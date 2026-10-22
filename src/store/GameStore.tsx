import {
  APP_SCHEMA_VERSION,
  decideBuildUpdate,
  decideSchemaUpdate,
  formatConflictNotice,
  keepNewerLocalGames,
  isPullOutdated,
  keepLocallyCreatedGames,
  resolveOwnRetryResult,
  getItemBaseFlowVersion,
  getItemBaseVersion,
  getQueuedMs,
  isSameSyncBatch,
  rebaseSyncQueue,
  type SyncRpcResult
} from "../utils/syncVersioning";
import { getServerNow } from "../utils/serverClock";
import { loadHeldGames, recordSyncConflict, saveHeldGames,
  decideAfterGameSave
} from "../utils/localSync";
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
  syncRepository,
  SyncRpcError,
  getEventPayloadFingerprint,
  getGameSnapshotFingerprint,
  getSyncedEventPayload,
  mapSupabaseGameToAppGame,
  type UpdateSupabaseEventPayload
} from "../services/gamesRepository";
import { RemoteGameCache, getLiveViewPause, getPollIntervalMs, getRealtimeGameId, liveViewBlocksLoad, shouldFullPullOnResume, shouldLiveViewFollowRealtime } from "../utils/deltaPull";
import type {
  CommandPointType,
  CreateGameInput,
  Game,
  GameFinishReason,
  PlayerId,
  ScoreType,
  StatsEligibilityOverrides,
  TimeEventAction,
  TurnRef
} from "../types/game";
import {
  appendLocalCommandPointEvent,
  appendLocalNoteEvent,
  appendLocalScoreEvent,
  appendLocalTimeEvents,
  createLocalGame,
  getMissingGameStartCreatedAt,
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
  getPlayerChallengeTotal,
  getPlayerPrimaryTotal,
  getPlayerSecondaryTotal,
  isSetupActive,
  isSetupPaused,
  isSetupRunning,
  isTimeoutActive,
  isTurnPaused
} from "../utils/gameCalculations";
import {
  createEventSyncQueueItem,
  createGameSyncQueueItem,
  createReopenGameSyncQueueItem,
  enqueueSyncQueueItem,
  getSyncErrorMessage,
  isTransientSyncError,
  loadCachedGames,
  loadSyncQueue,
  removeSyncQueueItem,
  saveCachedGames,
  saveSyncQueue,
  type SyncQueueItem
} from "../utils/localSync";
import { syncRememberedPlayerNames } from "../utils/presets";
import { rememberAccessMode } from "../utils/accessModeMemory";
import { createId } from "../utils/id";
import { getNowIso } from "../utils/time";
import {
  getGameAccessMode,
  getGameRouteAccess,
  isGameWriteBlocked,
  canReopenFromGamePage,
  isGameCompletedForDisplay,
  setGameAccessModeInState,
  type GameAccessMode,
  type GameAccessModeState
} from "../utils/gameAccessMode";

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
  turnRef?: TurnRef;
  turnMs?: number;
  corrections?: Array<{
    turnRef: TurnRef;
    turnMs: number;
  }>;
}

type SyncStatus = "idle" | "pending" | "syncing" | "success" | "offline" | "error";

