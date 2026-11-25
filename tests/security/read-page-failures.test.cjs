// A page of rows that formssource_GetTableData asks Baserow for is read, or the source answers an error. A connection
// error (BindException under load), an empty or not JSON answer or an HTTP error without a Baserow error gave no rows
// for that page: the next pages ended the reading with the rows read so far (1000 rows of 2000), the first page an
// empty table, without any error.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readSequence, stepProperty } = require('./read-yaml-steps.cjs');

const sequence = readSequence('formssource_GetTableData');
const nextPage = stepProperty(sequence, 'ParseRawNextPage', 'expression');
const firstPage = stepProperty(sequence, 'ParseRawFirstPage', 'expression');

const run = (code, vars) => {
  const warnings = [];
  const scope = { log: { warn: (m) => warnings.push(m), info() {} }, ...vars };
  new Function('scope', `with (scope) { ${code} }`)(scope);
  return { scope, warnings };
};

test('an unreadable next page is an error, not the end of the rows', () => {
  // what readResults, readNext and readError leave for an answer that is not a Baserow page
  for (const [label, results] of [['no answer', undefined], ['not JSON', null], ['no results', undefined], ['not a list', {}]]) {
    const { scope, warnings } = run(nextPage, { raw_page: '', page_results: results, next_page: null, raw_error: null, page: '6' });
    assert.equal(scope.raw_error, 'Baserow page 6 could not be read', label);
    assert.equal(warnings.length, 1, label);
  }
  // a read page, the last one included, and the error of Baserow itself
  assert.equal(run(nextPage, { raw_page: '{}', page_results: [{ id: 1 }], next_page: null, raw_error: null, page: '6' }).scope.raw_error, null);
  assert.equal(run(nextPage, { raw_page: '{}', page_results: [], next_page: null, raw_error: null, page: '6' }).scope.raw_error, null);
  assert.equal(run(nextPage, { raw_page: '{}', page_results: undefined, next_page: null, raw_error: 'ERROR_INVALID_PAGE', page: '6' }).scope.raw_error,
    'ERROR_INVALID_PAGE');
});

test('an unreadable first page is an error, not an empty table', () => {
  const block = firstPage.match(/\n\/\/ a page of rows that was asked is read[\s\S]*?\n}\n?$/);
  assert.ok(block, 'the check closes ParseRawFirstPage');
  const check = (vars) => run(block[0], { raw_error: null, readTable: false, pluginGroups: null, pluginRequiredError: null, page: '1', ...vars }).scope.raw_error;
  assert.equal(check({ results: undefined }), 'Baserow page 1 could not be read');
  assert.equal(check({ results: null }), 'Baserow page 1 could not be read');
  assert.equal(check({ results: [] }), null, 'an empty table');
  assert.equal(check({ results: [{ id: 1 }] }), null);
  // the rows were not asked: the groups of the plugin, or the table read again without it
  assert.equal(check({ results: undefined, pluginGroups: [{ count: 3 }] }), null);
  assert.equal(check({ results: undefined, readTable: true }), null);
  // nor when the plugin could not compute the aggregations only it computes: that error instead
  assert.equal(check({ results: undefined, pluginRequiredError: 'The aggregations median:Montant ...' }), null);
  assert.equal(check({ results: undefined, raw_error: 'ERROR_TABLE_DOES_NOT_EXIST' }), 'ERROR_TABLE_DOES_NOT_EXIST');
});

test('the error of a page ends the source with it', () => {
  for (const [parse, ifError] of [['ParseRawFirstPage', 'IfRawError [steps.IfStep-1996000000048]'], ['ParseRawNextPage', 'IfRawError [steps.IfStep-1996000000080]']]) {
    const start = sequence.indexOf(`↓${parse} [`);
    const next = sequence.indexOf('↓IfRawError [', start);
    assert.ok(start > 0 && next > start, parse);
    assert.ok(sequence.startsWith('↓' + ifError, next), parse);
    assert.match(sequence.slice(next, next + 1200), /condition: raw_error != null[\s\S]*?→→: raw_error[\s\S]*?↓Return \[steps\.ReturnStep/, parse);
  }
});
