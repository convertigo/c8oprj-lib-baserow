// js/baserow_schema.js on an in-memory Baserow: plan, field phases, key resolution, bounded and idempotent steps,
// new base each time, workspace of the user only, definitive delete and bounded wait of a job.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const BaserowSchema = require('../../js/baserow_schema.js');
const { fakeBaserow } = require('./fake-baserow.cjs');

const fixture = () => JSON.parse(JSON.stringify(require('./fixtures/mini-crm.baserow.json')));
const WORKSPACE = 836;

// all the steps, the state of each answer given to the next one
function runSteps(schema, api, options, max = 100) {
  let state = null;
  const answers = [];
  for (let i = 0; i < max; i++) {
    const answer = BaserowSchema.step(JSON.stringify(schema), state && JSON.stringify(state), api, { workspaceId: WORKSPACE, ...options });
    answers.push(answer);
    state = answer.state;
    if (answer.status !== 'running') break;
  }
  return answers;
}

const writes = ['createWorkspace', 'createDatabase', 'createTable', 'createField', 'updateField', 'createView',
  'createViewFilter', 'createViewSort', 'createRows', 'updateRows', 'deleteApplication', 'emptyTrash'];

test('plan on the fixture: the actions in phase order, no Baserow call offline', () => {
  const plan = BaserowSchema.plan(fixture());
  assert.equal(plan.status, 'ok', JSON.stringify(plan.error));
  assert.deepEqual(plan.summary, { tables: 3, fields: 9, links: 3, computed: 4, views: 3, rows: 6 });
  const types = plan.actions.map((a) => a.type);
  assert.equal(types[0], 'create_base');
  assert.deepEqual(plan.actions.filter((a) => a.type === 'create_table').map((a) => a.name), ['Sociétés', 'Contacts', 'Opportunités']);
  const fields = plan.actions.filter((a) => a.type === 'create_field');
  const firstLink = fields.findIndex((a) => a.fieldType === 'link_row');
  const firstComputed = fields.findIndex((a) => ['lookup', 'rollup', 'count', 'formula'].includes(a.fieldType));
  assert.ok(fields.slice(0, firstLink).every((a) => !['link_row', 'lookup', 'rollup', 'count', 'formula'].includes(a.fieldType)));
  assert.ok(fields.slice(firstLink, firstComputed).every((a) => a.fieldType === 'link_row'));
  assert.ok(fields.slice(firstComputed).every((a) => ['lookup', 'rollup', 'count', 'formula'].includes(a.fieldType)));
  assert.ok(types.indexOf('create_view') > types.lastIndexOf('create_field'));
  assert.ok(types.indexOf('create_rows') > types.lastIndexOf('create_view'));
  assert.deepEqual(plan.actions.filter((a) => a.type === 'create_view_filter').map((a) => a.field), ['industry']);
  const summary = fields.find((a) => a.field === 'summary');
  assert.equal(summary.body.formula, "concat(field('Nom'), ' - ', totext(field('Nombre d\\'opportunités')))");
});

test('plan with an api reads the base of the user and never writes', () => {
  const baserow = fakeBaserow();
  const plan = BaserowSchema.plan(fixture(), baserow.api, { workspaceId: WORKSPACE });
  assert.equal(plan.status, 'ok', JSON.stringify(plan.error));
  assert.deepEqual(baserow.calls.map((c) => c.name), ['listWorkspaces']);
  const refused = BaserowSchema.plan(fixture(), baserow.api, { workspaceId: 999 });
  assert.equal(refused.error.code, 'workspace_not_in_catalog');
  assert.ok(!baserow.calls.some((c) => writes.includes(c.name)));
});

