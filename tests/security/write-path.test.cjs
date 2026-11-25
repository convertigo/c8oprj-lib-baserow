// The write path (forms_AddRow, forms_AddRowFromData, TableCreateRows): the access token of an account shared by the
// HTTP sessions of the server (js/token_cache.js), the form read once per revision by formscommon_CheckConfig, the
// fields read as JSON, and the wait of an import job.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readSequence, readProjectFile, stepProperty } = require('./read-yaml-steps.cjs');

const root = path.join(__dirname, '../..');

// The Java classes used by js/jwt.js and js/token_cache.js
class JString {
  constructor(value) { this.value = Buffer.isBuffer(value) ? value.toString('utf8') : String(value); }
  getBytes() { return Buffer.from(this.value, 'utf8'); }
  toString() { return this.value; }
}
class ConcurrentHashMap {
  constructor() { this.map = new Map(); }
  get(key) { return this.map.has(key) ? this.map.get(key) : null; }
  put(key, value) { this.map.set(key, value); }
  remove(key, value) { if (this.map.get(key) === value) this.map.delete(key); }
  size() { return this.map.size; }
  entrySet() {
    const entries = [...this.map.entries()];
    return { iterator: () => ({ hasNext: () => entries.length > 0, next: () => { const [key, value] = entries.shift(); return { getKey: () => key, getValue: () => value }; } }) };
  }
}
const java = {
  lang: { String: JString, Byte: { TYPE: 'byte' }, reflect: { Array: { newInstance: (type, length) => Buffer.alloc(length) } } },
  security: { SecureRandom: class { nextBytes(bytes) { crypto.randomFillSync(bytes); } } },
  util: {
    Base64: {
      getEncoder: () => ({ encodeToString: (bytes) => bytes.toString('base64') }),
      getDecoder: () => ({ decode: (text) => Buffer.from(String(text), 'base64') }),
      getUrlEncoder: () => ({ withoutPadding: () => ({ encodeToString: (bytes) => bytes.toString('base64url') }) }),
      getUrlDecoder: () => ({ decode: (text) => Buffer.from(String(text), 'base64url') }),
    },
    concurrent: { ConcurrentHashMap },
  },
};
const javax = {
  crypto: {
    Mac: { getInstance: () => ({ init(spec) { this.key = spec.key; }, doFinal(bytes) { return crypto.createHmac('sha256', this.key).update(bytes).digest(); } }) },
    spec: { SecretKeySpec: class { constructor(key) { this.key = key; } } },
  },
};
const org = { apache: { commons: { codec: { digest: { DigestUtils: { md5Hex: (text) => crypto.createHash('md5').update(text).digest('hex') } } } } } };

function httpSession() {
  const values = new Map();
  return {
    values,
    getAttribute: (key) => (values.has(key) ? values.get(key) : null),
    setAttribute: (key, value) => { values.set(key, value); },
    removeAttribute: (key) => { values.delete(key); },
    getAttributeNames: () => {
      const names = [...values.keys()];
      return { hasMoreElements: () => names.length > 0, nextElement: () => names.shift() };
    },
  };
}

// Crypto2 of the engine, reversible
const com = { twinsoft: { convertigo: { engine: { util: { Crypto2: {
  encodeToHexString: (text) => `c2:${Buffer.from(String(text)).toString('hex')}`,
  decodeFromHexString: (hex) => (String(hex).startsWith('c2:') ? Buffer.from(String(hex).slice(3), 'hex').toString() : null),
} } } } } };

// A Baserow JWT of a user issued age seconds ago, valid for seconds more (negative: expired)
function jwt(userId, seconds, signature = 'sig', age = 30) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { user_id: userId, iat: now - age, exp: now + seconds };
  return `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${signature}`;
}

const md5 = (text) => crypto.createHash('md5').update(text).digest('hex');

