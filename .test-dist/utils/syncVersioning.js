"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveOwnRetryResult = exports.FLOW_EVENT_TYPES = exports.keepNewerLocalGames = exports.isStaleRemoteGame = exports.isSameSyncBatch = exports.LEGACY_BATCH_WINDOW_MS = exports.decideBuildUpdate = exports.decideSchemaUpdate = exports.formatConflictNotice = exports.parseSyncConflict = exports.rebaseSyncQueue = exports.getItemBaseFlowVersion = exports.getItemBaseVersion = exports.getQueuedMs = exports.LEGACY_BASE_VERSION = exports.APP_SCHEMA_VERSION = void 0;
// Schema-Stand, den diese App-Version voraussetzt (siehe supabase/migrations/20261012_*).
exports.APP_SCHEMA_VERSION = 2;
// Vor der Migration gespeicherte Spiele/Queue-Eintraege haben keine Version: Basis = Migrationsstand.
exports.LEGACY_BASE_VERSION = 1;
const getQueuedMs = (createdAt, now) => {
    const queuedAt = Date.parse(createdAt);
    if (!Number.isFinite(queuedAt) || !Number.isFinite(now))
        return 0;
    return Math.min(Math.max(0, Math.round(now - queuedAt)), 7 * 24 * 60 * 60 * 1000);
};
exports.getQueuedMs = getQueuedMs;
const getItemBaseVersion = (item) => item.baseVersion ?? exports.LEGACY_BASE_VERSION;
exports.getItemBaseVersion = getItemBaseVersion;
const getItemBaseFlowVersion = (item) => item.baseFlowVersion ?? exports.LEGACY_BASE_VERSION;
exports.getItemBaseFlowVersion = getItemBaseFlowVersion;
// Nach eigenem erfolgreichem Schreiben: wartende Eintraege desselben Spiels auf die neue Version heben,
// aber nur wenn der Server bestaetigt, dass kein fremdes Schreiben dazwischen lag (matched).
const rebaseSyncQueue = (queue, gameId, previous, result) => {
    if (!result.matched)
        return queue;
    return queue.map((item) => {
        if (item.gameId !== gameId)
            return item;
        let next = item;
        if (result.version !== undefined && (0, exports.getItemBaseVersion)(item) === previous.version) {
            next = { ...next, baseVersion: result.version };
        }
        if (result.flow_version !== undefined && (0, exports.getItemBaseFlowVersion)(item) === previous.flowVersion) {
            next = { ...next, baseFlowVersion: result.flow_version };
        }
        return next;
    });
};
exports.rebaseSyncQueue = rebaseSyncQueue;
const parseSyncConflict = (error) => {
    if (error.status !== 409 && error.code !== "PT409" && error.message !== "mt_conflict")
        return null;
    try {
        const details = JSON.parse(error.details ?? "{}");
        return {
            kind: typeof details.kind === "string" ? details.kind : "unknown",
            gameId: typeof details.game_id === "string" ? details.game_id : "",
            expected: typeof details.expected === "number" ? details.expected : null,
            current: typeof details.current === "number" ? details.current : null
        };
    }
    catch {
        return { kind: "unknown", gameId: "", expected: null, current: null };
    }
};
exports.parseSyncConflict = parseSyncConflict;
const formatConflictNotice = (droppedCount) => droppedCount === 1
    ? "Konflikt: Ein anderes Gerät hat dieses Spiel gleichzeitig geändert. 1 lokale Änderung wurde verworfen, der aktuelle Stand ist geladen."
    : `Konflikt: Ein anderes Gerät hat dieses Spiel gleichzeitig geändert. ${droppedCount} lokale Änderungen wurden verworfen, der aktuelle Stand ist geladen.`;
