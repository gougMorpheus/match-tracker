const assert = require("node:assert/strict");

const createMemoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear()
  };
};

const loadLocalSync = () => {
  global.window = {
    localStorage: createMemoryStorage()
  };
  const modulePath = "../.test-dist/utils/localSync.js";
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
};

const runLocalSyncTests = () => {
  const {
    createEventSyncQueueItem,
    createGameSyncQueueItem,
    createReopenGameSyncQueueItem,
    enqueueSyncQueueItem,
    loadCachedGames,
    loadSyncQueue,
    removeSyncQueueItem,
    saveCachedGames,
    saveSyncQueue
  } = loadLocalSync();
  const { createBaseGame } = require("./helpers/gameFixtures.cjs");

  const game = createBaseGame({ id: "11111111-1111-4111-8111-111111111111" });
  const queuedGameWrite = createGameSyncQueueItem("upsert-game", game.id, "2026-05-20T12:00:00.000Z");

  saveCachedGames([game]);
  saveSyncQueue([queuedGameWrite]);
  assert.equal(loadCachedGames()[0].id, game.id);
  assert.deepEqual(loadSyncQueue(), [queuedGameWrite]);

  const failingWrite = async () => {
    throw new Error("Supabase unavailable");
  };
  assert.rejects(failingWrite, /Supabase unavailable/);
  assert.equal(loadCachedGames()[0].id, game.id);
  assert.deepEqual(loadSyncQueue(), [queuedGameWrite]);

  const retriedQueue = removeSyncQueueItem(loadSyncQueue(), queuedGameWrite.id);
  saveSyncQueue(retriedQueue);
  assert.deepEqual(loadSyncQueue(), []);

  const duplicateGameQueue = enqueueSyncQueueItem(
    [queuedGameWrite],
    createGameSyncQueueItem("upsert-game", game.id, "2026-05-20T12:00:01.000Z")
  );
  assert.equal(duplicateGameQueue.length, 1);
  assert.equal(duplicateGameQueue[0].id, queuedGameWrite.id);

  const firstEventWrite = createEventSyncQueueItem(
    "upsert-event",
    game.id,
    "event-1",
    "2026-05-20T12:00:00.000Z"
  );
  const duplicateEventQueue = enqueueSyncQueueItem(
    [firstEventWrite],
    createEventSyncQueueItem("upsert-event", game.id, "event-1", "2026-05-20T12:00:01.000Z")
  );
  assert.equal(duplicateEventQueue.length, 1);
  assert.equal(duplicateEventQueue[0].id, firstEventWrite.id);

  const pendingGameUpsert = createGameSyncQueueItem("upsert-game", game.id, "2026-05-20T12:00:02.000Z");
  const pendingGameEndDelete = createEventSyncQueueItem(
    "delete-event",
    game.id,
    "game-end-event",
    "2026-05-20T12:00:03.000Z"
  );
  const reopenQueue = enqueueSyncQueueItem(
    [pendingGameUpsert, pendingGameEndDelete],
    createReopenGameSyncQueueItem(game.id, "2026-05-20T12:00:04.000Z", "game-end-event")
  );

  assert.equal(reopenQueue.length, 1);
  assert.equal(reopenQueue[0].type, "reopen-game");
  assert.equal(reopenQueue[0].gameEndEventId, "game-end-event");

  const reloadedLocalSync = loadLocalSync();
  reloadedLocalSync.saveCachedGames([game]);
  reloadedLocalSync.saveSyncQueue([queuedGameWrite]);
  assert.equal(reloadedLocalSync.loadCachedGames()[0].id, game.id);
  assert.deepEqual(reloadedLocalSync.loadSyncQueue(), [queuedGameWrite]);
};

module.exports = {
  runLocalSyncTests
};
