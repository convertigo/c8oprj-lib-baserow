const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (name) => fs.readFileSync(path.join(__dirname, '../../_c8oProject/sequences', name + '.yaml'), 'utf8');
const actions = { forms_AddRow: (value) => ({ variable: { resp: { choice: { value } } } }), forms_AddRowFromData: (value) => ({ choice: value }) };
const field = { select_options: [{ id: 12, value: 'Option A' }, { id: 13, value: 'Option B' }] };

// The value helpers of each PrepareData copy (answerText, selectOptionId...), in YAML order ('' is an escaped quote).
function helpers(name) {
  return (read(name).match(/var fieldErrors = \[\];\n[\s\S]*?(?=\n\s*for \(var key in)/g) || []).map((block) => block.replace(/''/g, "'"));
}

// The cases of one field type in the YAML expressions, run as JavaScript on one answer with the helpers of the same copy:
// each returns data[key] for that type (withErrors: {data, errors}, the answers reported as matching no option).
function typeCases(name, type, withErrors) {
  const shared = helpers(name);
  const blocks = read(name).match(new RegExp(`case ''${type}'':[\\s\\S]*?break;`, 'g')) || [];
  assert.equal(shared.length, blocks.length, `${name}: helpers of each ${type} case`);
  const log = { warn() {} };
  return blocks.map((block, i) => {
    const run = new Function('jDoc', 'key', 'obj', 'data', 'log', `${shared[i]}\nswitch ('${type}') { ${block.replace(/''/g, "'")} } return { data: data, errors: fieldErrors };`);
    return (jDoc, key, obj, data) => (withErrors ? run(jDoc, key, obj, data, log) : run(jDoc, key, obj, data, log).data);
  });
}
const selectCases = (name, withErrors) => typeCases(name, 'single_select', withErrors);

// An unanswered choice was sent as +"" = 0, which Baserow refuses (ERROR_REQUEST_BODY_VALIDATION): the whole row was lost.
test('an unanswered single select leaves the cell empty', () => {
  for (const [name, doc] of Object.entries(actions)) {
    const cases = selectCases(name);
    assert.equal(cases.length, 2, `${name}: single_select cases`);
    for (const run of cases) {
      for (const empty of ['', '  ', null, undefined]) {
        assert.equal(run(doc(empty), 'choice', field, {}).choice, null, `${name}: ${JSON.stringify(empty)}`);
      }
      assert.equal(run(doc('Option B'), 'choice', field, {}).choice, 13, `${name}: option label`);
      assert.equal(run(doc('12'), 'choice', field, {}).choice, 12, `${name}: option id`);
      assert.equal(run(doc(12), 'choice', field, {}).choice, 12, `${name}: numeric option id`);
    }
  }
});

// A number was taken as an option id before the labels were tried: with options labelled "1".."5" (ids 501..505) the
// answer "2" was sent as the option 2, which Baserow refuses. An unknown label was sent as +"label" = NaN, written as
// null: the cell was silently emptied. A number is now an option id only if that option exists.
test('a single select answer is matched on the labels first, then on existing option ids, else reported', () => {
  const scale = { select_options: [1, 2, 3, 4, 5].map((n) => ({ id: 500 + n, value: '' + n })) };
  for (const [name, doc] of Object.entries(actions)) {
    for (const run of selectCases(name, true)) {
      assert.equal(run(doc('2'), 'choice', scale, {}).data.choice, 502, `${name}: label "2"`);
      assert.equal(run(doc(2), 'choice', scale, {}).data.choice, 502, `${name}: label 2`);
      assert.equal(run(doc('504'), 'choice', scale, {}).data.choice, 504, `${name}: id 504`);
      assert.equal(run(doc(' option b '), 'choice', field, {}).data.choice, 13, `${name}: label ignoring case and spaces`);
      for (const unknown of ['Option Z', '14', 'NaN']) {
        const result = run(doc(unknown), 'choice', field, {});
        assert.equal('choice' in result.data, false, `${name}: ${unknown} leaves the cell unchanged`);
        assert.deepEqual(result.errors, [`The answer "${unknown}" of the field "choice" is not an option of its select column`], `${name}: ${unknown}`);
      }
      assert.deepEqual(run(doc(''), 'choice', scale, {}).errors, [], `${name}: unanswered`);
    }
  }
});

// An unanswered link was sent as [0] (Number("")), a row Baserow cannot find: the whole row was refused.
// Writing [] on an update clears the cell, which is what an emptied field means.
test('an unanswered link row leaves the cell empty and keeps ids and primary-field texts', () => {
  for (const [name, doc] of Object.entries(actions)) {
    const cases = typeCases(name, 'link_row');
    assert.equal(cases.length, 2, `${name}: link_row cases`);
    for (const run of cases) {
      for (const empty of ['', '  ', ',', ' , ', null, undefined]) {
        assert.deepEqual(run(doc(empty), 'choice', {}, {}).choice, [], `${name}: ${JSON.stringify(empty)}`);
      }
      assert.deepEqual(run(doc('12,'), 'choice', {}, {}).choice, [12], `${name}: trailing comma`);
      assert.deepEqual(run(doc('12, 13'), 'choice', {}, {}).choice, [12, 13], `${name}: ids`);
      assert.deepEqual(run(doc(12), 'choice', {}, {}).choice, [12], `${name}: numeric id`);
      assert.deepEqual(run(doc('Paris, 7'), 'choice', {}, {}).choice, ['Paris', 7], `${name}: primary-field text`);
    }
  }
});

// Baserow's number and date serializers refuse "": an unanswered number or date lost the whole row.
test('an unanswered number or date leaves the cell empty and keeps 0', () => {
  for (const [name, doc] of Object.entries(actions)) {
    for (const type of ['number', 'date']) {
      const cases = typeCases(name, type);
      assert.equal(cases.length, 2, `${name}: ${type} cases`);
      for (const run of cases) {
        for (const empty of ['', '  ', null, undefined]) {
          assert.equal(run(doc(empty), 'choice', {}, {}).choice, null, `${name} ${type}: ${JSON.stringify(empty)}`);
        }
      }
    }
    for (const run of typeCases(name, 'number')) {
      assert.equal(run(doc(0), 'choice', {}, {}).choice, 0, `${name}: 0`);
      assert.equal(run(doc('0'), 'choice', {}, {}).choice, '0', `${name}: "0"`);
      assert.equal(run(doc('3.5'), 'choice', {}, {}).choice, '3.5', `${name}: number`);
    }
    for (const run of typeCases(name, 'date')) {
      assert.equal(run(doc('2026-10-14'), 'choice', {}, {}).choice, '2026-10-14', `${name}: date`);
    }
  }
});

// Each row call (TableCreateRow, TableUpdateRow) is followed by its own error check: the update branch used to read the
// create call of the other branch, which never runs there, so a row update refused by Baserow went unnoticed.
// Baserow answers {"error": "<code>", "detail": "<text>"}: the detail is reported with the error.
test('the error check of each row call reads that call and carries the Baserow detail', () => {
  for (const name of Object.keys(actions)) {
    const sequence = read(name);
    const calls = [...sequence.matchAll(/↓Call_Sequence \[steps\.SequenceStep-(\d+)\]: \n(?: {6}.*\n)*? {6}sourceSequence: lib_BaseRow\.Table(Create|Update)Row\n/g)];
    assert.deepEqual(calls.map((call) => call[2]).sort(), ['Create', 'Update'], `${name}: row calls`);
    for (const call of calls) {
      const after = sequence.slice(call.index + call[0].length);
      const check = after.slice(after.indexOf('↓IfExist [steps.IfExistStep-'), after.indexOf('[steps.ReturnStep-'));
      const sources = [...check.matchAll(/- ↑value: (\d{10,})\n/g)].map((source) => source[1]);
      assert.deepEqual(sources, [call[1], call[1], call[1]], `${name}: error check of ${call[2]}Row`);
      assert.match(check, / {8}details: \n(?: {10,}.*\n)+? {18}- ↑value: \.\/document\/detail\n {8}message: /, `${name}: detail of ${call[2]}Row`);
    }
  }
});
