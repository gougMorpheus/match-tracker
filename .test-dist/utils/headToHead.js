"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPlayerWinRate = exports.getHeadToHead = exports.getGameOutcome = exports.normalizePlayerName = void 0;
const gameCalculations_1 = require("./gameCalculations");
const normalizePlayerName = (name) => name.trim().replace(/\s+/g, " ").toLowerCase();
exports.normalizePlayerName = normalizePlayerName;
// Only completed, non-interrupted/non-abandoned games count. Explicit draws and
// concessions take precedence; otherwise comparable total VP decide. Draws count
// as rated games, but never as wins. Statistics overrides do not alter this record.
const getGameOutcome = (game) => {
    if (game.status !== "completed" || game.finishReason === "interrupted" || game.finishReason === "abandoned")
        return null;
    if (game.finishReason === "draw")
        return { winnerId: null, draw: true };
    if (game.finishReason === "player-1-conceded")
        return { winnerId: game.players[1].id, draw: false };
    if (game.finishReason === "player-2-conceded")
        return { winnerId: game.players[0].id, draw: false };
    const [a, b] = game.players.map(p => (0, gameCalculations_1.getPlayerComparableTotalScore)(game, p.id));
    if (a === null || b === null)
        return null;
    return { winnerId: a === b ? null : game.players[a > b ? 0 : 1].id, draw: a === b };
};
exports.getGameOutcome = getGameOutcome;
const getHeadToHead = (games, nameA, nameB, excludeGameId) => {
    let winsA = 0, winsB = 0, draws = 0;
    const a = (0, exports.normalizePlayerName)(nameA), b = (0, exports.normalizePlayerName)(nameB);
    if (!a || !b || a === b)
        return { winsA, winsB, draws, games: 0 };
    for (const game of games) {
        if (game.id === excludeGameId)
            continue;
        const pa = game.players.find(p => (0, exports.normalizePlayerName)(p.name) === a);
        const pb = game.players.find(p => (0, exports.normalizePlayerName)(p.name) === b);
        const outcome = (0, exports.getGameOutcome)(game);
        if (!pa || !pb || !outcome)
            continue;
        if (outcome.draw)
            draws++;
        else if (outcome.winnerId === pa.id)
            winsA++;
        else
            winsB++;
    }
    return { winsA, winsB, draws, games: winsA + winsB + draws };
};
exports.getHeadToHead = getHeadToHead;
const getPlayerWinRate = (games, name, excludeGameId) => {
    let wins = 0, ratedGames = 0;
    const normalized = (0, exports.normalizePlayerName)(name);
    for (const game of games) {
        if (game.id === excludeGameId || !normalized)
            continue;
        const matches = game.players.filter(p => (0, exports.normalizePlayerName)(p.name) === normalized);
        const outcome = (0, exports.getGameOutcome)(game);
        if (matches.length !== 1 || !outcome)
            continue;
        ratedGames++;
        if (outcome.winnerId === matches[0].id)
            wins++;
    }
    return { wins, games: ratedGames, percent: ratedGames ? Math.round(100 * wins / ratedGames) : null };
};
exports.getPlayerWinRate = getPlayerWinRate;
