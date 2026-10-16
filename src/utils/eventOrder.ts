// Zentrale logische Reihenfolge fuer Anzeige-Ereignisse mit GLEICHEM Zeitstempel (nur Anzeige/Sortierung, Daten unveraendert).
// Chronologisch (aufsteigend): Zug Ende -> Runde abgeschlossen (round-end, ★ Rundenabschluss, Zeit-Duell, Meilensteine)
// -> Spielende -> Spielstart -> Runde beginnt -> Aufstellung/Zug Start -> danach Pause, Fortsetzen, CP, Punkte, sonstige Highlights.
// Anzeige "neueste oben" ist genau die Umkehrung. Passt zur Auswertungsregel "Start vor Pause" (timeEventOrder.ts):
// jede Pause hat einen hoeheren Rang als jeder Start.
export interface LogicallyOrderable { id?: string; kind?: string; action?: string; timeAction?: string; createdAt: string }

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

// Aufsteigend (chronologisch). Gleichstand nach Rang, danach ID (stabil, deterministisch).
export const compareEventsAsc = (a: LogicallyOrderable, b: LogicallyOrderable): number =>
  Date.parse(a.createdAt) - Date.parse(b.createdAt) || getLogicalRank(a) - getLogicalRank(b) || (a.id ?? "").localeCompare(b.id ?? "");
// Neueste zuerst: exakte Umkehrung.
export const compareEventsDesc = (a: LogicallyOrderable, b: LogicallyOrderable): number => compareEventsAsc(b, a);
