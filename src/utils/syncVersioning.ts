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

// Fehlerbild 16.10. (Falschalarm "Konflikt: Ein anderes Geraet ..."): Ein Neuladen (Realtime/15-s-Takt) las den
// Server vor dem eigenen Schreiben, kam aber erst danach zurueck und setzte die lokale Version wieder zurueck.
// Die naechste Aenderung beruhte dann auf der alten Version und wurde als Konflikt verworfen.
// Versionen steigen auf dem Server nur; ein Serverstand mit kleinerer Version als lokal bekannt ist veraltet
// und darf den lokalen Stand nicht ersetzen. Fremde Aenderungen haben immer eine hoehere Version (Schutz bleibt).
export const isStaleRemoteGame = (
  local: { syncVersion?: number; syncFlowVersion?: number } | undefined,
  remote: { syncVersion?: number; syncFlowVersion?: number }
): boolean => {
  if (!local) return false;
  const lower = (l?: number, r?: number) => typeof l === "number" && typeof r === "number" && r < l;
  return lower(local.syncVersion, remote.syncVersion) || lower(local.syncFlowVersion, remote.syncFlowVersion);
};

export const keepNewerLocalGames = <T extends { id: string; syncVersion?: number; syncFlowVersion?: number }>(
  remoteGames: T[], localGames: T[]
): T[] => {
  const localById = new Map(localGames.map((game) => [game.id, game]));
  return remoteGames.map((remote) => {
    const local = localById.get(remote.id);
    return local && isStaleRemoteGame(local, remote) ? local : remote;
  });
};

// Wiederholtes Senden (Retry nach Netzfehler), obwohl der erste Versuch schon gespeichert war: Der Server meldet
// "noop" (identisches Ereignis existiert) und matched=false, weil unser eigener erster Versuch die Ablauf-Version
// um 1 erhoeht hat. Ist die Serverversion genau Basis + 1, gab es ausser uns keine Aenderung: als eigenes
// Schreiben werten (sonst fiele die naechste Aktion als Konflikt durch). Bei fremden Aenderungen (> Basis + 1) bleibt es ein Konflikt.
export const FLOW_EVENT_TYPES = new Set(["game-start", "game-end", "setup-start", "setup-end", "setup-pause", "setup-resume",
  "round-start", "round-end", "turn-start", "turn-end", "turn-pause", "turn-resume", "timeout-start", "timeout-end"]);
export const resolveOwnRetryResult = (result: SyncRpcResult, baseFlowVersion: number, eventType: string): SyncRpcResult =>
  result.noop && !result.matched && FLOW_EVENT_TYPES.has(eventType) && result.flow_version === baseFlowVersion + 1
    ? { ...result, matched: true } : result;

// Abgleich gegen eigenes Schreiben absichern ("Spiel nicht gefunden" direkt nach dem Anlegen):
// Ein Zaehler steigt bei jedem eigenen Schreiben (Queue-Eintrag abgearbeitet) und beim lokalen Anlegen.
// Hat er sich waehrend eines Ladens geaendert, ist die Antwort evtl. vor dem Speichern gelesen -> verwerfen, neu laden.
export const isPullOutdated = (pullStartGeneration: number, currentGeneration: number): boolean =>
  currentGeneration !== pullStartGeneration;

// Zweite Sicherung: Ein lokal angelegtes Spiel, das in der Serverantwort fehlt, nur verwerfen, wenn das Laden NACH
// dem letzten eigenen Speichern dieses Spiels gestartet wurde (Speicher-Generation <= Start-Generation).
export const keepLocallyCreatedGames = <T extends { id: string }>(
  merged: T[], localGames: T[], lastOwnSaveGeneration: ReadonlyMap<string, number>, pullStartGeneration: number
): T[] => {
  const present = new Set(merged.map((game) => game.id));
  const kept = localGames.filter((game) => !present.has(game.id)
    && (lastOwnSaveGeneration.get(game.id) ?? Number.NEGATIVE_INFINITY) > pullStartGeneration);
  return kept.length ? [...merged, ...kept] : merged;
};
