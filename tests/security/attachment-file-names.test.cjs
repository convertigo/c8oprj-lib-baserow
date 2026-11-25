const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (name) => fs.readFileSync(path.join(__dirname, '../../_c8oProject/sequences', name + '.yaml'), 'utf8');
const actions = ['forms_AddRow', 'forms_AddRowFromData'];

// A key of the response document names the temporary file of an attachment under attachments/<dir>/: a key such as
// "../../x" must never leave that folder (the file is downloaded, renamed, uploaded to Baserow, then deleted).
test('every temporary attachment path is built from safeName', () => {
  for (const name of actions) {
    const sequence = read(name);
    const paths = [...sequence.matchAll(/var _use_attpath = dir \+ dirName \+ "\/" ?\+ ?([^;\n]+);/g)].map((m) => m[1].trim());
    assert.equal(paths.length, 4, `${name}: ${paths.length} paths`);
    for (const value of paths) {
      assert.match(value, /^safeName\(/, `${name}: unsafe path ${value}`);
    }
    const renames = [...sequence.matchAll(/_use_attpath = _use_attpath \+ "\." \+ ([^;\n]+);/g)].map((m) => m[1].trim());
    assert.equal(renames.length, 2, `${name}: ${renames.length} renames`);
    for (const value of renames) {
      assert.equal(value, '(contentExt == "" ? "bin" : contentExt)', `${name}: unsafe extension ${value}`);
    }
    assert.equal((sequence.match(/function safeName\(name\)\{/g) || []).length, 4, `${name}: safeName definitions`);
  }
});

test('safeName keeps a file name only', () => {
  const source = read('forms_AddRow').match(/function safeName\(name\)\{[\s\S]*?\n\s*\}/)[0];
  const safeName = new Function(`${source}; return safeName;`)();
  assert.equal(safeName('../../etc/passwd'), 'passwd');
  assert.equal(safeName('..\\..\\win.ini'), 'win.ini');
  assert.equal(safeName('x/../../../../tmp/evil'), 'evil');
  assert.equal(safeName('..'), 'file');
  assert.equal(safeName(''), 'file');
  assert.equal(safeName(undefined), 'file');
  assert.equal(safeName('photo\u0000.png'), 'photo.png');
  assert.equal(safeName('1735_C80C80_photo.png'), '1735_C80C80_photo.png');
});
