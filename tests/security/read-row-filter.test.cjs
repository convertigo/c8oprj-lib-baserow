// A filter or a sort on the row id or the row order of formssource_GetTableData (convertigo/C8oForms#1156): Baserow
// filters and sorts fields only, the library keeps and orders the rows itself (js/row_filter.js). The exact path reads
// the rows of an equal / any of on the id by their id; any other case keeps the rows read, and says when the read stopped
// at max_search_results with rows left (incomplete). A published scope is never left out: it keeps the read on Baserow.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readSequence, stepProperty } = require('./read-yaml-steps.cjs');

const root = path.join(__dirname, '../..');
const rowFilter = require('../../js/row_filter.js');
const yaml = readSequence('formssource_GetTableData');
const json = (value) => JSON.parse(JSON.stringify(value));
const tree = (...filters) => JSON.stringify({ mode: 'AND', filters });
const leaf = (field, op, value) => ({ field, op, value });

test('a filter and a sort without the row id or order are left as they are', () => {
  const filter = tree(leaf('Name', 'contains', 'a'), { mode: 'OR', filters: [leaf('City', 'equal', 'Paris'), leaf('City', 'equal', 'Lyon')] });
  const sort = JSON.stringify({ sorts: [{ name: 'Name', order: 'asc' }] });
  const plan = rowFilter.plan(filter, sort, {});
  assert.equal(plan.active, false);
  assert.equal(plan.filter, filter);
  assert.equal(plan.sort, sort);
  assert.equal(rowFilter.plan(null, null, {}).active, false);
  assert.equal(rowFilter.plan('', '', {}).filter, '');
  assert.equal(rowFilter.plan('not json', 'Name', {}).filter, 'not json');
  // a model (the editor asks the fields of the table) never filters
  assert.equal(rowFilter.plan(tree(leaf('id', 'equal', 3)), null, { model: true }).active, false);
});

test('equal or any of on the id alone: the exact path reads those rows by their id', () => {
  let plan = rowFilter.plan(tree(leaf('id', 'equal', '12')), null, {});
  assert.deepEqual(json(plan), { active: true, direct: true, error: null, filter: null, sort: null,
    constraints: [{ mode: 'AND', leaves: [{ field: 'id', op: 'equal', value: '12' }] }], ids: ['12'], rowSort: null, gridPage: null, gridPageSize: null });
  // any of: an OR of equal, or a list of values
  plan = rowFilter.plan(tree({ mode: 'OR', filters: [leaf('id', 'equal', 4), leaf('id', 'equal', '9')] }), null, {});
  assert.deepEqual(plan.ids, ['4', '9']);
  assert.equal(plan.direct, true);
  assert.deepEqual(rowFilter.plan(tree(leaf('id', 'equal', ['3', 5, 'x'])), null, {}).ids, ['3', '5']);
  // a root that is the condition itself, or an OR of conditions on the id only
  assert.equal(rowFilter.plan(JSON.stringify(leaf('id', 'equal', 7)), null, {}).direct, true);
  assert.deepEqual(rowFilter.plan(JSON.stringify({ mode: 'OR', filters: [leaf('id', 'equal', 1), leaf('id', 'equal', 2)] }), null, {}).ids, ['1', '2']);
  // two equal: the ids of both
  assert.deepEqual(rowFilter.plan(tree(leaf('id', 'equal', 1), { mode: 'OR', filters: [leaf('id', 'equal', 1), leaf('id', 'equal', 2)] }), null, {}).ids, ['1']);
  // not the exact path: another condition for Baserow, a view, a sort on a field with several ids, too many ids
  assert.equal(rowFilter.plan(tree(leaf('id', 'equal', 12), leaf('Status', 'equal', 'Open')), null, {}).direct, false);
  assert.equal(rowFilter.plan(tree(leaf('id', 'equal', 12)), null, { viewId: '55' }).direct, false);
  const sortByName = JSON.stringify({ sorts: [{ name: 'Name', order: 'asc' }] });
  assert.equal(rowFilter.plan(tree(leaf('id', 'equal', [1, 2])), sortByName, {}).direct, false);
  assert.equal(rowFilter.plan(tree(leaf('id', 'equal', 1)), sortByName, {}).direct, true);
  const many = Array.from({ length: rowFilter.MAX_DIRECT_IDS + 1 }, (_, i) => i + 1);
  assert.equal(rowFilter.plan(tree(leaf('id', 'equal', many)), null, {}).direct, false);
});

