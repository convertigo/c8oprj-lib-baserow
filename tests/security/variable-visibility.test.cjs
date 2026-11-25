const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const header = /^( *)↓(\S+) \[([\w.]+?)(?:-\d+)?\]:/;
const property = /^↑?[A-Za-z_][\w.]*:( |$)/;
const indent = (line) => line.length - line.trimStart().length;

function yamlFiles(folder = path.join(root, '_c8oProject')) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(folder, entry.name);
    return entry.isDirectory() ? yamlFiles(file) : entry.name.endsWith('.yaml') ? [file] : [];
  });
}
const projectFiles = () => [path.join(root, 'c8oProject.yaml'), ...yamlFiles().sort()];

// The engine reads the properties of an object at 2 spaces under its header `↓name [type]:`, the Studio writes them
// before its children. A property written at the indent of the children, after one of them, is read as a property of
// the parent: dropped with a warning when the parent has no such property (visibility of a step), or given to the
// parent silently (its comment).
test('the properties of each object of the project are written under its header, before its children', () => {
  const wrong = [];
  for (const file of projectFiles()) {
    // the root of an included file has its properties and its children at indent 0
    const stack = [{ indent: -2, child: false }];
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      if (!line.trim()) {
        return;
      }
      const at = indent(line);
      while (stack[stack.length - 1].indent >= at) {
        stack.pop();
      }
      const parent = stack[stack.length - 1];
      const match = header.exec(line);
      if (match) {
        parent.child = parent.child || at === parent.indent + 2;
        stack.push({ indent: at, child: false });
      } else if (parent.child && at === parent.indent + 2 && property.test(line.trim())) {
        wrong.push(`${path.relative(root, file)}:${index + 1} ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(wrong, []);
});

// The variables holding a Bearer, a password, an API key, a token of Baserow or the key of a PWA link of a published
// form (forms_anonymous_key). The engine prints a variable as ****** when its visibility masks the logs: the input
// document of a requestable (INFO) and the values given by a call step (TRACE) are logged with their variables masked.
const everywhere = new Set(['__header_Authorization', 'authorization', 'password', 'apikey', 'refresh_token',
  'forms_anonymous_key']);
// variables of the Baserow API transactions: tokens, OAuth2 code, SAML response, signed file data, AI settings with keys
const transactionVariables = new Set(['access', 'refresh', 'token', 'workspace_invitation_token', 'code', 'SAMLResponse',
  'signed_data', 'openai']);
// transactions whose __body holds a password or a token (and their _raw copies), with the __body of the calls to them
const secretBodies = new Set(['_api_Auth', '_api_user_token_auth__POST', '_api_user_token_refresh__POST',
  '_api_user_token_verify__POST', '_api_user__POST', '_api_user_change_password__POST', '_api_user_reset_password__POST',
  '_api_database_views__slug__public_auth__POST', '_api_admin_users__user_id___PATCH']);

// The variables of a YAML file, with their direct properties and the transaction they belong to or are given to.
function variables(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const api = file.endsWith(path.join('connectors', 'Baserow_API_spec.yaml'));
  const block = (start) => {
    let end = start + 1;
    while (end < lines.length && (!lines[end].trim() || indent(lines[end]) > indent(lines[start]))) end++;
    return lines.slice(start + 1, end).filter((line) => indent(line) === indent(lines[start]) + 2 && property.test(line.trim()))
      .map((line) => line.trim());
  };
  const found = [];
  const stack = [];
  lines.forEach((line, index) => {
    const match = header.exec(line);
    if (!match) {
      return;
    }
    while (stack.length && stack[stack.length - 1].indent >= match[1].length) stack.pop();
    const node = { indent: match[1].length, name: match[2], kind: match[3], index };
    const parent = stack[stack.length - 1];
    if (node.kind.startsWith('variables.')) {
      let transaction = api && parent && parent.kind.startsWith('transactions.') ? parent.name : undefined;
      const source = parent && parent.kind.startsWith('steps.')
        && block(parent.index).find((text) => text.startsWith('sourceTransaction: '));
      if (source) transaction = source.split('.').pop();
      found.push({ ...node, api, transaction: transaction && transaction.replace(/_raw$/, ''), properties: block(index),
        where: `${path.relative(root, file)}:${index + 1}` });
    }
    stack.push(node);
  });
  return found;
}

test('the variables holding a secret are masked under their own header', () => {
  const secrets = projectFiles().flatMap(variables).filter((variable) => everywhere.has(variable.name)
    || (variable.api && transactionVariables.has(variable.name))
    || (variable.name === '__body' && secretBodies.has(variable.transaction)));
  assert.ok(secrets.length >= 470, `${secrets.length} variables`);
  const wrong = secrets.filter((variable) => !variable.properties.includes("visibility: '-1'"))
    .map((variable) => `${variable.where} ${variable.name}`);
  assert.deepEqual(wrong, []);
  // the refresh token given to AdminLogin by TokenGetOrRefresh and its native copy
  for (const name of ['TokenGetOrRefresh', 'TokenGetOrRefreshNative']) {
    const given = variables(path.join(root, `_c8oProject/sequences/${name}.yaml`))
      .filter((variable) => variable.name === 'refresh_token' && variable.kind === 'variables.StepVariable');
    assert.equal(given.length, 1, name);
    assert.deepEqual(given[0].properties, ['comment: The refresh token of this account', "visibility: '-1'"], name);
  }
});
