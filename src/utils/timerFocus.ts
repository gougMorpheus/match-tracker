import type { Round, Turn } from "../types/game";
import { isTurnPaused } from "./gameCalculations";

export const getTimerFocusTurn = (selectedTurn?: Turn, latestTurn?: Turn, viewOnly = false): Turn | undefined =>
  viewOnly ? latestTurn : selectedTurn ?? latestTurn;

// Ziel der Timer-Bedienung (Status, "Timer an/aus", Time-out): Sieht man einen bereits BEENDETEN älteren Zug an
// (Zurück-Navigation), wirkt der Timer auf den neuesten Zug. Ein beendeter Zug wird nie fortgesetzt; die Auswertung
// ignoriert turn-resume nach turn-end ohnehin (gameState.buildRoundsFromTimeEvents), die Zeit ginge sonst verloren.
export const getTimerControlTurn = (selectedTurn?: Turn, latestTurn?: Turn): Turn | undefined => {
  if (!selectedTurn || !latestTurn) return selectedTurn ?? latestTurn;
  const sameTurn = selectedTurn.roundNumber === latestTurn.roundNumber && selectedTurn.turnNumber === latestTurn.turnNumber;
  return !sameTurn && selectedTurn.timing.endedAt ? latestTurn : selectedTurn;
};

export const shouldRunTimerTicker = (
  turn?: Turn,
  timeoutActive = false,
  isClosed = false
): boolean =>
  !isClosed && !timeoutActive && Boolean(turn?.timing.startedAt && !turn.timing.endedAt && !isTurnPaused(turn));

// Display-only ticker: keep rerendering during timeout so the live totals stay current.
export const shouldRunTimerRenderTicker = (
  turn?: Turn,
  timeoutActive = false,
  isClosed = false
): boolean => !isClosed && (timeoutActive || shouldRunTimerTicker(turn, false, false));

export const getDisplayedRoundTurns = (
  round: Round,
  selectedTurn?: Turn,
  timerRunning = false,
  timeoutActive = false
): Turn[] => {
  if (timerRunning || timeoutActive || !selectedTurn) {
    return round.turns;
  }

  return round.turns.filter((turn) => turn.turnNumber <= selectedTurn.turnNumber);
};
