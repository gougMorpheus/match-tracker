// Zurueck-Fix + TV "Link teilen" Ende-zu-Ende, NUR lokal: gebaute App, Supabase-URL zeigt auf einen lokalen Port ohne Dienst
// (App offline), alles ausser 127.0.0.1/localhost wird im Browser blockiert -> kein Zugriff auf die Live-DB.
// Das ZZ-Spiel wird mit der App-eigenen Logik (.test-dist) gebaut und in den lokalen Cache gelegt. Start: npm run test:zurueck-e2e
const assert = require("node:assert/strict");
const path = require("node:path"); const { randomUUID } = require("node:crypto"); const { execFileSync } = require("node:child_process");
const { chromium } = require(process.env.PW_MODULE || "playwright");
const { serveDir } = require("./staticServer.cjs");
const { appendLocalTimeEvents } = require("../../.test-dist/utils/gameState.js");
const { createBaseGame } = require("../helpers/gameFixtures.cjs");

const ROOT = path.join(__dirname, "..", ".."); const OUT = ".test-e2e-dist-zt";
const PORT = 4801; const APP = `http://127.0.0.1:${PORT}`;
const CACHE_KEY = "match-tracker.local-games.v1";

const makeGame = (id, ended) => {
  const now = Date.now(); const at = (min) => new Date(now + min * 60000).toISOString();
  const base = createBaseGame({ id, createdAt: at(-15), updatedAt: at(-15), scheduledDate: undefined, scheduledTime: undefined });
  base.players[0].name = "ZZ-A"; base.players[1].name = "ZZ-B";
  const [p1, p2] = base.players.map((p) => p.id);
  const events = [
    { action: "game-start", playerId: p1, createdAt: at(-12) },
    { action: "round-start", playerId: p1, roundNumber: 1, createdAt: at(-12) },
    { action: "turn-start", playerId: p1, roundNumber: 1, turnNumber: 1, createdAt: at(-12) },
    { action: "turn-end", playerId: p1, roundNumber: 1, turnNumber: 1, createdAt: at(-2) },
    { action: "turn-start", playerId: p2, roundNumber: 1, turnNumber: 2, createdAt: at(-2) }
  ];
  if (ended) events.push({ action: "game-end", playerId: p2, createdAt: at(-1) });
  const game = appendLocalTimeEvents(base, events);
  return ended ? { ...game, status: "completed", endedAt: at(-1) } : game;
};

