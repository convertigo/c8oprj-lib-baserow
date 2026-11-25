// The row condition of a respondent write (C8Oforms js/action_access.js): when the step that runs a write may only change
// some rows, formscommon_CheckConfig answers the column of the condition (row_column) and the write asks
// formscommon_CheckRow before it changes or deletes a row. No dependency.

// The texts a write puts in the column of the condition: the value data holds for the column (a text, a number, a
// boolean, or a list of them), the option values for the ids of a single or multiple select, as a JSON list of texts;
// null when data does not set the column. data: the row about to be written (an object or its JSON text, keyed by field
// names); fields: the fields of the table (readTableFields, or the JSON of FieldsList: a field or a list of fields).
// A value that cannot be read gives an empty list: C8Oforms then refuses a condition on the user or their groups.
function rowRuleWritten(data, column, fields) {
	var key = function (value) {
		var name = value == null ? "" : ("" + value).trim();
		try {
			name = name.normalize("NFC");
		} catch (e) {
		}
		return name.toLowerCase();
	};
	var list = function (value) {
		return value == null ? [] : (Object.prototype.toString.call(value) == "[object Array]" ? value : [value]);
	};
	var row = data;
	if (typeof row == "string" || (typeof java != "undefined" && row instanceof java.lang.String)) {
		try {
			row = JSON.parse("" + row);
		} catch (e) {
			return "[]";
		}
	}
	if (row == null || typeof row != "object" || Object.prototype.toString.call(row) == "[object Array]") {
		return "[]";
	}
	var wanted = key(column);
	var name = null;
	if (Object.prototype.hasOwnProperty.call(row, "" + column)) {
		name = "" + column;
	} else {
		for (var candidate in row) {
			if (Object.prototype.hasOwnProperty.call(row, candidate) && key(candidate) == wanted) {
				name = candidate;
				break;
			}
		}
	}
	if (name == null) {
		return null;
	}
	var field = null;
	var all = list(fields);
	for (var f = 0; f < all.length; f++) {
		if (all[f] != null && typeof all[f] == "object" && key(all[f].name) == key(name)) {
			field = all[f];
			break;
		}
	}
	var select = field != null && (field.type == "single_select" || field.type == "multiple_select");
	var optionValue = function (id) {
		var options = select ? list(field.select_options) : [];
		for (var o = 0; o < options.length; o++) {
			if (options[o] != null && ("" + options[o].id) == ("" + id)) {
				return options[o].value == null ? "" : "" + options[o].value;
			}
		}
		return null;
	};
	var texts = [];
	var add = function (value, depth) {
		if (value == null || depth > 4) {
			return;
		}
		if (Object.prototype.toString.call(value) == "[object Array]") {
			for (var i = 0; i < value.length && i < 1000; i++) {
				add(value[i], depth + 1);
			}
			return;
		}
		if (typeof value == "object") {
			add(Object.prototype.hasOwnProperty.call(value, "value") ? value.value : value.name, depth + 1);
			return;
		}
		var text = ("" + value).trim();
		if (select && /^\d+$/.test(text) && optionValue(text) != null) {
			text = optionValue(text).trim();
		}
		if (text != "") {
			texts.push(text);
		}
	};
	add(row[name], 0);
	return JSON.stringify(texts);
}
