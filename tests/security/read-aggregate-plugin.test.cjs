// lib_baserow.c8o_aggregate: the groups and aggregates of a grouped source computed by the c8oforms Baserow plugin, with the
// same answer as the reading of the rows, and a new reading of the rows whenever the plugin cannot answer.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readSequence, readProjectFile, stepProperty } = require('./read-yaml-steps.cjs');

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
const load = (code, name) => new Function(functionSource(code, name) + `\nreturn ${name};`)();

const buildPluginAggregateRequest = load(parseConfig, 'buildPluginAggregateRequest');
const readPluginAggregate = load(parseRawFirstPage, 'readPluginAggregate');
const pluginGroupRows = load(computeData, 'pluginGroupRows');
const pluginAggregateValue = new Function(functionSource(computeData, 'getAggregationFieldKind') + '\n' +
  functionSource(computeData, 'pluginAggregateValue') + '\nreturn pluginAggregateValue;')();

const specs = [
  { type: 'count', column: null, key: 'count' },
  { type: 'sum', column: 'Montant', key: 'sum_Montant' },
  { type: 'max', column: 'Montant', key: 'max_Montant' },
];

test('the request groups by the columns and names the aggregates c8o_a<index>', () => {
  const request = buildPluginAggregateRequest(['Ville', 'Statut'], specs, null, false);
  assert.deepEqual(JSON.parse(request.group_by), ['Ville', 'Statut']);
  assert.deepEqual(JSON.parse(request.aggregations), [
    'c8o_first=first:id', 'c8o_order=min:order', 'c8o_a1=sum:Montant', 'c8o_a2=max:Montant',
  ]);
  // a column name with = or : stays after the alias of our own
  const odd = buildPluginAggregateRequest(['A'], [{ type: 'avg', column: 'x=y:z', key: 'avg_x=y:z' }], '', false);
  assert.deepEqual(JSON.parse(odd.aggregations).slice(2), ['c8o_a0=avg:x=y:z']);
});

test('no plugin request when its answer could differ from the reading of the rows', () => {
  assert.equal(buildPluginAggregateRequest(null, specs, null, false), null, 'not grouped');
  assert.equal(buildPluginAggregateRequest(['Ville'], specs, '-Montant', false), null, 'a Baserow order_by text: read as is by the rows');
  assert.equal(buildPluginAggregateRequest(['Ville'], specs, null, true), null, 'model of the viewer');
  assert.equal(buildPluginAggregateRequest(['Ville'], [{ type: 'median', column: 'Montant' }], null, false), null);
  assert.equal(buildPluginAggregateRequest(['Ville'], [{ type: 'sum', column: '' }], null, false), null);
  assert.ok(buildPluginAggregateRequest(['Ville'], specs, 'null', false), 'an empty sort is no sort');
  assert.ok(buildPluginAggregateRequest(['Ville'], specs, '{"sorts":[]}', false), 'the viewer sends an empty sort list');
  assert.ok(buildPluginAggregateRequest(['Ville'], specs, '{"sorts":[{"name":""}]}', false));
  assert.ok(buildPluginAggregateRequest(['Ville'], specs, '{not json', false), 'TableGetData drops an unreadable sort too');
  assert.equal(buildPluginAggregateRequest(['Ville'], specs, '{"sorts":[{"name":"Montant","order":"asc"}]}', false), null);
  assert.equal(buildPluginAggregateRequest(['Ville'], specs, '{"sorts":[{"name":"Ville","order":"asc"},{"name":"Montant","order":"asc"}]}', false),
    null, 'a sort on another column too orders the rows inside the groups');
});

// A grouped source sorted on its own column (count by month sorted by month) read the first max_search_results rows
// only: one group of 1000 actions instead of the 30 months of the 50000 actions.
test('a sort on grouped columns keeps the plugin, the sort going with the request', () => {
  const byMonth = buildPluginAggregateRequest(['Mois'], specs, '{"sorts":[{"name":"Mois","order":"asc"}]}', false);
  assert.ok(byMonth, 'the plugin computes the groups on the whole table');
  assert.deepEqual(byMonth.sorts, [{ name: 'Mois', desc: false }]);
  assert.deepEqual(JSON.parse(byMonth.group_by), ['Mois']);
  const two = buildPluginAggregateRequest(['Statut', 'Type'], specs, '{"sorts":[{"name":"Type","order":"desc"},{"name":"Statut","order":"asc"}]}', false);
  assert.deepEqual(two.sorts, [{ name: 'Type', desc: true }, { name: 'Statut', desc: false }]);
  assert.deepEqual(buildPluginAggregateRequest(['Ville'], specs, null, false).sorts, [], 'no sort: the table order');
});

