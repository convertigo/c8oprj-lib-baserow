const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const read = (name) => fs.readFileSync(path.join(__dirname, '../../_c8oProject/sequences', name + '.yaml'), 'utf8');
const actions = ['forms_AddRow', 'forms_AddRowFromData'];
const indent = (line) => line.length - line.trimStart().length;

// The steps named `label` of a sequence, in YAML order, with their properties: a `key: |` block is decoded the way the
// engine reads it (a '...' block is a quoted text where '' is a quote).
function steps(name, label) {
  const lines = read(name).split('\n');
  const found = [];
  lines.forEach((line, start) => {
    if (!line.trimStart().startsWith(`↓${label} [`)) {
      return;
    }
    const own = indent(line);
    const props = { line: start, indent: own };
    for (let i = start + 1; i < lines.length && (lines[i].trim() === '' || indent(lines[i]) > own); i++) {
      const match = indent(lines[i]) === own + 2 && /^\s*([A-Za-z_]+): ?(.*)$/.exec(lines[i]);
      if (!match) {
        continue;
      }
      if (match[2] !== '|') {
        props[match[1]] = match[2].trim();
        continue;
      }
      const block = [];
      for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || indent(lines[j]) > own + 2); j++) {
        block.push(lines[j].slice(own + 4));
      }
      let text = block.join('\n');
      if (text.startsWith("'")) {
        text = text.slice(1, text.lastIndexOf("'")).replace(/''/g, "'");
      }
      props[match[1]] = text;
    }
    found.push(props);
  });
  return found;
}

const log = () => {
  const warnings = [];
  // the names of the columns are logged at debug level only
  const debugs = [];
  return { warnings, debugs, warn: (message) => warnings.push(message), debug: (message) => debugs.push(message) };
};

// Runs one PrepareData copy (0: first pass, 1: after the columns creation) on the answers of a form, as the engine does.
function prepareData(name, copy, answers, jFields, createColumn = 'false') {
  const code = steps(name, 'PrepareData')[copy].expression;
  const doc = name === 'forms_AddRow' ? { variable: { _id: 'response', resp: answers } } : { variable: { _id: 'response', resp: {} } };
  const com = { twinsoft: { convertigo: { engine: { util: { XMLUtils: { XmlToJson: () => JSON.stringify(doc) } } } } } };
  const logger = log();
  const run = new Function('com', 'doc', 'forms_freeVars', 'jFields', 'forms_createColumn', 'log', `var data;\n${code}\n;return {
    data: data, jDoc: jDoc, columnToBeCreated: columnToBeCreated, fieldErrors: fieldErrors,
    fieldErrorMessage: typeof fieldErrorMessage == 'undefined' ? undefined : fieldErrorMessage,
    attachmentKeys: typeof attachmentKeys == 'undefined' ? undefined : attachmentKeys };`);
  const result = run(com, 'doc', JSON.stringify(answers), jFields, createColumn, logger);
  result.warnings = logger.warnings;
  return result;
}
// One answer of the form: forms_AddRow reads a response {value}, forms_AddRowFromData a free variable value.
const answer = (name, value) => (name === 'forms_AddRow' ? { value } : value);
const answersOf = (name, values) => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, answer(name, value)]));

const colors = { name: 'colors', type: 'multiple_select', select_options: [
  { id: 601, value: 'Red, dark' }, { id: 602, value: 'Blue' }, { id: 603, value: 'Green' }, { id: 604, value: '1' }] };

