// An internal call (callSequence, callSequenceNative, a sequence called from JavaScript) gets a context of its own.
// A context name made of the time in milliseconds was shared by the calls of one HTTP session made in the same
// millisecond (the sources of a page): the engine runs the requests of a context one after the other, so the sources
// waited for each other, and one call could remove the context another still used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const files = [
  ...fs.readdirSync(path.join(root, 'js')).filter((f) => f.endsWith('.js')).map((f) => path.join('js', f)),
  ...fs.readdirSync(path.join(root, '_c8oProject', 'sequences')).map((f) => path.join('_c8oProject', 'sequences', f)),
];

test('no internal call names its context after the time', () => {
  const offenders = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const line of text.split('\n')) {
      if (/__context/.test(line) && /currentTimeMillis|new Date\(\)\.getTime|Date\.now/.test(line)) { offenders.push(`${file}: ${line.trim()}`); }
    }
  }
  assert.deepEqual(offenders, []);
});

test('the internal calls of the lib use a unique context name', () => {
  const common2 = fs.readFileSync(path.join(root, 'js', 'common2.js'), 'utf8');
  const native = fs.readFileSync(path.join(root, '_c8oProject', 'sequences', 'formscommon_CheckConfigNative.yaml'), 'utf8');
  assert.equal((common2.match(/"syncContext_" \+ java\.util\.UUID\.randomUUID\(\)/g) || []).length, 2);
  assert.match(native, /"syncContext_" \+ java\.util\.UUID\.randomUUID\(\)/);
});
