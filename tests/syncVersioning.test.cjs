const assert = require('node:assert/strict');
const { loadBrowserModule } = require('./helpers/loadBrowserModule.cjs');
const { createBaseGame } = require('./helpers/gameFixtures.cjs');
const sv = require('../.test-dist/utils/syncVersioning.js');
const { createGameSyncQueueItem, createEventSyncQueueItem } = require('../.test-dist/utils/localSync.js');

const runSyncVersioningTests = async () => {
  // Wartezeit in der Queue: relativ, geklemmt, robust gegen kaputte Zeiten
  assert.equal(sv.getQueuedMs('2026-10-12T10:00:00.000Z', Date.parse('2026-10-12T10:00:05.000Z')), 5000);
  assert.equal(sv.getQueuedMs('2026-10-12T10:00:10.000Z', Date.parse('2026-10-12T10:00:05.000Z')), 0);
  assert.equal(sv.getQueuedMs('kaputt', Date.now()), 0);
  assert.equal(sv.getQueuedMs('2020-01-01T00:00:00Z', Date.parse('2026-01-01T00:00:00Z')), 7 * 24 * 3600 * 1000);

  // Altdaten ohne Basis -> Migrationsstand 1
  const legacy = createGameSyncQueueItem('upsert-game', 'g1', '2026-10-12T10:00:00Z');
  assert.equal(sv.getItemBaseVersion(legacy), 1);
  assert.equal(sv.getItemBaseFlowVersion(legacy), 1);

  // Rebase nur bei bestaetigtem eigenem Schreiben und nur fuer Eintraege mit gleicher Basis
  const queue = [
    { ...createEventSyncQueueItem('upsert-event', 'g1', 'e1', 'x'), baseVersion: 3, baseFlowVersion: 5 },
    { ...createEventSyncQueueItem('upsert-event', 'g1', 'e2', 'x'), baseVersion: 3, baseFlowVersion: 4 },
    { ...createEventSyncQueueItem('upsert-event', 'g2', 'e3', 'x'), baseVersion: 3, baseFlowVersion: 5 }
  ];
  const rebased = sv.rebaseSyncQueue(queue, 'g1', { version: 3, flowVersion: 5 }, { matched: true, version: 3, flow_version: 6 });
  assert.equal(rebased[0].baseFlowVersion, 6);
  assert.equal(rebased[1].baseFlowVersion, 4, 'veraltete Basis bleibt veraltet');
  assert.equal(rebased[2].baseFlowVersion, 5, 'anderes Spiel unveraendert');
  assert.equal(sv.rebaseSyncQueue(queue, 'g1', { version: 3, flowVersion: 5 }, { matched: false, flow_version: 9 }), queue);

  // 409-Erkennung
  const conflict = sv.parseSyncConflict({ status: 409, code: 'PT409', message: 'mt_conflict',
    details: JSON.stringify({ kind: 'flow', game_id: 'g1', expected: 2, current: 3 }) });
  assert.deepEqual(conflict, { kind: 'flow', gameId: 'g1', expected: 2, current: 3 });
  assert.equal(sv.parseSyncConflict({ status: 401, message: 'permission denied' }), null);
  assert.match(sv.formatConflictNotice(2), /2 lokale Aenderungen/);

  // Aktionsgruppen
  assert.ok(sv.isSameSyncBatch({ gameId: 'g', batchId: 'b1', createdAt: 'x' }, { gameId: 'g', batchId: 'b1', createdAt: 'y' }));
  assert.ok(!sv.isSameSyncBatch({ gameId: 'g', batchId: 'b1', createdAt: 'x' }, { gameId: 'g', batchId: 'b2', createdAt: 'x' }));
  assert.ok(!sv.isSameSyncBatch({ gameId: 'g', batchId: 'b1', createdAt: 'x' }, { gameId: 'h', batchId: 'b1', createdAt: 'x' }));
  assert.ok(sv.isSameSyncBatch({ gameId: 'g', createdAt: '2026-10-12T10:00:00.000Z' }, { gameId: 'g', createdAt: '2026-10-12T10:00:00.010Z' }));
  assert.ok(!sv.isSameSyncBatch({ gameId: 'g', createdAt: '2026-10-12T10:00:00.000Z' }, { gameId: 'g', createdAt: '2026-10-12T10:00:00.300Z' }));

  // Update-Entscheidungen
  assert.equal(sv.decideSchemaUpdate(2, false), 'ok');
  assert.equal(sv.decideSchemaUpdate(3, false), 'reload');
  assert.equal(sv.decideSchemaUpdate(3, true), 'notice');
  assert.equal(sv.decideSchemaUpdate(null, false), 'ok');
  assert.equal(sv.decideBuildUpdate('a', 'a', 0), 'ok');
  assert.equal(sv.decideBuildUpdate('a', 'b', 0), 'reload');
  assert.equal(sv.decideBuildUpdate('a', 'b', 2), 'notice');
  assert.equal(sv.decideBuildUpdate('dev', 'b', 0), 'ok');

  // Store: 409 verwirft nur die betroffene Aenderung, haelt Hinweis, schreibt weiter; Erfolg hebt Basis an.
  const saved = Object.fromEntries(['window', 'navigator', 'document', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    const id = '11111111-1111-4111-8111-111111111111';
    const data = new Map();
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
    globalThis.window = { location: { hash: `#/game/${id}`, search: '' }, localStorage: {
      getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) } };
    globalThis.document = { hidden: false };
    let context;
    const states = [];
    const react = {
      createContext: () => ({ Provider: 'provider' }), useContext: () => context,
      useState: initial => { const cell = [typeof initial === 'function' ? initial() : initial]; states.push(cell);
        return [cell[0], v => { cell[0] = typeof v === 'function' ? v(cell[0]) : v; }]; },
      useRef: current => ({ current }), useCallback: fn => fn, useMemo: fn => fn(), useEffect: () => {}
    };
    const jsx = (_, props) => { context = props.value; return null; };
    const module = loadBrowserModule('src/store/GameStore.tsx', { react, 'react/jsx-runtime': { jsx, jsxs: jsx } });
    const game = { ...createBaseGame({ id }), syncVersion: 4, syncFlowVersion: 7 };
    data.set('match-tracker.local-games.v1', JSON.stringify([game]));
    data.set('match-tracker.sync-queue.v2', JSON.stringify([
      { ...createGameSyncQueueItem('upsert-game', id, '2026-10-01T10:00:00Z'), baseVersion: 3, baseFlowVersion: 7 },
      { ...createEventSyncQueueItem('delete-event', id, 'ev-x', '2026-10-01T10:00:01Z'), baseVersion: 4, baseFlowVersion: 7 }
    ]));
    module.GameStoreProvider({ children: null });
    const store = context;
    store.setGameAccessMode(id, 'edit');
    const calls = [];
    const ok = value => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(value) });
    globalThis.fetch = async (url, options) => {
      if (options.method === 'GET') return ok([]);
      const body = JSON.parse(options.body);
      calls.push([String(url).split('/rpc/')[1], body]);
      if (String(url).endsWith('mt_save_game')) {
        return { ok: false, status: 409, headers: { get: () => null }, text: async () => JSON.stringify({
          code: 'PT409', message: 'mt_conflict', details: JSON.stringify({ kind: 'game', game_id: id, expected: 3, current: 5 }) }) };
      }
      return ok({ matched: true, version: 4, flow_version: 8 });
    };
    await store.retrySync();
    assert.deepEqual(calls.map(c => c[0]), ['mt_save_game', 'mt_revoke_event']);
    assert.equal(calls[0][1].p_expected_version, 3, 'Basis aus dem Queue-Eintrag');
    assert.equal(calls[1][1].p_expected_flow, 7);
    assert.equal(JSON.parse(data.get('match-tracker.sync-queue.v2')).length, 0, 'Queue leer');
    const conflicts = JSON.parse(data.get('match-tracker.sync-conflicts.v1'));
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].conflict.kind, 'game');
    assert.ok(states.some(cell => typeof cell[0] === 'string' && /Konflikt/.test(cell[0])), 'Hinweis gesetzt');
  } finally {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
};
module.exports = { runSyncVersioningTests };
