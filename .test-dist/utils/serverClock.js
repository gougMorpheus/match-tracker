"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getServerNow = exports.observeServerDate = exports.elapsedTimerMs = exports.applyClockOffset = exports.estimateClockOffset = exports.estimateClockSample = void 0;
const MAX_CLOCK_SAMPLES = 9;
const estimateClockSample = (date, sentAt, receivedAt) => {
    const serverSecond = date ? Date.parse(date) : NaN;
    const roundTripMs = receivedAt - sentAt;
    if (!Number.isFinite(serverSecond) || !Number.isFinite(sentAt) || !Number.isFinite(receivedAt) ||
        roundTripMs < 0 || roundTripMs > 5000)
        return null;
    return { lowerBoundMs: serverSecond - receivedAt, upperBoundMs: serverSecond + 1000 - sentAt, roundTripMs };
};
exports.estimateClockSample = estimateClockSample;
const estimateClockOffset = (samples) => {
    const recent = samples.filter((sample) => Number.isFinite(sample.lowerBoundMs) &&
        Number.isFinite(sample.upperBoundMs) && sample.lowerBoundMs <= sample.upperBoundMs &&
        Number.isFinite(sample.roundTripMs) && sample.roundTripMs >= 0 && sample.roundTripMs <= 5000).slice(-MAX_CLOCK_SAMPLES);
    if (!recent.length)
        return 0;
    let lo = recent[recent.length - 1].lowerBoundMs;
    let hi = recent[recent.length - 1].upperBoundMs;
    // Keep the newest consistent suffix. An outlier/clock jump discards older
    // constraints instead of combining incompatible clock epochs.
    for (let index = recent.length - 2; index >= 0; index -= 1) {
        const nextLo = Math.max(lo, recent[index].lowerBoundMs);
        const nextHi = Math.min(hi, recent[index].upperBoundMs);
        if (nextLo > nextHi)
            break;
        lo = nextLo;
        hi = nextHi;
    }
    return (lo + hi) / 2;
};
exports.estimateClockOffset = estimateClockOffset;
const applyClockOffset = (localNow, offsetMs) => localNow + (Number.isFinite(offsetMs) ? offsetMs : 0);
exports.applyClockOffset = applyClockOffset;
const elapsedTimerMs = (startedAt, accumulatedMs, running, now) => Math.max(0, Number.isFinite(accumulatedMs) ? accumulatedMs : 0) +
    (running && startedAt !== undefined && Number.isFinite(startedAt) && Number.isFinite(now) ? Math.max(0, now - startedAt) : 0);
exports.elapsedTimerMs = elapsedTimerMs;
let samples = [];
const observeServerDate = (date, sentAt, receivedAt) => {
    const sample = (0, exports.estimateClockSample)(date, sentAt, receivedAt);
    if (sample)
        samples = [...samples.slice(-(MAX_CLOCK_SAMPLES - 1)), sample];
};
exports.observeServerDate = observeServerDate;
const getServerNow = () => (0, exports.applyClockOffset)(Date.now(), (0, exports.estimateClockOffset)(samples));
exports.getServerNow = getServerNow;
