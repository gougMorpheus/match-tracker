import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from "react";
import { getSupabaseConfigError } from "../lib/supabase";
import {
  createGameUpdatePayload,
  createEventPayload,
  createImportedEventPayloads,
  createImportedGamePayload,
  gamesRepository
} from "../services/gamesRepository";
import type { CreateSupabaseEventPayload } from "../services/gamesRepository";
import type { UpdateSupabaseEventPayload } from "../services/gamesRepository";
import type {
  CommandPointType,
  CreateGameInput,
  Game,
  PlayerId,
  ScoreType
} from "../types/game";
import {
  getLatestRound,
  getLatestTurn,
  getPlayerTotalScore,
  isTurnPaused
} from "../utils/gameCalculations";
import { rememberPlayerNames } from "../utils/presets";
import { normalizeSupabaseErrorMessage } from "../utils/supabaseErrors";
import { getNowIso } from "../utils/time";

interface EventPayload {
  gameId: string;
  playerId: PlayerId;
  value?: number;
  note?: string;
}

interface GameStoreValue {
  games: Game[];
  isLoading: boolean;
  isMutating: boolean;
  errorMessage: string | null;
  createGame: (input: CreateGameInput) => Promise<Game>;
  getGame: (gameId: string) => Game | undefined;
  refreshGames: () => Promise<void>;
  updateGameDetails: (gameId: string, input: CreateGameInput) => Promise<void>;
  addScoreEvent: (payload: EventPayload & { scoreType: ScoreType }) => Promise<void>;
  addCommandPointEvent: (payload: EventPayload & { cpType: CommandPointType }) => Promise<void>;
  addNoteEvent: (payload: EventPayload) => Promise<void>;
  advanceGame: (gameId: string) => Promise<void>;
  rewindLastTurn: (gameId: string) => Promise<void>;
  pauseActiveTimer: (gameId: string) => Promise<void>;
  startGameTimer: (gameId: string) => Promise<void>;
  reopenGame: (gameId: string) => Promise<void>;
  updateGameEvent: (gameId: string, eventId: string, patch: UpdateSupabaseEventPayload) => Promise<void>;
  deleteGameEvent: (gameId: string, eventId: string) => Promise<void>;
  finishGame: (gameId: string) => Promise<void>;
  deleteGame: (gameId: string) => Promise<void>;
  importGames: (games: Game[]) => Promise<void>;
  exportGames: () => Game[];
  clearError: () => void;
}

const GameStoreContext = createContext<GameStoreValue | null>(null);

const getErrorMessage = (error: unknown): string => {
  const rawMessage = error instanceof Error ? error.message : "Unbekannter Fehler.";
  return normalizeSupabaseErrorMessage(rawMessage);
};

const getWinnerPlayerSlot = (game: Game): 1 | 2 | null => {
  const playerOneScore = getPlayerTotalScore(game, game.players[0].id);
  const playerTwoScore = getPlayerTotalScore(game, game.players[1].id);

  if (playerOneScore > playerTwoScore) {
    return 1;
  }

  if (playerTwoScore > playerOneScore) {
    return 2;
  }

  return null;
};

