const assert = require("node:assert/strict");
const {
  createCpScoreCorrelationPoints,
  createArmyAggregates,
  createGameSummary,
  createPlayerAggregates,
  createPlayerTurnDurationAggregates,
  createRoundScoreAggregates,
  createRoundDurationAggregates,
  createStatsOverview,
  createStatsEligibilityReport,
  filterGames,
  getCurrentRoundNumber,
  getCountedRounds,
  getGameDurationMs,
  getPlayerCommandPoints,
  getPlayerCommandPointsSpent,
  getPlayerPrimaryTotal,
  getPlayerSecondaryTotal,
  getPlayerTurnDurationTotalMs,
  getRoundDurationMs,
  getSetupDurationMs,
  getTurnDurationMs,
  getTurnRecords,
  isTurnActive,
  isTurnPaused,
  prepareGamesForStats
} = require("../.test-dist/utils/gameCalculations.js");
const {
  appendLocalCommandPointEvent,
  appendLocalScoreEvent,
  appendLocalTimeEvents,
  updateLocalEvent
} = require("../.test-dist/utils/gameState.js");
const { overlayLocalGameMetadata } = require("../.test-dist/utils/gameState.js");
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
    assert.equal(overview.averageDurationMs, 27 * 60 * 1000);
    assert.equal(overview.averagePlayerDurationMs, 13.5 * 60 * 1000);
    assert.equal(overview.averageDurationGameCount, 1);
    assert.equal(overview.averageCombinedScore, 25);
    assert.equal(overview.averagePlayerScore, 12.5);
    assert.equal(overview.averagePlayerOneScore, 9);
    assert.equal(overview.averagePlayerTwoScore, 16);
    assert.equal(overview.averageScoreGameCount, 1);
    assert.equal(overview.averageSpentCp, 1.5);
  }

  {
    const game = createCompletedGameFixture("game-stats-1");
    const roundScores = createRoundScoreAggregates([game]);
    const playerTurnDurations = createPlayerTurnDurationAggregates([game]);
    const roundDurations = createRoundDurationAggregates([game]);
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
    assert.equal(roundDurations.length, 1);
  }

  {
    let game = createBaseGame({ id: "game-eligibility-broad" });
    const [playerOne, playerTwo] = game.players;

    game = appendLocalTimeEvents(game, [
      { action: "game-start", createdAt: "2026-04-20T18:00:00.000Z" },
      {
        action: "turn-start",
        playerId: playerOne.id,
        roundNumber: 1,
        turnNumber: 1,
        createdAt: "2026-04-20T18:00:00.000Z"
      },
      {
        action: "turn-end",
        playerId: playerOne.id,
        roundNumber: 1,
        turnNumber: 1,
        createdAt: "2026-04-20T18:00:06.000Z"
      },
      {
        action: "turn-start",
        playerId: playerTwo.id,
        roundNumber: 1,
        turnNumber: 2,
        createdAt: "2026-04-20T18:00:06.000Z"
      },
      {
        action: "turn-end",
        playerId: playerTwo.id,
        roundNumber: 1,
        turnNumber: 2,
        createdAt: "2026-04-20T18:00:20.000Z"
      },
      { action: "round-end", roundNumber: 1, createdAt: "2026-04-20T18:00:20.000Z" },
      { action: "game-end", createdAt: "2026-04-20T18:01:00.000Z" }
    ]);
    game = appendLocalScoreEvent(game, {
      playerId: playerOne.id,
      scoreType: "primary",
      value: 3,
      roundNumber: 1,
      turnNumber: 1,
      createdAt: "2026-04-20T18:00:02.000Z"
    });

    const [statsGame] = prepareGamesForStats([game]);
    const roundScores = createRoundScoreAggregates([statsGame]);
    const roundDurations = createRoundDurationAggregates([statsGame]);
    const playerTurnDurations = createPlayerTurnDurationAggregates([statsGame]);

    assert.ok(statsGame);
    assert.equal(getCountedRounds(statsGame).length, 1);
    assert.equal(roundScores[0]?.averagePlayerOneScore, 3);
    assert.equal(roundScores[0]?.averagePlayerTwoScore, 0);
    assert.equal(roundDurations.length, 0);
    assert.deepEqual(
      playerTurnDurations.map((entry) => [entry.playerName, entry.averageTurnDurationMs]),
      [["Bob", 14 * 1000]]
    );
  }

  {
    let game = createBaseGame({ id: "game-eligibility-cp-only" });
    const [playerOne] = game.players;

    game = appendLocalTimeEvents(game, [
      { action: "game-start", createdAt: "2026-04-20T18:00:00.000Z" },
      {
        action: "turn-start",
        playerId: playerOne.id,
        roundNumber: 1,
        turnNumber: 1,
        createdAt: "2026-04-20T18:00:00.000Z"
      },
      {
        action: "turn-end",
        playerId: playerOne.id,
        roundNumber: 1,
        turnNumber: 1,
        createdAt: "2026-04-20T18:00:04.000Z"
      },
      { action: "game-end", createdAt: "2026-04-20T18:00:10.000Z" }
    ]);
    game = appendLocalCommandPointEvent(game, {
      playerId: playerOne.id,
      cpType: "spent",
      value: 2,
      roundNumber: 1,
      turnNumber: 1,
      createdAt: "2026-04-20T18:00:02.000Z"
    });

    assert.equal(prepareGamesForStats([game]).length, 0);
    assert.equal(getCountedRounds(game).length, 0);
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
        createdAt: "2026-04-20T19:01:05.000Z"
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
      createdAt: "2026-04-20T19:01:03.000Z"
    });
    game = appendLocalScoreEvent(game, {
      playerId: playerOne.id,
      scoreType: "primary",
      value: 20,
      roundNumber: 2,
      turnNumber: 1,
      createdAt: "2026-04-20T19:01:04.000Z"
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
    assert.equal(statsGame.rounds.length, 2);
    assert.equal(getPlayerPrimaryTotal(statsGame, playerOne.id), 25);
    assert.equal(getPlayerPrimaryTotal(statsGame, playerTwo.id), 30);
    assert.equal(getCountedRounds(game).length, 2);
    assert.equal(createGameSummary(game).roundCount, 2);
  }

  {
    let game = createBaseGame({ id: "game-cp-validity" });
    const [playerOne, playerTwo] = game.players;

    game = appendLocalTimeEvents(game, [
      { action: "game-start", createdAt: "2026-04-20T18:00:00.000Z" },
      { action: "round-start", roundNumber: 1, createdAt: "2026-04-20T18:00:00.000Z" },
      {
        action: "turn-start",
        playerId: playerOne.id,
        roundNumber: 1,
        turnNumber: 1,
        createdAt: "2026-04-20T18:00:00.000Z"
      },
      {
        action: "turn-end",
        playerId: playerOne.id,
        roundNumber: 1,
        turnNumber: 1,
        createdAt: "2026-04-20T18:00:04.000Z"
      },
      {
        action: "turn-start",
        playerId: playerTwo.id,
        roundNumber: 1,
        turnNumber: 2,
        createdAt: "2026-04-20T18:00:04.000Z"
      },
      {
        action: "turn-end",
        playerId: playerTwo.id,
        roundNumber: 1,
        turnNumber: 2,
        createdAt: "2026-04-20T18:00:20.000Z"
      },
      { action: "round-end", roundNumber: 1, createdAt: "2026-04-20T18:00:20.000Z" },
      { action: "game-end", createdAt: "2026-04-20T18:00:30.000Z" }
    ]);
    game = appendLocalCommandPointEvent(game, {
      playerId: playerOne.id,
      cpType: "spent",
      value: 7,
      roundNumber: 1,
      turnNumber: 1,
      createdAt: "2026-04-20T18:00:02.000Z"
    });
    game = appendLocalCommandPointEvent(game, {
      playerId: playerTwo.id,
      cpType: "spent",
      value: 2,
      roundNumber: 1,
      turnNumber: 2,
      createdAt: "2026-04-20T18:00:06.000Z"
    });

    const preparedGames = prepareGamesForStats([game]);
    const playerAggregates = createPlayerAggregates(preparedGames);

    assert.equal(preparedGames.length, 1);
    assert.deepEqual(
      playerAggregates.map((player) => [player.name, player.averageSpentCp]),
      [
        ["Alice", null],
        ["Bob", 2]
      ]
    );
  }

  {
    let game = createBaseGame({ id: "game-eligibility-include", statsEligibilityMode: "include" });
    const [playerOne] = game.players;

    game = appendLocalTimeEvents(game, [
      { action: "game-start", createdAt: "2026-04-20T18:00:00.000Z" },
      { action: "round-start", roundNumber: 1, createdAt: "2026-04-20T18:00:00.000Z" },
      {
        action: "turn-start",
        playerId: playerOne.id,
        roundNumber: 1,
        turnNumber: 1,
        createdAt: "2026-04-20T18:00:00.000Z"
      },
      {
        action: "turn-end",
        playerId: playerOne.id,
        roundNumber: 1,
        turnNumber: 1,
        createdAt: "2026-04-20T18:00:04.000Z"
      }
    ]);
    game = {
      ...game,
      finishReason: "interrupted"
    };

    const preparedGames = prepareGamesForStats([game]);
    const overview = createStatsOverview(preparedGames);

    assert.equal(preparedGames.length, 1);
    assert.equal(overview.games, 1);
  }

  {
    const game = createBaseGame({ id: "game-eligibility-exclude", statsEligibilityMode: "exclude" });
    const preparedGames = prepareGamesForStats([game]);

    assert.equal(preparedGames.length, 0);
  }

  {
    let game = createBaseGame({
      id: "game-area-overrides",
      statsEligibilityOverrides: {
        areas: {
          time: "exclude",
          scoring: "include"
        }
      }
    });
    const [playerOne] = game.players;

    game = appendLocalTimeEvents(game, [
      { action: "game-start", createdAt: "2026-04-20T18:00:00.000Z" },
      { action: "round-start", roundNumber: 1, createdAt: "2026-04-20T18:00:00.000Z" },
      {
        action: "turn-start",
        playerId: playerOne.id,
        roundNumber: 1,
        turnNumber: 1,
        createdAt: "2026-04-20T18:00:00.000Z"
      },
      {
        action: "turn-end",
        playerId: playerOne.id,
        roundNumber: 1,
        turnNumber: 1,
        createdAt: "2026-04-20T18:05:00.000Z"
      },
      { action: "round-end", roundNumber: 1, createdAt: "2026-04-20T18:05:00.000Z" },
      { action: "game-end", createdAt: "2026-04-20T18:05:00.000Z" }
    ]);

    const report = createStatsEligibilityReport(game);
    const [statsGame] = prepareGamesForStats([game]);

    assert.equal(report.areas.time.effective, "excluded");
    assert.equal(report.areas.scoring.effective, "included");
    assert.equal(createStatsOverview([statsGame]).averageDurationMs, null);
    assert.equal(createRoundScoreAggregates([statsGame])[0]?.averagePlayerOneScore, 0);
  }

  {
    let game = createBaseGame({
      id: "game-turn-overrides",
      statsEligibilityOverrides: {
        turns: {
          "1:1": {
            scoring: "include",
            cp: "include"
          }
        }
      }
    });
    const [playerOne] = game.players;

    game = appendLocalTimeEvents(game, [
      { action: "game-start", createdAt: "2026-04-20T18:00:00.000Z" },
      { action: "round-start", roundNumber: 1, createdAt: "2026-04-20T18:00:00.000Z" },
      {
        action: "turn-start",
        playerId: playerOne.id,
        roundNumber: 1,
        turnNumber: 1,
        createdAt: "2026-04-20T18:00:00.000Z"
      },
      {
        action: "turn-end",
        playerId: playerOne.id,
        roundNumber: 1,
        turnNumber: 1,
        createdAt: "2026-04-20T18:00:04.000Z"
      },
      { action: "game-end", createdAt: "2026-04-20T18:00:05.000Z" }
    ]);
    game = appendLocalCommandPointEvent(game, {
      playerId: playerOne.id,
      cpType: "spent",
      value: 2,
      roundNumber: 1,
      turnNumber: 1,
      createdAt: "2026-04-20T18:00:02.000Z"
    });

    const [statsGame] = prepareGamesForStats([game]);
    const report = createStatsEligibilityReport(game);

    assert.equal(report.turns[0].areas.scoring.auto, false);
    assert.equal(report.turns[0].areas.scoring.effective, true);
    assert.equal(report.turns[0].areas.cp.effective, true);
    assert.equal(createStatsOverview([statsGame]).averageSpentCp, 2);
  }

  {
    const interruptedGame = {
      ...createCompletedGameFixture("game-interrupted"),
      finishReason: "interrupted"
    };

    assert.equal(prepareGamesForStats([interruptedGame]).length, 0);
  }

  {
    const drawGame = {
      ...createCompletedGameFixture("game-draw"),
      finishReason: "draw"
    };
    const summary = createGameSummary(drawGame);
    const playerAggregates = createPlayerAggregates([drawGame]);
    const armyAggregates = createArmyAggregates([drawGame]);

    assert.deepEqual(summary.players.map((player) => player.result), ["tie", "tie"]);
    assert.deepEqual(
      playerAggregates.map((player) => [player.name, player.wins, player.losses, player.ties, player.winRate]),
      [
        ["Alice", 0, 0, 1, 0],
        ["Bob", 0, 0, 1, 0]
      ]
    );
    assert.deepEqual(
      armyAggregates.map((army) => [army.armyName, army.wins, army.losses, army.ties, army.winRate]),
      [
        ["Adepta Sororitas", 0, 0, 1, 0],
        ["Aeldari", 0, 0, 1, 0]
      ]
    );
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

    assert.equal(prepareGamesForStats([legacyGame]).length, 1);
  }

  {
    const legacyGame = {
      ...createCompletedGameFixture("game-legacy-stats"),
      scoreDetailLevel: "total-only",
      rounds: [],
      scoreEvents: [],
      commandPointEvents: [],
      timeEvents: [],
      legacyScoreTotals: {
        "game-legacy-stats:player-1": 78,
        "game-legacy-stats:player-2": 64
      }
    };
    const overview = createStatsOverview([createCompletedGameFixture("game-stats-overview"), legacyGame]);

    assert.equal(overview.games, 2);
    assert.equal(overview.averageDurationMs, 27 * 60 * 1000);
    assert.equal(overview.averagePlayerDurationMs, 13.5 * 60 * 1000);
    assert.equal(overview.averageDurationGameCount, 1);
    assert.equal(overview.averageRounds, 1);
    assert.equal(overview.averageCombinedScore, 83.5);
    assert.equal(overview.averagePlayerScore, 41.75);
    assert.equal(overview.averageScoreGameCount, 2);
  }

  {
    let game = createBaseGame({ id: "game-setup" });
    game = appendLocalTimeEvents(game, [
      { action: "game-start", createdAt: "2026-04-20T18:00:00.000Z" },
      { action: "setup-start", createdAt: "2026-04-20T18:00:00.000Z" },
      { action: "setup-pause", createdAt: "2026-04-20T18:05:00.000Z" },
      { action: "setup-resume", createdAt: "2026-04-20T18:07:00.000Z" },
      { action: "setup-end", createdAt: "2026-04-20T18:10:00.000Z" },
      { action: "round-start", roundNumber: 1, createdAt: "2026-04-20T18:10:00.000Z" }
    ]);

    assert.equal(getSetupDurationMs(game), 8 * 60 * 1000);
  }

  {
    let game = createBaseGame({ id: "game-edit-score-event" });
    const [playerOne] = game.players;

    game = appendLocalScoreEvent(game, {
      playerId: playerOne.id,
      scoreType: "primary",
      value: 5,
      roundNumber: 1,
      turnNumber: 1,
      note: "before",
      createdAt: "2026-04-20T18:02:00.000Z"
    });

    const event = game.scoreEvents[0];
    game = updateLocalEvent(game, event.id, {
      value_number: 8,
      note: "after"
    });

    assert.equal(getPlayerPrimaryTotal(game, playerOne.id), 8);
    assert.equal(game.scoreEvents[0].note, "after");
  }

  {
    let game = createBaseGame({ id: "game-edit-time-event" });
    const [playerOne, playerTwo] = game.players;

    game = appendLocalTimeEvents(game, [
      { action: "game-start", createdAt: "2026-04-20T18:00:00.000Z" },
      { action: "round-start", roundNumber: 1, createdAt: "2026-04-20T18:00:00.000Z" },
      {
        action: "turn-start",
        playerId: playerOne.id,
        roundNumber: 1,
        turnNumber: 1,
        createdAt: "2026-04-20T18:00:00.000Z"
      },
      {
        action: "turn-end",
        playerId: playerOne.id,
        roundNumber: 1,
        turnNumber: 1,
        createdAt: "2026-04-20T18:10:00.000Z"
      },
      {
        action: "turn-start",
        playerId: playerTwo.id,
        roundNumber: 1,
        turnNumber: 2,
        createdAt: "2026-04-20T18:10:00.000Z"
      }
    ]);

    const turnEndEvent = game.timeEvents.find((event) => event.action === "turn-end");
    assert.ok(turnEndEvent);
    game = updateLocalEvent(game, turnEndEvent.id, {
      occurred_at: "2026-04-20T17:58:00.000Z"
    });

    const turn = game.rounds[0]?.turns[0];
    const nextTurn = game.rounds[0]?.turns[1];
    assert.ok(turn);
    assert.ok(nextTurn);
    assert.equal(turn.playerId, playerOne.id);
    assert.equal(turn.roundNumber, 1);
    assert.equal(turn.turnNumber, 1);
    assert.equal(turn.timing.endedAt, "2026-04-20T17:58:00.000Z");
    assert.equal(nextTurn.playerId, playerTwo.id);
    assert.equal(nextTurn.turnNumber, 2);
    assert.equal(getTurnDurationMs(turn, game), 0);
  }

  {
    let game = createBaseGame({ id: "game-closed-open-turn" });
    const [playerOne] = game.players;

    game = appendLocalTimeEvents(game, [
      { action: "game-start", createdAt: "2026-04-20T18:00:00.000Z" },
      { action: "round-start", roundNumber: 1, createdAt: "2026-04-20T18:00:00.000Z" },
      {
        action: "turn-start",
        playerId: playerOne.id,
        roundNumber: 1,
        turnNumber: 1,
        createdAt: "2026-04-20T18:00:00.000Z"
      },
      { action: "game-end", createdAt: "2026-04-20T18:12:00.000Z" }
    ]);

    const turn = game.rounds[0]?.turns[0];
    assert.ok(turn);
    assert.equal(getTurnDurationMs(turn, game), 12 * 60 * 1000);
    assert.equal(getPlayerTurnDurationTotalMs(game, playerOne.id), 12 * 60 * 1000);
    assert.equal(createStatsOverview([game]).averageDurationMs, 12 * 60 * 1000);
  }

  {
    let game = createBaseGame({ id: "game-events-after-end" });
    const [playerOne, playerTwo] = game.players;

    game = appendLocalTimeEvents(game, [
      { action: "game-start", createdAt: "2026-04-20T18:00:00.000Z" },
      { action: "round-start", roundNumber: 1, createdAt: "2026-04-20T18:00:00.000Z" },
      {
        action: "turn-start",
        playerId: playerOne.id,
        roundNumber: 1,
        turnNumber: 1,
        createdAt: "2026-04-20T18:00:00.000Z"
      },
      {
        action: "turn-end",
        playerId: playerOne.id,
        roundNumber: 1,
        turnNumber: 1,
        createdAt: "2026-04-20T18:10:00.000Z"
      },
      { action: "round-end", roundNumber: 1, createdAt: "2026-04-20T18:10:00.000Z" },
      { action: "game-end", createdAt: "2026-04-20T18:10:00.000Z" },
      { action: "round-start", roundNumber: 2, createdAt: "2026-04-20T18:11:00.000Z" },
      {
        action: "turn-start",
        playerId: playerTwo.id,
        roundNumber: 2,
        turnNumber: 1,
        createdAt: "2026-04-20T18:11:00.000Z"
      },
      {
        action: "turn-pause",
        playerId: playerTwo.id,
        roundNumber: 2,
        turnNumber: 1,
        createdAt: "2026-04-20T18:12:00.000Z"
      },
      {
        action: "turn-resume",
        playerId: playerTwo.id,
        roundNumber: 2,
        turnNumber: 1,
        createdAt: "2026-04-20T18:13:00.000Z"
      }
    ]);

    assert.equal(game.status, "completed");
    assert.equal(game.rounds.length, 1);
    assert.equal(game.rounds[0].roundNumber, 1);
    assert.equal(game.timeEvents.some((event) => event.roundNumber === 2), true);
    assert.equal(getPlayerTurnDurationTotalMs(game, playerTwo.id), 0);
    assert.equal(createStatsOverview([game]).averageDurationMs, 10 * 60 * 1000);
  }

  {
    let game = createBaseGame({ id: "game-late-game-start" });
    const [playerOne] = game.players;

    game = appendLocalTimeEvents(game, [
      { action: "setup-start", createdAt: "2026-04-20T18:00:00.000Z" },
      { action: "setup-end", createdAt: "2026-04-20T18:05:00.000Z" },
      { action: "round-start", roundNumber: 1, createdAt: "2026-04-20T18:05:00.000Z" },
      {
        action: "turn-start",
        playerId: playerOne.id,
        roundNumber: 1,
        turnNumber: 1,
        createdAt: "2026-04-20T18:05:00.000Z"
      },
      { action: "game-start", createdAt: "2026-04-20T18:07:00.000Z" },
      {
        action: "turn-end",
        playerId: playerOne.id,
        roundNumber: 1,
        turnNumber: 1,
        createdAt: "2026-04-20T18:15:00.000Z"
      },
      { action: "round-end", roundNumber: 1, createdAt: "2026-04-20T18:15:00.000Z" },
      { action: "game-end", createdAt: "2026-04-20T18:15:00.000Z" }
    ]);

    assert.equal(game.status, "completed");
    assert.equal(game.startedAt, "2026-04-20T18:00:00.000Z");
    assert.equal(getGameDurationMs(game), 15 * 60 * 1000);
  }

  {
    let game = createBaseGame({ id: "game-pause-resume-after-turn-end" });
    const [playerOne] = game.players;

    game = appendLocalTimeEvents(game, [
      { action: "game-start", createdAt: "2026-04-20T18:00:00.000Z" },
      { action: "round-start", roundNumber: 1, createdAt: "2026-04-20T18:00:00.000Z" },
      {
        action: "turn-start",
        playerId: playerOne.id,
        roundNumber: 1,
        turnNumber: 1,
        createdAt: "2026-04-20T18:00:00.000Z"
      },
      {
        action: "turn-end",
        playerId: playerOne.id,
        roundNumber: 1,
        turnNumber: 1,
        createdAt: "2026-04-20T18:10:00.000Z"
      },
      {
        action: "turn-pause",
        playerId: playerOne.id,
        roundNumber: 1,
        turnNumber: 1,
        createdAt: "2026-04-20T18:12:00.000Z"
      },
      {
        action: "turn-resume",
        playerId: playerOne.id,
        roundNumber: 1,
        turnNumber: 1,
        createdAt: "2026-04-20T18:20:00.000Z"
      },
      { action: "round-end", roundNumber: 1, createdAt: "2026-04-20T18:10:00.000Z" },
      { action: "game-end", createdAt: "2026-04-20T18:20:00.000Z" }
    ]);

    const turn = game.rounds[0]?.turns[0];
    assert.ok(turn);
    assert.equal(turn.timing.endedAt, "2026-04-20T18:10:00.000Z");
    assert.equal(turn.timing.pauses.length, 0);
    assert.equal(getTurnDurationMs(turn, game), 10 * 60 * 1000);
  }

  {
    let game = createBaseGame({ id: "game-corrupt-beta-pattern" });
    const [playerOne, playerTwo] = game.players;

    game = appendLocalTimeEvents(game, [
      { action: "setup-end", createdAt: "2026-04-20T18:05:00.000Z" },
      { action: "round-start", roundNumber: 1, createdAt: "2026-04-20T18:05:00.000Z" },
      {
        action: "turn-start",
        playerId: playerOne.id,
        roundNumber: 1,
        turnNumber: 1,
        createdAt: "2026-04-20T18:05:00.000Z"
      },
      {
        action: "turn-end",
        playerId: playerOne.id,
        roundNumber: 1,
        turnNumber: 1,
        createdAt: "2026-04-20T18:15:00.000Z"
      },
      { action: "game-start", createdAt: "2026-04-20T18:20:00.000Z" },
      { action: "round-end", roundNumber: 1, createdAt: "2026-04-20T18:35:00.000Z" },
      { action: "round-start", roundNumber: 2, createdAt: "2026-04-20T18:35:00.000Z" },
      {
        action: "turn-start",
        playerId: playerTwo.id,
        roundNumber: 2,
        turnNumber: 2,
        createdAt: "2026-04-20T18:50:00.000Z"
      },
      {
        action: "turn-end",
        playerId: playerTwo.id,
        roundNumber: 2,
        turnNumber: 2,
        createdAt: "2026-04-20T19:00:00.000Z"
      },
      {
        action: "turn-pause",
        playerId: playerOne.id,
        roundNumber: 1,
        turnNumber: 1,
        createdAt: "2026-04-20T19:05:00.000Z"
      },
      {
        action: "turn-resume",
        playerId: playerOne.id,
        roundNumber: 1,
        turnNumber: 1,
        createdAt: "2026-04-20T19:10:00.000Z"
      },
      { action: "round-start", roundNumber: 3, createdAt: "2026-04-20T19:15:00.000Z" },
      {
        action: "turn-start",
        playerId: playerOne.id,
        roundNumber: 3,
        turnNumber: 1,
        createdAt: "2026-04-20T19:15:00.000Z"
      },
      {
        action: "turn-end",
        playerId: playerOne.id,
        roundNumber: 3,
        turnNumber: 1,
        createdAt: "2026-04-20T19:30:00.000Z"
      },
      { action: "round-start", roundNumber: 4, createdAt: "2026-04-20T19:40:00.000Z" },
      {
        action: "turn-start",
        playerId: playerTwo.id,
        roundNumber: 4,
        turnNumber: 1,
        createdAt: "2026-04-20T19:40:00.000Z"
      },
      {
        action: "turn-end",
        playerId: playerTwo.id,
        roundNumber: 4,
        turnNumber: 1,
        createdAt: "2026-04-20T19:55:00.000Z"
      },
      { action: "round-start", roundNumber: 5, createdAt: "2026-04-20T20:00:00.000Z" },
      {
        action: "turn-start",
        playerId: playerTwo.id,
        roundNumber: 5,
        turnNumber: 2,
        createdAt: "2026-04-20T20:00:00.000Z"
      },
      {
        action: "turn-end",
        playerId: playerTwo.id,
        roundNumber: 5,
        turnNumber: 2,
        createdAt: "2026-04-20T20:15:00.000Z"
      },
      { action: "round-end", roundNumber: 5, createdAt: "2026-04-20T20:15:00.000Z" },
      { action: "game-end", createdAt: "2026-04-20T20:15:00.000Z" }
    ]);
    game = appendLocalScoreEvent(game, {
      playerId: playerOne.id,
      scoreType: "primary",
      value: 5,
      roundNumber: 3,
      turnNumber: 1,
      createdAt: "2026-04-20T19:20:00.000Z"
    });
    game = appendLocalCommandPointEvent(game, {
      playerId: playerTwo.id,
      cpType: "spent",
      value: 1,
      roundNumber: 4,
      turnNumber: 1,
      createdAt: "2026-04-20T19:45:00.000Z"
    });

    const report = createStatsEligibilityReport(game);
    assert.equal(game.status, "completed");
    assert.equal(game.startedAt, "2026-04-20T18:05:00.000Z");
    assert.equal(isTurnActive(game), false);
    assert.equal(report.areas.scoring.effective !== "excluded", true);
    assert.equal(report.turns.some((turn) => turn.label === "R4 Z1"), true);
    assert.equal(Number.isFinite(getGameDurationMs(game)), true);
  }

  {
    let game = createBaseGame({ id: "game-inconsistent-timer-events" });
    const [playerOne] = game.players;

    game = appendLocalTimeEvents(game, [
      { action: "game-start", createdAt: "2026-04-20T18:00:00.000Z" },
      {
        action: "turn-pause",
        playerId: playerOne.id,
        roundNumber: 1,
        turnNumber: 1,
        createdAt: "2026-04-20T18:02:00.000Z"
      },
      {
        action: "turn-resume",
        playerId: playerOne.id,
        roundNumber: 1,
        turnNumber: 1,
        createdAt: "2026-04-20T18:03:00.000Z"
      },
      { action: "game-end", createdAt: "2026-04-20T18:04:00.000Z" }
    ]);

    assert.equal(game.status, "completed");
    assert.equal(game.rounds.length, 1);
    assert.equal(getPlayerTurnDurationTotalMs(game, playerOne.id), 0);
  }

  {
    const baseGame = createCompletedGameFixture("game-overlay-base");
    const localGame = {
      ...baseGame,
      autoCommandPointOn: false,
      autoCommandPointAwards: { "1:1": true, "2:1": true }
    };

    const mergedGame = overlayLocalGameMetadata(baseGame, localGame);

    assert.equal(mergedGame.autoCommandPointOn, false);
    assert.deepEqual(mergedGame.autoCommandPointAwards, {
      "1:1": true,
      "2:1": true
    });
  }
};

module.exports = {
  runGameCalculationsTests
};
