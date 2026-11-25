// The native reads of a source: the grid stream without a probe page, the revision of the form by _all_docs, and the
// Baserow account of the owner kept in the session per revision.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readSequence, readProjectFile, stepProperty } = require('./read-yaml-steps.cjs');

const tableJson = readSequence('formssource_GetTableData');
const checkConfig = readSequence('formscommon_CheckConfigNative');

test('a streamed grid reads a full first page, then its next pages in stream after its rows', () => {
  const decide = stepProperty(tableJson, 'StreamFirstRow', 'expression');
  assert.doesNotMatch(decide, /size = "1"/, 'no page of one row before the stream');
  assert.match(decide, /streamPageSize = null;/, 'the stream does not read the first page again');
  const stream = tableJson.slice(tableJson.indexOf('↓object [steps.JsonStreamRowsStep'));
  assert.match(stream, /\n {2}rows: results\n/);
  assert.match(stream, /\n {2}firstPage: page\n/);
  assert.match(stream, /\n {2}nextUrl: streamNextUrl\n/);
  assert.match(stream, /\n {2}restartPageSize: streamPageSize\n/);
});

test('the revision of the form comes from _all_docs?key, without reading the document', () => {
  const connector = readProjectFile('_c8oProject/connectors/c8oforms_fs.yaml');
  assert.match(connector, /↓RevDocument \[transactions\.couchdb\.AllDocsTransaction\]: \n {2}accessibility: Private\n/);
  assert.match(connector, /↓RevDocument[^↓]*↓_use_key \[variables\.RequestableVariable-\d+\]/);
  assert.match(checkConfig, /sourceTransaction: lib_BaseRow\.c8oforms_fs\.RevDocument/);
  assert.doesNotMatch(checkConfig, /HeadDocument/);
  const unquote = (text) => (text.startsWith("'") && text.endsWith("'") ? text.slice(1, -1).replace(/''/g, "'") : text);
  const key = unquote(stepProperty(checkConfig, 'FormRevKey', 'expression'));
  const scope = { _use_docid: 'a@b.c_1_"2', _use_key: null };
  new Function('scope', `with (scope) { ${key} }`)(scope);
  assert.equal(scope._use_key, JSON.stringify('a@b.c_1_"2'), 'a JSON string, kept as is by AllDocsTransaction');
  const rev = unquote(stepProperty(checkConfig, 'FormRev ', 'expression'));
  const revOf = (formRevRow) => {
    const s = { formRevRow, form_rev: undefined };
    new Function('scope', `with (scope) { ${rev} }`)(s);
    return s.form_rev;
  };
  assert.equal(revOf({ rev: '3-abc' }), '3-abc');
  assert.equal(revOf({ rev: '4-def', deleted: true }), null, 'a deleted form: no revision, as the HEAD that answered 404');
  assert.equal(revOf(null), null, 'a missing form (row with error not_found)');
});

// the callSequenceNative helper of AuthorizeSourceOwner
function nativeCallHelper() {
  const authorize = stepProperty(checkConfig, 'AuthorizeSourceOwner', 'expression');
  const helper = authorize.match(/\nvar callSequenceNative = function[\s\S]*?\n};/);
  assert.ok(helper, 'AuthorizeSourceOwner defines callSequenceNative');
  return helper[0];
}

class JMap {
  constructor() { this.m = new Map(); }
  put(k, v) { this.m.set(k, v); }
  get(k) { return this.m.get(k); }
  entrySet() {
    const entries = [...this.m.entries()];
    let i = 0;
    return { iterator: () => ({ hasNext: () => i < entries.length, next: () => { const [k, v] = entries[i++]; return { getKey: () => k, getValue: () => v }; } }) };
  }
}

