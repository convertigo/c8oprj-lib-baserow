const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readSequence, stepProperty } = require('./read-yaml-steps.cjs');

// Fake Baserow rows endpoint: offset = (page - 1) * size, `next` is an absolute URL.
function baserowPage(total, page, size) {
  page = Number(page);
  size = Number(size);
  const rows = [];
  for (let id = (page - 1) * size + 1; id <= Math.min(page * size, total); id++) rows.push({ id });
  const next = page * size < total
    ? `http://baserow:8000/api/database/rows/table/7/?page=${page + 1}&size=${size}&user_field_names=true`
    : null;
  return { rows, next };
}

const sources = [
  { name: 'formssource_GetTableData', results: 'results', acc: 'all_results' },
  { name: 'formssource_GetSelectData', results: 'res', acc: 'all_res' },
];

function runSource(source, { total, max, pageSize, model = null, gridPage = null, gridPageSize = null, grouped = false }) {
  const yaml = readSequence(source.name);
  // GetTableData then takes the one page a grid asks (grid_page, grid_page_size)
  const parse = stepProperty(yaml, 'ParseConfig', 'expression')
    .match(/var normalizeMaxSearchResults[\s\S]*?size = "" \+ fetch_page_size;\n\}(?:\n\/\/ grid_page[\s\S]*?max_search_results = fetch_page_size;\n\})?/);
  assert.ok(parse, `${source.name}: page size block`);
  const init = stepProperty(yaml, 'InitPagination', 'expression');
  const setPage = stepProperty(yaml, 'SetPage', 'expression');
  const append = stepProperty(yaml, 'AppendResults', 'expression');
  const condition = stepProperty(yaml, 'FetchNextPages', 'condition');

  // streamRows: the pages read here, not streamed (a grouped source, a model, or lib_baserow.stream_rows=false)
  const sandbox = { model, max_search_results: String(max), size: String(pageSize), page: '1', streamRows: false,
    isModelMode: model == 'true', groupByColumns: grouped ? ['City'] : null, distinctColumns: null,
    grid_page: gridPage, grid_page_size: gridPageSize, pagedRead: false };
  vm.createContext(sandbox);
  vm.runInContext(parse[0], sandbox);
  const calls = [];
  const callTableGetData = () => {
    calls.push({ page: String(sandbox.page), size: String(sandbox.size) });
    return baserowPage(total, sandbox.page, sandbox.size);
  };
  let answer = callTableGetData();
  sandbox[source.results] = answer.rows;
  sandbox.next_page = answer.next;
  vm.runInContext(init, sandbox);
  let guard = 0;
  while (vm.runInContext(condition, sandbox)) {
    assert.ok(guard++ < 100, 'pagination loop must end');
    vm.runInContext(setPage, sandbox);
    answer = callTableGetData();
    sandbox.page_results = answer.rows;
    sandbox.next_page = answer.next;
    vm.runInContext(append, sandbox);
  }
  return { ids: JSON.parse(JSON.stringify(sandbox[source.results].map((row) => row.id))), calls, sandbox };
}

for (const source of sources) {
  test(`${source.name}: every page keeps the same size, no row read twice or skipped`, () => {
    const { ids, calls } = runSource(source, { total: 1000, max: 500, pageSize: 200 });
    assert.equal(ids.length, 500);
    assert.deepEqual(ids, Array.from({ length: 500 }, (_, i) => i + 1));
    assert.deepEqual(calls, [
      { page: '1', size: '200' },
      { page: '2', size: '200' },
      { page: '3', size: '200' },
    ]);
  });

  test(`${source.name}: a table smaller than the limit is read entirely`, () => {
    const { ids, calls } = runSource(source, { total: 450, max: 1000, pageSize: 200 });
    assert.deepEqual(ids, Array.from({ length: 450 }, (_, i) => i + 1));
    assert.equal(calls.length, 3);
  });

  test(`${source.name}: a limit under the page size reads one page of that limit`, () => {
    const { ids, calls } = runSource(source, { total: 1000, max: 50, pageSize: 200 });
    assert.equal(ids.length, 50);
    assert.deepEqual(calls, [{ page: '1', size: '50' }]);
  });

  test(`${source.name}: the Baserow next URL becomes a page number`, () => {
    const yaml = readSequence(source.name);
    const sandbox = { next_page: null };
    vm.createContext(sandbox);
    vm.runInContext(stepProperty(yaml, 'InitPagination', 'expression').replace(/\nnext_page = [\s\S]*$/, ''), sandbox);
    const pageOf = sandbox.getNextPageNumber;
    assert.equal(pageOf('https://br.example/api/database/rows/table/7/?page=12&size=200'), '12');
    assert.equal(pageOf('https://br.example/api/database/rows/table/7/?size=200&page=3'), '3');
    assert.equal(pageOf('4'), '4');
    assert.equal(pageOf(''), null);
    assert.equal(pageOf('null'), null);
    assert.equal(pageOf(null), null);
    assert.equal(pageOf('https://br.example/?subpage=2'), null);
  });
}

test('formssource_GetTableData: the model read never paginates', () => {
  const { ids, calls } = runSource(sources[0], { total: 1000, max: 500, pageSize: 1, model: 'true' });
  assert.equal(calls.length, 1);
  assert.equal(ids.length, 1);
});

// A grid that paginates (gridPaginationEnabled) asks one page: one request of Baserow, its rows only.
test('formssource_GetTableData: a grid page reads that page of Baserow only', () => {
  const { ids, calls, sandbox } = runSource(sources[0], { total: 59, max: 1000, pageSize: 200, gridPage: '3', gridPageSize: '5' });
  assert.deepEqual(calls, [{ page: '3', size: '5' }]);
  assert.deepEqual(ids, [11, 12, 13, 14, 15]);
  assert.equal(sandbox.pagedRead, true);
});

test('formssource_GetTableData: a grid page holds at most 200 rows, the limit of Baserow', () => {
  const { ids, calls } = runSource(sources[0], { total: 1000, max: 1000, pageSize: 200, gridPage: '2', gridPageSize: '500' });
  assert.deepEqual(calls, [{ page: '2', size: '200' }]);
  assert.equal(ids.length, 200);
  assert.equal(ids[0], 201);
});

test('formssource_GetTableData: without a grid page every row is read, over 200 rows too', () => {
  const { ids, calls, sandbox } = runSource(sources[0], { total: 450, max: 1000, pageSize: 200, gridPage: null, gridPageSize: null });
  assert.equal(ids.length, 450);
  assert.equal(calls.length, 3);
  assert.equal(sandbox.pagedRead, false);
});

test('formssource_GetTableData: a model or a grouped source ignores the grid page', () => {
  assert.equal(runSource(sources[0], { total: 450, max: 1000, pageSize: 200, gridPage: '2', gridPageSize: '5', grouped: true }).ids.length, 450);
  assert.equal(runSource(sources[0], { total: 450, max: 1000, pageSize: 1, gridPage: '2', gridPageSize: '5', model: 'true' }).calls.length, 1);
});

test('formssource_GetTableData: a bad grid page reads the first page', () => {
  for (const gridPage of ['0', '-2', 'abc', null]) {
    assert.deepEqual(runSource(sources[0], { total: 59, max: 1000, pageSize: 200, gridPage, gridPageSize: '5' }).calls, [{ page: '1', size: '5' }], String(gridPage));
  }
});