test('the field phases: simple fields, then links, then computed fields after what they read', () => {
  const units = BaserowSchema.units(BaserowSchema.normalizeSchema(fixture()), {});
  const phases = units.map((u) => u.phase);
  const order = ['base', 'tables', 'fields', 'links', 'computed', 'views', 'rows', 'rowlinks', 'done'];
  for (let i = 1; i < phases.length; i++) {
    assert.ok(order.indexOf(phases[i]) >= order.indexOf(phases[i - 1]), `${phases[i - 1]} then ${phases[i]}`);
  }
  const computed = units.filter((u) => u.phase === 'computed').map((u) => `${u.table}.${u.field}`);
  assert.ok(computed.indexOf('companies.summary') > computed.indexOf('companies.deal_count'), computed.join());
  // the primary field of a table and the related fields of the links are not created by a field unit
  assert.ok(!units.some((u) => u.field === 'name' || u.field === 'contacts' || u.field === 'deals'));
  // without sample data, no row unit
  assert.ok(!BaserowSchema.units(BaserowSchema.normalizeSchema(fixture()), { sampleData: false }).some((u) => u.phase === 'rows'));
});

test('a full run: bounded steps, the key -> id map, rows with option ids and row ids, links of a cycle afterwards', () => {
  const baserow = fakeBaserow();
  const answers = runSteps(fixture(), baserow.api, { maxCalls: 6 });
  const last = answers[answers.length - 1];
  assert.equal(last.status, 'done', JSON.stringify(last.error));
  assert.ok(answers.length > 4, `${answers.length} steps`);
  for (const answer of answers) {
    assert.ok(answer.calls <= 6 + 8, `${answer.calls} calls in a step`);
  }
  const { db } = baserow;
  assert.equal(db.applications.length, 1);
  const base = db.applications[0];
  assert.deepEqual([base.name, base.workspace.id], ['Mini CRM', WORKSPACE]);
  assert.equal(last.state.createdBase, true);
  assert.equal(last.state.baseId, base.id);
  const map = last.map;
  assert.deepEqual(Object.keys(map.tables), ['companies', 'contacts', 'deals']);
  for (const [key, tableId] of Object.entries(map.tables)) {
    assert.equal(db.tables.find((t) => t.id === tableId).database_id, base.id, key);
  }
  const field = (key) => db.fields.find((f) => f.id === map.fields[key]);
  assert.equal(field('companies.name').primary, true);
  assert.equal(field('companies.name').name, 'Nom');
  assert.equal(field('contacts.company').link_row_table_id, map.tables.companies);
  assert.equal(field('companies.contacts').name, 'Contacts', 'the related field is named as the schema says');
  assert.equal(field('companies.deals').name, 'Opportunités');
  assert.equal(field('companies.main_contact').has_related_field, false);
  assert.equal(field('companies.deals_value').through_field_id, map.fields['companies.deals']);
  assert.equal(field('companies.deals_value').target_field_id, map.fields['deals.amount']);
  assert.equal(field('contacts.company_industry').target_field_id, map.fields['companies.industry']);
  assert.equal(field('companies.created').type, 'created_on');
  assert.equal(field('deals.amount').number_decimal_places, 2);
  assert.equal(map.options['deals.stage.won'], field('deals.stage').select_options.find((o) => o.value === 'Gagnée').id);
  const view = db.views.find((v) => v.id === map.views['companies.by_industry']);
  assert.equal(view.public, false);
  assert.deepEqual(db.filters.filter((f) => f.view === view.id).map((f) => [f.field, f.type, f.value]),
    [[map.fields['companies.industry'], 'single_select_equal', String(map.options['companies.industry.tech'])]]);
  assert.equal(db.views.find((v) => v.id === map.views['deals.pipeline']).single_select_field, map.fields['deals.stage']);
  assert.deepEqual(db.sorts.filter((s) => s.view === map.views['deals.agenda']).map((s) => s.order), ['DESC']);
  const rows = (table) => db.rows.filter((r) => r.table_id === map.tables[table]);
  const rowIds = last.state.rowIds;
  const acme = rows('companies').find((r) => r[`field_${map.fields['companies.name']}`] === 'Acme');
  assert.equal(acme.id, rowIds.companies.Acme);
  assert.equal(acme[`field_${map.fields['companies.industry']}`], map.options['companies.industry.tech']);
  assert.deepEqual(acme[`field_${map.fields['companies.main_contact']}`], [rowIds.contacts['Alice Martin']]);
  const alice = rows('contacts').find((r) => r.id === rowIds.contacts['Alice Martin']);
  assert.deepEqual(alice[`field_${map.fields['contacts.company']}`], [rowIds.companies.Acme], 'link of the cycle written by rowlinks');
  const deal = rows('deals').find((r) => r.id === rowIds.deals['Bazar 2026']);
  assert.deepEqual(deal[`field_${map.fields['deals.tags']}`], [map.options['deals.tags.Partenaire'], map.options['deals.tags.Urgent']]);
  assert.deepEqual(last.state.rowsDone, { contacts: 2, companies: 2, deals: 2 });
  assert.equal(baserow.calls.filter((c) => c.name === 'updateRows').length, 1);
  // a step on a finished state does nothing
  const again = BaserowSchema.step(fixture(), last.state, baserow.api, { workspaceId: WORKSPACE });
  assert.equal(again.status, 'done');
  assert.equal(again.calls, 0);
});

