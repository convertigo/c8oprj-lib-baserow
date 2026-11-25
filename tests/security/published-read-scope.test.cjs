const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.join(__dirname, '../../js/published_read_scope.js'), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const bind = sandbox.bindPublishedReadScope;
const scope = JSON.stringify({ mode: 'AND', filters: [{ field: 'Visibility', op: 'equal', value: 'public' }] });

test('client OR remains inside a mandatory server AND', () => {
  const client = JSON.stringify({ mode: 'OR', filters: [
    { field: 'Name', op: 'equal', value: 'Ada' },
    { field: 'Name', op: 'equal', value: 'Bob' },
  ] });
  const result = JSON.parse(bind(scope, client));
  assert.equal(result.mode, 'AND');
  assert.equal(result.filters.length, 2);
  assert.equal(result.filters[0].filters[0].value, 'public');
  assert.equal(result.filters[1].mode, 'OR');
});

test('empty client filter cannot remove the server scope', () => {
  const result = JSON.parse(bind(scope, JSON.stringify({ mode: 'AND', filters: [] })));
  assert.equal(result.mode, 'AND');
  assert.equal(result.filters.length, 1);
  assert.equal(result.filters[0].filters[0].value, 'public');
});

test('a Java String client filter still refines the mandatory server scope', () => {
  const client = JSON.stringify({ mode: 'AND', filters: [
    { field: 'Name', op: 'equal', value: 'no-such-row' },
  ] });
  const result = JSON.parse(bind(scope, new String(client)));
  assert.equal(result.filters.length, 2);
  assert.equal(result.filters[0].filters[0].value, 'public');
  assert.equal(result.filters[1].filters[0].value, 'no-such-row');
});

test('a Java String published search stays inside the mandatory scope', () => {
  const result = JSON.parse(bind(scope, '', 'Name', new String('missing')));
  assert.deepEqual(result.filters[1], { field: 'Name', op: 'contains', value: 'missing' });
});

test('published search is a display-column filter inside the server AND', () => {
  const result = JSON.parse(bind(scope, '', 'Name', 'private note'));
  assert.equal(result.mode, 'AND');
  assert.equal(result.filters[0].filters[0].value, 'public');
  assert.deepEqual(result.filters[1], { field: 'Name', op: 'contains', value: 'private note' });
  assert.throws(() => bind(scope, '', 'Name', 'x'.repeat(129)));
  assert.equal(bind('', ''), '');
});

test('client groups normalize into the nested filter shape used by TableGetData', () => {
  const client = JSON.stringify({ mode: 'AND', filters: [], groups: [
    { mode: 'OR', filters: [{ field: 'Name', op: 'equal', value: 'Ada' }] },
  ] });
  const result = JSON.parse(bind(scope, client));
  assert.equal(result.filters[1].filters[0].mode, 'OR');
  assert.equal(result.filters[1].groups, undefined);
});

test('malformed scope and client JSON fail closed', () => {
  assert.throws(() => bind('{bad', ''));
  assert.throws(() => bind(scope, '{bad'));
  assert.throws(() => bind(JSON.stringify({ mode: 'OR', filters: [] }), ''));
  assert.throws(() => bind('', '', null, null, true), /missing mandatory published scope/);
});

test('raw Baserow rows and field schema are never copied to source output', () => {
  for (const name of ['formssource_GetTableData', 'formssource_GetSelectData', 'formssource_GetFieldValues']) {
    const yaml = fs.readFileSync(path.join(__dirname, '../../_c8oProject/sequences', `${name}.yaml`), 'utf8');
    const lines = yaml.split(/\r?\n/);
    let checked = 0;
    for (let i = 1; i < lines.length; i++) {
      if (/sourceSequence: lib_BaseRow\.(TableGetDataNative|FieldsList)$/.test(lines[i].trim())) {
        assert.equal(lines[i - 1].trim(), 'output: false', `${name}:${i + 1}`);
        checked++;
      }
    }
    assert.ok(checked > 0, `${name} has a raw data call`);
  }
});

test('published source responses hide the owner token and carry the mandatory scope', () => {
  const sequenceDir = path.join(__dirname, '../../_c8oProject/sequences');
  const common = fs.readFileSync(path.join(sequenceDir, 'formscommon_CheckConfig.yaml'), 'utf8');
  assert.match(common, /↓published_scope_filter \[steps\.ElementStep-\d+\]:\s+expression: publishedReadScope\s+nodeName: published_scope_filter/);
  assert.match(common, /↓Call_Sequence3 \[steps\.SequenceStep-\d+\]:\s+output: false\s+sourceSequence: lib_BaseRow\.TokenGetOrRefresh/);
  for (const name of ['formssource_GetTableData', 'formssource_GetSelectData', 'formssource_GetFieldValues']) {
    const yaml = fs.readFileSync(path.join(sequenceDir, `${name}.yaml`), 'utf8');
    assert.match(yaml, /↓Call_Sequence\d* \[steps\.SequenceStep-\d+\]:\s+output: false\s+sourceSequence: lib_BaseRow\.formscommon_CheckConfig/, name);
  }
});

test('a Java String step variable reaches the published source authorization', () => {
  const common = fs.readFileSync(path.join(__dirname, '../../_c8oProject/sequences/formscommon_CheckConfig.yaml'), 'utf8');
  const block = common.match(/↓AuthorizeSourceOwner \[steps\.SimpleStep-\d+\]:\s+expression: \|\n([\s\S]*?)\n↓published_scope_filter/);
  assert.ok(block, 'authorization script should be present');
  let script = block[1].split('\n').map((line) => line.replace(/^    /, '')).join('\n').trim();
  assert.equal(script.at(0), "'");
  assert.equal(script.at(-1), "'");
  script = script.slice(1, -1).replace(/''/g, "'");

  let called = false;
  const sandbox = {
    include: () => {},
    owner: 'author',
    source_kind: new String('formssource_GetTableData'),
    _use_docid: 'published_42_anonymous',
    forms_config: '{}',
    read_params: '{}',
    forms_anonymous_key: 'capability',
    context: { getAuthenticatedUser: () => 'respondent' },
    callSequence: (_project, _sequence, args) => {
      called = true;
      assert.equal(args.source_kind, 'formssource_GetTableData');
      return { document: { allowed: 'true', scope_filter: scope } };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  assert.equal(called, true);
  assert.equal(sandbox.publishedSourceAuthorized, true);
  assert.equal(sandbox.sourceOwnerAuthorized, true);
  assert.equal(sandbox.publishedReadScope, scope);
});

test('an unbounded published source keeps only the validated client filter and search', () => {
  const unbounded = JSON.stringify({ unbounded: true });
  assert.equal(bind(unbounded, '', null, null, true), '');
  const client = JSON.stringify({ mode: 'OR', filters: [{ field: 'Name', op: 'equal', value: 'Ada' }] });
  assert.deepEqual(JSON.parse(bind(unbounded, client, null, null, true)),
    { mode: 'AND', filters: [{ mode: 'OR', filters: [{ field: 'Name', op: 'equal', value: 'Ada' }] }] });
  assert.deepEqual(JSON.parse(bind(unbounded, '', 'Name', 'Ada', true)),
    { mode: 'AND', filters: [{ field: 'Name', op: 'contains', value: 'Ada' }] });
  assert.throws(() => bind(JSON.stringify({ unbounded: true, filters: [] }), '', null, null, true));
  assert.throws(() => bind(JSON.stringify({ unbounded: 'true' }), '', null, null, true));
});
