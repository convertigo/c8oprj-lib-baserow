// link_display (formssource_GetTableData, js/link_display.js): a table source shows a link column by another column of the
// linked table than its primary one. Baserow gives a link as {id, value}, value the primary column of the linked row; the
// value becomes the column chosen, read with the account of the source on a linked table of link_row_table_id only (the
// tables the owner of the source signed), page after page until every link is found. Anything else keeps the value.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readSequence, readProjectFile, stepProperty } = require('./read-yaml-steps.cjs');

const linkDisplay = require('../../js/link_display.js');
const yaml = readSequence('formssource_GetTableData');
const plain = (value) => JSON.parse(JSON.stringify(value));

// The table Incidents, its link column Créateur to the table Createurs (77), whose primary column is a meaningless number
const structure = [
  { id: 1, name: 'Titre', type: 'text', primary: true },
  { id: 2, name: 'Créateur', type: 'link_row', link_row_table_id: 77 },
  { id: 3, name: 'Tags', type: 'multiple_select' },
  { id: 4, name: 'Autre lien', type: 'link_row', link_row_table_id: 88 },
];
const incidents = () => [
  { id: 10, order: '1.00000000000000000000', Titre: 'Panne', 'Créateur': [{ id: 1, value: '3018', order: '1.00000000000000000000' }], Tags: [] },
  { id: 11, order: '2.00000000000000000000', Titre: 'Lenteur', 'Créateur': [{ id: 2, value: '2595', order: '1.00000000000000000000' }, { id: 1, value: '3018', order: '2.00000000000000000000' }] },
  { id: 12, order: '3.00000000000000000000', Titre: 'Sans', 'Créateur': [] },
];
// Createurs as Baserow pages it, {results, next}; reads: the requests made
function createurs(rows, reads) {
  return (tableId, display, page, size) => {
    reads.push({ tableId, display, page, size });
    const all = rows();
    const results = all.slice((page - 1) * size, page * size).map((row) => ({ id: row.id, order: row.order, [display]: row[display] }));
    return { count: all.length, next: page * size < all.length ? `https://baserow/api/database/rows/table/77/?page=${page + 1}` : null, results };
  };
}
const people = () => [{ id: 1, order: '1', 'id qui veut rien dire': '3018', Nom: 'Charles' }, { id: 2, order: '2', 'id qui veut rien dire': '2595', Nom: 'Toto' }];

test('the case of Incidents: the creators shown by their name, not by their meaningless primary column', () => {
  const rows = incidents();
  const reads = [];
  const entries = linkDisplay.plan({ 'Créateur': 'Nom' }, structure, [77]);
  assert.deepEqual(plain(entries), [{ column: 'Créateur', tableId: '77', display: 'Nom' }]);
  const summary = linkDisplay.apply(rows, entries, createurs(people, reads), 2000);
  assert.deepEqual(rows.map((row) => row['Créateur'].map((link) => [link.id, link.value])), [[[1, 'Charles']], [[2, 'Toto'], [1, 'Charles']], []]);
  assert.deepEqual(summary, { links: 3, labelled: 3 });
  // one request: the linked table, its id and that column only, as many rows a page as Baserow gives
  assert.deepEqual(reads, [{ tableId: '77', display: 'Nom', page: 1, size: 200 }]);
  // the rest of the row and of the link stays
  assert.deepEqual([rows[1].Titre, rows[1]['Créateur'][0].order, rows[0].Tags], ['Lenteur', '1.00000000000000000000', []]);
});

