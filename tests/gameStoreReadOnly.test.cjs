const assert = require('node:assert/strict');
const { loadBrowserModule } = require('./helpers/loadBrowserModule.cjs');
const { createBaseGame, createCompletedGameFixture, createGameInput } = require('./helpers/gameFixtures.cjs');
const { appendLocalTimeEvents } = require('../.test-dist/utils/gameState.js');
const { createGameSyncQueueItem } = require('../.test-dist/utils/localSync.js');
const runGameStoreReadOnlyTests = async () => {
  const saved = Object.fromEntries(['window', 'navigator', 'document', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let fetchCalls = 0;
  try {
    const id = '11111111-1111-4111-8111-111111111111';
    const data = new Map();
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
    globalThis.window = { location: { hash: `#/game/${id}`, search: '' }, localStorage: {
      getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value)
    } };
    globalThis.fetch = async () => { fetchCalls++; throw Error('Unexpected network request'); };
    globalThis.document = { hidden: false };
    let context;
    const react = {
      createContext: () => ({ Provider: 'provider' }), useContext: () => context,
      useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
      useRef: current => ({current}), useCallback: fn => fn, useMemo: fn => fn(), useEffect: () => {}
    };
    const jsx = (_, props) => { context = props.value; return null; };
    const module = loadBrowserModule('src/store/GameStore.tsx', { react, 'react/jsx-runtime': {jsx, jsxs: jsx} });
    const open = (completed = false, pending = []) => {
      data.clear();
      data.set('match-tracker.local-games.v1', JSON.stringify([completed ? createCompletedGameFixture(id) : createBaseGame({id})]));
      data.set('match-tracker.sync-queue.v2', JSON.stringify(pending));
      module.GameStoreProvider({ children: null });
      return context;
    };
    const attemptAll = async store => {
      const before = JSON.stringify(store.getGame(id));
      const queue = data.get('match-tracker.sync-queue.v2');
      const playerId = store.getGame(id).players[0].id;
      await store.updateGameDetails(id, createGameInput({playerOneName: 'Changed'}));
      await store.addScoreEvent({gameId: id, playerId, scoreType: 'primary', value: 5});
      await store.addCommandPointEvent({gameId: id, playerId, cpType: 'gained', value: 2});
      await store.addNoteEvent({gameId: id, playerId, note: 'Changed'});
      await store.setAutoCommandPointEnabled(id, true);
      await store.updateStatsEligibilityOverrides(id, {areas: {time: 'exclude'}});
      await store.setTimerCorrections({gameId: id, corrections: {totalMs: 10, rounds: {}, turns: {}}});
      await store.resetAllGameTimers(id);
      await store.advanceGame(id);
      await store.rewindLastTurn(id);
      await store.startGameTimer(id);
      await store.pauseActiveTimer(id);
      await store.startTimeout(id);
      await store.endTimeout(id);
      await store.updateGameEvent(id, 'missing', {created_at: '2026-10-01T10:00:00Z'});
      await store.deleteGameEvent(id, 'missing');
      await store.undoGameAction(id);
      await store.redoGameAction(id);
      await store.finishGame(id);
      await store.reopenGame(id);
      await store.importGames([createBaseGame({id, gamePoints: 999})]);
      await store.deleteGame(id);
      assert.equal(JSON.stringify(store.getGame(id)), before, 'No store mutation in view mode');
      assert.equal(data.get('match-tracker.sync-queue.v2'), queue, 'No enqueue in view mode');
    };
    // Before access dialog selection, explicit view, and completed viewer.
    await attemptAll(open());
    let store = open(); store.setGameAccessMode(id, 'view'); await attemptAll(store);
    store = open(true); store.setGameAccessMode(id, 'view'); await attemptAll(store);
    store = open(true); store.setGameAccessMode(id, 'edit'); await attemptAll(store);
    // Both TV URL forms override even explicit edit mode, before any effects.
    for (const [hash, search] of [[`#/game/${id}?tv=1`, ''], [`#/game/${id}`, '?tv=1']]) {
      window.location = {hash, search};
      store = open(); store.setGameAccessMode(id, 'edit'); await attemptAll(store);
    }
    window.location = {hash: `#/game/${id}`, search: ''};
    store = open(); store.setGameAccessMode(id, 'edit');
    await store.addScoreEvent({gameId: id, playerId: store.getGame(id).players[0].id, scoreType: 'primary', value: 5});
    assert.equal(store.getGame(id).scoreEvents.length, 1, 'Editor still mutates');
    assert.ok(JSON.parse(data.get('match-tracker.sync-queue.v2')).length > 0, 'Editor enqueues');
    // Cached pending writes stay queued while watching; refresh may only read.
    store = open(false, [createGameSyncQueueItem('upsert-game', id, '2026-10-01T10:00:00Z')]);
    store.setGameAccessMode(id, 'view');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {onLine: true} });
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.method, 'GET', 'Viewer never sends a REST mutation');
      return { ok: true, headers: {get: () => null}, text: async () => '[]' };
    };
    await store.retrySync();
    assert.equal(JSON.parse(data.get('match-tracker.sync-queue.v2')).length, 1);
    assert.equal(fetchCalls, 0);
    // Regression: a running cached timer must not mask a remote pause or switch.
    const repository = loadBrowserModule('src/services/gamesRepository.ts');
    const running = appendLocalTimeEvents(createBaseGame({id}), [
      {action: 'setup-start', createdAt: '2026-10-01T10:00:00Z'}
    ]);
    const paused = appendLocalTimeEvents(running, [{action: 'setup-pause', createdAt: '2026-10-01T10:05:00Z'}]);
    store = open();
    const response = value => ({ok: true, headers: {get: () => null}, text: async () => JSON.stringify(value)});
    let remote = running;
    globalThis.fetch = async (url, options) => {
      assert.equal(options.method, 'GET');
      return response(String(url).includes('/events?') ? repository.createSyncedEventPayloads(remote) : [repository.createSyncedGamePayload(remote)]);
    };
    await store.refreshGames();
    assert.equal(store.getGame(id).timeEvents.at(-1).action, 'setup-start');
    remote = paused;
    await store.refreshGames();
    assert.equal(store.getGame(id).timeEvents.at(-1).action, 'setup-pause', 'Remote pause replaces running local snapshot');
    // A viewer ignores pending local mutations while retaining the compatible queue.
    store = open(false, [createGameSyncQueueItem('upsert-game', id, '2026-10-01T10:00:00Z')]);
    store.setGameAccessMode(id, 'view');
    await store.refreshGames();
    assert.equal(store.getGame(id).timeEvents.at(-1).action, 'setup-pause');
    assert.equal(JSON.parse(data.get('match-tracker.sync-queue.v2')).length, 1);
    // An access-mode change during repository preflight must block the subsequent POST.
    store = open(false, [createGameSyncQueueItem('upsert-game', id, '2026-10-01T10:00:00Z')]);
    store.setGameAccessMode(id, 'edit');
    let release;
    let writes = 0;
    globalThis.fetch = async (_url, options) => {
      if (options.method !== 'GET') writes++;
      return await new Promise(resolve => { release = () => resolve(response([])); });
    };
    const flushing = store.retrySync();
    await new Promise(setImmediate);
    assert.ok(release, 'Repository preflight is in flight');
    store.setGameAccessMode(id, 'view');
    release();
    await flushing;
    assert.equal(writes, 0, 'REST guard rechecks access immediately before sending');
    assert.equal(JSON.parse(data.get('match-tracker.sync-queue.v2')).length, 1);
    // Legacy imported corrections survive normal sync and absent-column fallback.
    const corrected = createBaseGame({id, timerCorrections: {totalMs: 5000, rounds: {'1': 2000}, turns: {'1:1': 1000}}});
    const payload = repository.createSyncedGamePayload(corrected);
    assert.deepEqual(payload.timer_corrections, corrected.timerCorrections);
    assert.deepEqual(repository.mapSupabaseGameToAppGame(payload, []).timerCorrections, corrected.timerCorrections);
    assert.ok(!('timerCorrections' in JSON.parse(payload.notes)), 'Normal notes contain no correction duplicate');
    const imported = repository.createImportedGamePayload(corrected);
    assert.ok(!('timerCorrections' in JSON.parse(imported.notes)), 'Import notes also use the dedicated column');
    const changedCorrections = {...corrected, timerCorrections: {...corrected.timerCorrections, totalMs: 6000}};
    assert.notEqual(repository.getGameSnapshotFingerprint(corrected), repository.getGameSnapshotFingerprint(changedCorrections), 'Corrections participate in snapshot comparison');
    const retryPayloads = [];
    globalThis.fetch = async (url, options) => {
      if (options.method === 'GET') return response([]);
      const body = JSON.parse(options.body);
      retryPayloads.push(body);
      if (retryPayloads.length === 1) return {ok: false, headers: {get: () => null}, text: async () => JSON.stringify({message: "Could not find the 'timer_corrections' column"})};
      return response(body);
    };
    const fallbackGame = await repository.gamesRepository.upsertGameSnapshot(corrected);
    assert.equal(retryPayloads.length, 2);
    assert.ok(!('timerCorrections' in JSON.parse(retryPayloads[0].notes)));
    assert.ok(!('timer_corrections' in retryPayloads[1]));
    const fallbackNotes = JSON.parse(retryPayloads[1].notes);
    assert.deepEqual(fallbackNotes.timerCorrections, corrected.timerCorrections);
    for (const [key, value] of Object.entries(JSON.parse(payload.notes))) assert.deepEqual(fallbackNotes[key], value, 'Fallback preserves other metadata');
    assert.deepEqual(fallbackGame.timerCorrections, corrected.timerCorrections);
    // A missing unrelated column must not duplicate corrections into notes.
    retryPayloads.length = 0;
    globalThis.fetch = async (_url, options) => {
      if (options.method === 'GET') return response([]);
      const body = JSON.parse(options.body);
      retryPayloads.push(body);
      if (retryPayloads.length === 1) return {ok: false, headers: {get: () => null}, text: async () => JSON.stringify({message: "Could not find the 'deployment' column"})};
      return response(body);
    };
    const scenarioFallback = await repository.gamesRepository.upsertGameSnapshot(corrected);
    assert.deepEqual(retryPayloads[1].timer_corrections, corrected.timerCorrections);
    assert.ok(!('timerCorrections' in JSON.parse(retryPayloads[1].notes)));
    assert.deepEqual(scenarioFallback.timerCorrections, corrected.timerCorrections);
    retryPayloads.length = 0;
    globalThis.fetch = async (_url, options) => {
      if (options.method === 'GET') return response([]);
      const body = JSON.parse(options.body);
      retryPayloads.push(body);
      const missing = ['deployment', 'timer_corrections'][retryPayloads.length - 1];
      if (missing) return {ok: false, headers: {get: () => null}, text: async () => JSON.stringify({message: `Could not find the '${missing}' column`})};
      return response(body);
    };
    const legacySchemaFallback = await repository.gamesRepository.upsertGameSnapshot(corrected);
    assert.equal(retryPayloads.length, 3);
    assert.ok(!('timerCorrections' in JSON.parse(retryPayloads[1].notes)));
    assert.deepEqual(JSON.parse(retryPayloads[2].notes).timerCorrections, corrected.timerCorrections);
    assert.deepEqual(legacySchemaFallback.timerCorrections, corrected.timerCorrections);
  } finally {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
};
module.exports = { runGameStoreReadOnlyTests };
