// CONV-1658: the native JSON steps of the engine read a row by the name of its column, and miss a key that a
// JavaScript object keeps as an array index ("2024"): the cells of such a column came back empty. formssource_GetTableData
// leaves the rows of such a table to ComputeData, neither streamed nor formatted by the native steps.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readSequence, stepProperty } = require('./read-yaml-steps.cjs');

const yaml = readSequence('formssource_GetTableData');
const decideStream = stepProperty(yaml, 'DecideStream', 'expression');
const nativeOrJs = stepProperty(yaml, 'NativeOrJs', 'expression');

function decide(structure, results, hasLinkDisplay = false) {
  const scope = { structure, results, streamEligible: true, pluginGroups: null, isModelMode: false, pluginRequiredError: null, hasLinkDisplay };
  vm.createContext(scope);
  vm.runInContext(decideStream.replace(/\$\{lib_baserow\.[a-z_]+=([a-z]+)\}/g, '$1'), scope);
  vm.runInContext(nativeOrJs.replace(/\$\{lib_baserow\.[a-z_]+=([a-z]+)\}/g, '$1'), scope);
  return { streamRows: scope.streamRows, nativeSteps: scope.nativeSteps };
}

test('a table with a column named by an integer is formatted by ComputeData', () => {
  const rows = [{ id: 1, order: '1', Name: 'Accueil', 2024: 120, 2025: 150 }];
  const fields = [{ name: 'Name' }, { name: '2024' }, { name: '2025' }];
  assert.deepEqual(decide(fields, rows), { streamRows: false, nativeSteps: false });
  // the structure is not always read: the keys of the first row tell it too
  assert.deepEqual(decide(undefined, rows), { streamRows: false, nativeSteps: false });
});

test('the other tables keep the native steps and the stream', () => {
  const rows = [{ id: 1, order: '1', Name: 'Accueil', 'Année 2024': 120, '02024': 1, '1.5': 2, '-1': 3, '99999999999': 4 }];
  assert.deepEqual(decide([{ name: 'Name' }, { name: 'Année 2024' }], rows), { streamRows: true, nativeSteps: false });
  const scope = { structure: null, results: rows, streamEligible: false, pluginGroups: null, isModelMode: false, pluginRequiredError: null };
  vm.createContext(scope);
  vm.runInContext(decideStream, scope);
  vm.runInContext(nativeOrJs.replace(/\$\{lib_baserow\.[a-z_]+=([a-z]+)\}/g, '$1'), scope);
  assert.equal(scope.nativeSteps, true);
});

test('a table whose links show another column of their rows (link_display) reads its pages here, no stream', () => {
  const rows = [{ id: 1, order: '1', Name: 'Accueil', Owner: [{ id: 3, value: '3018' }] }];
  assert.deepEqual(decide([{ name: 'Name' }, { name: 'Owner', type: 'link_row' }], rows, true), { streamRows: false, nativeSteps: true });
  assert.deepEqual(decide([{ name: 'Name' }, { name: 'Owner', type: 'link_row' }], rows, false), { streamRows: true, nativeSteps: false });
});
