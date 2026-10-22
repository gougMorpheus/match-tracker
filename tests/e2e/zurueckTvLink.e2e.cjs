// Timer-Regel (Tim 22.10.: Navigation nimmt den Timer mit, genau ein Zug zaehlt) + TV "Link teilen" Ende-zu-Ende, NUR lokal: gebaute App, Supabase-URL zeigt auf einen lokalen Port ohne Dienst
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

const { GAME_ADMIN_PASSWORD } = require("../../.test-dist/utils/gameSecurity.js");
const calc = require("../../.test-dist/utils/gameCalculations.js");

// kind: "laufend" (R1Z1 beendet, R1Z2 laeuft), "beendet", "aufstellung-r1z1" (Aufstellung -12..-5, R1Z1 laeuft),
// "aufstellung-laeuft" / "aufstellung-gestoppt" (noch kein Zug), "aufstellung-ohnestart-laeuft/-gestoppt" (ohne Startspieler -> Dialog)
const makeGame = (id, kind) => {
  const now = Date.now(); const at = (min) => new Date(now + min * 60000).toISOString();
  const base = createBaseGame({ id, createdAt: at(-15), updatedAt: at(-15), scheduledDate: undefined, scheduledTime: undefined });
  base.players[0].name = "ZZ-A"; base.players[1].name = "ZZ-B";
  const [p1, p2] = base.players.map((p) => p.id);
  if (kind.includes("ohnestart")) base.startingPlayerId = ""; // wie neues Spiel ohne Startspieler
  const ev = (action, playerId, r, t, min) => ({ action, playerId, roundNumber: r, turnNumber: t, createdAt: at(min) });
  const events = [{ action: "game-start", playerId: p1, createdAt: at(-12) }];
  if (kind.startsWith("aufstellung")) {
    events.push({ action: "setup-start", createdAt: at(-12) });
    if (kind === "aufstellung-r1z1") events.push({ action: "setup-end", createdAt: at(-5) }, { action: "round-start", playerId: p1, roundNumber: 1, createdAt: at(-5) }, ev("turn-start", p1, 1, 1, -5));
    if (kind.endsWith("gestoppt")) events.push({ action: "setup-pause", createdAt: at(-6) });
  } else {
    events.push({ action: "round-start", playerId: p1, roundNumber: 1, createdAt: at(-12) }, ev("turn-start", p1, 1, 1, -12), ev("turn-end", p1, 1, 1, -2), ev("turn-start", p2, 1, 2, -2));
  }
  if (kind === "beendet") events.push(ev("turn-end", p2, 1, 2, -1), { action: "round-end", playerId: p2, roundNumber: 1, createdAt: at(-1) }, { action: "game-end", playerId: p2, createdAt: at(-1) });
  const game = appendLocalTimeEvents(base, events);
  return kind === "beendet" ? { ...game, status: "completed", endedAt: at(-1) } : game;
};
const toSec = (text) => { const m = /\(((\d+)h )?((\d+)m)? ?((\d+)s)?\)/.exec(text); return m ? (+(m[2] || 0)) * 3600 + (+(m[4] || 0)) * 60 + (+(m[6] || 0)) : NaN; };

