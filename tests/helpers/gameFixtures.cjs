const {
  appendLocalCommandPointEvent,
  appendLocalScoreEvent,
  appendLocalTimeEvents,
  syncDerivedGameState
} = require("../../.test-dist/utils/gameState.js");

const createGameInput = (overrides = {}) => ({
  playerOneName: "Alice",
  playerOneArmy: "Adepta Sororitas",
  playerOneDetachment: "Bringers of Flame",
  playerTwoName: "Bob",
  playerTwoArmy: "Aeldari",
  playerTwoDetachment: "Battle Host",
  gamePoints: 2000,
  scheduledDate: "2026-04-20",
  scheduledTime: "18:30",
  deployment: "Sweeping Engagement",
  primaryMission: "Take and Hold",
  defenderSlot: "player1",
  startingSlot: "player1",
  ...overrides
});

const createBaseGame = (overrides = {}) => {
  const gameId = overrides.id ?? "game-1";
  const playerOneId = `${gameId}:player-1`;
  const playerTwoId = `${gameId}:player-2`;
  const input = createGameInput();

  return syncDerivedGameState({
    id: gameId,
    createdAt: "2026-04-20T18:30:00.000Z",
    updatedAt: "2026-04-20T18:30:00.000Z",
    status: "active",
    scoreDetailLevel: "full",
    gamePoints: input.gamePoints,
    scheduledDate: input.scheduledDate,
    scheduledTime: input.scheduledTime,
    deployment: input.deployment,
    primaryMission: input.primaryMission,
    defenderPlayerId: playerOneId,
    startingPlayerId: playerOneId,
    currentPlayerId: playerOneId,
    startedAt: undefined,
    endedAt: undefined,
    players: [
      {
        id: playerOneId,
        name: input.playerOneName,
        army: {
          name: input.playerOneArmy,
          maxPoints: input.gamePoints,
          detachment: input.playerOneDetachment
        }
      },
      {
        id: playerTwoId,
        name: input.playerTwoName,
        army: {
          name: input.playerTwoArmy,
          maxPoints: input.gamePoints,
          detachment: input.playerTwoDetachment
        }
      }
    ],
    rounds: [],
    scoreEvents: [],
    commandPointEvents: [],
    noteEvents: [],
    timeEvents: [],
    timerCorrections: {
      totalMs: 0,
      rounds: {},
      turns: {}
    },
    legacyScoreTotals: {},
    ...overrides
  });
};

const createCompletedGameFixture = (gameId = "game-1") => {
  let game = createBaseGame({
    id: gameId,
    scheduledDate: "2026-04-20",
    scheduledTime: "18:30"
  });
  const [playerOne, playerTwo] = game.players;

  game = appendLocalTimeEvents(game, [
    { action: "session-start", createdAt: "2026-04-20T18:30:00.000Z" },
    { action: "game-start", createdAt: "2026-04-20T18:30:00.000Z" },
    { action: "round-start", roundNumber: 1, createdAt: "2026-04-20T18:30:00.000Z" },
    {
      action: "turn-start",
      playerId: playerOne.id,
      roundNumber: 1,
      turnNumber: 1,
      createdAt: "2026-04-20T18:30:00.000Z"
    },
    {
      action: "turn-end",
      playerId: playerOne.id,
      roundNumber: 1,
      turnNumber: 1,
      createdAt: "2026-04-20T18:42:00.000Z"
    },
    {
      action: "turn-start",
      playerId: playerTwo.id,
      roundNumber: 1,
      turnNumber: 2,
      createdAt: "2026-04-20T18:42:00.000Z"
    },
    {
      action: "turn-pause",
      playerId: playerTwo.id,
      roundNumber: 1,
      turnNumber: 2,
      createdAt: "2026-04-20T18:50:00.000Z"
    },
    {
      action: "turn-resume",
      playerId: playerTwo.id,
      roundNumber: 1,
      turnNumber: 2,
      createdAt: "2026-04-20T18:53:00.000Z"
    },
    {
      action: "turn-end",
      playerId: playerTwo.id,
      roundNumber: 1,
      turnNumber: 2,
      createdAt: "2026-04-20T19:00:00.000Z"
    },
    { action: "round-end", roundNumber: 1, createdAt: "2026-04-20T19:00:00.000Z" },
    { action: "session-end", createdAt: "2026-04-20T19:15:00.000Z" },
    { action: "game-end", createdAt: "2026-04-20T19:15:00.000Z" }
  ]);

  game = appendLocalScoreEvent(game, {
    playerId: playerOne.id,
    scoreType: "primary",
    value: 5,
    roundNumber: 1,
    turnNumber: 1,
    createdAt: "2026-04-20T18:35:00.000Z"
  });
  game = appendLocalScoreEvent(game, {
    playerId: playerOne.id,
    scoreType: "secondary",
    value: 4,
    roundNumber: 1,
    turnNumber: 1,
    createdAt: "2026-04-20T18:36:00.000Z"
  });
  game = appendLocalScoreEvent(game, {
    playerId: playerTwo.id,
    scoreType: "primary",
    value: 10,
    roundNumber: 1,
    turnNumber: 2,
    createdAt: "2026-04-20T18:55:00.000Z"
  });
  game = appendLocalScoreEvent(game, {
    playerId: playerTwo.id,
    scoreType: "secondary",
    value: 6,
    roundNumber: 1,
    turnNumber: 2,
    createdAt: "2026-04-20T18:56:00.000Z"
  });

  game = appendLocalCommandPointEvent(game, {
    playerId: playerOne.id,
    cpType: "gained",
    value: 2,
    roundNumber: 1,
    turnNumber: 1,
    createdAt: "2026-04-20T18:34:00.000Z"
  });
  game = appendLocalCommandPointEvent(game, {
    playerId: playerOne.id,
    cpType: "spent",
    value: 1,
    roundNumber: 1,
    turnNumber: 1,
    createdAt: "2026-04-20T18:37:00.000Z"
  });
  game = appendLocalCommandPointEvent(game, {
    playerId: playerTwo.id,
    cpType: "gained",
    value: 3,
    roundNumber: 1,
    turnNumber: 2,
    createdAt: "2026-04-20T18:54:00.000Z"
  });
  game = appendLocalCommandPointEvent(game, {
    playerId: playerTwo.id,
    cpType: "spent",
    value: 2,
    roundNumber: 1,
    turnNumber: 2,
    createdAt: "2026-04-20T18:57:00.000Z"
  });

  return game;
};

const createPausedActiveGameFixture = () => {
  let game = createBaseGame({
    id: "game-paused",
    scheduledDate: "2026-04-21",
    scheduledTime: "19:00"
  });
  const [playerOne] = game.players;

  game = appendLocalTimeEvents(game, [
    { action: "session-start", createdAt: "2026-04-21T19:00:00.000Z" },
    { action: "game-start", createdAt: "2026-04-21T19:00:00.000Z" },
    { action: "round-start", roundNumber: 1, createdAt: "2026-04-21T19:00:00.000Z" },
    {
      action: "turn-start",
      playerId: playerOne.id,
      roundNumber: 1,
      turnNumber: 1,
      createdAt: "2026-04-21T19:00:00.000Z"
    },
    {
      action: "turn-pause",
      playerId: playerOne.id,
      roundNumber: 1,
      turnNumber: 1,
      createdAt: "2026-04-21T19:08:00.000Z"
    }
  ]);

  return game;
};

module.exports = {
  createBaseGame,
  createCompletedGameFixture,
  createGameInput,
  createPausedActiveGameFixture
};