test('the linked rows read page after page until every link is found, never more than maxRows', () => {
  const many = () => Array.from({ length: 450 }, (_, i) => ({ id: i + 1, order: '' + (i + 1), Nom: 'Personne ' + (i + 1) }));
  const rows = [{ 'Créateur': [{ id: 3, value: 'x' }, { id: 420, value: 'y' }] }];
  const reads = [];
  const entries = linkDisplay.plan({ 'Créateur': 'Nom' }, structure, ['77']);
  linkDisplay.apply(rows, entries, createurs(many, reads), 2000);
  assert.deepEqual(rows[0]['Créateur'].map((link) => link.value), ['Personne 3', 'Personne 420']);
  assert.deepEqual(reads.map((read) => read.page), [1, 2, 3]);
  // every link found on the first page: no other page
  const first = [{ 'Créateur': [{ id: 3, value: 'x' }] }];
  const firstReads = [];
  linkDisplay.apply(first, entries, createurs(many, firstReads), 2000);
  assert.deepEqual(firstReads.map((read) => read.page), [1]);
  // maxRows: a row beyond keeps its value
  const capped = [{ 'Créateur': [{ id: 3, value: 'x' }, { id: 420, value: 'y' }] }];
  const cappedReads = [];
  linkDisplay.apply(capped, entries, createurs(many, cappedReads), 200);
  assert.deepEqual(capped[0]['Créateur'].map((link) => link.value), ['Personne 3', 'y']);
  assert.deepEqual(cappedReads.map((read) => read.page), [1]);
});

test('only a link column of the table, on a linked table the owner signed: anything else keeps its value, reads nothing', () => {
  const reads = [];
  const read = createurs(people, reads);
  const refused = [
    [{ 'Créateur': 'Nom' }, structure, [88]],
    [{ 'Créateur': 'Nom' }, structure, []],
    [{ 'Créateur': 'Nom' }, structure, null],
    [{ Titre: 'Nom' }, structure, [77]],
    [{ Tags: 'Nom' }, structure, [77]],
    [{ Inconnue: 'Nom' }, structure, [77]],
    [{ 'Créateur': '' }, structure, [77]],
    [{ 'Créateur': 3 }, structure, [77]],
    [{ 'Créateur': 'x'.repeat(300) }, structure, [77]],
    [['Créateur'], structure, [77]],
    ['{"Créateur":"Nom"}', structure, [77]],
    [null, structure, [77]],
    [{ 'Créateur': 'Nom' }, null, [77]],
  ];
  for (const [display, fields, allowed] of refused) {
    const rows = incidents();
    linkDisplay.apply(rows, linkDisplay.plan(display, fields, allowed), read, 2000);
    assert.deepEqual(rows.map((row) => row['Créateur'].map((link) => link.value)), [['3018'], ['2595', '3018'], []], JSON.stringify([display, allowed]));
  }
  assert.deepEqual(reads, []);
  // the other link column, on its own linked table
  assert.deepEqual(plain(linkDisplay.plan({ 'Autre lien': 'Code', 'Créateur': 'Nom' }, structure, ['88', 77])),
    [{ column: 'Autre lien', tableId: '88', display: 'Code' }, { column: 'Créateur', tableId: '77', display: 'Nom' }]);
});

test('a column the linked rows leave empty, a column the linked table does not have, an error of Baserow: the value stays', () => {
  const entries = linkDisplay.plan({ 'Créateur': 'Nom' }, structure, [77]);
  const empty = incidents();
  linkDisplay.apply(empty, entries, createurs(() => [{ id: 1, Nom: '' }, { id: 2, Nom: null }], []), 2000);
  assert.deepEqual(empty.map((row) => row['Créateur'].map((link) => link.value)), [['3018'], ['2595', '3018'], []]);
  for (const answer of [null, { error: 'ERROR_FIELD_DOES_NOT_EXIST' }, { detail: 'not found' }, 'text']) {
    const rows = incidents();
    const reads = [];
    linkDisplay.apply(rows, entries, (tableId, display, page) => { reads.push(page); return answer; }, 2000);
    assert.deepEqual(rows[1]['Créateur'].map((link) => link.value), ['2595', '3018'], JSON.stringify(answer));
    assert.deepEqual(reads, [1], 'no page after an error');
  }
  // rows without the column, a cell that is not a list of links
  const odd = [{ id: 1 }, { 'Créateur': null }, { 'Créateur': [{ value: 'no id' }, null] }, null];
  assert.deepEqual(linkDisplay.apply(odd, entries, createurs(people, []), 2000), { links: 0, labelled: 0 });
});