interface GameHistoryEntry {
  id: string;
  gameId: string;
  label: string;
  kind: "snapshot" | "advance-turn" | "rewind-turn";
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
  syncNotice: string | null;
  appUpdateNotice: string | null;
  dismissSyncNotice: () => void;
  syncStatus: SyncStatus;
  lastSyncAt: string | null;
  pendingSyncCount: number;
  retrySync: () => Promise<void>;
  getGameAccessMode: (gameId: string) => GameAccessMode | null;
  isGameViewOnly: (gameId: string) => boolean;
  setGameAccessMode: (gameId: string, mode: GameAccessMode | null) => void;
  createGame: (input: CreateGameInput) => Promise<Game>;
  getGame: (gameId: string) => Game | undefined;
  refreshGames: () => Promise<void>;
  // Live-Ansicht (View only/TV): angehalten nach Spielende ("ended") bzw. 15 min ohne neues Event ("idle").
  liveViewPause: "ended" | "idle" | null;
  resumeLiveView: () => void;
  updateGameDetails: (gameId: string, input: CreateGameInput) => Promise<void>;
  updateStatsEligibilityOverrides: (gameId: string, overrides: StatsEligibilityOverrides) => Promise<void>;
  setTimerCorrections: (input: TimerCorrectionInput) => Promise<void>;
  resetAllGameTimers: (gameId: string) => Promise<void>;
  addScoreEvent: (payload: EventPayload & { scoreType: ScoreType }) => Promise<void>;
  addCommandPointEvent: (payload: EventPayload & { cpType: CommandPointType }) => Promise<void>;
  addNoteEvent: (payload: EventPayload) => Promise<void>;
  setAutoCommandPointEnabled: (gameId: string, enabled: boolean) => Promise<void>;
  advanceGame: (gameId: string, turnRef?: TurnRef, keepTimerRunning?: boolean, recordHistory?: boolean) => Promise<void>;
  rewindLastTurn: (gameId: string, turnRef?: TurnRef, keepTimerRunning?: boolean, recordHistory?: boolean) => Promise<void>;
  pauseActiveTimer: (gameId: string, turnRef?: TurnRef) => Promise<void>;
  startGameTimer: (gameId: string, turnRef?: TurnRef) => Promise<void>;
  startTimeout: (gameId: string, turnRef?: TurnRef) => Promise<void>;
  endTimeout: (gameId: string, turnRef?: TurnRef) => Promise<void>;
  reopenGame: (gameId: string) => Promise<void>;
  updateGameEvent: (gameId: string, eventId: string, patch: UpdateSupabaseEventPayload) => Promise<void>;
  deleteGameEvent: (gameId: string, eventId: string) => Promise<void>;
  // navigationByCaller: bei Weiter/Zurueck-Eintraegen navigiert die Spielseite selbst (gleiche Timer-Regel wie die Knoepfe),
  // der Store verschiebt dann nur den Verlaufseintrag.
  undoGameAction: (gameId: string, navigationByCaller?: boolean) => Promise<void>;
  redoGameAction: (gameId: string, navigationByCaller?: boolean) => Promise<void>;
  getUndoActionLabel: (gameId: string) => string | null;
  getRedoActionLabel: (gameId: string) => string | null;
  finishGame: (gameId: string, finishReason?: GameFinishReason) => Promise<void>;
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
const RESUME_SYNC_DELAY_MS = 1200;
const SYNC_RETRY_BASE_DELAY_MS = 2000;
const SYNC_RETRY_MAX_DELAY_MS = 60000;

const canAttemptRemoteSync = (): boolean =>
  typeof document === "undefined" ||
  (!document.hidden && (typeof navigator === "undefined" || navigator.onLine));

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
  scoreType === "primary"
    ? "Prim"
    : scoreType === "secondary"
      ? "Sek"
      : scoreType === "challenge"
        ? "Chal"
        : "Ges";

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

const getTimeHistoryLabel = (baseLabel: string, turnRef?: TurnRef | null): string => {
  if (baseLabel !== "Weiter" && baseLabel !== "Zurück") {
    return baseLabel;
  }

  if (!turnRef) {
    return baseLabel;
  }

  return `${baseLabel} R${turnRef.roundNumber} Z${turnRef.turnNumber}`;
};

export const mergeRemoteWithPending = (
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
    if (queueItem.type === "reopen-game") {
      mergedById.set(queueItem.gameId, localGame);
      return;
    }

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
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [appUpdateNotice, setAppUpdateNotice] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [gameAccessModes, setGameAccessModes] = useState<GameAccessModeState>({});
  const gamesRef = useRef(games);
  const queueRef = useRef(syncQueue);
  const gameAccessModesRef = useRef<GameAccessModeState>({});
  const flushPromiseRef = useRef<Promise<boolean> | null>(null);
  const mutationLocksRef = useRef<Set<string>>(new Set());
  const refreshTimerRef = useRef<number | null>(null);
  const resumeSyncTimerRef = useRef<number | null>(null);
  const hiddenSinceRef = useRef<number | null>(null);
  const retrySyncTimerRef = useRef<number | null>(null);
  const retryAttemptRef = useRef(0);
  const advanceGameRef = useRef<(gameId: string, turnRef?: TurnRef, keepTimerRunning?: boolean, recordHistory?: boolean) => Promise<void>>(async () => {});
  const rewindLastTurnRef = useRef<(gameId: string, turnRef?: TurnRef, keepTimerRunning?: boolean, recordHistory?: boolean) => Promise<void>>(async () => {});

  useEffect(() => {
    gamesRef.current = games;
    saveCachedGames(games);
    syncRememberedPlayerNames(games);
  }, [games]);

  useEffect(() => {
    queueRef.current = syncQueue;
    saveSyncQueue(syncQueue);
  }, [syncQueue]);

  const getGameAccessModeForId = useCallback(
    (gameId: string) => getGameAccessMode(gameAccessModesRef.current, gameId),
    []
  );

  const isGameViewOnly = useCallback(
    (gameId: string) => isGameWriteBlocked(gameAccessModesRef.current, gameId,
      getGameRouteAccess(window.location.hash, window.location.search)),
    []
  );

  const warnBlockedViewOnlyWrite = useCallback((gameId: string, action: string) => {
    if (import.meta.env.DEV) {
      console.warn("[view-only] blocked write", { gameId, action });
    }
  }, []);

  const shouldBlockGameWrite = useCallback(
    (gameId: string, action: string): boolean => {
      const completed = isGameCompletedForDisplay(gamesRef.current.find((game) => game.id === gameId));
      const openedHere = getGameRouteAccess(window.location.hash, window.location.search).gameId === gameId;
      // Persist an editor's just-completed snapshot, but never edit a completed
      // display. Administrative import/delete/reopen outside the display remain compatible.
      const persistence = action.startsWith("enqueue-");
      // Ursache "Entsperren geht nicht": reopenGame wurde auf der eigenen Spielseite immer blockiert (openedHere).
      // Jetzt erlaubt, wenn das Spiel per Passwort entsperrt wurde (Modus "edit").
      const administration = action === "reopenGame"
        ? canReopenFromGamePage(completed, openedHere, getGameAccessMode(gameAccessModesRef.current, gameId))
        : !openedHere && ["deleteGame", "importGames"].includes(action);
      if (!isGameViewOnly(gameId) && (!completed || persistence || administration)) return false;

      warnBlockedViewOnlyWrite(gameId, action);
      return true;
    },
    [isGameViewOnly, warnBlockedViewOnlyWrite]
  );

  const flushSyncQueueRef = useRef<(() => Promise<boolean>) | null>(null);
  const heldGamesRef = useRef<Record<string, Game>>(loadHeldGames());
  // Vor dem Ersetzen durch den Server-Stand: lokalen Stand gesperrter Spiele mit wartender Queue sichern.
  const holdBlockedLocalGames = () => {
    let changed = false;
    queueRef.current.forEach((item) => {
      if (heldGamesRef.current[item.gameId] || !isGameViewOnly(item.gameId)) return;
      const localGame = gamesRef.current.find((game) => game.id === item.gameId);
      if (!localGame) return;
      heldGamesRef.current = { ...heldGamesRef.current, [item.gameId]: localGame };
      changed = true;
    });
    if (changed) saveHeldGames(heldGamesRef.current);
  };
  const releaseHeldGame = (gameId: string) => {
    if (!heldGamesRef.current[gameId]) return;
    const { [gameId]: _released, ...rest } = heldGamesRef.current;
    heldGamesRef.current = rest;
    saveHeldGames(rest);
  };
  const flushAgainRef = useRef(false);
  const pullPendingRef = useRef<(attempt?: number) => Promise<boolean>>(async () => false);
  const scheduleRemoteRefreshRef = useRef<(() => void) | null>(null);
  // Zaehler fuer eigenes Schreiben und lokales Anlegen (siehe isPullOutdated / keepLocallyCreatedGames).
  const writeGenerationRef = useRef(0);
  // Delta-Abgleich (#679): Server-Stände je Spiel; eigenes Schreiben/Realtime markiert Spiele zum Nachladen.
  const remoteCacheRef = useRef<RemoteGameCache>(new RemoteGameCache());
  const realtimeConnectedRef = useRef(false);
  const lastPullStartRef = useRef(0);
  const refreshGamesRef = useRef<(() => Promise<void>) | null>(null);
  const liveViewRef = useRef<{ gameId: string | null; since: number; pause: "ended" | "idle" | null }>({ gameId: null, since: 0, pause: null });
  const [liveViewPause, setLiveViewPause] = useState<"ended" | "idle" | null>(null);
  const locallyCreatedSaveGenerationRef = useRef<Map<string, number>>(new Map());
  const bumpWriteGeneration = (gameId?: string) => {
    writeGenerationRef.current += 1;
    // Eigene Aenderung (auch CP/Punkte/Notizen ohne Versionserhoehung): Spiel beim naechsten Abgleich voll nachladen.
    if (gameId) remoteCacheRef.current.markDirty(gameId); else remoteCacheRef.current.requestFull();
    if (gameId && locallyCreatedSaveGenerationRef.current.has(gameId)) {
      locallyCreatedSaveGenerationRef.current.set(gameId, writeGenerationRef.current);
    }
  };
  // Aktionsgruppen: alle Queue-Eintraege eines synchronen Durchlaufs teilen sich eine batchId.
  const currentBatchRef = useRef<string | null>(null);
  const getCurrentBatchId = () => {
    if (!currentBatchRef.current) {
      currentBatchRef.current = createId("batch");
      void Promise.resolve().then(() => { currentBatchRef.current = null; });
    }
    return currentBatchRef.current;
  };
  // Bereits gesendete Ereignisse je Gruppe, damit sie bei Konflikt der Gruppe zurueckgenommen werden.
  const appliedEventsRef = useRef<Array<{ gameId: string; eventId: string; batchId?: string; createdAt: string;
    flowVersion: number }>>([]);
  const setGameAccessMode = useCallback((gameId: string, mode: GameAccessMode | null) => {
    const nextModes = setGameAccessModeInState(gameAccessModesRef.current, gameId, mode);
    gameAccessModesRef.current = nextModes;
    setGameAccessModes(nextModes);
    // Nach "Bearbeiten" wartende (z. B. offline oder von aelterer App-Version gespeicherte) Aenderungen sofort senden.
    const held = heldGamesRef.current[gameId];
    if (mode === "edit" && held) {
      // Gesicherten lokalen Stand wieder ueber den Server-Stand legen, bevor gesendet wird.
      const pending = queueRef.current.filter((item) => item.gameId === gameId);
      const merged = mergeRemoteWithPending(gamesRef.current.filter((game) => game.id === gameId), [held], pending)
        .find((game) => game.id === gameId);
      if (merged) {
        gamesRef.current = sortGames([merged, ...gamesRef.current.filter((game) => game.id !== gameId)]);
        setGames(gamesRef.current);
      }
      releaseHeldGame(gameId);
    }
    if (mode === "edit" && queueRef.current.some((item) => item.gameId === gameId)) {
      void Promise.resolve().then(() => flushSyncQueueRef.current?.());
    }
  }, []);

  const updateSyncQueue = useCallback((updater: (currentQueue: SyncQueueItem[]) => SyncQueueItem[]) => {
    const candidateQueue = updater(queueRef.current);
    if (candidateQueue === queueRef.current) return;
    const existingIds = new Set(queueRef.current.map((item) => item.id));
    const nextQueue = candidateQueue
      .filter((item) => existingIds.has(item.id) || !isGameViewOnly(item.gameId))
      .map((item) => {
        // Neue Eintraege merken den Serverstand, auf dem die lokale Aenderung beruht.
        if (existingIds.has(item.id) || item.batchId !== undefined) return item;
        const baseGame = gamesRef.current.find((game) => game.id === item.gameId);
        return { ...item, batchId: getCurrentBatchId(),
          ...(baseGame?.syncVersion === undefined && baseGame?.syncFlowVersion === undefined ? {}
            : { baseVersion: baseGame?.syncVersion, baseFlowVersion: baseGame?.syncFlowVersion }) };
      });
    if (nextQueue === queueRef.current) {
      return;
    }
    queueRef.current = nextQueue;
    setSyncQueue(nextQueue);
    saveSyncQueue(nextQueue);
    if (import.meta.env.DEV) {
      console.debug("[sync-queue]", {
        length: nextQueue.length
      });
    }
  }, [isGameViewOnly]);

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
    if (isGameViewOnly(nextGame.id)) return gamesRef.current.find((game) => game.id === nextGame.id) ?? nextGame;
    const syncedGame = syncDerivedGameState(nextGame);
    const nextGames = sortGames([syncedGame, ...gamesRef.current.filter((game) => game.id !== syncedGame.id)]);
    gamesRef.current = nextGames;
    setGames(nextGames);
    saveCachedGames(nextGames);
    syncRememberedPlayerNames(nextGames);
    return syncedGame;
  }, [isGameViewOnly]);

  const removeGameLocally = useCallback((gameId: string) => {
    if (isGameViewOnly(gameId)) return;
    const nextGames = gamesRef.current.filter((game) => game.id !== gameId);
    gamesRef.current = nextGames;
    setGames(nextGames);
    saveCachedGames(nextGames);
    syncRememberedPlayerNames(nextGames);
  }, [isGameViewOnly]);

  const enqueueGameUpsert = useCallback((gameId: string) => {
    if (shouldBlockGameWrite(gameId, "enqueue-game-upsert")) {
      return;
    }

    updateSyncQueue((currentQueue) => {
      const nextQueue = enqueueSyncQueueItem(currentQueue, createGameSyncQueueItem("upsert-game", gameId, getNowIso()));
      if (import.meta.env.DEV && nextQueue.length === currentQueue.length) {
        console.debug("[sync-queue] skipped duplicate game upsert", { gameId });
      }
      return nextQueue;
    });
  }, [shouldBlockGameWrite, updateSyncQueue]);

  const enqueueGameDelete = useCallback((gameId: string) => {
    if (shouldBlockGameWrite(gameId, "enqueue-game-delete")) {
      return;
    }

    updateSyncQueue((currentQueue) =>
      enqueueSyncQueueItem(currentQueue, createGameSyncQueueItem("delete-game", gameId, getNowIso()))
    );
  }, [shouldBlockGameWrite, updateSyncQueue]);

  const enqueueEventUpsert = useCallback((gameId: string, eventId: string) => {
    if (shouldBlockGameWrite(gameId, "enqueue-event-upsert")) {
      return;
    }

    updateSyncQueue((currentQueue) => {
      const nextQueue = enqueueSyncQueueItem(
        currentQueue,
        createEventSyncQueueItem("upsert-event", gameId, eventId, getNowIso())
      );
      if (import.meta.env.DEV && nextQueue.length === currentQueue.length) {
        console.debug("[sync-queue] skipped duplicate event upsert", { gameId, eventId });
      }
      return nextQueue;
    });
  }, [shouldBlockGameWrite, updateSyncQueue]);

  const enqueueEventDelete = useCallback((gameId: string, eventId: string) => {
    if (shouldBlockGameWrite(gameId, "enqueue-event-delete")) {
      return;
    }

    updateSyncQueue((currentQueue) => {
      return enqueueSyncQueueItem(
        currentQueue,
        createEventSyncQueueItem("delete-event", gameId, eventId, getNowIso())
      );
    });
  }, [shouldBlockGameWrite, updateSyncQueue]);

  const enqueueSnapshotSync = useCallback(
    (beforeGame: Game | null, afterGame: Game) => {
      if (!beforeGame || getGameSnapshotFingerprint(beforeGame) !== getGameSnapshotFingerprint(afterGame)) {
        enqueueGameUpsert(afterGame.id);
      }

      const beforeEventIds = beforeGame ? getAllEventIds(beforeGame) : new Set<string>();
      const afterEventIds = getAllEventIds(afterGame);

      beforeEventIds.forEach((eventId) => {
        if (!afterEventIds.has(eventId)) {
          enqueueEventDelete(afterGame.id, eventId);
        }
      });

      const beforeEventFingerprints = new Map<string, string>();
      if (beforeGame) {
        [
          ...beforeGame.timeEvents,
          ...beforeGame.commandPointEvents,
          ...beforeGame.scoreEvents,
          ...beforeGame.noteEvents
        ].forEach((event) => {
          const payload = getSyncedEventPayload(beforeGame, event.id);
          if (payload) {
            beforeEventFingerprints.set(event.id, getEventPayloadFingerprint(payload));
          }
        });
      }

      [
        ...afterGame.timeEvents,
        ...afterGame.commandPointEvents,
        ...afterGame.scoreEvents,
        ...afterGame.noteEvents
      ].forEach((event) => {
        const payload = getSyncedEventPayload(afterGame, event.id);
        if (!payload) {
          return;
        }

        if (beforeEventFingerprints.get(event.id) === getEventPayloadFingerprint(payload)) {
          return;
        }

        enqueueEventUpsert(afterGame.id, event.id);
      });
    },
    [enqueueEventDelete, enqueueEventUpsert, enqueueGameUpsert]
  );

  const recordHistoryAction = useCallback((
    label: string,
    beforeGame: Game,
    afterGame: Game,
    kind: GameHistoryEntry["kind"] = "snapshot"
  ) => {
    setHistoryStacksByGameId((currentStacks) => {
      const currentStack = currentStacks[afterGame.id] ?? { undo: [], redo: [] };
      const nextEntry: GameHistoryEntry = {
        id: createId("history"),
        gameId: afterGame.id,
        label,
        kind,
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
      kind: GameHistoryEntry["kind"] = "snapshot",
      recordHistory = true
    ): Game => {
      if (isGameViewOnly(afterGame.id)) return beforeGame;
      const nextGame = replaceGame(afterGame);
      enqueueSnapshotSync(beforeGame, nextGame);
      if (recordHistory) {
        recordHistoryAction(label, beforeGame, nextGame, kind);
      }
      return nextGame;
    },
    [enqueueSnapshotSync, isGameViewOnly, recordHistoryAction, replaceGame]
  );

  const removeQueueItem = useCallback((queueItemId: string) => {
    updateSyncQueue((currentQueue) => removeSyncQueueItem(currentQueue, queueItemId));
  }, [updateSyncQueue]);

  const normalizeEventPatch = useCallback(
    (game: Game, eventId: string, patch: UpdateSupabaseEventPayload): UpdateSupabaseEventPayload => {
      const scoreEvent = game.scoreEvents.find((event) => event.id === eventId);
      if (scoreEvent) {
        const currentTotal =
          scoreEvent.scoreType === "primary"
            ? getPlayerPrimaryTotal(game, scoreEvent.playerId)
            : scoreEvent.scoreType === "secondary"
              ? getPlayerSecondaryTotal(game, scoreEvent.playerId)
              : scoreEvent.scoreType === "challenge"
                ? getPlayerChallengeTotal(game, scoreEvent.playerId)
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

  const clearRetryTimer = useCallback(() => {
    if (retrySyncTimerRef.current) {
      window.clearTimeout(retrySyncTimerRef.current);
      retrySyncTimerRef.current = null;
    }
  }, []);

  const scheduleSyncRetry = useCallback(() => {
    if (!queueRef.current.length || !canAttemptRemoteSync()) {
      return;
    }

    clearRetryTimer();
    const delay = Math.min(
      SYNC_RETRY_BASE_DELAY_MS * 2 ** retryAttemptRef.current,
      SYNC_RETRY_MAX_DELAY_MS
    );
    retryAttemptRef.current += 1;

    if (import.meta.env.DEV) {
      console.debug("[sync-retry] scheduled", {
        delayMs: delay,
        attempt: retryAttemptRef.current,
        queueLength: queueRef.current.length
      });
    }

    retrySyncTimerRef.current = window.setTimeout(() => {
      retrySyncTimerRef.current = null;
      void flushSyncQueue();
    }, delay);
  }, [clearRetryTimer]);

  const pullRemoteGames = useCallback(async (attempt = 0): Promise<boolean> => {
    if (!canAttemptRemoteSync()) {
      setSyncStatus(queueRef.current.length ? "offline" : "idle");
      return false;
    }

    const configError = getSupabaseConfigError();
    if (configError) {
      setErrorMessage(configError);
      return false;
    }

    try {
      // Veraltete Antworten (vor dem eigenen Schreiben gelesen) ersetzen den neueren lokalen Stand nicht.
      const pullStartGeneration = writeGenerationRef.current;
      const listed = await gamesRepository.listGamesDelta(remoteCacheRef.current, getServerNow());
      if (isPullOutdated(pullStartGeneration, writeGenerationRef.current)) {
        // Waehrend des Ladens wurde selbst gespeichert/angelegt: Antwort kann aelter sein -> verwerfen, sofort neu laden.
        if (attempt < 3) return pullPendingRef.current(attempt + 1);
        scheduleRemoteRefreshRef.current?.();
        return false;
      }
      const remoteGames = keepNewerLocalGames(listed, gamesRef.current);
      holdBlockedLocalGames();
      const nextGames = keepLocallyCreatedGames(mergeRemoteWithPending(remoteGames, gamesRef.current,
        queueRef.current.filter((item) => !isGameViewOnly(item.gameId))), gamesRef.current,
        locallyCreatedSaveGenerationRef.current, pullStartGeneration);
      gamesRef.current = nextGames;
      setGames(nextGames);
      saveCachedGames(nextGames);
      syncRememberedPlayerNames(nextGames);
      if (!queueRef.current.length) {
        setErrorMessage(null);
      }
      setLastSyncAt(getNowIso());
      setSyncStatus("success");
      return true;
    } catch (error) {
      if (!isTransientSyncError(error)) {
        setErrorMessage(getErrorMessage(error));
      }
      setSyncStatus("error");
      return false;
    }
  }, [isGameViewOnly]);
  pullPendingRef.current = pullRemoteGames;

  const flushSyncQueue = useCallback(async (): Promise<boolean> => {
    if (!canAttemptRemoteSync()) {
      setSyncStatus("offline");
      return false;
    }

    if (flushPromiseRef.current) {
      // Waehrend eines laufenden Durchgangs angefragt (z. B. Wechsel auf "Bearbeiten"): danach erneut senden.
      flushAgainRef.current = true;
      return flushPromiseRef.current;
    }

    flushAgainRef.current = false;
    flushPromiseRef.current = (async () => {
      const configError = getSupabaseConfigError();
      if (configError) {
        setErrorMessage(configError);
        setSyncStatus("error");
        return false;
      }

      setSyncStatus("syncing");
      if (import.meta.env.DEV) {
        console.debug("[sync-queue] flush start", {
          queueLength: queueRef.current.length
        });
      }

      let droppedConflicts = 0;
      const gameResends = new Map<string, number>();
      while (queueRef.current.length) {
        const nextItem = queueRef.current.find((item) => !isGameViewOnly(item.gameId));
        if (!nextItem) {
          setSyncStatus("pending");
          break;
        }

        try {
          if (import.meta.env.DEV) {
            console.debug("[sync-queue] attempt", {
              type: nextItem.type,
              gameId: nextItem.gameId,
              eventId: "eventId" in nextItem ? nextItem.eventId : undefined,
              queueLength: queueRef.current.length
            });
          }

          const canWrite = () => !isGameViewOnly(nextItem.gameId);
          const base = { version: getItemBaseVersion(nextItem), flowVersion: getItemBaseFlowVersion(nextItem) };
          // "matched" bezieht sich je RPC nur auf die geprueften Version: Spielzeile bzw. Spielablauf.
          const rowOnly = (result: SyncRpcResult): SyncRpcResult => ({ ...result, flow_version: undefined });
          const flowOnly = (result: SyncRpcResult): SyncRpcResult => ({ ...result, version: undefined });
          const applyResult = (result: SyncRpcResult, current = base) => {
            // Eigene Schreibvorgaenge ohne fremde Zwischenstaende: Queue und lokalen Stand mitziehen.
            if (!result.matched) return current;
            updateSyncQueue((queue) => rebaseSyncQueue(queue, nextItem.gameId, current, result));
            const next = { version: result.version ?? current.version, flowVersion: result.flow_version ?? current.flowVersion };
            gamesRef.current = gamesRef.current.map((game) => game.id === nextItem.gameId
              ? { ...game, syncVersion: next.version, syncFlowVersion: next.flowVersion } : game);
            return next;
          };

          if (nextItem.type === "delete-game") {
            await syncRepository.deleteGame(nextItem.gameId, canWrite);
            bumpWriteGeneration(nextItem.gameId); removeQueueItem(nextItem.id);
            continue;
          }

          const currentGame = gamesRef.current.find((game) => game.id === nextItem.gameId);
          if (!currentGame) {
            bumpWriteGeneration(nextItem.gameId); removeQueueItem(nextItem.id);
            continue;
          }

          if (nextItem.type === "reopen-game") {
            let current = base;
            if (nextItem.gameEndEventId) {
              current = applyResult(flowOnly(await syncRepository.revokeEvent(nextItem.gameId, nextItem.gameEndEventId,
                current.flowVersion, canWrite)), current);
            }
            if (isGameViewOnly(nextItem.gameId)) break;
            applyResult(rowOnly(await syncRepository.saveGame(currentGame, current.version, canWrite)), current);
            bumpWriteGeneration(nextItem.gameId); removeQueueItem(nextItem.id);
            continue;
          }

          if (nextItem.type === "upsert-game") {
            const sentFingerprint = getGameSnapshotFingerprint(currentGame);
            applyResult(rowOnly(await syncRepository.saveGame(currentGame, base.version, canWrite)));
            bumpWriteGeneration(nextItem.gameId);
            const latestGame = gamesRef.current.find((game) => game.id === nextItem.gameId);
            const resends = gameResends.get(nextItem.gameId) ?? 0;
            const decision = decideAfterGameSave(sentFingerprint, latestGame ? getGameSnapshotFingerprint(latestGame) : null, resends);
            if (decision === "resend") {
              // Waehrend des Speicherns lokal geaendert: Eintrag bleibt (Basisversion wurde mitgezogen) und geht erneut raus.
              gameResends.set(nextItem.gameId, resends + 1);
              continue;
            }
            if (decision === "defer") {
              setSyncStatus("pending");
              scheduleSyncRetry();
              return false;
            }
            removeQueueItem(nextItem.id);
            continue;
          }

          if (nextItem.type === "delete-event") {
            applyResult(flowOnly(await syncRepository.revokeEvent(nextItem.gameId, nextItem.eventId, base.flowVersion, canWrite)));
            bumpWriteGeneration(nextItem.gameId); removeQueueItem(nextItem.id);
            continue;
          }

          const eventPayload = getSyncedEventPayload(currentGame, nextItem.eventId);
          if (!eventPayload) {
            // Lokale Daten zur wartenden Aenderung fehlen (z. B. lokal wieder entfernt): protokollieren.
            recordSyncConflict({ at: getNowIso(), item: nextItem, conflict: { kind: "local-missing" } });
            bumpWriteGeneration(nextItem.gameId); removeQueueItem(nextItem.id);
            continue;
          }

          const eventResult = applyResult(flowOnly(resolveOwnRetryResult(await syncRepository.putEvent(eventPayload, base.flowVersion,
            getQueuedMs(nextItem.createdAt, getServerNow()), canWrite), base.flowVersion, eventPayload.event_type)));
          appliedEventsRef.current = [...appliedEventsRef.current.slice(-200), { gameId: nextItem.gameId,
            eventId: nextItem.eventId, batchId: nextItem.batchId, createdAt: nextItem.createdAt,
            flowVersion: eventResult.flowVersion }];
          bumpWriteGeneration(nextItem.gameId); removeQueueItem(nextItem.id);
        } catch (error) {
          if (isGameViewOnly(nextItem.gameId)) {
            setSyncStatus("pending");
            return false;
          }
          if (error instanceof SyncRpcError && (error.conflict || error.status === 404)) {
            // Konflikt (veraltete Version) oder Spiel fehlt: Aenderung verwerfen, protokollieren, Stand neu laden.
            recordSyncConflict({ at: getNowIso(), item: nextItem, conflict: error.conflict, status: error.status });
            bumpWriteGeneration(nextItem.gameId); removeQueueItem(nextItem.id);
            droppedConflicts += 1;
            // Die ganze Benutzeraktion verwerfen: wartende Geschwister entfernen, gesendete zuruecknehmen.
            const siblings = queueRef.current.filter((item) => item.id !== nextItem.id && isSameSyncBatch(item, nextItem));
            siblings.forEach((item) => recordSyncConflict({ at: getNowIso(), item, conflict: { kind: "batch" } }));
            updateSyncQueue((queue) => queue.filter((item) => !siblings.some((sibling) => sibling.id === item.id)));
            droppedConflicts += siblings.length;
            const applied = appliedEventsRef.current.filter((entry) => isSameSyncBatch(entry, nextItem));
            appliedEventsRef.current = appliedEventsRef.current.filter((entry) => !applied.includes(entry));
            for (const entry of applied.reverse()) {
              await syncRepository.revokeEvent(entry.gameId, entry.eventId, entry.flowVersion,
                () => !isGameViewOnly(entry.gameId)).catch((revokeError) =>
                recordSyncConflict({ at: getNowIso(), item: entry, conflict: { kind: "revoke-failed" },
                  message: getErrorMessage(revokeError) }));
              droppedConflicts += 1;
            }
            continue;
          }
          if (import.meta.env.DEV) {
            console.debug("[sync-queue] failure", {
              message: getErrorMessage(error),
              queueLength: queueRef.current.length
            });
          }
          if (!isTransientSyncError(error)) {
            setErrorMessage(getErrorMessage(error));
          }
          setSyncStatus("error");
          scheduleSyncRetry();
          return false;
        }
      }

      if (droppedConflicts) {
        setSyncNotice(formatConflictNotice(droppedConflicts));
      }
      const pulled = await pullRemoteGames();
      if (pulled) {
        retryAttemptRef.current = 0;
        clearRetryTimer();
        setLastSyncAt(getNowIso());
        setSyncStatus("success");
      }
      return pulled;
    })().finally(() => {
      flushPromiseRef.current = null;
      if (flushAgainRef.current && queueRef.current.some((item) => !isGameViewOnly(item.gameId))) {
        flushAgainRef.current = false;
        void Promise.resolve().then(() => flushSyncQueueRef.current?.());
      }
    });

    return flushPromiseRef.current;
  }, [clearRetryTimer, isGameViewOnly, pullRemoteGames, removeQueueItem, scheduleSyncRetry, updateSyncQueue]);

  flushSyncQueueRef.current = flushSyncQueue;

  // Live-Ansicht = Spielseite im Modus View only (TV, ?tv=1, abgeschlossene Spiele, Zuschauer).
  const getLiveGameId = useCallback((): string | null => {
    if (typeof window === "undefined") return null;
    const { gameId } = getGameRouteAccess(window.location.hash, window.location.search);
    return gameId && isGameViewOnly(gameId) ? gameId : null;
  }, [isGameViewOnly]);

  const loadLiveGame = useCallback(async (gameId: string): Promise<void> => {
    const live = liveViewRef.current;
    if (live.gameId !== gameId) {
      liveViewRef.current = { gameId, since: getServerNow(), pause: null };
      setLiveViewPause(null);
    } else if (liveViewBlocksLoad(live.pause)) {
      return;
    }
    try {
      const entry = await remoteCacheRef.current.exclusive(() => gamesRepository.getGameEntryById(gameId));
      if (getLiveGameId() !== gameId || queueRef.current.some((item) => item.gameId === gameId)) return;
      if (entry === null) return;
      holdBlockedLocalGames();
      if (entry === "deleted") {
        // Auf einem anderen Geraet geloescht (Zeile mit deleted_at vorhanden).
        remoteCacheRef.current.entries.delete(gameId);
        const nextGames = gamesRef.current.filter((game) => game.id !== gameId);
        gamesRef.current = nextGames;
        setGames(nextGames);
        saveCachedGames(nextGames);
        return;
      }
      remoteCacheRef.current.entries.set(gameId, entry);
      const remoteGame = mapSupabaseGameToAppGame(entry.row, entry.events);
      const nextGames = sortGames([remoteGame, ...gamesRef.current.filter((game) => game.id !== gameId)]);
      gamesRef.current = nextGames;
      setGames(nextGames);
      saveCachedGames(nextGames);
      setLastSyncAt(getNowIso());
      setSyncStatus("success");
      const pause = getLiveViewPause(entry, liveViewRef.current.since, getServerNow());
      if (liveViewRef.current.gameId === gameId && pause !== liveViewRef.current.pause) {
        liveViewRef.current = { ...liveViewRef.current, pause };
        setLiveViewPause(pause);
      }
    } catch { /* Naechster Takt bzw. Realtime versucht es erneut; letzter Stand bleibt sichtbar. */ }
  }, [getLiveGameId]);

  const resumeLiveView = useCallback(() => {
    liveViewRef.current = { ...liveViewRef.current, since: getServerNow(), pause: null };
    setLiveViewPause(null);
    void refreshGamesRef.current?.();
  }, []);

  const refreshGames = useCallback(async () => {
    if (!canAttemptRemoteSync()) {
      setIsLoading(false);
      return;
    }

    const configError = getSupabaseConfigError();
    if (configError) {
      setErrorMessage(configError);
      setSyncStatus("error");
      setIsLoading(false);
      return;
    }

    lastPullStartRef.current = Date.now();
    const liveGameId = getLiveGameId();
    if (liveGameId && !queueRef.current.length) {
      // Live-Ansicht: nur das gezeigte Spiel laden, kein Vollabzug.
      setIsLoading(!gamesRef.current.some((game) => game.id === liveGameId));
      await loadLiveGame(liveGameId);
      setIsLoading(false);
      return;
    }
    setSyncStatus("syncing");
    setIsLoading(gamesRef.current.length === 0);
    if (queueRef.current.length) {
      await flushSyncQueue();
    } else {
      await pullRemoteGames();
    }
    setIsLoading(false);
  }, [flushSyncQueue, getLiveGameId, loadLiveGame, pullRemoteGames]);

  refreshGamesRef.current = refreshGames;

  const scheduleRemoteRefresh = useCallback(() => {
    if (!canAttemptRemoteSync()) {
      return;
    }

    if (refreshTimerRef.current) {
      window.clearTimeout(refreshTimerRef.current);
    }

    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void refreshGames();
    }, 600);
  }, [refreshGames]);
  scheduleRemoteRefreshRef.current = scheduleRemoteRefresh;

  useEffect(() => {
    void refreshGames();
  }, [refreshGames]);

  useEffect(() => {
    if (!syncQueue.length) {
      clearRetryTimer();
      return;
    }

    if (!canAttemptRemoteSync()) {
      setSyncStatus("offline");
      return;
    }

    setSyncStatus((currentStatus) =>
      currentStatus === "syncing" || currentStatus === "error" ? currentStatus : "pending"
    );
    void flushSyncQueue();
  }, [clearRetryTimer, flushSyncQueue, syncQueue.length]);

  useEffect(() => {
    const handleOnline = () => {
      retryAttemptRef.current = 0;
      remoteCacheRef.current.requestFull();
      void refreshGames();
    };
    const handleOffline = () => {
      setSyncStatus("idle");
    };
    const handleVisibilityChange = () => {
      if (document.hidden) {
        hiddenSinceRef.current = Date.now();
        if (resumeSyncTimerRef.current) {
          window.clearTimeout(resumeSyncTimerRef.current);
          resumeSyncTimerRef.current = null;
        }
        return;
      }

      if (resumeSyncTimerRef.current) {
        window.clearTimeout(resumeSyncTimerRef.current);
      }
      // Egress: Vollabzug nur nach mehr als 5 min im Hintergrund, sonst normaler Delta-Abgleich.
      if (shouldFullPullOnResume(hiddenSinceRef.current, Date.now())) remoteCacheRef.current.requestFull();
      hiddenSinceRef.current = null;
      resumeSyncTimerRef.current = window.setTimeout(() => {
        resumeSyncTimerRef.current = null;
        void refreshGames();
      }, RESUME_SYNC_DELAY_MS);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (resumeSyncTimerRef.current) {
        window.clearTimeout(resumeSyncTimerRef.current);
        resumeSyncTimerRef.current = null;
      }
    };
  }, [refreshGames]);

  useEffect(() => {
    const configError = getSupabaseConfigError();
    if (configError) {
      return;
    }

    const supabase = getSupabaseClient();
    // Realtime-Payload: betroffenes Spiel gezielt nachladen (Delta); ohne game_id Vollabzug.
    const onChange = (change?: unknown) => {
      const gameId = getRealtimeGameId(change);
      if (gameId) remoteCacheRef.current.markDirty(gameId); else remoteCacheRef.current.requestFull();
      const liveGameId = getLiveGameId();
      if (liveGameId && !shouldLiveViewFollowRealtime(liveGameId, gameId, liveViewRef.current.pause)) return;
      scheduleRemoteRefresh();
    };
    const channel = supabase
      .channel("match-tracker-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "games" }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, onChange)
      .subscribe((status) => {
        realtimeConnectedRef.current = status === "SUBSCRIBED";
        if (status === "SUBSCRIBED") {
          // (Wieder) verbunden: Meldungen koennen gefehlt haben -> Vollabzug (ausser direkt nach einem).
          if (getServerNow() - remoteCacheRef.current.lastFullAt > 10000) remoteCacheRef.current.requestFull();
          scheduleRemoteRefresh();
        }
      });

    return () => {
      realtimeConnectedRef.current = false;
      void supabase.removeChannel(channel);
    };
  }, [getLiveGameId, scheduleRemoteRefresh]);

  useEffect(() => {
    // Takt: 60 s mit Realtime, sonst 15 s; Live-Ansicht 30 s bzw. 10 s, angehalten nach Spielende/Inaktivitaet.
    const tick = () => {
      if (!canAttemptRemoteSync()) return;
      const liveGameId = getLiveGameId();
      if (liveGameId && liveViewRef.current.gameId === liveGameId && liveViewRef.current.pause) return;
      if (Date.now() - lastPullStartRef.current >= getPollIntervalMs(realtimeConnectedRef.current, Boolean(liveGameId))) {
        void refreshGames();
      }
    };
    const interval = window.setInterval(tick, 5000);
    // Wechsel Liste <-> Live-Ansicht: sofort passend laden.
    const onRoute = () => scheduleRemoteRefresh();
    window.addEventListener("hashchange", onRoute);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("hashchange", onRoute);
    };
  }, [getLiveGameId, refreshGames, scheduleRemoteRefresh]);

  useEffect(() => {
    // Moduswechsel (z. B. View only gewaehlt): Live-Ansicht sofort laden. Ersetzt das fruehere 3-s-Nachladen.
    if (getLiveGameId()) scheduleRemoteRefresh();
  }, [gameAccessModes, getLiveGameId, scheduleRemoteRefresh]);

  useEffect(
    () => () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
      }
      if (resumeSyncTimerRef.current) {
        window.clearTimeout(resumeSyncTimerRef.current);
      }
      if (retrySyncTimerRef.current) {
        window.clearTimeout(retrySyncTimerRef.current);
      }
    },
    []
  );

  const retrySync = useCallback(async () => {
    retryAttemptRef.current = 0;
    clearRetryTimer();
    if (!queueRef.current.length) {
      await refreshGames();
      return;
    }

    await flushSyncQueue();
  }, [clearRetryTimer, flushSyncQueue, refreshGames]);

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

  const runLockedMutation = useCallback(async <T,>(
    lockKey: string,
    operation: () => Promise<T>
  ): Promise<T | undefined> => {
    if (mutationLocksRef.current.has(lockKey)) {
      if (import.meta.env.DEV) {
        console.warn("[mutation-lock] skipped duplicate mutation", { lockKey });
      }
      return undefined;
    }

    mutationLocksRef.current.add(lockKey);
    try {
      return await runMutation(operation);
    } finally {
      mutationLocksRef.current.delete(lockKey);
    }
  }, [runMutation]);

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
    async (gameId: string, navigationByCaller = false) =>
      runMutation(async () => {
        if (shouldBlockGameWrite(gameId, "undoGameAction")) {
          return;
        }

        const undoStack = historyStacksByGameId[gameId]?.undo;
        const entry = undoStack?.[undoStack.length - 1];
        if (!entry) {
          return;
        }

        if (navigationByCaller && (entry.kind === "advance-turn" || entry.kind === "rewind-turn")) {
          // nur Verlaufseintrag verschieben
        } else if (entry.kind === "advance-turn") {
          const currentTurn = getLatestTurn(entry.afterGame);
          await rewindLastTurnRef.current(
            gameId,
            currentTurn ? { roundNumber: currentTurn.roundNumber, turnNumber: currentTurn.turnNumber } : undefined,
            true,
            false
          );
        } else if (entry.kind === "rewind-turn") {
          const currentTurn = getLatestTurn(entry.afterGame);
          await advanceGameRef.current(
            gameId,
            currentTurn ? { roundNumber: currentTurn.roundNumber, turnNumber: currentTurn.turnNumber } : undefined,
            true,
            false
          );
        } else {
          replaceGame(entry.beforeGame);
          enqueueSnapshotSync(entry.afterGame, entry.beforeGame);
        }
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
    [enqueueSnapshotSync, flushSyncQueue, getLatestTurn, historyStacksByGameId, replaceGame, runMutation, shouldBlockGameWrite]
  );

  const redoGameAction = useCallback(
    async (gameId: string, navigationByCaller = false) =>
      runMutation(async () => {
        if (shouldBlockGameWrite(gameId, "redoGameAction")) {
          return;
        }

        const redoStack = historyStacksByGameId[gameId]?.redo;
        const entry = redoStack?.[redoStack.length - 1];
        if (!entry) {
          return;
        }

        if (navigationByCaller && (entry.kind === "advance-turn" || entry.kind === "rewind-turn")) {
          // nur Verlaufseintrag verschieben
        } else if (entry.kind === "advance-turn") {
          const currentTurn = getLatestTurn(entry.beforeGame);
          await advanceGameRef.current(
            gameId,
            currentTurn ? { roundNumber: currentTurn.roundNumber, turnNumber: currentTurn.turnNumber } : undefined,
            true,
            false
          );
        } else if (entry.kind === "rewind-turn") {
          const currentTurn = getLatestTurn(entry.beforeGame);
          await rewindLastTurnRef.current(
            gameId,
            currentTurn ? { roundNumber: currentTurn.roundNumber, turnNumber: currentTurn.turnNumber } : undefined,
            true,
            false
          );
        } else {
          replaceGame(entry.afterGame);
          enqueueSnapshotSync(entry.beforeGame, entry.afterGame);
        }
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
    [enqueueSnapshotSync, flushSyncQueue, getLatestTurn, historyStacksByGameId, replaceGame, runMutation, shouldBlockGameWrite]
  );

  const createGame = useCallback(
    async (input: CreateGameInput): Promise<Game> =>
      runMutation(async () => {
        const createdGame = createLocalGame(input);
        setGameAccessMode(createdGame.id, "edit");
        // Wer das Spiel anlegt, bearbeitet es: Wahl für dieses Gerät merken (kein Dialog nach Neuladen).
        rememberAccessMode(createdGame.id, "edit");
        replaceGame(createdGame);
        // Lokales Anlegen zaehlt als eigenes Schreiben: laufende (aeltere) Abgleiche werfen das Spiel nicht weg.
        locallyCreatedSaveGenerationRef.current.set(createdGame.id, 0);
        bumpWriteGeneration(createdGame.id);
        enqueueGameUpsert(createdGame.id);
        // Start-Events (game-start, setup-start) mit der Spielzeile speichern. Fehlerbild vorher: Sie lagen nur lokal;
        // der erste Abgleich nach dem Speichern ersetzte das Spiel durch den Serverstand ohne Events, die laufende
        // Aufstellung wurde zu "Bereit" und es erschien "Timer gestoppt" (die Aufstellungszeit ging verloren).
        createdGame.timeEvents.forEach((event) => enqueueEventUpsert(createdGame.id, event.id));
        void flushSyncQueue();
        return createdGame;
      }),
    [enqueueEventUpsert, enqueueGameUpsert, flushSyncQueue, replaceGame, runMutation, setGameAccessMode]
  );

  const updateGameDetails = useCallback(
    async (gameId: string, input: CreateGameInput) =>
      runMutation(async () => {
        if (shouldBlockGameWrite(gameId, "updateGameDetails")) {
          return;
        }

        const game = getGame(gameId);
        if (!game) {
          throw new Error("Spiel nicht gefunden.");
        }

        commitGameSnapshot("Spieldetails", game, updateLocalGameDetails(game, input));
        void flushSyncQueue();
      }),
    [commitGameSnapshot, flushSyncQueue, getGame, runMutation, shouldBlockGameWrite]
  );

  const setAutoCommandPointEnabled = useCallback(
    async (gameId: string, enabled: boolean) =>
      runMutation(async () => {
        if (shouldBlockGameWrite(gameId, "setAutoCommandPointEnabled")) {
          return;
        }

        const game = getGame(gameId);
        if (!game) {
          throw new Error("Spiel nicht gefunden.");
        }

        if (game.autoCommandPointOn === enabled) {
          return;
        }

        commitGameSnapshot("Optionen", game, {
          ...game,
          autoCommandPointOn: enabled
        });
        void flushSyncQueue();
      }),
    [commitGameSnapshot, flushSyncQueue, getGame, runMutation, shouldBlockGameWrite]
  );

  const updateStatsEligibilityOverrides = useCallback(
    async (gameId: string, overrides: StatsEligibilityOverrides) =>
      runMutation(async () => {
        if (shouldBlockGameWrite(gameId, "updateStatsEligibilityOverrides")) {
          return;
        }

        const game = getGame(gameId);
        if (!game) {
          throw new Error("Spiel nicht gefunden.");
        }

        const nextGame = {
          ...game,
          statsEligibilityOverrides: overrides
        };
        commitGameSnapshot("Statistik-Wertung", game, nextGame);
        void flushSyncQueue();
      }),
    [commitGameSnapshot, flushSyncQueue, getGame, runMutation, shouldBlockGameWrite]
  );

  const setTimerCorrections = useCallback(
    async ({ gameId, turnRef, turnMs, corrections }: TimerCorrectionInput) =>
      runMutation(async () => {
        if (shouldBlockGameWrite(gameId, "setTimerCorrections")) {
          return;
        }

        const game = getGame(gameId);
        if (!game) {
          throw new Error("Spiel nicht gefunden.");
        }

        if (import.meta.env.DEV) {
          console.warn("[timer-corrections] Ignored write. Edit the affected time event in Verlauf instead.", {
            gameId,
            turnRef,
            turnMs,
            corrections
          });
        }
      }),
    [getGame, runMutation, shouldBlockGameWrite]
  );

  const resetAllGameTimers = useCallback(
    async (gameId: string) =>
      runMutation(async () => {
        if (shouldBlockGameWrite(gameId, "resetAllGameTimers")) {
          return;
        }

        const game = getGame(gameId);
        if (!game) {
          throw new Error("Spiel nicht gefunden.");
        }

        if (import.meta.env.DEV) {
          console.warn("[timer-corrections] Ignored reset. Edit or delete time events in Verlauf instead.", {
            gameId
          });
        }
      }),
    [getGame, runMutation, shouldBlockGameWrite]
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
        if (shouldBlockGameWrite(gameId, "addScoreEvent")) {
          return;
        }

        const game = getGame(gameId);
        if (!game) {
          throw new Error("Spiel nicht gefunden.");
        }

        const currentTotal =
          scoreType === "primary"
            ? getPlayerPrimaryTotal(game, playerId)
            : scoreType === "secondary"
              ? getPlayerSecondaryTotal(game, playerId)
              : scoreType === "challenge"
                ? getPlayerChallengeTotal(game, playerId)
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
    [commitGameSnapshot, flushSyncQueue, getGame, runMutation, shouldBlockGameWrite]
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
        if (shouldBlockGameWrite(gameId, "addCommandPointEvent")) {
          return;
        }

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
    [commitGameSnapshot, flushSyncQueue, getGame, runMutation, shouldBlockGameWrite]
  );

  const addNoteEvent = useCallback(
    async ({ gameId, playerId, note, roundNumber, turnNumber }: EventPayload) =>
      runMutation(async () => {
        if (shouldBlockGameWrite(gameId, "addNoteEvent")) {
          return;
        }

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
    [commitGameSnapshot, flushSyncQueue, getGame, runMutation, shouldBlockGameWrite]
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
      label = "Zeit geändert",
      historyTurnRef?: TurnRef | null,
      kind: GameHistoryEntry["kind"] = "snapshot",
      recordHistory = true,
      transformNextGame?: (nextGame: Game) => Game
    ) => {
      if (!timeEvents.length) {
        return game;
      }

      const nextGame = transformNextGame ? transformNextGame(appendLocalTimeEvents(game, timeEvents)) : appendLocalTimeEvents(game, timeEvents);
      return commitGameSnapshot(getTimeHistoryLabel(label, historyTurnRef), game, nextGame, kind, recordHistory);
    },
    [commitGameSnapshot]
  );

  const advanceGame = useCallback(
    async (gameId: string, turnRef?: TurnRef, keepTimerRunning = false, recordHistory = true) =>
      runLockedMutation(`advance:${gameId}`, async () => {
        if (shouldBlockGameWrite(gameId, "advanceGame")) {
          return;
        }

        const game = getGame(gameId);
        if (
          !game ||
          game.status === "completed" ||
          game.endedAt ||
          game.timeEvents.some((event) => event.action === "game-end")
        ) {
          return;
        }

        const now = getNowIso();
        const isSetupTurnRef = turnRef?.roundNumber === 0 && turnRef?.turnNumber === 0;
        const setupRound = game.rounds.find((round) => round.roundNumber === 1);
        const setupTurn = setupRound?.turns[0];
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
        const applyAutoCommandPoints = (nextGame: Game, targetTurn?: TurnRef | null): Game => {
          if (!game.autoCommandPointOn || !targetTurn || targetTurn.roundNumber <= 0) {
            return nextGame;
          }

          const turnKey = `${targetTurn.roundNumber}:${targetTurn.turnNumber}`;
          if (nextGame.autoCommandPointAwards[turnKey]) {
            return nextGame;
          }

          const nextState = nextGame.players.reduce(
            (accumulator, player) =>
              appendLocalCommandPointEvent(accumulator, {
                playerId: player.id,
                cpType: "gained",
                value: 1,
                roundNumber: targetTurn.roundNumber,
                turnNumber: targetTurn.turnNumber,
                createdAt: now
              }),
            nextGame
          );

          return {
            ...nextState,
            autoCommandPointAwards: {
              ...nextState.autoCommandPointAwards,
              [turnKey]: true
            }
          };
        };
        const pushGameStartIfMissing = () => {
          if (game.timeEvents.some((event) => event.action === "game-start")) {
            return;
          }

          eventsToAdd.push({
            playerId: game.startingPlayerId,
            action: "game-start",
            createdAt: getMissingGameStartCreatedAt(game, now)
          });
        };
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
          pushGameStartIfMissing();

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

        if (isSetupTurnRef) {
          if (isSetupActive(game)) {
            eventsToAdd.push({
              action: "setup-end",
              createdAt: now
            });
          }

          pushGameStartIfMissing();

          if (setupRound && !setupRound.startedAt) {
            eventsToAdd.push({
              playerId: setupTurn?.playerId ?? game.startingPlayerId,
              roundNumber: setupRound.roundNumber,
              action: "round-start",
              createdAt: now
            });
          }

          // Navigation aendert den Timer-Zustand nie (Tim 22.10.): laeuft er, laeuft er in R1Z1 weiter; ist er gestoppt,
          // bleibt er gestoppt (neuer Zug = turn-start + turn-pause, vorhandener Zug bekommt kein Event).
          const firstTurnPlayerId = setupTurn?.playerId ?? game.startingPlayerId;
          if (!setupTurn || !setupTurn.timing.startedAt) {
            eventsToAdd.push({
              playerId: firstTurnPlayerId,
              roundNumber: 1,
              turnNumber: 1,
              action: "turn-start",
              createdAt: now
            });
            if (!keepTimerRunning) {
              eventsToAdd.push({
                playerId: firstTurnPlayerId,
                roundNumber: 1,
                turnNumber: 1,
                action: "turn-pause",
                createdAt: now
              });
            }
          } else if (keepTimerRunning && (setupTurn.timing.endedAt || isTurnPaused(setupTurn))) {
            eventsToAdd.push({
              playerId: setupTurn.playerId,
              roundNumber: setupTurn.roundNumber,
              turnNumber: setupTurn.turnNumber,
              action: "turn-resume",
              createdAt: now
            });
          }

          if (eventsToAdd.length) {
            // Verlaufs-Label nennt wie sonst den VERLASSENEN Abschnitt (hier die Aufstellung), nicht das Ziel R1Z1.
            enqueueTimeEvents(
              game,
              eventsToAdd,
              "Weiter Aufstellung",
              null,
              recordHistory ? "advance-turn" : "snapshot",
              recordHistory,
              (nextGame) =>
                applyAutoCommandPoints(nextGame, {
                  roundNumber: 1,
                  turnNumber: 1
                })
            );
            void flushSyncQueue();
          }
          return;
        }

        if (nextExistingTurn) {
          if (keepTimerRunning) {
            pushPauseForRunningTurns(getTurnKey(nextExistingTurn));
            pushStartStateForTurn(nextExistingTurn, true);
            enqueueTimeEvents(
              game,
              eventsToAdd,
              "Weiter",
              currentTurn ?? nextExistingTurn,
              recordHistory ? "advance-turn" : "snapshot",
              recordHistory,
              (nextGame) => applyAutoCommandPoints(nextGame, nextExistingTurn)
            );
            void flushSyncQueue();
          }
          return;
        }

        if (!currentRound) {
          if (isSetupActive(game)) {
            eventsToAdd.push({
              action: "setup-end",
              createdAt: now
            });

            eventsToAdd.push(
              {
                playerId: game.startingPlayerId,
                roundNumber: 1,
                action: "round-start",
                createdAt: now
              },
              {
                playerId: game.startingPlayerId,
                roundNumber: 1,
                turnNumber: 1,
                action: "turn-start",
                createdAt: now
              }
            );

            if (!keepTimerRunning) {
              eventsToAdd.push({
                playerId: game.startingPlayerId,
                roundNumber: 1,
                turnNumber: 1,
                action: "turn-pause",
                createdAt: now
              });
            }

            // Label nennt den verlassenen Abschnitt (Aufstellung), wie "Weiter R1 Z1" = aus R1Z1 heraus.
            enqueueTimeEvents(
              game,
              eventsToAdd,
              "Weiter Aufstellung",
              null,
              recordHistory ? "advance-turn" : "snapshot",
              recordHistory,
              (nextGame) =>
                applyAutoCommandPoints(nextGame, {
                  roundNumber: 1,
                  turnNumber: 1
                })
            );
            void flushSyncQueue();
            return;
          }

          const firstRoundNumber = 1;
          const shouldRun = keepTimerRunning;
          eventsToAdd.push(
            {
              playerId: game.startingPlayerId,
              action: "game-start",
              createdAt: getMissingGameStartCreatedAt(game, now)
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

          enqueueTimeEvents(
            game,
            eventsToAdd,
            "Weiter",
            {
              roundNumber: firstRoundNumber,
              turnNumber: 1
            },
            recordHistory ? "advance-turn" : "snapshot",
            recordHistory
          );
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

          eventsToAdd.push({
            playerId: currentTurn?.playerId ?? game.currentPlayerId,
            action: "game-end",
            createdAt: now
          });
        };

        const currentRoundHasTwoTurns = currentRound.turns.length >= 2 && (currentTurn?.turnNumber ?? 0) >= 2;
        if (currentRound.roundNumber >= MAX_ROUNDS && currentRoundHasTwoTurns) {
          closeCurrentGame();
          enqueueTimeEvents(game, eventsToAdd, "Spiel beenden", undefined, "snapshot", recordHistory);
          void flushSyncQueue();
          return;
        }

        const shouldRunNextTurn = keepTimerRunning;
        const nextTurnRef: TurnRef = currentRoundHasTwoTurns
          ? { roundNumber: currentRound.roundNumber + 1, turnNumber: 1 }
          : { roundNumber: currentRound.roundNumber, turnNumber: 2 };
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

          enqueueTimeEvents(
            game,
            eventsToAdd,
            "Weiter",
            currentTurn ?? nextTurnRef,
            recordHistory ? "advance-turn" : "snapshot",
            recordHistory,
            (nextGame) => applyAutoCommandPoints(nextGame, nextTurnRef)
          );
        void flushSyncQueue();
      }),
    [enqueueTimeEvents, flushSyncQueue, getGame, getNextTurnByRef, getTurnByRef, runLockedMutation, shouldBlockGameWrite]
  );

  const rewindLastTurn = useCallback(
    async (gameId: string, turnRef?: TurnRef, keepTimerRunning = false, recordHistory = true) =>
      runMutation(async () => {
        if (shouldBlockGameWrite(gameId, "rewindLastTurn")) {
          return;
        }

        const game = getGame(gameId);
        if (!game || game.status === "completed") {
          return;
        }

        const targetTurn = getPreviousTurnByRef(game, turnRef);
        const currentTurn = getTurnByRef(game, turnRef);
        const shouldRewindToSetup =
          !targetTurn &&
          Boolean(currentTurn) &&
          currentTurn?.roundNumber === 1 &&
          currentTurn.turnNumber === 1 &&
          game.timeEvents.some((event) => event.action === "setup-start");

        if ((!targetTurn && !shouldRewindToSetup) || !keepTimerRunning) {
          return;
        }

        const now = getNowIso();
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
          if (!shouldRewindToSetup && getTurnKey(turn) === getTurnKey(targetTurn)) {
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

        if (shouldRewindToSetup) {
          if (!isSetupRunning(game)) {
            eventsToAdd.push({
              action: "setup-start",
              createdAt: now
            });
          }
        } else if (targetTurn && !targetTurn.timing.startedAt) {
          eventsToAdd.push({
            playerId: targetTurn.playerId,
            roundNumber: targetTurn.roundNumber,
            turnNumber: targetTurn.turnNumber,
            action: "turn-start",
            createdAt: now
          });
        } else if (
          targetTurn &&
          (targetTurn.timing.endedAt ||
            isTurnPaused(targetTurn) ||
            getTurnKey(currentTurn) !== getTurnKey(targetTurn))
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
          enqueueTimeEvents(
            game,
            eventsToAdd,
            "Zurück",
            currentTurn ?? targetTurn ?? null,
            recordHistory ? "rewind-turn" : "snapshot",
            recordHistory
          );
          void flushSyncQueue();
        }
      }),
    [enqueueTimeEvents, flushSyncQueue, getGame, getPreviousTurnByRef, getTurnByRef, runMutation, shouldBlockGameWrite]
  );

  useEffect(() => {
    advanceGameRef.current = advanceGame;
    rewindLastTurnRef.current = rewindLastTurn;
  }, [advanceGame, rewindLastTurn]);

  const pauseActiveTimer = useCallback(
    async (gameId: string, turnRef?: TurnRef) =>
      runMutation(async () => {
        if (shouldBlockGameWrite(gameId, "pauseActiveTimer")) {
          return;
        }

        const game = getGame(gameId);
        if (!game || game.status === "completed") {
          return;
        }

        if (!turnRef && isSetupRunning(game)) {
          enqueueTimeEvents(game, [{ action: "setup-pause" }], "Timer aus");
          void flushSyncQueue();
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
    [enqueueTimeEvents, flushSyncQueue, getGame, getTurnByRef, runMutation, shouldBlockGameWrite]
  );

  const startGameTimer = useCallback(
    async (gameId: string, turnRef?: TurnRef) =>
      runMutation(async () => {
        if (shouldBlockGameWrite(gameId, "startGameTimer")) {
          return;
        }

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
            createdAt: getMissingGameStartCreatedAt(game, now)
          });
        }

        if (!turnRef && game.timeEvents.some((event) => event.action === "setup-start")) {
          if (isSetupPaused(game)) {
            eventsToAdd.push({
              action: "setup-resume",
              createdAt: now
            });
          } else if (!isSetupRunning(game)) {
            eventsToAdd.push({
              action: "setup-start",
              createdAt: now
            });
          }
        } else if (targetTurn) {
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
          if (!targetRound) {
            if (isSetupPaused(game)) {
              eventsToAdd.push({
                action: "setup-resume",
                createdAt: now
              });
            } else if (!isSetupActive(game)) {
              eventsToAdd.push({
                action: "setup-start",
                createdAt: now
              });
            }

            if (eventsToAdd.length) {
              enqueueTimeEvents(game, eventsToAdd, "Timer an");
              void flushSyncQueue();
            }
            return;
          }

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
    [enqueueTimeEvents, flushSyncQueue, getGame, getTurnByRef, runMutation, shouldBlockGameWrite]
  );

  const startTimeout = useCallback(
    async (gameId: string, turnRef?: TurnRef) =>
      runMutation(async () => {
        if (shouldBlockGameWrite(gameId, "startTimeout")) {
          return;
        }

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
    [enqueueTimeEvents, flushSyncQueue, getGame, getTurnByRef, runMutation, shouldBlockGameWrite]
  );

  const endTimeout = useCallback(
    async (gameId: string, turnRef?: TurnRef) =>
      runMutation(async () => {
        if (shouldBlockGameWrite(gameId, "endTimeout")) {
          return;
        }

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

        // Ziel ist der angewaehlte Zug; ein beendeter Zug wird dafuer wieder geoeffnet (Auswertung, Tim 22.10.).
        if (targetTurn && targetTurn.timing.startedAt && (targetTurn.timing.endedAt || isTurnPaused(targetTurn))) {
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
    [enqueueTimeEvents, flushSyncQueue, getGame, getTurnByRef, runMutation, shouldBlockGameWrite]
  );

  const reopenGame = useCallback(
    async (gameId: string) =>
      runMutation(async () => {
        if (shouldBlockGameWrite(gameId, "reopenGame")) return;
        const game = getGame(gameId);
        if (
          !game ||
          (
            game.status !== "completed" &&
            !game.endedAt &&
            !game.timeEvents.some((event) => event.action === "game-end")
          )
        ) {
          return;
        }

        const latestGameEndEvent = [...game.timeEvents]
          .filter((event) => event.action === "game-end")
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];

        const nextGame = latestGameEndEvent
          ? removeLocalEvent(game, latestGameEndEvent.id)
          : syncDerivedGameState({
              ...game,
              status: "active",
              endedAt: undefined,
              finishReason: undefined
            });

        const syncedGame = replaceGame(nextGame);
        updateSyncQueue((currentQueue) =>
          enqueueSyncQueueItem(
            currentQueue,
            createReopenGameSyncQueueItem(gameId, getNowIso(), latestGameEndEvent?.id)
          )
        );
        recordHistoryAction("Spiel wieder eröffnet", game, syncedGame);
        void flushSyncQueue();
      }),
    [flushSyncQueue, getGame, recordHistoryAction, replaceGame, runMutation, shouldBlockGameWrite, updateSyncQueue]
  );

  const updateGameEvent = useCallback(
    async (gameId: string, eventId: string, patch: UpdateSupabaseEventPayload) =>
      runMutation(async () => {
        if (shouldBlockGameWrite(gameId, "updateGameEvent")) {
          return;
        }

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
      runMutation,
      shouldBlockGameWrite
    ]
  );

  const deleteGameEvent = useCallback(
    async (gameId: string, eventId: string) =>
      runMutation(async () => {
        if (shouldBlockGameWrite(gameId, "deleteGameEvent")) {
          return;
        }

        const currentGame = getGame(gameId);
        if (!currentGame) {
          throw new Error("Spiel nicht gefunden.");
        }

        const label = `Eintrag gelöscht: ${getEventActionLabel(currentGame, eventId)}`;
        const nextGame = removeLocalEvent(currentGame, eventId);
        commitGameSnapshot(label, currentGame, nextGame);
        void flushSyncQueue();
      }),
    [commitGameSnapshot, flushSyncQueue, getGame, runMutation, shouldBlockGameWrite]
  );

  const finishGame = useCallback(
    async (gameId: string, finishReason: GameFinishReason = "completed") =>
      runLockedMutation(`finish:${gameId}`, async () => {
        if (shouldBlockGameWrite(gameId, "finishGame")) {
          return;
        }

        const game = getGame(gameId);
        if (!game) {
          throw new Error("Spiel nicht gefunden.");
        }
        if (game.status === "completed" || game.endedAt || game.timeEvents.some((event) => event.action === "game-end")) {
          return;
        }

        const latestRound = getLatestRound(game);
        const latestTurn = getLatestTurn(game);
        const eventsToAdd: Array<{
          action: TimeEventAction;
          playerId?: PlayerId;
          roundNumber?: number;
          turnNumber?: number;
        }> = [];

        if (isSetupActive(game)) {
          eventsToAdd.push({
            action: "setup-end"
          });
        }

        game.rounds
          .flatMap((round) => round.turns)
          .filter((turn) => turn.timing.startedAt && !turn.timing.endedAt)
          .forEach((turn) => {
            eventsToAdd.push({
              playerId: turn.playerId,
              roundNumber: turn.roundNumber,
              turnNumber: turn.turnNumber,
              action: "turn-end"
            });
          });

        if (
          latestTurn &&
          latestTurn.timing.startedAt &&
          !latestTurn.timing.endedAt &&
          !eventsToAdd.some(
            (event) =>
              event.action === "turn-end" &&
              event.roundNumber === latestTurn.roundNumber &&
              event.turnNumber === latestTurn.turnNumber
          )
        ) {
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

        const nextGame = {
          ...appendLocalTimeEvents(game, eventsToAdd),
          finishReason
        };
        commitGameSnapshot("Spiel beenden", game, nextGame);
        void flushSyncQueue();
      }),
    [commitGameSnapshot, flushSyncQueue, getGame, runLockedMutation, shouldBlockGameWrite]
  );

  const deleteGame = useCallback(
    async (gameId: string) =>
      runMutation(async () => {
        if (shouldBlockGameWrite(gameId, "deleteGame")) return;
        removeGameLocally(gameId);
        updateSyncQueue((currentQueue) =>
          enqueueSyncQueueItem(currentQueue, createGameSyncQueueItem("delete-game", gameId, getNowIso()))
        );
        void flushSyncQueue();
      }),
    [flushSyncQueue, removeGameLocally, runMutation, shouldBlockGameWrite, updateSyncQueue]
  );

  const importGames = useCallback(
    async (importedGames: Game[]) =>
      runMutation(async () => {
        importedGames.forEach((game) => {
          if (shouldBlockGameWrite(game.id, "importGames")) return;
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
    [enqueueEventUpsert, enqueueGameUpsert, flushSyncQueue, replaceGame, runMutation, shouldBlockGameWrite]
  );

  const exportGames = useCallback(() => gamesRef.current, []);
  const clearError = useCallback(() => setErrorMessage(null), []);
  const dismissSyncNotice = useCallback(() => setSyncNotice(null), []);

  // Schema- und Build-Pruefung: alte gecachte App-Versionen erkennen und neu laden.
  useEffect(() => {
    if (typeof window === "undefined" || getSupabaseConfigError()) return;
    const currentBuild = String(import.meta.env.VITE_APP_BUILD ?? "dev");
    const reloadKey = "match-tracker.update-reload";
    const reloadOnce = (reason: string) => {
      if (window.sessionStorage?.getItem(reloadKey) === reason) return false;
      window.sessionStorage?.setItem(reloadKey, reason);
      window.location.reload();
      return true;
    };
    let cancelled = false;
    const check = async () => {
      if (cancelled || !canAttemptRemoteSync()) return;
      const info = await syncRepository.getSchemaInfo().catch(() => null);
      const schemaDecision = decideSchemaUpdate(info?.min_app_schema ?? null,
        window.sessionStorage?.getItem(reloadKey) === "schema");
      if (schemaDecision === "reload" && !queueRef.current.length && reloadOnce("schema")) return;
      if (schemaDecision !== "ok") {
        setAppUpdateNotice(`Diese App-Version (Schema ${APP_SCHEMA_VERSION}) ist veraltet. Bitte neu laden.`);
        return;
      }
      const liveBuild = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { build?: string } | null) => body?.build ?? null)
        .catch(() => null);
      const buildDecision = decideBuildUpdate(currentBuild, liveBuild, queueRef.current.length);
      if (buildDecision === "reload" && reloadOnce(`build:${liveBuild}`)) return;
      setAppUpdateNotice(buildDecision === "notice"
        ? "Neue App-Version verfügbar. Sie wird geladen, sobald alle Änderungen synchronisiert sind." : null);
    };
    void check();
    const interval = window.setInterval(() => void check(), 120000);
    const onVisible = () => { if (!document.hidden) void check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; window.clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  const value = useMemo<GameStoreValue>(
    () => ({
      games,
      isLoading,
      isMutating,
      errorMessage,
      syncNotice,
      appUpdateNotice,
      dismissSyncNotice,
      syncStatus,
      lastSyncAt,
      pendingSyncCount: syncQueue.length,
      retrySync,
      getGameAccessMode: getGameAccessModeForId,
      isGameViewOnly,
      setGameAccessMode,
      createGame,
      getGame,
      refreshGames,
      liveViewPause,
      resumeLiveView,
      updateGameDetails,
      updateStatsEligibilityOverrides,
      setAutoCommandPointEnabled,
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
      syncNotice,
      appUpdateNotice,
      dismissSyncNotice,
      exportGames,
      finishGame,
      gameAccessModes,
      games,
      getGameAccessModeForId,
      getGame,
      importGames,
      isLoading,
      isMutating,
      isGameViewOnly,
      lastSyncAt,
      pauseActiveTimer,
      endTimeout,
      retrySync,
      refreshGames,
      liveViewPause,
      resumeLiveView,
      setAutoCommandPointEnabled,
      setGameAccessMode,
      setTimerCorrections,
      resetAllGameTimers,
      reopenGame,
      rewindLastTurn,
      redoGameAction,
      startTimeout,
      startGameTimer,
      syncStatus,
      updateStatsEligibilityOverrides,
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