test('the rest of the filter goes to Baserow; a condition on the id or order beside others under an OR is refused', () => {
  const plan = rowFilter.plan(tree(leaf('id', 'higher_than', 10), { mode: 'OR', filters: [leaf('City', 'equal', 'Paris'), leaf('City', 'equal', 'Lyon')] },
    { mode: 'AND', filters: [leaf('order', 'lower_than', '5'), leaf('Name', 'contains', 'a')] }), null, {});
  assert.equal(plan.error, null);
  assert.equal(plan.active, true);
  assert.equal(plan.direct, false);
  assert.equal(plan.ids, null);
  assert.deepEqual(JSON.parse(plan.filter), { mode: 'AND', filters: [
    { mode: 'OR', filters: [leaf('City', 'equal', 'Paris'), leaf('City', 'equal', 'Lyon')] },
    { mode: 'AND', filters: [leaf('Name', 'contains', 'a')] }] });
  assert.equal(plan.constraints.length, 2);
  for (const refused of [
    { mode: 'OR', filters: [leaf('id', 'equal', 1), leaf('City', 'equal', 'Paris')] },
    { mode: 'OR', filters: [{ mode: 'AND', filters: [leaf('id', 'equal', 1), leaf('City', 'equal', 'Paris')] }, leaf('City', 'equal', 'Lyon')] },
    { mode: 'OR', filters: [{ mode: 'OR', filters: [leaf('order', 'equal', 1), leaf('order', 'equal', 2)] }, leaf('City', 'equal', 'Lyon')] },
  ]) {
    assert.match(rowFilter.plan(JSON.stringify(refused), null, {}).error, /combined with the other filters with AND only/);
  }
  assert.match(rowFilter.plan(tree(leaf('id', 'date_is', 'today')), null, {}).error, /cannot be filtered with date_is/);
  // groups given as groups (the shape of the filter panel) too
  assert.deepEqual(JSON.parse(rowFilter.plan(JSON.stringify({ mode: 'AND', filters: [leaf('id', 'not_equal', 3)], groups: [{ mode: 'OR', filters: [leaf('A', 'equal', 1), leaf('A', 'equal', 2)] }] }), null, {}).filter),
    { mode: 'AND', filters: [{ mode: 'OR', filters: [leaf('A', 'equal', 1), leaf('A', 'equal', 2)] }] });
});

test('a sort on the row id or order: its first key is done by the library, a later one is dropped', () => {
  const sorts = (...items) => JSON.stringify({ sorts: items.map(([name, order]) => ({ name, order })) });
  let plan = rowFilter.plan(null, sorts(['id', 'desc'], ['Name', 'asc']), {});
  assert.deepEqual(json([plan.active, plan.sort, plan.rowSort]), [true, null, { field: 'id', desc: true }]);
  plan = rowFilter.plan(null, sorts(['Name', 'asc'], ['id', 'desc']), {});
  assert.deepEqual(json([plan.active, JSON.parse(plan.sort), plan.rowSort]), [false, { sorts: [{ name: 'Name', order: 'asc' }] }, null]);
  // the order ascending is the order of Baserow itself (without a view)
  plan = rowFilter.plan(null, sorts(['order', 'asc'], ['Name', 'asc']), {});
  assert.deepEqual(json([plan.active, plan.sort, plan.rowSort]), [false, null, null]);
  assert.deepEqual(json(rowFilter.plan(null, sorts(['order', 'asc']), { viewId: 4 }).rowSort), { field: 'order', desc: false });
  assert.deepEqual(json(rowFilter.plan(null, '-id,Name', {}).rowSort), { field: 'id', desc: true });
  assert.equal(rowFilter.plan(null, 'Name,-order', {}).sort, 'Name');
  // a grid page is cut by the library
  plan = rowFilter.plan(null, sorts(['id', 'asc']), { gridPage: '3', gridPageSize: '500' });
  assert.deepEqual([plan.gridPage, plan.gridPageSize], [3, 200]);
  assert.deepEqual([rowFilter.plan(null, sorts(['id', 'asc']), { gridPage: 'x', gridPageSize: '10' }).gridPage], [1]);
});

