// Battle-Cal (D2) Ende-zu-Ende, NUR lokal: gebaute App (.test-e2e-dist, Supabase-URL = lokaler Mock) + lokales Test-Postgres.
// Start: npm run test:battlecal-e2e  (braucht psql/Postgres unter BC_LOCAL_PG, Standard "-h /tmp -p 54329", und Playwright).
// Alles, was nicht 127.0.0.1/localhost ist, wird im Browser blockiert -> kein Zugriff auf die Live-DB.
const assert = require("node:assert/strict");
const path = require("node:path"); const fs = require("node:fs"); const { execFileSync } = require("node:child_process");
const { chromium } = require(process.env.PW_MODULE || "playwright");
const { createRpcMock } = require("./bcRpcMock.cjs");
const { serveDir } = require("./staticServer.cjs");

const ROOT = path.join(__dirname, "..", "..");
const PG = (process.env.BC_LOCAL_PG || "-h /tmp -p 54329").split(" ");
const DB = "bc_e2e";
const APP = "http://127.0.0.1:4795"; const OLD = "http://localhost:4796"; const RPC_PORT = 4797;
const PW = "zz-profil-pw"; const ADMIN = "dummy-admin";
const psql = (db, ...a) => execFileSync("psql", [...PG, "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-qAt", ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const setupDb = () => {
  psql("postgres", "-c", `drop database if exists ${DB}`); psql("postgres", "-c", `create database ${DB}`);
  psql(DB, "-f", path.join(ROOT, "supabase/tests/battlecal_local_stubs.sql"));
  psql(DB, "-f", path.join(ROOT, "supabase/migrations/20261019_01_battlecal_basis.sql"));
  psql(DB, "-f", path.join(ROOT, "supabase/migrations/20261019_02_battlecal_app.sql"));
  psql(DB, "-f", path.join(ROOT, "supabase/migrations/20261019_03_battlecal_ohne_passwort.sql"));
  psql(DB, "-c", `insert into vault.decrypted_secrets (name, decrypted_secret) values ('bc_admin_password_hash', extensions.crypt('${ADMIN}', extensions.gen_salt('bf')))`);
};
const build = () => {
  const env = { ...process.env, VITE_SUPABASE_URL: `http://127.0.0.1:${RPC_PORT}`, VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_lokaler_test" };
  execFileSync("node", ["./node_modules/vite/bin/vite.js", "build", "--outDir", ".test-e2e-dist", "--emptyOutDir", "--logLevel", "error"], { cwd: ROOT, env, stdio: "inherit" });
};

const run = async () => {
  setupDb(); build();
  const mock = await createRpcMock({ pgArgs: PG, db: DB, port: RPC_PORT });
  const web = await serveDir(path.join(ROOT, ".test-e2e-dist"), 4795, "127.0.0.1");
  const old = await serveDir(path.join(ROOT, "tools/battle-cal/umzug"), 4796, "localhost");
  const browser = await chromium.launch();
  const results = [];
  const step = async (name, fn) => { await fn(); results.push(name); console.log(`  ok  ${name}`); };
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block" });
    const blocked = [];
    await ctx.route((u) => !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(u.toString()), (r) => { blocked.push(r.request().url()); r.abort(); });
    // Popups (Umzug) bekommen sofort einen Dialog-Handler (sonst verwirft Playwright confirm() automatisch).
    const page = await ctx.newPage(); page.setDefaultTimeout(8000);
    ctx.on("page", (p) => { if (p !== page) { p.on("dialog", (d) => d.accept()); p.on("pageerror", (e) => errors.push(`popup: ${e}`)); } });
    const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    const dialogs = []; let promptAnswer = null;
    page.on("dialog", (d) => { dialogs.push(`${d.type()}: ${d.message()}`); d.type() === "prompt" ? d.accept(promptAnswer ?? d.defaultValue()) : d.accept(); });
    const toast = async (re) => { await page.waitForFunction((src) => new RegExp(src).test(document.getElementById("toast")?.textContent || ""), re.source); };
    const menu = async (id) => { if (!(await page.isVisible(id))) await page.click("#menuToggleBtn"); await page.click(id); };
    const enterPassword = async (value) => { await page.fill("#bcPasswordInput", value); await page.click('[data-password-action="ok"]'); };
    const rpcs = () => mock.log.filter((l) => l.rpc).map((l) => l.rpc);
    const storageDump = () => page.evaluate(() => JSON.stringify({ l: Object.entries(localStorage), s: Object.entries(sessionStorage) }));
    const history = () => page.evaluate(() => JSON.parse(localStorage.getItem("wh40k-prob-history-v1") || "[]"));
    const sql = (q) => psql(DB, "-c", q).trim();
    let savedInputs = null; let savedOutputs = null;

    await step("Schalter AUS (?battlecal=0, gemerkt): Hinweis, keine Datenaufrufe", async () => {
      await page.goto(`${APP}/battle-cal/?battlecal=0`); await page.waitForTimeout(500);
      await page.goto(`${APP}/battle-cal/`); await page.waitForTimeout(500);
      assert.equal(await page.isVisible("#bcDisabledNote"), true); assert.equal(await page.isHidden("#bcAppRoot"), true);
      assert.equal(mock.log.length, 0);
    });
    await step("Standard AN (frischer Browser ohne Schalter): App laedt Profile", async () => {
      const fresh = await browser.newContext({ serviceWorkers: "block" }); const fp = await fresh.newPage(); fp.setDefaultTimeout(8000);
      await fp.goto(`${APP}/battle-cal/`);
      await fp.waitForFunction(() => document.getElementById("cloudProfileSelect")?.options.length >= 1);
      assert.equal(await fp.isHidden("#bcDisabledNote"), true);
      await fp.goto(`${APP}/#/battle-cal`); await fp.waitForSelector("iframe.battle-cal-frame");
      await fresh.close(); mock.log.length = 0;
    });
    await step("Schalter AN (?battlecal=1): App laedt Profile per bc_profiles_list", async () => {
      await page.goto(`${APP}/battle-cal/?battlecal=1`);
      await page.waitForFunction(() => document.getElementById("cloudProfileSelect")?.options.length >= 1);
      await page.waitForTimeout(300);
      assert.deepEqual(rpcs(), ["bc_profiles_list"]);
    });
    await step("Profil anlegen (bc_profile_create), Passwort nicht im Speicher", async () => {
      await menu("#cloudProfileOpenBtn");
      await page.fill("#cloudProfileName", "ZZ-E2E"); await page.fill("#cloudProfilePassword", PW);
      await page.click("#cloudProfileCreateBtn"); await toast(/Cloud-Profil ZZ-E2E aktiv/);
      assert.ok(rpcs().includes("bc_profile_create"));
      const dump = await storageDump(); assert.ok(!dump.includes(PW), "kein Klartext-Passwort im Browser-Speicher");
      assert.ok(!dump.includes("delete_password"));
      assert.equal(sql("select count(*) from battlecal.profiles where name = 'ZZ-E2E' and password_hash like '$2a$%'"), "1");
      await page.click("#cloudProfileCloseBtn");
    });
    await step("Berechnen speichert in der Cloud (bc_result_upsert, Passwort aus dem Arbeitsspeicher, keine Abfrage)", async () => {
      await page.evaluate(() => document.getElementById("calculatorForm").requestSubmit());
      await page.waitForFunction(() => JSON.parse(localStorage.getItem("wh40k-prob-history-v1") || "[]").length === 1);
      await page.waitForFunction(() => /Synchron|Gespeichert|synchron/i.test(document.body.innerText) || true);
      await page.waitForTimeout(600);
      assert.ok(rpcs().includes("bc_result_upsert")); assert.equal(await page.isVisible("#bcPasswordInput"), false);
      const first = (await history())[0]; savedInputs = first.inputs; savedOutputs = first.outputs;
      assert.equal(sql("select count(*) from battlecal.results where deleted_at is null"), "1");
    });
    await step("Neu laden: Passwort weg; Umbenennen fragt nach; falsches Passwort abgelehnt, richtiges gespeichert", async () => {
      await page.reload(); await page.waitForFunction(() => document.querySelectorAll('#historyContainer [data-action="rename"]').length === 1);
      assert.ok(!(await storageDump()).includes(PW));
      promptAnswer = "ZZ Titel 1";
      await page.locator('#historyContainer [data-action=\"rename\"]').dispatchEvent('click');
      await page.waitForSelector("#bcPasswordInput"); await enterPassword("falsch");
      await toast(/Passwort ist falsch/);
      assert.equal(sql("select custom_title from battlecal.results"), "");
      promptAnswer = "ZZ Titel 2";
      await page.locator('#historyContainer [data-action=\"rename\"]').dispatchEvent('click');
      await page.waitForSelector("#bcPasswordInput"); await enterPassword(PW);
      await page.waitForFunction(() => true); await page.waitForTimeout(800);
      assert.equal(sql("select custom_title from battlecal.results"), "ZZ Titel 2");
      assert.ok(!(await storageDump()).includes(PW));
    });
    await step("Admin-Passwort darf NICHT in die Historie schreiben", async () => {
      await page.reload(); await page.waitForFunction(() => document.querySelectorAll('#historyContainer [data-action="rename"]').length === 1);
      promptAnswer = "ZZ Admin";
      await page.locator('#historyContainer [data-action=\"rename\"]').dispatchEvent('click');
      await page.waitForSelector("#bcPasswordInput"); await enterPassword(ADMIN);
      await toast(/Passwort ist falsch/);
      assert.equal(sql("select custom_title from battlecal.results"), "ZZ Titel 2");
    });
    await step("Eintrag loeschen = weich (bc_result_delete)", async () => {
      await page.reload(); await page.waitForFunction(() => document.querySelectorAll('#historyContainer [data-action="delete"]').length === 1);
      await page.locator('#historyContainer [data-action=\"delete\"]').dispatchEvent('click');
      await page.waitForSelector("#bcPasswordInput"); await enterPassword(PW);
      await page.waitForTimeout(800);
      assert.equal(sql("select count(*) || '/' || count(deleted_at) from battlecal.results"), "1/1");
    });
    await step("Armeeliste importieren (bc_roster_import, EIN Aufruf) und Einheiten/Waffen laden (bc_roster_get)", async () => {
      const before = rpcs().length;
      await page.setInputFiles("#armyImportFile", path.join(ROOT, "tests/fixtures/battle-cal/wraith-kern-basis.json"));
      await toast(/importiert: \d+ Einheiten, \d+ Waffen/);
      const calls = rpcs().slice(before);
      assert.equal(calls.filter((c) => c === "bc_roster_import").length, 1, calls.join(","));
      assert.ok(calls.includes("bc_roster_get"));
      const units = Number(sql("select count(*) from battlecal.army_units where deleted_at is null"));
      const weapons = Number(sql("select count(*) from battlecal.army_weapons where deleted_at is null"));
      assert.ok(units > 0 && weapons > 0, `${units}/${weapons}`);
      const maxId = sql("select max(length(id)) || ' ' || (select max(length(id)) from battlecal.army_units) || ' ' || (select id from battlecal.army_weapons order by length(id) desc limit 1) from battlecal.army_weapons"); console.log("      laengste IDs (Waffe/Einheit):", maxId.split(" ").slice(0, 2).join("/"));
      await page.waitForFunction(() => document.getElementById("armyAttackerUnit").options.length > 1);
      await page.waitForFunction(() => document.querySelectorAll("#armyWeaponList input[type='checkbox']").length > 0);
    });
    await step("Erneuter Import ersetzt (keine Dubletten)", async () => {
      const n = sql("select count(*) from battlecal.army_units where deleted_at is null");
      await page.setInputFiles("#armyImportFile", path.join(ROOT, "tests/fixtures/battle-cal/wraith-kern-basis.json"));
      await toast(/importiert/); await page.waitForTimeout(300);
      assert.equal(sql("select count(*) from battlecal.army_units where deleted_at is null"), n);
      assert.equal(sql("select count(*) from battlecal.army_units"), n);
    });
    await step("Einheiten-Editor: Einheit aendern, Waffe anlegen/loeschen, Einheit loeschen, Armee loeschen (alles weich)", async () => {
      await menu("#armyEditorOpenBtn");
      await page.waitForFunction(() => document.getElementById("armyEditorUnitSelect").options.length > 1);
      const unitId = await page.inputValue("#armyEditorUnitSelect");
      const movementBefore = sql(`select movement_text from battlecal.army_units where id = $$${unitId}$$`);
      await page.fill("#armyEditorUnitName", "ZZ Einheit geaendert");
      await page.click("#armyEditorSaveUnitBtn"); await toast(/Einheit gespeichert/);
      assert.equal(sql(`select name from battlecal.army_units where id = $$${unitId}$$`), "ZZ Einheit geaendert");
      assert.equal(sql(`select movement_text from battlecal.army_units where id = $$${unitId}$$`), movementBefore, "unveraenderte Felder bleiben");
      await page.selectOption("#armyEditorUnitSelect", unitId); await page.waitForTimeout(300);
      await page.click("#armyEditorNewWeaponBtn");
      await page.fill("#armyEditorWeaponName", "ZZ Waffe"); await page.fill("#armyEditorWeaponCount", "1");
      await page.fill("#armyEditorWeaponAttacks", "2"); await page.fill("#armyEditorWeaponStrength", "4");
      await page.fill("#armyEditorWeaponAp", "-1"); await page.fill("#armyEditorWeaponDamage", "1");
      await page.click("#armyEditorSaveWeaponBtn"); await toast(/Waffe gespeichert/);
      assert.equal(sql("select count(*) from battlecal.army_weapons where name = 'ZZ Waffe' and deleted_at is null"), "1");
      await page.waitForFunction(() => Array.from(document.getElementById("armyEditorWeaponSelect").options).some((o) => /ZZ Waffe/.test(o.textContent)));
      const wid = await page.evaluate(() => Array.from(document.getElementById("armyEditorWeaponSelect").options).find((o) => /ZZ Waffe/.test(o.textContent)).value);
      await page.selectOption("#armyEditorWeaponSelect", wid);
      await page.click("#armyEditorDeleteWeaponBtn"); await toast(/Waffe gelöscht/);
      assert.equal(sql("select count(*) from battlecal.army_weapons where name = 'ZZ Waffe' and deleted_at is not null"), "1");
      await page.selectOption("#armyEditorUnitSelect", unitId); await page.waitForTimeout(300);
      await page.click("#armyEditorDeleteUnitBtn"); await toast(/Einheit gelöscht/);
      assert.equal(sql(`select (deleted_at is not null)::text from battlecal.army_units where id = $$${unitId}$$`), "true");
      await page.click("#armyEditorDeleteRosterBtn"); await toast(/Armee gelöscht/);
      assert.equal(sql("select count(*) from battlecal.army_rosters where deleted_at is null"), "0");
      assert.equal(sql("select count(*) from battlecal.army_units where deleted_at is null"), "0");
      await page.click("#armyEditorCloseBtn").catch(() => undefined);
    });
    await step("Profil umbenennen mit Admin-Passwort (Ersatz fuer Master-Passwort)", async () => {
      await page.reload(); await page.waitForTimeout(800);
      promptAnswer = "ZZ-E2E-neu";
      await menu("#cloudProfileOpenBtn"); await page.click("#cloudProfileRenameBtn");
      await page.waitForSelector("#bcPasswordInput"); await enterPassword(ADMIN);
      await toast(/umbenannt/);
      assert.equal(sql("select name from battlecal.profiles where deleted_at is null"), "ZZ-E2E-neu");
    });
    await step("Profil loeschen: falsches Passwort abgelehnt, Admin-Passwort loescht weich", async () => {
      await page.click("#cloudProfileDeleteBtn"); await page.waitForSelector("#bcPasswordInput"); await enterPassword("falsch");
      await toast(/Passwort ist falsch/);
      assert.equal(sql("select count(*) from battlecal.profiles where deleted_at is null"), "1");
      await page.click("#cloudProfileDeleteBtn"); await page.waitForSelector("#bcPasswordInput"); await enterPassword(ADMIN);
      await toast(/gelöscht/);
      assert.equal(sql("select count(*) || '/' || count(deleted_at) from battlecal.profiles"), "1/1");
      await page.click("#cloudProfileCloseBtn");
    });
    await step("Umzug: alte Site (andere Origin) uebergibt lokale Daten per postMessage, ohne altes Passwort", async () => {
      const oldPage = await ctx.newPage(); oldPage.setDefaultTimeout(8000);
      await oldPage.goto(`${OLD}/umzug.html`);
      const entry = (id, t) => ({ id, createdAt: t, customTitle: `ZZ alt ${id}`, inputs: savedInputs, outputs: savedOutputs });
      await oldPage.evaluate(([e1, e2]) => {
        localStorage.setItem("wh40k-prob-history-v1", JSON.stringify([e1, e2]));
        localStorage.setItem("wh40k-army-compare-history-v1", JSON.stringify([{ id: "cmp1", title: "ZZ Vergleich", summary: "s", createdAt: "2026-05-01T10:00:00Z", html: '<div class="x">Tabelle</div><img src=x onerror="window.__xss=1"><script>window.__xss=2</script>' }]));
        localStorage.setItem("wh40k-prob-cloud-profile-v1", JSON.stringify({ id: "11111111-1111-1111-1111-111111111111", name: "Alt", delete_password: "altes-geheim" }));
      }, [entry("alt-1", "2026-05-01T09:00:00Z"), entry("alt-2", "2026-05-02T09:00:00Z")]);
      await oldPage.goto(`${OLD}/umzug.html?target=${encodeURIComponent(`${APP}/battle-cal/?umzug=1&battlecal=1`)}`);
      await oldPage.waitForFunction(() => /2 Historien-Einträge, 1 Armeevergleiche/.test(document.getElementById("summary").textContent));
      const [popup] = await Promise.all([ctx.waitForEvent("page"), oldPage.click("#moveBtn")]);
      await oldPage.waitForFunction(() => /Fertig: 2 Historien-Einträge und 1 Armeevergleiche/.test(document.getElementById("status").textContent), null, { timeout: 15000 })
        .catch(async (e) => { throw new Error(`${e.message} | Status alt: ${await oldPage.textContent("#status")} | Toast neu: ${await popup.textContent("#toast").catch(() => "?")} | ${errors.join(" ; ")}`); });
      const moved = await popup.evaluate(() => ({ h: JSON.parse(localStorage.getItem("wh40k-prob-history-v1") || "[]"), c: JSON.parse(localStorage.getItem("wh40k-army-compare-history-v1") || "[]"), all: JSON.stringify(Object.entries(localStorage)), xss: window.__xss || 0 }));
      assert.deepEqual(moved.h.map((e) => e.id).sort(), ["alt-1", "alt-2"]);
      assert.equal(moved.c.length, 1); assert.ok(!/onerror|<script/i.test(moved.c[0].html), "Vergleichs-HTML bereinigt");
      assert.ok(!moved.all.includes("altes-geheim"), "altes Passwort nicht uebernommen");
      await popup.waitForTimeout(300); assert.equal(await popup.evaluate(() => window.__xss || 0), 0);
      // zweiter Umzug: keine Dubletten
      await popup.close();
      const [popup2] = await Promise.all([ctx.waitForEvent("page"), oldPage.click("#moveBtn")]);
      await popup2.waitForFunction(() => /keine neuen Einträge/.test(document.getElementById("toast").textContent), null, { timeout: 15000 });
      await popup2.close();
      // Datei-Weg: Export der alten Seite in der neuen App einlesen
      const [download] = await Promise.all([oldPage.waitForEvent("download"), oldPage.click("#fileBtn")]);
      const file = path.join(ROOT, ".test-e2e-dist", "umzug-test.json"); await download.saveAs(file);
      const fresh = await browser.newContext({ serviceWorkers: "block" });
      await fresh.route((u) => !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(u.toString()), (r) => r.abort());
      const p2 = await fresh.newPage(); p2.setDefaultTimeout(8000); p2.on("dialog", (d) => d.accept());
      await p2.goto(`${APP}/battle-cal/?battlecal=1`); await p2.waitForTimeout(500);
      await p2.setInputFiles("#importHistoryFile", file);
      await p2.waitForFunction(() => JSON.parse(localStorage.getItem("wh40k-prob-history-v1") || "[]").length === 2);
      await fresh.close(); await oldPage.close();
    });
    await step("Neues Profil uebernimmt lokale (umgezogene) Historie (bc_results_upsert_many), Historie leeren (bc_results_clear), Armee manuell anlegen (bc_roster_upsert)", async () => {
      await page.reload(); await page.waitForFunction(() => JSON.parse(localStorage.getItem("wh40k-prob-history-v1") || "[]").length >= 2);
      await menu("#cloudProfileOpenBtn");
      await page.fill("#cloudProfileName", "ZZ-Zwei"); await page.fill("#cloudProfilePassword", PW);
      await page.click("#cloudProfileCreateBtn"); await toast(/Cloud-Profil ZZ-Zwei aktiv/); await page.waitForTimeout(500);
      assert.ok(rpcs().includes("bc_results_upsert_many"));
      assert.equal(sql("select count(*) from battlecal.results r join battlecal.profiles p on p.id = r.profile_id where p.name = 'ZZ-Zwei' and r.deleted_at is null and r.id like 'alt-%'"), "2");
      await page.click("#cloudProfileCloseBtn");
      await menu("#clearHistoryBtn"); await toast(/Historie gelöscht/); await page.waitForTimeout(500);
      assert.ok(rpcs().includes("bc_results_clear"));
      assert.equal(sql("select count(*) from battlecal.results r join battlecal.profiles p on p.id = r.profile_id where p.name = 'ZZ-Zwei' and r.deleted_at is null"), "0");
      await menu("#armyEditorOpenBtn"); await page.fill("#armyEditorRosterName", "ZZ Handarmee");
      await page.click("#armyEditorCreateRosterBtn"); await toast(/Armee angelegt/);
      assert.ok(rpcs().includes("bc_roster_upsert"));
      assert.equal(sql("select count(*) from battlecal.army_rosters where name = 'ZZ Handarmee' and deleted_at is null"), "1");
      await page.click("#armyEditorCloseBtn");
      assert.ok(!(await storageDump()).includes(PW));
    });
    await step("Profil ohne Passwort (wie importiertes Profil): Speichern ohne Abfrage, Umbenennen ohne Abfrage, Passwort setzen, danach Abfrage", async () => {
      const id = sql("insert into battlecal.profiles (name, password_hash) values ('ZZ-OhnePW', null) returning id").split("\n")[0];
      await page.reload(); await page.waitForTimeout(600);
      await menu("#cloudProfileOpenBtn");
      await page.selectOption("#cloudProfileSelect", id); await page.waitForTimeout(600);
      assert.equal((await page.textContent("#cloudProfilePasswordBtn")).trim(), "Passwort setzen");
      await page.click("#cloudProfileCloseBtn");
      const before = sql(`select count(*) from battlecal.results where profile_id = '${id}' and deleted_at is null`);
      await page.evaluate(() => document.getElementById("calculatorForm").requestSubmit()); await page.waitForTimeout(900);
      assert.equal(await page.isVisible("#bcPasswordInput"), false, "keine Passwortabfrage ohne Passwort");
      assert.equal(Number(sql(`select count(*) from battlecal.results where profile_id = '${id}' and deleted_at is null`)), Number(before) + 1);
      promptAnswer = "ZZ-OhnePW-neu";
      await menu("#cloudProfileOpenBtn"); await page.click("#cloudProfileRenameBtn"); await toast(/umbenannt/);
      assert.equal(await page.isVisible("#bcPasswordInput"), false);
      assert.equal(sql(`select name from battlecal.profiles where id = '${id}'`), "ZZ-OhnePW-neu");
      // Passwort setzen (frei, da keins gesetzt), zweimal eingeben
      await page.click("#cloudProfilePasswordBtn");
      await page.waitForSelector("#bcPasswordInput"); await enterPassword("zz-neu-pw"); await page.waitForTimeout(150);
      await page.waitForSelector("#bcPasswordInput"); await enterPassword("zz-neu-pw");
      await toast(/Passwort gesetzt/);
      assert.equal(sql(`select (password_hash like '$2%')::text from battlecal.profiles where id = '${id}'`), "true");
      assert.equal((await page.textContent("#cloudProfilePasswordBtn")).trim(), "Passwort ändern");
      assert.ok(!(await storageDump()).includes("zz-neu-pw"), "neues Passwort nicht im Browser-Speicher");
      await page.click("#cloudProfileCloseBtn");
      // nach Neuladen fragt Speichern wieder nach dem Passwort
      await page.reload(); await page.waitForTimeout(600);
      await page.evaluate(() => document.getElementById("calculatorForm").requestSubmit());
      await page.waitForSelector("#bcPasswordInput"); await enterPassword("zz-neu-pw"); await page.waitForTimeout(900);
      assert.equal(Number(sql(`select count(*) from battlecal.results where profile_id = '${id}' and deleted_at is null`)), Number(before) + 2);
      // Aendern nach Neuladen: altes Passwort wird abgefragt; falsches abgelehnt, richtiges aendert
      const changePw = async (oldPw, nextPw) => {
        await page.click("#cloudProfilePasswordBtn");
        for (const v of [oldPw, nextPw, nextPw]) { await page.waitForSelector("#bcPasswordInput"); await enterPassword(v); await page.waitForTimeout(150); }
      };
      await page.reload(); await page.waitForTimeout(600); await menu("#cloudProfileOpenBtn");
      const hash1 = sql(`select password_hash from battlecal.profiles where id = '${id}'`);
      await changePw("falsch", "zz-pw-2"); await toast(/Passwort ist falsch/);
      assert.equal(sql(`select password_hash from battlecal.profiles where id = '${id}'`), hash1);
      await changePw("zz-neu-pw", "zz-pw-2"); await toast(/Passwort geändert/);
      assert.notEqual(sql(`select password_hash from battlecal.profiles where id = '${id}'`), hash1);
      assert.ok(!(await storageDump()).includes("zz-pw-2"));
      // Peppers Fall (ohne Neuladen, Passwort gemerkt): altes Passwort wird trotzdem abgefragt, falsches abgelehnt
      const hash2 = sql(`select password_hash from battlecal.profiles where id = '${id}'`);
      await changePw("falsch-123", "zz-pw-3"); await toast(/Passwort ist falsch/);
      assert.equal(sql(`select password_hash from battlecal.profiles where id = '${id}'`), hash2, "falsches altes Passwort aendert nichts");
      await page.click("#cloudProfileCloseBtn");
      // gemerktes Sitzungs-Passwort bleibt gueltig: Speichern ohne erneute Abfrage
      await page.evaluate(() => document.getElementById("calculatorForm").requestSubmit()); await page.waitForTimeout(900);
      assert.equal(await page.locator("#bcPasswordInput").count(), 0, "keine Abfrage nach falschem Aendern-Versuch");
      assert.equal(Number(sql(`select count(*) from battlecal.results where profile_id = '${id}' and deleted_at is null`)), Number(before) + 3);
    });
    await step("Match-Tracker-Huelle: #/battle-cal bettet /battle-cal/ ein (nur mit Schalter)", async () => {
      const p3 = await ctx.newPage(); p3.setDefaultTimeout(8000);
      await p3.goto(`${APP}/?battlecal=0#/battle-cal`); await p3.waitForTimeout(800);
      assert.equal(await p3.locator("iframe.battle-cal-frame").count(), 0);
      await p3.goto(`${APP}/?battlecal=1#/battle-cal`); await p3.waitForSelector("iframe.battle-cal-frame");
      const frame = p3.frameLocator("iframe.battle-cal-frame");
      await frame.locator("#calculatorForm").waitFor();
      assert.equal(await frame.locator("#bcStandaloneBar").isHidden(), true);
      await p3.close();
    });
    await step("Nur bc_*-RPCs, nie direkter Tabellenzugriff, nichts ausserhalb von localhost", async () => {
      const nonRpc = mock.log.filter((l) => !l.rpc);
      assert.ok(nonRpc.every((l) => !/battle_|army_|battlecal|profiles|results/.test(l.path)), JSON.stringify(nonRpc));
      // mt_* stammen von der Match-Tracker-Huelle (letzter Schritt); Battle-Cal selbst ruft nur bc_* auf.
      const rpcCalls = mock.log.filter((l) => l.rpc);
      assert.ok(rpcCalls.every((l) => /^(bc|mt)_/.test(l.rpc) && l.apikey), rpcCalls.map((l) => l.rpc).join(","));
      const firstShell = mock.log.findIndex((l) => /^mt_/.test(l.rpc || "") || /\/rest\/v1\/(games|events)|\/realtime\//.test(l.path));
      assert.ok(firstShell === -1 || mock.log.slice(0, firstShell).every((l) => /^bc_/.test(l.rpc || "")), "vor der Huelle nur bc_*: " + JSON.stringify(mock.log.slice(0, firstShell).filter((l) => !/^bc_/.test(l.rpc || "")).map((l) => [l.method, l.path, l.rpc])));
      assert.equal(blocked.filter((u) => /qznocdybgwzsbovgmesi|rgvpxnmbuyxqplsfonzm/.test(u)).length, 0, "kein Aufruf echter Projekte");
      assert.deepEqual(errors, [], errors.join("\n"));
      const used = [...new Set(rpcs())].sort();
      console.log(`      RPCs genutzt: ${used.join(", ")}`);
    });
    await ctx.close();
  } finally {
    await browser.close(); await web.close(); await old.close(); await mock.close();
    try { psql("postgres", "-c", `drop database if exists ${DB}`); } catch {}
  }
  console.log(`Battle-Cal E2E: ${results.length} Schritte OK`);
};

run().catch((e) => { console.error(e); process.exit(1); });
