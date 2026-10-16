"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AUTO_CP_SUFFIX = exports.formatScoreValue = exports.formatCpGroup = exports.groupDisplayEvents = exports.findAutoCommandPoints = exports.AUTO_CP_WINDOW_MS = exports.getSameTimeRank = void 0;
const eventOrder_1 = require("./eventOrder");
// Gleicher Zeitpunkt: zentrale logische Reihenfolge (eventOrder.ts), z. B. Zug Ende, ★ Runde abgeschlossen, Runde beginnt, Zug Start, Pause.
const getSameTimeRank = (e) => (0, eventOrder_1.getLogicalRank)(e);
exports.getSameTimeRank = getSameTimeRank;
const byTimeAsc = (a, b) => (0, eventOrder_1.compareEventsAsc)(a, b);
const hasTurn = (e) => typeof e.roundNumber === "number" && typeof e.turnNumber === "number";
// Auto-CP liegen zeitlich am Zugstart: frueher exakt gleicher Zeitpunkt, seit Server-Zeitstempeln fuer
// Zeit-Events bis zu einige ms (Client-Uhr) daneben. Fenster +-2 s, je Spieler und Zugstart nur das erste.
exports.AUTO_CP_WINDOW_MS = 2000;
const turnKey = (round, turn) => `${round}:${turn}`;
// awardedTurns: optional game.autoCommandPointAwards ("runde:zug" -> true); wenn angegeben, nur dort Auto-CP.
const findAutoCommandPoints = (asc, awardedTurns) => {
    const starts = asc.filter(e => e.kind === "time" && e.timeAction === "turn-start" && hasTurn(e));
    const result = new Map(); // cp-id -> turn-start
    for (const start of starts) {
        const key = turnKey(start.roundNumber, start.turnNumber);
        if (awardedTurns && !awardedTurns[key])
            continue;
        const t = Date.parse(start.createdAt);
        const seen = new Set();
        for (const e of asc) {
            if (e.kind !== "cp" || e.cpType !== "gained" || e.value !== 1 || turnKey(e.roundNumber, e.turnNumber) !== key)
                continue;
            if (Math.abs(Date.parse(e.createdAt) - t) > exports.AUTO_CP_WINDOW_MS || seen.has(e.playerId ?? "") || result.has(e.id))
                continue;
            seen.add(e.playerId ?? "");
            result.set(e.id, start);
        }
    }
    return result;
};
exports.findAutoCommandPoints = findAutoCommandPoints;
const groupDisplayEvents = (events, awardedTurns) => {
    const asc = [...events].sort(byTimeAsc);
    const autoCp = (0, exports.findAutoCommandPoints)(asc, awardedTurns);
    const groups = [];
    const buckets = new Map();
    const turnStartGroups = new Map();
    const make = (key, e) => ({ key, kind: e.kind, items: [], first: e, latest: e, createdAt: e.createdAt,
        playerId: e.playerId, roundNumber: e.roundNumber, turnNumber: e.turnNumber, autoCp: [], cpGained: 0, cpSpent: 0, scoreSum: 0, scoreType: e.scoreType });
    const add = (g, e) => {
        g.items.push(e);
        g.latest = e;
        g.createdAt = e.createdAt;
        if (e.kind === "cp") {
            if (e.cpType === "spent")
                g.cpSpent += Math.abs(e.value ?? 0);
            else
                g.cpGained += Math.abs(e.value ?? 0);
        }
        if (e.kind === "score")
            g.scoreSum += e.value ?? 0;
    };
    for (const e of asc) {
        if (autoCp.has(e.id))
            continue;
        if (e.kind === "cp" || e.kind === "score") {
            const base = e.kind === "cp" ? `cp|${e.playerId}` : `score|${e.scoreType}|${e.playerId}`;
            if (hasTurn(e)) {
                const key = `${base}|${e.roundNumber}|${e.turnNumber}`;
                let g = buckets.get(key);
                if (!g) {
                    g = make(key, e);
                    buckets.set(key, g);
                    groups.push(g);
                }
                add(g, e);
                continue;
            }
            const last = groups[groups.length - 1];
            if (last && last.key.startsWith(`${base}|-|`)) {
                add(last, e);
                continue;
            }
            const g = make(`${base}|-|${e.id}`, e);
            add(g, e);
            groups.push(g);
            continue;
        }
        const g = make(`${e.kind}|${e.id}`, e);
        add(g, e);
        groups.push(g);
        if (e.kind === "time" && e.timeAction === "turn-start")
            turnStartGroups.set(e.id, g);
    }
    for (const [cpId, start] of autoCp) {
        const cp = asc.find(e => e.id === cpId);
        turnStartGroups.get(start.id)?.autoCp.push(cp);
    }
    // Neueste zuerst; Zeitpunkt einer Gruppe = juengstes Event; Gleichstand nach logischer Reihenfolge (umgekehrt).
    return groups.sort((a, b) => (0, eventOrder_1.compareEventsDesc)({ ...a.latest, createdAt: a.createdAt }, { ...b.latest, createdAt: b.createdAt }));
};
exports.groupDisplayEvents = groupDisplayEvents;
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "±0");
const formatCpGroup = (g) => g.cpGained && g.cpSpent ? `+${g.cpGained} / −${g.cpSpent} CP` : g.cpSpent ? `−${g.cpSpent} CP` : `+${g.cpGained} CP`;
exports.formatCpGroup = formatCpGroup;
const formatScoreValue = (n) => signed(n);
exports.formatScoreValue = formatScoreValue;
exports.AUTO_CP_SUFFIX = " (auto CP each)";
