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
  createEventPayload,
  createImportedEventPayloads,
  createImportedGamePayload,
  gamesRepository
} from "../services/gamesRepository";
import type { CreateSupabaseEventPayload } from "../services/gamesRepository";
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
  isTurnActive
} from "../utils/gameCalculations";
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
  startRound: (gameId: string) => Promise<void>;
  endRound: (gameId: string) => Promise<void>;
  startTurn: (gameId: string) => Promise<void>;
  endTurn: (gameId: string) => Promise<void>;
  addScoreEvent: (payload: EventPayload & { scoreType: ScoreType }) => Promise<void>;
  addCommandPointEvent: (payload: EventPayload & { cpType: CommandPointType }) => Promise<void>;
  addNoteEvent: (payload: EventPayload) => Promise<void>;
  finishGame: (gameId: string) => Promise<void>;
  importGames: (games: Game[]) => Promise<void>;
  exportGames: () => Game[];
  clearError: () => void;
}

const GameStoreContext = createContext<GameStoreValue | null>(null);

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unbekannter Fehler.";

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
        setGames((currentGames) => [createdGame, ...currentGames]);
        return createdGame;
      }),
    [runMutation]
  );

  const startRound = useCallback(
    async (gameId: string) =>
      runMutation(async () => {
        const game = getGame(gameId);
        if (!game) {
          throw new Error("Spiel nicht gefunden.");
        }

        const latestRound = getLatestRound(game);
        if (latestRound && !latestRound.endedAt) {
          return;
        }

        const now = getNowIso();
        const nextRoundNumber = (latestRound?.roundNumber ?? 0) + 1;
        const payloads: CreateSupabaseEventPayload[] = [];

        if (!game.timeEvents.some((event) => event.action === "game-start")) {
          payloads.push(
            createEventPayload(game, {
              playerId: game.currentPlayerId,
              eventType: "game-start",
              occurredAt: now
            })
          );
        }

        payloads.push(
          createEventPayload(game, {
            playerId: game.currentPlayerId,
            roundNumber: nextRoundNumber,
            eventType: "round-start",
            occurredAt: now
          })
        );

        await gamesRepository.addEvents(payloads);
        await gamesRepository.updateGame(gameId, {
          started_at: now
        });
        await refreshSingleGame(gameId);
      }),
    [getGame, refreshSingleGame, runMutation]
  );

  const endTurn = useCallback(
    async (gameId: string) =>
      runMutation(async () => {
        const game = getGame(gameId);
        if (!game) {
          throw new Error("Spiel nicht gefunden.");
        }

        const latestTurn = getLatestTurn(game);
        if (!latestTurn || latestTurn.timing.endedAt) {
          return;
        }

        await gamesRepository.addEvent(
          createEventPayload(game, {
            playerId: latestTurn.playerId,
            roundNumber: latestTurn.roundNumber,
            turnNumber: latestTurn.turnNumber,
            eventType: "turn-end"
          })
        );
        await refreshSingleGame(gameId);
      }),
    [getGame, refreshSingleGame, runMutation]
  );

  const startTurn = useCallback(
    async (gameId: string) =>
      runMutation(async () => {
        const game = getGame(gameId);
        if (!game) {
          throw new Error("Spiel nicht gefunden.");
        }

        const latestRound = getLatestRound(game);
        if (!latestRound || latestRound.endedAt || isTurnActive(game)) {
          return;
        }

        await gamesRepository.addEvent(
          createEventPayload(game, {
            playerId: game.currentPlayerId,
            roundNumber: latestRound.roundNumber,
            turnNumber: latestRound.turns.length + 1,
            eventType: "turn-start"
          })
        );
        await refreshSingleGame(gameId);
      }),
    [getGame, refreshSingleGame, runMutation]
  );

  const endRound = useCallback(
    async (gameId: string) =>
      runMutation(async () => {
        const game = getGame(gameId);
        if (!game) {
          throw new Error("Spiel nicht gefunden.");
        }

        const latestRound = getLatestRound(game);
        if (!latestRound || latestRound.endedAt) {
          return;
        }

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

        payloads.push(
          createEventPayload(game, {
            playerId: game.currentPlayerId,
            roundNumber: latestRound.roundNumber,
            eventType: "round-end"
          })
        );

        await gamesRepository.addEvents(payloads);
        await refreshSingleGame(gameId);
      }),
    [getGame, refreshSingleGame, runMutation]
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
    [getGame, refreshSingleGame, runMutation]
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
      clearError
    }),
    [
      addCommandPointEvent,
      addNoteEvent,
      addScoreEvent,
      clearError,
      createGame,
      endRound,
      endTurn,
      errorMessage,
      exportGames,
      finishGame,
      games,
      getGame,
      importGames,
      isLoading,
      isMutating,
      refreshGames,
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
