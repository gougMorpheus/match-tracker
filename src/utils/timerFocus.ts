import type { Round, Turn } from "../types/game";
import { isTurnPaused } from "./gameCalculations";

// Anzeige-Zug: Zuschauer (view-only) folgen dem aktiven Zug, sonst der angewaehlte Zug.
export const getTimerFocusTurn = (selectedTurn?: Turn, activeTurn?: Turn, viewOnly = false): Turn | undefined =>
  viewOnly ? activeTurn : selectedTurn ?? activeTurn;

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

// Rundenzeit = Summe ALLER Zuege der Runde, unabhaengig vom Timer-Zustand (frueher bei gestopptem Timer nur bis zum
// angewaehlten Zug -> Anzeige sprang bei Timer aus/an, Pepper 22.10.). Gleiches Modell wie die Statistik.
export const getDisplayedRoundTurns = (round: Round): Turn[] => round.turns;
