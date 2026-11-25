// A filter or a sort on the row id or the row order of a table source (formssource_GetTableData): Baserow filters and
// sorts its fields only, never these two (they are no field; a filter on "id" was an unknown field, error 100). The read
// asks Baserow the rest of the filter and of the sort, and the library keeps and orders the rows itself:
// - plan: the filter of the source split in two, the part Baserow does and the conditions on the row id or order. Those
//   combine with the rest by AND only: a condition of the root, or of a group of AND groups, or a group made only of
//   such conditions (AND or OR). Anywhere else (beside other conditions under an OR) the filter is refused.
// - the exact path: equal (or any of, an OR of equal) on "id", with no other condition for Baserow, no view and no sort
//   on a field, reads those rows by their id (at most MAX_DIRECT_IDS), whatever the size of the table: never incomplete.
// - the bounded path, any other case: the rows Baserow answers for the rest of the filter, read up to max_search_results,
//   are kept by the conditions on the row id or order and ordered by a sort on them (its first key; a later key is dropped,
//   the order of Baserow keeps the ties by id). When the read stops at max_search_results with rows left, the answer says
//   so: incomplete (and rows_read), never a silently partial list. A grid page is then cut by the library.
// The fields of a row read by its id are the ones the read of the table includes, the id and the order.
var baserowRowFilter = (function () {
	var ROW_FIELDS = ["id", "order"];
	var OPERATORS = ["equal", "not_equal", "higher_than", "higher_than_or_equal", "lower_than", "lower_than_or_equal",
		"contains", "contains_not", "empty", "not_empty"];
	var MAX_DIRECT_IDS = 100;
	var MAX_DEPTH = 50;
	var text = function (value) {
		return value == null ? "" : ("" + value);
	};
	var trim = function (value) {
		return text(value).replace(/^\s+|\s+$/g, "");
	};
	var isRowField = function (field) {
		return ROW_FIELDS.indexOf(text(field)) != -1;
	};
	var isGroup = function (node) {
		return node != null && typeof node == "object" && (Array.isArray(node.filters) || Array.isArray(node.groups));
	};
	var children = function (node) {
		return (Array.isArray(node.filters) ? node.filters : []).concat(Array.isArray(node.groups) ? node.groups : []);
	};
	var modeOf = function (node) {
		return text(node.mode).toUpperCase() == "OR" ? "OR" : "AND";
	};
	var parse = function (value) {
		if (value == null) {
			return null;
		}
		if (typeof value == "object") {
			return value;
		}
		var raw = trim(value);
		if (raw == "" || raw == "null") {
			return null;
		}
		try {
			return JSON.parse(raw);
		}
		catch (e) {
			return undefined;
		}
	};
	var hasRowLeaf = function (node, depth) {
		if (node == null || typeof node != "object" || depth > MAX_DEPTH) {
			return false;
		}
		if (isGroup(node)) {
			return children(node).some(function (child) {
				return hasRowLeaf(child, depth + 1);
			});
		}
		return isRowField(node.field);
	};

	// A decimal text (an id, an order "1.50000000000000000000", a value) as [sign, integer digits, fraction digits], null
	// when it is no decimal number.
	var decimal = function (value) {
		var match = /^([-+]?)0*(\d*)(?:\.(\d*))?$/.exec(trim(value));
		if (match == null || (match[2] == "" && (match[3] == null || match[3] == "") && !/\d/.test(trim(value)))) {
			return null;
		}
		var fraction = (match[3] || "").replace(/0+$/, "");
		var integer = match[2];
		var negative = match[1] == "-" && (integer != "" || fraction != "");
		return { negative: negative, integer: integer, fraction: fraction };
	};
	// -1, 0 or 1, exact for any number of digits (the order of Baserow has 20 decimals)
	var compareDecimal = function (a, b) {
		if (a.negative != b.negative) {
			return a.negative ? -1 : 1;
		}
		var sign = a.negative ? -1 : 1;
		if (a.integer.length != b.integer.length) {
			return (a.integer.length < b.integer.length ? -1 : 1) * sign;
		}
		if (a.integer != b.integer) {
			return (a.integer < b.integer ? -1 : 1) * sign;
		}
		var length = Math.max(a.fraction.length, b.fraction.length);
		var fa = a.fraction + new Array(length - a.fraction.length + 1).join("0");
		var fb = b.fraction + new Array(length - b.fraction.length + 1).join("0");
		return fa == fb ? 0 : (fa < fb ? -1 : 1) * sign;
	};
	var decimalText = function (value) {
		var parsed = decimal(value);
		if (parsed == null) {
			return trim(value);
		}
		return (parsed.negative ? "-" : "") + (parsed.integer == "" ? "0" : parsed.integer) + (parsed.fraction != "" ? "." + parsed.fraction : "");
	};

	// Whether the row id or order of a row passes one condition {field, op, value}, as Baserow compares a number field:
	// an empty value leaves the rows (equal keeps none, as lib_BaseRow sends it), a value that is no number keeps none
	// (not equal keeps them all).
	var passes = function (row, leaf) {
		var cell = row == null ? null : row[text(leaf.field)];
		var own = decimal(cell);
		var op = text(leaf.op);
		var values = Array.isArray(leaf.value) ? leaf.value : [leaf.value];
		if (op == "empty") {
			return cell == null || trim(cell) == "";
		}
		if (op == "not_empty") {
			return !(cell == null || trim(cell) == "");
		}
		if (op == "equal" || op == "not_equal") {
			var found = values.some(function (value) {
				var wanted = decimal(value);
				return own != null && wanted != null && trim(value) != "" && compareDecimal(own, wanted) == 0;
			});
			return op == "equal" ? found : !found;
		}
		var value = values.length == 1 ? values[0] : null;
		if (trim(value) == "") {
			return true;
		}
		if (op == "contains" || op == "contains_not") {
			var contained = decimalText(cell).indexOf(trim(value)) != -1;
			return op == "contains" ? contained : !contained;
		}
		var wantedNumber = decimal(value);
		if (own == null || wantedNumber == null) {
			return false;
		}
		var comparison = compareDecimal(own, wantedNumber);
		switch (op) {
			case "higher_than": return comparison > 0;
			case "higher_than_or_equal": return comparison >= 0;
			case "lower_than": return comparison < 0;
			case "lower_than_or_equal": return comparison <= 0;
		}
		return false;
	};

	// The ids an equal (or an any of) on "id" allows, null when the condition allows others too.
	var equalIds = function (leaf) {
		if (text(leaf.field) != "id" || text(leaf.op) != "equal") {
			return null;
		}
		var ids = [];
		(Array.isArray(leaf.value) ? leaf.value : [leaf.value]).forEach(function (value) {
			var raw = trim(value);
			if (/^\d+$/.test(raw) && raw.length < 16) {
				var id = "" + parseInt(raw, 10);
				if (ids.indexOf(id) == -1) {
					ids.push(id);
				}
			}
		});
		return ids;
	};
	var constraintIds = function (constraint) {
		if (constraint.leaf != null) {
			return equalIds(constraint.leaf);
		}
		if (constraint.mode == "OR") {
			var union = [];
			for (var i = 0; i < constraint.leaves.length; i++) {
				var ids = equalIds(constraint.leaves[i]);
				if (ids == null) {
					return null;
				}
				ids.forEach(function (id) {
					if (union.indexOf(id) == -1) {
						union.push(id);
					}
				});
			}
			return union;
		}
		var intersection = null;
		constraint.leaves.forEach(function (leaf) {
			var leafIds = equalIds(leaf);
			if (leafIds != null) {
				intersection = intersection == null ? leafIds : intersection.filter(function (id) {
					return leafIds.indexOf(id) != -1;
				});
			}
		});
		return intersection;
	};
	var keeps = function (constraints, row) {
		return constraints.every(function (constraint) {
			if (constraint.leaf != null) {
				return passes(row, constraint.leaf);
			}
			return constraint.mode == "OR" ? constraint.leaves.some(function (leaf) {
				return passes(row, leaf);
			}) : constraint.leaves.every(function (leaf) {
				return passes(row, leaf);
			});
		});
	};

	// The filter without its conditions on the row id or order (null when nothing is left), and these conditions.
	var split = function (root) {
		var constraints = [];
		var problem = null;
		var walk = function (node, allAnd, depth) {
			if (problem != null || node == null || typeof node != "object" || depth > MAX_DEPTH) {
				return node;
			}
			if (!isGroup(node)) {
				if (!isRowField(node.field)) {
					return node;
				}
				if (!allAnd) {
					problem = "A filter on the row " + text(node.field) + " is combined with the other filters with AND only";
					return null;
				}
				if (OPERATORS.indexOf(text(node.op)) == -1) {
					problem = "The row " + text(node.field) + " cannot be filtered with " + text(node.op);
					return null;
				}
				constraints.push({ leaf: { field: text(node.field), op: text(node.op), value: node.value } });
				return null;
			}
			var items = children(node);
			var rowOnly = items.length > 0 && items.every(function (item) {
				return !isGroup(item) && item != null && isRowField(item.field);
			});
			if (rowOnly) {
				if (!allAnd) {
					problem = "A filter on the row id or order is combined with the other filters with AND only";
					return null;
				}
				var leaves = [];
				for (var i = 0; i < items.length; i++) {
					if (OPERATORS.indexOf(text(items[i].op)) == -1) {
						problem = "The row " + text(items[i].field) + " cannot be filtered with " + text(items[i].op);
						return null;
					}
					leaves.push({ field: text(items[i].field), op: text(items[i].op), value: items[i].value });
				}
				constraints.push({ mode: modeOf(node), leaves: leaves });
				return null;
			}
			var mode = modeOf(node);
			var kept = [];
			items.forEach(function (item) {
				var rest = walk(item, allAnd && (mode == "AND" || items.length == 1), depth + 1);
				if (rest != null) {
					kept.push(rest);
				}
			});
			return kept.length == 0 ? null : { mode: mode, filters: kept };
		};
		var rest = walk(root, true, 0);
		return { rest: rest, constraints: constraints, error: problem };
	};

	// The sort of the source: {sorts: [{name, order}]} or a Baserow order_by text. A first key on the row id or order is
	// done by the library (the order ascending is the order of Baserow itself, without a view); a later one is dropped.
	var splitSort = function (sortValue, viewId) {
		var none = { sort: sortValue, rowSort: null };
		if (sortValue == null) {
			return none;
		}
		var raw = trim(sortValue);
		if (raw == "" || raw == "null") {
			return none;
		}
		var items;
		var json = raw.charAt(0) == "{";
		if (json) {
			var parsed = parse(raw);
			if (parsed == null || !Array.isArray(parsed.sorts)) {
				return none;
			}
			items = parsed.sorts.filter(function (sort) {
				return sort != null && sort.name != null && text(sort.name) != "";
			}).map(function (sort) {
				return { name: text(sort.name), desc: text(sort.order) != "asc", sort: sort };
			});
		}
		else {
			if (raw.indexOf("\"") != -1 || raw.indexOf("\\") != -1) {
				return none;
			}
			items = raw.split(",").map(function (item) {
				var name = trim(item);
				return { name: name.replace(/^[-+]/, ""), desc: name.charAt(0) == "-", raw: name };
			}).filter(function (item) {
				return item.name != "";
			});
		}
		if (!items.some(function (item) { return isRowField(item.name); })) {
			return none;
		}
		var rowSort = null;
		var kept = items;
		if (isRowField(items[0].name)) {
			var first = items[0];
			kept = [];
			if (!(first.name == "order" && !first.desc && (viewId == null || trim(viewId) == ""))) {
				rowSort = { field: first.name, desc: first.desc };
			}
		}
		else {
			kept = items.filter(function (item) {
				return !isRowField(item.name);
			});
		}
		var sort = kept.length == 0 ? null : (json ? JSON.stringify({ sorts: kept.map(function (item) { return item.sort; }) }) :
			kept.map(function (item) { return item.raw; }).join(","));
		return { sort: sort, rowSort: rowSort };
	};

	// What the read asks Baserow (filter, sort) and what the library does after it. options: {model, viewId, gridPage,
	// gridPageSize}. active: the library keeps or orders the rows; direct: the exact path (rows read by their id).
	var plan = function (filterValue, sortValue, options) {
		options = options || {};
		var out = { active: false, direct: false, error: null, filter: filterValue, sort: sortValue, constraints: [],
			ids: null, rowSort: null, gridPage: null, gridPageSize: null };
		if (options.model === true) {
			return out;
		}
		var sorted = splitSort(sortValue, options.viewId);
		out.sort = sorted.sort;
		out.rowSort = sorted.rowSort;
		var root = parse(filterValue);
		if (root != null && root !== undefined && hasRowLeaf(root, 0)) {
			var parts = split(root);
			if (parts.error != null) {
				out.error = parts.error;
				return out;
			}
			out.filter = parts.rest == null ? null : JSON.stringify(parts.rest);
			out.constraints = parts.constraints;
		}
		out.active = out.constraints.length > 0 || out.rowSort != null;
		if (!out.active) {
			return out;
		}
		var ids = null;
		out.constraints.forEach(function (constraint) {
			var allowed = constraintIds(constraint);
			if (allowed != null) {
				ids = ids == null ? allowed : ids.filter(function (id) {
					return allowed.indexOf(id) != -1;
				});
			}
		});
		out.ids = ids;
		var noView = options.viewId == null || trim(options.viewId) == "";
		out.direct = ids != null && ids.length <= MAX_DIRECT_IDS && out.filter == null && noView &&
			(out.sort == null || ids.length <= 1);
		var askedSize = parseInt(text(options.gridPageSize), 10);
		if (!isNaN(askedSize) && askedSize > 0) {
			var askedPage = parseInt(text(options.gridPage), 10);
			out.gridPageSize = Math.min(askedSize, 200);
			out.gridPage = isNaN(askedPage) || askedPage < 1 ? 1 : askedPage;
		}
		return out;
	};

	var orderRows = function (rows, field, desc) {
		var indexed = rows.map(function (row, index) {
			return { row: row, index: index, value: decimal(row == null ? null : row[field]) };
		});
		indexed.sort(function (a, b) {
			var comparison = a.value == null || b.value == null ? (a.value == null ? (b.value == null ? 0 : 1) : -1) :
				compareDecimal(a.value, b.value) * (desc ? -1 : 1);
			return comparison != 0 ? comparison : a.index - b.index;
		});
		return indexed.map(function (entry) {
			return entry.row;
		});
	};
	// A row read by its id with the fields the read of the table includes (null: every field), its id and its order.
	var keepFields = function (row, includes) {
		if (includes == null) {
			return row;
		}
		var kept = {};
		Object.keys(row).forEach(function (name) {
			if (isRowField(name) || includes.indexOf(name) != -1) {
				kept[name] = row[name];
			}
		});
		return kept;
	};

	// The rows of the source once read: rows (the rows Baserow answered for the rest of the filter), more (the read
	// stopped at max_search_results with rows left), readRow(id) (the row of that id as Baserow answers it), includes
	// (the fields the read includes, null for all). Answers {rows, count, incomplete, read, paged, page, size, error}.
	var apply = function (current, rows, more, readRow, includes) {
		var out = { rows: [], count: 0, incomplete: false, read: 0, paged: false, page: 1, size: null, error: null };
		var source = Array.isArray(rows) ? rows : (rows != null ? [rows] : []);
		if (current.direct) {
			source = [];
			for (var i = 0; i < current.ids.length; i++) {
				var answer = readRow(current.ids[i]);
				if (answer != null && typeof answer == "object" && answer.id != null && answer.error == null) {
					source.push(keepFields(answer, includes));
				}
				else if (answer == null || typeof answer != "object" || text(answer.error) != "ERROR_ROW_DOES_NOT_EXIST") {
					// a refused token, Baserow out of reach: an error, never a row silently missing
					out.error = "The row " + current.ids[i] + " could not be read: " + text(answer != null && typeof answer == "object" ? (answer.error || answer.detail) : "no answer");
					return out;
				}
			}
			// in the order of the table, as Baserow lists them
			source = orderRows(orderRows(source, "id", false), "order", false);
		}
		out.read = source.length;
		var kept = source.filter(function (row) {
			return keeps(current.constraints, row);
		});
		if (current.rowSort != null) {
			kept = orderRows(kept, current.rowSort.field, current.rowSort.desc);
		}
		var allFound = current.ids != null && current.ids.every(function (id) {
			return kept.some(function (row) {
				return text(row.id) == id;
			});
		});
		out.incomplete = !current.direct && more === true && !allFound;
		out.count = kept.length;
		if (current.gridPageSize != null) {
			out.paged = true;
			out.size = current.gridPageSize;
			out.page = current.gridPage;
			kept = kept.slice((out.page - 1) * out.size, out.page * out.size);
		}
		out.rows = kept;
		return out;
	};

	return { ROW_FIELDS: ROW_FIELDS, OPERATORS: OPERATORS, MAX_DIRECT_IDS: MAX_DIRECT_IDS, plan: plan, apply: apply,
		passes: passes, compareDecimal: function (a, b) { return compareDecimal(decimal(a), decimal(b)); } };
})();

if (typeof module !== "undefined" && module.exports) {
	module.exports = baserowRowFilter;
}
