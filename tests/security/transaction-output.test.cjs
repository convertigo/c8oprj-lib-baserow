const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const folder = path.join(__dirname, '../../_c8oProject/sequences');
const indent = (line) => line.length - line.trimStart().length;

// The steps of every sequence with their own properties (`key: value` lines right under the step header).
function steps() {
  const found = [];
  for (const file of fs.readdirSync(folder).filter((name) => name.endsWith('.yaml')).sort()) {
    const lines = fs.readFileSync(path.join(folder, file), 'utf8').split('\n');
    lines.forEach((line, start) => {
      const header = /^\s*↓(\S+) \[steps\.(\w+)-\d+\]:/.exec(line);
      if (!header) {
        return;
      }
      const props = {};
      for (let i = start + 1; i < lines.length && (lines[i].trim() === '' || indent(lines[i]) > indent(line)); i++) {
        const prop = indent(lines[i]) === indent(line) + 2 && /^\s*([A-Za-z_]+): (.+)$/.exec(lines[i]);
        if (prop) props[prop[1]] = prop[2].trim();
      }
      found.push({ where: `${file}:${start + 1} ${header[1]}`, kind: header[2], props });
    });
  }
  return found;
}

// The transactions of Baserow_API_spec have httpInfo: their document holds an HttpInfo element with the request headers,
// the Authorization (JWT or Token) of the Baserow account included. A transaction step with output: true put it in the
// answer of the sequence (TableDeleteView, AssetFileUpload): only the Baserow answer (./document/object/*) is copied.
test('no sequence outputs the document of a Baserow transaction', () => {
  const outputs = steps()
    .filter((step) => step.kind === 'TransactionStep' && /^lib_BaseRow\.Baserow_API_spec\./.test(step.props.sourceTransaction || ''))
    .filter((step) => step.props.output === 'true')
    .map((step) => step.where);
  assert.deepEqual(outputs, []);
});

// AssetFileUpload output its input variables, the Baserow API key included.
test('no sequence outputs its input variables', () => {
  const outputs = steps()
    .filter((step) => step.kind === 'InputVariablesStep' && step.props.output === 'true')
    .map((step) => step.where);
  assert.deepEqual(outputs, []);
});

// A call answering a Baserow token (classic or native) never puts its answer in the output of the sequence.
test('no sequence outputs the answer of a call answering a Baserow token', () => {
  const outputs = steps()
    .filter((step) => step.kind === 'SequenceStep'
      && /^lib_BaseRow\.(TokenGetOrRefresh|formscommon_CheckConfig|AdminLogin)(Native)?$/.test(step.props.sourceSequence || ''))
    .filter((step) => step.props.output === 'true')
    .map((step) => step.where);
  assert.deepEqual(outputs, []);
});

// The sources C8Oforms calls (native sequences) answer their data: no output named after a token or a credential.
test('the native sources output no token', () => {
  const outputs = steps()
    .filter((step) => /^formssource_/.test(step.where))
    .filter((step) => ['JsonToXmlStep', 'ElementStep', 'JsonObjectStep', 'JsonFieldStep'].includes(step.kind))
    .filter((step) => /bearer|token|password|authorization/i.test(`${step.props.key || ''} ${step.props.nodeName || ''}`))
    .map((step) => step.where);
  assert.deepEqual(outputs, []);
});
