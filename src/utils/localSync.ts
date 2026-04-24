import type { Game } from "../types/game";
import { createId } from "./id";
import { normalizeSupabaseErrorMessage } from "./supabaseErrors";
import { mapPersistedGame } from "./gameState";

const GAMES_CACHE_KEY = "match-tracker.local-games.v1";
const SYNC_QUEUE_KEY = "match-tracker.sync-queue.v1";

export interface SyncQueueItem {
  id: string;
  type: "upsert-game" | "delete-game";
  gameId: string;
  createdAt: string;
}

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

export const loadSyncQueue = (): SyncQueueItem[] => {
  if (!isBrowser) {
    return [];
  }

  const rawItems = parseJson<SyncQueueItem[]>(window.localStorage.getItem(SYNC_QUEUE_KEY), []);
  return Array.isArray(rawItems)
    ? rawItems.filter(
        (item) =>
          item &&
          typeof item.id === "string" &&
          typeof item.gameId === "string" &&
          (item.type === "upsert-game" || item.type === "delete-game")
      )
    : [];
};

export const saveSyncQueue = (queue: SyncQueueItem[]): void => {
  if (!isBrowser) {
    return;
  }

  window.localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
};

export const createSyncQueueItem = (
  type: SyncQueueItem["type"],
  gameId: string,
  createdAt: string
): SyncQueueItem => ({
  id: createId(type),
  type,
  gameId,
  createdAt
});

export const getSyncErrorMessage = (error: unknown): string => {
  const rawMessage = error instanceof Error ? error.message : "Synchronisierung fehlgeschlagen.";
  return normalizeSupabaseErrorMessage(rawMessage);
};
