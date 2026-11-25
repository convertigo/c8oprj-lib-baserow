// Compose the published, server-derived row boundary outside every client OR.
// The caller has already verified the source and the request parameters through
// C8Oforms.BaserowPublishedSourceAuthorize.
var bindPublishedReadScope = function (scopeText, clientText, searchField, searchText, required) {
	if (scopeText == null || "" + scopeText === "") {
		if (required) { throw new Error("missing mandatory published scope"); }
		return clientText;
	}
	var scope = JSON.parse("" + scopeText);
	// C8Oforms marks a published source without a server-side row boundary (no literal filter) as unbounded:
	// the respondent reads what the form reads, refined by the validated client filter.
	var unbounded = scope && typeof scope === "object" && !Array.isArray(scope) &&
		scope.unbounded === true && Object.keys(scope).length === 1;
	var normalize = function (node, depth) {
		if (!node || typeof node !== "object" || Array.isArray(node) || depth > 6) {
			throw new Error("invalid published filter tree");
		}
		if (Array.isArray(node.filters)) {
			if (node.mode !== "AND" && node.mode !== "OR") {
				throw new Error("invalid published filter mode");
			}
			var children = node.filters.slice(0);
			if (node.groups != null) {
				if (!Array.isArray(node.groups)) { throw new Error("invalid published filter groups"); }
				children = children.concat(node.groups);
			}
			if (!children.length || children.length > 80) { throw new Error("empty published filter group"); }
			return { mode: node.mode, filters: children.map(function (child) { return normalize(child, depth + 1); }) };
		}
		if (typeof node.field !== "string" || typeof node.op !== "string") {
			throw new Error("invalid published filter leaf");
		}
		return { field: node.field, op: node.op, value: node.value };
	};
	scope = unbounded ? null : normalize(scope, 0);
	var client = null;
	if (clientText != null && "" + clientText !== "") {
		// Convertigo request variables may be java.lang.String in Rhino. Parse
		// those as JSON instead of silently dropping the respondent's filter.
		client = clientText && typeof clientText === "object" && Array.isArray(clientText.filters)
			? clientText : JSON.parse("" + clientText);
		if (client && Array.isArray(client.filters) && (client.filters.length ||
			(Array.isArray(client.groups) && client.groups.length))) {
			client = normalize(client, 0);
		} else {
			client = null;
		}
	}
	var filters = [];
	if (scope) { filters.push(scope); }
	if (client) { filters.push(client); }
	if (searchText != null && "" + searchText !== "") {
		var searchValue = "" + searchText;
		var searchColumn = searchField == null ? "" : "" + searchField;
		if (searchValue.length > 128 || !searchColumn || searchColumn.length > 255) {
			throw new Error("invalid published search");
		}
		filters.push({ field: searchColumn, op: "contains", value: searchValue });
	}
	if (!filters.length) {
		return clientText;
	}
	return JSON.stringify({ mode: "AND", filters: filters });
};