// One run of TokenGetOrRefresh(Native): the owner step, then, when it found no token, the answer of the login (or of the
// refresh) stored by StoreToken. project is the shared map of the project (context.project), kept between runs.
function tokenRun(sequence, project, session, variables, login, symbol = 'true') {
  const yaml = readSequence(sequence);
  const owner = stepProperty(yaml, 'owner', 'expression').replace('${lib_baserow.token_cache=true}', symbol);
  const store = stepProperty(yaml, 'StoreToken', 'expression');
  const sandbox = {
    java, javax, org, com, JSON, Date, Math,
    context: { httpSession: session, project: { get: (key) => project.get(key) ?? null, set: (key, value) => project.set(key, value) } },
    log: { info() {}, warn() {}, debug() {} },
    email: '', password: '', authorization: '', ...variables,
  };
  sandbox.include = (file) => vm.runInContext(readProjectFile(file), sandbox);
  vm.createContext(sandbox);
  vm.runInContext(owner, sandbox);
  let logins = 0;
  // what AdminLogin is asked: a login with the credentials of the scope, or a refresh only
  const asked = { email: sandbox.email, password: sandbox.password, refreshOnly: sandbox.refresh_only, refreshToken: sandbox.refresh_token };
  if (sandbox.bearer == null) {
    logins++;
    sandbox.loginTokens = login;
    vm.runInContext(store, sandbox);
  }
  return { bearer: sandbox.bearer, logins, asked };
}

const kept = (project) => {
  const store = project.get('lib_baserow.token_cache');
  return store == null ? [] : [...store.map.entries()].filter(([name]) => name !== 'secret').map(([, value]) => JSON.parse(value).token);
};

