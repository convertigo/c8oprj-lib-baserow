// The sums and averages of formssource_GetTableData are rounded like the cells of their column.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readSequence, stepProperty } = require('./read-yaml-steps.cjs');

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

const code = stepProperty(readSequence('formssource_GetTableData'), 'ComputeData', 'expression');
const buildAggregateCell = new Function('base_html', 'close_html',
  ['getFieldOption', 'getAggregationDecimalPlaces', 'roundAggregateValue', 'buildAggregateCell']
    .map((name) => functionSource(code, name)).join('\n') + '\nreturn buildAggregateCell;')('<p>', '</p>');

test('a sum keeps the decimal places of its number column', () => {
  const field = { type: 'number', number_decimal_places: 2 };
  const cell = buildAggregateCell({ key: 'sum:amount', type: 'sum', field }, 0.1 + 0.2 + 1000.55);
  assert.equal(cell.value, 1000.85);
  assert.equal(cell.displayValue, '<p>1000.85</p>');
  assert.equal(buildAggregateCell({ key: 's', type: 'sum', field: { type: 'number', number_decimal_places: 0 } }, 955.9999999).displayValue, '<p>956</p>');
});

test('a sum without decimal places on its column is rounded to 2 decimals', () => {
  assert.equal(buildAggregateCell({ key: 's', type: 'sum' }, 1.005).value, 1.01);
  assert.equal(buildAggregateCell({ key: 's', type: 'sum', field: { type: 'duration' } }, 12.3456).displayValue, '<p>12.35</p>');
  assert.equal(buildAggregateCell({ key: 's', type: 'sum', field: { type: 'rating' } }, 7).displayValue, '<p>7</p>');
  assert.equal(buildAggregateCell({ key: 's', type: 'sum' }, -2.675).value, -2.68);
});

test('an average keeps at least 2 decimals', () => {
  const field = { type: 'number', number_decimal_places: 0 };
  assert.equal(buildAggregateCell({ key: 'a', type: 'avg', field }, 1.5).displayValue, '<p>1.50</p>');
  assert.equal(buildAggregateCell({ key: 'a', type: 'avg', field: { type: 'number', number_decimal_places: 3 } }, 2 / 3).displayValue, '<p>0.667</p>');
});

test('count, min, max and empty aggregates are unchanged', () => {
  assert.equal(buildAggregateCell({ key: 'c', type: 'count' }, 3).displayValue, '<p>3</p>');
  assert.equal(buildAggregateCell({ key: 'm', type: 'max' }, 'B').displayValue, '<p>B</p>');
  assert.equal(buildAggregateCell({ key: 's', type: 'sum' }, null).displayValue, '<p></p>');
  assert.equal(buildAggregateCell({ key: 's', type: 'sum' }, 1e-7).value, 0);
});

// An optional label after "=" names the value in the legends and headers of the viewer; the key of the cell stays
// <type>_<column> (count), so the paths to its value (<grid>.0.sum_Contract Value) do not change.
const parseCode = stepProperty(readSequence('formssource_GetTableData'), 'ParseConfig', 'expression');
const parseAggregationSpecs = new Function(
  functionSource(parseCode, 'trimFieldName') + '\nvar included = [];\nvar ensureIncludedField = function (name) { included.push(name); };\n' +
  functionSource(parseCode, 'parseAggregationSpecs') + '\nreturn parseAggregationSpecs;')();

test('an aggregation takes an optional label after "=", its key unchanged', () => {
  const specs = parseAggregationSpecs('sum:Contract Value=Montant, count = Nombre de ventes ,avg:Expected revenue,max:Score=');
  assert.deepEqual(specs.map((spec) => [spec.type, spec.column, spec.key, spec.label]), [
    ['sum', 'Contract Value', 'sum_Contract Value', 'Montant'],
    ['count', null, 'count', 'Nombre de ventes'],
    ['avg', 'Expected revenue', 'avg_Expected revenue', ''],
    ['max', 'Score', 'max_Score', ''],
  ]);
  assert.equal(parseAggregationSpecs('sum:Amount=A,sum:Amount=B').length, 1, 'one aggregation per type and column');
  assert.equal(parseAggregationSpecs('decile:Amount=Déciles'), null, 'not an aggregation of the footer of a Baserow grid');
  assert.equal(parseAggregationSpecs('constructor:Amount'), null);
});

test('the cell of an aggregation carries its type, its column and its label, displayName stays the key', () => {
  const cell = buildAggregateCell({ key: 'sum_Contract Value', type: 'sum', column: 'Contract Value', label: 'Montant' }, 12);
  assert.equal(cell.displayName, 'sum_Contract Value');
  assert.equal(cell.aggregationType, 'sum');
  assert.equal(cell.aggregationColumn, 'Contract Value');
  assert.equal(cell.label, 'Montant');
  const count = buildAggregateCell({ key: 'count', type: 'count', column: null, label: '' }, 3);
  assert.equal(count.label, undefined, 'no label property without a label');
  assert.equal(count.aggregationType, 'count');
});
