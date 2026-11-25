// The aggregations of the footer of a Baserow grid (Summarize) in forms_tableAggregations: empty and filled counts and
// percents, unique count, checked counts and percents, median, standard deviation, variance, earliest and latest date,
// distribution. The c8oforms Baserow plugin computes them on the whole table, by group or for the whole table without
// Group by (one summary row); without the plugin the source answers an error, never values of the first
// max_search_results rows.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readSequence, stepProperty } = require('./read-yaml-steps.cjs');

function functionSource(code, name) {
  const start = code.indexOf(`var ${name} = function`);
  assert.ok(start >= 0, `${name} not found`);
  let depth = 0;
  for (let i = code.indexOf('{', start); i < code.length; i++) {
    if (code[i] === '"') {
      // the braces of a string ("{") do not count
      for (i++; i < code.length && code[i] !== '"'; i++) if (code[i] === '\\') i++;
      continue;
    }
    if (code[i] === '{') depth++;
    if (code[i] === '}' && --depth === 0) return code.slice(start, i + 1) + ';';
  }
  throw new Error(`${name} not closed`);
}

const sequence = readSequence('formssource_GetTableData');
const parseConfig = stepProperty(sequence, 'ParseConfig', 'expression');
const parseRawFirstPage = stepProperty(sequence, 'ParseRawFirstPage', 'expression');
const computeData = stepProperty(sequence, 'ComputeData', 'expression');
const load = (code, names, prelude = '') =>
  new Function(prelude + names.map((name) => functionSource(code, name)).join('\n') + `\nreturn ${names[names.length - 1]};`)();

const parseAggregationSpecs = load(parseConfig, ['trimFieldName', 'parseAggregationSpecs'], 'var ensureIncludedField = function () {};\n');
const buildPluginAggregateRequest = load(parseConfig, ['buildPluginAggregateRequest']);
const describePluginRequirement = load(parseConfig, ['describePluginRequirement']);
const readPluginAggregate = load(parseRawFirstPage, ['readPluginAggregate']);
const pluginGroupRows = load(computeData, ['pluginGroupRows']);
const pluginAggregateValue = load(computeData, ['pluginAggregateValue']);
const getAggregationFieldKind = load(computeData, ['getAggregationFieldKind']);
const updateAggregationState = load(computeData, ['getAggregationSourceValue', 'getNumericValue', 'getAggregationFieldKind',
  'getDateSortKey', 'updateAggregationState']);
const getDateSortKey = load(computeData, ['getDateSortKey']);
const buildAggregateCell = load(computeData, [
  'escapeDisplayHtml', 'isTrueValue', 'padNumber', 'getFieldOption', 'getResolvedFieldType', 'getDateDisplayTimezone',
  'getDateTimeParts', 'formatDateValue', 'formatDurationValue', 'formatNumberValue', 'formatBooleanHtml',
  'formatDistributionLabel', 'formatDistributionHtml', 'getAggregationDecimalPlaces', 'roundAggregateValue', 'buildAggregateCell',
], 'var base_html = "<p>", close_html = "</p>";\nvar getBrFilterType = function (field) { return { type: field.type }; };\n');

const FOOTER = {
  empty_count: ['empty_count'], not_empty_count: ['not_empty_count'],
  empty_percentage: ['empty_count', 'percentage'], not_empty_percentage: ['not_empty_count', 'percentage'],
  unique_count: ['unique_count'],
  checked_count: ['not_empty_count', 'boolean'], not_checked_count: ['empty_count', 'boolean'],
  checked_percentage: ['not_empty_count', 'boolean', 'percentage'], not_checked_percentage: ['empty_count', 'boolean', 'percentage'],
  median: ['median'], std_dev: ['std_dev'], variance: ['variance'],
  earliest_date: ['min', 'date'], latest_date: ['max', 'date'], distribution: ['distribution'],
};

