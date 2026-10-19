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
    // Standard: AUS -> kein Menueeintrag
    f.syncBattleCalFlagFromUrl();
    assert.equal(f.isBattleCalEnabled(), false);
    assert.deepEqual(f.getBattleCalMenuItems(), [], "Schalter aus = kein Menueeintrag");
    // Einschalten per Query (Hash oder Suche), Ausschalten per 0
    window.location.hash = "#/games?battlecal=1"; f.syncBattleCalFlagFromUrl();
    assert.equal(f.isBattleCalEnabled(), true);
    const items = f.getBattleCalMenuItems();
    assert.deepEqual(items.map((i) => i.label), ["Battle-Cal"]);
    items[0].onClick(); assert.equal(window.location.hash, "/battle-cal");
    window.location.hash = "#/games"; f.syncBattleCalFlagFromUrl(); assert.equal(f.isBattleCalEnabled(), true, "bleibt gemerkt");
    window.location.search = "?battlecal=0"; f.syncBattleCalFlagFromUrl(); assert.equal(f.isBattleCalEnabled(), false);
    window.location.search = "";
  } finally {
    for (const [k, d] of Object.entries(keep)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
  }
  // Route nur mit Schalter; Menueeintrag nur in den Hauptmenues; Spielmenue/TV unveraendert
  const app = read("src/App.tsx");
  assert.match(app, /normalized === BATTLE_CAL_ROUTE && isBattleCalEnabled\(\)/);
  for (const page of ["GamesPage", "StatsPage"]) assert.match(read(`src/pages/${page}.tsx`), /\.\.\.getBattleCalMenuItems\(\)/, page);
  assert.doesNotMatch(read("src/pages/GamePage.tsx"), /BattleCal|battle-cal/i, "Spielmenue/TV unveraendert");
  assert.doesNotMatch(read("src/pages/BattleCalPage.tsx"), /supabase|fetch\(|rest\/v1/i, "Platzhalter ohne Datenaufrufe");

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
    psql(...db, "-f", path.join(__dirname, "../supabase/migrations/20261019_01_battlecal_basis.rollback.sql"));
    assert.equal(psql(...db, "-Atc", "select count(*) from pg_namespace where nspname='battlecal'").trim(), "0");
    psql("-c", "drop database bctest_ci");
    void out;
  }
};
module.exports = { runBattleCalTests };