const run = async () => {
  execFileSync("node", ["./node_modules/vite/bin/vite.js", "build", "--outDir", OUT, "--emptyOutDir", "--logLevel", "error"],
    { cwd: ROOT, env: { ...process.env, VITE_SUPABASE_URL: "http://127.0.0.1:4798", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_lokaler_test" }, stdio: "inherit" });
  const web = await serveDir(path.join(ROOT, OUT), PORT, "127.0.0.1");
  const browser = await chromium.launch(); const results = [];
  const step = async (name, fn) => { await fn(); results.push(name); console.log(`  ok  ${name}`); };
  const kinds = ["laufend", "beendet", "aufstellung-r1z1", "aufstellung-laeuft", "aufstellung-gestoppt", "aufstellung-ohnestart-laeuft", "aufstellung-ohnestart-gestoppt"];
  const games = kinds.map((k) => makeGame(randomUUID(), k)); // IDs muessen UUIDs sein (mapPersistedGame)
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
    let gameId = games[0].id;
    const cached = () => page.evaluate(([key, id]) => JSON.parse(localStorage.getItem(key) || "[]").find((g) => g.id === id), [CACHE_KEY, gameId]);
    const events = async () => ((await cached())?.timeEvents || []).map((e) => `${e.action}${e.roundNumber && e.turnNumber ? ` R${e.roundNumber}Z${e.turnNumber}` : ""}`);
    const pill = () => page.locator(".game-status-strip .status-pill", { hasText: "Timer:" }).innerText();
    const header = () => page.locator(".game-header-stats span").nth(0).innerText();
    const turnHeader = () => page.locator(".game-header-stats span").nth(1).innerText();
    const dismiss = async (title) => { const m = page.locator(".timer-state-modal"); await m.waitFor();
      if (title) assert.equal(await m.locator("h2").innerText(), title); await m.locator("button").click(); await m.waitFor({ state: "detached" }); };
    const noModal = async () => assert.equal(await page.locator(".timer-state-modal").count(), 0, "Navigation aendert den Timer-Zustand nicht (kein Hinweis)");
    let mark = 0;
    const added = async () => { const all = await events(); const out = all.slice(mark); mark = all.length; return out.sort(); };
    const click = async (name) => { await page.getByRole("button", { name, exact: true }).click(); await page.waitForTimeout(600); };
    const counts = async (getText, label) => { const a = toSec(await getText()); await page.waitForTimeout(2300); const b = toSec(await getText());
      assert.ok(b - a >= 1, `${label} zaehlt sichtbar (${a}s -> ${b}s)`); };
    const still = async (getText, label) => { const a = await getText(); await page.waitForTimeout(1500); assert.equal(await getText(), a, `${label} steht`); };
    const open = async (id) => { gameId = id; await page.goto(`${APP}/#/game/${id}`);
      const edit = page.getByRole("button", { name: "Edit", exact: true });
      if (await edit.isVisible({ timeout: 3000 }).catch(() => false)) await edit.click();
      await page.getByRole("button", { name: "Weiter", exact: true }).waitFor(); await page.waitForTimeout(800); mark = (await events()).length; };
    const timerBtn = async (title) => { await page.locator(".game-bottom-dock__timer").click(); await dismiss(title); };

    await step("Spiel offen (Edit), R1Z2 laeuft", async () => {
      await open(games[0].id);
      assert.equal(await pill(), "Timer: Läuft"); assert.match(await turnHeader(), /^Zug 2 /);
    });
    await step("Zurueck bei laufendem Timer: R1Z1 wird aktiv und zaehlt, R1Z2 pausiert (nichts verdeckt)", async () => {
      await click("Zurück"); await noModal();
      assert.deepEqual(await added(), ["turn-pause R1Z2", "turn-resume R1Z1"]);
      assert.equal(await pill(), "Timer: Läuft"); assert.match(await turnHeader(), /^Zug 1 /);
      await counts(turnHeader, "Zug 1 (Vorzug)");
    });
    await step("Timer aus im Vorzug: stoppt dort (kein Springen der Rundenzeit)", async () => {
      const round = toSec(await header());
      await timerBtn("Timer gestoppt");
      assert.deepEqual(await added(), ["turn-pause R1Z1"]); assert.equal(await pill(), "Timer: Gestoppt");
      assert.ok(Math.abs(toSec(await header()) - round) <= 2, "Rundenzeit bleibt (Pepper 2: sprang frueher auf 3s)");
      await still(turnHeader, "Zug 1");
    });
    // TV in einem zweiten Tab (gleiches Geraet, laedt aus dem gespeicherten Stand = wie Neuladen/anderes Geraet)
    const tvPage = await ctx.newPage(); tvPage.setDefaultTimeout(8000); tvPage.on("pageerror", (e) => errors.push(String(e)));
    const tvPhase = async () => { await tvPage.goto(`${APP}/#/game/${games[0].id}?tv=1`); await tvPage.reload();
      await tvPage.locator(".tv-phase__title").waitFor(); return tvPage.locator(".tv-phase__title").innerText(); };
    const tvActive = async () => tvPage.locator(".tv-player--active").innerText();
    let gameIdTv = null;
    const tvPhaseOf = async (id) => { await tvPage.goto(`${APP}/#/game/${id}?tv=1`); await tvPage.reload();
      await tvPage.locator(".tv-phase__title").waitFor(); return tvPage.locator(".tv-phase__title").innerText(); };
    await step("A: Weiter/Zurueck bei gestopptem Timer: Zielzug wird aktiv (zeitneutrale Markierung), gespeichert, TV/Neuladen folgt", async () => {
      const before = await cached(); const ms = (g) => g.rounds.flatMap((r) => r.turns).map((t) => calc.getTurnDurationMs(t, g));
      await click("Weiter"); await noModal(); assert.deepEqual(await added(), ["turn-pause R1Z2"]); assert.equal(await pill(), "Timer: Gestoppt");
      assert.match(await turnHeader(), /^Zug 2 /); await still(turnHeader, "Zug 2");
      assert.equal(await tvPhase(), "Runde 1 · Zug 2", "TV nach Neuladen auf dem aktiven Zug Z2"); assert.match(await tvActive(), /ZZ-B/);
      await click("Zurück"); await noModal(); assert.deepEqual(await added(), ["turn-pause R1Z1"]); assert.equal(await pill(), "Timer: Gestoppt");
      assert.equal(await tvPhase(), "Runde 1 · Zug 1", "TV nach Zurueck auf Z1"); assert.match(await tvActive(), /ZZ-A/);
      const after = await cached();
      assert.deepEqual(ms(after).map((v) => Math.round(v / 1000)), ms(before).map((v) => Math.round(v / 1000)), "Markierung verschiebt keine Zeit");
      await open(games[0].id); assert.match(await turnHeader(), /^Zug 1 /, "Editor nach Neuladen auf Z1");
    });
    await step("B: gestoppter Zugwechsel steht im Rueckgaengig-Stapel; Undo/Redo (langer Druck) navigiert, startet nie den Timer", async () => {
      await click("Weiter"); await noModal(); assert.deepEqual(await added(), ["turn-pause R1Z2"]);
      const undo = page.locator(".game-bottom-dock__undo");
      assert.match(await undo.innerText(), /Undo: Weiter R1 Z1/, "Label = gestoppter Zugwechsel (nicht Timer aus)");
      await undo.click(); await page.waitForTimeout(700); await noModal();
      assert.deepEqual(await added(), ["turn-pause R1Z1"]); assert.equal(await pill(), "Timer: Gestoppt");
      assert.match(await turnHeader(), /^Zug 1 /); await still(turnHeader, "Zug 1 nach Undo (kein Timerstart)");
      assert.equal(await tvPhase(), "Runde 1 · Zug 1");
      const box = await undo.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.waitForTimeout(1200); await page.mouse.up();
      await page.locator(".game-bottom-dock__redo-popover").click(); await page.waitForTimeout(700); await noModal();
      assert.deepEqual(await added(), ["turn-pause R1Z2"]); assert.equal(await pill(), "Timer: Gestoppt");
      assert.match(await turnHeader(), /^Zug 2 /); await still(turnHeader, "Zug 2 nach Redo");
      assert.equal(await tvPhase(), "Runde 1 · Zug 2");
      await click("Zurück"); await noModal(); assert.deepEqual(await added(), ["turn-pause R1Z1"]); assert.match(await turnHeader(), /^Zug 1 /);
    });
    await step("Timer an im angewaehlten Vorzug: zaehlt dort", async () => {
      await timerBtn("Timer läuft");
      assert.deepEqual(await added(), ["turn-resume R1Z1"]); await counts(turnHeader, "Zug 1");
    });
    await step("Weiter bei laufendem Timer: R1Z2 wird aktiv und zaehlt, R1Z1 pausiert", async () => {
      await click("Weiter"); await noModal();
      assert.deepEqual(await added(), ["turn-pause R1Z1", "turn-resume R1Z2"]);
      assert.equal(await pill(), "Timer: Läuft"); assert.match(await turnHeader(), /^Zug 2 /); await counts(turnHeader, "Zug 2");
    });
    await step("Rueckgaengig (Undo Weiter) = Zurueck: R1Z1 aktiv, Timer laeuft weiter", async () => {
      const undo = page.locator(".game-bottom-dock__undo");
      assert.match(await undo.innerText(), /Undo: Weiter/);
      await undo.click(); await page.waitForTimeout(700); await noModal();
      assert.deepEqual(await added(), ["turn-pause R1Z2", "turn-resume R1Z1"]);
      assert.equal(await pill(), "Timer: Läuft"); assert.match(await turnHeader(), /^Zug 1 /); await counts(turnHeader, "Zug 1");
    });
    await step("Redo (Undo halten) = Weiter: R1Z2 aktiv, Timer laeuft weiter", async () => {
      const undo = page.locator(".game-bottom-dock__undo"); const box = await undo.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.waitForTimeout(1200); await page.mouse.up();
      await page.locator(".game-bottom-dock__redo-popover").click(); await page.waitForTimeout(700); await noModal();
      assert.deepEqual(await added(), ["turn-pause R1Z1", "turn-resume R1Z2"]);
      assert.equal(await pill(), "Timer: Läuft"); assert.match(await turnHeader(), /^Zug 2 /);
    });
    await step("Neuladen: Auswahl = aktiver Zug; Anzeige = Statistik (App-Logik auf den gespeicherten Events)", async () => {
      await open(games[0].id); assert.match(await turnHeader(), /^Zug 2 /); assert.equal(await pill(), "Timer: Läuft");
      const g = await cached(); const turns = g.rounds.flatMap((r) => r.turns);
      g.players.forEach((p) => assert.equal(calc.getPlayerTurnDurationTotalMs(g, p.id),
        turns.filter((t) => t.playerId === p.id).reduce((s, t) => s + calc.getTurnDurationMs(t, g), 0)));
      assert.ok(calc.getTurnDurationMs(turns[0], g) > 10 * 60000, "R1Z1 hat die nachgetragene Zeit (alt: genau 10 min)");
    });

    await step("Time-out im wieder aktiven Vorzug: stoppt dort, nach Ende laeuft der Timer dort weiter", async () => {
      await click("Zurück"); await noModal(); assert.deepEqual(await added(), ["turn-pause R1Z2", "turn-resume R1Z1"]);
      const btn = page.locator(".game-bottom-dock__timer"); const box = await btn.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.waitForTimeout(1200); await page.mouse.up();
      await page.locator(".game-bottom-dock__timeout-popover").click(); await dismiss("Time-out aktiv");
      assert.deepEqual(await added(), ["timeout-start R1Z1", "turn-pause R1Z1"]);
      await still(turnHeader, "Zug 1 im Time-out");
      await click("Weiter"); await noModal(); assert.deepEqual(await added(), ["turn-pause R1Z2"], "Navigation im Time-out: zeitneutrale Markierung");
      await click("Zurück"); await noModal(); assert.deepEqual(await added(), ["turn-pause R1Z1"]);
      await page.getByRole("button", { name: "Time-out beenden", exact: true }).click(); await dismiss("Timer läuft");
      assert.deepEqual(await added(), ["timeout-end R1Z1", "turn-resume R1Z1"]);
      assert.match(await turnHeader(), /^Zug 1 /); await counts(turnHeader, "Zug 1 nach Time-out");
    });
    await step('TV nach Zurueck: Kopfzeile "Runde 1 · Zug 1" und ZZ-A "Am Zug" (aktiver, nicht neuester Zug)', async () => {
      await page.goto(`${APP}/#/game/${games[0].id}?tv=1`);
      await page.locator(".tv-phase__title").waitFor();
      assert.equal(await page.locator(".tv-phase__title").innerText(), "Runde 1 · Zug 1");
      const active = page.locator(".tv-player--active"); assert.equal(await active.count(), 1);
      assert.match(await active.innerText(), /ZZ-A/); assert.match(await active.innerText(), /Am Zug/);
    });
    await step("Aufstellung: Zurueck bei laufendem Timer -> Aufstellung zaehlt, R1Z1 pausiert; Weiter -> R1Z1 zaehlt", async () => {
      await open(games[2].id); assert.equal(await pill(), "Timer: Läuft");
      await click("Zurück"); await noModal();
      assert.deepEqual(await added(), ["setup-start", "turn-pause R1Z1"]);
      assert.match(await header(), /^Aufstellung /); assert.equal(await pill(), "Timer: Läuft"); await counts(header, "Aufstellung");
      await click("Weiter"); await noModal();
      assert.deepEqual(await added(), ["setup-end", "turn-resume R1Z1"]);
      assert.match(await turnHeader(), /^Zug 1 /); await counts(turnHeader, "Zug 1");
    });
    await step("Aufstellung bei gestopptem Timer: Zurueck/Weiter mit zeitneutralen Markierungen, bleibt gestoppt, TV folgt", async () => {
      gameIdTv = games[2].id;
      await timerBtn("Timer gestoppt"); assert.deepEqual(await added(), ["turn-pause R1Z1"]);
      const setupBefore = calc.getSetupDurationMs(await cached());
      await click("Zurück"); await noModal(); assert.deepEqual(await added(), ["setup-pause"]); assert.match(await header(), /^Aufstellung /);
      assert.equal(await pill(), "Timer: Gestoppt"); await still(header, "Aufstellung");
      assert.equal(await tvPhaseOf(games[2].id), "Aufstellung", "TV: Aufstellung aktiv");
      assert.equal(calc.getSetupDurationMs(await cached()), setupBefore, "Markierung verschiebt keine Aufstellungszeit");
      await open(games[2].id); assert.match(await header(), /^Aufstellung /, "Neuladen: Aufstellung aktiv");
      await timerBtn("Timer läuft"); assert.deepEqual(await added(), ["setup-start"], "neuer Abschnitt (kein wirkungsloses setup-resume)");
      await counts(header, "Aufstellung nach Timer an"); await timerBtn("Timer gestoppt"); assert.deepEqual(await added(), ["setup-pause"]);
      await click("Weiter"); await noModal(); assert.deepEqual(await added(), ["setup-end", "turn-pause R1Z1"]); assert.equal(await pill(), "Timer: Gestoppt");
      assert.match(await turnHeader(), /^Zug 1 /); assert.equal(await tvPhaseOf(games[2].id), "Runde 1 · Zug 1");
      const undo = page.locator(".game-bottom-dock__undo"); assert.match(await undo.innerText(), /Undo: Weiter Aufstellung/);
    });
    await step("Weiter aus laufender Aufstellung: R1Z1 startet laufend (kein automatischer pausierter Start)", async () => {
      await open(games[3].id); assert.equal(await pill(), "Timer: Läuft");
      await click("Weiter"); await noModal();
      const a = await added(); assert.ok(a.includes("turn-start R1Z1") && a.includes("setup-end") && !a.includes("turn-pause R1Z1"), a.join(","));
      assert.equal(await pill(), "Timer: Läuft"); await counts(turnHeader, "Zug 1");
      assert.match(await page.locator(".game-bottom-dock__undo").innerText(), /Undo: Weiter Aufstellung/, "Label nennt den verlassenen Abschnitt");
    });
    const viaDialog = async () => {
      await page.getByRole("button", { name: "Weiter", exact: true }).click();
      await page.getByRole("heading", { name: "Startspieler auswählen" }).waitFor();
      await page.locator(".modal-card select").selectOption("player2");
      await page.getByRole("button", { name: "Weiter zu Zug 1", exact: true }).click(); await page.waitForTimeout(900);
      assert.equal((await cached()).startingPlayerId, (await cached()).players[1].id, "Startspieler ZZ-B gespeichert");
    };
    await step("Startspieler-Dialog aus laufender Aufstellung: R1Z1 (ZZ-B) laeuft", async () => {
      await open(games[5].id); assert.equal(await pill(), "Timer: Läuft");
      await viaDialog();
      const a = await added(); assert.ok(a.includes("turn-start R1Z1") && a.includes("setup-end") && !a.includes("turn-pause R1Z1"), a.join(","));
      assert.equal(await pill(), "Timer: Läuft"); assert.match(await turnHeader(), /^Zug 1 /); await counts(turnHeader, "Zug 1 nach Dialog");
    });
    await step("Startspieler-Dialog aus gestoppter Aufstellung: R1Z1 bleibt gestoppt", async () => {
      await open(games[6].id); assert.equal(await pill(), "Timer: Gestoppt");
      await viaDialog();
      const a = await added(); assert.ok(a.includes("turn-start R1Z1") && a.includes("turn-pause R1Z1"), a.join(","));
      assert.equal(await pill(), "Timer: Gestoppt"); await still(turnHeader, "Zug 1 nach Dialog");
    });
    await step("Weiter aus gestoppter Aufstellung: R1Z1 entsteht gestoppt", async () => {
      await open(games[4].id); assert.equal(await pill(), "Timer: Gestoppt");
      await click("Weiter"); await noModal();
      const a = await added(); assert.ok(a.includes("turn-start R1Z1") && a.includes("turn-pause R1Z1"), a.join(","));
      assert.equal(await pill(), "Timer: Gestoppt");
    });
    await step("Abschluss = gestoppter Timer; Wiedereroeffnen und Timer an zaehlt im aktiven Zug", async () => {
      await page.goto(`${APP}/#/game/${games[1].id}`); gameId = games[1].id; await page.waitForTimeout(800);
      await page.getByRole("button", { name: "Spielmenü" }).click();
      // Beendetes Spiel oeffnet als TV-Ansicht; Wiedereroeffnen ueber "Entsperren" (Admin-Passwort)
      await page.locator(".floating-menu__item", { hasText: "Entsperren" }).click();
      await page.locator("input[type=password]").fill(GAME_ADMIN_PASSWORD);
      await page.getByRole("button", { name: "Wieder eröffnen", exact: true }).click();
      const edit = page.getByRole("button", { name: "Edit", exact: true });
      if (await edit.isVisible({ timeout: 2500 }).catch(() => false)) await edit.click();
      await page.getByRole("button", { name: "Weiter", exact: true }).waitFor(); await page.waitForTimeout(800);
      const ev = await events(); assert.ok(!ev.includes("game-end"), "game-end entfernt"); mark = ev.length;
      await dismiss("Timer gestoppt"); // nach dem Wiedereroeffnen: gestoppter Timer (Abschluss = gestoppt)
      assert.equal(await pill(), "Timer: Gestoppt"); assert.match(await turnHeader(), /^Zug 2 /);
      await timerBtn("Timer läuft");
      assert.deepEqual(await added(), ["turn-resume R1Z2"]); await counts(turnHeader, "Zug 2 nach Wiedereroeffnen");
    });
    await ctx.close();

    const desk = await newContext({ permissions: ["clipboard-read", "clipboard-write"] });
    const tv = await desk.newPage(); tv.setDefaultTimeout(8000); tv.on("pageerror", (e) => errors.push(String(e)));
    for (const [label, game] of [["laufendes Spiel", games[0]], ["beendetes Spiel", games[1]], ["Aufstellung", games[3]]]) {
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
