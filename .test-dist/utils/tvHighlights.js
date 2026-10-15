"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enqueueTvHighlights = exports.reconcileTvHighlightQueue = exports.getScoreEventIds = exports.findNewScoreLeadHighlights = exports.MAX_TV_HIGHLIGHT_QUEUE = exports.HIGHLIGHT_ICON = exports.deriveScoreLeadHighlights = exports.SCORE_DRIVEN_KINDS = exports.deriveGameHighlights = exports.getGameAsOf = exports.detectTvHighlights = exports.HIGHLIGHT_RULES = exports.createTvSnapshot = void 0;
const gameCalculations_1 = require("./gameCalculations");
const headToHead_1 = require("./headToHead");
const gameState_1 = require("./gameState");
const createTvSnapshot = (game, nowIso) => {
    const round = (0, gameCalculations_1.getCurrentRoundNumber)(game), completed = game.status === "completed";
    const total = game.players.map(p => (0, gameCalculations_1.getPlayerComparableTotalScore)(game, p.id));
    const leaderId = total[0] !== null && total[1] !== null && total[0] !== total[1] ? game.players[total[0] > total[1] ? 0 : 1].id : null;
    // Supply an explicit end fallback to existing timer calculations, keeping this pure.
    const atNow = { ...game, endedAt: game.endedAt ?? nowIso };
    return { phaseKey: `r${round}t${(0, gameCalculations_1.getCurrentTurnNumber)(game)}:${completed}`, round, completed,
        winnerId: (0, headToHead_1.getGameOutcome)(game)?.winnerId ?? null, total, leaderId, lastLeaderId: leaderId,
        primary: game.players.map(p => (0, gameCalculations_1.getPlayerComparablePrimaryScore)(game, p.id)),
        secondary: game.players.map(p => (0, gameCalculations_1.getPlayerComparableSecondaryScore)(game, p.id)),
        timeMs: game.players.map(p => (0, gameCalculations_1.getPlayerTurnDurationTotalMs)(atNow, p.id)),
        roundPoints: Array.from({ length: 5 }, (_, r) => game.players.map(p => game.scoreDetailLevel === "full" || game.scoreEvents.some(e => e.scoreType === "legacy-total" && e.roundNumber !== undefined) ? (0, gameCalculations_1.getPlayerRoundScoreTotal)(game, p.id, r + 1) : null)) };
};
exports.createTvSnapshot = createTvSnapshot;
const highlight = (next, kind, title, subtitle, playerId) => ({ id: `${kind}:${next.phaseKey}`, kind, title, subtitle, playerId });
const scoreLabel = (next) => `${next.total[0] ?? "–"} : ${next.total[1] ?? "–"} VP`;
// Round time leaders are derived from the complete round history, independent of
// the viewer's initial snapshot. A margin below one minute has no leader.
const roundTimeChange = (prev, next, game) => {
    const roundNumber = next.round > prev.round ? next.round - 1 :
        !prev.completed && next.completed ? next.round : 0;
    if (roundNumber < 2)
        return [];
    const totals = [0, 0];
    let lastLeader = null;
    for (let r = 1; r <= roundNumber; r++) {
        const round = game.rounds.find(item => item.roundNumber === r);
        // Never evaluate an unfinished round at an early concession/game end.
        if (!round || !(next.round > r || round.endedAt || game.timeEvents.some(e => e.action === "round-end" && e.roundNumber === r)) ||
            round.turns.some(t => !t.timing.endedAt))
            return [];
        game.players.forEach((p, i) => {
            totals[i] += round.turns.filter(t => t.playerId === p.id).reduce((sum, t) => sum + (0, gameCalculations_1.getTurnDurationMs)(t, game), 0);
        });
        const leader = Math.abs(totals[0] - totals[1]) >= 60000 ? (totals[0] > totals[1] ? 0 : 1) : null;
        if (r === roundNumber && leader !== null && lastLeader !== null && leader !== lastLeader) {
            const clock = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
            const player = game.players[leader];
            return [{ id: `time-overtake:r${r}`, kind: "time-overtake", title: "Zeit-Duell",
                    subtitle: `${player.name} hat jetzt mehr Spielerzeit verbraucht · ${clock(totals[leader])} vs. ${clock(totals[1 - leader])}`, playerId: player.id }];
        }
        if (leader !== null)
            lastLeader = leader;
    }
    return [];
};
exports.HIGHLIGHT_RULES = [
    roundTimeChange,
    (prev, next, game) => {
        const before = prev.leaderId ?? prev.lastLeaderId;
        if (before && next.leaderId && before !== next.leaderId)
            return [highlight(next, "lead-change", "Führungswechsel", `${game.players.find(p => p.id === next.leaderId)?.name} übernimmt die Führung · ${scoreLabel(next)}`, next.leaderId)];
        if (prev.leaderId && !next.leaderId && next.total.every(v => v !== null) && next.total[0] === next.total[1])
            return [highlight(next, "equalizer", "Ausgleich", scoreLabel(next))];
        return [];
    },
    (prev, next, game) => {
        if ([...prev.total, ...next.total].some(v => v === null))
            return [];
        const oldGap = Math.abs(prev.total[0] - prev.total[1]), gap = Math.abs(next.total[0] - next.total[1]);
        if (oldGap >= 6 || gap < 6)
            return [];
        const player = game.players[next.total[0] < next.total[1] ? 0 : 1];
        return [highlight(next, "challenge", "Herausforderungskarten verfügbar", `${player.name} liegt ${gap} VP zurück`, player.id)];
    },
    (prev, next, game) => {
        const result = [];
        game.players.forEach((p, i) => {
            const minutes = next.timeMs[i] / 60000;
            const thresholds = [30, 45, 60];
            for (let m = 120; m <= minutes; m += 60)
                thresholds.push(m);
            for (const m of thresholds)
                if (prev.timeMs[i] < m * 60000 && next.timeMs[i] >= m * 60000)
                    result.push(highlight(next, `time-milestone-${i}-${m}`, m < 60 ? `${m} Minuten` : `${m / 60} ${m === 60 ? "Stunde" : "Stunden"}`, `${p.name} · verbrauchte Spielerzeit`, p.id));
        });
        return result;
    },
    (prev, next, game) => {
        if (next.round <= prev.round || prev.round < 1)
            return [];
        const points = next.roundPoints[prev.round - 1];
        return [highlight(next, "round-summary", `Runde ${prev.round} abgeschlossen`, `${game.players[0].name} ${points[0] ?? "–"} VP · ${game.players[1].name} ${points[1] ?? "–"} VP · Stand ${scoreLabel(next)}`)];
    },
    (prev, next, game) => {
        if (prev.completed || !next.completed)
            return [];
        const outcome = (0, headToHead_1.getGameOutcome)(game);
        const winner = game.players.find(p => p.id === outcome?.winnerId);
        return [highlight(next, "game-end", winner ? `${winner.name} gewinnt` : outcome?.draw ? "Unentschieden" : "Spiel beendet", `Endstand ${scoreLabel(next)}`, winner?.id)];
    }
];
const detectTvHighlights = (prev, next, game, rules = exports.HIGHLIGHT_RULES) => prev.phaseKey === next.phaseKey ? [] : rules.flatMap(rule => rule(prev, next, game));
exports.detectTvHighlights = detectTvHighlights;
const PHASE_ACTIONS = new Set(["round-start", "turn-start", "game-end"]);
const getGameAsOf = (game, iso) => {
    const until = Date.parse(iso);
    const keep = (items) => items.filter(e => Date.parse(e.createdAt) <= until);
    const timeEvents = keep(game.timeEvents);
    const ended = timeEvents.some(e => e.action === "game-end");
    return (0, gameState_1.syncDerivedGameState)({ ...game, timeEvents, scoreEvents: keep(game.scoreEvents),
        commandPointEvents: keep(game.commandPointEvents), noteEvents: keep(game.noteEvents),
        endedAt: ended ? game.endedAt : undefined, finishReason: ended ? game.finishReason : undefined,
        // Altdaten-Summen ohne Zeitstempel gehoeren zum Endstand.
        legacyScoreTotals: ended ? game.legacyScoreTotals : {} });
};
exports.getGameAsOf = getGameAsOf;
const deriveGameHighlights = (game, rules = exports.HIGHLIGHT_RULES) => {
    const boundaries = [...new Set(game.timeEvents.filter(e => PHASE_ACTIONS.has(e.action)).map(e => e.createdAt))]
        .sort((a, b) => Date.parse(a) - Date.parse(b));
    const result = [];
    const seen = new Set();
    let prev = null;
    for (const at of boundaries) {
        const asOf = (0, exports.getGameAsOf)(game, at);
        const next = (0, exports.createTvSnapshot)(asOf, asOf.endedAt ?? at);
        if (!prev) {
            prev = next;
            continue;
        }
        if (prev.phaseKey === next.phaseKey)
            continue;
        for (const h of (0, exports.detectTvHighlights)(prev, next, asOf, rules)) {
            // Fuehrungswechsel/Ausgleich kommen aus deriveScoreLeadHighlights (pro Punkte-Event).
            if (exports.SCORE_DRIVEN_KINDS.has(h.kind))
                continue;
            if (seen.has(h.id))
                continue;
            seen.add(h.id);
            result.push({ ...h, id: `highlight:${h.id}`, createdAt: at, roundNumber: (0, gameCalculations_1.getCurrentRoundNumber)(asOf), turnNumber: (0, gameCalculations_1.getCurrentTurnNumber)(asOf) });
        }
        next.lastLeaderId = next.leaderId ?? prev.lastLeaderId;
        prev = next;
    }
    return [...result, ...(0, exports.deriveScoreLeadHighlights)(game)]
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
};
exports.deriveGameHighlights = deriveGameHighlights;
// Fehlerbild 15.10.: Fuehrungswechsel innerhalb eines Zugs fehlten, weil der Stand nur an Phasengrenzen
// verglichen wurde. Jetzt: Stand nach JEDEM (nicht widerrufenen) Punkte-Event. Widerrufene Events (Undo)
// sind schon aus game.scoreEvents entfernt, negative Korrekturen gehen in die Summe ein.
exports.SCORE_DRIVEN_KINDS = new Set(["lead-change", "equalizer"]);
const deriveScoreLeadHighlights = (game) => {
    const events = [...game.scoreEvents].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
    const result = [];
    let leader = null;
    let lastLeader = null;
    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        // Mehrere Events mit identischem Zeitstempel als einen Schritt werten.
        if (i + 1 < events.length && events[i + 1].createdAt === event.createdAt)
            continue;
        const until = Date.parse(event.createdAt);
        const partial = { ...game, legacyScoreTotals: {}, scoreEvents: events.filter(e => Date.parse(e.createdAt) <= until) };
        const total = game.players.map(p => (0, gameCalculations_1.getPlayerComparableTotalScore)(partial, p.id) ?? 0);
        const now = total[0] === total[1] ? null : total[0] > total[1] ? 0 : 1;
        const label = `${total[0]} : ${total[1]} VP`;
        const meta = { createdAt: event.createdAt, roundNumber: event.roundNumber, turnNumber: event.turnNumber };
        if (now !== null && lastLeader !== null && now !== lastLeader) {
            const player = game.players[now];
            result.push({ id: `highlight:lead-change:${event.id}`, kind: "lead-change", title: "Führungswechsel",
                subtitle: `${player.name} übernimmt die Führung · ${label}`, playerId: player.id, ...meta });
        }
        else if (now === null && leader !== null) {
            result.push({ id: `highlight:equalizer:${event.id}`, kind: "equalizer", title: "Ausgleich", subtitle: label, ...meta });
        }
        leader = now;
        if (now !== null)
            lastLeader = now;
    }
    return result;
};
exports.deriveScoreLeadHighlights = deriveScoreLeadHighlights;
exports.HIGHLIGHT_ICON = "★";
// TV-Einblendung fuer Fuehrungswechsel/Ausgleich mitten im Zug (gleiche Logik wie Liste/Verlauf).
// - Neu sind nur Highlights, die beim letzten Stand noch nicht existierten (kein Nachspielen der Historie).
// - Undo: Einblendungen, deren ausloesendes Event nicht mehr gilt, werden aus der Warteschlange entfernt
//   (auch die gerade sichtbare).
// - Kein Stau: von mehreren schnell aufeinanderfolgenden Punkte-Highlights wartet nur das neueste;
//   die sichtbare Einblendung wird nicht ersetzt (kein Flackern). Warteschlange hoechstens 3 Eintraege.
exports.MAX_TV_HIGHLIGHT_QUEUE = 3;
// knownEventIds: nur Highlights von Punkte-Events, die beim letzten Stand noch nicht existierten
// (ein Undo mitten im Verlauf erzeugt so keine Einblendungen fuer alte Events).
const sourceEventId = (h) => h.id.replace(/^highlight:(lead-change|equalizer):/, "");
const findNewScoreLeadHighlights = (seen, current, knownEventIds = null) => current.filter(h => !seen.has(h.id) && (!knownEventIds || !knownEventIds.has(sourceEventId(h))));
exports.findNewScoreLeadHighlights = findNewScoreLeadHighlights;
const getScoreEventIds = (game) => new Set(game.scoreEvents.map(e => e.id));
exports.getScoreEventIds = getScoreEventIds;
const reconcileTvHighlightQueue = (queue, validScoreIds) => {
    const next = queue.filter(h => !exports.SCORE_DRIVEN_KINDS.has(h.kind) || validScoreIds.has(h.id));
    return next.length === queue.length ? queue : next;
};
exports.reconcileTvHighlightQueue = reconcileTvHighlightQueue;
const enqueueTvHighlights = (queue, incoming) => {
    if (!incoming.length)
        return queue;
    const scoreIncoming = incoming.filter(h => exports.SCORE_DRIVEN_KINDS.has(h.kind));
    const other = incoming.filter(h => !exports.SCORE_DRIVEN_KINDS.has(h.kind));
    const [active, ...pending] = queue;
    const latestScore = scoreIncoming.slice(-1);
    const keptPending = latestScore.length ? pending.filter(h => !exports.SCORE_DRIVEN_KINDS.has(h.kind)) : pending;
    const merged = [...(active ? [active] : []), ...keptPending, ...other, ...latestScore];
    if (merged.length <= exports.MAX_TV_HIGHLIGHT_QUEUE)
        return merged;
    // Aktive behalten, aelteste wartende verwerfen.
    return [merged[0], ...merged.slice(merged.length - (exports.MAX_TV_HIGHLIGHT_QUEUE - 1))];
};
exports.enqueueTvHighlights = enqueueTvHighlights;
