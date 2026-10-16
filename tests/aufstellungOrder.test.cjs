const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadBrowserModule } = require("./helpers/loadBrowserModule.cjs");
const { createGameInput } = require("./helpers/gameFixtures.cjs");
const { createLocalGame } = require("../.test-dist/utils/gameState.js");
const { isSetupRunning } = require("../.test-dist/utils/gameCalculations.js");
const { createGameSyncQueueItem, createEventSyncQueueItem } = require("../.test-dist/utils/localSync.js");
const { compareEventsAsc, compareEventsDesc } = require("../.test-dist/utils/eventOrder.js");
const { groupDisplayEvents } = require("../.test-dist/utils/eventGrouping.js");
const { orderTimeEventsForEvaluation } = require("../.test-dist/utils/timeEventOrder.js");

const loadStore = () => {
  const react = {
    createContext: () => ({ Provider: "provider" }), useContext: () => null,
    useState: (i) => [typeof i === "function" ? i() : i, () => {}],
    useRef: (current) => ({ current }), useCallback: (fn) => fn, useMemo: (fn) => fn(), useEffect: () => {}
  };
  const jsx = () => null;
  return loadBrowserModule("src/store/GameStore.tsx", { react, "react/jsx-runtime": { jsx, jsxs: jsx } });
};

const runAufstellungOrderTests = async () => {
  // Fix 1: "Timer gestoppt" kurz nach "Spiel anlegen". Der erste Abgleich ersetzt das Spiel durch den Serverstand;
  // nur Events in der Queue ueberleben. createGame muss deshalb game-start/setup-start mit einreihen.
  const local = createLocalGame(createGameInput());
  assert.deepEqual(local.timeEvents.map((e) => e.action).sort(), ["game-start", "setup-start"]);
  assert.equal(isSetupRunning(local), true);
  const remote = { ...JSON.parse(JSON.stringify(local)), timeEvents: [] }; // Serverstand direkt nach mt_save_game
  const { mergeRemoteWithPending } = loadStore();
  const t = local.createdAt;
  const gameOnly = [createGameSyncQueueItem("upsert-game", local.id, t)];
  const buggy = mergeRemoteWithPending([remote], [local], gameOnly).find((g) => g.id === local.id);
  assert.equal(isSetupRunning(buggy), false, "Fehlerbild reproduziert: ohne Event-Queue geht die Aufstellung verloren");
  const withEvents = [...gameOnly, ...local.timeEvents.map((e) => createEventSyncQueueItem("upsert-event", local.id, e.id, t))];
  const merged = mergeRemoteWithPending([remote], [local], withEvents).find((g) => g.id === local.id);
  assert.equal(isSetupRunning(merged), true, "Aufstellung laeuft nach dem ersten Abgleich weiter");
  assert.deepEqual(merged.timeEvents.map((e) => e.id).sort(), local.timeEvents.map((e) => e.id).sort());
  const store = fs.readFileSync(path.join(__dirname, "..", "src/store/GameStore.tsx"), "utf8");
  const create = store.slice(store.indexOf("const createGame = useCallback"), store.indexOf("const createGame = useCallback") + 2500);
  assert.ok(/createdGame\.timeEvents\.forEach\(\(event\) => enqueueEventUpsert\(createdGame\.id, event\.id\)\)/.test(create), "createGame reiht alle Start-Events ein");

  // Fix 2: Rundenwechsel mit identischem Zeitstempel.
  const ts = "2026-10-16T09:25:24.119Z";
  const ev = [
    { id: "f-pause", createdAt: ts, kind: "time", timeAction: "turn-pause" },
    { id: "e-turn-start", createdAt: ts, kind: "time", timeAction: "turn-start", roundNumber: 3, turnNumber: 1 },
    { id: "d-round-start", createdAt: ts, kind: "time", timeAction: "round-start", roundNumber: 3 },
    { id: "highlight:time-milestone-0-30:x", createdAt: ts, kind: "highlight" },
    { id: "highlight:time-overtake:x", createdAt: ts, kind: "highlight" },
    { id: "highlight:round-summary:r3t1:false", createdAt: ts, kind: "highlight" },
    { id: "c-round-end", createdAt: ts, kind: "time", timeAction: "round-end", roundNumber: 2 },
    { id: "b-turn-end", createdAt: ts, kind: "time", timeAction: "turn-end", roundNumber: 2, turnNumber: 2 }
  ];
  const expectedAsc = ["b-turn-end", "c-round-end", "highlight:round-summary:r3t1:false", "highlight:time-overtake:x",
    "highlight:time-milestone-0-30:x", "d-round-start", "e-turn-start", "f-pause"];
  for (let i = 0; i < 5; i += 1) {
    const shuffled = [...ev].sort(() => Math.random() - 0.5);
    assert.deepEqual([...shuffled].sort(compareEventsAsc).map((e) => e.id), expectedAsc);
    assert.deepEqual([...shuffled].sort(compareEventsDesc).map((e) => e.id), [...expectedAsc].reverse(), "neueste oben = Umkehrung");
    assert.deepEqual(groupDisplayEvents(shuffled).map((g) => g.first.id), [...expectedAsc].reverse(), "Verlauf/Letzte Ereignisse/TV-Feed");
  }
  // Highlight-Objekte (kind statt ID), wie in deriveGameHighlights/Push.
  const hl = [{ kind: "game-end", createdAt: ts }, { kind: "time-overtake", createdAt: ts }, { kind: "round-summary", createdAt: ts }, { kind: "game-start", createdAt: ts }];
  assert.deepEqual(hl.sort(compareEventsAsc).map((h) => h.kind), ["round-summary", "time-overtake", "game-end", "game-start"]);
  // Bestehende Regel "Start vor Pause" (Auswertung) bleibt und ist mit der Anzeige-Reihenfolge konsistent.
  const timeEvents = [
    { id: "p", action: "turn-pause", createdAt: ts, roundNumber: 3, turnNumber: 1 },
    { id: "s", action: "turn-start", createdAt: ts, roundNumber: 3, turnNumber: 1 }
  ];
  assert.deepEqual(orderTimeEventsForEvaluation(timeEvents).map((e) => e.action), ["turn-start", "turn-pause"]);
  assert.deepEqual([...timeEvents].sort(compareEventsAsc).map((e) => e.action), ["turn-start", "turn-pause"]);
  // Alle Anzeige-/Push-Stellen nutzen die zentrale Funktion.
  const src = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
  assert.ok(src("src/pages/GamePage.tsx").includes("sortEventsNewestFirst(["));
  assert.ok(src("src/utils/tvHighlights.ts").includes(".sort(compareEventsAsc)"));
  assert.ok(src("src/utils/pushHighlights.ts").includes(".sort(compareEventsAsc)"));
  assert.ok(src("src/utils/eventGrouping.ts").includes("createEventComparators(events)"));
};
module.exports = { runAufstellungOrderTests };
