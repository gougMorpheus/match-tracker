// HTTP Date is truncated to a full second. Each response bounds the offset;
// compatible responses at different sub-second phases narrow the uncertainty.
export interface ClockSample { lowerBoundMs: number; upperBoundMs: number; roundTripMs: number }
const MAX_CLOCK_SAMPLES = 9;
export const estimateClockSample = (date: string | null, sentAt: number, receivedAt: number): ClockSample | null => {
  const serverSecond = date ? Date.parse(date) : NaN;
  const roundTripMs = receivedAt - sentAt;
  if (!Number.isFinite(serverSecond) || !Number.isFinite(sentAt) || !Number.isFinite(receivedAt) ||
      roundTripMs < 0 || roundTripMs > 5000) return null;
  return { lowerBoundMs: serverSecond - receivedAt, upperBoundMs: serverSecond + 1000 - sentAt, roundTripMs };
};
export const estimateClockOffset = (samples: ClockSample[]): number => {
  const recent = samples.filter((sample) => Number.isFinite(sample.lowerBoundMs) &&
    Number.isFinite(sample.upperBoundMs) && sample.lowerBoundMs <= sample.upperBoundMs &&
    Number.isFinite(sample.roundTripMs) && sample.roundTripMs >= 0 && sample.roundTripMs <= 5000).slice(-MAX_CLOCK_SAMPLES);
  if (!recent.length) return 0;
  let lo = recent[recent.length - 1].lowerBoundMs;
  let hi = recent[recent.length - 1].upperBoundMs;
  // Keep the newest consistent suffix. An outlier/clock jump discards older
  // constraints instead of combining incompatible clock epochs.
  for (let index = recent.length - 2; index >= 0; index -= 1) {
    const nextLo = Math.max(lo, recent[index].lowerBoundMs);
    const nextHi = Math.min(hi, recent[index].upperBoundMs);
    if (nextLo > nextHi) break;
    lo = nextLo;
    hi = nextHi;
  }
  return (lo + hi) / 2;
};
export const applyClockOffset = (localNow: number, offsetMs: number): number => localNow + (Number.isFinite(offsetMs) ? offsetMs : 0);
export const elapsedTimerMs = (startedAt: number | undefined, accumulatedMs: number, running: boolean, now: number): number =>
  Math.max(0, Number.isFinite(accumulatedMs) ? accumulatedMs : 0) +
  (running && startedAt !== undefined && Number.isFinite(startedAt) && Number.isFinite(now) ? Math.max(0, now - startedAt) : 0);
let samples: ClockSample[] = [];
export const observeServerDate = (date: string | null, sentAt: number, receivedAt: number): void => {
  const sample = estimateClockSample(date, sentAt, receivedAt);
  if (sample) samples = [...samples.slice(-(MAX_CLOCK_SAMPLES - 1)), sample];
};
export const getServerNow = (): number => applyClockOffset(Date.now(), estimateClockOffset(samples));
