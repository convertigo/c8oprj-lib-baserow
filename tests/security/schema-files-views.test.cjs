// formscommon_SchemaApply with files, views and the rollback of a base completed (C8Oforms #1836, lib_BaseRow
// 1.2.0-beta25), through the engine with its internal calls answered by the in-memory Baserow:
// - every Baserow call with the account of the user, the logs off; no token, no name nor URL of a file of Baserow in
//   an answer;
// - the token of the account goes to the Baserow server of the connector only, never to another host, never after a
//   redirection; a file is written in a folder of the transfer folder, deleted on any failure;
// - a view is never public; a file cell of a schema names a file of the schema, never a file of Baserow;
// - the rollback of a base that existed deletes only what the run made, in that base, never the base nor the trash.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const BaserowSchema = require('../../js/baserow_schema.js');
const { fakeBaserow } = require('../schema/fake-baserow.cjs');

const root = path.join(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'js/baserow_schema.js'), 'utf8');
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const fixture = () => JSON.parse(JSON.stringify(require('../schema/fixtures/mini-crm.baserow.json')));
const JWT = 'JWT eyJ.user-token.sig';
const TRANSFER = '/tmp/c8o-file-transfer/';
const WORKSPACE_NAME = 'Convertigo NoCode Databases - user@example.com';

// the engine with its internal calls answered by the in-memory Baserow, the files on a disk of the test
function harness(extra = {}) {
  const disk = new Map();
  const baserow = fakeBaserow({ writeFile: (p, b) => disk.set(p, b), readFile: (p) => disk.get(p), ...extra });
  const requests = [];
  const downloads = [];
  const mdc = new Map();
  global.org = { apache: { log4j: { MDC: {
    put: (key, value) => mdc.set(key, value), get: (key) => (mdc.has(key) ? mdc.get(key) : null), remove: (key) => mdc.delete(key),
  } } } };
  const id = (value) => Number(value);
  const body = (v) => JSON.parse(v.__body);
  const api = baserow.api;
  const transactions = {
    _api_workspaces__GET: () => api.listWorkspaces(),
    _api_applications__GET: () => api.listApplications(),
    _api_applications__application_id___GET: (v) => api.getApplication(id(v.application_id)),
    _api_applications_workspace__workspace_id___POST: (v) => api.createDatabase(id(v.workspace_id), body(v).name),
    _api_applications__application_id___DELETE: (v) => api.deleteApplication(id(v.application_id)) || {},
    _api_trash_workspace__workspace_id___DELETE: (v) => api.emptyTrash(id(v.workspace_id), id(v.application_id)) || {},
    _api_database_tables_database__database_id___GET: (v) => api.listTables(id(v.database_id)),
    _api_database_tables_database__database_id___POST: (v) => api.createTable(id(v.database_id), body(v)),
    _api_database_tables__table_id___DELETE: (v) => api.deleteTable(id(v.table_id)) || {},
    _api_database_fields_table__table_id___GET: (v) => api.listFields(id(v.table_id)),
    _api_database_fields_table__table_id___POST: (v) => api.createField(id(v.table_id), body(v)),
    _api_database_fields__field_id___PATCH: (v) => api.updateField(id(v.field_id), body(v)),
    _api_database_fields__field_id___DELETE: (v) => api.deleteField(id(v.field_id)) || {},
    _api_database_views_table__table_id___GET: (v) => {
      assert.equal(v.include_attributes, 'filters,sortings,group_bys,decorations');
      return api.listViews(id(v.table_id));
    },
    _api_database_views_table__table_id___POST: (v) => api.createView(id(v.table_id), body(v)),
    _api_database_views__view_id___DELETE: (v) => api.deleteView(id(v.view_id)) || {},
    _api_database_views__view_id__decorations__GET: (v) => api.listViewDecorations(id(v.view_id)),
    _api_database_views__view_id__decorations__POST: (v) => api.createViewDecoration(id(v.view_id), body(v)),
    _api_database_views__view_id__field_options__GET: (v) => api.listFieldOptions(id(v.view_id)),
    _api_database_views__view_id__field_options__PATCH: (v) => api.updateFieldOptions(id(v.view_id), body(v)),
    _api_database_views__view_id__filter_groups__POST: (v) => api.createFilterGroup(id(v.view_id), { filter_type: v.filter_type, parent_group: v.parent_group == null ? null : id(v.parent_group) }),
    _api_database_views_filter_group__filter_group_id___GET: (v) => api.getFilterGroup(id(v.filter_group_id)),
    _api_database_views__view_id__filters__POST: (v) => api.createViewFilter(id(v.view_id), body(v)),
    _api_database_views_filter__view_filter_id___DELETE: (v) => api.deleteViewFilter(id(v.view_filter_id)) || {},
    _api_database_views__view_id__sortings__POST: (v) => api.createViewSort(id(v.view_id), body(v)),
    _api_database_views_sort__view_sort_id___DELETE: (v) => api.deleteViewSort(id(v.view_sort_id)) || {},
    _api_database_views__view_id__group_bys__GET: (v) => api.listViewGroupBys(id(v.view_id)),
    _api_database_views__view_id__group_bys__POST: (v) => api.createViewGroupBy(id(v.view_id), { field: id(v.field), order: v.order }),
    _api_database_views_group_by__view_group_by_id___DELETE: (v) => api.deleteViewGroupBy(id(v.view_group_by_id)) || {},
    _api_database_rows_table__table_id___GET: (v) => api.listRows(id(v.table_id), id(v.page), id(v.size)),
    _api_database_rows_table__table_id__batch__POST: (v) => ({ items: api.createRows(id(v.table_id), body(v).items) }),
    _api_database_rows_table__table_id__batch__PATCH: (v) => ({ items: api.updateRows(id(v.table_id), body(v).items) }),
    _api_database_rows_table__table_id__batch_delete__POST: (v) => api.deleteRows(id(v.table_id), body(v).items) || {},
    _api_user_files_upload_file__POST: (v) => api.uploadFile(v.file),
  };
  BaserowSchema.engine.useRequester((project, target, variables) => {
    requests.push({ project, target, variables, nolog: mdc.get('nolog') === true });
    if (target.__sequence === 'BaserowAccountGet') return { document: { email: 'user@example.com', password: 'secret' } };
    if (target.__sequence === 'TokenGetOrRefresh') return { document: { Bearer: JWT } };
    assert.equal(variables.__header_Authorization, JWT, `${target.__transaction} with the user's token`);
    const handler = transactions[target.__transaction];
    assert.ok(handler, target.__transaction);
    try {
      const value = handler(variables);
      return { document: Array.isArray(value) ? { array: value } : { object: value } };
    } catch (e) {
      return { document: { object: { error: e.baserowError || 'ERROR', detail: e.message } } };
    }
  });
  let folders = 0;
  const removed = [];
  BaserowSchema.engine.useFiles({
    download: (bearer, url, target, maxBytes) => {
      downloads.push({ bearer, url, target, maxBytes });
      return api.downloadFile(url, target, maxBytes);
    },
    transfer: {
      open: () => `${TRANSFER}describe-t${++folders}`,
      target: (dir, n, name) => `${dir}/${n}/${name}`,
      remove: (dir) => removed.push(dir),
    },
    fileOf: (p) => (p.startsWith(TRANSFER) && !p.includes('..') && disk.has(p) ? { path: p, size: disk.get(p).length, name: p.split('/').pop() } : null),
  });
  return { baserow, requests, downloads, removed, disk, mdc };
}