test('every aggregation of the footer of a Baserow grid is read, with what the plugin computes for it', () => {
  const text = Object.keys(FOOTER).map((type) => `${type}:Col ${type}`).join(',');
  const specs = parseAggregationSpecs(text + ',count,sum:Montant=Total,avg:Montant');
  assert.equal(specs.length, Object.keys(FOOTER).length + 3);
  for (const spec of specs.slice(0, -3)) {
    const [plugin, ...flags] = FOOTER[spec.type];
    assert.equal(spec.column, `Col ${spec.type}`);
    assert.equal(spec.key, `${spec.type}_Col ${spec.type}`);
    assert.equal(spec.plugin, plugin, spec.type);
    assert.equal(spec.pluginOnly, true, spec.type);
    assert.equal(spec.percentage === true, flags.includes('percentage'), spec.type);
    assert.equal(spec.fieldKind || null, flags.find((flag) => flag == 'boolean' || flag == 'date') || null, spec.type);
  }
  // the aggregations the reading of the rows computes stay as they were
  const [count, sum, avg] = specs.slice(-3);
  assert.deepEqual([count.type, count.pluginOnly, sum.plugin, sum.pluginOnly, sum.label, avg.plugin], ['count', undefined, 'sum', undefined, 'Total', 'avg']);
  assert.equal(parseAggregationSpecs('MEDIAN:Montant')[0].type, 'median', 'any case');
  assert.equal(parseAggregationSpecs('median'), null, 'a column is needed');
  assert.equal(parseAggregationSpecs('hasOwnProperty:Montant,__proto__:Montant,average:Montant'), null, 'not an aggregation of the list');
});

test('aggregations without Group by give one row for the whole table, grouped by nothing', () => {
  assert.match(parseConfig, /else if \(aggregationSpecs != null\) \{\n[^\n]*\n\tgroupByColumns = \[\];\n\tdistinctColumns = null;\n\}/);
  const request = buildPluginAggregateRequest([], parseAggregationSpecs('count,sum:Montant,distribution:Ville'), null, false, true);
  assert.equal(request.group_by, '[]');
  // the smallest id and order of the table, without the array of every id of first:id
  assert.deepEqual(JSON.parse(request.aggregations), ['c8o_first=min:id', 'c8o_order=min:order', 'c8o_a1=sum:Montant', 'c8o_a2=distribution:Ville']);
  const [row] = pluginGroupRows([{ count: 0, c8o_first: null, c8o_order: null, c8o_a1: null }], [], [], {});
  assert.deepEqual({ ...row }, { id: null, order: null }, 'an empty table is still one row');
  assert.equal(row.__c8oAggregates.count, 0);
});

test('the plugin request names what the plugin computes for each aggregation', () => {
  const specs = parseAggregationSpecs('checked_percentage:Payé,earliest_date:Quand,not_empty_percentage:Ville,count');
  const request = buildPluginAggregateRequest(['Statut'], specs, null, false, true);
  assert.deepEqual(JSON.parse(request.aggregations), [
    'c8o_first=first:id', 'c8o_order=min:order', 'c8o_a0=not_empty_count:Payé', 'c8o_a1=min:Quand', 'c8o_a2=not_empty_count:Ville',
  ]);
});

test('when the plugin is required, a sort on other columns keeps the plugin', () => {
  const specs = parseAggregationSpecs('median:Montant');
  const sort = '{"sorts":[{"name":"Montant","order":"asc"},{"name":"Ville","order":"desc"}]}';
  assert.equal(buildPluginAggregateRequest(['Ville'], specs, sort, false, false), null, 'not required: the reading of the rows');
  assert.deepEqual(buildPluginAggregateRequest(['Ville'], specs, sort, false, true).sorts, [{ name: 'Ville', desc: true }],
    'the groups follow the sort on their own columns');
  assert.deepEqual(buildPluginAggregateRequest([], specs, '-Montant', false, true).sorts, [], 'a Baserow order_by text sorts no summary');
  assert.equal(buildPluginAggregateRequest([], specs, null, true, true), null, 'the model of the viewer reads the rows');
});

