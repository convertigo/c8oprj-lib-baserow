// The row condition of a respondent write (C8Oforms js/action_access.js): formscommon_CheckConfig answers the column of
// the condition, and forms_AddRow, forms_AddRowFromData and forms_DeleteRow ask formscommon_CheckRow before they change or
// delete a row. formscommon_CheckRow reads the row with the account of the source and C8Oforms decides.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readSequence, readProjectFile, stepProperty } = require('./read-yaml-steps.cjs');

const rowRule = readProjectFile('js/row_rule.js');
const written = (data, column, fields) => {
  const sandbox = {};
  vm.runInNewContext(rowRule, sandbox);
  const out = sandbox.rowRuleWritten(data, column, fields);
  return out == null ? null : JSON.parse(out);
};

test('the texts a write puts in the column of the condition', () => {
  const fields = [
    { id: 1, name: 'Organizer', type: 'email' },
    { id: 2, name: 'Status', type: 'single_select', select_options: [{ id: 11, value: 'Draft' }, { id: 12, value: 'Sent' }] },
    { id: 3, name: 'Teams', type: 'multiple_select', select_options: [{ id: 21, value: 'Blue' }, { id: 22, value: 'Red' }] },
  ];
  assert.deepEqual(written(JSON.stringify({ Organizer: ' ada@example.test ' }), 'Organizer', fields), ['ada@example.test']);
  // the column is found without case, a select id becomes its option value
  assert.deepEqual(written({ status: 12 }, 'Status', fields), ['Sent']);
  assert.deepEqual(written({ Teams: [21, '22'] }, 'Teams', fields), ['Blue', 'Red']);
  // an unknown id stays as it is (it then matches no allowed value)
  assert.deepEqual(written({ Status: 99 }, 'Status', fields), ['99']);
  // the fields as the JSON of FieldsList: one field alone, options alone
  assert.deepEqual(written({ Status: 11 }, 'Status', { name: 'Status', type: 'single_select', select_options: { id: 11, value: 'Draft' } }), ['Draft']);
  // a cleared column writes nothing: C8Oforms refuses a condition on the user then
  assert.deepEqual(written({ Organizer: '' }, 'Organizer', fields), []);
  assert.deepEqual(written({ Organizer: null }, 'Organizer', fields), []);
  // the column is not written: null (only the row read before the write is checked)
  assert.equal(written({ Other: 'x' }, 'Organizer', fields), null);
  // data that cannot be read: an empty list, never null
  assert.deepEqual(written('{not json', 'Organizer', fields), []);
  assert.deepEqual(written(['a'], 'Organizer', fields), []);
});

