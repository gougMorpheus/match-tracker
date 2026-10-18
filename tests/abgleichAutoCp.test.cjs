const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { isPullOutdated, keepLocallyCreatedGames } = require("../.test-dist/utils/syncVersioning.js");
const { compareEventsAsc, createEventComparators, sortEventsNewestFirst } = require("../.test-dist/utils/eventOrder.js");
const { groupDisplayEvents } = require("../.test-dist/utils/eventGrouping.js");
const { deriveGameHighlights } = require("../.test-dist/utils/tvHighlights.js");
const src = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

const runAbgleichAutoCpTests = async () => {
  // 1) "Spiel nicht gefunden": alter Abgleich (vor dem Speichern gelesen) darf das neue Spiel nicht verwerfen.
  assert.equal(isPullOutdated(4, 4), false);
  assert.equal(isPullOutdated(4, 5), true, "waehrend des Ladens selbst gespeichert -> verwerfen");
  const newGame = { id: "neu" }, other = { id: "alt" };
  const remoteWithout = [other]; // Serverantwort ohne das gerade angelegte Spiel
  assert.deepEqual(keepLocallyCreatedGames(remoteWithout, [other, newGame], new Map([["neu", 6]]), 5).map((g) => g.id), ["alt", "neu"],
    "Speichern NACH Start des Ladens -> lokal behalten");
  assert.deepEqual(keepLocallyCreatedGames(remoteWithout, [other, newGame], new Map([["neu", 5]]), 5).map((g) => g.id), ["alt"],
    "Laden nach dem letzten eigenen Speichern gestartet -> verwerfen erlaubt");
  assert.deepEqual(keepLocallyCreatedGames(remoteWithout, [other, newGame], new Map(), 5).map((g) => g.id), ["alt"], "fremde Spiele unveraendert");
  const store = src("src/store/GameStore.tsx");
  const pull = store.slice(store.indexOf("const pullRemoteGames = useCallback"), store.indexOf("pullPendingRef.current = pullRemoteGames;"));
  assert.ok(/const pullStartGeneration = writeGenerationRef\.current;\s*const listed = await gamesRepository\.listGamesDelta\(remoteCacheRef\.current, getServerNow\(\)\);/.test(pull), "Generation vor dem Laden");
  assert.ok(pull.includes("if (isPullOutdated(pullStartGeneration, writeGenerationRef.current))") && pull.includes("return pullPendingRef.current(attempt + 1)"), "verwerfen + sofort neu laden");
  assert.ok(pull.includes("keepLocallyCreatedGames(mergeRemoteWithPending("));
  const flush = store.slice(store.indexOf("const flushSyncQueue = useCallback"), store.indexOf("flushSyncQueueRef.current = flushSyncQueue;"));
  assert.equal((flush.match(/removeQueueItem\(nextItem\.id\)/g) || []).length - 1, (flush.match(/bumpWriteGeneration\(nextItem\.gameId\); removeQueueItem\(nextItem\.id\)/g) || []).length, "jedes eigene Schreiben zaehlt");
  assert.ok(/saveGame\(currentGame, base\.version, canWrite\)\)\);\s*bumpWriteGeneration\(nextItem\.gameId\);/.test(flush), "Spielzeile: Zaehler nach dem Speichern");
  const create = store.slice(store.indexOf("const createGame = useCallback"), store.indexOf("const createGame = useCallback") + 1500);
  assert.ok(create.indexOf("bumpWriteGeneration(createdGame.id)") > 0 && create.indexOf("bumpWriteGeneration(createdGame.id)") < create.indexOf("enqueueGameUpsert(createdGame.id)"), "lokales Anlegen zaehlt");

  // 2a) Echte Lage 5af59d8b: Auto-CP R2/Z1 1 ms VOR Zug Start, Markierung 2:1 fehlt (kein Buendeln).
  const ev = [
    { id: "te12", kind: "time", timeAction: "turn-end", roundNumber: 1, turnNumber: 2, createdAt: "2026-10-16T20:51:49.350Z" },
    { id: "cpA", kind: "cp", cpType: "gained", value: 1, playerId: "p1", roundNumber: 2, turnNumber: 1, createdAt: "2026-10-16T20:51:49.366Z" },
    { id: "cpB", kind: "cp", cpType: "gained", value: 1, playerId: "p2", roundNumber: 2, turnNumber: 1, createdAt: "2026-10-16T20:51:49.366Z" },
    { id: "rs2", kind: "time", timeAction: "round-start", roundNumber: 2, createdAt: "2026-10-16T20:51:49.367Z" },
    { id: "ts21", kind: "time", timeAction: "turn-start", roundNumber: 2, turnNumber: 1, createdAt: "2026-10-16T20:51:49.367Z" },
    { id: "re1", kind: "time", timeAction: "round-end", roundNumber: 1, createdAt: "2026-10-16T20:51:49.367Z" },
    { id: "highlight:round-summary:r2t1:false", kind: "highlight", createdAt: "2026-10-16T20:51:49.367Z" },
    { id: "pause", kind: "time", timeAction: "turn-pause", roundNumber: 2, turnNumber: 1, createdAt: "2026-10-16T20:51:49.367Z" },
    { id: "late", kind: "score", scoreType: "primary", value: 5, playerId: "p1", roundNumber: 2, turnNumber: 1, createdAt: "2026-10-16T20:56:00.000Z" }
  ];
  const expectedAsc = ["te12", "re1", "highlight:round-summary:r2t1:false", "rs2", "ts21", "cpA", "cpB", "pause", "late"];
  const order = createEventComparators(ev);
  assert.deepEqual([...ev].sort(order.asc).map((e) => e.id), expectedAsc, "CP direkt nach Zug Start (Rang 55), vor Pause");
  assert.deepEqual(sortEventsNewestFirst(ev).map((e) => e.id), [...expectedAsc].reverse());
  assert.deepEqual(groupDisplayEvents(ev, { "1:1": true, "1:2": true }).map((g) => g.first.id), [...expectedAsc].reverse(), "Verlauf ohne Buendelung");
  // Ohne Kontext (Highlights, Push) unveraendert: reine Zeit-/Rangordnung.
  assert.deepEqual([...ev].sort(compareEventsAsc).map((e) => e.id).slice(0, 3), ["te12", "cpA", "cpB"]);
  // Mehr als 2 s vorher oder anderer Zug: bleibt an seinem Zeitpunkt.
  const far = { id: "far", kind: "cp", cpType: "spent", value: 1, roundNumber: 2, turnNumber: 1, createdAt: "2026-10-16T20:51:47.000Z" };
  const other2 = { id: "oth", kind: "score", value: 3, roundNumber: 1, turnNumber: 2, createdAt: "2026-10-16T20:51:49.360Z" };
  assert.deepEqual(sortEventsNewestFirst([...ev, far, other2]).slice(-3).map((e) => e.id), ["oth", "te12", "far"]);
  // Highlights-Ableitung und Auswertung nutzen keine Anker.
  assert.ok(!src("src/utils/tvHighlights.ts").includes("createEventComparators") && !src("src/utils/timeEventOrder.ts").includes("eventOrder"));
  assert.equal(typeof deriveGameHighlights, "function");

  // Tim 2026-10-16: Bearbeiten eines Punkte-/CP-Eintrags pausiert die Uhr nicht.
  const page = src("src/pages/GamePage.tsx");
  const open = page.slice(page.indexOf("const openEditor = async"), page.indexOf("const closeEditor = ()"));
  assert.ok(!/pauseActiveTimer|startGameTimer|resume/.test(open), "openEditor erzeugt keine Timer-Events");
  const save = page.slice(page.indexOf("const saveEditedEvent = async"), page.indexOf("const saveEditedEvent = async") + 2500);
  assert.ok(!/pauseActiveTimer|startGameTimer/.test(save), "Speichern erzeugt keine Timer-Events");
  const close = page.slice(page.indexOf("const closeEditor = ()"), page.indexOf("const saveEditedEvent = async"));
  assert.ok(!/pauseActiveTimer|startGameTimer/.test(close), "Abbrechen erzeugt keine Timer-Events");
};
module.exports = { runAbgleichAutoCpTests };
