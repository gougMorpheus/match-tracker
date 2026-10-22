// #46 (Pepper 22.10. 21:27, Variante 2): Aenderung in einem verdeckten Editor-Tab blieb als "Offline" liegen; ein Tab konnte
// mit seiner ganzen Queue ungesendete Eintraege eines anderen Tabs aus localStorage entfernen. NUR lokal: gebaute App gegen
// einen lokalen REST-Mock MIT Schreibweg (mt_put_event/mt_save_game/mt_revoke_event, Zustand im Speicher, ZZ-Spiel aus dem
// Backup). Alles ausser 127.0.0.1 wird blockiert -> kein Zugriff auf die Live-DB. Realtime gibt es im Mock nicht.
const assert = require("node:assert/strict");
const path = require("node:path"); const http = require("node:http"); const { execFileSync } = require("node:child_process");
const { chromium } = require(process.env.PW_MODULE || "playwright");
const { serveDir } = require("./staticServer.cjs");
const fixture = require("./fixtures/zz-tv-hintergrund.json");

const ROOT = path.join(__dirname, "..", ".."); const OUT = ".test-e2e-dist-queue";
const PORT = 4804; const APP = `http://127.0.0.1:${PORT}`; const MOCK = 4797; const ID = fixture.game.id;
const QKEY = "match-tracker.sync-queue.v2";
const FLOW = new Set(["game-start", "game-end", "setup-start", "setup-end", "setup-pause", "setup-resume", "round-start", "round-end",
  "turn-start", "turn-end", "turn-pause", "turn-resume", "timeout-start", "timeout-end"]);

