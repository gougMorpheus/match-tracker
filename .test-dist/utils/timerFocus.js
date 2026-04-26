"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDisplayedRoundTurns = exports.shouldRunTimerRenderTicker = exports.shouldRunTimerTicker = exports.getTimerFocusTurn = void 0;
const gameCalculations_1 = require("./gameCalculations");
const getTimerFocusTurn = (selectedTurn, latestTurn) => selectedTurn ?? latestTurn;
exports.getTimerFocusTurn = getTimerFocusTurn;
const shouldRunTimerTicker = (turn, timeoutActive = false, isClosed = false) => !isClosed && !timeoutActive && Boolean(turn?.timing.startedAt && !turn.timing.endedAt && !(0, gameCalculations_1.isTurnPaused)(turn));
exports.shouldRunTimerTicker = shouldRunTimerTicker;
// Display-only ticker: keep rerendering during timeout so the live totals stay current.
const shouldRunTimerRenderTicker = (turn, timeoutActive = false, isClosed = false) => !isClosed && (timeoutActive || (0, exports.shouldRunTimerTicker)(turn, false, false));
exports.shouldRunTimerRenderTicker = shouldRunTimerRenderTicker;
const getDisplayedRoundTurns = (round, selectedTurn, timerRunning = false, timeoutActive = false) => {
    if (timerRunning || timeoutActive || !selectedTurn) {
        return round.turns;
    }
    return round.turns.filter((turn) => turn.turnNumber <= selectedTurn.turnNumber);
};
exports.getDisplayedRoundTurns = getDisplayedRoundTurns;
