const assert = require("node:assert/strict");
const http = require("node:http");
const { loadBrowserModule } = require("./helpers/loadBrowserModule.cjs");

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ACCESS_TOKEN = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
  exp: 1999999999,
  sub: USER_ID,
  email: "a@example.com",
  role: "authenticated"
})}.sig`;

const memory = () => {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); }
  };
};

const runDashboardAuthClientTests = async () => {
  const requests = [];
  let role = "ansehen";
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const url = new URL(req.url, "http://127.0.0.1");
      const body = Buffer.concat(chunks).toString();
      requests.push({ method: req.method, path: url.pathname, search: url.search, headers: req.headers, body });
      const send = (status, payload) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.method === "POST" && url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
        const parsed = JSON.parse(body);
        if (parsed.password !== "correct") {
          send(400, { code: "invalid_credentials", error_code: "invalid_credentials", msg: "Invalid login credentials" });
          return;
        }
        send(200, {
          access_token: ACCESS_TOKEN,
          token_type: "bearer",
          expires_in: 3600,
          refresh_token: "refresh-test",
          user: {
            id: USER_ID,
            aud: "authenticated",
            role: "authenticated",
            email: parsed.email,
            app_metadata: {},
            user_metadata: {},
            created_at: "2026-01-01T00:00:00Z"
          }
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/rest/v1/rpc/my_app_role") {
        send(200, role);
        return;
      }
      if (req.method === "GET" || req.method === "HEAD") {
        send(200, {});
        return;
      }
      send(500, { message: `unerwartet ${req.method} ${url.pathname}` });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const clientModule = loadBrowserModule("src/lib/dashboardClient.ts");
  const access = require("../.test-dist/utils/dashboardAccess.js");
  try {
    const client = clientModule.createDashboardClient(`http://127.0.0.1:${port}`, "sb_publishable_test", memory());
    const bad = await client.auth.signInWithPassword({ email: "a@example.com", password: "wrong" });
    assert.ok(bad.error, "falsches Passwort");
    assert.equal(bad.error.code, "invalid_credentials");

    const good = await client.auth.signInWithPassword({ email: "a@example.com", password: "correct" });
    assert.equal(good.error, null);
    assert.equal(good.data.user.id, USER_ID);

    const storage = memory();
    const load = () => access.loadDashboardRoleOnce(USER_ID, storage, () => clientModule.fetchMyAppRole(client));
    assert.equal(await load(), "ansehen");
    role = "bearbeiten";
    assert.equal(await load(), "ansehen", "zweites Lesen bleibt beim gemerkten Wert");
    const roleCalls = requests.filter((entry) => entry.path === "/rest/v1/rpc/my_app_role");
    assert.equal(roleCalls.length, 1);
    const call = roleCalls[0];
    assert.equal(call.method, "POST");
    assert.equal(call.headers["content-profile"], "dashboard");
    assert.equal(call.headers.apikey, "sb_publishable_test");
    assert.equal(call.headers.authorization, `Bearer ${ACCESS_TOKEN}`);
    assert.deepEqual(JSON.parse(call.body), { p_app_slug: "match-tracker" });
    assert.ok(requests.every((entry) => entry.path === "/auth/v1/token" || entry.path === "/rest/v1/rpc/my_app_role" || entry.method === "GET" || entry.method === "HEAD"));
    assert.ok(!requests.some((entry) => /app_access|admin_/.test(entry.path)));

    const empty = memory();
    role = null;
    assert.equal(await access.loadDashboardRoleOnce("other-user", empty, () => clientModule.fetchMyAppRole(client)), null);
    assert.equal(access.accessScreenForRole(true, null), "no-access");
    assert.equal(access.accessScreenForRole(true, "bearbeiten"), "edit");
  } finally {
    access.clearDashboardRoleMemory();
    access.setSessionWriteGate("legacy");
    await new Promise((resolve) => server.close(resolve));
  }
};

module.exports = { runDashboardAuthClientTests };
