const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const folder = path.join(root, '_c8oProject/sequences');
const indent = (line) => line.length - line.trimStart().length;

// The nodes `↓name [type-id]` of a YAML file at a given indent, with their lines (header, properties and children).
function nodes(lines, at) {
  const found = [];
  lines.forEach((line, start) => {
    const header = /^\s*↓(\S+) \[([\w.]+)(?:-\d+)?\]: ?$/.exec(line);
    if (!header || (at !== undefined && indent(line) !== at)) {
      return;
    }
    let end = start + 1;
    while (end < lines.length && (lines[end].trim() === '' || indent(lines[end]) > indent(line))) end++;
    found.push({ name: header[1], kind: header[2], start, end, lines: lines.slice(start, end) });
  });
  return found;
}

// The engine logs at INFO the input document of each transaction and the answer (Generated XML) of each requestable.
// The HttpInfo element of a transaction held the request headers, the Authorization included; a header is masked in the
// logged input document only when the transaction declares it as a masked __header_ variable.
test('the Baserow transactions have no HttpInfo and mask their Authorization header in the logs', () => {
  const lines = fs.readFileSync(path.join(root, '_c8oProject/connectors/Baserow_API_spec.yaml'), 'utf8').split('\n');
  const transactions = nodes(lines, 0).filter((node) => node.kind.startsWith('transactions.'));
  assert.ok(transactions.length > 300, `${transactions.length} transactions`);
  const wrong = transactions.filter((transaction) => {
    const header = nodes(transaction.lines, 2).find((node) => node.name === '__header_Authorization');
    return transaction.lines.some((line) => /^  httpInfo: true$/.test(line))
      || !header || !header.lines.includes("    visibility: '-1'");
  }).map((transaction) => transaction.name);
  assert.deepEqual(wrong, []);
});

// The answer of these calls holds a Baserow token (Bearer, access or refresh token): the engine logs it in the thread of
// the caller, so the caller sets the MDC nolog just before and removes it just after.
// The native copies (…Native sequences, …_raw transactions) answer the same tokens.
const tokenCalls = [
  /^\s*sourceSequence: lib_BaseRow\.(TokenGetOrRefresh|formscommon_CheckConfig|AdminLogin)(Native)?$/,
  /^\s*sourceTransaction: lib_BaseRow\.Baserow_API_spec\.(_api_Auth|_api_user_token_refresh__POST)(_raw)?$/,
];

test('the calls answering a Baserow token run with the logs off', () => {
  const wrong = [];
  let count = 0;
  for (const file of fs.readdirSync(folder).filter((name) => name.endsWith('.yaml')).sort()) {
    const lines = fs.readFileSync(path.join(folder, file), 'utf8').split('\n');
    for (const call of nodes(lines)) {
      const own = indent(lines[call.start]) + 2;
      if (!call.lines.some((line) => indent(line) === own && tokenCalls.some((re) => re.test(line)))) {
        continue;
      }
      count++;
      const siblings = nodes(lines, indent(lines[call.start]));
      const at = siblings.findIndex((node) => node.start === call.start);
      const before = siblings[at - 1];
      const after = siblings[at + 1];
      const ok = before && before.end === call.start && before.kind === 'steps.SimpleStep'
        && before.lines.some((line) => line.trim() === 'expression: org.apache.log4j.MDC.put("nolog", true);')
        && after && after.start === call.end && after.kind === 'steps.SimpleStep'
        && after.lines.some((line) => line.trim() === 'expression: org.apache.log4j.MDC.remove("nolog");');
      if (!ok) wrong.push(`${file}:${call.start + 1} ${call.name}`);
    }
  }
  assert.ok(count >= 40, `${count} calls`);
  assert.deepEqual(wrong, []);
});

// The native sequences call the native copies: each of their calls answering a token is covered above.
test('the native calls answering a Baserow token are among the calls run with the logs off', () => {
  const natives = ['formssource_GetTableData', 'formssource_GetSelectData', 'formscommon_CheckConfigNative',
    'TableGetDataNative', 'TokenGetOrRefreshNative', 'AdminLoginNative'];
  const expected = { formssource_GetTableData: 2, formssource_GetSelectData: 1, formscommon_CheckConfigNative: 1,
    TableGetDataNative: 1, TokenGetOrRefreshNative: 1, AdminLoginNative: 2 };
  for (const name of natives) {
    const text = fs.readFileSync(path.join(folder, `${name}.yaml`), 'utf8');
    const calls = text.split('\n').filter((line) => tokenCalls.some((re) => re.test(line))).length;
    assert.equal(calls, expected[name], name);
    assert.equal((text.match(/expression: org\.apache\.log4j\.MDC\.put\("nolog", true\);/g) || []).length, expected[name], name);
  }
  // getAuthToken calls the native login transaction with the logs off too
  const common = fs.readFileSync(path.join(root, 'js/common.js'), 'utf8');
  assert.match(common, /MDC\.put\("nolog", true\);\s*try \{\s*authAnswer = jsonAnswer\(callNative\("\.\._api_Auth_raw"/);
});