test('the groups of the plugin follow the sort of the source, as Baserow sorts the rows', () => {
  const group = (value, order, first) => ({ Val: value, count: 1, c8o_first: first, c8o_order: String(order) });
  const names = (rows) => rows.map((row) => {
    const value = row.Val;
    return value != null && typeof value === 'object' ? value.value : value;
  });
  // a number of Baserow is a text: 10 after 9
  const numbers = [group('10.00', 1, 1), group('9.50', 2, 2), group(null, 3, 3), group('100.00', 4, 4)];
  const number = { Val: { type: 'number' } };
  assert.deepEqual(names(pluginGroupRows(numbers, ['Val'], [{ name: 'Val', desc: false }], number)), [null, '9.50', '10.00', '100.00'],
    'the empty first in ascending order');
  assert.deepEqual(names(pluginGroupRows(numbers, ['Val'], [{ name: 'Val', desc: true }], number)), ['100.00', '10.00', '9.50', null],
    'the empty last in descending order');
  // a select by its option, a rating by its number
  const selects = [group({ id: 3, value: 'Realisee' }, 1, 1), group({ id: 1, value: 'En cours' }, 2, 2), group({ id: 2, value: 'Bloquee' }, 3, 3)];
  assert.deepEqual(names(pluginGroupRows(selects, ['Val'], [{ name: 'Val', desc: false }], { Val: { type: 'single_select' } })),
    ['Bloquee', 'En cours', 'Realisee']);
  const ratings = [group(5, 1, 1), group(0, 2, 2), group(3, 3, 3)];
  assert.deepEqual(names(pluginGroupRows(ratings, ['Val'], [{ name: 'Val', desc: false }], { Val: { type: 'rating' } })), [0, 3, 5]);
  // months as text, without a field description
  const months = [group('2025-06', 1, 1), group('2024-01', 2, 2), group('2024-12', 3, 3)];
  assert.deepEqual(names(pluginGroupRows(months, ['Val'], [{ name: 'Val', desc: false }])), ['2024-01', '2024-12', '2025-06']);
  // the groups equal on the sort keep the table order of their first rows
  const ties = [
    { A: 'x', B: 'b', count: 1, c8o_first: 7, c8o_order: '7' },
    { A: 'x', B: 'a', count: 1, c8o_first: 2, c8o_order: '2' },
    { A: 'w', B: 'c', count: 1, c8o_first: 9, c8o_order: '9' },
  ];
  assert.deepEqual(pluginGroupRows(ties, ['A', 'B'], [{ name: 'A', desc: false }], {}).map((row) => row.id), [9, 2, 7]);
  // without a sort, the table order as before
  assert.deepEqual(pluginGroupRows(ties, ['A', 'B'], [], {}).map((row) => row.id), [2, 7, 9]);
});

test('the source passes the sort of the request and the fields of the table to the groups', () => {
  assert.match(computeData, /results = pluginGroupRows\(pluginGroups, groupByColumns, pluginAggregate\.sorts, pluginFieldsByName\);/);
});

test('the plugin is on unless lib_baserow.c8o_aggregate is false, and needs raw_json', () => {
  assert.match(parseConfig, /"\$\{lib_baserow\.c8o_aggregate=true\}" != "false" && "\$\{lib_baserow\.raw_json=true\}" == "true"/);
});

