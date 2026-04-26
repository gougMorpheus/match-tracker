import type { Turn } from "../types/game";
import { isTurnPaused } from "./gameCalculations";

export const getTimerFocusTurn = (selectedTurn?: Turn, latestTurn?: Turn): Turn | undefined =>
  selectedTurn ?? latestTurn;

export const shouldRunTimerTicker = (
  turn?: Turn,
  timeoutActive = false,
  isClosed = false
): boolean =>
  !isClosed && !timeoutActive && Boolean(turn?.timing.startedAt && !turn.timing.endedAt && !isTurnPaused(turn));
