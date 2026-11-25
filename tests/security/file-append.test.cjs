// forms_appendFiles (forms_AddRow, forms_AddRowFromData, js/file_append.js): an update of a row adds the files it sends
// to a file column to the files the row already has, instead of replacing them. Off by default: without the option a
// file column is written with the files of this submit only (Baserow replaces the list of the cell).
// The step AppendFiles of the YAML is run here as the engine runs it, against an in-memory Baserow row store.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readSequence, readProjectFile, stepProperty } = require('./read-yaml-steps.cjs');

const fileAppend = require('../../js/file_append.js');
const writers = { forms_AddRow: '1734427992515', forms_AddRowFromData: '1743074271016' };
const plain = (value) => JSON.parse(JSON.stringify(value));

// The fields of the table "Constats" of the template "Suivi qualité": a file column of evidences among other columns.
const fields = [
  { id: 1, name: 'Titre', type: 'text', primary: true },
  { id: 2, name: 'Statut', type: 'single_select', select_options: [{ id: 11, value: 'Ouvert' }, { id: 12, value: 'Clos' }] },
  { id: 3, name: 'Preuves', type: 'file' },
  { id: 4, name: 'Photos', type: 'file' },
  { id: 5, name: 'Commentaire', type: 'long_text' },
];

// A Baserow file as an upload answers it: the same file uploaded again gets the same name (Baserow finds it by its hash)
const originals = {};
const uploaded = (original) => {
  const name = `${original.replace(/\W/g, '')}_0123456789abcdef.${original.split('.').pop()}`;
  originals[name] = original;
  return { name, original };
};

// In-memory rows of the table: PATCH writes the columns given only (a file cell is replaced by the list given), GET
// answers the row with user field names.
function baserowRows(initial) {
  const rows = new Map(Object.entries(initial || {}).map(([id, row]) => [id, plain({ id: Number(id), ...row })]));
  const calls = [];
  const fileCell = (files) => files.map((file) => ({
    name: file.name, visible_name: file.visible_name || originals[file.name] || file.name, size: 10, url: `https://baserow/media/${file.name}`,
  }));
  return {
    calls,
    rows,
    get(rowId) {
      calls.push({ verb: 'GET', rowId: '' + rowId });
      const row = rows.get('' + rowId);
      return row ? plain(row) : { error: 'ERROR_ROW_DOES_NOT_EXIST', detail: `The row ${rowId} does not exist.` };
    },
    patch(rowId, dataText) {
      calls.push({ verb: 'PATCH', rowId: '' + rowId, data: JSON.parse(dataText) });
      const row = rows.get('' + rowId);
      for (const [name, value] of Object.entries(JSON.parse(dataText))) {
        const field = fields.find((candidate) => candidate.name === name);
        row[name] = field && field.type === 'file' ? fileCell(value) : value;
      }
      return plain(row);
    },
    files(rowId, column) {
      return (rows.get('' + rowId)[column] || []).map((file) => file.name);
    },
  };
}

// The map of the locks the engine keeps for the server (a java.util.concurrent.ConcurrentHashMap)
class LockStore {
  constructor() { this.map = new Map(); }
  get(key) { return this.map.has(key) ? this.map.get(key) : null; }
  putIfAbsent(key, value) { if (this.map.has(key)) return this.map.get(key); this.map.set(key, value); return null; }
  replace(key, old, value) { if (this.map.get(key) !== old) return false; this.map.set(key, value); return true; }
  remove(key, value) { if (this.map.get(key) !== value) return false; this.map.delete(key); return true; }
}

// One server: the project store of the engine (context.project.get/set), its clock and its log
function server(options = {}) {
  const store = new Map();
  let uuid = 0;
  const clock = { now: 1_000_000 };
  const warnings = [];
  const forgotten = [];
  return {
    store,
    clock,
    warnings,
    forgotten,
    context: { project: { get: (key) => (store.has(key) ? store.get(key) : null), set: (key, value) => store.set(key, value) } },
    java: {
      util: { concurrent: { ConcurrentHashMap: LockStore }, UUID: { randomUUID: () => `owner-${options.name || 's'}-${++uuid}` } },
      lang: { System: { currentTimeMillis: () => clock.now }, Thread: { sleep: (ms) => (options.onSleep ? options.onSleep(ms) : (clock.now += ms)) } },
    },
    log: { warn: (message) => warnings.push(message) },
  };
}

