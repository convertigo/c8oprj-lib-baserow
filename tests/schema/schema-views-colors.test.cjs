// js/baserow_schema.js, the colors of the rows, the timeline view and the images of a form (C8Oforms #1836):
// - describe with views reads the decorations of a view (left border or background, by the color of a select option or
//   by conditions whose filters name options and rows by key), the start and end fields and the time scale of a
//   timeline, the texts of a form and, with attachments, its cover and logo as files of the schema (same limits);
// - apply makes them again in the views of the run; the images are uploaded first (phase files, before the views);
// - the round trip describe -> apply -> describe gives the same schema and the same bytes;
// - the rollback lists the files the run uploaded, which Baserow cannot delete.
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

function disk() {
  const files = new Map();
  let folders = 0;
  return {
    files,
    transfer: {
      open: () => `${TRANSFER}describe-${++folders}`,
      target: (dir, n, name) => `${dir}/${n}/${name}`,
      remove: (dir) => { for (const key of [...files.keys()]) if (key.startsWith(`${dir}/`)) files.delete(key); },
    },
    fileOf: (p) => (typeof p === 'string' && p.startsWith(TRANSFER) && files.has(p) ? { path: p, size: files.get(p).length, name: p.split('/').pop() } : null),
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

// the Mini CRM with colored rows, a timeline and a form with its images, made by apply (the images uploaded)
function source(extra = {}) {
  const d = disk();
  d.files.set(`${TRANSFER}seed/cover.png`, Buffer.from('PNG cover'));
  d.files.set(`${TRANSFER}seed/logo.png`, Buffer.from('PNG logo!'));
  const baserow = fakeBaserow({ writeFile: (p, b) => d.files.set(p, b), readFile: (p) => d.files.get(p), ...extra });
  const schema = fixture();
  schema.files = [{ key: 'cover', visible_name: 'cover.png' }, { key: 'logo', visible_name: 'logo.png' }];
  const companies = schema.tables.find((t) => t.key === 'companies');
  companies.views.push({
    key: 'colors', name: 'Couleurs', type: 'grid',
    decorations: [
      { type: 'left_border_color', provider: 'single_select_color', field: 'industry' },
      {
        type: 'background_color', provider: 'conditional_color', default: 'light-gray',
        colors: [
          { color: 'light-red', filterType: 'OR', filterGroups: [{ key: 'g1', filterType: 'AND' }],
            filters: [{ field: 'industry', type: 'single_select_equal', options: ['retail'] }, { field: 'name', type: 'contains', value: 'Ac', group: 'g1' }] },
          { color: '#00ff00', filters: [{ field: 'main_contact', type: 'link_row_has', rows: ['Alice Martin'] }] },
        ],
      },
    ],
  }, {
    key: 'form', name: 'Formulaire', type: 'form', title: 'Nouvelle société', description: 'Dites-nous tout', submitText: 'Envoyer',
    submitAction: 'REDIRECT', submitActionRedirectUrl: 'https://example.com/merci', mode: 'form',
    coverImage: { file: 'cover' }, logoImage: { file: 'logo' }, fieldOptions: { name: { enabled: true, required: true, order: 1 } },
  });
  const deals = schema.tables.find((t) => t.key === 'deals');
  deals.fields.push({ key: 'end', name: 'Fin', type: 'date' });
  deals.views.push({ key: 'timeline', name: 'Frise', type: 'timeline', startDateField: 'closing', endDateField: 'end', timescale: 'week', fieldOptions: { title: { hidden: false, order: 0 } } });
  const made = runSteps(schema, baserow.api, { files: { cover: { path: `${TRANSFER}seed/cover.png` }, logo: { path: `${TRANSFER}seed/logo.png` } } }, d.fileOf);
  assert.equal(made.status, 'done', JSON.stringify(made.error));
  baserow.calls.length = 0;
  return { baserow, disk: d, made, schema };
}

const describeAll = (baserow, d, base = 'Mini CRM', extra = {}) => BaserowSchema.describe(baserow.api,
  { tables: [{ path: path('Sociétés', base) }], rows: true, attachments: true, views: true, ...extra }, d.transfer);

// a describe answer without what differs from one base to another (the keys of the rows: their rank)
function canonical(described) {
  return described.bases.map((base) => {
    const schema = JSON.parse(JSON.stringify(base.schema));
    const rank = {};
    for (const table of schema.tables) {
      rank[table.key] = {};
      (table.sampleRows ? table.sampleRows.rows : []).forEach((row, i) => { rank[table.key][row._key] = `r${i}`; });
    }
    const fixFilters = (table, filters) => {
      for (const filter of filters || []) {
        if (filter.rows) {
          const field = [table.primaryField, ...table.fields].find((f) => f.key === filter.field);
          filter.rows = filter.rows.map((k) => rank[field.targetTable][k]);
        }
      }
    };
    for (const table of schema.tables) {
      for (const row of table.sampleRows ? table.sampleRows.rows : []) {
        row._key = rank[table.key][row._key];
        for (const field of [table.primaryField, ...table.fields]) {
          if (field.type === 'link_row' && row[field.key]) row[field.key] = row[field.key].map((k) => rank[field.targetTable][k]);
        }
      }
      for (const view of table.views || []) {
        fixFilters(table, view.filters);
        for (const decoration of view.decorations || []) for (const color of decoration.colors || []) fixFilters(table, color.filters);
      }
    }
    delete schema.key;
    delete schema.base;
    return schema;
  });
}

test('describe: the colors of the rows, the timeline and the form with its images', () => {
  const { baserow, disk: d } = source();
  const described = describeAll(baserow, d);
  assert.equal(described.status, 'ok', JSON.stringify(described.error));
  const tables = described.bases[0].schema.tables;
  const companies = tables.find((t) => t.name === 'Sociétés');
  const alice = tables.find((t) => t.name === 'Contacts').sampleRows.rows.find((r) => r['Nom complet'] === 'Alice Martin')._key;
  assert.deepEqual(companies.views.find((v) => v.name === 'Couleurs').decorations, [
    { type: 'left_border_color', provider: 'single_select_color', field: 'Secteur' },
    {
      type: 'background_color', provider: 'conditional_color', default: 'light-gray',
      colors: [
        { color: 'light-red', filterType: 'OR', filterGroups: [{ key: 'g1', filterType: 'AND', parent: null }],
          filters: [{ field: 'Secteur', type: 'single_select_equal', options: ['Commerce'] }, { field: 'Nom', type: 'contains', value: 'Ac', group: 'g1' }] },
        { color: '#00ff00', filters: [{ field: 'Contact principal', type: 'link_row_has', rows: [alice] }] },
      ],
    },
  ]);
  const form = companies.views.find((v) => v.name === 'Formulaire');
  assert.deepEqual(
    [form.title, form.description, form.submitText, form.submitAction, form.submitActionRedirectUrl, form.mode, form.coverImage, form.logoImage],
    ['Nouvelle société', 'Dites-nous tout', 'Envoyer', 'REDIRECT', 'https://example.com/merci', 'form', { file: 'f1' }, { file: 'f2' }],
  );
  assert.deepEqual(described.bases[0].schema.files.map((f) => [f.key, f.visible_name, f.mime_type, f.is_image]), [
    ['f1', 'cover.png', 'image/png', true], ['f2', 'logo.png', 'image/png', true],
  ]);
  assert.deepEqual(described.attachments.map((a) => [a.key, a.path.slice(described.transferDir.length)]), [['f1', '/1/cover.png'], ['f2', '/2/logo.png']]);
  const timeline = tables.find((t) => t.name === 'Opportunités').views.find((v) => v.name === 'Frise');
  assert.deepEqual([timeline.type, timeline.startDateField, timeline.endDateField, timeline.timescale], ['timeline', 'Clôture', 'Fin', 'week']);
  assert.deepEqual(timeline.fieldOptions['Titre'], { hidden: false, order: 0 });
  assert.deepEqual(described.omittedViews, []);
  assert.doesNotMatch(JSON.stringify(described), /media\.example\.com|"url":|"name":"u\d+_/);
});

test('round trip with colors, timeline and form images: the same schema and the same bytes', () => {
  const { baserow, disk: d } = source();
  const first = describeAll(baserow, d);
  const files = Object.fromEntries(first.attachments.map((a) => [a.key, { path: a.path }]));
  const made = runSteps(first.bases[0].schema, baserow.api, { baseName: 'Copie', files, exactViews: true }, d.fileOf);
  assert.equal(made.status, 'done', JSON.stringify(made.error));
  // the images are uploaded before the views, the form made with them
  const names = baserow.calls.map((c) => c.name);
  assert.ok(names.lastIndexOf('uploadFile') < names.indexOf('createView'));
  const form = baserow.calls.find((c) => c.name === 'createView' && c.args[1].type === 'form').args[1];
  assert.ok(form.cover_image.name && form.logo_image.name && form.public === false);
  const decorations = baserow.calls.filter((c) => c.name === 'createViewDecoration').map((c) => c.args[1]);
  assert.equal(decorations.length, 2);
  assert.deepEqual(decorations[0].value_provider_conf, { field_id: made.map.fields['Sociétés.Secteur'] });
  const conditional = decorations[1].value_provider_conf;
  assert.match(conditional.colors[0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(conditional.colors[0].filters[0].value, String(made.map.options['Sociétés.Secteur.Commerce']));
  assert.equal(conditional.colors[0].filters[1].group, conditional.colors[0].filter_groups[0].id);
  const second = describeAll(baserow, d, 'Copie');
  assert.deepEqual(canonical(second), canonical(first));
  for (const a of first.attachments) {
    assert.deepEqual(d.files.get(second.attachments.find((x) => x.key === a.key).path), d.files.get(a.path), a.visible_name);
  }
});

test('the images of a form: listed without attachments, within the limits of the files, read without the rows', () => {
  const { baserow, disk: d } = source();
  const noFiles = BaserowSchema.describe(baserow.api, { tables: [{ path: path('Sociétés') }], views: true, rows: true }, d.transfer);
  assert.deepEqual(noFiles.omittedViews.map((o) => [o.view, o.what, o.reason]), [['Formulaire', 'coverImage', 'attachments'], ['Formulaire', 'logoImage', 'attachments']]);
  assert.equal(noFiles.attachments, undefined);
  // without the rows, the images only
  const images = BaserowSchema.describe(baserow.api, { tables: [{ path: path('Sociétés') }], views: true, attachments: true }, d.transfer);
  assert.deepEqual(images.attachments.map((a) => a.visible_name), ['cover.png', 'logo.png']);
  // and an image above 10 MB: refused, the view named
  baserow.db.files.find((f) => f.visible_name === 'cover.png').size = 11 * MB;
  const e = (() => { try { describeAll(baserow, d); } catch (x) { return x; } return null; })();
  assert.deepEqual([e.code, e.refused, e.file, e.table, e.view, e.field], ['file_too_large', true, 'cover.png', 'Sociétés', 'Formulaire', 'cover_image']);
  // a schema without the rows still uploads the images of its forms
  baserow.db.files.find((f) => f.visible_name === 'cover.png').size = 9;
  const schema = images.bases[0].schema;
  const files = Object.fromEntries(images.attachments.map((a) => [a.key, { path: a.path }]));
  const made = runSteps(schema, baserow.api, { baseName: 'Sans lignes', files, sampleData: false }, d.fileOf);
  assert.equal(made.status, 'done', JSON.stringify(made.error));
  assert.equal(Object.keys(made.state.files).length, 2);
  const missing = runSteps(schema, baserow.api, { baseName: 'Sans fichiers', sampleData: false }, d.fileOf);
  assert.deepEqual([missing.error.code, missing.error.file], ['file_missing', 'cover.png']);
});

test('describe leaves out and lists a redirection that is not http or https, a color without its field', () => {
  const { baserow, disk: d, made } = source();
  const formId = made.map.views['companies.form'];
  baserow.db.fieldOptions[formId][String(made.map.fields['companies.website'])] = { enabled: true, show_when_matching_conditions: true };
  baserow.db.views.find((v) => v.id === formId).submit_action_redirect_url = 'ftp://example.com/merci';
  const colors = made.map.views['companies.colors'];
  baserow.db.decorations.push({ id: 99001, view: colors, type: 'left_border_color', value_provider_type: 'single_select_color', value_provider_conf: { field_id: made.map.fields['companies.website'] } });
  baserow.db.decorations.push({ id: 99002, view: colors, type: 'glow', value_provider_type: 'single_select_color', value_provider_conf: {} });
  const described = describeAll(baserow, d);
  // (Couleurs is made after Formulaire: a color filters on rows)
  assert.deepEqual(described.omittedViews.map((o) => [o.view, o.what, o.reason]), [
    ['Formulaire', 'submitActionRedirectUrl', 'url'],
    ['Couleurs', 'decoration', 'view_field'], ['Couleurs', 'decoration', 'type'],
  ]);
  // the field shown on conditions is carried (beta28)
  const form = described.bases[0].schema.tables.find((t) => t.name === 'Sociétés').views.find((v) => v.name === 'Formulaire');
  assert.equal(form.fieldOptions['Site web'].showWhenMatchingConditions, true);
  assert.doesNotMatch(JSON.stringify(described), /ftp:/);
});

test('the schema of the colors, the timeline and the form is checked', () => {
  const refuse = (view, pattern, files) => {
    const schema = fixture();
    if (files) schema.files = files;
    schema.tables[0].views = [{ name: 'V', type: 'grid', ...view }];
    assert.throws(() => BaserowSchema.normalizeSchema(schema), pattern, JSON.stringify(view));
  };
  refuse({ decorations: [{ type: 'glow', provider: 'single_select_color', field: 'industry' }] }, /a decoration is a left_border_color or background_color/);
  refuse({ decorations: [{ type: 'background_color', provider: 'single_select_color', field: 'name' }] }, /is not a single_select field/);
  refuse({ decorations: [{ type: 'background_color', provider: 'conditional_color', colors: [] }] }, /1 to 100 colors/);
  refuse({ decorations: [{ type: 'background_color', provider: 'conditional_color', colors: [{ color: 'red; background:url(x)' }] }] }, /a name or #code/);
  refuse({ decorations: [{ type: 'background_color', provider: 'conditional_color', colors: [{ color: 'red', filters: [{ field: 'created', type: 'user_is', value: '1' }] }] }] }, /on a user/);
  refuse({ title: 'x' }, /only a form view has texts and images/);
  refuse({ type: 'form', submitActionRedirectUrl: 'ftp://example.com/merci' }, /http or https/);
  refuse({ type: 'form', submitAction: 'EXEC' }, /MESSAGE or REDIRECT/);
  refuse({ type: 'form', coverImage: { name: 'u1_x.png' } }, /coverImage is \{file/, [{ key: 'f1', visible_name: 'x.png' }]);
  refuse({ type: 'form', logoImage: { file: 'f9' } }, /logoImage is \{file/, [{ key: 'f1', visible_name: 'x.png' }]);
  refuse({ type: 'timeline', timescale: 'decade' }, /timescale is day, week, month, year/);
  refuse({ type: 'timeline', startDateField: 'nope' }, /no field nope/);
  // a form schema without its images is fine; the phase files comes before the views
  const schema = fixture();
  schema.files = [{ key: 'f1', visible_name: 'x.png' }];
  schema.tables[0].views = [{ name: 'F', type: 'form', coverImage: { file: 'f1' } }];
  const units = BaserowSchema.units(BaserowSchema.normalizeSchema(schema), { sampleData: false });
  assert.ok(units.findIndex((u) => u.phase === 'files') < units.findIndex((u) => u.phase === 'views'));
  assert.deepEqual(BaserowSchema.PHASES, ['base', 'tables', 'fields', 'links', 'computed', 'files', 'views', 'rows', 'rowlinks', 'done']);
});

test('the rollback lists the files the run uploaded, which Baserow cannot delete, never their name of Baserow', () => {
  const { baserow, disk: d } = source();
  const described = describeAll(baserow, d);
  const files = Object.fromEntries(described.attachments.map((a) => [a.key, { path: a.path }]));
  const made = runSteps(described.bases[0].schema, baserow.api, { baseName: 'Copie', files }, d.fileOf);
  const rollback = BaserowSchema.rollback(baserow.api, made.state);
  assert.equal(rollback.status, 'deleted');
  assert.deepEqual(rollback.uploadedFiles, [{ key: 'f1', visible_name: 'cover.png', size: 9 }, { key: 'f2', visible_name: 'logo.png', size: 9 }]);
  assert.doesNotMatch(JSON.stringify(rollback.uploadedFiles), /u\d+_/);
  // files given by the caller (uploaded by mode upload) are the caller's: not listed
  const given = Object.fromEntries(described.attachments.map((a) => [a.key, BaserowSchema.uploadFile(baserow.api, { path: a.path }, d.fileOf).file]));
  const other = runSteps(described.bases[0].schema, baserow.api, { baseName: 'Copie 2', files: given }, d.fileOf);
  assert.equal(BaserowSchema.rollback(baserow.api, other.state).uploadedFiles, undefined);
});

test('in a base of the user, a view of the user that the import names gets no color, text nor image of the import', () => {
  const { baserow, disk: d, made } = source();
  const before = baserow.db.decorations.length;
  const colorsId = made.map.views['companies.colors'];
  const formId = made.map.views['companies.form'];
  const described = describeAll(baserow, d);
  const files = Object.fromEntries(described.attachments.map((a) => [a.key, { path: a.path }]));
  // the same views imported into the same base (the user's now): found by name, left as they are
  const schema = described.bases[0].schema;
  const formBefore = JSON.parse(JSON.stringify(baserow.db.views.find((v) => v.id === formId)));
  baserow.calls.length = 0;
  const run = runSteps(schema, baserow.api, { workspaceId: undefined, baseId: made.state.baseId, files, sampleData: false }, d.fileOf);
  assert.equal(run.status, 'done', JSON.stringify(run.error));
  assert.ok(!baserow.calls.some((c) => c.name === 'createViewDecoration'), 'no color added to a view of the user');
  assert.equal(baserow.db.decorations.length, before);
  assert.equal(run.map.views['Sociétés.Couleurs'], colorsId);
  assert.deepEqual(baserow.db.views.find((v) => v.id === formId), formBefore, 'the form of the user as it was');
  // the images were uploaded all the same (the files of the schema): listed by the rollback, which deletes nothing else
  const rollback = BaserowSchema.rollback(baserow.api, run.state);
  assert.deepEqual(rollback.uploadedFiles.map((f) => f.visible_name), ['cover.png', 'logo.png']);
});
