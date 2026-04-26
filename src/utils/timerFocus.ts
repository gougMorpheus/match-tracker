import type { Round, Turn } from "../types/game";
import { isTurnPaused } from "./gameCalculations";

export const getTimerFocusTurn = (selectedTurn?: Turn, latestTurn?: Turn): Turn | undefined =>
  selectedTurn ?? latestTurn;

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
