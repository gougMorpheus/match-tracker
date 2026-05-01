const assert = require("node:assert/strict");
const {
  createCpScoreCorrelationPoints,
  createPlayerTurnDurationAggregates,
  createRoundScoreAggregates,
  createStatsOverview,
  filterGames,
  getCurrentRoundNumber,
  getPlayerCommandPoints,
  getPlayerCommandPointsSpent,
  getPlayerPrimaryTotal,
  getPlayerSecondaryTotal,
  getPlayerTurnDurationTotalMs,
  getRoundDurationMs,
  getSetupDurationMs,
  getSessionDurationMs,
  getTurnDurationMs,
  getTurnRecords,
  isTurnPaused,
  prepareGamesForStats
} = require("../.test-dist/utils/gameCalculations.js");
const {
  appendLocalCommandPointEvent,
  appendLocalScoreEvent,
  appendLocalTimeEvents
} = require("../.test-dist/utils/gameState.js");
const {
  createBaseGame,
  createCompletedGameFixture,
  createPausedActiveGameFixture
} = require("./helpers/gameFixtures.cjs");

const runGameCalculationsTests = () => {
  {
    const game = createCompletedGameFixture();
    const [playerOne, playerTwo] = game.players;
    const firstRound = game.rounds[0];
    const firstTurn = firstRound?.turns[0];
    const secondTurn = firstRound?.turns[1];

    assert.ok(firstRound);
    assert.ok(firstTurn);
    assert.ok(secondTurn);

    assert.equal(getCurrentRoundNumber(game), 1);
    assert.equal(getPlayerPrimaryTotal(game, playerOne.id), 5);
    assert.equal(getPlayerSecondaryTotal(game, playerOne.id), 4);
    assert.equal(getPlayerCommandPoints(game, playerOne.id), 1);
    assert.equal(getPlayerCommandPointsSpent(game, playerTwo.id), 2);
    assert.equal(getTurnDurationMs(firstTurn, game), 12 * 60 * 1000);
    assert.equal(getTurnDurationMs(secondTurn, game), 15 * 60 * 1000);
    assert.equal(getRoundDurationMs(firstRound, game), 27 * 60 * 1000);
    assert.equal(getPlayerTurnDurationTotalMs(game, playerOne.id), 12 * 60 * 1000);
    assert.equal(getSessionDurationMs(game), 45 * 60 * 1000);
  }

  {
    const game = createPausedActiveGameFixture();
    const activeTurn = game.rounds[0]?.turns[0];

    assert.ok(activeTurn);
    assert.equal(isTurnPaused(activeTurn), true);
  }

  {
    const completedGame = createCompletedGameFixture("game-filter-1");
    const activeGame = createPausedActiveGameFixture();
    const games = [completedGame, activeGame];

    const filteredByPlayer = filterGames(games, {
      query: "",
      playerName: "Alice",
      armyName: "all",
      status: "all",
      dateFrom: "",
      dateTo: ""
    });
    const filteredByStatus = filterGames(games, {
      query: "",
      playerName: "all",
      armyName: "all",
      status: "completed",
      dateFrom: "",
      dateTo: ""
    });
    const filteredByQuery = filterGames(games, {
      query: "sweeping",
      playerName: "all",
      armyName: "all",
      status: "all",
      dateFrom: "",
      dateTo: ""
    });
    const overview = createStatsOverview([completedGame]);

    assert.equal(filteredByPlayer.length, 2);
    assert.deepEqual(filteredByStatus.map((game) => game.id), ["game-filter-1"]);
    assert.equal(filteredByQuery.length, 2);
    assert.equal(overview.games, 1);
    assert.equal(overview.players, 2);
    assert.equal(overview.armies, 2);
    assert.equal(overview.averageCombinedScore, 25);
    assert.equal(overview.averagePlayerOneScore, 9);
    assert.equal(overview.averagePlayerTwoScore, 16);
    assert.equal(overview.averageSpentCp, 1.5);
  }

  {
    const game = createCompletedGameFixture("game-stats-1");
    const roundScores = createRoundScoreAggregates([game]);
    const playerTurnDurations = createPlayerTurnDurationAggregates([game]);
    const cpScorePoints = createCpScoreCorrelationPoints([game]);
    const turnRecords = getTurnRecords([game]);

    assert.equal(roundScores.length, 1);
    assert.equal(roundScores[0]?.averagePlayerOneScore, 9);
    assert.equal(roundScores[0]?.averagePlayerTwoScore, 16);
    assert.equal(roundScores[0]?.averageCombinedScore, 25);

    assert.deepEqual(
      playerTurnDurations.map((entry) => [entry.playerName, entry.averageTurnDurationMs]),
      [
        ["Alice", 12 * 60 * 1000],
        ["Bob", 15 * 60 * 1000]
      ]
    );

    assert.deepEqual(
      cpScorePoints.map((point) => [point.playerName, point.cpSpent, point.totalScore]),
      [
        ["Alice", 1, 9],
        ["Bob", 2, 16]
      ]
    );

    assert.equal(turnRecords.fastestTurn?.playerName, "Alice");
    assert.equal(turnRecords.fastestTurn?.durationMs, 12 * 60 * 1000);
    assert.equal(turnRecords.longestTurn?.playerName, "Bob");
    assert.equal(turnRecords.longestTurn?.durationMs, 15 * 60 * 1000);
    assert.equal(turnRecords.highestScoringTurn?.playerName, "Bob");
    assert.equal(turnRecords.highestScoringTurn?.totalScore, 16);
  }

  {
    let game = createCompletedGameFixture("game-stats-filter");
    const [playerOne, playerTwo] = game.players;

    game = appendLocalTimeEvents(game, [
      { action: "round-start", roundNumber: 2, createdAt: "2026-04-20T19:01:00.000Z" },
      {
        action: "turn-start",
        playerId: playerOne.id,
        roundNumber: 2,
        turnNumber: 1,
        createdAt: "2026-04-20T19:01:00.000Z"
      },
      {
        action: "turn-end",
        playerId: playerOne.id,
        roundNumber: 2,
        turnNumber: 1,
        createdAt: "2026-04-20T19:01:30.000Z"
      },
      {
        action: "turn-start",
        playerId: playerTwo.id,
        roundNumber: 2,
        turnNumber: 2,
        createdAt: "2026-04-20T19:02:00.000Z"
      },
      {
        action: "turn-end",
        playerId: playerTwo.id,
        roundNumber: 2,
        turnNumber: 2,
        createdAt: "2026-04-20T19:08:00.000Z"
      },
      { action: "round-end", roundNumber: 2, createdAt: "2026-04-20T19:08:00.000Z" }
    ]);
    game = appendLocalCommandPointEvent(game, {
      playerId: playerOne.id,
      cpType: "gained",
      value: 1,
      roundNumber: 2,
      turnNumber: 1,
      createdAt: "2026-04-20T19:01:10.000Z"
    });
    game = appendLocalScoreEvent(game, {
      playerId: playerOne.id,
      scoreType: "primary",
      value: 20,
      roundNumber: 2,
      turnNumber: 1,
      createdAt: "2026-04-20T19:01:20.000Z"
    });
    game = appendLocalScoreEvent(game, {
      playerId: playerTwo.id,
      scoreType: "primary",
      value: 20,
      roundNumber: 2,
      turnNumber: 2,
      createdAt: "2026-04-20T19:03:00.000Z"
    });

    const [statsGame] = prepareGamesForStats([game]);
    assert.ok(statsGame);
    assert.equal(statsGame.rounds.length, 1);
    assert.equal(getPlayerPrimaryTotal(statsGame, playerOne.id), 5);
    assert.equal(getPlayerPrimaryTotal(statsGame, playerTwo.id), 10);
  }

  {
    const interruptedGame = {
      ...createCompletedGameFixture("game-interrupted"),
      finishReason: "interrupted"
    };

    assert.equal(prepareGamesForStats([interruptedGame]).length, 0);
  }

  {
    const legacyGame = {
      ...createCompletedGameFixture("game-legacy"),
      scoreDetailLevel: "total-only",
      rounds: [],
      scoreEvents: [],
      commandPointEvents: [],
      timeEvents: [],
      legacyScoreTotals: {
        "game-legacy:player-1": 78,
        "game-legacy:player-2": 64
      }
    };

    const [statsGame] = prepareGamesForStats([legacyGame]);
    assert.ok(statsGame);
    assert.equal(statsGame.scoreDetailLevel, "total-only");
    assert.equal(statsGame.legacyScoreTotals["game-legacy:player-1"], 78);
  }

  {
    let game = createBaseGame({ id: "game-setup" });
    game = appendLocalTimeEvents(game, [
      { action: "session-start", createdAt: "2026-04-20T18:00:00.000Z" },
      { action: "game-start", createdAt: "2026-04-20T18:00:00.000Z" },
      { action: "setup-start", createdAt: "2026-04-20T18:00:00.000Z" },
      { action: "setup-pause", createdAt: "2026-04-20T18:05:00.000Z" },
      { action: "setup-resume", createdAt: "2026-04-20T18:07:00.000Z" },
      { action: "setup-end", createdAt: "2026-04-20T18:10:00.000Z" },
      { action: "round-start", roundNumber: 1, createdAt: "2026-04-20T18:10:00.000Z" }
    ]);

    assert.equal(getSetupDurationMs(game), 8 * 60 * 1000);
  }
};

module.exports = {
  runGameCalculationsTests
};