for (const sequence of ['TokenGetOrRefresh', 'TokenGetOrRefreshNative']) {
  test(`${sequence}: an account logged in by one HTTP session is not logged in again by the next ones`, () => {
    const project = new Map();
    const account = { email: 'owner@example.com', password: 'secret' };
    const token = jwt(7, 600);
    const first = httpSession();
    const login = tokenRun(sequence, project, first, account, { token, refresh_token: 'refresh-1' });
    assert.deepEqual([login.bearer, login.logins], [`JWT ${token}`, 1]);
    // each submit action of a form runs in a session of its own
    const second = httpSession();
    const reuse = tokenRun(sequence, project, second, account, { token: 'never asked' });
    assert.deepEqual([reuse.bearer, reuse.logins], [`JWT ${token}`, 0]);
    const key = md5('owner:owner@example.com:secret');
    assert.equal(second.values.get('token_for_' + key), token, 'the token is kept in the session too');
    assert.equal(second.values.get('token'), token, 'and given to the callers without account');
    // the refresh token stays in the session that logged in, it is never shared
    assert.equal(second.values.get('refresh_token_for_' + key), undefined);
    assert.equal(first.values.get('refresh_token_for_' + key), 'refresh-1');
    // the session that took the token can log its account in again, its credentials kept ciphered
    const relogin = second.values.get('token_relogin_for_' + key);
    assert.ok(relogin && !relogin.includes('secret') && !relogin.includes('owner@example.com'), relogin);
    assert.equal(first.values.get('token_relogin_for_' + key), undefined, 'a session with its refresh token renews by refresh');
    const store = project.get('lib_baserow.token_cache');
    for (const [name, value] of store.map) {
      assert.ok(!name.includes('owner@example.com') && !name.includes('secret@') && !name.includes(token), 'the key is an HMAC');
      if (name !== 'secret') {
        assert.ok(!value.includes('refresh-1'), 'no refresh token kept for the server');
        assert.ok(!value.includes('owner@example.com') && !value.includes('"secret"'), 'no credential kept');
      }
    }
  });

  test(`${sequence}: the token of an account is found only with its own credentials, while half of its life is left`, () => {
    const project = new Map();
    const owner = { email: 'owner@example.com', password: 'secret' };
    tokenRun(sequence, project, httpSession(), owner, { token: jwt(7, 600) });
    // another password (a changed one) or another account logs in
    assert.equal(tokenRun(sequence, project, httpSession(), { email: 'owner@example.com', password: 'other' }, { token: jwt(7, 600, 'b') }).logins, 1);
    assert.equal(tokenRun(sequence, project, httpSession(), { email: 'other@example.com', password: 'secret' }, { token: jwt(8, 600) }).logins, 1);
    // a 10 minutes token: given with 310 s left, not with 290 s left (still valid for the session that logged in)
    const project2 = new Map();
    const young = jwt(7, 310, 'young', 290);
    tokenRun(sequence, project2, httpSession(), owner, { token: young });
    assert.deepEqual(tokenRun(sequence, project2, httpSession(), owner, { token: 'never asked' }).bearer, `JWT ${young}`);
    const project3 = new Map();
    tokenRun(sequence, project3, httpSession(), owner, { token: jwt(7, 290, 'old', 310) });
    const renewed = jwt(7, 600, 'renewed');
    const run = tokenRun(sequence, project3, httpSession(), owner, { token: renewed });
    assert.deepEqual([run.bearer, run.logins], [`JWT ${renewed}`, 1]);
    assert.deepEqual(kept(project3), [renewed], 'the new login replaces the old token');
    // a token without iat or exp is never given
    const project4 = new Map();
    const opaque = `x.${Buffer.from(JSON.stringify({ user_id: 7 })).toString('base64url')}.sig`;
    tokenRun(sequence, project4, httpSession(), owner, { token: opaque });
    assert.equal(tokenRun(sequence, project4, httpSession(), owner, { token: jwt(7, 600) }).logins, 1);
  });

  test(`${sequence}: a call given an expired token of the server cache logs its account in again instead of failing`, () => {
    const project = new Map();
    const owner = { email: 'owner@example.com', password: 'secret' };
    const key = md5('owner:owner@example.com:secret');
    tokenRun(sequence, project, httpSession(), owner, { token: jwt(7, 600, 'first') });
    const session = httpSession();
    tokenRun(sequence, project, session, owner, { token: 'never asked' });
    // minutes later, the token of the session has expired (a long submit: files, then the row)
    const expired = jwt(7, -5, 'first', 605);
    session.setAttribute('token_for_' + key, expired);
    // another session logged in meanwhile: its token is taken, without login
    const other = jwt(7, 600, 'other');
    tokenRun(sequence, project, httpSession(), { email: 'owner@example.com', password: 'secret' }, { token: other });
    project.get('lib_baserow.token_cache').map.forEach((value, name) => {
      if (name !== 'secret') project.get('lib_baserow.token_cache').map.set(name, JSON.stringify({ token: other, timestamp: Date.now() }));
    });
    const reuse = tokenRun(sequence, project, session, { authorization: `JWT ${expired}`, password: 'admin-default' }, { token: 'never asked' });
    assert.deepEqual([reuse.bearer, reuse.logins], [`JWT ${other}`, 0]);
    // no token left in the server cache: a login with the credentials of the account, never a refresh that cannot work
    session.setAttribute('token_for_' + key, expired);
    project.delete('lib_baserow.token_cache');
    const fresh = jwt(7, 600, 'fresh');
    const relogin = tokenRun(sequence, project, session, { authorization: `JWT ${expired}`, password: 'admin-default' },
      { token: fresh, refresh_token: 'refresh-2' });
    assert.deepEqual([relogin.bearer, relogin.logins], [`JWT ${fresh}`, 1]);
    assert.deepEqual(relogin.asked, { email: 'owner@example.com', password: 'secret', refreshOnly: 'false', refreshToken: null });
    assert.equal(session.values.get('token_for_' + key), fresh);
    assert.equal(session.values.get('refresh_token_for_' + key), 'refresh-2');
    assert.deepEqual(kept(project), [fresh], 'a login: kept for the server');
    // without the credentials of a cached token (a session that refreshes), the refresh path is unchanged
    const plain = httpSession();
    plain.setAttribute('token_for_abc', expired);
    plain.setAttribute('refresh_token_for_abc', 'refresh-9');
    const refresh = tokenRun(sequence, new Map(), plain, { authorization: `JWT ${expired}`, password: 'admin-default' }, { token: jwt(7, 600, 'r'), refreshed: 'true' });
    assert.deepEqual(refresh.asked, { email: '', password: 'admin-default', refreshOnly: 'true', refreshToken: 'refresh-9' });
  });

  test(`${sequence}: a refreshed token is never kept for the server`, () => {
    const project = new Map();
    const owner = { email: 'owner@example.com', password: 'secret' };
    const key = md5('owner:owner@example.com:secret');
    const session = httpSession();
    session.setAttribute('token_for_' + key, jwt(7, -10));
    session.setAttribute('refresh_token_for_' + key, 'refresh-1');
    const run = tokenRun(sequence, project, session, owner, { token: jwt(7, 600, 'refreshed'), refreshed: 'true' });
    assert.equal(run.asked.refreshToken, 'refresh-1');
    assert.equal(run.logins, 1);
    assert.deepEqual(kept(project), []);
  });

  test(`${sequence}: lib_baserow.token_cache=false keeps the tokens in the HTTP session only`, () => {
    const project = new Map();
    const account = { email: 'owner@example.com', password: 'secret' };
    tokenRun(sequence, project, httpSession(), account, { token: jwt(7, 600) }, 'false');
    assert.equal(tokenRun(sequence, project, httpSession(), account, { token: jwt(7, 600, 'b') }, 'false').logins, 1);
    assert.equal(project.get('lib_baserow.token_cache'), undefined);
  });

  test(`${sequence}: a token renewed for the Bearer given by a caller is never kept for the server`, () => {
    const project = new Map();
    const session = httpSession();
    const expired = jwt(9, -10);
    // the session knows the account of that user (a token and its refresh token)
    session.setAttribute('token_for_abc', expired);
    session.setAttribute('refresh_token_for_abc', 'refresh-9');
    // the password variable keeps its default value (the Baserow admin password) when the caller gives only authorization
    const run = tokenRun(sequence, project, session, { authorization: `JWT ${expired}`, password: 'admin-default' },
      { token: jwt(9, 600, 'refreshed'), refreshed: 'true' });
    assert.equal(run.logins, 1);
    assert.deepEqual(kept(project), [], 'nothing kept under the admin credentials');
  });
}

