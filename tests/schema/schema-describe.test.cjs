// js/baserow_schema.js mode describe (C8Oforms #1836, export of an application with its no-code database): the schemas
// of tables of the account, read with its own token, the tables they link, their rows on demand; applied again in a
// new base they give the same tables, fields, select options, links and rows. What it cannot carry is left out and
// listed; above its limits it refuses with the table and the limit.
const test = require('node:test');
const assert = require('node:assert/strict');
const BaserowSchema = require('../../js/baserow_schema.js');
const { fakeBaserow } = require('./fake-baserow.cjs');

const fixture = () => JSON.parse(JSON.stringify(require('./fixtures/mini-crm.baserow.json')));
const WORKSPACE = 836;
const WORKSPACE_NAME = 'Convertigo NoCode Databases - user@example.com';
const path = (table, base = 'Mini CRM') => `${WORKSPACE_NAME}~>${base}~>${table}`;

function runSteps(schema, api, options, max = 200) {
  let state = null;
  let answer;
  for (let i = 0; i < max; i++) {
    answer = BaserowSchema.step(JSON.stringify(schema), state && JSON.stringify(state), api, { workspaceId: WORKSPACE, ...options });
    state = answer.state;
    if (answer.status !== 'running') break;
  }
  assert.equal(answer.status, 'done', JSON.stringify(answer.error));
  return answer;
}

// the Mini CRM of the fixture, made in the fake base with its sample rows
function crm() {
  const baserow = fakeBaserow();
  const made = runSteps(fixture(), baserow.api, {});
  return { baserow, baseId: made.state.baseId, tables: made.state.tables };
}

// what a base holds, by names: tables, fields with their types and options, rows by primary value with their
// selects and links by the primary value of the linked row
function contents(described) {
  const out = {};
  for (const base of described.bases) {
    for (const table of base.schema.tables) {
      const fields = [table.primaryField, ...table.fields].map((f) => [f.name, f.type, (f.values || []).map((v) => v.value).join('|')]);
      out[table.name] = { fields: fields.sort((a, b) => a[0].localeCompare(b[0])) };
    }
    const primaryOf = {};
    for (const table of base.schema.tables) {
      for (const row of table.sampleRows ? table.sampleRows.rows : []) {
        primaryOf[`${table.key}#${row._key}`] = row[table.primaryField.key];
      }
    }
    for (const table of base.schema.tables) {
      out[table.name].rows = (table.sampleRows ? table.sampleRows.rows : []).map((row) => {
        const values = {};
        for (const [column, value] of Object.entries(row)) {
          if (column === '_key') continue;
          const field = table.fields.find((f) => f.key === column) || table.primaryField;
          values[column] = field.type === 'link_row' ? value.map((key) => primaryOf[`${field.targetTable}#${key}`]).sort() : value;
        }
        return values;
      }).sort((a, b) => String(a[table.primaryField.key]).localeCompare(String(b[table.primaryField.key])));
    }
  }
  return out;
}

