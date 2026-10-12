"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveHeldGames = exports.loadHeldGames = exports.recordSyncConflict = exports.isTransientSyncError = exports.getSyncErrorMessage = exports.createEventSyncQueueItem = exports.createReopenGameSyncQueueItem = exports.createGameSyncQueueItem = exports.removeSyncQueueItem = exports.enqueueSyncQueueItem = exports.saveSyncQueue = exports.loadSyncQueue = exports.saveCachedGames = exports.loadCachedGames = void 0;
const id_1 = require("./id");
const gameState_1 = require("./gameState");
const supabaseErrors_1 = require("./supabaseErrors");
const GAMES_CACHE_KEY = "match-tracker.local-games.v1";
const SYNC_QUEUE_KEY = "match-tracker.sync-queue.v2";
const isBrowser = typeof window !== "undefined";
const parseJson = (value, fallback) => {
    if (!value) {
        return fallback;
    }
    try {
        return JSON.parse(value);
    }
    catch {
        return fallback;
    }
};
const loadCachedGames = () => {
    if (!isBrowser) {
        return [];
    }
    const rawGames = parseJson(window.localStorage.getItem(GAMES_CACHE_KEY), []);
    return Array.isArray(rawGames)
        ? rawGames
            .map((game) => (0, gameState_1.mapPersistedGame)(game))
            .filter((game) => Boolean(game))
        : [];
};
exports.loadCachedGames = loadCachedGames;
const saveCachedGames = (games) => {
    if (!isBrowser) {
        return;
    }
    window.localStorage.setItem(GAMES_CACHE_KEY, JSON.stringify(games));
};
exports.saveCachedGames = saveCachedGames;
const isSyncQueueItem = (item) => {
    if (!item || typeof item !== "object") {
        return false;
    }
    const candidate = item;
    if (typeof candidate.id !== "string" ||
        typeof candidate.gameId !== "string" ||
        typeof candidate.createdAt !== "string" ||
        typeof candidate.type !== "string" ||
        (candidate.baseVersion !== undefined && typeof candidate.baseVersion !== "number") ||
        (candidate.baseFlowVersion !== undefined && typeof candidate.baseFlowVersion !== "number") ||
        (candidate.batchId !== undefined && typeof candidate.batchId !== "string")) {
        return false;
    }
    if (candidate.type === "upsert-game" || candidate.type === "delete-game") {
        return true;
    }
    if (candidate.type === "reopen-game") {
        return !("gameEndEventId" in candidate) || typeof candidate.gameEndEventId === "string";
    }
    if ((candidate.type === "upsert-event" || candidate.type === "delete-event") &&
        typeof candidate.eventId === "string") {
        return true;
    }
    return false;
};
const loadSyncQueue = () => {
    if (!isBrowser) {
        return [];
    }
    const rawItems = parseJson(window.localStorage.getItem(SYNC_QUEUE_KEY), []);
    return Array.isArray(rawItems) ? rawItems.filter(isSyncQueueItem) : [];
};
exports.loadSyncQueue = loadSyncQueue;
const saveSyncQueue = (queue) => {
    if (!isBrowser) {
        return;
    }
    window.localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
};
exports.saveSyncQueue = saveSyncQueue;
const enqueueSyncQueueItem = (queue, item) => {
    if (item.type === "delete-game") {
        return [...queue.filter((candidate) => candidate.gameId !== item.gameId), item];
    }
    if (item.type === "reopen-game") {
        return [
            item,
            ...queue.filter((candidate) => candidate.gameId !== item.gameId ||
                (candidate.type !== "upsert-game" &&
                    candidate.type !== "reopen-game" &&
                    !(candidate.type === "delete-event" &&
                        item.gameEndEventId &&
                        candidate.eventId === item.gameEndEventId)))
        ];
    }
    if (item.type === "upsert-game") {
        const filteredQueue = queue.filter((candidate) => !(candidate.type === "delete-game" && candidate.gameId === item.gameId));
        return filteredQueue.some((candidate) => candidate.type === "upsert-game" && candidate.gameId === item.gameId)
            ? filteredQueue
            : [...filteredQueue, item];
    }
    if (item.type === "delete-event") {
        const filteredQueue = queue.filter((candidate) => !(candidate.gameId === item.gameId &&
            "eventId" in candidate &&
            candidate.eventId === item.eventId));
        return filteredQueue.some((candidate) => candidate.type === "delete-event" &&
            candidate.gameId === item.gameId &&
            candidate.eventId === item.eventId)
            ? filteredQueue
            : [...filteredQueue, item];
    }
    const filteredQueue = queue.filter((candidate) => !(candidate.gameId === item.gameId &&
        candidate.type === "delete-event" &&
        candidate.eventId === item.eventId));
    return filteredQueue.some((candidate) => candidate.type === "upsert-event" &&
        candidate.gameId === item.gameId &&
        candidate.eventId === item.eventId)
        ? filteredQueue
        : [...filteredQueue, item];
};
exports.enqueueSyncQueueItem = enqueueSyncQueueItem;
const removeSyncQueueItem = (queue, queueItemId) => queue.filter((item) => item.id !== queueItemId);
exports.removeSyncQueueItem = removeSyncQueueItem;
const createGameSyncQueueItem = (type, gameId, createdAt) => ({
    id: (0, id_1.createId)(type),
    type,
    gameId,
    createdAt
});
exports.createGameSyncQueueItem = createGameSyncQueueItem;
const createReopenGameSyncQueueItem = (gameId, createdAt, gameEndEventId) => ({
    id: (0, id_1.createId)("reopen-game"),
    type: "reopen-game",
    gameId,
    createdAt,
    gameEndEventId
});
exports.createReopenGameSyncQueueItem = createReopenGameSyncQueueItem;
const createEventSyncQueueItem = (type, gameId, eventId, createdAt) => ({
    id: (0, id_1.createId)(type),
    type,
    gameId,
    eventId,
    createdAt
});
exports.createEventSyncQueueItem = createEventSyncQueueItem;
const getSyncErrorMessage = (error) => {
    const rawMessage = error instanceof Error ? error.message : "Synchronisierung fehlgeschlagen.";
    return (0, supabaseErrors_1.normalizeSupabaseErrorMessage)(rawMessage);
};
exports.getSyncErrorMessage = getSyncErrorMessage;
const isTransientSyncError = (error) => {
    const rawMessage = error instanceof Error ? error.message : String(error ?? "");
    return (0, supabaseErrors_1.isTransientSupabaseErrorMessage)(rawMessage);
};
exports.isTransientSyncError = isTransientSyncError;
const SYNC_CONFLICTS_KEY = "match-tracker.sync-conflicts.v1";
// Verworfene Aenderungen werden lokal protokolliert (max. 20), damit nichts spurlos verschwindet.
const recordSyncConflict = (entry) => {
    if (!isBrowser) {
        return;
    }
    const existing = parseJson(window.localStorage.getItem(SYNC_CONFLICTS_KEY), []);
    const next = [...(Array.isArray(existing) ? existing : []), entry].slice(-20);
    window.localStorage.setItem(SYNC_CONFLICTS_KEY, JSON.stringify(next));
};
exports.recordSyncConflict = recordSyncConflict;
const HELD_GAMES_KEY = "match-tracker.held-local-games.v1";
// Lokaler Stand von Spielen mit wartenden Aenderungen, solange sie nur angesehen werden
// (Zuschauer/Auswahldialog). Ohne diese Sicherung wuerde der Server-Stand die Queue-Daten ueberschreiben.
const loadHeldGames = () => {
    if (!isBrowser) {
        return {};
    }
    const raw = parseJson(window.localStorage.getItem(HELD_GAMES_KEY), {});
    return Object.fromEntries(Object.entries(raw && typeof raw === "object" ? raw : {})
        .map(([id, value]) => [id, (0, gameState_1.mapPersistedGame)(value)])
        .filter((entry) => Boolean(entry[1])));
};
exports.loadHeldGames = loadHeldGames;
const saveHeldGames = (games) => {
    if (!isBrowser) {
        return;
    }
    if (Object.keys(games).length) {
        window.localStorage.setItem(HELD_GAMES_KEY, JSON.stringify(games));
    }
    else {
        window.localStorage.removeItem?.(HELD_GAMES_KEY);
    }
};
exports.saveHeldGames = saveHeldGames;
