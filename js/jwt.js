var TOKEN_FALLBACK_REFRESH_MS = 58000;

var getJwtTiming = function(token) {
	try {
		if (!token) {
			return null;
		}
		var payload = ("" + token).split(".")[1];
		if (!payload) {
			return null;
		}
		while (payload.length % 4) {
			payload += "=";
		}
		var json = "" + new java.lang.String(java.util.Base64.getUrlDecoder().decode(payload), "UTF-8");
		var claims = JSON.parse(json);
		var expMs = claims.exp == null ? NaN : claims.exp * 1000;
		if (isNaN(expMs)) {
			return null;
		}
		var iatMs = claims.iat == null ? NaN : claims.iat * 1000;
		return {
			expMs: expMs,
			iatMs: isNaN(iatMs) ? null : iatMs
		};
	} catch (e) {
		if (typeof log != "undefined") {
			log.warn("Unable to read JWT expiration, using fallback refresh delay: " + e);
		}
		return null;
	}
};

var getTokenRefreshAt = function(token, issuedAt) {
	var now = new Date().getTime();
	var timing = getJwtTiming(token);
	var startMs = issuedAt * 1;
	if (timing && timing.iatMs) {
		startMs = timing.iatMs;
	}
	if (isNaN(startMs) || startMs <= 0) {
		startMs = now;
	}
	if (!timing) {
		return startMs + TOKEN_FALLBACK_REFRESH_MS;
	}
	var lifetimeMs = timing.expMs - startMs;
	if (isNaN(lifetimeMs) || lifetimeMs <= 0) {
		lifetimeMs = timing.expMs - now;
	}
	var safetyMs = Math.min(60000, Math.max(5000, Math.floor(lifetimeMs * 0.1)));
	return timing.expMs - safetyMs;
};

var isTokenStillValid = function(token, issuedAt, traceRefreshDelay) {
	var now = new Date().getTime();
	var refreshAt = getTokenRefreshAt(token, issuedAt);
	if (traceRefreshDelay && typeof log != "undefined") {
		log.info("Token refresh in (ms): " + (refreshAt - now));
	}
	return now <= refreshAt;
};