test('the 4 PrepareData copies share the same value mapping', () => {
  const helpers = (code) => code.slice(code.indexOf('var fieldErrors = [];'), code.indexOf('\nfor (var key in'));
  const switches = (name, code) => code.slice(code.indexOf('\tswitch (type) {'), code.indexOf('\t\tcase null:'))
    .split(name === 'forms_AddRow' ? 'jDoc.variable.resp[key].value' : 'jDoc[key]').join('ANSWER');
  const copies = actions.flatMap((name) => steps(name, 'PrepareData').map((step) => ({ name, code: step.expression })));
  assert.equal(copies.length, 4);
  for (const copy of copies) {
    assert.ok(helpers(copy.code).length > 1000, `${copy.name}: helpers`);
    assert.equal(helpers(copy.code), helpers(copies[0].code), `${copy.name}: helpers`);
    assert.equal(switches(copy.name, copy.code), switches(copies[0].name, copies[0].code), `${copy.name}: switch`);
    assert.doesNotMatch(copy.code, /debugger/, `${copy.name}: debugger statement`);
  }
});

// Multiple select: a string was always split on commas (a label "Red, dark" became two unknown labels) and a number was
// always taken as an option id (an option labelled "1" was never found). Arrays are now taken item by item, the whole
// text is tried as a label before it is split, and a number is an id only if that option exists.
test('a multiple select answer resolves labels first, keeps arrays and labels with commas, and reports unknown options', () => {
  const cases = [
    [['Red, dark', 'Blue'], [601, 602]],
    ['Red, dark', [601]],
    [' red, DARK ', [601]],
    ['Blue, Green', [602, 603]],
    ['Blue,Green,Blue', [602, 603]],
    ['1', [604]],
    ['602', [602]],
    [602, [602]],
    ['["Green", "Blue"]', [603, 602]],
    [[{ id: 603 }, { value: 'Blue' }], [603, 602]],
    ['', []],
    [' , ', []],
    [null, []],
    [[], []],
  ];
  for (const name of actions) {
    for (const copy of [0, 1]) {
      for (const [value, ids] of cases) {
        const result = prepareData(name, copy, answersOf(name, { colors: value }), [colors]);
        assert.deepEqual(result.data.colors, ids, `${name} #${copy}: ${JSON.stringify(value)}`);
        assert.equal(result.fieldErrorMessage || '', '', `${name} #${copy}: ${JSON.stringify(value)} errors`);
      }
      const unknown = prepareData(name, copy, answersOf(name, { colors: 'Blue, Purple, 999' }), [colors]);
      assert.deepEqual(unknown.fieldErrors, [
        'The answer "Purple" of the field "colors" is not an option of its select column',
        'The answer "999" of the field "colors" is not an option of its select column'], `${name} #${copy}: unknown options`);
    }
  }
});

test('a link row answer accepts arrays and {id}/{value} objects, and splits a text on commas only', () => {
  const link = [{ name: 'city', type: 'link_row' }];
  const cases = [
    [['Paris, France', 12, '13'], ['Paris, France', 12, 13]],
    [{ id: 5 }, [5]],
    [{ value: 'Lyon' }, ['Lyon']],
    [[{ id: 7 }, { value: '8' }], [7, 8]],
    ['[1, 2]', [1, 2]],
    ['Paris', ['Paris']],
    ['Paris, 7', ['Paris', 7]],
    ['12,', [12]],
    ['', []],
    [null, []],
    [[], []],
  ];
  for (const name of actions) {
    for (const copy of [0, 1]) {
      for (const [value, links] of cases) {
        assert.deepEqual(prepareData(name, copy, answersOf(name, { city: value }), link).data.city, links, `${name} #${copy}: ${JSON.stringify(value)}`);
      }
    }
  }
});