test('the conditions compare the id and the order as numbers, exactly, as Baserow compares a number field', () => {
  const row = { id: 12, order: '3.50000000000000000000' };
  const passes = (field, op, value) => rowFilter.passes(row, { field, op, value });
  assert.deepEqual(['equal', 'not_equal', 'higher_than', 'higher_than_or_equal', 'lower_than', 'lower_than_or_equal'].map((op) => passes('id', op, '12')),
    [true, false, false, true, false, true]);
  assert.equal(passes('id', 'equal', 12.0), true);
  assert.equal(passes('id', 'higher_than', '9'), true);
  assert.equal(passes('id', 'lower_than', '100'), true, 'numbers, not texts');
  assert.equal(passes('order', 'equal', '3.5'), true);
  assert.equal(passes('order', 'higher_than', '3.49999999999999999999'), true, 'the 20 decimals of the order');
  assert.equal(passes('order', 'lower_than', '3.50000000000000000001'), true);
  assert.equal(passes('id', 'contains', '2'), true);
  assert.equal(passes('id', 'contains_not', '2'), false);
  assert.equal(passes('id', 'empty', ''), false);
  assert.equal(passes('id', 'not_empty', ''), true);
  // an empty value: equal keeps no row (as lib_BaseRow sends it), the others keep every row
  assert.equal(passes('id', 'equal', ''), false);
  assert.equal(passes('id', 'higher_than', ''), true);
  assert.equal(passes('id', 'not_equal', ''), true);
  // a value that is no number: no row, not equal keeps them all
  assert.equal(passes('id', 'equal', 'abc'), false);
  assert.equal(passes('id', 'higher_than', 'abc'), false);
  assert.equal(passes('id', 'not_equal', 'abc'), true);
  assert.equal(passes('id', 'equal', ['5', '12']), true, 'any of');
  assert.equal(passes('id', 'not_equal', ['5', '12']), false, 'none of');
  assert.equal(rowFilter.compareDecimal('10', '9'), 1);
  assert.equal(rowFilter.compareDecimal('-1', '0'), -1);
  assert.equal(rowFilter.compareDecimal('2.000', '2'), 0);
});

const tableRows = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, order: (30 - i) + '.00000000000000000000', Name: 'n' + (i + 1), Secret: 's' }));

test('the exact path: the rows of the ids, their included fields, in the order of the table, never incomplete', () => {
  const asked = [];
  const readRow = (id) => {
    asked.push(id);
    const row = tableRows.find((current) => String(current.id) === id);
    return row ? { ...row } : { error: 'ERROR_ROW_DOES_NOT_EXIST', detail: 'The row does not exist.' };
  };
  const plan = rowFilter.plan(tree({ mode: 'OR', filters: [leaf('id', 'equal', 5), leaf('id', 'equal', 7), leaf('id', 'equal', 999)] }, leaf('order', 'higher_than', '24.5')), null, {});
  assert.equal(plan.direct, true);
  const answer = rowFilter.apply(plan, [{ id: 1 }], true, readRow, ['Name']);
  assert.deepEqual(asked, ['5', '7', '999']);
  // 7 has the order 24, kept out by the other condition; 999 does not exist; the order of the table is the order
  assert.deepEqual(json(answer), { rows: [{ id: 5, order: '26.00000000000000000000', Name: 'n5' }], count: 1, incomplete: false, read: 2,
    paged: false, page: 1, size: null, error: null });
  // every field when the read includes them all
  assert.equal(rowFilter.apply(rowFilter.plan(tree(leaf('id', 'equal', 5)), null, {}), [], false, readRow, null).rows[0].Secret, 's');
  // a refused token or Baserow out of reach: an error, never a row silently missing
  const failing = rowFilter.apply(rowFilter.plan(tree(leaf('id', 'equal', 5)), null, {}), [], false, () => ({ error: 'ERROR_INVALID_ACCESS_TOKEN' }), null);
  assert.match(failing.error, /The row 5 could not be read: ERROR_INVALID_ACCESS_TOKEN/);
  assert.match(rowFilter.apply(rowFilter.plan(tree(leaf('id', 'equal', 5)), null, {}), [], false, () => null, null).error, /no answer/);
});

test('the bounded path: the rows read kept and ordered, the grid page cut, incomplete when the read stopped with rows left', () => {
  const read = tableRows.slice(0, 20);
  let plan = rowFilter.plan(tree(leaf('id', 'higher_than', 4)), JSON.stringify({ sorts: [{ name: 'id', order: 'desc' }] }), { gridPage: 2, gridPageSize: 5 });
  let answer = rowFilter.apply(plan, read, true, null, null);
  assert.deepEqual(answer.rows.map((row) => row.id), [15, 14, 13, 12, 11]);
  assert.deepEqual([answer.count, answer.incomplete, answer.read, answer.paged, answer.page, answer.size], [16, true, 20, true, 2, 5]);
  // every row read: complete
  answer = rowFilter.apply(plan, tableRows, false, null, null);
  assert.deepEqual([answer.count, answer.incomplete], [26, false]);
  // the order of the table, as Baserow gives it, for a sort on the order descending
  plan = rowFilter.plan(null, JSON.stringify({ sorts: [{ name: 'order', order: 'desc' }] }), {});
  assert.deepEqual(rowFilter.apply(plan, tableRows.slice(0, 3), false, null, null).rows.map((row) => row.id), [1, 2, 3]);
  // the ids of an equal beside another condition: complete once every id is found, even when rows are left
  plan = rowFilter.plan(tree(leaf('id', 'equal', [2, 3]), leaf('Name', 'contains', 'n')), null, {});
  assert.equal(plan.direct, false);
  answer = rowFilter.apply(plan, read, true, null, null);
  assert.deepEqual([answer.rows.map((row) => row.id), answer.incomplete], [[2, 3], false]);
  answer = rowFilter.apply(rowFilter.plan(tree(leaf('id', 'equal', [2, 25]), leaf('Name', 'contains', 'n')), null, {}), read, true, null, null);
  assert.deepEqual([answer.rows.map((row) => row.id), answer.incomplete], [[2], true]);
});