test('without sample data: tables, fields and views, no row', () => {
  const baserow = fakeBaserow();
  const last = runSteps(fixture(), baserow.api, { sampleData: false }).pop();
  assert.equal(last.status, 'done');
  assert.equal(baserow.db.rows.length, 0);
  assert.equal(baserow.db.views.length, 3);
});

test('a base is never reused by name: each run creates its own base', () => {
  const baserow = fakeBaserow();
  baserow.api.createDatabase(WORKSPACE, 'Mini CRM');
  const last = runSteps(fixture(), baserow.api, {}).pop();
  assert.equal(last.status, 'done');
  assert.equal(baserow.db.applications.filter((a) => a.name === 'Mini CRM').length, 2);
  assert.notEqual(last.state.baseId, baserow.db.applications[0].id);
  const named = runSteps(fixture(), baserow.api, { baseName: 'Mini CRM (3)' }).pop();
  assert.equal(baserow.db.applications.find((a) => a.id === named.state.baseId).name, 'Mini CRM (3)');
  for (const name of ['a~>b', 'x'.repeat(161)]) {
    const refused = BaserowSchema.step(fixture(), null, fakeBaserow().api, { workspaceId: WORKSPACE, baseName: name });
    assert.equal(refused.error.code, 'base_name_invalid');
  }
});

test('the workspace must be one of the workspaces of the user', () => {
  const baserow = fakeBaserow({ workspaces: [{ id: 836, name: 'Convertigo NoCode Databases - user@example.com' }, { id: 900, name: 'Shared' }] });
  const refused = BaserowSchema.step(fixture(), null, baserow.api, { workspaceId: 12 });
  assert.equal(refused.status, 'error');
  assert.equal(refused.error.code, 'workspace_not_in_catalog');
  assert.equal(refused.retryable, false);
  const schema = { ...fixture(), workspaceId: 12 };
  assert.equal(BaserowSchema.step(schema, null, baserow.api, {}).error.code, 'workspace_not_in_catalog');
  assert.equal(BaserowSchema.step({ ...fixture(), workspaceId: 900 }, null, baserow.api, { workspaceId: 836 }).error.code, 'workspace_mismatch');
  assert.equal(BaserowSchema.step(fixture(), null, baserow.api, {}).error.code, 'workspace_required');
  assert.ok(!baserow.calls.some((c) => writes.includes(c.name)), 'nothing created');
  const byName = BaserowSchema.step({ ...fixture(), workspaceName: 'shared' }, null, baserow.api, { maxCalls: 1 });
  assert.equal(byName.state.workspaceId, 900);
});

