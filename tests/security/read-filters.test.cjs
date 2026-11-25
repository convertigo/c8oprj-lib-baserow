const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readSequence, readProjectFile, stepProperty } = require('./read-yaml-steps.cjs');

const tableGetData = readSequence('TableGetDataNative');
// TableGetDataNative builds the sort (…020) before the filters (…026)
const filtersScript = stepProperty(tableGetData, 'BuildFilters [steps.SimpleStep-1994000000026]', 'expression');
const orderScript = stepProperty(tableGetData, 'BuildFilters [steps.SimpleStep-1994000000020]', 'expression');
// included by the step ParseFields, before the sort and the filters
const sortSourceScript = readProjectFile('js/field_sort_source.js');

const aFields = [
  { id: 1, name: 'Name', type: 'text' },
  { id: 2, name: 'City', type: 'single_select', select_options: [
    { id: 12, value: 'Paris' }, { id: 13, value: 'Lyon' }, { id: 14, value: '2024' },
  ] },
  { id: 3, name: 'Customer', type: 'link_row' },
  { id: 4, name: 'Active', type: 'boolean' },
  { id: 5, name: 'Is late', type: 'formula', formula_type: 'boolean' },
  { id: 6, name: 'Tags', type: 'multiple_select', select_options: [
    { id: 21, value: 'Red' }, { id: 22, value: 'Blue' },
  ] },
  { id: 7, name: 'Contract Value', type: 'number' },
  // an amount written "44 000" by a text formula (Mini CRM): ordered and compared by Contract Value
  { id: 8, name: 'Montant (€)', type: 'formula', formula_type: 'text',
    formula: "if(isblank(field('Contract Value')), '', concat(totext(trunc(round(field('Contract Value'), 0) / 1000)), ' ', " +
      "right(concat('00', totext(trunc(mod(round(field('Contract Value'), 0), 1000)))), 3)))" },
  { id: 9, name: 'Close', type: 'date' },
  { id: 10, name: 'Close text', type: 'formula', formula_type: 'text', formula: "datetime_format(field('Close'), 'DD/MM/YYYY')" },
  { id: 11, name: 'Label', type: 'formula', formula_type: 'text', formula: "concat(field('Name'), ' ', field('Contract Value'))" },
  { id: 12, name: 'Pipeline sum', type: 'formula', formula_type: 'text', formula: "totext(sum(lookup('Pipelines', 'Contract Value')))" },
  // fields Baserow cannot order the rows by (ERROR_ORDER_BY_FIELD_NOT_POSSIBLE), and orderable neighbours
  { id: 13, name: 'Photo', type: 'file' },
  { id: 14, name: 'Pièces jointes', type: 'file' },
  { id: 15, name: 'Scans, signed', type: 'file' },
  { id: 16, name: 'Secret', type: 'password' },
  { id: 17, name: 'Customer photos', type: 'lookup', formula_type: 'array', array_formula_type: 'single_file' },
  { id: 18, name: 'Customer names', type: 'lookup', formula_type: 'array', array_formula_type: 'text' },
  { id: 19, name: 'First photo', type: 'formula', formula_type: 'single_file', array_formula_type: null },
  { id: 20, name: 'Tag list', type: 'formula', formula_type: 'multiple_select', array_formula_type: null },
  { id: 21, name: 'Open', type: 'formula', formula_type: 'button', array_formula_type: null },
  { id: 22, name: 'Team', type: 'multiple_collaborators' },
  { id: 23, name: 'Customer tags', type: 'lookup', formula_type: 'array', array_formula_type: 'multiple_select' },
];

