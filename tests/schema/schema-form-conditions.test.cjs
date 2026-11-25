// js/baserow_schema.js, the conditions that show the fields of a form (C8Oforms #1836, lib_BaseRow 1.2.0-beta28):
// - describe with views reads, for each field of a form, when it is shown (its conditions on the other fields, by name,
//   select options and linked rows by key, in groups of conditions), its component and the options of a select it
//   offers (by key);
// - apply writes them on a form of the run only, one write per level of groups, new conditions and groups with ids of
//   their own; the round trip describe -> apply -> describe gives the same schema.
const test = require('node:test');
const assert = require('node:assert/strict');
const BaserowSchema = require('../../js/baserow_schema.js');
const { fakeBaserow } = require('./fake-baserow.cjs');

const fixture = () => JSON.parse(JSON.stringify(require('./fixtures/mini-crm.baserow.json')));
const WORKSPACE = 836;
const WORKSPACE_NAME = 'Convertigo NoCode Databases - user@example.com';
const path = (table, base = 'Mini CRM') => `${WORKSPACE_NAME}~>${base}~>${table}`;

function runSteps(schema, api, options, max = 300) {
  let state = null;
  let answer;
  for (let i = 0; i < max; i++) {
    answer = BaserowSchema.step(JSON.stringify(schema), state && JSON.stringify(state), api, { workspaceId: WORKSPACE, ...options });
    state = answer.state;
    if (answer.status === 'error' && answer.retryable) continue;
    if (answer.status !== 'running') break;
  }
  return answer;
}

// a form of Sociétés: Site web shown when the company is in Commerce, or (its name holds Ac and, in a group under it,
// its main contact is Alice); Secteur offered as radio buttons with the option Technologie only
function formView() {
  return {
    key: 'form', name: 'Formulaire', type: 'form',
    fieldOptions: {
      website: {
        enabled: true, required: false, order: 2, showWhenMatchingConditions: true, conditionType: 'OR',
        conditionGroups: [{ key: 'g1', filterType: 'AND' }, { key: 'g2', filterType: 'OR', parent: 'g1' }],
        conditions: [
          { field: 'industry', type: 'single_select_equal', options: ['retail'] },
          { field: 'name', type: 'contains', value: 'Ac', group: 'g1' },
          { field: 'main_contact', type: 'link_row_has', rows: ['Alice Martin'], group: 'g2' },
        ],
      },
      industry: { enabled: true, order: 1, fieldComponent: 'radio', includeAllSelectOptions: false, allowedSelectOptions: ['tech'] },
      name: { enabled: true, required: true, order: 0 },
    },
  };
}

function source(view = formView()) {
  const baserow = fakeBaserow();
  const schema = fixture();
  schema.tables.find((t) => t.key === 'companies').views.push(view);
  const made = runSteps(schema, baserow.api, {});
  assert.equal(made.status, 'done', JSON.stringify(made.error));
  baserow.calls.length = 0;
  return { baserow, made };
}

const describeForm = (baserow, base = 'Mini CRM') => BaserowSchema.describe(baserow.api, { tables: [{ path: path('Sociétés', base) }], rows: true, views: true });

// the schema without what differs from one base to another (the keys of the rows: their rank)
function canonical(described) {
  const schema = JSON.parse(JSON.stringify(described.bases[0].schema));
  const rank = {};
  for (const table of schema.tables) {
    rank[table.key] = {};
    (table.sampleRows ? table.sampleRows.rows : []).forEach((row, i) => { rank[table.key][row._key] = `r${i}`; });
  }
  for (const table of schema.tables) {
    const fields = [table.primaryField, ...table.fields];
    for (const row of table.sampleRows ? table.sampleRows.rows : []) {
      row._key = rank[table.key][row._key];
      for (const field of fields) if (field.type === 'link_row' && row[field.key]) row[field.key] = row[field.key].map((k) => rank[field.targetTable][k]);
    }
    for (const view of table.views || []) {
      for (const options of Object.values(view.fieldOptions || {})) {
        for (const condition of options.conditions || []) {
          if (condition.rows) condition.rows = condition.rows.map((k) => rank[fields.find((f) => f.key === condition.field).targetTable][k]);
        }
      }
    }
  }
  delete schema.key;
  delete schema.base;
  return schema;
}