const startMock = () => new Promise((resolve) => {
  const db = { game: { ...fixture.game }, events: fixture.events.map((e) => ({ ...e })), delayMs: 0, rpcs: [] };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${MOCK}`);
    const send = (status, body) => { res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*",
      "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,OPTIONS", "access-control-expose-headers": "content-range" });
      res.end(body === undefined ? "" : JSON.stringify(body)); };
    if (req.method === "OPTIONS") return send(204);
    let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => {
      const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/)?.[1];
      if (rpc) {
        const args = raw ? JSON.parse(raw) : {}; db.rpcs.push({ at: Date.now(), rpc });
        const done = (body) => setTimeout(() => send(200, body), rpc === "mt_put_event" ? db.delayMs : 0);
        const ok = (extra = {}) => ({ matched: true, version: db.game.version, flow_version: db.game.flow_version, ...extra });
        if (rpc === "mt_put_event") {
          const ev = args.p_event; if (db.events.some((e) => e.id === ev.id)) return done(ok({ noop: true }));
          const now = new Date().toISOString();
          db.events.push({ legacy: false, note: null, revoked_by: null, value_number: null, round_number: null, turn_number: null, ...ev,
            created_at: now, occurred_at: FLOW.has(ev.event_type) ? now : (ev.occurred_at || now) });
          if (FLOW.has(ev.event_type)) db.game.flow_version += 1;
          return done(ok());
        }
        if (rpc === "mt_save_game") { const { id: _id, ...rest } = args.p_game || {}; Object.assign(db.game, rest); db.game.version += 1; return done(ok()); }
        if (rpc === "mt_revoke_event") { const e = db.events.find((x) => x.id === args.p_event_id); if (e) e.revoked_by = "mock"; return done(ok()); }
        return send(404, { message: "nicht im Mock" });
      }
      if (url.pathname === "/rest/v1/games") {
        const select = url.searchParams.get("select") || "*";
        if (select !== "*") return send(200, [{ id: ID, version: db.game.version, flow_version: db.game.flow_version }]);
        return send(200, [db.game]);
      }
      if (url.pathname === "/rest/v1/events") return send(200, db.events.filter((e) => !e.revoked_by));
      return send(404, { message: "nicht im Mock" });
    });
  });
  server.listen(MOCK, "127.0.0.1", () => resolve({ server, db }));
});

const run = async () => {
  execFileSync("node", ["./node_modules/vite/bin/vite.js", "build", "--outDir", OUT, "--emptyOutDir", "--logLevel", "error"],
    { cwd: ROOT, env: { ...process.env, VITE_SUPABASE_URL: `http://127.0.0.1:${MOCK}`, VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_lokaler_test" }, stdio: "inherit" });
  const web = await serveDir(path.join(ROOT, OUT), PORT, "127.0.0.1"); const { server, db } = await startMock();
  const browser = await chromium.launch(); const results = []; const errors = [];
  let stepNo = 0; // ONLY=4 o. ae.: nur diese Schritte (Gegenprobe am alten Code)
  const step = async (name, fn) => { stepNo += 1; if (process.env.ONLY && !process.env.ONLY.split(",").includes(String(stepNo))) return;
    await fn(); results.push(name); console.log(`  ok  ${name}`); };
  const newCtx = async () => { const ctx = await browser.newContext({ serviceWorkers: "block" });
    await ctx.route((u) => !/^http:\/\/127\.0\.0\.1:(4804|4797)\//.test(u.toString()), (r) => r.abort());
    await ctx.addInitScript(() => { window.__hidden = false; Object.defineProperty(document, "hidden", { get: () => window.__hidden });
      Object.defineProperty(document, "visibilityState", { get: () => (window.__hidden ? "hidden" : "visible") }); });
    return ctx; };
  const newPage = async (ctx) => { const p = await ctx.newPage(); p.setDefaultTimeout(8000); p.on("pageerror", (e) => errors.push(String(e))); return p; };
  const setHidden = (page, hidden) => page.evaluate((h) => { window.__hidden = h; document.dispatchEvent(new Event("visibilitychange")); }, hidden);
  const queueIds = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "[]").map((i) => i.id), QKEY);
  const queueItems = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "[]"), QKEY);
  // Ungesendet und trotzdem aus localStorage verschwunden = Verlustrisiko (Tab schliessen/neu laden -> weg).
  const lostEventItems = async (page, items) => { const stored = new Set(await queueIds(page)); const onServer = new Set(db.events.map((e) => e.id));
    return items.filter((i) => i.eventId && !stored.has(i.id) && !onServer.has(i.eventId)).map((i) => `${i.type}:${i.eventId}`); };
  const status = (page) => page.locator(".sync-indicator").first().innerText();
  const flowCount = () => db.events.filter((e) => FLOW.has(e.event_type)).length;
  const lastTurn = () => { const e = [...db.events].reverse().find((x) => /^turn-(start|pause|resume)$/.test(x.event_type)); return `Runde ${e.round_number} · Zug ${e.turn_number}`; };
  const openEditor = async (page) => { await page.goto(`${APP}/#/game/${ID}`);
    const edit = page.getByRole("button", { name: "Edit", exact: true });
    await edit.waitFor({ timeout: 6000 }).catch(() => {}); if (await edit.isVisible()) await edit.click();
    await page.getByRole("button", { name: "Weiter", exact: true }).waitFor(); await page.waitForTimeout(800); };
  const weiter = (page) => page.getByRole("button", { name: "Weiter", exact: true }).click();
  const until = async (fn, ms, label) => { const t = Date.now(); while (!(await fn())) { if (Date.now() - t > ms) assert.fail(label); await new Promise((r) => setTimeout(r, 100)); } };
  try {
    const ctx = await newCtx(); const ed = await newPage(ctx); await openEditor(ed);
    await step("Editor im Hintergrund: Weiter wird sofort gesendet (kein \"Offline\", kein Warten aufs Sichtbarwerden)", async () => {
      const before = flowCount(); await setHidden(ed, true); await weiter(ed);
      await until(async () => flowCount() > before && (await queueIds(ed)).length === 0, 4000, "im Hintergrund nicht gesendet");
      assert.doesNotMatch(await status(ed), /Offline/);
    });
    await step("Offline-Moment im Hintergrund: Weiter wartet, beim Online-Werden zuverlaessig nachgesendet", async () => {
      await setHidden(ed, true); await ctx.setOffline(true); const before = flowCount(); await weiter(ed); await ed.waitForTimeout(1000);
      assert.equal(flowCount(), before, "offline nichts gesendet"); assert.ok((await queueIds(ed)).length > 0, "wartet in der Queue");
      await ctx.setOffline(false);
      await until(async () => flowCount() > before && (await queueIds(ed)).length === 0, 5000, "nach Online nicht nachgesendet");
      assert.doesNotMatch(await status(ed), /Offline/);
    });
    await step("Variante 2 (2 Tabs): Weiter, TV sofort neu laden, Weiter im verdeckten Editor -> beides beim Server, TV folgt", async () => {
      await setHidden(ed, false); db.delayMs = 400; const tv = await newPage(ctx);
      await weiter(ed); const tvLoad = tv.goto(`${APP}/#/game/${ID}?tv=1`);
      await until(async () => (await queueIds(ed)).length === 0, 6000, "erstes Weiter nicht gesendet"); await tvLoad;
      await setHidden(ed, true); await weiter(ed); const pendingB = await queueItems(ed); // wie Pepper: Editor verdeckt
      assert.ok(pendingB.length > 0, "Ausgangslage: zweites Weiter wartet");
      for (let i = 0; i < 20 && (await queueIds(ed)).length; i++) {
        assert.deepEqual(await lostEventItems(tv, pendingB), [], "ungesendete Eintraege bleiben in localStorage"); await tv.waitForTimeout(150); }
      await until(async () => (await queueIds(ed)).length === 0, 10000, "Editor hat nicht alles gesendet");
      await setHidden(tv, true); await setHidden(tv, false);
      await until(async () => (await tv.locator(".tv-phase__title").innerText().catch(() => "")) === lastTurn(), 4000, `TV folgt nicht (${lastTurn()})`);
      db.delayMs = 0; await tv.close();
    });
    await ctx.close();
    const ctx2 = await newCtx(); const e2 = await newPage(ctx2); await openEditor(e2);
    await step("Ein zweiter Tab (Spieleliste) entfernt beim Senden nie ungesendete Eintraege des Editors aus localStorage", async () => {
      db.delayMs = 700; await weiter(e2); await e2.waitForTimeout(100);
      const list = await newPage(ctx2); await list.goto(`${APP}/#/games`); await list.waitForTimeout(400);
      await weiter(e2); await e2.waitForTimeout(50);
      const pending = (await queueItems(e2)).filter((i) => i.eventId && !db.events.some((e) => e.id === i.eventId));
      assert.ok(pending.length > 0, "Ausgangslage: Editor hat ungesendete Ereignisse");
      const t = Date.now();
      while (Date.now() - t < 9000 && (await queueIds(e2)).length) {
        assert.deepEqual(await lostEventItems(list, pending), [], "ungesendete Eintraege des Editors aus localStorage entfernt");
        await e2.waitForTimeout(100);
      }
      await until(async () => (await queueIds(e2)).length === 0 && (await queueIds(list)).length === 0, 15000, "nicht alles gesendet");
      db.delayMs = 0;
    });
    await ctx2.close();
    assert.deepEqual(errors, [], "keine Seitenfehler");
    console.log(`Queue-Tabs E2E: ${results.length} Schritte OK`);
  } finally { await browser.close(); await web.close(); server.close(); }
};
run().catch((e) => { console.error(e); process.exit(1); });
