const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '../../_c8oProject/connectors');

test('no HTTP transaction copies its request headers (and the Baserow JWT) into HttpInfo', () => {
  // HttpInfo holds the request headers, Authorization included, in the transaction output: the engine logs that output
  // at INFO (the default level of cems.Context) and writes it to the response cache.
  for (const file of fs.readdirSync(dir)) {
    assert.doesNotMatch(fs.readFileSync(path.join(dir, file), 'utf8'), /^\s*httpInfo: true$/m, file);
  }
});
