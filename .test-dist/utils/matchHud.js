"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMatchHud = exports.terrainMatchQuery = void 0;
const gameCalculations_1 = require("./gameCalculations");
// Forge hängt diese Query an die Gelände-URL. Den Host legt Match-Tracker nicht fest.
const terrainMatchQuery = (matchId) => `?match=${matchId}`;
exports.terrainMatchQuery = terrainMatchQuery;
const slotOf = (game, playerId) => playerId === game.players[1].id ? 2 : 1;
const isTurnRunning = (turn) => Boolean(turn.timing.startedAt && !turn.timing.endedAt && !(0, gameCalculations_1.isTurnPaused)(turn));
const playerSnapshot = (game, slot) => {
    const player = game.players[slot - 1];
    const detail = game.scoreDetailLevel === "full";
    return {
        slot,
        name: player.name,
        score: (0, gameCalculations_1.getPlayerTotalScore)(game, player.id),
        primary: detail ? (0, gameCalculations_1.getPlayerPrimaryTotal)(game, player.id) : 0,
        secondary: detail ? (0, gameCalculations_1.getPlayerSecondaryTotal)(game, player.id) : 0,
        challenge: detail ? (0, gameCalculations_1.getPlayerChallengeTotal)(game, player.id) : 0,
        cp: (0, gameCalculations_1.getPlayerCommandPoints)(game, player.id),
        cpGained: (0, gameCalculations_1.getPlayerCommandPointsGained)(game, player.id),
        cpSpent: (0, gameCalculations_1.getPlayerCommandPointsSpent)(game, player.id)
    };
};
const buildMatchHud = (game) => {
    const ended = Boolean(game.endedAt) || game.timeEvents.some((event) => event.action === "game-end");
    const setup = !ended && (0, gameCalculations_1.isSetupActive)(game);
    const turn = (0, gameCalculations_1.getActiveTurn)(game);
    const phase = ended ? "ended" : setup ? "setup" : turn ? "turn" : "pending";
    const showTurn = phase === "turn" || phase === "ended" ? turn : undefined;
    const activeTurn = showTurn
        ? {
            playerSlot: slotOf(game, showTurn.playerId),
            round: showTurn.roundNumber,
            turn: showTurn.turnNumber,
            running: !ended && isTurnRunning(showTurn)
        }
        : null;
    const round = activeTurn?.round ?? (phase === "turn" || phase === "ended" ? (0, gameCalculations_1.getCurrentRoundNumber)(game) : 0);
    const shownPlayerId = showTurn
        ? showTurn.playerId
        : game.startingPlayerId || game.defenderPlayerId || game.players[0].id;
    const players = [playerSnapshot(game, 1), playerSnapshot(game, 2)];
    return {
        matchId: game.id,
        isOnline: game.isOnline === true,
        status: ended ? "completed" : "active",
        phase,
        round,
        activeTurn,
        activePlayerSlot: shownPlayerId ? slotOf(game, shownPlayerId) : null,
        scores: { 1: players[0].score, 2: players[1].score },
        cp: { 1: players[0].cp, 2: players[1].cp },
        players
    };
};
exports.buildMatchHud = buildMatchHud;