// The steps AppendFiles then ReleaseAppendFiles of a writer, run as the engine runs them (in the scope of the sequence)
function appendStep(name) {
  const yaml = readSequence(name);
  const code = stepProperty(yaml, 'AppendFiles', 'expression');
  const release = stepProperty(yaml, 'ReleaseAppendFiles', 'expression');
  const library = readProjectFile('js/file_append.js');
  const prepare = new Function('include', 'context', 'java', 'log', 'jsonAnswer', 'callNative', 'isRefusedToken', 'forgetCachedToken',
    'data', 'jFields', 'table_id', 'row_id', 'appendFilesAuthorization',
    `var appendFiles, appendFilesError, baserowFileAppend;\n${library}\n${code}\n;return { data: data, appendFiles: appendFiles, appendFilesError: appendFilesError, appendFilesAuthorization: appendFilesAuthorization, release: function () {\n${release}\n} };`);
  return (srv, baserow, vars) => {
    const reads = [];
    const run = prepare(() => {}, srv.context, srv.java, srv.log, (answer) => answer,
      (requestable, params) => {
        reads.push({ requestable, params: plain(params) });
        return baserow.get(params.row_id);
      },
      (answer) => answer != null && answer.error === 'ERROR_INVALID_ACCESS_TOKEN',
      (authorization) => srv.forgotten.push(authorization),
      vars.data, vars.jFields === undefined ? fields : vars.jFields, vars.tableId || '901', vars.rowId, 'JWT source-token');
    run.reads = reads;
    return run;
  };
}

// A submit of the update page: the step runs AppendFiles when its option is on, then TableUpdateRow, then the release
function update(name, srv, baserow, rowId, data, appendOption) {
  const condition = stepProperty(readSequence(name), 'IfAppendFiles', 'condition');
  const on = new Function('forms_appendFiles', `return ${condition};`)(appendOption);
  let written = JSON.stringify(data);
  let step = null;
  if (on) {
    step = appendStep(name)(srv, baserow, { data: written, rowId });
    if (step.appendFilesError !== '') {
      return { error: step.appendFilesError, step };
    }
    written = step.data;
  }
  baserow.patch(rowId, written);
  if (step) {
    step.release();
  }
  return { error: '', step };
}

const A = uploaded('constat-a.jpg');
const B = uploaded('constat-b.pdf');
const C = uploaded('constat-c.jpg');
const D = uploaded('constat-d.jpg');
const fileRef = (file) => ({ name: file.name });

test('the option is declared by both writers, off by default, and only "true" turns it on', () => {
  for (const name of Object.keys(writers)) {
    const yaml = readSequence(name);
    assert.match(yaml, /\n↓forms_appendFiles \[variables\.RequestableVariable-\d+\]: \n  comment: \|\n[\s\S]+?\n  description: boolean=false\n  value: $/, name);
    const variable = yaml.slice(yaml.indexOf('↓forms_appendFiles ['));
    assert.match(variable, /"displayName": "Add the files to the existing ones"/);
    assert.match(variable, /"displayName": "Ajouter les fichiers aux fichiers existants"/);
    const condition = stepProperty(yaml, 'IfAppendFiles', 'condition');
    const on = (value) => new Function('forms_appendFiles', `return ${condition};`)(value);
    for (const value of [undefined, null, '', 'false', 'append', 'yes', '1', false]) {
      assert.equal(on(value), false, `${name}: ${JSON.stringify(value)}`);
    }
    for (const value of ['true', ' TRUE ', true]) {
      assert.equal(on(value), true, `${name}: ${JSON.stringify(value)}`);
    }
    for (const value of ['', 'false', null, 'yes', true, 'true', ' True ']) {
      assert.equal(fileAppend.wanted(value), on(value), `${name}: wanted(${JSON.stringify(value)})`);
    }
  }
});