test('a published scope keeps the read on Baserow: the exact path never leaves it out', () => {
  const scoped = vm.runInNewContext(fs.readFileSync(path.join(root, 'js/published_read_scope.js'), 'utf8') + '\nbindPublishedReadScope', {});
  const bound = scoped(JSON.stringify({ mode: 'AND', filters: [leaf('Owner', 'equal', 'me')] }), tree(leaf('id', 'equal', 5)), null, null, true);
  const plan = rowFilter.plan(bound, null, {});
  assert.equal(plan.direct, false);
  assert.deepEqual(JSON.parse(plan.filter), { mode: 'AND', filters: [{ mode: 'AND', filters: [leaf('Owner', 'equal', 'me')] }] });
  assert.deepEqual(plan.ids, ['5']);
  // a scope with a condition on the id of its own is kept by the library as well
  const own = scoped(JSON.stringify({ mode: 'AND', filters: [leaf('id', 'lower_than', '10')] }), tree(leaf('Name', 'contains', 'n')), null, null, true);
  assert.deepEqual(rowFilter.apply(rowFilter.plan(own, null, {}), tableRows, false, null, null).rows.map((row) => row.id), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  // unbounded: the filter of the request only, which may take the exact path
  assert.equal(rowFilter.plan(scoped(JSON.stringify({ unbounded: true }), tree(leaf('id', 'equal', 5)), null, null, true), null, {}).direct, true);
});

test('GetTableData plans the row filter before its page sizes, and the read leaves the stream, the plugin and the grid page', () => {
  const config = stepProperty(yaml, 'ParseConfig', 'expression');
  const planAt = config.indexOf('rowFilter = baserowRowFilter.plan(filterExpression, order_by, { model: isModelMode, viewId: view_id, gridPage: grid_page, gridPageSize: grid_page_size });');
  assert.ok(planAt > config.indexOf('filterExpression = bindPublishedReadScope(') && planAt > config.indexOf('if (isModelMode) {'));
  assert.ok(planAt < config.indexOf('var normalizeMaxSearchResults'));
  assert.match(config, /include\("js\/row_filter\.js"\);/);
  assert.match(config, /if \(rowFilter\.active\) \{\n\tfilterExpression = rowFilter\.filter;\n\tif \(rowFilter\.direct\) \{\n\t\tmax_search_results = 1;\n\t\}\n\}\norder_by = rowFilter\.sort;/);
  assert.match(config, /distinctColumns == null && !\(typeof rowFilter != "undefined" && rowFilter\.active\) && !isNaN\(askedPageSize\)/);
  // with the views (view_id) merged in: the plugin is skipped for a row filter as for a view
  assert.match(config, /var rowFilterActive = typeof rowFilter != "undefined" && rowFilter\.active;/);
  assert.match(config, /pluginAggregate = pluginAllowed && !pluginKnownAbsent && pluginReadsSource && !rowFilterActive \?/);
  assert.match(stepProperty(yaml, 'StreamFirstRow', 'expression'), /&& !pagedRead && !rowFilter\.active;/);
  // the grid page of a source with a row filter: every row read (up to the limit), the page cut afterwards
  const block = config.slice(config.indexOf('var normalizeMaxSearchResults'), config.indexOf('var shouldExposeColumn'));
  const sandbox = { model: null, max_search_results: '1000', size: undefined, page: '1', isModelMode: false, groupByColumns: null,
    distinctColumns: null, grid_page: '2', grid_page_size: '10', rowFilter: { active: true } };
  vm.runInNewContext(block.replace(/\$\{[^=}]+=([^}]*)\}/g, '$1'), sandbox);
  assert.deepEqual([sandbox.pagedRead, sandbox.max_search_results, sandbox.size, sandbox.page], [false, 1000, '200', '1']);
  sandbox.rowFilter = { active: false };
  sandbox.max_search_results = '1000';
  vm.runInNewContext(block.replace(/\$\{[^=}]+=([^}]*)\}/g, '$1'), sandbox);
  assert.deepEqual([sandbox.pagedRead, sandbox.max_search_results, sandbox.size, sandbox.page], [true, 10, '10', '2']);
});