// Baserow refuses the whole row for an empty boolean or rating (never null), and for "" in a duration or a number.
test('empty and formatted answers of boolean, rating, duration, number and date columns are accepted by Baserow', () => {
  const fields = [
    { name: 'done', type: 'boolean' }, { name: 'stars', type: 'rating' }, { name: 'time', type: 'duration' },
    { name: 'amount', type: 'number' }, { name: 'day', type: 'date', date_include_time: false },
    { name: 'at', type: 'date', date_include_time: true }, { name: 'mail', type: 'email' }];
  const cases = [
    [{ done: '', stars: '', time: '', amount: '', day: '', at: '', mail: '' }, { done: false, stars: 0, time: null, amount: null, day: null, at: null, mail: '' }],
    [{ done: null, stars: null, time: null, amount: null, day: null, at: null }, { done: false, stars: 0, time: null, amount: null, day: null, at: null }],
    [{ done: 'true', stars: 4, time: '1:30', amount: '3,5', day: '2026-10-14', at: '2026-10-14T23:30:00+02:00' },
      { done: 'true', stars: 4, time: '1:30', amount: '3.5', day: '2026-10-14', at: '2026-10-14T23:30:00+02:00' }],
    [{ amount: ' 4 ', day: '2026-10-14T23:30:00+02:00' }, { amount: '4', day: '2026-10-14' }],
    [{ amount: '-0,25', day: '2026-01-02 08:00' }, { amount: '-0.25', day: '2026-01-02' }],
    [{ amount: 0, stars: 0, done: false }, { amount: 0, stars: 0, done: false }],
  ];
  for (const name of actions) {
    for (const copy of [0, 1]) {
      for (const [values, expected] of cases) {
        assert.deepEqual(prepareData(name, copy, answersOf(name, values), fields).data, expected, `${name} #${copy}: ${JSON.stringify(values)}`);
      }
    }
  }
});

// A free variable can be null: the attachment loop and the columns creation read .att_type / .type on it (TypeError,
// the whole row was lost).
test('a null free variable neither breaks the value mapping nor the attachment loop', () => {
  for (const createColumn of ['true', 'false']) {
    for (const copy of [0, 1]) {
      const result = prepareData('forms_AddRowFromData', copy, { Amount: null, Count: 3, Label: 'x' }, [{ name: 'Count', type: 'number' }], createColumn);
      assert.equal(result.data.Count, 3);
      if (createColumn === 'true') {
        assert.deepEqual(result.columnToBeCreated, [{ name: 'Amount', type: 'text' }, { name: 'Label', type: 'text' }]);
        assert.deepEqual(result.data, { Amount: null, Count: 3, Label: 'x' });
      }
      else {
        assert.deepEqual(result.data, { Count: 3 });
      }
    }
  }
  const prepared = prepareData('forms_AddRow', 0, { Amount: null, Note: 'text' }, [{ name: 'Amount', type: 'number' }, { name: 'Note', type: 'text' }]);
  assert.deepEqual(prepared.data, { Amount: null, Note: 'text' });
});

// The conditions of the attachment loops, evaluated on a response and the prepared data.
function conditions(name) {
  return ['jIf', 'jIf1'].flatMap((label) => steps(name, label)).filter((step) => /att_type|=== 'file'/.test(step.condition))
    .map((step) => ({ text: step.condition, run: new Function('jDoc', 'data', 'item', `return ${step.condition};`) }));
}

// A photo, signature or file answer whose column is missing (columns creation off) or is not a file column pushed into
// undefined or a text: TypeError, the whole row was lost. Such a file is now skipped like any other unmatched field.
test('the attachment loops only upload the files of file columns and survive null answers', () => {
  for (const name of actions) {
    const list = conditions(name);
    assert.equal(list.length, 4, `${name}: attachment conditions`);
    for (const { text, run } of list) {
      const kind = /att_type/.test(text) ? { att_type: true } : { type: 'file', value: ['1_C80C80_a.pdf_C80C80_1'] };
      const jDoc = name === 'forms_AddRow' ? { variable: { resp: { photo: kind } } } : { photo: kind, empty: null };
      assert.equal(run(jDoc, { photo: [] }, 'photo'), true, `${name}: ${text}`);
      assert.equal(run(jDoc, {}, 'photo'), false, `${name}: missing column ${text}`);
      assert.equal(run(jDoc, { photo: 'text' }, 'photo'), false, `${name}: text column ${text}`);
      if (name === 'forms_AddRowFromData') {
        assert.equal(run(jDoc, { empty: null }, 'empty'), false, `${name}: null answer ${text}`);
      }
    }
  }
});

