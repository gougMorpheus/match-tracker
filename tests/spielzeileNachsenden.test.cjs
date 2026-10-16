const assert = require("node:assert/strict");
const { loadBrowserModule } = require("./helpers/loadBrowserModule.cjs");
const { createGameInput } = require("./helpers/gameFixtures.cjs");
const { decideAfterGameSave, MAX_GAME_RESENDS } = require("../.test-dist/utils/localSync.js");

// 2b: Spielzeile langsam gespeichert, waehrenddessen lokal geaendert -> erneut senden, bis der Serverstand passt.
const runSpielzeileNachsendenTests = async () => {
  assert.equal(decideAfterGameSave("a", "a", 0), "done");
  assert.equal(decideAfterGameSave("a", null, 0), "done");
  assert.equal(decideAfterGameSave("a", "b", 0), "resend");
  assert.equal(decideAfterGameSave("a", "b", MAX_GAME_RESENDS), "defer", "keine Endlosschleife");

  const saved = Object.fromEntries(["window", "navigator", "document", "fetch"].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  try {
    const data = new Map();
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
    globalThis.window = { location: { hash: "#/new", search: "" }, localStorage: { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) },
      setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true };
    globalThis.document = { hidden: false, addEventListener: () => {}, removeEventListener: () => {} };
    let context;
    const saves = []; let version = 0; let flow = 0; let onFirstSave = null;
    const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url);
      if (u.includes("/rpc/mt_save_game")) {
        const body = JSON.parse(init.body);
        saves.push({ name: body.p_game.player1_name, expected: body.p_expected_version });
        if (saves.length === 1 && onFirstSave) { const f = onFirstSave; onFirstSave = null; setTimeout(f, 0); await new Promise((r) => setTimeout(r, 150)); }
        version += 1; return json({ matched: true, version, flow_version: flow, created: version === 1 });
      }
      if (u.includes("/rpc/mt_put_event")) { flow += 1; return json({ matched: true, flow_version: flow, version }); }
      if (u.includes("/rpc/")) return json({});
      return json([]);
    };
    const react = { createContext: () => ({ Provider: "provider" }), useContext: () => context,
      useState: (i) => [typeof i === "function" ? i() : i, () => {}], useRef: (current) => ({ current }), useCallback: (fn) => fn, useMemo: (fn) => fn(), useEffect: () => {} };
    const jsx = (_, props) => { context = props.value; return null; };
    const module = loadBrowserModule("src/store/GameStore.tsx", { react, "react/jsx-runtime": { jsx, jsxs: jsx } });
    module.GameStoreProvider({ children: null });
    const store = context;
    let changeDone;
    const changed = new Promise((r) => { changeDone = r; });
    onFirstSave = () => { store.updateGameDetails(gameId, createGameInput({ playerOneName: "Changed" })).then(changeDone, changeDone); };
    const game = await store.createGame(createGameInput());
    var gameId = game.id;
    await changed;
    for (let i = 0; i < 100 && JSON.parse(data.get("match-tracker.sync-queue.v2") || "[]").length; i++) await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(saves.length >= 2, `Spielzeile erneut gesendet (${JSON.stringify(saves)})`);
    assert.equal(saves[0].name, "Alice", "erster Stand vom Absendezeitpunkt");
    assert.equal(saves[saves.length - 1].name, "Changed", "letzter gespeicherter Stand = lokaler Stand");
    assert.equal(saves[1].expected, 1, "Nachsendung mit mitgezogener Basisversion");
    assert.ok(saves.length <= 1 + MAX_GAME_RESENDS + 1, "begrenzt");
    assert.equal(JSON.parse(data.get("match-tracker.sync-queue.v2") || "[]").length, 0, "Queue leer");
  } finally {
    for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
  }
};
module.exports = { runSpielzeileNachsendenTests };
