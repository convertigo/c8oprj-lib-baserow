const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '../../_c8oProject/connectors');

test('the C8Oforms store declared here is pull only, like in C8Oforms', () => {
  // The engine applies the most restrictive connector of a database, but ignores a project it cannot load (while it is
  // deployed): this declaration keeps c8oforms_fs pull only while C8Oforms reloads.
  assert.match(fs.readFileSync(path.join(dir, 'c8oforms_fs.yaml'), 'utf8'), /^replicationAccess: pullOnly$/m);
});

test('properties unknown to the engine are not used as security settings', () => {
  for (const file of fs.readdirSync(dir)) {
    assert.doesNotMatch(fs.readFileSync(path.join(dir, file), 'utf8'), /publicReplicationAllowed|publicBulkDocsAllowed/, file);
  }
});