test('a summary or an aggregation only the plugin computes requires the plugin', () => {
  const legacy = parseAggregationSpecs('count,sum:Montant');
  assert.equal(describePluginRequirement(['Ville'], legacy, false), null, 'grouped count and sum: the rows read without it');
  assert.match(describePluginRequirement([], legacy, false), /without Group by/);
  assert.match(describePluginRequirement(['Ville'], parseAggregationSpecs('count,median:Montant,distribution:Ville'), false),
    /^The aggregations median:Montant, distribution:Ville are computed by the c8oforms plugin of Baserow$/);
  assert.equal(describePluginRequirement([], legacy, true), null, 'the model of the viewer');
  assert.equal(describePluginRequirement(null, null, false), null, 'no aggregation');
});

// ParseConfig from the plugin request to its use, the symbols taking their values
const runConfig = ({ store = null, now = 1000, symbols = {}, groupByColumns = ['Ville'], aggregations = 'median:Montant', modelMode = false } = {}) => {
  const code = parseConfig.slice(parseConfig.indexOf('var buildPluginAggregateRequest'), parseConfig.indexOf('pluginGroups = null;'))
    .replace(/\$\{([^=}]+)=([^}]*)\}/g, (all, name, value) => (name in symbols ? symbols[name] : value));
  return new Function('context', 'java', 'groupByColumns', 'aggregationSpecs', 'order_by', 'isModelMode', 'view_id',
    code + 'return { pluginAggregate, pluginRequirement, pluginRequiredError };')(
    { project: { get: () => store } },
    { lang: { System: { currentTimeMillis: () => now } } },
    groupByColumns, parseAggregationSpecs(aggregations), null, modelMode, null);
};

test('without the plugin, the source answers an error before reading any row', () => {
  const asked = runConfig();
  assert.ok(asked.pluginAggregate, 'the plugin is asked');
  assert.equal(asked.pluginRequiredError, null);
  const absent = runConfig({ store: new Map([['https://baserow-backend.convertigo.net:443', 2000]]) });
  assert.equal(absent.pluginAggregate, null);
  assert.equal(absent.pluginRequiredError, 'The aggregations median:Montant are computed by the c8oforms plugin of Baserow: the plugin is not installed on this Baserow.');
  assert.match(runConfig({ symbols: { 'lib_baserow.c8o_aggregate': 'false' } }).pluginRequiredError, /lib_baserow\.c8o_aggregate is false/);
  assert.match(runConfig({ symbols: { 'lib_baserow.raw_json': 'false' } }).pluginRequiredError, /raw_json/);
  assert.match(runConfig({ groupByColumns: [], aggregations: 'count', symbols: { 'lib_baserow.c8o_aggregate': 'false' } }).pluginRequiredError,
    /without Group by/);
  // what the reading of the rows computes keeps reading them without the plugin
  assert.equal(runConfig({ aggregations: 'count,sum:Montant', symbols: { 'lib_baserow.c8o_aggregate': 'false' } }).pluginRequiredError, null);
  assert.equal(runConfig({ modelMode: true, symbols: { 'lib_baserow.c8o_aggregate': 'false' } }).pluginRequiredError, null, 'the model of the viewer');
  // the error ends the source right after ParseConfig
  const start = sequence.indexOf('↓ParseConfig [');
  const next = sequence.indexOf('\n↓', start + 1) + 1;
  assert.ok(sequence.startsWith('↓IfPluginRequired [steps.IfStep-', next));
  assert.match(sequence.slice(next, sequence.indexOf('\n↓', next + 1)),
    /condition: pluginRequiredError != null\n {2}↓Error_structure \[steps\.XMLErrorStep-\d+\]: [\s\S]*?→→: 101[\s\S]*?→→: pluginRequiredError\n {2}↓Return \[steps\.ReturnStep-\d+\]: $/);
});

const structure = [
  { name: 'Ville', type: 'text' },
  { name: 'Montant', type: 'number', number_decimal_places: 2 },
  { name: 'Quand', type: 'date', date_format: 'EU', date_include_time: false },
  { name: 'Payé', type: 'boolean' },
];

