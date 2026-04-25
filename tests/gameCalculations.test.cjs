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
  getSessionDurationMs,
  getTurnDurationMs,
  getTurnRecords,
  isTurnPaused
} = require("../.test-dist/utils/gameCalculations.js");
const {
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
};

module.exports = {
  runGameCalculationsTests
};
