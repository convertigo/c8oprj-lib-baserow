// js/baserow_schema.js, the files and the views of a schema (C8Oforms #1836, lib_BaseRow 1.2.0-beta25):
// - describe with attachments reads the files of the rows with the account, within 10 MB a file and 30 MB in all,
//   into a folder of the transfer folder, and names them by key in the schemas (never their name of Baserow);
// - describe with views reads the views (filters, groups of filters, sorts, group bys, kanban and calendar field,
//   cover, hidden columns and their order), never public; apply makes them again and maps their keys to new ids;
// - step and apply upload the files of the rows (phase files) and write the rows with their new names;
// - the round trip describe -> apply -> describe gives the same schema and the same bytes.
const test = require('node:test');
const assert = require('node:assert/strict');
const BaserowSchema = require('../../js/baserow_schema.js');
const { fakeBaserow } = require('./fake-baserow.cjs');

const fixture = () => JSON.parse(JSON.stringify(require('./fixtures/mini-crm.baserow.json')));
const WORKSPACE = 836;
const WORKSPACE_NAME = 'Convertigo NoCode Databases - user@example.com';
const path = (table, base = 'Mini CRM') => `${WORKSPACE_NAME}~>${base}~>${table}`;
const TRANSFER = '/tmp/c8o-file-transfer/';
const MB = 1024 * 1024;

// a disk of the tests: the transfer folder of describe (written by downloadFile), read by the uploads of apply
function disk() {
  const files = new Map();
  let folders = 0;
  const removed = [];
  return {
    files,
    removed,
    transfer: {
      open: () => `${TRANSFER}describe-${++folders}`,
      target: (dir, n, name) => `${dir}/${n}/${name}`,
      remove: (dir) => {
        removed.push(dir);
        for (const key of [...files.keys()]) if (key.startsWith(`${dir}/`)) files.delete(key);
      },
    },
    fileOf: (p) => (typeof p === 'string' && p.startsWith(TRANSFER) && !p.includes('..') && files.has(p)
      ? { path: p, size: files.get(p).length, name: p.split('/').pop() } : null),
  };
}

function runSteps(schema, api, options, fileOf, max = 300) {
  let state = null;
  let answer;
  for (let i = 0; i < max; i++) {
    answer = BaserowSchema.step(JSON.stringify(schema), state && JSON.stringify(state), api, { workspaceId: WORKSPACE, ...options }, fileOf);
    state = answer.state;
    if (answer.status !== 'running') break;
  }
  return answer;
}

// the Mini CRM with views of every kind and files in its rows
function source(options = {}) {
  const d = disk();
  const baserow = fakeBaserow({ writeFile: (p, b) => d.files.set(p, b), readFile: (p) => d.files.get(p), ...options });
  const schema = fixture();
  const companies = schema.tables.find((t) => t.key === 'companies');
  companies.fields.push({ key: 'logo', name: 'Logo', type: 'file' }, { key: 'contract', name: 'Contrat', type: 'file' });
  companies.views.push(
    {
      key: 'all', name: 'Grille complète', type: 'grid', filterType: 'OR', filtersDisabled: true,
      filterGroups: [{ key: 'g1', filterType: 'OR' }, { key: 'g2', filterType: 'AND', parent: 'g1' }],
      filters: [
        { field: 'industry', type: 'single_select_is_any_of', options: ['tech', 'retail'] },
        { field: 'website', type: 'contains', value: 'acme', group: 'g1' },
        { field: 'name', type: 'equal', value: 'Bazar', group: 'g2' },
      ],
      sorts: [{ field: 'name', order: 'desc' }],
      groupBys: [{ field: 'industry', order: 'asc' }],
      fieldOptions: { website: { hidden: true, order: 2, width: 300 }, name: { order: 0, width: 150 } },
    },
    { key: 'gallery', name: 'Galerie', type: 'gallery', cardCoverImageField: 'logo', fieldOptions: { industry: { hidden: true, order: 1 } } },
    { key: 'form', name: 'Formulaire', type: 'form', fieldOptions: { name: { enabled: true, required: true, order: 1, name: 'Votre société' } } },
  );
  const deals = schema.tables.find((t) => t.key === 'deals');
  deals.views.push({ key: 'acme', name: 'Acme', type: 'grid', filters: [{ field: 'company', type: 'link_row_has', rows: ['Acme'] }] });
  const made = runSteps(schema, baserow.api, {});
  assert.equal(made.status, 'done', JSON.stringify(made.error));
  // files in the rows of Sociétés: one file in two rows (named apart in the second), two files in one cell
  const logo = baserow.addFile('logo.png', Buffer.from('PNG-logo-bytes'), 'image/png');
  const contract = baserow.addFile('contrat.pdf', Buffer.from('%PDF contrat'));
  const annex = baserow.addFile('annexe.pdf', Buffer.from('%PDF annexe, longer'));
  const ids = made.state.rowIds.companies;
  const field = (key) => `field_${made.map.fields[`companies.${key}`]}`;
  baserow.api.updateRows(made.state.tables.companies, [
    { id: ids.Acme, [field('logo')]: [logo], [field('contract')]: [contract, annex] },
    { id: ids.Bazar, [field('logo')]: [{ ...logo, visible_name: 'bazar.png' }] },
  ]);
  baserow.calls.length = 0;
  return { baserow, disk: d, made };
}

