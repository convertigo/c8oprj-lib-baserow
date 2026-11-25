// js/baserow_schema.js on an account without the paid features of Baserow (lib_BaseRow 1.2.0-beta29, as seen on a real
// round trip of C8Oforms #1836): Baserow answers 402 ERROR_FEATURE_NOT_AVAILABLE for the colors of the rows,
// and may for a view type, a survey or the options and conditions of a form. Apply never fails for it: it leaves out
// what Baserow refused, lists it (omittedViews, reason feature_not_available) and goes on. Also the images of a form
// keep their name of upload, and the labels of a form are written only when set.
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
    answer = BaserowSchema.step(JSON.stringify(schema), state && JSON.stringify(state), api, { workspaceId: WORKSPACE, maxCalls: 5, ...options });
    state = answer.state;
    if (answer.status !== 'running') break;
  }
  return answer;
}

// the Mini CRM with colors of rows, a survey and a form with conditions
function schema() {
  const s = fixture();
  const companies = s.tables.find((t) => t.key === 'companies');
  companies.views.push(
    { key: 'colors', name: 'Couleurs', type: 'grid', sorts: [{ field: 'name', order: 'asc' }],
      decorations: [{ type: 'left_border_color', provider: 'single_select_color', field: 'industry' },
        { type: 'background_color', provider: 'conditional_color', colors: [{ color: 'light-red', filters: [{ field: 'name', type: 'contains', value: 'A' }] }] }] },
    { key: 'survey', name: 'Sondage', type: 'form', mode: 'survey', title: 'Vos avis' },
    { key: 'form', name: 'Formulaire', type: 'form', fieldOptions: {
      website: { enabled: true, showWhenMatchingConditions: true, conditions: [{ field: 'industry', type: 'single_select_equal', options: ['tech'] }] },
      name: { enabled: true, name: 'Votre société' },
    } },
  );
  return s;
}

test('the colors of the rows refused (402): left out and listed, the base made with its other views', () => {
  const baserow = fakeBaserow({ paid: ['decorations'], defaultView: true });
  const made = runSteps(schema(), baserow.api, { exactViews: true });
  assert.equal(made.status, 'done', JSON.stringify(made.error));
  assert.equal(baserow.db.applications.length, 1, 'the base stays');
  assert.equal(baserow.db.decorations.length, 0);
  assert.deepEqual(made.omittedViews, [
    { table: 'Sociétés', view: 'Couleurs', what: 'decoration', reason: 'feature_not_available', baserowError: 'ERROR_FEATURE_NOT_AVAILABLE' },
    { table: 'Sociétés', view: 'Couleurs', what: 'decoration', reason: 'feature_not_available', baserowError: 'ERROR_FEATURE_NOT_AVAILABLE' },
  ]);
  // the view itself, its sort, and the other views are made
  const colors = made.map.views['companies.colors'];
  assert.ok(Number.isInteger(colors));
  assert.equal(baserow.db.sorts.filter((s) => s.view === colors).length, 1);
  for (const key of ['companies.by_industry', 'companies.survey', 'companies.form', 'deals.pipeline', 'deals.agenda']) {
    assert.ok(Number.isInteger(made.map.views[key]), key);
  }
  assert.ok(made.state.warnings.some((w) => w.code === 'feature_not_available'));
  // a step run again tries nothing again
  baserow.calls.length = 0;
  const again = BaserowSchema.step(JSON.stringify(schema()), JSON.stringify({ ...made.state, cursor: 0, done: false }), baserow.api, { workspaceId: WORKSPACE });
  assert.ok(!baserow.calls.some((c) => c.name === 'createViewDecoration'), JSON.stringify(again.error));
});

test('a view type refused (402): the view left out and listed, no id to remap; a survey made a plain form', () => {
  const baserow = fakeBaserow({ paid: ['kanban', 'survey'], defaultView: true });
  const s = schema();
  // a table whose only view is refused keeps the view Baserow made with it
  s.tables.find((t) => t.key === 'contacts').views = [{ key: 'board', name: 'Tableau', type: 'kanban', singleSelectField: 'company_industry' }];
  s.tables.find((t) => t.key === 'contacts').fields.push({ key: 'kind', name: 'Genre', type: 'single_select', values: ['A', 'B'] });
  s.tables.find((t) => t.key === 'contacts').views[0].singleSelectField = 'kind';
  const made = runSteps(s, baserow.api, { exactViews: true });
  assert.equal(made.status, 'done', JSON.stringify(made.error));
  assert.deepEqual(made.omittedViews.map((o) => [o.table, o.view, o.what]), [
    ['Sociétés', 'Sondage', 'mode'], ['Contacts', 'Tableau', 'view'], ['Opportunités', 'Pipeline', 'view'],
  ]);
  assert.equal(made.map.views['deals.pipeline'], undefined);
  const survey = baserow.db.views.find((v) => v.id === made.map.views['companies.survey']);
  assert.deepEqual([survey.type, survey.mode, survey.title], ['form', undefined, 'Vos avis']);
  assert.deepEqual(baserow.db.views.filter((v) => v.table_id === made.state.tables.contacts).map((v) => v.name), ['Grid'], 'a table keeps a view');
});

