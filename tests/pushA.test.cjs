const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const f = require("../.test-dist/utils/pushFollow.js");
const s = require("../.test-dist/utils/pushSupport.js");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const memoryStorage = () => { const data = {}; return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } }; };

const runPushATests = () => {
  // Folge-Logik pro Geraet, device_id als UUID, persistent.
  const storage = memoryStorage();
  const first = f.loadPushFollowSettings(storage);
  assert.match(first.deviceId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(f.loadPushFollowSettings(storage).deviceId, first.deviceId, "device_id bleibt gleich");
  assert.equal(first.schema, 1);
  let st = f.setGameFollowed(first, "g1", true, "2026-10-15T10:00:00Z");
  assert.equal(f.isFollowingGame(st, "g1"), true);
  assert.equal(st.follows.g1.source, "manual");
  st = f.toggleGameFollowed(st, "g1", "2026-10-15T10:01:00Z");
  assert.equal(f.isFollowingGame(st, "g1"), false);
  assert.ok(st.unfollowed.g1, "entfolgt wird gemerkt");
  f.savePushFollowSettings(storage, st);
  assert.deepEqual(f.loadPushFollowSettings(storage), st, "Speichern/Laden verlustfrei");
  assert.equal(f.parsePushFollowSettings("kaputt"), null);
  assert.equal(f.parsePushFollowSettings(JSON.stringify({ schema: 2, deviceId: "x" })), null);

  // Auto-Folgen: nur nach dem Einschalten angelegte Spiele, nicht bewusst entfolgte.
  let auto = f.setAutoFollowNew(f.createPushFollowSettings("dev", "2026-10-15T09:00:00Z"), true, "2026-10-15T12:00:00Z");
  assert.equal(auto.autoFollowSince, "2026-10-15T12:00:00Z");
  const games = [
    { id: "alt", createdAt: "2026-10-14T10:00:00Z" },
    { id: "neu", createdAt: "2026-10-15T12:30:00Z" },
    { id: "neu-entfolgt", createdAt: "2026-10-15T12:31:00Z" }
  ];
  auto = f.setGameFollowed(auto, "neu-entfolgt", false, "2026-10-15T12:32:00Z");
  const applied = f.applyAutoFollow(auto, games, "2026-10-15T12:40:00Z");
  assert.deepEqual(Object.keys(applied.follows), ["neu"]);
  assert.equal(applied.follows.neu.source, "auto");
  assert.equal(f.applyAutoFollow(applied, games), applied, "keine Aenderung => gleiches Objekt (kein Speichern)");
  const off = f.setAutoFollowNew(applied, false);
  assert.equal(off.autoFollowSince, null);
  assert.equal(f.applyAutoFollow(off, [{ id: "spaet", createdAt: "2030-01-01T00:00:00Z" }]), off);
  assert.deepEqual(f.getFollowedGameIds(f.setGameFollowed(applied, "x", true, "2026-10-15T13:00:00Z")), ["x", "neu"]);

  // Hinweis-Logik je Umgebung.
  const env = (o = {}) => ({ hasServiceWorker: true, hasPushManager: true, hasNotification: true, permission: "default", isIos: false, isStandalone: false, isSecureContext: true, ...o });
  assert.equal(s.getPushStatus(env({ isIos: true })), "ios-install");
  assert.equal(s.getPushStatus(env({ isIos: true, isStandalone: true })), "ask");
  assert.equal(s.getPushStatus(env({ hasPushManager: false })), "unsupported");
  assert.equal(s.getPushStatus(env({ hasNotification: false, permission: "unsupported" })), "unsupported");
  assert.equal(s.getPushStatus(env({ isSecureContext: false })), "insecure");
  assert.equal(s.getPushStatus(env({ permission: "denied" })), "denied");
  assert.equal(s.getPushStatus(env({ permission: "granted" })), "granted");
  assert.equal(s.getPushStatus(env()), "ask");
  assert.match(s.getPushHint("ios-install").lines.join(" "), /Zum Home-Bildschirm/);
  assert.match(s.getPushHint("denied").lines.join(" "), /Zulassen/);
  assert.match(s.getPushHint("denied", true).lines.join(" "), /Einstellungen → Mitteilungen/);
  assert.equal(s.getPushHint("ask").canRequestPermission, true);
  assert.equal(s.getPushHint("ios-install").canRequestPermission, false);
  for (const status of ["ios-install", "unsupported", "insecure", "denied", "ask", "granted"]) {
    assert.match(s.getPushHint(status).lines.join(" "), /Notifications kommen bald/, `ehrlich: ${status}`);
  }
  assert.equal(s.PUSH_DELIVERY_AVAILABLE, false);
  // Umbenennung 15.10.: "Notifications" statt "Benachrichtigungen" (nur der Browser-Einstellungsname bleibt).
  for (const file of ["src/components/NotificationsCenter.tsx", "src/pages/GamePage.tsx", "src/pages/StatsPage.tsx", "src/pages/GamesPage.tsx", "src/utils/gameAccessMode.ts"]) {
    assert.doesNotMatch(read(file), /Benachrichtigungen/, file);
  }
  assert.equal((read("src/utils/pushSupport.ts").match(/Benachrichtigungen/g) || []).length, 1);

  // Kein Fake-Abo: kein pushManager.subscribe im Client.
  for (const file of ["src/components/NotificationsCenter.tsx", "src/pwa/registerServiceWorker.ts", "src/pwa/pushFollowStore.ts"]) {
    assert.doesNotMatch(read(file), /pushManager|subscribe\(\{/i, file);
  }

  // PWA: Manifest, Meta-Tags, Service Worker.
  const manifest = JSON.parse(read("public/manifest.webmanifest"));
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.name && manifest.short_name && manifest.start_url && manifest.theme_color && manifest.background_color);
  const sizes = manifest.icons.map((i) => `${i.sizes}:${i.purpose}`);
  for (const need of ["192x192:any", "512x512:any", "512x512:maskable"]) assert.ok(sizes.includes(need), need);
  for (const icon of manifest.icons) assert.ok(fs.existsSync(path.join(__dirname, "..", "public", icon.src)), icon.src);
  const html = read("index.html");
  for (const tag of ['rel="manifest"', 'rel="apple-touch-icon"', 'apple-mobile-web-app-capable', 'apple-mobile-web-app-title', 'name="theme-color"']) assert.ok(html.includes(tag), tag);
  const sw = read("src/pwa/sw.template.js");
  assert.match(sw, /skipWaiting\(\)/);
  assert.match(sw, /clients\.claim\(\)/);
  assert.match(sw, /url\.origin !== self\.location\.origin/, "fremde Hosts (Supabase) nie cachen");
  assert.match(sw, /\/version\.json/);
  assert.match(sw, /addEventListener\("push"/);
  assert.match(sw, /addEventListener\("notificationclick"/);
  assert.match(sw, /\?tv=1/, "Klick oeffnet View only");
  assert.match(read("vite.config.mjs"), /fileName: "sw\.js"/);
  assert.match(read("public/_headers"), /manifest\+json/);
  assert.match(read("src/pwa/registerServiceWorker.ts"), /import\.meta\.env\.PROD/);

  // Menues: Benachrichtigungen unter Optionen ueberall, Folgen im Spiel (Edit + View only).
  for (const page of ["GamesPage", "StatsPage", "GamePage"]) assert.match(read(`src/pages/${page}.tsx`), /label: "Notifications"/, page);
  assert.equal((read("src/pages/GamePage.tsx").match(/\.\.\.followMenuItems/g) || []).length, 2);
};

module.exports = { runPushATests };
