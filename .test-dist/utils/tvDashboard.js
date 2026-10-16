"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTvStatusLabel = exports.buildTvEventFeed = exports.getDeficitInfo = exports.TV_FEED_SCROLL_LIMIT = exports.TV_EVENT_LIMIT = void 0;
const gameCalculations_1 = require("./gameCalculations");
const time_1 = require("./time");
const eventGrouping_1 = require("./eventGrouping");
exports.TV_EVENT_LIMIT = 8;
// View only: Ereignisliste scrollbar, bis zu so vielen Eintraegen.
exports.TV_FEED_SCROLL_LIMIT = 500;
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
// highlights: abgeleitete Highlights (deriveGameHighlights), erscheinen als eigene Ereignisart.
const SCORE_LABEL = { primary: "Primär", secondary: "Sekundär", challenge: "Herausforderung" };
const TIME_TEXT = { "round-start": true, "turn-start": true, "setup-start": true, "game-end": true, "timeout-start": true, "timeout-end": true, "turn-pause": true, "turn-resume": true };
const buildTvEventFeed = (game, limit = exports.TV_EVENT_LIMIT, highlights = []) => {
    const name = (id) => game.players.find(p => p.id === id)?.name ?? "Spieler";
    const round = (n) => n ? `Runde ${n} · ` : "";
    // Notizen werden nicht mehr angezeigt (Daten bleiben in der DB).
    const sources = [
        ...highlights.map(h => ({ id: h.id, createdAt: h.createdAt, kind: "highlight", highlightText: `${h.title}: ${h.subtitle}` })),
        ...game.scoreEvents.map(e => ({ id: e.id, createdAt: e.createdAt, kind: "score", playerId: e.playerId, roundNumber: e.roundNumber, turnNumber: e.turnNumber, scoreType: e.scoreType, value: e.value })),
        ...game.commandPointEvents.map(e => ({ id: e.id, createdAt: e.createdAt, kind: "cp", playerId: e.playerId, roundNumber: e.roundNumber, turnNumber: e.turnNumber, cpType: e.cpType, value: e.value })),
        ...game.timeEvents.filter(e => TIME_TEXT[e.action]).map(e => ({ id: e.id, createdAt: e.createdAt, kind: "time", playerId: e.playerId, roundNumber: e.roundNumber, turnNumber: e.turnNumber, timeAction: e.action }))
    ];
    const textOf = (g) => {
        const e = g.first;
        switch (g.kind) {
            case "highlight": return e.highlightText ?? "";
            case "score": return `${round(e.roundNumber)}${name(e.playerId)}: ${signed(g.scoreSum)} ${SCORE_LABEL[e.scoreType ?? ""] ?? "VP"}`;
            case "cp": return `${round(e.roundNumber)}${name(e.playerId)}: ${(0, eventGrouping_1.formatCpGroup)(g)}`;
            default: {
                const auto = g.autoCp.length ? eventGrouping_1.AUTO_CP_SUFFIX : "";
                switch (e.timeAction) {
                    case "round-start": return `Runde ${e.roundNumber} beginnt`;
                    case "turn-start": return `${round(e.roundNumber)}Zug ${e.turnNumber}: ${name(e.playerId)} ist am Zug${auto}`;
                    case "setup-start": return "Aufstellung beginnt";
                    case "game-end": return "Spiel beendet";
                    case "timeout-start": return "Time-out beginnt";
                    case "timeout-end": return "Time-out beendet";
                    case "turn-pause": return `${name(e.playerId)}: Zug pausiert`;
                    default: return `${name(e.playerId)}: Zug fortgesetzt`;
                }
            }
        }
    };
    // ID einer Gruppe = juengstes Event (stabil fuer Animationen, aendert sich, wenn ein Event dazukommt).
    return (0, eventGrouping_1.groupDisplayEvents)(sources, game.autoCommandPointAwards)
        .slice(0, Math.max(0, Math.floor(limit)))
        .map(g => ({ id: g.kind === "cp" || g.kind === "score" ? `group:${g.key}` : g.first.id, createdAt: g.createdAt, text: textOf(g), time: (0, time_1.formatClockTime)(g.createdAt), ...(g.kind === "highlight" ? { kind: "highlight" } : {}) }));
};
exports.buildTvEventFeed = buildTvEventFeed;
// Status-Chip der Zuschaueransicht. Der Zug startet nach "Weiter" aus der Aufstellung bewusst pausiert;
// solange noch keine Zugzeit gelaufen ist, heisst das "Zug noch nicht gestartet" statt "Pausiert".
const getTvStatusLabel = (s) => {
    if (s.completed)
        return "Beendet";
    if (s.timeout)
        return "Time-out";
    if (s.running)
        return "Läuft";
    if (!s.started)
        return "Bereit";
    // Pausiert, bevor ein Zug Zeit hatte (Aufstellung pausiert oder pausierter Zugstart): noch kein Zug gestartet.
    if (!s.hasTurn || s.turnMs < 1000)
        return "Zug noch nicht gestartet";
    return "Pausiert";
};
exports.getTvStatusLabel = getTvStatusLabel;
