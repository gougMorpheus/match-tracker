"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compareEventsDesc = exports.compareEventsAsc = exports.getLogicalRank = void 0;
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
// Aufsteigend (chronologisch). Gleichstand nach Rang, danach ID (stabil, deterministisch).
const compareEventsAsc = (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || (0, exports.getLogicalRank)(a) - (0, exports.getLogicalRank)(b) || (a.id ?? "").localeCompare(b.id ?? "");
exports.compareEventsAsc = compareEventsAsc;
// Neueste zuerst: exakte Umkehrung.
const compareEventsDesc = (a, b) => (0, exports.compareEventsAsc)(b, a);
exports.compareEventsDesc = compareEventsDesc;
