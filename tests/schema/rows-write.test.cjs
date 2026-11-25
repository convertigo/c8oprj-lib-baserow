// js/baserow_schema.js mode rows (writeRows): one write of a migration into a table the account reaches, the writable
// fields only, at most 200 rows, and no duplicate when a batch is written again after an interruption (keyField).
const test = require('node:test');
const assert = require('node:assert/strict');
const BaserowSchema = require('../../js/baserow_schema.js');
const { fakeBaserow } = require('./fake-baserow.cjs');

// a base with a table Items: Title (primary text), SharePoint ID (number), Status (single select), a formula
function setup() {
  const baserow = fakeBaserow();
  const base = baserow.api.createDatabase(836, 'Imports');
  const table = baserow.api.createTable(base.id, { name: 'Items', data: [['Title']], first_row_header: true });
  const title = baserow.api.listFields(table.id)[0];
  const key = baserow.api.createField(table.id, { name: 'SharePoint ID', type: 'number' });
  const status = baserow.api.createField(table.id, { name: 'Status', type: 'single_select', select_options: [{ value: 'Open', color: 'blue' }] });
  const formula = baserow.api.createField(table.id, { name: 'Upper', type: 'formula', formula: "upper(field('Title'))" });
  baserow.calls.length = 0;
  return { baserow, table, title, key, status, formula, option: status.select_options[0].id };
}

const item = (s, n) => ({ [`field_${s.title.id}`]: `Item ${n}`, [`field_${s.key.id}`]: n, [`field_${s.status.id}`]: s.option });

test('rows: creates the rows of a batch and gives their ids in the order of create', () => {
  const s = setup();
  const answer = BaserowSchema.writeRows(s.baserow.api, { tableId: s.table.id, keyField: s.key.id, create: [item(s, 3), item(s, 1), item(s, 2)] });
  assert.equal(answer.status, 'ok');
  assert.equal(answer.created, 3);
  assert.equal(answer.existing, 0);
  assert.deepEqual(answer.rows.map((r) => r.key), [3, 1, 2]);
  const rows = s.baserow.db.rows.filter((r) => r.table_id === s.table.id);
  assert.deepEqual(answer.rows.map((r) => r.id), rows.map((r) => r.id));
  assert.equal(rows[0][`field_${s.status.id}`], s.option);
  // one read of the fields, one read of the keys, one batch write
  assert.deepEqual(s.baserow.calls.map((c) => c.name), ['listFields', 'findRows', 'createRows']);
});

test('rows: a batch written again after an interruption creates only the rows not yet written', () => {
  const s = setup();
  BaserowSchema.writeRows(s.baserow.api, { tableId: s.table.id, keyField: s.key.id, create: [item(s, 10), item(s, 11)] });
  // another row of the table, outside the range of the batch, is never taken for a row of the batch
  BaserowSchema.writeRows(s.baserow.api, { tableId: s.table.id, keyField: s.key.id, create: [item(s, 40)] });
  const before = s.baserow.db.rows.filter((r) => r.table_id === s.table.id).map((r) => r.id);
  const answer = BaserowSchema.writeRows(s.baserow.api, { tableId: s.table.id, keyField: s.key.id, create: [item(s, 10), item(s, 11), item(s, 12)] });
  assert.equal(answer.created, 1);
  assert.equal(answer.existing, 2);
  assert.deepEqual(answer.rows.slice(0, 2).map((r) => r.id), before.slice(0, 2));
  assert.deepEqual(answer.rows.map((r) => r.existing), [true, true, false]);
  assert.equal(s.baserow.db.rows.filter((r) => r.table_id === s.table.id).length, 4);
});

test('rows: the keys of a batch are found over several pages', () => {
  const s = setup();
  for (let from = 1; from <= 400; from += 200) {
    const batch = [];
    for (let n = from; n < from + 200; n++) batch.push(item(s, n));
    BaserowSchema.writeRows(s.baserow.api, { tableId: s.table.id, keyField: s.key.id, create: batch });
  }
  s.baserow.calls.length = 0;
  const again = [];
  for (let n = 201; n <= 400; n++) again.push(item(s, n));
  const answer = BaserowSchema.writeRows(s.baserow.api, { tableId: s.table.id, keyField: s.key.id, create: again });
  assert.equal(answer.created, 0);
  assert.equal(answer.existing, 200);
  assert.ok(!s.baserow.calls.some((c) => c.name === 'createRows'));
});

