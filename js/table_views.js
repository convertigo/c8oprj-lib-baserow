// The views of a table a source reads its rows through (forms_config view_id): formssource_GetTableData and
// formssource_GetSelectData give it to the list of rows of Baserow, which applies the filters of the view on top of the
// filters of the request (both narrow the same rows), after checking that the view belongs to the table and that the
// account sees it, and orders the rows by the sorts of the view when the request does not sort. It never widens the
// rows, nor the fields: the list of rows ignores the hidden fields of a view, the fields stay the columns of the source.

// A view id: a positive integer (a number, or its digits as text), as text. null for anything else (an array or an
// object whose text would be digits too).
var tableViewIdText = function (value) {
	if (typeof value == "number") {
		return isFinite(value) && value > 0 && Math.floor(value) === value && value <= 9007199254740991 ? "" + value : null;
	}
	return typeof value == "string" && /^[1-9][0-9]{0,15}$/.test(value) ? value : null;
};

// The view_id of a source configuration (the parsed forms_config): its id as text, null without one (absent, null or
// ""). Anything else throws: a source whose view cannot be read must never read every row of its table instead.
var sourceViewId = function (config) {
	var value = config != null && typeof config == "object" ? config.view_id : null;
	if (value === undefined || value === null || value === "") {
		return null;
	}
	var id = tableViewIdText(value);
	if (id == null) {
		throw new Error("Invalid view_id in forms_config: the id of a view of the table is expected");
	}
	return id;
};

// The views the picker of a source offers, from the answer of Baserow (GET /api/database/views/table/<id>/, the views
// the account sees): the collaborative ones (a personal view belongs to one account, while a form reads with the
// account of whoever configured its source last) that filter rows (every type but form), as {id, name, type} only.
var sourceReadableViews = function (answer) {
	var list = answer == null ? [] : (Array.isArray(answer) ? answer : [answer]);
	var views = [];
	for (var i = 0; i < list.length; i++) {
		var view = list[i];
		if (view == null || typeof view != "object") {
			continue;
		}
		var id = tableViewIdText(view.id == null ? null : Number(view.id));
		var type = view.type == null ? "" : "" + view.type;
		var ownership = view.ownership_type == null || ("" + view.ownership_type) == "" ? "collaborative" : "" + view.ownership_type;
		if (id == null || type == "" || type == "form" || ownership != "collaborative") {
			continue;
		}
		views.push({ id: Number(id), name: view.name == null ? "" : "" + view.name, type: type });
	}
	return views;
};