test.afterEach(() => {
  BaserowSchema.engine.useRequester(null);
  BaserowSchema.engine.useFiles(null);
  delete global.org;
});

// a Mini CRM with a file in a row and a view of every feature, made through the engine
function base(h) {
  const schema = fixture();
  const companies = schema.tables[0];
  companies.fields.push({ key: 'logo', name: 'Logo', type: 'file' });
  companies.views.push({ key: 'g', name: 'Galerie', type: 'gallery', cardCoverImageField: 'logo', fieldOptions: { website: { hidden: true } } },
    { key: 'r', name: 'Groupes', type: 'grid', filterGroups: [{ key: 'g1', filterType: 'OR' }], filters: [{ field: 'name', type: 'contains', value: 'a', group: 'g1' }],
      groupBys: [{ field: 'industry', order: 'asc' }], fieldOptions: { website: { hidden: true, width: 80 } } });
  let state = null;
  let result;
  for (let i = 0; i < 50; i++) {
    result = BaserowSchema.engine.run({ mode: 'step', schema: JSON.stringify(schema), state: state && JSON.stringify(state), options: JSON.stringify({ workspaceId: 836 }) });
    state = result.state;
    if (result.status !== 'running') break;
  }
  assert.equal(result.status, 'done', JSON.stringify(result.error));
  const logo = h.baserow.addFile('logo.png', Buffer.from('PNG-bytes'), 'image/png');
  h.baserow.api.updateRows(result.state.tables.companies, [{ id: result.state.rowIds.companies.Acme, [`field_${result.map.fields['companies.logo']}`]: [logo] }]);
  return { result, logo };
}

