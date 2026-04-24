import type { Game } from "../types/game";
import { createId } from "./id";
import { mapPersistedGame } from "./gameState";
import { normalizeSupabaseErrorMessage } from "./supabaseErrors";

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
