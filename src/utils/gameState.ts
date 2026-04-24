import type {
  CommandPointEvent,
  CommandPointType,
  CreateGameInput,
  Game,
  NoteEvent,
  Player,
  PlayerId,
  Round,
  ScoreEvent,
  ScoreType,
  TimeEvent,
  TimeEventAction,
  Turn
} from "../types/game";
import { createId, createUuid, isUuid } from "./id";
import { getNowIso } from "./time";

const sortByCreatedAt = <T extends { createdAt: string }>(items: T[]): T[] =>
  [...items].sort((left, right) => left.createdAt.localeCompare(right.createdAt));

const ensureRound = (roundsByNumber: Map<number, Round>, roundNumber: number): Round => {
  const existing = roundsByNumber.get(roundNumber);
  if (existing) {
    return existing;
  }

  const nextRound: Round = {
    id: createId(`round-${roundNumber}`),
    roundNumber,
    turns: []
  };
  roundsByNumber.set(roundNumber, nextRound);
  return nextRound;
};

const ensureTurn = (round: Round, turnNumber: number, playerId: PlayerId): Turn => {
  const existing = round.turns.find((turn) => turn.turnNumber === turnNumber);
  if (existing) {
    return existing;
  }

  const nextTurn: Turn = {
    id: createId(`turn-${round.roundNumber}-${turnNumber}`),
    roundNumber: round.roundNumber,
    turnNumber,
    playerId,
    timing: {
      pauses: []
    }
  };
  round.turns.push(nextTurn);
  return nextTurn;
};

const buildRoundsFromTimeEvents = (timeEvents: TimeEvent[]): Round[] => {
  const roundsByNumber = new Map<number, Round>();

  sortByCreatedAt(timeEvents).forEach((event) => {
    if (!event.roundNumber) {
      return;
    }

    const round = ensureRound(roundsByNumber, event.roundNumber);
    if (event.action === "round-start") {
      round.startedAt = event.createdAt;
      return;
    }

    if (event.action === "round-end") {
      round.endedAt = event.createdAt;
      return;
    }

    if (!event.turnNumber || !event.playerId) {
      return;
    }

    const turn = ensureTurn(round, event.turnNumber, event.playerId);
    if (event.action === "turn-start") {
      turn.playerId = event.playerId;
      if (!turn.timing.startedAt) {
        turn.timing.startedAt = event.createdAt;
      } else {
        const latestPause = turn.timing.pauses[turn.timing.pauses.length - 1];
        if (latestPause && !latestPause.endedAt) {
          latestPause.endedAt = event.createdAt;
        }
      }
      return;
    }

    if (event.action === "turn-resume") {
      turn.playerId = event.playerId;
      const latestPause = turn.timing.pauses[turn.timing.pauses.length - 1];
      if (latestPause && !latestPause.endedAt) {
        latestPause.endedAt = event.createdAt;
      }
      return;
    }

    if (event.action === "turn-pause") {
      turn.playerId = event.playerId;
      const latestPause = turn.timing.pauses[turn.timing.pauses.length - 1];
      if (!latestPause || latestPause.endedAt) {
        turn.timing.pauses.push({
          startedAt: event.createdAt
        });
      }
      return;
    }

    if (event.action === "turn-end") {
      turn.playerId = event.playerId;
      const latestPause = turn.timing.pauses[turn.timing.pauses.length - 1];
      if (latestPause && !latestPause.endedAt) {
        latestPause.endedAt = event.createdAt;
      }
      turn.timing.endedAt = event.createdAt;
    }
  });

  return Array.from(roundsByNumber.values())
    .sort((left, right) => left.roundNumber - right.roundNumber)
    .map((round) => ({
      ...round,
      turns: [...round.turns].sort((left, right) => left.turnNumber - right.turnNumber)
    }));
};

const getCurrentPlayerId = (
  gameId: string,
  startingPlayerId: PlayerId,
  rounds: Round[],
  endedAt?: string
): PlayerId => {
  if (endedAt) {
    return startingPlayerId;
  }

  const latestRound = rounds[rounds.length - 1];
  const latestTurn = latestRound?.turns[latestRound.turns.length - 1];
  if (!latestTurn) {
    return startingPlayerId;
  }

  if (latestTurn.timing.startedAt && !latestTurn.timing.endedAt) {
    return latestTurn.playerId;
  }

  return latestTurn.playerId === `${gameId}:player-1`
    ? `${gameId}:player-2`
    : `${gameId}:player-1`;
};

