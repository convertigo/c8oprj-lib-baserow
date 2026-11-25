// The fields of a table are kept 60 s by _api_database_fields_table__table_id___GET(_raw), under a key made of the
// variables of the call only: the Authorization header is not one of them (#1423). Their callers give cache_scope:
// the digest of the token the fields are read with (never the token itself, the key is logged) and a generation that
// every change of a field through this library increases. A user never gets the fields read with the token of another
// one, even when both tokens hold the same user_id, and a column just created is read again.
// Included by js/common.js and by the sequences calling these transactions: no const, it can be included twice.
var getFieldsCacheScope = function (authorization) {
	var token = authorization == null ? "" : ("" + authorization).trim();
	var digest = java.security.MessageDigest.getInstance("SHA-256").digest(new java.lang.String(token).getBytes("UTF-8"));
	return getFieldsCacheGeneration().get() + ":" + java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
};

var getFieldsCacheGeneration = function () {
	var generation = context.project.get("fields_cache_generation");
	if (generation == null) {
		// starts at the current time: the answers cached before a reload of the project are never reused
		context.project.set("fields_cache_generation", new java.util.concurrent.atomic.AtomicLong(java.lang.System.currentTimeMillis()));
		generation = context.project.get("fields_cache_generation");
	}
	return generation;
};

// A field of a table is created, changed or deleted: the cached lists of fields are read again
var bumpFieldsCacheGeneration = function () {
	getFieldsCacheGeneration().incrementAndGet();
};
