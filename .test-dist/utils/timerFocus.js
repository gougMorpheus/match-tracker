"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDisplayedRoundTurns = exports.shouldRunTimerRenderTicker = exports.shouldRunTimerTicker = exports.getTimerFocusTurn = void 0;
const gameCalculations_1 = require("./gameCalculations");
// Anzeige-Zug: Zuschauer (view-only) folgen dem aktiven Zug, sonst der angewaehlte Zug.
const getTimerFocusTurn = (selectedTurn, activeTurn, viewOnly = false) => viewOnly ? activeTurn : selectedTurn ?? activeTurn;
exports.getTimerFocusTurn = getTimerFocusTurn;
const shouldRunTimerTicker = (turn, timeoutActive = false, isClosed = false) => !isClosed && !timeoutActive && Boolean(turn?.timing.startedAt && !turn.timing.endedAt && !(0, gameCalculations_1.isTurnPaused)(turn));
exports.shouldRunTimerTicker = shouldRunTimerTicker;
// Display-only ticker: keep rerendering during timeout so the live totals stay current.
const shouldRunTimerRenderTicker = (turn, timeoutActive = false, isClosed = false) => !isClosed && (timeoutActive || (0, exports.shouldRunTimerTicker)(turn, false, false));
exports.shouldRunTimerRenderTicker = shouldRunTimerRenderTicker;
// Rundenzeit = Summe ALLER Zuege der Runde, unabhaengig vom Timer-Zustand (frueher bei gestopptem Timer nur bis zum
// angewaehlten Zug -> Anzeige sprang bei Timer aus/an, Pepper 22.10.). Gleiches Modell wie die Statistik.
const getDisplayedRoundTurns = (round) => round.turns;
exports.getDisplayedRoundTurns = getDisplayedRoundTurns;
