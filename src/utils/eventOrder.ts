// Zentrale logische Reihenfolge fuer Anzeige-Ereignisse mit GLEICHEM Zeitstempel (nur Anzeige/Sortierung, Daten unveraendert).
// Chronologisch (aufsteigend): Zug Ende -> Runde abgeschlossen (round-end, ★ Rundenabschluss, Zeit-Duell, Meilensteine)
// -> Spielende -> Spielstart -> Runde beginnt -> Aufstellung/Zug Start -> danach Pause, Fortsetzen, CP, Punkte, sonstige Highlights.
// Anzeige "neueste oben" ist genau die Umkehrung. Passt zur Auswertungsregel "Start vor Pause" (timeEventOrder.ts):
// jede Pause hat einen hoeheren Rang als jeder Start.
export interface LogicallyOrderable { id?: string; kind?: string; action?: string; timeAction?: string; createdAt: string;
  roundNumber?: number; turnNumber?: number }

const TIME_RANK: Record<string, number> = {
  "turn-end": 10, "setup-end": 10, "round-end": 20, "game-end": 30,
  "game-start": 35, "round-start": 40, "setup-start": 45, "turn-start": 50
};
const HIGHLIGHT_RANK: Record<string, number> = {
  "round-summary": 21, "time-overtake": 22, "time-milestone": 23, "game-end": 31, "game-start": 36
};
const OTHER_RANK = 60;
const OTHER_HIGHLIGHT_RANK = 61; // Fuehrung/Ausgleich/Herausforderung: nach dem ausloesenden Punkte-Event

const highlightKindOf = (e: LogicallyOrderable): string | null => {
  if (e.id?.startsWith("highlight:")) return e.id.split(":")[1] ?? null;
  if (e.kind && !["time", "cp", "score", "note", "highlight"].includes(e.kind)) return e.kind;
  return null;
};

export const getLogicalRank = (e: LogicallyOrderable): number => {
  const hk = highlightKindOf(e);
  if (hk) return HIGHLIGHT_RANK[hk.startsWith("time-milestone") ? "time-milestone" : hk] ?? OTHER_HIGHLIGHT_RANK;
  const action = e.timeAction ?? e.action;
  return action ? TIME_RANK[action] ?? OTHER_RANK : OTHER_RANK;
};

// Auto-CP/Punkte kurz VOR dem eigenen Zug Start (Client- vs. Serverzeit, wenige ms): in der Anzeige direkt nach
// Zug Start einsortieren (Rang 55, Zeitpunkt = Zug Start). Gilt fuer CP und Punkte mit derselben Runde/demselben Zug,
// die bis zu 2 s vor (oder gleichzeitig mit) dessen Zug Start liegen. Nur Anzeige; Auswertung/Highlights unveraendert.
export const TURN_START_ANCHOR_WINDOW_MS = 2000;
const ANCHORED_RANK = 55;
export type TurnStartAnchors = ReadonlyMap<string, number>;
const turnKeyOf = (e: LogicallyOrderable) => `${e.roundNumber}:${e.turnNumber}`;
const isCpOrScore = (e: LogicallyOrderable) => e.kind === "cp" || e.kind === "score";
export const buildTurnStartAnchors = (events: readonly LogicallyOrderable[]): TurnStartAnchors => {
  const anchors = new Map<string, number>();
  for (const e of events) {
    if ((e.timeAction ?? e.action) !== "turn-start" || !e.roundNumber || !e.turnNumber || e.id?.startsWith("highlight:")) continue;
    const t = Date.parse(e.createdAt); const key = turnKeyOf(e);
    if (!anchors.has(key) || t < (anchors.get(key) as number)) anchors.set(key, t);
  }
  return anchors;
};
const sortKey = (e: LogicallyOrderable, anchors?: TurnStartAnchors): [number, number] => {
  const t = Date.parse(e.createdAt);
  if (anchors && isCpOrScore(e) && e.roundNumber && e.turnNumber) {
    const start = anchors.get(turnKeyOf(e));
    if (start !== undefined && start - t >= 0 && start - t <= TURN_START_ANCHOR_WINDOW_MS) return [start, ANCHORED_RANK];
  }
  return [t, getLogicalRank(e)];
};

// Aufsteigend (chronologisch). Gleichstand nach Rang, danach ID (stabil, deterministisch). Mit anchors (aus derselben
// Ereignisliste) zusaetzlich die Zug-Start-Regel oben.
export const compareEventsAsc = (a: LogicallyOrderable, b: LogicallyOrderable, anchors?: TurnStartAnchors): number => {
  const [ta, ra] = sortKey(a, anchors), [tb, rb] = sortKey(b, anchors);
  return ta - tb || ra - rb || (a.id ?? "").localeCompare(b.id ?? "");
};
// Neueste zuerst: exakte Umkehrung.
export const compareEventsDesc = (a: LogicallyOrderable, b: LogicallyOrderable, anchors?: TurnStartAnchors): number =>
  compareEventsAsc(b, a, anchors);
// Vergleichsfunktionen fuer eine konkrete Ereignisliste (Anzeige: Verlauf, Letzte Ereignisse, TV-Feed).
export const createEventComparators = (events: readonly LogicallyOrderable[]) => {
  const anchors = buildTurnStartAnchors(events);
  return {
    asc: (a: LogicallyOrderable, b: LogicallyOrderable) => compareEventsAsc(a, b, anchors),
    desc: (a: LogicallyOrderable, b: LogicallyOrderable) => compareEventsDesc(a, b, anchors)
  };
};
// Anzeige "neueste oben" fuer eine ganze Liste (mit Zug-Start-Regel).
export const sortEventsNewestFirst = <T extends LogicallyOrderable>(items: T[]): T[] => [...items].sort(createEventComparators(items).desc);