// js/token_cache.js alone, its project map kept
function tokenCache(project = new Map()) {
  const sandbox = { java, javax, JSON, Date, context: { project: { get: (key) => project.get(key) ?? null, set: (key, value) => project.set(key, value) } },
    getFieldsCacheScope: (authorization) => `1:${crypto.createHash('sha256').update(String(authorization)).digest('base64url')}` };
  vm.createContext(sandbox);
  vm.runInContext(readProjectFile('js/jwt.js'), sandbox);
  vm.runInContext(readProjectFile('js/token_cache.js'), sandbox);
  return sandbox;
}

test('js/token_cache.js forgets a token Baserow refuses, by the Authorization or by the cache_scope of the call', () => {
  const cache = tokenCache();
  const [a, b] = [jwt(7, 600, 'a'), jwt(8, 600, 'b')];
  cache.putCachedToken('a@example.com', 'p', a, Date.now());
  cache.putCachedToken('b@example.com', 'p', b, Date.now());
  // the answer of Baserow 1.34 to a refused access token (HTTP 401)
  assert.equal(cache.isRefusedToken({ detail: 'Access token is expired or invalid.', error: 'ERROR_INVALID_ACCESS_TOKEN' }), true);
  assert.equal(cache.isRefusedToken({ error: 'ERROR_TABLE_DOES_NOT_EXIST' }), false);
  assert.equal(cache.isRefusedToken([]), false);
  cache.forgetCachedToken(`JWT ${a}`);
  assert.equal(cache.getCachedToken('a@example.com', 'p'), null);
  assert.equal(cache.getCachedToken('b@example.com', 'p').token, b);
  cache.forgetCachedTokenOfScope(cache.getFieldsCacheScope(`JWT ${b}`));
  assert.equal(cache.getCachedToken('b@example.com', 'p'), null);
  // nothing kept: nothing to forget
  tokenCache().forgetCachedToken(`JWT ${a}`);
});

