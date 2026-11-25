const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readSequence, readProjectFile, stepProperty } = require('./read-yaml-steps.cjs');

function dateTimezoneHelper(name) {
  const yaml = readSequence(name);
  const script = stepProperty(yaml, name === 'formssource_GetTableData' ? 'ComputeData' : 'computeValue', 'expression');
  const helper = script.match(/var getDateDisplayTimezone = function\(field\) \{[\s\S]*?\n\};/);
  assert.ok(helper, `${name}: getDateDisplayTimezone`);
  return helper[0];
}

test('GetSelectData shows datetimes in the same timezone as GetTableData (#1424)', () => {
  const tableHelper = dateTimezoneHelper('formssource_GetTableData');
  const selectHelper = dateTimezoneHelper('formssource_GetSelectData');
  assert.equal(selectHelper, tableHelper);
  const sandbox = {
    getFieldOption: (field, name) => (field != null && field[name] != undefined ? '' + field[name] : ''),
  };
  vm.createContext(sandbox);
  // The ${symbol=default} is resolved by Convertigo; here the literal stands for an unset symbol.
  vm.runInContext(selectHelper.replace('${lib_BaseRow.dateTimezone=UTC}', 'UTC'), sandbox);
  assert.equal(sandbox.getDateDisplayTimezone({ date_force_timezone: 'Europe/Paris' }), 'Europe/Paris');
  assert.equal(sandbox.getDateDisplayTimezone({ date_include_time: true }), 'UTC');
  assert.equal(sandbox.getDateDisplayTimezone(null), 'UTC');
  for (const name of ['formssource_GetTableData', 'formssource_GetSelectData']) {
    assert.doesNotMatch(readSequence(name), /lib_BaseRow\.dateTimezone=Europe\/Paris/, name);
  }
});

function authError(authResponse) {
  const script = stepProperty(readSequence('AdminLogin'), 'CheckAuthResponse', 'expression');
  const sandbox = authResponse === undefined ? {} : { authResponse };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  return sandbox.authError;
}

test('AdminLogin turns every login answer without a token into an error', () => {
  assert.equal(authError({ token: 'jwt', refresh_token: 'r' }), null);
  assert.equal(authError({ access_token: 'jwt' }), null);
  assert.equal(authError({ error: 'ERROR_INVALID_CREDENTIALS', detail: 'Invalid credentials.' }),
    'ERROR_INVALID_CREDENTIALS: Invalid credentials.');
  assert.equal(authError({ error: 'ERROR_DEACTIVATED_USER', detail: 'User account has been disabled.' }),
    'ERROR_DEACTIVATED_USER: User account has been disabled.');
  assert.equal(authError({ detail: 'Request was throttled. Expected available in 5 seconds.' }),
    'Request was throttled. Expected available in 5 seconds.');
  assert.equal(authError({ non_field_errors: ['Unable to log in with provided credentials.'] }),
    'Unable to log in with provided credentials.');
  assert.equal(authError({ token: '' }), 'Baserow authentication failed: no token in the answer');
  assert.equal(authError(undefined), 'Baserow authentication failed: no token in the answer');
  assert.equal(authError({ error: 'ERROR_REQUEST_BODY_VALIDATION', detail: { email: [{ error: 'required' }] } }),
    'ERROR_REQUEST_BODY_VALIDATION: {"email":[{"error":"required"}]}');
});

test('AdminLogin refuses a Baserow account with 2FA instead of keeping its temporary token', () => {
  assert.equal(authError({ two_factor_auth: 'totp', token: 'temporary' }),
    'Baserow authentication failed: the Baserow account has two-factor authentication enabled (totp), which is not supported');
  assert.equal(authError({ access_token: 'jwt', token: '' }), null);
  assert.equal(authError({ access_token: '', token: 'jwt' }), null);
});

