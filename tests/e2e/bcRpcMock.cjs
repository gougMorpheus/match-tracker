// Lokaler Ersatz fuer PostgREST, NUR fuer Tests: POST /rest/v1/rpc/bc_* -> lokales Test-Postgres (Rolle anon).
// Alle anderen Pfade werden protokolliert; GET bekommt [] (Match-Tracker-Huelle), sonst 404. Nie gegen die Live-DB.
const http = require("node:http");
const { execFileSync } = require("node:child_process");

const createRpcMock = ({ pgArgs, db, port }) => {
  const log = [];
  const psql = (sql) => execFileSync("psql", [...pgArgs, "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-qAt", "-c", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const sigs = {};
  const rows = psql("select proname || '|' || coalesce(array_to_string(proargnames, ','), '') || '|' || coalesce(array_to_string(proargtypes::regtype[]::text[], ','), '') " +
    "from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'bc\\_%'").trim().split("\n");
  for (const line of rows) { const [name, a, t] = line.split("|"); sigs[name] = { names: a ? a.split(",") : [], types: t ? t.split(",") : [] }; }

  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info, prefer, accept-profile, content-profile, range", "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS" };
  const send = (res, status, body) => { res.writeHead(status, { ...cors, "Content-Type": "application/json" }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const m = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
      log.push({ method: req.method, path: url.pathname, search: url.search, rpc: m ? m[1] : null, apikey: Boolean(req.headers.apikey), body: m ? body : "" });
      if (!m) { send(res, req.method === "GET" ? 200 : 404, req.method === "GET" ? [] : { message: "nicht im Mock" }); return; }
      const sig = sigs[m[1]];
      if (!sig || req.method !== "POST") { send(res, 404, { code: "PGRST202", message: `Could not find the function public.${m[1]}` }); return; }
      let args = {};
      try { args = body ? JSON.parse(body) : {}; } catch { send(res, 400, { message: "bad json" }); return; }
      const parts = [];
      for (const [k] of Object.entries(args)) {
        const i = sig.names.indexOf(k);
        if (i < 0) { send(res, 404, { code: "PGRST202", message: `unknown arg ${k}` }); return; }
        const type = sig.types[i];
        parts.push(type === "jsonb" ? `${k} => (j->'${k}')` : `${k} => (j->>'${k}')::${type}`);
      }
      const json = JSON.stringify(args);
      if (json.includes("$BCJ$")) { send(res, 400, { message: "bad" }); return; }
      const sql = `set role anon; select coalesce((public.${m[1]}(${parts.join(", ")}))::text, 'null') from (select $BCJ$${json}$BCJ$::jsonb j) s;`;
      try {
        send(res, 200, psql(sql).trim() || "null");
      } catch (error) {
        const err = String(error.stderr || error.message || "");
        const message = (err.match(/ERROR:\s+(.*)/) || [])[1] || "Fehler";
        const details = (err.match(/DETAIL:\s+(.*)/) || [])[1] || null;
        send(res, 400, { code: "P0001", message, details, hint: null });
      }
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, log, close: () => new Promise((r) => server.close(r)) })));
};

module.exports = { createRpcMock };
