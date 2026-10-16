import type { SyncQueueItem } from "./localSync";

// Schema-Stand, den diese App-Version voraussetzt (siehe supabase/migrations/20261012_*).
export const APP_SCHEMA_VERSION = 2;
// Vor der Migration gespeicherte Spiele/Queue-Eintraege haben keine Version: Basis = Migrationsstand.
export const LEGACY_BASE_VERSION = 1;

export interface SyncRpcResult {
  matched: boolean;
  version?: number;
  flow_version?: number;
  noop?: boolean;
}

export interface SyncConflictInfo {
  kind: string;
  gameId: string;
  expected: number | null;
  current: number | null;
}

export const getQueuedMs = (createdAt: string, now: number): number => {
  const queuedAt = Date.parse(createdAt);
  if (!Number.isFinite(queuedAt) || !Number.isFinite(now)) return 0;
  return Math.min(Math.max(0, Math.round(now - queuedAt)), 7 * 24 * 60 * 60 * 1000);
};

export const getItemBaseVersion = (item: SyncQueueItem): number => item.baseVersion ?? LEGACY_BASE_VERSION;
export const getItemBaseFlowVersion = (item: SyncQueueItem): number => item.baseFlowVersion ?? LEGACY_BASE_VERSION;

// Nach eigenem erfolgreichem Schreiben: wartende Eintraege desselben Spiels auf die neue Version heben,
// aber nur wenn der Server bestaetigt, dass kein fremdes Schreiben dazwischen lag (matched).
export const rebaseSyncQueue = (
  queue: SyncQueueItem[],
  gameId: string,
  previous: { version: number; flowVersion: number },
  result: SyncRpcResult
): SyncQueueItem[] => {
  if (!result.matched) return queue;
  return queue.map((item) => {
    if (item.gameId !== gameId) return item;
    let next = item;
    if (result.version !== undefined && getItemBaseVersion(item) === previous.version) {
      next = { ...next, baseVersion: result.version };
    }
    if (result.flow_version !== undefined && getItemBaseFlowVersion(item) === previous.flowVersion) {
      next = { ...next, baseFlowVersion: result.flow_version };
    }
    return next;
  });
};

export const parseSyncConflict = (error: { status?: number; code?: string; details?: string | null; message?: string }):
  SyncConflictInfo | null => {
  if (error.status !== 409 && error.code !== "PT409" && error.message !== "mt_conflict") return null;
  try {
    const details = JSON.parse(error.details ?? "{}") as Record<string, unknown>;
    return {
      kind: typeof details.kind === "string" ? details.kind : "unknown",
      gameId: typeof details.game_id === "string" ? details.game_id : "",
      expected: typeof details.expected === "number" ? details.expected : null,
      current: typeof details.current === "number" ? details.current : null
    };
  } catch {
    return { kind: "unknown", gameId: "", expected: null, current: null };
  }
};

export const formatConflictNotice = (droppedCount: number): string =>
  droppedCount === 1
    ? "Konflikt: Ein anderes Gerät hat dieses Spiel gleichzeitig geändert. 1 lokale Änderung wurde verworfen, der aktuelle Stand ist geladen."
    : `Konflikt: Ein anderes Gerät hat dieses Spiel gleichzeitig geändert. ${droppedCount} lokale Änderungen wurden verworfen, der aktuelle Stand ist geladen.`;

export type AppUpdateDecision = "ok" | "reload" | "notice";

// Schema-Pruefung: Server verlangt neuere App -> neu laden (einmal je Sitzung), sonst Hinweis.
export const decideSchemaUpdate = (minAppSchema: number | null, alreadyReloaded: boolean): AppUpdateDecision => {
  if (minAppSchema === null || !Number.isFinite(minAppSchema) || minAppSchema <= APP_SCHEMA_VERSION) return "ok";
  return alreadyReloaded ? "notice" : "reload";
};

// Build-Pruefung: neuer Deploy -> neu laden, aber nie mit ungesyncter Queue.
export const decideBuildUpdate = (currentBuild: string, liveBuild: string | null, pendingCount: number): AppUpdateDecision => {
  if (!liveBuild || !currentBuild || currentBuild === "dev" || liveBuild === currentBuild) return "ok";
  return pendingCount > 0 ? "notice" : "reload";
};

// Eintraege derselben Benutzeraktion (z. B. "Weiter" = Zugwechsel + automatische CP) bilden eine Gruppe.
// Aeltere Queue-Eintraege ohne batchId: gleiche Partie und quasi gleichzeitiger Zeitpunkt.
export const LEGACY_BATCH_WINDOW_MS = 25;

export const isSameSyncBatch = (
  left: { gameId: string; batchId?: string; createdAt: string },
  right: { gameId: string; batchId?: string; createdAt: string }
): boolean => {
  if (left.gameId !== right.gameId) return false;
  if (left.batchId || right.batchId) return left.batchId === right.batchId;
  const delta = Math.abs(Date.parse(left.createdAt) - Date.parse(right.createdAt));
  return Number.isFinite(delta) && delta <= LEGACY_BATCH_WINDOW_MS;
};
