"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTvEventFeed = exports.getDeficitInfo = exports.TV_EVENT_LIMIT = void 0;
const gameCalculations_1 = require("./gameCalculations");
const time_1 = require("./time");
exports.TV_EVENT_LIMIT = 8;
const getDeficitInfo = (game) => {
    const [a, b] = game.players.map(p => (0, gameCalculations_1.getPlayerComparableTotalScore)(game, p.id));
    const remainingRounds = Math.max(0, 5 - (0, gameCalculations_1.getCurrentRoundNumber)(game));
    if (a === null || b === null)
        return { text: "Keine vergleichbaren VP", deficit: null, playerId: null, remainingRounds, perRound: null };
    if (a === b)
        return { text: "Gleichstand", deficit: 0, playerId: null, remainingRounds, perRound: null };
    const player = game.players[a < b ? 0 : 1], deficit = Math.abs(a - b);
    return { text: `${player.name} liegt ${deficit} VP zurück`, deficit, playerId: player.id, remainingRounds,
        perRound: remainingRounds > 0 && game.status !== "completed" ? Math.ceil(deficit / remainingRounds) : null };
};
exports.getDeficitInfo = getDeficitInfo;
const signed = (n) => `${n < 0 ? "−" : "+"}${Math.abs(n)}`;
const buildTvEventFeed = (game, limit = exports.TV_EVENT_LIMIT) => {
    const name = (id) => game.players.find(p => p.id === id)?.name ?? "Spieler";
    const round = (n) => n ? `Runde ${n} · ` : "";
    const events = [
        ...game.scoreEvents.map(e => ({ ...e, text: `${round(e.roundNumber)}${name(e.playerId)}: ${signed(e.value)} ${e.scoreType === "primary" ? "Primär" : e.scoreType === "secondary" ? "Sekundär" : e.scoreType === "challenge" ? "Herausforderung" : "VP"}` })),
        ...game.commandPointEvents.map(e => ({ ...e, text: `${round(e.roundNumber)}${name(e.playerId)}: ${signed(e.cpType === "spent" ? -e.value : e.value)} CP` })),
        ...game.noteEvents.map(e => ({ ...e, text: `${name(e.playerId)}: ${e.note}` }))
    ];
    for (const e of game.timeEvents) {
        let text;
        switch (e.action) {
            case "round-start":
                text = `Runde ${e.roundNumber} beginnt`;
                break;
            case "turn-start":
                text = `${round(e.roundNumber)}Zug ${e.turnNumber}: ${name(e.playerId)} ist am Zug`;
                break;
            case "setup-start":
                text = "Aufstellung beginnt";
                break;
            case "game-end":
                text = "Spiel beendet";
                break;
            case "timeout-start":
                text = "Time-out beginnt";
                break;
            case "timeout-end":
                text = "Time-out beendet";
                break;
            case "turn-pause":
                text = `${name(e.playerId)}: Zug pausiert`;
                break;
            case "turn-resume":
                text = `${name(e.playerId)}: Zug fortgesetzt`;
                break;
            default: continue;
        }
        events.push({ id: e.id, createdAt: e.createdAt, text });
    }
    return events.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id))
        .slice(0, Math.min(exports.TV_EVENT_LIMIT, Math.max(0, Math.floor(limit))))
        .map(e => ({ id: e.id, createdAt: e.createdAt, text: e.text, time: (0, time_1.formatClockTime)(e.createdAt) }));
};
exports.buildTvEventFeed = buildTvEventFeed;
