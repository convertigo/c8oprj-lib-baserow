/*
 * Schema engine of the no-code database: creates a Baserow base, its tables, fields, views and sample rows from a
 * declarative schema, with the Baserow account of the user (formscommon_SchemaApply, DatabaseCreate, TableCreate,
 * DatabaseDeleteDefinitive, JobWait).
 *
 * Taken from the nocode-baserow-schema-apply tool of lib_ConvertigoMCP (js/nocode_baserow.js) so that C8Oforms can call
 * it without lib_ConvertigoMCP. Differences with that tool:
 * - a base is never reused by name: without baseId a new base is created;
 * - the workspace must be one of the workspaces of the user (GET /api/workspaces/ with the user's token);
 * - the work is cut in bounded steps: step() takes the state {baseId, tables, fields, options, rowIds...}, does a few
 *   Baserow calls and returns it enriched; each unit of work is idempotent (what exists is read again, by name, in
 *   this base only);
 * - the answer maps the stable keys of the schema to Baserow ids (tables, fields, select options, views).
 *
 * The schema format is the one of the tool (names) plus stable keys (docs/design/template-baserow.md § 2 of C8Oforms):
 * tables, fields and select options have a key, references (targetTable, through, targetField, view fields, sample row
 * columns, formulas field('<key>')) name keys, and a missing key is the name.
 *
 * Plain ECMAScript 5: run by Rhino in the engine and by node in tests/schema. The Baserow calls go through an api object
 * (BaserowSchema.engineApi in the engine, a fake in the tests); its token never leaves it.
 */

