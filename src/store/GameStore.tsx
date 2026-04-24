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
import { getSupabaseClient, getSupabaseConfigError } from "../lib/supabase";
import {
  gamesRepository,
  getSyncedEventPayload,
  type UpdateSupabaseEventPayload
} from "../services/gamesRepository";
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
  overlayLocalGameMetadata,
  removeLocalEvent,
  syncDerivedGameState,
  updateLocalEvent,
  updateLocalGameDetails,
  upsertLocalEventFromSource
} from "../utils/gameState";
import {
  getLatestRound,
  getLatestTurn,
  getPlayerCommandPoints,
  getPlayerPrimaryTotal,
  getPlayerSecondaryTotal,
  isSessionRunning,
  isTurnPaused
} from "../utils/gameCalculations";
import {
  createEventSyncQueueItem,
  createGameSyncQueueItem,
  getSyncErrorMessage,
  loadCachedGames,
  loadSyncQueue,
  saveCachedGames,
  saveSyncQueue,
  type SyncQueueItem
} from "../utils/localSync";
import { syncRememberedPlayerNames } from "../utils/presets";
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

const getErrorMessage = (error: unknown): string => getSyncErrorMessage(error);
const clampNonNegative = (value: number): number => Math.max(value, 0);
const MAX_ROUNDS = 5;

const mergeRemoteWithPending = (
  remoteGames: Game[],
  localGames: Game[],
  queue: SyncQueueItem[]
): Game[] => {
  const remoteById = new Map(remoteGames.map((game) => [game.id, game]));
  const localById = new Map(localGames.map((game) => [game.id, game]));
  const mergedById = new Map(remoteById);

  queue.forEach((queueItem) => {
    if (queueItem.type === "delete-game") {
      mergedById.delete(queueItem.gameId);
      return;
    }

    const localGame = localById.get(queueItem.gameId);
    if (!localGame) {
      return;
    }

    const baseGame = mergedById.get(queueItem.gameId) ?? localGame;
    if (queueItem.type === "upsert-game") {
      mergedById.set(queueItem.gameId, overlayLocalGameMetadata(baseGame, localGame));
      return;
    }

    if (queueItem.type === "upsert-event") {
      mergedById.set(queueItem.gameId, upsertLocalEventFromSource(baseGame, localGame, queueItem.eventId));
      return;
    }

    mergedById.set(queueItem.gameId, removeLocalEvent(baseGame, queueItem.eventId));
  });

  return sortGames(Array.from(mergedById.values()));
};

