import { isSupabaseGameDeleted, type SupabaseEventRecord, type SupabaseGameRecord } from "./supabaseGameMapping";

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

export const FULL_PULL_INTERVAL_MS = 30 * 60 * 1000;
export const ACTIVE_WINDOW_MS = 12 * 60 * 60 * 1000;
export const FULL_EVENTS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const RESUME_FULL_AFTER_HIDDEN_MS = 5 * 60 * 1000;

// Rueckkehr in den Vordergrund: Vollabzug nur nach laengerer Zeit im Hintergrund (unbekannt -> sicherheitshalber ja).
export const shouldFullPullOnResume = (hiddenSinceMs: number | null, now: number): boolean =>
  hiddenSinceMs === null || now - hiddenSinceMs > RESUME_FULL_AFTER_HIDDEN_MS;

export interface SlimGameRow { id: string; version: number | null; flow_version: number | null }
// deleted: alte Loeschung nur in notes.deletedMeta (deleted_at leer) -> Platzhalter, damit sie nicht jedes Mal neu geladen wird.
export interface RemoteGameEntry { row: SupabaseGameRecord; events: SupabaseEventRecord[]; deleted?: boolean }
export interface DeltaPlan { full: boolean; rowIds: string[]; eventIds: string[]; dirtyMark: number; fullMark: number }

const toMs = (value: string | null | undefined): number => {
  const ms = value ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? ms : 0;
};

export const getLastActivityMs = (entry: RemoteGameEntry): number => {
  let last = Math.max(toMs(entry.row.created_at), toMs(entry.row.started_at), toMs(entry.row.ended_at));
  for (const event of entry.events) last = Math.max(last, toMs(event.created_at), toMs(event.occurred_at));
  return last;
};

export class RemoteGameCache {
  entries = new Map<string, RemoteGameEntry>();
  private dirty = new Map<string, number>();
  private markSeq = 0;
  private fullSeq = 1;
  private fullDoneSeq = 0;
  lastFullAt = 0;
  private chain: Promise<unknown> = Promise.resolve();

  // Abgleiche nacheinander: eine aeltere Antwort darf den Cache nicht nach einer neueren ueberschreiben.
  exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task);
    this.chain = run.catch(() => undefined);
    return run;
  }

  markDirty(gameId: string) { this.dirty.set(gameId, ++this.markSeq); }
  requestFull() { this.fullSeq += 1; }
  isDirty(gameId: string) { return this.dirty.has(gameId); }
  isFullRequested() { return this.fullSeq > this.fullDoneSeq; }

  plan(slim: SlimGameRow[], now: number): DeltaPlan {
    const full = this.isFullRequested() || !this.lastFullAt || now - this.lastFullAt >= FULL_PULL_INTERVAL_MS;
    const unchangedTombstone = (row: SlimGameRow) => {
      const entry = this.entries.get(row.id);
      return Boolean(entry?.deleted && entry.row.version === row.version && entry.row.flow_version === row.flow_version);
    };
    if (full) {
      // Events nur fuer nicht geloeschte Spiele, die neu/geaendert/markiert sind oder Aktivitaet < FULL_EVENTS_WINDOW_MS haben.
      const needsEvents = (row: SlimGameRow) => {
        if (unchangedTombstone(row)) return false;
        const entry = this.entries.get(row.id);
        if (!entry || entry.deleted || entry.row.version !== row.version || entry.row.flow_version !== row.flow_version) return true;
        return this.dirty.has(row.id) || now - getLastActivityMs(entry) < FULL_EVENTS_WINDOW_MS;
      };
      return { full, rowIds: slim.map((row) => row.id), eventIds: slim.filter(needsEvents).map((row) => row.id),
        dirtyMark: this.markSeq, fullMark: this.fullSeq };
    }
    const rowIds: string[] = [];
    const eventIds: string[] = [];
    for (const row of slim) {
      const entry = this.entries.get(row.id);
      const changed = !entry || entry.row.version !== row.version || entry.row.flow_version !== row.flow_version;
      if (changed) rowIds.push(row.id);
      if (!changed && entry!.deleted) continue;
      if (changed || this.dirty.has(row.id) || now - getLastActivityMs(entry!) < ACTIVE_WINDOW_MS) eventIds.push(row.id);
    }
    return { full, rowIds, eventIds, dirtyMark: this.markSeq, fullMark: this.fullSeq };
  }

  // Antwort uebernehmen. Markierungen, die WAEHREND des Ladens gesetzt wurden (spaeter als dirtyMark), bleiben bestehen.
  apply(slim: SlimGameRow[], plan: DeltaPlan, rows: SupabaseGameRecord[], events: SupabaseEventRecord[], now: number) {
    const rowById = new Map(rows.map((row) => [row.id, row]));
    const eventsById = new Map<string, SupabaseEventRecord[]>(plan.eventIds.map((id) => [id, []]));
    events.forEach((event) => eventsById.get(event.game_id)?.push(event));
    const next = new Map<string, RemoteGameEntry>();
    for (const { id } of slim) {
      const previous = this.entries.get(id);
      const row = rowById.get(id) ?? (plan.rowIds.includes(id) ? undefined : previous?.row);
      if (!row) continue;
      if (isSupabaseGameDeleted(row)) { next.set(id, { row, events: [], deleted: true }); continue; }
      const fetchedEvents = eventsById.get(id);
      if (!fetchedEvents && !previous) continue;
      next.set(id, { row, events: fetchedEvents ?? (previous!.deleted ? [] : previous!.events) });
    }
    this.entries = next;
    for (const id of plan.eventIds) if ((this.dirty.get(id) ?? 0) <= plan.dirtyMark) this.dirty.delete(id);
    for (const id of [...this.dirty.keys()]) if (!next.has(id) && !slim.some((row) => row.id === id)) this.dirty.delete(id);
    if (plan.full) {
      this.lastFullAt = now;
      this.fullDoneSeq = Math.max(this.fullDoneSeq, plan.fullMark);
    }
  }

  // Reihenfolge der schlanken Liste (created_at absteigend) = Reihenfolge des frueheren Vollabzugs.
  list(slim: SlimGameRow[]): RemoteGameEntry[] {
    return slim.map((row) => this.entries.get(row.id)).filter((entry): entry is RemoteGameEntry => Boolean(entry && !entry.deleted));
  }
}

