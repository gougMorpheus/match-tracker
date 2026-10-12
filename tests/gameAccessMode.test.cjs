const assert = require("node:assert/strict");
const { createBaseGame, createCompletedGameFixture } = require("./helpers/gameFixtures.cjs");
const {
  getGameAccessMode,
  getGameRouteAccess,
  isGameWriteBlocked,
  isGameCompletedForDisplay,
  isGameViewOnlyInState,
  setGameAccessModeInState,
  shouldAskGameAccessMode,
  shouldOpenGameViewOnly,
  shouldShowSpectatorTv,
  shouldShowClosedGameTv,
  getTvModeHash
} = require("../.test-dist/utils/gameAccessMode.js");
const {
  createGameSyncQueueItem,
  enqueueSyncQueueItem
} = require("../.test-dist/utils/localSync.js");

const runGameAccessModeTests = () => {
  const runningGame = createBaseGame({ id: "11111111-1111-4111-8111-111111111111" });
  const completedGame = createCompletedGameFixture("22222222-2222-4222-8222-222222222222");

  assert.equal(shouldAskGameAccessMode(runningGame, null), true);
  assert.equal(shouldAskGameAccessMode(runningGame, "edit"), false);
  assert.equal(shouldAskGameAccessMode(runningGame, "view"), false);
  assert.equal(shouldAskGameAccessMode(completedGame, null), false);
  assert.equal(shouldOpenGameViewOnly(completedGame, null), true);
  assert.equal(shouldShowSpectatorTv(runningGame, "view"), true);
  assert.equal(shouldShowSpectatorTv(runningGame, "edit"), false);
  assert.equal(shouldShowSpectatorTv(runningGame, null), false);
  assert.equal(shouldShowSpectatorTv(completedGame, "view"), false);
  // Beendete Spiele: TV-Modus mit Menue ersetzt den Abschlussbildschirm, fuer Spieler und Zuschauer.
  assert.equal(shouldShowSpectatorTv(completedGame, null, true), false);
  assert.equal(shouldShowClosedGameTv(completedGame, null), true, "Klick in der Liste -> TV");
  assert.equal(shouldShowClosedGameTv(completedGame, "view"), true, "?tv=1 bzw. Zuschauer -> TV");
  assert.equal(shouldShowClosedGameTv(completedGame, "edit"), false, "nur nach Passwort-Entsperren in die Bearbeitung");
  assert.equal(shouldShowClosedGameTv(runningGame, null), false, "laufende Spiele unveraendert");
  assert.equal(shouldShowClosedGameTv(runningGame, "view"), false);
  assert.equal(shouldShowClosedGameTv(undefined, null), false);
  assert.deepEqual(getGameRouteAccess(`#${getTvModeHash(completedGame.id)}`), { gameId: completedGame.id, tv: true });
  assert.equal(shouldShowSpectatorTv(runningGame, null, true), true);
  assert.equal(shouldShowSpectatorTv(undefined, "view", true), false);
  // Abschluss im TV-Modus bleibt gesperrt: ohne Passwort kein Schreiben, auch nicht mit "edit"-Status.
  const tvRoute = getGameRouteAccess(`#/game/${completedGame.id}?tv=1`);
  assert.equal(shouldOpenGameViewOnly(completedGame, "view"), true);
  assert.equal(isGameWriteBlocked(setGameAccessModeInState({}, completedGame.id, "view"), completedGame.id, tvRoute), true);
  assert.equal(isGameWriteBlocked(setGameAccessModeInState({}, completedGame.id, "edit"), completedGame.id, tvRoute), true);
  assert.equal(isGameWriteBlocked({}, completedGame.id, tvRoute), true);

  const inconsistentCompletedGame = {
    ...runningGame,
    status: "active",
    endedAt: undefined,
    timeEvents: [
      ...runningGame.timeEvents,
      {
        id: "33333333-3333-4333-8333-333333333333",
        type: "time",
        action: "game-end",
        createdAt: "2026-05-20T21:00:00.000Z"
      }
    ]
  };
  assert.equal(isGameCompletedForDisplay(inconsistentCompletedGame), true);
  assert.equal(shouldAskGameAccessMode(inconsistentCompletedGame, null), false);
  assert.equal(shouldOpenGameViewOnly(inconsistentCompletedGame, null), true);

  const viewOnlyModes = setGameAccessModeInState({}, runningGame.id, "view");
  assert.equal(getGameAccessMode(viewOnlyModes, runningGame.id), "view");
  assert.equal(isGameViewOnlyInState(viewOnlyModes, runningGame.id), true);

  const beforeQueue = [];
  const afterBlockedScore = isGameViewOnlyInState(viewOnlyModes, runningGame.id)
    ? beforeQueue
    : enqueueSyncQueueItem(
        beforeQueue,
        createGameSyncQueueItem("upsert-game", runningGame.id, "2026-05-20T12:00:00.000Z")
      );
  assert.equal(afterBlockedScore.length, 0);

  let supabaseWriteCalls = 0;
  const writeScore = () => {
    if (isGameViewOnlyInState(viewOnlyModes, runningGame.id)) {
      return;
    }
    supabaseWriteCalls += 1;
  };
  writeScore();
  assert.equal(supabaseWriteCalls, 0);

  const editModes = setGameAccessModeInState(viewOnlyModes, runningGame.id, "edit");
  const editQueue = isGameViewOnlyInState(editModes, runningGame.id)
    ? []
    : enqueueSyncQueueItem(
        [],
        createGameSyncQueueItem("upsert-game", runningGame.id, "2026-05-20T12:00:00.000Z")
      );
  assert.equal(editQueue.length, 1);

  assert.equal(isGameViewOnlyInState({}, completedGame.id), false);
  const route = getGameRouteAccess(`#/game/${runningGame.id}?tv=1`);
  assert.deepEqual(route, {gameId: runningGame.id, tv: true});
  assert.equal(isGameWriteBlocked(editModes, runningGame.id, route), true);
  assert.equal(isGameWriteBlocked({}, runningGame.id, getGameRouteAccess(`#/game/${runningGame.id}`)), true);
  assert.equal(isGameWriteBlocked(editModes, runningGame.id, getGameRouteAccess(`#/game/${runningGame.id}`)), false);
  assert.equal(getGameRouteAccess(`#/game/${runningGame.id}/overview?tv=1`).gameId, runningGame.id);
  assert.equal(getGameRouteAccess(`#/game/${runningGame.id}`, '?tv=1').tv, true);
  assert.equal(getGameRouteAccess(`#/game/${runningGame.id}?tv=0`).tv, false);
  assert.deepEqual(getGameRouteAccess('#/games'), {gameId: null, tv: false});
};

module.exports = {
  runGameAccessModeTests
};