const syncPlayers = (players: [Player, Player], gamePoints: number): [Player, Player] =>
  [
    {
      ...players[0],
      army: {
        ...players[0].army,
        maxPoints: gamePoints
      }
    },
    {
      ...players[1],
      army: {
        ...players[1].army,
        maxPoints: gamePoints
      }
    }
  ];

export const syncDerivedGameState = (game: Game): Game => {
  const sortedTimeEvents = sortByCreatedAt(game.timeEvents);
  const hasTimeEvents = sortedTimeEvents.length > 0;
  const rounds = buildRoundsFromTimeEvents(sortedTimeEvents);
  const timestamps = [
    game.createdAt,
    ...game.scoreEvents.map((event) => event.createdAt),
    ...game.commandPointEvents.map((event) => event.createdAt),
    ...game.noteEvents.map((event) => event.createdAt),
    ...sortedTimeEvents.map((event) => event.createdAt)
  ].sort((left, right) => left.localeCompare(right));
  const startedAt =
    sortedTimeEvents.find((event) => event.action === "game-start")?.createdAt ??
    sortedTimeEvents.find((event) => event.action === "round-start")?.createdAt ??
    (hasTimeEvents ? undefined : game.startedAt);
  const endedAt =
    [...sortedTimeEvents]
      .reverse()
      .find((event) => event.action === "game-end")?.createdAt ??
    (hasTimeEvents ? undefined : game.endedAt);

  return {
    ...game,
    updatedAt: timestamps[timestamps.length - 1] ?? game.createdAt,
    status: endedAt ? "completed" : "active",
    players: syncPlayers(game.players, game.gamePoints),
    rounds,
    startedAt,
    endedAt,
    currentPlayerId: getCurrentPlayerId(game.id, game.startingPlayerId, rounds, endedAt),
    timeEvents: sortedTimeEvents,
    scoreEvents: sortByCreatedAt(game.scoreEvents),
    commandPointEvents: sortByCreatedAt(game.commandPointEvents),
    noteEvents: sortByCreatedAt(game.noteEvents)
  };
};

export const createLocalGame = (input: CreateGameInput): Game => {
  const gameId = createUuid();
  const createdAt = getNowIso();
  const playerOneId = `${gameId}:player-1`;
  const playerTwoId = `${gameId}:player-2`;
  const players: [Player, Player] = [
    {
      id: playerOneId,
      name: input.playerOneName.trim(),
      army: {
        name: input.playerOneArmy.trim(),
        maxPoints: input.gamePoints
      }
    },
    {
      id: playerTwoId,
      name: input.playerTwoName.trim(),
      army: {
        name: input.playerTwoArmy.trim(),
        maxPoints: input.gamePoints
      }
    }
  ];

  return syncDerivedGameState({
    id: gameId,
    createdAt,
    updatedAt: createdAt,
    status: "active",
    gamePoints: input.gamePoints,
    scheduledDate: input.scheduledDate,
    scheduledTime: input.scheduledTime,
    deployment: input.deployment.trim(),
    primaryMission: input.primaryMission.trim(),
    defenderPlayerId: input.defenderSlot === "player1" ? playerOneId : playerTwoId,
    startingPlayerId: input.startingSlot === "player1" ? playerOneId : playerTwoId,
    currentPlayerId: input.startingSlot === "player1" ? playerOneId : playerTwoId,
    startedAt: undefined,
    endedAt: undefined,
    players,
    rounds: [],
    scoreEvents: [],
    commandPointEvents: [],
    noteEvents: [],
    timeEvents: [
      {
        id: createUuid(),
        type: "time",
        action: "session-start",
        createdAt
      }
    ]
  });
};

export const updateLocalGameDetails = (game: Game, input: CreateGameInput): Game =>
  syncDerivedGameState({
    ...game,
    gamePoints: input.gamePoints,
    scheduledDate: input.scheduledDate,
    scheduledTime: input.scheduledTime,
    deployment: input.deployment.trim(),
    primaryMission: input.primaryMission.trim(),
    defenderPlayerId: input.defenderSlot === "player1" ? game.players[0].id : game.players[1].id,
    startingPlayerId: input.startingSlot === "player1" ? game.players[0].id : game.players[1].id,
    players: [
      {
        ...game.players[0],
        name: input.playerOneName.trim(),
        army: {
          ...game.players[0].army,
          name: input.playerOneArmy.trim(),
          maxPoints: input.gamePoints
        }
      },
      {
        ...game.players[1],
        name: input.playerTwoName.trim(),
        army: {
          ...game.players[1].army,
          name: input.playerTwoArmy.trim(),
          maxPoints: input.gamePoints
        }
      }
    ]
  });