// AuthorizeSourceOwner with the Java objects it uses replaced: the published read of a respondent calls
// C8Oforms.BaserowPublishedSourceAuthorize natively (__nativeCall), so the engine runs it in the thread of the source
test('the published read authorization is a native call, run in the thread of the source', () => {
  const code = stepProperty(checkConfig, 'AuthorizeSourceOwner', 'expression');
  assert.ok(code.indexOf('var callSequenceNative = function') < code.indexOf('callSequenceNative("C8Oforms", "BaserowPublishedSourceAuthorize"'),
    'the helper is defined before the call');
  assert.doesNotMatch(code, /callSequence\("C8Oforms", "BaserowPublishedSourceAuthorize"/);
  assert.doesNotMatch(stepProperty(checkConfig, 'CallSequenceFormsWithoutReferences', 'expression'), /var callSequenceNative = function/,
    'one definition, in the first step that calls natively');
  const calls = [];
  const answer = (allowed, scope) => class {
    constructor(parameters) { this.parameters = parameters; }
    processRequest() {
      calls.push(this.parameters);
      const result = new JMap();
      result.put('allowed', allowed);
      result.put('scope_filter', scope);
      return result;
    }
    getContext() { return null; }
  };
  const run = (Requester, kind) => {
    const scope = {
      include() {}, owner: 'author', source_kind: kind, _use_docid: 'published_42', forms_config: '{}', read_params: '{}',
      forms_anonymous_key: '', context: { getAuthenticatedUser: () => 'respondent', httpServletRequest: null, logParameters: '' },
      theApp: { contextManager: { remove() {} } }, org: { apache: { log4j: { MDC: { put() {} } } } },
      java: { util: { HashMap: JMap, Map: JMap, UUID: { randomUUID: () => 'u' } }, lang: { String, CharSequence: String,
        reflect: { Array: { newInstance: () => [] } } } },
      com: { twinsoft: { convertigo: { engine: { requesters: { InternalRequester: Requester } } } } },
      callSequence: () => { throw new Error('the read authorization must be a native call'); },
    };
    new Function('scope', `with (scope) { ${code}\n scope.out = { sourceOwnerAuthorized, publishedReadScope }; }`)(scope);
    return scope.out;
  };
  const granted = run(answer('true', '{"mode":"AND","filters":[]}'), 'formssource_GetTableData');
  assert.equal(granted.sourceOwnerAuthorized, true);
  assert.equal(granted.publishedReadScope, '{"mode":"AND","filters":[]}');
  const sent = calls[0];
  assert.equal(sent.get('__sequence'), 'BaserowPublishedSourceAuthorize');
  assert.equal(sent.get('__nativeCall'), 'true');
  assert.equal(sent.get('__context'), 'syncContext_u');
  assert.equal(sent.get('source_kind'), 'formssource_GetTableData');
  assert.equal(run(answer('false', ''), 'formssource_GetTableData').sourceOwnerAuthorized, false);
  assert.equal(run(answer('true', ''), 'formssource_GetTableData').sourceOwnerAuthorized, false, 'a read without scope is refused');
  const failing = class { processRequest() { throw new Error('down'); } getContext() { return null; } };
  assert.equal(run(failing, 'formssource_GetTableData').sourceOwnerAuthorized, false, 'an error refuses');
});

// CallSequenceFormsWithoutReferences with the Java objects it uses replaced
function accountRunner(options) {
  // callSequenceNative is defined by AuthorizeSourceOwner, the first step that calls natively, for the next steps
  const code = nativeCallHelper() + '\n' + stepProperty(checkConfig, 'CallSequenceFormsWithoutReferences', 'expression')
    .replace('"${lib_baserow.account_cache=true}"', JSON.stringify(options.cache ? 'true' : 'false'));
  const state = options.state;
  const java = {
    util: { HashMap: JMap, Map: JMap, UUID: { randomUUID: () => 'uuid-' + Math.random().toString(16).slice(2) } },
    lang: { String: String, CharSequence: String, System: { currentTimeMillis: () => 1 },
      reflect: { Array: { newInstance: () => [] } } },
  };
  const com = { twinsoft: { convertigo: { engine: {
    util: { Crypto2: { encodeToHexString: (t) => 'enc:' + t, decodeFromHexString: (t) => t.replace(/^enc:/, '') } },
    requesters: { InternalRequester: class {
      constructor(parameters) { this.parameters = parameters; }
      processRequest() {
        state.accountReads++;
        const answer = new JMap();
        for (const [k, v] of Object.entries(state.account)) answer.put(k, v);
        return answer;
      }
      getContext() { return null; }
    } },
  } } } };
  const theApp = {
    contextManager: { remove() {} },
    couchDbManager: { getFullSyncClient: () => ({ getAllDocs: (db, query) => {
      state.revReads++;
      const keys = JSON.parse(query.m.get('keys'));
      return JSON.stringify({ rows: keys.map((key) => state.revs[key] ? { key, id: key, value: state.revs[key] } : { key, error: 'not_found' }) });
    } }) },
  };
  const session = state.session;
  const context = { httpServletRequest: null, logParameters: '', httpSession: {
    getAttribute: (k) => session.get(k) ?? null, setAttribute: (k, v) => session.set(k, v), removeAttribute: (k) => session.delete(k) } };
  const org = { apache: { log4j: { MDC: { put() {}, remove() {} } } } };
  const log = { warn() {}, debug() {} };
  const run = new Function('java', 'com', 'theApp', 'context', 'org', 'log', 'owner', '_use_docid', 'enums', 'XmlToJson', 'toJSON',
    code + '\nreturn { email: email, password: password, error: callSequenceForms.document.error };');
  return () => run(java, com, theApp, context, org, log, options.owner, options.form, {}, null, null);
}

test('the account of the owner is kept in the session while the form, the user and the account keep their revisions', () => {
  const state = { session: new Map(), accountReads: 0, revReads: 0,
    account: { email: 'owner@x', password: 'p1', user_id: 'u1' },
    revs: { form1: { rev: '1-f' }, u1: { rev: '1-u' }, u1_baserow: { rev: '1-a' } } };
  const call = accountRunner({ cache: true, state, owner: 'owner@x', form: 'form1' });
  assert.deepEqual(call(), { email: 'owner@x', password: 'p1', error: undefined });
  assert.equal(state.accountReads, 1, 'the first call reads the account, with no revisions to keep');
  call();
  assert.equal(state.accountReads, 2, 'the second one reads it after the revisions');
  assert.deepEqual(call(), { email: 'owner@x', password: 'p1', error: undefined });
  assert.equal(state.accountReads, 2, 'then it comes from the session');
  assert.ok(![...state.session.values()].some((v) => v.includes('"p1"')), 'the password is kept ciphered');
  // each change of a revision reads the account at once
  for (const [id, rev] of [['u1_baserow', '2-a'], ['u1', '2-u'], ['form1', '2-f']]) {
    state.revs[id] = { rev };
    state.account.password = 'p-' + rev;
    const reads = state.accountReads;
    assert.equal(call().password, 'p-' + rev, `${id} changed`);
    assert.equal(state.accountReads, reads + 1);
  }
  // an account removed: never served from the session
  delete state.revs.u1_baserow;
  state.account = { error: { code: 2, message: 'no password found for the current user' } };
  const removed = call();
  assert.equal(removed.password, undefined);
  assert.ok(removed.error);
  assert.equal(state.session.size, 0);
});

test('the account is kept by default, and not when lib_baserow.account_cache is false', () => {
  assert.match(stepProperty(checkConfig, 'CallSequenceFormsWithoutReferences', 'expression'),
    /"\$\{lib_baserow\.account_cache=true\}" != "false"/);
  const state = { session: new Map(), accountReads: 0, revReads: 0,
    account: { email: 'owner@x', password: 'p1', user_id: 'u1' }, revs: {} };
  const call = accountRunner({ cache: false, state, owner: 'owner@x', form: 'form1' });
  call(); call(); call();
  assert.equal(state.accountReads, 3);
  assert.equal(state.revReads, 0);
  assert.equal(state.session.size, 0);
});

test('the configurations of a form revision are kept by default, and not when lib_baserow.form_rev_cache is false', () => {
  const lookup = stepProperty(checkConfig, 'FormRevCacheLookup', 'expression');
  assert.match(lookup, /"\$\{lib_baserow\.form_rev_cache=true\}" != "false"/);
  assert.doesNotMatch(checkConfig, /form_rev_cache=false/);
});


// A native sequence called by a native one answers JSON: an XML copy of its answer (./document/error) finds nothing, the
// error is lost and the source answers an empty document ({"text":""}). The errors are output from the JSON read.
test('no native sequence copies the answer of a native call as XML', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const folder = path.join(__dirname, '../../_c8oProject/sequences');
  const files = fs.readdirSync(folder).filter((name) => name.endsWith('.yaml'));
  const nativeNames = files.filter((name) => /^nativeExecution: true$/m.test(fs.readFileSync(path.join(folder, name), 'utf8')))
    .map((name) => name.replace(/\.yaml$/, ''));
  const wrong = [];
  for (const name of nativeNames) {
    const lines = fs.readFileSync(path.join(folder, `${name}.yaml`), 'utf8').split('\n');
    const steps = new Map();
    lines.forEach((line, index) => {
      const header = /^\s*↓(\S+) \[steps\.(\w+)-(\d+)\]:/.exec(line);
      if (header) steps.set(header[3], { name: header[1], kind: header[2], index });
    });
    for (const step of steps.values()) {
      if (step.kind !== 'XMLCopyStep') continue;
      const source = lines.slice(step.index + 1, step.index + 12).join('\n').match(/↑value: (\d{12,14})/);
      const called = source && steps.get(source[1]);
      if (!called) continue;
      const block = lines.slice(called.index, called.index + 4).join('\n');
      const target = /sourceSequence: lib_BaseRow\.(\w+)/.exec(block);
      if (called.kind === 'JsonToXmlStep' || (target && nativeNames.includes(target[1]))) {
        wrong.push(`${name}: ${step.name} copies ${called.name}`);
      }
    }
  }
  assert.deepEqual(wrong, []);
  // the error of the account of the owner is output as is
  const check = readSequence('formscommon_CheckConfigNative');
  const accountError = check.slice(check.indexOf('↓object [steps.JsonToXmlStep-1995000000029]'), check.indexOf('↓Return [steps.ReturnStep-1995000000031]'));
  assert.doesNotMatch(accountError, /output: false/);
});

