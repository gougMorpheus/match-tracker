import type { Game } from "../types/game";
import { createId } from "./id";
import { mapPersistedGame } from "./gameState";
import { isTransientSupabaseErrorMessage, normalizeSupabaseErrorMessage } from "./supabaseErrors";

const GAMES_CACHE_KEY = "match-tracker.local-games.v1";
export const SYNC_QUEUE_KEY = "match-tracker.sync-queue.v2";

type SyncQueueItemBase = {
  id: string;
  gameId: string;
  createdAt: string;
  // Serverstand, auf dem die lokale Aenderung beruht (games.version / games.flow_version).
  baseVersion?: number;
  baseFlowVersion?: number;
  // Gemeinsame Kennung aller Eintraege einer Benutzeraktion (fuer Konfliktaufloesung als Ganzes).
  batchId?: string;
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
    typeof candidate.type !== "string" ||
    (candidate.baseVersion !== undefined && typeof candidate.baseVersion !== "number") ||
    (candidate.baseFlowVersion !== undefined && typeof candidate.baseFlowVersion !== "number") ||
    (candidate.batchId !== undefined && typeof candidate.batchId !== "string")
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

const SYNC_CONFLICTS_KEY = "match-tracker.sync-conflicts.v1";

// Verworfene Aenderungen werden lokal protokolliert (max. 20), damit nichts spurlos verschwindet.
export const recordSyncConflict = (entry: Record<string, unknown>): void => {
  if (!isBrowser) {
    return;
  }

  const existing = parseJson<unknown[]>(window.localStorage.getItem(SYNC_CONFLICTS_KEY), []);
  const next = [...(Array.isArray(existing) ? existing : []), entry].slice(-20);
  window.localStorage.setItem(SYNC_CONFLICTS_KEY, JSON.stringify(next));
};

const HELD_GAMES_KEY = "match-tracker.held-local-games.v1";

// Lokaler Stand von Spielen mit wartenden Aenderungen, solange sie nur angesehen werden
// (Zuschauer/Auswahldialog). Ohne diese Sicherung wuerde der Server-Stand die Queue-Daten ueberschreiben.
export const loadHeldGames = (): Record<string, Game> => {
  if (!isBrowser) {
    return {};
  }

  const raw = parseJson<Record<string, unknown>>(window.localStorage.getItem(HELD_GAMES_KEY), {});
  return Object.fromEntries(Object.entries(raw && typeof raw === "object" ? raw : {})
    .map(([id, value]) => [id, mapPersistedGame(value)] as const)
    .filter((entry): entry is readonly [string, Game] => Boolean(entry[1])));
};

export const saveHeldGames = (games: Record<string, Game>): void => {
  if (!isBrowser) {
    return;
  }

  if (Object.keys(games).length) {
    window.localStorage.setItem(HELD_GAMES_KEY, JSON.stringify(games));
  } else {
    window.localStorage.removeItem?.(HELD_GAMES_KEY);
  }
};

// Spielzeile nach erfolgreichem Speichern: Hat sich die lokale Spielzeile seit dem Absenden geaendert (z. B. "Weiter"
// waehrend eines langsamen Speicherns -> neue Auto-CP-Markierung), wurde ein neues "upsert-game" als doppelt verworfen.
// Dann den Eintrag behalten und erneut senden, bis der gespeicherte Stand dem lokalen entspricht.
// Schutz gegen Endlosschleifen: hoechstens MAX_GAME_RESENDS Nachsendungen je Durchgang, danach spaeter erneut versuchen.
export const MAX_GAME_RESENDS = 5;
export type SavedGameDecision = "done" | "resend" | "defer";
export const decideAfterGameSave = (sentFingerprint: string, currentFingerprint: string | null, resends: number,
  maxResends = MAX_GAME_RESENDS): SavedGameDecision => {
  if (currentFingerprint === null || currentFingerprint === sentFingerprint) return "done";
  return resends < maxResends ? "resend" : "defer";
};