test('AdminLogin keeps access_token first and the deprecated token only as a fallback', () => {
  const yaml = readSequence('AdminLogin');
  const preferred = './document/object/access_token/text() | ./document/object[not(access_token/text())]/token/text()';
  assert.equal(yaml.split(`↑value: ${preferred}\n`).length - 1, 1);
  assert.equal(yaml.split(`↑value: (${preferred})[1]\n`).length - 1, 2);
  assert.doesNotMatch(yaml, /↑value: \(?\.\/document\/object\/token\/text\(\)/);
});

// The tokens are stored in the session (keep_in_session) or returned (keep_in_session=false) after the error check.
test('AdminLogin returns before storing or returning a token when the login failed', () => {
  const yaml = readSequence('AdminLogin');
  const order = ['↓Call_Transaction ', '↓AuthResponse ', '↓CheckAuthResponse ', '↓IfAuthError ', '↓IfKeepTokenInSession ',
    '↓SetTokenInSession ', '↓IfReturnToken ', '\n  ↓auth '].map((header) => yaml.indexOf(header));
  assert.ok(order.every((index, i) => index > 0 && (i === 0 || index > order[i - 1])), order.join(','));
  assert.equal(stepProperty(yaml, 'IfAuthError', 'condition'), 'authError != null');
  assert.match(yaml, /↓IfAuthError [^\n]+\n  condition: authError != null\n  ↓Error_structure [\s\S]*?\n  ↓Return \[steps\.ReturnStep-\d+\]: \n↓IfKeepTokenInSession [^\n]+\n  condition: keepInSession\n  ↓SetTokenInSession /);
  assert.doesNotMatch(yaml, /non_field_errors\/value/);
});

const common = readProjectFile('js/common.js');

test('table names are compared as texts in the JSON of Baserow, whatever quotes they hold', () => {
  const helper = common.match(/function findFirst\(items, matches\) \{[\s\S]*?\n\t\}/);
  assert.ok(helper);
  const isJsonArray = common.match(/function isJsonArray\(value\) \{[\s\S]*?\n\t\}/);
  assert.ok(isJsonArray);
  // in common.js, Array is java.lang.reflect.Array (JavaImporter): no Array.isArray
  assert.doesNotMatch(common, /Array\.isArray/);
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(isJsonArray[0] + '\n' + helper[0], sandbox);
  const tables = [{ id: 1, name: 'a"b' }, { id: 2, name: 'a"b\'c' }, { id: 3, name: 'a"b\'c' }];
  for (const name of ['a"b', 'a"b\'c']) {
    const found = sandbox.findFirst(tables, (table) => table.name != null && ('' + table.name) == name);
    assert.equal(found.id, name == 'a"b' ? 1 : 2);
  }
  assert.equal(sandbox.findFirst(null, () => true), null);
  // no name is put into an XPath any more: the applications and the tables are read as JSON
  assert.doesNotMatch(common, /toXPathLiteral|object\[name=/);
  assert.match(common, /callNative\("\.\._api_applications__GET_raw"/);
  assert.match(common, /callNative\("\.\._api_database_tables_database__database_id___GET_raw"/);
  assert.match(common, /application_\.workspace\.name\) == application/);
});

test('an incomplete application~>database~>table id is not resolved', () => {
  const check = common.match(/let \[application, database, table\] = [\s\S]*?\n\t\t\}/);
  assert.ok(check);
  const complete = new Function('table_id', 'log',
    `${check[0].replace('let [application, database, table]', 'var [application, database, table]').replace('return;', 'return false;')} return true;`);
  const log = { debug() {} };
  assert.equal(complete('App~>Db~>Table', log), true);
  assert.equal(complete('App~>Db', log), false);
  assert.equal(complete('App~>~>Table', log), false);
  assert.equal(complete('~>Db~>Table', log), false);
  assert.equal(complete('Table', log), false);
});

test('FieldsListApiKey cache keeps a schema change visible within a minute', () => {
  const expiry = readSequence('FieldsListApiKey').match(/^responseExpiryDate: absolute,(\d+)$/m);
  assert.ok(expiry);
  assert.ok(Number(expiry[1]) <= 60000, expiry[1]);
});

function authToken(answer) {
  const helper = common.match(/function getAuthToken\(\) \{[\s\S]*?\n\t\}/);
  assert.ok(helper);
  const helpers = ['isJsonArray', 'textOf', 'jsonAnswer', 'callNative'].map((name) => common.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\t\\}`))[0]);
  const session = {};
  const mdc = {};
  const noLogCalls = [];
  const sandbox = {
    context: { httpSession: { getAttribute: (key) => session[key], setAttribute: (key, value) => { session[key] = value; } } },
    Engine: { theApp: { databaseObjectsManager: { symbolsGetValue: () => '' } } },
    MDC: { put: (key, value) => { mdc[key] = value; }, remove: (key) => { delete mdc[key]; } },
    isTokenStillValid: () => true,
    // the raw token-auth transaction answers its JSON text to a native call, with the logs off
    call: (requestable, vars) => {
      assert.equal(requestable, '.._api_Auth_raw');
      assert.equal(vars.__nativeCall, 'true');
      noLogCalls.push(mdc.nolog === true);
      return JSON.stringify(answer);
    },
    org: { w3c: { dom: { Document: function Document() {} } } },
    log: { debug() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(helpers.join('\n') + '\n' + helper[0], sandbox);
  let token;
  try {
    token = sandbox.getAuthToken();
  } finally {
    noLogCalls.push(mdc.nolog === undefined ? 'logs on' : 'logs off');
  }
  return { token, session, noLogCalls };
}

test('the table id resolution logs in with access_token first and refuses 2FA', () => {
  assert.equal(authToken({ access_token: 'access', token: 'deprecated' }).token, 'access');
  assert.equal(authToken({ token: 'deprecated' }).token, 'deprecated');
  assert.throws(() => authToken({ two_factor_auth: 'totp', token: 'temporary' }), /two-factor authentication enabled \(totp\)/);
});

// The answer of _api_Auth holds the tokens of the account: the engine logs it (Generated XML) unless the MDC nolog is set.
test('the table id resolution calls _api_Auth with the logs off, then turns them on again', () => {
  assert.deepEqual(authToken({ access_token: 'access' }).noLogCalls, [true, 'logs on']);
});

test('GroupsList reads /api/workspaces/, /api/groups/ being gone from Baserow 1.34', () => {
  assert.match(readSequence('GroupsList'), /sourceTransaction: lib_BaseRow\.Baserow_API_spec\._api_workspaces__GET\n/);
  const connector = readProjectFile('_c8oProject/connectors/Baserow_API_spec.yaml');
  const transaction = connector.match(/\n↓_api_workspaces__GET \[transactions\.JsonHttpTransaction\]: \n[\s\S]*?(?=\n↓)/);
  assert.ok(transaction);
  assert.match(transaction[0], /\n  subDir: \/api\/workspaces\/\n/);
});

test('the filter types are those of Baserow 1.34.5', () => {
  const getFilter = readProjectFile('js/getFilter.js');
  assert.match(getFilter, /^\/\/ 1\.34\.5 baserow filters /);
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${getFilter}\nthis.types = _c8oBRtypes; this.typeOf = getBrFilterType;`, sandbox);
  // starts_with only exists from Baserow 2.x: Baserow 1.34 refuses it
  assert.ok(!sandbox.types.field_types.text.includes('starts_with'));
  assert.ok(sandbox.types.formula_types['array(number)'].includes('has_value_higher'));
  assert.ok(sandbox.types.formula_types['array(date)'].includes('has_date_within'));
  assert.ok(sandbox.types.formula_types.multiple_select.includes('multiple_select_has'));
  // no Baserow filter accepts a link formula: no filter rather than a wrong one
  assert.equal(sandbox.typeOf({ type: 'formula', formula_type: 'link' }).value, undefined);
});