export const appendLocalScoreEvent = (
  game: Game,
  payload: {
    playerId: PlayerId;
    scoreType: ScoreType;
    value: number;
    note?: string;
    roundNumber?: number;
    turnNumber?: number;
    createdAt?: string;
  }
): Game => {
  const event: ScoreEvent = {
    id: createUuid(),
    type: "score",
    playerId: payload.playerId,
    scoreType: payload.scoreType,
    value: payload.value,
    note: payload.note?.trim() || undefined,
    roundNumber: payload.roundNumber,
    turnNumber: payload.turnNumber,
    createdAt: payload.createdAt ?? getNowIso()
  };

  return syncDerivedGameState({
    ...game,
    scoreEvents: [...game.scoreEvents, event]
  });
};

export const appendLocalCommandPointEvent = (
  game: Game,
  payload: {
    playerId: PlayerId;
    cpType: CommandPointType;
    value: number;
    note?: string;
    roundNumber?: number;
    turnNumber?: number;
    createdAt?: string;
  }
): Game => {
  const event: CommandPointEvent = {
    id: createUuid(),
    type: "command-point",
    playerId: payload.playerId,
    cpType: payload.cpType,
    value: payload.value,
    note: payload.note?.trim() || undefined,
    roundNumber: payload.roundNumber,
    turnNumber: payload.turnNumber,
    createdAt: payload.createdAt ?? getNowIso()
  };

  return syncDerivedGameState({
    ...game,
    commandPointEvents: [...game.commandPointEvents, event]
  });
};

export const appendLocalNoteEvent = (
  game: Game,
  payload: {
    playerId: PlayerId;
    note: string;
    roundNumber?: number;
    turnNumber?: number;
    createdAt?: string;
  }
): Game => {
  const event: NoteEvent = {
    id: createUuid(),
    type: "note",
    playerId: payload.playerId,
    note: payload.note.trim(),
    roundNumber: payload.roundNumber,
    turnNumber: payload.turnNumber,
    createdAt: payload.createdAt ?? getNowIso()
  };

  return syncDerivedGameState({
    ...game,
    noteEvents: [...game.noteEvents, event]
  });
};

export const appendLocalTimeEvents = (
  game: Game,
  timeEvents: Array<{
    action: TimeEventAction;
    playerId?: PlayerId;
    roundNumber?: number;
    turnNumber?: number;
    createdAt?: string;
  }>
): Game =>
  syncDerivedGameState({
    ...game,
    timeEvents: [
      ...game.timeEvents,
      ...timeEvents.map(
        (timeEvent): TimeEvent => ({
          id: createUuid(),
          type: "time",
          action: timeEvent.action,
          playerId: timeEvent.playerId,
          roundNumber: timeEvent.roundNumber,
          turnNumber: timeEvent.turnNumber,
          createdAt: timeEvent.createdAt ?? getNowIso()
        })
      )
    ]
  });

export const removeLocalEvent = (game: Game, eventId: string): Game =>
  syncDerivedGameState({
    ...game,
    scoreEvents: game.scoreEvents.filter((event) => event.id !== eventId),
    commandPointEvents: game.commandPointEvents.filter((event) => event.id !== eventId),
    noteEvents: game.noteEvents.filter((event) => event.id !== eventId),
    timeEvents: game.timeEvents.filter((event) => event.id !== eventId)
  });

export const updateLocalEvent = (
  game: Game,
  eventId: string,
  patch: {
    value_number?: number | null;
    note?: string | null;
  }
): Game => {
  const nextNote = patch.note?.trim() || undefined;

  return syncDerivedGameState({
    ...game,
    scoreEvents: game.scoreEvents.map((event) =>
      event.id === eventId
        ? {
            ...event,
            value: typeof patch.value_number === "number" ? patch.value_number : event.value,
            note: nextNote
          }
        : event
    ),
    commandPointEvents: game.commandPointEvents.map((event) =>
      event.id === eventId
        ? {
            ...event,
            value: typeof patch.value_number === "number" ? patch.value_number : event.value,
            note: nextNote
          }
        : event
    ),
    noteEvents: game.noteEvents.map((event) =>
      event.id === eventId
        ? {
            ...event,
            note: nextNote ?? ""
          }
        : event
    )
  });
};