test('describe with views and attachments, then apply with the files, through the engine: the account of the user, logs off, no token nor file of Baserow in an answer', () => {
  const h = harness();
  const { logo } = base(h);
  const described = BaserowSchema.engine.run({ mode: 'describe', options: JSON.stringify({ tables: [{ path: `${WORKSPACE_NAME}~>Mini CRM~>Sociétés` }], rows: true, views: true, attachments: true }) });
  assert.equal(described.status, 'ok', JSON.stringify(described.error));
  assert.deepEqual(h.downloads.map((d) => [d.bearer, d.maxBytes]), [[JWT, 10 * 1024 * 1024]], 'downloaded with the token of the account, 10 MB at most');
  assert.equal(described.transferDir, `${TRANSFER}describe-t1`);
  const text = JSON.stringify(described);
  for (const secret of [JWT, 'user-token', 'secret', logo.name, 'media.example.com']) {
    assert.ok(!text.includes(secret), `no ${secret} in the answer`);
  }
  assert.doesNotMatch(JSON.stringify(described.bases.map((b) => b.schema.tables.map((t) => t.views))), /"public"|slug|password/);
  // apply in a new base with the files of describe
  const files = Object.fromEntries(described.attachments.map((a) => [a.key, { path: a.path }]));
  let state = null;
  let result;
  for (let i = 0; i < 50; i++) {
    result = BaserowSchema.engine.run({ mode: 'step', schema: JSON.stringify(described.bases[0].schema), state: state && JSON.stringify(state), options: JSON.stringify({ workspaceId: 836, baseName: 'Copie', files, exactViews: true }) });
    state = result.state;
    if (result.status !== 'running') break;
  }
  assert.equal(result.status, 'done', JSON.stringify(result.error));
  const uploads = h.requests.filter((r) => r.target.__transaction === '_api_user_files_upload_file__POST');
  assert.deepEqual(uploads.map((r) => r.variables.file), [described.attachments[0].path]);
  assert.ok(h.requests.every((r) => r.nolog), 'the logs are off during each call');
  assert.equal(h.mdc.has('nolog'), false);
  const views = h.requests.filter((r) => r.target.__transaction === '_api_database_views_table__table_id___POST').map((r) => JSON.parse(r.variables.__body));
  assert.ok(views.length >= 4 && views.every((v) => v.public === false), 'a view made is never public');
  assert.ok(!JSON.stringify(result).includes(JWT));
});

test('a file cell of a schema names a file of the schema, never a file of Baserow; options.files names files of the transfer folder', () => {
  const h = harness();
  const schema = {
    format: 'c8oforms.baserow-template', formatVersion: 1, key: 'k', version: '1', base: { defaultName: 'B' },
    files: [{ key: 'f1', visible_name: 'a.pdf', size: 3 }],
    tables: [{ key: 'T', name: 'T', primaryField: { key: 'N', name: 'N', type: 'text' }, fields: [{ key: 'F', name: 'F', type: 'file' }],
      sampleRows: { upsertKey: 'N', rows: [{ _key: '1', N: 'x', F: [{ file: 'f1' }] }] } }],
  };
  const run = (s, options) => BaserowSchema.engine.run({ mode: 'apply', schema: JSON.stringify(s), options: JSON.stringify({ workspaceId: 836, ...options }) });
  const someoneElse = JSON.parse(JSON.stringify(schema));
  someoneElse.tables[0].sampleRows.rows[0].F = [{ name: 'VXotniBOVm8tbstZkKsMKbj2Qg7KmPvn_39d354a.png', visible_name: 'a.pdf' }];
  assert.equal(run(someoneElse, {}).error.code, 'schema_invalid', 'the name of a file of another account cannot be written in a row');
  for (const bad of ['/etc/passwd', `${TRANSFER}../etc/passwd`, '', null]) {
    const answer = run(schema, { files: { f1: { path: bad } } });
    assert.equal(answer.error.code, 'file_invalid', String(bad));
  }
  assert.equal(run(schema, { files: { f1: { name: '../x' } } }).error.code, 'file_invalid');
  assert.equal(h.baserow.calls.filter((c) => /^(create|upload)/.test(c.name)).length, 0, 'nothing written');
});

