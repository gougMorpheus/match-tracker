const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const access = require("../.test-dist/utils/dashboardAccess.js");

const memory = () => {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); }
  };
};

const runDashboardAccessTests = async () => {
  try {
    assert.equal(access.MATCH_TRACKER_APP_SLUG, "match-tracker");
    assert.equal(access.DASHBOARD_HOME_URL, "https://bfg-projekte-uebersicht.netlify.app/");
    assert.equal(access.classifyDashboardConfig("", ""), "off");
    assert.equal(access.classifyDashboardConfig("https://example.supabase.co", ""), "incomplete");
    assert.equal(access.classifyDashboardConfig("", "sb_publishable_test"), "incomplete");
    assert.equal(access.classifyDashboardConfig(" https://example.supabase.co ", " sb_publishable_test "), "ready");

    assert.deepEqual(
      ["admin", "bearbeiten", "ansehen", null].map((role) => access.accessScreenForRole(true, role)),
      ["edit", "edit", "view", "no-access"]
    );
    assert.equal(access.accessScreenForRole(false, null), "login");
    assert.equal(access.accessScreenForRole(false, "admin"), "login");
    assert.equal(access.roleAllowsEdit("ansehen"), false);
    assert.equal(access.roleAllowsEdit("bearbeiten"), true);
    assert.equal(access.roleAllowsEdit("admin"), true);
    assert.equal(access.readAppRoleResult(null).role, null);
    assert.equal(access.readAppRoleResult(" ansehen ").role, "ansehen");
    assert.equal(access.readAppRoleResult("superuser").ok, false);
    assert.equal(access.readAppRoleResult({ rolle: "admin" }).ok, false);

    assert.equal(access.dashboardLoginErrorMessage({ code: "invalid_credentials" }), "E-Mail-Adresse oder Passwort ist falsch.");
    assert.match(access.dashboardLoginErrorMessage({ name: "AuthRetryableFetchError", message: "Failed to fetch" }), /nicht erreichbar/);
    assert.equal(access.hashHasAuthTokens("#/game/abc"), false);
    assert.equal(access.hashHasAuthTokens("#access_token=a&refresh_token=b"), true);
    assert.equal(access.appHashAfterAuth("#access_token=a&refresh_token=b"), "#/games");
    assert.equal(access.appHashAfterAuth("#/games"), null);

    const store = memory();
    let fetches = 0;
    const fetchRole = () => {
      fetches += 1;
      return Promise.resolve("ansehen");
    };
    const first = access.loadDashboardRoleOnce("user-1", store, fetchRole);
    const second = access.loadDashboardRoleOnce("user-1", store, fetchRole);
    assert.equal(await first, "ansehen");
    assert.equal(await second, "ansehen");
    assert.equal(fetches, 1, "paralleler Abruf nur einmal");
    assert.equal(await access.loadDashboardRoleOnce("user-1", store, fetchRole), "ansehen");
    assert.equal(fetches, 1, "Cache in der Sitzung, kein zweiter Abruf");
    assert.equal(await access.loadDashboardRoleOnce("user-2", store, () => Promise.resolve(null)), null);
    assert.equal(fetches, 1);
    assert.equal(await access.loadDashboardRoleOnce("user-2", store, () => Promise.resolve("admin")), null, "gemerktes null bleibt");

    const broken = memory();
    await assert.rejects(access.loadDashboardRoleOnce("user-3", broken, () => Promise.resolve("owner")));
    assert.equal(broken.getItem(access.DASHBOARD_ROLE_CACHE_KEY), null);
    assert.equal(await access.loadDashboardRoleOnce("user-3", broken, () => Promise.resolve("bearbeiten")), "bearbeiten");

    access.setSessionWriteGate("view");
    assert.equal(access.isSessionWriteBlocked(), true);
    access.setSessionWriteGate("edit");
    assert.equal(access.isSessionWriteBlocked(), false);
    access.setSessionWriteGate("legacy");
    assert.equal(access.isSessionWriteBlocked(), false);

    const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    const client = read("src/lib/dashboardClient.ts");
    const gate = read("src/components/DashboardAuthGate.tsx");
    const storeSrc = read("src/store/GameStore.tsx");
    assert.match(client, /schema\("dashboard"\)\.rpc\("my_app_role"/);
    assert.match(client, /p_app_slug: MATCH_TRACKER_APP_SLUG/);
    assert.doesNotMatch(client, /admin_|app_access|\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
    assert.doesNotMatch(gate, />Ansehen<|>Bearbeiten<|>Admin</);
    assert.match(gate, /Kein Zugang/);
    assert.match(gate, /href=\{DASHBOARD_HOME_URL\}/);
    assert.match(storeSrc, /isSessionWriteBlocked\(\)/);
    assert.match(read("src/pages/GamePage.tsx"), /setReopenPasswordError\("Falsches Passwort\."\)/);
    assert.match(read("src/utils/gameSecurity.ts"), /GAME_ADMIN_PASSWORD = "110326"/);
  } finally {
    access.setSessionWriteGate("legacy");
    access.clearDashboardRoleMemory();
  }
};

module.exports = { runDashboardAccessTests };