function buildFilters(expression) {
  const sandbox = {
    aFields,
    filterExpression: JSON.stringify(expression),
    include_fields: 'Name',
    log: { warn() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(sortSourceScript, sandbox);
  vm.runInContext(filtersScript, sandbox);
  return sandbox;
}

function flat(...filters) {
  const result = buildFilters({ mode: 'AND', filters });
  assert.equal(result.bFieldError, false);
  assert.equal(result.filters, null, 'flat syntax expected');
  return decodeURIComponent(result.filterExpression);
}

function grouped(expression) {
  const result = buildFilters(expression);
  assert.equal(result.bFieldError, false);
  assert.equal(result.filterExpression, '');
  return JSON.parse(result.filters);
}

test('single select labels map to option ids only for the id filters', () => {
  assert.equal(flat({ field: 'City', op: 'single_select_equal', value: 'Paris' }), 'filter__field_2__single_select_equal=12&');
  assert.equal(flat({ field: 'City', op: 'single_select_not_equal', value: 'Lyon' }), 'filter__field_2__single_select_not_equal=13&');
  assert.equal(flat({ field: 'City', op: 'single_select_is_any_of', value: 'Paris,Lyon' }), 'filter__field_2__single_select_is_any_of=12,13&');
  assert.equal(flat({ field: 'City', op: 'single_select_is_none_of', value: '13, Paris' }), 'filter__field_2__single_select_is_none_of=13,12&');
  // An id stays an id, a numeric label that is no id maps to its id.
  assert.equal(flat({ field: 'City', op: 'single_select_equal', value: '12' }), 'filter__field_2__single_select_equal=12&');
  assert.equal(flat({ field: 'City', op: 'single_select_equal', value: '2024' }), 'filter__field_2__single_select_equal=14&');
  // Text filters keep comparing the option text.
  assert.equal(flat({ field: 'City', op: 'contains', value: 'Paris' }), 'filter__field_2__contains=Paris&');
  assert.equal(flat({ field: 'City', op: 'contains_word', value: 'Paris' }), 'filter__field_2__contains_word=Paris&');
  assert.equal(flat({ field: 'City', op: 'contains_not', value: 'Lyon' }), 'filter__field_2__contains_not=Lyon&');
});

// equal / not_equal are not single select filters for Baserow 1.34 (ERROR_VIEW_FILTER_TYPE_UNSUPPORTED_FIELD): a literal
// filter of a published form saved without the type of its field (C8Oforms scope) sends them on a single select.
test('equal and not_equal on a single select compare by option', () => {
  assert.equal(flat({ field: 'City', op: 'not_equal', value: 'Paris' }), 'filter__field_2__single_select_not_equal=12&');
  assert.equal(flat({ field: 'City', op: 'equal', value: 'Lyon' }), 'filter__field_2__single_select_equal=13&');
  assert.equal(flat({ field: 'City', op: 'equal', value: '14' }), 'filter__field_2__single_select_equal=14&');
  // a text of no option: equal keeps no row, not_equal keeps them all, Baserow accepts both
  assert.equal(flat({ field: 'City', op: 'equal', value: 'Annulé' }), 'filter__field_2__single_select_equal=-1&');
  assert.equal(flat({ field: 'City', op: 'not_equal', value: 'Annulé' }), 'filter__field_2__single_select_not_equal=-1&');
  // an empty equal still matches nothing, other fields keep their filter
  assert.equal(flat({ field: 'City', op: 'equal', value: '' }), 'filter__field_2__equal=__empty&');
  assert.equal(flat({ field: 'Name', op: 'not_equal', value: 'Paris' }), 'filter__field_1__not_equal=Paris&');
  // the grouped syntax too
  const built = JSON.stringify(grouped({ mode: 'AND', filters: [{ field: 'Name', op: 'contains', value: 'a' },
    { mode: 'OR', filters: [{ field: 'City', op: 'not_equal', value: 'Lyon' }, { field: 'Name', op: 'equal', value: 'x' }] }] }));
  assert.match(built, /"type":"single_select_not_equal","value":"13"/);
  assert.doesNotMatch(built, /"type":"not_equal"/);
});

test('the grouped syntax applies the same single select rule', () => {
  const built = grouped({ mode: 'AND', filters: [
    { field: 'Name', op: 'contains', value: 'a' },
    { mode: 'OR', filters: [
      { field: 'City', op: 'single_select_equal', value: 'Paris' },
      { field: 'City', op: 'contains', value: 'Lyon' },
    ] },
  ] });
  assert.deepEqual(built.groups[0].filters, [
    { field: 'City', type: 'single_select_equal', value: '12' },
    { field: 'City', type: 'contains', value: 'Lyon' },
  ]);
});

test('multiple select labels map to option ids for the has filters', () => {
  assert.equal(flat({ field: 'Tags', op: 'multiple_select_has', value: 'Red' }), 'filter__field_6__multiple_select_has=21&');
  assert.equal(flat({ field: 'Tags', op: 'multiple_select_has_not', value: 'Blue' }), 'filter__field_6__multiple_select_has_not=22&');
  assert.equal(flat({ field: 'Tags', op: 'multiple_select_has', value: '22' }), 'filter__field_6__multiple_select_has=22&');
  assert.equal(flat({ field: 'Tags', op: 'contains', value: 'Red' }), 'filter__field_6__contains=Red&');
  // single select id filters never map a multiple select, and the reverse
  assert.equal(flat({ field: 'Tags', op: 'single_select_equal', value: 'Red' }), 'filter__field_6__single_select_equal=Red&');
  assert.equal(flat({ field: 'City', op: 'multiple_select_has', value: 'Paris' }), 'filter__field_2__multiple_select_has=Paris&');
  const built = grouped({ mode: 'AND', filters: [{ mode: 'OR', filters: [
    { field: 'Tags', op: 'multiple_select_has', value: 'Red' },
    { field: 'Tags', op: 'multiple_select_has_not', value: 'Blue' },
  ] }] });
  assert.deepEqual(built.groups[0].filters, [
    { field: 'Tags', type: 'multiple_select_has', value: '21' },
    { field: 'Tags', type: 'multiple_select_has_not', value: '22' },
  ]);
});

test('an equal filter without value never throws and never matches everything', () => {
  assert.equal(flat({ field: 'Name', op: 'equal', value: null }), 'filter__field_1__equal=__empty&');
  assert.equal(flat({ field: 'Name', op: 'equal' }), 'filter__field_1__equal=__empty&');
  assert.equal(flat({ field: 'Name', op: 'equal', value: '' }), 'filter__field_1__equal=__empty&');
  const built = grouped({ mode: 'AND', filters: [{ mode: 'OR', filters: [{ field: 'Name', op: 'equal', value: null }] }] });
  assert.deepEqual(built.groups[0].filters, [{ field: 'Name', type: 'equal', value: '__empty' }]);
});

test('contains on a link_row uses the link_row text filters', () => {
  assert.equal(flat({ field: 'Customer', op: 'contains', value: 'Acme' }), 'filter__field_3__link_row_contains=Acme&');
  assert.equal(flat({ field: 'Customer', op: 'contains_not', value: 'Acme' }), 'filter__field_3__link_row_not_contains=Acme&');
});

test('contains on a boolean uses the boolean filter or matches nothing', () => {
  assert.equal(flat({ field: 'Active', op: 'contains', value: 'true' }), 'filter__field_4__boolean=1&');
  assert.equal(flat({ field: 'Active', op: 'contains', value: 'False' }), 'filter__field_4__boolean=0&');
  assert.equal(flat({ field: 'Active', op: 'contains_not', value: 'true' }), 'filter__field_4__boolean=0&');
  assert.equal(flat({ field: 'Is late', op: 'contains', value: '1' }), 'filter__field_5__boolean=1&');
  // Any other text can never be contained in a checkbox: an always-false group.
  const built = grouped({ mode: 'AND', filters: [{ field: 'Active', op: 'contains', value: 'abc' }] });
  assert.deepEqual(built, { filter_type: 'AND', filters: [], groups: [{ filter_type: 'AND', filters: [
    { field: 'Active', type: 'boolean', value: '1' },
    { field: 'Active', type: 'boolean', value: '0' },
  ] }] });
});

test('an unknown filter field is still an error in both syntaxes', () => {
  assert.equal(buildFilters({ mode: 'AND', filters: [{ field: 'Nope', op: 'contains', value: 'x' }] }).bFieldError, true);
  assert.equal(buildFilters({ mode: 'AND', filters: [{ mode: 'OR', filters: [{ field: 'Nope', op: 'equal', value: 'x' }] }] }).bFieldError, true);
});

function runOrderBy(value, fields = aFields) {
  const logs = [];
  const sandbox = { order_by: value, aFields: fields, log: { info(message) { logs.push(String(message)); }, warn() {}, debug() {} } };
  vm.createContext(sandbox);
  vm.runInContext(sortSourceScript, sandbox);
  vm.runInContext(orderScript, sandbox);
  return { orderBy: sandbox.order_by, logs };
}

function orderBy(value, fields) {
  return runOrderBy(value, fields).orderBy;
}

const sorts = (...names) => JSON.stringify({ sorts: names.map((name) => name.startsWith('-') ?
  { name: name.substring(1), order: 'desc' } : { name, order: 'asc' }) });

// Baserow 1.34 cannot order by a file (ERROR_ORDER_BY_FIELD_NOT_POSSIBLE) and then fails the whole read: the grid of
// a table imported from SharePoint (Photo, Pièces jointes) answered "Des données n'ont pas pu être chargées".
test('a sort on a file column is dropped: the rows are read unsorted, not an error', () => {
  assert.equal(orderBy(sorts('-Photo')), null);
  assert.equal(orderBy(sorts('Pièces jointes')), null);
  assert.equal(orderBy(sorts('Photo', '-Pièces jointes')), null);
  const { logs } = runOrderBy(sorts('-Photo', 'Name'));
  assert.deepEqual(logs, ['Sort dropped, Baserow cannot order the rows by: Photo']);
  assert.deepEqual(runOrderBy(sorts('Name')).logs, []);
});

test('a mixed sort keeps the names Baserow can order, in their order and direction', () => {
  assert.equal(orderBy(sorts('Name', '-Photo', '-Contract Value', 'Secret', 'Customer names')), 'Name,-Contract Value,Customer names');
  // the text formula still orders by its number field
  assert.equal(orderBy(sorts('Pièces jointes', '-Montant (€)')), '-Contract Value');
});

test('a formula or a lookup is dropped only when Baserow cannot order its result', () => {
  for (const name of ['Secret', 'Customer photos', 'First photo', 'Tag list', 'Open', 'Customer tags']) {
    assert.equal(orderBy(sorts(name)), null, name);
  }
  // arrays of texts, boolean formulas, links, selects and collaborators are ordered by Baserow
  assert.equal(orderBy(sorts('Customer names', '-Is late', 'Customer', 'City', '-Tags', 'Team')), 'Customer names,-Is late,Customer,City,-Tags,Team');
});

test('without the fields of the table, the sorts are sent as they are', () => {
  assert.equal(orderBy(sorts('-Photo', 'Name'), null), '-Photo,Name');
  assert.equal(orderBy('Photo,-Name', null), 'Photo,-Name');
  // an unknown name is left to Baserow (ORDER_BY_FIELD_NOT_FOUND), as before
  assert.equal(orderBy(sorts('Nope')), 'Nope');
});

test('quoted sort names still work around a dropped file column', () => {
  assert.equal(orderBy(sorts('-Scans, signed', 'City, country', '-Photo', 'Say "hi"')), '"City, country","Say \\"hi\\""');
  assert.equal(orderBy(sorts('-Scans, signed')), null);
});

test('a plain Baserow order_by string drops the file columns too, keeping the others as written', () => {
  assert.equal(orderBy('Name,-Photo'), 'Name');
  assert.equal(orderBy('-Photo'), null);
  assert.equal(orderBy('+Pièces jointes,-Contract Value'), '-Contract Value');
  assert.equal(orderBy('"-Scans, signed",Name,"Say \\"hi\\"",-Photo'), 'Name,"Say \\"hi\\""');
  assert.equal(orderBy('"Size, cm","-Pièces jointes"'), '"Size, cm"');
  assert.equal(orderBy('"Say ""hi""",Photo'), '"Say ""hi"""');
  assert.equal(orderBy('Scans\\, signed,Name'), 'Name');
  // nothing dropped: the string is sent untouched
  assert.equal(orderBy('"City, country",-Name'), '"City, country",-Name');
});

test('order_by accepts the JSON sorts and a plain Baserow string', () => {
  assert.equal(orderBy(JSON.stringify({ sorts: [{ name: 'Name', order: 'asc' }, { name: 'Age', order: 'desc' }] })), 'Name,-Age');
  assert.equal(orderBy('Name,-Age'), 'Name,-Age');
  assert.equal(orderBy('  -Age  '), '-Age');
  assert.equal(orderBy(''), null);
  assert.equal(orderBy(JSON.stringify({ sorts: [] })), null);
  assert.equal(orderBy('{bad json'), null);
});

test('order_by quotes the sort names Baserow would split', () => {
  assert.equal(orderBy(JSON.stringify({ sorts: [
    { name: 'City, country', order: 'asc' },
    { name: 'Size, cm', order: 'desc' },
    { name: 'Say "hi"', order: 'asc' },
  ] })), '"City, country","-Size, cm","Say \\"hi\\""');
});

test('TableGetDataApiKey: an equal filter without value never throws', () => {
  const script = stepProperty(readSequence('TableGetDataApiKey'), 'BuildFilters', 'expression');
  const sandbox = {
    aFields: [{ id: 1, name: 'Name' }],
    filterExpression: JSON.stringify({ mode: 'AND', filters: [{ field: 'Name', op: 'equal', value: null }] }),
    log: { warn() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  assert.equal(sandbox.filterExpression, 'filter__field_1__equal=__empty&');
});

test('TableGetDataApiKey: equal and not_equal on a single select compare by option', () => {
  const script = stepProperty(readSequence('TableGetDataApiKey'), 'BuildFilters', 'expression');
  const run = (filters) => {
    const sandbox = {
      aFields: [{ id: 1, name: 'Name', type: 'text' }, { id: 2, name: 'City', type: 'single_select', select_options: [
        { id: 12, value: 'Paris' }, { id: 13, value: 'Lyon' }] }],
      filterExpression: JSON.stringify({ mode: 'AND', filters }),
      log: { warn() {} },
    };
    vm.createContext(sandbox);
    vm.runInContext(script, sandbox);
    return sandbox.filterExpression;
  };
  assert.equal(run([{ field: 'City', op: 'not_equal', value: 'Paris' }]), 'filter__field_2__single_select_not_equal=12&');
  assert.equal(run([{ field: 'City', op: 'equal', value: '13' }]), 'filter__field_2__single_select_equal=13&');
  assert.equal(run([{ field: 'City', op: 'equal', value: 'Annulé' }]), 'filter__field_2__single_select_equal=-1&');
  assert.equal(run([{ field: 'City', op: 'equal', value: '' }]), 'filter__field_2__equal=__empty&');
  assert.equal(run([{ field: 'Name', op: 'not_equal', value: 'Paris' }]), 'filter__field_1__not_equal=Paris&');
});

// Baserow orders a text formula as text: "9 000" came after "44 000", "01/10/2025" before "02/02/2024".
test('a text formula formatting one number or date field is ordered by that field', () => {
  assert.equal(orderBy(JSON.stringify({ sorts: [{ name: 'Montant (€)', order: 'desc' }] })), '-Contract Value');
  assert.equal(orderBy(JSON.stringify({ sorts: [{ name: 'Close text', order: 'asc' }, { name: 'Name', order: 'asc' }] })), 'Close,Name');
  // two fields, a lookup, or no formula: ordered as they are
  assert.equal(orderBy(JSON.stringify({ sorts: [{ name: 'Label', order: 'asc' }] })), 'Label');
  assert.equal(orderBy(JSON.stringify({ sorts: [{ name: 'Pipeline sum', order: 'asc' }] })), 'Pipeline sum');
  assert.equal(orderBy(JSON.stringify({ sorts: [{ name: 'Contract Value', order: 'asc' }] })), 'Contract Value');
});

test('a number or date comparison on such a formula compares its source field, a text one the formula', () => {
  assert.equal(flat({ field: 'Montant (€)', op: 'higher_than', value: '10000' }), 'filter__field_7__higher_than=10000&');
  assert.equal(flat({ field: 'Montant (€)', op: 'equal', value: '44000' }), 'filter__field_7__equal=44000&');
  // equal to a text: the text of the formula
  assert.equal(flat({ field: 'Montant (€)', op: 'equal', value: '44 000' }), 'filter__field_8__equal=44 000&');
  assert.equal(flat({ field: 'Montant (€)', op: 'contains', value: '44' }), 'filter__field_8__contains=44&');
  assert.equal(flat({ field: 'Close text', op: 'date_is_before', value: 'Europe/Paris?2026-10-25?exact_date' }),
    'filter__field_9__date_is_before=Europe/Paris?2026-10-25?exact_date&');
  assert.deepEqual(grouped({ mode: 'AND', filters: [{ field: 'Montant (€)', op: 'lower_than', value: '5' },
    { mode: 'OR', filters: [{ field: 'Name', op: 'contains', value: 'a' }] }] }).filters,
  [{ field: 'Contract Value', type: 'lower_than', value: '5' }]);
});