test('js/token_cache.js keeps only an access token and its time, under an HMAC of the credentials with a server secret', () => {
  const code = readProjectFile('js/token_cache.js');
  assert.match(code, /javax\.crypto\.Mac\.getInstance\("HmacSHA256"\)/);
  assert.match(code, /new java\.security\.SecureRandom\(\)\.nextBytes\(secret\)/);
  assert.match(code, /JSON\.stringify\(\{ token: "" \+ token, timestamp: timestamp \}\)/);
  const statements = code.replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(statements, /refresh/i, 'no refresh token');
  assert.doesNotMatch(statements, /\blog\./, 'nothing logged');
  for (const sequence of ['TokenGetOrRefresh', 'TokenGetOrRefreshNative']) {
    const yaml = readSequence(sequence);
    const owner = stepProperty(yaml, 'owner', 'expression');
    assert.match(owner, /include\("js\/jwt\.js"\);\ninclude\("js\/token_cache\.js"\);/, sequence);
    assert.match(owner, /tokenCacheOn = "\$\{lib_baserow\.token_cache=true\}" != "false";/, sequence);
    assert.match(stepProperty(yaml, 'StoreToken', 'expression'), /if \(tokenCacheAccount && tokenText\(tokens\.refreshed\) != "true"\) \{\s*putCachedToken\(email, password, newToken, now\);/, sequence);
  }
});

test('the native read of the fields forgets the token Baserow refuses', () => {
  const parse = stepProperty(readSequence('TableGetDataNative'), 'ParseFields', 'expression');
  const run = (answer) => {
    const forgotten = [];
    const sandbox = { raw_json: 'true', raw_fields: JSON.stringify(answer), cache_scope: 'scope-1', aFields: undefined, JSON, Array,
      log: { warn() {} }, include: (file) => { if (file === 'js/token_cache.js') sandbox.forgetCachedTokenOfScope = (scope) => forgotten.push(scope); } };
    vm.createContext(sandbox);
    vm.runInContext(parse, sandbox);
    return { forgotten, fields: sandbox.aFields };
  };
  assert.deepEqual(run({ detail: 'Access token is expired or invalid.', error: 'ERROR_INVALID_ACCESS_TOKEN' }), { forgotten: ['scope-1'], fields: null });
  assert.deepEqual(run({ error: 'ERROR_TABLE_DOES_NOT_EXIST' }).forgotten, []);
  assert.deepEqual(run([{ id: 1, name: 'Name' }]).forgotten, []);
});

// js/common.js readTableFields with the helpers it uses, the native call replaced
function readTableFields(answer) {
  const common = readProjectFile('js/common.js');
  const helpers = ['readTableFields', 'isJsonArray', 'jsonAnswer', 'callNative'].map((name) => {
    const found = common.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\t\\}`));
    assert.ok(found, name);
    return found[0];
  });
  const calls = [];
  const forgotten = [];
  const sandbox = {
    getFieldsCacheScope: (authorization) => `scope of ${authorization}`,
    call: (requestable, vars) => { calls.push({ requestable, vars }); return answer; },
    org: { w3c: { dom: { Document: function Document() {} } } },
    log: { debug() {} },
    JSON,
  };
  vm.createContext(sandbox);
  vm.runInContext(readProjectFile('js/token_cache.js'), sandbox);
  sandbox.forgetCachedToken = (authorization) => forgotten.push(authorization);
  vm.runInContext(helpers.join('\n'), sandbox);
  return { fields: sandbox.readTableFields('App~>Db~>Table', 'JWT abc'), calls, forgotten };
}

test('readTableFields reads the fields of a table as JSON, without XML, cached for the token of the call', () => {
  const fields = [{ id: 1, name: 'Name', type: 'text', primary: true }, { id: 2, name: 'Status', type: 'single_select',
    select_options: [{ id: 3, value: 'Open', color: 'blue' }] }, { id: 4, name: 'Day', type: 'date', date_include_time: false }];
  const read = readTableFields(JSON.stringify(fields));
  assert.deepEqual(JSON.parse(JSON.stringify(read.fields)), fields);
  assert.deepEqual(JSON.parse(JSON.stringify(read.calls)), [{
    requestable: 'lib_BaseRow.Baserow_API_spec._api_database_fields_table__table_id___GET_raw',
    vars: { __nativeCall: 'true', __header_Authorization: 'JWT abc', table_id: 'App~>Db~>Table', cache_scope: 'scope of JWT abc' },
  }]);
  // a Baserow error or an answer that is not JSON: no fields, as the empty answer of FieldsList
  assert.equal(readTableFields(JSON.stringify({ error: 'ERROR_TABLE_DOES_NOT_EXIST', detail: 'The requested table does not exist.' })).fields, null);
  assert.equal(readTableFields('<html>Bad gateway</html>').fields, null);
  assert.deepEqual(readTableFields(JSON.stringify(fields)).forgotten, []);
  // a token Baserow refuses (401) is no longer handed out to the other sessions
  const refused = readTableFields(JSON.stringify({ detail: 'Access token is expired or invalid.', error: 'ERROR_INVALID_ACCESS_TOKEN' }));
  assert.deepEqual([refused.fields, refused.forgotten], [null, ['JWT abc']]);
  assert.match(readProjectFile('js/common.js'), /^include\("js\/jwt\.js"\);\ninclude\("js\/fields_cache\.js"\);\ninclude\("js\/token_cache\.js"\);\n/);
});

for (const name of ['forms_AddRow', 'forms_AddRowFromData']) {
  test(`${name} reads the fields of its table as JSON, with the Bearer of its check`, () => {
    const yaml = readSequence(name);
    // the classic check: its errors name formscommon_CheckConfig (attr.sequence), as before
    const check = yaml.match(/↓Call_Sequence2 \[steps\.SequenceStep-(\d+)\]: \n  sourceSequence: lib_BaseRow\.(formscommon_CheckConfig\w*)\n/);
    assert.ok(check, name);
    assert.equal(check[2], 'formscommon_CheckConfig');
    // the Bearer of the check, then the fields read with it, before the answers are prepared
    const bearer = yaml.match(/↓fields_authorization \[steps\.SimpleSourceStep-\d+\]: \n[\s\S]*?↑value: (\d+)\n[\s\S]*?↑value: (\S+)\n  variableName: fields_authorization\n/);
    assert.ok(bearer, name);
    assert.deepEqual([bearer[1], bearer[2]], [check[1], './document/Bearer/text()']);
    const read = stepProperty(yaml, 'ReadFields', 'expression');
    assert.equal(read, 'include("js/common.js");\njFields = readTableFields(table_id, fields_authorization);\nfields_authorization = null;');
    const prepare = yaml.indexOf('↓PrepareData [');
    assert.ok(yaml.indexOf('↓ReadFields [') < prepare && yaml.indexOf('↓fields_authorization [') < prepare);
    assert.match(stepProperty(yaml, 'PrepareData', 'expression'), /jFields\.find\(\(object\) => object\.name === key \)/);
    // FieldsList stays only for the read after columns were created
    assert.equal((yaml.match(/sourceSequence: lib_BaseRow\.FieldsList\n/g) || []).length, 1);
    assert.ok(yaml.indexOf('sourceSequence: lib_BaseRow.FieldsList') > yaml.indexOf('sourceSequence: lib_BaseRow.TableCreateColumn'));
  });
}

test('formscommon_CheckConfig reads the revision of the form by _all_docs and keeps its configurations for the server', () => {
  const classic = readSequence('formscommon_CheckConfig');
  const native = readSequence('formscommon_CheckConfigNative');
  assert.doesNotMatch(classic, /HeadDocument/);
  assert.match(stepProperty(classic, 'ParseConfig', 'expression'), /\nrevCached = false;\n/);
  // the same light copy of the form as the native check, by revision, in the same store
  assert.equal(stepProperty(classic, 'FormRevCacheLookup', 'expression'), stepProperty(native, 'FormRevCacheLookup', 'expression'));
  assert.match(classic, /↓IfOwnerConfigCheck \[steps\.IfStep-\d+\]: \n  condition: '!publishedSourceAuthorized && !configCached && !revCached'\n/);
  const order = ['↓FormRev [', '↓ConfigCacheLookup [', '↓FormRevCacheLookup [', '↓IfOwnerConfigCheck ['].map((header) => classic.indexOf(header));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(order[0] > classic.indexOf('↓IfOwnerConfigCacheLookup ['));
  const rev = stepProperty(classic, 'FormRev ', 'expression');
  const revOf = (docId, rows) => {
    const queries = [];
    class HashMap { constructor() { this.m = {}; } put(k, v) { this.m[k] = v; } }
    const scope = { _use_docid: docId, form_rev: undefined, theApp: { couchDbManager: { getFullSyncClient: () => ({
      getAllDocs: (db, query) => { queries.push([db, query.m]); return JSON.stringify({ rows }); } }) } }, java: { util: { HashMap } } };
    new Function('scope', `with (scope) { ${rev} }`)(scope);
    return { rev: scope.form_rev, queries };
  };
  const read = revOf('a@b.c_1_"2', [{ id: 'a@b.c_1_"2', key: 'a@b.c_1_"2', value: { rev: '3-abc' } }]);
  assert.deepEqual(read, { rev: '3-abc', queries: [['c8oforms_fs', { key: JSON.stringify('a@b.c_1_"2') }]] });
  assert.equal(revOf('f', [{ id: 'f', key: 'f', value: { rev: '4-def', deleted: true } }]).rev, null, 'a deleted form, as the HEAD that answered 404');
  assert.equal(revOf('f', [{ key: 'f', error: 'not_found' }]).rev, null, 'a missing form');
  assert.equal(revOf('f', []).rev, null);
});

// FormRev and FormRevCacheLookup of a check run on a form held by a fake CouchDB: the revision of _all_docs (null for a
// deleted form), the reads of the whole form counted
function revCheck(sequence) {
  const yaml = readSequence(sequence);
  const lookup = stepProperty(yaml, 'FormRevCacheLookup', 'expression').replace('"${lib_baserow.form_rev_cache=true}"', '"true"');
  const rev = sequence === 'formscommon_CheckConfig' ? stepProperty(yaml, 'FormRev ', 'expression') : null;
  const project = new Map();
  const fake = { doc: null, deleted: false, down: false, reads: 0, warnings: [] };
  class JMap { constructor() { this.m = new Map(); } get(k) { return this.m.has(k) ? this.m.get(k) : null; } put(k, v) { this.m.set(k, v); }
    putIfAbsent(k, v) { if (this.m.has(k)) return this.m.get(k); this.m.set(k, v); return null; } remove(k) { this.m.delete(k); } size() { return this.m.size; } }
  class Lock { tryLock() { return true; } unlock() {} }
  const java = { util: { HashMap: JMap, concurrent: { ConcurrentHashMap: JMap, TimeUnit: { SECONDS: 's' }, locks: { ReentrantLock: Lock } } } };
  const theApp = { couchDbManager: { getFullSyncClient: () => ({
    getDocument: () => { fake.reads++; return JSON.stringify(fake.doc); },
    getAllDocs: (db, query) => {
      if (fake.down) throw new Error('Connection refused: http://couchdb:5984/c8oforms_fs/_all_docs');
      const value = fake.deleted ? { rev: fake.doc._rev, deleted: true } : { rev: fake.doc._rev };
      return JSON.stringify({ rows: [{ id: fake.doc._id, key: JSON.parse(query.get('key')), value }] });
    },
  }) } };
  const context = { project: { get: (k) => project.get(k) || null, set: (k, v) => project.set(k, v) } };
  const log = { warn: (text) => fake.warnings.push(text) };
  const run = (sourceId, config, formRev) => {
    const scope = { configCached: false, form_rev: formRev, _use_docid: 'f1', source_id: sourceId, forms_config: config, revCached: false,
      doc_forms_config: null, doc_forms_config_markers: null, doc_forms_config_circles: null, doc_forms_config_polygons: null };
    if (rev != null) {
      new Function('scope', 'java', 'theApp', 'log', `with (scope) { ${rev} }`)(scope, java, theApp, log);
    }
    new Function('scope', 'context', 'java', 'theApp', 'log', `with (scope) { ${lookup} }`)(scope, context, java, theApp, log);
    return scope;
  };
  return { fake, run, store: () => project.get('form_rev_configs') };
}

for (const sequence of ['formscommon_CheckConfig', 'formscommon_CheckConfigNative']) {
  test(`${sequence}: a configuration found by many elements is kept once, and a copy above 256 KB is not kept`, () => {
    const check = revCheck(sequence);
    // 200 elements nested in the sources of each other: each of them finds the configuration of the deepest one
    const nested = (config) => {
      let item = { id: 200, sources: { x: { vars: { forms_config: { str: config } } } } };
      for (let id = 199; id >= 1; id--) item = { id, sources: { wrap: [item] } };
      return { _id: 'f1', _rev: '1-a', flows: [{ elements: [item] }] };
    };
    const config = 'c'.repeat(100 * 1024);
    check.fake.doc = nested(config);
    assert.equal(check.run(1, config, '1-a').revCached, true);
    assert.equal(check.run(150, config, '1-a').doc_forms_config, config);
    assert.equal(check.fake.reads, 1, 'one read for the revision');
    const text = check.store().get('f1|1-a');
    assert.ok(text.length < config.length + 10 * 1024, `${text.length} characters: the configuration is not repeated for its 200 elements`);
    // a copy above 256 KB: used for its call, not kept, the next call reads the form again
    const long = 'l'.repeat(300 * 1024);
    check.fake.doc = { ...nested(long), _rev: '2-b' };
    assert.equal(check.run(1, long, '2-b').revCached, true);
    assert.equal(check.run(2, long, '2-b').revCached, true);
    assert.equal(check.fake.reads, 3);
    assert.equal(check.store().get('f1|2-b'), null);
  });
}

test('formscommon_CheckConfig: the kept copy decides only a matching configuration of the checked revision', () => {
  const check = revCheck('formscommon_CheckConfig');
  const form = (rev, config) => ({ _id: 'f1', _rev: rev, flows: [{ elements: [{ id: 1, type: 'submit',
    actions: { 'lib_BaseRow.forms_AddRow': { enabled: true, vars: { forms_config: { str: config } } } } }] }] });
  check.fake.doc = form('3-a', 'cfg-1');
  const first = check.run(1, 'cfg-1');
  assert.deepEqual([first.form_rev, first.revCached, first.doc_forms_config], ['3-a', true, 'cfg-1']);
  // a mismatch (another configuration, another source): the whole check, which answers its error (code 7)
  assert.equal(check.run(1, 'other').revCached, false);
  assert.equal(check.run(9, 'cfg-1').revCached, false);
  // the form saved with a changed configuration: the old one takes the whole check, the new one is read once
  check.fake.doc = form('4-b', 'cfg-1b');
  assert.deepEqual([check.run(1, 'cfg-1').form_rev, check.run(1, 'cfg-1').revCached], ['4-b', false]);
  assert.equal(check.run(1, 'cfg-1b').revCached, true);
  assert.equal(check.fake.reads, 2);
  // a deleted form: no revision, no kept copy used, the whole check answers as before
  check.fake.deleted = true;
  const deleted = check.run(1, 'cfg-1b');
  assert.deepEqual([deleted.form_rev, deleted.revCached], [null, false]);
  // CouchDB down: no revision and a warning, never an exception of the engine (the whole check answers its error)
  check.fake.down = true;
  const down = check.run(1, 'cfg-1b');
  assert.deepEqual([down.form_rev, down.revCached], [null, false]);
  assert.match(check.fake.warnings.join('\n'), /the revision of the form f1 could not be read, the form is checked whole/);
  assert.equal(check.fake.reads, 2);
});

test('TableCreateRows reads its import job again after 100 ms, then twice the wait up to 1 second', () => {
  const yaml = readSequence('TableCreateRows');
  const sleeps = [];
  const sandbox = { java: { lang: { Thread: { sleep: (ms) => sleeps.push(ms) } } }, log: { warn() {} }, Math, state: 'pending' };
  vm.createContext(sandbox);
  vm.runInContext(stepProperty(yaml, 'PollDelay', 'expression'), sandbox);
  for (let i = 0; i < 7; i++) {
    vm.runInContext(stepProperty(yaml, 'Sleep15Sec', 'expression'), sandbox);
  }
  assert.deepEqual(sleeps, [100, 200, 400, 800, 1000, 1000, 1000]);
  // the same loop: it ends only on a finished job (or no state), the answer is the job started
  assert.match(yaml, /↓PollDelay \[steps\.SimpleStep-\d+\]: \n(?:  .*\n)*?↓jWhile \[steps\.WhileStep-\d+\]: \n  condition: state != "finished" && state != "null" && state != null\n/);
});
