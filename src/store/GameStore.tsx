import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren
} from "react";
import { getSupabaseConfigError } from "../lib/supabase";
import { gamesRepository } from "../services/gamesRepository";
import type { UpdateSupabaseEventPayload } from "../services/gamesRepository";
import type {
  CommandPointType,
  CreateGameInput,
  Game,
  PlayerId,
  ScoreType,
  TimeEventAction
} from "../types/game";
import {
  appendLocalCommandPointEvent,
  appendLocalNoteEvent,
  appendLocalScoreEvent,
  appendLocalTimeEvents,
  createLocalGame,
  mapPersistedGame,
  removeLocalEvent,
  syncDerivedGameState,
  updateLocalEvent,
  updateLocalGameDetails
} from "../utils/gameState";
import {
  getLatestRound,
  getLatestTurn,
  isTurnPaused
} from "../utils/gameCalculations";
import {
  createSyncQueueItem,
  getSyncErrorMessage,
  loadCachedGames,
  loadSyncQueue,
  saveCachedGames,
  saveSyncQueue,
  type SyncQueueItem
} from "../utils/localSync";
import { rememberPlayerNames } from "../utils/presets";
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

const sortGames = (games: Game[]): Game[] =>
  [...games].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

const mergeRemoteWithPending = (
  remoteGames: Game[],
  localGames: Game[],
  queue: SyncQueueItem[]
): Game[] => {
  const pendingUpsertIds = new Set(
    queue.filter((item) => item.type === "upsert-game").map((item) => item.gameId)
  );
  const pendingDeleteIds = new Set(
    queue.filter((item) => item.type === "delete-game").map((item) => item.gameId)
  );
  const mergedGames = remoteGames
    .filter((game) => !pendingDeleteIds.has(game.id) && !pendingUpsertIds.has(game.id))
    .concat(localGames.filter((game) => pendingUpsertIds.has(game.id)));

  return sortGames(mergedGames);
};

const getErrorMessage = (error: unknown): string => getSyncErrorMessage(error);

