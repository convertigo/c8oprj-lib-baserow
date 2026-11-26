// formssource_GetSelectData, displayColumns (convertigo/C8oForms M15 of « L'Arbre à Chats »): the label of an option made of
// several columns, in their order, joined by displaySeparator (a space by default). The columns are read with the others
// (include_fields); a list of fewer than 2 columns is ignored (the label is displayValue, as before). Each cell shows as its
// column shows it, an empty one left out, the separator escaped.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readSequence, readProjectFile, stepProperty } = require('./read-yaml-steps.cjs');

const yaml = readSequence('formssource_GetSelectData');
const parse = stepProperty(yaml, 'ParseConfig', 'expression');
const compute = stepProperty(yaml, 'computeValue', 'expression');
const helper = (script, name) => {
  const match = new RegExp(`var ${name} = function\\([^)]*\\) \\{[\\s\\S]*?\\n    \\t?\\};`).exec(script) || new RegExp(`var ${name} = function\\([^)]*\\) \\{[\\s\\S]*?\\n\\s*\\};`).exec(script);
  assert.ok(match, name);
  return match[0];
};

test('displayColumns: the columns of the label, in their order, 2 at least, 10 at most, each once', () => {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(helper(parse, 'readDisplayColumns'), sandbox);
  const read = (config) => JSON.parse(JSON.stringify(sandbox.readDisplayColumns(config)));
  assert.deepEqual(read({ displayColumns: ['Nom', ' Prénom ', 'Nom', '', null, { a: 1 }] }), ['Nom', 'Prénom']);
  assert.deepEqual(read({ displayColumns: ['Nom'] }), [], 'one column: displayValue');
  assert.deepEqual(read({ displayColumns: 'Nom,Prénom' }), [], 'a list only');
  assert.deepEqual(read({}), []);
  assert.equal(read({ displayColumns: Array.from({ length: 14 }, (_, i) => 'c' + i) }).length, 10);
  assert.match(parse, /var displaySeparator = typeof jConfig\.displaySeparator == "string" && jConfig\.displaySeparator\.length <= 10 \? jConfig\.displaySeparator : " ";/);
  assert.match(parse, /for \(var iDisplayColumn = 0; iDisplayColumn < displayColumns\.length; iDisplayColumn\+\+\) \{\n\s+appendUniqueColumn\(includeColumns, includeColumnsMap, displayColumns\[iDisplayColumn\]\);/);
});

test('the label joins the cells as their columns show them, the empty ones left out, the separator escaped', () => {
  const utils = readProjectFile('js/utils.js');
  const base = /var base_html = (".*?"|'.*?');/.exec(utils)[1];
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`var base_html = ${base}; var close_html = '</div>';\n` + helper(compute, 'joinDisplayHtml'), sandbox);
  const html = sandbox.joinDisplayHtml(['Martin</div>', '<b>Alice</b></div>', '</div>', '<div class="x"></div></div>'], ' ');
  assert.equal(html, sandbox.base_html + 'Martin<span>&nbsp;</span><b>Alice</b></div>');
  assert.equal(sandbox.joinDisplayHtml(['A</div>', 'B</div>'], ' <b> - '), sandbox.base_html + 'A<span>&nbsp;&lt;b&gt;&nbsp;-&nbsp;</span>B</div>');
  assert.equal(sandbox.joinDisplayHtml(['<img src="x.png"></div>', 'Chat</div>'], ', '), sandbox.base_html + '<img src="x.png"><span>,&nbsp;</span>Chat</div>');
  assert.match(compute, /var label = displayColumns\.length > 1 \? joinDisplayHtml\(displayColumns\.map\(\(column\) => formatBaserowCell\(x\[column\] != null \? x\[column\] : "", structureByName\[column\], false\)\.innerHtml\), displaySeparator\) : base_html \+ displayResult\.innerHtml;/);
  assert.match(compute, /displayValue: label,/);
});
