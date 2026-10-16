"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sortEventsNewestFirst = exports.createEventComparators = exports.compareEventsDesc = exports.compareEventsAsc = exports.buildTurnStartAnchors = exports.TURN_START_ANCHOR_WINDOW_MS = exports.getLogicalRank = void 0;
const TIME_RANK = {
    "turn-end": 10, "setup-end": 10, "round-end": 20, "game-end": 30,
    "game-start": 35, "round-start": 40, "setup-start": 45, "turn-start": 50
};
const HIGHLIGHT_RANK = {
    "round-summary": 21, "time-overtake": 22, "time-milestone": 23, "game-end": 31, "game-start": 36
};
const OTHER_RANK = 60;
const OTHER_HIGHLIGHT_RANK = 61; // Fuehrung/Ausgleich/Herausforderung: nach dem ausloesenden Punkte-Event
const highlightKindOf = (e) => {
    if (e.id?.startsWith("highlight:"))
        return e.id.split(":")[1] ?? null;
    if (e.kind && !["time", "cp", "score", "note", "highlight"].includes(e.kind))
        return e.kind;
    return null;
};
const getLogicalRank = (e) => {
    const hk = highlightKindOf(e);
    if (hk)
        return HIGHLIGHT_RANK[hk.startsWith("time-milestone") ? "time-milestone" : hk] ?? OTHER_HIGHLIGHT_RANK;
    const action = e.timeAction ?? e.action;
    return action ? TIME_RANK[action] ?? OTHER_RANK : OTHER_RANK;
};
exports.getLogicalRank = getLogicalRank;
// Auto-CP/Punkte kurz VOR dem eigenen Zug Start (Client- vs. Serverzeit, wenige ms): in der Anzeige direkt nach
// Zug Start einsortieren (Rang 55, Zeitpunkt = Zug Start). Gilt fuer CP und Punkte mit derselben Runde/demselben Zug,
// die bis zu 2 s vor (oder gleichzeitig mit) dessen Zug Start liegen. Nur Anzeige; Auswertung/Highlights unveraendert.
exports.TURN_START_ANCHOR_WINDOW_MS = 2000;
const ANCHORED_RANK = 55;
const turnKeyOf = (e) => `${e.roundNumber}:${e.turnNumber}`;
const isCpOrScore = (e) => e.kind === "cp" || e.kind === "score";
const buildTurnStartAnchors = (events) => {
    const anchors = new Map();
    for (const e of events) {
        if ((e.timeAction ?? e.action) !== "turn-start" || !e.roundNumber || !e.turnNumber || e.id?.startsWith("highlight:"))
            continue;
        const t = Date.parse(e.createdAt);
        const key = turnKeyOf(e);
        if (!anchors.has(key) || t < anchors.get(key))
            anchors.set(key, t);
    }
    return anchors;
};
exports.buildTurnStartAnchors = buildTurnStartAnchors;
const sortKey = (e, anchors) => {
    const t = Date.parse(e.createdAt);
    if (anchors && isCpOrScore(e) && e.roundNumber && e.turnNumber) {
        const start = anchors.get(turnKeyOf(e));
        if (start !== undefined && start - t >= 0 && start - t <= exports.TURN_START_ANCHOR_WINDOW_MS)
            return [start, ANCHORED_RANK];
    }
    return [t, (0, exports.getLogicalRank)(e)];
};
// Aufsteigend (chronologisch). Gleichstand nach Rang, danach ID (stabil, deterministisch). Mit anchors (aus derselben
// Ereignisliste) zusaetzlich die Zug-Start-Regel oben.
const compareEventsAsc = (a, b, anchors) => {
    const [ta, ra] = sortKey(a, anchors), [tb, rb] = sortKey(b, anchors);
    return ta - tb || ra - rb || (a.id ?? "").localeCompare(b.id ?? "");
};
exports.compareEventsAsc = compareEventsAsc;
// Neueste zuerst: exakte Umkehrung.
const compareEventsDesc = (a, b, anchors) => (0, exports.compareEventsAsc)(b, a, anchors);
exports.compareEventsDesc = compareEventsDesc;
// Vergleichsfunktionen fuer eine konkrete Ereignisliste (Anzeige: Verlauf, Letzte Ereignisse, TV-Feed).
const createEventComparators = (events) => {
    const anchors = (0, exports.buildTurnStartAnchors)(events);
    return {
        asc: (a, b) => (0, exports.compareEventsAsc)(a, b, anchors),
        desc: (a, b) => (0, exports.compareEventsDesc)(a, b, anchors)
    };
};
exports.createEventComparators = createEventComparators;
// Anzeige "neueste oben" fuer eine ganze Liste (mit Zug-Start-Regel).
const sortEventsNewestFirst = (items) => [...items].sort((0, exports.createEventComparators)(items).desc);
exports.sortEventsNewestFirst = sortEventsNewestFirst;
