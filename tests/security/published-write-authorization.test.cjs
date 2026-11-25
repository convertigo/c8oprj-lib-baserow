const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (name) => fs.readFileSync(path.join(__dirname, '../../_c8oProject/sequences', name + '.yaml'), 'utf8');
const writes = ['forms_AddRow', 'forms_AddRowFromData', 'forms_DeleteRow'];

test('write actions fix their kind for the published form authorization', () => {
  for (const name of writes) {
    const sequence = read(name);
    const call = sequence.match(/sourceSequence: lib_BaseRow\.formscommon_CheckConfig\n([\s\S]*?)\n↓IfError /);
    assert.ok(call, `${name} checks its configuration first`);
    assert.match(call[1], new RegExp(`↓source_kind \\[variables\\.StepVariable-\\d+\\]: \\n    value: ${name}(\\n|$)`));
    assert.doesNotMatch(sequence, /↓source_kind \[variables\.RequestableVariable/, 'the kind is never a request variable');
  }
});

test('config check sends respondent writes to C8Oforms and reads to the read broker', () => {
  const check = read('formscommon_CheckConfig');
  assert.match(check, /^accessibility: Private\n/);
  assert.match(check, /callSequence\("C8Oforms", "BaserowPublishedWriteAuthorize", \{\n\s+form_id: _use_docid,\n\s+forms_config: forms_config,\n\s+write_kind: publishedSourceKind/);
  assert.match(check, /if \(!sourceOwnerAuthorized && publishedSourceKind != "" && !publishedWrite\) \{/);
  assert.match(check, /condition: '!sourceOwnerAuthorized'/);
});
