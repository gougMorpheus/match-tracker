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
  TimeEventAction,
  TurnRef
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
  getTurnBaseDurationMs,
  isSessionRunning,
  isTimeoutActive,
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
import { createId } from "../utils/id";
import { getNowIso } from "../utils/time";

interface EventPayload {
  gameId: string;
  playerId: PlayerId;
  value?: number;
  note?: string;
  roundNumber?: number;
  turnNumber?: number;
}

interface TimerCorrectionInput {
  gameId: string;
  turnRef: TurnRef;
  totalMs: number;
  roundMs: number;
  turnMs: number;
}

interface GameHistoryEntry {
  id: string;
  gameId: string;
  label: string;
  beforeGame: Game;
  afterGame: Game;
  createdAt: string;
}

interface GameHistoryStacks {
  undo: GameHistoryEntry[];
  redo: GameHistoryEntry[];
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
  setTimerCorrections: (input: TimerCorrectionInput) => Promise<void>;
  resetAllGameTimers: (gameId: string) => Promise<void>;
  addScoreEvent: (payload: EventPayload & { scoreType: ScoreType }) => Promise<void>;
  addCommandPointEvent: (payload: EventPayload & { cpType: CommandPointType }) => Promise<void>;
  addNoteEvent: (payload: EventPayload) => Promise<void>;
  advanceGame: (gameId: string, turnRef?: TurnRef, keepTimerRunning?: boolean) => Promise<void>;
  rewindLastTurn: (gameId: string, turnRef?: TurnRef, keepTimerRunning?: boolean) => Promise<void>;
  pauseActiveTimer: (gameId: string, turnRef?: TurnRef) => Promise<void>;
  startGameTimer: (gameId: string, turnRef?: TurnRef) => Promise<void>;
  startTimeout: (gameId: string, turnRef?: TurnRef) => Promise<void>;
  endTimeout: (gameId: string, turnRef?: TurnRef) => Promise<void>;
  reopenGame: (gameId: string) => Promise<void>;
  updateGameEvent: (gameId: string, eventId: string, patch: UpdateSupabaseEventPayload) => Promise<void>;
  deleteGameEvent: (gameId: string, eventId: string) => Promise<void>;
  undoGameAction: (gameId: string) => Promise<void>;
  redoGameAction: (gameId: string) => Promise<void>;
  getUndoActionLabel: (gameId: string) => string | null;
  getRedoActionLabel: (gameId: string) => string | null;
  finishGame: (gameId: string) => Promise<void>;
  deleteGame: (gameId: string) => Promise<void>;
  importGames: (games: Game[]) => Promise<void>;
  exportGames: () => Game[];
  clearError: () => void;
}

const GameStoreContext = createContext<GameStoreValue | null>(null);

const getScheduledSortKey = (game: Game): string =>
  `${game.scheduledDate || "0000-00-00"}T${game.scheduledTime || "00:00"}`;

const sortGames = (games: Game[]): Game[] =>
  [...games].sort((left, right) => {
    const scheduledComparison = getScheduledSortKey(right).localeCompare(getScheduledSortKey(left));
    if (scheduledComparison !== 0) {
      return scheduledComparison;
    }

    return right.createdAt.localeCompare(left.createdAt);
  });

const getErrorMessage = (error: unknown): string => getSyncErrorMessage(error);
const clampNonNegative = (value: number): number => Math.max(value, 0);
const MAX_ROUNDS = 5;
const HISTORY_LIMIT = 50;

const getTurnKey = (turnRef?: TurnRef | null): string | null =>
  turnRef ? `${turnRef.roundNumber}:${turnRef.turnNumber}` : null;

const getAllEventIds = (game: Game): Set<string> =>
  new Set([
    ...game.timeEvents.map((event) => event.id),
    ...game.commandPointEvents.map((event) => event.id),
    ...game.scoreEvents.map((event) => event.id),
    ...game.noteEvents.map((event) => event.id)
  ]);

const getPlayerName = (game: Game, playerId: PlayerId): string =>
  game.players.find((player) => player.id === playerId)?.name ?? "-";

const getScoreTypeLabel = (scoreType: ScoreType): string =>
  scoreType === "primary" ? "Prim" : scoreType === "secondary" ? "Sek" : "Ges";

