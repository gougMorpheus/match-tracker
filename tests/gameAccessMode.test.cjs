const assert = require("node:assert/strict");
const { createBaseGame, createCompletedGameFixture } = require("./helpers/gameFixtures.cjs");
const {
  getGameAccessMode,
  isGameViewOnlyInState,
  setGameAccessModeInState,
  shouldAskGameAccessMode,
  shouldOpenGameViewOnly
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
};

module.exports = {
  runGameAccessModeTests
};