test('GetTableData: an error for a filter it cannot do, the rows kept before the links, the flag next to the count', () => {
  const after = (header) => yaml.indexOf('\n↓', yaml.indexOf(`↓${header} [`) + 1) + 1;
  assert.ok(yaml.startsWith('↓IfRowFilterError [steps.IfStep-', after('IfPluginRequired')));
  assert.match(yaml.slice(yaml.indexOf('↓IfRowFilterError ['), yaml.indexOf('↓RawJsonMode [')),
    /condition: rowFilter\.error != null\n {2}↓Error_structure \[steps\.XMLErrorStep-\d+\]: [\s\S]*?→→: 102[\s\S]*?→→: rowFilter\.error\n {2}↓Return \[steps\.ReturnStep-\d+\]: \n$/);
  assert.ok(yaml.indexOf('↓IfRowFilter [') > yaml.indexOf('↓FetchNextPages [') && yaml.indexOf('↓IfRowFilter [') < yaml.indexOf('↓IfLinkDisplay ['));
  const incomplete = yaml.slice(yaml.indexOf('↓IfRowFilterIncomplete ['), yaml.indexOf('↓SortSources ['));
  assert.match(incomplete, /condition: rowFilter\.active && rowFilterIncomplete === true\n/);
  assert.match(incomplete, /→→: 'true'\n[\s\S]*?→→: incomplete\n[\s\S]*?→→: rowFilterRead\n[\s\S]*?→→: rows_read\n/);
  assert.ok(yaml.indexOf('↓IfRowFilterIncomplete [') > yaml.indexOf('↓IfCount ['));
});

test('GetTableData RowFilter: the rows of the ids read with the account of the source, the rows kept, the count and the page', () => {
  const step = stepProperty(yaml, 'RowFilter', 'expression');
  const calls = [];
  const run = (plan, sandbox) => {
    const context = { include: () => {}, baserowRowFilter: rowFilter, rowFilter: plan, rowFilterIncludes: null, table_id: 'Clients',
      rowFilterAuthorization: 'JWT abc', pagedRead: false, page: '1', fetch_page_size: 200, max_search_results: 1000,
      jsonAnswer: (text) => JSON.parse(text),
      callNative: (requestable, vars) => { calls.push([requestable, vars]); return JSON.stringify(tableRows.find((row) => String(row.id) === vars.row_id)); },
      ...sandbox };
    vm.runInNewContext(step, context);
    return context;
  };
  let out = run(rowFilter.plan(tree(leaf('id', 'equal', 3)), null, { gridPage: 1, gridPageSize: 10 }), { results: [{ id: 1 }], all_results: [{ id: 1 }], next_page: '2' });
  assert.deepEqual(json(calls), [['lib_BaseRow.Baserow_API_spec._api_database_rows_table__table_id___row_id___GET_raw',
    { __header_Authorization: 'JWT abc', table_id: 'Clients', row_id: '3', user_field_names: 'true' }]]);
  assert.deepEqual(json([out.results.map((row) => row.id), out.total_count, out.rowFilterIncomplete, out.pagedRead, out.page, out.fetch_page_size, out.rowFilterError]),
    [[3], 1, false, true, '1', 10, null]);
  assert.equal(out.rowFilterAuthorization, null);
  calls.length = 0;
  // the bounded path reads nothing more: the rows of Baserow, stopped at the limit with a next page
  const read = tableRows.slice(0, 20);
  out = run(rowFilter.plan(tree(leaf('id', 'higher_than', 15)), null, {}), { results: read, all_results: read, next_page: '2', max_search_results: 20 });
  assert.deepEqual(json([calls.length, out.results.map((row) => row.id), out.total_count, out.rowFilterIncomplete, out.rowFilterRead, out.pagedRead]),
    [0, [16, 17, 18, 19, 20], 5, true, 20, false]);
  out = run(rowFilter.plan(tree(leaf('id', 'higher_than', 15)), null, {}), { results: read, all_results: read, next_page: null, max_search_results: 1000 });
  assert.equal(out.rowFilterIncomplete, false);
});