// The owner check reads a form once per revision for the server: a light copy keeps, for every element, the
// configurations FormSourceConfigs finds for it, and each source is checked against it.
const formSample = { _id: 'f1', _rev: '3-a', formulaire: [
  { id: 1, sources: { 'lib_BaseRow.formssource_GetTableData': { vars: { forms_config: { str: 'cfg-1' } } } }, children: [
    { id: 2, sourcesMarkers: { a: { vars: { forms_config: { str: 'markers-2' } } } }, sourcesPolygons: [{ vars: { forms_config: { str: 'poly-2' } } }] },
    { id: 3, actions: { x: { forms_config: { str: 'action-3' } } } },
  ] },
  { id: 2, sources: { b: { vars: { forms_config: { str: 'cfg-2-later' } } } } },
  { id: 4, sourcesCircles: { c: { vars: { forms_config: { str: 'circles-4' } } } }, sources: { d: { vars: { forms_config: { str: 'cfg-4' } } } } },
  { id: 5, title: 'no source' },
] };

function checkConfigFunctions() {
  const yaml = readSequence('formscommon_CheckConfigNative');
  const lookup = stepProperty(yaml, 'FormRevCacheLookup', 'expression');
  const light = new Function(lookup.slice(lookup.indexOf('var formRevLight = function'), lookup.indexOf('var formRevKey')) + 'return formRevLight;')();
  const configs = stepProperty(yaml, 'FormSourceConfigs [steps.SimpleStep-1995000000016]', 'expression');
  const find = new Function(configs.slice(0, configs.indexOf('var formDocument = ')) + 'return findFormsConfig;')();
  return { lookup, light, find };
}