test('a Baserow without the plugin is not asked again for 5 minutes, per address of Baserow', () => {
  // URL_NOT_FOUND (no route /api/c8o/) or an answer that is not JSON: the plugin is absent
  assert.equal(readPluginAggregate(answer({ error: 'URL_NOT_FOUND', detail: 'URL /api/c8o/aggregate/table/1/ not found.' }), structure, specs).absent, true);
  assert.equal(readPluginAggregate('<html>Not Found</html>', structure, specs).absent, true);
  assert.equal(readPluginAggregate('<html><head><title>404 Not Found</title></head><body>nginx</body></html>', structure, specs).absent, true);
  // a refusal of the plugin is not its absence
  assert.ok(!readPluginAggregate(answer({ error: 'ERROR_C8O_AGGREGATE_FIELD_NOT_FOUND' }), structure, specs).absent);
  // nor an error page of Baserow: a sum of a formula holding NaN made the plugin answer 500 to one source, and the
  // plugin was no longer asked for 5 minutes by any source of the server
  const serverError = '<!doctype html>\n<html lang="en">\n<head>\n  <title>Server Error (500)</title>\n</head>\n<body>\n  <h1>Server Error (500)</h1><p></p>\n</body>\n</html>\n';
  assert.ok(!readPluginAggregate(serverError, structure, specs).absent);
  assert.match(readPluginAggregate(serverError, structure, specs).reason, /error of Baserow/);
  assert.ok(!readPluginAggregate('<html><body>502 Bad Gateway</body></html>', structure, specs).absent);
  for (const name of ['formssource_GetTableData']) {
    const yaml = readSequence(name);
    const config = stepProperty(yaml, 'ParseConfig', 'expression');
    // the request is skipped while the absence is remembered for this address
    const run = (store, now) => new Function('context', 'java', 'groupByColumns', 'aggregationSpecs', 'order_by', 'isModelMode', 'view_id',
      // the symbols take their default values
      config.slice(config.indexOf('var buildPluginAggregateRequest'), config.indexOf('pluginGroups = null;'))
        .replace(/\$\{[^=}]+=([^}]*)\}/g, '$1') + 'return pluginAggregate;')(
      { project: { get: () => store } },
      { lang: { System: { currentTimeMillis: () => now } } },
      ['Ville'], specs, null, false, null);
    const address = 'https://baserow-backend.convertigo.net:443';
    assert.ok(run(null, 1000), `${name}: asked when nothing is remembered`);
    assert.equal(run(new Map([[address, 2000]]), 1000), null, `${name}: not asked while absent`);
    assert.ok(run(new Map([[address, 2000]]), 2000), `${name}: asked again after 5 minutes`);
    assert.ok(run(new Map([['http://other:80', 2000]]), 1000), `${name}: another Baserow is asked`);
    const read = stepProperty(yaml, 'ParseRawFirstPage', 'expression');
    assert.match(read, /if \(pluginAnswer\.absent\) \{[\s\S]*?pluginAbsentKeep\.put\(pluginBaserowUrl, java\.lang\.Long\.valueOf\(java\.lang\.System\.currentTimeMillis\(\) \+ 300000\)\);/, name);
  }
});

const structure = [
  { name: 'Ville', type: 'text' },
  { name: 'Montant', type: 'number', number_decimal_places: 2 },
  { name: 'Note', type: 'rating' },
  { name: 'Quand', type: 'date' },
  { name: 'Durée', type: 'duration' },
];
const answer = (body) => JSON.stringify(body);

test('the groups of a valid answer are used', () => {
  const groups = [{ Ville: 'Paris', count: 3, c8o_first: 1, c8o_order: '1.00000000000000000000' }];
  assert.deepEqual(readPluginAggregate(answer({ count: 1, results: groups }), structure, specs), { groups });
  assert.deepEqual(readPluginAggregate(answer({ results: groups }), structure[1], [specs[0]]).groups, groups);
});

// The reading of the rows compared dates as numbers, the year only (parseFloat("2024-03-05") is 2024): the min of a date
// column was a date of the first year, and on the first max_search_results rows only.
test('the min and max of a date column are the ones of the plugin', () => {
  const answerOf = answer({ results: [{ count: 2, c8o_a0: '2023-01-17' }] });
  for (const field of [{ name: 'D', type: 'date' }, { name: 'D', type: 'created_on' }, { name: 'D', type: 'last_modified' },
    { name: 'D', type: 'formula', formula_type: 'date' }]) {
    assert.ok(readPluginAggregate(answerOf, [field], [{ type: 'min', column: 'D' }]).groups, field.type);
    assert.ok(readPluginAggregate(answerOf, [field], [{ type: 'max', column: 'D' }]).groups, field.type);
    assert.ok(readPluginAggregate(answerOf, [field], [{ type: 'avg', column: 'D' }]).reason, `avg of a ${field.type}`);
  }
  assert.ok(readPluginAggregate(answerOf, [{ name: 'D', type: 'formula', formula_type: 'text' }], [{ type: 'min', column: 'D' }]).reason);
});