test('the rollback of a base completed: through the engine, only what the run made in that base, never the base nor the trash', () => {
  const h = harness();
  const { result: made } = base(h);
  const schema = fixture();
  schema.tables[0].fields.push({ key: 'extra', name: 'Extra', type: 'text' });
  schema.tables[0].views.push({ key: 'new', name: 'Nouvelle', type: 'grid', sorts: [{ field: 'extra', order: 'asc' }] });
  delete schema.tables[0].sampleRows;
  schema.tables.forEach((t) => { delete t.sampleRows; });
  const completed = BaserowSchema.engine.run({ mode: 'apply', schema: JSON.stringify(schema), options: JSON.stringify({ baseId: made.state.baseId }) });
  assert.equal(completed.status, 'done', JSON.stringify(completed.error));
  assert.equal(completed.state.undo.fields.length, 1);
  assert.equal(completed.state.undo.views.length, 1);
  // a state that names a table of another base deletes nothing of it
  const other = h.baserow.api.createDatabase(836, 'Autre');
  const foreign = h.baserow.api.createTable(other.id, { name: 'Intouchable', data: [['Nom']], first_row_header: true });
  const crafted = JSON.parse(JSON.stringify(completed.state));
  crafted.undo.tables.push({ id: foreign.id, table: 'companies' });
  crafted.undo.fields.push({ id: h.baserow.db.fields.find((f) => f.table_id === foreign.id).id, table: 'companies' });
  crafted.undo.rows.push({ table: 'companies', tableId: foreign.id, ids: [1] });
  const before = h.requests.length;
  const undone = BaserowSchema.engine.run({ mode: 'rollback', state: JSON.stringify(crafted) });
  assert.equal(undone.status, 'undone', JSON.stringify(undone));
  assert.deepEqual([undone.removed.fields, undone.removed.views, undone.removed.tables], [1, 1, 0]);
  assert.ok(h.baserow.db.tables.some((t) => t.id === foreign.id), 'the table of another base stays');
  assert.equal(h.baserow.db.fields.filter((f) => f.table_id === foreign.id).length, 1);
  assert.deepEqual(undone.errors.map((e) => e.code), ['delete_refused']);
  const calls = h.requests.slice(before).map((r) => r.target.__transaction).filter(Boolean);
  assert.ok(!calls.some((t) => /_api_applications__application_id___DELETE|_api_trash_/.test(t)), 'never the base, never the trash');
  assert.ok(h.requests.every((r) => r.nolog));
  assert.ok(!JSON.stringify(undone).includes(JWT));
  // a state of another workspace: refused
  const elsewhere = JSON.parse(JSON.stringify(completed.state));
  elsewhere.workspaceId = 999;
  elsewhere.undo = { tables: [], fields: [{ id: 1, table: 'companies' }], options: [], views: [], filters: [], sorts: [], groupBys: [], rows: [] };
  const refused = BaserowSchema.engine.run({ mode: 'rollback', state: JSON.stringify(elsewhere) });
  assert.equal(refused.status, 'undone');
  assert.deepEqual(refused.errors.map((e) => e.code), ['delete_refused']);
});

