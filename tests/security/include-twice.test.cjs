// forms_AddRow and forms_AddRowFromData include js/common.js in two steps of one sequence: ReadFields, then AppendFiles
// (forms_appendFiles). The steps of a sequence share one scope: a const declared again by the second include stopped
// AppendFiles ("TypeError: the constant xpath was declared again"), and every update with the option failed. A file a
// sequence includes more than once declares no const or let at its top level.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

// the files included by the steps of a sequence, in order
function includes(sequence) {
  return [...read(`_c8oProject/sequences/${sequence}.yaml`).matchAll(/include\("(js\/[^"]+)"\)/g)].map((match) => match[1]);
}

// a file and the files it includes
function closure(file, seen = new Set()) {
  if (seen.has(file)) {
    return seen;
  }
  seen.add(file);
  for (const match of read(file).matchAll(/include\("(js\/[^"]+)"\)/g)) {
    closure(match[1], seen);
  }
  return seen;
}

test('the files included twice by a write declare no const or let at their top level', () => {
  for (const sequence of ['forms_AddRow', 'forms_AddRowFromData']) {
    const list = includes(sequence);
    const twice = [...new Set(list.filter((file, i) => list.indexOf(file) !== i))];
    assert.ok(twice.includes('js/common.js'), `${sequence} includes js/common.js twice`);
    for (const file of new Set(twice.flatMap((entry) => [...closure(entry)]))) {
      assert.doesNotMatch(read(file), /^(const|let)\s/m, `${file} is included twice by ${sequence}`);
    }
  }
});

test('js/common.js runs twice in one scope', () => {
  // any Java package or class: a function that is also an object of any member
  const java = new Proxy(function () {}, { get: (target, key) => (key === Symbol.toPrimitive ? undefined : java), apply: () => java, construct: () => java });
  const context = vm.createContext({
    include: () => {}, JavaImporter: () => ({}), java, org: java, com: java, Packages: java,
    context: { getXpathApi: () => ({}) }, log: { debug() {}, warn() {}, error() {}, info() {} },
  });
  const code = read('js/common.js');
  vm.runInContext(code, context);
  assert.doesNotThrow(() => vm.runInContext(code, context));
});