test('an error keeps the state of what exists (base included), for the rollback; the definitive delete empties the trash', () => {
  const baserow = fakeBaserow();
  baserow.fail('createField', baserow.baserowError('ERROR_REQUEST_BODY_VALIDATION', 'bad field'), { after: 3 });
  const answers = runSteps(fixture(), baserow.api, {});
  const last = answers[answers.length - 1];
  assert.equal(last.status, 'error');
  assert.equal(last.retryable, false);
  assert.match(last.error.message, /ERROR_REQUEST_BODY_VALIDATION/);
  assert.equal(last.state.phase, 'fields');
  assert.equal(last.state.createdBase, true);
  assert.equal(last.state.baseId, baserow.db.applications[0].id);
  assert.equal(Object.keys(last.state.tables).length, 3);
  const deleted = BaserowSchema.deleteBase(baserow.api, last.state.baseId, last.state.workspaceId);
  assert.equal(deleted.status, 'deleted');
  assert.equal(baserow.db.applications.length, 0);
  assert.equal(baserow.db.trash.length, 0, 'not left in the trash');
  assert.deepEqual(baserow.calls.slice(-3).map((c) => c.name), ['getApplication', 'deleteApplication', 'emptyTrash']);
  assert.deepEqual(baserow.calls[baserow.calls.length - 1].args, [WORKSPACE, last.state.baseId]);
});

test('the definitive delete refuses a base of another workspace, or without workspace', () => {
  const baserow = fakeBaserow({ workspaces: [{ id: 836, name: 'Mine' }, { id: 900, name: 'Shared' }] });
  const shared = baserow.api.createDatabase(900, 'Shared base');
  assert.throws(() => BaserowSchema.deleteBase(baserow.api, shared.id, 836), { code: 'delete_refused' });
  assert.throws(() => BaserowSchema.deleteBase(baserow.api, shared.id, null), { code: 'delete_refused' });
  assert.equal(baserow.db.applications.length, 1);
  assert.ok(!baserow.calls.some((c) => c.name === 'deleteApplication'));
});

// A write Baserow did although its answer was lost: the next step reads the base again and does not do it twice.
for (const [name, after] of [['createTable', 1], ['createField', 2], ['createField', 12], ['createView', 1], ['createViewFilter', 0], ['createRows', 1]]) {
  test(`idempotent step: ${name} done by Baserow but answered with an error is not done twice`, () => {
    const baserow = fakeBaserow();
    const lost = new Error('Read timed out');
    lost.code = 'baserow_unreachable';
    lost.retryable = true;
    lost.applied = true;
    baserow.fail(name, lost, { after });
    const answers = runSteps(fixture(), baserow.api, { maxCalls: 10 });
    const failed = answers.find((a) => a.status === 'error');
    assert.ok(failed, 'the lost answer is an error');
    assert.equal(failed.retryable, true);
    // the client retries the step with the state of the error
    let state = failed.state;
    let answer;
    for (let i = 0; i < 50; i++) {
      answer = BaserowSchema.step(fixture(), state, baserow.api, { workspaceId: WORKSPACE, maxCalls: 10 });
      state = answer.state;
      if (answer.status !== 'running') break;
    }
    assert.equal(answer.status, 'done', JSON.stringify(answer.error));
    const { db } = baserow;
    assert.equal(db.applications.length, 1);
    assert.equal(db.tables.length, 3);
    const names = db.fields.map((f) => `${f.table_id}.${f.name}`);
    assert.equal(new Set(names).size, names.length, 'no field twice');
    assert.equal(db.views.length, 3);
    assert.equal(db.filters.length, 1);
    assert.equal(db.rows.length, 6);
    for (const [key, id] of Object.entries(answer.map.fields)) {
      assert.ok(db.fields.some((f) => f.id === id), key);
    }
  });
}

test('the key of a table, a field or an option is its name when the schema gives none (format of the MCP tool)', () => {
  const schema = {
    workspaceId: WORKSPACE,
    baseName: 'Congés',
    tables: [
      { name: 'Employees', primaryField: 'Nom', upsertKey: 'Nom',
        fields: [{ name: 'Nom', type: 'text' }, { name: 'Service', type: 'select', values: ['RH', 'IT'] }],
        sampleRows: [{ nom: 'Alice', service: 'IT' }, { Nom: 'Bob', Service: 'RH' }] },
      { name: 'Requests', fields: [{ name: 'Title', type: 'text' }, { name: 'Employee', type: 'link', targetTable: 'employees' },
        { name: 'Days', type: 'integer' }, { name: 'Service', type: 'lookup', through: 'Employee', targetField: 'Service' },
        { name: 'Label', type: 'formula', formula: 'concat(field("Title"), "!")' }],
        sampleRows: [{ Title: 'Été', Employee: ['Alice'], Days: 5 }] },
    ],
  };
  const baserow = fakeBaserow();
  const last = runSteps(schema, baserow.api, {}).pop();
  assert.equal(last.status, 'done', JSON.stringify(last.error));
  assert.ok(last.map.fields['Employees.Nom'] != null);
  assert.ok(last.map.fields['Requests.Title'] != null, 'the first text field is the primary field');
  assert.ok(last.map.options['Employees.Service.IT'] != null);
  const formula = baserow.db.fields.find((f) => f.name === 'Label');
  assert.equal(formula.formula, "concat(field('Title'), \"!\")");
  const request = baserow.db.rows.find((r) => r.table_id === last.map.tables.Requests);
  assert.deepEqual(request[`field_${last.map.fields['Requests.Employee']}`], [last.state.rowIds.Employees.Alice]);
});

