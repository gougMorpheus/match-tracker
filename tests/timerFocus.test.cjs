const assert = require("node:assert/strict");
const { getTimerFocusTurn, shouldRunTimerTicker } = require("../.test-dist/utils/timerFocus.js");

const createTurn = (overrides = {}) => ({
  id: "turn-1",
  roundNumber: 1,
  turnNumber: 1,
  playerId: "player-1",
  timing: {
    startedAt: "2026-04-20T18:30:00.000Z",
    endedAt: undefined,
    pauses: []
  },
  ...overrides
});

const runTimerFocusTests = () => {
  {
    const latestTurn = createTurn({
      id: "turn-latest",
      roundNumber: 2,
      turnNumber: 1,
      playerId: "player-2"
    });
    const selectedTurn = createTurn({
      id: "turn-selected",
      roundNumber: 1,
      turnNumber: 2,
      playerId: "player-1"
    });

    assert.equal(getTimerFocusTurn(selectedTurn, latestTurn), selectedTurn);
    assert.equal(shouldRunTimerTicker(selectedTurn), true);
    assert.equal(shouldRunTimerTicker(latestTurn), true);
  }

  {
    const pausedTurn = createTurn({
      id: "turn-paused",
      timing: {
        startedAt: "2026-04-20T18:30:00.000Z",
        endedAt: undefined,
        pauses: [{ startedAt: "2026-04-20T18:35:00.000Z" }]
      }
    });

    assert.equal(shouldRunTimerTicker(pausedTurn), false);
    assert.equal(shouldRunTimerTicker(pausedTurn, true), false);
    assert.equal(shouldRunTimerTicker(pausedTurn, false, true), false);
  }

  {
    const selectedTurn = createTurn({
      id: "turn-selected",
      roundNumber: 3,
      turnNumber: 2,
      playerId: "player-2",
      timing: {
        startedAt: "2026-04-20T19:00:00.000Z",
        endedAt: undefined,
        pauses: []
      }
    });
    const latestTurn = createTurn({
      id: "turn-latest",
      roundNumber: 4,
      turnNumber: 1,
      playerId: "player-1",
      timing: {
        startedAt: "2026-04-20T19:20:00.000Z",
        endedAt: undefined,
        pauses: []
      }
    });

    assert.equal(getTimerFocusTurn(selectedTurn, latestTurn), selectedTurn);
    assert.equal(shouldRunTimerTicker(getTimerFocusTurn(selectedTurn, latestTurn)), true);
  }
};

module.exports = {
  runTimerFocusTests
};