test('the engine sends the token of the account to the Baserow server of the connector only, writes the files in the transfer folder only', () => {
  const download = code.slice(code.indexOf('function engineDownload('), code.indexOf('var engineTransfer = {'));
  assert.ok(download.length > 500);
  // the only Authorization header, under the check of the host, never after a redirection
  assert.equal((download.match(/setRequestProperty\(/g) || []).length, 1);
  assert.match(download, /if \(withToken && origin\.length && originOf\(parsed\) === origin\) \{\s*connection\.setRequestProperty\("Authorization", bearer\);/);
  assert.match(download, /connection\.setInstanceFollowRedirects\(false\);/);
  assert.match(download, /current = "" \+ new java\.net\.URL\(parsed, location\);\s*withToken = false;/);
  assert.match(download, /if \(protocol !== "https" && protocol !== "http"\)/);
  // no URL nor token in the errors
  for (const [, message] of download.matchAll(/SchemaError\("[a-z_]+", ([^;]*)\)/g)) {
    assert.doesNotMatch(message, /\burl\b|current|bearer|location|token/, message);
  }
  const host = code.slice(code.indexOf('function baserowOrigin('), code.indexOf('function engineDownload('));
  assert.match(host, /getOriginalProjectByName\("lib_BaseRow"\)/);
  assert.match(host, /getConnectorByName\("Baserow_API_spec"\)/);
  assert.match(host, /connector\.isHttps\(\)/);
  assert.match(host, /connector\.getPort\(\)/);
  // the folder of a describe: under the transfer folder, deleted only when it is one
  const transfer = code.slice(code.indexOf('var engineTransfer = {'), code.indexOf('function engineApi('));
  assert.match(transfer, /new java\.io\.File\(java\.lang\.System\.getProperty\("java\.io\.tmpdir"\), TRANSFER_DIR\)\.getCanonicalFile\(\)/);
  assert.match(transfer, /"describe-" \+ java\.util\.UUID\.randomUUID\(\)/);
  assert.match(transfer, /if \(!root\.equals\(folder\.getParentFile\(\)\) \|\| \(\"\" \+ folder\.getName\(\)\)\.indexOf\("describe-"\) !== 0\) \{\s*return;/);
  // the files of options.files: the transfer folder only (the check of mode upload)
  assert.match(code, /return step\(params\.schema, params\.state, engineApiFor\(params\), options, fileHooks\.fileOf \|\| engineTransferFile\);/);
  assert.match(code, /return apply\(params\.schema, params\.state, engineApiFor\(params\), options, fileHooks\.fileOf \|\| engineTransferFile\);/);
  // the rollback of a base that existed never empties the trash
  const undo = code.slice(code.indexOf('function undoRun('), code.indexOf('function rollback('));
  assert.doesNotMatch(undo, /emptyTrash|deleteApplication/);
});

test('the Baserow options of a field never set what the engine sets: its type, name, links, references', () => {
  const baserow = fakeBaserow();
  const schema = fixture();
  schema.tables[0].fields.push({ key: 'x', name: 'X', type: 'text', baserowOptions: { type: 'password', name: 'Y', text_default: 'ok', link_row_table_id: 1, formula: 'field(1)' } });
  const made = BaserowSchema.apply(JSON.stringify(schema), null, baserow.api, { workspaceId: 836 });
  assert.equal(made.status, 'done', JSON.stringify(made.error));
  const field = baserow.db.fields.find((f) => f.id === made.map.fields['companies.x']);
  assert.deepEqual([field.name, field.type, field.text_default, field.link_row_table_id, field.formula], ['X', 'text', 'ok', undefined, undefined]);
});

test('the conditions of a form through the engine: written with the account of the user, logs off, never naming a user', () => {
  const h = harness();
  const schema = fixture();
  schema.tables[0].views.push({ key: 'f', name: 'Formulaire', type: 'form', fieldOptions: {
    website: { enabled: true, showWhenMatchingConditions: true, conditionGroups: [{ key: 'g' }], conditions: [{ field: 'industry', type: 'single_select_equal', options: ['tech'], group: 'g' }] },
  } });
  const made = BaserowSchema.engine.run({ mode: 'apply', schema: JSON.stringify(schema), options: JSON.stringify({ workspaceId: 836 }) });
  assert.equal(made.status, 'done', JSON.stringify(made.error));
  const writes = h.requests.filter((r) => r.target.__transaction === '_api_database_views__view_id__field_options__PATCH');
  assert.equal(writes.length, 2, 'the field options, then the conditions');
  const conditions = JSON.parse(writes[1].variables.__body).field_options[String(made.map.fields['companies.website'])];
  assert.deepEqual(conditions.conditions.map((c) => [c.type, c.value]), [['single_select_equal', String(made.map.options['companies.industry.tech'])]]);
  assert.ok(h.requests.every((r) => r.nolog));
  assert.ok(!JSON.stringify(made).includes(JWT));
  // a condition naming a user is refused before any write
  const user = fixture();
  user.tables[0].views = [{ name: 'U', type: 'form', fieldOptions: { website: { conditions: [{ field: 'created', type: 'user_is', value: '1' }] } } }];
  const before = h.requests.length;
  const refused = BaserowSchema.engine.run({ mode: 'apply', schema: JSON.stringify(user), options: JSON.stringify({ workspaceId: 836 }) });
  assert.equal(refused.error.code, 'schema_invalid');
  assert.equal(h.requests.slice(before).filter((r) => r.target.__connector).length, 0);
});

test('a paid feature refused by the no-code database (402) through the engine: left out and listed, the base kept, no token in the answer', () => {
  const h = harness({ paid: ['decorations'] });
  const schema = fixture();
  schema.tables[0].views.push({ key: 'c', name: 'Couleurs', type: 'grid', decorations: [{ type: 'background_color', provider: 'single_select_color', field: 'industry' }] });
  const made = BaserowSchema.engine.run({ mode: 'apply', schema: JSON.stringify(schema), options: JSON.stringify({ workspaceId: 836 }) });
  assert.equal(made.status, 'done', JSON.stringify(made.error));
  assert.deepEqual(made.omittedViews, [{ table: 'Sociétés', view: 'Couleurs', what: 'decoration', reason: 'feature_not_available', baserowError: 'ERROR_FEATURE_NOT_AVAILABLE' }]);
  assert.equal(h.baserow.db.applications.length, 1);
  assert.ok(h.requests.some((r) => r.target.__transaction === '_api_database_views__view_id__decorations__POST'));
  assert.ok(h.requests.every((r) => r.nolog));
  assert.ok(!JSON.stringify(made).includes(JWT));
});
