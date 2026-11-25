const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const folder = path.join(__dirname, '../../_c8oProject/sequences');
const header = /^( *)↓(\S+) \[([\w.]+)-(\d+)\]:/;

// The steps of a sequence as a tree (variables are kept as children of their step), with the step ids read by the
// sources of each node (sourceDefinition, SmartType SOURCE).
function tree(yaml) {
  const root = { name: '<sequence>', kind: 'sequence', indent: -1, parent: null, children: [], refs: [] };
  const stack = [root];
  const byId = new Map();
  yaml.split('\n').forEach((line, index) => {
    const match = header.exec(line);
    const indent = match ? match[1].length : line.length - line.trimStart().length;
    if (!line.trim()) {
      return;
    }
    while (stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    if (match) {
      const node = { name: match[2], kind: match[3], id: match[4], indent, line: index + 1, parent: stack[stack.length - 1], children: [], refs: [] };
      node.parent.children.push(node);
      stack.push(node);
      byId.set(node.id, node);
      return;
    }
    const ref = /↑value: (\d{12,14})\s*$/.exec(line);
    if (ref) {
      stack[stack.length - 1].refs.push(ref[1]);
    }
  });
  return byId;
}

const isStep = (node) => node.kind.startsWith('steps.');
const label = (node) => {
  const names = [];
  for (let n = node; n.parent; n = n.parent) names.unshift(n.name);
  return names.join('/');
};

// A source step surely ran before the step reading it when it encloses the reader (an iterator item...) or when it is
// a previous step of a block enclosing the reader. A step of another branch of an if/else, inside an if or a loop the
// reader is not in, or after the reader may not have run: the engine then skips the reading step ("source is in
// error") or fails ("Did not find source").
function ranBefore(source, reader) {
  const chain = [];
  for (let n = reader; n; n = n.parent) chain.push(n);
  if (chain.includes(source)) {
    return true;
  }
  const at = chain.indexOf(source.parent);
  return at > 0 && source.parent.children.indexOf(source) < source.parent.children.indexOf(chain[at - 1]);
}

function unsureSources(yaml) {
  const byId = tree(yaml);
  const found = [];
  for (const node of byId.values()) {
    let reader = node;
    while (reader && !isStep(reader)) reader = reader.parent;
    for (const id of node.refs) {
      const source = byId.get(id);
      if (reader && source && isStep(source) && !ranBefore(source, reader)) {
        found.push(`${label(node)} (line ${node.line}) reads ${label(source)} (line ${source.line})`);
      }
    }
  }
  return found;
}

test('the check finds a source read from another branch of an if/else', () => {
  const yaml = [
    '↓jIfThenElse [steps.IfThenElseStep-1000000000001]: ',
    '  ↓jThen [steps.ThenStep-1000000000002]: ',
    '    ↓Update [steps.SequenceStep-1000000000003]: ',
    '    ↓IfExist [steps.IfExistStep-1000000000004]: ',
    '      sourceDefinition: ',
    '        - xmlizable: ',
    '          - com.twinsoft.convertigo.beans.common.XMLVector: ',
    '            - java.lang.String: ',
    '              - ↑value: 1000000000006',
    '  ↓jElse [steps.ElseStep-1000000000005]: ',
    '    ↓Create [steps.SequenceStep-1000000000006]: ',
    '↓Call [steps.SequenceStep-1000000000007]: ',
    '  ↓authorization [variables.StepVariable-1000000000008]: ',
    '    sourceDefinition: ',
    '      - xmlizable: ',
    '        - com.twinsoft.convertigo.beans.common.XMLVector: ',
    '          - java.lang.String: ',
    '            - ↑value: 1000000000006',
    '↓Copy [steps.XMLCopyStep-1000000000009]: ',
    '  sourceDefinition: ',
    '    - xmlizable: ',
    '      - com.twinsoft.convertigo.beans.common.XMLVector: ',
    '        - java.lang.String: ',
    '          - ↑value: 1000000000007',
  ].join('\n');
  assert.deepEqual(unsureSources(yaml), [
    'jIfThenElse/jThen/IfExist (line 4) reads jIfThenElse/jElse/Create (line 11)',
    'Call/authorization (line 13) reads jIfThenElse/jElse/Create (line 11)',
  ]);
});

// The update branch of forms_AddRow / forms_AddRowFromData read the create call of the other branch (a refused update
// was answered as a success), formscommon_FieldsList gave FieldsList the Bearer of a step of the non-editor branch.
test('no step reads a step that may not have run', () => {
  const found = [];
  for (const file of fs.readdirSync(folder).filter((name) => name.endsWith('.yaml')).sort()) {
    for (const entry of unsureSources(fs.readFileSync(path.join(folder, file), 'utf8'))) {
      found.push(`${file}: ${entry}`);
    }
  }
  assert.deepEqual(found, []);
});
