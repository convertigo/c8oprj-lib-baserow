// forms_config view_id: a source reads the rows of its table through one of its views (Baserow applies the filters of the
// view on top of the filters of the request, and its sorts when the request does not sort). The view only comes from the
// source configuration, as a positive integer, and only narrows: an invalid one fails the read, never reads the table.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readSequence, readProjectFile, stepProperty } = require('./read-yaml-steps.cjs');

const root = path.join(__dirname, '../..');
const views = {};
vm.createContext(views);
vm.runInContext(readProjectFile('js/table_views.js'), views);

// The ParseConfig step of a read sequence, run as the engine runs it: the variables of the request in the scope first
// (a parameter of the HTTP request, declared or not, is a variable of the scope), then the step.
function parseConfig(name, config, scope = {}) {
  const code = stepProperty(readSequence(name), 'ParseConfig', 'expression').replace(/\$\{[a-z_.]+=([^}]*)\}/g, '$1');
  const sandbox = {
    forms_config: JSON.stringify(config), forms_tableFilter: '', forms_tableSort: '', forms_tableDistinct: '',
    forms_tableGroupBy: '', forms_tableAggregations: '', forms_Filter: '', forms_filter: '', model: '',
    grid_page: '', grid_page_size: '', lean_cells: '', include_fields: null, search: null, order_by: null,
    max_search_results: '1000', published_scope_filter: '',
    context: { getAuthenticatedUser: () => 'author', project: { get: () => null } },
    java: { lang: { System: { currentTimeMillis: () => Date.now() } } },
    log: { info() {}, debug() {}, warn() {} },
    ...scope,
  };
  sandbox.include = (file) => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox);
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

const config = { table_id: 7, columns: ['Name', 'Montant', 'Ville'], source_owner: 'author', form_id: '42', source_id: 's1' };

test('a view id is a positive integer of the source configuration, or none', () => {
  for (const [value, expected] of [[12, '12'], ['12', '12'], [9007199254740991, '9007199254740991'], [undefined, null], [null, null], ['', null]]) {
    assert.equal(views.sourceViewId({ ...config, view_id: value }), expected, `${value}`);
  }
  assert.equal(views.sourceViewId(config), null);
  for (const value of [0, -3, 1.5, '0', '-3', '12a', '12 ', ' 12', '1e3', '12,13', 'abc', true, false, [12], { id: 12 }, NaN, Infinity, 1e300]) {
    assert.throws(() => views.sourceViewId({ ...config, view_id: value }), /Invalid view_id/, JSON.stringify(value) ?? `${value}`);
  }
});

test('the picker lists the collaborative views that filter rows, as id, name and type only', () => {
  const answer = [
    { id: 1, name: 'Grid', type: 'grid', ownership_type: 'collaborative', slug: 'public-slug', filters_disabled: false },
    { id: '2', name: 'Kanban', type: 'kanban' },
    { id: 3, name: 'Mine', type: 'grid', ownership_type: 'personal', owned_by_id: 5 },
    { id: 4, name: 'Form', type: 'form', ownership_type: 'collaborative' },
    { id: 0, name: 'Zero', type: 'grid' },
    { id: 'x', name: 'Bad', type: 'grid' },
    { name: 'No id', type: 'grid' },
    { id: 6, name: 'No type' },
    null,
    'text',
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(views.sourceReadableViews(answer))), [
    { id: 1, name: 'Grid', type: 'grid' },
    { id: 2, name: 'Kanban', type: 'kanban' },
  ]);
  // an XML round trip answers an array of one view as the view itself
  assert.deepEqual(JSON.parse(JSON.stringify(views.sourceReadableViews({ id: 9, name: 'Only', type: 'gallery' }))),
    [{ id: 9, name: 'Only', type: 'gallery' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(views.sourceReadableViews(null))), []);
});

for (const name of ['formssource_GetTableData', 'formssource_GetSelectData']) {
  test(`${name} reads the view of its configuration only`, () => {
    const selectConfig = name === 'formssource_GetSelectData' ? { displayValue: 'Name', value: 'Ville' } : {};
    assert.equal(parseConfig(name, { ...config, ...selectConfig, view_id: 12 }).view_id, '12');
    assert.equal(parseConfig(name, { ...config, ...selectConfig, view_id: '12' }).view_id, '12');
    assert.equal(parseConfig(name, { ...config, ...selectConfig }).view_id, null);
    // a view_id parameter of the request is a variable of the scope: ParseConfig replaces it with the one of the configuration
    assert.equal(parseConfig(name, { ...config, ...selectConfig }, { view_id: '99' }).view_id, null);
    assert.equal(parseConfig(name, { ...config, ...selectConfig, view_id: 12 }, { view_id: '99' }).view_id, '12');
    // an invalid view fails the read, it never reads the rows of the whole table
    for (const value of [0, 'abc', '12 OR 1=1', { id: 12 }]) {
      assert.throws(() => parseConfig(name, { ...config, ...selectConfig, view_id: value }), /Invalid view_id/, JSON.stringify(value));
    }
  });

  test(`${name} gives the view to every read of the rows from the variable of ParseConfig`, () => {
    const yaml = readSequence(name);
    const blocks = [...yaml.matchAll(/^( *)↓view_id \[variables\.StepVariable-\d+\]: \n((?:\1  .*\n)*)/gm)];
    assert.ok(blocks.length >= 2, 'the first page and the next pages');
    for (const block of blocks) {
      assert.doesNotMatch(block[2], /sourceDefinition|value:/, 'no source nor value: the view_id of ParseConfig');
    }
    assert.doesNotMatch(yaml, /jConfig\.view_id \?/);
  });
}

