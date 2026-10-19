// Battle-Cal Basis: Schalter (Standard AUS), Route, Menueeintrag nur im Hauptmenue; SQL-Migration statisch + optional lokal.
const assert = require("node:assert/strict");
const fs = require("node:fs"); const path = require("node:path"); const { execFileSync } = require("node:child_process");
const { loadBrowserModule } = require("./helpers/loadBrowserModule.cjs");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

const runBattleCalTests = () => {
  const keep = Object.fromEntries(["window"].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  try {
    const data = new Map();
    globalThis.window = { location: { hash: "#/games", search: "" },
      localStorage: { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) } };
    const f = loadBrowserModule("src/utils/battleCalFeature.ts");
    // Standard (Stufe E): AN ohne gespeicherten Wert -> Menueeintrag
    f.syncBattleCalFlagFromUrl();
    assert.equal(f.isBattleCalEnabled(), true, "Standard AN");
    assert.deepEqual(f.getBattleCalMenuItems().map((i) => i.label), ["Battle-Cal"], "Standard AN = Menueeintrag");
    // Ausschalten per 0 (Hash), bleibt gemerkt; kein Menueeintrag
    window.location.hash = "#/games?battlecal=0"; f.syncBattleCalFlagFromUrl();
    assert.equal(f.isBattleCalEnabled(), false); assert.equal(data.get("match-tracker.feature.battle-cal"), "0");
    window.location.hash = "#/games"; f.syncBattleCalFlagFromUrl(); assert.equal(f.isBattleCalEnabled(), false, "AUS bleibt gemerkt");
    assert.deepEqual(f.getBattleCalMenuItems(), [], "Schalter aus = kein Menueeintrag");
    // Wieder einschalten per Query (Hash oder Suche)
    window.location.hash = "#/games?battlecal=1"; f.syncBattleCalFlagFromUrl();
    assert.equal(f.isBattleCalEnabled(), true);
    const items = f.getBattleCalMenuItems();
    assert.deepEqual(items.map((i) => i.label), ["Battle-Cal"]);
    items[0].onClick(); assert.equal(window.location.hash, "/battle-cal");
    window.location.hash = "#/games"; f.syncBattleCalFlagFromUrl(); assert.equal(f.isBattleCalEnabled(), true, "bleibt gemerkt");
    window.location.search = "?battlecal=0"; f.syncBattleCalFlagFromUrl(); assert.equal(f.isBattleCalEnabled(), false);
    window.location.search = "?battlecal=1"; f.syncBattleCalFlagFromUrl(); assert.equal(f.isBattleCalEnabled(), true);
    window.location.search = "";
    // ohne localStorage (privat/gesperrt): AN
    data.clear(); assert.equal(f.isBattleCalEnabled(), true);
  } finally {
    for (const [k, d] of Object.entries(keep)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
  }
  // Route nur mit Schalter; Menueeintrag nur in den Hauptmenues; Spielmenue/TV unveraendert
  const app = read("src/App.tsx");
  assert.match(app, /normalized === BATTLE_CAL_ROUTE && isBattleCalEnabled\(\)/);
  for (const page of ["GamesPage", "StatsPage"]) assert.match(read(`src/pages/${page}.tsx`), /\.\.\.getBattleCalMenuItems\(\)/, page);
  assert.doesNotMatch(read("src/pages/GamePage.tsx"), /BattleCal|battle-cal/i, "Spielmenue/TV unveraendert");
  const page = read("src/pages/BattleCalPage.tsx");
  assert.doesNotMatch(page, /supabase|fetch\(|rest\/v1/i, "Seite selbst ohne Datenaufrufe");
  assert.match(page, /<iframe[\s\S]*src=\{BATTLE_CAL_APP_URL\}/);
  assert.doesNotMatch(page, /FloatingMenu|actions=/, "UX A: kein zweites ☰ (Match-Tracker-Menue) auf der Battle-Cal-Seite");
  assert.match(page, /onBack=\{onBack\}/, "UX A: Zurück bleibt"); assert.match(page, /BATTLE_CAL_APP_URL = "\/battle-cal\/"/);

  // D2: Battle-Cal-App (statische Seite) nur ueber public.bc_*; kein Klartext-Passwort im Browser-Speicher
  const bc = read("src/battle-cal/battle-cal.html");
  assert.doesNotMatch(bc, /supabaseRequest|battle_profiles|battle_results|\/rest\/v1\/(?!rpc\/)/, "kein direkter Tabellenzugriff");
  assert.equal((bc.match(/\bfetch\(/g) || []).length, 1, "genau ein fetch (bcRpc)");
  assert.match(bc, /fetch\(`\$\{SUPABASE_URL\}\/rest\/v1\/rpc\/\$\{name\}`/);
  assert.match(bc, /if \(!\/\^bc_\[a-z_\]\+\$\/\.test\(name\)\)/, "nur bc_* aufrufbar");
  assert.doesNotMatch(bc, /rgvpxnmbuyxqplsfonzm|sb_publishable_|delete_password|storedPassword/, "altes Projekt/Key/Client-Passwortpruefung entfernt");
  assert.match(bc, /const SUPABASE_URL = "__BC_SUPABASE_URL__";/); assert.match(bc, /const SUPABASE_KEY = "__BC_SUPABASE_KEY__";/);
  assert.doesNotMatch(bc, /sessionStorage\.setItem|localStorage\.setItem\([^)]*[Pp]assword/, "Passwort nie im Browser-Speicher");
  assert.match(bc, /localStorage\.setItem\(CLOUD_PROFILE_KEY, JSON\.stringify\(publicProfile\(cloudProfile\)\)\)/);
  assert.match(bc, /return \{ id: String\(profile\.id\), name: String\(profile\.name \|\| ""\), created_at: profile\.created_at \|\| null, has_password: profile\.has_password !== false \};/);
  assert.match(bc, /window\.__BC_ENABLED = localStorage\.getItem\(KEY\) !== "0"/, "gleicher Schalter wie die App (Standard AN)");
  assert.match(bc, /else if \(q === "0"\) localStorage\.setItem\(KEY, "0"\)/, "?battlecal=0 schaltet aus (gemerkt)");
  assert.match(bc, /const KEY = "match-tracker\.feature\.battle-cal";/);
  const sqlAll = read("supabase/migrations/20261019_01_battlecal_basis.sql") + read("supabase/migrations/20261019_02_battlecal_app.sql") + read("supabase/migrations/20261019_03_battlecal_ohne_passwort.sql");
  const used = [...new Set([...bc.matchAll(/bcRpc\("(bc_[a-z_]+)"/g)].map((m) => m[1]))];
  assert.ok(used.length >= 18, `bc-RPCs in der App: ${used.length}`);
  for (const name of used) assert.match(sqlAll, new RegExp(`create or replace function public\\.${name}\\(`), `${name} existiert`);
  assert.match(bc, /UMZUG_SOURCE_ORIGINS = \["https:\/\/battle-cal\.netlify\.app"\]/, "Umzug nur von der alten Origin");
  assert.match(bc, /function sanitizeCompareHtml/);
  // Profile ohne Passwort (Migration 03): keine Abfrage beim Speichern, Passwort setzen/aendern
  assert.match(bc, /if \(!profileHasPassword\(cloudProfile\)\) return "";/);
  assert.match(bc, /has_password: profile\.has_password !== false/);
  assert.match(bc, /bcRpc\("bc_profile_set_password", \{ p_profile_id: cloudProfile\.id, p_password: oldPassword, p_new_password: nextPassword \}\)/);
  assert.match(bc, /id="cloudProfilePasswordBtn">Passwort setzen</);
  // UX B: eingebettet durchsichtig und bis zum Fensterrand (nur mit Schalter, nur gleiche Origin ueber frameElement)
  assert.match(bc, /if \(!window\.__BC_EMBEDDED \|\| !window\.__BC_ENABLED\) return;/);
  assert.match(bc, /document\.body\.style\.background = "transparent";/);
  assert.match(bc, /frame\.style\.height = `\$\{Math\.max\(320, Math\.floor\(host\.innerHeight - top - 12\)\)\}px`;/);
  assert.match(bc, /host\.removeEventListener\("resize", fit\)/);
  const vite = read("vite.config.mjs");
  assert.match(vite, /fileName: "battle-cal\/index\.html"/); assert.match(vite, /VITE_SUPABASE_PUBLISHABLE_KEY/);
  // UX C: Match-Tracker-Titel auf der Battle-Cal-Seite nur optisch ausgeblendet
  assert.match(read("src/styles/index.css"), /body:has\(iframe\.battle-cal-frame\) \.app-header \.header-title-row h1 \{[^}]*clip: rect\(0 0 0 0\);/);
  // Umzugsseite (alte Site): nur an die Match-Tracker-Origin, nie das alte Passwort
  const umzug = read("tools/battle-cal/umzug/umzug.html");
  assert.match(umzug, /PROD_TARGET = "https:\/\/40k-match-tracker\.netlify\.app\/battle-cal\/\?umzug=1"/);
  assert.match(umzug, /postMessage\(\{ type: "bc-umzug-data", payload: buildPayload\(\) \}, targetOrigin\)/);
  assert.doesNotMatch(umzug, /postMessage\([^)]*"\*"\)/, "nie an beliebige Origin");
  assert.match(umzug, /cloudProfile: profile && profile\.id \? \{ id: String\(profile\.id\), name: String\(profile\.name \|\| ""\) \}/);

  // Migration 02: gleiche Regeln
  const sql2 = read("supabase/migrations/20261019_02_battlecal_app.sql").replace(/--.*$/gm, "");
  assert.doesNotMatch(sql2, /alter publication|supabase_realtime|pgrst|db_schemas|create policy|public\.(games|events)\b|function public\.mt_/i);
  assert.doesNotMatch(sql2, /grant [^;]* on (all )?tables?[^;]* to (anon|authenticated)/i);
  for (const name of ["bc_roster_import", "bc_results_upsert_many"]) {
    const m = sql2.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?end \\$\\$;`)); assert.ok(m, name);
    assert.match(m[0], /security definer set search_path = battlecal/); assert.match(m[0], /require_profile\(p_profile_id, p_password, false\)/);
  }
  assert.match(read("supabase/migrations/20261019_02_battlecal_app.rollback.sql"), /drop function if exists public\.bc_roster_import/);
  // Migration 03: Profile ohne Passwort + Passwort setzen (nur bcrypt, nie Klartext gespeichert/ausgegeben)
  const m3 = read("supabase/migrations/20261019_03_battlecal_ohne_passwort.sql");
  assert.match(m3, /alter column password_hash drop not null/); assert.match(m3, /set password_hash = null where password_hash = '!'/);
  assert.match(m3, /if p\.password_hash is null then return p; end if;/);
  assert.match(m3, /function public\.bc_profile_set_password\(p_profile_id uuid, p_password text, p_new_password text\)/);
  assert.match(m3, /password_hash = extensions\.crypt\(p_new_password, extensions\.gen_salt\('bf'\)\)/);
  assert.match(m3, /'has_password', p\.password_hash is not null/);
  assert.doesNotMatch(m3.replace(/--.*$/gm, ""), /games|events|mt_|publication|raise notice/i, "Migration 03 fasst nur battlecal/bc_* an");
  // Passwort aendern: altes Passwort immer neu abfragen, nie das gemerkte Sitzungs-Passwort als Ersatz (Peppers Retest PR #35)
  for (const [name, src] of [["battle-cal.html", bc], ["patch-original.py", read("tools/battle-cal/patch-original.py")]]) {
    const fn = src.slice(src.indexOf("async function setCloudProfilePassword()"), src.indexOf("async function", src.indexOf("async function setCloudProfilePassword()") + 10));
    assert.ok(fn.length > 200, `${name}: setCloudProfilePassword gefunden`);
    assert.doesNotMatch(fn, /oldPassword\s*=\s*cloudProfilePassword\s*\|\|/, `${name}: altes Passwort nicht aus cloudProfilePassword`);
    assert.doesNotMatch(fn, /cloudProfilePassword\s*\|\|/, `${name}: kein cloudProfilePassword-Ersatz`);
    assert.match(fn, /oldPassword = await requestPassword\(/, `${name}: altes Passwort wird abgefragt`);
    assert.doesNotMatch(fn.slice(fn.indexOf("catch (error)")), /cloudProfilePassword\s*=/, `${name}: Fehler ueberschreibt/leert gemerktes Passwort nicht`);
  }
  const rb3 = read("supabase/migrations/20261019_03_battlecal_ohne_passwort.rollback.sql");
  assert.match(rb3, /drop function if exists public\.bc_profile_set_password/); assert.match(rb3, /set password_hash = '!' where password_hash is null/);

  // SQL: statische Regeln
  const sql = read("supabase/migrations/20261019_01_battlecal_basis.sql").replace(/--.*$/gm, ""); // nur Code, ohne Kommentare
  assert.doesNotMatch(sql, /alter publication|supabase_realtime/i, "Realtime-Publikation unveraendert");
  assert.doesNotMatch(sql, /pgrst|db_schemas|exposed/i, "keine PostgREST-Einstellung (Schema nicht freigegeben)");
  assert.doesNotMatch(sql, /public\.(games|events)\b|function public\.mt_/i, "Match-Tracker-Tabellen/mt_* nicht angefasst");
  assert.doesNotMatch(sql, /create policy/i, "keine RLS-Freigaben");
  assert.doesNotMatch(sql, /grant [^;]* on (all )?tables?[^;]* to (anon|authenticated)/i, "keine Tabellenrechte fuer anon");
  assert.doesNotMatch(sql, /\$2[aby]\$/, "kein Passwort-Hash im Repo");
  const fns = sql.split(/(?=create or replace function )/).map((chunk) => [chunk, (chunk.match(/^create or replace function public\.(bc_\w+)\(/) || [])[1]])
    .filter(([, n]) => n);
  assert.ok(fns.length >= 15, `bc_* Funktionen: ${fns.length}`);
  for (const [body, name] of fns) {
    assert.match(body, /security definer/, `${name}: security definer`);
    assert.match(body, /set search_path = battlecal/, `${name}: fester search_path`);
  }
  for (const w of ["bc_result_upsert", "bc_result_delete", "bc_results_clear", "bc_profile_rename", "bc_profile_delete", "bc_roster_upsert", "bc_unit_upsert", "bc_weapon_upsert"]) {
    const m = fns.find(([, n]) => n === w); assert.ok(m, w);
    assert.match(m[0], /require_profile|require_roster_write/, `${w}: Passwortpruefung`);
  }
  assert.match(sql, /crypt\(p_password, extensions\.gen_salt\('bf'\)\)/, "bcrypt per pgcrypto");
  assert.match(read("supabase/migrations/20261019_01_battlecal_basis.rollback.sql"), /drop schema if exists battlecal cascade/);

  // Optional: echter Lauf gegen lokales Test-Postgres (BC_LOCAL_PG="-h /tmp -p 54329"), nie gegen die Live-DB.
  const local = process.env.BC_LOCAL_PG;
  if (local) {
    const args = [...local.split(" "), "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q"];
    const psql = (...a) => execFileSync("psql", [...args, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    psql("-c", "drop database if exists bctest_ci"); psql("-c", "create database bctest_ci");
    const db = ["-d", "bctest_ci"];
    psql(...db, "-f", path.join(__dirname, "../supabase/tests/battlecal_local_stubs.sql"));
    psql(...db, "-f", path.join(__dirname, "../supabase/migrations/20261019_01_battlecal_basis.sql"));
    psql(...db, "-f", path.join(__dirname, "../supabase/migrations/20261019_01_battlecal_basis.sql"));
    const out = execFileSync("psql", [...args, ...db, "-f", path.join(__dirname, "../supabase/tests/battlecal_local_test.sql")], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    // Migration 02 (zweimal = idempotent), App-Tests, Rollback 02 (lange IDs vorhanden -> Grenzen bleiben, Funktionen weg)
    psql(...db, "-c", "truncate battlecal.army_weapons, battlecal.army_units, battlecal.army_rosters, battlecal.results, battlecal.profiles");
    psql(...db, "-f", path.join(__dirname, "../supabase/migrations/20261019_02_battlecal_app.sql"));
    psql(...db, "-f", path.join(__dirname, "../supabase/migrations/20261019_02_battlecal_app.sql"));
    psql(...db, "-f", path.join(__dirname, "../supabase/tests/battlecal_app_local_test.sql"));
    psql(...db, "-c", "truncate battlecal.army_weapons, battlecal.army_units, battlecal.army_rosters, battlecal.results, battlecal.profiles");
    // Migration 03 (Profile ohne Passwort): Import-Zustand mit Sperrwert '!' nachbilden, 03 zweimal, Tests, Rollback 03
    psql(...db, "-c", "insert into battlecal.profiles (name, password_hash) values ('ZZ-Import', '!')");
    psql(...db, "-f", path.join(__dirname, "../supabase/migrations/20261019_03_battlecal_ohne_passwort.sql"));
    psql(...db, "-f", path.join(__dirname, "../supabase/migrations/20261019_03_battlecal_ohne_passwort.sql"));
    psql(...db, "-f", path.join(__dirname, "../supabase/tests/battlecal_nopw_local_test.sql"));
    psql(...db, "-c", "insert into battlecal.profiles (name, password_hash) values ('ZZ-Null', null)");
    psql(...db, "-f", path.join(__dirname, "../supabase/migrations/20261019_03_battlecal_ohne_passwort.rollback.sql"));
    assert.equal(psql(...db, "-Atc", "select password_hash from battlecal.profiles where name='ZZ-Null'").trim(), "!", "Rollback 03: ohne Passwort -> Sperrwert");
    assert.equal(psql(...db, "-Atc", "select attnotnull from pg_attribute where attrelid='battlecal.profiles'::regclass and attname='password_hash'").trim(), "t");
    assert.equal(psql(...db, "-Atc", "select count(*) from pg_proc where proname='bc_profile_set_password'").trim(), "0");
    psql(...db, "-c", "truncate battlecal.army_weapons, battlecal.army_units, battlecal.army_rosters, battlecal.results, battlecal.profiles");
    psql(...db, "-f", path.join(__dirname, "../supabase/migrations/20261019_02_battlecal_app.rollback.sql"));
    assert.equal(psql(...db, "-Atc", "select count(*) from pg_proc where proname in ('bc_roster_import','bc_results_upsert_many')").trim(), "0");
    psql(...db, "-f", path.join(__dirname, "../supabase/migrations/20261019_01_battlecal_basis.rollback.sql"));
    assert.equal(psql(...db, "-Atc", "select count(*) from pg_namespace where nspname='battlecal'").trim(), "0");
    psql("-c", "drop database bctest_ci");
    void out;
  }
};
module.exports = { runBattleCalTests };