test('the schema is checked before any call', () => {
  const cases = [
    [(s) => { s.tables[0].fields.push({ key: 'secret', name: 'Mot de passe', type: 'password' }); }, /password fields are refused/],
    [(s) => { s.tables[0].fields.push({ key: 'x', name: 'X', type: 'hologram' }); }, /unknown field type hologram/],
    [(s) => { s.tables[0].fields[0].key = 'website'; }, /declared twice/],
    [(s) => { s.tables[0].fields[3].targetField = 'nope'; }, /no field nope in table deals/],
    [(s) => { s.tables[0].fields[2].targetTable = 'nope'; }, /unknown table nope/],
    [(s) => { s.tables[0].fields[5].formula = "field('ghost')"; }, /no field ghost/],
    [(s) => { s.tables[0].views[0].filters[0].option = 'farming'; }, /no option farming/],
    [(s) => { s.tables[0].views[0].public = true; }, /never public/],
    [(s) => { s.tables[0].sampleRows.rows[0].summary = 'x'; }, /computed by the base/],
    [(s) => { s.tables[0].sampleRows.rows[0].industry = 'farming'; }, /no option farming/],
    [(s) => { s.tables[1].sampleRows.rows[0].company = ['Nobody']; }, /links a row Nobody missing from companies/],
    [(s) => { s.tables[0].sampleRows.rows[1].name = 'Acme'; }, /used by two rows/],
    [(s) => { s.tables[0].name = 'A~>B'; }, /separator/],
    [(s) => { s.limits.maxRowsPerTable = 1; }, /more than limits.maxRowsPerTable/],
    [(s) => { s.formatVersion = 2; }, /Unknown schema formatVersion/],
    [(s) => {
      s.tables[0].fields.push({ key: 'f1', name: 'F1', type: 'formula', formula: "field('f2')" },
        { key: 'f2', name: 'F2', type: 'formula', formula: "field('f1')" });
    }, /read each other/],
    [(s) => { s.tables[0].primaryField.type = 'link_row'; }, /cannot be the primary field/],
  ];
  for (const [change, message] of cases) {
    const schema = fixture();
    change(schema);
    const baserow = fakeBaserow();
    const answer = BaserowSchema.step(schema, null, baserow.api, { workspaceId: WORKSPACE });
    assert.equal(answer.status, 'error', String(message));
    assert.match(answer.error.message, message);
    assert.equal(baserow.calls.length, 0, String(message));
    assert.equal(BaserowSchema.plan(schema).status, 'error');
  }
});

test('the types of the business templates are accepted: created_on, last_modified, created_by, last_modified_by, uuid, autonumber', () => {
  const schema = fixture();
  schema.tables[2].fields.push({ key: 'by', name: 'Créé par', type: 'created_by' }, { key: 'mby', name: 'Modifié par', type: 'last_modified_by' },
    { key: 'uid', name: 'UID', type: 'uuid' }, { key: 'num', name: 'Numéro', type: 'auto_number' });
  const plan = BaserowSchema.plan(schema);
  assert.equal(plan.status, 'ok', JSON.stringify(plan.error));
  assert.deepEqual(plan.actions.filter((a) => a.table === 'deals' && a.type === 'create_field' && a.fieldType !== 'link_row').map((a) => a.fieldType).slice(-4),
    ['created_by', 'last_modified_by', 'uuid', 'autonumber']);
});

