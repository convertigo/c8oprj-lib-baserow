const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const spec = fs.readFileSync(path.join(root, '_c8oProject/connectors/Baserow_API_spec.yaml'), 'utf8').split('\n');
const folder = path.join(root, '_c8oProject/sequences');
const indent = (line) => line.length - line.trimStart().length;

// The lines of the node `↓name [...]` at the top level of the connector
function transaction(name) {
  const start = spec.findIndex((line) => line.startsWith(`↓${name} [`));
  assert.ok(start >= 0, name);
  let end = start + 1;
  while (end < spec.length && !spec[end].startsWith('↓')) end++;
  return spec.slice(start, end).join('\n');
}

// #1423: the list of the fields is cached 60 s under a key made of the variables only, the Authorization header is not
// one of them. The key holds cache_scope, and only an answer read with the token cache_scope names is stored.
test('the cached lists of fields are stored only under the cache_scope of the token of the call', () => {
  for (const name of ['_api_database_fields_table__table_id___GET', '_api_database_fields_table__table_id___GET_raw']) {
    const yaml = transaction(name);
    assert.match(yaml, /responseExpiryDate: absolute,60\n/, name);
    assert.match(yaml, /checkFieldsCacheScope\(\);/, name);
    // a POST variable of a GET: in the cache key, never sent to Baserow
    assert.match(yaml, /↓cache_scope \[variables\.RequestableHttpVariable-\d+\]: \n(    .*\n)*?    httpMethod: POST\n/, name);
  }
});

test('a change of a field through the library makes the cached lists of fields read again', () => {
  for (const name of ['_api_database_fields_table__table_id___POST', '_api_database_fields__field_id___PATCH',
    '_api_database_fields__field_id___DELETE', '_api_database_fields__field_id__duplicate_async__POST',
    '_api_database_fields_table__table_id__change_primary_field__POST']) {
    const yaml = transaction(name);
    assert.match(yaml, /function onTransactionStarted\(\) \{[^}]*bumpFieldsCacheGeneration\(\);/, name);
    assert.match(yaml, /function onXmlGenerated\(\) \{[^}]*bumpFieldsCacheGeneration\(\);/, name);
  }
});

// Each step calling these transactions gives cache_scope, computed for its token by a step of the sequence: a step
// variable without source would otherwise take a request parameter of the same name.
test('every call of the cached lists of fields gives the cache_scope of its token', () => {
  let count = 0;
  for (const file of fs.readdirSync(folder).filter((name) => name.endsWith('.yaml'))) {
    const lines = fs.readFileSync(path.join(folder, file), 'utf8').split('\n');
    lines.forEach((line, at) => {
      if (!/sourceTransaction: lib_BaseRow\.Baserow_API_spec\._api_database_fields_table__table_id___GET(_raw)?$/.test(line)) {
        return;
      }
      count++;
      const own = indent(line);
      let end = at + 1;
      while (end < lines.length && indent(lines[end]) >= own) end++;
      assert.ok(lines.slice(at, end).some((l) => indent(l) === own && /^\s*↓cache_scope \[variables\.StepVariable-\d+\]/.test(l)), file);
      assert.ok(lines.slice(0, at).some((l) => /cache_scope = getFieldsCacheScope\(/.test(l)), file);
    });
  }
  assert.equal(count, 4);
});

// js/fields_cache.js run with the Java classes it uses
function fieldsCache() {
  const shared = new Map();
  class AtomicLong {
    constructor(value) { this.value = value; }
    get() { return this.value; }
    incrementAndGet() { return ++this.value; }
  }
  const java = {
    security: { MessageDigest: { getInstance: () => ({ digest: (bytes) => crypto.createHash('sha256').update(bytes).digest() }) } },
    lang: { String: class { constructor(text) { this.text = text; } getBytes() { return Buffer.from(this.text, 'utf8'); } }, System: { currentTimeMillis: () => 1000 } },
    util: { Base64: { getUrlEncoder: () => ({ withoutPadding: () => ({ encodeToString: (bytes) => bytes.toString('base64url') }) }) },
      concurrent: { atomic: { AtomicLong } } },
  };
  const sandbox = { java, context: { project: { get: (key) => shared.get(key) ?? null, set: (key, value) => shared.set(key, value) } } };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/fields_cache.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/fields_cache.js'), 'utf8'), sandbox);
  return sandbox;
}

test('cache_scope is a digest of the whole token, changed by every change of a field', () => {
  const cache = fieldsCache();
  const jwt = (claims, signature) => `JWT x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${signature}`;
  const owner = cache.getFieldsCacheScope(jwt({ user_id: 5 }, 'good'));
  assert.equal(cache.getFieldsCacheScope(jwt({ user_id: 5 }, 'good')), owner);
  // a token forged with the same user_id does not reach the fields read by the owner
  assert.notEqual(cache.getFieldsCacheScope(jwt({ user_id: 5 }, 'forged')), owner);
  assert.notEqual(cache.getFieldsCacheScope(jwt({ user_id: 6 }, 'good')), owner);
  assert.ok(!owner.includes('good') && !owner.includes('JWT'), owner);
  cache.bumpFieldsCacheGeneration();
  assert.notEqual(cache.getFieldsCacheScope(jwt({ user_id: 5 }, 'good')), owner);
});
