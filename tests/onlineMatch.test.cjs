const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadBrowserModule } = require("./helpers/loadBrowserModule.cjs");
const {
  appendLocalCommandPointEvent,
  appendLocalScoreEvent,
  appendLocalTimeEvents,
  createLocalGame,
  overlayLocalGameMetadata,
  syncDerivedGameState,
  updateLocalGameDetails
} = require("../.test-dist/utils/gameState.js");
const {
  createGameUpdatePayload,
  createImportedGamePayload,
  createSyncedGamePayload,
  getGameSnapshotFingerprint
} = loadBrowserModule("src/services/gamesRepository.ts");
const { mapSupabaseGameToAppGame } = require("../.test-dist/utils/supabaseGameMapping.js");
const { buildMatchHud, terrainMatchQuery } = require("../.test-dist/utils/matchHud.js");
const { getActiveTurn, getPlayerCommandPoints, getPlayerTotalScore, isSetupActive } = require("../.test-dist/utils/gameCalculations.js");

const input = (overrides = {}) => ({
  playerOneName: "ZZ-A",
  playerOneArmy: "Aeldari",
  playerOneDetachment: "",
  playerTwoName: "ZZ-B",
  playerTwoArmy: "Necrons",
  playerTwoDetachment: "",
  gamePoints: 1000,
  scheduledDate: "2026-11-04",
  scheduledTime: "18:00",
  deployment: "",
  primaryMission: "",
  statsEligibilityMode: "auto",
  defenderSlot: "player2",
  startingSlot: "player1",
  isOnline: false,
  ...overrides
});