test('formulas: field(key) and lookup(link key, key) become names, quotes escaped', () => {
  const schema = BaserowSchema.normalizeSchema(fixture());
  const companies = schema.tables[0];
  assert.equal(BaserowSchema.translateFormula(schema, companies, 'field("industry") & field(\'deal_count\')'),
    "field('Secteur') & field('Nombre d\\'opportunités')");
  assert.equal(BaserowSchema.translateFormula(schema, companies, "join(lookup('deals', 'stage'), ',')"),
    "join(lookup('Opportunités', 'Étape'), ',')");
  assert.equal(BaserowSchema.translateFormula(schema, companies, "field('Nom')"), "field('Nom')", 'a name is kept');
});

test('an existing base (baseId, the MCP tool): checked against the workspaces of the user, its tables and fields matched by name', () => {
  const baserow = fakeBaserow();
  const first = runSteps(fixture(), baserow.api, { sampleData: false }).pop();
  assert.equal(first.status, 'done');
  const before = baserow.db.fields.length;
  const schema = fixture();
  schema.tables[0].fields[0].values.push({ key: 'farming', value: 'Agriculture' });
  schema.tables[0].fields[1].type = 'text';
  const second = runSteps(schema, baserow.api, { workspaceId: undefined, baseId: first.state.baseId }).pop();
  assert.equal(second.status, 'done', JSON.stringify(second.error));
  assert.equal(second.state.createdBase, false);
  assert.equal(baserow.db.applications.length, 1);
  assert.equal(baserow.db.fields.length, before);
  assert.ok(second.state.warnings.some((w) => w.code === 'field_type_mismatch' && w.field === 'website'));
  const industry = baserow.db.fields.find((f) => f.id === second.map.fields['companies.industry']);
  assert.deepEqual(industry.select_options.map((o) => o.value), ['Technologie', 'Commerce', 'Agriculture']);
  assert.equal(second.map.options['companies.industry.farming'], industry.select_options[2].id);
  assert.equal(baserow.db.rows.length, 6);
  // the rollback of a run in a base that existed undoes what it added (the option), never the base
  const rollback = BaserowSchema.rollback(baserow.api, second.state);
  assert.equal(rollback.status, 'undone', JSON.stringify(rollback));
  assert.equal(rollback.removed.options, 1);
  assert.equal(rollback.removed.rows, 6, 'the sample rows this run wrote in the tables of the user');
  assert.equal(baserow.db.applications.length, 1, 'a base the state did not create is never deleted');
  assert.deepEqual(baserow.db.fields.find((f) => f.id === industry.id).select_options.map((o) => o.value), ['Technologie', 'Commerce']);
  assert.equal(baserow.db.fields.length, before);
  assert.equal(baserow.db.rows.length, 0);
  const nothing = BaserowSchema.engine.run({ mode: 'rollback', state: JSON.stringify({ ...second.state, undo: null }) });
  assert.equal(nothing.status, 'nothing', 'a state that made nothing in a base it did not create deletes nothing');
  const outside = fakeBaserow({ workspaces: [{ id: 836, name: 'Mine' }, { id: 900, name: 'Other' }] });
  const other = outside.api.createDatabase(900, 'Other base');
  outside.db.workspaces.pop();
  assert.equal(BaserowSchema.step(fixture(), null, outside.api, { baseId: other.id }).error.code, 'baserow_error');
  const foreign = fakeBaserow({ workspaces: [{ id: 836, name: 'Mine' }, { id: 900, name: 'Other' }] });
  const base = foreign.api.createDatabase(900, 'Other base');
  assert.equal(BaserowSchema.step(fixture(), null, foreign.api, { baseId: base.id, workspaceId: 836 }).error.code, 'base_not_in_catalog');
});

