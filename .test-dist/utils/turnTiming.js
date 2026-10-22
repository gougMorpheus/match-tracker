"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTurnTimingTracker = void 0;
const isRunning = (turn) => {
    const latestPause = turn.timing.pauses[turn.timing.pauses.length - 1];
    return Boolean(turn.timing.startedAt && !turn.timing.endedAt && (!latestPause || latestPause.endedAt));
};
const createTurnTimingTracker = () => {
    const turnsByKey = new Map();
    const reopened = new Set();
    const keyOf = (turn) => `${turn.roundNumber}:${turn.turnNumber}`;
    const stopOtherTurns = (at, exceptKey) => {
        turnsByKey.forEach((other, key) => {
            if (key === exceptKey)
                return;
            if (reopened.has(key)) {
                reopened.delete(key);
                const latestPause = other.timing.pauses[other.timing.pauses.length - 1];
                if (latestPause && !latestPause.endedAt) {
                    other.timing.pauses.pop();
                    other.timing.endedAt = latestPause.startedAt;
                }
                else {
                    other.timing.endedAt = at;
                }
                return;
            }
            if (isRunning(other))
                other.timing.pauses.push({ startedAt: at });
        });
    };
    return {
        // setup-start / setup-resume: die Aufstellung wird die zaehlende Phase
        setupActivated: (at) => stopOtherTurns(at, null),
        apply: (action, turn, at) => {
            const key = keyOf(turn);
            turnsByKey.set(key, turn);
            const latestPause = turn.timing.pauses[turn.timing.pauses.length - 1];
            if (action === "turn-start") {
                if (turn.timing.endedAt && at >= turn.timing.endedAt)
                    return;
                if (!turn.timing.startedAt) {
                    turn.timing.startedAt = at;
                }
                else if (latestPause && !latestPause.endedAt) {
                    latestPause.endedAt = at;
                }
                stopOtherTurns(at, key);
                return;
            }
            if (action === "turn-resume") {
                if (!turn.timing.startedAt)
                    return;
                if (turn.timing.endedAt && at >= turn.timing.endedAt) {
                    turn.timing.pauses.push({ startedAt: turn.timing.endedAt, endedAt: at });
                    turn.timing.endedAt = undefined;
                    reopened.add(key);
                }
                else if (latestPause && !latestPause.endedAt && at >= latestPause.startedAt) {
                    latestPause.endedAt = at;
                }
                stopOtherTurns(at, key);
                return;
            }
            if (action === "turn-pause") {
                if (!turn.timing.startedAt || (turn.timing.endedAt && at >= turn.timing.endedAt))
                    return;
                if (!latestPause || latestPause.endedAt)
                    turn.timing.pauses.push({ startedAt: at });
                return;
            }
            // turn-end
            if (turn.timing.endedAt && at >= turn.timing.endedAt)
                return;
            if (latestPause && !latestPause.endedAt)
                latestPause.endedAt = at;
            turn.timing.endedAt = at;
            reopened.delete(key);
        }
    };
};
exports.createTurnTimingTracker = createTurnTimingTracker;