// An upload that failed (attachment unreadable, upload refused) pushed {name: null}: Baserow refused the row with an
// unrelated message. The file is now skipped with a warning and the rest of the row is saved.
test('an uploaded file is added to a file column only, and a failed upload is skipped', () => {
  for (const name of actions) {
    const pushes = steps(name, 'AddAttachementToBRField');
    assert.equal(pushes.length, 4, `${name}: pushes`);
    for (const push of pushes) {
      const run = (data, jAttachmentName) => {
        const logger = log();
        new Function('data', 'item', '_use_attname', 'respItem', 'jAttachmentName', 'log', push.expression)(data, 'photo', 'photo', 'photo', jAttachmentName, logger);
        return logger.warnings;
      };
      const data = { photo: [] };
      assert.deepEqual(run(data, 'baserow_file.png'), []);
      assert.deepEqual(data.photo, [{ name: 'baserow_file.png' }]);
      for (const failed of [null, '', ' ']) {
        assert.equal(run(data, failed).length, 1, `${name}: upload ${JSON.stringify(failed)}`);
      }
      assert.deepEqual(data.photo, [{ name: 'baserow_file.png' }]);
      for (const notFile of [{}, { photo: 'text' }, { photo: null }]) {
        const warnings = run(notFile, 'baserow_file.png');
        assert.equal(warnings.length, 1, `${name}: ${JSON.stringify(notFile)}`);
        assert.doesNotMatch(warnings[0], /baserow_file/, `${name}: the warning carries no value`);
      }
    }
    // forms_AddRow indexed the files of a file field by resp[key].name instead of the key of data
    assert.doesNotMatch(read(name), /data\[jDoc\.variable\.resp\[respItem\]\.name\]/, `${name}: file key`);
  }
});