test('the wait of a job is bounded: finished, failed, unknown, or a timeout', () => {
  let polls = 0;
  const clock = { t: 0 };
  const options = { timeoutMs: 5000, intervalMs: 1000, now: () => clock.t, sleep: (ms) => { clock.t += ms; } };
  const finishing = fakeBaserow({ jobs: { 7: () => ({ id: 7, state: ++polls < 3 ? 'started' : 'finished', progress_percentage: polls * 30 }) } });
  assert.equal(BaserowSchema.waitJob(finishing.api, 7, options).state, 'finished');
  assert.equal(polls, 3);

  const failing = fakeBaserow({ jobs: { 8: { id: 8, state: 'failed', human_readable_error: 'Import refused' } } });
  assert.throws(() => BaserowSchema.waitJob(failing.api, 8, options), { code: 'job_failed', message: /Import refused/ });

  clock.t = 0;
  const pending = fakeBaserow({ jobs: { 9: { id: 9, state: 'pending' } } });
  assert.throws(() => BaserowSchema.waitJob(pending.api, 9, options), (e) => e.code === 'job_timeout' && e.retryable === true);
  assert.ok(pending.calls.length <= 6, `${pending.calls.length} polls`);
  assert.ok(clock.t <= 5000);

  const stuck = fakeBaserow({ jobs: { 10: { id: 10, state: 'started' } } });
  assert.throws(() => BaserowSchema.waitJob(stuck.api, 10, { maxPolls: 3, timeoutMs: 1e9, intervalMs: 1, sleep: () => {} }), { code: 'job_timeout' });
  assert.equal(stuck.calls.length, 3);

  assert.throws(() => BaserowSchema.waitJob(fakeBaserow().api, 11, options), /ERROR_JOB_DOES_NOT_EXIST/);
  assert.throws(() => BaserowSchema.waitJob(fakeBaserow({ jobs: { 12: { id: 12 } } }).api, 12, options), { code: 'job_unknown' });
  assert.throws(() => BaserowSchema.waitJob(fakeBaserow().api, 'x', options), { code: 'job_invalid' });
});

test('apply runs all the steps in one call and reports what it created', () => {
  const baserow = fakeBaserow();
  const answer = BaserowSchema.apply(fixture(), null, baserow.api, { workspaceId: WORKSPACE });
  assert.equal(answer.status, 'done', JSON.stringify(answer.error));
  assert.equal(answer.created.bases.length, 1);
  assert.equal(answer.created.tables.length, 3);
  assert.equal(answer.created.fields.length, 16);
  assert.equal(answer.created.views.length, 3);
  assert.equal(answer.created.rows, 6);
});

test('the file is plain ECMAScript 5 for Rhino (no let, const, arrow function, template or class)', () => {
  const source = require('node:fs').readFileSync(path.join(__dirname, '../../js/baserow_schema.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''");
  assert.doesNotMatch(source, /\b(let|const|class)\s/);
  assert.doesNotMatch(source, /=>/);
  assert.doesNotMatch(source, /`/);
  assert.doesNotMatch(source, /\.\.\.[a-zA-Z]/);
});

test('a base created or deleted forgets the table ids js/common.js cached by path, for every user, that base only', () => {
  const entries = new Map([
    ['project_hash', 1],
    ['jwt:alice~>Mine~>Mini CRM~>Companies', '501'],
    ['jwt:bob~>Mine~>Mini CRM~>Contacts', '502'],
    ['jwt:alice~>Mine~>Mini CRM (2)~>Companies', '601'],
    ['jwt:alice~>Other~>Mini CRM~>Companies', '701'],
  ]);
  const cache = { keySet: () => ({ toArray: () => [...entries.keys()] }), remove: (key) => entries.delete(key) };
  global.context = { project: { get: (name) => (name === 'table_id_cache' ? cache : null) } };
  try {
    assert.equal(BaserowSchema.forgetTablePaths('Mine', 'Mini CRM'), 2);
    assert.deepEqual([...entries.keys()], ['project_hash', 'jwt:alice~>Mine~>Mini CRM (2)~>Companies', 'jwt:alice~>Other~>Mini CRM~>Companies']);
    assert.equal(BaserowSchema.forgetTablePaths('', 'Mini CRM'), 0);
  } finally {
    delete global.context;
  }
});
