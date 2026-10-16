// Abo-Abgleich Browser <-> Server (pushSubscription.ts) mit gemocktem Service Worker, Notification und Supabase-RPC.
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const { build } = require("esbuild");

const load = async () => {
  const entry = path.join(__dirname, "..", "src/pwa/pushSubscription.ts");
  const { outputFiles } = await build({ entryPoints: [entry], bundle: true, write: false, platform: "node", format: "cjs",
    define: { "import.meta.env": JSON.stringify({ DEV: false, VITE_VAPID_PUBLIC_KEY: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U" }) },
    plugins: [{ name: "mock-supabase", setup(b) { b.onResolve({ filter: /lib\/supabase$/ }, () => ({ path: "mock-supabase", namespace: "mock" }));
      b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: "export const getSupabaseClient = () => globalThis.__supabase;", loader: "js" })); } }] });
  const m = new Module(entry); m.filename = entry; m.paths = Module._nodeModulePaths(process.cwd());
  m._compile(outputFiles[0].text, entry); return m.exports;
};

const setup = ({ local = null, serverSubscribed = true } = {}) => {
  const calls = []; let counter = 0;
  const makeSub = (endpoint) => ({ endpoint, unsubscribed: false, toJSON() { return { endpoint, keys: { p256dh: "p", auth: "a" } }; }, async unsubscribe() { this.unsubscribed = true; state.sub = null; return true; } });
  const state = { sub: local ? makeSub(local) : null, serverSubscribed };
  const pushManager = { async getSubscription() { return state.sub; }, async subscribe() { counter += 1; state.sub = makeSub(`https://push.example/neu-${counter}`); calls.push("browser-subscribe"); return state.sub; } };
  const registration = { pushManager };
  globalThis.Notification = { permission: "granted" };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "test", serviceWorker: { async getRegistration() { return registration; }, ready: Promise.resolve(registration), async register() {} } } });
  globalThis.__supabase = { async rpc(name, args) { calls.push(name + (args.p_endpoint ? ":" + args.p_endpoint : ""));
    if (name === "mt_push_subscribe") { state.serverSubscribed = true; return { error: null }; }
    if (name === "mt_push_set_follows") return { data: { subscribed: state.serverSubscribed }, error: null };
    return { error: null }; } };
  return { calls, state, makeSub };
};
const settings = { schema: 1, deviceId: "dev-1", autoFollowNew: false, autoFollowSince: null, follows: { g1: { followedAt: "2026-10-16T08:00:00.000Z" } }, unfollowed: {} };

const runPushAboTests = async () => {
  // 1) Browser hat kein Abo, Server glaubt eins zu haben -> neues Abo anlegen und speichern.
  let mod = await load(); let env = setup({ local: null, serverSubscribed: true });
  assert.equal(await mod.syncFollowsIfSubscribed(settings), true);
  assert.deepEqual(env.calls, ["browser-subscribe", "mt_push_subscribe:https://push.example/neu-1"]);

  // 2) Danach gleicher Stand: kein weiterer RPC.
  env.calls.length = 0;
  assert.equal(await mod.syncFollowsIfSubscribed(settings), true);
  assert.deepEqual(env.calls, []);

  // 3) Browser verwirft das Abo (z. B. Berechtigung zurueckgenommen) -> beim naechsten Abgleich neu.
  env.state.sub = null; env.calls.length = 0;
  assert.equal(await mod.syncFollowsIfSubscribed(settings), true);
  assert.deepEqual(env.calls, ["browser-subscribe", "mt_push_subscribe:https://push.example/neu-2"]);

  // 4) Server hat das Abo entfernt (404/410 beim Versand), Browser hat noch das alte -> Browser-Abo erneuern.
  env.state.serverSubscribed = false; env.calls.length = 0;
  const changed = { ...settings, follows: { ...settings.follows, g2: { followedAt: "2026-10-16T08:05:00.000Z" } } };
  assert.equal(await mod.syncFollowsIfSubscribed(changed), true);
  assert.deepEqual(env.calls, ["mt_push_set_follows", "browser-subscribe", "mt_push_subscribe:https://push.example/neu-3"]);

  // 5) Erster Abgleich nach Neuladen mit vorhandenem Browser-Abo: Endpoint wird gespeichert (Server ggf. veraltet).
  mod = await load(); env = setup({ local: "https://push.example/alt", serverSubscribed: false });
  assert.equal(await mod.syncFollowsIfSubscribed(settings), true);
  assert.deepEqual(env.calls, ["mt_push_subscribe:https://push.example/alt"]);

  // 6) Anlegen schlaegt fehl -> nicht aktiv (false), keine falsche Erfolgsmeldung.
  mod = await load(); env = setup({ local: null });
  globalThis.navigator.serviceWorker.ready = Promise.resolve({ pushManager: { async getSubscription() { return null; }, async subscribe() { throw new Error("denied"); } } });
  globalThis.navigator.serviceWorker.getRegistration = async () => ({});
  assert.equal(await mod.syncFollowsIfSubscribed(settings), false);
  const res = await mod.subscribeAndSync(settings);
  assert.equal(res.ok, false); assert.match(res.message, /nicht aktiv/);

  // 7) Ohne Berechtigung kein Abgleich.
  mod = await load(); env = setup({}); globalThis.Notification = { permission: "denied" };
  assert.equal(await mod.syncFollowsIfSubscribed(settings), false); assert.deepEqual(env.calls, []);
};
module.exports = { runPushAboTests };