// When columns are created, the first PrepareData pass uploaded the attachments to Baserow, then the second pass rebuilt
// data and uploaded them again: the first files were orphaned. The first loop now runs only without columns to create.
test('attachments are uploaded once when columns are created', () => {
  for (const name of actions) {
    const loops = steps(name, 'jIterator').filter((step) => step.indent === 0);
    assert.equal(loops[0].expression, 'attachmentKeys', `${name}: first attachment loop`);
    const second = steps(name, 'jIterator2');
    assert.equal(second.length, 1, `${name}: second attachment loop`);
    assert.match(second[0].expression, /^Object\.keys\(/, `${name}: second attachment loop`);
    const answers = answersOf(name, { known: 'a', missing: 'b' });
    const fields = [{ name: 'known', type: 'text' }];
    assert.deepEqual(prepareData(name, 0, answers, fields, 'true').attachmentKeys, [], `${name}: columns to create`);
    assert.deepEqual(prepareData(name, 0, answers, fields, 'false').attachmentKeys, ['known', 'missing'], `${name}: no columns creation`);
    assert.deepEqual(prepareData(name, 0, answersOf(name, { known: 'a' }), fields, 'true').attachmentKeys, ['known'], `${name}: no column missing`);
  }
});

// An answer matching no option of a select column used to empty the cell (single select) or lose the row (multiple
// select): the sequence now returns an error naming the field and the answer, before any upload or row call.
test('an unknown select option is returned as an error before anything is written', () => {
  const choice = { name: 'choice', type: 'single_select', select_options: [{ id: 1, value: 'Yes' }] };
  for (const name of actions) {
    const sequence = read(name);
    const check = steps(name, 'IfFieldErrors');
    assert.equal(check.length, 1, `${name}: field error check`);
    assert.equal(check[0].condition, 'fieldErrorMessage != ""');
    assert.ok(check[0].line < steps(name, 'jIterator')[0].line, `${name}: checked before the attachments`);
    assert.ok(check[0].line > steps(name, 'PrepareData')[0].line, `${name}: checked after the first PrepareData`);
    const block = sequence.slice(sequence.indexOf('↓IfFieldErrors ['), sequence.indexOf('↓jIterator ['));
    assert.match(block, /↓Error_structure \[steps\.XMLErrorStep-\d+\]: \n {4}message: \n[\s\S]*?- ↑mode: JS\n {10}- →→: fieldErrorMessage\n {2}↓Return \[steps\.ReturnStep-\d+\]: \n$/, `${name}: error step`);
    const result = prepareData(name, 0, answersOf(name, { choice: 'Maybe' }), [choice]);
    assert.equal(result.fieldErrorMessage, 'The answer "Maybe" of the field "choice" is not an option of its select column');
    assert.equal(prepareData(name, 0, answersOf(name, { choice: 'yes' }), [choice]).fieldErrorMessage, '');
  }
});

// A Baserow error is {"error": "<code>", "detail": ...}: ./document/error/message is a Convertigo error only, so the
// message of a Baserow error was empty. The message falls back to the error code.
test('the row errors carry a message for Convertigo and Baserow errors', () => {
  const message = '- ↑value: ./document/error/message/text() | ./document/error[not(*)]/text()';
  for (const name of [...actions, 'forms_DeleteRow']) {
    const sequence = read(name);
    assert.doesNotMatch(sequence, /- ↑value: \.\/document\/error\/message\/text\(\)\n/, `${name}: message without fallback`);
    assert.equal(sequence.split(message).length - 1, name === 'forms_DeleteRow' ? 1 : 2, `${name}: messages`);
  }
});

// TableDeleteRow copies ./document/object/*: a Baserow error lands at ./document/error, not under ./document/transaction.
// A refused delete (ERROR_ROW_DOES_NOT_EXIST, an expired token) was reported as a success.
test('a refused row delete is reported with its Baserow detail', () => {
  const sequence = read('forms_DeleteRow');
  assert.doesNotMatch(sequence, /document\/transaction\/document/);
  const call = sequence.match(/↓Call_Sequence \[steps\.SequenceStep-(\d+)\]: \n(?: {6}.*\n)*? {6}sourceSequence: lib_BaseRow\.TableDeleteRow\n/);
  assert.ok(call, 'TableDeleteRow call');
  const after = sequence.slice(call.index + call[0].length);
  const check = after.slice(after.indexOf('↓IfExist [steps.IfExistStep-'), after.indexOf('[steps.ReturnStep-'));
  const sources = [...check.matchAll(/- ↑value: (\d{10,})\n\s+- java\.lang\.String: \n\s+- ↑value: (.*)\n/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(sources, [
    [call[1], './document/error'],
    [call[1], './document/detail'],
    [call[1], './document/error/message/text() | ./document/error[not(*)]/text()']]);
});

// The file loops deleted the temporary file but left its folder in attachments/.
test('the temporary folder of an uploaded file is deleted when empty', () => {
  for (const name of actions) {
    const deletes = steps(name, 'delete_empty_dir');
    assert.equal(deletes.length, 2, `${name}: file loops`);
    const enabledDeletes = steps(name, 'Delete_file').filter((step) => step.isEnabled !== 'false');
    assert.deepEqual(deletes.map((step) => step.line), enabledDeletes.map((step) => step.line + 3), `${name}: right after the file delete`);
    for (const step of deletes) {
      const File = function (folder) {
        this.list = () => (fs.existsSync(folder) ? fs.readdirSync(folder) : null);
        this.delete = () => { try { fs.rmdirSync(folder); return true; } catch (e) { return false; } };
      };
      const run = (dir, dirName) => new Function('java', 'dir', 'dirName', 'log', step.expression)({ io: { File } }, dir, dirName, log());
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'attachments-')) + '/';
      fs.mkdirSync(root + 'empty');
      fs.mkdirSync(root + 'full');
      fs.writeFileSync(root + 'full/file', 'x');
      run(root, 'empty');
      run(root, 'full');
      run(root, 'gone');
      assert.equal(fs.existsSync(root + 'empty'), false, `${name}: empty folder`);
      assert.equal(fs.existsSync(root + 'full/file'), true, `${name}: folder with a file`);
      fs.rmSync(root, { recursive: true });
    }
  }
});

// A null answer of a text-like column was sent as JSON.stringify(null), the text "null": the cell showed "null".
test('a null answer of a text-like column leaves the cell empty', () => {
  const types = ['text', 'long_text', 'email', 'phone_number', 'password', 'url'];
  const fields = types.map((type) => ({ name: type, type }));
  for (const name of actions) {
    for (const copy of [0, 1]) {
      const values = Object.fromEntries(types.map((type) => [type, null]));
      assert.deepEqual(prepareData(name, copy, answersOf(name, values), fields).data, values, `${name} #${copy}: null`);
      const texts = { text: '', long_text: 'a\nb', email: 'a@b.c', phone_number: '0102', password: 'x', url: 'https://x' };
      assert.deepEqual(prepareData(name, copy, answersOf(name, texts), fields).data, texts, `${name} #${copy}: texts`);
      assert.deepEqual(prepareData(name, copy, answersOf(name, { text: ['a', 'b'] }), fields).data, { text: '["a","b"]' }, `${name} #${copy}: object`);
    }
  }
});

// A file column of forms_AddRowFromData takes the answer of a File, Photo or Signature field ({type, value}), whose files the
// attachment loop uploads. Another value (the name of the file a reference to the field gave, a text) wrote an empty list
// of files: the column was emptied while the flow showed its success. It is now reported and nothing is written. No value
// still empties the column, and a File field in a text column writes the names of its files.
test('forms_AddRowFromData reports a value that is not a file of the form for a file column', () => {
  const fields = [{ name: 'Name', type: 'text' }, { name: 'Document', type: 'file' }];
  const fileAnswer = { name: 'doc_file', type: 'file', value: [{}, '16_C80C80_report.pdf_C80C80_1795700000000'] };
  const photo = { name: 'photo', type: 'img', value: 'photo', att_type: true };
  for (const [value, error] of [
    [fileAnswer, false],
    [photo, false],
    [{ name: 'sign', type: 'signature', value: '' }, false],
    [null, false],
    ['', false],
    [[], false],
    ['report.pdf', true],
    [['report.pdf'], true],
    [{ name: 'Name', type: 'text', value: 'x' }, true],
  ]) {
    const result = prepareData('forms_AddRowFromData', 0, { Name: 'row', Document: value }, fields);
    assert.deepEqual(result.data.Document, [], `${JSON.stringify(value)}: the files are added by the attachment loop`);
    if (error) {
      assert.match(result.fieldErrorMessage, /The value of the column "Document" is not a file of the form/, JSON.stringify(value));
    }
    else {
      assert.equal(result.fieldErrorMessage, '', JSON.stringify(value));
    }
  }
  // a column that is not a file column is not checked
  assert.equal(prepareData('forms_AddRowFromData', 0, { Name: 'report.pdf' }, fields).fieldErrorMessage, '');
});

test('a File field written in a text column writes the names of its files', () => {
  const fields = [{ name: 'Name', type: 'text' }, { name: 'Files', type: 'long_text' }];
  const files = { name: 'doc_file', type: 'file', value: [{}, '16_C80C80_a.pdf_C80C80_1', '16_C80C80_b c.png_C80C80_2'] };
  assert.equal(prepareData('forms_AddRowFromData', 0, { Name: 'row', Files: files }, fields).data.Files, 'a.pdf, b c.png');
  assert.equal(prepareData('forms_AddRowFromData', 0, { Name: 'row', Files: { type: 'signature', value: 'data:image/png;base64,AA' } }, fields).data.Files, '');
  // forms_AddRow reads the value of the answer: unchanged
  assert.equal(prepareData('forms_AddRow', 0, { Name: { value: 'row' }, Files: { value: 'text' } }, fields).data.Files, 'text');
});
