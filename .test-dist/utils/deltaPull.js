"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLiveViewPause = exports.liveViewBlocksLoad = exports.shouldLiveViewFollowRealtime = exports.LIVE_VIEW_IDLE_MS = exports.getPollIntervalMs = exports.getRealtimeGameId = exports.RemoteGameCache = exports.getLastActivityMs = exports.shouldFullPullOnResume = exports.RESUME_FULL_AFTER_HIDDEN_MS = exports.FULL_EVENTS_WINDOW_MS = exports.ACTIVE_WINDOW_MS = exports.FULL_PULL_INTERVAL_MS = void 0;
const supabaseGameMapping_1 = require("./supabaseGameMapping");
// Delta-Abgleich (#679, Egress): Statt bei jedem Abgleich alle Spiele mit allen Events zu laden, wird eine schlanke
// Liste (id, version, flow_version; geloeschte schon serverseitig gefiltert) geholt. Volle Zeilen bzw. Events nur fuer
// - neue Spiele und Spiele mit geaenderter version (mt_save_game, mt_delete_game) bzw. flow_version (Ablauf-Events, Restore),
// - als "dirty" markierte Spiele: eigenes Schreiben (jede RPC, auch Nicht-Ablauf-Events wie CP/Punkte/Notizen, die die
//   Versionen NICHT erhoehen) und Realtime-Meldungen mit game_id,
// - aktive Spiele (letzte Aktivitaet < ACTIVE_WINDOW_MS): faengt Revoke von Nicht-Ablauf-Events ab. Die sind fuer anon
//   per RLS unsichtbar (kein Realtime) und erhoehen keine Version.
// - Sicherheitsnetz: Vollabzug spaetestens alle FULL_PULL_INTERVAL_MS, beim Start, bei Rueckkehr in den Tab (nur nach mehr
//   als RESUME_FULL_AFTER_HIDDEN_MS im Hintergrund), online und nach (Wieder-)Verbindung von Realtime.
// - Vollabzug (Egress, 19.10.): alle Spielzeilen, Events aber nur fuer Spiele mit Aktivitaet < FULL_EVENTS_WINDOW_MS sowie
//   neue/geaenderte/markierte Spiele. Aeltere Spiele behalten die Events aus dem Cache (Grenze: Revoke eines
//   Nicht-Ablauf-Events in einem aelteren Spiel ohne Versionserhoehung erscheint erst nach Neustart der App).
// Ein Spiel, das in der schlanken Liste fehlt, gilt als geloescht (wie zuvor: geloeschte wurden clientseitig gefiltert).
// Der Cache haelt nur SERVER-Stände; die Zusammenfuehrung mit lokalen Aenderungen (Queue, #25, #26) bleibt unveraendert.
exports.FULL_PULL_INTERVAL_MS = 30 * 60 * 1000;
exports.ACTIVE_WINDOW_MS = 12 * 60 * 60 * 1000;
exports.FULL_EVENTS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
exports.RESUME_FULL_AFTER_HIDDEN_MS = 5 * 60 * 1000;
// Rueckkehr in den Vordergrund: Vollabzug nur nach laengerer Zeit im Hintergrund (unbekannt -> sicherheitshalber ja).
const shouldFullPullOnResume = (hiddenSinceMs, now) => hiddenSinceMs === null || now - hiddenSinceMs > exports.RESUME_FULL_AFTER_HIDDEN_MS;
exports.shouldFullPullOnResume = shouldFullPullOnResume;
const toMs = (value) => {
    const ms = value ? Date.parse(value) : NaN;
    return Number.isFinite(ms) ? ms : 0;
};
const getLastActivityMs = (entry) => {
    let last = Math.max(toMs(entry.row.created_at), toMs(entry.row.started_at), toMs(entry.row.ended_at));
    for (const event of entry.events)
        last = Math.max(last, toMs(event.created_at), toMs(event.occurred_at));
    return last;
};
exports.getLastActivityMs = getLastActivityMs;
class RemoteGameCache {
    constructor() {
        this.entries = new Map();
        this.dirty = new Map();
        this.markSeq = 0;
        this.fullSeq = 1;
        this.fullDoneSeq = 0;
        this.lastFullAt = 0;
        this.chain = Promise.resolve();
    }
    // Abgleiche nacheinander: eine aeltere Antwort darf den Cache nicht nach einer neueren ueberschreiben.
    exclusive(task) {
        const run = this.chain.then(task, task);
        this.chain = run.catch(() => undefined);
        return run;
    }
    markDirty(gameId) { this.dirty.set(gameId, ++this.markSeq); }
    requestFull() { this.fullSeq += 1; }
    isDirty(gameId) { return this.dirty.has(gameId); }
    isFullRequested() { return this.fullSeq > this.fullDoneSeq; }
    plan(slim, now) {
        const full = this.isFullRequested() || !this.lastFullAt || now - this.lastFullAt >= exports.FULL_PULL_INTERVAL_MS;
        const unchangedTombstone = (row) => {
            const entry = this.entries.get(row.id);
            return Boolean(entry?.deleted && entry.row.version === row.version && entry.row.flow_version === row.flow_version);
        };
        if (full) {
            // Events nur fuer nicht geloeschte Spiele, die neu/geaendert/markiert sind oder Aktivitaet < FULL_EVENTS_WINDOW_MS haben.
            const needsEvents = (row) => {
                if (unchangedTombstone(row))
                    return false;
                const entry = this.entries.get(row.id);
                if (!entry || entry.deleted || entry.row.version !== row.version || entry.row.flow_version !== row.flow_version)
                    return true;
                return this.dirty.has(row.id) || now - (0, exports.getLastActivityMs)(entry) < exports.FULL_EVENTS_WINDOW_MS;
            };
            return { full, rowIds: slim.map((row) => row.id), eventIds: slim.filter(needsEvents).map((row) => row.id),
                dirtyMark: this.markSeq, fullMark: this.fullSeq };
        }
        const rowIds = [];
        const eventIds = [];
        for (const row of slim) {
            const entry = this.entries.get(row.id);
            const changed = !entry || entry.row.version !== row.version || entry.row.flow_version !== row.flow_version;
            if (changed)
                rowIds.push(row.id);
            if (!changed && entry.deleted)
                continue;
            if (changed || this.dirty.has(row.id) || now - (0, exports.getLastActivityMs)(entry) < exports.ACTIVE_WINDOW_MS)
                eventIds.push(row.id);
        }
        return { full, rowIds, eventIds, dirtyMark: this.markSeq, fullMark: this.fullSeq };
    }
    // Antwort uebernehmen. Markierungen, die WAEHREND des Ladens gesetzt wurden (spaeter als dirtyMark), bleiben bestehen.
    apply(slim, plan, rows, events, now) {
        const rowById = new Map(rows.map((row) => [row.id, row]));
        const eventsById = new Map(plan.eventIds.map((id) => [id, []]));
        events.forEach((event) => eventsById.get(event.game_id)?.push(event));
        const next = new Map();
        for (const { id } of slim) {
            const previous = this.entries.get(id);
            const row = rowById.get(id) ?? (plan.rowIds.includes(id) ? undefined : previous?.row);
            if (!row)
                continue;
            if ((0, supabaseGameMapping_1.isSupabaseGameDeleted)(row)) {
                next.set(id, { row, events: [], deleted: true });
                continue;
            }
            const fetchedEvents = eventsById.get(id);
            if (!fetchedEvents && !previous)
                continue;
            next.set(id, { row, events: fetchedEvents ?? (previous.deleted ? [] : previous.events) });
        }
        this.entries = next;
        for (const id of plan.eventIds)
            if ((this.dirty.get(id) ?? 0) <= plan.dirtyMark)
                this.dirty.delete(id);
        for (const id of [...this.dirty.keys()])
            if (!next.has(id) && !slim.some((row) => row.id === id))
                this.dirty.delete(id);
        if (plan.full) {
            this.lastFullAt = now;
            this.fullDoneSeq = Math.max(this.fullDoneSeq, plan.fullMark);
        }
    }
    // Reihenfolge der schlanken Liste (created_at absteigend) = Reihenfolge des frueheren Vollabzugs.
    list(slim) {
        return slim.map((row) => this.entries.get(row.id)).filter((entry) => Boolean(entry && !entry.deleted));
    }
}
exports.RemoteGameCache = RemoteGameCache;
// Realtime-Payload (postgres_changes): betroffenes Spiel bestimmen. null = unbekannt -> Vollabzug.
const getRealtimeGameId = (change) => {
    if (!change || typeof change !== "object")
        return null;
    const data = change;
    const record = data.record ?? data.new ?? data.old_record ?? data.old ?? null;
    if (!record)
        return null;
    const value = data.table === "games" ? record.id : record.game_id;
    return typeof value === "string" && value ? value : null;
};
exports.getRealtimeGameId = getRealtimeGameId;
// Abgleich-Takt: mit verbundenem Realtime seltener (Aenderungen kommen per Payload), sonst wie bisher 15 s.
const getPollIntervalMs = (realtimeConnected, liveGameView) => liveGameView ? (realtimeConnected ? 30000 : 10000) : (realtimeConnected ? 60000 : 15000);
exports.getPollIntervalMs = getPollIntervalMs;
// Live-Ansicht (View only/TV): nach Spielende oder 15 min ohne neues Event anhalten.
exports.LIVE_VIEW_IDLE_MS = 15 * 60 * 1000;
// Realtime in der Live-Ansicht: nur das eigene gezeigte Spiel. Bei "idle" angehalten; bei "ended" weiter durchlassen,
// damit z. B. ein Undo des Spielendes das Spiel neu laedt und die Pause aufhebt (nur bei echten Aenderungen, kaum Verkehr).
const shouldLiveViewFollowRealtime = (liveGameId, changeGameId, pause) => changeGameId === liveGameId && pause !== "idle";
exports.shouldLiveViewFollowRealtime = shouldLiveViewFollowRealtime;
// Laden der Live-Ansicht: nur "idle" sperrt (bis "Weiter live"); bei "ended" laden Realtime/Rueckkehr das Spiel einmal neu.
const liveViewBlocksLoad = (pause) => pause === "idle";
exports.liveViewBlocksLoad = liveViewBlocksLoad;
const getLiveViewPause = (entry, liveSinceMs, now) => {
    if (!entry)
        return null;
    if (entry.row.ended_at)
        return "ended";
    let last = liveSinceMs;
    for (const event of entry.events)
        last = Math.max(last, toMs(event.created_at), toMs(event.occurred_at));
    return now - last >= exports.LIVE_VIEW_IDLE_MS ? "idle" : null;
};
exports.getLiveViewPause = getLiveViewPause;