test('the light copy of a form gives each source the configurations of the whole form', () => {
  const { light, find } = checkConfigFunctions();
  const copy = JSON.parse(JSON.stringify(light(JSON.parse(JSON.stringify(formSample)))));
  // each configuration once, the elements give its index
  const of = (id) => (copy.sources[id] || [null, null, null, null]).map((index) => (index == null ? null : copy.configs[index]));
  const sets = [['sources', 'sourcesMarkers', 'sourcesCircles', 'actions'], ['sourcesMarkers'], ['sourcesCircles'], ['sourcesPolygons']];
  for (const id of ['1', '2', '3', '4', '5', '9']) {
    const expected = sets.map((names) => find(formSample, id, names));
    assert.deepEqual(of(id), expected, `source ${id}`);
  }
  assert.deepEqual(of('2'), ['markers-2', 'markers-2', null, 'poly-2'], 'the first element with this id that has the configuration');
  assert.equal(new Set(copy.configs).size, copy.configs.length, 'no configuration twice');
});

test('the form is read once per revision for every source, and read again when it is saved', () => {
  const { lookup } = checkConfigFunctions();
  const store = new Map();
  let reads = 0;
  let current = JSON.parse(JSON.stringify(formSample));
  class JMap { constructor() { this.m = new Map(); } get(k) { return this.m.has(k) ? this.m.get(k) : null; } put(k, v) { this.m.set(k, v); }
    putIfAbsent(k, v) { if (this.m.has(k)) return this.m.get(k); this.m.set(k, v); return null; } remove(k) { this.m.delete(k); } size() { return this.m.size; } }
  class Lock { tryLock() { return true; } unlock() {} }
  const java = { util: { HashMap: JMap, concurrent: { ConcurrentHashMap: JMap, TimeUnit: { SECONDS: 's' }, locks: { ReentrantLock: Lock } } } };
  const theApp = { couchDbManager: { getFullSyncClient: () => ({ getDocument: (db, id) => { reads++; assert.equal(db, 'c8oforms_fs'); return JSON.stringify(current); } }) } };
  const code = lookup.replace('"${lib_baserow.form_rev_cache=true}"', '"true"');
  const run = (sourceId, config, rev) => {
    const scope = { configCached: false, form_rev: rev, _use_docid: 'f1', source_id: sourceId, forms_config: config, revCached: false,
      doc_forms_config: null, doc_forms_config_markers: null, doc_forms_config_circles: null, doc_forms_config_polygons: null };
    new Function('scope', 'context', 'java', 'theApp', 'log', `with (scope) { ${code} }`)(scope,
      { project: { get: (k) => store.get(k) || null, set: (k, v) => store.set(k, v) } }, java, theApp, { warn() {} });
    return scope;
  };
  // the sources of a page: one read of the form
  assert.equal(run(1, 'cfg-1', '3-a').revCached, true);
  // the element 4 has its circles before its sources: the first configuration found is the one of its circles
  assert.equal(run(4, 'circles-4', '3-a').doc_forms_config, 'circles-4');
  assert.equal(run(2, 'markers-2', '3-a').doc_forms_config_polygons, 'poly-2');
  assert.equal(reads, 1);
  // a missing source or a changed configuration takes the whole check, as before
  assert.equal(run(9, 'cfg-9', '3-a').revCached, false);
  assert.equal(run(1, 'changed', '3-a').revCached, false);
  assert.equal(reads, 1);
  // a save of the form: a new revision, read again
  current = { ...current, _rev: '4-b' };
  assert.equal(run(1, 'cfg-1', '4-b').revCached, true);
  assert.equal(reads, 2);
});