// ParseRawFirstPage, the plugin answer read
const runFirstPage = (rawAggregate, specs, requirement) => {
  const warnings = [];
  const absent = new Map();
  absent.put = absent.set;
  const scope = {
    log: { warn: (m) => warnings.push(m), info() {} },
    context: { project: { get: () => absent, set() {} } },
    java: { lang: { System: { currentTimeMillis: () => 0 }, Long: { valueOf: (v) => v } }, util: { concurrent: { ConcurrentHashMap: Map } } },
    raw_page: null, raw_error: null, next_page: null, raw_fields: null, results: undefined, page: '1', readTable: false,
    structure, aggregationSpecs: specs, pluginAggregate: { group_by: '[]' }, raw_aggregate: rawAggregate, pluginGroups: null,
    pluginBaserowUrl: 'https://baserow:443', pluginRequirement: requirement, pluginRequiredError: null,
    aggregate_group_by: '[]', aggregate_aggregations: '[]', pagedRead: false,
  };
  new Function('scope', `with (scope) { ${parseRawFirstPage} }`)(scope);
  return { scope, warnings, absent };
};

test('the aggregations only the plugin computes are taken on any column the plugin accepts', () => {
  const groups = [{ count: 2, c8o_first: 1, c8o_order: '1', c8o_a0: '2024-01-03' }];
  const answer = JSON.stringify({ count: 1, results: groups });
  assert.deepEqual(readPluginAggregate(answer, structure, parseAggregationSpecs('earliest_date:Quand,unique_count:Ville')), { groups });
  assert.deepEqual(readPluginAggregate(answer, structure, parseAggregationSpecs('min:Quand')), { groups }, 'min of a date too');
  const { scope } = runFirstPage(answer, parseAggregationSpecs('earliest_date:Quand'), 'The aggregations earliest_date:Quand are computed by the c8oforms plugin of Baserow');
  assert.deepEqual(scope.pluginGroups, groups);
  assert.equal(scope.pluginRequiredError, null);
  assert.equal(scope.raw_error, null);
});