// a describe answer without what differs from one base to another: the keys of the rows (their ids, replaced by
// their rank in their table, in the links and filters too), the key of the schema
function canonical(described) {
  return described.bases.map((base) => {
    const schema = JSON.parse(JSON.stringify(base.schema));
    const rank = {};
    for (const table of schema.tables) {
      rank[table.key] = {};
      (table.sampleRows ? table.sampleRows.rows : []).forEach((row, i) => { rank[table.key][row._key] = `r${i}`; });
    }
    for (const table of schema.tables) {
      const fields = [table.primaryField, ...table.fields];
      for (const row of table.sampleRows ? table.sampleRows.rows : []) {
        row._key = rank[table.key][row._key];
        for (const field of fields) {
          if (field.type === 'link_row' && row[field.key]) row[field.key] = row[field.key].map((k) => rank[field.targetTable][k]);
        }
      }
      for (const view of table.views || []) {
        for (const filter of view.filters || []) {
          if (filter.rows) {
            const field = fields.find((f) => f.key === filter.field);
            filter.rows = filter.rows.map((k) => rank[field.targetTable][k]);
          }
        }
      }
    }
    delete schema.key;
    delete schema.base;
    return schema;
  });
}

const describeAll = (baserow, d, base = 'Mini CRM', extra = {}) => BaserowSchema.describe(baserow.api,
  { tables: [{ path: path('Sociétés', base) }], rows: true, attachments: true, views: true, ...extra }, d.transfer);

