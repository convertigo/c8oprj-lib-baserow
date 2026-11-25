// (forms_appendFiles) The files a write sends to a file column added to the files the row already has, instead of
// replacing them. forms_AddRow and forms_AddRowFromData write a file column as the list of the files uploaded by this
// submit, and Baserow replaces the list of the cell: a row saved with A and B, then with C, kept C only.
// With forms_appendFiles, an update (forms_id set) reads its row again just before it writes, with the account of the
// source and only once formscommon_CheckConfig and formscommon_CheckRow allowed the write, and writes for each file column
// of the write the files of the row followed by the new files, each file once: a file is known by its Baserow name, the
// id of an uploaded file (Baserow gives the same name to the same file uploaded again). A file column the write sends
// without a new file is left out of the write: the row keeps its files. The other columns and the other rows are written
// as without the option. A creation, or a write without a file column, reads nothing.
// Two appends to the same row on this server run one after the other: the row is locked from its read to the end of its
// write (a lease of LEASE_MS, waited for WAIT_MS at most, then the write goes on without the lock). A write made by another
// server, in Baserow itself or by a write without the option between the read and the write is not seen: Baserow has no
// version or lock a write could check.
// Included by forms_AddRow and forms_AddRowFromData (step AppendFiles). No dependency; no const, it can be included twice.
var baserowFileAppend = (function () {
	var LEASE_MS = 60000;
	var WAIT_MS = 10000;
	var STEP_MS = 25;

	var text = function (value) {
		return value == null ? "" : "" + value;
	};
	var isArray = function (value) {
		return Object.prototype.toString.call(value) == "[object Array]";
	};
	var isObject = function (value) {
		return value != null && typeof value == "object" && !isArray(value);
	};
	var asList = function (value) {
		return value == null ? [] : (isArray(value) ? value : [value]);
	};

	// the option of the write: "true" (a checkbox of the step editor of C8Oforms, or a boolean); anything else is off
	var wanted = function (value) {
		return value === true || text(value).trim().toLowerCase() == "true";
	};

	// The file columns of a write: the keys of data (the row about to be written, keyed by field names) whose field is a
	// file column and whose value is a list of files. fields: the fields of the table (readTableFields, or the JSON of
	// FieldsList: a field or a list of fields).
	var columns = function (data, fields) {
		if (!isObject(data)) {
			return [];
		}
		var files = {};
		asList(fields).forEach(function (field) {
			if (isObject(field) && text(field.type) == "file" && text(field.name) != "") {
				files[text(field.name)] = true;
			}
		});
		return Object.keys(data).filter(function (name) {
			return files[name] === true && isArray(data[name]);
		});
	};

	// One file of a cell as Baserow takes it: its name, and the name shown when the row gives one (renamed in Baserow);
	// null without a name.
	var entry = function (file) {
		if (!isObject(file) || text(file.name).trim() == "") {
			return null;
		}
		var written = { name: text(file.name) };
		if (file.visible_name != null && text(file.visible_name) != "") {
			written.visible_name = text(file.visible_name);
		}
		return written;
	};

	// The files of a cell: the files of the row first, in their order, then the new ones; each name once.
	var mergeCell = function (existing, added) {
		var merged = [];
		var seen = {};
		asList(existing).concat(asList(added)).forEach(function (file) {
			var written = entry(file);
			if (written != null && seen["#" + written.name] !== true) {
				seen["#" + written.name] = true;
				merged.push(written);
			}
		});
		return merged;
	};

	// The write once the files of the row are added: data (an object) for each of the file columns named, with row the row
	// read (an object keyed by field names). A column without a new file is removed from the write. Returns
	// {data, appended: columns written with the files of the row, kept: columns left out}.
	var merge = function (data, row, names) {
		var written = {};
		Object.keys(data).forEach(function (name) {
			written[name] = data[name];
		});
		var summary = { data: written, appended: [], kept: [] };
		asList(names).forEach(function (name) {
			var added = mergeCell([], written[name]);
			if (added.length == 0) {
				delete written[name];
				summary.kept.push(name);
				return;
			}
			written[name] = mergeCell(isObject(row) ? row[name] : null, added);
			summary.appended.push(name);
		});
		return summary;
	};

	// The lock of a row on this server: store a map shared by the calls (get, putIfAbsent, replace(key, old, new),
	// remove(key, value)), "<owner>@<end of the lease>" for a row locked. A lease that ended is taken over: a write stopped
	// before it released its row (an exception of the engine) holds it LEASE_MS at most.
	var tryLock = function (store, key, owner, now, leaseMs) {
		var value = owner + "@" + (now + leaseMs);
		var held = store.get(key);
		if (held == null) {
			return store.putIfAbsent(key, value) == null;
		}
		var end = Number(text(held).substring(text(held).lastIndexOf("@") + 1));
		return !(end > now) && store.replace(key, held, value) == true;
	};
	// owner when the row is locked, null after waitMs (the write then goes on without the lock)
	var lock = function (store, key, owner, clock, sleep, waitMs, leaseMs) {
		var deadline = clock() + (waitMs == null ? WAIT_MS : waitMs);
		while (true) {
			var now = clock();
			if (tryLock(store, key, owner, now, leaseMs == null ? LEASE_MS : leaseMs)) {
				return owner;
			}
			if (now >= deadline) {
				return null;
			}
			sleep(STEP_MS);
		}
	};
	var release = function (store, key, owner) {
		if (store == null || key == null || owner == null) {
			return;
		}
		var held = store.get(key);
		if (held != null && text(held).indexOf(owner + "@") == 0) {
			store.remove(key, held);
		}
	};
	var lockKey = function (tableId, rowId) {
		return text(tableId) + "/" + text(rowId);
	};

	// The update of a row with the option: dataText the JSON of the row about to be written, fields its table's fields,
	// read(rowId) the row read again from Baserow (an object, else the answer of Baserow), store/owner/clock/sleep the lock.
	// Returns {data: the JSON to write, lockKey, owner (null when not locked), error ("" or why nothing must be written),
	// appended, kept}. A row id that is not a Baserow row id, or a row that cannot be read, is an error: writing the new
	// files alone would remove the files of the row.
	var prepare = function (options) {
		var result = { data: options.dataText, lockKey: null, owner: null, error: "", appended: [], kept: [] };
		var data;
		try {
			data = JSON.parse(text(options.dataText));
		} catch (e) {
			return result;
		}
		var names = columns(data, options.fields);
		if (names.length == 0) {
			return result;
		}
		var rowId = text(options.rowId).trim();
		if (!/^[0-9]{1,18}$/.test(rowId)) {
			result.error = "The files cannot be added to the row \"" + rowId + "\": it is not a row id, nothing was written";
			return result;
		}
		result.lockKey = lockKey(options.tableId, rowId);
		if (options.store != null) {
			result.owner = lock(options.store, result.lockKey, options.owner, options.clock, options.sleep, options.waitMs, options.leaseMs);
		}
		var row = options.read(rowId);
		if (!isObject(row) || row.id == null || text(row.id) != rowId) {
			release(options.store, result.lockKey, result.owner);
			result.owner = null;
			var detail = isObject(row) && (row.error != null || row.detail != null) ? " (" + [row.error, row.detail].filter(function (part) {
				return part != null && text(part) != "";
			}).map(text).join(": ") + ")" : "";
			result.error = "The files of the row " + rowId + " could not be read to add the new ones, nothing was written" + detail;
			return result;
		}
		var merged = merge(data, row, names);
		result.data = JSON.stringify(merged.data);
		result.appended = merged.appended;
		result.kept = merged.kept;
		return result;
	};

	return {
		LEASE_MS: LEASE_MS, WAIT_MS: WAIT_MS, wanted: wanted, columns: columns, mergeCell: mergeCell, merge: merge,
		tryLock: tryLock, lock: lock, release: release, lockKey: lockKey, prepare: prepare
	};
})();

if (typeof module !== "undefined" && module.exports) {
	module.exports = baserowFileAppend;
}
