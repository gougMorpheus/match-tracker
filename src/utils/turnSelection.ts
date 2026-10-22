// Auswahl des angezeigten Zugs im Editor (GamePage). Reine Logik, testbar.
// Regel: Wer auf dem bisher neuesten Zug steht (Normalfall), folgt automatisch dem neuen neuesten Zug,
// z. B. wenn ein anderes Gerät "Weiter" drückt oder nach dem Start der Server-Stand neuer ist als der
// lokale Cache. Wer bewusst einen älteren Zug ansieht (Zurück-Navigation), bleibt dort.
// Fehlerbild ohne diese Regel: Auswahl bleibt auf dem alten Zug, "Timer an" pausiert den laufenden neuen Zug
// und setzt den alten (beendeten) Zug fort (turn-pause R1Z2 + turn-resume R1Z1).
export const SETUP_TURN_KEY = "setup";

export interface TurnSelectionInput {
  current: string | null;
  previousLatestKey: string | null;
  latestKey: string | null;
  turnKeys: string[];
  snapToLatest: boolean;
  setupStarted: boolean;
  // Laeuft die Aufstellung, ist sie die aktive Phase (Sprung nach Rueckgaengig eines Timer-Eintrags).
  setupRunning?: boolean;
}

export const resolveSelectedTurnKey = ({
  current, previousLatestKey, latestKey, turnKeys, snapToLatest, setupStarted, setupRunning = false
}: TurnSelectionInput): string | null => {
  if (snapToLatest && setupRunning && setupStarted) return SETUP_TURN_KEY;
  if (!latestKey) return null;
  if (snapToLatest || !current) return latestKey;
  if (current === SETUP_TURN_KEY && setupStarted) return current;
  if (current === previousLatestKey && current !== latestKey) return latestKey;
  return turnKeys.includes(current) ? current : latestKey;
};