export const overlayLocalGameMetadata = (baseGame: Game, localGame: Game): Game =>
  syncDerivedGameState({
    ...baseGame,
    gamePoints: localGame.gamePoints,
    scheduledDate: localGame.scheduledDate,
    scheduledTime: localGame.scheduledTime,
    deployment: localGame.deployment,
    primaryMission: localGame.primaryMission,
    defenderPlayerId: localGame.defenderPlayerId,
    startingPlayerId: localGame.startingPlayerId,
    currentPlayerId: localGame.currentPlayerId,
    startedAt: localGame.startedAt,
    endedAt: localGame.endedAt,
    players: localGame.players
  });

export const upsertLocalEventFromSource = (
  baseGame: Game,
  sourceGame: Game,
  eventId: string
): Game => {
  const scoreEvent = sourceGame.scoreEvents.find((event) => event.id === eventId);
  if (scoreEvent) {
    return syncDerivedGameState({
      ...baseGame,
      scoreEvents: [
        ...baseGame.scoreEvents.filter((event) => event.id !== eventId),
        scoreEvent
      ]
    });
  }

  const commandPointEvent = sourceGame.commandPointEvents.find((event) => event.id === eventId);
  if (commandPointEvent) {
    return syncDerivedGameState({
      ...baseGame,
      commandPointEvents: [
        ...baseGame.commandPointEvents.filter((event) => event.id !== eventId),
        commandPointEvent
      ]
    });
  }

  const noteEvent = sourceGame.noteEvents.find((event) => event.id === eventId);
  if (noteEvent) {
    return syncDerivedGameState({
      ...baseGame,
      noteEvents: [
        ...baseGame.noteEvents.filter((event) => event.id !== eventId),
        noteEvent
      ]
    });
  }

  const timeEvent = sourceGame.timeEvents.find((event) => event.id === eventId);
  if (timeEvent) {
    return syncDerivedGameState({
      ...baseGame,
      timeEvents: [
        ...baseGame.timeEvents.filter((event) => event.id !== eventId),
        timeEvent
      ]
    });
  }

  return baseGame;
};

export const mapPersistedGame = (value: unknown): Game | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const rawGame = value as Game;
  const gameId = isUuid(rawGame.id) ? rawGame.id : createUuid();
  const playerOneId = `${gameId}:player-1`;
  const playerTwoId = `${gameId}:player-2`;
  const playerIdMap = new Map<string, PlayerId>([
    [rawGame.players[0]?.id ?? "player-1", playerOneId],
    [rawGame.players[1]?.id ?? "player-2", playerTwoId],
    ["player-1", playerOneId],
    ["player-2", playerTwoId]
  ]);
  const mapPlayerId = (playerId?: string): PlayerId | undefined =>
    playerId ? playerIdMap.get(playerId) ?? playerId : undefined;

  return syncDerivedGameState({
    ...rawGame,
    id: gameId,
    defenderPlayerId: mapPlayerId(rawGame.defenderPlayerId) ?? playerOneId,
    startingPlayerId: mapPlayerId(rawGame.startingPlayerId) ?? playerOneId,
    currentPlayerId: mapPlayerId(rawGame.currentPlayerId) ?? playerOneId,
    players: [
      {
        ...rawGame.players[0],
        id: playerOneId
      },
      {
        ...rawGame.players[1],
        id: playerTwoId
      }
    ],
    scoreEvents: rawGame.scoreEvents.map((event) => ({
      ...event,
      id: isUuid(event.id) ? event.id : createUuid(),
      playerId: mapPlayerId(event.playerId) ?? playerOneId
    })),
    commandPointEvents: rawGame.commandPointEvents.map((event) => ({
      ...event,
      id: isUuid(event.id) ? event.id : createUuid(),
      playerId: mapPlayerId(event.playerId) ?? playerOneId
    })),
    noteEvents: rawGame.noteEvents.map((event) => ({
      ...event,
      id: isUuid(event.id) ? event.id : createUuid(),
      playerId: mapPlayerId(event.playerId) ?? playerOneId
    })),
    timeEvents: rawGame.timeEvents.map((event) => ({
      ...event,
      id: isUuid(event.id) ? event.id : createUuid(),
      playerId: mapPlayerId(event.playerId)
    }))
  });
};
