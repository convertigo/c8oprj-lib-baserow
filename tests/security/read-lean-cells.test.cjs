// lean_cells: formssource_GetTableData sends each cell with the value formatBaserowCell computes but without its displayValue
// HTML, and the options of the columns in fields; the Forms viewer builds the HTML from them (viewerPage applyBaserowLeanCells).
const test = require('node:test');
const assert = require('node:assert/strict');
const { readSequence, readProjectFile, stepProperty } = require('./read-yaml-steps.cjs');

function functionSource(code, name) {
  const start = code.indexOf(`var ${name} = function`);
  assert.ok(start >= 0, `${name} not found`);
  let depth = 0;
  for (let i = code.indexOf('{', start); i < code.length; i++) {
    if (code[i] === '{') depth++;
    if (code[i] === '}' && --depth === 0) return code.slice(start, i + 1) + ';';
  }
  throw new Error(`${name} not closed`);
}

const yaml = readSequence('formssource_GetTableData');
const code = stepProperty(yaml, 'ComputeData', 'expression');
const names = ['escapeDisplayHtml', 'isTrueValue', 'padNumber', 'getFieldOption', 'getResolvedFieldType', 'getPrimitiveCellValue',
  'formatDateValue', 'formatDurationValue', 'formatNumberValue', 'formatEmailHtml', 'formatPhoneHtml', 'formatRatingHtml',
  'formatBooleanHtml', 'formatBaserowCell', 'isLeanTypedField', 'leanAnyValue', 'leanCellValue', 'leanFieldOptions'];
const lib = new Function('log', [
  readProjectFile('js/utils.js'),
  readProjectFile('js/getFilter.js'),
  'var getDateDisplayTimezone = function () { return "Europe/Paris"; };',
  'var getDateTimeParts = function () { return null; };',
  ...names.map((name) => functionSource(code, name)),
  `return { ${names.join(', ')} };`,
].join('\n'))({ warn: () => {} });

const columns = {
  status: { name: 'status', type: 'single_select' },
  tags: { name: 'tags', type: 'multiple_select' },
  files: { name: 'files', type: 'file' },
  link: { name: 'link', type: 'link_row' },
  amount: { name: 'amount', type: 'number', number_decimal_places: 2 },
  done: { name: 'done', type: 'boolean' },
  day: { name: 'day', type: 'date', date_format: 'EU', date_include_time: false },
  site: { name: 'site', type: 'url' },
  lookup: { name: 'lookup', type: 'lookup', formula_type: 'array', array_formula_type: 'single_select' },
};
const cells = {
  status: { id: 3, value: 'Done', color: 'green' },
  tags: [{ id: 1, value: 'a', color: 'red' }, { id: 2, value: 'b', color: 'blue' }],
  files: [{ url: 'https://x/f.png', is_image: true, visible_name: 'f.png' }, { url: 'https://x/d.pdf', is_image: false, visible_name: 'd.pdf' }],
  link: [{ id: 7, value: 'Row 7' }, { id: 8, value: { id: 1, value: 'nested' } }],
  amount: '12.5',
  done: true,
  day: '2024-03-31',
  site: 'example.com',
  lookup: [{ id: 1, value: { id: 4, value: 'Open', color: 'green' } }],
  unknown: { id: 9 },
  text: 'plain',
};

test('a lean cell has the value of the full cell', () => {
  for (const [key, cell] of Object.entries(cells)) {
    const field = columns[key] || null;
    const full = lib.formatBaserowCell(cell, field, false).value;
    assert.deepEqual(lib.leanCellValue(cell, lib.isLeanTypedField(field)), full, key);
  }
});

test('the options of a column are sent as text, with the timezone of a date', () => {
  assert.deepEqual(lib.leanFieldOptions(columns.amount), { type: 'number', resolvedType: 'number', number_decimal_places: '2' });
  assert.deepEqual(lib.leanFieldOptions(columns.day),
    { type: 'date', resolvedType: 'date', date_format: 'EU', date_include_time: 'false', timezone: 'Europe/Paris' });
  assert.deepEqual(lib.leanFieldOptions(columns.lookup), { type: 'lookup', resolvedType: 'single_select' });
});