test('rows: without keyField the rows are created as they are', () => {
  const s = setup();
  const answer = BaserowSchema.writeRows(s.baserow.api, { tableId: s.table.id, create: [item(s, 1), item(s, 1)] });
  assert.equal(answer.created, 2);
  assert.deepEqual(s.baserow.calls.map((c) => c.name), ['listFields', 'createRows']);
});

test('rows: update writes the links of a second pass by row id', () => {
  const s = setup();
  const link = s.baserow.api.createField(s.table.id, { name: 'Parent', type: 'link_row', link_row_table_id: s.table.id, has_related_field: false });
  const written = BaserowSchema.writeRows(s.baserow.api, { tableId: s.table.id, keyField: s.key.id, create: [item(s, 1), item(s, 2)] });
  const [first, second] = written.rows.map((r) => r.id);
  const answer = BaserowSchema.writeRows(s.baserow.api, { tableId: s.table.id, update: [{ id: second, [`field_${link.id}`]: [first] }] });
  assert.equal(answer.updated, 1);
  assert.deepEqual(s.baserow.db.rows.find((r) => r.id === second)[`field_${link.id}`], [first]);
});

test('rows: refuses computed and unknown fields, values that are not plain, too many rows and bad keys', () => {
  const s = setup();
  const write = (options) => {
    try {
      BaserowSchema.writeRows(s.baserow.api, { tableId: s.table.id, ...options });
      return null;
    } catch (e) {
      return e.code;
    }
  };
  assert.equal(write({ create: [{ [`field_${s.formula.id}`]: 'x' }] }), 'rows_invalid');
  assert.equal(write({ create: [{ field_999999: 'x' }] }), 'rows_invalid');
  assert.equal(write({ create: [{ id: 5, [`field_${s.title.id}`]: 'x' }] }), 'rows_invalid');
  assert.equal(write({ create: [{ [`field_${s.title.id}`]: { nested: { deep: 1 } } }] }), 'rows_invalid');
  assert.equal(write({ create: 'rows' }), 'rows_invalid');
  assert.equal(write({ update: [{ [`field_${s.title.id}`]: 'no id' }] }), 'rows_invalid');
  assert.equal(write({ update: [{ id: -3, [`field_${s.title.id}`]: 'x' }] }), 'rows_invalid');
  assert.equal(write({ create: new Array(201).fill(null).map((_, n) => item(s, n + 1)) }), 'rows_too_many');
  assert.equal(write({ keyField: s.title.id, create: [item(s, 1)] }), 'rows_invalid');
  assert.equal(write({ keyField: s.key.id, create: [item(s, 1), item(s, 1)] }), 'rows_invalid');
  assert.equal(write({ keyField: s.key.id, create: [{ [`field_${s.title.id}`]: 'no key' }] }), 'rows_invalid');
  assert.equal(write({ tableId: null, create: [item(s, 1)] }), 'table_invalid');
  // nothing was written by a refused call
  assert.equal(s.baserow.db.rows.length, 0);
  assert.ok(!s.baserow.calls.some((c) => c.name === 'createRows' || c.name === 'updateRows'));
});

test('rows: a table the account does not reach is refused by Baserow before any write', () => {
  const s = setup();
  assert.throws(() => BaserowSchema.writeRows(s.baserow.api, { tableId: 424242, create: [item(s, 1)] }), (e) => e.baserowError === 'ERROR_TABLE_DOES_NOT_EXIST');
  assert.equal(s.baserow.db.rows.length, 0);
});

test('rows: nothing to write makes no Baserow call', () => {
  const s = setup();
  const answer = BaserowSchema.writeRows(s.baserow.api, { tableId: s.table.id, create: [], update: [] });
  assert.equal(answer.status, 'ok');
  assert.equal(s.baserow.calls.length, 0);
});

test('rows: engine.run mode rows answers an error object, never throws', () => {
  const answer = BaserowSchema.engine.run({ mode: 'rows', options: '{"tableId": "x"}' });
  assert.equal(answer.status, 'error');
  assert.equal(answer.mode, 'rows');
});