const getEventActionLabel = (game: Game, eventId: string): string => {
  const scoreEvent = game.scoreEvents.find((event) => event.id === eventId);
  if (scoreEvent) {
    const sign = scoreEvent.value < 0 ? "-" : "+";
    return `${getPlayerName(game, scoreEvent.playerId)} ${sign}${Math.abs(scoreEvent.value)} ${getScoreTypeLabel(scoreEvent.scoreType)}`;
  }

  const commandPointEvent = game.commandPointEvents.find((event) => event.id === eventId);
  if (commandPointEvent) {
    const sign = commandPointEvent.cpType === "spent" ? "-" : "+";
    return `${getPlayerName(game, commandPointEvent.playerId)} ${sign}${commandPointEvent.value} CP`;
  }

  const noteEvent = game.noteEvents.find((event) => event.id === eventId);
  if (noteEvent) {
    return `${getPlayerName(game, noteEvent.playerId)} Notiz`;
  }

  return "Eintrag";
};

const getLatestAddedEventId = (beforeGame: Game, afterGame: Game): string | null => {
  const beforeIds = getAllEventIds(beforeGame);
  return [
    ...afterGame.timeEvents,
    ...afterGame.commandPointEvents,
    ...afterGame.scoreEvents,
    ...afterGame.noteEvents
  ]
    .filter((event) => !beforeIds.has(event.id))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]?.id ?? null;
};

