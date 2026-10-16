// Feste Auswertungsreihenfolge fuer Zeit-Events (nur Lesen/Auswerten, Daten bleiben unveraendert).
// Fehlerbild 16.10.: Nach "Weiter" haben turn-start und turn-pause denselben Server-Zeitstempel. Die DB liefert
// gleiche Zeitstempel in beliebiger Reihenfolge; kam die Pause vor dem Start, wurde sie ignoriert und der Zug
// galt als laufend (Zuschauer "Laeuft", Editor nach Neuladen "Timer laeuft").
// Regel: bei identischem Zeitstempel kommt ein Start (game-start, round-start, turn-start desselben Zugs) vor
// turn-pause; ebenso game-start/setup-start vor setup-pause (Aufstellung). Alle anderen Events behalten ihre Reihenfolge (stabile Sortierung nach Zeitstempel).
export interface OrderableTimeEvent { createdAt: string; action: string; roundNumber?: number; turnNumber?: number }

const PAUSE_ACTIONS = new Set(["turn-pause", "setup-pause"]);
const isStartFor = (start: OrderableTimeEvent, pause: OrderableTimeEvent): boolean =>
  pause.action === "setup-pause" ? start.action === "game-start" || start.action === "setup-start" :
  start.action === "game-start" ||
  (start.action === "round-start" && (start.roundNumber === undefined || start.roundNumber === pause.roundNumber)) ||
  (start.action === "turn-start" && start.roundNumber === pause.roundNumber && start.turnNumber === pause.turnNumber);

export const fixStartBeforePauseTies = <T extends OrderableTimeEvent>(sorted: T[]): T[] => {
  const result: T[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].createdAt === sorted[i].createdAt) j++;
    const group = sorted.slice(i, j);
    if (group.length > 1) {
      // Jede Pause, nach der in derselben Zeitstempel-Gruppe noch ein passender Start folgt, hinter den letzten
      // passenden Start verschieben. Reihenfolge der uebrigen Events bleibt.
      for (let k = 0; k < group.length; k++) {
        const event = group[k];
        if (!PAUSE_ACTIONS.has(event.action)) continue;
        let last = -1;
        for (let m = k + 1; m < group.length; m++) if (isStartFor(group[m], event)) last = m;
        if (last > k) { group.splice(k, 1); group.splice(last, 0, event); k--; }
      }
    }
    result.push(...group);
    i = j;
  }
  return result;
};

export const orderTimeEventsForEvaluation = <T extends OrderableTimeEvent>(events: T[]): T[] =>
  fixStartBeforePauseTies([...events].sort((left, right) => left.createdAt.localeCompare(right.createdAt)));