test('describe: the conditions of the fields of a form, by name and key, its components and the options it offers', () => {
  const { baserow } = source();
  const described = describeForm(baserow);
  const tables = described.bases[0].schema.tables;
  const alice = tables.find((t) => t.name === 'Contacts').sampleRows.rows.find((r) => r['Nom complet'] === 'Alice Martin')._key;
  const form = tables.find((t) => t.name === 'Sociétés').views.find((v) => v.name === 'Formulaire');
  assert.deepEqual(form.fieldOptions['Site web'], {
    enabled: true, required: false, order: 2, showWhenMatchingConditions: true, conditionType: 'OR',
    conditionGroups: [{ key: 'g1', filterType: 'AND', parent: null }, { key: 'g2', filterType: 'OR', parent: 'g1' }],
    conditions: [
      { field: 'Secteur', type: 'single_select_equal', options: ['Commerce'] },
      { field: 'Nom', type: 'contains', value: 'Ac', group: 'g1' },
      { field: 'Contact principal', type: 'link_row_has', rows: [alice], group: 'g2' },
    ],
  });
  assert.deepEqual(form.fieldOptions.Secteur, { enabled: true, required: true, order: 1, fieldComponent: 'radio', includeAllSelectOptions: false, allowedSelectOptions: ['Technologie'] });
  assert.deepEqual(form.fieldOptions.Nom, { enabled: true, required: true, order: 0 }, 'nothing for the defaults of Baserow');
  assert.deepEqual(described.omittedViews, []);
});

test('round trip with the conditions of a form: the same schema; one write per level of groups, on new ids', () => {
  const { baserow } = source();
  const first = describeForm(baserow);
  const made = runSteps(first.bases[0].schema, baserow.api, { baseName: 'Copie' });
  assert.equal(made.status, 'done', JSON.stringify(made.error));
  const formId = made.map.views['Sociétés.Formulaire'];
  const writes = baserow.calls.filter((c) => c.name === 'updateFieldOptions' && c.args[0] === formId).map((c) => c.args[1].field_options);
  assert.equal(writes.length, 3, 'the field options, then the conditions of each of the 2 levels of groups');
  const website = String(made.map.fields['Sociétés.Site web']);
  assert.ok(writes[1][website].condition_groups.every((g) => g.id < 0 && g.parent_group === null));
  const second = writes[2][website];
  assert.equal(second.condition_groups.filter((g) => g.id > 0).length, 1, 'the first level by the id Baserow gave it');
  assert.ok(second.condition_groups.some((g) => g.id < 0 && g.parent_group > 0), 'the second level under it');
  assert.equal(second.conditions.filter((c) => c.id > 0).length, 2, 'the conditions of the first write kept');
  const options = baserow.db.fieldOptions[formId][website];
  assert.equal(options.conditions.length, 3);
  assert.equal(options.condition_groups.length, 2);
  assert.deepEqual(canonical(describeForm(baserow, 'Copie')), canonical(first));
});

test('a write of the conditions that fails is made again whole: each condition once', () => {
  const { baserow } = source();
  const first = describeForm(baserow);
  // the write of the second level fails once (after the field options and the first level)
  baserow.fail('updateFieldOptions', Object.assign(new Error('timeout'), { code: 'baserow_unreachable', retryable: true }), { after: 2 });
  const made = runSteps(first.bases[0].schema, baserow.api, { baseName: 'Copie' });
  assert.equal(made.status, 'done', JSON.stringify(made.error));
  const options = baserow.db.fieldOptions[made.map.views['Sociétés.Formulaire']][String(made.map.fields['Sociétés.Site web'])];
  assert.equal(options.conditions.length, 3);
  assert.equal(options.condition_groups.length, 2);
  assert.deepEqual(canonical(describeForm(baserow, 'Copie')), canonical(first));
});

