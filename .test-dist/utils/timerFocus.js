"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDisplayedRoundTurns = exports.shouldRunTimerRenderTicker = exports.shouldRunTimerTicker = exports.getTimerControlTurn = exports.getTimerFocusTurn = void 0;
const gameCalculations_1 = require("./gameCalculations");
const getTimerFocusTurn = (selectedTurn, latestTurn, viewOnly = false) => viewOnly ? latestTurn : selectedTurn ?? latestTurn;
exports.getTimerFocusTurn = getTimerFocusTurn;
// Ziel der Timer-Bedienung (Status, "Timer an/aus", Time-out): Sieht man einen bereits BEENDETEN älteren Zug an
// (Zurück-Navigation), wirkt der Timer auf den neuesten Zug. Ein beendeter Zug wird nie fortgesetzt; die Auswertung
// ignoriert turn-resume nach turn-end ohnehin (gameState.buildRoundsFromTimeEvents), die Zeit ginge sonst verloren.
const getTimerControlTurn = (selectedTurn, latestTurn) => {
    if (!selectedTurn || !latestTurn)
        return selectedTurn ?? latestTurn;
    const sameTurn = selectedTurn.roundNumber === latestTurn.roundNumber && selectedTurn.turnNumber === latestTurn.turnNumber;
    return !sameTurn && selectedTurn.timing.endedAt ? latestTurn : selectedTurn;
};
exports.getTimerControlTurn = getTimerControlTurn;
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
