// Service Worker: Navigationen auf Unterseiten (z. B. /battle-cal/) duerfen die App-Huelle (/index.html) nicht ueberschreiben.
const assert = require("node:assert/strict");
const fs = require("node:fs"); const path = require("node:path"); const vm = require("node:vm");

const runSwNavigationTests = async () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src/pwa/sw.template.js"), "utf8");
  const store = new Map(); const listeners = {}; let online = true;
  const resp = (body) => ({ ok: true, body, clone() { return resp(body); } });
  const caches = {
    open: async () => ({ put: async (k, v) => { store.set(String(k), v); }, addAll: async () => {} }),
    match: async (k) => store.get(String(typeof k === "string" ? k : k.url)),
    keys: async () => [], delete: async () => true
  };
  const self = { location: { origin: "https://mt.example" }, addEventListener: (t, fn) => { listeners[t] = fn; },
    skipWaiting: () => {}, clients: { claim: () => {} }, registration: {} };
  const ctx = { self, caches, fetch: async (req) => { if (!online) throw new Error("offline"); return resp(`page:${new URL(req.url).pathname}`); },
    Response: { error: () => ({ ok: false, error: true }) }, URL, console };
  vm.runInNewContext(src.replaceAll("__APP_BUILD__", "test"), ctx);
  const nav = async (u) => { let p; listeners.fetch({ request: { method: "GET", mode: "navigate", url: u }, respondWith: (x) => { p = x; } }); const r = await p; await new Promise((r2) => setTimeout(r2, 0)); return r; };

  await nav("https://mt.example/");
  assert.equal(store.get("/index.html").body, "page:/", "App-Huelle gespeichert");
  await nav("https://mt.example/battle-cal/");
  assert.equal(store.get("/index.html").body, "page:/", "Unterseite ueberschreibt /index.html nicht");
  assert.equal(store.get("https://mt.example/battle-cal/").body, "page:/battle-cal/", "Unterseite unter eigenem Schluessel");
  await nav("https://mt.example/battle-cal/index.html?x=1");
  assert.equal(store.get("/index.html").body, "page:/");
  await nav("https://mt.example/index.html");
  assert.equal(store.get("/index.html").body, "page:/index.html");
  // Offline wie bisher: App-Huelle aus dem Cache; Unterseite aus ihrem eigenen Eintrag, nie die MT-App
  online = false;
  assert.equal((await nav("https://mt.example/#/stats")).body, "page:/index.html", "offline: App-Huelle");
  assert.equal((await nav("https://mt.example/battle-cal/")).body, "page:/battle-cal/", "offline: Unterseite aus eigenem Eintrag");
  assert.equal((await nav("https://mt.example/unbekannt/")).error, true, "offline: unbekannte Unterseite bekommt NICHT die MT-App");
};
module.exports = { runSwNavigationTests };
