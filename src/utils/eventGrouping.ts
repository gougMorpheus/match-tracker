// Buendelung fuer die ANZEIGE von "Letzte Ereignisse" und Verlauf. Gespeicherte Events bleiben unveraendert;
// alles wird bei jeder Aenderung (auch Undo des letzten Einzel-Events) neu aus den Events berechnet.
// Regeln:
// 1. Automatische +1 CP beim Zugwechsel (cp gained = 1, Runde/Zug wie turn-start, Zeitpunkt +-2 s, je Spieler das erste)
//    erscheinen nicht als eigene Zeilen, sondern im Zugwechsel mit "(auto CP each)".
// 2.-4. Innerhalb eines Zuges werden pro Spieler alle CP-Gewinne/-Ausgaben zu einem Eintrag gebuendelt,
//    ebenso SP pro Spieler und Art (Primaer, Sekundaer, Herausforderung, Gesamt getrennt).
//    Ohne Runde/Zug werden nur direkt aufeinanderfolgende gleiche Eintraege zusammengefasst.
// Highlights und Zeit-Events bleiben eigene Eintraege.

export interface GroupableEvent {
  id: string;
  kind: "time" | "cp" | "score" | "highlight" | "note";
  createdAt: string;
  playerId?: string;
  roundNumber?: number;
  turnNumber?: number;
  timeAction?: string;
  cpType?: "gained" | "spent";
  scoreType?: string;
  // CP: Betrag (positiv); Score: vorzeichenbehafteter Wert.
  value?: number;
}

export interface EventGroup<T extends GroupableEvent> {
  key: string;
  kind: T["kind"];
  items: T[];
  first: T;
  latest: T;
  createdAt: string;
  playerId?: string;
  roundNumber?: number;
  turnNumber?: number;
  autoCp: T[];
  cpGained: number;
  cpSpent: number;
  scoreSum: number;
  scoreType?: string;
}

// Gleicher Zeitpunkt: der Rundenabschluss (Highlight) gehört vor den Beginn der nächsten Runde
// (Fehlerbild: „★ Runde 1 abgeschlossen“ stand in der Liste über „Runde 2 beginnt“).
export const getSameTimeRank = (e: { id: string }): number => (e.id.startsWith("highlight:round-summary") ? -1 : 0);
const byTimeAsc = (a: GroupableEvent, b: GroupableEvent) => Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
  getSameTimeRank(a) - getSameTimeRank(b) || a.id.localeCompare(b.id);
const hasTurn = (e: GroupableEvent) => typeof e.roundNumber === "number" && typeof e.turnNumber === "number";
// Auto-CP liegen zeitlich am Zugstart: frueher exakt gleicher Zeitpunkt, seit Server-Zeitstempeln fuer
// Zeit-Events bis zu einige ms (Client-Uhr) daneben. Fenster +-2 s, je Spieler und Zugstart nur das erste.
export const AUTO_CP_WINDOW_MS = 2000;
const turnKey = (round?: number, turn?: number) => `${round}:${turn}`;

// awardedTurns: optional game.autoCommandPointAwards ("runde:zug" -> true); wenn angegeben, nur dort Auto-CP.
export const findAutoCommandPoints = <T extends GroupableEvent>(asc: T[], awardedTurns?: Record<string, boolean>): Map<string, T> => {
  const starts = asc.filter(e => e.kind === "time" && e.timeAction === "turn-start" && hasTurn(e));
  const result = new Map<string, T>(); // cp-id -> turn-start
  for (const start of starts) {
    const key = turnKey(start.roundNumber, start.turnNumber);
    if (awardedTurns && !awardedTurns[key]) continue;
    const t = Date.parse(start.createdAt); const seen = new Set<string>();
    for (const e of asc) {
      if (e.kind !== "cp" || e.cpType !== "gained" || e.value !== 1 || turnKey(e.roundNumber, e.turnNumber) !== key) continue;
      if (Math.abs(Date.parse(e.createdAt) - t) > AUTO_CP_WINDOW_MS || seen.has(e.playerId ?? "") || result.has(e.id)) continue;
      seen.add(e.playerId ?? ""); result.set(e.id, start);
    }
  }
  return result;
};

export const groupDisplayEvents = <T extends GroupableEvent>(events: T[], awardedTurns?: Record<string, boolean>): EventGroup<T>[] => {
  const asc = [...events].sort(byTimeAsc);
  const autoCp = findAutoCommandPoints(asc, awardedTurns);
  const groups: EventGroup<T>[] = [];
  const buckets = new Map<string, EventGroup<T>>();
  const turnStartGroups = new Map<string, EventGroup<T>>();
  const make = (key: string, e: T): EventGroup<T> => ({ key, kind: e.kind, items: [], first: e, latest: e, createdAt: e.createdAt,
    playerId: e.playerId, roundNumber: e.roundNumber, turnNumber: e.turnNumber, autoCp: [], cpGained: 0, cpSpent: 0, scoreSum: 0, scoreType: e.scoreType });
  const add = (g: EventGroup<T>, e: T) => {
    g.items.push(e); g.latest = e; g.createdAt = e.createdAt;
    if (e.kind === "cp") { if (e.cpType === "spent") g.cpSpent += Math.abs(e.value ?? 0); else g.cpGained += Math.abs(e.value ?? 0); }
    if (e.kind === "score") g.scoreSum += e.value ?? 0;
  };
  for (const e of asc) {
    if (autoCp.has(e.id)) continue;
    if (e.kind === "cp" || e.kind === "score") {
      const base = e.kind === "cp" ? `cp|${e.playerId}` : `score|${e.scoreType}|${e.playerId}`;
      if (hasTurn(e)) {
        const key = `${base}|${e.roundNumber}|${e.turnNumber}`;
        let g = buckets.get(key);
        if (!g) { g = make(key, e); buckets.set(key, g); groups.push(g); }
        add(g, e);
        continue;
      }
      const last = groups[groups.length - 1];
      if (last && last.key.startsWith(`${base}|-|`)) { add(last, e); continue; }
      const g = make(`${base}|-|${e.id}`, e); add(g, e); groups.push(g);
      continue;
    }
    const g = make(`${e.kind}|${e.id}`, e); add(g, e); groups.push(g);
    if (e.kind === "time" && e.timeAction === "turn-start") turnStartGroups.set(e.id, g);
  }
  for (const [cpId, start] of autoCp) {
    const cp = asc.find(e => e.id === cpId)!;
    turnStartGroups.get(start.id)?.autoCp.push(cp);
  }
  // Neueste zuerst; Zeitpunkt einer Gruppe = juengstes Event.
  return groups.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.latest.id.localeCompare(a.latest.id));
};

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "±0");
export const formatCpGroup = (g: { cpGained: number; cpSpent: number }) =>
  g.cpGained && g.cpSpent ? `+${g.cpGained} / −${g.cpSpent} CP` : g.cpSpent ? `−${g.cpSpent} CP` : `+${g.cpGained} CP`;
export const formatScoreValue = (n: number) => signed(n);
export const AUTO_CP_SUFFIX = " (auto CP each)";