test('a source with a view never asks the aggregate plugin, which does not read views', () => {
  const grouped = { forms_tableGroupBy: 'Ville', forms_tableAggregations: 'count,sum:Montant' };
  const withoutView = parseConfig('formssource_GetTableData', config, grouped);
  assert.ok(withoutView.pluginAggregate, 'the plugin groups the rows of the table');
  assert.notEqual(withoutView.aggregate_group_by, '');
  const withView = parseConfig('formssource_GetTableData', { ...config, view_id: 12 }, grouped);
  assert.equal(withView.pluginAggregate, null, 'the rows read through the view are grouped');
  assert.equal(withView.aggregate_group_by, '');
  assert.equal(withView.pluginRequiredError, null);
  // an aggregation only the plugin computes: an error, never the values of the whole table
  const pluginOnly = parseConfig('formssource_GetTableData', { ...config, view_id: 12 },
    { forms_tableGroupBy: 'Ville', forms_tableAggregations: 'median:Montant' });
  assert.equal(pluginOnly.pluginAggregate, null);
  assert.match(pluginOnly.pluginRequiredError, /median:Montant .*the plugin does not read the view of the source/);
  const pluginOnlyWithoutView = parseConfig('formssource_GetTableData', config,
    { forms_tableGroupBy: 'Ville', forms_tableAggregations: 'median:Montant' });
  assert.equal(pluginOnlyWithoutView.pluginRequiredError, null);
});

test('formscommon_ViewsList lists the views with the Baserow account of the authenticated editor only', () => {
  const yaml = readSequence('formscommon_ViewsList');
  assert.match(yaml, /^accessibility: Hidden$/m);
  assert.match(readProjectFile('c8oProject.yaml'),
    /\n  ↓formscommon_ViewsList \[sequences\.GenericSequence\]: 🗏 sequences\/formscommon_ViewsList\.yaml\n/);
  const run = (forms, user) => {
    const sandbox = { forms_config: JSON.stringify(forms), context: { getAuthenticatedUser: () => user } };
    vm.createContext(sandbox);
    vm.runInContext(stepProperty(yaml, 'ParseConfig', 'expression'), sandbox);
    return sandbox;
  };
  assert.equal(run({ table_id: 'W~>B~>T', editor: 'author' }, 'author').editor_ok, true);
  assert.equal(run({ table_id: 'W~>B~>T', editor: 'someone' }, 'author').editor_ok, false, 'another editor');
  assert.equal(run({ table_id: 'W~>B~>T' }, 'author').editor_ok, false, 'no editor');
  assert.equal(run({ table_id: 'W~>B~>T', editor: 'author' }, null).editor_ok, false, 'not authenticated');
  assert.equal(run({ editor: 'author' }, 'author').editor_ok, false, 'no table');
  // the Bearer is the one of the account of the editor (BaserowAccountGet), set before the call, its value masked
  const order = ['RejectBadEditor', 'UseAuthenticatedEditorsBaserowAccount', 'RejectUnavailableEditorAccount', 'EditorViews', 'KeepRowViews']
    .map((step) => yaml.indexOf(`\n↓${step} [`));
  assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), 'checks before the call, the answer kept after');
  assert.match(stepProperty(yaml, 'UseAuthenticatedEditorsBaserowAccount', 'expression'),
    /callSequence\("C8Oforms", "BaserowAccountGet", \{\}\)[\s\S]*__header_Authorization = String\(token\.document\.Bearer\)/);
  const call = yaml.slice(yaml.indexOf('\n↓EditorViews ['), yaml.indexOf('\n↓Log_EditorViews ['));
  assert.match(call, /sourceTransaction: lib_BaseRow\.Baserow_API_spec\._api_database_views_table__table_id___GET/);
  assert.match(call, /↓__header_Authorization \[variables\.StepVariable-\d+\]: \n {4}comment: .*\n {4}visibility: '-1'\n/);
  assert.doesNotMatch(call, /sourceDefinition|value:/, 'no source: the variables of ParseConfig and of the account step');
  // only id, name and type of the collaborative views that filter rows reach the editor
  const keep = { viewsArray: [{ id: 1, name: 'Grid', type: 'grid', slug: 's' }, { id: 2, name: 'F', type: 'form' }] };
  keep.include = (file) => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), keep);
  vm.createContext(keep);
  vm.runInContext(stepProperty(yaml, 'KeepRowViews', 'expression'), keep);
  assert.deepEqual(JSON.parse(JSON.stringify(keep.views)), [{ id: 1, name: 'Grid', type: 'grid' }]);
  assert.match(yaml, /↓views_json \[steps\.ElementStep-\d+\]: \n {2}comment: .*\n {2}expression: JSON\.stringify\(views\)\n/);
});
