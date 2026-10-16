// Buendelung fuer die ANZEIGE von "Letzte Ereignisse" und Verlauf. Gespeicherte Events bleiben unveraendert;
// alles wird bei jeder Aenderung (auch Undo des letzten Einzel-Events) neu aus den Events berechnet.
// Regeln:
// 1. Automatische +1 CP beim Zugwechsel (cp gained = 1, gleicher Zeitpunkt + Runde/Zug wie turn-start)
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

const byTimeAsc = (a: GroupableEvent, b: GroupableEvent) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id);
const hasTurn = (e: GroupableEvent) => typeof e.roundNumber === "number" && typeof e.turnNumber === "number";
const turnStartKey = (round?: number, turn?: number, at?: string) => `${round}:${turn}:${at ? Date.parse(at) : ""}`;

export const isAutoCommandPoint = (e: GroupableEvent, turnStarts: Set<string>) =>
  e.kind === "cp" && e.cpType === "gained" && e.value === 1 && hasTurn(e) && turnStarts.has(turnStartKey(e.roundNumber, e.turnNumber, e.createdAt));

export const groupDisplayEvents = <T extends GroupableEvent>(events: T[]): EventGroup<T>[] => {
  const asc = [...events].sort(byTimeAsc);
  const turnStarts = new Set(asc.filter(e => e.kind === "time" && e.timeAction === "turn-start").map(e => turnStartKey(e.roundNumber, e.turnNumber, e.createdAt)));
  const groups: EventGroup<T>[] = [];
  const buckets = new Map<string, EventGroup<T>>();
  const turnStartGroups = new Map<string, EventGroup<T>>();
  const pendingAuto: T[] = [];
  const make = (key: string, e: T): EventGroup<T> => ({ key, kind: e.kind, items: [], first: e, latest: e, createdAt: e.createdAt,
    playerId: e.playerId, roundNumber: e.roundNumber, turnNumber: e.turnNumber, autoCp: [], cpGained: 0, cpSpent: 0, scoreSum: 0, scoreType: e.scoreType });
  const add = (g: EventGroup<T>, e: T) => {
    g.items.push(e); g.latest = e; g.createdAt = e.createdAt;
    if (e.kind === "cp") { if (e.cpType === "spent") g.cpSpent += Math.abs(e.value ?? 0); else g.cpGained += Math.abs(e.value ?? 0); }
    if (e.kind === "score") g.scoreSum += e.value ?? 0;
  };
  for (const e of asc) {
    if (isAutoCommandPoint(e, turnStarts)) { pendingAuto.push(e); continue; }
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
    if (e.kind === "time" && e.timeAction === "turn-start") turnStartGroups.set(turnStartKey(e.roundNumber, e.turnNumber, e.createdAt), g);
  }
  for (const cp of pendingAuto) {
    const g = turnStartGroups.get(turnStartKey(cp.roundNumber, cp.turnNumber, cp.createdAt));
    if (g) g.autoCp.push(cp);
  }
  // Neueste zuerst; Zeitpunkt einer Gruppe = juengstes Event.
  return groups.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.latest.id.localeCompare(a.latest.id));
};

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "±0");
export const formatCpGroup = (g: { cpGained: number; cpSpent: number }) =>
  g.cpGained && g.cpSpent ? `+${g.cpGained} / −${g.cpSpent} CP` : g.cpSpent ? `−${g.cpSpent} CP` : `+${g.cpGained} CP`;
export const formatScoreValue = (n: number) => signed(n);
export const AUTO_CP_SUFFIX = " (auto CP each)";