test('lean cells are asked by the caller, never in model mode, and only then answer fields', () => {
  assert.match(code, /var leanCells = typeof lean_cells != "undefined" && \("" \+ lean_cells\) == "true" && !isModelMode;/);
  assert.match(code, /if \(current != null && leanCells\) \{/);
  assert.match(yaml, /\n↓IfLeanFields \[steps\.IfStep-\d+\]: \n[^\n]*\n  condition: leanCells\n  ↓FieldDisplayOptions \[steps\.SimpleStep-\d+\]: \n[\s\S]*?\n  ↓fields \[steps\.JsonToXmlStep-\d+\]: /);
  assert.match(yaml, /\n↓lean_cells \[variables\.RequestableVariable-\d+\]: \n/);
});

// FieldDisplayOptions: the options the viewer needs besides to show a cell as Baserow does, added to fields whichever way
// the rows were read (a Java map from the native steps), and the aggregates of a grouped answer
class JavaMap {
  constructor(entries) { this.entries = entries; }
  entrySet() {
    const list = Object.entries(this.entries).map(([key, value]) => ({ getKey: () => key, getValue: () => value }));
    return { iterator: () => { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; } };
  }
}
const displayOptions = new Function('java', 'leanFields', 'structure', 'groupByColumns', 'aggregationSpecs',
  `${stepProperty(yaml, 'FieldDisplayOptions', 'expression').replace(/\$\{lib_BaseRow\.dateTimezone=([^}]*)\}/g, '$1')}\nreturn leanFields;`);
// the 8.4.7 engine gives the Java map of the native steps without instanceof java.util.Map: the step knows it by its entrySet
const java = { util: { Map: class NotThatMap {} } };
const structure = [
  { name: 'Amount', type: 'number', number_decimal_places: 2, number_separator: 'SPACE_COMMA', number_prefix: '', number_suffix: ' €' },
  { name: 'Stars', type: 'rating', max_value: 5, color: 'dark-red', style: 'heart' },
  { name: 'Day', type: 'date', date_format: 'EU', date_include_time: true, date_force_timezone: null, date_show_tzinfo: true },
  { name: 'Prices', type: 'lookup', formula_type: 'array', array_formula_type: 'number', number_decimal_places: 1, number_separator: 'COMMA_PERIOD' },
  { name: 'Units', type: 'count', formula_type: 'number', number_decimal_places: 0 },
  { name: 'Label', type: 'formula', formula_type: 'text', number_separator: '' },
  { name: 'Notes', type: 'long_text', long_text_enable_rich_text: true },
  { name: 'Memo', type: 'long_text', long_text_enable_rich_text: false },
];

test('fields get the display options of their column, from a Java map of the native steps too (not instanceof java.util.Map)', () => {
  const native = new JavaMap({
    Amount: new JavaMap({ type: 'number', resolvedType: 'number', number_decimal_places: '2' }),
    Stars: new JavaMap({ type: 'rating', resolvedType: 'rating' }),
    Day: new JavaMap({ type: 'date', resolvedType: 'date', date_format: 'EU', timezone: 'UTC' }),
    Prices: new JavaMap({ type: 'lookup', resolvedType: 'number', number_decimal_places: '1' }),
    Label: new JavaMap({ type: 'formula', resolvedType: 'text' }),
  });
  const fields = displayOptions(java, native, structure, null, null);
  assert.deepEqual(fields.Amount, { type: 'number', resolvedType: 'number', number_decimal_places: '2', number_separator: 'SPACE_COMMA', number_suffix: ' €' });
  assert.deepEqual(fields.Stars, { type: 'rating', resolvedType: 'rating', max_value: '5', color: 'dark-red', style: 'heart' });
  assert.deepEqual(fields.Day, { type: 'date', resolvedType: 'date', date_format: 'EU', timezone: 'UTC', date_show_tzinfo: 'true', date_force_timezone: 'UTC' });
  assert.deepEqual(fields.Prices, { type: 'lookup', resolvedType: 'number', number_decimal_places: '1', number_separator: 'COMMA_PERIOD', array_formula_type: 'number' });
  assert.deepEqual(fields.Label, { type: 'formula', resolvedType: 'text' });
  // a rich long text: its value is Markdown, which the viewer shows formatted; a plain long text stays text
  const longTexts = displayOptions(java, new JavaMap({ Notes: new JavaMap({ type: 'long_text', resolvedType: 'long_text' }),
    Memo: new JavaMap({ type: 'long_text', resolvedType: 'long_text' }) }), structure, null, null);
  assert.deepEqual(longTexts.Notes, { type: 'long_text', resolvedType: 'long_text', long_text_enable_rich_text: 'true' });
  assert.deepEqual(longTexts.Memo, { type: 'long_text', resolvedType: 'long_text', long_text_enable_rich_text: 'false' });
  // #1424: a date without forced timezone is shown in the one of the server (UTC), never in the one of the browser
  const paris = displayOptions(java, { Day: { type: 'date' } }, [{ ...structure[2], date_force_timezone: 'Europe/Paris' }], null, null);
  assert.equal(paris.Day.date_force_timezone, 'Europe/Paris');
  const fromJs = displayOptions(java, { Amount: { type: 'number', resolvedType: 'number' } }, structure, null, null);
  assert.equal(fromJs.Amount.number_separator, 'SPACE_COMMA');
});

test('the aggregates of a grouped answer giving a number get the format of their column', () => {
  const specs = [
    { type: 'count', key: 'count' },
    { type: 'sum', column: 'Amount', key: 'sum_Amount' },
    { type: 'avg', column: 'Units', key: 'avg_Units' },
    { type: 'max', column: 'Prices', key: 'max_Prices' },
    { type: 'sum', column: 'Stars', key: 'sum_Stars' },
    { type: 'empty_percentage', column: 'Amount', key: 'empty_percentage_Amount', percentage: true },
    { type: 'earliest_date', column: 'Day', key: 'earliest_date_Day', fieldKind: 'date' },
    { type: 'sum', column: 'Label', key: 'sum_Label' },
  ];
  const fields = displayOptions(java, { Group: { type: 'text', resolvedType: 'text' } }, structure, ['Group'], specs);
  assert.deepEqual(fields.count, { type: 'number', resolvedType: 'number', number_decimal_places: '0', aggregate: 'count' });
  assert.deepEqual(fields.sum_Amount, { type: 'number', resolvedType: 'number', aggregate: 'sum', number_decimal_places: '2', number_separator: 'SPACE_COMMA', number_suffix: ' €' });
  assert.equal(fields.avg_Units.number_decimal_places, '2');
  assert.deepEqual(fields.max_Prices, { type: 'number', resolvedType: 'number', aggregate: 'max', number_decimal_places: '1', number_separator: 'COMMA_PERIOD' });
  assert.deepEqual(fields.sum_Stars, { type: 'number', resolvedType: 'number', aggregate: 'sum', number_decimal_places: '0' });
  for (const key of ['empty_percentage_Amount', 'earliest_date_Day', 'sum_Label']) {
    assert.equal(fields[key], undefined, key);
  }
  assert.match(yaml, /\n  ↓FieldDisplayOptions \[steps\.SimpleStep-\d+\]: \n[^\n]*\n    expression: \|\n[\s\S]*?\n  ↓fields \[steps\.JsonToXmlStep-\d+\]: /);
});

// The native steps put leanFields in the scope as a raw Java object: Rhino reads its members inline but refuses it as the
// argument of a JavaScript function (Invalid JavaScript value of type java.util.LinkedHashMap). A sandbox cannot show that,
// so the step is read: leanFields is never an argument of a call.
test('FieldDisplayOptions never passes the raw leanFields of the native steps to a function', () => {
  const step = stepProperty(yaml, 'FieldDisplayOptions', 'expression');
  const code = step.replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(code, /\(\s*leanFields\s*[,)]|,\s*leanFields\s*[,)]/);
  assert.match(code, /if \(leanFields != null && typeof leanFields\.entrySet == "function"\) \{/);
});