test('a refusal or the absence of the plugin is the error of the source, the rows are not read again', () => {
  const requirement = 'The aggregations median:Ville are computed by the c8oforms plugin of Baserow';
  const refused = runFirstPage(JSON.stringify({ error: 'ERROR_C8O_AGGREGATE_AGGREGATION_NOT_SUPPORTED', detail: 'The aggregation median does not apply to the field "Ville" of type text.' }),
    parseAggregationSpecs('median:Ville'), requirement);
  assert.equal(refused.scope.pluginRequiredError, requirement + ': ERROR_C8O_AGGREGATE_AGGREGATION_NOT_SUPPORTED: The aggregation median does not apply to the field "Ville" of type text.');
  assert.notEqual(refused.scope.readTable, true, 'the table is not read again');
  assert.equal(refused.scope.raw_error, null, 'not an unreadable page: the error of the aggregations');
  assert.equal(refused.scope.pluginAggregate, null);
  const absent = runFirstPage('<html>Not Found</html>', parseAggregationSpecs('median:Montant'), requirement);
  assert.match(absent.scope.pluginRequiredError, /: the plugin is not installed on this Baserow \(not JSON/);
  assert.equal(absent.absent.size, 1, 'remembered for 5 minutes');
  const tooMany = runFirstPage(JSON.stringify({ count: 6000, results: [{}] }), parseAggregationSpecs('median:Montant'), requirement);
  assert.match(tooMany.scope.pluginRequiredError, /more groups \(6000\)/);
  // without a requirement, the rows are read again as before
  const legacy = runFirstPage('<html>Not Found</html>', parseAggregationSpecs('sum:Montant'), null);
  assert.equal(legacy.scope.readTable, true);
  assert.equal(legacy.scope.pluginRequiredError, null);
});

test('the error reaches the answer through the aggregation error, never through the native steps', () => {
  assert.match(computeData, /var aggregationError = typeof pluginRequiredError != "undefined" \? pluginRequiredError : null;/);
  assert.match(computeData, /if \(aggregationError == null && aggregationSpecs != null && "structure" in this\) \{/);
  assert.match(stepProperty(sequence, 'NativeOrJs', 'expression'), /pluginGroups == null && pluginRequiredError == null && /);
});

test('the values of the plugin: counts, shares of the rows, statistics, dates and distributions', () => {
  const specs = parseAggregationSpecs('empty_count:Montant,not_empty_percentage:Montant,checked_percentage:Payé,median:Montant,latest_date:Quand,unique_count:Ville');
  const group = { count: 4, c8o_a0: 1, c8o_a1: 3, c8o_a2: 1, c8o_a3: 15.25, c8o_a4: '2024-01-09', c8o_a5: 2 };
  assert.deepEqual(specs.map((spec, index) => pluginAggregateValue(group, spec, index)), [1, 75, 25, 15.25, '2024-01-09', 2]);
  // no rows: no share, as Baserow
  assert.equal(pluginAggregateValue({ count: 0, c8o_a1: 0 }, specs[1], 1), null);
  assert.equal(pluginAggregateValue({ count: 3, c8o_a3: null }, specs[3], 3), null);
  const distribution = parseAggregationSpecs('distribution:Ville')[0];
  assert.deepEqual(pluginAggregateValue({ count: 12, c8o_a0: [{ value: 'Paris', count: 6 }, { value: null, count: 2 }] }, distribution, 0), [
    { value: 'Paris', count: 6, percentage: 50 },
    { value: null, count: 2, percentage: 16.67 },
    { others: true, count: 4, percentage: 33.33 },
  ], 'the rows of the other values after the top values');
  assert.deepEqual(pluginAggregateValue({ count: 0, c8o_a0: [] }, distribution, 0), []);
});

test('the cells of the new aggregations', () => {
  const montant = { name: 'Montant', type: 'number', number_decimal_places: 0 };
  const quand = structure[2];
  const cell = (aggregations, value, field) => {
    const spec = parseAggregationSpecs(aggregations)[0];
    spec.field = field;
    return buildAggregateCell(spec, value);
  };
  const percent = cell('empty_percentage:Montant', 100 / 3, montant);
  assert.deepEqual([percent.value, percent.displayValue, percent.cType], [33.33, '<p>33%</p>', 'number']);
  const median = cell('median:Montant=Médiane', 15.25, montant);
  assert.deepEqual([median.value, median.displayValue, median.label, median.aggregationType], [15.25, '<p>15.25</p>', 'Médiane', 'median']);
  assert.equal(cell('std_dev:Montant', 38.552521, montant).displayValue, '<p>38.55</p>');
  assert.equal(cell('unique_count:Montant', 2, montant).displayValue, '<p>2</p>');
  const latest = cell('latest_date:Quand', '2024-01-09', quand);
  assert.deepEqual([latest.value, latest.displayValue, latest.cType], ['2024-01-09', '<p>09/01/2024</p>', 'text']);
  assert.equal(cell('earliest_date:Quand', null, quand).displayValue, '<p></p>');
  const distribution = cell('distribution:Montant', [
    { value: '10.50', count: 2, percentage: 50 }, { value: null, count: 1, percentage: 25 }, { others: true, count: 1, percentage: 25 },
  ], montant);
  assert.equal(distribution.displayValue, '<p><div>11 <span style="opacity:.7">(2) 50%</span></div>' +
    '<div>— <span style="opacity:.7">(1) 25%</span></div><div>… <span style="opacity:.7">(1) 25%</span></div></p>');
  assert.equal(distribution.cType, 'text');
  // the text of the table is escaped
  assert.equal(cell('distribution:Ville', [{ value: '<img src=x onerror=alert(1)>', count: 1, percentage: 100 }], structure[0]).displayValue,
    '<p><div>&lt;img src=x onerror=alert(1)&gt; <span style="opacity:.7">(1) 100%</span></div></p>');
  assert.match(cell('distribution:Payé', [{ value: true, count: 1, percentage: 100 }], structure[3]).displayValue, /&#10003;/);
});

test('a checked count applies to booleans, an earliest date to dates', () => {
  assert.equal(getAggregationFieldKind({ type: 'boolean' }), 'boolean');
  assert.equal(getAggregationFieldKind({ type: 'formula', formula_type: 'boolean' }), 'boolean');
  for (const type of ['date', 'created_on', 'last_modified']) assert.equal(getAggregationFieldKind({ type }), 'date', type);
  assert.equal(getAggregationFieldKind({ type: 'formula', formula_type: 'date' }), 'date');
  assert.equal(getAggregationFieldKind({ type: 'number' }), null);
  assert.equal(getAggregationFieldKind({ type: 'lookup', formula_type: 'array' }), null);
  assert.match(computeData, /aggregationError = "The aggregation '" \+ currentAggregationSpec\.type \+ "' only applies to " \+ currentAggregationSpec\.fieldKind \+ " columns\./);
});

test('the rows read for the model of the viewer give no value to the aggregations of the plugin', () => {
  const state = {};
  updateAggregationState(state, parseAggregationSpecs('median:Montant')[0], { value: '12' });
  assert.deepEqual(state, {});
  const sum = {};
  updateAggregationState(sum, parseAggregationSpecs('sum:Montant')[0], { value: '12' });
  assert.equal(sum.value, 12);
});

// Without the plugin, the reading of the rows compared dates as numbers: parseFloat("2024-03-05") is 2024, the min of a
// date column was the first date read of the earliest year.
test('the reading of the rows compares dates in time order', () => {
  const run = (aggregation, field, values) => {
    const spec = parseAggregationSpecs(aggregation)[0];
    spec.field = field;
    const state = {};
    for (const value of values) updateAggregationState(state, spec, value === undefined ? null : { value });
    return state.value;
  };
  const date = { type: 'date' };
  const days = ['2024-06-11', '2024-01-03', null, '2023-12-31', '2024-12-01', undefined];
  assert.equal(run('min:Quand', date, days), '2023-12-31');
  assert.equal(run('max:Quand', date, days), '2024-12-01');
  assert.equal(run('min:Quand', date, ['2024-06-11', '2024-01-03']), '2024-01-03', 'the same year');
  // with time: the fraction of the seconds may be absent or shorter, the zone may be an offset
  const times = ['2024-05-01T08:07:00.5Z', '2024-05-01T08:07:00Z', '2024-05-01T08:07:00.123456Z', '2024-05-01T09:00:00+02:00'];
  for (const type of [{ type: 'last_modified' }, { type: 'created_on' }, { type: 'formula', formula_type: 'date' }, date]) {
    assert.equal(run('min:Quand', type, times), '2024-05-01T09:00:00+02:00', type.type);
    assert.equal(run('max:Quand', type, times), '2024-05-01T08:07:00.5Z', type.type);
  }
  // a number column keeps its numeric order, a text its text order
  assert.equal(run('min:N', { type: 'number' }, ['10', '9.5', '100']), '9.5');
  assert.equal(run('max:T', { type: 'text' }, ['b', 'a', 'c']), 'c');
});

test('the sort key of a date of Baserow', () => {
  assert.equal(getDateSortKey('2024-03-05'), '2024-03-05');
  assert.equal(getDateSortKey('2024-03-05T08:07:00Z'), '2024-03-05T08:07:00.000000000Z');
  assert.equal(getDateSortKey('2024-03-05T08:07Z'), '2024-03-05T08:07:00.000000000Z');
  assert.equal(getDateSortKey('2024-03-05T08:07:00.123456Z'), '2024-03-05T08:07:00.123456000Z');
  assert.equal(getDateSortKey('2024-03-05 08:07:00.1+00:00'), '2024-03-05T08:07:00.100000000Z');
  assert.equal(getDateSortKey('2024-03-05T08:07:00+01:00'), '2024-03-05T07:07:00.000000000Z');
  assert.equal(getDateSortKey('05/03/2024'), null);
  assert.equal(getDateSortKey('2024'), null);
});
