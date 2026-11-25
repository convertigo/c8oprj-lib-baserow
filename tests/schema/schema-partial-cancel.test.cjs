// js/baserow_schema.js, the rollback of a run that completed a base of the user (C8Oforms #1836, lib_BaseRow
// 1.2.0-beta25): tables and fields matched by name, options added, new tables, fields, views and rows. The rollback
// deletes what the run made, and only that: the base is as it was before, whatever the user had in it.
const test = require('node:test');
const assert = require('node:assert/strict');
const BaserowSchema = require('../../js/baserow_schema.js');
const { fakeBaserow } = require('./fake-baserow.cjs');

const fixture = () => JSON.parse(JSON.stringify(require('./fixtures/mini-crm.baserow.json')));
const WORKSPACE = 836;

function runSteps(schema, api, options, max = 300) {
  let state = null;
  let answer;
  for (let i = 0; i < max; i++) {
    answer = BaserowSchema.step(JSON.stringify(schema), state && JSON.stringify(state), api, { workspaceId: WORKSPACE, ...options });
    state = answer.state;
    if (answer.status !== 'running') break;
  }
  return answer;
}

// everything a base holds, ids included: what the rollback must give back as it was
function snapshot(db) {
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const sort = (list) => copy(list).sort((a, b) => a.id - b.id);
  return {
    applications: sort(db.applications), tables: sort(db.tables), fields: sort(db.fields), views: sort(db.views),
    filters: sort(db.filters), sorts: sort(db.sorts), groupBys: sort(db.groupBys), groups: sort(db.groups),
    fieldOptions: copy(db.fieldOptions), rows: sort(db.rows),
  };
}

// the base of the user: the Mini CRM, plus a field, a view with a filter and a row of their own
function userBase() {
  const baserow = fakeBaserow();
  const made = runSteps(fixture(), baserow.api, {});
  assert.equal(made.status, 'done');
  const companies = made.state.tables.companies;
  const notes = baserow.api.createField(companies, { name: 'Notes', type: 'long_text' });
  const mine = baserow.api.createView(companies, { name: 'Mes sociétés', type: 'grid', filter_type: 'AND', public: false });
  baserow.api.createViewFilter(mine.id, { field: notes.id, type: 'contains', value: 'vip' });
  baserow.api.createRows(companies, [{ [`field_${made.map.fields['companies.name']}`]: 'Cobalt', [`field_${notes.id}`]: 'vip' }]);
  baserow.calls.length = 0;
  return { baserow, made, baseId: made.state.baseId };
}

// what an import brings to that base: the tables of the user matched by name, a field, an option, a new table linked
// to a table of the user, views (a new one, a sort added to one of the user), rows keyed by their own key
function importSchema() {
  return {
    format: 'c8oforms.baserow-template', formatVersion: 1, key: 'import', version: '1', base: { defaultName: 'Mini CRM' },
    tables: [
      {
        key: 'Sociétés', name: 'Sociétés', primaryField: { key: 'Nom', name: 'Nom', type: 'long_text' },
        fields: [
          { key: 'Secteur', name: 'Secteur', type: 'single_select', values: [{ key: 'Technologie', value: 'Technologie' }, { key: 'Agriculture', value: 'Agriculture', color: 'green' }] },
          { key: 'Notes', name: 'Notes', type: 'long_text' },
          { key: 'Priorité', name: 'Priorité', type: 'single_select', values: [{ key: 'Haute', value: 'Haute' }, { key: 'Basse', value: 'Basse' }] },
        ],
        views: [
          { key: 'Technologie', name: 'Technologie', type: 'grid', sorts: [{ field: 'Secteur', order: 'desc' }], fieldOptions: { Notes: { hidden: true } } },
          {
            key: 'Import', name: 'Import', type: 'grid', filterGroups: [{ key: 'g1', filterType: 'OR' }],
            filters: [{ field: 'Priorité', type: 'single_select_equal', options: ['Haute'], group: 'g1' }],
            groupBys: [{ field: 'Secteur', order: 'asc' }], fieldOptions: { Notes: { hidden: true, width: 90 } },
          },
        ],
        sampleRows: { upsertKey: 'Nom', rows: [{ _key: '1', Nom: 'Delta', Secteur: 'Agriculture', 'Priorité': 'Haute' }, { _key: '2', Nom: 'Epsilon' }] },
      },
      {
        key: 'Projets', name: 'Projets', primaryField: { key: 'Titre', name: 'Titre', type: 'text' },
        fields: [{ key: 'Société', name: 'Société', type: 'link_row', targetTable: 'Sociétés', createRelatedField: true, relatedFieldKey: 'Projets', relatedFieldName: 'Projets' }],
        views: [{ key: 'Tous', name: 'Tous', type: 'grid', sorts: [{ field: 'Titre', order: 'asc' }] }],
        sampleRows: { upsertKey: 'Titre', rows: [{ _key: '10', Titre: 'Serre', 'Société': ['1'] }] },
      },
    ],
  };
}