const run = async () => {
  execFileSync("node", ["./node_modules/vite/bin/vite.js", "build", "--outDir", OUT, "--emptyOutDir", "--logLevel", "error"],
    { cwd: ROOT, env: { ...process.env, VITE_SUPABASE_URL: "http://127.0.0.1:4798", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_lokaler_test" }, stdio: "inherit" });
  const web = await serveDir(path.join(ROOT, OUT), PORT, "127.0.0.1");
  const browser = await chromium.launch(); const results = [];
  const step = async (name, fn) => { await fn(); results.push(name); console.log(`  ok  ${name}`); };
  const games = [makeGame(randomUUID(), false), makeGame(randomUUID(), true)]; // IDs muessen UUIDs sein (mapPersistedGame)
  const newContext = async (opts = {}) => {
    const ctx = await browser.newContext({ serviceWorkers: "block", ...opts });
    await ctx.route((u) => !/^http:\/\/(127\.0\.0\.1|localhost):(4801)\//.test(u.toString()), (r) => r.abort());
    await ctx.addInitScript(([key, value]) => { if (!sessionStorage.getItem("zz-seeded")) { localStorage.setItem(key, value); sessionStorage.setItem("zz-seeded", "1"); } },
      [CACHE_KEY, JSON.stringify(games)]);
    return ctx;
  };
  const errors = [];
  try {
    const ctx = await newContext(); const page = await ctx.newPage(); page.setDefaultTimeout(8000);
    page.on("pageerror", (e) => errors.push(String(e)));
    const events = () => page.evaluate(([key, id]) => (JSON.parse(localStorage.getItem(key) || "[]").find((g) => g.id === id)?.timeEvents || [])
      .map((e) => `${e.action}${e.roundNumber ? ` R${e.roundNumber}Z${e.turnNumber}` : ""}`), [CACHE_KEY, games[0].id]);
    const pill = () => page.locator(".game-status-strip .status-pill", { hasText: "Timer:" }).innerText();
    const timerBtn = () => page.locator(".game-bottom-dock__timer .game-bottom-dock__primary-label").innerText();

    await step("Spiel offen (Edit), R1Z2 laeuft", async () => {
      await page.goto(`${APP}/#/game/${games[0].id}`);
      const edit = page.getByRole("button", { name: "Edit", exact: true });
      if (await edit.isVisible({ timeout: 3000 }).catch(() => false)) await edit.click();
      await page.getByRole("button", { name: "Zurück", exact: true }).waitFor();
      await page.waitForTimeout(800);
      assert.equal(await pill(), "Timer: Läuft"); assert.equal(await timerBtn(), "Timer aus");
    });
    let before;
    await step("Zurueck bei laufendem Timer: keine Timer-Events, Timer laeuft weiter (alt: turn-pause R1Z2 + turn-resume R1Z1)", async () => {
      before = await events();
      await page.getByRole("button", { name: "Zurück", exact: true }).click(); await page.waitForTimeout(700);
      assert.deepEqual((await events()).slice(before.length), [], "Zurueck schreibt nichts");
      assert.equal(await pill(), "Timer: Läuft"); assert.equal(await timerBtn(), "Timer aus");
      assert.equal(await page.locator(".timer-state-modal").count(), 0, "kein Hinweis 'Timer gestoppt' durch Zurueck");
    });
    await step("Auf dem Vorzug: Timer aus/an wirkt auf den laufenden Zug R1Z2, nie auf den beendeten R1Z1", async () => {
      const notice = async (title) => { const m = page.locator(".timer-state-modal"); await m.waitFor();
        assert.equal(await m.locator("h2").innerText(), title); await m.locator("button").click(); };
      await page.locator(".game-bottom-dock__timer").click(); await notice("Timer gestoppt");
      assert.equal(await pill(), "Timer: Gestoppt");
      await page.locator(".game-bottom-dock__timer").click(); await notice("Timer läuft");
      assert.equal(await pill(), "Timer: Läuft");
      const added = (await events()).slice(before.length);
      assert.deepEqual(added, ["turn-pause R1Z2", "turn-resume R1Z2"]);
    });
    await step("Weiter zurueck auf den laufenden Zug: nur Ansicht, keine Timer-Events", async () => {
      const n = (await events()).length;
      await page.getByRole("button", { name: "Weiter", exact: true }).click(); await page.waitForTimeout(600);
      assert.equal((await events()).length, n); assert.equal(await pill(), "Timer: Läuft");
    });
    await ctx.close();

    const desk = await newContext({ permissions: ["clipboard-read", "clipboard-write"] });
    const tv = await desk.newPage(); tv.setDefaultTimeout(8000); tv.on("pageerror", (e) => errors.push(String(e)));
    for (const [label, game] of [["laufendes Spiel", games[0]], ["beendetes Spiel", games[1]]]) {
      await step(`TV (${label}): Knopf "Link teilen" kopiert Direktlink ?tv=1 + "Link kopiert"`, async () => {
        await tv.goto(`${APP}/#/game/${game.id}?tv=1`);
        const btn = tv.locator(".tv-game__controls button", { hasText: "Link teilen" }); await btn.waitFor();
        await btn.click();
        await tv.locator(".share-notice", { hasText: "Link kopiert" }).waitFor();
        assert.equal(await tv.evaluate(() => navigator.clipboard.readText()), `${APP}/#/game/${game.id}?tv=1`);
      });
    }
    await desk.close();

    const mob = await newContext({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });
    await mob.addInitScript(() => { window.__shared = []; navigator.share = async (data) => { window.__shared.push(data); }; });
    const mp = await mob.newPage(); mp.setDefaultTimeout(8000); mp.on("pageerror", (e) => errors.push(String(e)));
    await step('TV mobil: "Link teilen" oeffnet den Teilen-Dialog mit dem Direktlink', async () => {
      await mp.goto(`${APP}/#/game/${games[0].id}?tv=1`);
      await mp.locator(".tv-game__controls button", { hasText: "Link teilen" }).click();
      await mp.locator(".share-notice", { hasText: "Link geteilt" }).waitFor();
      const shared = await mp.evaluate(() => window.__shared);
      assert.equal(shared.length, 1); assert.equal(shared[0].url, `${APP}/#/game/${games[0].id}?tv=1`);
    });
    await mob.close();
    assert.deepEqual(errors, [], "keine Seitenfehler");
    console.log(`Zurueck/TV-Link E2E: ${results.length} Schritte OK`);
  } finally { await browser.close(); await web.close(); }
};
run().catch((e) => { console.error(e); process.exit(1); });