const getTimeHistoryLabel = (baseLabel: string, game: Game): string => {
  if (baseLabel !== "Weiter") {
    return baseLabel;
  }

  if (game.status === "completed") {
    return "Spiel beenden";
  }

  const latestTurn = getLatestTurn(game);
  return latestTurn ? `Weiter R${latestTurn.roundNumber} Z${latestTurn.turnNumber}` : "Weiter";
};

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
  const [historyStacksByGameId, setHistoryStacksByGameId] = useState<Record<string, GameHistoryStacks>>({});
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

  const getTurnByRef = useCallback((game: Game, turnRef?: TurnRef) => {
    if (!turnRef) {
      return getLatestTurn(game);
    }

    return game.rounds
      .flatMap((round) => round.turns)
      .find(
        (turn) =>
          turn.roundNumber === turnRef.roundNumber && turn.turnNumber === turnRef.turnNumber
      );
  }, []);

  const getPreviousTurnByRef = useCallback((game: Game, turnRef?: TurnRef) => {
    const turns = game.rounds.flatMap((round) => round.turns);
    const currentKey = getTurnKey(turnRef);
    const currentIndex = currentKey
      ? turns.findIndex((turn) => getTurnKey(turn) === currentKey)
      : turns.length - 1;

    if (currentIndex <= 0) {
      return null;
    }

    return turns[currentIndex - 1] ?? null;
  }, []);

  const getNextTurnByRef = useCallback((game: Game, turnRef?: TurnRef) => {
    const turns = game.rounds.flatMap((round) => round.turns);
    const currentKey = getTurnKey(turnRef);
    const currentIndex = currentKey
      ? turns.findIndex((turn) => getTurnKey(turn) === currentKey)
      : turns.length - 1;

    if (currentIndex < 0 || currentIndex >= turns.length - 1) {
      return null;
    }

    return turns[currentIndex + 1] ?? null;
  }, []);

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

  const enqueueSnapshotSync = useCallback(
    (beforeGame: Game | null, afterGame: Game) => {
      enqueueGameUpsert(afterGame.id);

      const beforeEventIds = beforeGame ? getAllEventIds(beforeGame) : new Set<string>();
      const afterEventIds = getAllEventIds(afterGame);

      beforeEventIds.forEach((eventId) => {
        if (!afterEventIds.has(eventId)) {
          enqueueEventDelete(afterGame.id, eventId);
        }
      });

      [
        ...afterGame.timeEvents,
        ...afterGame.commandPointEvents,
        ...afterGame.scoreEvents,
        ...afterGame.noteEvents
      ].forEach((event) => enqueueEventUpsert(afterGame.id, event.id));
    },
    [enqueueEventDelete, enqueueEventUpsert, enqueueGameUpsert]
  );

  const recordHistoryAction = useCallback((label: string, beforeGame: Game, afterGame: Game) => {
    setHistoryStacksByGameId((currentStacks) => {
      const currentStack = currentStacks[afterGame.id] ?? { undo: [], redo: [] };
      const nextEntry: GameHistoryEntry = {
        id: createId("history"),
        gameId: afterGame.id,
        label,
        beforeGame,
        afterGame,
        createdAt: getNowIso()
      };

      return {
        ...currentStacks,
        [afterGame.id]: {
          undo: [...currentStack.undo, nextEntry].slice(-HISTORY_LIMIT),
          redo: []
        }
      };
    });
  }, []);

  const commitGameSnapshot = useCallback(
    (
      label: string,
      beforeGame: Game,
      afterGame: Game,
      options: { recordHistory?: boolean } = {}
    ): Game => {
      const nextGame = replaceGame(afterGame);
      enqueueSnapshotSync(beforeGame, nextGame);
      if (options.recordHistory !== false) {
        recordHistoryAction(label, beforeGame, nextGame);
      }
      return nextGame;
    },
    [enqueueSnapshotSync, recordHistoryAction, replaceGame]
  );

  const removeQueueItem = useCallback((queueItemId: string) => {
    setSyncQueue((currentQueue) => currentQueue.filter((item) => item.id !== queueItemId));
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

  const getUndoActionLabel = useCallback(
    (gameId: string) => {
      const undoStack = historyStacksByGameId[gameId]?.undo;
      return undoStack?.[undoStack.length - 1]?.label ?? null;
    },
    [historyStacksByGameId]
  );

  const getRedoActionLabel = useCallback(
    (gameId: string) => {
      const redoStack = historyStacksByGameId[gameId]?.redo;
      return redoStack?.[redoStack.length - 1]?.label ?? null;
    },
    [historyStacksByGameId]
  );

  const undoGameAction = useCallback(
    async (gameId: string) =>
      runMutation(async () => {
        const undoStack = historyStacksByGameId[gameId]?.undo;
        const entry = undoStack?.[undoStack.length - 1];
        if (!entry) {
          return;
        }

        const currentGame = getGame(gameId);
        replaceGame(entry.beforeGame);
        enqueueSnapshotSync(currentGame ?? entry.afterGame, entry.beforeGame);
        setHistoryStacksByGameId((currentStacks) => {
          const currentStack = currentStacks[gameId] ?? { undo: [], redo: [] };
          return {
            ...currentStacks,
            [gameId]: {
              undo: currentStack.undo.slice(0, -1),
              redo: [...currentStack.redo, entry].slice(-HISTORY_LIMIT)
            }
          };
        });
        void flushSyncQueue();
      }),
    [enqueueSnapshotSync, flushSyncQueue, getGame, historyStacksByGameId, replaceGame, runMutation]
  );

  const redoGameAction = useCallback(
    async (gameId: string) =>
      runMutation(async () => {
        const redoStack = historyStacksByGameId[gameId]?.redo;
        const entry = redoStack?.[redoStack.length - 1];
        if (!entry) {
          return;
        }

        const currentGame = getGame(gameId);
        replaceGame(entry.afterGame);
        enqueueSnapshotSync(currentGame ?? entry.beforeGame, entry.afterGame);
        setHistoryStacksByGameId((currentStacks) => {
          const currentStack = currentStacks[gameId] ?? { undo: [], redo: [] };
          return {
            ...currentStacks,
            [gameId]: {
              undo: [...currentStack.undo, entry].slice(-HISTORY_LIMIT),
              redo: currentStack.redo.slice(0, -1)
            }
          };
        });
        void flushSyncQueue();
      }),
    [enqueueSnapshotSync, flushSyncQueue, getGame, historyStacksByGameId, replaceGame, runMutation]
  );

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
        const game = getGame(gameId);
        if (!game) {
          throw new Error("Spiel nicht gefunden.");
        }

        commitGameSnapshot("Spieldetails", game, updateLocalGameDetails(game, input));
        void flushSyncQueue();
      }),
    [commitGameSnapshot, flushSyncQueue, getGame, runMutation]
  );

  const setTimerCorrections = useCallback(
    async ({ gameId, turnRef, totalMs, roundMs, turnMs }: TimerCorrectionInput) =>
      runMutation(async () => {
        const game = getGame(gameId);
        if (!game) {
          throw new Error("Spiel nicht gefunden.");
        }

        const nextGame = {
          ...game,
          timerCorrections: (() => {
          const nextTurns = { ...game.timerCorrections.turns };
          const nextRounds = { ...game.timerCorrections.rounds };
          const turnKey = `${turnRef.roundNumber}:${turnRef.turnNumber}`;
          const roundKey = String(turnRef.roundNumber);

          if (turnMs) {
            nextTurns[turnKey] = turnMs;
          } else {
            delete nextTurns[turnKey];
          }

          if (roundMs) {
            nextRounds[roundKey] = roundMs;
          } else {
            delete nextRounds[roundKey];
          }

            return {
              totalMs,
              rounds: nextRounds,
              turns: nextTurns
            };
          })()
        };

        commitGameSnapshot("Timer korrigiert", game, nextGame);
        void flushSyncQueue();
      }),
    [commitGameSnapshot, flushSyncQueue, getGame, runMutation]
  );

  const resetAllGameTimers = useCallback(
    async (gameId: string) =>
      runMutation(async () => {
        const game = getGame(gameId);
        if (!game) {
          throw new Error("Spiel nicht gefunden.");
        }

        const nextGame = {
          ...game,
          timerCorrections: {
            totalMs: 0,
            rounds: {},
            turns: Object.fromEntries(
              game.rounds
                .flatMap((round) => round.turns)
                .map((turn) => [
                  `${turn.roundNumber}:${turn.turnNumber}`,
                  -getTurnBaseDurationMs(turn)
                ])
                .filter(([, correction]) => correction !== 0)
            )
          }
        };

        commitGameSnapshot("Timer zurueckgesetzt", game, nextGame);
        void flushSyncQueue();
      }),
    [commitGameSnapshot, flushSyncQueue, getGame, runMutation]
  );

  const addScoreEvent = useCallback(
    async ({
      gameId,
      playerId,
      value = 0,
      note,
      roundNumber,
      turnNumber,
      scoreType
    }: EventPayload & { scoreType: ScoreType }) =>
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
        const nextGame = appendLocalScoreEvent(game, {
          playerId,
          scoreType,
          value: safeValue,
          note,
          roundNumber: roundNumber ?? latestRound?.roundNumber,
          turnNumber: turnNumber ?? latestTurn?.turnNumber
        });
        const newEventId = getLatestAddedEventId(game, nextGame);
        commitGameSnapshot(newEventId ? getEventActionLabel(nextGame, newEventId) : "Siegpunkte", game, nextGame);
        void flushSyncQueue();
      }),
    [commitGameSnapshot, flushSyncQueue, getGame, runMutation]
  );

  const addCommandPointEvent = useCallback(
    async ({
      gameId,
      playerId,
      value = 0,
      note,
      roundNumber,
      turnNumber,
      cpType
    }: EventPayload & { cpType: CommandPointType }) =>
      runMutation(async () => {
        const game = getGame(gameId);
        if (!game) {
          throw new Error("Spiel nicht gefunden.");
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
        const nextGame = appendLocalCommandPointEvent(game, {
          playerId,
          cpType,
          value: safeValue,
          note,
          roundNumber: roundNumber ?? latestRound?.roundNumber,
          turnNumber: turnNumber ?? latestTurn?.turnNumber
        });
        const newEventId = getLatestAddedEventId(game, nextGame);
        commitGameSnapshot(newEventId ? getEventActionLabel(nextGame, newEventId) : "Command Points", game, nextGame);
        void flushSyncQueue();
      }),
    [commitGameSnapshot, flushSyncQueue, getGame, runMutation]
  );

  const addNoteEvent = useCallback(
    async ({ gameId, playerId, note, roundNumber, turnNumber }: EventPayload) =>
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
        const nextGame = appendLocalNoteEvent(game, {
          playerId,
          note: trimmedNote,
          roundNumber: roundNumber ?? latestRound?.roundNumber,
          turnNumber: turnNumber ?? latestTurn?.turnNumber
        });
        const newEventId = getLatestAddedEventId(game, nextGame);
        commitGameSnapshot(newEventId ? getEventActionLabel(nextGame, newEventId) : "Notiz", game, nextGame);
        void flushSyncQueue();
      }),
    [commitGameSnapshot, flushSyncQueue, getGame, runMutation]
  );

  const enqueueTimeEvents = useCallback(
    (
      game: Game,
      timeEvents: Array<{
        action: TimeEventAction;
        playerId?: PlayerId;
        roundNumber?: number;
        turnNumber?: number;
        createdAt?: string;
      }>,
      label = "Zeit geaendert"
    ) => {
      if (!timeEvents.length) {
        return game;
      }

      const nextGame = appendLocalTimeEvents(game, timeEvents);
      return commitGameSnapshot(getTimeHistoryLabel(label, nextGame), game, nextGame, {
        recordHistory: false
      });
    },
    [commitGameSnapshot]
  );

  const advanceGame = useCallback(
    async (gameId: string, turnRef?: TurnRef, keepTimerRunning = false) =>
      runMutation(async () => {
        const game = getGame(gameId);
        if (!game || game.status === "completed") {
          return;
        }

        const now = getNowIso();
        const currentTurn = getTurnByRef(game, turnRef);
        const currentRound = currentTurn
          ? game.rounds.find((round) => round.roundNumber === currentTurn.roundNumber)
          : getLatestRound(game);
        const nextExistingTurn = getNextTurnByRef(game, turnRef);
        const eventsToAdd: Array<{
          action: TimeEventAction;
          playerId?: PlayerId;
          roundNumber?: number;
          turnNumber?: number;
          createdAt?: string;
        }> = [];
        const runningTurns = game.rounds
          .flatMap((round) => round.turns)
          .filter(
            (turn) =>
              turn.timing.startedAt &&
              !turn.timing.endedAt &&
              !isTurnPaused(turn)
          );
        const currentTurnIsRunning = Boolean(
          currentTurn?.timing.startedAt &&
          !currentTurn.timing.endedAt &&
          !isTurnPaused(currentTurn)
        );
        const pushPauseForRunningTurns = (excludeKey?: string | null) => {
          runningTurns.forEach((turn) => {
            if (getTurnKey(turn) === excludeKey) {
              return;
            }

            eventsToAdd.push({
              playerId: turn.playerId,
              roundNumber: turn.roundNumber,
              turnNumber: turn.turnNumber,
              action: "turn-pause",
              createdAt: now
            });
          });
        };
        const pushStartStateForTurn = (
          targetTurn: NonNullable<ReturnType<typeof getTurnByRef>>,
          shouldRun: boolean
        ) => {
          const targetRound = game.rounds.find(
            (round) => round.roundNumber === targetTurn.roundNumber
          );
          if (!game.timeEvents.some((event) => event.action === "game-start")) {
            eventsToAdd.push({
              playerId: game.startingPlayerId,
              action: "game-start",
              createdAt: now
            });
          }

          if (targetRound && !targetRound.startedAt) {
            eventsToAdd.push({
              playerId: targetTurn.playerId,
              roundNumber: targetTurn.roundNumber,
              action: "round-start",
              createdAt: now
            });
          }

          if (!targetTurn.timing.startedAt) {
            eventsToAdd.push({
              playerId: targetTurn.playerId,
              roundNumber: targetTurn.roundNumber,
              turnNumber: targetTurn.turnNumber,
              action: "turn-start",
              createdAt: now
            });
          } else if (shouldRun) {
            eventsToAdd.push({
              playerId: targetTurn.playerId,
              roundNumber: targetTurn.roundNumber,
              turnNumber: targetTurn.turnNumber,
              action: "turn-resume",
              createdAt: now
            });
          }

          if (!shouldRun) {
            eventsToAdd.push({
              playerId: targetTurn.playerId,
              roundNumber: targetTurn.roundNumber,
              turnNumber: targetTurn.turnNumber,
              action: "turn-pause",
              createdAt: now
            });
          }
        };

        if (nextExistingTurn) {
          if (keepTimerRunning) {
            pushPauseForRunningTurns(getTurnKey(nextExistingTurn));
            pushStartStateForTurn(nextExistingTurn, true);
            enqueueTimeEvents(game, eventsToAdd, "Weiter");
            void flushSyncQueue();
          }
          return;
        }

        if (!currentRound) {
          const firstRoundNumber = 1;
          const shouldRun = keepTimerRunning;
          eventsToAdd.push(
            {
              playerId: game.startingPlayerId,
              action: "game-start",
              createdAt: now
            },
            {
              playerId: game.startingPlayerId,
              roundNumber: firstRoundNumber,
              action: "round-start",
              createdAt: now
            },
            {
              playerId: game.startingPlayerId,
              roundNumber: firstRoundNumber,
              turnNumber: 1,
              action: "turn-start",
              createdAt: now
            }
          );

          if (!shouldRun) {
            eventsToAdd.push({
              playerId: game.startingPlayerId,
              roundNumber: firstRoundNumber,
              turnNumber: 1,
              action: "turn-pause",
              createdAt: now
            });
          }

          enqueueTimeEvents(game, eventsToAdd, "Weiter");
          void flushSyncQueue();
          return;
        }

        const closeCurrentGame = () => {
          if (currentTurn?.timing.startedAt && !currentTurn.timing.endedAt) {
            eventsToAdd.push({
              playerId: currentTurn.playerId,
              roundNumber: currentTurn.roundNumber,
              turnNumber: currentTurn.turnNumber,
              action: "turn-end",
              createdAt: now
            });
          }

          if (currentRound.startedAt && !currentRound.endedAt) {
            eventsToAdd.push({
              playerId: currentTurn?.playerId ?? game.currentPlayerId,
              roundNumber: currentRound.roundNumber,
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
            playerId: currentTurn?.playerId ?? game.currentPlayerId,
            action: "game-end",
            createdAt: now
          });
        };

        const currentRoundHasTwoTurns = currentRound.turns.length >= 2 && (currentTurn?.turnNumber ?? 0) >= 2;
        if (currentRound.roundNumber >= MAX_ROUNDS && currentRoundHasTwoTurns) {
          closeCurrentGame();
          enqueueTimeEvents(game, eventsToAdd, "Weiter");
          void flushSyncQueue();
          return;
        }

        const shouldRunNextTurn = keepTimerRunning;
        if (currentRoundHasTwoTurns) {
          const nextRoundNumber = currentRound.roundNumber + 1;
          if (currentTurn?.timing.startedAt && !currentTurn.timing.endedAt) {
            eventsToAdd.push({
              playerId: currentTurn.playerId,
              roundNumber: currentTurn.roundNumber,
              turnNumber: currentTurn.turnNumber,
              action: "turn-end",
              createdAt: now
            });
          }

          if (currentRound.startedAt && !currentRound.endedAt) {
            eventsToAdd.push({
              playerId: currentTurn?.playerId ?? game.currentPlayerId,
              roundNumber: currentRound.roundNumber,
              action: "round-end",
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

          if (!shouldRunNextTurn) {
            eventsToAdd.push({
              playerId: game.startingPlayerId,
              roundNumber: nextRoundNumber,
              turnNumber: 1,
              action: "turn-pause",
              createdAt: now
            });
          }
        } else {
          const nextPlayerId =
            game.players.find((player) => player.id !== (currentTurn?.playerId ?? game.currentPlayerId))?.id ??
            game.currentPlayerId;

          if (currentTurn?.timing.startedAt && !currentTurn.timing.endedAt) {
            eventsToAdd.push({
              playerId: currentTurn.playerId,
              roundNumber: currentTurn.roundNumber,
              turnNumber: currentTurn.turnNumber,
              action: "turn-end",
              createdAt: now
            });
          }

          eventsToAdd.push({
            playerId: nextPlayerId,
            roundNumber: currentRound.roundNumber,
            turnNumber: 2,
            action: "turn-start",
            createdAt: now
          });

          if (!shouldRunNextTurn) {
            eventsToAdd.push({
              playerId: nextPlayerId,
              roundNumber: currentRound.roundNumber,
              turnNumber: 2,
              action: "turn-pause",
              createdAt: now
            });
          }
        }

        enqueueTimeEvents(game, eventsToAdd, "Weiter");
        void flushSyncQueue();
      }),
    [enqueueTimeEvents, flushSyncQueue, getGame, getNextTurnByRef, getTurnByRef, runMutation]
  );

  const rewindLastTurn = useCallback(
    async (gameId: string, turnRef?: TurnRef, keepTimerRunning = false) =>
      runMutation(async () => {
        const game = getGame(gameId);
        if (!game || game.status === "completed") {
          return;
        }

        const targetTurn = getPreviousTurnByRef(game, turnRef);
        if (!targetTurn || !keepTimerRunning) {
          return;
        }

        const now = getNowIso();
        const currentTurn = getTurnByRef(game, turnRef);
        const eventsToAdd: Array<{
          action: TimeEventAction;
          playerId?: PlayerId;
          roundNumber?: number;
          turnNumber?: number;
          createdAt?: string;
        }> = [];
        const runningTurns = game.rounds
          .flatMap((round) => round.turns)
          .filter(
            (turn) =>
              turn.timing.startedAt &&
              !turn.timing.endedAt &&
              !isTurnPaused(turn)
          );

        runningTurns.forEach((turn) => {
          if (getTurnKey(turn) === getTurnKey(targetTurn)) {
            return;
          }

          eventsToAdd.push({
            playerId: turn.playerId,
            roundNumber: turn.roundNumber,
            turnNumber: turn.turnNumber,
            action: "turn-pause",
            createdAt: now
          });
        });

        if (!targetTurn.timing.startedAt) {
          eventsToAdd.push({
            playerId: targetTurn.playerId,
            roundNumber: targetTurn.roundNumber,
            turnNumber: targetTurn.turnNumber,
            action: "turn-start",
            createdAt: now
          });
        } else if (
          targetTurn.timing.endedAt ||
          isTurnPaused(targetTurn) ||
          getTurnKey(currentTurn) !== getTurnKey(targetTurn)
        ) {
          eventsToAdd.push({
            playerId: targetTurn.playerId,
            roundNumber: targetTurn.roundNumber,
            turnNumber: targetTurn.turnNumber,
            action: "turn-resume",
            createdAt: now
          });
        }

        if (eventsToAdd.length) {
          enqueueTimeEvents(game, eventsToAdd, "Timer zu vorherigem Zug");
          void flushSyncQueue();
        }
      }),
    [enqueueTimeEvents, flushSyncQueue, getGame, getPreviousTurnByRef, getTurnByRef, runMutation]
  );

  const pauseActiveTimer = useCallback(
    async (gameId: string, turnRef?: TurnRef) =>
      runMutation(async () => {
        const game = getGame(gameId);
        if (!game || game.status === "completed") {
          return;
        }

        const targetTurn = getTurnByRef(game, turnRef);
        if (!targetTurn || !targetTurn.timing.startedAt || targetTurn.timing.endedAt || isTurnPaused(targetTurn)) {
          return;
        }

        enqueueTimeEvents(game, [
          {
            playerId: targetTurn.playerId,
            roundNumber: targetTurn.roundNumber,
            turnNumber: targetTurn.turnNumber,
            action: "turn-pause"
          }
        ], "Timer aus");
        void flushSyncQueue();
      }),
    [enqueueTimeEvents, flushSyncQueue, getGame, getTurnByRef, runMutation]
  );

  const startGameTimer = useCallback(
    async (gameId: string, turnRef?: TurnRef) =>
      runMutation(async () => {
        const game = getGame(gameId);
        if (!game || game.status === "completed") {
          return;
        }

        const now = getNowIso();
        const targetTurn = getTurnByRef(game, turnRef);
        const targetRound = turnRef
          ? game.rounds.find((round) => round.roundNumber === turnRef.roundNumber)
          : getLatestRound(game);
        const eventsToAdd: Array<{
          action: TimeEventAction;
          playerId?: PlayerId;
          roundNumber?: number;
          turnNumber?: number;
          createdAt?: string;
        }> = [];
        const runningTurns = game.rounds
          .flatMap((round) => round.turns)
          .filter(
            (turn) =>
              turn.timing.startedAt &&
              !turn.timing.endedAt &&
              !isTurnPaused(turn)
          );

        runningTurns.forEach((turn) => {
          if (getTurnKey(turn) === getTurnKey(targetTurn)) {
            return;
          }

          eventsToAdd.push({
            playerId: turn.playerId,
            roundNumber: turn.roundNumber,
            turnNumber: turn.turnNumber,
            action: "turn-pause",
            createdAt: now
          });
        });

        if (!game.timeEvents.some((event) => event.action === "game-start")) {
          eventsToAdd.push({
            playerId: game.startingPlayerId,
            action: "game-start",
            createdAt: now
          });
        }

        if (targetTurn) {
          if (targetRound && !targetRound.startedAt) {
            eventsToAdd.push({
              playerId: targetTurn.playerId,
              roundNumber: targetTurn.roundNumber,
              action: "round-start",
              createdAt: now
            });
          }

          if (!targetTurn.timing.startedAt) {
            eventsToAdd.push({
              playerId: targetTurn.playerId,
              roundNumber: targetTurn.roundNumber,
              turnNumber: targetTurn.turnNumber,
              action: "turn-start",
              createdAt: now
            });
          } else if (targetTurn.timing.endedAt || isTurnPaused(targetTurn)) {
            eventsToAdd.push({
              playerId: targetTurn.playerId,
              roundNumber: targetTurn.roundNumber,
              turnNumber: targetTurn.turnNumber,
              action: "turn-resume",
              createdAt: now
            });
          }
        } else {
          const nextRoundNumber = (targetRound?.roundNumber ?? 0) + 1;
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
        }

        if (eventsToAdd.length) {
          enqueueTimeEvents(game, eventsToAdd, "Timer an");
          void flushSyncQueue();
        }
      }),
    [enqueueTimeEvents, flushSyncQueue, getGame, getTurnByRef, runMutation]
  );

  const startTimeout = useCallback(
    async (gameId: string, turnRef?: TurnRef) =>
      runMutation(async () => {
        const game = getGame(gameId);
        if (!game || game.status === "completed" || isTimeoutActive(game)) {
          return;
        }

        const targetTurn = getTurnByRef(game, turnRef);
        if (!targetTurn || !targetTurn.timing.startedAt || targetTurn.timing.endedAt || isTurnPaused(targetTurn)) {
          return;
        }

        const now = getNowIso();
        enqueueTimeEvents(game, [
          {
            playerId: targetTurn.playerId,
            roundNumber: targetTurn.roundNumber,
            turnNumber: targetTurn.turnNumber,
            action: "turn-pause",
            createdAt: now
          },
          {
            playerId: targetTurn.playerId,
            roundNumber: targetTurn.roundNumber,
            turnNumber: targetTurn.turnNumber,
            action: "timeout-start",
            createdAt: now
          }
        ], "Time-out starten");
        void flushSyncQueue();
      }),
    [enqueueTimeEvents, flushSyncQueue, getGame, getTurnByRef, runMutation]
  );

  const endTimeout = useCallback(
    async (gameId: string, turnRef?: TurnRef) =>
      runMutation(async () => {
        const game = getGame(gameId);
        if (!game || game.status === "completed" || !isTimeoutActive(game)) {
          return;
        }

        const targetTurn = getTurnByRef(game, turnRef);
        const now = getNowIso();
        const eventsToAdd: Array<{
          action: TimeEventAction;
          playerId?: PlayerId;
          roundNumber?: number;
          turnNumber?: number;
          createdAt?: string;
        }> = [
          {
            playerId: targetTurn?.playerId,
            roundNumber: targetTurn?.roundNumber,
            turnNumber: targetTurn?.turnNumber,
            action: "timeout-end",
            createdAt: now
          }
        ];

        if (targetTurn && targetTurn.timing.startedAt && !targetTurn.timing.endedAt && isTurnPaused(targetTurn)) {
          eventsToAdd.push({
            playerId: targetTurn.playerId,
            roundNumber: targetTurn.roundNumber,
            turnNumber: targetTurn.turnNumber,
            action: "turn-resume",
            createdAt: now
          });
        }

        enqueueTimeEvents(game, eventsToAdd, "Time-out beenden");
        void flushSyncQueue();
      }),
    [enqueueTimeEvents, flushSyncQueue, getGame, getTurnByRef, runMutation]
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

        let nextGame = removeLocalEvent(game, latestGameEndEvent.id);
        if (restartSession && !isSessionRunning(nextGame)) {
          nextGame = appendLocalTimeEvents(nextGame, [{ action: "session-start" }]);
        }

        commitGameSnapshot("Spiel wieder eroeffnet", game, nextGame);
        void flushSyncQueue();
      }),
    [commitGameSnapshot, flushSyncQueue, getGame, runMutation]
  );

  const updateGameEvent = useCallback(
    async (gameId: string, eventId: string, patch: UpdateSupabaseEventPayload) =>
      runMutation(async () => {
        const currentGame = getGame(gameId);
        if (!currentGame) {
          throw new Error("Spiel nicht gefunden.");
        }

        const normalizedPatch = normalizeEventPatch(currentGame, eventId, patch);
        const nextGame = updateLocalEvent(currentGame, eventId, normalizedPatch);
        commitGameSnapshot(`Eintrag bearbeitet: ${getEventActionLabel(nextGame, eventId)}`, currentGame, nextGame);
        void flushSyncQueue();
      }),
    [
      commitGameSnapshot,
      flushSyncQueue,
      getGame,
      normalizeEventPatch,
      runMutation
    ]
  );

  const deleteGameEvent = useCallback(
    async (gameId: string, eventId: string) =>
      runMutation(async () => {
        const currentGame = getGame(gameId);
        if (!currentGame) {
          throw new Error("Spiel nicht gefunden.");
        }

        const label = `Eintrag geloescht: ${getEventActionLabel(currentGame, eventId)}`;
        const nextGame = removeLocalEvent(currentGame, eventId);
        commitGameSnapshot(label, currentGame, nextGame);
        void flushSyncQueue();
      }),
    [commitGameSnapshot, flushSyncQueue, getGame, runMutation]
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

        enqueueTimeEvents(game, eventsToAdd, "Spiel beenden");
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
      setTimerCorrections,
      resetAllGameTimers,
      addScoreEvent,
      addCommandPointEvent,
      addNoteEvent,
      advanceGame,
      rewindLastTurn,
      pauseActiveTimer,
      startGameTimer,
      startTimeout,
      endTimeout,
      reopenGame,
      updateGameEvent,
      deleteGameEvent,
      undoGameAction,
      redoGameAction,
      getUndoActionLabel,
      getRedoActionLabel,
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
      endTimeout,
      refreshGames,
      setTimerCorrections,
      resetAllGameTimers,
      reopenGame,
      rewindLastTurn,
      redoGameAction,
      startTimeout,
      startGameTimer,
      updateGameDetails,
      updateGameEvent,
      undoGameAction,
      getUndoActionLabel,
      getRedoActionLabel
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