test('the text of the column shown, and its name as the include parameter of Baserow', () => {
  const text = linkDisplay.cellText;
  assert.equal(text('Charles'), 'Charles');
  assert.equal(text(3018), '3018');
  assert.equal(text(0), '0');
  assert.equal(text(false), 'false');
  assert.equal(text('2026-12-15'), '2026-12-15');
  assert.equal(text({ id: 3, value: 'Urgent', color: 'red' }), 'Urgent');
  assert.equal(text([{ id: 1, value: 'A' }, { id: 2, value: 'B' }]), 'A, B');
  assert.equal(text([{ value: { id: 1, value: 'nested' } }]), 'nested');
  assert.equal(text({ id: 7, name: 'Jane' }), 'Jane');
  assert.equal(text([{ visible_name: 'devis.pdf', name: 'x_devis.pdf' }]), 'devis.pdf');
  assert.equal(text(null), '');
  assert.equal(text({}), '');
  assert.equal(linkDisplay.fieldList('Nom'), 'Nom');
  assert.equal(linkDisplay.fieldList('Nom, prénom'), '"Nom, prénom"');
  assert.equal(linkDisplay.fieldList('Le "nom"'), '"Le \\"nom\\""');
});

test('formssource_GetTableData labels the links before their cells are built, every page read, with the account of the source', () => {
  const parse = stepProperty(yaml, 'ParseConfig', 'expression');
  assert.match(parse, /hasLinkDisplay = jConfig\.link_display != null && typeof jConfig\.link_display == "object" && !Array\.isArray\(jConfig\.link_display\) &&\n\s+Object\.keys\(jConfig\.link_display\)\.length > 0;/);
  // the pages are read here (no stream), so every row gets its labels
  assert.match(stepProperty(yaml, 'DecideStream', 'expression'), /streamRows = streamEligible && !hasLinkDisplay && /);
  const at = (header) => yaml.indexOf(`↓${header} [`);
  assert.ok(at('FetchNextPages') < at('IfLinkDisplay') && at('IfLinkDisplay') < at('NativeOrJs') && at('NativeOrJs') < at('IfJsCells'), 'after the pages, before the cells');
  assert.match(yaml, /↓IfLinkDisplay \[steps\.IfStep-\d+\]: \n.*\n  condition: hasLinkDisplay && !isModelMode && Array\.isArray\(results\) && results\.length > 0\n/);
  // the Bearer of the source (formscommon_CheckConfigNative), forgotten once read
  const block = yaml.slice(at('IfLinkDisplay'), at('NativeOrJs'));
  assert.match(block, /↓linkDisplayAuthorization \[steps\.SimpleSourceStep-\d+\]: [\s\S]*?- ↑value: 1996000000002\n\s+- java\.lang\.String: \n\s+- ↑value: \$\.Bearer\n\s+variableName: linkDisplayAuthorization/);
  const resolve = stepProperty(yaml, 'ResolveLinkDisplay', 'expression');
  assert.match(resolve, /var linkDisplayEntries = baserowLinkDisplay\.plan\(jConfig\.link_display, structure, jConfig\.link_row_table_id\);/);
  assert.match(resolve, /callNative\("lib_BaseRow\.Baserow_API_spec\._api_database_rows_table__table_id___GET_raw", \{\n\s+"__header_Authorization": linkDisplayToken, "table_id": "" \+ linkedTableId, "include_fields": baserowLinkDisplay\.fieldList\(display\),\n\s+"page": "" \+ linkedPage, "size": "" \+ linkedSize, "user_field_names": "true"/);
  assert.match(resolve, /parseInt\("\$\{lib_baserow\.link_display_max_rows=2000\}", 10\)/);
  assert.match(resolve, /linkDisplayToken = null;\n\s*\}\nlinkDisplayAuthorization = null;/);
  assert.doesNotMatch(resolve, /log\.(info|warn|debug)/, 'no token in the logs');
  // the raw transaction keeps the token out of the document (no httpInfo)
  assert.ok(readProjectFile('js/link_display.js').includes('var baserowLinkDisplay = (function () {'));
});