test('describe leaves out and lists a condition it cannot carry, and an option offered it does not know', () => {
  const { baserow, made } = source();
  const formId = made.map.views['companies.form'];
  const website = String(made.map.fields['companies.website']);
  const industry = String(made.map.fields['companies.industry']);
  const set = baserow.db.fieldOptions[formId];
  set[website].conditions.push({ id: 990001, field: made.map.fields['companies.created'], type: 'user_is', value: '7', group: null });
  set[website].conditions.push({ id: 990002, field: Number(industry), type: 'single_select_equal', value: '424242', group: null });
  set[industry].allowed_select_options.push(424242);
  const described = describeForm(baserow);
  // (the fields in the order of their ids: Secteur before Site web)
  assert.deepEqual(described.omittedViews.map((o) => [o.view, o.what, o.reason, o.field]), [
    ['Formulaire', 'allowedSelectOption', 'filter_value', 'Secteur'],
    ['Formulaire', 'fieldCondition', 'filter_user', 'Créé le'],
    ['Formulaire', 'fieldCondition', 'filter_value', 'Secteur'],
  ]);
  const form = described.bases[0].schema.tables[0].views.find((v) => v.name === 'Formulaire');
  assert.equal(form.fieldOptions['Site web'].conditions.length, 3);
  assert.deepEqual(form.fieldOptions.Secteur.allowedSelectOptions, ['Technologie']);
  // without the rows, a condition on rows is left out
  const noRows = BaserowSchema.describe(baserow.api, { tables: [{ path: path('Sociétés') }], views: true });
  assert.ok(noRows.omittedViews.some((o) => o.what === 'fieldCondition' && o.reason === 'filter_row' && o.field === 'Contact principal'));
});

test('the conditions of a schema are checked', () => {
  const refuse = (options, pattern) => {
    const schema = fixture();
    schema.tables[0].views = [{ name: 'F', type: 'form', fieldOptions: options }];
    assert.throws(() => BaserowSchema.normalizeSchema(schema), pattern, JSON.stringify(options));
  };
  refuse({ website: { conditionType: 'XOR' } }, /conditionType is AND or OR/);
  refuse({ website: { showWhenMatchingConditions: 'yes' } }, /must be a boolean/);
  refuse({ website: { fieldComponent: '<script>' } }, /fieldComponent is a name/);
  refuse({ website: { allowedSelectOptions: ['x'] } }, /is not a select field/);
  refuse({ industry: { allowedSelectOptions: ['nope'] } }, /no option nope in industry/);
  refuse({ website: { conditions: [{ field: 'created', type: 'user_is', value: '1' }] } }, /on a user/);
  refuse({ website: { conditions: [{ field: 'name', type: 'equal', value: 'x', group: 'g9' }] } }, /no filter group g9/);
  refuse({ website: { conditions: [{ field: 'nope', type: 'equal', value: 'x' }] } }, /no field nope/);
  refuse({ website: { conditions: Array.from({ length: 101 }, () => ({ field: 'name', type: 'equal', value: 'x' })) } }, /100 conditions at most/);
  refuse({ website: { conditionGroups: [{ key: 'b', parent: 'a' }] } }, /not a group declared before/);
  // a grid takes none of the options of a form
  const grid = fixture();
  grid.tables[0].views = [{ name: 'G', type: 'grid', fieldOptions: { website: { hidden: true, conditions: [{ field: 'name', type: 'equal', value: 'x' }] } } }];
  assert.deepEqual(BaserowSchema.normalizeSchema(grid).tables[0].views[0].fieldOptions, [{ field: 'website', options: { hidden: true } }]);
  // a form whose condition names rows is made after the rows
  const units = BaserowSchema.units(BaserowSchema.normalizeSchema((() => { const s = fixture(); s.tables[0].views = [formView()]; return s; })()), {});
  assert.ok(units.findIndex((u) => u.phase === 'views' && u.view === 'form') > units.findIndex((u) => u.phase === 'rows'));
});

test('in a base of the user, a form of the user that the import names gets none of its conditions', () => {
  const { baserow, made } = source();
  const formId = made.map.views['companies.form'];
  const before = JSON.parse(JSON.stringify(baserow.db.fieldOptions[formId]));
  const described = describeForm(baserow);
  const run = runSteps(described.bases[0].schema, baserow.api, { workspaceId: undefined, baseId: made.state.baseId, sampleData: false });
  assert.equal(run.status, 'done', JSON.stringify(run.error));
  assert.ok(!baserow.calls.some((c) => c.name === 'updateFieldOptions' && c.args[0] === formId));
  assert.deepEqual(baserow.db.fieldOptions[formId], before);
});
