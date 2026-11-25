// The schema engine (js/baserow_schema.js) and its sequences (formscommon_SchemaApply, DatabaseCreate, TableCreate,
// DatabaseDeleteDefinitive, JobWait) call Baserow with the user's own account only: never without account (no fallback
// on the Baserow admin account of TokenGetOrRefresh), the logs off around each call, no token in the answers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const BaserowSchema = require('../../js/baserow_schema.js');
const { fakeBaserow } = require('../schema/fake-baserow.cjs');

const root = path.join(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'js/baserow_schema.js'), 'utf8');
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const connector = fs.readFileSync(path.join(root, '_c8oProject/connectors/Baserow_API_spec.yaml'), 'utf8');
const sequences = ['formscommon_SchemaApply', 'DatabaseCreate', 'TableCreate', 'DatabaseDeleteDefinitive', 'JobWait'];
const readSequence = (name) => fs.readFileSync(path.join(root, '_c8oProject/sequences', `${name}.yaml`), 'utf8');
const fixture = () => JSON.parse(JSON.stringify(require('../schema/fixtures/mini-crm.baserow.json')));

test('the sequences of the schema engine are private, declared in the project and call Baserow through js/baserow_schema.js only', () => {
  const project = fs.readFileSync(path.join(root, 'c8oProject.yaml'), 'utf8');
  for (const name of sequences) {
    const yaml = readSequence(name);
    assert.match(yaml, /^accessibility: Private\n/, name);
    assert.match(yaml, /\nnativeExecution: true\n/, name);
    assert.match(yaml, /include\("js\/baserow_schema\.js"\);/, name);
    assert.doesNotMatch(yaml, /\[steps\.(SequenceStep|TransactionStep)/, `${name}: no direct call, no token in a step`);
    assert.doesNotMatch(yaml, /GroupsList|httpInfo|AdminLogin/, name);
    for (const secret of ['authorization', 'password']) {
      const at = yaml.indexOf(`↓${secret} [variables.RequestableVariable-`);
      assert.ok(at > 0, `${name}.${secret}`);
      const block = yaml.slice(at, yaml.indexOf('\n↓', at + 1) === -1 ? undefined : yaml.indexOf('\n↓', at + 1));
      assert.match(block, /↑traceable: false/, `${name}.${secret} kept out of the logs`);
      assert.match(block, /visibility: '-1'/, `${name}.${secret} masked`);
    }
    assert.ok(project.includes(`  ↓${name} [sequences.GenericSequence]: 🗏 sequences/${name}.yaml\n`), `${name} in c8oProject.yaml`);
    assert.doesNotMatch(yaml, /\n\n/, `${name}: an empty line breaks the load of the project`);
  }
});

test('js/baserow_schema.js asks a token only with an account, never uses GroupsList, AdminLogin or HttpInfo, and logs nothing', () => {
  assert.doesNotMatch(code, /GroupsList|AdminLogin|httpInfo|HttpInfo/);
  assert.equal(code.match(/"TokenGetOrRefresh(Native)?"/g).length, 1, 'one call, in engineBearer');
  assert.doesNotMatch(code, /\blog\.(info|warn|debug|error|trace)\(/);
  assert.doesNotMatch(code, /console\./);
});

test('each transaction the engine calls exists in Baserow_API_spec with the variables it passes', () => {
  const calls = [...code.matchAll(/json\("(_api_[A-Za-z0-9_]+)", \{(.*)$/gm)].map(([all, transaction, rest]) =>
    [all, transaction, rest.replace(/body\(\{.*?\}\)/g, 'body()').replace(/\}\)[^}]*$/, '')]);
  assert.ok(calls.length >= 20, `${calls.length} calls`);
  for (const [, transaction, variables] of calls) {
    const start = connector.indexOf(`\n↓${transaction} [transactions.`);
    assert.ok(start > 0, transaction);
    const end = connector.indexOf('\n↓', start + 1);
    const block = connector.slice(start, end);
    assert.doesNotMatch(block, /\n {2}httpInfo: true/, transaction);
    for (const [, variable] of variables.matchAll(/(\w+):/g)) {
      if (variable === '__nocache') continue;
      assert.match(block, new RegExp(`\\n {2}↓${variable} \\[variables\\.`), `${transaction}.${variable}`);
    }
    assert.match(block, /\n {2}↓__header_Authorization \[variables\.[^\n]*\n {4}visibility: '-1'/, `${transaction}: masked Authorization`);
  }
});

// The engine with its internal calls replaced: TokenGetOrRefresh, C8Oforms.BaserowAccountGet and the Baserow_API_spec
// transactions answered by the in-memory Baserow, each call checked to run with the logs off.
function engineHarness(options = {}) {
  const baserow = fakeBaserow();
  const requests = [];
  const mdc = new Map();
  if (options.nolog != null) mdc.set('nolog', options.nolog);
  global.org = { apache: { log4j: { MDC: {
    put: (key, value) => mdc.set(key, value), get: (key) => (mdc.has(key) ? mdc.get(key) : null), remove: (key) => mdc.delete(key),
  } } } };
  const JWT = 'JWT eyJ.user-token.sig';
  const id = (value) => Number(value);
  const answer = (value) => ({ document: Array.isArray(value) ? { array: value } : { object: value } });
  const transactions = {
    _api_workspaces__GET: () => baserow.api.listWorkspaces(),
    _api_applications__GET: () => baserow.api.listApplications(),
    _api_applications__application_id___GET: (v) => baserow.api.getApplication(id(v.application_id)),
    _api_applications_workspace__workspace_id___POST: (v) => baserow.api.createDatabase(id(v.workspace_id), JSON.parse(v.__body).name),
    _api_applications__application_id___DELETE: (v) => baserow.api.deleteApplication(id(v.application_id)) || {},
    _api_trash_workspace__workspace_id___DELETE: (v) => baserow.api.emptyTrash(id(v.workspace_id), id(v.application_id)) || {},
    _api_database_tables_database__database_id___GET: (v) => baserow.api.listTables(id(v.database_id)),
    _api_database_tables_database__database_id___POST: (v) => baserow.api.createTable(id(v.database_id), JSON.parse(v.__body)),
    _api_database_fields_table__table_id___GET: (v) => baserow.api.listFields(id(v.table_id)),
    _api_database_fields_table__table_id___POST: (v) => baserow.api.createField(id(v.table_id), JSON.parse(v.__body)),
    _api_database_fields__field_id___PATCH: (v) => baserow.api.updateField(id(v.field_id), JSON.parse(v.__body)),
    _api_database_views_table__table_id___GET: (v) => baserow.api.listViews(id(v.table_id)),
    _api_database_views_table__table_id___POST: (v) => baserow.api.createView(id(v.table_id), JSON.parse(v.__body)),
    _api_database_views__view_id__filters__POST: (v) => baserow.api.createViewFilter(id(v.view_id), JSON.parse(v.__body)),
    _api_database_views__view_id__sortings__POST: (v) => baserow.api.createViewSort(id(v.view_id), JSON.parse(v.__body)),
    _api_database_rows_table__table_id___GET: (v) => baserow.api.listRows(id(v.table_id), id(v.page), id(v.size)),
    _api_database_rows_table__table_id__batch__POST: (v) => ({ items: baserow.api.createRows(id(v.table_id), JSON.parse(v.__body).items) }),
    _api_database_rows_table__table_id__batch__PATCH: (v) => ({ items: baserow.api.updateRows(id(v.table_id), JSON.parse(v.__body).items) }),
    _api_jobs__job_id___GET: (v) => baserow.api.getJob(id(v.job_id)),
  };
  BaserowSchema.engine.useRequester((project, target, variables) => {
    requests.push({ project, target, variables, nolog: mdc.get('nolog') === true });
    if (target.__sequence === 'BaserowAccountGet') {
      return { document: options.account || { email: 'user@example.com', password: 'secret' } };
    }
    if (target.__sequence === 'TokenGetOrRefresh') {
      if (options.tokenError) return { document: { error: { message: 'Baserow authentication failed' } } };
      return { document: { Bearer: JWT } };
    }
    assert.equal(project, 'lib_BaseRow');
    assert.equal(target.__connector, 'Baserow_API_spec');
    assert.equal(variables.__header_Authorization, JWT, `${target.__transaction} with the user's token`);
    const handler = transactions[target.__transaction];
    assert.ok(handler, target.__transaction);
    try {
      return answer(handler(variables));
    } catch (e) {
      return { document: { object: { error: e.baserowError || 'ERROR', detail: e.message } } };
    }
  });
  return { baserow, requests, mdc, JWT };
}

test.afterEach(() => {
  BaserowSchema.engine.useRequester(null);
  delete global.org;
});

test('formscommon_SchemaApply step with the account of the C8Oforms user: token asked with that account, every call with the logs off, no token in the answer', () => {
  const { baserow, requests, mdc, JWT } = engineHarness();
  let state = null;
  let result;
  for (let i = 0; i < 20; i++) {
    result = BaserowSchema.engine.run({ mode: 'step', schema: JSON.stringify(fixture()), state: state && JSON.stringify(state), options: JSON.stringify({ workspaceId: 836 }) });
    state = result.state;
    if (result.status !== 'running') break;
  }
  assert.equal(result.status, 'done', JSON.stringify(result.error));
  assert.equal(baserow.db.tables.length, 3);
  const tokens = requests.filter((r) => r.target.__sequence === 'TokenGetOrRefresh');
  assert.ok(tokens.length >= 1);
  for (const token of tokens) {
    assert.deepEqual(token.variables, { email: 'user@example.com', password: 'secret' }, 'never TokenGetOrRefresh without account');
  }
  assert.ok(requests.every((r) => r.nolog), 'the logs are off during each call');
  assert.equal(mdc.has('nolog'), false, 'and on again after');
  const text = JSON.stringify(result);
  assert.ok(!text.includes(JWT) && !text.includes('user-token') && !text.includes('secret'), 'no token nor password in the answer');
});

test('formscommon_SchemaApply describe (C8Oforms #1836) reads with the account of the C8Oforms user only, logs off, and a refusal names its limit', () => {
  const { baserow, requests, JWT } = engineHarness();
  const made = BaserowSchema.apply(fixture(), null, baserow.api, { workspaceId: 836 });
  assert.equal(made.status, 'done', JSON.stringify(made.error));
  baserow.calls.length = 0;
  const path = 'Convertigo NoCode Databases - user@example.com~>Mini CRM~>Opportunités';
  const result = BaserowSchema.engine.run({ mode: 'describe', options: JSON.stringify({ tables: [{ path }], rows: true }) });
  assert.equal(result.status, 'ok', JSON.stringify(result.error));
  assert.equal(result.counts.tables, 3);
  assert.ok(!baserow.calls.some((c) => /^(create|update|delete|empty)/.test(c.name)), 'describe never writes');
  const tokens = requests.filter((r) => r.target.__sequence === 'TokenGetOrRefresh');
  assert.deepEqual(tokens.map((t) => t.variables), [{ email: 'user@example.com', password: 'secret' }]);
  assert.ok(requests.every((r) => r.nolog), 'the logs are off during each call');
  const text = JSON.stringify(result);
  assert.ok(!text.includes(JWT) && !text.includes('user-token') && !text.includes('secret'), 'no token nor password in the answer');
  const refused = BaserowSchema.engine.run({ mode: 'describe', options: { tables: [{ path }], rows: true, maxRowsPerTable: 1 } });
  assert.equal(refused.status, 'error');
  assert.equal(refused.refused, true);
  assert.deepEqual([refused.error.code, refused.error.table, refused.error.count, refused.error.max], ['rows_too_many', 'Opportunités', 2, 1]);
  const missing = BaserowSchema.engine.run({ mode: 'describe', options: {} });
  assert.equal(missing.error.code, 'tables_missing');
  assert.equal(missing.refused, undefined);
});

test('without an account the engine refuses, it never asks a token without account', () => {
  for (const account of [{}, { email: 'user@example.com', password: '' }, { error: { message: 'no account' } }]) {
    const { baserow, requests } = engineHarness({ account });
    const result = BaserowSchema.engine.run({ mode: 'apply', schema: fixture(), options: { workspaceId: 836 } });
    assert.equal(result.status, 'error');
    assert.equal(result.error.code, 'baserow_account_unavailable');
    assert.ok(!requests.some((r) => r.target.__sequence === 'TokenGetOrRefresh'), JSON.stringify(account));
    assert.equal(baserow.calls.length, 0);
  }
  for (const params of [{ authorization: 'Bearer abc' }, { authorization: 'garbage' }, { email: 'user@example.com' }, { password: 'x' }]) {
    const { requests } = engineHarness();
    const result = BaserowSchema.engine.run({ mode: 'step', schema: fixture(), options: { workspaceId: 836 }, ...params });
    assert.equal(result.error.code, 'baserow_account_unavailable', JSON.stringify(params));
    assert.equal(requests.length, 0, JSON.stringify(params));
  }
  const { requests } = engineHarness({ tokenError: true });
  const failed = BaserowSchema.engine.databaseCreate({ workspace_id: '836', name: 'Base', email: 'user@example.com', password: 'pw' });
  assert.equal(failed.error.code, 'baserow_account_unavailable');
  assert.ok(!JSON.stringify(failed).includes('pw'));
  assert.equal(requests.filter((r) => r.target.__connector).length, 0);
});

test('an explicit account is used as given: a JWT of the caller, or email and password', () => {
  const jwt = engineHarness();
  BaserowSchema.engine.tableCreate({ database_id: '1', name: 'T', authorization: 'JWT eyJ.caller.sig' });
  assert.deepEqual(jwt.requests[0].variables, { authorization: 'JWT eyJ.caller.sig' });
  assert.ok(!jwt.requests.some((r) => r.target.__sequence === 'BaserowAccountGet'));
  const pair = engineHarness();
  BaserowSchema.engine.databaseCreate({ workspace_id: '836', name: 'Base', email: 'other@example.com', password: 'pw' });
  assert.deepEqual(pair.requests[0].variables, { email: 'other@example.com', password: 'pw' });
});

test('the logs stay off after a call when the caller had turned them off', () => {
  const { mdc } = engineHarness({ nolog: true });
  BaserowSchema.engine.databaseCreate({ workspace_id: '836', name: 'Base' });
  assert.equal(mdc.get('nolog'), true);
});

test('DatabaseCreate: in a workspace of the user only; DatabaseDeleteDefinitive: trash then purge, only in the workspace given', () => {
  const { baserow } = engineHarness();
  const refused = BaserowSchema.engine.databaseCreate({ workspace_id: '12', name: 'Base' });
  assert.equal(refused.error.code, 'workspace_not_in_catalog');
  const created = BaserowSchema.engine.databaseCreate({ workspace_id: '836', name: 'Base' });
  assert.equal(created.status, 'created');
  assert.equal(baserow.db.applications[0].id, created.id);
  const table = BaserowSchema.engine.tableCreate({ database_id: String(created.id), name: 'Clients', primary_field: 'Nom' });
  assert.equal(table.status, 'created');
  assert.deepEqual(baserow.db.fields.filter((f) => f.table_id === table.id).map((f) => [f.name, f.primary]), [['Nom', true]]);
  assert.equal(BaserowSchema.engine.databaseDelete({ database_id: String(created.id), workspace_id: '900' }).error.code, 'delete_refused');
  assert.equal(baserow.db.applications.length, 1);
  const deleted = BaserowSchema.engine.databaseDelete({ database_id: String(created.id), workspace_id: '836' });
  assert.equal(deleted.status, 'deleted');
  assert.equal(baserow.db.applications.length + baserow.db.trash.length, 0);
});

test('formscommon_SchemaApply rollback deletes for good the base the state created, and nothing else', () => {
  const { baserow } = engineHarness();
  // (a paid feature refused no longer fails the run, beta29: another refusal of Baserow)
  baserow.fail('createView', baserow.baserowError('ERROR_REQUEST_BODY_VALIDATION', 'kanban'), { after: 1 });
  const failed = BaserowSchema.engine.run({ mode: 'apply', schema: JSON.stringify(fixture()), options: JSON.stringify({ workspaceId: 836 }) });
  assert.equal(failed.status, 'error');
  assert.match(failed.error.message, /ERROR_REQUEST_BODY_VALIDATION/);
  assert.equal(failed.state.createdBase, true);
  const rollback = BaserowSchema.engine.run({ mode: 'rollback', state: JSON.stringify(failed.state) });
  assert.equal(rollback.status, 'deleted');
  assert.equal(baserow.db.applications.length + baserow.db.trash.length, 0);
  const forged = BaserowSchema.engine.run({ mode: 'rollback', state: JSON.stringify({ ...failed.state, workspaceId: 900 }) });
  assert.equal(forged.status, 'error');
});

test('JobWait answers a failed job as an error and never waits more than 300 s', () => {
  const { baserow } = engineHarness();
  baserow.db.jobs[5] = { id: 5, state: 'failed', human_readable_error: 'Broken file' };
  const failed = BaserowSchema.engine.jobWait({ job_id: '5' });
  assert.equal(failed.error.code, 'job_failed');
  assert.match(failed.error.message, /Broken file/);
  baserow.db.jobs[6] = { id: 6, state: 'finished' };
  assert.equal(BaserowSchema.engine.jobWait({ job_id: '6', timeout_ms: '999999999' }).status, 'finished');
  assert.match(source, /Math\.min\(numberOrNull\(params\.timeout_ms\) \|\| 60000, 300000\)/);
});

test('a Baserow error is final, an engine error (connection, timeout) can be retried', () => {
  const final = BaserowSchema.answerError({ document: { object: { error: 'ERROR_USER_NOT_IN_GROUP', detail: 'not in workspace' } } });
  assert.equal(final.retryable, false);
  assert.match(final.message, /ERROR_USER_NOT_IN_GROUP: not in workspace/);
  const engine = BaserowSchema.answerError({ document: { error: { message: 'Read timed out' } } });
  assert.equal(engine.retryable, true);
  assert.equal(BaserowSchema.answerError({ document: { object: { id: 3, name: 'f', error: 'formula error' } } }), null, 'a formula field with an error is a field');
  assert.equal(BaserowSchema.answerError({ document: { array: [] } }), null);
  assert.match(BaserowSchema.answerError({ document: { object: { detail: 'Not found.' } } }).message, /Not found/);
  assert.equal(BaserowSchema.answerError({ document: {} }), null, 'a DELETE answers no content');
});

test('formscommon_SchemaApply workspaces: the workspaces of the user account, a workspace without base included, no token in the answer', () => {
  const { JWT } = engineHarness();
  const result = BaserowSchema.engine.run({ mode: 'workspaces' });
  assert.equal(result.status, 'ok', JSON.stringify(result.error));
  assert.ok(Array.isArray(result.workspaces) && result.workspaces.length > 0);
  assert.ok(result.workspaces.every((w) => typeof w.id === 'number' && typeof w.name === 'string'));
  assert.ok(!JSON.stringify(result).includes(JWT.replace(/^JWT /, '')));
});