test('a run that completes a base of the user records what it makes, and the rollback deletes only that', () => {
  const { baserow, made, baseId } = userBase();
  const before = snapshot(baserow.db);
  const run = runSteps(importSchema(), baserow.api, { workspaceId: undefined, baseId, exactViews: true });
  assert.equal(run.status, 'done', JSON.stringify(run.error));
  assert.equal(run.state.createdBase, false);
  // the primary field of a table of the user keeps its type
  assert.ok(run.state.warnings.some((w) => w.code === 'primary_field_type' && w.table === 'Sociétés'));
  assert.equal(baserow.db.fields.find((f) => f.id === made.map.fields['companies.name']).type, 'text');
  // what it made
  const undo = run.state.undo;
  assert.deepEqual(undo.tables.map((t) => t.table), ['Projets']);
  assert.deepEqual(undo.fields.map((f) => f.table), ['Sociétés']);
  assert.equal(baserow.db.fields.find((f) => f.id === undo.fields[0].id).name, 'Priorité');
  assert.deepEqual(undo.options, [{ id: made.map.fields['companies.industry'], table: 'Sociétés', values: ['Agriculture'] }]);
  assert.deepEqual(undo.views.map((v) => v.table), ['Sociétés']);
  assert.equal(undo.sorts.length, 1, 'the sort added to the view of the user');
  assert.deepEqual(undo.rows.map((r) => [r.table, r.ids.length]), [['Sociétés', 2]]);
  assert.deepEqual(undo.pending, []);
  // the view of the user keeps its field options, the view made gets them
  assert.equal(baserow.db.fieldOptions[run.map.views['Sociétés.Technologie']], undefined);
  assert.deepEqual(baserow.db.fieldOptions[run.map.views['Sociétés.Import']][String(run.map.fields['Sociétés.Notes'])], { hidden: true, width: 90 });
  // the new table links a row made in the table of the user
  const project = baserow.db.rows.find((r) => r.table_id === run.state.tables.Projets);
  assert.deepEqual(project[`field_${run.map.fields['Projets.Société']}`], [run.state.rowIds['Sociétés']['1']]);
  // the rollback, then the base as it was
  const rollback = BaserowSchema.rollback(baserow.api, JSON.stringify(run.state));
  assert.equal(rollback.status, 'undone', JSON.stringify(rollback));
  assert.deepEqual(rollback.removed, { tables: 1, fields: 1, options: 1, views: 1, filters: 0, sorts: 1, groupBys: 0, rows: 2 });
  assert.deepEqual(rollback.errors, []);
  assert.deepEqual(snapshot(baserow.db), before);
  assert.ok(!baserow.calls.some((c) => c.name === 'deleteApplication' || c.name === 'emptyTrash'), 'never the base, never the trash');
  // again: nothing left to do
  assert.equal(BaserowSchema.rollback(baserow.api, rollback.state).status, 'nothing');
});

test('the rollback is bounded: running with its state, then undone; what is already gone is skipped', () => {
  const { baserow, baseId } = userBase();
  const before = snapshot(baserow.db);
  const run = runSteps(importSchema(), baserow.api, { workspaceId: undefined, baseId });
  assert.equal(run.status, 'done', JSON.stringify(run.error));
  // the user deleted one of the rows of the import and the view of the import meanwhile
  const gone = run.state.undo.rows[0].ids[0];
  baserow.api.deleteRows(run.state.tables['Sociétés'], [gone]);
  baserow.api.deleteView(run.map.views['Sociétés.Import']);
  let state = run.state;
  let answer;
  const statuses = [];
  for (let i = 0; i < 50; i++) {
    answer = BaserowSchema.rollback(baserow.api, JSON.stringify(state), { maxCalls: 1 });
    statuses.push(answer.status);
    state = answer.state;
    if (answer.status !== 'running') break;
  }
  assert.equal(answer.status, 'undone', JSON.stringify(answer));
  assert.ok(statuses.filter((s) => s === 'running').length >= 4, statuses.join());
  assert.equal(answer.removed.rows, 1);
  assert.equal(answer.removed.views, 0);
  assert.deepEqual(answer.errors, []);
  assert.deepEqual(snapshot(baserow.db), before);
});

