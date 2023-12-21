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
	function resolveTableId() {
		if (typeof table_id == "undefined") {
			log.debug("table_id is undefined");
			return;
		}

		if (Number.isInteger(1 * table_id)) {
			log.debug("table_id is already an Integer: " + table_id);
			return;
		}

		let [application, database, table] = table_id.split("~>");
		if (typeof application && database && table == "undefined") {
			log.debug("table_id is not complet: " + table_id);
			return;
		}
		
		const table_id_key = new String(table_id);
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
		
		table_id = table_id_cache.get(table_id_key);
		
		if (table_id == null) {
			log.trace("no table_id found for: " + table_id_key);
			const __header_Authorization = "JWT " + getAuthToken();
			let doc = call(".._api_applications__GET", {__header_Authorization});
			let node = xpath.selectSingleNode(doc, '/document/array/object[name="' + database + '" and workspace/name="'+ application + '"]/id/text()');
			if (!node) {
				log.debug("database id not found");
				return;
			}
			const database_id = node.getNodeValue();
			doc = call(".._api_database_tables_database__database_id___GET", {__header_Authorization, database_id});
			node = xpath.selectSingleNode(doc, '/document/array/object[name="' + table + '"]/id/text()');
			if (!node) {
				log.debug("table '" + table + "' not found in database id '" + database_id + "'");
				return;
			}
			table_id = node.getNodeValue();
			table_id_cache.put(table_id_key, table_id);
		}
		
		context.transaction.variables.put("table_id", table_id);
		context.connector.prepareForTransaction(context);
	}
	
	function getAuthToken() {
		const now = new Date().getTime();
		let token = context.httpSession.getAttribute("token");
		if (token) {
			const ts = context.httpSession.getAttribute("token_timestamp");
			if (now - ts * 1 > 58000) {
				token = null;
			}
		}
		if (!token) {
			context.httpSession.setAttribute("token_timestamp", now);
			const username = Engine.theApp.databaseObjectsManager.symbolsGetValue("lib_baserow.adminuser");
			const password = Engine.theApp.databaseObjectsManager.symbolsGetValue("lib_baserow.password.secret");
			const doc = call(".._api_Auth", {"__body": JSON.stringify({
				username, password
			})});
			const ntoken = xpath.selectSingleNode(doc, '/document/object/token/text()');
			if (ntoken) {
				context.httpSession.setAttribute("token_timestamp", now);
				context.httpSession.setAttribute("token", token = ntoken.getNodeValue());
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
		
		parameters.put("__context", context.contextID + "_internal_" + System.currentTimeMillis());
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