export const GameStoreProvider = ({ children }: PropsWithChildren) => {
  const [games, setGames] = useState<Game[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(getSupabaseConfigError());

  const refreshGames = useCallback(async () => {
    const configError = getSupabaseConfigError();
    if (configError) {
      setGames([]);
      setErrorMessage(configError);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const nextGames = await gamesRepository.listGames();
      setGames(nextGames);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshGames();
  }, [refreshGames]);

  const getGame = useCallback(
    (gameId: string) => games.find((game) => game.id === gameId),
    [games]
  );

  const getActiveActionPlayerId = useCallback((game: Game): PlayerId => {
    const latestTurn = getLatestTurn(game);
    if (latestTurn?.timing.startedAt && !latestTurn.timing.endedAt) {
      return latestTurn.playerId;
    }

    return game.currentPlayerId;
  }, []);

  const refreshSingleGame = useCallback(async (gameId: string) => {
    const freshGame = await gamesRepository.getGameById(gameId);
    setGames((currentGames) => {
      const withoutTarget = currentGames.filter((game) => game.id !== gameId);
      return [freshGame, ...withoutTarget].sort(
        (left, right) => right.createdAt.localeCompare(left.createdAt)
      );
    });
  }, []);

  const runMutation = useCallback(
    async function executeMutation<T>(operation: () => Promise<T>): Promise<T> {
      const configError = getSupabaseConfigError();
      if (configError) {
        setErrorMessage(configError);
        throw new Error(configError);
      }

      setIsMutating(true);
      setErrorMessage(null);
      try {
        return await operation();
      } catch (error) {
        const message = getErrorMessage(error);
        setErrorMessage(message);
        throw error instanceof Error ? error : new Error(message);
      } finally {
        setIsMutating(false);
      }
    },
    []
  );

  const createGame = useCallback(
    async (input: CreateGameInput): Promise<Game> =>
      runMutation(async () => {
        const createdGame = await gamesRepository.createGame(input);
        rememberPlayerNames([input.playerOneName, input.playerTwoName]);
        setGames((currentGames) => [createdGame, ...currentGames]);
        return createdGame;
      }),
    [runMutation]
  );

  const updateGameDetails = useCallback(
    async (gameId: string, input: CreateGameInput) =>
      runMutation(async () => {
        await gamesRepository.updateGame(gameId, createGameUpdatePayload(input));
        rememberPlayerNames([input.playerOneName, input.playerTwoName]);
        await refreshSingleGame(gameId);
      }),
    [refreshSingleGame, runMutation]
  );

  const addScoreEvent = useCallback(
    async ({ gameId, playerId, value = 0, note, scoreType }: EventPayload & { scoreType: ScoreType }) =>
      runMutation(async () => {
        const game = getGame(gameId);
        if (!game) {
          throw new Error("Spiel nicht gefunden.");
        }

        const latestRound = getLatestRound(game);
        const latestTurn = getLatestTurn(game);
        await gamesRepository.addEvent(
          createEventPayload(game, {
            playerId,
            roundNumber: latestRound?.roundNumber,
            turnNumber: latestTurn?.turnNumber,
            eventType: scoreType === "primary" ? "score-primary" : "score-secondary",
            value,
            note
          })
        );
        await refreshSingleGame(gameId);
      }),
    [getGame, refreshSingleGame, runMutation]
  );

  const addCommandPointEvent = useCallback(
    async ({ gameId, playerId, value = 0, note, cpType }: EventPayload & { cpType: CommandPointType }) =>
      runMutation(async () => {
        const game = getGame(gameId);
        if (!game) {
          throw new Error("Spiel nicht gefunden.");
        }

        if (cpType === "spent" && playerId !== getActiveActionPlayerId(game)) {
          throw new Error("CP koennen nur vom aktiven Spieler im aktuellen Zug ausgegeben werden.");
        }

        const latestRound = getLatestRound(game);
        const latestTurn = getLatestTurn(game);
        await gamesRepository.addEvent(
          createEventPayload(game, {
            playerId,
            roundNumber: latestRound?.roundNumber,
            turnNumber: latestTurn?.turnNumber,
            eventType: cpType === "gained" ? "cp-gained" : "cp-spent",
            value,
            note
          })
        );
        await refreshSingleGame(gameId);
      }),
    [getActiveActionPlayerId, getGame, refreshSingleGame, runMutation]
  );

  const addNoteEvent = useCallback(
    async ({ gameId, playerId, note }: EventPayload) =>
      runMutation(async () => {
        const trimmedNote = note?.trim();
        if (!trimmedNote) {
          return;
        }

        const game = getGame(gameId);
        if (!game) {
          throw new Error("Spiel nicht gefunden.");
        }

        const latestRound = getLatestRound(game);
        const latestTurn = getLatestTurn(game);
        await gamesRepository.addEvent(
          createEventPayload(game, {
            playerId,
            roundNumber: latestRound?.roundNumber,
            turnNumber: latestTurn?.turnNumber,
            eventType: "note",
            note: trimmedNote
          })
        );
        await refreshSingleGame(gameId);
      }),
    [getGame, refreshSingleGame, runMutation]
  );

  const finishGame = useCallback(
    async (gameId: string) =>
      runMutation(async () => {
        const game = getGame(gameId);
        if (!game) {
          throw new Error("Spiel nicht gefunden.");
        }

        const latestRound = getLatestRound(game);
        const latestTurn = getLatestTurn(game);
        const payloads: CreateSupabaseEventPayload[] = [];
        if (latestTurn && latestTurn.timing.startedAt && !latestTurn.timing.endedAt) {
          payloads.push(
            createEventPayload(game, {
              playerId: latestTurn.playerId,
              roundNumber: latestTurn.roundNumber,
              turnNumber: latestTurn.turnNumber,
              eventType: "turn-end"
            })
          );
        }

        if (latestRound && latestRound.startedAt && !latestRound.endedAt) {
          payloads.push(
            createEventPayload(game, {
              playerId: game.currentPlayerId,
              roundNumber: latestRound.roundNumber,
              eventType: "round-end"
            })
          );
        }

        payloads.push(
          createEventPayload(game, {
            playerId: game.currentPlayerId,
            eventType: "game-end"
          })
        );

        await gamesRepository.addEvents(payloads);
        await gamesRepository.updateGame(gameId, {
          ended_at: getNowIso(),
          winner_player: getWinnerPlayerSlot(game)
        });
        await refreshSingleGame(gameId);
      }),
    [getGame, refreshSingleGame, runMutation]
  );

  const advanceGame = useCallback(
    async (gameId: string) =>
      runMutation(async () => {
        const game = getGame(gameId);
        if (!game || game.status === "completed") {
          return;
        }

        const latestRound = getLatestRound(game);
        const latestTurn = getLatestTurn(game);
        const now = getNowIso();
        const payloads: CreateSupabaseEventPayload[] = [];
        const otherPlayerId =
          game.players.find((player) => player.id !== game.currentPlayerId)?.id ?? game.currentPlayerId;

        if (!latestRound || latestRound.endedAt) {
          const nextRoundNumber = (latestRound?.roundNumber ?? 0) + 1;

          if (!game.timeEvents.some((event) => event.action === "game-start")) {
            payloads.push(
              createEventPayload(game, {
                playerId: game.startingPlayerId,
                eventType: "game-start",
                occurredAt: now
              })
            );
          }

          payloads.push(
            createEventPayload(game, {
              playerId: game.startingPlayerId,
              roundNumber: nextRoundNumber,
              eventType: "round-start",
              occurredAt: now
            }),
            createEventPayload(game, {
              playerId: game.startingPlayerId,
              roundNumber: nextRoundNumber,
              turnNumber: 1,
              eventType: "turn-start",
              occurredAt: now
            })
          );
        } else if (!latestTurn || latestTurn.timing.endedAt) {
          if (latestRound.turns.length >= 2) {
            const nextRoundNumber = latestRound.roundNumber + 1;
            payloads.push(
              createEventPayload(game, {
                playerId: latestRound.turns[latestRound.turns.length - 1]?.playerId ?? game.startingPlayerId,
                roundNumber: latestRound.roundNumber,
                eventType: "round-end",
                occurredAt: now
              }),
              createEventPayload(game, {
                playerId: game.startingPlayerId,
                roundNumber: nextRoundNumber,
                eventType: "round-start",
                occurredAt: now
              }),
              createEventPayload(game, {
                playerId: game.startingPlayerId,
                roundNumber: nextRoundNumber,
                turnNumber: 1,
                eventType: "turn-start",
                occurredAt: now
              })
            );
          } else {
            const nextTurnNumber = latestRound.turns.length + 1;
            const previousPlayerId = latestTurn?.playerId ?? latestRound.turns[latestRound.turns.length - 1]?.playerId;
            const nextPlayerId =
              game.players.find((player) => player.id !== previousPlayerId)?.id ?? otherPlayerId;

            payloads.push(
              createEventPayload(game, {
                playerId: nextPlayerId,
                roundNumber: latestRound.roundNumber,
                turnNumber: nextTurnNumber,
                eventType: "turn-start",
                occurredAt: now
              })
            );
          }
        } else {
          payloads.push(
            createEventPayload(game, {
              playerId: latestTurn.playerId,
              roundNumber: latestTurn.roundNumber,
              turnNumber: latestTurn.turnNumber,
              eventType: "turn-end",
              occurredAt: now
            })
          );

          if (latestRound.turns.length >= 2) {
            const nextRoundNumber = latestRound.roundNumber + 1;
            payloads.push(
              createEventPayload(game, {
                playerId: latestTurn.playerId,
                roundNumber: latestRound.roundNumber,
                eventType: "round-end",
                occurredAt: now
              }),
              createEventPayload(game, {
                playerId: game.startingPlayerId,
                roundNumber: nextRoundNumber,
                eventType: "round-start",
                occurredAt: now
              }),
              createEventPayload(game, {
                playerId: game.startingPlayerId,
                roundNumber: nextRoundNumber,
                turnNumber: 1,
                eventType: "turn-start",
                occurredAt: now
              })
            );
          } else {
            payloads.push(
              createEventPayload(game, {
                playerId: otherPlayerId,
                roundNumber: latestRound.roundNumber,
                turnNumber: latestRound.turns.length + 1,
                eventType: "turn-start",
                occurredAt: now
              })
            );
          }
        }

        if (payloads.length) {
          await gamesRepository.addEvents(payloads);
          await refreshSingleGame(gameId);
        }
      }),
    [getGame, refreshSingleGame, runMutation]
  );

  const rewindLastTurn = useCallback(
    async (gameId: string) =>
      runMutation(async () => {
        const game = getGame(gameId);
        if (!game || game.status === "completed") {
          return;
        }

        const latestRound = getLatestRound(game);
        const latestTurn = getLatestTurn(game);
        if (!latestRound || !latestTurn) {
          return;
        }

        const eventIds = new Set<string>();

        game.commandPointEvents.forEach((event) => {
          if (event.roundNumber === latestTurn.roundNumber && event.turnNumber === latestTurn.turnNumber) {
            eventIds.add(event.id);
          }
        });

        game.scoreEvents.forEach((event) => {
          if (event.roundNumber === latestTurn.roundNumber && event.turnNumber === latestTurn.turnNumber) {
            eventIds.add(event.id);
          }
        });

        game.noteEvents.forEach((event) => {
          if (event.roundNumber === latestTurn.roundNumber && event.turnNumber === latestTurn.turnNumber) {
            eventIds.add(event.id);
          }
        });

        game.timeEvents.forEach((event) => {
          if (
            event.roundNumber === latestTurn.roundNumber &&
            event.turnNumber === latestTurn.turnNumber
          ) {
            eventIds.add(event.id);
          }

          if (
            event.action === "round-end" &&
            event.roundNumber === latestRound.roundNumber
          ) {
            eventIds.add(event.id);
          }

          if (
            latestRound.turns.length === 1 &&
            event.action === "round-start" &&
            event.roundNumber === latestRound.roundNumber
          ) {
            eventIds.add(event.id);
          }
        });

        for (const eventId of eventIds) {
          await gamesRepository.deleteEvent(eventId);
        }

        await refreshSingleGame(gameId);
      }),
    [getGame, refreshSingleGame, runMutation]
  );

  const pauseActiveTimer = useCallback(
    async (gameId: string) =>
      runMutation(async () => {
        const game = getGame(gameId);
        if (!game || game.status === "completed") {
          return;
        }

        const latestTurn = getLatestTurn(game);
        if (!latestTurn || !latestTurn.timing.startedAt || latestTurn.timing.endedAt || isTurnPaused(latestTurn)) {
          return;
        }

        await gamesRepository.addEvent(
          createEventPayload(game, {
            playerId: latestTurn.playerId,
            roundNumber: latestTurn.roundNumber,
            turnNumber: latestTurn.turnNumber,
            eventType: "turn-pause"
          })
        );
        await refreshSingleGame(gameId);
      }),
    [getGame, refreshSingleGame, runMutation]
  );

  const startGameTimer = useCallback(
    async (gameId: string) =>
      runMutation(async () => {
        const game = getGame(gameId);
        if (!game || game.status === "completed") {
          return;
        }

        const latestRound = getLatestRound(game);
        const latestTurn = getLatestTurn(game);

        if (!latestRound || latestRound.endedAt) {
          const nextRoundNumber = (latestRound?.roundNumber ?? 0) + 1;
          const payloads: CreateSupabaseEventPayload[] = [];

          if (!game.timeEvents.some((event) => event.action === "game-start")) {
            payloads.push(
              createEventPayload(game, {
                playerId: game.startingPlayerId,
                eventType: "game-start"
              })
            );
          }

          payloads.push(
            createEventPayload(game, {
              playerId: game.startingPlayerId,
              roundNumber: nextRoundNumber,
              eventType: "round-start"
            }),
            createEventPayload(game, {
              playerId: game.startingPlayerId,
              roundNumber: nextRoundNumber,
              turnNumber: 1,
              eventType: "turn-start"
            })
          );

          await gamesRepository.addEvents(payloads);
          await refreshSingleGame(gameId);
          return;
        }

        if (!latestTurn) {
          await gamesRepository.addEvent(
            createEventPayload(game, {
              playerId: game.currentPlayerId,
              roundNumber: latestRound.roundNumber,
              turnNumber: latestRound.turns.length + 1,
              eventType: "turn-start"
            })
          );
          await refreshSingleGame(gameId);
          return;
        }

        if (isTurnPaused(latestTurn)) {
          await gamesRepository.addEvent(
            createEventPayload(game, {
              playerId: latestTurn.playerId,
              roundNumber: latestTurn.roundNumber,
              turnNumber: latestTurn.turnNumber,
              eventType: "turn-resume"
            })
          );
          await refreshSingleGame(gameId);
        }
      }),
    [getGame, refreshSingleGame, runMutation]
  );

  const reopenGame = useCallback(
    async (gameId: string) =>
      runMutation(async () => {
        const game = getGame(gameId);
        if (!game || game.status !== "completed") {
          return;
        }

        const latestGameEndEvent = [...game.timeEvents]
          .filter((event) => event.action === "game-end")
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];

        if (latestGameEndEvent) {
          await gamesRepository.deleteEvent(latestGameEndEvent.id);
        }

        await gamesRepository.updateGame(gameId, {
          ended_at: null,
          winner_player: null
        });
        await refreshSingleGame(gameId);
      }),
    [getGame, refreshSingleGame, runMutation]
  );

  const updateGameEvent = useCallback(
    async (gameId: string, eventId: string, patch: UpdateSupabaseEventPayload) =>
      runMutation(async () => {
        await gamesRepository.updateEvent(eventId, patch);
        await refreshSingleGame(gameId);
      }),
    [refreshSingleGame, runMutation]
  );

  const deleteGameEvent = useCallback(
    async (gameId: string, eventId: string) =>
      runMutation(async () => {
        await gamesRepository.deleteEvent(eventId);
        await refreshSingleGame(gameId);
      }),
    [refreshSingleGame, runMutation]
  );

  const deleteGame = useCallback(
    async (gameId: string) =>
      runMutation(async () => {
        await gamesRepository.deleteGame(gameId);
        setGames((currentGames) => currentGames.filter((game) => game.id !== gameId));
      }),
    [runMutation]
  );

  const importGames = useCallback(
    async (importedGames: Game[]) =>
      runMutation(async () => {
        for (const importedGame of importedGames) {
          const createdGame = await gamesRepository.createGame(createImportedGamePayload(importedGame));
          const eventPayloads = createImportedEventPayloads(createdGame, importedGame);
          if (eventPayloads.length) {
            await gamesRepository.addEvents(eventPayloads);
          }
          await gamesRepository.updateGame(createdGame.id, {
            started_at: importedGame.startedAt ?? createdGame.createdAt,
            ended_at: importedGame.endedAt ?? null,
            winner_player: importedGame.endedAt ? getWinnerPlayerSlot(importedGame) : null
          });
          rememberPlayerNames(importedGame.players.map((player) => player.name));
        }

        await refreshGames();
      }),
    [refreshGames, runMutation]
  );

  const exportGames = useCallback(() => games, [games]);
  const clearError = useCallback(() => setErrorMessage(null), []);

  const value = useMemo<GameStoreValue>(
    () => ({
      games,
      isLoading,
      isMutating,
      errorMessage,
      createGame,
      getGame,
      refreshGames,
      updateGameDetails,
      addScoreEvent,
      addCommandPointEvent,
      addNoteEvent,
      advanceGame,
      rewindLastTurn,
      pauseActiveTimer,
      startGameTimer,
      reopenGame,
      updateGameEvent,
      deleteGameEvent,
      finishGame,
      deleteGame,
      importGames,
      exportGames,
      clearError
    }),
    [
      addCommandPointEvent,
      addNoteEvent,
      addScoreEvent,
      advanceGame,
      clearError,
      createGame,
      deleteGame,
      deleteGameEvent,
      errorMessage,
      exportGames,
      finishGame,
      games,
      getGame,
      importGames,
      isLoading,
      isMutating,
      pauseActiveTimer,
      reopenGame,
      rewindLastTurn,
      startGameTimer,
      updateGameEvent,
      updateGameDetails,
      refreshGames,
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
