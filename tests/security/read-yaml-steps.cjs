// Helpers for the read-*.test.cjs tests: pull the JavaScript of a step out of a
// Convertigo YAML sequence (a quoted block uses '' for a single quote).
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');

function readSequence(name) {
  return fs.readFileSync(path.join(root, '_c8oProject/sequences', `${name}.yaml`), 'utf8');
}

function readProjectFile(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

// The block of the first `key: |` (or `key: value`) property under the step `↓<header>`.
function stepProperty(yaml, header, key) {
  const lines = yaml.split('\n');
  const start = lines.findIndex((line) => line.trim().startsWith(`↓${header}`));
  if (start < 0) throw new Error(`step ${header} not found`);
  const stepIndent = lines[start].search(/\S/);
  for (let i = start + 1; i < lines.length; i++) {
    const indent = lines[i].search(/\S/);
    if (indent >= 0 && indent <= stepIndent) break;
    const trimmed = lines[i].trim();
    if (trimmed === `${key}: |`) {
      const block = [];
      for (let j = i + 1; j < lines.length; j++) {
        const lineIndent = lines[j].search(/\S/);
        if (lineIndent >= 0 && lineIndent <= indent) break;
        block.push(lines[j]);
      }
      const blockIndent = block[0].search(/\S/);
      let text = block.map((line) => line.slice(blockIndent)).join('\n').replace(/\s+$/, '');
      if (text.startsWith("'") && text.endsWith("'")) {
        text = text.slice(1, -1).replace(/''/g, "'");
      }
      return text;
    }
    if (trimmed.startsWith(`${key}: `)) {
      return trimmed.slice(key.length + 2);
    }
  }
  throw new Error(`${key} of ${header} not found`);
}

module.exports = { readSequence, readProjectFile, stepProperty };