test('the options or conditions of a form refused (402): left out and listed, the form made', () => {
  const conditions = fakeBaserow({ paid: ['formConditions'] });
  const made = runSteps(schema(), conditions.api, {});
  assert.equal(made.status, 'done', JSON.stringify(made.error));
  assert.deepEqual(made.omittedViews.map((o) => [o.view, o.what]), [['Formulaire', 'fieldOptions']]);
  const form = made.map.views['companies.form'];
  assert.equal(conditions.db.fieldOptions[form][String(made.map.fields['companies.name'])].name, 'Votre société', 'the options without conditions are written');
  const options = fakeBaserow({ paid: ['fieldOptions'] });
  const none = runSteps(schema(), options.api, {});
  assert.equal(none.status, 'done', JSON.stringify(none.error));
  assert.deepEqual(none.omittedViews.map((o) => [o.view, o.what]), [['Formulaire', 'fieldOptions']]);
  // the apply of the tool: the same list in its answer
  const tool = fakeBaserow({ paid: ['decorations'] });
  const applied = BaserowSchema.apply(JSON.stringify(schema()), null, tool.api, { workspaceId: WORKSPACE });
  assert.equal(applied.status, 'done');
  assert.equal(applied.omittedViews.length, 2);
  // an account with every feature: nothing left out
  const full = runSteps(schema(), fakeBaserow().api, {});
  assert.deepEqual(full.omittedViews, []);
});

test('another refusal of Baserow still stops the run (only a paid feature is left out)', () => {
  const baserow = fakeBaserow();
  baserow.fail('createViewDecoration', baserow.baserowError('ERROR_REQUEST_BODY_VALIDATION', 'decoration'));
  const made = runSteps(schema(), baserow.api, {});
  assert.equal(made.status, 'error');
  assert.equal(made.error.code, 'baserow_error');
  assert.match(made.error.message, /ERROR_REQUEST_BODY_VALIDATION/);
  assert.equal(made.error.baserowError, 'ERROR_REQUEST_BODY_VALIDATION', 'the code of the refusal, apart from the message');
});

test('the labels of a form: written only when set, never an empty one', () => {
  const s = schema();
  s.tables[0].views.find((v) => v.key === 'form').fieldOptions.website.name = '';
  s.tables[0].views.find((v) => v.key === 'form').fieldOptions.website.description = '';
  const normalized = BaserowSchema.normalizeSchema(JSON.parse(JSON.stringify(s)));
  const website = normalized.tables[0].views.find((v) => v.key === 'form').fieldOptions.find((o) => o.field === 'website');
  assert.deepEqual(website.options, { enabled: true });
  const baserow = fakeBaserow();
  const made = runSteps(s, baserow.api, {});
  const described = BaserowSchema.describe(baserow.api, { tables: [{ path: 'Convertigo NoCode Databases - user@example.com~>Mini CRM~>Sociétés' }], views: true });
  const form = described.bases[0].schema.tables.find((t) => t.name === 'Sociétés').views.find((v) => v.name === 'Formulaire');
  assert.equal(form.fieldOptions.Nom.name, 'Votre société');
  for (const [field, options] of Object.entries(form.fieldOptions)) {
    assert.ok(options.name !== '' && options.description !== '', field);
  }
  assert.doesNotMatch(JSON.stringify(described.bases[0].schema), /"name":""|"description":""/);
  assert.equal(made.status, 'done');
});

test('an action of an answer keeps its type: the type of a field or of a decoration is a detail of its own', () => {
  // a decoration that fails: the last action of the step says what was written
  const baserow = fakeBaserow();
  baserow.fail('createViewDecoration', baserow.baserowError('ERROR_REQUEST_BODY_VALIDATION', 'decoration'));
  let state = null;
  let answer;
  for (let i = 0; i < 300; i++) {
    answer = BaserowSchema.step(JSON.stringify(schema()), state && JSON.stringify(state), baserow.api, { workspaceId: WORKSPACE });
    state = answer.state;
    if (answer.status !== 'running') break;
  }
  assert.equal(answer.status, 'error');
  const last = answer.actions[answer.actions.length - 1];
  assert.deepEqual([last.type, last.decorationType, last.provider, last.view], ['create_view_decoration', 'left_border_color', 'single_select_color', 'colors']);
  // a field found in a base that existed: field_exists, its type apart
  const made = runSteps(fixture(), baserow.api, {});
  const again = BaserowSchema.apply(JSON.stringify(fixture()), null, baserow.api, { baseId: made.state.baseId, sampleData: false });
  const exists = again.actions.filter((a) => a.field === 'industry');
  assert.deepEqual(exists.map((a) => [a.type, a.fieldType]), [['field_exists', 'single_select']]);
  assert.ok(again.actions.every((a) => /^[a-z_]+$/.test(a.type) && !['text', 'single_select', 'left_border_color'].includes(a.type)));
});
