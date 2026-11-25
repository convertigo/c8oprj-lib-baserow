// The label of the links of the rows a table source reads (formssource_GetTableData), when its forms_config names, for a
// link_row column of the table, another column of the linked table to show: link_display {"<link column>": "<column of
// the linked table>"}. Baserow gives each link of a cell as {id, value}, value being the primary column of the linked row:
// value becomes that other column of the row, as text. The linked rows are read with the account of the source, on a
// linked table that forms_config.link_row_table_id lists (the tables the owner of the source signed, js/baserow_source_owner.js
// of C8Oforms), their id and that column only, page after page until every link is found. A column that is not a link_row
// of the table, a table not listed, a column the linked table does not have, a row not found (beyond maxRows rows read) or
// an empty label: the link keeps the value Baserow gave.
var baserowLinkDisplay = (function () {
	var PAGE_SIZE = 200;
	var MAX_COLUMNS = 50;
	var text = function (value) {
		return value == null ? "" : "" + value;
	};
	var asList = function (value) {
		return value == null ? [] : (Array.isArray(value) ? value : [value]);
	};
	var isObject = function (value) {
		return value != null && typeof value == "object" && !Array.isArray(value);
	};

	// The text of a cell of the column shown: a text, a number, a date as Baserow gives it, the value of a choice or of a
	// lookup, the name of a collaborator, the items of a list joined by ", ".
	var cellText = function (value, depth) {
		depth = depth || 0;
		if (value == null || depth > 4) {
			return "";
		}
		if (typeof value == "string" || typeof value == "number" || typeof value == "boolean") {
			return "" + value;
		}
		if (Array.isArray(value)) {
			return value.map(function (item) {
				return cellText(item, depth + 1);
			}).filter(function (item) {
				return item !== "";
			}).join(", ");
		}
		if (isObject(value)) {
			if (value.value != null) {
				return cellText(value.value, depth + 1);
			}
			if (value.visible_name != null) {
				return text(value.visible_name);
			}
			if (value.name != null) {
				return text(value.name);
			}
			return "";
		}
		// a Java string, number or boolean
		return text(value);
	};

	// The link columns of forms_config.link_display to show by another column: [{column, tableId, display}], a link_row
	// column of the table (structure: its fields) whose linked table is one of allowedTables (forms_config.link_row_table_id).
	var plan = function (linkDisplay, structure, allowedTables) {
		var out = [];
		if (!isObject(linkDisplay)) {
			return out;
		}
		var allowed = asList(allowedTables).map(function (id) {
			return text(id);
		});
		var fields = asList(structure);
		Object.keys(linkDisplay).slice(0, MAX_COLUMNS).forEach(function (column) {
			var display = linkDisplay[column];
			if (typeof display != "string" || display === "" || display.length > 255) {
				return;
			}
			var field = fields.filter(function (current) {
				return current != null && text(current.name) === column;
			})[0];
			if (field == null || text(field.type) !== "link_row" || field.link_row_table_id == null) {
				return;
			}
			var tableId = text(field.link_row_table_id);
			if (!/^\d+$/.test(tableId) || allowed.indexOf(tableId) == -1) {
				return;
			}
			out.push({ column: column, tableId: tableId, display: display });
		});
		return out;
	};

	// The include parameter of Baserow for one field name (user_field_names): quoted when it holds a comma or a quote.
	var fieldList = function (name) {
		var value = text(name);
		return /[,"\\]/.test(value) ? "\"" + value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"" : value;
	};

	// The labels {id: text} of the rows ids (a set {id: true}) of a linked table: its column display, read page after page
	// (read(tableId, display, page, size) answers the page of Baserow, {results, next}, or null) until every id is found, no
	// page is left or maxRows rows are read.
	var labelsOf = function (entry, ids, read, maxRows) {
		var labels = {};
		var missing = Object.keys(ids).length;
		var readRows = 0;
		for (var page = 1; missing > 0 && readRows < maxRows; page++) {
			var answer = read(entry.tableId, entry.display, page, PAGE_SIZE);
			if (!isObject(answer) || answer.error != null || answer.detail != null) {
				break;
			}
			var results = asList(answer.results);
			for (var r = 0; r < results.length; r++) {
				var row = results[r];
				var id = row != null ? text(row.id) : "";
				if (id !== "" && ids[id] === true && labels[id] == null) {
					labels[id] = cellText(row[entry.display]);
					missing--;
				}
			}
			readRows += results.length;
			if (results.length === 0 || answer.next == null || text(answer.next) === "") {
				break;
			}
		}
		return labels;
	};

	// The links of the rows (the results of Baserow, by user field names) labelled by the column each entry shows.
	// Answers {links, labelled}.
	var apply = function (rows, entries, read, maxRows) {
		var summary = { links: 0, labelled: 0 };
		var limit = maxRows > 0 ? maxRows : 2000;
		asList(entries).forEach(function (entry) {
			var ids = {};
			var links = [];
			asList(rows).forEach(function (row) {
				if (!isObject(row)) {
					return;
				}
				asList(row[entry.column]).forEach(function (link) {
					if (isObject(link) && link.id != null && text(link.id) !== "") {
						ids[text(link.id)] = true;
						links.push(link);
					}
				});
			});
			summary.links += links.length;
			if (links.length === 0) {
				return;
			}
			var labels = labelsOf(entry, ids, read, limit);
			links.forEach(function (link) {
				var label = labels[text(link.id)];
				if (label != null && label !== "") {
					link.value = label;
					summary.labelled++;
				}
			});
		});
		return summary;
	};

	return { PAGE_SIZE: PAGE_SIZE, cellText: cellText, plan: plan, fieldList: fieldList, apply: apply };
})();

if (typeof module !== "undefined" && module.exports) {
	module.exports = baserowLinkDisplay;
}
