const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, '_c8oProject/sequences', file), 'utf8');
const logLines = (text) => text.split('\n').map((line, at) => ({ line: line.trim(), at: at + 1 }))
  .filter(({ line }) => /\blog\.(warn|info|error|debug|trace)\(/.test(line));

// The writes of a response (forms_AddRow, forms_AddRowFromData) log no value of a row: neither an answer, nor a file
// name (the paths of the temporary attachment folders hold them). The name of a column is only logged at debug level.
const VALUE = /jDoc|\.value\b|\btrimmed\b|getAbsolutePath|jAttachmentName|\bdata\[/;
const COLUMN = /\+\s*(key|item|respItem|_use_attname)\b/;

for (const file of ['forms_AddRow.yaml', 'forms_AddRowFromData.yaml']) {
  test(`${file} logs no value of a row, and the names of the columns at debug level only`, () => {
    const lines = logLines(read(file));
    assert.ok(lines.length > 20, `${lines.length} log lines`);
    const values = lines.filter(({ line }) => VALUE.test(line)).map(({ at, line }) => `${at}: ${line}`);
    assert.deepEqual(values, []);
    const columns = lines.filter(({ line }) => COLUMN.test(line) && !/\blog\.debug\(/.test(line)).map(({ at, line }) => `${at}: ${line}`);
    assert.deepEqual(columns, []);
  });
}

test('a CSV import logs the number of rows it sends, not the rows', () => {
  const lines = logLines(read('TableBulkImportFromCSV.yaml'));
  assert.deepEqual(lines.filter(({ line }) => /\+\s*data\b|JSON\.stringify\(table\)/.test(line)).map(({ line }) => line), []);
});