// Realtime-Payload (postgres_changes): betroffenes Spiel bestimmen. null = unbekannt -> Vollabzug.
export const getRealtimeGameId = (change: unknown): string | null => {
  if (!change || typeof change !== "object") return null;
  const data = change as { table?: string; record?: Record<string, unknown> | null; old_record?: Record<string, unknown> | null;
    new?: Record<string, unknown> | null; old?: Record<string, unknown> | null };
  const record = data.record ?? data.new ?? data.old_record ?? data.old ?? null;
  if (!record) return null;
  const value = data.table === "games" ? record.id : record.game_id;
  return typeof value === "string" && value ? value : null;
};

// Abgleich-Takt: mit verbundenem Realtime seltener (Aenderungen kommen per Payload), sonst wie bisher 15 s.
export const getPollIntervalMs = (realtimeConnected: boolean, liveGameView: boolean): number =>
  liveGameView ? (realtimeConnected ? 30000 : 10000) : (realtimeConnected ? 60000 : 15000);

// Live-Ansicht (View only/TV): nach Spielende oder 15 min ohne neues Event anhalten.
export const LIVE_VIEW_IDLE_MS = 15 * 60 * 1000;

// Realtime in der Live-Ansicht: nur das eigene gezeigte Spiel. Bei "idle" angehalten; bei "ended" weiter durchlassen,
// damit z. B. ein Undo des Spielendes das Spiel neu laedt und die Pause aufhebt (nur bei echten Aenderungen, kaum Verkehr).
export const shouldLiveViewFollowRealtime = (liveGameId: string, changeGameId: string | null, pause: "ended" | "idle" | null): boolean =>
  changeGameId === liveGameId && pause !== "idle";

// Laden der Live-Ansicht: nur "idle" sperrt (bis "Weiter live"); bei "ended" laden Realtime/Rueckkehr das Spiel einmal neu.
export const liveViewBlocksLoad = (pause: "ended" | "idle" | null): boolean => pause === "idle";
export const getLiveViewPause = (entry: RemoteGameEntry | null, liveSinceMs: number, now: number): "ended" | "idle" | null => {
  if (!entry) return null;
  if (entry.row.ended_at) return "ended";
  let last = liveSinceMs;
  for (const event of entry.events) last = Math.max(last, toMs(event.created_at), toMs(event.occurred_at));
  return now - last >= LIVE_VIEW_IDLE_MS ? "idle" : null;
};

// Darf jetzt vom Server geladen werden? Normal nur sichtbar und online (Egress). Ausnahme Live-Ansicht (TV/Zuschauer) eines
// Spiels ohne eigene ausstehende Aenderungen: auch im Hintergrund-Tab, aber nur auf Anlass (Start, Realtime-Meldung zum
// eigenen Spiel, Rueckkehr) - der Takt (Polling) bleibt im Hintergrund aus. Sonst zeigte ein im Hintergrund geoeffneter
// TV-Tab dauerhaft den lokalen Stand des anderen Tabs ("Noch kein Sync") und zog erst nach dem Umschalten nach (Pepper 22.10.).
export const canRefreshNow = (input: { hidden: boolean; online: boolean; liveGameId: string | null; queueLength: number }): boolean =>
  input.online && (!input.hidden || (Boolean(input.liveGameId) && input.queueLength === 0));

// Rueckkehr in den Tab: Live-Ansicht sofort laden, sonst kurz warten (Netz nach dem Aufwachen).
export const getResumeSyncDelayMs = (liveView: boolean, defaultDelayMs: number): number => (liveView ? 0 : defaultDelayMs);