test('describe with views and attachments: the views of each table, the files of the rows by key, downloaded apart', () => {
  const { baserow, disk: d } = source();
  const described = describeAll(baserow, d);
  assert.equal(described.status, 'ok');
  // the files: one per file of Baserow, in a folder of the transfer folder, never their name nor their URL in the answer
  assert.deepEqual(described.attachments.map((a) => [a.key, a.visible_name, a.size, a.mime_type, a.is_image]), [
    ['f1', 'logo.png', 14, 'image/png', true], ['f2', 'contrat.pdf', 12, 'application/pdf', false], ['f3', 'annexe.pdf', 19, 'application/pdf', false],
  ]);
  assert.equal(described.transferDir, `${TRANSFER}describe-1`);
  assert.ok(described.attachments.every((a) => a.path.startsWith(`${described.transferDir}/`)));
  assert.equal(d.files.get(described.attachments[2].path).toString(), '%PDF annexe, longer');
  assert.deepEqual([described.counts.files, described.counts.fileBytes], [3, 45]);
  assert.deepEqual(described.files, [], 'the file fields are carried with their files');
  const text = JSON.stringify(described);
  assert.doesNotMatch(text, /seed\d+_|media\.example\.com|"url":|JWT/);
  assert.deepEqual(described.attachments.map((a) => a.path.slice(described.transferDir.length)), ['/1/logo.png', '/2/contrat.pdf', '/3/annexe.pdf'], 'their name kept');
  const schema = described.bases[0].schema;
  assert.deepEqual(schema.files, [
    { key: 'f1', visible_name: 'logo.png', size: 14, mime_type: 'image/png', is_image: true },
    { key: 'f2', visible_name: 'contrat.pdf', size: 12, mime_type: 'application/pdf', is_image: false },
    { key: 'f3', visible_name: 'annexe.pdf', size: 19, mime_type: 'application/pdf', is_image: false },
  ]);
  const companies = schema.tables.find((t) => t.name === 'Sociétés');
  const acme = companies.sampleRows.rows.find((r) => r.Nom === 'Acme');
  const bazar = companies.sampleRows.rows.find((r) => r.Nom === 'Bazar');
  assert.deepEqual(acme.Logo, [{ file: 'f1', visible_name: 'logo.png' }]);
  assert.deepEqual(acme.Contrat, [{ file: 'f2', visible_name: 'contrat.pdf' }, { file: 'f3', visible_name: 'annexe.pdf' }]);
  assert.deepEqual(bazar.Logo, [{ file: 'f1', visible_name: 'bazar.png' }], 'the name shown of the cell');
  // the views, by name, never public
  assert.deepEqual(companies.views.map((v) => [v.name, v.type]), [['Technologie', 'grid'], ['Grille complète', 'grid'], ['Galerie', 'gallery'], ['Formulaire', 'form']]);
  const all = companies.views.find((v) => v.name === 'Grille complète');
  assert.deepEqual(all, {
    key: 'Grille complète', name: 'Grille complète', type: 'grid', filterType: 'OR', filtersDisabled: true,
    filterGroups: [{ key: 'g1', filterType: 'OR', parent: null }, { key: 'g2', filterType: 'AND', parent: 'g1' }],
    filters: [
      { field: 'Secteur', type: 'single_select_is_any_of', options: ['Technologie', 'Commerce'] },
      { field: 'Site web', type: 'contains', value: 'acme', group: 'g1' },
      { field: 'Nom', type: 'equal', value: 'Bazar', group: 'g2' },
    ],
    sorts: [{ field: 'Nom', order: 'DESC' }],
    groupBys: [{ field: 'Secteur', order: 'ASC' }],
    fieldOptions: {
      Nom: { hidden: false, order: 0, width: 150 }, Secteur: { hidden: false, order: 32767, width: 200 }, 'Site web': { hidden: true, order: 2, width: 300 },
      'Contact principal': { hidden: false, order: 32767, width: 200 }, 'Montant des opportunités': { hidden: false, order: 32767, width: 200 },
      "Nombre d'opportunités": { hidden: false, order: 32767, width: 200 }, 'Résumé': { hidden: false, order: 32767, width: 200 },
      'Créé le': { hidden: false, order: 32767, width: 200 }, 'Modifié le': { hidden: false, order: 32767, width: 200 },
      Logo: { hidden: false, order: 32767, width: 200 }, Contrat: { hidden: false, order: 32767, width: 200 },
      Contacts: { hidden: false, order: 32767, width: 200 }, 'Opportunités': { hidden: false, order: 32767, width: 200 },
    },
  });
  assert.equal(companies.views.find((v) => v.name === 'Galerie').cardCoverImageField, 'Logo');
  assert.deepEqual(companies.views.find((v) => v.name === 'Formulaire').fieldOptions.Nom, { enabled: true, required: true, order: 1, name: 'Votre société' });
  assert.doesNotMatch(JSON.stringify(schema.tables.map((t) => t.views || [])), /public|slug|password|aggregation/);
  const deals = schema.tables.find((t) => t.name === 'Opportunités');
  const acmeRow = companies.sampleRows.rows.find((r) => r.Nom === 'Acme')._key;
  assert.deepEqual(deals.views.find((v) => v.name === 'Acme').filters, [{ field: 'Société', type: 'link_row_has', rows: [acmeRow] }]);
  assert.deepEqual(deals.views.find((v) => v.name === 'Pipeline').singleSelectField, 'Étape');
  assert.deepEqual(deals.views.find((v) => v.name === 'Agenda').dateField, 'Clôture');
  // the ids of the views read, to remap what an application names by id
  const ids = described.bases[0].views;
  assert.equal(ids.length, 7);
  assert.ok(ids.every((v) => Number.isInteger(v.id) && baserow.db.views.some((view) => view.id === v.id && view.name === v.view)));
  assert.deepEqual(described.omittedViews, []);
  assert.ok(!baserow.calls.some((c) => /^(create|update|delete|upload)/.test(c.name)), 'describe never writes');
});

test('round trip: describe -> apply in a new base (files uploaded first) -> describe gives the same schema and bytes', () => {
  const { baserow, disk: d } = source();
  const first = describeAll(baserow, d);
  const files = Object.fromEntries(first.attachments.map((a) => [a.key, { path: a.path }]));
  const made = runSteps(first.bases[0].schema, baserow.api, { baseName: 'Copie', files, exactViews: true }, d.fileOf);
  assert.equal(made.status, 'done', JSON.stringify(made.error));
  // the files are uploaded before the rows, once each
  const order = baserow.calls.map((c) => c.name);
  assert.equal(order.filter((n) => n === 'uploadFile').length, 3);
  assert.ok(order.lastIndexOf('uploadFile') < order.indexOf('createRows'));
  // the old view id -> keys (describe) -> new view id (map.views)
  for (const view of first.bases[0].views) {
    const newId = made.map.views[`${view.table}.${view.view}`];
    assert.ok(Number.isInteger(newId), `${view.table}.${view.view}`);
    assert.equal(baserow.db.views.find((v) => v.id === newId).name, baserow.db.views.find((v) => v.id === view.id).name);
  }
  assert.ok(baserow.db.views.every((v) => v.public === false || v.public === undefined));
  const second = describeAll(baserow, d, 'Copie');
  assert.deepEqual(canonical(second), canonical(first));
  for (const a of first.attachments) {
    const b = second.attachments.find((x) => x.key === a.key);
    assert.deepEqual(d.files.get(b.path), d.files.get(a.path), a.visible_name);
  }
});