test('a write whose answer was lost: found by its name for the rollback, never a thing of the user of that name', () => {
  const { baserow, baseId } = userBase();
  const before = snapshot(baserow.db);
  // the field Priorité is made by Baserow, its answer lost, and the run stops there (not retryable)
  const lost = Object.assign(new Error('ERROR_X: lost'), { code: 'baserow_error', baserowError: 'ERROR_X', retryable: false, applied: true });
  baserow.fail('createField', lost);
  const failed = runSteps(importSchema(), baserow.api, { workspaceId: undefined, baseId });
  assert.equal(failed.status, 'error');
  assert.deepEqual(failed.state.undo.pending, [{ kind: 'fields', table: 'Sociétés', name: 'Priorité' }]);
  assert.ok(baserow.db.fields.some((f) => f.name === 'Priorité'));
  const rollback = BaserowSchema.rollback(baserow.api, failed.state);
  assert.equal(rollback.status, 'undone', JSON.stringify(rollback));
  assert.equal(rollback.removed.fields, 1);
  assert.deepEqual(snapshot(baserow.db), before);
  // the same lost answer on a step run again: found by its name, recorded as made by the run
  const again = userBase();
  const snap = snapshot(again.baserow.db);
  again.baserow.fail('createView', Object.assign(new Error('timeout'), { code: 'baserow_unreachable', retryable: true, applied: true }));
  let state = null;
  let answer;
  for (let i = 0; i < 300; i++) {
    answer = BaserowSchema.step(JSON.stringify(importSchema()), state && JSON.stringify(state), again.baserow.api, { baseId: again.baseId });
    state = answer.state;
    if (answer.status === 'error' && answer.retryable) continue;
    if (answer.status !== 'running') break;
  }
  assert.equal(answer.status, 'done', JSON.stringify(answer.error));
  assert.equal(again.baserow.db.views.filter((v) => v.name === 'Import').length, 1);
  assert.deepEqual(answer.state.undo.views.map((v) => v.id), [answer.map.views['Sociétés.Import']]);
  assert.equal(BaserowSchema.rollback(again.baserow.api, answer.state).status, 'undone');
  assert.deepEqual(snapshot(again.baserow.db), snap);
});

test('a table, a field or a view of the user that the import names is never deleted, nor its data written over', () => {
  const { baserow, made, baseId } = userBase();
  const before = snapshot(baserow.db);
  // an import naming only what the user has: it adds nothing, the rollback deletes nothing
  const schema = importSchema();
  schema.tables = [schema.tables[0]];
  schema.tables[0].fields = schema.tables[0].fields.filter((f) => f.key === 'Notes');
  schema.tables[0].fields.push({ key: 'Secteur', name: 'Secteur', type: 'text' });
  schema.tables[0].views = [{ key: 'Mes sociétés', name: 'Mes sociétés', type: 'grid', filters: [{ field: 'Notes', type: 'contains', value: 'vip' }], fieldOptions: { Notes: { hidden: true } } }];
  delete schema.tables[0].sampleRows;
  schema.tables[0].primaryField.type = 'text';
  const run = runSteps(schema, baserow.api, { workspaceId: undefined, baseId });
  assert.equal(run.status, 'done', JSON.stringify(run.error));
  assert.ok(run.state.warnings.some((w) => w.code === 'field_type_mismatch'));
  assert.equal(BaserowSchema.rollback(baserow.api, run.state).status, 'nothing');
  assert.deepEqual(snapshot(baserow.db), before);
  assert.ok(!baserow.calls.some((c) => /^(create|update|delete)/.test(c.name)), JSON.stringify(baserow.calls.map((c) => c.name)));
  // a rollback of a base this run created deletes the base (as before)
  const fresh = fakeBaserow();
  const created = runSteps(fixture(), fresh.api, {});
  assert.equal(BaserowSchema.rollback(fresh.api, created.state).status, 'deleted');
  assert.equal(made.state.createdBase, true);
});

