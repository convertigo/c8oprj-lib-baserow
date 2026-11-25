include("js/jwt.js");
include("js/fields_cache.js");
include("js/token_cache.js");

const api = JavaImporter(
	java.util.Collections,
	java.util.HashMap,
	java.lang.String,
	java.lang.System,
	java.lang.reflect.Array,
	org.apache.log4j.MDC,
	com.twinsoft.convertigo.engine.Engine,
	com.twinsoft.convertigo.engine.requesters.InternalHttpServletRequest,
	com.twinsoft.convertigo.engine.requesters.InternalRequester
)
const xpath = context.getXpathApi();

with (api) {
	// Per-user scope for the shared (project-scoped) table_id cache. The cache maps
	// "application~>database~>table" name tuples to Baserow ids, but those names are
	// not unique across users (each Baserow account has its own workspaces with the
	// same names). Without a per-user prefix, one user's resolved id leaks to another
	// user, who then queries a table id it cannot access (empty field list). We key on
	// the authenticated Baserow user (the JWT whose workspaces are actually queried).
	function getUserScope(authorization) {
		try {
			var token = authorization == null ? "" : ("" + authorization).replace(/^\s*(JWT|Bearer)\s*/i, "");
			if (!token) {
				return "anon";
			}
			var payload = ("" + token).split(".")[1];
			if (!payload) {
				return "tok:" + token;
			}
			while (payload.length % 4) {
				payload += "=";
			}
			var json = "" + new java.lang.String(java.util.Base64.getUrlDecoder().decode(payload), "UTF-8");
			var claims = JSON.parse(json);
			if (claims.user_id != null) {
				return "u:" + claims.user_id;
			}
			if (claims.sub != null) {
				return "s:" + claims.sub;
			}
			return "tok:" + token;
		} catch (e) {
			log.warn("getUserScope failed, falling back to anon cache scope: " + e);
			return "anon";
		}
	}


	// The JWT Authorization header this transaction was called with (__header_Authorization of the
	// calling step, "JWT <token>"), null otherwise (no header, or a database token of the *ApiKey
	// sequences, which cannot list the workspaces). The sources of a page run in parallel in the same
	// HTTP session with the tokens of different Baserow accounts: the table must be looked up with the
	// token of this call, not with the token that happens to be in the session.
	function getTransactionAuthorization() {
		var authorization = getTransactionAuthorizationHeader();
		return /^JWT\s+\S/i.test(authorization) ? authorization : null;
	}

	// The Authorization header this transaction was called with, whatever its scheme (JWT, Token), "" when none
	function getTransactionAuthorizationHeader() {
		if (context.inputDocument == null && context.nativeParameters != null) {
			// a native call: the header given as a parameter of the call
			var header = context.nativeParameters.get("__header_Authorization");
			if (header != null && header.getClass && header.getClass().isArray()) {
				header = header.length > 0 ? header[0] : null;
			}
			return header == null ? "" : ("" + header).trim();
		}
		var node = xpath.selectSingleNode(context.inputDocument, '//transaction-headers/header[@name="Authorization"]/@value');
		return node ? ("" + node.getNodeValue()).trim() : "";
	}

	// Only an answer read with the token that cache_scope names is stored in the cache, so a cache_scope can only ever
	// find the fields read with its own token. A call without cache_scope (or with a stale generation) is not cached.
	function checkFieldsCacheScope() {
		const given = typeof cache_scope == "undefined" || cache_scope == null ? "" : "" + cache_scope;
		if (given == "" || given != getFieldsCacheScope(getTransactionAuthorizationHeader())) {
			log.debug("fields of table " + table_id + ": cache_scope does not match the token of the call, the answer is not cached");
			context.isCacheEnabled = false;
		}
	}

	// A table that cannot be found is never sent to Baserow as its path (URL_NOT_FOUND): id 0, that no
	// Baserow table has, makes Baserow answer ERROR_TABLE_DOES_NOT_EXIST through the usual error path
	// of every sequence.
	function setMissingTableId(reason) {
		log.warn(reason);
		context.transaction.variables.put("table_id", "0");
		context.connector.prepareForTransaction(context);
	}

	// " (ERROR_CODE: detail)" of a Baserow error answer read as JSON, "" otherwise
	function getBaserowJsonErrorText(answer) {
		if (answer == null || typeof answer != "object" || isJsonArray(answer)) {
			return "";
		}
		var texts = [];
		if (textOf(answer.error)) {
			texts.push(textOf(answer.error));
		}
		if (textOf(answer.detail)) {
			texts.push(textOf(answer.detail));
		}
		return texts.length ? " (" + texts.join(": ") + ")" : "";
	}


	// how long a table id resolved from its path is used without checking that the table still exists
	var TABLE_ID_CHECK_MS = 60000;

	// a Baserow answer telling the table does not exist (deleted, or another table renamed into its path)
	function isMissingTable(answer) {
		return answer != null && typeof answer == "object" && (answer.error == "ERROR_TABLE_DOES_NOT_EXIST"
			|| (answer.id != null && answer.name != null));
	}

	function resolveTableId() {
		if (typeof table_id == "undefined") {
			log.debug("table_id is undefined");
			return;
		}

		if (Number.isInteger(1 * table_id)) {
			log.debug("table_id is already an Integer: " + table_id);
			return;
		}

		let [application, database, table] = ("" + table_id).split("~>");
		if (!application || !database || !table) {
			log.debug("table_id is not complet: " + table_id);
			return;
		}
		
		const table_path = "" + table_id;
		let __header_Authorization = getTransactionAuthorization();
		if (__header_Authorization == null) {
			// no JWT given to the transaction: token of the HTTP session
			__header_Authorization = "JWT " + getAuthToken();
		}
		const table_id_key = getUserScope(__header_Authorization) + "~>" + table_path;
		const project_hash = System.identityHashCode(context.project.original ? context.project.original : context.project);
		log.trace("project_hash: " + project_hash);
		
		let table_id_cache = context.project.get('table_id_cache');
		
		if (table_id_cache != null) {
			if (table_id_cache.get('project_hash') != project_hash) {
				table_id_cache = null;
				log.trace("project changed, renew cache");
			}
		}
		
		if (table_id_cache == null) {
			context.project.set('table_id_cache', table_id_cache = Collections.synchronizedMap(new HashMap()));
			table_id_cache.put('project_hash', project_hash);
		}
		
		// "<id>@<time of its last check>": a cached id is checked again at most every TABLE_ID_CHECK_MS. A table deleted by
		// hand in Baserow and created again with the same names (a new id) is found again, once, instead of being queried
		// with the id of the deleted table until the project is reloaded.
		const now = new Date().getTime();
		let cached = table_id_cache.get(table_id_key);
		table_id = null;
		if (cached != null) {
			const at = ("" + cached).indexOf("@");
			table_id = at == -1 ? "" + cached : ("" + cached).substring(0, at);
			const checkedAt = at == -1 ? 0 : 1 * ("" + cached).substring(at + 1);
			if (now - checkedAt > TABLE_ID_CHECK_MS) {
				const checked = jsonAnswer(callNative(".._api_database_tables__table_id___GET_raw", {__header_Authorization, table_id}));
				if (checked != null && typeof checked == "object" && checked.id != null && ("" + checked.id) == table_id && ("" + checked.name) == table) {
					table_id_cache.put(table_id_key, table_id + "@" + now);
				}
				else if (isMissingTable(checked)) {
					log.info("table " + table_path + ": the cached id " + table_id + " no longer exists, resolved again");
					table_id_cache.remove(table_id_key);
					table_id = null;
				}
				// another answer (network, rights): the cached id is kept, the call tells its error
			}
		}
		
		if (table_id == null) {
			log.trace("no table_id found for: " + table_id_key);
			// the applications and the tables as JSON text, read without XML
			let applications = jsonAnswer(callNative(".._api_applications__GET_raw", {__header_Authorization}));
			let found = findFirst(applications, function (application_) {
				return application_.name != null && ("" + application_.name) == database
					&& application_.workspace != null && application_.workspace.name != null && ("" + application_.workspace.name) == application;
			});
			if (found == null || found.id == null) {
				setMissingTableId("Baserow table \"" + table_path + "\" not found: the Baserow account " + getUserScope(__header_Authorization) + " has no database \"" + database + "\" in a workspace \"" + application + "\"" + getBaserowJsonErrorText(applications));
				return;
			}
			const database_id = "" + found.id;
			let tables = jsonAnswer(callNative(".._api_database_tables_database__database_id___GET_raw", {__header_Authorization, database_id}));
			found = findFirst(tables, function (table_) {
				return table_.name != null && ("" + table_.name) == table;
			});
			if (found == null || found.id == null) {
				setMissingTableId("Baserow table \"" + table_path + "\" not found: no table \"" + table + "\" in the database \"" + database + "\" (id " + database_id + ") for the Baserow account " + getUserScope(__header_Authorization) + getBaserowJsonErrorText(tables));
				return;
			}
			table_id = "" + found.id;
			table_id_cache.put(table_id_key, table_id + "@" + now);
		}
		
		context.transaction.variables.put("table_id", table_id);
		context.connector.prepareForTransaction(context);
	}
	
	function getAuthToken() {
		const now = new Date().getTime();
		let token = context.httpSession.getAttribute("token");
		if (token) {
			const ts = context.httpSession.getAttribute("token_timestamp");
			if (!isTokenStillValid(token, ts)) {
				token = null;
			}
		}
		if (!token) {
			context.httpSession.setAttribute("token_timestamp", now);
			const username = Engine.theApp.databaseObjectsManager.symbolsGetValue("lib_baserow.adminuser");
			const password = Engine.theApp.databaseObjectsManager.symbolsGetValue("lib_baserow.password.secret");
			// the answer of token-auth as JSON text, read without XML; it holds the tokens of the account, the engine would
			// log it in this thread
			let authAnswer;
			MDC.put("nolog", true);
			try {
				authAnswer = jsonAnswer(callNative(".._api_Auth_raw", {"__body": JSON.stringify({
					username, password
				})}));
			} finally {
				MDC.remove("nolog");
			}
			if (authAnswer == null || typeof authAnswer != "object" || isJsonArray(authAnswer)) {
				authAnswer = {};
			}
			const twoFactor = textOf(authAnswer.two_factor_auth);
			if (twoFactor) {
				// the token of a 2FA answer is only a temporary verification token, not a JWT
				throw new Error("Baserow authentication failed: the Baserow account has two-factor authentication enabled (" + twoFactor + "), which is not supported");
			}
			let ntoken = textOf(authAnswer.access_token);
			if (!ntoken) {
				ntoken = textOf(authAnswer.token);
			}
			if (ntoken) {
				context.httpSession.setAttribute("token_timestamp", now);
				context.httpSession.setAttribute("token", token = ntoken);
			}
		}
		return token;
	}

	function toJavaStringArray() {
		const ret = Array.newInstance(String, arguments.length);
		for (let i in arguments) {
			ret[i] = arguments[i];
		}
		return ret;
	}

	// the text of a value as the XPath text() of its XML gave it: nothing for null or an empty text
	function textOf(value) {
		return value == null || typeof value == "object" ? null : ("" + value) || null;
	}

	// a JSON array (Array is java.lang.reflect.Array in this file)
	function isJsonArray(value) {
		return Object.prototype.toString.call(value) == "[object Array]";
	}

	// the first item of a JSON array that matches, in the order of the answer
	function findFirst(items, matches) {
		if (!isJsonArray(items)) {
			return null;
		}
		for (let i = 0; i < items.length; i++) {
			if (items[i] != null && typeof items[i] == "object" && matches(items[i])) {
				return items[i];
			}
		}
		return null;
	}

	// the JSON of a raw transaction: its text for a native call, or the text node of its document
	// for an engine that answers in XML; null when it is not JSON
	function jsonAnswer(response) {
		try {
			if (response instanceof org.w3c.dom.Document) {
				response = response.getDocumentElement().getTextContent();
			}
			return response == null ? null : JSON.parse("" + response);
		} catch (e) {
			log.debug("not a JSON answer: " + e);
			return null;
		}
	}

	// The fields of a table (a JSON array), read without XML: the raw transaction answers its text to a native call and
	// keeps it 60 s for the token of the call (js/fields_cache.js). null for another answer (a Baserow error), as the
	// array of an answer of FieldsList holding none.
	function readTableFields(tableId, authorization) {
		const fields = jsonAnswer(callNative("lib_BaseRow.Baserow_API_spec._api_database_fields_table__table_id___GET_raw", {
			"__header_Authorization": authorization, "table_id": "" + tableId, "cache_scope": getFieldsCacheScope(authorization)
		}));
		if (isRefusedToken(fields)) {
			// a token refused by Baserow (401) is no longer handed out to the other sessions (js/token_cache.js)
			forgetCachedToken(authorization);
		}
		return isJsonArray(fields) ? fields : null;
	}

	// a call of a raw transaction that answers its text without XML (an engine with native calls)
	function callNative(requestable, vars) {
		const nativeVars = {"__nativeCall": "true"};
		if (vars) {
			for (let k in vars) {
				nativeVars[k] = vars[k];
			}
		}
		return call(requestable, nativeVars);
	}

	function call(requestable, vars) {
		const parameters = new HashMap();
		let [project, connector, transaction] = requestable.split(".");
		
		if (!project) {
			project = context.projectName;
		}
		parameters.put("__project", toJavaStringArray(project));
		
		if (!transaction) {
			parameters.put("__sequence", toJavaStringArray(connector));
		} else {
			if (!connector) {
				connector = context.connectorName;
			}
			parameters.put("__connector", toJavaStringArray(connector));
			parameters.put("__transaction", toJavaStringArray(transaction));
		}
		
		parameters.put("__context", context.contextID + "_internal_" + java.util.UUID.randomUUID());
		if (vars) {
			for (let k in vars) {
				parameters.put(k, vars[k]);
			}
		}
		
		const request = new InternalHttpServletRequest(context.httpServletRequest);		
		const requester = new InternalRequester(parameters, request);
		try {
			const res = requester.processRequest();
			MDC.put("ContextualParameters", context.logParameters);
			return res;
		} finally {
			Engine.theApp.contextManager.remove(requester.getContext());
		}
	}
}
