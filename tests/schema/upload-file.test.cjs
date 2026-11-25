// js/baserow_schema.js mode upload (uploadFile): one file of a migration uploaded to the user files of the account,
// from the transfer folder only, its name given back for a file field of a row (mode rows).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const BaserowSchema = require('../../js/baserow_schema.js');
const { fakeBaserow } = require('./fake-baserow.cjs');

const TRANSFER = '/tmp/c8o-file-transfer/';
// the check of the engine, as a fake: a file of the transfer folder
const fileOf = (p) => (p.startsWith(TRANSFER) && !p.includes('..') ? { path: p, size: p.includes('huge') ? 2 * 1024 * 1024 * 1024 : 1200, name: p.split('/').pop() } : null);

test('upload: a file of the transfer folder is uploaded, its Baserow name and visible name answered', () => {
  const baserow = fakeBaserow();
  const answer = BaserowSchema.uploadFile(baserow.api, { path: `${TRANSFER}1f2e/devis été.pdf` }, fileOf);
  assert.equal(answer.status, 'ok');
  assert.equal(answer.mode, 'upload');
  assert.equal(answer.file.visible_name, 'devis été.pdf');
  assert.match(answer.file.name, /^u\d+_devis/);
  assert.deepEqual(baserow.calls.map((c) => c.name), ['uploadFile']);
  // the value of a file field of a row, as mode rows accepts it
  const s = baserow.api.createDatabase(836, 'Imports');
  const table = baserow.api.createTable(s.id, { name: 'Items', data: [['Title']], first_row_header: true });
  const files = baserow.api.createField(table.id, { name: 'Attachments', type: 'file' });
  const row = baserow.api.createRows(table.id, [{}])[0];
  const write = BaserowSchema.writeRows(baserow.api, { tableId: table.id, update: [{ id: row.id, [`field_${files.id}`]: [{ name: answer.file.name, visible_name: answer.file.visible_name }] }] });
  assert.equal(write.updated, 1);
});

test('upload: only a file of the transfer folder, at most 1 GB', () => {
  const baserow = fakeBaserow();
  for (const bad of ['', '/var/data/file.pdf', `${TRANSFER}../other.txt`, '/tmp/other/file.pdf']) {
    assert.throws(() => BaserowSchema.uploadFile(baserow.api, { path: bad }, fileOf), (e) => e.code === 'file_invalid', bad);
  }
  assert.throws(() => BaserowSchema.uploadFile(baserow.api, { path: `${TRANSFER}a/huge.iso` }, fileOf), (e) => e.code === 'file_too_large');
  assert.equal(baserow.calls.length, 0, 'nothing uploaded');
});

test('upload: the engine reads the transfer folder only, by the canonical path of the file', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'baserow_schema.js'), 'utf8');
  assert.match(source, /var TRANSFER_DIR = "c8o-file-transfer";/);
  assert.match(source, /var file = new java\.io\.File\(path\)\.getCanonicalFile\(\);/);
  assert.match(source, /if \(!file\.isFile\(\) \|\| canonical\.indexOf\(root\) !== 0\) \{\s*return null;/);
  assert.match(source, /return uploadFile\(engineApiFor\(params\), options, engineTransferFile\);/);
});