var BaserowSchema = (function () {
	var FORMAT = "c8oforms.baserow-template";
	var FIELD_TYPES = ["text", "long_text", "number", "boolean", "date", "email", "phone_number", "url", "file",
		"single_select", "multiple_select", "link_row", "lookup", "rollup", "count", "formula", "rating", "duration",
		"uuid", "autonumber", "created_on", "last_modified", "created_by", "last_modified_by"];
	// written by Baserow, never by a sample row
	var READ_ONLY_TYPES = ["lookup", "rollup", "count", "formula", "uuid", "autonumber", "created_on", "last_modified",
		"created_by", "last_modified_by"];
	var COMPUTED_TYPES = ["lookup", "rollup", "count", "formula"];
	var UPSERT_TYPES = ["text", "long_text", "number", "email", "url", "phone_number"];
	// fields Baserow can hold as primary field
	var PRIMARY_TYPES = ["text", "long_text", "number", "boolean", "date", "email", "phone_number", "url", "rating",
		"duration", "uuid", "autonumber", "created_on", "last_modified", "formula", "single_select"];
	var VIEW_TYPES = ["grid", "gallery", "form", "kanban", "calendar", "timeline"];
	var TIMESCALES = ["day", "week", "month", "year"];
	// the colors of the rows of a view: a left border or a background, by the color of a select option or by conditions
	var DECORATION_TYPES = ["left_border_color", "background_color"];
	var DECORATION_PROVIDERS = ["single_select_color", "conditional_color"];
	var COLOR = /^[A-Za-z0-9#_-]{1,32}$/;
	// the texts of a form view a schema carries (its images are files of the schema)
	// the component of a field of a form (default, radio...)
	var FIELD_COMPONENT = /^[A-Za-z0-9_-]{1,32}$/;
	var FORM_TEXTS = { title: "title", description: "description", submitText: "submit_text", submitActionMessage: "submit_action_message" };
	var ROLLUP_FUNCTIONS = ["sum", "min", "max", "avg", "count", "countall", "any", "every", "join", "stddev_pop",
		"stddev_sample", "variance_pop", "variance_sample", "median", "mode"];
	var ALIASES = {
		link: "link_row", relation: "link_row", relationship: "link_row", lookup_field: "lookup", reported: "lookup",
		rapport: "lookup", single: "single_select", select: "single_select", multiselect: "multiple_select",
		multi_select: "multiple_select", multiple: "multiple_select", checkbox: "boolean", bool: "boolean",
		integer: "number", decimal: "number", text_long: "long_text", datetime: "date", auto_number: "autonumber"
	};
	var COLORS = ["light-blue", "light-green", "light-orange", "light-red", "light-purple", "light-pink", "light-gray"];
	// the attributes of a field the engine sets, that baserowOptions never sets
	var RESERVED_FIELD_KEYS = ["id", "name", "type", "primary", "table_id", "order", "read_only", "description", "select_options",
		"link_row_table_id", "link_row_table", "link_row_related_field", "link_row_related_field_id", "has_related_field",
		"link_row_multiple_relationships", "through_field_id", "target_field_id", "rollup_function", "formula"];
	var ROWS_PER_BATCH = 100;
	var ROWS_PAGE = 200;
	var PHASES = ["base", "tables", "fields", "links", "computed", "files", "views", "rows", "rowlinks", "done"];
	// The files a schema carries (C8Oforms #1836): at most 10 MB each and 30 MB in all, by describe as by apply.
	var FILE_MAX_BYTES = 10485760;
	var FILES_MAX_BYTES = 31457280;
	var FILE_KEY = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
	// The name Baserow gives an uploaded file (letters, digits, _ . -), the value of a file cell.
	var FILE_NAME = /^[A-Za-z0-9_.-]{1,255}$/;
	// The filters whose value names rows of the linked table (the ids of rows), and those that name users.
	var ROW_FILTERS = ["link_row_has", "link_row_has_not"];
	var USER_FILTERS = ["user_is", "user_is_not", "multiple_collaborators_has", "multiple_collaborators_has_not"];
	// The field options of a view a schema carries, by view type: hidden columns and their order (enabled and required
	// for a form, with its labels), the width of the columns of a grid.
	var FIELD_OPTION_KEYS = {
		grid: { hidden: "boolean", order: "number", width: "number" },
		gallery: { hidden: "boolean", order: "number" },
		kanban: { hidden: "boolean", order: "number" },
		calendar: { hidden: "boolean", order: "number" },
		timeline: { hidden: "boolean", order: "number" },
		form: { enabled: "boolean", required: "boolean", order: "number", name: "string", description: "string" }
	};

	function SchemaError(code, message, extra) {
		var error = new Error(message);
		error.code = code;
		error.retryable = false;
		if (extra) {
			for (var key in extra) {
				error[key] = extra[key];
			}
		}
		return error;
	}

	function text(value) {
		return value == null ? "" : ("" + value).replace(/^\s+|\s+$/g, "");
	}

	function lower(value) {
		return text(value).toLowerCase();
	}

	function list(value) {
		if (value == null) {
			return [];
		}
		return Array.isArray(value) ? value : [value];
	}

	function contains(array, value) {
		return array.indexOf(value) !== -1;
	}

	function numberOrNull(value) {
		if (value == null || value === "") {
			return null;
		}
		var parsed = Number(value);
		return isNaN(parsed) ? null : parsed;
	}

	function bool(value, fallback) {
		if (value == null || value === "") {
			return fallback;
		}
		if (value === true || value === false) {
			return value;
		}
		var t = lower(value);
		return t === "true" || t === "1" || t === "yes";
	}

	function parseJson(value, label, fallback) {
		if (value == null || value === "") {
			return fallback;
		}
		if (typeof value === "object" && !(value instanceof String) && !isJavaString(value)) {
			return value;
		}
		var t = text(value);
		if (!t.length || t === "null" || t === "undefined") {
			return fallback;
		}
		try {
			return JSON.parse(t);
		} catch (e) {
			throw SchemaError("invalid_json", label + " must be valid JSON: " + e.message);
		}
	}

	function isJavaString(value) {
		try {
			return value != null && typeof value.getClass === "function" && ("" + value.getClass().getName()) === "java.lang.String";
		} catch (e) {
			return false;
		}
	}

	function normalizeFieldType(type) {
		var value = lower(type);
		return ALIASES[value] || value;
	}

	function checkName(name, label) {
		if (!name.length) {
			throw SchemaError("schema_invalid", label + ": a name is required.");
		}
		if (name.length > 255) {
			throw SchemaError("schema_invalid", label + ": the name " + name.substring(0, 40) + "... is longer than 255 characters.");
		}
		if (name.indexOf("~>") !== -1) {
			throw SchemaError("schema_invalid", label + ": the name " + name + " holds ~>, the separator of the table paths.");
		}
	}

	function checkBaseName(name) {
		if (!name.length || name.length > 160 || name.indexOf("~>") !== -1) {
			throw SchemaError("base_name_invalid", "The base name must hold 1 to 160 characters, without ~>.");
		}
	}

	// ---- schema ----------------------------------------------------------------------------------------------------

	function normalizeOptions(values, label) {
		var out = [];
		var keys = {};
		var raw = list(values);
		for (var i = 0; i < raw.length; i++) {
			var item = raw[i];
			var option = item && typeof item === "object"
				? { key: text(item.key || item.value), value: text(item.value), color: text(item.color) || COLORS[i % COLORS.length] }
				: { key: text(item), value: text(item), color: COLORS[i % COLORS.length] };
			if (!option.value.length) {
				continue;
			}
			if (keys[option.key]) {
				throw SchemaError("schema_invalid", label + ": the option key " + option.key + " is used twice.");
			}
			keys[option.key] = true;
			out.push(option);
		}
		return out;
	}

	function normalizeField(field, label, primary) {
		var raw = field || {};
		var name = text(raw.name || raw.column);
		checkName(name, label);
		var type = normalizeFieldType(raw.type || "text");
		if (type === "password") {
			throw SchemaError("schema_invalid", label + ": password fields are refused.");
		}
		if (!contains(FIELD_TYPES, type)) {
			throw SchemaError("schema_invalid", label + ": unknown field type " + type + ".");
		}
		var spec = {
			key: text(raw.key) || name,
			name: name,
			type: type,
			primary: primary === true,
			description: text(raw.description || raw.notes || raw.comment),
			values: type === "single_select" || type === "multiple_select" ? normalizeOptions(raw.values || raw.options, label) : [],
			targetTable: text(raw.targetTable || raw.linkRowTable || raw.relation || raw.target || raw.table),
			through: text(raw.through || raw.throughField || raw.linkField),
			targetField: text(raw.targetField || raw.lookupField || raw.field),
			rollupFunction: lower(raw.rollupFunction || raw.rollup_function || "sum"),
			multiple: raw.multiple,
			createRelatedField: raw.createRelatedField,
			relatedFieldKey: text(raw.relatedFieldKey),
			relatedFieldName: text(raw.relatedFieldName || raw.linkRowRelatedFieldName),
			formula: text(raw.formula),
			baserowOptions: raw.baserowOptions && typeof raw.baserowOptions === "object" ? raw.baserowOptions : {}
		};
		if (spec.primary && !contains(PRIMARY_TYPES, type)) {
			throw SchemaError("schema_invalid", label + ": a " + type + " field cannot be the primary field.");
		}
		if (type === "link_row" && !spec.targetTable.length) {
			throw SchemaError("schema_invalid", label + ": a link_row field needs targetTable.");
		}
		if ((type === "lookup" || type === "rollup" || type === "count") && !spec.through.length) {
			throw SchemaError("schema_invalid", label + ": a " + type + " field needs through (a link_row field of the table).");
		}
		if ((type === "lookup" || type === "rollup") && !spec.targetField.length) {
			throw SchemaError("schema_invalid", label + ": a " + type + " field needs targetField.");
		}
		if (type === "rollup" && !contains(ROLLUP_FUNCTIONS, spec.rollupFunction)) {
			throw SchemaError("schema_invalid", label + ": unknown rollupFunction " + spec.rollupFunction + ".");
		}
		if (type === "formula" && !spec.formula.length) {
			throw SchemaError("schema_invalid", label + ": a formula field needs formula.");
		}
		return spec;
	}

	function normalizeTable(raw, index) {
		var table = raw || {};
		var label = "tables[" + index + "]";
		var name = text(table.name || table.table);
		checkName(name, label);
		var fields = list(table.fields || table.columns);
		var specs = [];
		for (var f = 0; f < fields.length; f++) {
			specs.push(normalizeField(fields[f], label + ".fields[" + f + "]", false));
		}
		// The primary field: an object {key, name, type}, or the name of one of the fields (the tool's format), else the
		// first text field, else a text field "Name".
		var primary = null;
		var rawPrimary = table.primaryField || table.primary || table.displayField;
		if (rawPrimary && typeof rawPrimary === "object") {
			primary = normalizeField(rawPrimary, label + ".primaryField", true);
		} else {
			var primaryName = lower(rawPrimary);
			var at = -1;
			for (var p = 0; p < specs.length && at === -1; p++) {
				if (primaryName.length ? lower(specs[p].name) === primaryName || specs[p].key === text(rawPrimary) : specs[p].type === "text") {
					at = p;
				}
			}
			if (at !== -1) {
				primary = specs.splice(at, 1)[0];
				primary.primary = true;
				if (!contains(PRIMARY_TYPES, primary.type)) {
					throw SchemaError("schema_invalid", label + ": a " + primary.type + " field cannot be the primary field.");
				}
			} else {
				var fallback = text(rawPrimary) || "Name";
				primary = normalizeField({ key: fallback, name: fallback, type: "text" }, label + ".primaryField", true);
			}
		}
		var sample = table.sampleRows;
		var rows;
		var upsertKey;
		if (sample && !Array.isArray(sample) && typeof sample === "object") {
			rows = list(sample.rows);
			upsertKey = text(sample.upsertKey || table.upsertKey || table.keyField);
		} else {
			rows = list(sample || table.rows || table.data).filter(function (row) {
				return row && typeof row === "object" && !Array.isArray(row);
			});
			upsertKey = text(table.upsertKey || table.keyField);
		}
		return {
			key: text(table.key) || name,
			name: name,
			primary: primary,
			fields: specs,
			views: list(table.views),
			rows: rows,
			upsertKey: upsertKey || primary.key
		};
	}

	function findTable(schema, ref) {
		var t = text(ref);
		for (var i = 0; i < schema.tables.length; i++) {
			if (schema.tables[i].key === t) {
				return schema.tables[i];
			}
		}
		for (var j = 0; j < schema.tables.length; j++) {
			if (lower(schema.tables[j].name) === lower(t)) {
				return schema.tables[j];
			}
		}
		return null;
	}

	function allFields(table) {
		return [table.primary].concat(table.fields, table.related || []);
	}

	function findField(table, ref) {
		var t = text(ref);
		var fields = allFields(table);
		for (var i = 0; i < fields.length; i++) {
			if (fields[i].key === t) {
				return fields[i];
			}
		}
		for (var j = 0; j < fields.length; j++) {
			if (lower(fields[j].name) === lower(t)) {
				return fields[j];
			}
		}
		return null;
	}

	function requireField(table, ref, label) {
		var field = findField(table, ref);
		if (!field) {
			throw SchemaError("schema_invalid", label + ": no field " + ref + " in table " + table.key + ".");
		}
		return field;
	}

	function findOption(field, ref) {
		var t = text(ref);
		for (var i = 0; i < field.values.length; i++) {
			if (field.values[i].key === t) {
				return field.values[i];
			}
		}
		for (var j = 0; j < field.values.length; j++) {
			if (field.values[j].value === t) {
				return field.values[j];
			}
		}
		return null;
	}

	// field('<key>') and lookup('<link key>', '<key in the linked table>') of a formula, with the names of the fields:
	// names(table, field) gives the name of a field (the name Baserow gave it once created).
	function translateFormula(schema, table, formula, names) {
		var nameOf = names || function (t, f) { return f.name; };
		var quote = function (name) {
			return "'" + name.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
		};
		var literal = "(?:'((?:\\\\.|[^'\\\\])*)'|\"((?:\\\\.|[^\"\\\\])*)\")";
		var unescape = function (single, double) {
			return (single != null ? single : double).replace(/\\(.)/g, "$1");
		};
		var out = formula.replace(new RegExp("\\blookup\\(\\s*" + literal + "\\s*,\\s*" + literal + "\\s*\\)", "g"),
			function (match, s1, d1, s2, d2) {
				var link = findField(table, unescape(s1, d1));
				if (!link || link.type !== "link_row") {
					throw SchemaError("schema_invalid", "formula of table " + table.key + ": lookup() needs a link_row field, not " + unescape(s1, d1) + ".");
				}
				var target = findTable(schema, link.targetTable);
				var field = requireField(target, unescape(s2, d2), "formula of table " + table.key);
				return "lookup(" + quote(nameOf(table, link)) + ", " + quote(nameOf(target, field)) + ")";
			});
		return out.replace(new RegExp("\\bfield\\(\\s*" + literal + "\\s*\\)", "g"), function (match, s, d) {
			var field = requireField(table, unescape(s, d), "formula of table " + table.key);
			return "field(" + quote(nameOf(table, field)) + ")";
		});
	}

	// The fields a formula names, in its own table.
	function formulaReferences(table, formula) {
		var refs = [];
		var re = /\bfield\(\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)")\s*\)/g;
		var m;
		while ((m = re.exec(formula)) !== null) {
			var field = findField(table, (m[1] != null ? m[1] : m[2]).replace(/\\(.)/g, "$1"));
			if (field) {
				refs.push(field);
			}
		}
		return refs;
	}

	function normalizeSchema(rawSchema) {
		var raw = parseJson(rawSchema, "schema", {}) || {};
		if (raw.format != null && text(raw.format) !== FORMAT) {
			throw SchemaError("schema_format_unknown", "Unknown schema format " + text(raw.format) + ".");
		}
		if (raw.formatVersion != null && numberOrNull(raw.formatVersion) !== 1) {
			throw SchemaError("schema_format_unknown", "Unknown schema formatVersion " + text(raw.formatVersion) + ".");
		}
		var base = raw.base && typeof raw.base === "object" ? raw.base : {};
		var tables = list(raw.tables || raw.entities || raw.collections);
		if (!tables.length) {
			throw SchemaError("schema_invalid", "The schema has no table.");
		}
		var schema = {
			key: text(raw.key),
			version: text(raw.version),
			lang: text(raw.lang),
			workspaceId: numberOrNull(raw.workspaceId),
			workspaceName: text(raw.workspaceName || raw.workspace),
			baseId: numberOrNull(raw.baseId || raw.databaseId),
			baseName: text(raw.baseName || raw.databaseName || base.defaultName || base.name || (typeof raw.base === "string" ? raw.base : "") || raw.database),
			limits: raw.limits && typeof raw.limits === "object" ? raw.limits : {},
			tables: [],
			files: normalizeFiles(raw.files),
			fileByKey: {}
		};
		schema.files.forEach(function (file) {
			schema.fileByKey["k:" + file.key] = file;
		});
		var tableKeys = {};
		var tableNames = {};
		for (var i = 0; i < tables.length; i++) {
			var table = normalizeTable(tables[i], i);
			if (tableKeys[table.key] || tableNames[lower(table.name)]) {
				throw SchemaError("schema_invalid", "The table " + table.key + " is declared twice.");
			}
			tableKeys[table.key] = tableNames[lower(table.name)] = true;
			table.related = [];
			schema.tables.push(table);
		}
		// link_row: target tables, then the related fields Baserow creates in them (relatedFieldKey names them)
		schema.tables.forEach(function (table) {
			table.fields.forEach(function (field) {
				if (field.type !== "link_row") {
					return;
				}
				var target = findTable(schema, field.targetTable);
				if (!target) {
					throw SchemaError("schema_invalid", "Field " + table.key + "." + field.key + " links to an unknown table " + field.targetTable + ".");
				}
				field.targetTable = target.key;
				if (field.relatedFieldKey.length || field.relatedFieldName.length) {
					if (target === table) {
						throw SchemaError("schema_invalid", "Field " + table.key + "." + field.key + " links its own table: no related field.");
					}
					if (field.createRelatedField != null && !bool(field.createRelatedField, true)) {
						throw SchemaError("schema_invalid", "Field " + table.key + "." + field.key + " names a related field but createRelatedField is false.");
					}
					var relatedName = field.relatedFieldName || table.name;
					target.related.push({
						key: field.relatedFieldKey || relatedName, name: relatedName, type: "link_row", targetTable: table.key,
						related: true, from: table.key + "." + field.key, values: [], primary: false,
						namedBySchema: field.relatedFieldName.length > 0
					});
				}
			});
		});
		schema.tables.forEach(function (table) {
			var keys = {};
			var names = {};
			allFields(table).forEach(function (field) {
				if (keys[field.key] || names[lower(field.name)]) {
					throw SchemaError("schema_invalid", "The field " + table.key + "." + field.key + " is declared twice.");
				}
				keys[field.key] = names[lower(field.name)] = true;
			});
		});
		// references of the computed fields, formulas included
		schema.tables.forEach(function (table) {
			allFields(table).forEach(function (field) {
				var label = "Field " + table.key + "." + field.key;
				if (field.type === "lookup" || field.type === "rollup" || field.type === "count") {
					var link = requireField(table, field.through, label);
					if (link.type !== "link_row") {
						throw SchemaError("schema_invalid", label + ": through " + field.through + " is not a link_row field.");
					}
					field.through = link.key;
					if (field.type !== "count") {
						field.targetField = requireField(findTable(schema, link.targetTable), field.targetField, label).key;
					}
				}
				if (field.type === "formula") {
					translateFormula(schema, table, field.formula);
				}
			});
		});
		schema.tables.forEach(function (table) {
			normalizeViews(schema, table);
			normalizeRows(schema, table);
		});
		checkRowLinks(schema);
		return schema;
	}

	// The files a schema carries (describe with attachments): {key, visible_name, size, mime_type, is_image}, never the
	// name Baserow gave the file at its source (it opens its URL) nor its bytes, which the caller hands over apart
	// (options.files of step and apply).
	function normalizeFiles(raw) {
		var keys = {};
		return list(raw).map(function (item, i) {
			var label = "files[" + i + "]";
			var file = item && typeof item === "object" ? item : {};
			var key = text(file.key);
			if (!FILE_KEY.test(key)) {
				throw SchemaError("schema_invalid", label + ": a file needs a key of 1 to 64 letters, digits, _ . or - (a letter or a digit first).");
			}
			if (keys["k:" + key]) {
				throw SchemaError("schema_invalid", label + ": the file key " + key + " is used twice.");
			}
			keys["k:" + key] = true;
			if (file.name != null || file.url != null || file.path != null) {
				throw SchemaError("schema_invalid", label + ": a file of the schema holds no name, url nor path.");
			}
			var visibleName = text(file.visible_name || file.visibleName);
			if (!visibleName.length || visibleName.length > 255) {
				throw SchemaError("schema_invalid", label + ": a file needs a visible_name of 1 to 255 characters.");
			}
			var size = numberOrNull(file.size);
			return {
				key: key, visibleName: visibleName, size: size != null && size >= 0 ? size : null,
				mimeType: text(file.mime_type || file.mimeType).substring(0, 255), isImage: file.is_image === true || file.isImage === true
			};
		});
	}

	// The keys of the files a schema uses: the images of its form views, and the files of its rows when they are written.
	function schemaFiles(schema, withRows) {
		var keys = [];
		schema.tables.forEach(function (table) {
			table.views.forEach(function (view) {
				["coverImage", "logoImage"].forEach(function (key) {
					if (view.form && view.form[key] && keys.indexOf(view.form[key]) === -1) {
						keys.push(view.form[key]);
					}
				});
			});
		});
		if (withRows) {
			rowFiles(schema).forEach(function (key) {
				if (keys.indexOf(key) === -1) {
					keys.push(key);
				}
			});
		}
		return keys;
	}

	// The keys of the files the sample rows of a schema name, in the order of the tables and rows.
	function rowFiles(schema) {
		var keys = [];
		var seen = {};
		schema.tables.forEach(function (table) {
			table.rows.forEach(function (row) {
				Object.keys(row.values).forEach(function (column) {
					var field = findField(table, column);
					if (field && field.type === "file") {
						row.values[column].forEach(function (item) {
							if (!seen["k:" + item.file]) {
								seen["k:" + item.file] = true;
								keys.push(item.file);
							}
						});
					}
				});
			});
		});
		return keys;
	}

	// A filter of a view or of a color of a view: its field by key, select options by key (option, options), rows of the
	// linked table by key (rows), its group among groups ({"k:<key>": true}); never a value naming a user.
	function normalizeFilter(table, filter, flabel, groups) {
		var field = requireField(table, filter && filter.field, flabel);
		var out = { field: field.key, type: text(filter.type), value: filter.value == null ? "" : "" + filter.value, options: null, rows: null, group: null };
		if (!out.type.length) {
			throw SchemaError("schema_invalid", flabel + ": a filter needs a type.");
		}
		if (contains(USER_FILTERS, out.type)) {
			throw SchemaError("schema_invalid", flabel + ": a filter on a user takes no value of a schema.");
		}
		// select options by key (option: one, options: several), rows of the linked table by key
		if (filter.option != null || filter.options != null) {
			out.options = (filter.options != null ? list(filter.options) : [filter.option]).map(function (ref) {
				var option = findOption(field, ref);
				if (!option) {
					throw SchemaError("schema_invalid", flabel + ": no option " + ref + " in " + field.key + ".");
				}
				return option.key;
			});
		}
		if (filter.rows != null) {
			if (field.type !== "link_row" || !contains(ROW_FILTERS, out.type)) {
				throw SchemaError("schema_invalid", flabel + ": rows name the rows of a link_row field, for " + ROW_FILTERS.join(" or ") + ".");
			}
			out.rows = list(filter.rows).map(function (key) {
				var t = text(key);
				if (!t.length) {
					throw SchemaError("schema_invalid", flabel + ": an empty row key.");
				}
				return t;
			});
		} else if (contains(ROW_FILTERS, out.type) && out.value.length) {
			throw SchemaError("schema_invalid", flabel + ": a " + out.type + " filter names its rows by key (rows), not by id.");
		}
		if (filter.group != null && text(filter.group).length) {
			if (!groups["k:" + text(filter.group)]) {
				throw SchemaError("schema_invalid", flabel + ": no filter group " + text(filter.group) + ".");
			}
			out.group = text(filter.group);
		}
		return out;
	}

	// Groups of filters: a key each, a parent declared before; groups gets their keys ({"k:<key>": true}).
	function normalizeGroups(raw, label, groups) {
		return list(raw).map(function (group, g) {
			var key = text(group && group.key);
			var parent = text(group && (group.parent || group.parentGroup));
			if (!key.length || groups["k:" + key]) {
				throw SchemaError("schema_invalid", label + "[" + g + "]: a filter group needs a key of its own.");
			}
			if (parent.length && !groups["k:" + parent]) {
				throw SchemaError("schema_invalid", label + "[" + g + "]: the parent " + parent + " is not a group declared before.");
			}
			groups["k:" + key] = true;
			return { key: key, filterType: text(group.filterType || group.filter_type).toUpperCase() === "OR" ? "OR" : "AND", parent: parent.length ? parent : null };
		});
	}

	// The colors of the rows of a view: {type, provider: single_select_color, field} or {type, provider:
	// conditional_color, colors: [{color, filterType, filterGroups, filters}], default}.
	function normalizeDecorations(table, raw, label) {
		return list(raw).map(function (item, d) {
			var dlabel = label + ".decorations[" + d + "]";
			var decoration = item && typeof item === "object" ? item : {};
			var type = text(decoration.type);
			var provider = text(decoration.provider || decoration.valueProviderType || decoration.value_provider_type);
			if (!contains(DECORATION_TYPES, type) || !contains(DECORATION_PROVIDERS, provider)) {
				throw SchemaError("schema_invalid", dlabel + ": a decoration is a " + DECORATION_TYPES.join(" or ") + " by " + DECORATION_PROVIDERS.join(" or ") + ".");
			}
			var out = { type: type, provider: provider, field: null, colors: [], defaultColor: null };
			if (provider === "single_select_color") {
				var field = requireField(table, decoration.field, dlabel);
				if (field.type !== "single_select") {
					throw SchemaError("schema_invalid", dlabel + ": " + field.key + " is not a single_select field.");
				}
				out.field = field.key;
				return out;
			}
			var colors = list(decoration.colors);
			if (!colors.length || colors.length > 100) {
				throw SchemaError("schema_invalid", dlabel + ": a conditional color has 1 to 100 colors.");
			}
			out.colors = colors.map(function (rawColor, c) {
				var clabel = dlabel + ".colors[" + c + "]";
				var color = rawColor && typeof rawColor === "object" ? rawColor : {};
				if (!COLOR.test(text(color.color))) {
					throw SchemaError("schema_invalid", clabel + ": a color is a name or #code of 1 to 32 characters.");
				}
				var groups = {};
				var filterGroups = normalizeGroups(color.filterGroups || color.filter_groups, clabel + ".filterGroups", groups);
				return {
					color: text(color.color), filterType: text(color.filterType || color.filter_type).toUpperCase() === "OR" ? "OR" : "AND",
					filterGroups: filterGroups,
					filters: list(color.filters).map(function (filter, f) {
						return normalizeFilter(table, filter, clabel + ".filters[" + f + "]", groups);
					})
				};
			});
			if (decoration.default != null && text(decoration.default).length) {
				if (!COLOR.test(text(decoration.default))) {
					throw SchemaError("schema_invalid", dlabel + ": the default color is a name or #code of 1 to 32 characters.");
				}
				out.defaultColor = text(decoration.default);
			}
			return out;
		});
	}

	// The options of a field of a form beyond its label: when it is shown (conditions on the other fields, in groups),
	// its component, and the options of a select it offers (by key). null when it has none of them.
	function normalizeFormFieldOptions(table, field, given, label) {
		var out = {};
		var has = false;
		if (given.showWhenMatchingConditions != null) {
			if (given.showWhenMatchingConditions !== true && given.showWhenMatchingConditions !== false) {
				throw SchemaError("schema_invalid", label + ".showWhenMatchingConditions must be a boolean.");
			}
			out.showWhenMatchingConditions = given.showWhenMatchingConditions;
			has = true;
		}
		if (given.conditionType != null) {
			var conditionType = text(given.conditionType).toUpperCase();
			if (conditionType !== "AND" && conditionType !== "OR") {
				throw SchemaError("schema_invalid", label + ".conditionType is AND or OR.");
			}
			out.conditionType = conditionType;
			has = true;
		}
		if (given.fieldComponent != null) {
			if (!FIELD_COMPONENT.test(text(given.fieldComponent))) {
				throw SchemaError("schema_invalid", label + ".fieldComponent is a name of 1 to 32 letters, digits, _ or -.");
			}
			out.fieldComponent = text(given.fieldComponent);
			has = true;
		}
		if (given.includeAllSelectOptions != null) {
			if (given.includeAllSelectOptions !== true && given.includeAllSelectOptions !== false) {
				throw SchemaError("schema_invalid", label + ".includeAllSelectOptions must be a boolean.");
			}
			out.includeAllSelectOptions = given.includeAllSelectOptions;
			has = true;
		}
		if (given.allowedSelectOptions != null) {
			if (field.type !== "single_select" && field.type !== "multiple_select") {
				throw SchemaError("schema_invalid", label + ".allowedSelectOptions: " + field.key + " is not a select field.");
			}
			out.allowedSelectOptions = list(given.allowedSelectOptions).map(function (ref) {
				var option = findOption(field, ref);
				if (!option) {
					throw SchemaError("schema_invalid", label + ".allowedSelectOptions: no option " + ref + " in " + field.key + ".");
				}
				return option.key;
			});
			has = true;
		}
		var groups = {};
		out.conditionGroups = normalizeGroups(given.conditionGroups, label + ".conditionGroups", groups);
		var conditions = list(given.conditions);
		if (conditions.length > 100) {
			throw SchemaError("schema_invalid", label + ": 100 conditions at most.");
		}
		out.conditions = conditions.map(function (condition, c) {
			return normalizeFilter(table, condition, label + ".conditions[" + c + "]", groups);
		});
		has = has || out.conditionGroups.length > 0 || out.conditions.length > 0;
		return has ? out : null;
	}

	// The texts of a form view, and its images by key of a file of the schema.
	function normalizeForm(schema, view, label) {
		var form = {};
		Object.keys(FORM_TEXTS).forEach(function (key) {
			var value = view[key] != null ? view[key] : view[FORM_TEXTS[key]];
			if (value == null) {
				return;
			}
			if (typeof value !== "string" || value.length > 10000) {
				throw SchemaError("schema_invalid", label + ": " + key + " is a text of 10000 characters at most.");
			}
			form[key] = value;
		});
		var mode = text(view.mode);
		if (mode.length) {
			if (mode !== "form" && mode !== "survey") {
				throw SchemaError("schema_invalid", label + ": mode is form or survey.");
			}
			form.mode = mode;
		}
		var action = text(view.submitAction || view.submit_action).toUpperCase();
		if (action.length) {
			if (action !== "MESSAGE" && action !== "REDIRECT") {
				throw SchemaError("schema_invalid", label + ": submitAction is MESSAGE or REDIRECT.");
			}
			form.submitAction = action;
		}
		var url = text(view.submitActionRedirectUrl || view.submit_action_redirect_url);
		if (url.length) {
			if (!/^https?:\/\/[^\s]+$/i.test(url) || url.length > 2000) {
				throw SchemaError("schema_invalid", label + ": submitActionRedirectUrl is an http or https address.");
			}
			form.submitActionRedirectUrl = url;
		}
		["coverImage", "logoImage"].forEach(function (key) {
			var image = view[key];
			if (image == null) {
				return;
			}
			if (typeof image !== "object" || image.name != null || image.url != null || !schema.fileByKey["k:" + text(image.file)]) {
				throw SchemaError("schema_invalid", label + ": " + key + " is {file: <key of the files of the schema>}.");
			}
			form[key] = text(image.file);
		});
		return form;
	}

	function normalizeViews(schema, table) {
		var names = {};
		table.views = table.views.map(function (raw, i) {
			var view = raw || {};
			var label = "View " + table.key + ".views[" + i + "]";
			var name = text(view.name || view.view || ("View " + (i + 1)));
			checkName(name, label);
			var type = lower(view.type || "grid");
			if (!contains(VIEW_TYPES, type)) {
				throw SchemaError("schema_invalid", label + ": unknown view type " + type + ".");
			}
			if (names[lower(name)]) {
				throw SchemaError("schema_invalid", label + ": the view " + name + " is declared twice.");
			}
			names[lower(name)] = true;
			var spec = {
				key: text(view.key) || name,
				name: name,
				type: type,
				filterType: text(view.filterType || view.filter_type || "AND").toUpperCase() === "OR" ? "OR" : "AND",
				filtersDisabled: bool(view.filtersDisabled != null ? view.filtersDisabled : view.filters_disabled, false),
				filters: [],
				filterGroups: [],
				sorts: [],
				groupBys: [],
				field: null,
				cardCover: null,
				fieldOptions: []
			};
			if (type === "kanban" || type === "calendar") {
				var ref = text(type === "kanban" ? (view.singleSelectField || view.single_select_field) : (view.dateField || view.date_field));
				if (!ref.length) {
					throw SchemaError("schema_invalid", label + ": a " + type + " view needs " + (type === "kanban" ? "singleSelectField." : "dateField."));
				}
				spec.field = requireField(table, ref, label).key;
			}
			// a timeline: its start and end date fields (Baserow wants both, of the same date settings), its time scale
			if (type === "timeline") {
				var start = text(view.startDateField || view.start_date_field);
				var end = text(view.endDateField || view.end_date_field);
				spec.timeline = {
					start: start.length ? requireField(table, start, label + ".startDateField").key : null,
					end: end.length ? requireField(table, end, label + ".endDateField").key : null,
					timescale: null
				};
				var timescale = lower(view.timescale);
				if (timescale.length) {
					if (!contains(TIMESCALES, timescale)) {
						throw SchemaError("schema_invalid", label + ": timescale is " + TIMESCALES.join(", ") + ".");
					}
					spec.timeline.timescale = timescale;
				}
			}
			var formKeys = ["title", "description", "submitText", "submitActionMessage", "submitAction", "submitActionRedirectUrl", "coverImage", "logoImage", "mode",
				"submit_text", "submit_action", "submit_action_message", "submit_action_redirect_url"];
			if (type !== "form" && formKeys.some(function (key) { return view[key] != null; })) {
				throw SchemaError("schema_invalid", label + ": only a form view has texts and images of a form.");
			}
			spec.form = type === "form" ? normalizeForm(schema, view, label) : null;
			spec.decorations = normalizeDecorations(table, view.decorations, label);
			var cover = text(view.cardCoverImageField || view.card_cover_image_field);
			if (cover.length) {
				if (type !== "gallery" && type !== "kanban") {
					throw SchemaError("schema_invalid", label + ": only a gallery or a kanban view has a cardCoverImageField.");
				}
				var coverField = requireField(table, cover, label + ".cardCoverImageField");
				if (coverField.type !== "file") {
					throw SchemaError("schema_invalid", label + ": the cardCoverImageField " + coverField.key + " is not a file field.");
				}
				spec.cardCover = coverField.key;
			}
			// groups of filters: a key each, a parent declared before
			var groups = {};
			spec.filterGroups = normalizeGroups(view.filterGroups || view.filter_groups, label + ".filterGroups", groups);
			list(view.filters).forEach(function (filter, f) {
				spec.filters.push(normalizeFilter(table, filter, label + ".filters[" + f + "]", groups));
			});
			list(view.sorts || view.sortings).forEach(function (sort, s) {
				var field = requireField(table, sort && sort.field, label + ".sorts[" + s + "]");
				spec.sorts.push({ field: field.key, order: lower(sort.order) === "desc" ? "DESC" : "ASC" });
			});
			if ((view.groupBys || view.group_bys) != null && list(view.groupBys || view.group_bys).length && type !== "grid") {
				throw SchemaError("schema_invalid", label + ": only a grid view groups its rows (groupBys).");
			}
			list(view.groupBys || view.group_bys).forEach(function (groupBy, g) {
				var field = requireField(table, groupBy && groupBy.field, label + ".groupBys[" + g + "]");
				spec.groupBys.push({ field: field.key, order: lower(groupBy.order) === "desc" ? "DESC" : "ASC" });
			});
			// hidden columns and their order: only the options of the type of the view, of their type
			var options = view.fieldOptions || view.field_options;
			if (options != null && (typeof options !== "object" || Array.isArray(options))) {
				throw SchemaError("schema_invalid", label + ": fieldOptions must be an object {field: options}.");
			}
			var allowed = FIELD_OPTION_KEYS[type];
			Object.keys(options || {}).forEach(function (ref) {
				var field = requireField(table, ref, label + ".fieldOptions");
				var given = options[ref] || {};
				var kept = {};
				Object.keys(allowed).forEach(function (key) {
					var value = given[key];
					// an empty label of a form overrides nothing: never written
					if (value == null || (allowed[key] === "string" && value === "")) {
						return;
					}
					var ok = allowed[key] === "boolean" ? value === true || value === false
						: allowed[key] === "number" ? typeof value === "number" && isFinite(value) && Math.round(value) === value && value >= 0 && value <= 1000000
						: typeof value === "string" && value.length <= 1000;
					if (!ok) {
						throw SchemaError("schema_invalid", label + ".fieldOptions." + field.key + "." + key + " must be a " + allowed[key] + ".");
					}
					kept[key] = value;
				});
				var form = type === "form" ? normalizeFormFieldOptions(table, field, given, label + ".fieldOptions." + field.key) : null;
				if (Object.keys(kept).length || form) {
					var entry = { field: field.key, options: kept };
					if (form) {
						entry.form = form;
					}
					spec.fieldOptions.push(entry);
				}
			});
			if (bool(view.public, false)) {
				throw SchemaError("schema_invalid", label + ": a view of the schema is never public.");
			}
			return spec;
		});
	}

	function normalizeRows(schema, table) {
		if (!table.rows.length) {
			// no row: no upsertKey to check (a table whose primary field is a formula or a date may have no row)
			return;
		}
		// Rows that each carry their own key (_key), copied from another base (mode describe, C8Oforms #1836): they are
		// created in a new base without looking for them by the value of an upsertKey field, which any primary field
		// may then be.
		table.keyed = table.rows.every(function (raw) {
			return raw && typeof raw === "object" && raw._key != null && text(raw._key).length > 0;
		});
		var upsert = requireField(table, table.upsertKey, "Sample rows of " + table.key + " (upsertKey)");
		if (!table.keyed && !contains(UPSERT_TYPES, upsert.type)) {
			throw SchemaError("schema_invalid", "Sample rows of " + table.key + ": the upsertKey " + upsert.key + " must be a text or number field.");
		}
		table.upsertKey = upsert.key;
		var max = numberOrNull(schema.limits.maxRowsPerTable);
		if (max != null && table.rows.length > max) {
			throw SchemaError("schema_invalid", "Sample rows of " + table.key + ": " + table.rows.length + " rows, more than limits.maxRowsPerTable " + max + ".");
		}
		var seen = {};
		table.rows = table.rows.map(function (raw, r) {
			var label = "Sample row " + table.key + "[" + r + "]";
			var row = { key: "", values: {} };
			Object.keys(raw).forEach(function (column) {
				if (column.charAt(0) === "_") {
					return;
				}
				var field = requireField(table, column, label);
				if (contains(READ_ONLY_TYPES, field.type)) {
					throw SchemaError("schema_invalid", label + ": " + field.key + " is computed by the base, it takes no value.");
				}
				var value = raw[column];
				if (field.type === "file") {
					// only in rows copied with their own key (describe with attachments), by the key of a file of the schema
					if (!table.keyed) {
						throw SchemaError("schema_invalid", label + ": no file in the sample rows.");
					}
					value = list(value).map(function (item) {
						if (!item || typeof item !== "object" || item.name != null || item.url != null || !text(item.file).length) {
							throw SchemaError("schema_invalid", label + ": a file of " + field.key + " is {file: <key of the files of the schema>, visible_name}.");
						}
						var file = schema.fileByKey["k:" + text(item.file)];
						if (!file) {
							throw SchemaError("schema_invalid", label + ": no file " + text(item.file) + " in the files of the schema.");
						}
						var visibleName = text(item.visible_name || item.visibleName) || file.visibleName;
						if (visibleName.length > 255) {
							throw SchemaError("schema_invalid", label + ": a visible_name of " + field.key + " is longer than 255 characters.");
						}
						return { file: file.key, visibleName: visibleName };
					});
				}
				if (field.type === "single_select" && value != null && value !== "") {
					var option = findOption(field, value);
					if (!option) {
						throw SchemaError("schema_invalid", label + ": no option " + value + " in " + field.key + ".");
					}
					value = option.key;
				}
				if (field.type === "multiple_select") {
					value = list(value).map(function (item) {
						var option = findOption(field, item);
						if (!option) {
							throw SchemaError("schema_invalid", label + ": no option " + item + " in " + field.key + ".");
						}
						return option.key;
					});
				}
				if (field.type === "link_row") {
					value = list(value).map(function (item) {
						var key = text(item && typeof item === "object" ? (item.key || item.value || item.name) : item);
						if (!key.length) {
							throw SchemaError("schema_invalid", label + ": an empty link in " + field.key + ".");
						}
						return key;
					});
				}
				row.values[field.key] = value;
			});
			row.key = text(raw._key != null ? raw._key : row.values[table.upsertKey]);
			if (!row.key.length) {
				throw SchemaError("schema_invalid", label + ": no value for the upsertKey " + table.upsertKey + ".");
			}
			if (seen[row.key]) {
				throw SchemaError("schema_invalid", label + ": the key " + row.key + " is used by two rows.");
			}
			seen[row.key] = true;
			return row;
		});
	}

	// A link of a sample row names the key of a row of the target table, as a filter of a view on rows when the target
	// table has rows (without rows, the filter is left out at apply, with a warning).
	function checkRowLinks(schema) {
		schema.tables.forEach(function (table) {
			table.views.forEach(function (view) {
				view.filters.forEach(function (filter) {
					if (filter.rows == null) {
						return;
					}
					var target = findTable(schema, findField(table, filter.field).targetTable);
					if (!target.rows.length) {
						return;
					}
					filter.rows.forEach(function (key) {
						if (!target.rows.some(function (row) { return row.key === key; })) {
							throw SchemaError("schema_invalid", "View " + table.key + "." + view.key + ": a filter on " + filter.field + " names a row " + key + " missing from " + target.key + ".");
						}
					});
				});
			});
		});
		schema.tables.forEach(function (table) {
			table.rows.forEach(function (row, r) {
				Object.keys(row.values).forEach(function (key) {
					var field = findField(table, key);
					if (field.type !== "link_row") {
						return;
					}
					var target = findTable(schema, field.targetTable);
					row.values[key].forEach(function (item) {
						if (!target.rows.some(function (other) { return other.key === item; })) {
							throw SchemaError("schema_invalid", "Sample row " + table.key + "[" + r + "]: " + field.key + " links a row " + item + " missing from " + target.key + ".");
						}
					});
				});
			});
		});
	}

	// ---- units of work ---------------------------------------------------------------------------------------------

	function phaseOf(field) {
		if (field.related) {
			return null;
		}
		if (field.type === "link_row") {
			return "links";
		}
		return contains(COMPUTED_TYPES, field.type) ? "computed" : "fields";
	}

	// The computed fields in an order where each one comes after the computed fields it reads.
	function computedOrder(schema) {
		var nodes = [];
		var byId = {};
		schema.tables.forEach(function (table) {
			allFields(table).forEach(function (field) {
				if (phaseOf(field) === "computed") {
					var node = { id: table.key + "." + field.key, table: table, field: field, deps: [] };
					nodes.push(node);
					byId[node.id] = node;
				}
			});
		});
		nodes.forEach(function (node) {
			var field = node.field;
			var table = node.table;
			if (field.type === "lookup" || field.type === "rollup") {
				var link = findField(table, field.through);
				node.deps.push(link.targetTable + "." + field.targetField);
			}
			if (field.type === "formula") {
				formulaReferences(table, field.formula).forEach(function (ref) {
					node.deps.push(table.key + "." + ref.key);
				});
				var re = /\blookup\(\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)")\s*,\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)")\s*\)/g;
				var m;
				while ((m = re.exec(field.formula)) !== null) {
					var lookupLink = findField(table, (m[1] != null ? m[1] : m[2]).replace(/\\(.)/g, "$1"));
					var target = findTable(schema, lookupLink.targetTable);
					node.deps.push(target.key + "." + findField(target, (m[3] != null ? m[3] : m[4]).replace(/\\(.)/g, "$1")).key);
				}
			}
		});
		var order = [];
		var mark = {};
		var visit = function (node, path) {
			if (mark[node.id] === 2) {
				return;
			}
			if (mark[node.id] === 1) {
				throw SchemaError("schema_invalid", "The computed fields " + path.concat(node.id).join(" -> ") + " read each other.");
			}
			mark[node.id] = 1;
			node.deps.forEach(function (dep) {
				if (byId[dep]) {
					visit(byId[dep], path.concat(node.id));
				}
			});
			mark[node.id] = 2;
			order.push(node);
		};
		nodes.forEach(function (node) {
			visit(node, []);
		});
		return order;
	}

	// The tables in an order where the rows a sample row links already exist (links of a cycle are written afterwards).
	function rowsOrder(schema) {
		var order = [];
		var mark = {};
		var visit = function (table) {
			if (mark[table.key]) {
				return;
			}
			mark[table.key] = 1;
			table.fields.forEach(function (field) {
				if (field.type === "link_row" && table.rows.some(function (row) { return row.values[field.key] != null; })) {
					visit(findTable(schema, field.targetTable));
				}
			});
			(table.related || []).forEach(function (field) {
				if (table.rows.some(function (row) { return row.values[field.key] != null; })) {
					visit(findTable(schema, field.targetTable));
				}
			});
			order.push(table);
		};
		schema.tables.forEach(visit);
		return order;
	}

	// The ordered units of work of a schema: the same list at each step, so that state.cursor points into it.
	function units(schema, options) {
		var out = [{ phase: "base" }];
		schema.tables.forEach(function (table) {
			out.push({ phase: "tables", table: table.key });
		});
		["fields", "links"].forEach(function (phase) {
			schema.tables.forEach(function (table) {
				allFields(table).forEach(function (field) {
					if (field.primary ? phase === "fields" && field.type !== "text" && field.type !== "formula" : phaseOf(field) === phase) {
						out.push({ phase: phase, table: table.key, field: field.key });
					}
				});
			});
		});
		computedOrder(schema).forEach(function (node) {
			out.push({ phase: "computed", table: node.table.key, field: node.field.key });
		});
		var sampleData = bool(options.sampleData, true);
		// the files of the schema (the images of the forms, the files of the rows with them) before the views
		schemaFiles(schema, sampleData).forEach(function (key) {
			out.push({ phase: "files", file: key });
		});
		// a view filtered on rows is made once the rows exist
		var afterRows = [];
		schema.tables.forEach(function (table) {
			table.views.forEach(function (view) {
				var unit = { phase: "views", table: table.key, view: view.key };
				if (sampleData && viewNeedsRows(schema, table, view)) {
					afterRows.push(unit);
				} else {
					out.push(unit);
				}
			});
			// exactViews: the views Baserow made with a table of this import that the schema does not name, deleted
			if (bool(options.exactViews, false) && table.views.length) {
				out.push({ phase: "views", table: table.key, cleanup: true });
			}
		});
		if (sampleData) {
			rowsOrder(schema).forEach(function (table) {
				for (var from = 0; from < table.rows.length; from += ROWS_PER_BATCH) {
					out.push({ phase: "rows", table: table.key, from: from, to: Math.min(from + ROWS_PER_BATCH, table.rows.length) });
				}
			});
			rowsOrder(schema).forEach(function (table) {
				if (deferredLinks(schema, table).length) {
					out.push({ phase: "rowlinks", table: table.key });
				}
			});
		}
		out = out.concat(afterRows);
		out.push({ phase: "done" });
		return out;
	}

	// A view with a filter (of the view, or of a color of its rows) on rows of a linked table that has rows in the schema.
	function viewNeedsRows(schema, table, view) {
		var filters = view.filters.slice(0);
		list(view.decorations).forEach(function (decoration) {
			decoration.colors.forEach(function (color) {
				filters = filters.concat(color.filters);
			});
		});
		list(view.fieldOptions).forEach(function (item) {
			if (item.form) {
				filters = filters.concat(item.form.conditions);
			}
		});
		return filters.some(function (filter) {
			return filter.rows != null && findTable(schema, findField(table, filter.field).targetTable).rows.length > 0;
		});
	}

	// The link fields of the sample rows of a table whose target rows come after it (cycles): written by rowlinks.
	function deferredLinks(schema, table) {
		var order = rowsOrder(schema).map(function (t) { return t.key; });
		var at = order.indexOf(table.key);
		return allFields(table).filter(function (field) {
			return field.type === "link_row" && order.indexOf(field.targetTable) > at
				&& table.rows.some(function (row) { return row.values[field.key] != null; });
		}).map(function (field) { return field.key; });
	}

	// ---- state -----------------------------------------------------------------------------------------------------

	function newState(schema, options) {
		return {
			version: 1,
			schemaKey: schema.key,
			schemaVersion: schema.version,
			phase: "base",
			cursor: 0,
			done: false,
			sampleData: bool(options.sampleData, true),
			// the options the units depend on, kept from the first step (the cursor points into the same list)
			exactViews: bool(options.exactViews, false),
			workspaceId: null,
			workspaceName: "",
			baseId: null,
			baseName: "",
			createdBase: false,
			createdWorkspace: false,
			tables: {},
			tableNames: {},
			fields: {},
			fieldNames: {},
			options: {},
			views: {},
			rowIds: {},
			rowsDone: {},
			primaryDone: {},
			viewsDone: {},
			linksDone: {},
			// the colors of the rows made, by view and rank
			decorations: {},
			// the files uploaded for the rows (key -> {name, visible_name, size})
			files: {},
			// the tables this run created, the views it made in a table it did not create, the groups of filters it made
			createdTables: {},
			ownViews: {},
			filterGroups: {},
			// exactViews: the views Baserow made with a table of this run, and the tables whose views were cleaned
			autoViews: {},
			viewsCleaned: {},
			// in a base that existed (baseId): what existed before the first write (before) and what this run made in it,
			// for the rollback that deletes only that (undo)
			before: null,
			undo: null,
			matchedRows: {},
			// what Baserow refused as a paid feature of its own (402), left out: {table, view, what, reason, field}
			omittedViews: [],
			// a batch of rows being written: the number of rows of its table before it (a write whose answer is lost is
			// found again at the end of the table, never written twice)
			rowMarks: {},
			warnings: []
		};
	}

	function emptyUndo() {
		return { tables: [], fields: [], options: [], views: [], filters: [], sorts: [], groupBys: [], rows: [] };
	}

	function undoCount(undo) {
		if (!undo || typeof undo !== "object") {
			return 0;
		}
		var count = 0;
		["tables", "fields", "options", "views", "filters", "sorts", "groupBys"].forEach(function (kind) {
			count += list(undo[kind]).length;
		});
		list(undo.rows).forEach(function (entry) {
			count += list(entry && entry.ids).length;
		});
		return count + list(undo.pending).length;
	}

	function readState(raw, schema, options) {
		var parsed = parseJson(raw, "state", null);
		if (!parsed || typeof parsed !== "object") {
			return newState(schema, options);
		}
		var state = newState(schema, options);
		Object.keys(parsed).forEach(function (key) {
			state[key] = parsed[key];
		});
		if (state.schemaKey !== schema.key || state.schemaVersion !== schema.version) {
			throw SchemaError("state_mismatch", "This state was made for the schema " + state.schemaKey + " " + state.schemaVersion + ".");
		}
		// the files of a state are files this run uploaded: a name of Baserow, a size
		if (!state.files || typeof state.files !== "object" || Array.isArray(state.files)) {
			throw SchemaError("state_invalid", "The files of the state are not an object.");
		}
		Object.keys(state.files).forEach(function (key) {
			var file = state.files[key];
			if (!FILE_KEY.test(key) || !file || typeof file !== "object" || !FILE_NAME.test(text(file.name)) || !(numberOrNull(file.size) >= 0)) {
				throw SchemaError("state_invalid", "The file " + key + " of the state is not a file uploaded by the run.");
			}
		});
		return state;
	}

	function map(state) {
		return { tables: state.tables, fields: state.fields, options: state.options, views: state.views };
	}

	// ---- execution -------------------------------------------------------------------------------------------------

	// Reads of the step, kept for the step only: what exists is read once per step, by name, in this base only.
	function Reader(api) {
		this.api = api;
		this.tables = null;
		this.fields = {};
		this.views = {};
		this.rows = {};
	}
	Reader.prototype.tableList = function (baseId) {
		if (this.tables == null) {
			this.tables = baseId > 0 ? list(this.api.listTables(baseId)) : [];
		}
		return this.tables;
	};
	Reader.prototype.fieldList = function (tableId, refresh) {
		if (refresh || this.fields[tableId] == null) {
			this.fields[tableId] = tableId > 0 ? list(this.api.listFields(tableId)) : [];
		}
		return this.fields[tableId];
	};
	Reader.prototype.viewList = function (tableId) {
		if (this.views[tableId] == null) {
			this.views[tableId] = tableId > 0 ? list(this.api.listViews(tableId)) : [];
		}
		return this.views[tableId];
	};

	function byName(items, name) {
		var t = lower(name);
		for (var i = 0; i < items.length; i++) {
			if (items[i] && lower(items[i].name) === t) {
				return items[i];
			}
		}
		return null;
	}

	function Run(schema, state, api, options, plan, fileOf) {
		this.schema = schema;
		this.state = state;
		this.api = api;
		this.options = options;
		this.plan = plan;
		this.fileOf = fileOf || function () { return null; };
		this.reader = new Reader(api);
		this.actions = [];
		this.created = { workspaces: [], bases: [], tables: [], fields: [], views: [], rows: 0, files: 0 };
	}

	// A table this run created (or any table of a base it created): everything in it is the run's.
	Run.prototype.ours = function (tableKey) {
		return this.state.createdBase === true || this.state.createdTables[tableKey] === true;
	};

	// Records what this run made in a base that existed, for the rollback (state.undo).
	Run.prototype.track = function (kind, item) {
		var undo = this.state.undo;
		if (!undo) {
			return;
		}
		undo[kind] = list(undo[kind]);
		if (item != null && typeof item !== "object" && contains(undo[kind], item)) {
			return;
		}
		if (item != null && typeof item === "object" && item.id != null && undo[kind].some(function (o) { return o && o.id === item.id; })) {
			return;
		}
		undo[kind].push(item);
	};

	// A write about to be made in a base that existed (a table, a field or a view, by its name): if its answer is lost
	// and the run stops there, the rollback finds it by its name (state.undo.pending), never a name of the snapshot.
	Run.prototype.pending = function (kind, table, name) {
		var undo = this.state.undo;
		if (!undo) {
			return function () {};
		}
		var item = { kind: kind, table: table, name: name };
		undo.pending = list(undo.pending).concat([item]);
		return function () {
			undo.pending = list(undo.pending).filter(function (p) { return !(p.kind === kind && p.table === table && p.name === name); });
		};
	};

	// A batch of rows written, its answer received: no longer pending.
	Run.prototype.unpendRows = function (markId) {
		var undo = this.state.undo;
		if (undo) {
			undo.pending = list(undo.pending).filter(function (p) { return !(p.kind === "rows" && p.mark === markId); });
		}
	};

	// A name of the snapshot of what existed (state.before), compared without case.
	function existed(names, name) {
		return list(names).indexOf(lower(name)) !== -1;
	}

	// An action of the answer: its type always, never one of its details (a field or a decoration has a type of its own:
	// fieldType, decorationType).
	Run.prototype.action = function (type, extra) {
		var item = {};
		for (var key in extra) {
			item[key] = extra[key];
		}
		item.type = type;
		this.actions.push(item);
		return item;
	};

	Run.prototype.warn = function (code, message, extra) {
		var item = { code: code, message: message };
		for (var key in extra) {
			item[key] = extra[key];
		}
		this.state.warnings.push(item);
	};

	Run.prototype.table = function (key) {
		return findTable(this.schema, key);
	};

	Run.prototype.fieldId = function (tableKey, fieldKey) {
		return this.state.fields[tableKey + "." + fieldKey];
	};

	Run.prototype.fieldName = function (table, field) {
		return this.state.fieldNames[table.key + "." + field.key] || field.name;
	};

	Run.prototype.requireId = function (value, what) {
		if (value == null) {
			throw SchemaError("state_incomplete", what + " is not created yet.");
		}
		return value;
	};

	Run.prototype.unit = function (unit) {
		if (unit.phase === "base") {
			return this.base();
		}
		if (unit.phase === "tables") {
			return this.createTable(this.table(unit.table));
		}
		if (unit.phase === "fields" || unit.phase === "links" || unit.phase === "computed") {
			var table = this.table(unit.table);
			return this.createField(table, findField(table, unit.field));
		}
		if (unit.phase === "views") {
			var viewTable = this.table(unit.table);
			if (unit.cleanup) {
				return this.cleanViews(viewTable);
			}
			return this.createView(viewTable, viewTable.views.filter(function (view) { return view.key === unit.view; })[0]);
		}
		if (unit.phase === "files") {
			return this.uploadFile(unit.file);
		}
		if (unit.phase === "rows") {
			return this.createRows(this.table(unit.table), unit.from, unit.to);
		}
		if (unit.phase === "rowlinks") {
			return this.linkRows(this.table(unit.table));
		}
	};

	Run.prototype.offline = function () {
		return this.plan && !this.api.online;
	};

	// The workspaces of the user (GET /api/workspaces/ with the user's token, never GroupsList).
	Run.prototype.workspaces = function () {
		if (this.workspaceList == null) {
			this.workspaceList = list(this.api.listWorkspaces());
		}
		return this.workspaceList;
	};

	// The workspace asked (options.workspaceId, given by the caller, or the schema's), one of the user's.
	Run.prototype.wantedWorkspace = function () {
		var wanted = numberOrNull(this.options.workspaceId);
		var schemaWanted = this.schema.workspaceId;
		if (wanted != null && schemaWanted != null && wanted !== schemaWanted) {
			throw SchemaError("workspace_mismatch", "The schema names the workspace " + schemaWanted + ", the call " + wanted + ".");
		}
		return wanted != null ? wanted : schemaWanted;
	};

	Run.prototype.workspace = function () {
		var state = this.state;
		var wanted = this.wantedWorkspace();
		if (this.offline()) {
			state.workspaceId = wanted;
			state.workspaceName = this.schema.workspaceName;
			return;
		}
		var workspaces = this.workspaces();
		var found = null;
		if (wanted != null) {
			found = workspaces.filter(function (w) { return numberOrNull(w.id) === wanted; })[0];
			if (!found) {
				throw SchemaError("workspace_not_in_catalog", "The workspace " + wanted + " is not one of the workspaces of the user.");
			}
		} else if (this.schema.workspaceName.length) {
			var name = lower(this.schema.workspaceName);
			var named = workspaces.filter(function (w) { return lower(w.name) === name; });
			if (named.length > 1) {
				throw SchemaError("workspace_ambiguous", "Several workspaces of the user are named " + this.schema.workspaceName + ": give workspaceId.");
			}
			found = named[0];
			if (found) {
				this.action("workspace_exists", { workspaceId: found.id, workspaceName: found.name });
			} else {
				if (!bool((this.options.create || {}).workspace, false)) {
					throw SchemaError("workspace_missing", "The user has no workspace named " + this.schema.workspaceName + " and create.workspace is false.");
				}
				this.action("create_workspace", { workspaceName: this.schema.workspaceName });
				found = this.api.createWorkspace(this.schema.workspaceName);
				state.createdWorkspace = true;
				this.created.workspaces.push({ id: numberOrNull(found.id), name: text(found.name) });
			}
		} else {
			throw SchemaError("workspace_required", "Give the workspace of the new base (workspaceId or workspaceName).");
		}
		state.workspaceId = numberOrNull(found.id);
		state.workspaceName = text(found.name);
	};

	// An existing base (baseId), used as it is: a database of a workspace of the user, the workspace asked if any.
	Run.prototype.existingBase = function (baseId) {
		var state = this.state;
		var wanted = this.wantedWorkspace();
		if (this.offline()) {
			state.workspaceId = wanted;
			state.baseId = baseId;
			this.action("base_exists", { baseId: baseId, workspaceId: wanted });
			return;
		}
		var application = this.api.getApplication(baseId);
		var owner = application && (application.workspace || application.group) || {};
		var ownerId = numberOrNull(owner.id);
		var workspace = this.workspaces().filter(function (w) { return numberOrNull(w.id) === ownerId; })[0];
		if (!application || text(application.type) !== "database" || !workspace || (wanted != null && wanted !== ownerId)) {
			throw SchemaError("base_not_in_catalog", "The base " + baseId + " is not a base of " + (wanted != null ? "the workspace " + wanted + " of the user." : "a workspace of the user."));
		}
		// the tables of the base before the first write, read before anything is kept in the state: a table found by its
		// name later is the user's only if it was there (else this run made it, its answer lost), and the rollback
		// deletes only what this run made
		var tablesBefore = state.undo == null ? this.reader.tableList(baseId).map(function (t) { return lower(t && t.name); }) : null;
		state.workspaceId = ownerId;
		state.workspaceName = text(workspace.name);
		state.baseId = baseId;
		state.baseName = text(application.name);
		state.createdBase = false;
		if (state.undo == null) {
			state.before = { tables: tablesBefore, fields: {}, views: {} };
			state.undo = emptyUndo();
		}
		this.action("base_exists", { baseId: baseId, baseName: state.baseName, workspaceId: ownerId });
	};

	// A new base, never one found by name: a template creates a base of its own each time.
	Run.prototype.base = function () {
		var state = this.state;
		if (state.baseId != null) {
			return;
		}
		var baseId = numberOrNull(this.options.baseId) != null ? numberOrNull(this.options.baseId) : this.schema.baseId;
		if (baseId != null) {
			return this.existingBase(baseId);
		}
		var name = text(this.options.baseName) || this.schema.baseName;
		checkBaseName(name);
		this.workspace();
		this.action("create_base", { baseName: name, workspaceId: state.workspaceId });
		var created = this.api.createDatabase(state.workspaceId, name);
		state.baseId = numberOrNull(created && created.id);
		if (state.baseId == null) {
			throw SchemaError("baserow_error", "Baserow did not answer the id of the new base.");
		}
		state.baseName = text(created.name) || name;
		forgetTablePaths(state.workspaceName, state.baseName);
		state.createdBase = true;
		this.created.bases.push({ id: state.baseId, name: state.baseName });
	};

	Run.prototype.createTable = function (table) {
		var state = this.state;
		if (state.tables[table.key] != null) {
			return;
		}
		var baseId = this.requireId(state.baseId, "The base");
		var existing = byName(this.reader.tableList(baseId), table.name);
		var created = existing;
		var made = !existing;
		if (existing) {
			this.action("table_exists", { table: table.key, tableId: existing.id });
			// in a base that existed, a table missing from the snapshot was made by this run (its answer lost)
			made = state.before != null && !existed(state.before.tables, existing.name);
		} else {
			// A header row alone gives a table holding its primary field only, named as the schema asks, and no rows
			// (without data Baserow creates its example table: Name, Notes, Active and two rows).
			this.action("create_table", { table: table.key, name: table.name, baseId: baseId, primaryField: table.primary.name });
			var tableDone = this.pending("tables", table.key, table.name);
			created = this.api.createTable(baseId, { name: table.name, data: [[table.primary.name]], first_row_header: true });
			tableDone();
			this.reader.tables.push(created);
			this.created.tables.push({ id: numberOrNull(created.id), name: text(created.name), primaryField: table.primary.name });
		}
		var tableId = numberOrNull(created.id);
		if (tableId == null) {
			throw SchemaError("baserow_error", "Baserow did not answer the id of the table " + table.name + ".");
		}
		made = made || state.createdBase === true;
		// every read first, then the state (a read that fails leaves the state as it was: the unit runs again whole)
		var fields = this.reader.fieldList(tableId, !existing);
		var autoViews = made && state.exactViews === true && table.views.length && !this.plan
			? list(this.api.listViews(tableId)).map(function (v) { return numberOrNull(v.id); }) : null;
		var viewsBefore = !made && state.before != null && table.views.length ? this.reader.viewList(tableId).map(function (v) { return lower(v && v.name); }) : null;
		if (!made && state.before != null) {
			// a table of the user: its fields with their options and its views, before any write
			state.before.fields["k:" + table.key] = fields.map(function (f) {
				return { name: lower(f.name), values: list(f.select_options).map(function (o) { return text(o && o.value); }) };
			});
			if (viewsBefore) {
				state.before.views["k:" + table.key] = viewsBefore;
			}
		}
		if (made) {
			state.createdTables[table.key] = true;
			this.track("tables", { id: tableId, table: table.key });
			// exactViews: the views Baserow makes with a table, to delete when the schema does not name them
			if (autoViews) {
				state.autoViews[table.key] = autoViews;
			}
		}
		state.tables[table.key] = tableId;
		state.tableNames[table.key] = text(created.name) || table.name;
		var primary = null;
		fields.forEach(function (field) {
			if (field.primary === true || field.primary === "true") {
				primary = field;
			}
		});
		if (primary) {
			this.register(table, table.primary, primary);
			if (existing && lower(primary.name) !== lower(table.primary.name)) {
				this.warn("primary_field_name", "The primary field of " + table.name + " is " + primary.name + ", the schema names it " + table.primary.name + ".", { table: table.key });
			}
		} else if (this.plan) {
			this.register(table, table.primary, { id: -tableId || -1, name: table.primary.name });
		} else {
			throw SchemaError("baserow_error", "The table " + table.name + " has no primary field.");
		}
	};

	// Keeps the id, the name and the select options of a field of the base.
	Run.prototype.register = function (table, spec, field) {
		var id = table.key + "." + spec.key;
		this.state.fields[id] = numberOrNull(field.id);
		this.state.fieldNames[id] = text(field.name) || spec.name;
		var options = list(field.select_options || field.selectOptions);
		var state = this.state;
		(spec.values || []).forEach(function (option) {
			var match = options.filter(function (o) { return o && text(o.value) === option.value; })[0];
			if (match && numberOrNull(match.id) != null) {
				state.options[id + "." + option.key] = numberOrNull(match.id);
			}
		});
	};

	Run.prototype.fieldBody = function (table, spec) {
		var body = { name: spec.name, type: spec.type };
		var state = this.state;
		var run = this;
		if (spec.description.length) {
			body.description = spec.description;
		}
		// the Baserow options of the field, never what the engine sets itself (its name, type, links, references, options)
		Object.keys(spec.baserowOptions).forEach(function (key) {
			if (!contains(RESERVED_FIELD_KEYS, key)) {
				body[key] = spec.baserowOptions[key];
			}
		});
		if (spec.type === "single_select" || spec.type === "multiple_select") {
			body.select_options = spec.values.map(function (option) { return { value: option.value, color: option.color }; });
		}
		if (spec.type === "link_row") {
			body.link_row_table_id = this.requireId(state.tables[spec.targetTable], "The table " + spec.targetTable);
			var related = spec.relatedFieldKey.length || spec.relatedFieldName.length;
			if (spec.createRelatedField != null || related) {
				body.has_related_field = related ? true : bool(spec.createRelatedField, true);
			}
			if (spec.targetTable === table.key) {
				body.has_related_field = false;
			}
			if (spec.multiple != null) {
				body.link_row_multiple_relationships = bool(spec.multiple, true);
			}
		}
		if (spec.type === "lookup" || spec.type === "rollup" || spec.type === "count") {
			body.through_field_id = this.requireId(this.fieldId(table.key, spec.through), "The field " + table.key + "." + spec.through);
			if (spec.type !== "count") {
				var link = findField(table, spec.through);
				body.target_field_id = this.requireId(this.fieldId(link.targetTable, spec.targetField), "The field " + link.targetTable + "." + spec.targetField);
			}
			if (spec.type === "rollup") {
				body.rollup_function = spec.rollupFunction;
			}
		}
		if (spec.type === "formula") {
			body.formula = translateFormula(this.schema, table, spec.formula, function (t, f) { return run.fieldName(t, f); });
		}
		return body;
	};

	Run.prototype.createField = function (table, spec) {
		var state = this.state;
		var id = table.key + "." + spec.key;
		var tableId = this.requireId(state.tables[table.key], "The table " + table.key);
		if (spec.primary) {
			// the table was created with a text primary field: change its type
			if (state.primaryDone[id]) {
				return;
			}
			var current = this.reader.fieldList(tableId).filter(function (f) { return numberOrNull(f.id) === state.fields[id]; })[0];
			if (current && normalizeFieldType(current.type) !== spec.type && !this.ours(table.key)) {
				// the primary field of a table of the user keeps its type (a change would convert its values)
				this.warn("primary_field_type", "The primary field of " + table.name + " is a " + current.type + ", the schema asks a " + spec.type + ": its type is not changed.", { table: table.key });
			} else if (!current || normalizeFieldType(current.type) !== spec.type) {
				var primaryBody = this.fieldBody(table, spec);
				this.action("update_field", { table: table.key, field: spec.key, fieldType: spec.type, body: primaryBody });
				var updated = this.api.updateField(this.requireId(state.fields[id], "The primary field of " + table.key), primaryBody);
				this.register(table, spec, updated && updated.id != null ? updated : { id: state.fields[id], name: spec.name });
			}
			state.primaryDone[id] = true;
			return;
		}
		if (state.fields[id] != null) {
			return;
		}
		var existing = byName(this.reader.fieldList(tableId), spec.name);
		if (existing) {
			this.action("field_exists", { table: table.key, field: spec.key, fieldId: existing.id, fieldType: existing.type });
			// in a table of the user, a field missing from the snapshot was made by this run (its answer lost)
			// (a table of the user without snapshot: everything found in it existed)
			var known = this.ours(table.key) || !this.state.before ? null : this.state.before.fields["k:" + table.key];
			var before = known === undefined
				? [{ name: lower(existing.name), values: list(existing.select_options).map(function (o) { return text(o && o.value); }) }]
				: (known ? list(known) : null);
			var snapshot = before ? before.filter(function (f) { return f && f.name === lower(existing.name); })[0] : null;
			if (before && !snapshot) {
				this.track("fields", { id: numberOrNull(existing.id), table: table.key });
			}
			if (normalizeFieldType(existing.type) !== spec.type) {
				this.warn("field_type_mismatch", "The field " + table.name + "." + spec.name + " is a " + existing.type + ", the schema asks a " + spec.type + ": its type is not changed.", { table: table.key, field: spec.key });
			} else if (spec.values.length) {
				existing = this.appendOptions(table, spec, existing, snapshot);
			}
			this.register(table, spec, existing);
			this.registerRelated(table, spec, existing, !!snapshot);
			return;
		}
		var body = this.fieldBody(table, spec);
		this.action("create_field", { table: table.key, tableId: tableId, field: spec.key, name: spec.name, fieldType: spec.type, body: body });
		var fieldDone = this.ours(table.key) ? function () {} : this.pending("fields", table.key, spec.name);
		var created = this.api.createField(tableId, body);
		fieldDone();
		if (!created || numberOrNull(created.id) == null) {
			throw SchemaError("baserow_error", "Baserow did not create the field " + table.name + "." + spec.name + ".");
		}
		this.reader.fieldList(tableId).push(created);
		this.register(table, spec, created);
		this.created.fields.push({ table: table.key, tableId: tableId, name: text(created.name), type: spec.type, id: numberOrNull(created.id) });
		if (!this.ours(table.key)) {
			this.track("fields", { id: numberOrNull(created.id), table: table.key });
		}
		this.registerRelated(table, spec, created, false);
	};

	// The related field Baserow created in the target table of a link_row: its id, and the name the schema gives it (a
	// link of the user, userLink, keeps the name of its related field).
	Run.prototype.registerRelated = function (table, spec, field, userLink) {
		if (spec.type !== "link_row") {
			return;
		}
		var target = this.table(spec.targetTable);
		var related = (target.related || []).filter(function (r) { return r.from === table.key + "." + spec.key; })[0];
		if (!related) {
			return;
		}
		var relatedId = numberOrNull(field.link_row_related_field_id || field.link_row_related_field);
		if (relatedId == null) {
			if (this.plan) {
				this.state.fields[target.key + "." + related.key] = -1;
				return;
			}
			throw SchemaError("baserow_error", "Baserow did not create the related field of " + table.name + "." + spec.name + ".");
		}
		var targetId = this.state.tables[target.key];
		var current = this.reader.fieldList(targetId, true).filter(function (f) { return numberOrNull(f.id) === relatedId; })[0] || { id: relatedId, name: related.name };
		if (related.namedBySchema && text(current.name) !== related.name && userLink === true) {
			this.warn("related_field_name", "The related field of " + table.name + "." + spec.name + " is " + text(current.name) + ", the schema names it " + related.name + ": it is not renamed.", { table: target.key });
		} else if (related.namedBySchema && text(current.name) !== related.name) {
			this.action("update_field", { table: target.key, field: related.key, name: related.name });
			var renamed = this.api.updateField(relatedId, { name: related.name });
			current = renamed && renamed.id != null ? renamed : { id: relatedId, name: related.name };
		}
		this.register(target, related, current);
	};

	// The options of the schema missing from an existing select field (an existing base): added, never removed. In a
	// field of the user (snapshot: its options before any write), the options this run added are recorded for the
	// rollback, by value (an option added by an answer lost is not in the snapshot either).
	Run.prototype.appendOptions = function (table, spec, existing, snapshot) {
		var options = list(existing.select_options || existing.selectOptions);
		var missing = spec.values.filter(function (option) {
			return !options.some(function (o) { return o && text(o.value) === option.value; });
		});
		var result = existing;
		if (missing.length) {
			this.action("update_select_options", { table: table.key, field: spec.key, fieldId: existing.id, missingOptions: missing.map(function (o) { return o.value; }) });
			var updated = this.api.updateField(numberOrNull(existing.id), {
				select_options: options.map(function (o) { return { id: o.id, value: o.value, color: o.color }; })
					.concat(missing.map(function (o) { return { value: o.value, color: o.color }; }))
			});
			result = updated && updated.id != null ? updated : existing;
		}
		if (snapshot && this.state.undo) {
			var added = spec.values.map(function (o) { return o.value; }).filter(function (value) {
				return snapshot.values.indexOf(value) === -1;
			});
			if (added.length) {
				var fieldId = numberOrNull(existing.id);
				var undo = this.state.undo;
				var entry = list(undo.options).filter(function (o) { return o && o.id === fieldId; })[0];
				if (!entry) {
					entry = { id: fieldId, table: table.key, values: [] };
					undo.options.push(entry);
				}
				added.forEach(function (value) {
					if (entry.values.indexOf(value) === -1) {
						entry.values.push(value);
					}
				});
			}
		}
		return result;
	};

	// The value of a filter as Baserow takes it: select options by their id, rows of the linked table by their id; null
	// when its rows are not made (a filter left out, with a warning).
	Run.prototype.filterValue = function (table, filter, where) {
		var state = this.state;
		var run = this;
		if (filter.options != null) {
			return filter.options.map(function (option) {
				return "" + run.requireId(state.options[table.key + "." + filter.field + "." + option], "The option " + option);
			}).join(",");
		}
		if (filter.rows != null) {
			var targetIds = state.rowIds[findField(table, filter.field).targetTable] || {};
			if (filter.rows.some(function (key) { return targetIds[key] == null; })) {
				this.warn("view_filter_rows", "A filter of " + where + " on " + filter.field + " names rows that are not created: it is left out.", { table: table.key });
				return null;
			}
			return filter.rows.map(function (key) { return "" + targetIds[key]; }).join(",");
		}
		return filter.value;
	};

	// A random identifier of the kind Baserow gives the colors, filters and groups of a conditional color (uuid4).
	function uuid() {
		return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
			var r = Math.floor(Math.random() * 16);
			return (c === "x" ? r : (r % 4) + 8).toString(16);
		});
	}

	// The value_provider_conf of a decoration: {field_id} for the colors of a select field, {colors, default} for
	// conditional colors (their filters as the filters of a view).
	Run.prototype.decorationConf = function (table, decoration) {
		var run = this;
		if (decoration.provider === "single_select_color") {
			return { field_id: this.requireId(this.fieldId(table.key, decoration.field), "The field " + table.key + "." + decoration.field) };
		}
		var colors = decoration.colors.map(function (color) {
			var groupIds = {};
			var groups = color.filterGroups.map(function (group) {
				var groupId = uuid();
				groupIds["k:" + group.key] = groupId;
				var out = { id: groupId, filter_type: group.filterType };
				if (group.parent != null) {
					out.parent_group = groupIds["k:" + group.parent];
				}
				return out;
			});
			var filters = [];
			color.filters.forEach(function (filter) {
				var value = run.filterValue(table, filter, "a color of " + table.name);
				if (value == null) {
					return;
				}
				var out = { id: uuid(), field: run.requireId(run.fieldId(table.key, filter.field), "The field " + table.key + "." + filter.field), type: filter.type, value: value };
				if (filter.group != null) {
					out.group = groupIds["k:" + filter.group];
				}
				filters.push(out);
			});
			return { id: uuid(), color: color.color, filter_type: color.filterType, filters: filters, filter_groups: groups };
		});
		var conf = { colors: colors };
		if (decoration.defaultColor != null) {
			conf["default"] = decoration.defaultColor;
		}
		return conf;
	};

	// A refusal of Baserow for a paid feature the account does not have (402).
	function featureNotAvailable(e) {
		return /^ERROR_(FEATURE_NOT_AVAILABLE|NO_ACTIVE_PREMIUM_LICENSE)$/.test(text(e && e.baserowError));
	}

	// A part of a view Baserow refused as a paid feature: left out, listed (state.omittedViews), the run goes on.
	Run.prototype.skipPaid = function (table, spec, what, field, e) {
		var item = { table: table.name, view: spec.name, what: what, reason: "feature_not_available" };
		if (field != null) {
			item.field = field;
		}
		// the refusal of Baserow (ERROR_FEATURE_NOT_AVAILABLE...), for the message of the caller
		if (e && text(e.baserowError).length) {
			item.baserowError = text(e.baserowError);
		}
		this.state.omittedViews = list(this.state.omittedViews).concat([item]);
		this.warn("feature_not_available", "The no-code database refused the " + what + " of the view " + table.name + "." + spec.name + " (a paid feature of the account): it is left out.", { table: table.key, view: spec.key });
	};

	// A view of the schema. In a table of the user, a view found by its name is the user's: its flat filters, sorts and
	// group bys are completed as before (recorded for the rollback), nothing else of it is changed; a view this run
	// made (or any view of a table it made) gets its groups of filters and its field options too.
	Run.prototype.createView = function (table, spec) {
		var state = this.state;
		var id = table.key + "." + spec.key;
		var tableId = this.requireId(state.tables[table.key], "The table " + table.key);
		if (state.viewsDone[id]) {
			return;
		}
		var own = this.ours(table.key) || state.ownViews[id] === true;
		var view = null;
		if (state.views[id] != null) {
			view = { id: state.views[id], filters: null, sortings: null, group_bys: null };
		}
		if (!view) {
			view = byName(this.reader.viewList(tableId), spec.name);
			if (view) {
				this.action("view_exists", { table: table.key, view: spec.key, viewId: view.id });
				// in a table of the user, a view missing from the snapshot was made by this run (its answer lost)
				// (a table of the user without snapshot of its views: every view found existed)
				var viewsBefore = state.before != null ? state.before.views["k:" + table.key] : undefined;
				if (!own && viewsBefore !== undefined && !existed(viewsBefore, view.name)) {
					own = true;
					state.ownViews[id] = true;
					this.track("views", { id: numberOrNull(view.id), table: table.key });
				}
			}
		}
		if (!view) {
			var body = { name: spec.name, type: spec.type, filter_type: spec.filterType, filters_disabled: spec.filtersDisabled === true, public: false };
			if (spec.type === "kanban") {
				body.single_select_field = this.requireId(this.fieldId(table.key, spec.field), "The field " + table.key + "." + spec.field);
			}
			if (spec.type === "calendar") {
				body.date_field = this.requireId(this.fieldId(table.key, spec.field), "The field " + table.key + "." + spec.field);
			}
			if (spec.cardCover != null) {
				body.card_cover_image_field = this.requireId(this.fieldId(table.key, spec.cardCover), "The field " + table.key + "." + spec.cardCover);
			}
			if (spec.timeline) {
				if (spec.timeline.start != null) {
					body.start_date_field = this.requireId(this.fieldId(table.key, spec.timeline.start), "The field " + table.key + "." + spec.timeline.start);
				}
				if (spec.timeline.end != null) {
					body.end_date_field = this.requireId(this.fieldId(table.key, spec.timeline.end), "The field " + table.key + "." + spec.timeline.end);
				}
				if (spec.timeline.timescale != null) {
					body.timescale = spec.timeline.timescale;
				}
			}
			if (spec.form) {
				var form = spec.form;
				Object.keys(FORM_TEXTS).forEach(function (key) {
					if (form[key] != null) {
						body[FORM_TEXTS[key]] = form[key];
					}
				});
				if (form.mode) {
					body.mode = form.mode;
				}
				if (form.submitAction) {
					body.submit_action = form.submitAction;
				}
				if (form.submitActionRedirectUrl) {
					body.submit_action_redirect_url = form.submitActionRedirectUrl;
				}
				// the images: the files this run uploaded (phase files)
				var self = this;
				[["coverImage", "cover_image"], ["logoImage", "logo_image"]].forEach(function (image) {
					if (form[image[0]] != null) {
						body[image[1]] = { name: self.requireId(state.files[form[image[0]]], "The file " + form[image[0]]).name };
					}
				});
			}
			this.action("create_view", { table: table.key, tableId: tableId, view: spec.key, name: spec.name, body: body });
			var viewDone = this.ours(table.key) ? function () {} : this.pending("views", table.key, spec.name);
			try {
				view = this.api.createView(tableId, body);
			} catch (e) {
				if (!featureNotAvailable(e)) {
					throw e;
				}
				// a paid feature: a survey made a plain form, else the view is left out
				view = null;
				if (body.mode === "survey") {
					delete body.mode;
					try {
						view = this.api.createView(tableId, body);
						this.skipPaid(table, spec, "mode", null, e);
					} catch (again) {
						if (!featureNotAvailable(again)) {
							throw again;
						}
					}
				}
				if (!view) {
					viewDone();
					this.skipPaid(table, spec, "view", null, e);
					state.viewsDone[id] = true;
					return;
				}
			}
			viewDone();
			if (!view || numberOrNull(view.id) == null) {
				throw SchemaError("baserow_error", "Baserow did not create the view " + table.name + "." + spec.name + ".");
			}
			view.filters = [];
			view.sortings = [];
			view.group_bys = [];
			this.created.views.push({ table: table.key, name: spec.name, id: numberOrNull(view.id) });
			if (!this.ours(table.key)) {
				state.ownViews[id] = true;
				this.track("views", { id: numberOrNull(view.id), table: table.key });
			}
			own = true;
		}
		var viewId = numberOrNull(view.id);
		state.views[id] = viewId;
		var run = this;
		var filters = view.filters != null ? list(view.filters) : (viewId > 0 ? list(this.api.listViewFilters(viewId)) : []);
		var sortings = view.sortings != null ? list(view.sortings) : (viewId > 0 ? list(this.api.listViewSorts(viewId)) : []);
		var groupBys = [];
		if (spec.groupBys.length) {
			groupBys = view.group_bys != null ? list(view.group_bys) : (viewId > 0 ? list(this.api.listViewGroupBys(viewId)) : []);
		}
		// a view of the user: what it held before any write, so that the rollback deletes only what this run adds
		var snapshot = null;
		if (!own && state.before != null && viewId > 0) {
			state.before.items = state.before.items || {};
			snapshot = state.before.items["v:" + viewId];
			if (!snapshot) {
				snapshot = state.before.items["v:" + viewId] = {
					filters: filters.map(function (f) { return numberOrNull(f && f.id); }),
					sorts: sortings.map(function (s) { return numberOrNull(s && s.id); }),
					groupBys: groupBys.map(function (g) { return numberOrNull(g && g.id); })
				};
			}
		}
		if (own) {
			spec.filterGroups.forEach(function (group) {
				var groupId = id + "." + group.key;
				if (state.filterGroups[groupId] != null) {
					return;
				}
				var groupBody = { filter_type: group.filterType };
				if (group.parent != null) {
					groupBody.parent_group = run.requireId(state.filterGroups[id + "." + group.parent], "The filter group " + group.parent);
				}
				run.action("create_view_filter_group", { table: table.key, view: spec.key, group: group.key, filterType: group.filterType });
				var made = run.api.createFilterGroup(viewId, groupBody);
				if (!made || numberOrNull(made.id) == null) {
					throw SchemaError("baserow_error", "Baserow did not create a filter group of the view " + table.name + "." + spec.name + ".");
				}
				state.filterGroups[groupId] = numberOrNull(made.id);
			});
		}
		spec.filters.forEach(function (filter) {
			if (filter.group != null && !own) {
				run.warn("view_filter_group", "The view " + table.name + "." + spec.name + " exists: a filter of a group is not added to it.", { table: table.key, view: spec.key });
				return;
			}
			var fieldId = run.requireId(run.fieldId(table.key, filter.field), "The field " + table.key + "." + filter.field);
			var value = run.filterValue(table, filter, "the view " + table.name + "." + spec.name);
			if (value == null) {
				return;
			}
			var group = filter.group != null ? run.requireId(state.filterGroups[id + "." + filter.group], "The filter group " + filter.group) : null;
			if (filters.some(function (f) {
				return numberOrNull(f.field) === fieldId && text(f.type) === filter.type && text(f.value) === text(value) && numberOrNull(f.group) === group;
			})) {
				return;
			}
			var filterBody = { field: fieldId, type: filter.type, value: value };
			if (group != null) {
				filterBody.group = group;
			}
			run.action("create_view_filter", { table: table.key, view: spec.key, field: filter.field, filterType: filter.type });
			filters.push(run.api.createViewFilter(viewId, filterBody));
		});
		spec.sorts.forEach(function (sort) {
			var fieldId = run.requireId(run.fieldId(table.key, sort.field), "The field " + table.key + "." + sort.field);
			if (sortings.some(function (s) { return numberOrNull(s.field) === fieldId; })) {
				return;
			}
			run.action("create_view_sort", { table: table.key, view: spec.key, field: sort.field, order: sort.order });
			sortings.push(run.api.createViewSort(viewId, { field: fieldId, order: sort.order }));
		});
		spec.groupBys.forEach(function (groupBy) {
			var fieldId = run.requireId(run.fieldId(table.key, groupBy.field), "The field " + table.key + "." + groupBy.field);
			if (groupBys.some(function (g) { return numberOrNull(g.field) === fieldId; })) {
				return;
			}
			run.action("create_view_group_by", { table: table.key, view: spec.key, field: groupBy.field, order: groupBy.order });
			groupBys.push(run.api.createViewGroupBy(viewId, { field: fieldId, order: groupBy.order }));
		});
		// the colors of the rows: a view of this run only, each decoration once (state.decorations)
		if (own) {
			list(spec.decorations).forEach(function (decoration, d) {
				var decorationId = id + "#" + d;
				if (state.decorations[decorationId] != null) {
					return;
				}
				var conf = run.decorationConf(table, decoration);
				if (conf == null) {
					return;
				}
				run.action("create_view_decoration", { table: table.key, view: spec.key, decorationType: decoration.type, provider: decoration.provider });
				var made;
				try {
					made = run.api.createViewDecoration(viewId, { type: decoration.type, value_provider_type: decoration.provider, value_provider_conf: conf });
				} catch (e) {
					if (!featureNotAvailable(e)) {
						throw e;
					}
					// the colors of the rows are a paid feature of the account: left out, the view stays
					state.decorations[decorationId] = -1;
					run.skipPaid(table, spec, "decoration", null, e);
					return;
				}
				state.decorations[decorationId] = numberOrNull(made && made.id) != null ? numberOrNull(made.id) : 0;
			});
		}
		// hidden columns, their order and width: a view of this run only
		if (own && spec.fieldOptions.length) {
			var fieldOptions = {};
			spec.fieldOptions.forEach(function (item) {
				var options = {};
				Object.keys(item.options).forEach(function (key) {
					options[key] = item.options[key];
				});
				// a field of a form: when it is shown, its component, the options of a select it offers
				var form = item.form;
				if (form) {
					[["showWhenMatchingConditions", "show_when_matching_conditions"], ["conditionType", "condition_type"],
						["fieldComponent", "field_component"], ["includeAllSelectOptions", "include_all_select_options"]].forEach(function (names) {
						if (form[names[0]] != null) {
							options[names[1]] = form[names[0]];
						}
					});
					if (form.allowedSelectOptions) {
						options.allowed_select_options = form.allowedSelectOptions.map(function (option) {
							return run.requireId(state.options[table.key + "." + item.field + "." + option], "The option " + option);
						});
					}
				}
				fieldOptions["" + run.requireId(run.fieldId(table.key, item.field), "The field " + table.key + "." + item.field)] = options;
			});
			run.action("update_view_field_options", { table: table.key, view: spec.key, fields: spec.fieldOptions.length });
			var written = true;
			try {
				run.api.updateFieldOptions(viewId, { field_options: fieldOptions });
			} catch (e) {
				if (!featureNotAvailable(e)) {
					throw e;
				}
				written = false;
				run.skipPaid(table, spec, "fieldOptions", null, e);
			}
			if (written) {
				run.formConditions(table, spec, viewId);
			}
		}
		if (snapshot) {
			[["filters", filters, snapshot.filters], ["sorts", sortings, snapshot.sorts], ["groupBys", groupBys, snapshot.groupBys]].forEach(function (kind) {
				kind[1].forEach(function (item) {
					var itemId = numberOrNull(item && item.id);
					if (itemId != null && list(kind[2]).indexOf(itemId) === -1) {
						run.track(kind[0], { id: itemId, table: table.key });
					}
				});
			});
		}
		state.viewsDone[id] = true;
	};

	// The conditions that show the fields of a form (a form of this run): written with the field options, one write per
	// level of groups (Baserow takes a new group of conditions under a group it already has only), new conditions and
	// groups with ids of their own (negative), the ids Baserow gives them read back for the next level. Each write names
	// every condition and group of its fields: what it does not name is deleted, so that a view made again holds them once.
	Run.prototype.formConditions = function (table, spec, viewId) {
		var run = this;
		var items = spec.fieldOptions.filter(function (item) {
			return item.form && (item.form.conditions.length || item.form.conditionGroups.length);
		});
		if (!items.length) {
			return;
		}
		var depths = {};
		var maxDepth = 0;
		items.forEach(function (item) {
			var depth = {};
			item.form.conditionGroups.forEach(function (group) {
				depth["k:" + group.key] = group.parent != null ? depth["k:" + group.parent] + 1 : 0;
				maxDepth = Math.max(maxDepth, depth["k:" + group.key]);
			});
			depths[item.field] = depth;
		});
		var known = {};
		var next = -1;
		for (var level = 0; level <= maxDepth; level++) {
			var body = {};
			var made = {};
			items.forEach(function (item) {
				var fieldId = "" + run.requireId(run.fieldId(table.key, item.field), "The field " + table.key + "." + item.field);
				var depth = depths[item.field];
				var ids = known[fieldId] || (known[fieldId] = { groups: {}, conditions: {} });
				var fresh = { groups: [], conditions: [] };
				var temp = {};
				var groups = [];
				item.form.conditionGroups.forEach(function (group) {
					if (depth["k:" + group.key] > level) {
						return;
					}
					var parent = group.parent != null ? run.requireId(ids.groups["k:" + group.parent], "The group of conditions " + group.parent) : null;
					var groupId = ids.groups["k:" + group.key];
					if (groupId == null) {
						groupId = temp["k:" + group.key] = next--;
						fresh.groups.push(group.key);
					}
					groups.push({ id: groupId, filter_type: group.filterType, parent_group: parent });
				});
				var conditions = [];
				item.form.conditions.forEach(function (condition, c) {
					if (condition.group != null && depth["k:" + condition.group] > level) {
						return;
					}
					var value = run.filterValue(table, condition, "a condition of " + table.name + "." + spec.name + "." + item.field);
					if (value == null) {
						return;
					}
					var group = null;
					if (condition.group != null) {
						group = ids.groups["k:" + condition.group] != null ? ids.groups["k:" + condition.group] : temp["k:" + condition.group];
					}
					var conditionId = ids.conditions["c" + c];
					if (conditionId == null) {
						conditionId = next--;
						fresh.conditions.push(c);
					}
					conditions.push({
						id: conditionId, field: run.requireId(run.fieldId(table.key, condition.field), "The field " + table.key + "." + condition.field),
						type: condition.type, value: value, group: group
					});
				});
				body[fieldId] = { condition_groups: groups, conditions: conditions };
				made[fieldId] = fresh;
			});
			run.action("update_form_conditions", { table: table.key, view: spec.key, level: level });
			var answer;
			try {
				answer = run.api.updateFieldOptions(viewId, { field_options: body }) || {};
			} catch (e) {
				if (!featureNotAvailable(e)) {
					throw e;
				}
				// the conditions of a form are a paid feature of the account: left out, the fields always shown
				run.skipPaid(table, spec, "fieldOptions", null, e);
				return;
			}
			// the ids Baserow gave the new ones: those it did not have, in the order they were written
			Object.keys(made).forEach(function (fieldId) {
				var got = (answer.field_options || {})[fieldId] || {};
				var ids = known[fieldId];
				var newIds = function (items2, knownIds) {
					return list(items2).map(function (o) { return numberOrNull(o && o.id); })
						.filter(function (o) { return o != null && knownIds.indexOf(o) === -1; })
						.sort(function (a, b) { return a - b; });
				};
				var groupIds = newIds(got.condition_groups, Object.keys(ids.groups).map(function (k) { return ids.groups[k]; }));
				var conditionIds = newIds(got.conditions, Object.keys(ids.conditions).map(function (k) { return ids.conditions[k]; }));
				if (groupIds.length !== made[fieldId].groups.length || conditionIds.length !== made[fieldId].conditions.length) {
					throw SchemaError("baserow_error", "Baserow did not keep the conditions of a field of the form " + table.name + "." + spec.name + ".");
				}
				made[fieldId].groups.forEach(function (key, i) {
					ids.groups["k:" + key] = groupIds[i];
				});
				made[fieldId].conditions.forEach(function (c, i) {
					ids.conditions["c" + c] = conditionIds[i];
				});
			});
		}
	};

	// exactViews: the views Baserow made with a table of this run (its "Grid") that the schema does not name, deleted
	// once the views of the schema exist.
	Run.prototype.cleanViews = function (table) {
		var state = this.state;
		if (state.viewsCleaned[table.key]) {
			return;
		}
		var auto = list(state.autoViews[table.key]);
		var tableId = numberOrNull(state.tables[table.key]);
		// (only once a view of the schema is in the table: a table keeps a view when Baserow refused all of them)
		var made = table.views.some(function (view) { return state.views[table.key + "." + view.key] != null; });
		if (auto.length && tableId > 0 && this.ours(table.key) && made) {
			var names = table.views.map(function (v) { return lower(v.name); });
			var run = this;
			list(this.api.listViews(tableId)).forEach(function (view) {
				var viewId = numberOrNull(view && view.id);
				if (auto.indexOf(viewId) !== -1 && names.indexOf(lower(view.name)) === -1) {
					run.action("delete_view", { table: table.key, viewId: viewId, name: text(view.name) });
					run.api.deleteView(viewId);
				}
			});
		}
		state.viewsCleaned[table.key] = true;
	};

	// The value of options.files for a file key: {path} (a file of the transfer folder, uploaded by the step) or
	// {name, visible_name} (already uploaded by the caller with mode upload).
	function fileEntry(options, key) {
		var files = options && options.files;
		if (!files || typeof files !== "object" || Array.isArray(files) || !Object.prototype.hasOwnProperty.call(files, key)) {
			return null;
		}
		var entry = files[key];
		return entry && typeof entry === "object" && !Array.isArray(entry) ? entry : null;
	}

	// The limits of the files of a run: maxFileBytes and maxFilesBytes may lower them, never raise them.
	function fileCaps(options) {
		return {
			file: Math.min(numberOrNull(options.maxFileBytes) || FILE_MAX_BYTES, FILE_MAX_BYTES),
			files: Math.min(numberOrNull(options.maxFilesBytes) || FILES_MAX_BYTES, FILES_MAX_BYTES)
		};
	}

	// The size of a file given by its name (uploaded by the caller): the size it tells, else the size of the schema,
	// never below 0.
	function givenSize(entry, file) {
		var size = numberOrNull(entry.size);
		return Math.max(0, size != null ? size : (file.size || 0));
	}

	// The files the rows name, checked before any step: each one given (options.files), a file of the transfer folder
	// or a name of Baserow, at most maxFileBytes (10 MB) each and maxFilesBytes (30 MB) in all.
	function checkFiles(schema, state, options, fileOf) {
		var keys = schemaFiles(schema, state.sampleData);
		if (!keys.length) {
			return;
		}
		var caps = fileCaps(options);
		var maxFile = caps.file;
		var maxFiles = caps.files;
		var total = 0;
		keys.forEach(function (key) {
			var file = schema.fileByKey["k:" + key];
			var size;
			if (state.files[key] != null) {
				size = Math.max(0, numberOrNull(state.files[key].size) || 0);
			} else {
				var entry = fileEntry(options, key);
				if (!entry) {
					throw SchemaError("file_missing", "The rows name the file " + file.visibleName + " (" + key + "), missing from options.files.", { file: file.visibleName, key: key });
				}
				if (entry.name != null) {
					if (!FILE_NAME.test(text(entry.name))) {
						throw SchemaError("file_invalid", "The name given for the file " + file.visibleName + " is not a name of an uploaded file.", { file: file.visibleName, key: key });
					}
					size = givenSize(entry, file);
				} else {
					var local = fileOf(text(entry.path));
					if (!local) {
						throw SchemaError("file_invalid", "The file " + file.visibleName + " is not a file of the transfer folder.", { file: file.visibleName, key: key });
					}
					size = local.size;
				}
			}
			if (size > maxFile) {
				throw SchemaError("file_too_large", "The file " + file.visibleName + " holds " + size + " bytes, " + maxFile + " at most.", { file: file.visibleName, key: key, bytes: size, max: maxFile });
			}
			total += size;
			if (total > maxFiles) {
				throw SchemaError("files_too_large", "With the file " + file.visibleName + " the files hold " + total + " bytes, " + maxFiles + " at most.", { file: file.visibleName, key: key, bytes: total, max: maxFiles });
			}
		});
	}

	// A file the rows name, before the rows: uploaded from the transfer folder ({path}), or the name the caller got
	// from mode upload ({name}). state.files keeps its name, so that a step run again uploads nothing again.
	Run.prototype.uploadFile = function (key) {
		var state = this.state;
		if (state.files[key] != null) {
			return;
		}
		var file = this.schema.fileByKey["k:" + key];
		if (this.plan) {
			this.action("upload_file", { file: key, visibleName: file.visibleName });
			state.files[key] = { name: "", visible_name: file.visibleName, size: file.size };
			return;
		}
		var entry = fileEntry(this.options, key);
		if (!entry) {
			throw SchemaError("file_missing", "The rows name the file " + file.visibleName + " (" + key + "), missing from options.files.", { file: file.visibleName, key: key });
		}
		if (entry.name != null) {
			if (!FILE_NAME.test(text(entry.name))) {
				throw SchemaError("file_invalid", "The name given for the file " + file.visibleName + " is not a name of an uploaded file.", { file: file.visibleName, key: key });
			}
			state.files[key] = { name: text(entry.name), visible_name: text(entry.visible_name) || file.visibleName, size: givenSize(entry, file) };
			return;
		}
		var local = this.fileOf(text(entry.path));
		if (!local) {
			throw SchemaError("file_invalid", "The file " + file.visibleName + " is not a file of the transfer folder.", { file: file.visibleName, key: key });
		}
		// its size again, as it is now (checkFiles counted it before the first step)
		var maxFile = fileCaps(this.options).file;
		if (!(local.size >= 0) || local.size > maxFile) {
			throw SchemaError("file_too_large", "The file " + file.visibleName + " holds " + local.size + " bytes, " + maxFile + " at most.", { file: file.visibleName, key: key, bytes: local.size, max: maxFile });
		}
		this.action("upload_file", { file: key, visibleName: file.visibleName, size: local.size });
		var uploaded = this.api.uploadFile(local.path) || {};
		if (!FILE_NAME.test(text(uploaded.name))) {
			throw SchemaError("baserow_error", "Baserow gave no name for the file " + file.visibleName + ".");
		}
		state.files[key] = { name: text(uploaded.name), visible_name: file.visibleName || text(uploaded.visible_name), size: local.size, uploaded: true };
		this.created.files++;
	};

	// The number of rows of a table (one row read).
	function rowCount(api, tableId) {
		var count = numberOrNull((api.listRows(tableId, 1, 1) || {}).count);
		if (count == null) {
			throw SchemaError("baserow_error", "Baserow did not answer the number of rows of a table.");
		}
		return count;
	}

	// The ids of the rows of a table at the positions start to start + n - 1, in the order of the rows (a batch written
	// last is at its end).
	function rowIdsAt(api, tableId, start, n) {
		var ids = [];
		var last = Math.floor((start + n - 1) / ROWS_PAGE) + 1;
		for (var page = Math.floor(start / ROWS_PAGE) + 1; page <= last; page++) {
			list((api.listRows(tableId, page, ROWS_PAGE) || {}).results).forEach(function (row, i) {
				var at = (page - 1) * ROWS_PAGE + i;
				if (at >= start && at < start + n) {
					ids.push(numberOrNull(row && row.id));
				}
			});
		}
		return ids;
	}

	// Rows this run made in a table of the user: deleted by the rollback.
	Run.prototype.recordRows = function (table, tableId, rowIds) {
		var state = this.state;
		if (this.ours(table.key) || !state.undo) {
			return;
		}
		state.undo.rows = list(state.undo.rows);
		var entry = state.undo.rows.filter(function (e) { return e && e.table === table.key; })[0];
		if (!entry) {
			entry = { table: table.key, tableId: tableId, ids: [] };
			state.undo.rows.push(entry);
		}
		rowIds.forEach(function (rowId) {
			if (rowId != null && entry.ids.indexOf(rowId) === -1) {
				entry.ids.push(rowId);
			}
		});
	};

	// The rows of a table already in the base, by the value of their upsertKey field.
	Run.prototype.existingRows = function (table) {
		if (this.reader.rows[table.key]) {
			return this.reader.rows[table.key];
		}
		var tableId = this.state.tables[table.key];
		var fieldId = this.fieldId(table.key, table.upsertKey);
		var index = {};
		if (tableId > 0 && fieldId > 0) {
			for (var page = 1; page <= 50; page++) {
				var answer = this.api.listRows(tableId, page, ROWS_PAGE) || {};
				var rows = list(answer.results);
				rows.forEach(function (row) {
					var value = row["field_" + fieldId];
					var key = text(value && typeof value === "object" ? value.value : value);
					if (key.length && index[key] == null) {
						index[key] = numberOrNull(row.id);
					}
				});
				if (rows.length < ROWS_PAGE || answer.next == null || answer.next === "") {
					break;
				}
			}
		}
		this.reader.rows[table.key] = index;
		return index;
	};

	Run.prototype.rowItem = function (table, row, deferred) {
		var state = this.state;
		var run = this;
		var item = {};
		Object.keys(row.values).forEach(function (key) {
			var field = findField(table, key);
			var value = row.values[key];
			var fieldId = run.requireId(run.fieldId(table.key, key), "The field " + table.key + "." + key);
			if (field.type === "link_row") {
				if (deferred.indexOf(key) !== -1) {
					return;
				}
				value = value.map(function (target) {
					var targetIds = state.rowIds[field.targetTable] || {};
					return run.requireId(targetIds[target], "The row " + target + " of " + field.targetTable);
				});
			} else if (field.type === "single_select") {
				value = value == null || value === "" ? null : run.requireId(state.options[table.key + "." + key + "." + value], "The option " + value);
			} else if (field.type === "multiple_select") {
				value = value.map(function (option) {
					return run.requireId(state.options[table.key + "." + key + "." + option], "The option " + option);
				});
			} else if (field.type === "file") {
				// the name Baserow gave the file uploaded by this run (phase files), the name shown in the cell
				value = value.map(function (item) {
					var uploaded = run.requireId(state.files[item.file], "The file " + item.file);
					return { name: uploaded.name, visible_name: item.visibleName || uploaded.visible_name };
				});
			}
			item["field_" + fieldId] = value;
		});
		return item;
	};

	Run.prototype.createRows = function (table, from, to) {
		var state = this.state;
		var tableId = this.requireId(state.tables[table.key], "The table " + table.key);
		state.rowIds[table.key] = state.rowIds[table.key] || {};
		var ids = state.rowIds[table.key];
		var markId = table.key + "#" + from;
		var mark = state.rowMarks[markId];
		if (mark && list(mark.keys).length && !this.plan) {
			// this batch was written before, its answer lost (the step failed after it), or never: by the number of rows
			var now = rowCount(this.api, tableId);
			if (now === mark.count + mark.keys.length) {
				var found = rowIdsAt(this.api, tableId, mark.count, mark.keys.length);
				if (found.length === mark.keys.length && found.every(function (rowId) { return rowId != null; })) {
					mark.keys.forEach(function (key, i) {
						ids[key] = found[i];
					});
					this.recordRows(table, tableId, found);
				}
			} else if (now !== mark.count) {
				this.warn("rows_uncertain", "The rows of " + table.name + " changed during the import: a batch is written again.", { table: table.key });
			}
			delete state.rowMarks[markId];
			this.unpendRows(markId);
		}
		var todo = table.rows.slice(from, to).filter(function (row) { return ids[row.key] == null; });
		if (!todo.length) {
			state.rowsDone[table.key] = table.rows.filter(function (row) { return ids[row.key] != null; }).length;
			return;
		}
		// rows keyed by their own key are never looked for by value: they are new rows of a new base
		var existing = table.keyed ? {} : this.existingRows(table);
		var deferred = deferredLinks(this.schema, table);
		var items = [];
		var keys = [];
		var run = this;
		var userTable = !this.ours(table.key);
		todo.forEach(function (row) {
			if (existing[row.key] != null) {
				ids[row.key] = existing[row.key];
				// a row of the user found by its key: its links are not written over (linkRows)
				if (userTable) {
					state.matchedRows[table.key] = list(state.matchedRows[table.key]).concat([row.key]);
				}
				return;
			}
			items.push(run.rowItem(table, row, deferred));
			keys.push(row.key);
		});
		if (items.length) {
			this.action("create_rows", { table: table.key, tableId: tableId, count: items.length, upsertKey: table.upsertKey });
			var before = this.plan ? 0 : rowCount(this.api, tableId);
			state.rowMarks[markId] = { count: before, keys: keys };
			if (userTable && state.undo && !this.plan) {
				state.undo.pending = list(state.undo.pending).concat([{ kind: "rows", table: table.key, tableId: tableId, count: before, size: items.length, mark: markId }]);
			}
			var created = list(this.api.createRows(tableId, items));
			delete state.rowMarks[markId];
			this.unpendRows(markId);
			if (created.length !== items.length) {
				throw SchemaError("baserow_error", "Baserow created " + created.length + " rows of " + items.length + " in " + table.name + ".");
			}
			created.forEach(function (row, i) {
				ids[keys[i]] = numberOrNull(row.id);
				existing[keys[i]] = numberOrNull(row.id);
			});
			this.created.rows += items.length;
			// rows made in a table of the user: deleted by the rollback
			this.recordRows(table, tableId, created.map(function (row) { return numberOrNull(row.id); }));
		}
		state.rowsDone[table.key] = table.rows.filter(function (row) { return ids[row.key] != null; }).length;
	};

	// The links of a cycle, written once the rows of both tables exist.
	Run.prototype.linkRows = function (table) {
		var state = this.state;
		if (state.linksDone[table.key]) {
			return;
		}
		var tableId = this.requireId(state.tables[table.key], "The table " + table.key);
		var deferred = deferredLinks(this.schema, table);
		var run = this;
		var items = [];
		var matched = list(state.matchedRows[table.key]);
		table.rows.forEach(function (row) {
			if (matched.indexOf(row.key) !== -1) {
				return;
			}
			var values = {};
			deferred.forEach(function (key) {
				if (row.values[key] != null) {
					values[key] = row.values[key];
				}
			});
			if (!Object.keys(values).length) {
				return;
			}
			var item = run.rowItem(table, { key: row.key, values: values }, []);
			item.id = run.requireId((state.rowIds[table.key] || {})[row.key], "The row " + row.key + " of " + table.key);
			items.push(item);
		});
		for (var from = 0; from < items.length; from += ROWS_PER_BATCH) {
			this.action("link_rows", { table: table.key, tableId: tableId, count: Math.min(ROWS_PER_BATCH, items.length - from) });
			this.api.updateRows(tableId, items.slice(from, from + ROWS_PER_BATCH));
		}
		state.linksDone[table.key] = true;
	};

	// ---- api wrappers ----------------------------------------------------------------------------------------------

	// Counts the calls of an api (the budget of a step).
	function counted(api, counter) {
		var out = { online: api.online !== false };
		Object.keys(api).forEach(function (name) {
			if (typeof api[name] === "function") {
				out[name] = function () {
					counter.calls++;
					return api[name].apply(api, arguments);
				};
			}
		});
		return out;
	}

	var WRITES = ["createWorkspace", "createDatabase", "createTable", "createField", "updateField", "createView",
		"createViewFilter", "createViewSort", "createRows", "updateRows", "deleteApplication", "emptyTrash",
		"createFilterGroup", "createViewGroupBy", "updateFieldOptions", "deleteView", "uploadFile", "createViewDecoration"];
	var READS = ["listWorkspaces", "getApplication", "listTables", "listFields", "listViews", "listViewFilters",
		"listViewSorts", "listViewGroupBys", "listViewDecorations", "listRows", "getJob"];

	// The api of a plan: the reads go to Baserow when an api is given (what exists is reported), the writes only answer
	// made-up negative ids.
	function planApi(api) {
		var next = 0;
		var out = { online: !!api };
		READS.forEach(function (name) {
			out[name] = function () {
				if (!api) {
					return name === "listRows" ? { results: [] } : (name === "getApplication" || name === "getJob" ? null : []);
				}
				return api[name].apply(api, arguments);
			};
		});
		WRITES.forEach(function (name) {
			out[name] = function (a, b) {
				next++;
				if (name === "createRows") {
					return b.map(function () { next++; return { id: -next }; });
				}
				var body = b && typeof b === "object" && !Array.isArray(b) ? b : {};
				var made = { id: -next, name: body.name != null ? body.name : (typeof b === "string" ? b : "") };
				if (body.select_options) {
					made.select_options = body.select_options.map(function (o) { next++; return { id: -next, value: o.value }; });
				}
				if (name === "createField" && body.type === "link_row" && body.has_related_field !== false) {
					next++;
					made.link_row_related_field_id = -next;
				}
				return made;
			};
		});
		return out;
	}

	// ---- public functions ------------------------------------------------------------------------------------------

	// The error of an answer: its code, its message, and what it is about (a table, a field, a file, a limit).
	function errorOf(e) {
		var out = {
			code: text(e && e.code) || "baserow_schema_apply_failed",
			message: text(e && e.message ? e.message : e)
		};
		// what it is about, and the code of a refusal of Baserow (ERROR_...)
		["table", "field", "view", "file", "key", "count", "bytes", "max", "baserowError"].forEach(function (key) {
			if (e && e[key] != null && (typeof e[key] === "string" || typeof e[key] === "number")) {
				out[key] = e[key];
			}
		});
		return out;
	}

	function progress(list, state) {
		var current = list[Math.min(state.cursor, list.length - 1)];
		return { cursor: state.cursor, total: list.length - 1, phase: current.phase, done: state.done };
	}

	// One bounded step: runs units from state.cursor until done or the budget (maxCalls Baserow calls, maxMillis) is
	// spent, at least one unit. Never throws: an error comes back with the state as it is after the units that ran
	// (a base created before the error is in it, for the rollback).
	// fileOf(path): a file of the transfer folder {path, size, name}, or null (the files of options.files).
	function step(rawSchema, rawState, api, rawOptions, fileOf) {
		var options = parseJson(rawOptions, "options", {}) || {};
		var schema;
		var state;
		var plan;
		var files = fileOf || function () { return null; };
		try {
			schema = normalizeSchema(rawSchema);
			state = readState(rawState, schema, options);
			plan = units(schema, { sampleData: state.sampleData, exactViews: state.exactViews });
			if (!state.done) {
				checkFiles(schema, state, options, files);
			}
		} catch (e) {
			var refusal = { status: "error", error: errorOf(e), retryable: false, state: parseJson(rawState, "state", null) };
			if (e && /^files?_too_large$/.test(text(e.code))) {
				refusal.refused = true;
			}
			return refusal;
		}
		var counter = { calls: 0 };
		var run = new Run(schema, state, counted(api, counter), options, false, files);
		var maxCalls = numberOrNull(options.maxCalls) || 40;
		var maxMillis = numberOrNull(options.maxMillis) || 15000;
		var now = options.now || function () { return new Date().getTime(); };
		var start = now();
		var ran = 0;
		try {
			while (state.cursor < plan.length - 1 && (ran === 0 || (counter.calls < maxCalls && now() - start < maxMillis))) {
				run.unit(plan[state.cursor]);
				state.cursor++;
				ran++;
				state.phase = plan[state.cursor].phase;
			}
			state.done = state.cursor >= plan.length - 1;
		} catch (e) {
			state.phase = plan[state.cursor].phase;
			return {
				status: "error", error: errorOf(e), retryable: e && e.retryable === true, state: state, map: map(state),
				progress: progress(plan, state), actions: run.actions, created: run.created, calls: counter.calls,
				omittedViews: list(state.omittedViews)
			};
		}
		return {
			status: state.done ? "done" : "running", state: state, map: map(state), progress: progress(plan, state),
			actions: run.actions, created: run.created, calls: counter.calls, warnings: state.warnings,
			omittedViews: list(state.omittedViews)
		};
	}

	// All the steps in one call (the tool's apply): stops at the first error, the state of the answer tells what exists.
	function apply(rawSchema, rawState, api, rawOptions, fileOf) {
		var options = parseJson(rawOptions, "options", {}) || {};
		var stepOptions = {};
		Object.keys(options).forEach(function (key) {
			stepOptions[key] = options[key];
		});
		stepOptions.maxCalls = 1000000;
		stepOptions.maxMillis = numberOrNull(options.maxMillis) || 280000;
		var state = rawState;
		var actions = [];
		var created = { workspaces: [], bases: [], tables: [], fields: [], views: [], rows: 0, files: 0 };
		var answer;
		for (var i = 0; i < 1000; i++) {
			answer = step(rawSchema, state, api, stepOptions, fileOf);
			actions = actions.concat(answer.actions || []);
			if (answer.created) {
				Object.keys(created).forEach(function (key) {
					created[key] = key === "rows" || key === "files" ? created[key] + (answer.created[key] || 0) : created[key].concat(answer.created[key]);
				});
			}
			if (answer.status !== "running") {
				break;
			}
			state = answer.state;
		}
		answer.actions = actions;
		answer.created = created;
		return answer;
	}

	// What apply would do, without any write: offline without api, else the reads of the user's base report what exists.
	function plan(rawSchema, api, rawOptions) {
		var options = parseJson(rawOptions, "options", {}) || {};
		try {
			var schema = normalizeSchema(rawSchema);
			var state = newState(schema, options);
			var run = new Run(schema, state, planApi(api || null), options, true);
			var list = units(schema, options);
			for (var i = 0; i < list.length - 1; i++) {
				run.unit(list[i]);
			}
			var summary = { tables: schema.tables.length, fields: 0, links: 0, computed: 0, views: 0, rows: 0 };
			list.forEach(function (unit) {
				if (unit.phase === "fields" || unit.phase === "links" || unit.phase === "computed") {
					summary[unit.phase]++;
				}
				if (unit.phase === "views" && !unit.cleanup) {
					summary.views++;
				}
				if (unit.phase === "files") {
					summary.files = (summary.files || 0) + 1;
				}
				if (unit.phase === "rows") {
					summary.rows += unit.to - unit.from;
				}
			});
			return { status: "ok", mode: "plan", actions: run.actions, warnings: state.warnings, summary: summary, units: list.length - 1 };
		} catch (e) {
			return { status: "error", mode: "plan", error: errorOf(e), retryable: e && e.retryable === true };
		}
	}

	// Deletes for good a base this run created: to the trash, then the trash of this base emptied. Only a base of the
	// workspace given (read again before the delete).
	// js/common.js resolveTableId keeps, for the whole project, the Baserow id of a table by its path
	// "workspace~>base~>table" (key "<user scope>~>workspace~>base~>table"). A base deleted then created again with the
	// same names (a template pack uninstalled then installed again) would get the ids of the deleted tables: the paths of
	// a base are forgotten when it is created or deleted here.
	function forgetTablePaths(workspaceName, baseName) {
		if (typeof context == "undefined" || context == null || context.project == null || !text(workspaceName).length || !text(baseName).length) {
			return 0;
		}
		var cache = context.project.get("table_id_cache");
		if (cache == null) {
			return 0;
		}
		var infix = "~>" + text(workspaceName) + "~>" + text(baseName) + "~>";
		// a copy of the keys: the map is changed below
		var keys = cache.keySet().toArray();
		var forgotten = 0;
		for (var i = 0; i < keys.length; i++) {
			var key = "" + keys[i];
			var at = key.lastIndexOf(infix);
			if (at >= 0 && key.indexOf("~>", at + infix.length) == -1) {
				cache.remove(keys[i]);
				forgotten++;
			}
		}
		return forgotten;
	}

	function deleteBase(api, baseId, workspaceId) {
		var id = numberOrNull(baseId);
		var workspace = numberOrNull(workspaceId);
		if (id == null || workspace == null) {
			throw SchemaError("delete_refused", "A base id and its workspace id are required.");
		}
		var application = api.getApplication(id);
		var owner = application && (application.workspace || application.group) || {};
		if (!application || text(application.type) !== "database" || numberOrNull(owner.id) !== workspace) {
			throw SchemaError("delete_refused", "The base " + id + " is not a base of the workspace " + workspace + ".");
		}
		api.deleteApplication(id);
		api.emptyTrash(workspace, id);
		forgetTablePaths(text(owner.name), text(application.name));
		return { status: "deleted", baseId: id, workspaceId: workspace };
	}

	// ---- rollback of a run in a base that existed --------------------------------------------------------------------

	// The most rows of one delete (a Baserow batch call holds 200 rows at most).
	var DELETE_ROWS = 200;

	// What a run made in a base that existed (state.undo) deleted, never anything else: the rows it made in tables of
	// the user, the filters, sorts and group bys it added to their views, the views it made there, the options it added
	// to their select fields (the field keeps the options it had), the fields it added to their tables, then the tables
	// it made. Bounded like a step (options.maxCalls, options.maxMillis): status running with the state to give again,
	// then undone. What is already gone is skipped; an error of Baserow on one item is listed (errors) and the others
	// go on; a retryable error stops with the state, to call again. What Baserow deletes goes to the trash of the
	// workspace, which Baserow empties by itself: emptying it here would also delete what the user put there.
	function undoRun(api, rawState, rawOptions) {
		var options = parseJson(rawOptions, "options", {}) || {};
		var state = parseJson(rawState, "state", null) || {};
		if (state.createdBase === true || !undoCount(state.undo)) {
			return { status: "nothing", mode: "rollback", message: "This state made nothing to undo." };
		}
		var undo = state.undo;
		var counter = { calls: 0 };
		var calls = counted(api, counter);
		var maxCalls = numberOrNull(options.maxCalls) || 1000000;
		var maxMillis = numberOrNull(options.maxMillis) || 240000;
		var now = options.now || function () { return new Date().getTime(); };
		var start = now();
		var removed = state.undoRemoved && typeof state.undoRemoved === "object" ? state.undoRemoved
			: { tables: 0, fields: 0, options: 0, views: 0, filters: 0, sorts: 0, groupBys: 0, rows: 0 };
		var errors = list(state.undoErrors);
		// at least one call, then within the budget
		var left = function () {
			return counter.calls === 0 || (counter.calls < maxCalls && now() - start < maxMillis);
		};
		var gone = function (e) {
			return /_DOES_NOT_EXIST$/.test(text(e && e.baserowError));
		};
		var fail = function (kind, id, e) {
			if (e && e.retryable === true) {
				throw e;
			}
			errors.push({ kind: kind, id: id, code: text(e && (e.baserowError || e.code)), message: text(e && e.message ? e.message : e).substring(0, 300) });
		};
		// only what is in the base of the state, a base of the workspace of the state: a state that names anything else
		// deletes nothing of it
		var scope = null;
		var inBase = function () {
			if (!scope) {
				var application = calls.getApplication(state.baseId);
				var owner = application && (application.workspace || application.group) || {};
				if (!application || text(application.type) !== "database" || numberOrNull(owner.id) !== numberOrNull(state.workspaceId)) {
					throw SchemaError("delete_refused", "The base " + state.baseId + " is not a base of the workspace " + state.workspaceId + ".");
				}
				scope = { tables: list(calls.listTables(state.baseId)).map(function (t) { return numberOrNull(t && t.id); }), fields: {}, views: {} };
			}
			return scope;
		};
		var tableOf = function (key) {
			var tableId = numberOrNull(state.tables && state.tables[key]);
			return tableId != null && inBase().tables.indexOf(tableId) !== -1 ? tableId : null;
		};
		var fieldsOf = function (tableId) {
			var cache = inBase().fields;
			return cache["t" + tableId] || (cache["t" + tableId] = tableId != null ? list(calls.listFields(tableId)) : []);
		};
		var viewsOf = function (tableId) {
			var cache = inBase().views;
			return cache["t" + tableId] || (cache["t" + tableId] = tableId != null ? list(calls.listViews(tableId)) : []);
		};
		var hasId = function (items, itemId) {
			return list(items).some(function (o) { return numberOrNull(o && o.id) === itemId; });
		};
		// an item of a view of a table of the base (filters, sortings or group_bys)
		var inView = function (item, attribute) {
			return viewsOf(tableOf(item.table)).some(function (view) { return hasId(view[attribute], numberOrNull(item.id)); });
		};
		var drain = function (kind, fn) {
			undo[kind] = list(undo[kind]);
			while (undo[kind].length && left()) {
				var item = undo[kind][0];
				try {
					if (fn(item) !== false) {
						removed[kind]++;
					}
				} catch (e) {
					if (!gone(e)) {
						fail(kind, item && typeof item === "object" ? item.id : item, e);
					}
				}
				undo[kind].shift();
			}
		};
		var rows = function () {
			undo.rows = list(undo.rows);
			while (undo.rows.length && left()) {
				var entry = undo.rows[0];
				entry.ids = list(entry && entry.ids);
				if (!entry.ids.length) {
					undo.rows.shift();
					continue;
				}
				var batch = entry.ids.slice(0, DELETE_ROWS);
				try {
					if (tableOf(entry.table) == null || tableOf(entry.table) !== numberOrNull(entry.tableId)) {
						throw SchemaError("delete_refused", "The rows of " + entry.table + " are not in a table of the base.");
					}
					calls.deleteRows(entry.tableId, batch);
					removed.rows += batch.length;
					entry.ids = entry.ids.slice(batch.length);
				} catch (e) {
					// rows already gone (deleted by the user): the batch again without them
					var named = text(e && e.baserowError) === "ERROR_ROW_DOES_NOT_EXIST" ? (text(e.message).match(/\d+/g) || []).map(Number) : [];
					var rest = batch.filter(function (id) { return named.indexOf(id) === -1; });
					if (rest.length < batch.length) {
						entry.ids = rest.concat(entry.ids.slice(batch.length));
						continue;
					}
					if (!gone(e)) {
						fail("rows", entry.table, e);
					}
					entry.ids = entry.ids.slice(batch.length);
				}
			}
		};
		// the writes whose answer was lost: found by their name, only when the snapshot does not hold it
		var before = state.before || {};
		var resolve = function () {
			while (list(undo.pending).length && left()) {
				var item = undo.pending[0];
				var found = null;
				if (item.kind === "rows") {
					// a batch written in a table of the user, its answer lost: its rows are the last of the table when
					// the table holds exactly that many more rows
					var rowsTable = tableOf(item.table);
					if (rowsTable != null && rowsTable === numberOrNull(item.tableId)) {
						var now = rowCount(calls, rowsTable);
						if (now === item.count + item.size) {
							var made = rowIdsAt(calls, rowsTable, item.count, item.size).filter(function (rowId) { return rowId != null; });
							var entry = list(undo.rows).filter(function (e) { return e && e.table === item.table; })[0];
							if (!entry) {
								entry = { table: item.table, tableId: rowsTable, ids: [] };
								undo.rows = list(undo.rows).concat([entry]);
							}
							made.forEach(function (rowId) {
								if (entry.ids.indexOf(rowId) === -1) {
									entry.ids.push(rowId);
								}
							});
						} else if (now !== item.count) {
							errors.push({ kind: "rows", id: item.table, code: "rows_uncertain", message: "The rows of " + item.table + " changed since the write whose answer was lost: they are left." });
						}
					}
					undo.pending.shift();
					continue;
				}
				if (item.kind === "tables") {
					found = byName(list(calls.listTables(state.baseId)), item.name);
					found = found && !existed(before.tables, found.name) ? found : null;
				} else if (item.kind === "fields" || item.kind === "views") {
					var tableId = numberOrNull(state.tables[item.table]);
					found = tableId > 0 ? byName(list(item.kind === "fields" ? calls.listFields(tableId) : calls.listViews(tableId)), item.name) : null;
					var names = item.kind === "fields"
						? list((before.fields || {})["k:" + item.table]).map(function (f) { return f && f.name; })
						: list((before.views || {})["k:" + item.table]);
					found = found && !existed(names, found.name) ? found : null;
				}
				var foundId = numberOrNull(found && found.id);
				if (foundId != null && !list(undo[item.kind]).some(function (o) { return o && o.id === foundId; })) {
					undo[item.kind] = list(undo[item.kind]).concat([{ id: foundId, table: item.table }]);
				}
				undo.pending.shift();
			}
		};
		try {
			resolve();
			rows();
			drain("filters", function (item) {
				if (!inView(item, "filters")) {
					return false;
				}
				calls.deleteViewFilter(item.id);
			});
			drain("sorts", function (item) {
				if (!inView(item, "sortings")) {
					return false;
				}
				calls.deleteViewSort(item.id);
			});
			drain("groupBys", function (item) {
				if (!inView(item, "group_bys")) {
					return false;
				}
				calls.deleteViewGroupBy(item.id);
			});
			drain("views", function (item) {
				if (!hasId(viewsOf(tableOf(item.table)), numberOrNull(item.id))) {
					return false;
				}
				calls.deleteView(item.id);
			});
			drain("options", function (item) {
				var field = fieldsOf(tableOf(item.table)).filter(function (f) { return numberOrNull(f && f.id) === item.id; })[0];
				if (!field) {
					return false;
				}
				var current = list(field.select_options);
				var keep = current.filter(function (o) { return list(item.values).indexOf(text(o && o.value)) === -1; });
				if (keep.length === current.length) {
					return false;
				}
				calls.updateField(item.id, { select_options: keep.map(function (o) { return { id: o.id, value: o.value, color: o.color }; }) });
			});
			drain("fields", function (item) {
				if (!hasId(fieldsOf(tableOf(item.table)), numberOrNull(item.id))) {
					return false;
				}
				calls.deleteField(item.id);
			});
			drain("tables", function (item) {
				if (inBase().tables.indexOf(numberOrNull(item.id)) === -1) {
					return false;
				}
				calls.deleteTable(item.id);
			});
		} catch (e) {
			state.undoRemoved = removed;
			state.undoErrors = errors;
			return { status: "error", mode: "rollback", error: errorOf(e), retryable: e && e.retryable === true, state: state, removed: removed, errors: errors, calls: counter.calls };
		}
		state.undoRemoved = removed;
		state.undoErrors = errors;
		if (undoCount(undo)) {
			return { status: "running", mode: "rollback", state: state, removed: removed, errors: errors, calls: counter.calls };
		}
		forgetTablePaths(state.workspaceName, state.baseName);
		return { status: "undone", mode: "rollback", baseId: numberOrNull(state.baseId), state: state, removed: removed, errors: errors, calls: counter.calls };
	}

	// mode rollback: the base the state created deleted for good (deleteBase), or what it made in a base that existed
	// deleted (undoRun), or nothing. The files the run uploaded stay in the user files of the account (Baserow has no API
	// to delete one): the final answer lists them (uploadedFiles {key, visible_name, size}), never their Baserow name.
	function rollback(api, rawState, rawOptions) {
		var state = parseJson(rawState, "state", null) || {};
		var answer;
		if (state.createdBase === true && numberOrNull(state.baseId) != null) {
			answer = deleteBase(api, state.baseId, state.workspaceId);
		} else if (undoCount(state.undo)) {
			answer = undoRun(api, state, rawOptions);
		} else {
			answer = { status: "nothing", message: "This state created no base." };
		}
		if (answer.status !== "running" && answer.status !== "error") {
			var files = state.files && typeof state.files === "object" ? state.files : {};
			var uploaded = Object.keys(files).filter(function (key) { return files[key] && files[key].uploaded === true; }).map(function (key) {
				return { key: key, visible_name: text(files[key].visible_name), size: numberOrNull(files[key].size) };
			});
			if (uploaded.length) {
				answer.uploadedFiles = uploaded;
			}
		}
		return answer;
	}

	// Waits for a Baserow job, bounded: returns the finished job, throws when it failed, when it is unknown or after
	// timeoutMs / maxPolls (never loops for ever, unlike TableCreateRows).
	function waitJob(api, jobId, rawOptions) {
		var options = rawOptions || {};
		var timeoutMs = numberOrNull(options.timeoutMs) || 60000;
		var intervalMs = numberOrNull(options.intervalMs) || 1000;
		var maxPolls = numberOrNull(options.maxPolls) || Math.ceil(timeoutMs / intervalMs) + 1;
		var now = options.now || function () { return new Date().getTime(); };
		var sleep = options.sleep || function (ms) { java.lang.Thread.sleep(ms); };
		var start = now();
		var id = numberOrNull(jobId);
		if (id == null) {
			throw SchemaError("job_invalid", "A job id is required.");
		}
		for (var poll = 1; ; poll++) {
			var job = api.getJob(id);
			var state = lower(job && job.state);
			if (state === "finished") {
				return job;
			}
			if (state === "failed" || state === "cancelled") {
				throw SchemaError("job_failed", "The job " + id + " " + state + ": " + text(job.human_readable_error || job.error || "no detail") + ".", { job: job });
			}
			if (!state.length) {
				throw SchemaError("job_unknown", "The job " + id + " has no state.");
			}
			if (poll >= maxPolls || now() - start + intervalMs > timeoutMs) {
				var timeout = SchemaError("job_timeout", "The job " + id + " is still " + state + " after " + (now() - start) + " ms.", { job: job });
				timeout.retryable = true;
				throw timeout;
			}
			sleep(intervalMs);
		}
	}

	// ---- rows of a migration ----------------------------------------------------------------------------------------

	// The most rows of one write (a Baserow batch call holds 200 rows at most).
	var ROWS_PER_WRITE = 200;
	// The most pages read to find the rows of a batch already written (keyField).
	var KEY_PAGES = 20;

	function plainValue(value) {
		if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
			return true;
		}
		if (Array.isArray(value)) {
			return value.every(function (item) {
				return item == null || typeof item === "string" || typeof item === "number" || (typeof item === "object" && !Array.isArray(item) && Object.keys(item).every(function (k) {
					return item[k] == null || typeof item[k] === "string" || typeof item[k] === "number";
				}));
			});
		}
		return false;
	}

	// Checks one row of a write: an object whose keys are field_<id> of writable fields of the table (id too, for an
	// update), with plain values.
	function checkRowItem(item, writable, label, update) {
		if (item == null || typeof item !== "object" || Array.isArray(item)) {
			throw SchemaError("rows_invalid", label + " must be an object.");
		}
		Object.keys(item).forEach(function (key) {
			if (update && key === "id") {
				var id = numberOrNull(item.id);
				if (id == null || id < 1 || Math.round(id) !== id) {
					throw SchemaError("rows_invalid", label + ": id must be the id of a row.");
				}
				return;
			}
			if (writable[key] == null) {
				throw SchemaError("rows_invalid", label + ": " + key + " is not a field of the table that takes a value.");
			}
			if (!plainValue(item[key])) {
				throw SchemaError("rows_invalid", label + ": the value of " + key + " is not a plain value.");
			}
		});
		if (update && item.id == null) {
			throw SchemaError("rows_invalid", label + ": id is required to update a row.");
		}
	}

	// The ids of the rows of the table whose key field (a number field) is between min and max: the rows of a batch
	// written before an interruption.
	function rowsByKey(api, tableId, fieldId, min, max) {
		var found = {};
		var filters = JSON.stringify({
			filter_type: "AND",
			filters: [
				{ type: "higher_than", field: fieldId, value: "" + (min - 1) },
				{ type: "lower_than", field: fieldId, value: "" + (max + 1) }
			]
		});
		for (var page = 1; page <= KEY_PAGES; page++) {
			var answer = api.findRows(tableId, { filters: filters, include: "field_" + fieldId, page: page, size: ROWS_PAGE }) || {};
			var rows = list(answer.results);
			rows.forEach(function (row) {
				var key = numberOrNull(row["field_" + fieldId]);
				var id = numberOrNull(row.id);
				if (key != null && id != null && found[key] == null) {
					found[key] = id;
				}
			});
			if (rows.length < ROWS_PAGE || answer.next == null || answer.next === "") {
				return found;
			}
		}
		throw SchemaError("rows_key_overflow", "More than " + (KEY_PAGES * ROWS_PAGE) + " rows of the table have a key between " + min + " and " + max + ".");
	}

	// mode rows: one write of a migration (rows copied from elsewhere, not sample data) into a table the account
	// reaches. options:
	// - tableId: the table;
	// - create: rows to create, [{field_<id>: value}] (200 at most), values as Baserow takes them (option ids, row ids);
	// - keyField: the id of a number field identifying the rows (the id of the row at the source): a row of create
	//   whose key is already in the table is not created again, its id is given back (a batch written again after an
	//   interruption leaves no duplicate);
	// - update: rows to update, [{id, field_<id>: value}] (200 at most), the links of a second pass.
	// Only the writable fields of the table are accepted (no computed field, no password). The answer gives, in the
	// order of create, {key, id, existing} for each row, and the number of rows updated.
	function writeRows(api, rawOptions) {
		var options = parseJson(rawOptions, "options", {}) || {};
		var tableId = numberOrNull(options.tableId);
		if (tableId == null || tableId < 1) {
			throw SchemaError("table_invalid", "A tableId is required.");
		}
		var create = options.create == null ? [] : options.create;
		var update = options.update == null ? [] : options.update;
		if (!Array.isArray(create) || !Array.isArray(update)) {
			throw SchemaError("rows_invalid", "create and update must be arrays of rows.");
		}
		if (create.length > ROWS_PER_WRITE || update.length > ROWS_PER_WRITE) {
			throw SchemaError("rows_too_many", "At most " + ROWS_PER_WRITE + " rows to create and " + ROWS_PER_WRITE + " rows to update in one call.");
		}
		var result = { status: "ok", mode: "rows", tableId: tableId, created: 0, existing: 0, updated: 0, rows: [] };
		if (!create.length && !update.length) {
			return result;
		}
		// the fields of the table, read with the account: a table it does not reach is refused by Baserow
		var writable = {};
		list(api.listFields(tableId)).forEach(function (field) {
			var type = normalizeFieldType(field.type);
			if (numberOrNull(field.id) != null && type !== "password" && !contains(READ_ONLY_TYPES, type)) {
				writable["field_" + numberOrNull(field.id)] = type;
			}
		});
		create.forEach(function (item, i) {
			checkRowItem(item, writable, "create[" + i + "]", false);
		});
		update.forEach(function (item, i) {
			checkRowItem(item, writable, "update[" + i + "]", true);
		});
		var keyField = options.keyField == null || options.keyField === "" ? null : numberOrNull(options.keyField);
		var keys = [];
		var existing = {};
		if (create.length && options.keyField != null && options.keyField !== "") {
			if (keyField == null || writable["field_" + keyField] !== "number") {
				throw SchemaError("rows_invalid", "keyField must be the id of a number field of the table.");
			}
			var seen = {};
			create.forEach(function (item, i) {
				var key = numberOrNull(item["field_" + keyField]);
				if (key == null || Math.round(key) !== key) {
					throw SchemaError("rows_invalid", "create[" + i + "]: no whole number in the key field.");
				}
				if (seen[key]) {
					throw SchemaError("rows_invalid", "create[" + i + "]: the key " + key + " is used by two rows.");
				}
				seen[key] = true;
				keys.push(key);
			});
			existing = rowsByKey(api, tableId, keyField, Math.min.apply(null, keys), Math.max.apply(null, keys));
		}
		var todo = [];
		var todoAt = [];
		create.forEach(function (item, i) {
			var key = keyField != null ? keys[i] : null;
			if (key != null && existing[key] != null) {
				result.rows[i] = { key: key, id: existing[key], existing: true };
				result.existing++;
				return;
			}
			todo.push(item);
			todoAt.push(i);
		});
		if (todo.length) {
			var created = list(api.createRows(tableId, todo));
			if (created.length !== todo.length) {
				throw SchemaError("baserow_error", "Baserow created " + created.length + " rows of " + todo.length + ".");
			}
			created.forEach(function (row, n) {
				var i = todoAt[n];
				result.rows[i] = { key: keyField != null ? keys[i] : null, id: numberOrNull(row.id), existing: false };
			});
			result.created = todo.length;
		}
		if (update.length) {
			result.updated = list(api.updateRows(tableId, update)).length;
		}
		return result;
	}

	// ---- files of a migration ---------------------------------------------------------------------------------------

	// The largest file a migration uploads (the default size limit of Baserow is 1 GB).
	var UPLOAD_MAX_BYTES = 1024 * 1024 * 1024;
	// The only folder mode upload reads: where another project hands a file over (lib_Microsoft_Sharepoint.DownloadFile).
	var TRANSFER_DIR = "c8o-file-transfer";

	// mode upload: one file of a migration uploaded to the user files of the account, to set afterwards in a file field
	// of a row (mode rows, the value [{name, visible_name}]). options.path: a file of <java.io.tmpdir>/c8o-file-transfer,
	// checked by fileOf ({path, size, name} or null); the caller deletes the file.
	function uploadFile(api, rawOptions, fileOf) {
		var options = parseJson(rawOptions, "options", {}) || {};
		var file = fileOf(text(options.path));
		if (file == null) {
			throw SchemaError("file_invalid", "path must be a file of the transfer folder.");
		}
		if (file.size > UPLOAD_MAX_BYTES) {
			throw SchemaError("file_too_large", "The file is larger than 1 GB.");
		}
		var uploaded = api.uploadFile(file.path) || {};
		if (text(uploaded.name) === "") {
			throw SchemaError("baserow_error", "Baserow gave no name for the file.");
		}
		return {
			status: "ok", mode: "upload",
			file: {
				name: text(uploaded.name), visible_name: text(uploaded.visible_name) || file.name, size: numberOrNull(uploaded.size),
				is_image: uploaded.is_image === true, mime_type: text(uploaded.mime_type)
			}
		};
	}

	// A path when it is a regular file of the transfer folder (its canonical path: no way out of it by .. or a link),
	// else null.
	function engineTransferFile(path) {
		if (path === "") {
			return null;
		}
		try {
			var root = "" + new java.io.File(java.lang.System.getProperty("java.io.tmpdir"), TRANSFER_DIR).getCanonicalPath() + java.io.File.separator;
			var file = new java.io.File(path).getCanonicalFile();
			var canonical = "" + file.getPath();
			if (!file.isFile() || canonical.indexOf(root) !== 0) {
				return null;
			}
			return { path: canonical, size: Number(file.length()), name: "" + file.getName() };
		}
		catch (e) {
			return null;
		}
	}

	// ---- engine ----------------------------------------------------------------------------------------------------

	// The api of the engine: each call goes to a Baserow_API_spec transaction with the Bearer of the account, the logs
	// off. The Bearer stays in this closure.
	// ---- describe (C8Oforms #1836) ---------------------------------------------------------------------------------

	// mode describe: the structure of tables of the user's account, and their rows on demand, as schemas of this format
	// (the inverse of apply), one per base, read with the account's own token: a table it does not reach is left out and
	// listed. Used by the export of an application with its no-code database. The tables asked, plus the tables they link
	// (a link stays in its base) unless options.linked is false: then a link to a table not asked is left out and listed
	// (link_target), with the lookups, rollups, counts and formulas that go through it (the MCP tool
	// nocode-baserow-schema-get, to read one table). Keys are the names Baserow gives, so that formulas, lookups and links, which name
	// fields, need no rewriting (the engine resolves a key or a name). The schemas never hold an id, a workspace, a file,
	// a password field nor the value of a computed field; the answer gives, beside them, the ids of the tables and of the
	// select options it read (to remap what an application names by id).
	var DESCRIBE_MAX_TABLES = 100;
	var DESCRIBE_MAX_ROWS = 2000;
	var DESCRIBE_TABLE_BYTES = 1048576;
	var DESCRIBE_MAX_BYTES = 4194304;
	var DATE_OPTIONS = ["date_format", "date_include_time", "date_time_format", "date_show_tzinfo", "date_force_timezone"];
	// the Baserow options of a field the schema carries (baserowOptions), by type
	var DESCRIBE_OPTIONS = {
		text: ["text_default"],
		long_text: ["long_text_enable_rich_text"],
		number: ["number_decimal_places", "number_negative", "number_prefix", "number_suffix", "number_separator"],
		date: DATE_OPTIONS,
		created_on: DATE_OPTIONS,
		last_modified: DATE_OPTIONS,
		rating: ["max_value", "color", "style"],
		duration: ["duration_format"]
	};

	function DescribeRefusal(code, message, extra) {
		var error = SchemaError(code, message, extra);
		error.refused = true;
		return error;
	}

	// A name not taken yet (case-insensitively, as Baserow compares the names of a base or a table): name, name (2)...
	function freeName(name, used) {
		var candidate = name;
		for (var n = 2; used[lower(candidate)]; n++) {
			candidate = name + " (" + n + ")";
		}
		used[lower(candidate)] = true;
		return candidate;
	}

	// The fields a formula names: field('x') and lookup('link', 'x') (the link only, its target is in another table).
	function formulaNames(formula) {
		var names = [];
		var literal = "(?:'((?:\\\\.|[^'\\\\])*)'|\"((?:\\\\.|[^\"\\\\])*)\")";
		var unescape = function (single, double) {
			return (single != null ? single : double).replace(/\\(.)/g, "$1");
		};
		var m;
		var fieldRe = new RegExp("\\bfield\\(\\s*" + literal + "\\s*\\)", "g");
		while ((m = fieldRe.exec(formula)) !== null) {
			names.push(unescape(m[1], m[2]));
		}
		var lookupRe = new RegExp("\\blookup\\(\\s*" + literal + "\\s*,", "g");
		while ((m = lookupRe.exec(formula)) !== null) {
			names.push(unescape(m[1], m[2]));
		}
		return names;
	}

	// The id of a select option, a linked row or a user as a row of the API gives it (an object, or the id written).
	function idOf(value) {
		return numberOrNull(value && typeof value === "object" ? value.id : value);
	}

	// transfer: where the files of attachments are written ({open(): dir, target(dir, n): path, remove(dir)}), the
	// transfer folder in the engine.
	function describe(api, rawOptions, transfer) {
		var options = parseJson(rawOptions, "options", {}) || {};
		var withRows = bool(options.rows, false);
		var withLinked = bool(options.linked, true);
		var withFiles = bool(options.attachments, false);
		var withViews = bool(options.views, false);
		if (withFiles && !transfer) {
			throw SchemaError("options_invalid", "No transfer folder for the files of the rows.");
		}
		var registry = {
			list: [], byName: {}, bytes: 0,
			maxFile: Math.min(numberOrNull(options.maxFileBytes) || FILE_MAX_BYTES, FILE_MAX_BYTES),
			maxFiles: Math.min(numberOrNull(options.maxFilesBytes) || FILES_MAX_BYTES, FILES_MAX_BYTES)
		};
		var omittedViews = [];
		var maxRows = numberOrNull(options.maxRowsPerTable);
		maxRows = maxRows == null ? DESCRIBE_MAX_ROWS : Math.max(0, Math.min(maxRows, DESCRIBE_MAX_ROWS));
		var maxTableBytes = Math.min(numberOrNull(options.maxTableBytes) || DESCRIBE_TABLE_BYTES, DESCRIBE_TABLE_BYTES);
		var maxBytes = Math.min(numberOrNull(options.maxBytes) || DESCRIBE_MAX_BYTES, DESCRIBE_MAX_BYTES);
		var asked = list(options.tables);
		if (!asked.length) {
			throw SchemaError("tables_missing", "options.tables names no table.");
		}
		if (asked.length > DESCRIBE_MAX_TABLES) {
			throw DescribeRefusal("tables_too_many", asked.length + " tables asked, " + DESCRIBE_MAX_TABLES + " at most.", { count: asked.length, max: DESCRIBE_MAX_TABLES });
		}
		// the catalogue of the account: its bases with their tables
		var byTable = {};
		var byPath = {};
		list(api.listApplications()).forEach(function (app) {
			if (!app || text(app.type) !== "database" || numberOrNull(app.id) == null) {
				return;
			}
			var base = { id: numberOrNull(app.id), name: text(app.name), workspace: text(app.workspace && app.workspace.name) };
			list(app.tables).forEach(function (t) {
				var tableId = numberOrNull(t && t.id);
				if (tableId != null) {
					byTable[tableId] = { id: tableId, name: text(t.name), base: base };
					byPath[base.workspace + "~>" + base.name + "~>" + text(t.name)] = byTable[tableId];
				}
			});
		});
		var skipped = [];
		var omitted = [];
		var files = [];
		var chosen = {};
		var order = [];
		var take = function (entry) {
			if (!chosen[entry.id]) {
				chosen[entry.id] = entry;
				order.push(entry);
			}
		};
		asked.forEach(function (ref) {
			var id = numberOrNull(ref && typeof ref === "object" ? ref.id : null);
			var path = text(ref && typeof ref === "object" ? ref.path : ref);
			var found = (id != null ? byTable[id] : null) || (path.length ? byPath[path] : null) || (numberOrNull(path) != null ? byTable[numberOrNull(path)] : null);
			if (found) {
				take(found);
			} else {
				skipped.push({ table: path.length ? path : "" + id, reason: "not_readable" });
			}
		});
		// the fields of each table, and the tables they link (in the same base), unless linked is false
		var fieldsOf = {};
		for (var i = 0; i < order.length; i++) {
			if (order.length > DESCRIBE_MAX_TABLES) {
				throw DescribeRefusal("tables_too_many", order.length + " tables with the tables they link, " + DESCRIBE_MAX_TABLES + " at most.", { count: order.length, max: DESCRIBE_MAX_TABLES });
			}
			var entry = order[i];
			fieldsOf[entry.id] = list(api.listFields(entry.id));
			fieldsOf[entry.id].forEach(function (field) {
				var target = numberOrNull(field && field.link_row_table_id);
				if (withLinked && normalizeFieldType(field && field.type) === "link_row" && target != null && byTable[target] && byTable[target].base.id === entry.base.id) {
					take(byTable[target]);
				}
			});
		}
		var bases = [];
		var basesById = {};
		order.forEach(function (entry) {
			if (!basesById[entry.base.id]) {
				basesById[entry.base.id] = { base: entry.base, tables: [] };
				bases.push(basesById[entry.base.id]);
			}
			basesById[entry.base.id].tables.push(entry);
		});
		var rowCount = 0;
		var answerBases = bases.map(function (group) {
			return describeBase(api, group, fieldsOf, {
				rows: withRows, maxRows: maxRows, maxTableBytes: maxTableBytes, omitted: omitted, files: files,
				attachments: withFiles, registry: registry, views: withViews, omittedViews: omittedViews,
				onRows: function (n) { rowCount += n; }
			});
		});
		var answer = {
			status: "ok", mode: "describe", bases: answerBases, skipped: skipped, omitted: omitted, files: files,
			counts: { bases: answerBases.length, tables: order.length, rows: rowCount }
		};
		if (withViews) {
			answer.omittedViews = omittedViews;
		}
		var bytes = JSON.stringify(answerBases).length;
		if (bytes > maxBytes) {
			throw DescribeRefusal("export_too_large", "The no-code database part holds " + bytes + " bytes, " + maxBytes + " at most.", { bytes: bytes, max: maxBytes });
		}
		answer.counts.bytes = bytes;
		if (withFiles) {
			answer.attachments = downloadFiles(api, registry, transfer);
			answer.counts.files = answer.attachments.length;
			answer.counts.fileBytes = answer.attachments.reduce(function (sum, f) { return sum + f.size; }, 0);
			if (answer.attachments.length) {
				answer.transferDir = answer.attachments.transferDir;
			}
			delete answer.attachments.transferDir;
		}
		return answer;
	}

	// A file of a row (a value of a file cell as Baserow gives it), once per file of Baserow (its name): its key in the
	// schemas, within the limits, refused above them before any download (the file, its table and field named).
	function describeFile(registry, value, table, field, view) {
		var name = text(value.name);
		var known = registry.byName["n:" + name];
		// a file cell gives its name shown (visible_name), the image of a form the name of its upload (original_name)
		var visibleName = text(value.visible_name).substring(0, 255) || text(value.original_name).substring(0, 255) || name.substring(0, 255);
		if (!known) {
			var size = numberOrNull(value.size) || 0;
			if (size > registry.maxFile) {
				throw DescribeRefusal("file_too_large", "The file " + visibleName + " of " + table + "." + (view ? view + "." : "") + field + " holds " + size + " bytes, " + registry.maxFile + " at most.",
					{ table: table, field: field, view: view, file: visibleName, bytes: size, max: registry.maxFile });
			}
			if (registry.bytes + size > registry.maxFiles) {
				throw DescribeRefusal("files_too_large", "With the file " + visibleName + " of " + table + "." + (view ? view + "." : "") + field + " the files hold " + (registry.bytes + size) + " bytes, " + registry.maxFiles + " at most.",
					{ table: table, field: field, view: view, file: visibleName, bytes: registry.bytes + size, max: registry.maxFiles });
			}
			registry.bytes += size;
			known = {
				key: "f" + (registry.list.length + 1), url: text(value.url), visibleName: visibleName, size: size,
				mimeType: text(value.mime_type).substring(0, 255), isImage: value.is_image === true, table: table, field: view ? view + "." + field : field
			};
			registry.list.push(known);
			registry.byName["n:" + name] = known;
		}
		return { file: known.key, visible_name: visibleName };
	}

	// The name of a file of a describe in its folder: its name shown, only the characters a path refuses replaced, as
	// Baserow names and types an uploaded file by the name of the file (the image of a form shows it).
	function transferName(visibleName) {
		var safe = text(visibleName).replace(/[\/\\\u0000-\u001f\u007f:*?"<>|]/g, "_").replace(/^\s+|\s+$/g, "");
		if (safe.length > 200) {
			safe = safe.substring(safe.length - 200);
		}
		return safe === "" || safe === "." || safe === ".." ? "file" : safe;
	}

	// The files of the rows downloaded with the account into a folder of their own of the transfer folder, within the
	// limits counted again on the bytes read; on any failure the folder is deleted. Never the name nor the URL of a
	// file of Baserow in the answer.
	function downloadFiles(api, registry, transfer) {
		var out = [];
		if (!registry.list.length) {
			return out;
		}
		var dir = transfer.open();
		try {
			var total = 0;
			registry.list.forEach(function (file, n) {
				var target = transfer.target(dir, n + 1, transferName(file.visibleName));
				var got;
				// at most the limit of a file, and what is left of the limit of all the files
				var limit = Math.min(registry.maxFile, registry.maxFiles - total);
				try {
					got = api.downloadFile(file.url, target, limit);
				} catch (e) {
					if (e && e.code === "file_too_large" && limit < registry.maxFile) {
						throw DescribeRefusal("files_too_large", "With the file " + file.visibleName + " of " + file.table + "." + file.field + " the files hold more than " + registry.maxFiles + " bytes.",
							{ table: file.table, field: file.field, file: file.visibleName, bytes: total + (numberOrNull(e.bytes) || 0), max: registry.maxFiles });
					}
					if (e && e.code === "file_too_large") {
						throw DescribeRefusal("file_too_large", "The file " + file.visibleName + " of " + file.table + "." + file.field + " holds more than " + registry.maxFile + " bytes.",
							{ table: file.table, field: file.field, file: file.visibleName, bytes: e.bytes, max: registry.maxFile });
					}
					var failed = SchemaError("file_download_failed", "The file " + file.visibleName + " of " + file.table + "." + file.field + " could not be read.",
						{ table: file.table, field: file.field, file: file.visibleName });
					failed.retryable = !(e && e.retryable === false);
					throw failed;
				}
				var size = numberOrNull(got && got.size) || 0;
				total += size;
				if (total > registry.maxFiles) {
					throw DescribeRefusal("files_too_large", "With the file " + file.visibleName + " of " + file.table + "." + file.field + " the files hold " + total + " bytes, " + registry.maxFiles + " at most.",
						{ table: file.table, field: file.field, file: file.visibleName, bytes: total, max: registry.maxFiles });
				}
				out.push({ key: file.key, path: target, size: size, visible_name: file.visibleName, mime_type: file.mimeType, is_image: file.isImage });
			});
		} catch (e) {
			transfer.remove(dir);
			throw e;
		}
		out.transferDir = dir;
		return out;
	}

	// One base: its schema, the keys of its tables by id and path, the keys of its select options by id.
	function describeBase(api, group, fieldsOf, opts) {
		var base = group.base;
		var usedTables = {};
		var tableKey = {};
		group.tables.forEach(function (entry) {
			tableKey[entry.id] = freeName(entry.name, usedTables);
		});
		var fieldById = {};
		group.tables.forEach(function (entry) {
			fieldsOf[entry.id].forEach(function (field) {
				if (field && numberOrNull(field.id) != null) {
					fieldById[numberOrNull(field.id)] = { field: field, table: entry };
				}
			});
		});
		var optionKeys = [];
		var tables = group.tables.map(function (entry) {
			return { entry: entry, key: tableKey[entry.id], specs: [], primary: null, kept: {}, optionKey: {} };
		});
		var keep = function (t, field, reason, type) {
			opts.omitted.push({ table: t.key, field: text(field.name), type: text(type || field.type), reason: reason });
		};
		// the plain fields first, then the links, then the computed fields once every field they name is known
		tables.forEach(function (t) {
			var fields = fieldsOf[t.entry.id].slice(0).sort(function (a, b) {
				return (numberOrNull(a.order) || 0) - (numberOrNull(b.order) || 0) || (numberOrNull(a.id) || 0) - (numberOrNull(b.id) || 0);
			});
			fields.forEach(function (field) {
				var type = normalizeFieldType(field.type);
				var name = text(field.name);
				var primary = field.primary === true || field.primary === "true";
				if (type === "password") {
					keep(t, field, "password");
					return;
				}
				if (!contains(FIELD_TYPES, type) || !name.length || name.indexOf("~>") !== -1) {
					keep(t, field, "type");
					return;
				}
				var spec = { key: name, name: name, type: type };
				var baserowOptions = {};
				(DESCRIBE_OPTIONS[type] || []).forEach(function (option) {
					if (field[option] !== undefined && field[option] !== null) {
						baserowOptions[option] = field[option];
					}
				});
				if (Object.keys(baserowOptions).length) {
					spec.baserowOptions = baserowOptions;
				}
				if (type === "single_select" || type === "multiple_select") {
					var usedKeys = {};
					spec.values = list(field.select_options).filter(function (o) { return o && text(o.value).length; }).map(function (o) {
						var key = freeName(text(o.value), usedKeys);
						if (numberOrNull(o.id) != null) {
							t.optionKey[name + "\u0000" + numberOrNull(o.id)] = key;
							optionKeys.push({ id: numberOrNull(o.id), table: t.key, field: name, option: key });
						}
						return { key: key, value: text(o.value), color: text(o.color) || undefined };
					});
				}
				if (type === "link_row") {
					var target = numberOrNull(field.link_row_table_id);
					if (target == null || tableKey[target] == null) {
						keep(t, field, "link_target");
						return;
					}
					var relatedId = numberOrNull(field.link_row_related_field_id || field.link_row_related_field);
					var related = relatedId != null ? fieldById[relatedId] : null;
					// a pair of links is created once, by the field of the smaller id; the other is its related field
					if (related && relatedId < numberOrNull(field.id)) {
						t.kept[name] = { spec: null, field: field, related: true };
						return;
					}
					spec.targetTable = tableKey[target];
					if (field.link_row_multiple_relationships != null) {
						spec.multiple = field.link_row_multiple_relationships;
					}
					if (related && target !== t.entry.id) {
						spec.createRelatedField = true;
						spec.relatedFieldKey = text(related.field.name);
						spec.relatedFieldName = text(related.field.name);
					} else {
						spec.createRelatedField = false;
					}
				}
				if (type === "lookup" || type === "rollup" || type === "count") {
					var through = fieldById[numberOrNull(field.through_field_id)];
					var targetField = fieldById[numberOrNull(field.target_field_id)];
					if (!through || through.table.id !== t.entry.id || (type !== "count" && !targetField)) {
						keep(t, field, "reference");
						return;
					}
					spec.through = text(through.field.name);
					if (type !== "count") {
						spec.targetField = text(targetField.field.name);
					}
					if (type === "rollup") {
						spec.rollupFunction = lower(field.rollup_function || "sum");
					}
				}
				if (type === "formula") {
					spec.formula = text(field.formula);
					if (!spec.formula.length) {
						keep(t, field, "reference");
						return;
					}
				}
				if (primary) {
					if (!contains(PRIMARY_TYPES, type)) {
						keep(t, field, "primary_type");
						spec = { key: name, name: name, type: "text" };
					}
					t.primary = spec;
				} else {
					t.specs.push(spec);
				}
				t.kept[name] = { spec: spec, field: field };
			});
			if (!t.primary) {
				t.primary = { key: "Name", name: freeName("Name", Object.keys(t.kept).reduce(function (used, n) { used[lower(n)] = true; return used; }, {})), type: "text" };
				t.primary.key = t.primary.name;
			}
		});
		// a computed field naming a field left out is left out too, until nothing changes
		var byKey = {};
		tables.forEach(function (t) {
			byKey[t.key] = t;
		});
		var known = function (t, name) {
			return t.kept[name] != null || t.primary.name === name;
		};
		for (var changed = true; changed;) {
			changed = false;
			tables.forEach(function (t) {
				t.specs = t.specs.filter(function (spec) {
					var ok = true;
					if (spec.type === "lookup" || spec.type === "rollup" || spec.type === "count") {
						var link = t.kept[spec.through];
						var linkTarget = link && (link.spec ? link.spec.targetTable : tableKey[numberOrNull(link.field.link_row_table_id)]);
						ok = link != null && (spec.type === "count" || (byKey[linkTarget] != null && known(byKey[linkTarget], spec.targetField)));
					}
					if (spec.type === "formula") {
						ok = formulaNames(spec.formula).every(function (n) { return known(t, n); });
					}
					if (!ok) {
						delete t.kept[spec.name];
						opts.omitted.push({ table: t.key, field: spec.name, type: spec.type, reason: "reference" });
						changed = true;
					}
					return ok;
				});
				if (t.primary.type === "formula" && !formulaNames(t.primary.formula).every(function (n) { return known(t, n); })) {
					opts.omitted.push({ table: t.key, field: t.primary.name, type: "formula", reason: "reference" });
					t.primary = { key: t.primary.name, name: t.primary.name, type: "text" };
					changed = true;
				}
			});
		}
		// the rows, read with the account: what it reads is what it may read
		var readIds = {};
		if (opts.rows) {
			tables.forEach(function (t) {
				t.rows = describeRows(api, t, opts);
			});
			// a link to a row that was not read (not readable, or left out) is left out
			tables.forEach(function (t) {
				readIds[t.key] = {};
				(t.rows || []).forEach(function (row) {
					readIds[t.key][row._key] = true;
				});
			});
			tables.forEach(function (t) {
				var bytes = 0;
				(t.rows || []).forEach(function (row) {
					Object.keys(row).forEach(function (column) {
						var spec = t.kept[column] && t.kept[column].spec;
						if (spec && spec.type === "link_row") {
							row[column] = row[column].filter(function (key) { return readIds[spec.targetTable][key]; });
							if (!row[column].length) {
								delete row[column];
							}
						}
					});
				});
				bytes = JSON.stringify(t.rows || []).length;
				if (bytes > opts.maxTableBytes) {
					throw DescribeRefusal("rows_too_large", "The rows of " + t.key + " hold " + bytes + " bytes, " + opts.maxTableBytes + " at most.", { table: t.key, bytes: bytes, max: opts.maxTableBytes });
				}
				opts.onRows((t.rows || []).length);
			});
		}
		// the views, their fields named as the schema names them
		var viewIds = [];
		if (opts.views) {
			tables.forEach(function (t) {
				t.views = describeViews(api, t, {
					fieldById: fieldById, tableKey: tableKey, readIds: readIds, rows: opts.rows, omittedViews: opts.omittedViews, viewIds: viewIds,
					attachments: opts.attachments, registry: opts.registry
				});
			});
		}
		var schema = {
			format: FORMAT, formatVersion: 1, key: "describe-" + base.id, version: "1", base: { defaultName: base.name },
			limits: { maxRowsPerTable: opts.maxRows },
			tables: tables.map(function (t) {
				var table = { key: t.key, name: t.key, primaryField: t.primary, fields: t.specs };
				if (t.rows && t.rows.length) {
					table.sampleRows = { upsertKey: t.primary.key, rows: t.rows };
				}
				if (t.views && t.views.length) {
					table.views = t.views;
				}
				return table;
			})
		};
		// the files its rows name, by key (never their name of Baserow)
		if (opts.attachments) {
			var used = {};
			tables.forEach(function (t) {
				(t.views || []).forEach(function (view) {
					["coverImage", "logoImage"].forEach(function (key) {
						if (view[key]) {
							used["k:" + view[key].file] = true;
						}
					});
				});
				(t.rows || []).forEach(function (row) {
					Object.keys(row).forEach(function (column) {
						var kept = t.kept[column];
						if (kept && kept.spec && kept.spec.type === "file") {
							row[column].forEach(function (cell) {
								used["k:" + cell.file] = true;
							});
						}
					});
				});
			});
			var baseFiles = opts.registry.list.filter(function (file) { return used["k:" + file.key]; }).map(function (file) {
				return { key: file.key, visible_name: file.visibleName, size: file.size, mime_type: file.mimeType, is_image: file.isImage };
			});
			if (baseFiles.length) {
				schema.files = baseFiles;
			}
		}
		// what the engine refuses must not reach a file: checked now, as the import will check it
		normalizeSchema(JSON.parse(JSON.stringify(schema)));
		return {
			workspace: base.workspace, base: base.name, schema: schema,
			tables: group.tables.map(function (entry) {
				return { id: entry.id, path: base.workspace + "~>" + base.name + "~>" + entry.name, key: tableKey[entry.id] };
			}),
			options: optionKeys.filter(function (o) {
				var t = byKey[o.table];
				return t && t.kept[o.field] && t.kept[o.field].spec;
			}),
			views: opts.views ? viewIds : undefined
		};
	}

	// The views of a table as views of a schema: collaborative grid, gallery, form, kanban and calendar views, never
	// public; their filters (select options by key, rows of the linked table by key when its rows are carried; a filter
	// on a user is left out), groups of filters, sorts, group bys, the field of a kanban or calendar view, the cover of
	// a gallery or kanban, and their field options (hidden columns, order, width). What a view names that the schema
	// does not carry is left out and listed (omittedViews: {table, view, what, field, reason}).
	function describeViews(api, t, ctx) {
		var out = [];
		var used = {};
		var leftOut = function (view, what, reason, field) {
			var item = { table: t.key, view: text(view && view.name), what: what, reason: reason };
			if (field) {
				item.field = field;
			}
			ctx.omittedViews.push(item);
		};
		// the name of a field of this table that the schema keeps, by its id
		var nameOf = function (fieldId) {
			var found = ctx.fieldById[numberOrNull(fieldId)];
			if (!found || found.table.id !== t.entry.id) {
				return null;
			}
			var name = text(found.field.name);
			return t.kept[name] ? name : null;
		};
		var kind = function (name) {
			var kept = t.kept[name];
			return kept.spec ? kept.spec.type : normalizeFieldType(kept.field.type);
		};
		// groups of filters (of a view, or of a color), a parent before its children, keyed g1, g2...: a group whose
		// parent is not given (or a cycle) is left out with its filters
		var orderGroups = function (groupList) {
			var byId = {};
			groupList.forEach(function (group) {
				if (group && group.id != null) {
					byId["g" + text(group.id)] = group;
				}
			});
			var keys = {};
			var visiting = {};
			var ordered = [];
			var visit = function (group) {
				var groupId = "g" + text(group.id);
				if (keys[groupId] !== undefined || visiting[groupId]) {
					return;
				}
				visiting[groupId] = true;
				var parent = group.parent_group != null && text(group.parent_group).length ? "g" + text(group.parent_group) : null;
				var parentKey = null;
				if (parent != null) {
					if (byId[parent]) {
						visit(byId[parent]);
					}
					parentKey = keys[parent] || null;
					if (!parentKey) {
						keys[groupId] = null;
						return;
					}
				}
				var key = "g" + (ordered.length + 1);
				keys[groupId] = key;
				ordered.push({ key: key, filterType: lower(group.filter_type) === "or" ? "OR" : "AND", parent: parentKey });
			};
			groupList.forEach(function (group) {
				if (group && group.id != null) {
					visit(group);
				}
			});
			return { list: ordered, keys: keys };
		};
		// a filter of a view or of a color: {item} as a schema holds it, or {reason, field} when it is left out
		var describeFilter = function (filter, groupKey) {
			var field = nameOf(filter && filter.field);
			if (!field) {
				return { reason: "view_field" };
			}
			var filterType = text(filter.type);
			var value = filter.value == null ? "" : "" + filter.value;
			var fieldType = kind(field);
			var item = { field: field, type: filterType };
			if (contains(USER_FILTERS, filterType)) {
				return { reason: "filter_user", field: field };
			}
			if ((fieldType === "single_select" || fieldType === "multiple_select") && /_select_/.test(filterType) && value.length) {
				var optionKeys = value.split(",").map(function (v) { return text(v); }).filter(function (v) { return v.length > 0; }).map(function (v) {
					return t.optionKey[field + "\u0000" + numberOrNull(v)];
				});
				if (optionKeys.some(function (k) { return k == null; })) {
					return { reason: "filter_value", field: field };
				}
				item.options = optionKeys;
			} else if (contains(ROW_FILTERS, filterType) && value.length) {
				var kept = t.kept[field];
				var target = kept.spec ? kept.spec.targetTable : ctx.tableKey[numberOrNull(kept.field.link_row_table_id)];
				var rowKeys = value.split(",").map(function (v) { return text(v); }).filter(function (v) { return v.length > 0; });
				if (!ctx.rows || !target || !rowKeys.every(function (k) { return ctx.readIds[target] && ctx.readIds[target][k]; })) {
					return { reason: "filter_row", field: field };
				}
				item.rows = rowKeys;
			} else {
				item.value = value;
			}
			if (filter.group != null && text(filter.group).length) {
				var key = groupKey["g" + text(filter.group)];
				if (!key) {
					return { reason: "filter_group", field: field };
				}
				item.group = key;
			}
			return { item: item };
		};
		var views = list(api.listViews(t.entry.id)).slice(0).sort(function (a, b) {
			return (numberOrNull(a && a.order) || 0) - (numberOrNull(b && b.order) || 0) || (numberOrNull(a && a.id) || 0) - (numberOrNull(b && b.id) || 0);
		});
		views.forEach(function (view) {
			var type = lower(view && view.type);
			var name = text(view && view.name);
			if (!contains(VIEW_TYPES, type)) {
				return leftOut(view, "view", "type");
			}
			if (view.ownership_type != null && lower(view.ownership_type) !== "collaborative") {
				return leftOut(view, "view", "personal");
			}
			if (!name.length || name.indexOf("~>") !== -1 || name.length > 250) {
				return leftOut(view, "view", "name");
			}
			var spec = { key: "", name: "", type: type };
			if (lower(view.filter_type) === "or") {
				spec.filterType = "OR";
			}
			if (view.filters_disabled === true) {
				spec.filtersDisabled = true;
			}
			if (type === "kanban" || type === "calendar") {
				var ref = nameOf(type === "kanban" ? view.single_select_field : view.date_field);
				if (!ref) {
					return leftOut(view, "view", "view_field");
				}
				spec[type === "kanban" ? "singleSelectField" : "dateField"] = ref;
			}
			if ((type === "gallery" || type === "kanban") && view.card_cover_image_field != null) {
				var cover = nameOf(view.card_cover_image_field);
				if (cover && kind(cover) === "file") {
					spec.cardCoverImageField = cover;
				} else {
					leftOut(view, "cardCoverImageField", "view_field");
				}
			}
			// a timeline: its start and end date fields and its time scale
			if (type === "timeline") {
				var startField = view.start_date_field != null ? nameOf(view.start_date_field) : null;
				var endField = view.end_date_field != null ? nameOf(view.end_date_field) : null;
				if ((view.start_date_field != null && !startField) || (view.end_date_field != null && !endField)) {
					return leftOut(view, "view", "view_field");
				}
				if (startField) {
					spec.startDateField = startField;
				}
				if (endField) {
					spec.endDateField = endField;
				}
				if (contains(TIMESCALES, lower(view.timescale))) {
					spec.timescale = lower(view.timescale);
				}
			}
			// a form: its texts, and its images as files of the schema (attachments), within the limits of the files
			if (type === "form") {
				Object.keys(FORM_TEXTS).forEach(function (key) {
					var value = view[FORM_TEXTS[key]];
					if (typeof value === "string" && value.length && value.length <= 10000) {
						spec[key] = value;
					}
				});
				if (view.mode === "form" || view.mode === "survey") {
					spec.mode = view.mode;
				}
				if (view.submit_action === "MESSAGE" || view.submit_action === "REDIRECT") {
					spec.submitAction = view.submit_action;
				}
				var url = text(view.submit_action_redirect_url);
				if (/^https?:\/\/[^\s]+$/i.test(url) && url.length <= 2000) {
					spec.submitActionRedirectUrl = url;
				} else if (url.length) {
					leftOut(view, "submitActionRedirectUrl", "url");
				}
				[["cover_image", "coverImage"], ["logo_image", "logoImage"]].forEach(function (image) {
					var value = view[image[0]];
					if (!value || typeof value !== "object" || !text(value.name).length) {
						return;
					}
					if (!ctx.attachments) {
						return leftOut(view, image[1], "attachments");
					}
					spec[image[1]] = { file: describeFile(ctx.registry, value, t.key, image[0], name).file };
				});
			}
			// the colors of the rows (a grid or a gallery gives them, read apart when the list of the views does not)
			if (view.decorations == null && (type === "grid" || type === "gallery")) {
				view.decorations = list(api.listViewDecorations(view.id));
			}
			var decorations = [];
			list(view.decorations).forEach(function (decoration) {
				var decorationType = text(decoration && decoration.type);
				var provider = text(decoration && decoration.value_provider_type);
				var conf = decoration && decoration.value_provider_conf && typeof decoration.value_provider_conf === "object" ? decoration.value_provider_conf : {};
				if (!contains(DECORATION_TYPES, decorationType) || !contains(DECORATION_PROVIDERS, provider)) {
					return leftOut(view, "decoration", "type");
				}
				if (provider === "single_select_color") {
					var selectField = nameOf(conf.field_id != null ? conf.field_id : conf.field);
					if (!selectField || kind(selectField) !== "single_select") {
						return leftOut(view, "decoration", "view_field");
					}
					decorations.push({ type: decorationType, provider: provider, field: selectField });
					return;
				}
				var colors = [];
				list(conf.colors).forEach(function (color) {
					if (!color || !COLOR.test(text(color.color))) {
						return leftOut(view, "decoration", "color");
					}
					var colorGroups = orderGroups(list(color.filter_groups));
					var item = { color: text(color.color) };
					if (lower(color.filter_type) === "or") {
						item.filterType = "OR";
					}
					if (colorGroups.list.length) {
						item.filterGroups = colorGroups.list;
					}
					item.filters = [];
					list(color.filters).forEach(function (filter) {
						var made = describeFilter(filter, colorGroups.keys);
						if (made.reason) {
							return leftOut(view, "decorationFilter", made.reason, made.field);
						}
						item.filters.push(made.item);
					});
					colors.push(item);
				});
				if (!colors.length) {
					return leftOut(view, "decoration", "color");
				}
				var out = { type: decorationType, provider: provider, colors: colors };
				if (conf["default"] != null && COLOR.test(text(conf["default"]))) {
					out["default"] = text(conf["default"]);
				}
				decorations.push(out);
			});
			if (decorations.length) {
				spec.decorations = decorations;
			}
			// the groups of filters, a parent before its children (a group the view does not list is read)
			var groups = {};
			var groupList = [];
			var addGroup = function (group) {
				var groupId = numberOrNull(group && group.id);
				if (groupId != null && !groups["g" + groupId]) {
					groups["g" + groupId] = group;
					groupList.push(group);
				}
			};
			list(view.filter_groups).forEach(addGroup);
			var fetchGroup = function (groupId) {
				if (groupId == null || groups["g" + groupId]) {
					return;
				}
				var group = api.getFilterGroup(groupId);
				if (group && numberOrNull(group.id) === groupId) {
					addGroup(group);
					fetchGroup(numberOrNull(group.parent_group));
				}
			};
			list(view.filters).forEach(function (filter) {
				fetchGroup(numberOrNull(filter && filter.group));
			});
			groupList.slice(0).forEach(function (group) {
				fetchGroup(numberOrNull(group.parent_group));
			});
			var ordered = orderGroups(groupList);
			var groupKey = ordered.keys;
			if (ordered.list.length) {
				spec.filterGroups = ordered.list;
			}
			var filters = [];
			list(view.filters).forEach(function (filter) {
				var made = describeFilter(filter, groupKey);
				if (made.reason) {
					return leftOut(view, "filter", made.reason, made.field);
				}
				filters.push(made.item);
			});
			if (filters.length) {
				spec.filters = filters;
			}
			// group bys (a grid only): read apart when the list of the views does not give them (an older Baserow)
			if (type === "grid" && view.group_bys == null) {
				view.group_bys = list(api.listViewGroupBys(view.id));
			}
			[["sortings", "sorts", "sort"], ["group_bys", "groupBys", "groupBy"]].forEach(function (names) {
				var items = [];
				list(view[names[0]]).forEach(function (item) {
					var field = nameOf(item && item.field);
					if (!field) {
						return leftOut(view, names[2], "view_field");
					}
					items.push({ field: field, order: text(item.order).toUpperCase() === "DESC" ? "DESC" : "ASC" });
				});
				if (items.length) {
					spec[names[1]] = items;
				}
			});
			// hidden columns, their order and width: the options of the type of the view, of their type
			var allowed = FIELD_OPTION_KEYS[type];
			var read = (api.listFieldOptions(view.id) || {}).field_options || {};
			var fieldOptions = {};
			Object.keys(read).forEach(function (fieldId) {
				var field = nameOf(fieldId);
				var given = read[fieldId];
				if (!field || !given || typeof given !== "object") {
					return;
				}
				var keptOptions = {};
				Object.keys(allowed).forEach(function (key) {
					var v = given[key];
					// (a label of a form only when it is set: Baserow gives "" for none)
					var ok = allowed[key] === "boolean" ? v === true || v === false
						: allowed[key] === "number" ? typeof v === "number" && isFinite(v) && Math.round(v) === v && v >= 0 && v <= 1000000
						: typeof v === "string" && v.length > 0 && v.length <= 1000;
					if (ok) {
						keptOptions[key] = v;
					}
				});
				// a field of a form: when it is shown (its conditions on the other fields, by name, their values by key),
				// its component, the options of a select it offers; nothing when they are Baserow's defaults
				if (type === "form") {
					if (given.show_when_matching_conditions === true) {
						keptOptions.showWhenMatchingConditions = true;
					}
					if (lower(given.condition_type) === "or") {
						keptOptions.conditionType = "OR";
					}
					if (FIELD_COMPONENT.test(text(given.field_component)) && text(given.field_component) !== "default") {
						keptOptions.fieldComponent = text(given.field_component);
					}
					if (given.include_all_select_options === false) {
						keptOptions.includeAllSelectOptions = false;
						var allowedOptions = [];
						list(given.allowed_select_options).forEach(function (option) {
							var optionKey = t.optionKey[field + "\u0000" + idOf(option)];
							if (optionKey == null) {
								return leftOut(view, "allowedSelectOption", "filter_value", field);
							}
							allowedOptions.push(optionKey);
						});
						keptOptions.allowedSelectOptions = allowedOptions;
					}
					var conditionGroups = orderGroups(list(given.condition_groups));
					if (conditionGroups.list.length) {
						keptOptions.conditionGroups = conditionGroups.list;
					}
					var fieldConditions = [];
					list(given.conditions).forEach(function (condition) {
						var made = describeFilter(condition, conditionGroups.keys);
						if (made.reason) {
							return leftOut(view, "fieldCondition", made.reason, made.field || field);
						}
						fieldConditions.push(made.item);
					});
					if (fieldConditions.length) {
						keptOptions.conditions = fieldConditions;
					}
				}
				if (Object.keys(keptOptions).length) {
					fieldOptions[field] = keptOptions;
				}
			});
			if (Object.keys(fieldOptions).length) {
				spec.fieldOptions = fieldOptions;
			}
			spec.key = spec.name = freeName(name, used);
			ctx.viewIds.push({ id: numberOrNull(view.id), table: t.key, view: spec.key });
			out.push(spec);
		});
		return out;
	}

	// The rows of a table as sample rows keyed by their id (_key), with the values the engine writes: no computed value,
	// no file (listed), a select by its option key, a link by the key of the linked row.
	function describeRows(api, t, opts) {
		var tableId = t.entry.id;
		var columns = [];
		Object.keys(t.kept).forEach(function (name) {
			var kept = t.kept[name];
			var spec = kept.spec || (name === t.primary.name ? t.primary : null);
			if (!spec) {
				return;
			}
			if (spec.type === "file" && !opts.attachments) {
				opts.files.push({ table: t.key, field: name });
				return;
			}
			if (contains(READ_ONLY_TYPES, spec.type) || (spec === t.primary && normalizeFieldType(kept.field.type) !== spec.type)) {
				return;
			}
			columns.push({ name: name, id: numberOrNull(kept.field.id), spec: spec });
		});
		var rows = [];
		for (var page = 1; ; page++) {
			var answer = api.listRows(tableId, page, ROWS_PAGE) || {};
			var count = numberOrNull(answer.count);
			if (count != null && count > opts.maxRows) {
				throw DescribeRefusal("rows_too_many", "The table " + t.key + " holds " + count + " rows, " + opts.maxRows + " at most.", { table: t.key, count: count, max: opts.maxRows });
			}
			var results = list(answer.results);
			results.forEach(function (raw) {
				var rowId = numberOrNull(raw && raw.id);
				if (rowId == null) {
					return;
				}
				var row = { _key: "" + rowId };
				columns.forEach(function (column) {
					var value = raw["field_" + column.id];
					var type = column.spec.type;
					if (value == null || value === "" || (Array.isArray(value) && !value.length)) {
						return;
					}
					if (type === "single_select") {
						value = t.optionKey[column.name + "\u0000" + idOf(value)];
					} else if (type === "multiple_select") {
						value = list(value).map(function (item) { return t.optionKey[column.name + "\u0000" + idOf(item)]; })
							.filter(function (key) { return key != null; });
					} else if (type === "link_row") {
						value = list(value).map(idOf).filter(function (id) { return id != null; }).map(function (id) { return "" + id; });
					} else if (type === "file") {
						value = list(value).filter(function (f) { return f && typeof f === "object" && text(f.name).length > 0; }).map(function (f) {
							return describeFile(opts.registry, f, t.key, column.name);
						});
					} else if (value && typeof value === "object") {
						return;
					}
					if (value == null || (Array.isArray(value) && !value.length)) {
						return;
					}
					row[column.name] = value;
				});
				rows.push(row);
			});
			if (rows.length > opts.maxRows) {
				throw DescribeRefusal("rows_too_many", "The table " + t.key + " holds more than " + opts.maxRows + " rows.", { table: t.key, count: rows.length, max: opts.maxRows });
			}
			if (results.length < ROWS_PAGE || answer.next == null || answer.next === "") {
				break;
			}
		}
		return rows;
	}

	// The origin of the Baserow server of the connector (protocol://host:port): the token of the account is sent to it
	// only.
	function baserowOrigin() {
		try {
			var project = com.twinsoft.convertigo.engine.Engine.theApp.databaseObjectsManager.getOriginalProjectByName("lib_BaseRow");
			var connector = project.getConnectorByName("Baserow_API_spec");
			var https = connector.isHttps() === true || ("" + connector.isHttps()) === "true";
			var port = Number(connector.getPort());
			return (https ? "https" : "http") + "://" + lower(connector.getServer()) + ":" + (port > 0 ? port : (https ? 443 : 80));
		} catch (e) {
			return "";
		}
	}

	// The origin of an URL (protocol://host:port, its default port written).
	function originOf(url) {
		var protocol = lower(url.getProtocol());
		var port = Number(url.getPort());
		return protocol + "://" + lower(url.getHost()) + ":" + (port > 0 ? port : (protocol === "https" ? 443 : 80));
	}

	// A file of a row downloaded into target (a file of the transfer folder), at most maxBytes (else file_too_large,
	// the file deleted): the Authorization header only to the origin of the Baserow server of the connector (its
	// protocol, host and port), a redirection followed without it, http or https only. Never the URL nor the token in an
	// error.
	function engineDownload(bearer, url, target, maxBytes) {
		// a fifth argument: the origin of the Baserow server (the tests in Rhino)
		var origin = arguments.length > 4 ? lower(arguments[4]) : baserowOrigin();
		var current = text(url);
		var withToken = true;
		var tooLarge = function (bytes) {
			var e = SchemaError("file_too_large", "A file holds more than " + maxBytes + " bytes.", { bytes: bytes });
			return e;
		};
		try {
			for (var hop = 0; hop < 5; hop++) {
				var parsed = new java.net.URL(current);
				var protocol = lower(parsed.getProtocol());
				if (protocol !== "https" && protocol !== "http") {
					throw SchemaError("file_download_failed", "A file is not at an http address.");
				}
				var connection = parsed.openConnection();
				connection.setInstanceFollowRedirects(false);
				connection.setConnectTimeout(15000);
				connection.setReadTimeout(60000);
				connection.setUseCaches(false);
				if (withToken && origin.length && originOf(parsed) === origin) {
					connection.setRequestProperty("Authorization", bearer);
				}
				var status = Number(connection.getResponseCode());
				if (status >= 300 && status < 400) {
					var location = connection.getHeaderField("Location");
					connection.disconnect();
					if (location == null) {
						throw SchemaError("file_download_failed", "A redirection without address for a file.");
					}
					current = "" + new java.net.URL(parsed, location);
					withToken = false;
					continue;
				}
				if (status !== 200) {
					connection.disconnect();
					var failed = SchemaError("file_download_failed", "The server of the file answered " + status + ".");
					failed.retryable = status >= 500 || status === 429;
					throw failed;
				}
				var length = Number(connection.getContentLengthLong());
				if (length > maxBytes) {
					connection.disconnect();
					throw tooLarge(length);
				}
				var input = connection.getInputStream();
				var output = new java.io.FileOutputStream(target);
				var size = 0;
				var complete = false;
				try {
					var buffer = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 65536);
					for (var n = Number(input.read(buffer)); n !== -1; n = Number(input.read(buffer))) {
						size += n;
						if (size > maxBytes) {
							throw tooLarge(size);
						}
						output.write(buffer, 0, n);
					}
					complete = true;
				} finally {
					input.close();
					output.close();
					connection.disconnect();
					if (!complete) {
						new java.io.File(target)["delete"]();
					}
				}
				return { size: size };
			}
			throw SchemaError("file_download_failed", "Too many redirections for a file.");
		} catch (e) {
			if (e && (e.code === "file_too_large" || e.code === "file_download_failed")) {
				throw e;
			}
			var broken = SchemaError("file_download_failed", "A file could not be read.");
			broken.retryable = true;
			throw broken;
		}
	}

	// The folder of a describe in the transfer folder (<java.io.tmpdir>/c8o-file-transfer/describe-<uuid>), where its
	// files are written, each in a folder of its number under its name shown (<n>/<name>): mode upload reads them there;
	// the caller deletes the folder once read.
	var engineTransfer = {
		root: function () {
			return new java.io.File(java.lang.System.getProperty("java.io.tmpdir"), TRANSFER_DIR).getCanonicalFile();
		},
		open: function () {
			var dir = new java.io.File(engineTransfer.root(), "describe-" + java.util.UUID.randomUUID());
			if (!dir.mkdirs()) {
				throw SchemaError("file_download_failed", "The transfer folder could not be made.");
			}
			return "" + dir.getCanonicalPath();
		},
		target: function (dir, n, name) {
			var folder = new java.io.File(dir, "" + n);
			folder.mkdirs();
			return "" + new java.io.File(folder, "" + name).getPath();
		},
		// only a describe folder of the transfer folder
		remove: function (dir) {
			try {
				var folder = new java.io.File(dir).getCanonicalFile();
				var root = engineTransfer.root();
				if (!root.equals(folder.getParentFile()) || ("" + folder.getName()).indexOf("describe-") !== 0) {
					return;
				}
				// its numbered folders and their file (never a link followed: a link is deleted as a file)
				var files = folder.listFiles();
				for (var i = 0; files != null && i < files.length; i++) {
					var inner = java.nio.file.Files.isSymbolicLink(files[i].toPath()) ? null : files[i].listFiles();
					for (var j = 0; inner != null && j < inner.length; j++) {
						inner[j]["delete"]();
					}
					files[i]["delete"]();
				}
				folder["delete"]();
			} catch (e) {}
		}
	};

	function engineApi(bearer, call, download) {
		if (!/^JWT\s+\S+$/.test(text(bearer))) {
			throw SchemaError("baserow_account_unavailable", "No Baserow token for the account of the user.");
		}
		var token = text(bearer);
		var fetch = download || engineDownload;
		var json = function (transaction, variables) {
			variables.__header_Authorization = token;
			return call(transaction, variables);
		};
		var body = function (value) {
			return JSON.stringify(value);
		};
		var id = function (value) {
			return "" + Math.round(Number(value));
		};
		return {
			online: true,
			listWorkspaces: function () { return list(json("_api_workspaces__GET", {}).array); },
			// the applications of the account, a base with its tables
			listApplications: function () { return list(json("_api_applications__GET", {}).array); },
			createWorkspace: function (name) { return json("_api_workspaces__POST", { name: name }).object; },
			getApplication: function (applicationId) { return json("_api_applications__application_id___GET", { application_id: id(applicationId) }).object; },
			createDatabase: function (workspaceId, name) {
				return json("_api_applications_workspace__workspace_id___POST", { workspace_id: id(workspaceId), __body: body({ name: name, type: "database" }) }).object;
			},
			deleteApplication: function (applicationId) { json("_api_applications__application_id___DELETE", { application_id: id(applicationId) }); },
			emptyTrash: function (workspaceId, applicationId) {
				json("_api_trash_workspace__workspace_id___DELETE", { workspace_id: id(workspaceId), application_id: id(applicationId) });
			},
			listTables: function (databaseId) { return list(json("_api_database_tables_database__database_id___GET", { database_id: id(databaseId) }).array); },
			createTable: function (databaseId, value) {
				return json("_api_database_tables_database__database_id___POST", { database_id: id(databaseId), __body: body(value) }).object;
			},
			// the fields of a table are kept 60 s by the transaction: read again with __nocache
			listFields: function (tableId) { return list(json("_api_database_fields_table__table_id___GET", { table_id: id(tableId), __nocache: "true" }).array); },
			createField: function (tableId, value) { return json("_api_database_fields_table__table_id___POST", { table_id: id(tableId), __body: body(value) }).object; },
			updateField: function (fieldId, value) { return json("_api_database_fields__field_id___PATCH", { field_id: id(fieldId), __body: body(value) }).object; },
			listViews: function (tableId) {
				return list(json("_api_database_views_table__table_id___GET", { table_id: id(tableId), include_attributes: "filters,sortings,group_bys,decorations" }).array);
			},
			deleteView: function (viewId) { json("_api_database_views__view_id___DELETE", { view_id: id(viewId) }); },
			// the colors of the rows of a view
			listViewDecorations: function (viewId) { return list(json("_api_database_views__view_id__decorations__GET", { view_id: id(viewId) }).array); },
			createViewDecoration: function (viewId, value) { return json("_api_database_views__view_id__decorations__POST", { view_id: id(viewId), __body: body(value) }).object; },
			// hidden columns, order and width of the fields of a view
			listFieldOptions: function (viewId) { return json("_api_database_views__view_id__field_options__GET", { view_id: id(viewId) }).object; },
			updateFieldOptions: function (viewId, value) { return json("_api_database_views__view_id__field_options__PATCH", { view_id: id(viewId), __body: body(value) }).object; },
			getFilterGroup: function (groupId) { return json("_api_database_views_filter_group__filter_group_id___GET", { filter_group_id: id(groupId) }).object; },
			createFilterGroup: function (viewId, value) {
				return json("_api_database_views__view_id__filter_groups__POST", { view_id: id(viewId), filter_type: value.filter_type, parent_group: value.parent_group == null ? null : id(value.parent_group) }).object;
			},
			deleteViewFilter: function (filterId) { json("_api_database_views_filter__view_filter_id___DELETE", { view_filter_id: id(filterId) }); },
			deleteViewSort: function (sortId) { json("_api_database_views_sort__view_sort_id___DELETE", { view_sort_id: id(sortId) }); },
			listViewGroupBys: function (viewId) { return list(json("_api_database_views__view_id__group_bys__GET", { view_id: id(viewId) }).array); },
			createViewGroupBy: function (viewId, value) { return json("_api_database_views__view_id__group_bys__POST", { view_id: id(viewId), field: id(value.field), order: value.order }).object; },
			deleteViewGroupBy: function (groupById) { json("_api_database_views_group_by__view_group_by_id___DELETE", { view_group_by_id: id(groupById) }); },
			deleteField: function (fieldId) { json("_api_database_fields__field_id___DELETE", { field_id: id(fieldId) }); },
			deleteTable: function (tableId) { json("_api_database_tables__table_id___DELETE", { table_id: id(tableId) }); },
			deleteRows: function (tableId, ids) { json("_api_database_rows_table__table_id__batch_delete__POST", { table_id: id(tableId), __body: body({ items: ids }) }); },
			// a file of a row (its URL as Baserow gives it) written to target, at most maxBytes
			downloadFile: function (url, target, maxBytes) { return fetch(token, url, target, maxBytes); },
			createView: function (tableId, value) { return json("_api_database_views_table__table_id___POST", { table_id: id(tableId), __body: body(value) }).object; },
			listViewFilters: function (viewId) { return list(json("_api_database_views__view_id__filters__GET", { view_id: id(viewId) }).array); },
			createViewFilter: function (viewId, value) { return json("_api_database_views__view_id__filters__POST", { view_id: id(viewId), __body: body(value) }).object; },
			listViewSorts: function (viewId) { return list(json("_api_database_views__view_id__sortings__GET", { view_id: id(viewId) }).array); },
			// a file (its path on the server) uploaded to the user files of the account
			uploadFile: function (path) { return json("_api_user_files_upload_file__POST", { file: path }).object; },
			createViewSort: function (viewId, value) { return json("_api_database_views__view_id__sortings__POST", { view_id: id(viewId), __body: body(value) }).object; },
			listRows: function (tableId, page, size) {
				return json("_api_database_rows_table__table_id___GET", { table_id: id(tableId), page: "" + page, size: "" + size }).object;
			},
			// rows matching a filter tree (filters, JSON), with the fields of include only
			findRows: function (tableId, query) {
				return json("_api_database_rows_table__table_id___GET", {
					table_id: id(tableId), filters: query.filters, include_fields: query.include, page: "" + query.page, size: "" + query.size
				}).object;
			},
			createRows: function (tableId, items) {
				return list((json("_api_database_rows_table__table_id__batch__POST", { table_id: id(tableId), __body: body({ items: items }) }).object || {}).items);
			},
			updateRows: function (tableId, items) {
				return list((json("_api_database_rows_table__table_id__batch__PATCH", { table_id: id(tableId), __body: body({ items: items }) }).object || {}).items);
			},
			getJob: function (jobId) { return json("_api_jobs__job_id___GET", { job_id: id(jobId) }).object; }
		};
	}

	// The error of a Baserow_API_spec answer ({document: {object|array|error}}): a Baserow error (ERROR_..., detail)
	// is final, an engine error (connection, timeout) or an answer that is not JSON can be retried.
	function answerError(response) {
		var doc = response && (response.document || (response.doc && response.doc.document)) || response || {};
		var object = doc.object;
		var engine = doc.error;
		if (engine) {
			var message = text(engine.message || engine.exception || engine);
			var error = SchemaError("baserow_unreachable", message || "Baserow did not answer.");
			error.retryable = true;
			return error;
		}
		if (object && typeof object === "object" && !Array.isArray(object) && object.error != null && object.id == null) {
			var detail = object.detail;
			if (detail && typeof detail === "object") {
				detail = JSON.stringify(detail);
			}
			var failure = SchemaError("baserow_error", text(object.error) + (detail ? ": " + text(detail) : ""));
			failure.baserowError = text(object.error);
			failure.retryable = /^ERROR_(?:MAX_LOCKS|DATABASE_DEADLOCK|TIMEOUT|.*_TIMEOUT)$/.test(failure.baserowError);
			return failure;
		}
		// an answer of Django itself (404 Not found, 405 Method not allowed): {detail} alone
		if (object && typeof object === "object" && !Array.isArray(object) && object.detail != null && object.id == null && Object.keys(object).length === 1) {
			return SchemaError("baserow_error", text(object.detail));
		}
		return null;
	}

	// ---- engine glue (Rhino only) ----------------------------------------------------------------------------------

	// Runs fn with the engine logs off, then restores the caller's setting.
	function withoutLogs(fn) {
		var MDC = org.apache.log4j.MDC;
		var previous = MDC.get("nolog");
		MDC.put("nolog", true);
		try {
			return fn();
		} finally {
			if (previous == null) {
				MDC.remove("nolog");
			} else {
				MDC.put("nolog", previous);
			}
		}
	}

	// An internal call (sequence or transaction) in a context of its own, answered as JSON ({document: ...}).
	// The tests replace it (engine.useRequester).
	var request = engineRequest;
	function engineRequest(project, target, variables) {
		var parameters = new java.util.HashMap();
		var projects = java.lang.reflect.Array.newInstance(java.lang.String, 1);
		projects[0] = project;
		parameters.put("__project", projects);
		Object.keys(target).forEach(function (key) {
			parameters.put(key, target[key]);
		});
		parameters.put("__context", "syncContext_" + java.util.UUID.randomUUID());
		Object.keys(variables).forEach(function (key) {
			if (variables[key] != null) {
				parameters.put(key, "" + variables[key]);
			}
		});
		var engine = com.twinsoft.convertigo.engine;
		var request = context.httpServletRequest != null ? context.httpServletRequest : new engine.requesters.InternalHttpServletRequest();
		var requester = new engine.requesters.InternalRequester(parameters, request);
		var response = requester.processRequest();
		try {
			engine.Engine.theApp.contextManager.remove(requester.getContext());
		} catch (e) {}
		if (context.logParameters) {
			org.apache.log4j.MDC.put("ContextualParameters", context.logParameters);
		}
		return JSON.parse("" + engine.util.XMLUtils.XmlToJson(response.getDocumentElement(), true, true, engine.enums.JsonOutput.JsonRoot.docNode));
	}

	// A Baserow_API_spec transaction, the logs off (its input holds the masked Authorization header, its answer the
	// user's data): the document of the answer, or a thrown error.
	function engineTransaction(transaction, variables) {
		var json = withoutLogs(function () {
			return request("lib_BaseRow", { __connector: "Baserow_API_spec", __transaction: transaction }, variables);
		});
		var error = answerError(json);
		if (error) {
			error.transaction = transaction;
			throw error;
		}
		return json.document || {};
	}

	// The Bearer of the user's own Baserow account, by TokenGetOrRefresh with that account, never without one (it would
	// take the previous account of the HTTP session, then the Baserow admin account):
	// - authorization: a JWT already obtained by the caller (renewed for the same account only);
	// - email and password: the account;
	// - neither: the account of the authenticated C8Oforms user (C8Oforms.BaserowAccountGet).
	function engineBearer(account) {
		var authorization = text(account.authorization);
		var email = text(account.email);
		var password = account.password == null ? "" : "" + account.password;
		var variables;
		if (authorization.length) {
			if (!/^JWT\s+\S+$/.test(authorization)) {
				throw SchemaError("baserow_account_unavailable", "authorization must be the JWT of the user's Baserow account.");
			}
			variables = { authorization: authorization };
		} else if (email.length || password.length) {
			if (!email.length || !password.length) {
				throw SchemaError("baserow_account_unavailable", "The Baserow account needs its email and its password.");
			}
			variables = { email: email, password: password };
		} else {
			var stored = withoutLogs(function () {
				return request("C8Oforms", { __sequence: "BaserowAccountGet" }, {});
			});
			var doc = stored && stored.document || {};
			if (doc.error || !text(doc.email).length || doc.password == null || !("" + doc.password).length) {
				throw SchemaError("baserow_account_unavailable", "The authenticated user has no no-code database account.");
			}
			variables = { email: text(doc.email), password: "" + doc.password };
		}
		var answer = withoutLogs(function () {
			return request("lib_BaseRow", { __sequence: "TokenGetOrRefresh" }, variables);
		});
		var tokenDoc = answer && answer.document || {};
		var bearer = text(tokenDoc.Bearer);
		if (tokenDoc.error || !/^JWT\s+\S+$/.test(bearer)) {
			throw SchemaError("baserow_account_unavailable", "The Baserow account of the user could not be opened.");
		}
		return bearer;
	}

	// The files of the engine: the download of a file of a row, the transfer folder of describe and the check of a file
	// of the transfer folder (the tests replace them: engine.useFiles).
	var fileHooks = { download: null, transfer: null, fileOf: null };

	function engineApiFor(params) {
		return engineApi(engineBearer(params || {}), engineTransaction, fileHooks.download || engineDownload);
	}

	function failure(e, extra) {
		var out = { status: "error", error: errorOf(e), retryable: e && e.retryable === true };
		for (var key in extra) {
			out[key] = extra[key];
		}
		return out;
	}

	// formscommon_SchemaApply: mode plan (offline, or reading the user's base with options.online), step, apply,
	// describe (the schemas of tables of the account, with their rows on demand), rows (one write of a migration, writeRows), upload (one file of a migration, uploadFile) or rollback (the base the
	// state created, deleted for good).
	function engineRun(params) {
		var mode = lower(params.mode || "plan");
		try {
			var options = parseJson(params.options, "options", {}) || {};
			if (mode === "plan") {
				return plan(params.schema, bool(options.online, false) ? engineApiFor(params) : null, options);
			}
			if (mode === "step") {
				return step(params.schema, params.state, engineApiFor(params), options, fileHooks.fileOf || engineTransferFile);
			}
			if (mode === "apply") {
				return apply(params.schema, params.state, engineApiFor(params), options, fileHooks.fileOf || engineTransferFile);
			}
			if (mode === "workspaces") {
				// the workspaces of the user's account, with or without a base (formscommon_ApplicationsList lists bases only)
				return {
					status: "ok", mode: mode,
					workspaces: list(engineApiFor(params).listWorkspaces()).map(function (w) { return { id: numberOrNull(w.id), name: text(w.name) }; })
				};
			}
			if (mode === "describe") {
				return describe(engineApiFor(params), options, fileHooks.transfer || engineTransfer);
			}
			if (mode === "rows") {
				return writeRows(engineApiFor(params), options);
			}
			if (mode === "upload") {
				return uploadFile(engineApiFor(params), options, engineTransferFile);
			}
			if (mode === "rollback") {
				var state = parseJson(params.state, "state", null) || {};
				if ((state.createdBase !== true || numberOrNull(state.baseId) == null) && !undoCount(state.undo)) {
					return rollback(null, state, options);
				}
				return rollback(engineApiFor(params), state, options);
			}
			throw SchemaError("mode_invalid", "Unknown mode " + mode + ": plan, step, apply, describe, rows, upload, rollback or workspaces.");
		} catch (e) {
			var out = failure(e, { mode: mode });
			// a refusal of describe (a limit) tells what it is about, for the message of the caller
			if (e && e.refused === true) {
				out.refused = true;
				["table", "count", "bytes", "max"].forEach(function (key) {
					if (e[key] != null) {
						out.error[key] = e[key];
					}
				});
			}
			return out;
		}
	}

	// DatabaseCreate: a new base in a workspace of the user.
	function engineDatabaseCreate(params) {
		try {
			var name = text(params.name);
			checkBaseName(name);
			var workspaceId = numberOrNull(params.workspace_id);
			var api = engineApiFor(params);
			if (workspaceId == null || !list(api.listWorkspaces()).some(function (w) { return numberOrNull(w.id) === workspaceId; })) {
				throw SchemaError("workspace_not_in_catalog", "The workspace " + text(params.workspace_id) + " is not one of the workspaces of the user.");
			}
			var created = api.createDatabase(workspaceId, name);
			return { status: "created", id: numberOrNull(created.id), name: text(created.name), workspaceId: workspaceId };
		} catch (e) {
			return failure(e);
		}
	}

	// TableCreate: a table holding its primary field only (no example rows), in a base the user reaches.
	function engineTableCreate(params) {
		try {
			var name = text(params.name);
			checkName(name, "table");
			var primary = text(params.primary_field) || "Name";
			checkName(primary, "primary_field");
			var databaseId = numberOrNull(params.database_id);
			if (databaseId == null) {
				throw SchemaError("database_invalid", "A database_id is required.");
			}
			var created = engineApiFor(params).createTable(databaseId, { name: name, data: [[primary]], first_row_header: true });
			return { status: "created", id: numberOrNull(created.id), name: text(created.name), databaseId: databaseId };
		} catch (e) {
			return failure(e);
		}
	}

	// DatabaseDeleteDefinitive: to the trash, then out of it.
	function engineDatabaseDelete(params) {
		try {
			return deleteBase(engineApiFor(params), params.database_id, params.workspace_id);
		} catch (e) {
			return failure(e);
		}
	}

	// JobWait: a Baserow job waited for at most timeout_ms (300 s at most).
	function engineJobWait(params) {
		try {
			var timeoutMs = Math.min(numberOrNull(params.timeout_ms) || 60000, 300000);
			var intervalMs = Math.max(numberOrNull(params.interval_ms) || 1000, 200);
			var job = waitJob(engineApiFor(params), params.job_id, { timeoutMs: timeoutMs, intervalMs: intervalMs });
			return { status: "finished", job: job };
		} catch (e) {
			return failure(e, { job: e && e.job ? e.job : null });
		}
	}

	return {
		FORMAT: FORMAT,
		FIELD_TYPES: FIELD_TYPES,
		PHASES: PHASES,
		forgetTablePaths: forgetTablePaths,
		normalizeSchema: normalizeSchema,
		translateFormula: translateFormula,
		units: units,
		plan: plan,
		step: step,
		apply: apply,
		deleteBase: deleteBase,
		rollback: rollback,
		waitJob: waitJob,
		describe: describe,
		writeRows: writeRows,
		uploadFile: uploadFile,
		engineApi: engineApi,
		answerError: answerError,
		parseJson: parseJson,
		map: map,
		engine: {
			run: engineRun,
			databaseCreate: engineDatabaseCreate,
			tableCreate: engineTableCreate,
			databaseDelete: engineDatabaseDelete,
			jobWait: engineJobWait,
			useRequester: function (fn) {
				request = fn || engineRequest;
			},
			useFiles: function (hooks) {
				fileHooks = { download: hooks && hooks.download || null, transfer: hooks && hooks.transfer || null, fileOf: hooks && hooks.fileOf || null };
			},
			download: engineDownload,
			transfer: engineTransfer,
			transferFile: engineTransferFile
		}
	};
})();

if (typeof module !== "undefined" && module.exports) {
	module.exports = BaserowSchema;
}
