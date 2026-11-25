// (lib_baserow.token_cache) The access token of a Baserow account, kept for the server while it is valid: the HTTP
// sessions that log the same account in one after the other share it. Each submit action of a form runs in an HTTP
// session of its own (C8Oforms APIV2_Execute_Sequences), where a login of Baserow (about 150 ms, the password hashed by
// Baserow) was made for every row written.
// Only the access token of a login is kept, never a refresh token nor a refreshed token, under an HMAC of the
// credentials with a secret of this server: a caller finds it only by giving the same email and password, and a changed
// password logs in again. It is given while at least half of its life is left, and forgotten when Baserow refuses it.
// Included by TokenGetOrRefresh, TokenGetOrRefreshNative and js/common.js after js/jwt.js: no const, it can be included
// twice.
var getTokenCacheStore = function () {
	var store = context.project.get("lib_baserow.token_cache");
	if (store == null || store.size() > 1000) {
		store = new java.util.concurrent.ConcurrentHashMap();
		var secret = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 32);
		new java.security.SecureRandom().nextBytes(secret);
		store.put("secret", java.util.Base64.getEncoder().encodeToString(secret));
		context.project.set("lib_baserow.token_cache", store);
	}
	return store;
};

// the key of an account: never the credentials themselves (a base64url HMAC never equals "secret")
var getTokenCacheKey = function (store, email, password) {
	var mac = javax.crypto.Mac.getInstance("HmacSHA256");
	mac.init(new javax.crypto.spec.SecretKeySpec(java.util.Base64.getDecoder().decode("" + store.get("secret")), "HmacSHA256"));
	var digest = mac.doFinal(new java.lang.String("owner:" + email + ":" + password).getBytes("UTF-8"));
	return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
};

// At least half of the life of the token is left (js/jwt.js): the call that takes it, and the calls it makes, can run
// minutes before the token has to be renewed. A token without iat and exp is never given.
var hasHalfLifeLeft = function (token) {
	var timing = getJwtTiming(token);
	if (timing == null || timing.iatMs == null || timing.expMs <= timing.iatMs) {
		return false;
	}
	return timing.expMs - new Date().getTime() >= (timing.expMs - timing.iatMs) / 2;
};

// {token, timestamp} of the account, null when none is kept or when less than half of its life is left
var getCachedToken = function (email, password) {
	var store = getTokenCacheStore();
	var key = getTokenCacheKey(store, email, password);
	var kept = store.get(key);
	if (kept == null) {
		return null;
	}
	var token = JSON.parse("" + kept);
	if (!hasHalfLifeLeft(token.token)) {
		store.remove(key, kept);
		return null;
	}
	return token;
};

var putCachedToken = function (email, password, token, timestamp) {
	var store = getTokenCacheStore();
	store.put(getTokenCacheKey(store, email, password), JSON.stringify({ token: "" + token, timestamp: timestamp }));
};

// The answer of Baserow to an access token it refuses (401): revoked, or signed with another secret of Baserow
var isRefusedToken = function (answer) {
	return answer != null && typeof answer == "object" && answer.error == "ERROR_INVALID_ACCESS_TOKEN";
};

// The kept tokens that match: the next login of their account asks Baserow again
var forgetCachedTokens = function (matches) {
	var store = context.project.get("lib_baserow.token_cache");
	if (store == null) {
		return;
	}
	var entries = store.entrySet().iterator();
	while (entries.hasNext()) {
		var entry = entries.next();
		if (("" + entry.getKey()) != "secret" && matches("" + JSON.parse("" + entry.getValue()).token)) {
			store.remove(entry.getKey(), entry.getValue());
		}
	}
};

// a token refused by Baserow, given as the Authorization of the call ("JWT <token>")
var forgetCachedToken = function (authorization) {
	var refused = ("" + authorization).replace(/^\s*JWT\s+/i, "");
	forgetCachedTokens(function (token) { return token == refused; });
};

// a token refused by Baserow, known by the cache_scope of the call (js/fields_cache.js: the digest of its Authorization)
var forgetCachedTokenOfScope = function (cacheScope) {
	forgetCachedTokens(function (token) { return getFieldsCacheScope("JWT " + token) == "" + cacheScope; });
};