export const GameStoreProvider = ({ children }: PropsWithChildren) => {
  const [games, setGames] = useState<Game[]>(() => sortGames(loadCachedGames()));
  const [syncQueue, setSyncQueue] = useState<SyncQueueItem[]>(loadSyncQueue);
  const [isLoading, setIsLoading] = useState(games.length === 0);
  const [isMutating, setIsMutating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const gamesRef = useRef(games);
  const queueRef = useRef(syncQueue);
  const flushPromiseRef = useRef<Promise<boolean> | null>(null);
  const refreshTimerRef = useRef<number | null>(null);

  useEffect(() => {
    gamesRef.current = games;
    saveCachedGames(games);
    syncRememberedPlayerNames(games);
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

  const enqueueGameUpsert = useCallback((gameId: string) => {
    setSyncQueue((currentQueue) => {
      const filteredQueue = currentQueue.filter(
        (item) => !(item.type === "delete-game" && item.gameId === gameId)
      );

      if (filteredQueue.some((item) => item.type === "upsert-game" && item.gameId === gameId)) {
        return filteredQueue;
      }

      return [...filteredQueue, createGameSyncQueueItem("upsert-game", gameId, getNowIso())];
    });
  }, []);

  const enqueueGameDelete = useCallback((gameId: string) => {
    setSyncQueue((currentQueue) => [
      ...currentQueue.filter((item) => item.gameId !== gameId),
      createGameSyncQueueItem("delete-game", gameId, getNowIso())
    ]);
  }, []);

  const enqueueEventUpsert = useCallback((gameId: string, eventId: string) => {
    setSyncQueue((currentQueue) => {
      const filteredQueue = currentQueue.filter(
        (item) =>
          !(
            item.gameId === gameId &&
            item.type === "delete-event" &&
            item.eventId === eventId
          )
      );

      if (
        filteredQueue.some(
          (item) =>
            item.gameId === gameId &&
            item.type === "upsert-event" &&
            item.eventId === eventId
        )
      ) {
        return filteredQueue;
      }

      return [...filteredQueue, createEventSyncQueueItem("upsert-event", gameId, eventId, getNowIso())];
    });
  }, []);

  const enqueueEventDelete = useCallback((gameId: string, eventId: string) => {
    setSyncQueue((currentQueue) => {
      const filteredQueue = currentQueue.filter(
        (item) =>
          !(
            item.gameId === gameId &&
            item.type === "upsert-event" &&
            item.eventId === eventId
          )
      );

      if (
        filteredQueue.some(
          (item) =>
            item.gameId === gameId &&
            item.type === "delete-event" &&
            item.eventId === eventId
        )
      ) {
        return filteredQueue;
      }

      return [...filteredQueue, createEventSyncQueueItem("delete-event", gameId, eventId, getNowIso())];
    });
  }, []);

  const removeQueueItem = useCallback((queueItemId: string) => {
    setSyncQueue((currentQueue) => currentQueue.filter((item) => item.id !== queueItemId));
  }, []);

  const getActiveActionPlayerId = useCallback((game: Game): PlayerId => {
    const latestTurn = getLatestTurn(game);
    if (latestTurn?.timing.startedAt && !latestTurn.timing.endedAt) {
      return latestTurn.playerId;
    }

    return game.currentPlayerId;
  }, []);

  const normalizeEventPatch = useCallback(
    (game: Game, eventId: string, patch: UpdateSupabaseEventPayload): UpdateSupabaseEventPayload => {
      const scoreEvent = game.scoreEvents.find((event) => event.id === eventId);
      if (scoreEvent) {
        const currentTotal =
          scoreEvent.scoreType === "primary"
            ? getPlayerPrimaryTotal(game, scoreEvent.playerId)
            : getPlayerSecondaryTotal(game, scoreEvent.playerId);
        const safeAmount = typeof patch.value_number === "number" && Number.isFinite(patch.value_number)
          ? clampNonNegative(Math.abs(patch.value_number))
          : Math.abs(scoreEvent.value);

        if (scoreEvent.value < 0) {
          const maxAmount = clampNonNegative(currentTotal - scoreEvent.value);
          return {
            ...patch,
            value_number: -Math.min(safeAmount, maxAmount)
          };
        }

        return {
          ...patch,
          value_number: safeAmount
        };
      }

      const commandPointEvent = game.commandPointEvents.find((event) => event.id === eventId);
      if (commandPointEvent) {
        const safeAmount =
          typeof patch.value_number === "number" && Number.isFinite(patch.value_number)
            ? clampNonNegative(Math.abs(patch.value_number))
          : commandPointEvent.value;

        if (commandPointEvent.cpType === "spent") {
          const currentBalance = getPlayerCommandPoints(game, commandPointEvent.playerId);
          const maxAmount = clampNonNegative(currentBalance + commandPointEvent.value);
          return {
            ...patch,
            value_number: Math.min(safeAmount, maxAmount)
          };
        }

        return {
          ...patch,
          value_number: safeAmount
        };
      }

      return patch;
    },
    []
  );

  const pullRemoteGames = useCallback(async () => {
    const configError = getSupabaseConfigError();
    if (configError) {
      setErrorMessage(configError);
      return false;
    }

    try {
      const remoteGames = await gamesRepository.listGames();
      setGames(mergeRemoteWithPending(remoteGames, gamesRef.current, queueRef.current));
      if (!queueRef.current.length) {
        setErrorMessage(null);
      }
      return true;
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
      return false;
    }
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
            removeQueueItem(nextItem.id);
            continue;
          }

          const currentGame = gamesRef.current.find((game) => game.id === nextItem.gameId);
          if (!currentGame) {
            removeQueueItem(nextItem.id);
            continue;
          }

          if (nextItem.type === "upsert-game") {
            await gamesRepository.upsertGameSnapshot(currentGame);
            removeQueueItem(nextItem.id);
            continue;
          }

          if (nextItem.type === "delete-event") {
            await gamesRepository.deleteEvent(nextItem.eventId);
            removeQueueItem(nextItem.id);
            continue;
          }

          const eventPayload = getSyncedEventPayload(currentGame, nextItem.eventId);
          if (!eventPayload) {
            removeQueueItem(nextItem.id);
            continue;
          }

          await gamesRepository.upsertEvent(eventPayload);
          removeQueueItem(nextItem.id);
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
          return false;
        }
      }

      await pullRemoteGames();
      return true;
    })().finally(() => {
      flushPromiseRef.current = null;
    });

    return flushPromiseRef.current;
  }, [pullRemoteGames, removeQueueItem]);

  const refreshGames = useCallback(async () => {
    const configError = getSupabaseConfigError();
    if (configError) {
      setErrorMessage(configError);
      setIsLoading(false);
      return;
    }

    setIsLoading(gamesRef.current.length === 0);
    if (queueRef.current.length) {
      await flushSyncQueue();
    } else {
      await pullRemoteGames();
    }
    setIsLoading(false);
  }, [flushSyncQueue, pullRemoteGames]);

  const scheduleRemoteRefresh = useCallback(() => {
    if (refreshTimerRef.current) {
      window.clearTimeout(refreshTimerRef.current);
    }

    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void refreshGames();
    }, 600);
  }, [refreshGames]);

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
      void refreshGames();
    };

    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [refreshGames]);

  useEffect(() => {
    const configError = getSupabaseConfigError();
    if (configError) {
      return;
    }

    const supabase = getSupabaseClient();
    const channel = supabase
      .channel("match-tracker-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "games" },
        () => scheduleRemoteRefresh()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "events" },
        () => scheduleRemoteRefresh()
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [scheduleRemoteRefresh]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshGames();
    }, 15000);

    return () => window.clearInterval(interval);
  }, [refreshGames]);

  useEffect(
    () => () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
      }
    },
    []
  );

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
        replaceGame(createdGame);
        enqueueGameUpsert(createdGame.id);
        void flushSyncQueue();
        return createdGame;
      }),
    [enqueueGameUpsert, flushSyncQueue, replaceGame, runMutation]
  );

  const updateGameDetails = useCallback(
    async (gameId: string, input: CreateGameInput) =>
      runMutation(async () => {
        const nextGame = mutateGame(gameId, (game) => updateLocalGameDetails(game, input));
        enqueueGameUpsert(nextGame.id);
        void flushSyncQueue();
      }),
    [enqueueGameUpsert, flushSyncQueue, mutateGame, runMutation]
  );

  const addScoreEvent = useCallback(
    async ({ gameId, playerId, value = 0, note, scoreType }: EventPayload & { scoreType: ScoreType }) =>
      runMutation(async () => {
        const game = getGame(gameId);
        if (!game) {
          throw new Error("Spiel nicht gefunden.");
        }

        const currentTotal =
          scoreType === "primary"
            ? getPlayerPrimaryTotal(game, playerId)
            : getPlayerSecondaryTotal(game, playerId);
        const safeValue =
          value < 0 ? -Math.min(Math.abs(value), currentTotal) : clampNonNegative(value);
        if (safeValue === 0) {
          return;
        }

        const latestRound = getLatestRound(game);
        const latestTurn = getLatestTurn(game);
        const nextGame = mutateGame(gameId, (currentGame) =>
          appendLocalScoreEvent(currentGame, {
            playerId,
            scoreType,
            value: safeValue,
            note,
            roundNumber: latestRound?.roundNumber,
            turnNumber: latestTurn?.turnNumber
          })
        );

        const newEventId = nextGame.scoreEvents[nextGame.scoreEvents.length - 1]?.id;
        if (newEventId) {
          enqueueEventUpsert(nextGame.id, newEventId);
        }
        void flushSyncQueue();
      }),
    [enqueueEventUpsert, flushSyncQueue, getGame, mutateGame, runMutation]
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

        const safeValue =
          cpType === "spent"
            ? Math.min(clampNonNegative(value), getPlayerCommandPoints(game, playerId))
            : clampNonNegative(value);
        if (safeValue === 0) {
          return;
        }

        const latestRound = getLatestRound(game);
        const latestTurn = getLatestTurn(game);
        const nextGame = mutateGame(gameId, (currentGame) =>
          appendLocalCommandPointEvent(currentGame, {
            playerId,
            cpType,
            value: safeValue,
            note,
            roundNumber: latestRound?.roundNumber,
            turnNumber: latestTurn?.turnNumber
          })
        );

        const newEventId =
          nextGame.commandPointEvents[nextGame.commandPointEvents.length - 1]?.id;
        if (newEventId) {
          enqueueEventUpsert(nextGame.id, newEventId);
        }
        void flushSyncQueue();
      }),
    [enqueueEventUpsert, flushSyncQueue, getActiveActionPlayerId, getGame, mutateGame, runMutation]
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

        const newEventId = nextGame.noteEvents[nextGame.noteEvents.length - 1]?.id;
        if (newEventId) {
          enqueueEventUpsert(nextGame.id, newEventId);
        }
        void flushSyncQueue();
      }),
    [enqueueEventUpsert, flushSyncQueue, getGame, mutateGame, runMutation]
  );

  const enqueueTimeEvents = useCallback(
    (game: Game, timeEvents: Array<{ action: TimeEventAction; playerId?: PlayerId; roundNumber?: number; turnNumber?: number; createdAt?: string }>) => {
      const nextGame = replaceGame(appendLocalTimeEvents(game, timeEvents));
      enqueueGameUpsert(nextGame.id);
      nextGame.timeEvents
        .filter((event) => timeEvents.some((timeEvent) => timeEvent.createdAt ? event.createdAt === timeEvent.createdAt : true))
        .slice(-timeEvents.length)
        .forEach((event) => enqueueEventUpsert(nextGame.id, event.id));
      return nextGame;
    },
    [enqueueEventUpsert, enqueueGameUpsert, replaceGame]
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
        const closeGameFromRound = (
          playerId: PlayerId,
          roundNumber: number,
          turnNumber?: number,
          includeTurnEnd = false
        ) => {
          if (includeTurnEnd && turnNumber) {
            eventsToAdd.push({
              playerId,
              roundNumber,
              turnNumber,
              action: "turn-end",
              createdAt: now
            });
          }

          if (!latestRound?.endedAt) {
            eventsToAdd.push({
              playerId,
              roundNumber,
              action: "round-end",
              createdAt: now
            });
          }

          if (isSessionRunning(game)) {
            eventsToAdd.push({
              action: "session-end",
              createdAt: now
            });
          }

          eventsToAdd.push({
            playerId,
            action: "game-end",
            createdAt: now
          });
        };

        if (!latestRound || latestRound.endedAt) {
          const nextRoundNumber = (latestRound?.roundNumber ?? 0) + 1;

          if (latestRound && latestRound.roundNumber >= MAX_ROUNDS) {
            const closingPlayerId =
              latestRound.turns[latestRound.turns.length - 1]?.playerId ?? game.currentPlayerId;

            closeGameFromRound(closingPlayerId, latestRound.roundNumber);
            enqueueTimeEvents(game, eventsToAdd);
            void flushSyncQueue();
            return;
          }

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
            if (latestRound.roundNumber >= MAX_ROUNDS) {
              const closingPlayerId =
                latestTurn?.playerId ??
                latestRound.turns[latestRound.turns.length - 1]?.playerId ??
                game.currentPlayerId;

              closeGameFromRound(closingPlayerId, latestRound.roundNumber);
              enqueueTimeEvents(game, eventsToAdd);
              void flushSyncQueue();
              return;
            }

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
          if (latestRound.turns.length >= 2) {
            if (latestRound.roundNumber >= MAX_ROUNDS) {
              closeGameFromRound(
                latestTurn.playerId,
                latestRound.roundNumber,
                latestTurn.turnNumber,
                true
              );
            } else {
              const nextRoundNumber = latestRound.roundNumber + 1;
              eventsToAdd.push(
                {
                  playerId: latestTurn.playerId,
                  roundNumber: latestTurn.roundNumber,
                  turnNumber: latestTurn.turnNumber,
                  action: "turn-end",
                  createdAt: now
                },
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
            }
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

        enqueueTimeEvents(game, eventsToAdd);
        void flushSyncQueue();
      }),
    [enqueueTimeEvents, flushSyncQueue, getGame, runMutation]
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

        enqueueGameUpsert(nextGame.id);
        Array.from(eventIds).forEach((eventId) => enqueueEventDelete(nextGame.id, eventId));
        void flushSyncQueue();
      }),
    [enqueueEventDelete, enqueueGameUpsert, flushSyncQueue, getGame, mutateGame, runMutation]
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

        enqueueTimeEvents(game, [
          {
            playerId: latestTurn.playerId,
            roundNumber: latestTurn.roundNumber,
            turnNumber: latestTurn.turnNumber,
            action: "turn-pause"
          }
        ]);
        void flushSyncQueue();
      }),
    [enqueueTimeEvents, flushSyncQueue, getGame, runMutation]
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
        let eventsToAdd: Array<{
          action: TimeEventAction;
          playerId?: PlayerId;
          roundNumber?: number;
          turnNumber?: number;
        }> = [];

        if (!latestRound || latestRound.endedAt) {
          const nextRoundNumber = (latestRound?.roundNumber ?? 0) + 1;

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
        } else if (!latestTurn) {
          eventsToAdd = [
            {
              playerId: game.currentPlayerId,
              roundNumber: latestRound.roundNumber,
              turnNumber: latestRound.turns.length + 1,
              action: "turn-start"
            }
          ];
        } else if (isTurnPaused(latestTurn)) {
          eventsToAdd = [
            {
              playerId: latestTurn.playerId,
              roundNumber: latestTurn.roundNumber,
              turnNumber: latestTurn.turnNumber,
              action: "turn-resume"
            }
          ];
        }

        if (eventsToAdd.length) {
          enqueueTimeEvents(game, eventsToAdd);
          void flushSyncQueue();
        }
      }),
    [enqueueTimeEvents, flushSyncQueue, getGame, runMutation]
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

        if (!latestGameEndEvent) {
          return;
        }

        const restartSession = window.confirm(
          "Gesamtspielzeit beim Wiedereroeffnen wieder starten?"
        );

        let nextGame = mutateGame(gameId, (currentGame) =>
          removeLocalEvent(currentGame, latestGameEndEvent.id)
        );
        enqueueEventDelete(nextGame.id, latestGameEndEvent.id);

        if (restartSession && !isSessionRunning(nextGame)) {
          nextGame = enqueueTimeEvents(nextGame, [{ action: "session-start" }]);
        } else {
          enqueueGameUpsert(nextGame.id);
        }
        void flushSyncQueue();
      }),
    [
      enqueueEventDelete,
      enqueueGameUpsert,
      enqueueTimeEvents,
      flushSyncQueue,
      getGame,
      mutateGame,
      runMutation
    ]
  );

  const updateGameEvent = useCallback(
    async (gameId: string, eventId: string, patch: UpdateSupabaseEventPayload) =>
      runMutation(async () => {
        const currentGame = getGame(gameId);
        if (!currentGame) {
          throw new Error("Spiel nicht gefunden.");
        }

        const normalizedPatch = normalizeEventPatch(currentGame, eventId, patch);
        const nextGame = mutateGame(gameId, (mutableGame) =>
          updateLocalEvent(mutableGame, eventId, normalizedPatch)
        );
        enqueueGameUpsert(nextGame.id);
        enqueueEventUpsert(nextGame.id, eventId);
        void flushSyncQueue();
      }),
    [
      enqueueEventUpsert,
      enqueueGameUpsert,
      flushSyncQueue,
      getGame,
      mutateGame,
      normalizeEventPatch,
      runMutation
    ]
  );

  const deleteGameEvent = useCallback(
    async (gameId: string, eventId: string) =>
      runMutation(async () => {
        const nextGame = mutateGame(gameId, (currentGame) => removeLocalEvent(currentGame, eventId));
        enqueueGameUpsert(nextGame.id);
        enqueueEventDelete(nextGame.id, eventId);
        void flushSyncQueue();
      }),
    [enqueueEventDelete, enqueueGameUpsert, flushSyncQueue, mutateGame, runMutation]
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

        if (isSessionRunning(game)) {
          eventsToAdd.push({
            action: "session-end"
          });
        }

        eventsToAdd.push({
          playerId: game.currentPlayerId,
          action: "game-end"
        });

        enqueueTimeEvents(game, eventsToAdd);
        void flushSyncQueue();
      }),
    [enqueueTimeEvents, flushSyncQueue, getGame, runMutation]
  );

  const deleteGame = useCallback(
    async (gameId: string) =>
      runMutation(async () => {
        removeGameLocally(gameId);
        enqueueGameDelete(gameId);
        void flushSyncQueue();
      }),
    [enqueueGameDelete, flushSyncQueue, removeGameLocally, runMutation]
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
          enqueueGameUpsert(normalizedGame.id);
          normalizedGame.timeEvents.forEach((event) => enqueueEventUpsert(normalizedGame.id, event.id));
          normalizedGame.commandPointEvents.forEach((event) => enqueueEventUpsert(normalizedGame.id, event.id));
          normalizedGame.scoreEvents.forEach((event) => enqueueEventUpsert(normalizedGame.id, event.id));
          normalizedGame.noteEvents.forEach((event) => enqueueEventUpsert(normalizedGame.id, event.id));
        });

        void flushSyncQueue();
      }),
    [enqueueEventUpsert, enqueueGameUpsert, flushSyncQueue, replaceGame, runMutation]
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
