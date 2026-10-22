import type { Turn } from "../types/game";

// Gemeinsame Zug-Zeitlogik fuer BEIDE Auswertungen (lokal: gameState.buildRoundsFromTimeEvents, aus der DB:
// supabaseGameMapping.buildRoundsFromTimeEvents). Timer-Regel Tim 22.10.: genau EIN Zug bzw. die Aufstellung zaehlt.
// - turn-resume auf einen schon beendeten Zug (Zurueck/Rueckgaengig, Timer an nach Wiedereroeffnen) oeffnet ihn wieder:
//   die Luecke seit dem Ende gilt als Pause, ab dem Resume zaehlt die Zeit in diesem Zug.
// - Startet/laeuft ein anderer Zug weiter (turn-start/turn-resume) oder die Aufstellung (setup-start/setup-resume), wird ein
//   laufender anderer Zug implizit pausiert und ein wieder geoeffneter Zug wieder beendet. Nie laufen zwei Zuege gleichzeitig.
// - Explizites turn-pause (Timer-Knopf, Time-out) laesst einen wieder geoeffneten Zug offen (pausiert), damit Timer an bzw.
//   Time-out-Ende dort weiterlaufen.
export type TurnTimingAction = "turn-start" | "turn-resume" | "turn-pause" | "turn-end";

const isRunning = (turn: Turn): boolean => {
  const latestPause = turn.timing.pauses[turn.timing.pauses.length - 1];
  return Boolean(turn.timing.startedAt && !turn.timing.endedAt && (!latestPause || latestPause.endedAt));
};

export const createTurnTimingTracker = () => {
  const turnsByKey = new Map<string, Turn>();
  const reopened = new Set<string>();
  const keyOf = (turn: Turn) => `${turn.roundNumber}:${turn.turnNumber}`;

  const stopOtherTurns = (at: string, exceptKey: string | null) => {
    turnsByKey.forEach((other, key) => {
      if (key === exceptKey) return;
      if (reopened.has(key)) {
        reopened.delete(key);
        const latestPause = other.timing.pauses[other.timing.pauses.length - 1];
        if (latestPause && !latestPause.endedAt) {
          other.timing.pauses.pop();
          other.timing.endedAt = latestPause.startedAt;
        } else {
          other.timing.endedAt = at;
        }
        return;
      }
      if (isRunning(other)) other.timing.pauses.push({ startedAt: at });
    });
  };

  return {
    // setup-start / setup-resume: die Aufstellung wird die zaehlende Phase
    setupActivated: (at: string) => stopOtherTurns(at, null),
    apply: (action: TurnTimingAction, turn: Turn, at: string) => {
      const key = keyOf(turn);
      turnsByKey.set(key, turn);
      const latestPause = turn.timing.pauses[turn.timing.pauses.length - 1];

      if (action === "turn-start") {
        if (turn.timing.endedAt && at >= turn.timing.endedAt) return;
        if (!turn.timing.startedAt) {
          turn.timing.startedAt = at;
        } else if (latestPause && !latestPause.endedAt) {
          latestPause.endedAt = at;
        }
        stopOtherTurns(at, key);
        return;
      }

      if (action === "turn-resume") {
        if (!turn.timing.startedAt) return;
        if (turn.timing.endedAt && at >= turn.timing.endedAt) {
          turn.timing.pauses.push({ startedAt: turn.timing.endedAt, endedAt: at });
          turn.timing.endedAt = undefined;
          reopened.add(key);
        } else if (latestPause && !latestPause.endedAt && at >= latestPause.startedAt) {
          latestPause.endedAt = at;
        }
        stopOtherTurns(at, key);
        return;
      }

      if (action === "turn-pause") {
        if (!turn.timing.startedAt || (turn.timing.endedAt && at >= turn.timing.endedAt)) return;
        if (!latestPause || latestPause.endedAt) turn.timing.pauses.push({ startedAt: at });
        return;
      }

      // turn-end
      if (turn.timing.endedAt && at >= turn.timing.endedAt) return;
      if (latestPause && !latestPause.endedAt) latestPause.endedAt = at;
      turn.timing.endedAt = at;
      reopened.delete(key);
    }
  };
};
