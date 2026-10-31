const assert = require("node:assert/strict");
const { loadBrowserModule } = require("./helpers/loadBrowserModule.cjs");
const { createBaseGame, createGameInput } = require("./helpers/gameFixtures.cjs");

const runDashboardSessionGateTests = async () => {
  const saved = Object.fromEntries(["window", "navigator", "document", "fetch"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    const id = "11111111-1111-4111-8111-111111111111";
    const data = new Map();
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
    globalThis.window = {
      location: { hash: `#/game/${id}`, search: "" },
      localStorage: {
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => data.set(key, value),
        removeItem: (key) => data.delete(key)
      }
    };
    globalThis.fetch = async () => { throw new Error("Unexpected network request"); };
    globalThis.document = { hidden: false };
    let context;
    const react = {
      createContext: () => ({ Provider: "provider" }),
      useContext: () => context,
      useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
      useRef: (current) => ({ current }),
      useCallback: (fn) => fn,
      useMemo: (fn) => fn(),
      useEffect: () => {}
    };
    const jsx = (_, props) => { context = props.value; return null; };
    const probe = loadBrowserModule("tests/helpers/dashboardStoreProbe.ts", { react, "react/jsx-runtime": { jsx, jsxs: jsx } });
    data.set("match-tracker.local-games.v1", JSON.stringify([createBaseGame({ id })]));
    probe.GameStoreProvider({ children: null });
    const store = context;
    probe.setSessionWriteGate("view");
    store.setGameAccessMode(id, "edit");
    const before = store.getGame(id).scoreEvents.length;
    await store.addScoreEvent({ gameId: id, playerId: store.getGame(id).players[0].id, scoreType: "primary", value: 5 });
    assert.equal(store.getGame(id).scoreEvents.length, before, "ansehen bleibt View only, auch wenn der Modus edit waere");
    await assert.rejects(store.createGame(createGameInput()), /Kein Schreibzugriff/);
    probe.setSessionWriteGate("edit");
    await store.addScoreEvent({ gameId: id, playerId: store.getGame(id).players[0].id, scoreType: "primary", value: 5 });
    assert.equal(store.getGame(id).scoreEvents.length, before + 1, "bearbeiten/admin behalten die bestehende Eingabe");
    probe.setSessionWriteGate("legacy");
  } finally {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
};

module.exports = { runDashboardSessionGateTests };