test('describe gives the tables asked and the tables they link, with fields, options, links and computed fields', () => {
  const { baserow } = crm();
  baserow.calls.length = 0;
  const described = BaserowSchema.describe(baserow.api, { tables: [{ path: path('Contacts') }] });
  assert.equal(described.status, 'ok');
  assert.deepEqual(described.skipped, []);
  assert.equal(described.bases.length, 1);
  const base = described.bases[0];
  assert.equal(base.base, 'Mini CRM');
  assert.equal(base.workspace, WORKSPACE_NAME);
  assert.deepEqual(base.schema.tables.map((t) => t.name).sort(), ['Contacts', 'Opportunités', 'Sociétés']);
  assert.ok(base.tables.every((t) => Number.isInteger(t.id) && t.path === path(t.key)));
  const companies = base.schema.tables.find((t) => t.name === 'Sociétés');
  const contacts = base.schema.tables.find((t) => t.name === 'Contacts');
  const deals = base.schema.tables.find((t) => t.name === 'Opportunités');
  assert.deepEqual(companies.primaryField, { key: 'Nom', name: 'Nom', type: 'text' });
  const field = (table, name) => table.fields.find((f) => f.name === name);
  assert.deepEqual(field(companies, 'Secteur').values.map((v) => [v.key, v.value]), [['Technologie', 'Technologie'], ['Commerce', 'Commerce']]);
  // a pair of links is carried once, its related field named
  assert.deepEqual(field(contacts, 'Société'), { key: 'Société', name: 'Société', type: 'link_row', targetTable: 'Sociétés',
    createRelatedField: true, relatedFieldKey: 'Contacts', relatedFieldName: 'Contacts' });
  assert.equal(field(companies, 'Contacts'), undefined, 'the related field of a link is not a field of its own');
  assert.equal(field(companies, 'Contact principal').createRelatedField, false);
  assert.deepEqual(field(companies, 'Montant des opportunités'), { key: 'Montant des opportunités', name: 'Montant des opportunités', type: 'rollup',
    through: 'Opportunités', targetField: 'Montant', rollupFunction: 'sum' });
  assert.equal(field(companies, 'Résumé').formula, "concat(field('Nom'), ' - ', totext(field('Nombre d\\'opportunités')))");
  assert.deepEqual(field(deals, 'Montant').baserowOptions, { number_decimal_places: 2 });
  assert.equal(companies.sampleRows, undefined, 'no row unless asked');
  // the ids of the select options, to remap what an application names by id
  const option = base.options.find((o) => o.table === 'Opportunités' && o.field === 'Étape' && o.option === 'Gagnée');
  assert.ok(Number.isInteger(option.id));
  // never an id, a workspace or a token in the schema
  const text = JSON.stringify(base.schema);
  assert.doesNotMatch(text, /"id"|workspace|JWT|password/i);
  assert.ok(!baserow.calls.some((c) => /^(create|update|delete)/.test(c.name)), 'describe never writes');
});

test('applied again in a new base, the schema and the rows described give the same base', () => {
  const { baserow } = crm();
  const first = BaserowSchema.describe(baserow.api, { tables: [path('Sociétés')], rows: true });
  assert.equal(first.counts.rows, 6);
  const schema = first.bases[0].schema;
  assert.ok(schema.tables.every((t) => t.sampleRows.rows.every((row) => /^\d+$/.test(row._key))));
  const made = runSteps(schema, baserow.api, { baseName: 'Mini CRM copy' });
  assert.equal(made.created.rows === undefined || made.created.rows >= 0, true);
  const second = BaserowSchema.describe(baserow.api, { tables: [path('Sociétés', 'Mini CRM copy')], rows: true });
  assert.deepEqual(contents(second), contents(first));
  const deals = contents(second)['Opportunités'].rows;
  assert.deepEqual(deals.find((r) => r['Titre'] === 'Licence Acme'), { Titre: 'Licence Acme', Montant: 1200, 'Étape': 'Gagnée', Société: ['Acme'],
    'Clôture': '2026-01-15', 'Étiquettes': ['Urgent'] });
});