export const GameStoreProvider = ({ children }: PropsWithChildren) => {
  const [games, setGames] = useState<Game[]>(() => sortGames(loadCachedGames()));
  const [syncQueue, setSyncQueue] = useState<SyncQueueItem[]>(loadSyncQueue);
  const [isLoading, setIsLoading] = useState(games.length === 0);
  const [isMutating, setIsMutating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const gamesRef = useRef(games);
  const queueRef = useRef(syncQueue);
  const flushPromiseRef = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    gamesRef.current = games;
    saveCachedGames(games);
  }, [games]);

  useEffect(() => {
    queueRef.current = syncQueue;
    saveSyncQueue(syncQueue);
  }, [syncQueue]);

  const getGame = useCallback(
    (gameId: string) => gamesRef.current.find((game) => game.id === gameId),
    []
  );

  const replaceGame = useCallback((nextGame: Game) => {
    const syncedGame = syncDerivedGameState(nextGame);
    setGames((currentGames) =>
      sortGames([syncedGame, ...currentGames.filter((game) => game.id !== syncedGame.id)])
    );
    return syncedGame;
  }, []);

  const removeGameLocally = useCallback((gameId: string) => {
    setGames((currentGames) => currentGames.filter((game) => game.id !== gameId));
  }, []);

  const mutateGame = useCallback(
    (gameId: string, mutator: (game: Game) => Game): Game => {
      const currentGame = getGame(gameId);
      if (!currentGame) {
        throw new Error("Spiel nicht gefunden.");
      }

      return replaceGame(mutator(currentGame));
    },
    [getGame, replaceGame]
  );

  const enqueueUpsert = useCallback((gameId: string) => {
    setSyncQueue((currentQueue) => {
      const withoutDelete = currentQueue.filter(
        (item) => !(item.type === "delete-game" && item.gameId === gameId)
      );
      if (withoutDelete.some((item) => item.type === "upsert-game" && item.gameId === gameId)) {
        return withoutDelete;
      }

      return [
        ...withoutDelete,
        createSyncQueueItem("upsert-game", gameId, getNowIso())
      ];
    });
  }, []);

  const enqueueDelete = useCallback((gameId: string) => {
    setSyncQueue((currentQueue) => [
      ...currentQueue.filter((item) => item.gameId !== gameId),
      createSyncQueueItem("delete-game", gameId, getNowIso())
    ]);
  }, []);

  const dequeueItem = useCallback((queueItemId: string) => {
    setSyncQueue((currentQueue) => currentQueue.filter((item) => item.id !== queueItemId));
  }, []);

  const getActiveActionPlayerId = useCallback((game: Game): PlayerId => {
    const latestTurn = getLatestTurn(game);
    if (latestTurn?.timing.startedAt && !latestTurn.timing.endedAt) {
      return latestTurn.playerId;
    }

    return game.currentPlayerId;
  }, []);

  const flushSyncQueue = useCallback(async (): Promise<boolean> => {
    if (flushPromiseRef.current) {
      return flushPromiseRef.current;
    }

    flushPromiseRef.current = (async () => {
      const configError = getSupabaseConfigError();
      if (configError) {
        setErrorMessage(configError);
        return false;
      }

      while (queueRef.current.length) {
        const nextItem = queueRef.current[0];
        if (!nextItem) {
          break;
        }

        try {
          if (nextItem.type === "delete-game") {
            await gamesRepository.deleteGame(nextItem.gameId);
            dequeueItem(nextItem.id);
            continue;
          }

          const snapshotGame = gamesRef.current.find((item) => item.id === nextItem.gameId);
          if (!snapshotGame) {
            dequeueItem(nextItem.id);
            continue;
          }

          const syncedGame = await gamesRepository.syncGame(snapshotGame);
          const latestLocalGame = gamesRef.current.find((item) => item.id === nextItem.gameId);
          dequeueItem(nextItem.id);

          if (!latestLocalGame) {
            continue;
          }

          if (latestLocalGame.updatedAt !== snapshotGame.updatedAt) {
            enqueueUpsert(latestLocalGame.id);
            continue;
          }

          replaceGame(syncedGame);
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
          return false;
        }
      }

      setErrorMessage(null);
      return true;
    })().finally(() => {
      flushPromiseRef.current = null;
    });

    return flushPromiseRef.current;
  }, [dequeueItem, enqueueUpsert, replaceGame]);

  const refreshGames = useCallback(async () => {
    const configError = getSupabaseConfigError();
    if (configError) {
      setErrorMessage(configError);
      setIsLoading(false);
      return;
    }

    setIsLoading(gamesRef.current.length === 0);
    await flushSyncQueue();

    try {
      const remoteGames = await gamesRepository.listGames();
      setGames(mergeRemoteWithPending(remoteGames, gamesRef.current, queueRef.current));
      if (!queueRef.current.length) {
        setErrorMessage(null);
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [flushSyncQueue]);

  useEffect(() => {
    void refreshGames();
  }, [refreshGames]);

  useEffect(() => {
    if (!syncQueue.length) {
      return;
    }

    void flushSyncQueue();
  }, [flushSyncQueue, syncQueue.length]);

  useEffect(() => {
    const handleOnline = () => {
      void flushSyncQueue().then(() => refreshGames());
    };

    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [flushSyncQueue, refreshGames]);

  const runMutation = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    setIsMutating(true);
    try {
      return await operation();
    } catch (error) {
      const message = getErrorMessage(error);
      setErrorMessage(message);
      throw error instanceof Error ? error : new Error(message);
    } finally {
      setIsMutating(false);
    }
  }, []);

  const createGame = useCallback(
    async (input: CreateGameInput): Promise<Game> =>
      runMutation(async () => {
        const createdGame = createLocalGame(input);
        rememberPlayerNames([input.playerOneName, input.playerTwoName]);
        replaceGame(createdGame);
        enqueueUpsert(createdGame.id);
        void flushSyncQueue();
        return createdGame;
      }),
    [enqueueUpsert, flushSyncQueue, replaceGame, runMutation]
  );

  const updateGameDetails = useCallback(
    async (gameId: string, input: CreateGameInput) =>
      runMutation(async () => {
        const nextGame = mutateGame(gameId, (game) => updateLocalGameDetails(game, input));
        rememberPlayerNames([input.playerOneName, input.playerTwoName]);
        enqueueUpsert(nextGame.id);
        void flushSyncQueue();
      }),
    [enqueueUpsert, flushSyncQueue, mutateGame, runMutation]
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
        const nextGame = mutateGame(gameId, (currentGame) =>
          appendLocalScoreEvent(currentGame, {
            playerId,
            scoreType,
            value,
            note,
            roundNumber: latestRound?.roundNumber,
            turnNumber: latestTurn?.turnNumber
          })
        );

        enqueueUpsert(nextGame.id);
        void flushSyncQueue();
      }),
    [enqueueUpsert, flushSyncQueue, getGame, mutateGame, runMutation]
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
        const nextGame = mutateGame(gameId, (currentGame) =>
          appendLocalCommandPointEvent(currentGame, {
            playerId,
            cpType,
            value,
            note,
            roundNumber: latestRound?.roundNumber,
            turnNumber: latestTurn?.turnNumber
          })
        );

        enqueueUpsert(nextGame.id);
        void flushSyncQueue();
      }),
    [enqueueUpsert, flushSyncQueue, getActiveActionPlayerId, getGame, mutateGame, runMutation]
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
        const nextGame = mutateGame(gameId, (currentGame) =>
          appendLocalNoteEvent(currentGame, {
            playerId,
            note: trimmedNote,
            roundNumber: latestRound?.roundNumber,
            turnNumber: latestTurn?.turnNumber
          })
        );

        enqueueUpsert(nextGame.id);
        void flushSyncQueue();
      }),
    [enqueueUpsert, flushSyncQueue, getGame, mutateGame, runMutation]
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
        const eventsToAdd: Array<{
          action: TimeEventAction;
          playerId?: PlayerId;
          roundNumber?: number;
          turnNumber?: number;
          createdAt?: string;
        }> = [];
        const otherPlayerId =
          game.players.find((player) => player.id !== game.currentPlayerId)?.id ?? game.currentPlayerId;

        if (!latestRound || latestRound.endedAt) {
          const nextRoundNumber = (latestRound?.roundNumber ?? 0) + 1;

          if (!game.timeEvents.some((event) => event.action === "game-start")) {
            eventsToAdd.push({
              playerId: game.startingPlayerId,
              action: "game-start",
              createdAt: now
            });
          }

          eventsToAdd.push(
            {
              playerId: game.startingPlayerId,
              roundNumber: nextRoundNumber,
              action: "round-start",
              createdAt: now
            },
            {
              playerId: game.startingPlayerId,
              roundNumber: nextRoundNumber,
              turnNumber: 1,
              action: "turn-start",
              createdAt: now
            }
          );
        } else if (!latestTurn || latestTurn.timing.endedAt) {
          if (latestRound.turns.length >= 2) {
            const nextRoundNumber = latestRound.roundNumber + 1;
            eventsToAdd.push(
              {
                playerId: latestRound.turns[latestRound.turns.length - 1]?.playerId ?? game.startingPlayerId,
                roundNumber: latestRound.roundNumber,
                action: "round-end",
                createdAt: now
              },
              {
                playerId: game.startingPlayerId,
                roundNumber: nextRoundNumber,
                action: "round-start",
                createdAt: now
              },
              {
                playerId: game.startingPlayerId,
                roundNumber: nextRoundNumber,
                turnNumber: 1,
                action: "turn-start",
                createdAt: now
              }
            );
          } else {
            const nextTurnNumber = latestRound.turns.length + 1;
            const previousPlayerId =
              latestTurn?.playerId ?? latestRound.turns[latestRound.turns.length - 1]?.playerId;
            const nextPlayerId =
              game.players.find((player) => player.id !== previousPlayerId)?.id ?? otherPlayerId;

            eventsToAdd.push({
              playerId: nextPlayerId,
              roundNumber: latestRound.roundNumber,
              turnNumber: nextTurnNumber,
              action: "turn-start",
              createdAt: now
            });
          }
        } else {
          eventsToAdd.push({
            playerId: latestTurn.playerId,
            roundNumber: latestTurn.roundNumber,
            turnNumber: latestTurn.turnNumber,
            action: "turn-end",
            createdAt: now
          });

          if (latestRound.turns.length >= 2) {
            const nextRoundNumber = latestRound.roundNumber + 1;
            eventsToAdd.push(
              {
                playerId: latestTurn.playerId,
                roundNumber: latestRound.roundNumber,
                action: "round-end",
                createdAt: now
              },
              {
                playerId: game.startingPlayerId,
                roundNumber: nextRoundNumber,
                action: "round-start",
                createdAt: now
              },
              {
                playerId: game.startingPlayerId,
                roundNumber: nextRoundNumber,
                turnNumber: 1,
                action: "turn-start",
                createdAt: now
              }
            );
          } else {
            eventsToAdd.push({
              playerId: otherPlayerId,
              roundNumber: latestRound.roundNumber,
              turnNumber: latestRound.turns.length + 1,
              action: "turn-start",
              createdAt: now
            });
          }
        }

        const nextGame = mutateGame(gameId, (currentGame) => appendLocalTimeEvents(currentGame, eventsToAdd));
        enqueueUpsert(nextGame.id);
        void flushSyncQueue();
      }),
    [enqueueUpsert, flushSyncQueue, getGame, mutateGame, runMutation]
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
          if (event.roundNumber === latestTurn.roundNumber && event.turnNumber === latestTurn.turnNumber) {
            eventIds.add(event.id);
          }

          if (event.action === "round-end" && event.roundNumber === latestRound.roundNumber) {
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

        const nextGame = mutateGame(gameId, (currentGame) =>
          Array.from(eventIds).reduce(
            (updatedGame, eventId) => removeLocalEvent(updatedGame, eventId),
            currentGame
          )
        );

        enqueueUpsert(nextGame.id);
        void flushSyncQueue();
      }),
    [enqueueUpsert, flushSyncQueue, getGame, mutateGame, runMutation]
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

        const nextGame = mutateGame(gameId, (currentGame) =>
          appendLocalTimeEvents(currentGame, [
            {
              playerId: latestTurn.playerId,
              roundNumber: latestTurn.roundNumber,
              turnNumber: latestTurn.turnNumber,
              action: "turn-pause"
            }
          ])
        );

        enqueueUpsert(nextGame.id);
        void flushSyncQueue();
      }),
    [enqueueUpsert, flushSyncQueue, getGame, mutateGame, runMutation]
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
        let nextGame: Game | null = null;

        if (!latestRound || latestRound.endedAt) {
          const nextRoundNumber = (latestRound?.roundNumber ?? 0) + 1;
          const eventsToAdd: Array<{
            action: TimeEventAction;
            playerId?: PlayerId;
            roundNumber?: number;
            turnNumber?: number;
          }> = [];

          if (!game.timeEvents.some((event) => event.action === "game-start")) {
            eventsToAdd.push({
              playerId: game.startingPlayerId,
              action: "game-start"
            });
          }

          eventsToAdd.push(
            {
              playerId: game.startingPlayerId,
              roundNumber: nextRoundNumber,
              action: "round-start"
            },
            {
              playerId: game.startingPlayerId,
              roundNumber: nextRoundNumber,
              turnNumber: 1,
              action: "turn-start"
            }
          );

          nextGame = mutateGame(gameId, (currentGame) => appendLocalTimeEvents(currentGame, eventsToAdd));
        } else if (!latestTurn) {
          nextGame = mutateGame(gameId, (currentGame) =>
            appendLocalTimeEvents(currentGame, [
              {
                playerId: game.currentPlayerId,
                roundNumber: latestRound.roundNumber,
                turnNumber: latestRound.turns.length + 1,
                action: "turn-start"
              }
            ])
          );
        } else if (isTurnPaused(latestTurn)) {
          nextGame = mutateGame(gameId, (currentGame) =>
            appendLocalTimeEvents(currentGame, [
              {
                playerId: latestTurn.playerId,
                roundNumber: latestTurn.roundNumber,
                turnNumber: latestTurn.turnNumber,
                action: "turn-resume"
              }
            ])
          );
        }

        if (nextGame) {
          enqueueUpsert(nextGame.id);
          void flushSyncQueue();
        }
      }),
    [enqueueUpsert, flushSyncQueue, getGame, mutateGame, runMutation]
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

        const nextGame = latestGameEndEvent
          ? mutateGame(gameId, (currentGame) => removeLocalEvent(currentGame, latestGameEndEvent.id))
          : game;

        enqueueUpsert(nextGame.id);
        void flushSyncQueue();
      }),
    [enqueueUpsert, flushSyncQueue, getGame, mutateGame, runMutation]
  );

  const updateGameEvent = useCallback(
    async (gameId: string, eventId: string, patch: UpdateSupabaseEventPayload) =>
      runMutation(async () => {
        const nextGame = mutateGame(gameId, (currentGame) =>
          updateLocalEvent(currentGame, eventId, patch)
        );
        enqueueUpsert(nextGame.id);
        void flushSyncQueue();
      }),
    [enqueueUpsert, flushSyncQueue, mutateGame, runMutation]
  );

  const deleteGameEvent = useCallback(
    async (gameId: string, eventId: string) =>
      runMutation(async () => {
        const nextGame = mutateGame(gameId, (currentGame) => removeLocalEvent(currentGame, eventId));
        enqueueUpsert(nextGame.id);
        void flushSyncQueue();
      }),
    [enqueueUpsert, flushSyncQueue, mutateGame, runMutation]
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
        const eventsToAdd: Array<{
          action: TimeEventAction;
          playerId?: PlayerId;
          roundNumber?: number;
          turnNumber?: number;
        }> = [];

        if (latestTurn && latestTurn.timing.startedAt && !latestTurn.timing.endedAt) {
          eventsToAdd.push({
            playerId: latestTurn.playerId,
            roundNumber: latestTurn.roundNumber,
            turnNumber: latestTurn.turnNumber,
            action: "turn-end"
          });
        }

        if (latestRound && latestRound.startedAt && !latestRound.endedAt) {
          eventsToAdd.push({
            playerId: game.currentPlayerId,
            roundNumber: latestRound.roundNumber,
            action: "round-end"
          });
        }

        eventsToAdd.push({
          playerId: game.currentPlayerId,
          action: "game-end"
        });

        const nextGame = mutateGame(gameId, (currentGame) => appendLocalTimeEvents(currentGame, eventsToAdd));
        enqueueUpsert(nextGame.id);
        void flushSyncQueue();
      }),
    [enqueueUpsert, flushSyncQueue, getGame, mutateGame, runMutation]
  );

  const deleteGame = useCallback(
    async (gameId: string) =>
      runMutation(async () => {
        removeGameLocally(gameId);
        enqueueDelete(gameId);
        void flushSyncQueue();
      }),
    [enqueueDelete, flushSyncQueue, removeGameLocally, runMutation]
  );

  const importGames = useCallback(
    async (importedGames: Game[]) =>
      runMutation(async () => {
        importedGames.forEach((game) => {
          const normalizedGame = mapPersistedGame(game);
          if (!normalizedGame) {
            return;
          }

          replaceGame(normalizedGame);
          rememberPlayerNames(game.players.map((player) => player.name));
          enqueueUpsert(normalizedGame.id);
        });

        void flushSyncQueue();
      }),
    [enqueueUpsert, flushSyncQueue, replaceGame, runMutation]
  );

  const exportGames = useCallback(() => gamesRef.current, []);
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
      refreshGames,
      reopenGame,
      rewindLastTurn,
      startGameTimer,
      updateGameDetails,
      updateGameEvent
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