test('the files are read and merged in the update branch only, after the rights checks, just before TableUpdateRow', () => {
  for (const [name, checkConfig] of Object.entries(writers)) {
    const yaml = readSequence(name);
    const at = (text) => {
      const index = yaml.indexOf(text);
      assert.ok(index > 0, `${name}: ${text}`);
      return index;
    };
    const checkConfigCall = at('sourceSequence: lib_BaseRow.formscommon_CheckConfig\n');
    const checkConfigError = at('↓IfError [steps.IfExistStep-');
    const checkRow = at('↓IfRowRefused [steps.IfExistStep-');
    const thenBranch = at('  ↓jThen [steps.ThenStep-');
    const makeRowId = at('    ↓MakeRowID [steps.SimpleStep-');
    const append = at('    ↓IfAppendFiles [steps.IfStep-');
    const appendError = at('      ↓IfAppendFilesError [steps.IfStep-');
    const updateCall = at('      sourceSequence: lib_BaseRow.TableUpdateRow\n');
    const release = at('    ↓ReleaseAppendFiles [steps.SimpleStep-');
    const updateError = yaml.indexOf('    ↓IfExist [steps.IfExistStep-', updateCall);
    const elseBranch = at('  ↓jElse [steps.ElseStep-');
    assert.ok(checkConfigCall < checkConfigError && checkConfigError < checkRow && checkRow < thenBranch && thenBranch < makeRowId
      && makeRowId < append && append < appendError && appendError < updateCall && updateCall < release && release < updateError
      && updateError < elseBranch, name);
    // each appears once: a creation (jElse) reads nothing
    for (const step of ['↓IfAppendFiles [', '↓AppendFiles [', '↓ReleaseAppendFiles [', '↓appendFilesAuthorization [']) {
      assert.equal(yaml.split(step).length, 2, `${name}: ${step}`);
    }
    // the Bearer of the source, from formscommon_CheckConfig of this write, read by a raw transaction (no document, no log)
    const block = yaml.slice(append, appendError);
    assert.match(block, new RegExp(`↑value: ${checkConfig}\\n[^\\n]*\\n\\s+- ↑value: \\./document/Bearer/text\\(\\)\\n\\s+variableName: appendFilesAuthorization\\n`), name);
    assert.match(block, /callNative\("lib_BaseRow\.Baserow_API_spec\._api_database_rows_table__table_id___row_id___GET_raw"/);
    assert.match(block, /appendFilesAuthorization = null;/);
    assert.match(block, /appendFilesToken = null;/);
    // an error stops the write
    assert.match(yaml.slice(appendError, updateCall), /- →→: appendFilesError\n\s+↓Return \[steps\.ReturnStep-\d+\]: \n/);
  }
  // both writers run the same steps
  const steps = (name) => ['AppendFiles', 'ReleaseAppendFiles'].map((step) => stepProperty(readSequence(name), step, 'expression'));
  assert.deepEqual(steps('forms_AddRow'), steps('forms_AddRowFromData'));
});

test('T02 "Suivi qualité": A and B saved, then C added to the same row, keeps A, B and C', () => {
  for (const name of Object.keys(writers)) {
    const srv = server();
    const baserow = baserowRows({
      7: { Titre: 'Fuite atelier 2', Statut: { id: 11, value: 'Ouvert' }, Preuves: [], Photos: [], Commentaire: 'à suivre' },
      8: { Titre: 'Autre constat', Statut: { id: 12, value: 'Clos' }, Preuves: [{ name: 'other_0123456789abcdef.png', visible_name: 'other.png' }], Photos: [], Commentaire: '' },
    });
    const other = plain(baserow.rows.get('8'));
    // first visit: A and B
    assert.equal(update(name, srv, baserow, '7', { Preuves: [fileRef(A), fileRef(B)] }, 'true').error, '');
    assert.deepEqual(baserow.files(7, 'Preuves'), [A.name, B.name], name);
    // back on the row: C, and the comment changed
    const result = update(name, srv, baserow, '7', { Preuves: [fileRef(C)], Commentaire: 'preuve ajoutée' }, 'true');
    assert.equal(result.error, '');
    assert.deepEqual(baserow.files(7, 'Preuves'), [A.name, B.name, C.name], name);
    // the PATCH holds the column of the files and the columns of the write only
    const patch = baserow.calls.filter((call) => call.verb === 'PATCH').pop();
    assert.deepEqual(Object.keys(patch.data).sort(), ['Commentaire', 'Preuves']);
    assert.deepEqual(patch.data.Preuves, [{ name: A.name, visible_name: 'constat-a.jpg' }, { name: B.name, visible_name: 'constat-b.pdf' }, { name: C.name }]);
    // the other columns and the other rows are not changed
    const row = baserow.rows.get('7');
    assert.deepEqual([row.Titre, row.Statut, row.Photos, row.Commentaire], ['Fuite atelier 2', { id: 11, value: 'Ouvert' }, [], 'preuve ajoutée']);
    assert.deepEqual(baserow.rows.get('8'), other);
    // one read of the row, with the account of the source, by user field names
    assert.deepEqual(result.step.reads.map((read) => read.params), [{ __header_Authorization: 'JWT source-token', table_id: '901', row_id: '7', user_field_names: 'true' }]);
    assert.equal(result.step.appendFilesAuthorization, null, 'the Bearer does not stay in the scope of the sequence');
    // the lock of the row is released
    assert.equal(srv.store.get('lib_baserow.file_append_locks').map.size, 0);
  }
});

test('without the option, the bug as reported: C replaces A and B (the behavior kept by default)', () => {
  for (const name of Object.keys(writers)) {
    const srv = server();
    const baserow = baserowRows({ 7: { Titre: 'Fuite', Preuves: [] } });
    update(name, srv, baserow, '7', { Preuves: [fileRef(A), fileRef(B)] }, '');
    const result = update(name, srv, baserow, '7', { Preuves: [fileRef(C)] }, '');
    assert.equal(result.step, null, 'nothing is read');
    assert.deepEqual(baserow.files(7, 'Preuves'), [C.name], name);
    // and a file column sent empty empties the cell
    update(name, srv, baserow, '7', { Preuves: [] }, 'false');
    assert.deepEqual(baserow.files(7, 'Preuves'), [], name);
    assert.equal(baserow.calls.filter((call) => call.verb === 'GET').length, 0);
  }
});

test('each Baserow file once: a file sent again, twice in a submit, or already in the row is not duplicated', () => {
  const srv = server();
  const baserow = baserowRows({ 7: { Preuves: [{ name: A.name, visible_name: 'Renamed in Baserow.jpg' }] } });
  update('forms_AddRowFromData', srv, baserow, '7', { Preuves: [fileRef(A), fileRef(C), fileRef(C), { name: '' }, null, { visible_name: 'x' }] }, 'true');
  assert.deepEqual(baserow.files(7, 'Preuves'), [A.name, C.name]);
  // the name shown in Baserow is kept
  assert.equal(baserow.rows.get('7').Preuves[0].visible_name, 'Renamed in Baserow.jpg');
  assert.deepEqual(plain(fileAppend.mergeCell([{ name: 'x', visible_name: 'X', url: 'u', thumbnails: {} }, { name: 'x' }], [{ name: 'y' }, { name: 'x' }])),
    [{ name: 'x', visible_name: 'X' }, { name: 'y' }]);
});

test('a file column sent without a new file is left out of the write: the row keeps its files', () => {
  const srv = server();
  const baserow = baserowRows({ 7: { Titre: 'Fuite', Preuves: [{ name: A.name }], Photos: [{ name: B.name }] } });
  const result = update('forms_AddRowFromData', srv, baserow, '7', { Titre: 'Fuite (corrigé)', Preuves: [], Photos: [fileRef(D)] }, 'true');
  assert.deepEqual([result.step.appendFiles.appended, result.step.appendFiles.kept], [['Photos'], ['Preuves']]);
  const patch = baserow.calls.find((call) => call.verb === 'PATCH');
  assert.deepEqual(Object.keys(patch.data).sort(), ['Photos', 'Titre']);
  assert.deepEqual([baserow.files(7, 'Preuves'), baserow.files(7, 'Photos'), baserow.rows.get('7').Titre], [[A.name], [B.name, D.name], 'Fuite (corrigé)']);
});

test('a write without a file column reads nothing; a column that is not a file column of the table is not merged', () => {
  const srv = server();
  const baserow = baserowRows({ 7: { Titre: 'Fuite', Commentaire: 'x', Preuves: [{ name: A.name }] } });
  const textOnly = update('forms_AddRowFromData', srv, baserow, '7', { Commentaire: 'y' }, 'true');
  assert.equal(textOnly.step.reads.length, 0);
  assert.equal(textOnly.step.data, JSON.stringify({ Commentaire: 'y' }));
  // a list sent to a text column, or a column unknown to the table, is written as given
  assert.deepEqual(fileAppend.columns({ Commentaire: [], Inconnue: [{ name: 'z' }], Preuves: [], Photos: 'x' }, fields), ['Preuves']);
  assert.deepEqual(fileAppend.columns({ Preuves: [] }, { name: 'Preuves', type: 'file' }), ['Preuves'], 'FieldsList answers one field as an object');
  assert.deepEqual(fileAppend.columns({ Preuves: [] }, null), []);
  assert.deepEqual(fileAppend.columns(null, fields), []);
});

test('a row that cannot be read, or a row id that is not one, stops the write instead of replacing the files', () => {
  for (const name of Object.keys(writers)) {
    const srv = server();
    const baserow = baserowRows({ 7: { Preuves: [{ name: A.name }] } });
    const missing = update(name, srv, baserow, '9', { Preuves: [fileRef(C)] }, 'true');
    assert.equal(missing.error, 'The files of the row 9 could not be read to add the new ones, nothing was written (ERROR_ROW_DOES_NOT_EXIST: The row 9 does not exist.)');
    const injected = update(name, srv, baserow, '7/../8', { Preuves: [fileRef(C)] }, 'true');
    assert.equal(injected.error, 'The files cannot be added to the row "7/../8": it is not a row id, nothing was written');
    assert.equal(injected.step.reads.length, 0);
    assert.equal(baserow.calls.filter((call) => call.verb === 'PATCH').length, 0);
    assert.deepEqual(baserow.files(7, 'Preuves'), [A.name]);
    assert.equal(srv.store.get('lib_baserow.file_append_locks').map.size, 0, 'the lock is released on an error');
  }
  // a token Baserow refuses is forgotten by the token cache, and nothing is written
  const srv = server();
  const refused = { calls: [], get: () => ({ error: 'ERROR_INVALID_ACCESS_TOKEN', detail: 'Access token is expired.' }) };
  const step = appendStep('forms_AddRowFromData')(srv, refused, { data: JSON.stringify({ Preuves: [fileRef(C)] }), rowId: '7' });
  assert.match(step.appendFilesError, /could not be read .*ERROR_INVALID_ACCESS_TOKEN/);
  assert.deepEqual(srv.forgotten, ['JWT source-token']);
});

test('two appends to the same row on this server run one after the other: none of the files is lost', () => {
  // W1 adds C and holds the row; W2 (adding D) waits; while it waits, W1 writes and releases the row; W2 then reads the
  // row with C and writes A, B, C, D.
  const baserow = baserowRows({ 7: { Preuves: [{ name: A.name }, { name: B.name }] } });
  let w1 = null;
  const srv = server({
    onSleep: (ms) => {
      srv.clock.now += ms;
      if (w1 != null) {
        baserow.patch('7', w1.data);
        w1.release();
        w1 = null;
      }
    },
  });
  w1 = appendStep('forms_AddRowFromData')(srv, baserow, { data: JSON.stringify({ Preuves: [fileRef(C)] }), rowId: '7' });
  assert.equal(w1.appendFiles.owner, 'owner-s-1');
  const w2 = appendStep('forms_AddRow')(srv, baserow, { data: JSON.stringify({ Preuves: [fileRef(D)] }), rowId: '7' });
  assert.equal(w2.appendFiles.owner, 'owner-s-2');
  baserow.patch('7', w2.data);
  w2.release();
  assert.deepEqual(baserow.files(7, 'Preuves'), [A.name, B.name, C.name, D.name]);
  assert.deepEqual(baserow.calls.map((call) => call.verb), ['GET', 'PATCH', 'GET', 'PATCH']);
  assert.equal(srv.store.get('lib_baserow.file_append_locks').map.size, 0);
  // another row is not held by the lock of row 7
  const other = server();
  const store = new LockStore();
  other.store.set('lib_baserow.file_append_locks', store);
  assert.ok(fileAppend.tryLock(store, '901/7', 'a', 0, 1000));
  assert.ok(fileAppend.tryLock(store, '901/8', 'b', 0, 1000));
  assert.ok(!fileAppend.tryLock(store, '901/7', 'c', 10, 1000));
});

test('LIMIT: a write by another server (or one without the option) between the read and the write is not seen', () => {
  // Baserow has no version or lock a write could check: the lock only orders the appends made through this server. Two
  // servers appending at the same time to the same row: both read A, B; the last write wins and the other new file is
  // lost. Documented by this test: the day it fails, the limit is gone.
  const baserow = baserowRows({ 7: { Preuves: [{ name: A.name }, { name: B.name }] } });
  const first = server({ name: 'one' });
  const second = server({ name: 'two' });
  const w1 = appendStep('forms_AddRowFromData')(first, baserow, { data: JSON.stringify({ Preuves: [fileRef(C)] }), rowId: '7' });
  const w2 = appendStep('forms_AddRowFromData')(second, baserow, { data: JSON.stringify({ Preuves: [fileRef(D)] }), rowId: '7' });
  assert.ok(w1.appendFiles.owner != null && w2.appendFiles.owner != null, 'each server locks its own copy of the row');
  baserow.patch('7', w2.data);
  baserow.patch('7', w1.data);
  w1.release();
  w2.release();
  assert.deepEqual(baserow.files(7, 'Preuves'), [A.name, B.name, C.name], 'D is lost');
});

test('a lock left by a write stopped before its release ends with its lease; a write waits WAIT_MS at most', () => {
  assert.deepEqual([fileAppend.LEASE_MS, fileAppend.WAIT_MS], [60000, 10000]);
  const store = new LockStore();
  // a crashed write holds the row until the end of its lease
  assert.ok(fileAppend.tryLock(store, '901/7', 'crashed', 0, 60000));
  assert.ok(!fileAppend.tryLock(store, '901/7', 'next', 59999, 60000));
  assert.ok(fileAppend.tryLock(store, '901/7', 'next', 60000, 60000));
  // its late release does not free the row of the write that took it over
  fileAppend.release(store, '901/7', 'crashed');
  assert.match(store.get('901/7'), /^next@/);
  fileAppend.release(store, '901/7', 'next');
  assert.equal(store.get('901/7'), null);
  // a write that finds the row held waits WAIT_MS, then goes on without the lock (logged), the row read just before
  const baserow = baserowRows({ 7: { Preuves: [{ name: A.name }] } });
  const srv = server();
  const locks = new LockStore();
  srv.store.set('lib_baserow.file_append_locks', locks);
  fileAppend.tryLock(locks, '901/7', 'stuck', srv.clock.now, 60000);
  const start = srv.clock.now;
  const step = appendStep('forms_AddRowFromData')(srv, baserow, { data: JSON.stringify({ Preuves: [fileRef(C)] }), rowId: '7' });
  assert.equal(step.appendFiles.owner, null);
  assert.equal(step.appendFilesError, '');
  assert.ok(srv.clock.now - start >= 10000 && srv.clock.now - start < 10100, `${srv.clock.now - start} ms`);
  assert.deepEqual(JSON.parse(step.data).Preuves.map((file) => file.name), [A.name, C.name]);
  assert.deepEqual(srv.warnings, ['(forms_appendFiles) the row 901/7 stayed locked by another write: it is written without the lock']);
  // its release leaves the lock of the other write
  step.release();
  assert.match(locks.get('901/7'), /^stuck@/);
});

test('the step logs no Baserow token and keeps none in the scope of the sequence', () => {
  for (const name of Object.keys(writers)) {
    const code = stepProperty(readSequence(name), 'AppendFiles', 'expression');
    assert.doesNotMatch(code, /log\.\w+\([^)]*(appendFilesToken|appendFilesAuthorization)/);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../../js/file_append.js'), 'utf8'), /log\.|print\(/);
});