test('apply: the file cells name files of the schema in keyed rows only, given by options.files', () => {
  const { baserow, disk: d } = source();
  const described = describeAll(baserow, d);
  const schema = described.bases[0].schema;
  const files = Object.fromEntries(described.attachments.map((a) => [a.key, { path: a.path }]));
  const companies = (s) => s.tables.find((t) => t.name === 'Sociétés');
  const invalid = (change, pattern) => {
    const copy = JSON.parse(JSON.stringify(schema));
    change(copy);
    assert.throws(() => BaserowSchema.normalizeSchema(copy), pattern);
  };
  invalid((s) => { companies(s).sampleRows.rows[0].Logo = [{ name: 'seed1_logo.png', visible_name: 'x' }]; }, /is \{file: <key/);
  invalid((s) => { companies(s).sampleRows.rows[0].Logo = [{ file: 'f9' }]; }, /no file f9/);
  invalid((s) => { s.files[0].name = 'seed1_logo.png'; }, /holds no name, url nor path/);
  invalid((s) => { s.files[0].key = '__proto__'; }, /a key of 1 to 64/);
  invalid((s) => { s.files.push({ ...s.files[0] }); }, /used twice/);
  invalid((s) => { companies(s).sampleRows.rows.forEach((r) => { delete r._key; }); }, /no file in the sample rows/);
  // a file missing from options.files, a path out of the transfer folder: refused before any write
  const missing = runSteps(schema, baserow.api, { baseName: 'Copie', files: { f1: files.f1, f2: files.f2 } }, d.fileOf);
  assert.equal(missing.status, 'error');
  assert.deepEqual([missing.error.code, missing.error.file, missing.error.key], ['file_missing', 'annexe.pdf', 'f3']);
  const outside = runSteps(schema, baserow.api, { baseName: 'Copie', files: { ...files, f2: { path: '/var/data/contrat.pdf' } } }, d.fileOf);
  assert.deepEqual([outside.error.code, outside.error.file], ['file_invalid', 'contrat.pdf']);
  assert.ok(!baserow.calls.some((c) => /^(create|update|upload)/.test(c.name)), 'nothing written');
  // the names of files already uploaded by the caller (mode upload): no upload by the step
  const uploaded = Object.fromEntries(described.attachments.map((a) => [a.key, BaserowSchema.uploadFile(baserow.api, { path: a.path }, d.fileOf).file]));
  baserow.calls.length = 0;
  const named = runSteps(schema, baserow.api, { baseName: 'Copie 2', files: Object.fromEntries(Object.entries(uploaded).map(([k, f]) => [k, { name: f.name, visible_name: f.visible_name }])) }, d.fileOf);
  assert.equal(named.status, 'done', JSON.stringify(named.error));
  assert.ok(!baserow.calls.some((c) => c.name === 'uploadFile'));
  const row = baserow.db.rows.find((r) => r.table_id === named.state.tables['Sociétés'] && r[`field_${named.map.fields['Sociétés.Nom']}`] === 'Bazar');
  assert.deepEqual(row[`field_${named.map.fields['Sociétés.Logo']}`], [{ name: uploaded.f1.name, visible_name: 'bazar.png' }]);
  assert.equal(JSON.stringify(named).includes('JWT'), false);
  // a name holding folders is refused
  const withFolders = runSteps(schema, baserow.api, { baseName: 'Copie 3', files: { ...files, f1: { name: '../../other/bazar.png' } } }, d.fileOf);
  assert.equal(withFolders.error.code, 'file_invalid');
});

test('apply: the files are uploaded once, a step run again uploads nothing again', () => {
  const { baserow, disk: d } = source();
  const described = describeAll(baserow, d);
  const files = Object.fromEntries(described.attachments.map((a) => [a.key, { path: a.path }]));
  // the second upload fails once: the step stops, the next one goes on from the third file... after the second
  baserow.fail('uploadFile', Object.assign(new Error('timeout'), { code: 'baserow_unreachable', retryable: true }), { after: 1 });
  let state = null;
  let answer;
  const answers = [];
  for (let i = 0; i < 300; i++) {
    answer = BaserowSchema.step(JSON.stringify(described.bases[0].schema), state && JSON.stringify(state), baserow.api,
      { workspaceId: WORKSPACE, baseName: 'Copie', files, maxCalls: 3 }, d.fileOf);
    answers.push(answer);
    state = answer.state;
    if (answer.status === 'error' && answer.retryable) continue;
    if (answer.status !== 'running') break;
  }
  assert.equal(answer.status, 'done', JSON.stringify(answer.error));
  assert.ok(answers.some((a) => a.status === 'error' && a.retryable && a.progress.phase === 'files'));
  assert.equal(baserow.calls.filter((c) => c.name === 'uploadFile').length, 4, '3 files, the second one twice');
  assert.equal(Object.keys(answer.state.files).length, 3);
  assert.ok(answers.some((a) => a.progress && a.progress.phase === 'files'), 'the phase files is told');
});

test('the limits of the files: 10 MB a file, 30 MB in all, by describe (before any download) and by apply', () => {
  const big = (name, mb) => ({ name, bytes: Buffer.alloc(Math.round(mb * MB)) });
  const setup = (list) => {
    const s = source();
    const ids = s.made.state.rowIds.companies;
    const cells = list.map((f) => s.baserow.addFile(f.name, f.bytes));
    s.baserow.api.updateRows(s.made.state.tables.companies, [{ id: ids.Acme, [`field_${s.made.map.fields['companies.contract']}`]: cells }]);
    s.baserow.calls.length = 0;
    return s;
  };
  const refusal = (fn) => {
    try {
      fn();
    } catch (e) {
      return e;
    }
    return null;
  };
  // one file above 10 MB: refused, the file, its table and field named, nothing downloaded
  let s = setup([big('rapport.pdf', 10.5)]);
  let e = refusal(() => describeAll(s.baserow, s.disk));
  assert.deepEqual([e.code, e.refused, e.file, e.table, e.field, e.max], ['file_too_large', true, 'rapport.pdf', 'Sociétés', 'Contrat', 10 * MB]);
  assert.ok(!s.baserow.calls.some((c) => c.name === 'downloadFile'));
  // 30 MB in all: the file that goes over is named
  s = setup([big('a.pdf', 9), big('b.pdf', 9), big('c.pdf', 9), big('d.pdf', 4)]);
  e = refusal(() => describeAll(s.baserow, s.disk));
  assert.deepEqual([e.code, e.file, e.max], ['files_too_large', 'd.pdf', 30 * MB]);
  assert.ok(!s.baserow.calls.some((c) => c.name === 'downloadFile'));
  // lower limits asked by the caller, never higher ones
  e = refusal(() => describeAll(s.baserow, s.disk, 'Mini CRM', { maxFileBytes: 5 * MB }));
  assert.deepEqual([e.code, e.file, e.max], ['file_too_large', 'a.pdf', 5 * MB]);
  e = refusal(() => describeAll(s.baserow, s.disk, 'Mini CRM', { maxFileBytes: 100 * MB, maxFilesBytes: 100 * MB }));
  assert.deepEqual([e.code, e.max], ['files_too_large', 30 * MB]);
  // a size Baserow tells wrong: counted again on the bytes read, the folder deleted
  s = setup([big('menteur.pdf', 1)]);
  s.baserow.db.files.find((f) => f.visible_name === 'menteur.pdf').bytes = Buffer.alloc(11 * MB);
  e = refusal(() => describeAll(s.baserow, s.disk));
  assert.deepEqual([e.code, e.file, e.table, e.field], ['file_too_large', 'menteur.pdf', 'Sociétés', 'Contrat']);
  assert.deepEqual(s.disk.removed, [`${TRANSFER}describe-1`]);
  assert.equal([...s.disk.files.keys()].length, 0, 'nothing kept');
  // a download that fails: the file named, retryable, the folder deleted
  s = setup([big('x.pdf', 0.1)]);
  s.baserow.fail('downloadFile', Object.assign(new Error('reset'), { code: 'file_download_failed', retryable: true }), { after: 1 });
  e = refusal(() => describeAll(s.baserow, s.disk));
  assert.deepEqual([e.code, e.retryable, e.file], ['file_download_failed', true, 'x.pdf']);
  assert.equal(s.disk.removed.length, 1);
  // without the rows, the files of the rows are not read (only the images of the forms are)
  const noRows = BaserowSchema.describe(s.baserow.api, { tables: [path('Sociétés')], attachments: true }, s.disk.transfer);
  assert.deepEqual(noRows.attachments, []);
  assert.equal(noRows.transferDir, undefined);
  assert.throws(() => BaserowSchema.describe(s.baserow.api, { tables: [path('Sociétés')], attachments: true }), (x) => x.code === 'options_invalid', 'a transfer folder is needed');
  // apply checks the files it is given again, before any write
  s = source();
  const described = describeAll(s.baserow, s.disk);
  s.disk.files.set(`${TRANSFER}big/1`, Buffer.alloc(11 * MB));
  s.baserow.calls.length = 0;
  const files = Object.fromEntries(described.attachments.map((a) => [a.key, { path: a.path }]));
  let answer = runSteps(described.bases[0].schema, s.baserow.api, { baseName: 'Copie', files: { ...files, f2: { path: `${TRANSFER}big/1` } } }, s.disk.fileOf);
  assert.deepEqual([answer.error.code, answer.refused, answer.error.file, answer.error.max], ['file_too_large', true, 'contrat.pdf', 10 * MB]);
  s.disk.files.set(`${TRANSFER}big/2`, Buffer.alloc(9.9 * MB));
  s.disk.files.set(`${TRANSFER}big/3`, Buffer.alloc(9.9 * MB));
  s.disk.files.set(`${TRANSFER}big/4`, Buffer.alloc(9.9 * MB));
  answer = runSteps(described.bases[0].schema, s.baserow.api, { baseName: 'Copie', files: { f1: { path: `${TRANSFER}big/2` }, f2: { path: `${TRANSFER}big/3` }, f3: { path: `${TRANSFER}big/4` } }, maxFilesBytes: 20 * MB }, s.disk.fileOf);
  assert.deepEqual([answer.error.code, answer.error.file, answer.error.max], ['files_too_large', 'annexe.pdf', 20 * MB]);
  assert.ok(!s.baserow.calls.some((c) => /^(create|update|upload)/.test(c.name)));
});

test('describe of the views leaves out and lists what a schema does not carry', () => {
  const { baserow, disk: d, made } = source();
  const tableId = made.state.tables.companies;
  const field = (key) => made.map.fields[`companies.${key}`];
  const add = (view) => {
    const created = baserow.api.createView(tableId, { filter_type: 'AND', filters_disabled: false, public: false, ...view });
    return created.id;
  };
  add({ name: 'Personnelle', type: 'grid', ownership_type: 'personal' });
  add({ name: 'Carte', type: 'map' });
  const users = add({ name: 'Mes lignes', type: 'grid' });
  baserow.api.createViewFilter(users, { field: field('created'), type: 'user_is', value: '12' });
  baserow.api.createViewFilter(users, { field: field('industry'), type: 'single_select_equal', value: '999999' });
  baserow.api.createViewFilter(users, { field: field('name'), type: 'contains', value: 'a' });
  const publicView = add({ name: 'Publique', type: 'grid', public: true, slug: 'abcdef' });
  baserow.db.views.find((v) => v.id === publicView).public_view_password = 'secret';
  // without rows, a filter on rows is left out
  const described = BaserowSchema.describe(baserow.api, { tables: [{ path: path('Sociétés') }], views: true }, d.transfer);
  const omitted = described.omittedViews.map((o) => [o.table, o.view, o.what, o.reason, o.field || null]);
  assert.deepEqual(omitted, [
    ['Sociétés', 'Personnelle', 'view', 'personal', null],
    ['Sociétés', 'Carte', 'view', 'type', null],
    ['Sociétés', 'Mes lignes', 'filter', 'filter_user', 'Créé le'],
    ['Sociétés', 'Mes lignes', 'filter', 'filter_value', 'Secteur'],
    ['Opportunités', 'Acme', 'filter', 'filter_row', 'Société'],
  ]);
  const companies = described.bases[0].schema.tables.find((t) => t.name === 'Sociétés');
  assert.deepEqual(companies.views.find((v) => v.name === 'Mes lignes').filters, [{ field: 'Nom', type: 'contains', value: 'a' }]);
  const pub = companies.views.find((v) => v.name === 'Publique');
  assert.equal(pub.public, undefined);
  assert.doesNotMatch(JSON.stringify(described), /abcdef|secret|"public"/);
  // a view named twice gets a name of its own
  add({ name: 'Galerie', type: 'grid' });
  const twice = BaserowSchema.describe(baserow.api, { tables: [{ path: path('Sociétés') }], views: true }, d.transfer);
  assert.deepEqual(twice.bases[0].schema.tables.find((t) => t.name === 'Sociétés').views.filter((v) => /^Galerie/.test(v.name)).map((v) => v.name), ['Galerie', 'Galerie (2)']);
  // a group of filters the view does not list (an older Baserow) is read by its id
  const noGroups = source({ noFilterGroups: true });
  const read = describeAll(noGroups.baserow, noGroups.disk);
  const all = read.bases[0].schema.tables.find((t) => t.name === 'Sociétés').views.find((v) => v.name === 'Grille complète');
  assert.deepEqual(all.filterGroups, [{ key: 'g1', filterType: 'OR', parent: null }, { key: 'g2', filterType: 'AND', parent: 'g1' }]);
  assert.ok(noGroups.baserow.calls.some((c) => c.name === 'getFilterGroup'));
  assert.deepEqual(all.groupBys, [{ field: 'Secteur', order: 'ASC' }], 'the group bys read apart');
  assert.ok(noGroups.baserow.calls.filter((c) => c.name === 'listViewGroupBys').length >= 1);
});

test('apply of views: never public, a filter on rows made after the rows, left out without them', () => {
  const schema = fixture();
  const deals = schema.tables.find((t) => t.key === 'deals');
  deals.views.push({ key: 'acme', name: 'Acme', type: 'grid', filters: [{ field: 'company', type: 'link_row_has', rows: ['Acme'] }] });
  const units = BaserowSchema.units(BaserowSchema.normalizeSchema(JSON.parse(JSON.stringify(schema))), {});
  const at = (pred) => units.findIndex(pred);
  assert.ok(at((u) => u.phase === 'views' && u.view === 'acme') > at((u) => u.phase === 'rows'), 'after the rows');
  assert.ok(at((u) => u.phase === 'views' && u.view === 'pipeline') < at((u) => u.phase === 'rows'));
  const baserow = fakeBaserow();
  const done = runSteps(schema, baserow.api, {});
  const filter = baserow.db.filters.find((f) => f.view === done.map.views['deals.acme']);
  assert.equal(filter.value, String(done.state.rowIds.companies.Acme));
  const bare = fakeBaserow();
  const noRows = runSteps(schema, bare.api, { sampleData: false });
  assert.equal(noRows.status, 'done');
  assert.equal(bare.db.filters.filter((f) => f.view === noRows.map.views['deals.acme']).length, 0);
  assert.ok(noRows.state.warnings.some((w) => w.code === 'view_filter_rows'));
  // refusals of the schema
  const refuse = (view, pattern) => {
    const copy = fixture();
    copy.tables[0].views = [view];
    assert.throws(() => BaserowSchema.normalizeSchema(copy), pattern);
  };
  refuse({ name: 'P', public: true }, /never public/);
  refuse({ name: 'U', filters: [{ field: 'created', type: 'user_is', value: '3' }] }, /on a user/);
  refuse({ name: 'R', filters: [{ field: 'main_contact', type: 'link_row_has', value: '12' }] }, /by key \(rows\), not by id/);
  refuse({ name: 'G', filters: [{ field: 'name', type: 'equal', value: 'x', group: 'nope' }] }, /no filter group nope/);
  refuse({ name: 'H', filterGroups: [{ key: 'b', parent: 'a' }, { key: 'a' }] }, /not a group declared before/);
  refuse({ name: 'C', type: 'grid', cardCoverImageField: 'name' }, /only a gallery or a kanban/);
  refuse({ name: 'C', type: 'gallery', cardCoverImageField: 'name' }, /is not a file field/);
  refuse({ name: 'O', fieldOptions: { name: { width: 'large' } } }, /must be a number/);
  refuse({ name: 'O', fieldOptions: [] }, /must be an object/);
  refuse({ name: 'K', type: 'gallery', groupBys: [{ field: 'name' }] }, /only a grid view groups/);
  const kept = fixture();
  kept.tables[0].views = [{ name: 'O', fieldOptions: { name: { width: 120, aggregation_raw_type: 'sum', hidden: true, enabled: true } } }];
  assert.deepEqual(BaserowSchema.normalizeSchema(kept).tables[0].views[0].fieldOptions, [{ field: 'name', options: { hidden: true, width: 120 } }], 'only the options of the type of the view');
});

test('exactViews: the views Baserow makes with a new table, not named by the schema, are deleted; off by default', () => {
  const schema = fixture();
  schema.tables.forEach((t) => { t.views = t.views || []; });
  const withOption = fakeBaserow({ defaultView: true });
  const exact = runSteps(schema, withOption.api, { exactViews: true });
  assert.equal(exact.status, 'done', JSON.stringify(exact.error));
  const namesOf = (baserow, state, key) => baserow.db.views.filter((v) => v.table_id === state.tables[key]).map((v) => v.name);
  assert.deepEqual(namesOf(withOption, exact.state, 'companies'), ['Technologie']);
  assert.deepEqual(namesOf(withOption, exact.state, 'contacts'), ['Grid'], 'a table without views of the schema keeps its view');
  const without = fakeBaserow({ defaultView: true });
  const plain = runSteps(schema, without.api, {});
  assert.deepEqual(namesOf(without, plain.state, 'companies'), ['Grid', 'Technologie']);
  // a view of the schema named Grid is that view
  const named = fixture();
  named.tables[0].views.push({ key: 'grid', name: 'Grid', type: 'grid', sorts: [{ field: 'name', order: 'desc' }] });
  const kept = fakeBaserow({ defaultView: true });
  const done = runSteps(named, kept.api, { exactViews: true });
  assert.deepEqual(namesOf(kept, done.state, 'companies'), ['Grid', 'Technologie']);
  assert.equal(kept.db.sorts.filter((s) => s.view === done.map.views['companies.grid']).length, 1);
});

// review of beta26: the limits of the files always apply, the state names only uploaded files, the units of a
// run never change between its steps
test('the limits of the files: a negative size given counts 0, a file is checked again at its upload, the total of describe while it downloads', () => {
  const { baserow, disk: d } = source();
  const described = describeAll(baserow, d);
  const schema = described.bases[0].schema;
  d.files.set(`${TRANSFER}big/1`, Buffer.alloc(9.9 * MB));
  d.files.set(`${TRANSFER}big/2`, Buffer.alloc(9.9 * MB));
  d.files.set(`${TRANSFER}big/3`, Buffer.alloc(9.9 * MB));
  // a name of the caller with a negative size: counted 0, the paths still over 15 MB
  const uploaded = BaserowSchema.uploadFile(baserow.api, { path: described.attachments[0].path }, d.fileOf).file;
  const answer = runSteps(schema, baserow.api, { baseName: 'Copie', maxFilesBytes: 15 * MB,
    files: { f1: { name: uploaded.name, size: -1e9 }, f2: { path: `${TRANSFER}big/1` }, f3: { path: `${TRANSFER}big/2` } } }, d.fileOf);
  assert.deepEqual([answer.error.code, answer.error.file, answer.error.max], ['files_too_large', 'annexe.pdf', 15 * MB]);
  // a file that grew after the check of the first step: refused at its upload
  let grown = false;
  const fileOf = (p) => {
    const found = d.fileOf(p);
    if (found && p === `${TRANSFER}big/3` && grown) return { ...found, size: 11 * MB };
    return found;
  };
  let state = null;
  let last;
  for (let i = 0; i < 300; i++) {
    last = BaserowSchema.step(JSON.stringify(schema), state && JSON.stringify(state), baserow.api,
      { workspaceId: WORKSPACE, baseName: 'Copie 2', maxCalls: 1, files: { f1: { path: described.attachments[0].path }, f2: { path: described.attachments[1].path }, f3: { path: `${TRANSFER}big/3` } } }, fileOf);
    state = last.state;
    grown = true;
    if (last.status !== 'running') break;
  }
  assert.deepEqual([last.error.code, last.error.file], ['file_too_large', 'annexe.pdf']);
  // describe: the total checked while it downloads (Baserow tells small sizes)
  const lying = source();
  const ids = lying.made.state.rowIds.companies;
  const cells = ['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf'].map((n) => lying.baserow.addFile(n, Buffer.alloc(9 * MB)));
  lying.baserow.api.updateRows(lying.made.state.tables.companies, [{ id: ids.Acme, [`field_${lying.made.map.fields['companies.contract']}`]: cells }]);
  lying.baserow.db.files.forEach((f) => { f.size = 10; });
  const e = (() => { try { describeAll(lying.baserow, lying.disk); } catch (x) { return x; } return null; })();
  assert.deepEqual([e.code, e.file, e.max], ['files_too_large', 'd.pdf', 30 * MB]);
  const downloads = lying.baserow.calls.filter((c) => c.name === 'downloadFile').map((c) => c.args[2]);
  assert.ok(downloads.every((limit, i) => limit <= 10 * MB) && downloads[downloads.length - 1] < 10 * MB, 'the last download is bounded by what is left of the total');
});

test('the state names only files uploaded by the run, and keeps the options its units depend on', () => {
  const { baserow, disk: d } = source();
  const described = describeAll(baserow, d);
  const schema = described.bases[0].schema;
  const files = Object.fromEntries(described.attachments.map((a) => [a.key, { path: a.path }]));
  const first = BaserowSchema.step(JSON.stringify(schema), null, baserow.api, { workspaceId: WORKSPACE, baseName: 'Copie', files, maxCalls: 1, exactViews: true }, d.fileOf);
  assert.equal(first.status, 'running');
  for (const bad of [{ f1: { name: '../../x', size: 1 } }, { f1: { name: 'ok.png', size: -1 } }, { __proto__x: { name: 'a.png', size: 1 } }, []]) {
    const edited = { ...first.state, files: bad };
    const answer = BaserowSchema.step(JSON.stringify(schema), JSON.stringify(edited), baserow.api, { workspaceId: WORKSPACE, files }, d.fileOf);
    assert.equal(answer.error.code, 'state_invalid', JSON.stringify(bad));
  }
  // exactViews (and sampleData) of the first step stay: the cursor points into the same units
  assert.equal(first.state.exactViews, true);
  let state = first.state;
  let answer = first;
  for (let i = 0; i < 300 && answer.status === 'running'; i++) {
    answer = BaserowSchema.step(JSON.stringify(schema), JSON.stringify(state), baserow.api, { workspaceId: WORKSPACE, files, maxCalls: 3, exactViews: i % 2 === 0, sampleData: i % 3 === 0 }, d.fileOf);
    state = answer.state;
  }
  assert.equal(answer.status, 'done', JSON.stringify(answer.error));
  assert.equal(baserow.db.rows.filter((r) => r.table_id === answer.state.tables['Sociétés']).length, 2, 'the rows of the first step');
});