// The KPI of an application sum formula fields returning numbers (a 0/1 per row): the answer of the plugin was refused
// for its type "formula" and the whole table read again, while the reading sums them as numbers.
test('a formula, count or rollup returning a number is aggregated by the plugin like a number column', () => {
  const answerOf = answer({ results: [{ count: 2, c8o_a0: 21 }] });
  for (const field of [{ name: 'K', type: 'formula', formula_type: 'number' }, { name: 'K', type: 'count', formula_type: 'number' },
    { name: 'K', type: 'rollup', formula_type: 'number' }]) {
    for (const type of ['sum', 'avg', 'min', 'max']) {
      assert.ok(readPluginAggregate(answerOf, [field], [{ type, column: 'K' }]).groups, `${type} of a ${field.type}`);
    }
  }
  for (const field of [{ name: 'K', type: 'formula', formula_type: 'text' }, { name: 'K', type: 'formula', formula_type: 'array', array_formula_type: 'number' },
    { name: 'K', type: 'lookup', formula_type: 'array', array_formula_type: 'number' }, { name: 'K', type: 'formula' }]) {
    assert.match(readPluginAggregate(answerOf, [field], [{ type: 'sum', column: 'K' }]).reason, /of type (formula|lookup) \(/,
      `sum of a ${field.type} returning ${field.formula_type}`);
  }
});

test('the min and max of a formula returning a number keep the decimal places of its cells', () => {
  const field = { name: 'K', type: 'formula', formula_type: 'number', number_decimal_places: 2 };
  assert.equal(pluginAggregateValue({ count: 2, c8o_a0: 3.5 }, { type: 'max', column: 'K', field }, 0), '3.50');
  assert.equal(pluginAggregateValue({ count: 2, c8o_a0: '7' }, { type: 'min', column: 'K', field: { name: 'K', type: 'count', formula_type: 'number' } }, 0), '7');
  assert.equal(pluginAggregateValue({ count: 2, c8o_a0: 3.5 }, { type: 'sum', column: 'K', field }, 0), 3.5);
});

test('every answer the plugin cannot give exactly falls back on the reading of the rows', () => {
  const fallback = (text, s = structure, sp = specs) => readPluginAggregate(text, s, sp).reason;
  assert.ok(fallback(null), 'no answer');
  assert.ok(fallback(''), 'empty answer');
  assert.match(fallback('<html>Not Found</html>'), /not JSON/, 'plugin not installed: Baserow answers its 404 page');
  assert.match(fallback(answer({ error: 'ERROR_C8O_GROUP_BY_NOT_SUPPORTED', detail: 'link_row' })), /GROUP_BY_NOT_SUPPORTED/);
  assert.match(fallback(answer({ error: 'ERROR_C8O_INVALID_PARAMETER' })), /INVALID_PARAMETER/);
  assert.match(fallback(answer({ count: 5001, results: new Array(5000).fill({}) })), /more groups/);
  assert.ok(fallback(answer([1, 2])), 'unexpected answer');
  assert.ok(fallback(answer({ detail: 'x' })), 'no results');
  for (const column of ['Durée', 'Ville', 'Inconnue']) {
    assert.ok(fallback(answer({ results: [] }), structure, [{ type: 'max', column }]), `max on ${column}`);
  }
  assert.ok(fallback(answer({ results: [] }), structure, [{ type: 'sum', column: 'Quand' }]), 'sum on a date');
  assert.equal(fallback(answer({ results: [] }), structure, [{ type: 'avg', column: 'Note' }]), undefined);
});

test('the rows of the groups follow the first row of each in the table order', () => {
  const rows = pluginGroupRows([
    { Ville: 'Lyon', Statut: null, count: 2, c8o_first: 3, c8o_order: '3.00000000000000000000', c8o_a1: 5 },
    { Ville: 'Paris', Statut: { id: 1, value: 'Ouvert', color: 'blue' }, count: 3, c8o_first: 9, c8o_order: '0.50000000000000000000' },
  ], ['Ville', 'Statut']);
  assert.deepEqual(rows.map((row) => ({ ...row })), [
    { id: 9, order: '0.50000000000000000000', Ville: 'Paris', Statut: { id: 1, value: 'Ouvert', color: 'blue' } },
    { id: 3, order: '3.00000000000000000000', Ville: 'Lyon', Statut: null },
  ]);
  assert.equal(rows[1].__c8oAggregates.c8o_a1, 5, 'the aggregates stay on the row, not enumerable');
  assert.deepEqual(Object.keys(rows[1]), ['id', 'order', 'Ville', 'Statut']);
});

test('the aggregates take the values the reading of the rows computes', () => {
  const montant = { type: 'number', number_decimal_places: 2 };
  const group = { count: '4', c8o_a1: 135.5, c8o_a2: 100, c8o_a3: null, c8o_a4: 3 };
  assert.equal(pluginAggregateValue(group, { type: 'count' }, 0), 4);
  assert.equal(pluginAggregateValue(group, { type: 'sum', field: montant }, 1), 135.5);
  assert.equal(pluginAggregateValue(group, { type: 'max', field: montant }, 2), '100.00', 'the Baserow text of the number');
  assert.equal(pluginAggregateValue({ c8o_a2: -5 }, { type: 'min', field: { type: 'number', number_decimal_places: 0 } }, 2), '-5');
  assert.equal(pluginAggregateValue(group, { type: 'min', field: montant }, 3), null, 'no value in the group');
  assert.equal(pluginAggregateValue(group, { type: 'max', field: { type: 'rating' } }, 4), 3);
  // the min and max of a date: the value of its cell, as the rows endpoint writes it
  const dates = { c8o_a0: '2023-01-17', c8o_a1: '2026-10-15T16:36:31.353048Z' };
  assert.equal(pluginAggregateValue(dates, { type: 'min', field: { type: 'date' } }, 0), '2023-01-17');
  assert.equal(pluginAggregateValue(dates, { type: 'max', field: { type: 'last_modified' } }, 1), '2026-10-15T16:36:31.353048Z');
  assert.equal(pluginAggregateValue(dates, { type: 'max', field: { type: 'formula', formula_type: 'date' } }, 0), '2023-01-17');
  assert.equal(pluginAggregateValue({ c8o_a0: null }, { type: 'min', field: { type: 'date' } }, 0), null);
});

test('the plugin answer travels as text, without httpInfo, through TableGetDataNative', () => {
  const connector = readProjectFile('_c8oProject/connectors/Baserow_API_spec.yaml');
  const start = connector.indexOf('↓_api_c8o_aggregate_table__table_id___GET_raw [transactions.HttpTransaction]');
  assert.ok(start >= 0);
  const block = connector.slice(start, connector.indexOf('\n↓', start + 1));
  assert.doesNotMatch(block, /httpInfo: true/);
  assert.match(block, /subDir: \/api\/c8o\/aggregate\/table\/\{table_id\}\/\?\{filterExpression\}/);
  const tableGetData = readSequence('TableGetDataNative');
  assert.match(tableGetData, /↓Call_RawAggregate \[steps\.TransactionStep-\d+\]: \n {6}output: false\n {6}sourceTransaction: lib_BaseRow\.Baserow_API_spec\._api_c8o_aggregate_table__table_id___GET_raw/);
  assert.match(tableGetData, /condition: 'aggregate_group_by == null \|\| \(""\s*\+ aggregate_group_by\) == ""'/);
  // the source reads the table again when the plugin answer cannot be used
  assert.match(sequence, /↓ReadTable \[steps\.WhileStep-\d+\]: \n.*\n {2}condition: readTable === true/);
  assert.match(parseRawFirstPage, /readTable = true;/);
});

test('a group column the table does not have gives no key, as the rows read without it', () => {
  // unknown_group_by=ignore: the plugin drops the unknown reference and answers one group without its key
  const rows = pluginGroupRows([
    { Ville: 'Lyon', count: 5, c8o_first: 2, c8o_order: '2.00000000000000000000' },
  ], ['Ville', 'referent mail']);
  assert.deepEqual(Object.keys(rows[0]), ['id', 'order', 'Ville']);
  const json = readSequence('formssource_GetTableData');
  const jsonRows = load(stepProperty(json, 'ComputeData', 'expression'), 'pluginGroupRows')([
    { count: 5, c8o_first: 2, c8o_order: '2.00000000000000000000' },
  ], ['Id']);
  assert.deepEqual({ ...jsonRows[0] }, { id: 2, order: '2.00000000000000000000' });
});

test('a lookup group keeps the value of the plugin, the array of the rows endpoint', () => {
  const lookup = [{ id: 12, value: 'Dupont' }, { id: 15, value: 'Martin' }];
  const rows = pluginGroupRows([{ Noms: lookup, count: 2, c8o_first: 1, c8o_order: '1.00000000000000000000' }], ['Noms']);
  assert.deepEqual(rows[0].Noms, lookup);
});

test('the grouped reads ask the plugin to ignore a group column the table does not have', () => {
  const connector = readProjectFile('_c8oProject/connectors/Baserow_API_spec.yaml');
  const start = connector.indexOf('↓_api_c8o_aggregate_table__table_id___GET_raw [transactions.HttpTransaction]');
  const block = connector.slice(start, connector.indexOf('\n↓', start + 1));
  // any other caller keeps the refusal of the plugin
  assert.match(block, /↓unknown_group_by \[variables\.RequestableHttpVariable-\d+\]: \n(?: {4}.*\n)*? {4}httpName: unknown_group_by\n {4}value: error\n/);
  for (const name of ['TableGetDataNative']) {
    const yaml = readSequence(name);
    const call = yaml.slice(yaml.indexOf('↓Call_RawAggregate'), yaml.indexOf('↓rawAggregate', yaml.indexOf('↓Call_RawAggregate')));
    assert.match(call, /↓unknown_group_by \[variables\.StepVariable-\d+\]: \n(?: {8}.*\n)*? {8}value: ignore\n/, name);
  }
});
