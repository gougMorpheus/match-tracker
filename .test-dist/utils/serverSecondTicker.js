"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startServerSecondTicker = exports.getNextServerSecondDelay = void 0;
const serverClock_1 = require("./serverClock");
const getNextServerSecondDelay = (now) => 1000 - ((now % 1000 + 1000) % 1000) + 5;
exports.getNextServerSecondDelay = getNextServerSecondDelay;
// Render-only scheduler: re-align on every tick, including after delayed tab
// wakeups or clock corrections. No elapsed-time counters or domain mutations.
const startServerSecondTicker = (render, now = serverClock_1.getServerNow) => {
    let stopped = false;
    let timer;
    const arm = () => {
        timer = setTimeout(() => {
            if (stopped)
                return;
            render();
            if (!stopped)
                arm();
        }, (0, exports.getNextServerSecondDelay)(now()));
    };
    arm();
    return () => { stopped = true; clearTimeout(timer); };
};
exports.startServerSecondTicker = startServerSecondTicker;