exports.formatConflictNotice = formatConflictNotice;
// Schema-Pruefung: Server verlangt neuere App -> neu laden (einmal je Sitzung), sonst Hinweis.
const decideSchemaUpdate = (minAppSchema, alreadyReloaded) => {
    if (minAppSchema === null || !Number.isFinite(minAppSchema) || minAppSchema <= exports.APP_SCHEMA_VERSION)
        return "ok";
    return alreadyReloaded ? "notice" : "reload";
};
exports.decideSchemaUpdate = decideSchemaUpdate;
// Build-Pruefung: neuer Deploy -> neu laden, aber nie mit ungesyncter Queue.
const decideBuildUpdate = (currentBuild, liveBuild, pendingCount) => {
    if (!liveBuild || !currentBuild || currentBuild === "dev" || liveBuild === currentBuild)
        return "ok";
    return pendingCount > 0 ? "notice" : "reload";
};
exports.decideBuildUpdate = decideBuildUpdate;
// Eintraege derselben Benutzeraktion (z. B. "Weiter" = Zugwechsel + automatische CP) bilden eine Gruppe.
// Aeltere Queue-Eintraege ohne batchId: gleiche Partie und quasi gleichzeitiger Zeitpunkt.
exports.LEGACY_BATCH_WINDOW_MS = 25;
const isSameSyncBatch = (left, right) => {
    if (left.gameId !== right.gameId)
        return false;
    if (left.batchId || right.batchId)
        return left.batchId === right.batchId;
    const delta = Math.abs(Date.parse(left.createdAt) - Date.parse(right.createdAt));
    return Number.isFinite(delta) && delta <= exports.LEGACY_BATCH_WINDOW_MS;
};
exports.isSameSyncBatch = isSameSyncBatch;
// Fehlerbild 16.10. (Falschalarm "Konflikt: Ein anderes Geraet ..."): Ein Neuladen (Realtime/15-s-Takt) las den
// Server vor dem eigenen Schreiben, kam aber erst danach zurueck und setzte die lokale Version wieder zurueck.
// Die naechste Aenderung beruhte dann auf der alten Version und wurde als Konflikt verworfen.
// Versionen steigen auf dem Server nur; ein Serverstand mit kleinerer Version als lokal bekannt ist veraltet
// und darf den lokalen Stand nicht ersetzen. Fremde Aenderungen haben immer eine hoehere Version (Schutz bleibt).
const isStaleRemoteGame = (local, remote) => {
    if (!local)
        return false;
    const lower = (l, r) => typeof l === "number" && typeof r === "number" && r < l;
    return lower(local.syncVersion, remote.syncVersion) || lower(local.syncFlowVersion, remote.syncFlowVersion);
};
exports.isStaleRemoteGame = isStaleRemoteGame;
const keepNewerLocalGames = (remoteGames, localGames) => {
    const localById = new Map(localGames.map((game) => [game.id, game]));
    return remoteGames.map((remote) => {
        const local = localById.get(remote.id);
        return local && (0, exports.isStaleRemoteGame)(local, remote) ? local : remote;
    });
};
exports.keepNewerLocalGames = keepNewerLocalGames;
// Wiederholtes Senden (Retry nach Netzfehler), obwohl der erste Versuch schon gespeichert war: Der Server meldet
// "noop" (identisches Ereignis existiert) und matched=false, weil unser eigener erster Versuch die Ablauf-Version
// um 1 erhoeht hat. Ist die Serverversion genau Basis + 1, gab es ausser uns keine Aenderung: als eigenes
// Schreiben werten (sonst fiele die naechste Aktion als Konflikt durch). Bei fremden Aenderungen (> Basis + 1) bleibt es ein Konflikt.
exports.FLOW_EVENT_TYPES = new Set(["game-start", "game-end", "setup-start", "setup-end", "setup-pause", "setup-resume",
    "round-start", "round-end", "turn-start", "turn-end", "turn-pause", "turn-resume", "timeout-start", "timeout-end"]);
const resolveOwnRetryResult = (result, baseFlowVersion, eventType) => result.noop && !result.matched && exports.FLOW_EVENT_TYPES.has(eventType) && result.flow_version === baseFlowVersion + 1
    ? { ...result, matched: true } : result;
exports.resolveOwnRetryResult = resolveOwnRetryResult;
