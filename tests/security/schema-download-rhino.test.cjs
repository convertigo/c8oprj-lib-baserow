// The download of a file of a row and the transfer folder of describe (js/baserow_schema.js engineDownload and
// engineTransfer, lib_BaseRow 1.2.0-beta25) run in Rhino against a local HTTP server: the token of the account goes
// to the host of the Baserow server only, never to another host nor after a redirection; a file above the limit is
// refused and not kept; an http error is a failure without the URL; the folder of a describe is made in the transfer
// folder and only such a folder is deleted.
// Runs when RHINO_JARS gives the classpath of Rhino (the dependencies jar of a Convertigo engine) and RHINO_JAVA the
// java that runs it (the JRE of that engine), e.g.:
//   RHINO_JAVA=~/convertigo-headless/runtime/jre/bin/java RHINO_JARS=~/convertigo-headless/runtime/engine/war/WEB-INF/lib/dependencies-8.5.0-beta.jar
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const jars = process.env.RHINO_JARS;
const java = process.env.RHINO_JAVA || 'java';
const lib = path.join(__dirname, '../../js/baserow_schema.js');

test('engineDownload and engineTransfer in Rhino', { skip: jars ? false : 'RHINO_JARS is not set' }, async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ host: req.headers.host.split(':')[0], port: req.socket.localPort, path: req.url, authorization: req.headers.authorization || null });
    const port = server.address().port;
    if (req.url === '/media/ok.pdf' || req.url === '/media/ok2.pdf') {
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': 5 });
      return res.end('hello');
    }
    if (req.url === '/media/redirect') {
      res.writeHead(302, { Location: `http://127.0.0.1:${port}/media/ok2.pdf` });
      return res.end();
    }
    if (req.url === '/media/big') {
      res.writeHead(200, { 'Content-Length': 2000 });
      return res.end(Buffer.alloc(2000));
    }
    if (req.url === '/media/chunked-big') {
      res.writeHead(200, { 'Transfer-Encoding': 'chunked' });
      res.write(Buffer.alloc(800));
      return res.end(Buffer.alloc(1200));
    }
    if (req.url === '/media/down') {
      res.writeHead(503);
      return res.end('down');
    }
    res.writeHead(404);
    return res.end('missing');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  // the same host on another port: another origin
  const other = http.createServer(server.listeners('request')[0]);
  await new Promise((resolve) => other.listen(0, '127.0.0.1', resolve));
  const otherPort = other.address().port;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'baserow-download-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'describe-outside-'));
  const script = path.join(work, 'run.js');
  fs.writeFileSync(script, `
load(${JSON.stringify(lib)});
var DIR = ${JSON.stringify(work)};
var out = {};
function attempt(name, url, max) {
  var target = DIR + "/" + name;
  try {
    var r = BaserowSchema.engine.download("JWT abc.user-token.sig", url, target, max, "http://127.0.0.1:${port}");
    out[name] = { ok: true, size: r.size, exists: new java.io.File(target).exists() };
  } catch (e) {
    out[name] = { code: e.code, retryable: e.retryable === true, message: "" + e.message, exists: new java.io.File(target).exists() };
  }
}
attempt("same", "http://127.0.0.1:${port}/media/ok.pdf", 1000);
attempt("other", "http://localhost:${port}/media/ok.pdf", 1000);
attempt("port", "http://127.0.0.1:${otherPort}/media/ok.pdf", 1000);
attempt("redirect", "http://127.0.0.1:${port}/media/redirect", 1000);
attempt("big", "http://127.0.0.1:${port}/media/big", 1000);
attempt("chunked", "http://127.0.0.1:${port}/media/chunked-big", 1000);
attempt("missing", "http://127.0.0.1:${port}/media/missing", 1000);
attempt("down", "http://127.0.0.1:${port}/media/down", 1000);
attempt("ftp", "ftp://127.0.0.1:${port}/media/ok.pdf", 1000);
attempt("closed", "http://127.0.0.1:1/media/ok.pdf", 1000);
var t = BaserowSchema.engine.transfer;
var dir = t.open();
var file = t.target(dir, 1, "a été.pdf");
var w = new java.io.FileOutputStream(file); w.write(65); w.close();
out.transfer = { dir: dir, root: "" + t.root().getPath(), accepted: BaserowSchema.engine.transferFile(file) != null };
t.remove(${JSON.stringify(outside)});
t.remove(t.root().getPath());
t.remove(dir);
out.transfer.removed = !new java.io.File(dir).exists();
out.transfer.outsideKept = new java.io.File(${JSON.stringify(outside)}).exists();
out.transfer.rootKept = t.root().exists();
print(JSON.stringify(out));
`);
  const output = await new Promise((resolve, reject) => {
    const child = spawn(java, ['-Djava.net.preferIPv4Stack=true', '-cp', jars, 'org.mozilla.javascript.tools.shell.Main', '-version', '200', script]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (status) => (status === 0 ? resolve(stdout) : reject(new Error(`rhino ${status}: ${stderr}`))));
  });
  server.close();
  other.close();
  const out = JSON.parse(output.trim().split('\n').pop());
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
  // the token: to the host of the Baserow server only, never after a redirection
  const auth = (host, p, at = port) => seen.filter((s) => s.host === host && s.path === p && s.port === at).map((s) => s.authorization);
  assert.deepEqual(out.same, { ok: true, size: 5, exists: true });
  assert.deepEqual(auth('127.0.0.1', '/media/ok.pdf'), ['JWT abc.user-token.sig']);
  assert.deepEqual(out.other, { ok: true, size: 5, exists: true });
  assert.deepEqual(auth('localhost', '/media/ok.pdf'), [null], 'no token to another host');
  assert.deepEqual(out.port, { ok: true, size: 5, exists: true });
  assert.deepEqual(auth('127.0.0.1', '/media/ok.pdf', otherPort), [null], 'no token to another port');
  assert.deepEqual(out.redirect, { ok: true, size: 5, exists: true });
  assert.deepEqual(auth('127.0.0.1', '/media/redirect'), ['JWT abc.user-token.sig']);
  assert.deepEqual(auth('127.0.0.1', '/media/ok2.pdf'), [null], 'no token after a redirection');
  // above the limit: refused, nothing kept (told by its length, or counted)
  assert.deepEqual([out.big.code, out.big.exists], ['file_too_large', false]);
  assert.deepEqual([out.chunked.code, out.chunked.exists], ['file_too_large', false]);
  // failures without the URL nor the token
  assert.deepEqual([out.missing.code, out.missing.retryable], ['file_download_failed', false]);
  assert.deepEqual([out.down.code, out.down.retryable], ['file_download_failed', true]);
  assert.deepEqual([out.ftp.code, out.closed.code, out.closed.retryable], ['file_download_failed', 'file_download_failed', true]);
  for (const name of ['big', 'chunked', 'missing', 'down', 'ftp', 'closed']) {
    assert.doesNotMatch(out[name].message, /127\.0\.0\.1|media|JWT|token/, name);
  }
  // the folder of a describe: in the transfer folder, its file accepted by the check of upload, only it deleted
  assert.equal(path.dirname(out.transfer.dir), out.transfer.root);
  assert.match(path.basename(out.transfer.dir), /^describe-[0-9a-f-]{36}$/);
  assert.equal(path.basename(out.transfer.root), 'c8o-file-transfer');
  assert.deepEqual([out.transfer.accepted, out.transfer.removed, out.transfer.outsideKept, out.transfer.rootKept], [true, true, true, true]);
});