test('rows keyed by their own key: any primary field, created without being looked for by value', () => {
  const schema = {
    format: 'c8oforms.baserow-template', formatVersion: 1, key: 'k', version: '1', base: { defaultName: 'KPI' },
    tables: [{ key: 'kpi', name: 'KPI', primaryField: { key: 'Id', name: 'Id', type: 'formula', formula: 'row_id()' },
      fields: [{ key: 'Libellé', name: 'Libellé', type: 'text' }],
      sampleRows: { upsertKey: 'Id', rows: [{ _key: '7', 'Libellé': 'Taux' }, { _key: '9', 'Libellé': 'Taux' }] } }],
  };
  assert.doesNotThrow(() => BaserowSchema.normalizeSchema(JSON.parse(JSON.stringify(schema))));
  const noRows = JSON.parse(JSON.stringify(schema));
  delete noRows.tables[0].sampleRows;
  assert.doesNotThrow(() => BaserowSchema.normalizeSchema(noRows), 'a formula primary field without rows');
  const unkeyed = JSON.parse(JSON.stringify(schema));
  unkeyed.tables[0].sampleRows.rows = [{ 'Libellé': 'Taux' }];
  assert.throws(() => BaserowSchema.normalizeSchema(unkeyed), /upsertKey Id must be a text or number field/);
  const baserow = fakeBaserow();
  const made = runSteps(schema, baserow.api, {});
  assert.equal(baserow.db.rows.filter((r) => r.table_id === made.state.tables.kpi).length, 2, 'two rows with the same value are two rows');
  // (a batch reads the number of rows of its table first, one row: its write is never made twice)
  assert.ok(!baserow.calls.some((c) => c.name === 'listRows' && c.args[2] !== 1), 'keyed rows are never looked for');
});

test('what describe cannot carry is left out and listed, a table out of reach is skipped', () => {
  const { baserow, tables } = crm();
  const contactsId = tables.contacts;
  let nextId = 900000;
  const add = (body) => {
    const fieldRow = { id: ++nextId, table_id: contactsId, primary: false, ...body };
    baserow.db.fields.push(fieldRow);
    return fieldRow;
  };
  add({ name: 'Mot de passe', type: 'password' });
  add({ name: 'Collaborateurs', type: 'multiple_collaborators' });
  const file = add({ name: 'Pièce', type: 'file' });
  add({ name: 'Code', type: 'formula', formula: "concat(field('Mot de passe'), 'x')" });
  baserow.db.rows.filter((r) => r.table_id === contactsId).forEach((row) => {
    row[`field_${file.id}`] = [{ name: 'u1_cv.pdf', visible_name: 'cv.pdf' }];
  });
  const described = BaserowSchema.describe(baserow.api, { tables: [path('Contacts'), path('Absente'), { id: 424242 }], rows: true });
  assert.deepEqual(described.skipped, [{ table: path('Absente'), reason: 'not_readable' }, { table: '424242', reason: 'not_readable' }]);
  assert.deepEqual(described.omitted.map((o) => [o.table, o.field, o.reason]), [
    ['Contacts', 'Mot de passe', 'password'], ['Contacts', 'Collaborateurs', 'type'], ['Contacts', 'Code', 'reference'],
  ]);
  assert.deepEqual(described.files, [{ table: 'Contacts', field: 'Pièce' }]);
  const contacts = described.bases[0].schema.tables.find((t) => t.name === 'Contacts');
  assert.deepEqual(contacts.fields.find((f) => f.name === 'Pièce'), { key: 'Pièce', name: 'Pièce', type: 'file' }, 'the file field is created, empty');
  assert.ok(contacts.sampleRows.rows.every((row) => row['Pièce'] === undefined));
  assert.doesNotMatch(JSON.stringify(described), /cv\.pdf/);
});

