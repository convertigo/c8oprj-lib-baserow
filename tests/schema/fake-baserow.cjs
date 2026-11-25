// An in-memory Baserow for the tests of js/baserow_schema.js: the api object the engine calls (BaserowSchema.engineApi
// in Convertigo), with the calls it received and the failures it is told to simulate.
function fakeBaserow(options) {
  const opts = options || {};
  let next = 1000;
  const id = () => ++next;
  const db = {
    workspaces: (opts.workspaces || [{ id: 836, name: 'Convertigo NoCode Databases - user@example.com' }]).map((w) => ({ ...w })),
    applications: [],
    trash: [],
    tables: [],
    fields: [],
    views: [],
    filters: [],
    sorts: [],
    rows: [],
    groups: [],
    groupBys: [],
    decorations: [],
    fieldOptions: {},
    // the user files: name -> {name, visible_name, size, mime_type, is_image, bytes}
    files: [],
    jobs: opts.jobs || {},
  };
  const calls = [];
  const failures = [];

  // fail(name, error, {after}) makes the next call of name throw error (after `after` successful calls)
  function fail(name, error, at) {
    failures.push({ name, error, after: (at && at.after) || 0, done: false });
  }

  function baserowError(code, detail) {
    const error = new Error(`${code}: ${detail || ''}`);
    error.code = 'baserow_error';
    error.baserowError = code;
    error.retryable = false;
    return error;
  }

  function call(name, fn) {
    return (...args) => {
      calls.push({ name, args: JSON.parse(JSON.stringify(args)) });
      const failure = failures.find((f) => f.name === name && !f.done);
      if (failure) {
        if (failure.after > 0) {
          failure.after--;
        } else {
          failure.done = true;
          // a write that Baserow did although the answer was lost
          if (failure.error.applied) fn(...args);
          throw failure.error;
        }
      }
      return fn(...args);
    };
  }

  // a paid feature the account does not have (opts.paid: decorations, a view type, survey, formConditions,
  // fieldOptions): Baserow answers 402 ERROR_FEATURE_NOT_AVAILABLE
  const paid = (feature) => {
    if ((opts.paid || []).includes(feature)) throw baserowError('ERROR_FEATURE_NOT_AVAILABLE', 'The related user does not have access to these features.');
  };
  const table = (tableId) => {
    const found = db.tables.find((t) => t.id === tableId);
    if (!found) throw baserowError('ERROR_TABLE_DOES_NOT_EXIST', `table ${tableId}`);
    return found;
  };
  const fieldsOf = (tableId) => db.fields.filter((f) => f.table_id === tableId);
  const copy = (value) => JSON.parse(JSON.stringify(value));
  // a file cell as Baserow answers it: the url, size and type of each user file, the name shown of the cell
  const withFiles = (row) => {
    for (const [key, value] of Object.entries(row)) {
      if (!Array.isArray(value)) continue;
      row[key] = value.map((cell) => {
        const file = cell && typeof cell === 'object' && cell.name ? db.files.find((f) => f.name === cell.name) : null;
        return file ? { url: `https://media.example.com/user_files/${file.name}`, thumbnails: {}, name: file.name, size: file.size,
          mime_type: file.mime_type, is_image: file.is_image, visible_name: cell.visible_name || file.visible_name } : cell;
      });
    }
    return row;
  };
  // a user file as Baserow gives it in a view (a form image: UserFileSerializer, its name of upload as original_name, no
  // visible_name), or null
  const fileValue = (value) => {
    const file = value && db.files.find((f) => f.name === value.name);
    return file ? { url: `https://media.example.com/user_files/${file.name}`, thumbnails: {}, name: file.name, size: file.size,
      mime_type: file.mime_type, is_image: file.is_image, image_width: null, image_height: null, uploaded_at: '2026-11-24T00:00:00Z',
      original_name: file.visible_name } : null;
  };
  // a view and what it holds
  const dropView = (viewId) => {
    db.decorations = db.decorations.filter((d) => d.view !== viewId);
    db.views = db.views.filter((v) => v.id !== viewId);
    db.filters = db.filters.filter((f) => f.view !== viewId);
    db.sorts = db.sorts.filter((f) => f.view !== viewId);
    db.groupBys = db.groupBys.filter((f) => f.view !== viewId);
    db.groups = db.groups.filter((f) => f.view !== viewId);
    delete db.fieldOptions[viewId];
  };
  // Baserow types a file by its name
  const mimeOf = (name) => ({ png: 'image/png', jpg: 'image/jpeg', pdf: 'application/pdf' })[(/\.([a-z0-9]+)$/i.exec(name) || [])[1]] || 'application/octet-stream';
  // a user file already in Baserow (bytes: a Buffer)
  const addFile = (visibleName, bytes, mime = 'application/pdf') => {
    const file = { name: `seed${id()}_${visibleName.replace(/[^A-Za-z0-9.]/g, '')}`, visible_name: visibleName, size: bytes.length, mime_type: mime, is_image: /\.(png|jpe?g|gif)$/i.test(visibleName), bytes };
    db.files.push(file);
    return { name: file.name, visible_name: visibleName };
  };

  function addField(tableId, body) {
    if (fieldsOf(tableId).some((f) => f.name.toLowerCase() === body.name.toLowerCase())) {
      throw baserowError('ERROR_FIELD_WITH_SAME_NAME_ALREADY_EXISTS', body.name);
    }
    const field = { ...copy(body), id: id(), table_id: tableId, primary: false };
    if (field.select_options) field.select_options = field.select_options.map((o) => ({ id: id(), value: o.value, color: o.color }));
    if (field.type === 'link_row') {
      table(field.link_row_table_id);
      if (field.has_related_field !== false && field.link_row_table_id !== tableId) {
        const source = table(tableId);
        let name = source.name;
        while (fieldsOf(field.link_row_table_id).some((f) => f.name === name)) name += ' - related';
        const related = { id: id(), table_id: field.link_row_table_id, name, type: 'link_row', primary: false,
          link_row_table_id: tableId, link_row_related_field_id: field.id };
        db.fields.push(related);
        field.link_row_related_field_id = related.id;
      }
    }
    for (const key of ['through_field_id', 'target_field_id']) {
      if (field[key] != null && !db.fields.some((f) => f.id === field[key])) throw baserowError('ERROR_FIELD_DOES_NOT_EXIST', key);
    }
    db.fields.push(field);
    return copy(field);
  }

  const api = {
    online: true,
    listWorkspaces: call('listWorkspaces', () => copy(db.workspaces)),
    createWorkspace: call('createWorkspace', (name) => {
      const workspace = { id: id(), name };
      db.workspaces.push(workspace);
      return copy(workspace);
    }),
    getApplication: call('getApplication', (applicationId) => {
      const application = db.applications.find((a) => a.id === applicationId);
      if (!application || !db.workspaces.some((w) => w.id === application.workspace.id)) {
        throw baserowError('ERROR_APPLICATION_DOES_NOT_EXIST', `application ${applicationId}`);
      }
      return copy(application);
    }),
    createDatabase: call('createDatabase', (workspaceId, name) => {
      const workspace = db.workspaces.find((w) => w.id === workspaceId);
      if (!workspace) throw baserowError('ERROR_USER_NOT_IN_GROUP');
      const application = { id: id(), name, type: 'database', workspace: { id: workspace.id, name: workspace.name } };
      db.applications.push(application);
      return copy(application);
    }),
    deleteApplication: call('deleteApplication', (applicationId) => {
      const at = db.applications.findIndex((a) => a.id === applicationId);
      if (at < 0) throw baserowError('ERROR_APPLICATION_DOES_NOT_EXIST');
      db.trash.push(db.applications.splice(at, 1)[0]);
    }),
    emptyTrash: call('emptyTrash', (workspaceId, applicationId) => {
      db.trash = db.trash.filter((a) => !(a.workspace.id === workspaceId && a.id === applicationId));
    }),
    // GET /api/applications/: the bases of the account with their tables
    listApplications: call('listApplications', () => copy(db.applications.map((a) => ({
      ...a, tables: db.tables.filter((t) => t.database_id === a.id).map((t) => ({ id: t.id, name: t.name, database_id: a.id })),
    })))),
    listTables: call('listTables', (databaseId) => copy(db.tables.filter((t) => t.database_id === databaseId))),
    createTable: call('createTable', (databaseId, body) => {
      if (!db.applications.some((a) => a.id === databaseId)) throw baserowError('ERROR_APPLICATION_DOES_NOT_EXIST');
      const created = { id: id(), name: body.name, database_id: databaseId };
      db.tables.push(created);
      db.fields.push({ id: id(), table_id: created.id, name: body.data[0][0], type: 'text', primary: true });
      // like Baserow, a table made from data gets a grid view "Grid" (opts.defaultView)
      if (opts.defaultView) db.views.push({ id: id(), table_id: created.id, name: 'Grid', type: 'grid', order: 1, filter_type: 'AND', filters_disabled: false, public: false, ownership_type: 'collaborative' });
      return copy(created);
    }),
    deleteTable: call('deleteTable', (tableId) => {
      table(tableId);
      db.tables = db.tables.filter((t) => t.id !== tableId);
      const gone = db.fields.filter((f) => f.table_id === tableId).map((f) => f.id);
      // the links of other tables to it go with it
      db.fields = db.fields.filter((f) => f.table_id !== tableId && !(f.type === 'link_row' && f.link_row_table_id === tableId) && !gone.includes(f.link_row_related_field_id));
      for (const view of db.views.filter((v) => v.table_id === tableId)) dropView(view.id);
      db.rows = db.rows.filter((r) => r.table_id !== tableId);
    }),
    listFields: call('listFields', (tableId) => copy(fieldsOf(table(tableId).id))),
    createField: call('createField', (tableId, body) => addField(table(tableId).id, body)),
    updateField: call('updateField', (fieldId, body) => {
      const field = db.fields.find((f) => f.id === fieldId);
      if (!field) throw baserowError('ERROR_FIELD_DOES_NOT_EXIST');
      Object.assign(field, copy(body));
      if (body.select_options) field.select_options = body.select_options.map((o) => ({ id: o.id || id(), value: o.value, color: o.color }));
      return copy(field);
    }),
    listViews: call('listViews', (tableId) => copy(db.views.filter((v) => v.table_id === tableId).map((v) => ({
      ...v, filters: db.filters.filter((f) => f.view === v.id), sortings: db.sorts.filter((s) => s.view === v.id),
      // an older Baserow (opts.noFilterGroups) lists neither the groups of filters nor the group bys of a view
      ...(opts.noFilterGroups ? {} : { group_bys: db.groupBys.filter((g) => g.view === v.id) }),
      ...(opts.noFilterGroups ? {} : { filter_groups: db.groups.filter((g) => g.view === v.id).map(({ view, ...g }) => g) }),
      decorations: db.decorations.filter((d) => d.view === v.id),
      // a form gives its images as user files
      ...(v.type === 'form' ? { cover_image: fileValue(v.cover_image), logo_image: fileValue(v.logo_image) } : {}),
    })))),
    createView: call('createView', (tableId, body) => {
      table(tableId);
      for (const key of ['cover_image', 'logo_image']) {
        if (body[key] != null && !(body[key] && typeof body[key].name === 'string' && db.files.some((f) => f.name === body[key].name))) throw baserowError('ERROR_INVALID_USER_FILE_NAME_ERROR', key);
      }
      paid(body.type);
      if (body.mode === 'survey') paid('survey');
      if (body.type === 'timeline' && body.timescale != null && !['day', 'week', 'month', 'year'].includes(body.timescale)) throw baserowError('ERROR_REQUEST_BODY_VALIDATION', 'timescale');
      const view = { ownership_type: 'collaborative', ...copy(body), id: id(), table_id: tableId, order: db.views.filter((v) => v.table_id === tableId).length + 1 };
      db.views.push(view);
      return copy(view);
    }),
    deleteView: call('deleteView', (viewId) => {
      if (!db.views.some((v) => v.id === viewId)) throw baserowError('ERROR_VIEW_DOES_NOT_EXIST');
      dropView(viewId);
    }),
    // the options of each field of a view (Baserow answers every field of the table)
    listFieldOptions: call('listFieldOptions', (viewId) => {
      const view = db.views.find((v) => v.id === viewId);
      if (!view) throw baserowError('ERROR_VIEW_DOES_NOT_EXIST');
      const set = db.fieldOptions[viewId] || {};
      const out = {};
      for (const f of fieldsOf(view.table_id)) {
        // (like Baserow: a label of a form not set is "")
        out[f.id] = view.type === 'form' ? { enabled: false, required: true, order: 32767, name: '', description: '', show_when_matching_conditions: false,
          condition_type: 'AND', field_component: 'default', include_all_select_options: true, allowed_select_options: [], conditions: [], condition_groups: [], ...set[f.id] }
          : { hidden: false, order: 32767, ...(view.type === 'grid' ? { width: 200, aggregation_raw_type: '' } : {}), ...set[f.id] };
      }
      return { field_options: out };
    }),
    updateFieldOptions: call('updateFieldOptions', (viewId, body) => {
      const view = db.views.find((v) => v.id === viewId);
      if (!view) throw baserowError('ERROR_VIEW_DOES_NOT_EXIST');
      paid('fieldOptions');
      if (Object.values(body.field_options).some((o) => o.conditions !== undefined || o.condition_groups !== undefined)) paid('formConditions');
      const set = db.fieldOptions[viewId] = db.fieldOptions[viewId] || {};
      for (const [fieldId, value] of Object.entries(body.field_options)) {
        if (!db.fields.some((f) => f.id === Number(fieldId))) throw baserowError('ERROR_FIELD_DOES_NOT_EXIST');
        const { conditions, condition_groups: groups, ...plain } = copy(value);
        set[fieldId] = { ...set[fieldId], ...plain };
        // the conditions of a field of a form, as Baserow keeps them: an id it has is updated, any other is new; a new
        // group under a group it has only; what the write does not name is deleted
        if (conditions !== undefined || groups !== undefined) {
          if (view.type !== 'form') throw baserowError('ERROR_REQUEST_BODY_VALIDATION', 'conditions');
          const had = { groups: set[fieldId].condition_groups || [], conditions: set[fieldId].conditions || [] };
          const groupIds = {};
          const keptGroups = (groups || []).map((g) => {
            const old = had.groups.find((h) => h.id === g.id);
            if (old) {
              groupIds[g.id] = old.id;
              return { ...old, filter_type: g.filter_type };
            }
            if (g.parent_group != null && !had.groups.some((h) => h.id === g.parent_group)) throw baserowError('ERROR_VIEW_FILTER_GROUP_DOES_NOT_EXIST', 'Invalid parent filter group id.');
            const made = { id: id(), filter_type: g.filter_type, parent_group: g.parent_group == null ? null : g.parent_group };
            groupIds[g.id] = made.id;
            return made;
          });
          const keptConditions = (conditions || []).map((c) => {
            if (!fieldsOf(view.table_id).some((f) => f.id === c.field)) throw baserowError('ERROR_FIELD_NOT_IN_TABLE');
            if (c.group != null && groupIds[c.group] == null) throw baserowError('ERROR_VIEW_FILTER_GROUP_DOES_NOT_EXIST', 'Invalid filter group id.');
            const group = c.group == null ? null : groupIds[c.group];
            const old = had.conditions.find((h) => h.id === c.id);
            return old ? { ...old, field: c.field, type: c.type, value: c.value } : { id: id(), field: c.field, type: c.type, value: c.value, group };
          });
          set[fieldId].condition_groups = keptGroups;
          set[fieldId].conditions = keptConditions;
        }
      }
      return { field_options: copy(set) };
    }),
    createFilterGroup: call('createFilterGroup', (viewId, body) => {
      if (!db.views.some((v) => v.id === viewId)) throw baserowError('ERROR_VIEW_DOES_NOT_EXIST');
      const group = { id: id(), view: viewId, filter_type: body.filter_type, parent_group: body.parent_group == null ? null : body.parent_group };
      db.groups.push(group);
      const { view, ...out } = group;
      return copy(out);
    }),
    getFilterGroup: call('getFilterGroup', (groupId) => {
      const group = db.groups.find((g) => g.id === groupId);
      if (!group) throw baserowError('ERROR_VIEW_FILTER_GROUP_DOES_NOT_EXIST');
      return copy(group);
    }),
    deleteViewFilter: call('deleteViewFilter', (filterId) => {
      if (!db.filters.some((f) => f.id === filterId)) throw baserowError('ERROR_VIEW_FILTER_DOES_NOT_EXIST');
      db.filters = db.filters.filter((f) => f.id !== filterId);
    }),
    deleteViewSort: call('deleteViewSort', (sortId) => {
      if (!db.sorts.some((f) => f.id === sortId)) throw baserowError('ERROR_VIEW_SORT_DOES_NOT_EXIST');
      db.sorts = db.sorts.filter((f) => f.id !== sortId);
    }),
    listViewDecorations: call('listViewDecorations', (viewId) => copy(db.decorations.filter((d) => d.view === viewId))),
    createViewDecoration: call('createViewDecoration', (viewId, body) => {
      paid('decorations');
      if (!db.views.some((v) => v.id === viewId)) throw baserowError('ERROR_VIEW_DOES_NOT_EXIST');
      if (!['left_border_color', 'background_color'].includes(body.type) || !['single_select_color', 'conditional_color'].includes(body.value_provider_type)) {
        throw baserowError('ERROR_REQUEST_BODY_VALIDATION', 'decoration');
      }
      const decoration = { ...copy(body), id: id(), view: viewId, order: db.decorations.filter((d) => d.view === viewId).length + 1 };
      db.decorations.push(decoration);
      return copy(decoration);
    }),
    deleteViewDecoration: call('deleteViewDecoration', (decorationId) => {
      if (!db.decorations.some((d) => d.id === decorationId)) throw baserowError('ERROR_VIEW_DECORATION_DOES_NOT_EXIST');
      db.decorations = db.decorations.filter((d) => d.id !== decorationId);
    }),
    listViewGroupBys: call('listViewGroupBys', (viewId) => copy(db.groupBys.filter((g) => g.view === viewId))),
    createViewGroupBy: call('createViewGroupBy', (viewId, body) => {
      const groupBy = { ...copy(body), id: id(), view: viewId };
      db.groupBys.push(groupBy);
      return copy(groupBy);
    }),
    deleteViewGroupBy: call('deleteViewGroupBy', (groupById) => {
      if (!db.groupBys.some((f) => f.id === groupById)) throw baserowError('ERROR_VIEW_GROUP_BY_DOES_NOT_EXIST');
      db.groupBys = db.groupBys.filter((f) => f.id !== groupById);
    }),
    listViewFilters: call('listViewFilters', (viewId) => copy(db.filters.filter((f) => f.view === viewId))),
    createViewFilter: call('createViewFilter', (viewId, body) => {
      const filter = { ...copy(body), id: id(), view: viewId };
      db.filters.push(filter);
      return copy(filter);
    }),
    listViewSorts: call('listViewSorts', (viewId) => copy(db.sorts.filter((s) => s.view === viewId))),
    createViewSort: call('createViewSort', (viewId, body) => {
      const sort = { ...copy(body), id: id(), view: viewId };
      db.sorts.push(sort);
      return copy(sort);
    }),
    listRows: call('listRows', (tableId, page, size) => {
      const rows = db.rows.filter((r) => r.table_id === tableId);
      const results = rows.slice((page - 1) * size, page * size).map(({ table_id, ...row }) => withFiles(copy(row)));
      return { count: rows.length, next: page * size < rows.length ? page + 1 : null, results };
    }),
    deleteRows: call('deleteRows', (tableId, ids) => {
      table(tableId);
      const missing = ids.filter((rowId) => !db.rows.some((r) => r.table_id === tableId && r.id === rowId));
      if (missing.length) throw baserowError('ERROR_ROW_DOES_NOT_EXIST', `The rows [${missing.join(', ')}] do not exist.`);
      db.rows = db.rows.filter((r) => !(r.table_id === tableId && ids.includes(r.id)));
    }),
    deleteField: call('deleteField', (fieldId) => {
      const field = db.fields.find((f) => f.id === fieldId);
      if (!field) throw baserowError('ERROR_FIELD_DOES_NOT_EXIST');
      db.fields = db.fields.filter((f) => f.id !== fieldId && !(field.link_row_related_field_id && f.id === field.link_row_related_field_id));
    }),
    // a file of a row by its URL: its bytes written to target (a file of the test), at most maxBytes
    downloadFile: call('downloadFile', (url, target, maxBytes) => {
      const file = db.files.find((f) => url === `https://media.example.com/user_files/${f.name}`);
      if (!file) throw baserowError('ERROR_FILE_DOES_NOT_EXIST');
      if (file.bytes.length > maxBytes) {
        const error = new Error('too large');
        error.code = 'file_too_large';
        error.bytes = file.bytes.length;
        throw error;
      }
      if (opts.writeFile) opts.writeFile(target, file.bytes);
      return { size: file.bytes.length };
    }),
    // the filters of a migration write: an AND of higher_than / lower_than on number fields
    findRows: call('findRows', (tableId, query) => {
      table(tableId);
      const tree = JSON.parse(query.filters);
      const match = (row) => tree.filters.every((f) => {
        const value = Number(row[`field_${f.field}`]);
        if (row[`field_${f.field}`] == null || Number.isNaN(value)) return false;
        return f.type === 'higher_than' ? value > Number(f.value) : f.type === 'lower_than' ? value < Number(f.value) : false;
      });
      const rows = db.rows.filter((r) => r.table_id === tableId && match(r));
      const keep = query.include.split(',');
      const results = rows.slice((query.page - 1) * query.size, query.page * query.size)
        .map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => k === 'id' || keep.includes(k))));
      return { count: rows.length, next: query.page * query.size < rows.length ? query.page + 1 : null, results: copy(results) };
    }),
    createRows: call('createRows', (tableId, items) => {
      table(tableId);
      return items.map((item) => {
        const row = { ...copy(item), id: id(), table_id: tableId };
        db.rows.push(row);
        const { table_id, ...out } = row;
        return out;
      });
    }),
    updateRows: call('updateRows', (tableId, items) => items.map((item) => {
      const row = db.rows.find((r) => r.table_id === tableId && r.id === item.id);
      if (!row) throw baserowError('ERROR_ROW_DOES_NOT_EXIST');
      Object.assign(row, copy(item));
      return copy(row);
    })),
    // a file of the server uploaded to the user files: Baserow names it, its visible name is the name of the file
    // (opts.readFile gives its bytes, else 42 bytes)
    uploadFile: call('uploadFile', (path) => {
      const visible = path.split('/').pop();
      const bytes = opts.readFile ? opts.readFile(path) : Buffer.alloc(42);
      const file = { name: `u${id()}_${visible.replace(/[^A-Za-z0-9.]/g, '')}`, visible_name: visible, size: bytes.length, is_image: /\.(png|jpe?g|gif)$/i.test(visible), mime_type: mimeOf(visible), bytes };
      db.files.push(file);
      const { bytes: b, ...out } = file;
      return copy(out);
    }),
    getJob: call('getJob', (jobId) => {
      const job = db.jobs[jobId];
      if (typeof job === 'function') return job();
      if (!job) throw baserowError('ERROR_JOB_DOES_NOT_EXIST');
      return copy(job);
    }),
  };
  return { api, db, calls, fail, baserowError, addFile };
}

module.exports = { fakeBaserow };
