const assert = require('node:assert/strict');
const { getNextServerSecondDelay, startServerSecondTicker } = require('../.test-dist/utils/serverSecondTicker.js');
const runServerSecondTickerTests = () => {
  assert.equal(getNextServerSecondDelay(0), 1005);
  assert.equal(getNextServerSecondDelay(999), 6);
  assert.equal(getNextServerSecondDelay(-1), 6);
  assert.equal(100 + getNextServerSecondDelay(100), 700 + getNextServerSecondDelay(700), 'Different mount phases reach the same server boundary');
  const saved = {setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout};
  const scheduled = new Map(); let id = 0;
  try {
    globalThis.setTimeout = (fn, delay) => { scheduled.set(++id, {fn, delay}); return id; };
    globalThis.clearTimeout = (id) => scheduled.delete(id);
    let now = 712;
    let renders = 0;
    const stop = startServerSecondTicker(() => { renders++; }, () => now);
    const fire = () => {
      const [key, timer] = [...scheduled][0];
      scheduled.delete(key); timer.fn();
    };
    assert.equal([...scheduled.values()][0].delay, 293);
    now = 1005; fire();
    assert.equal(renders, 1);
    assert.equal([...scheduled.values()][0].delay, 1000);
    now = 2647; fire(); // Simulate throttled tab or changed clock estimate.
    assert.equal(renders, 2);
    assert.equal([...scheduled.values()][0].delay, 358, 'Rearm from corrected now, never the previous timer phase');
    const queued = [...scheduled.values()][0];
    stop(); assert.equal(scheduled.size, 0);
    queued.fn(); assert.equal(renders, 2, 'Late callback after cleanup cannot render/rearm');
    const stopDuringRender = startServerSecondTicker(() => stopDuringRender(), () => 100);
    fire(); assert.equal(scheduled.size, 0, 'Unmount during render cannot rearm');
  } finally { Object.assign(globalThis, saved); }
};
module.exports = { runServerSecondTickerTests };