test('above its limits describe refuses, naming the table and the limit', () => {
  const { baserow, tables } = crm();
  baserow.api.createRows(tables.deals, Array.from({ length: 30 }, () => ({})));
  const many = (() => {
    try {
      BaserowSchema.describe(baserow.api, { tables: [path('Opportunités')], rows: true, maxRowsPerTable: 20 });
    } catch (e) {
      return e;
    }
    return null;
  })();
  assert.equal(many.code, 'rows_too_many');
  assert.equal(many.refused, true);
  assert.deepEqual([many.table, many.count, many.max], ['Opportunités', 32, 20]);
  assert.throws(() => BaserowSchema.describe(baserow.api, { tables: [path('Opportunités')], rows: true, maxTableBytes: 100 }),
    (e) => e.code === 'rows_too_large' && e.table === 'Opportunités' && e.max === 100);
  assert.throws(() => BaserowSchema.describe(baserow.api, { tables: [path('Opportunités')], maxBytes: 200 }),
    (e) => e.code === 'export_too_large' && e.max === 200);
  assert.throws(() => BaserowSchema.describe(baserow.api, { tables: Array.from({ length: 101 }, (v, i) => ({ id: i })) }),
    (e) => e.code === 'tables_too_many');
  assert.throws(() => BaserowSchema.describe(baserow.api, { tables: [] }), (e) => e.code === 'tables_missing');
  // a limit above the engine's own is the engine's own
  const capped = BaserowSchema.describe(baserow.api, { tables: [path('Opportunités')], rows: true, maxRowsPerTable: 1e9, maxTableBytes: 1e12 });
  assert.equal(capped.bases[0].schema.limits.maxRowsPerTable, 2000);
});

test('a link to a row that was not read is left out of the row, the row stays', () => {
  const { baserow, tables } = crm();
  // a deal linked to a company row the account cannot read (removed from the answers)
  const hidden = baserow.db.rows.find((r) => r.table_id === tables.companies);
  baserow.db.rows = baserow.db.rows.filter((r) => r !== hidden);
  const described = BaserowSchema.describe(baserow.api, { tables: [path('Opportunités')], rows: true });
  const deals = described.bases[0].schema.tables.find((t) => t.name === 'Opportunités').sampleRows.rows;
  assert.equal(deals.length, 2);
  assert.ok(deals.every((row) => (row['Société'] || []).every((key) => key !== String(hidden.id))));
  assert.doesNotThrow(() => BaserowSchema.normalizeSchema(JSON.parse(JSON.stringify(described.bases[0].schema))));
});

test('with linked false, the tables asked only: a link to another table is left out and listed with what goes through it', () => {
  const { baserow } = crm();
  baserow.calls.length = 0;
  const described = BaserowSchema.describe(baserow.api, { tables: [{ path: path('Sociétés') }], linked: false, rows: true });
  assert.equal(described.status, 'ok');
  const base = described.bases[0];
  assert.deepEqual(base.schema.tables.map((t) => t.name), ['Sociétés']);
  assert.deepEqual(base.tables.map((t) => t.key), ['Sociétés']);
  assert.deepEqual(described.omitted, [
    { table: 'Sociétés', field: 'Contact principal', type: 'link_row', reason: 'link_target' },
    { table: 'Sociétés', field: 'Contacts', type: 'link_row', reason: 'link_target' },
    { table: 'Sociétés', field: 'Opportunités', type: 'link_row', reason: 'link_target' },
    { table: 'Sociétés', field: 'Montant des opportunités', type: 'rollup', reason: 'reference' },
    { table: 'Sociétés', field: "Nombre d'opportunités", type: 'count', reason: 'reference' },
    { table: 'Sociétés', field: 'Résumé', type: 'formula', reason: 'reference' }
  ]);
  const companies = base.schema.tables[0];
  assert.deepEqual(companies.fields.map((f) => f.name), ['Secteur', 'Site web', 'Créé le', 'Modifié le']);
  assert.ok(companies.sampleRows.rows.every((row) => !('Contact principal' in row) && !('Opportunités' in row)), 'no link in the rows');
  assert.deepEqual(described.counts.tables, 1);
  assert.doesNotThrow(() => BaserowSchema.normalizeSchema(JSON.parse(JSON.stringify(base.schema))), 'still a schema the engine applies');
  const fieldsRead = baserow.calls.filter((c) => c.name === 'listFields').map((c) => c.args[0]);
  assert.equal(new Set(fieldsRead).size, 1, 'the fields of the table asked only');
  // the default is unchanged: the tables they link come with them
  assert.equal(BaserowSchema.describe(baserow.api, { tables: [{ path: path('Sociétés') }] }).counts.tables, 3);
});
