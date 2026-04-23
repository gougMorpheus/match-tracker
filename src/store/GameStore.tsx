import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from "react";
import { localGameRepository } from "../data/gameRepository";
import type {
  CommandPointType,
  CreateGameInput,
  Game,
  NoteEvent,
  PlayerId,
  ScoreType,
  TimeEvent
} from "../types/game";
import { createId } from "../utils/id";
import { getLatestRound, getLatestTurn, isTurnActive } from "../utils/gameCalculations";
import { getNowIso } from "../utils/time";

interface EventPayload {
  gameId: string;
  playerId: PlayerId;
  value?: number;
  note?: string;
}

interface GameStoreValue {
  games: Game[];
  importError: string | null;
  createGame: (input: CreateGameInput) => Game;
  getGame: (gameId: string) => Game | undefined;
  startRound: (gameId: string) => void;
  endRound: (gameId: string) => void;
  startTurn: (gameId: string) => void;
  endTurn: (gameId: string) => void;
  addScoreEvent: (payload: EventPayload & { scoreType: ScoreType }) => void;
  addCommandPointEvent: (payload: EventPayload & { cpType: CommandPointType }) => void;
  addNoteEvent: (payload: EventPayload) => void;
  finishGame: (gameId: string) => void;
  importGames: (games: Game[]) => void;
  exportGames: () => Game[];
  clearImportError: () => void;
}

const GameStoreContext = createContext<GameStoreValue | null>(null);

const updateGameCollection = (games: Game[], gameId: string, updater: (game: Game) => Game): Game[] =>
  games.map((game) => (game.id === gameId ? updater(game) : game));

const createTimeEvent = (gameId: string, action: TimeEvent["action"], timestamp: string): TimeEvent => ({
  id: createId(`time-${gameId}`),
  type: "time",
  action,
  createdAt: timestamp
});