test('the disabled legacy read sequences are gone', () => {
  const project = readProjectFile('c8oProject.yaml');
  assert.doesNotMatch(project, /_disabled_formssource_Get(Select|Table)DataOld/);
  assert.throws(() => readSequence('_disabled_formssource_GetSelectDataOld'));
  assert.throws(() => readSequence('_disabled_formssource_GetTableDataOld'));
});

// A table deleted by hand in Baserow and created again with the same names gets a new id: the id cached by path is
// checked again (at most every TABLE_ID_CHECK_MS), dropped when Baserow answers the table does not exist, and the
// path resolved again, once.
function resolveWith({ cached, checkAnswer, now = 1000000 }) {
  const pick = (name) => common.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\t\\}`))[0];
  const constant = common.match(/var TABLE_ID_CHECK_MS = \d+;/)[0];
  const calls = [];
  const cache = new Map([['project_hash', 7]]);
  if (cached != null) cache.set('scope~>Mine~>Base~>Table', cached);
  const variables = new Map();
  const sandbox = {
    table_id: 'Mine~>Base~>Table',
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } },
    System: { identityHashCode: () => 7 },
    Collections: { synchronizedMap: (m) => m },
    HashMap: Map,
    context: {
      project: { original: null, get: () => ({ get: (k) => cache.get(k), put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k) }), set() {} },
      transaction: { variables: { put: (k, v) => variables.set(k, v) } },
      connector: { prepareForTransaction() {} },
    },
    getTransactionAuthorization: () => 'JWT x',
    getUserScope: () => 'scope',
    setMissingTableId: (reason) => { throw new Error(reason); },
    getBaserowJsonErrorText: () => '',
    org: { w3c: { dom: { Document: function Document() {} } } },
    log: { debug() {}, trace() {}, info() {} },
    call: (requestable, vars) => {
      calls.push(requestable);
      if (requestable === '.._api_database_tables__table_id___GET_raw') return JSON.stringify(checkAnswer(vars.table_id));
      if (requestable === '.._api_applications__GET_raw') return JSON.stringify([{ id: 30, name: 'Base', workspace: { name: 'Mine' } }]);
      if (requestable === '.._api_database_tables_database__database_id___GET_raw') return JSON.stringify([{ id: 99, name: 'Table' }]);
      throw new Error(requestable);
    },
  };
  vm.createContext(sandbox);
  vm.runInContext([constant, ...['isJsonArray', 'textOf', 'jsonAnswer', 'callNative', 'findFirst', 'isMissingTable', 'resolveTableId'].map(pick)].join('\n'), sandbox);
  // the cache is a project attribute: the sandbox returns the same map on every get
  const store = sandbox.context.project.get();
  sandbox.context.project.get = () => store;
  sandbox.resolveTableId();
  return { id: variables.get('table_id'), calls, entry: cache.get('scope~>Mine~>Base~>Table') };
}

test('a cached table id that no longer exists is dropped and its path resolved again, once', () => {
  const stale = resolveWith({ cached: '10@0', checkAnswer: () => ({ error: 'ERROR_TABLE_DOES_NOT_EXIST', detail: 'The requested table does not exist.' }) });
  assert.equal(stale.id, '99');
  assert.deepEqual(stale.calls, ['.._api_database_tables__table_id___GET_raw', '.._api_applications__GET_raw', '.._api_database_tables_database__database_id___GET_raw']);
  assert.equal(stale.entry, '99@1000000');
  // checked less than TABLE_ID_CHECK_MS ago: no call at all
  const fresh = resolveWith({ cached: '10@990000', checkAnswer: () => { throw new Error('no check expected'); } });
  assert.equal(fresh.id, '10');
  assert.deepEqual(fresh.calls, []);
  // still there: kept, its check renewed
  const alive = resolveWith({ cached: '10@0', checkAnswer: (id) => ({ id: Number(id), name: 'Table' }) });
  assert.equal(alive.id, '10');
  assert.equal(alive.entry, '10@1000000');
  // another table now holds the id under another name: resolved again
  assert.equal(resolveWith({ cached: '10@0', checkAnswer: (id) => ({ id: Number(id), name: 'Other' }) }).id, '99');
  // a network error or a refusal: the cached id is kept, the call itself tells the error
  assert.equal(resolveWith({ cached: '10@0', checkAnswer: () => null }).id, '10');
  assert.equal(resolveWith({ cached: '10@0', checkAnswer: () => ({ error: 'ERROR_USER_NOT_IN_GROUP' }) }).id, '10');
  // an entry cached before this version (no time) is checked at once
  assert.equal(resolveWith({ cached: '10', checkAnswer: () => ({ error: 'ERROR_TABLE_DOES_NOT_EXIST' }) }).id, '99');
});
