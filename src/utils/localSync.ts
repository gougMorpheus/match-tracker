import type { Game } from "../types/game";
import { createId } from "./id";
import { mapPersistedGame } from "./gameState";
import { isTransientSupabaseErrorMessage, normalizeSupabaseErrorMessage } from "./supabaseErrors";

const GAMES_CACHE_KEY = "match-tracker.local-games.v1";
const SYNC_QUEUE_KEY = "match-tracker.sync-queue.v2";

type SyncQueueItemBase = {
  id: string;
  gameId: string;
  createdAt: string;
};

export type SyncQueueItem =
  | (SyncQueueItemBase & {
      type: "upsert-game";
    })
  | (SyncQueueItemBase & {
      type: "delete-game";
    })
  | (SyncQueueItemBase & {
      type: "reopen-game";
      gameEndEventId?: string;
    })
  | (SyncQueueItemBase & {
      type: "upsert-event";
      eventId: string;
    })
  | (SyncQueueItemBase & {
      type: "delete-event";
      eventId: string;
    });

const isBrowser = typeof window !== "undefined";

const parseJson = <T>(value: string | null, fallback: T): T => {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export const loadCachedGames = (): Game[] => {
  if (!isBrowser) {
    return [];
  }

  const rawGames = parseJson<unknown[]>(window.localStorage.getItem(GAMES_CACHE_KEY), []);
  return Array.isArray(rawGames)
    ? rawGames
        .map((game) => mapPersistedGame(game))
        .filter((game): game is Game => Boolean(game))
    : [];
};

export const saveCachedGames = (games: Game[]): void => {
  if (!isBrowser) {
    return;
  }

  window.localStorage.setItem(GAMES_CACHE_KEY, JSON.stringify(games));
};

const isSyncQueueItem = (item: unknown): item is SyncQueueItem => {
  if (!item || typeof item !== "object") {
    return false;
  }

  const candidate = item as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.gameId !== "string" ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.type !== "string"
  ) {
    return false;
  }

  if (candidate.type === "upsert-game" || candidate.type === "delete-game") {
    return true;
  }

  if (candidate.type === "reopen-game") {
    return !("gameEndEventId" in candidate) || typeof candidate.gameEndEventId === "string";
  }

  if (
    (candidate.type === "upsert-event" || candidate.type === "delete-event") &&
    typeof candidate.eventId === "string"
  ) {
    return true;
  }

  return false;
};

export const loadSyncQueue = (): SyncQueueItem[] => {
  if (!isBrowser) {
    return [];
  }

  const rawItems = parseJson<unknown[]>(window.localStorage.getItem(SYNC_QUEUE_KEY), []);
  return Array.isArray(rawItems) ? rawItems.filter(isSyncQueueItem) : [];
};

export const saveSyncQueue = (queue: SyncQueueItem[]): void => {
  if (!isBrowser) {
    return;
  }

  window.localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
};

export const enqueueSyncQueueItem = (
  queue: SyncQueueItem[],
  item: SyncQueueItem
): SyncQueueItem[] => {
  if (item.type === "delete-game") {
    return [...queue.filter((candidate) => candidate.gameId !== item.gameId), item];
  }

  if (item.type === "reopen-game") {
    return [
      item,
      ...queue.filter(
        (candidate) =>
          candidate.gameId !== item.gameId ||
          (
            candidate.type !== "upsert-game" &&
            candidate.type !== "reopen-game" &&
            !(
              candidate.type === "delete-event" &&
              item.gameEndEventId &&
              candidate.eventId === item.gameEndEventId
            )
          )
      )
    ];
  }

  if (item.type === "upsert-game") {
    const filteredQueue = queue.filter(
      (candidate) => !(candidate.type === "delete-game" && candidate.gameId === item.gameId)
    );

    return filteredQueue.some(
      (candidate) => candidate.type === "upsert-game" && candidate.gameId === item.gameId
    )
      ? filteredQueue
      : [...filteredQueue, item];
  }

  if (item.type === "delete-event") {
    const filteredQueue = queue.filter(
      (candidate) =>
        !(
          candidate.gameId === item.gameId &&
          "eventId" in candidate &&
          candidate.eventId === item.eventId
        )
    );

    return filteredQueue.some(
      (candidate) =>
        candidate.type === "delete-event" &&
        candidate.gameId === item.gameId &&
        candidate.eventId === item.eventId
    )
      ? filteredQueue
      : [...filteredQueue, item];
  }

  const filteredQueue = queue.filter(
    (candidate) =>
      !(
        candidate.gameId === item.gameId &&
        candidate.type === "delete-event" &&
        candidate.eventId === item.eventId
      )
  );

  return filteredQueue.some(
    (candidate) =>
      candidate.type === "upsert-event" &&
      candidate.gameId === item.gameId &&
      candidate.eventId === item.eventId
  )
    ? filteredQueue
    : [...filteredQueue, item];
};

export const removeSyncQueueItem = (
  queue: SyncQueueItem[],
  queueItemId: string
): SyncQueueItem[] => queue.filter((item) => item.id !== queueItemId);

export const createGameSyncQueueItem = (
  type: "upsert-game" | "delete-game",
  gameId: string,
  createdAt: string
): SyncQueueItem => ({
  id: createId(type),
  type,
  gameId,
  createdAt
});

export const createReopenGameSyncQueueItem = (
  gameId: string,
  createdAt: string,
  gameEndEventId?: string
): SyncQueueItem => ({
  id: createId("reopen-game"),
  type: "reopen-game",
  gameId,
  createdAt,
  gameEndEventId
});

export const createEventSyncQueueItem = (
  type: "upsert-event" | "delete-event",
  gameId: string,
  eventId: string,
  createdAt: string
): SyncQueueItem => ({
  id: createId(type),
  type,
  gameId,
  eventId,
  createdAt
});

export const getSyncErrorMessage = (error: unknown): string => {
  const rawMessage = error instanceof Error ? error.message : "Synchronisierung fehlgeschlagen.";
  return normalizeSupabaseErrorMessage(rawMessage);
};

export const isTransientSyncError = (error: unknown): boolean => {
  const rawMessage = error instanceof Error ? error.message : String(error ?? "");
  return isTransientSupabaseErrorMessage(rawMessage);
};