export const GameStoreProvider = ({ children }: PropsWithChildren) => {
  const [games, setGames] = useState<Game[]>(() => localGameRepository.load());
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    localGameRepository.save(games);
  }, [games]);

  const getGame = useCallback(
    (gameId: string) => games.find((game) => game.id === gameId),
    [games]
  );

  const createGame = useCallback((input: CreateGameInput): Game => {
    const createdAt = getNowIso();
    const playerOneId = createId("player");
    const playerTwoId = createId("player");
    const players: Game["players"] = [
      {
        id: playerOneId,
        name: input.playerOneName.trim(),
        army: {
          name: input.playerOneArmy.trim(),
          maxPoints: input.playerOneMaxPoints
        }
      },
      {
        id: playerTwoId,
        name: input.playerTwoName.trim(),
        army: {
          name: input.playerTwoArmy.trim(),
          maxPoints: input.playerTwoMaxPoints
        }
      }
    ];
    const defenderPlayerId = input.defenderSlot === "player1" ? playerOneId : playerTwoId;
    const startingPlayerId = input.startingSlot === "player1" ? playerOneId : playerTwoId;

    const nextGame: Game = {
      id: createId("game"),
      createdAt,
      updatedAt: createdAt,
      status: "active",
      scheduledDate: input.scheduledDate,
      scheduledTime: input.scheduledTime,
      defenderPlayerId,
      startingPlayerId,
      currentPlayerId: startingPlayerId,
      players,
      rounds: [],
      scoreEvents: [],
      commandPointEvents: [],
      noteEvents: [],
      timeEvents: []
    };

    setGames((currentGames) => [nextGame, ...currentGames]);
    return nextGame;
  }, []);

  const startRound = useCallback((gameId: string) => {
    setGames((currentGames) =>
      updateGameCollection(currentGames, gameId, (game) => {
        const now = getNowIso();
        const latestRound = getLatestRound(game);
        if (latestRound && !latestRound.endedAt) {
          return game;
        }

        const roundNumber = (latestRound?.roundNumber ?? 0) + 1;
        return {
          ...game,
          startedAt: game.startedAt ?? now,
          updatedAt: now,
          rounds: [
            ...game.rounds,
            {
              id: createId("round"),
              roundNumber,
              startedAt: now,
              turns: []
            }
          ],
          timeEvents: [
            ...game.timeEvents,
            ...(game.startedAt
              ? []
              : [
                  {
                    ...createTimeEvent(gameId, "game-start", now)
                  }
                ]),
            {
              ...createTimeEvent(gameId, "round-start", now),
              roundNumber
            }
          ]
        };
      })
    );
  }, []);

  const endTurn = useCallback((gameId: string) => {
    setGames((currentGames) =>
      updateGameCollection(currentGames, gameId, (game) => {
        const latestRound = getLatestRound(game);
        const latestTurn = getLatestTurn(game);
        if (!latestRound || !latestTurn || latestTurn.timing.endedAt) {
          return game;
        }

        const now = getNowIso();
        const rounds = game.rounds.map((round) => {
          if (round.id !== latestRound.id) {
            return round;
          }

          return {
            ...round,
            turns: round.turns.map((turn) =>
              turn.id === latestTurn.id
                ? {
                    ...turn,
                    timing: {
                      ...turn.timing,
                      endedAt: now
                    }
                  }
                : turn
            )
          };
        });

        const nextPlayerId =
          game.players.find((player) => player.id !== latestTurn.playerId)?.id ?? game.currentPlayerId;

        return {
          ...game,
          updatedAt: now,
          currentPlayerId: nextPlayerId,
          rounds,
          timeEvents: [
            ...game.timeEvents,
            {
              ...createTimeEvent(gameId, "turn-end", now),
              playerId: latestTurn.playerId,
              roundNumber: latestTurn.roundNumber,
              turnNumber: latestTurn.turnNumber
            }
          ]
        };
      })
    );
  }, []);

  const startTurn = useCallback((gameId: string) => {
    setGames((currentGames) =>
      updateGameCollection(currentGames, gameId, (game) => {
        const latestRound = getLatestRound(game);
        if (!latestRound || latestRound.endedAt || isTurnActive(game)) {
          return game;
        }

        const now = getNowIso();
        const nextTurnNumber = latestRound.turns.length + 1;
        const playerId = game.currentPlayerId;
        const rounds = game.rounds.map((round) =>
          round.id === latestRound.id
            ? {
                ...round,
                turns: [
                  ...round.turns,
                  {
                    id: createId("turn"),
                    roundNumber: latestRound.roundNumber,
                    turnNumber: nextTurnNumber,
                    playerId,
                    timing: {
                      startedAt: now
                    }
                  }
                ]
              }
            : round
        );

        return {
          ...game,
          updatedAt: now,
          rounds,
          timeEvents: [
            ...game.timeEvents,
            {
              ...createTimeEvent(gameId, "turn-start", now),
              playerId,
              roundNumber: latestRound.roundNumber,
              turnNumber: nextTurnNumber
            }
          ]
        };
      })
    );
  }, []);

  const endRound = useCallback(
    (gameId: string) => {
      endTurn(gameId);
      setGames((currentGames) =>
        updateGameCollection(currentGames, gameId, (game) => {
          const latestRound = getLatestRound(game);
          if (!latestRound || latestRound.endedAt) {
            return game;
          }

          const now = getNowIso();
          return {
            ...game,
            updatedAt: now,
            rounds: game.rounds.map((round) =>
              round.id === latestRound.id
                ? {
                    ...round,
                    endedAt: now
                  }
                : round
            ),
            currentPlayerId: game.startingPlayerId,
            timeEvents: [
              ...game.timeEvents,
              {
                ...createTimeEvent(gameId, "round-end", now),
                roundNumber: latestRound.roundNumber
              }
            ]
          };
        })
      );
    },
    [endTurn]
  );

  const addScoreEvent = useCallback(
    ({ gameId, playerId, value = 0, note, scoreType }: EventPayload & { scoreType: ScoreType }) => {
      setGames((currentGames) =>
        updateGameCollection(currentGames, gameId, (game) => {
          const now = getNowIso();
          const latestRound = getLatestRound(game);
          const latestTurn = getLatestTurn(game);
          return {
            ...game,
            updatedAt: now,
            scoreEvents: [
              ...game.scoreEvents,
              {
                id: createId("score"),
                type: "score",
                playerId,
                scoreType,
                value,
                note: note?.trim() || undefined,
                roundNumber: latestRound?.roundNumber,
                turnNumber: latestTurn?.turnNumber,
                createdAt: now
              }
            ]
          };
        })
      );
    },
    []
  );

  const addCommandPointEvent = useCallback(
    ({ gameId, playerId, value = 0, note, cpType }: EventPayload & { cpType: CommandPointType }) => {
      setGames((currentGames) =>
        updateGameCollection(currentGames, gameId, (game) => {
          const now = getNowIso();
          const latestRound = getLatestRound(game);
          const latestTurn = getLatestTurn(game);
          return {
            ...game,
            updatedAt: now,
            commandPointEvents: [
              ...game.commandPointEvents,
              {
                id: createId("cp"),
                type: "command-point",
                playerId,
                cpType,
                value,
                note: note?.trim() || undefined,
                roundNumber: latestRound?.roundNumber,
                turnNumber: latestTurn?.turnNumber,
                createdAt: now
              }
            ]
          };
        })
      );
    },
    []
  );

  const addNoteEvent = useCallback(({ gameId, playerId, note }: EventPayload) => {
    const trimmedNote = note?.trim();
    if (!trimmedNote) {
      return;
    }

    setGames((currentGames) =>
      updateGameCollection(currentGames, gameId, (game) => {
        const now = getNowIso();
        const latestRound = getLatestRound(game);
        const latestTurn = getLatestTurn(game);
        const nextNoteEvent: NoteEvent = {
          id: createId("note"),
          type: "note",
          playerId,
          note: trimmedNote,
          roundNumber: latestRound?.roundNumber,
          turnNumber: latestTurn?.turnNumber,
          createdAt: now
        };

        return {
          ...game,
          updatedAt: now,
          noteEvents: [...game.noteEvents, nextNoteEvent]
        };
      })
    );
  }, []);

  const finishGame = useCallback(
    (gameId: string) => {
      endRound(gameId);
      setGames((currentGames) =>
        updateGameCollection(currentGames, gameId, (game) => {
          if (game.status === "completed") {
            return game;
          }

          const now = getNowIso();
          return {
            ...game,
            status: "completed",
            updatedAt: now,
            endedAt: game.endedAt ?? now,
            timeEvents: [
              ...game.timeEvents,
              ...(game.endedAt ? [] : [{ ...createTimeEvent(gameId, "game-end", now) }])
            ]
          };
        })
      );
    },
    [endRound]
  );

  const importGames = useCallback((nextGames: Game[]) => {
    setImportError(null);
    setGames(nextGames);
  }, []);

  const exportGames = useCallback(() => games, [games]);

  const clearImportError = useCallback(() => setImportError(null), []);

  const value = useMemo<GameStoreValue>(
    () => ({
      games,
      importError,
      createGame,
      getGame,
      startRound,
      endRound,
      startTurn,
      endTurn,
      addScoreEvent,
      addCommandPointEvent,
      addNoteEvent,
      finishGame,
      importGames,
      exportGames,
      clearImportError
    }),
    [
      addCommandPointEvent,
      addNoteEvent,
      addScoreEvent,
      clearImportError,
      createGame,
      endRound,
      endTurn,
      exportGames,
      finishGame,
      games,
      getGame,
      importError,
      importGames,
      startRound,
      startTurn
    ]
  );

  return <GameStoreContext.Provider value={value}>{children}</GameStoreContext.Provider>;
};

export const useGameStore = (): GameStoreValue => {
  const context = useContext(GameStoreContext);
  if (!context) {
    throw new Error("useGameStore must be used within a GameStoreProvider");
  }

  return context;
};