// The script of formscommon_CheckRow run with the calls it makes.
function checkRow({ rowId = '77', rowText = JSON.stringify({ id: 77, Organizer: 'ada@example.test' }), allowed = 'true', writtenValue = null, readThrows = false } = {}) {
  const yaml = readSequence('formscommon_CheckRow');
  const script = stepProperty(yaml, 'CheckRow', 'expression');
  const calls = { native: [], c8oforms: [] };
  const sandbox = {
    include: () => {},
    log: { warn: () => {} },
    forms_config: JSON.stringify({ table_id: 7, form_id: 'draft_42', source_owner: 'author' }),
    forms_form_id: 'published_42',
    source_kind: 'forms_AddRowFromData',
    row_id: rowId,
    written: writtenValue,
    authorization: 'JWT secret-token',
    callNative: (requestable, vars) => {
      calls.native.push({ requestable, vars });
      if (readThrows) { throw new Error('404'); }
      return rowText;
    },
    jsonAnswer: (text) => { try { return JSON.parse(text); } catch (e) { return null; } },
    callSequence: (project, sequence, vars) => {
      calls.c8oforms.push({ project, sequence, vars });
      return { document: { allowed } };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  return { allowed: sandbox.rowConditionAllowed, calls };
}

test('formscommon_CheckRow reads the row with the account of the source and lets C8Oforms decide', () => {
  const { allowed, calls } = checkRow({ writtenValue: '["ada@example.test"]' });
  assert.equal(allowed, true);
  assert.equal(calls.native.length, 1);
  assert.equal(calls.native[0].requestable, 'lib_BaseRow.Baserow_API_spec._api_database_rows_table__table_id___row_id___GET_raw');
  assert.deepEqual({ ...calls.native[0].vars }, { __header_Authorization: 'JWT secret-token', table_id: '7', row_id: '77', user_field_names: 'true' });
  assert.equal(calls.c8oforms.length, 1);
  const decision = calls.c8oforms[0];
  assert.deepEqual([decision.project, decision.sequence], ['C8Oforms', 'BaserowPublishedRowAuthorize']);
  assert.equal(decision.vars.form_id, 'published_42');
  assert.equal(decision.vars.write_kind, 'forms_AddRowFromData');
  assert.equal(decision.vars.row_id, '77');
  assert.deepEqual(JSON.parse(decision.vars.row), { id: 77, Organizer: 'ada@example.test' });
  assert.equal(decision.vars.written, '["ada@example.test"]');
  // the Bearer is given to the read only, never to C8Oforms
  assert.ok(!JSON.stringify(decision.vars).includes('secret-token'));
});

test('formscommon_CheckRow refuses what C8Oforms refuses, and a row it cannot read', () => {
  assert.equal(checkRow({ allowed: 'false' }).allowed, false);
  const unreadable = checkRow({ readThrows: true });
  assert.equal(unreadable.allowed, false);
  assert.equal(unreadable.calls.c8oforms.length, 0);
  const notJson = checkRow({ rowText: '<html>Bad gateway</html>' });
  assert.equal(notJson.allowed, false);
  // a row id that is not the id of a row: refused before anything is read
  for (const rowId of [' 77', '77 ', '77/../78', '78?x=1', '-1', '1e3']) {
    const odd = checkRow({ rowId });
    assert.equal(odd.allowed, false, rowId);
    assert.equal(odd.calls.native.length + odd.calls.c8oforms.length, 0, rowId);
  }
  // a creation reads no row: only the value it writes is checked
  const creation = checkRow({ rowId: '', writtenValue: '["ada@example.test"]' });
  assert.equal(creation.allowed, true);
  assert.equal(creation.calls.native.length, 0);
  assert.equal(creation.calls.c8oforms[0].vars.row, null);
});

test('formscommon_CheckRow is private and answers an authorization error', () => {
  const yaml = readSequence('formscommon_CheckRow');
  assert.match(yaml, /^accessibility: Private\n/);
  assert.match(yaml, /↓IfRowRefused \[steps\.IfStep-\d+\]: \n  condition: '!rowConditionAllowed'\n  ↓RowRefused \[steps\.XMLErrorStep-\d+\]: /);
  assert.match(yaml, /→→: 9\n[\s\S]*→→: row_denied\n[\s\S]*→→: The signed-in user may not change this row\n  ↓Return \[steps\.ReturnStep-\d+\]: /);
  assert.match(yaml, /↓authorization \[variables\.RequestableVariable-\d+\]: \n[\s\S]*?visibility: '-1'/);
  assert.match(readProjectFile('c8oProject.yaml'), /↓formscommon_CheckRow \[sequences\.GenericSequence\]: 🗏 sequences\/formscommon_CheckRow\.yaml/);
});

test('the row is read fresh, without httpInfo, and the Authorization header stays hidden', () => {
  const spec = readProjectFile('_c8oProject/connectors/Baserow_API_spec.yaml');
  const start = spec.indexOf('↓_api_database_rows_table__table_id___row_id___GET_raw [transactions.HttpTransaction]: ');
  assert.ok(start > 0);
  const end = spec.indexOf('\n↓', start + 1);
  const block = spec.slice(start, end);
  assert.match(block, /accessibility: Private/);
  assert.match(block, /subDir: \/api\/database\/rows\/table\/\{table_id\}\/\{row_id\}\//);
  assert.doesNotMatch(block, /responseExpiryDate/);
  assert.doesNotMatch(block, /^\s+httpInfo:/m);
  assert.match(block, /↓__header_Authorization \[variables\.RequestableHttpVariable-\d+\]: \n    visibility: '-1'/);
});

// The authorization script of formscommon_CheckConfig with the answer of C8Oforms.
function authorize(answer, { owner = 'author', user = 'respondent' } = {}) {
  const yaml = readSequence('formscommon_CheckConfig');
  const script = stepProperty(yaml, 'AuthorizeSourceOwner', 'expression');
  const sandbox = {
    include: () => {},
    owner,
    source_kind: 'forms_DeleteRow',
    _use_docid: 'published_42',
    forms_config: '{}',
    read_params: '',
    forms_anonymous_key: '',
    context: { getAuthenticatedUser: () => user },
    callSequence: () => ({ document: answer }),
  };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  return { authorized: sandbox.sourceOwnerAuthorized, column: sandbox.publishedWriteRowColumn };
}

test('formscommon_CheckConfig answers the column of the row condition C8Oforms granted', () => {
  assert.deepEqual(authorize({ allowed: 'true', row_check: 'false', row_column: '' }), { authorized: true, column: '' });
  assert.deepEqual(authorize({ allowed: 'true', row_check: 'true', row_column: 'Organizer' }), { authorized: true, column: 'Organizer' });
  // a column that reads as a number is still a column
  assert.deepEqual(authorize({ allowed: 'true', row_check: 'true', row_column: 2024 }), { authorized: true, column: '2024' });
  // a condition whose column cannot be read refuses the write
  assert.deepEqual(authorize({ allowed: 'true', row_check: 'true', row_column: {} }), { authorized: false, column: '' });
  // a refused write answers no column
  assert.deepEqual(authorize({ allowed: 'false', row_check: 'true', row_column: 'Organizer' }), { authorized: false, column: '' });
  // the owner of the source does not go through C8Oforms: no row condition
  assert.deepEqual(authorize({ allowed: 'false' }, { user: 'author' }), { authorized: true, column: '' });
  const yaml = readSequence('formscommon_CheckConfig');
  assert.match(yaml, /↓row_column \[steps\.ElementStep-\d+\]: \n  comment: [^\n]+\n  expression: publishedWriteRowColumn\n  nodeName: row_column\n/);
});

test('every write asks formscommon_CheckRow before it changes or deletes a row', () => {
  const kinds = { forms_AddRow: 'jIfThenElse', forms_AddRowFromData: 'jIfThenElse', forms_DeleteRow: 'Call_Sequence' };
  for (const [name, writeStep] of Object.entries(kinds)) {
    const yaml = readSequence(name);
    const checkConfig = yaml.match(/↓Call_Sequence2 \[steps\.SequenceStep-(\d+)\]: \n  sourceSequence: lib_BaseRow\.formscommon_CheckConfig/);
    assert.ok(checkConfig, name);
    const id = checkConfig[1];
    const column = yaml.indexOf('↓row_check_column [steps.SimpleSourceStep-');
    const condition = yaml.indexOf('↓IfRowCondition [steps.IfStep-');
    const call = yaml.indexOf('sourceSequence: lib_BaseRow.formscommon_CheckRow');
    const refused = yaml.indexOf('↓IfRowRefused [steps.IfExistStep-');
    const write = name === 'forms_DeleteRow' ? yaml.indexOf('sourceSequence: lib_BaseRow.TableDeleteRow') :
      yaml.indexOf(`↓${writeStep} [steps.IfThenElseStep-`);
    assert.ok(column > 0 && column < condition && condition < call && call < refused && refused < write, name);
    const block = yaml.slice(column, write);
    // the column and the Bearer come from the answer of formscommon_CheckConfig of this write
    assert.match(block, new RegExp(`↑value: ${id}\\n[^\\n]*\\n\\s+- ↑value: \\./document/row_column/text\\(\\)`), name);
    assert.match(block, new RegExp(`↑value: ${id}\\n[^\\n]*\\n\\s+- ↑value: \\./document/Bearer/text\\(\\)\\n\\s+visibility: '-1'`), name);
    assert.match(block, /condition: row_check_column != null && \("" \+ row_check_column\) != ""/);
    assert.match(block, new RegExp(`↓source_kind \\[variables\\.StepVariable-\\d+\\]: \\n\\s+value: ${name}\\n`), name);
    // an error of the check stops the write
    assert.match(block, /↓IfRowRefused \[steps\.IfExistStep-\d+\]: [\s\S]*↓Copy \[steps\.XMLCopyStep-\d+\]: [\s\S]*↓Return \[steps\.ReturnStep-\d+\]: /);
    if (name !== 'forms_DeleteRow') {
      // the row id exactly as the update uses it (MakeRowID: row_id = forms_id)
      assert.match(block, /'include\("js\/row_rule\.js"\);\n\s+row_id = forms_id != null && forms_id != undefined \? "" \+ forms_id : "";\n\s+written = rowRuleWritten\(data, "" \+ row_check_column, jFields\);'/);
    }
  }
});