// review of beta26: a read that fails once while the snapshot is taken never makes a thing of the user the run's
test('a read that fails during the snapshot: the step runs again whole, nothing of the user is taken for the run', () => {
  for (const failing of ['listTables', 'listFields', 'listViews']) {
    const { baserow, baseId } = userBase();
    const before = snapshot(baserow.db);
    const schema = importSchema();
    schema.tables[0].views.push({ key: 'Mes sociétés', name: 'Mes sociétés', type: 'grid', fieldOptions: { Notes: { hidden: true } }, filterGroups: [{ key: 'g' }], filters: [{ field: 'Notes', type: 'contains', value: 'x', group: 'g' }] });
    schema.tables[0].fields.push({ key: 'Notes', name: 'Notes', type: 'long_text' });
    schema.tables[0].fields = schema.tables[0].fields.filter((f, i, all) => all.findIndex((g) => g.key === f.key) === i);
    // after the reads of the base itself (getApplication, listWorkspaces), the next read of that kind fails once
    baserow.fail(failing, Object.assign(new Error('timeout'), { code: 'baserow_unreachable', retryable: true }));
    let state = null;
    let answer;
    for (let i = 0; i < 300; i++) {
      answer = BaserowSchema.step(JSON.stringify(schema), state && JSON.stringify(state), baserow.api, { baseId });
      state = answer.state;
      if (answer.status === 'error' && answer.retryable) continue;
      if (answer.status !== 'running') break;
    }
    assert.equal(answer.status, 'done', `${failing}: ${JSON.stringify(answer.error)}`);
    const mine = baserow.db.views.find((v) => v.name === 'Mes sociétés');
    assert.equal(baserow.db.fieldOptions[mine.id], undefined, `${failing}: the view of the user keeps its field options`);
    assert.equal(baserow.db.groups.filter((g) => g.view === mine.id).length, 0, `${failing}: and gets no group`);
    assert.ok(!answer.state.undo.views.some((v) => v.id === mine.id), failing);
    assert.ok(!answer.state.undo.fields.some((f) => baserow.db.fields.find((x) => x.id === f.id).name === 'Notes'), failing);
    const rollback = BaserowSchema.rollback(baserow.api, answer.state);
    assert.equal(rollback.status, 'undone', failing);
    assert.deepEqual(snapshot(baserow.db), before, `${failing}: the base as it was`);
  }
});

test('a batch of rows whose answer was lost is found again: never written twice, deleted by the rollback', () => {
  // retried: the rows of the batch are recognized at the end of the table
  const { baserow, baseId } = userBase();
  const before = snapshot(baserow.db);
  baserow.fail('createRows', Object.assign(new Error('timeout'), { code: 'baserow_unreachable', retryable: true, applied: true }));
  let state = null;
  let answer;
  for (let i = 0; i < 300; i++) {
    answer = BaserowSchema.step(JSON.stringify(importSchema()), state && JSON.stringify(state), baserow.api, { baseId });
    state = answer.state;
    if (answer.status === 'error' && answer.retryable) continue;
    if (answer.status !== 'running') break;
  }
  assert.equal(answer.status, 'done', JSON.stringify(answer.error));
  const companies = answer.state.tables['Sociétés'];
  assert.equal(baserow.db.rows.filter((r) => r.table_id === companies).length, 3 + 2, 'the 3 rows of the user and the 2 of the import, once');
  assert.deepEqual(answer.state.rowMarks, {});
  assert.equal(BaserowSchema.rollback(baserow.api, answer.state).status, 'undone');
  assert.deepEqual(snapshot(baserow.db), before);
  // not retried (the run stops): the rollback finds them by the number of rows of the table
  const again = userBase();
  const snap = snapshot(again.baserow.db);
  again.baserow.fail('createRows', Object.assign(new Error('ERROR_X: lost'), { code: 'baserow_error', baserowError: 'ERROR_X', retryable: false, applied: true }));
  const failed = runSteps(importSchema(), again.baserow.api, { workspaceId: undefined, baseId: again.baseId });
  assert.equal(failed.status, 'error');
  assert.deepEqual(failed.state.undo.pending.map((p) => [p.kind, p.table, p.size]), [['rows', 'Sociétés', 2]]);
  const undone = BaserowSchema.rollback(again.baserow.api, failed.state);
  assert.equal(undone.status, 'undone', JSON.stringify(undone));
  assert.equal(undone.removed.rows, 2);
  assert.deepEqual(snapshot(again.baserow.db), snap);
});
