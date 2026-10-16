"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderTimeEventsForEvaluation = exports.fixStartBeforePauseTies = void 0;
const PAUSE_ACTIONS = new Set(["turn-pause", "setup-pause"]);
const isStartFor = (start, pause) => pause.action === "setup-pause" ? start.action === "game-start" || start.action === "setup-start" :
    start.action === "game-start" ||
        (start.action === "round-start" && (start.roundNumber === undefined || start.roundNumber === pause.roundNumber)) ||
        (start.action === "turn-start" && start.roundNumber === pause.roundNumber && start.turnNumber === pause.turnNumber);
const fixStartBeforePauseTies = (sorted) => {
    const result = [];
    for (let i = 0; i < sorted.length;) {
        let j = i + 1;
        while (j < sorted.length && sorted[j].createdAt === sorted[i].createdAt)
            j++;
        const group = sorted.slice(i, j);
        if (group.length > 1) {
            // Jede Pause, nach der in derselben Zeitstempel-Gruppe noch ein passender Start folgt, hinter den letzten
            // passenden Start verschieben. Reihenfolge der uebrigen Events bleibt.
            for (let k = 0; k < group.length; k++) {
                const event = group[k];
                if (!PAUSE_ACTIONS.has(event.action))
                    continue;
                let last = -1;
                for (let m = k + 1; m < group.length; m++)
                    if (isStartFor(group[m], event))
                        last = m;
                if (last > k) {
                    group.splice(k, 1);
                    group.splice(last, 0, event);
                    k--;
                }
            }
        }
        result.push(...group);
        i = j;
    }
    return result;
};
exports.fixStartBeforePauseTies = fixStartBeforePauseTies;
const orderTimeEventsForEvaluation = (events) => (0, exports.fixStartBeforePauseTies)([...events].sort((left, right) => left.createdAt.localeCompare(right.createdAt)));
exports.orderTimeEventsForEvaluation = orderTimeEventsForEvaluation;