const runOnlineMatchTests = async () => {
  const off = createLocalGame(input());
  assert.equal(off.isOnline, false);
  assert.equal(createSyncedGamePayload(off).is_online, false);
  assert.equal(createImportedGamePayload(off).is_online, false);
  assert.equal(createGameUpdatePayload(input()).is_online, false);

  const on = createLocalGame(input({ isOnline: true }));
  assert.equal(on.isOnline, true);
  const payload = createSyncedGamePayload(on);
  assert.equal(payload.is_online, true);
  assert.equal(mapSupabaseGameToAppGame(payload, []).isOnline, true);
  const { is_online: _dropped, ...withoutFlag } = payload;
  assert.equal(mapSupabaseGameToAppGame(withoutFlag, []).isOnline, false, "alte Zeile ohne Spalte bleibt offline");
  assert.equal(mapSupabaseGameToAppGame({ ...payload, is_online: false }, []).isOnline, false);

  const edited = updateLocalGameDetails(off, input({ isOnline: true }));
  assert.equal(edited.isOnline, true);
  assert.equal(edited.players[0].name, "ZZ-A");
  assert.equal(updateLocalGameDetails(edited, input({ isOnline: false })).isOnline, false);
  assert.notEqual(getGameSnapshotFingerprint(off), getGameSnapshotFingerprint({ ...off, isOnline: true }), "nur Online ändert den Snapshot");
  assert.equal(overlayLocalGameMetadata(off, { ...off, isOnline: true }).isOnline, true);
  assert.equal(overlayLocalGameMetadata(on, off).isOnline, false);

  const legacyInput = input();
  delete legacyInput.isOnline;
  assert.equal(createLocalGame(legacyInput).isOnline, false, "alter Client ohne Feld");

  const sql = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20261104_01_online_match.sql"), "utf8");
  assert.match(sql, /add column if not exists is_online boolean not null default false/);
  assert.match(sql, /'schema_version', 3/);
  assert.match(sql, /'min_app_schema', 2/);
  assert.doesNotMatch(sql, /'min_app_schema', 3/);
  assert.match(sql, /function public\.mt_match_hud\(p_match_id uuid\)/);
  assert.match(sql, /coalesce\(n\.is_online, false\)/);
  const rollback = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20261104_01_online_match.rollback.sql"), "utf8");
  assert.match(rollback, /drop column if exists is_online/);
  assert.match(rollback, /'schema_version', 2/);
  assert.match(rollback, /'min_app_schema', 2/);
  assert.match(rollback, /drop function if exists public\.mt_match_hud\(uuid\)/);

  assert.equal(isSetupActive(on), true);
  let hud = buildMatchHud(on);
  assert.equal(hud.phase, "setup");
  assert.equal(hud.round, 0);
  assert.equal(hud.activeTurn, null);
  assert.equal(hud.activePlayerSlot, 1);
  assert.equal(hud.isOnline, true);
  assert.equal(terrainMatchQuery(on.id), `?match=${on.id}`);

  let game = on;
  game = appendLocalScoreEvent(game, {
    playerId: game.players[0].id, scoreType: "primary", value: -3, roundNumber: 1, turnNumber: 1,
    createdAt: "2026-11-04T18:01:00.000Z"
  });
  game = appendLocalScoreEvent(game, {
    playerId: game.players[0].id, scoreType: "secondary", value: 5, roundNumber: 1, turnNumber: 1,
    createdAt: "2026-11-04T18:02:00.000Z"
  });
  game = appendLocalScoreEvent(game, {
    playerId: game.players[1].id, scoreType: "challenge", value: 4, roundNumber: 1, turnNumber: 1,
    createdAt: "2026-11-04T18:03:00.000Z"
  });
  game = appendLocalCommandPointEvent(game, {
    playerId: game.players[0].id, cpType: "gained", value: 1, createdAt: "2026-11-04T18:04:00.000Z"
  });
  game = appendLocalCommandPointEvent(game, {
    playerId: game.players[0].id, cpType: "spent", value: 4, createdAt: "2026-11-04T18:05:00.000Z"
  });
  game = appendLocalCommandPointEvent(game, {
    playerId: game.players[1].id, cpType: "gained", value: 3, createdAt: "2026-11-04T18:06:00.000Z"
  });
  game = appendLocalCommandPointEvent(game, {
    playerId: game.players[1].id, cpType: "spent", value: 1, createdAt: "2026-11-04T18:07:00.000Z"
  });
  hud = buildMatchHud(game);
  assert.equal(hud.scores[1], getPlayerTotalScore(game, game.players[0].id));
  assert.equal(hud.scores[1], 5);
  assert.equal(hud.players[0].primary, 0);
  assert.equal(hud.players[0].secondary, 5);
  assert.equal(hud.scores[2], 4);
  assert.equal(hud.cp[1], getPlayerCommandPoints(game, game.players[0].id));
  assert.equal(hud.cp[1], 0);
  assert.equal(hud.players[0].cpGained, 1);
  assert.equal(hud.players[0].cpSpent, 4);
  assert.equal(hud.cp[2], 2);
  assert.equal(hud.phase, "setup");

  const same = "2026-11-04T18:10:00.000Z";
  game = appendLocalTimeEvents(game, [
    { action: "round-start", roundNumber: 1, createdAt: same },
    { action: "turn-start", playerId: game.players[1].id, roundNumber: 1, turnNumber: 1, createdAt: same },
    { action: "turn-pause", playerId: game.players[1].id, roundNumber: 1, turnNumber: 1, createdAt: same }
  ]);
  hud = buildMatchHud(game);
  const active = getActiveTurn(game);
  assert.ok(active);
  assert.equal(hud.phase, "turn");
  assert.equal(hud.round, active.roundNumber);
  assert.equal(hud.activeTurn.turn, active.turnNumber);
  assert.equal(hud.activeTurn.playerSlot, 2);
  assert.equal(hud.activeTurn.running, false);
  assert.equal(hud.activePlayerSlot, 2);

  game = appendLocalTimeEvents(game, [
    { action: "turn-resume", playerId: game.players[1].id, roundNumber: 1, turnNumber: 1, createdAt: "2026-11-04T18:11:00.000Z" }
  ]);
  assert.equal(buildMatchHud(game).activeTurn.running, true);

  game = appendLocalTimeEvents(game, [{ action: "setup-pause", createdAt: "2026-11-04T18:12:00.000Z" }]);
  assert.equal(isSetupActive(game), true);
  hud = buildMatchHud(game);
  assert.equal(hud.phase, "setup");
  assert.equal(hud.activeTurn, null);
  assert.equal(hud.round, 0);
  assert.equal(hud.activePlayerSlot, 1);

  game = appendLocalTimeEvents(game, [
    { action: "turn-resume", playerId: game.players[1].id, roundNumber: 1, turnNumber: 1, createdAt: "2026-11-04T18:13:00.000Z" },
    { action: "game-end", createdAt: "2026-11-04T18:20:00.000Z" }
  ]);
  hud = buildMatchHud(game);
  assert.equal(hud.phase, "ended");
  assert.equal(hud.status, "completed");
  assert.equal(hud.activeTurn.running, false);
  assert.equal(hud.activeTurn.playerSlot, 2);
  assert.equal(hud.scores[2], getPlayerTotalScore(game, game.players[1].id));

  const legacy = syncDerivedGameState({
    ...off,
    scoreDetailLevel: "total-only",
    legacyScoreTotals: {
      [off.players[0].id]: 85,
      [off.players[1].id]: 12
    },
    scoreEvents: [],
    timeEvents: []
  });
  const legacyHud = buildMatchHud(legacy);
  assert.equal(legacyHud.phase, "pending");
  assert.equal(legacyHud.scores[1], 85);
  assert.equal(legacyHud.scores[2], 12);
  assert.equal(legacyHud.players[0].primary, 0);

  const withLegacyEvents = appendLocalScoreEvent(legacy, {
    playerId: legacy.players[0].id,
    scoreType: "legacy-total",
    value: 40,
    roundNumber: 1,
    createdAt: "2026-11-04T18:30:00.000Z"
  });
  const eventHud = buildMatchHud(withLegacyEvents);
  assert.equal(eventHud.scores[1], 40);
  assert.equal(eventHud.scores[2], 0);
};

module.exports = { runOnlineMatchTests };
