// A text formula that only formats one number or date field (an amount written "44 000", a date written "25/10/2026")
// is ordered and compared by that field: Baserow orders and filters a text formula as text, so "9 000" came after
// "44 000". Only a formula reading exactly one field with field(), no lookup, is followed, and only to a field whose
// values are numbers or dates.
var SORT_SOURCE_NUMBER_TYPES = ["number", "autonumber", "count", "rating", "duration"];
var SORT_SOURCE_DATE_TYPES = ["date", "created_on", "last_modified"];
// the Baserow filters that compare a number or a date: on such a formula they apply to its source field
var SORT_SOURCE_NUMBER_FILTERS = ["equal", "not_equal", "higher_than", "higher_than_or_equal", "lower_than", "lower_than_or_equal"];

var getSortSourceKind = function (field) {
	if (field == null) {
		return null;
	}
	var type = ["formula", "rollup", "lookup"].indexOf("" + field.type) != -1 ? "" + field.formula_type : "" + field.type;
	if (SORT_SOURCE_NUMBER_TYPES.indexOf(type) != -1) {
		return "number";
	}
	if (SORT_SOURCE_DATE_TYPES.indexOf(type) != -1) {
		return "date";
	}
	return null;
};

// fieldsList: the fields of the table as Baserow lists them, fieldName: a field of the table.
// Returns { name, kind } of the number or date field the text formula fieldName formats, or null.
var getFormulaSortSource = function (fieldsList, fieldName) {
	var list = Array.isArray(fieldsList) ? fieldsList : (fieldsList != null ? [fieldsList] : []);
	var findField = function (name) {
		for (var iField = 0; iField < list.length; iField++) {
			if (list[iField] != null && ("" + list[iField].name) === ("" + name)) {
				return list[iField];
			}
		}
		return null;
	};
	var field = findField(fieldName);
	if (field == null || field.type != "formula" || ("" + field.formula_type) != "text" || field.formula == null) {
		return null;
	}
	var formula = "" + field.formula;
	if (/\blookup\s*\(/i.test(formula)) {
		return null;
	}
	var names = [];
	var fieldPattern = /\bfield\s*\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*\)/gi;
	var match;
	while ((match = fieldPattern.exec(formula)) != null) {
		var name = (match[1] != null ? match[1] : match[2]).replace(/\\(.)/g, "$1");
		if (names.indexOf(name) == -1) {
			names.push(name);
		}
	}
	if (names.length != 1) {
		return null;
	}
	var source = findField(names[0]);
	var kind = getSortSourceKind(source);
	return kind == null ? null : { name: "" + source.name, kind: kind };
};

// The field a filter {field, op, value} compares: the source of a formatting text formula for a number comparison
// (a numeric value) or a date comparison, else the field itself.
var getFilterSortSourceField = function (fieldsList, fieldName, op, value) {
	var source = getFormulaSortSource(fieldsList, fieldName);
	if (source == null) {
		return fieldName;
	}
	var operator = "" + op;
	if (source.kind == "number" && SORT_SOURCE_NUMBER_FILTERS.indexOf(operator) != -1 &&
			/^\s*-?\d+(?:\.\d+)?\s*$/.test(value == null ? "" : "" + value)) {
		return source.name;
	}
	if (source.kind == "date" && /^date_/.test(operator)) {
		return source.name;
	}
	return fieldName;
};

// Baserow (1.34) refuses to order the rows by some fields and then fails the whole read (ERROR_ORDER_BY_FIELD_NOT_POSSIBLE):
// a file or a password field, a formula or a lookup giving a file, a multiple select, collaborators, a link, a button or an
// error, an array (a lookup) of such values. A sort on such a field is dropped from order_by: the rows are read without it.
var UNORDERABLE_FIELD_TYPES = ["file", "password"];
var UNORDERABLE_FORMULA_TYPES = ["invalid", "single_file", "multiple_select", "multiple_collaborators", "link", "button"];
// the values Baserow orders an array by (can_order_by_in_array): an array of anything else cannot be ordered
var ORDERABLE_ARRAY_FORMULA_TYPES = ["text", "char", "url", "number", "boolean", "duration", "date", "single_select"];

var getFieldTypeText = function (value) {
	var text = value == null ? "" : "" + value;
	return text == "null" || text == "undefined" ? "" : text;
};

// field: a field of the table as Baserow lists it. False only when Baserow cannot order by it; a type it does not tell
// (no array_formula_type) leaves the sort to Baserow.
var canOrderByField = function (field) {
	if (field == null) {
		return true;
	}
	if (UNORDERABLE_FIELD_TYPES.indexOf(getFieldTypeText(field.type)) != -1) {
		return false;
	}
	// formula, lookup, rollup, count: ordered as the type of their result
	var formulaType = getFieldTypeText(field.formula_type);
	if (formulaType == "array") {
		var arrayType = getFieldTypeText(field.array_formula_type);
		return arrayType == "" || ORDERABLE_ARRAY_FORMULA_TYPES.indexOf(arrayType) != -1;
	}
	return UNORDERABLE_FORMULA_TYPES.indexOf(formulaType) == -1;
};

// fieldsList: the fields of the table as Baserow lists them. An unknown field is left to Baserow (ORDER_BY_FIELD_NOT_FOUND).
var canOrderBySortField = function (fieldsList, fieldName) {
	var list = Array.isArray(fieldsList) ? fieldsList : (fieldsList != null ? [fieldsList] : []);
	for (var iField = 0; iField < list.length; iField++) {
		if (list[iField] != null && ("" + list[iField].name) === ("" + fieldName)) {
			return canOrderByField(list[iField]);
		}
	}
	return true;
};

// Baserow splits order_by like a CSV line (quote ", escape \, "" a quote inside quotes): its items as written (raw) and
// the field name each one orders by, without its "-" or "+".
var splitBaserowOrderBy = function (orderText) {
	var items = [];
	var raw = "";
	var value = "";
	var inQuotes = false;
	var started = false;
	var pushItem = function () {
		items.push({ raw: raw, name: /^[-+]/.test(value) ? value.substring(1) : value });
		raw = "";
		value = "";
		started = false;
	};
	for (var iChar = 0; iChar < orderText.length; iChar++) {
		var c = orderText.charAt(iChar);
		if (c == "\\" && iChar + 1 < orderText.length) {
			raw += c + orderText.charAt(iChar + 1);
			value += orderText.charAt(++iChar);
			started = true;
		} else if (inQuotes) {
			raw += c;
			if (c != "\"") {
				value += c;
			} else if (orderText.charAt(iChar + 1) == "\"") {
				raw += "\"";
				value += "\"";
				iChar++;
			} else {
				inQuotes = false;
			}
		} else if (c == ",") {
			pushItem();
		} else if (c == "\"" && !started) {
			raw += c;
			inQuotes = true;
			started = true;
		} else {
			raw += c;
			value += c;
			started = true;
		}
	}
	pushItem();
	return items;
};
