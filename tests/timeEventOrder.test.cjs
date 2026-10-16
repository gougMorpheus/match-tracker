const assert = require('node:assert/strict');
const { createBaseGame } = require('./helpers/gameFixtures.cjs');
const { orderTimeEventsForEvaluation, fixStartBeforePauseTies } = require('../.test-dist/utils/timeEventOrder.js');
const { syncDerivedGameState } = require('../.test-dist/utils/gameState.js');
const { getTurnDurationMs, getPlayerTurnDurationTotalMs } = require('../.test-dist/utils/gameCalculations.js');
const { getTvStatusLabel } = require('../.test-dist/utils/tvDashboard.js');
const T = '2026-10-16T04:32:20.552Z';
const runTimeEventOrderTests = () => {
  const ids = (list) => list.map(e => e.id);
  // Pause vor Start (gleicher Zeitstempel) -> Start zuerst; andere Events behalten ihre Reihenfolge.
  const base = [
    { id: 'gs', action: 'game-start', createdAt: T },
    { id: 'rs', action: 'round-start', roundNumber: 1, createdAt: T },
    { id: 'p', action: 'turn-pause', roundNumber: 1, turnNumber: 1, createdAt: T },
    { id: 's', action: 'turn-start', roundNumber: 1, turnNumber: 1, createdAt: T }
  ];
  assert.deepEqual(ids(orderTimeEventsForEvaluation(base)), ['gs', 'rs', 's', 'p']);
  assert.deepEqual(ids(orderTimeEventsForEvaluation([base[2], base[3], base[1], base[0]])), ['s', 'rs', 'gs', 'p']);
  // Bereits richtige Reihenfolge bleibt unveraendert.
  assert.deepEqual(ids(orderTimeEventsForEvaluation([base[0], base[1], base[3], base[2]])), ['gs', 'rs', 's', 'p']);
  // Zugwechsel: turn-end Z1, Pause Z2 vor Start Z2 -> Ende bleibt vorn.
  const change = [
    { id: 'e1', action: 'turn-end', roundNumber: 1, turnNumber: 1, createdAt: T },
    { id: 'p2', action: 'turn-pause', roundNumber: 1, turnNumber: 2, createdAt: T },
    { id: 's2', action: 'turn-start', roundNumber: 1, turnNumber: 2, createdAt: T }
  ];
  assert.deepEqual(ids(fixStartBeforePauseTies(change)), ['e1', 's2', 'p2']);
  // Pause eines anderen Zugs wird nicht hinter einen fremden turn-start geschoben.
  const other = [
    { id: 'p1', action: 'turn-pause', roundNumber: 1, turnNumber: 1, createdAt: T },
    { id: 's2', action: 'turn-start', roundNumber: 1, turnNumber: 2, createdAt: T }
  ];
  assert.deepEqual(ids(fixStartBeforePauseTies(other)), ['p1', 's2']);
  // Unterschiedliche Zeitstempel: reine Zeitsortierung.
  assert.deepEqual(ids(orderTimeEventsForEvaluation([
    { id: 'b', action: 'turn-pause', roundNumber: 1, turnNumber: 1, createdAt: '2026-10-16T04:32:21.000Z' },
    { id: 'a', action: 'turn-start', roundNumber: 1, turnNumber: 1, createdAt: '2026-10-16T04:32:20.000Z' }
  ])), ['a', 'b']);

  // Ganzer Ablauf wie live (ZZ-LIVE, 16.10.): pausierter Zugstart nach "Weiter", DB liefert Pause zuerst.
  const g = createBaseGame();
  const [a, b] = g.players;
  g.status = 'active';
  g.timeEvents = [
    { id: 'gs', type: 'time', action: 'game-start', createdAt: T },
    { id: 'rs', type: 'time', action: 'round-start', roundNumber: 1, createdAt: T },
    { id: 'p', type: 'time', action: 'turn-pause', playerId: b.id, roundNumber: 1, turnNumber: 1, createdAt: T },
    { id: 's', type: 'time', action: 'turn-start', playerId: b.id, roundNumber: 1, turnNumber: 1, createdAt: T }
  ];
  const synced = syncDerivedGameState(g);
  const turn = synced.rounds[0].turns[0];
  assert.equal(turn.timing.startedAt, T);
  assert.equal(turn.timing.pauses.length, 1, 'Pause wird gewertet (Zug pausiert)');
  assert.ok(!turn.timing.pauses[0].endedAt);
  // Spaeter ausgewertet: weiterhin 0 Zugzeit, also "Zug noch nicht gestartet".
  const later = { ...synced, endedAt: undefined };
  assert.equal(getTurnDurationMs(turn, later), 0);
  assert.equal(getPlayerTurnDurationTotalMs(later, b.id), 0);
  assert.equal(getTvStatusLabel({ completed: false, timeout: false, running: false, started: true, hasTurn: true, turnMs: getTurnDurationMs(turn, later) }), 'Zug noch nicht gestartet');
  // Datenreihenfolge im Spiel selbst wird nicht veraendert (Eingabe bleibt).
  assert.deepEqual(ids(g.timeEvents), ['gs', 'rs', 'p', 's']);
};
module.exports = { runTimeEventOrderTests };
