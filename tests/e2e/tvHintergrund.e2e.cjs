// TV-Tab im Hintergrund (Pepper 22.10.), NUR lokal: gebaute App gegen einen lokalen REST-Mock (Port 4798, ZZ-Spiel aus dem
// Backup, nur lesend). Alles ausser 127.0.0.1 wird blockiert -> kein Zugriff auf die Live-DB. Realtime gibt es im Mock nicht.
// Prueft: ein im Hintergrund geoeffneter TV-Tab laedt sein Spiel trotzdem (Anlass Start, kein Polling) und zeigt den Sync;
// beim Sichtbarwerden laedt die Live-Ansicht sofort. Ein normaler Tab laedt im Hintergrund weiterhin nichts (Egress).
const assert = require("node:assert/strict");
const path = require("node:path"); const http = require("node:http"); const { execFileSync } = require("node:child_process");
const { chromium } = require(process.env.PW_MODULE || "playwright");
const { serveDir } = require("./staticServer.cjs");
const fixture = require("./fixtures/zz-tv-hintergrund.json");

const ROOT = path.join(__dirname, "..", ".."); const OUT = ".test-e2e-dist-tvh";
const PORT = 4802; const APP = `http://127.0.0.1:${PORT}`; const MOCK = 4798; const ID = fixture.game.id;

const startMock = () => new Promise((resolve) => {
  const hits = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${MOCK}`);
    const send = (status, body) => { res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*",
      "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,OPTIONS", "access-control-expose-headers": "content-range" });
      res.end(body === undefined ? "" : JSON.stringify(body)); };
    if (req.method === "OPTIONS") return send(204);
    hits.push({ at: Date.now(), path: url.pathname, select: url.searchParams.get("select") || "" });
    if (url.pathname === "/rest/v1/games") {
      const select = url.searchParams.get("select") || "*";
      if (/version/.test(select) && select !== "*") return send(200, [{ id: ID, version: fixture.game.version, flow_version: fixture.game.flow_version }]);
      return send(200, [fixture.game]);
    }
    if (url.pathname === "/rest/v1/events") return send(200, fixture.events);
    return send(404, { message: "nicht im Mock" });
  });
  server.listen(MOCK, "127.0.0.1", () => resolve({ server, hits }));
});

const run = async () => {
  execFileSync("node", ["./node_modules/vite/bin/vite.js", "build", "--outDir", OUT, "--emptyOutDir", "--logLevel", "error"],
    { cwd: ROOT, env: { ...process.env, VITE_SUPABASE_URL: `http://127.0.0.1:${MOCK}`, VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_lokaler_test" }, stdio: "inherit" });
  const web = await serveDir(path.join(ROOT, OUT), PORT, "127.0.0.1"); const { server, hits } = await startMock();
  const browser = await chromium.launch(); const results = []; const errors = [];
  const step = async (name, fn) => { await fn(); results.push(name); console.log(`  ok  ${name}`); };
  const hiddenPage = async () => {
    const ctx = await browser.newContext({ serviceWorkers: "block" });
    await ctx.route((u) => !/^http:\/\/127\.0\.0\.1:(4802|4798)\//.test(u.toString()), (r) => r.abort());
    const page = await ctx.newPage(); page.setDefaultTimeout(8000); page.on("pageerror", (e) => errors.push(String(e)));
    await page.addInitScript(() => { window.__hidden = true; Object.defineProperty(document, "hidden", { get: () => window.__hidden });
      Object.defineProperty(document, "visibilityState", { get: () => (window.__hidden ? "hidden" : "visible") }); });
    return { ctx, page };
  };
  const header = (page) => page.locator(".header-content").first().innerText().then((t) => t.replace(/\s+/g, " "));
  const gameHits = (since) => hits.filter((h) => h.at >= since && h.path === "/rest/v1/games").length;
  try {
    const { ctx, page } = await hiddenPage();
    await step("TV im Hintergrund geoeffnet: laedt das Spiel trotzdem, zeigt Server-Stand und Sync (nicht \"Noch kein Sync\")", async () => {
      const t = Date.now(); await page.goto(`${APP}/#/game/${ID}?tv=1`);
      await page.locator(".tv-phase__title").waitFor({ timeout: 6000 });
      assert.equal(await page.locator(".tv-phase__title").innerText(), "Runde 1 · Zug 1");
      assert.match(await page.locator(".tv-player--active").innerText(), /ZZ-B/);
      assert.match(await header(page), /Sync \d/, "Sync-Zeitpunkt statt \"Noch kein Sync\"");
      assert.ok(gameHits(t) >= 1, "Spiel geladen");
    });
    await step("Hintergrund: kein Polling (in 12 s keine weitere Abfrage ohne Anlass)", async () => {
      await page.waitForTimeout(2000); // Startphase (Start-Laden + Moduswechsel) abwarten
      const t = Date.now(); await page.waitForTimeout(12000); assert.equal(gameHits(t), 0, "Takt bleibt im Hintergrund aus (Egress)");
    });
    await step("Sichtbar werden: Live-Ansicht laedt sofort (ohne 1,2 s Wartezeit)", async () => {
      const t = Date.now(); await page.evaluate(() => { window.__hidden = false; document.dispatchEvent(new Event("visibilitychange")); });
      await page.waitForTimeout(700); assert.ok(gameHits(t) >= 1, "innerhalb 0,7 s geladen");
    });
    await ctx.close();
    const list = await hiddenPage();
    await step("Normaler Tab (Spieleliste) im Hintergrund laedt weiterhin nichts", async () => {
      const t = Date.now(); await list.page.goto(`${APP}/#/games`); await list.page.waitForTimeout(3000);
      assert.equal(hits.filter((h) => h.at >= t && h.path.startsWith("/rest/v1/games")).length, 0);
    });
    await list.ctx.close();
    assert.deepEqual(errors, [], "keine Seitenfehler");
    console.log(`TV-Hintergrund E2E: ${results.length} Schritte OK`);
  } finally { await browser.close(); await web.close(); server.close(); }
};
run().catch((e) => { console.error(e); process.exit(1); });
