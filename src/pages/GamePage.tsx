import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { FloatingMenu } from "../components/FloatingMenu";
import { GameMetaFields } from "../components/GameMetaFields";
import { GameOverview } from "../components/GameOverview";
import { GamePlayerFields } from "../components/GamePlayerFields";
import { Layout } from "../components/Layout";
import { PasswordDialog } from "../components/PasswordDialog";
import { PlayerScoreboard } from "../components/PlayerScoreboard";
import { QuickAdjustControls } from "../components/QuickAdjustControls";
import { useGameStore } from "../store/GameStore";
import type { CreateGameInput, Game, GameFinishReason, PlayerId, ScoreType, TimeEventAction } from "../types/game";
import { buildGameFormOptions, getPlayerArmyComboKey } from "../utils/gameFormOptions";
import {
  getCurrentRoundNumber,
  getGameDurationMs,
  getLatestTurn,
  getPlayerChallengeTotal,
  getPlayerCommandPoints,
  getPlayerPrimaryTotal,
  getPlayerSecondaryTotal,
  getSetupDurationMs,
  getTurnDurationMs,
  isSetupActive,
  isSetupPaused,
  isSetupRunning,
  isTimeoutActive,
  isTurnPaused
} from "../utils/gameCalculations";
import {
  getDisplayedRoundTurns,
  getTimerFocusTurn,
  shouldRunTimerRenderTicker
} from "../utils/timerFocus";
import { isGameAdminPassword } from "../utils/gameSecurity";
import { shouldAskGameAccessMode } from "../utils/gameAccessMode";
import { formatClockTime, formatClockTimeWithSeconds, formatDateLabel, formatDuration } from "../utils/time";

interface GamePageProps {
  gameId: string;
  onBack: () => void;
  forceOverview?: boolean;
}

type EditableEventFilterType =
  | "all"
  | "time"
  | "cp-gained"
  | "cp-spent"
  | "primary"
  | "secondary"
  | "challenge"
  | "legacy-total"
  | "note";

interface EditableEventItem {
  id: string;
  playerId?: string;
  playerName: string;
  kind: "cp" | "score" | "note" | "time";
  eventType: Exclude<EditableEventFilterType, "all">;
  label: string;
  value?: number;
  displayValue?: number;
  note?: string;
  roundNumber?: number;
  turnNumber?: number;
  createdAt: string;
}

interface ScoreLimitWarning {
  id: string;
  playerName: string;
  scoreLabel: string;
  thresholds: number[];
  total: number;
}

const SCORE_LIMITS: Record<ScoreType, number[]> = {
  primary: [50],
  secondary: [20],
  challenge: [12],
  "legacy-total": []
};
const COMBINED_PRIMARY_SECONDARY_LIMITS = [90];
const SETUP_TURN_KEY = "setup";
const SETUP_TURN_REF = {
  roundNumber: 0,
  turnNumber: 0
};

const createGameFormState = (game: Game): CreateGameInput => ({
  playerOneName: game.players[0].name,
  playerOneArmy: game.players[0].army.name,
  playerOneDetachment: game.players[0].army.detachment,
  playerTwoName: game.players[1].name,
  playerTwoArmy: game.players[1].army.name,
  playerTwoDetachment: game.players[1].army.detachment,
  gamePoints: game.gamePoints,
  scheduledDate: game.scheduledDate,
  scheduledTime: game.scheduledTime,
  deployment: game.deployment,
  primaryMission: game.primaryMission,
  defenderSlot: game.defenderPlayerId === game.players[0].id ? "player1" : game.defenderPlayerId === game.players[1].id ? "player2" : "",
  startingSlot: game.startingPlayerId === game.players[0].id ? "player1" : game.startingPlayerId === game.players[1].id ? "player2" : ""
});

const getRoundSurfaceClassName = (roundNumber?: number) =>
  roundNumber && roundNumber % 2 === 0 ? "round-surface round-surface--even" : "round-surface round-surface--odd";

const getScoreLimitLabel = (scoreType: ScoreType): string =>
  scoreType === "primary"
    ? "Primary"
    : scoreType === "secondary"
      ? "Secondary"
      : scoreType === "challenge"
        ? "Challenge"
        : "Gesamt";

const getTimeEventActionLabel = (action: TimeEventAction): string => {
  const labels: Record<TimeEventAction, string> = {
    "game-start": "Spiel Start",
    "game-end": "Spiel Ende",
    "setup-start": "Aufstellung Start",
    "setup-end": "Aufstellung Ende",
    "setup-pause": "Aufstellung Pause",
    "setup-resume": "Aufstellung Weiter",
    "round-start": "Runde Start",
    "round-end": "Runde Ende",
    "turn-start": "Zug Start",
    "turn-end": "Zug Ende",
    "turn-pause": "Zug Pause",
    "turn-resume": "Zug Weiter",
    "timeout-start": "Time-out Start",
    "timeout-end": "Time-out Ende"
  };

  return labels[action];
};

const toDateTimeLocalInput = (iso?: string): string => {
  if (!iso) {
    return "";
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 19);
};

const fromDateTimeLocalInput = (value: string, fallbackIso: string): string => {
  if (!value) {
    return fallbackIso;
  }

  const normalizedValue = value.length === 16 ? `${value}:00` : value;
  const date = new Date(normalizedValue);
  return Number.isNaN(date.getTime()) ? fallbackIso : date.toISOString();
};

const getCrossedScoreLimits = (
  scoreType: ScoreType,
  previousScore: number,
  nextScore: number
): number[] =>
  getCrossedThresholds(SCORE_LIMITS[scoreType], previousScore, nextScore);

const getCrossedThresholds = (
  thresholds: number[],
  previousScore: number,
  nextScore: number
): number[] =>
  thresholds.filter(
    (threshold) => previousScore < threshold && nextScore >= threshold
  );

export const GamePage = ({ gameId, onBack, forceOverview = false }: GamePageProps) => {
  const {
    games,
    getGame,
    isLoading,
    isMutating,
    errorMessage,
    clearError,
    advanceGame,
    rewindLastTurn,
    addScoreEvent,
    addCommandPointEvent,
    addNoteEvent,
    updateGameEvent,
    deleteGameEvent,
    updateGameDetails,
    setAutoCommandPointEnabled,
    pauseActiveTimer,
    startGameTimer,
    startTimeout,
    endTimeout,
    reopenGame,
    finishGame,
    deleteGame,
    undoGameAction,
    redoGameAction,
    getUndoActionLabel,
    getRedoActionLabel,
    getGameAccessMode,
    isGameViewOnly,
    setGameAccessMode
  } = useGameStore();
  const [, setTick] = useState(0);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [editingNote, setEditingNote] = useState("");
  const [isEditingGame, setIsEditingGame] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [noteDialogPlayerId, setNoteDialogPlayerId] = useState<PlayerId | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [entriesOpen, setEntriesOpen] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [finishDialogOpen, setFinishDialogOpen] = useState(false);
  const [actionFlash, setActionFlash] = useState<"cp" | "score" | null>(null);
  const [scoreLimitWarning, setScoreLimitWarning] = useState<ScoreLimitWarning | null>(null);
  const [roundChangePulse, setRoundChangePulse] = useState<number | null>(null);
  const [selectedTurnKey, setSelectedTurnKey] = useState<string | null>(null);
  const [entryFilterPlayerId, setEntryFilterPlayerId] = useState<"all" | PlayerId>("all");
  const [entryFilterType, setEntryFilterType] = useState<EditableEventFilterType>("all");
  const [reopenPasswordOpen, setReopenPasswordOpen] = useState(false);
  const [reopenPassword, setReopenPassword] = useState("");
  const [reopenPasswordError, setReopenPasswordError] = useState("");
  const [deletePasswordOpen, setDeletePasswordOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deletePasswordError, setDeletePasswordError] = useState("");
  const [startingPlayerPromptOpen, setStartingPlayerPromptOpen] = useState(false);
  const [startingPlayerPromptSlot, setStartingPlayerPromptSlot] = useState<CreateGameInput["startingSlot"]>("");
  const [redoHoldOpen, setRedoHoldOpen] = useState(false);
  const [timeoutHoldOpen, setTimeoutHoldOpen] = useState(false);
  const previousRoundRef = useRef<number | null>(null);
  const snapToLatestTurnRef = useRef(false);
  const redoHoldTimerRef = useRef<number | null>(null);
  const redoHoldTriggeredRef = useRef(false);
  const timeoutHoldTimerRef = useRef<number | null>(null);
  const timeoutHoldTriggeredRef = useRef(false);
  const game = getGame(gameId);
  const accessMode = getGameAccessMode(gameId);
  const viewOnlyActive = game ? isGameViewOnly(game.id) : false;
  const shouldShowAccessModeDialog = shouldAskGameAccessMode(game, accessMode);
  const [gameForm, setGameForm] = useState<CreateGameInput | null>(
    game ? createGameFormState(game) : null
  );

  const allTurns = useMemo(
    () =>
      game
        ? game.rounds.flatMap((round) =>
            round.turns.map((turn) => ({
              ...turn,
              key: `${turn.roundNumber}:${turn.turnNumber}`
            }))
          )
        : [],
    [game]
  );
  const latestTurn = useMemo(() => (game ? getLatestTurn(game) : undefined), [game]);
  const timeoutActive = game ? isTimeoutActive(game) : false;
  const setupActive = game ? isSetupActive(game) : false;
  const setupRunning = game ? isSetupRunning(game) : false;
  const setupPaused = game ? isSetupPaused(game) : false;
  const {
    playerOptions,
    latestArmyByPlayerName,
    latestDetachmentByPlayerArmy,
    detachmentOptionsByArmy,
    deploymentOptions,
    primaryMissionOptions
  } = useMemo(() => buildGameFormOptions(games), [games]);
  const editableEvents = useMemo<EditableEventItem[]>(
    () =>
      game
        ? [
            ...game.timeEvents.map((event) => ({
              id: event.id,
              playerId: event.playerId,
              playerName: event.playerId
                ? game.players.find((player) => player.id === event.playerId)?.name ?? "-"
                : "Timer",
              kind: "time" as const,
              eventType: "time" as const,
              label: getTimeEventActionLabel(event.action),
              displayValue: undefined,
              roundNumber: event.roundNumber,
              turnNumber: event.turnNumber,
              createdAt: event.createdAt
            })),
            ...game.commandPointEvents.map((event) => ({
              id: event.id,
              playerId: event.playerId,
              playerName: game.players.find((player) => player.id === event.playerId)?.name ?? "-",
              kind: "cp" as const,
              eventType:
                (event.cpType === "gained" ? "cp-gained" : "cp-spent") as EditableEventItem["eventType"],
              label: event.cpType === "gained" ? "CP +" : "CP -",
              value: event.value,
              displayValue: Math.abs(event.value),
              note: event.note,
              roundNumber: event.roundNumber,
              turnNumber: event.turnNumber,
              createdAt: event.createdAt
            })),
            ...game.scoreEvents.map((event) => ({
              id: event.id,
              playerId: event.playerId,
              playerName: game.players.find((player) => player.id === event.playerId)?.name ?? "-",
              kind: "score" as const,
              eventType: event.scoreType as EditableEventItem["eventType"],
              label: `${
                event.scoreType === "primary"
                  ? "Primary"
                  : event.scoreType === "secondary"
                    ? "Secondary"
                    : event.scoreType === "challenge"
                      ? "Challenge"
                      : "Gesamt"
              } ${event.value < 0 ? "-" : "+"}`,
              value: event.value,
              displayValue: Math.abs(event.value),
              note: event.note,
              roundNumber: event.roundNumber,
              turnNumber: event.turnNumber,
              createdAt: event.createdAt
            })),
            ...game.noteEvents.map((event) => ({
              id: event.id,
              playerId: event.playerId,
              playerName: game.players.find((player) => player.id === event.playerId)?.name ?? "-",
              kind: "note" as const,
              eventType: "note" as const,
              label: "Notiz",
              note: event.note,
              roundNumber: event.roundNumber,
              turnNumber: event.turnNumber,
              createdAt: event.createdAt
            }))
          ].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        : [],
    [game]
  );
  const filteredEditableEvents = useMemo(
    () =>
      editableEvents.filter((event) => {
        const matchesPlayer = entryFilterPlayerId === "all" || event.playerId === entryFilterPlayerId;
        const matchesType = entryFilterType === "all" || event.eventType === entryFilterType;
        return matchesPlayer && matchesType;
      }),
    [editableEvents, entryFilterPlayerId, entryFilterType]
  );
  const undoActionLabel = getUndoActionLabel(gameId);
  const redoActionLabel = getRedoActionLabel(gameId);
  const undoLabel = undoActionLabel ? `Undo: ${undoActionLabel}` : "Undo";
  const redoLabel = redoActionLabel ? `Redo: ${redoActionLabel}` : "Redo";

  const clearRedoHoldTimer = () => {
    if (redoHoldTimerRef.current !== null) {
      window.clearTimeout(redoHoldTimerRef.current);
      redoHoldTimerRef.current = null;
    }
  };

  const clearTimeoutHoldTimer = () => {
    if (timeoutHoldTimerRef.current !== null) {
      window.clearTimeout(timeoutHoldTimerRef.current);
      timeoutHoldTimerRef.current = null;
    }
  };

  const startRedoHold = () => {
    if (writeDisabled || !redoActionLabel || isClosed) {
      return;
    }

    clearRedoHoldTimer();
    redoHoldTriggeredRef.current = false;
    redoHoldTimerRef.current = window.setTimeout(() => {
      redoHoldTimerRef.current = null;
      redoHoldTriggeredRef.current = true;
      setRedoHoldOpen(true);
    }, 520);
  };

  const cancelRedoHold = () => {
    clearRedoHoldTimer();
  };

  const startTimeoutHold = () => {
    if (writeDisabled || !isTimerRunning || timeoutActive) {
      return;
    }

    clearTimeoutHoldTimer();
    timeoutHoldTriggeredRef.current = false;
    timeoutHoldTimerRef.current = window.setTimeout(() => {
      timeoutHoldTimerRef.current = null;
      timeoutHoldTriggeredRef.current = true;
      setTimeoutHoldOpen(true);
    }, 520);
  };

  const cancelTimeoutHold = () => {
    clearTimeoutHoldTimer();
  };

  useEffect(() => {
    if (!game) {
      setGameForm(null);
      setSelectedTurnKey(null);
      return;
    }

    if (isEditingGame) {
      return;
    }

    setGameForm(createGameFormState(game));
  }, [game, isEditingGame]);

  useEffect(
    () => () => {
      clearRedoHoldTimer();
      clearTimeoutHoldTimer();
    },
    []
  );

  useEffect(() => {
    if (!game) {
      return;
    }

    const latestKey = latestTurn ? `${latestTurn.roundNumber}:${latestTurn.turnNumber}` : null;
    setSelectedTurnKey((current) => {
      if (!latestKey) {
        return null;
      }

      if (snapToLatestTurnRef.current) {
        snapToLatestTurnRef.current = false;
        return latestKey;
      }

      if (!current) {
        return latestKey;
      }

      if (
        current === SETUP_TURN_KEY &&
        game.timeEvents.some((event) => event.action === "setup-start")
      ) {
        return current;
      }

      return allTurns.some((turn) => turn.key === current) ? current : latestKey;
    });
  }, [allTurns, game, latestTurn]);

  useEffect(() => {
    if (!actionFlash) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setActionFlash(null);
    }, 380);

    return () => window.clearTimeout(timeout);
  }, [actionFlash]);

  useEffect(() => {
    if (!game) {
      previousRoundRef.current = null;
      return;
    }

    const nextRound = getCurrentRoundNumber(game);
    if (previousRoundRef.current === null) {
      previousRoundRef.current = nextRound;
      return;
    }

    if (nextRound > 0 && previousRoundRef.current !== nextRound) {
      setRoundChangePulse(nextRound);
    }

    previousRoundRef.current = nextRound;
  }, [game]);

  useEffect(() => {
    if (!game) {
      setOverviewOpen(false);
    }
  }, [game]);

  useEffect(
    () => () => {
      setGameAccessMode(gameId, null);
    },
    [gameId, setGameAccessMode]
  );

  useEffect(() => {
    if (roundChangePulse === null) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setRoundChangePulse(null);
    }, 1500);

    return () => window.clearTimeout(timeout);
  }, [roundChangePulse]);

  useEffect(() => {
    if (!redoActionLabel || isMutating || viewOnlyActive || game?.status === "completed") {
      setRedoHoldOpen(false);
      clearRedoHoldTimer();
    }
  }, [game?.status, isMutating, redoActionLabel, viewOnlyActive]);

  if (!game && isLoading) {
    return <Layout title="Tracker" subtitle="Spiel wird geladen" />;
  }

  if (!game || !gameForm) {
    return (
      <Layout
        title="Spiel nicht gefunden"
        subtitle={errorMessage ?? "Das Match ist nicht verfuegbar oder konnte nicht geladen werden."}
      />
    );
  }

  const latestRound = game.rounds[game.rounds.length - 1];
  const selectedTurn =
    selectedTurnKey === SETUP_TURN_KEY
      ? undefined
      : allTurns.find((turn) => turn.key === selectedTurnKey) ?? latestTurn;
  const selectedTurnIndex = selectedTurn
    ? allTurns.findIndex((turn) => turn.key === `${selectedTurn.roundNumber}:${selectedTurn.turnNumber}`)
    : -1;
  const selectedRound =
    game.rounds.find((round) => round.roundNumber === selectedTurn?.roundNumber) ?? latestRound;
  const hasSetupPhase = game.timeEvents.some((event) => event.action === "setup-start");
  const isSetupSelected = selectedTurnKey === SETUP_TURN_KEY;
  const needsStartingPlayerBeforeFirstTurn = !game.startingPlayerId && (isSetupSelected || !latestRound);
  const timerFocusTurn = isSetupSelected ? undefined : getTimerFocusTurn(selectedTurn, latestTurn);
  const canGoBack = selectedTurnIndex > 0 || (selectedTurnIndex === 0 && hasSetupPhase);
  const canGoForwardToExistingTurn =
    (isSetupSelected && allTurns.length > 0) ||
    (selectedTurnIndex >= 0 && selectedTurnIndex < allTurns.length - 1);
  const orderedPlayers =
    game.players[0].id === game.startingPlayerId
      ? game.players
      : game.players[1].id === game.startingPlayerId
        ? [game.players[1], game.players[0]]
        : game.players;
  const activePlayerId = selectedTurn?.playerId ?? game.currentPlayerId;
  const isClosed = game.status === "completed";
  const isReadOnly = viewOnlyActive;
  const writeDisabled = isMutating || isReadOnly;
  const canNavigateTurns = !isMutating;
  const showOverview = isClosed || isReadOnly || forceOverview;
  const isPaused = isTurnPaused(selectedTurn);
  const hasActiveTurn = Boolean(selectedTurn?.timing.startedAt && !selectedTurn.timing.endedAt);
  const isSetupScreen = !showOverview && (isSetupSelected || !latestRound);
  const isTimerRunning = !isClosed && !timeoutActive && ((hasActiveTurn && !isPaused) || setupRunning);
  const timerStatusLabel = timeoutActive ? "Time-out" : isTimerRunning ? "Laeuft" : "Gestoppt";

  useEffect(() => {
    if (!isTimerRunning || timeoutActive || isMutating || viewOnlyActive || game?.status === "completed") {
      setTimeoutHoldOpen(false);
      clearTimeoutHoldTimer();
    }
  }, [game?.status, isMutating, isTimerRunning, timeoutActive, viewOnlyActive]);

  const displayTurn = timerFocusTurn ?? selectedTurn;
  const displayRound =
    timerFocusTurn ? game.rounds.find((round) => round.roundNumber === timerFocusTurn.roundNumber) ?? selectedRound : selectedRound;
  const selectedRoundTurns = displayRound
    ? getDisplayedRoundTurns(displayRound, displayTurn, isTimerRunning, timeoutActive)
    : [];
  const selectedRoundDurationMs = displayRound
    ? Math.max(
        selectedRoundTurns.reduce((total, turn) => total + getTurnDurationMs(turn, game), 0),
        0
      )
    : 0;
  const setupDurationMs = getSetupDurationMs(game);
  const currentRoundNumber = isSetupScreen ? 0 : selectedRound?.roundNumber ?? getCurrentRoundNumber(game);
  const roundThemeClassName =
    currentRoundNumber > 0 && currentRoundNumber % 2 === 0
      ? "game-page--round-even"
      : "game-page--round-odd";
  const headerRoundClassName =
    currentRoundNumber > 0 && currentRoundNumber % 2 === 0
      ? "game-header--round-even"
      : "game-header--round-odd";
  const selectedNotePlayer = noteDialogPlayerId
    ? game.players.find((player) => player.id === noteDialogPlayerId)
    : undefined;

  useEffect(() => {
    if (detailsOpen || isEditingGame) {
      return;
    }

    const focusTurn = timerFocusTurn;
    if (setupActive || shouldRunTimerRenderTicker(focusTurn, timeoutActive, isClosed)) {
      const interval = window.setInterval(() => {
        setTick((current) => current + 1);
      }, 1000);

      return () => window.clearInterval(interval);
    }
  }, [detailsOpen, isEditingGame, isClosed, setupActive, timeoutActive, timerFocusTurn]);

  const updateGameField = <K extends keyof CreateGameInput,>(
    key: K,
    value: CreateGameInput[K]
  ) => {
    setGameForm((current) =>
      current
        ? {
            ...current,
            [key]: value
          }
        : current
    );
  };

  const applyRememberedGamePlayerName = (slot: "player1" | "player2", value: string) => {
    const nameField = slot === "player1" ? "playerOneName" : "playerTwoName";
    const armyField = slot === "player1" ? "playerOneArmy" : "playerTwoArmy";
    const detachmentField = slot === "player1" ? "playerOneDetachment" : "playerTwoDetachment";

    setGameForm((current) => {
      if (!current) {
        return current;
      }

      const nextArmy = latestArmyByPlayerName.get(value.trim()) || String(current[armyField]);
      const comboKey = getPlayerArmyComboKey(value, nextArmy);
      const rememberedDetachment = comboKey ? latestDetachmentByPlayerArmy.get(comboKey) : undefined;

      return {
        ...current,
        [nameField]: value,
        [armyField]: nextArmy,
        [detachmentField]: rememberedDetachment || current[detachmentField]
      };
    });
  };

  const applyGameFormArmySelection = (slot: "player1" | "player2", army: string) => {
    const nameField = slot === "player1" ? "playerOneName" : "playerTwoName";
    const armyField = slot === "player1" ? "playerOneArmy" : "playerTwoArmy";
    const detachmentField = slot === "player1" ? "playerOneDetachment" : "playerTwoDetachment";

    setGameForm((current) => {
      if (!current) {
        return current;
      }

      const comboKey = getPlayerArmyComboKey(String(current[nameField]), army);
      const rememberedDetachment = comboKey ? latestDetachmentByPlayerArmy.get(comboKey) : undefined;

      return {
        ...current,
        [armyField]: army,
        [detachmentField]: rememberedDetachment || current[detachmentField]
      };
    });
  };

  const openGameEditor = async () => {
    if (isClosed || isReadOnly) {
      return;
    }

    if (isTimerRunning) {
      await pauseActiveTimer(
        game.id,
        selectedTurn
          ? {
              roundNumber: selectedTurn.roundNumber,
              turnNumber: selectedTurn.turnNumber
            }
          : undefined
      );
    }

    setGameForm(createGameFormState(getGame(game.id) ?? game));
    setDetailsOpen(true);
    setIsEditingGame(true);
  };

  const openGameDetails = () => {
    setDetailsOpen(true);
    setIsEditingGame(false);
  };

  const closeGameDetails = () => {
    setDetailsOpen(false);
    setIsEditingGame(false);
    setGameForm(createGameFormState(game));
  };

  const openEditor = async (event: EditableEventItem) => {
    if (isReadOnly) {
      return;
    }

    if (event.kind !== "time" && isTimerRunning) {
      await pauseActiveTimer(
        game.id,
        selectedTurn
          ? {
              roundNumber: selectedTurn.roundNumber,
              turnNumber: selectedTurn.turnNumber
            }
          : undefined
      );
    }
    setEditingEventId(event.id);
    setEditingValue(event.kind === "time" ? toDateTimeLocalInput(event.createdAt) : typeof event.displayValue === "number" ? String(event.displayValue) : "");
    setEditingNote(event.note ?? "");
  };

  const closeEditor = () => {
    setEditingEventId(null);
    setEditingValue("");
    setEditingNote("");
  };

  const saveEditedEvent = async (event: EditableEventItem) => {
    if (isReadOnly) {
      closeEditor();
      return;
    }

    const parsedValue = event.kind === "note" || event.kind === "time" ? undefined : Math.abs(Number(editingValue));
    const nextValue =
      event.kind === "note" || event.kind === "time"
        ? undefined
        : typeof parsedValue === "number" && Number.isFinite(parsedValue)
          ? event.kind === "score" && (event.value ?? 0) < 0
            ? parsedValue * -1
            : parsedValue
          : event.value ?? 0;

    await updateGameEvent(game.id, event.id, {
      value_number: nextValue,
      occurred_at: event.kind === "time" ? fromDateTimeLocalInput(editingValue, event.createdAt) : undefined,
      note: editingNote.trim() || null
    });
    closeEditor();
  };

  const handleGameSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isReadOnly) {
      return;
    }

    await updateGameDetails(game.id, gameForm);
    setDetailsOpen(false);
    setIsEditingGame(false);
  };

  const handleRequestDeleteGame = () => {
    if (isReadOnly) {
      return;
    }

    setDeletePasswordOpen(true);
    setDeletePassword("");
    setDeletePasswordError("");
  };

  const closeDeleteDialog = () => {
    setDeletePasswordOpen(false);
    setDeletePassword("");
    setDeletePasswordError("");
  };

  const handleConfirmDeleteGame = async () => {
    if (!isGameAdminPassword(deletePassword)) {
      setDeletePasswordError("Falsches Passwort.");
      return;
    }

    closeDeleteDialog();
    onBack();
    window.setTimeout(() => {
      void deleteGame(game.id);
    }, 0);
  };

  const closeNoteDialog = () => {
    setNoteDialogPlayerId(null);
    setNoteDraft("");
  };

  const closeReopenDialog = () => {
    setReopenPasswordOpen(false);
    setReopenPassword("");
    setReopenPasswordError("");
  };

  const openFinishDialog = () => {
    if (isReadOnly) {
      return;
    }

    setFinishDialogOpen(true);
  };

  const closeFinishDialog = () => {
    setFinishDialogOpen(false);
  };

  const handleFinishGame = async (finishReason: GameFinishReason) => {
    await finishGame(game.id, finishReason);
    closeFinishDialog();
  };

  const handleDeleteEvent = async (event: EditableEventItem) => {
    if (isReadOnly) {
      return;
    }

    if (!window.confirm("Eintrag wirklich loeschen?")) {
      return;
    }

    await deleteGameEvent(game.id, event.id);
    if (editingEventId === event.id) {
      closeEditor();
    }
  };

  const handleAddNote = async () => {
    if (isReadOnly) {
      closeNoteDialog();
      return;
    }

    if (!noteDialogPlayerId || !noteDraft.trim()) {
      return;
    }

    await addNoteEvent({
      gameId,
      playerId: noteDialogPlayerId,
      note: noteDraft,
      roundNumber: selectedRound?.roundNumber,
      turnNumber: selectedTurn?.turnNumber
    });
    closeNoteDialog();
  };

  const handleRequestReopenGame = () => {
    if (isReadOnly) {
      return;
    }

    setReopenPasswordOpen(true);
    setReopenPassword("");
    setReopenPasswordError("");
  };

  const handleConfirmReopenGame = async () => {
    if (!isGameAdminPassword(reopenPassword)) {
      setReopenPasswordError("Falsches Passwort.");
      return;
    }

    closeReopenDialog();
    await reopenGame(game.id);
    if (forceOverview) {
      window.location.hash = `/game/${game.id}`;
    }
  };

  const handleUndoLastEvent = async () => {
    if (isReadOnly || !undoActionLabel) {
      return;
    }

    closeEditor();
    if (undoActionLabel.startsWith("Weiter") || undoActionLabel.startsWith("Zurueck")) {
      snapToLatestTurnRef.current = true;
    }
    await undoGameAction(game.id);
  };

  const handleRedoEvent = async () => {
    if (isReadOnly || !redoActionLabel) {
      return;
    }

    closeEditor();
    if (redoActionLabel.startsWith("Weiter") || redoActionLabel.startsWith("Zurueck")) {
      snapToLatestTurnRef.current = true;
    }
    await redoGameAction(game.id);
  };

  const openOverviewWindow = () => {
    setOverviewOpen(true);
  };

  const closeOverviewWindow = () => {
    setOverviewOpen(false);
  };

  const handleStartTimeout = async () => {
    if (isReadOnly || !selectedTurn || !isTimerRunning) {
      return;
    }

    await startTimeout(game.id, {
      roundNumber: selectedTurn.roundNumber,
      turnNumber: selectedTurn.turnNumber
    });
  };

  const handleStartTimeoutFromHold = async () => {
    setTimeoutHoldOpen(false);
    await handleStartTimeout();
  };

  const handleEndTimeout = async () => {
    if (isReadOnly || !selectedTurn || !timeoutActive) {
      return;
    }

    await endTimeout(game.id, {
      roundNumber: selectedTurn.roundNumber,
      turnNumber: selectedTurn.turnNumber
    });
  };

  const continueFromSetup = async (startingSlot?: CreateGameInput["startingSlot"]) => {
    if (startingSlot) {
      await updateGameDetails(game.id, {
        ...createGameFormState(game),
        startingSlot
      });
    }

    snapToLatestTurnRef.current = true;
    await advanceGame(game.id, SETUP_TURN_REF, isTimerRunning);
    setStartingPlayerPromptOpen(false);
    setStartingPlayerPromptSlot("");
  };

  const handleAdvance = async () => {
    if (isMutating) {
      return;
    }

    if (needsStartingPlayerBeforeFirstTurn) {
      setStartingPlayerPromptSlot("");
      setStartingPlayerPromptOpen(true);
      return;
    }

    if (isSetupSelected) {
      const firstTurn = allTurns[0];
      if (firstTurn) {
        if (!isReadOnly && isTimerRunning) {
          await advanceGame(game.id, SETUP_TURN_REF, true);
        }
        setSelectedTurnKey(firstTurn.key);
      }
      return;
    }

    if (canGoForwardToExistingTurn) {
      const nextTurn = allTurns[selectedTurnIndex + 1];
      if (nextTurn) {
        if (!isReadOnly && isTimerRunning) {
          await advanceGame(
            game.id,
            selectedTurn
              ? {
                  roundNumber: selectedTurn.roundNumber,
                  turnNumber: selectedTurn.turnNumber
                }
              : undefined,
            true
          );
        }
        setSelectedTurnKey(nextTurn.key);
      }
      return;
    }

    if (isReadOnly) {
      return;
    }

    snapToLatestTurnRef.current = true;
    await advanceGame(
      game.id,
      selectedTurn
        ? {
            roundNumber: selectedTurn.roundNumber,
            turnNumber: selectedTurn.turnNumber
          }
        : undefined,
      isTimerRunning
    );
  };

  const handleGoBack = async () => {
    if (isMutating || !canGoBack) {
      return;
    }

    const previousTurn = allTurns[selectedTurnIndex - 1];
    if (previousTurn) {
      if (!isReadOnly && isTimerRunning) {
        await rewindLastTurn(
          game.id,
          selectedTurn
            ? {
                roundNumber: selectedTurn.roundNumber,
                turnNumber: selectedTurn.turnNumber
              }
            : undefined,
          true
        );
      }
      setSelectedTurnKey(previousTurn.key);
      return;
    }

    if (selectedTurnIndex === 0 && hasSetupPhase) {
      if (!isReadOnly && isTimerRunning) {
        await rewindLastTurn(
          game.id,
          selectedTurn
            ? {
                roundNumber: selectedTurn.roundNumber,
                turnNumber: selectedTurn.turnNumber
              }
            : undefined,
          true
        );
      }
      setSelectedTurnKey(SETUP_TURN_KEY);
    }
  };

  return (
    <Layout
      title="Tracker"
      subtitle={
        showOverview ? undefined : (
          <div className="game-header-stats">
            <span>
              {isSetupScreen
                ? `Aufstellung (${formatDuration(setupDurationMs)})`
                : `Runde ${displayRound?.roundNumber ?? 0} (${formatDuration(selectedRoundDurationMs)})`}
            </span>
            <span>
              {isSetupScreen
                ? setupPaused
                  ? "Phase pausiert"
                  : "Runde 0"
                : `Zug ${displayTurn?.turnNumber ?? 0} (${formatDuration(displayTurn ? getTurnDurationMs(displayTurn, game) : 0)})`}
            </span>
            <span>Gesamt {formatDuration(getGameDurationMs(game))}</span>
          </div>
        )
      }
      stickyHeader
      headerClassName={headerRoundClassName}
      actions={
        <>
          <div className="game-header-meta">
            <div className="game-status-strip">
              <span className={`status-pill status-pill--${isClosed ? "completed" : "active"}`}>
                Spiel: {isClosed ? "zu" : "offen"}
              </span>
              {!(showOverview && isClosed) ? (
                <span
                  className={`status-pill ${isTimerRunning ? "status-pill--active" : ""} ${timeoutActive ? "status-pill--timeout" : ""}`}
                >
                  Timer: {timerStatusLabel}
                </span>
              ) : null}
              {isReadOnly ? <span className="status-pill status-pill--view-only">View only</span> : null}
            </div>
          </div>
          <FloatingMenu
            fixed
            ariaLabel="Spielmenue"
            sections={[
              {
                label: "Navigation",
                items: [
                  { label: "Main", onClick: onBack },
                  { label: "Neues Spiel", onClick: () => (window.location.hash = "/new") },
                  { label: "Statistik", onClick: () => (window.location.hash = "/stats") }
                ]
              },
              {
                label: "Optionen",
                items: [
                  ...(!showOverview
                    ? [
                        {
                          label: "Scoreboard",
                          onClick: openOverviewWindow
                        }
                      ]
                    : []),
                  { label: "Verlauf", onClick: () => setEntriesOpen(true) },
                  { label: "Notizen", onClick: () => setNotesOpen(true) },
                  { label: "Einstellungen", onClick: openGameDetails },
                  isClosed
                    ? {
                        label: "Spiel wieder eroeffnen",
                        onClick: handleRequestReopenGame,
                        disabled: writeDisabled
                      }
                    : {
                        label: "Spiel beenden",
                        onClick: openFinishDialog,
                        disabled: writeDisabled,
                        danger: true
                      },
                  {
                    label: "Spiel loeschen",
                    onClick: handleRequestDeleteGame,
                    disabled: writeDisabled,
                    danger: true
                  }
                ]
              }
            ]}
          />
        </>
      }
    >
      {shouldShowAccessModeDialog ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="stack">
              <div>
                <h2>Match oeffnen</h2>
                <p className="muted-copy">Dieses Match laeuft noch.</p>
              </div>
              <div className="button-row button-row--compact">
                <button
                  type="button"
                  className="primary-button compact-button"
                  onClick={() => setGameAccessMode(game.id, "edit")}
                >
                  Edit mode
                </button>
                <button
                  type="button"
                  className="secondary-button compact-button"
                  onClick={() => setGameAccessMode(game.id, "view")}
                >
                  View-only mode
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {roundChangePulse !== null ? (
        <>
          <div className="action-feedback-flash action-feedback-flash--round" aria-hidden="true" />
          <div className="round-change-indicator" aria-hidden="true">
            <strong>Neue Runde</strong>
            <span>Runde {roundChangePulse}</span>
          </div>
        </>
      ) : null}
      {actionFlash ? (
        <div
          className={`action-feedback-flash action-feedback-flash--${actionFlash}`}
          aria-hidden="true"
        />
      ) : null}
      {scoreLimitWarning ? (
        <div key={scoreLimitWarning.id} className="score-limit-warning" role="alert">
          <div>
            <strong>
              {scoreLimitWarning.playerName}: {scoreLimitWarning.scoreLabel} Limit erreicht
            </strong>
            <p>
              {scoreLimitWarning.thresholds.join(" / ")} Punkte erreicht oder ueberschritten.
              Bitte pruefen, ob das Limit erreicht ist.
            </p>
          </div>
          <span>{scoreLimitWarning.total} Pkt</span>
          <button
            type="button"
            className="ghost-button compact-button"
            onClick={() => setScoreLimitWarning(null)}
          >
            OK
          </button>
        </div>
      ) : null}
      {timeoutActive ? (
        <div className="timeout-banner" role="status">
          <strong>Time-out aktiv</strong>
          <span>Spielzeit laeuft, Spielerzeit ist pausiert.</span>
        </div>
      ) : null}
      {overviewOpen && !showOverview ? (
        <div className="modal-backdrop">
          <div className="modal-card modal-card--wide game-overview-modal">
            <div className="stack">
              <div className="list-row">
                <div>
                  <h2>Scoreboard</h2>
                </div>
                <button
                  type="button"
                  className="ghost-button compact-button"
                  onClick={closeOverviewWindow}
                >
                  Schliessen
                </button>
              </div>
              <GameOverview game={game} />
            </div>
          </div>
        </div>
      ) : null}
      {reopenPasswordOpen ? (
        <PasswordDialog
          title="Spiel wieder eroeffnen"
          confirmLabel="Wieder eroeffnen"
          value={reopenPassword}
          error={reopenPasswordError}
          disabled={writeDisabled}
          onChange={(value) => {
            setReopenPassword(value);
            if (reopenPasswordError) {
              setReopenPasswordError("");
            }
          }}
          onClose={closeReopenDialog}
          onConfirm={() => void handleConfirmReopenGame()}
        />
      ) : null}
      {deletePasswordOpen ? (
        <PasswordDialog
          title="Spiel loeschen"
          confirmLabel="Spiel loeschen"
          value={deletePassword}
          error={deletePasswordError}
          hint="Alle Events dieses Spiels werden dabei entfernt."
          confirmTone="danger"
          disabled={writeDisabled}
          onChange={(value) => {
            setDeletePassword(value);
            if (deletePasswordError) {
              setDeletePasswordError("");
            }
          }}
          onClose={closeDeleteDialog}
          onConfirm={() => void handleConfirmDeleteGame()}
        />
      ) : null}
      {finishDialogOpen ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="stack">
              <div className="list-row">
                <div>
                  <h2>Spiel beenden</h2>
                  <p className="muted-copy">Wie soll dieses Spiel gewertet werden?</p>
                </div>
                <button
                  type="button"
                  className="ghost-button compact-button"
                  onClick={closeFinishDialog}
                >
                  Schliessen
                </button>
              </div>
              <div className="button-row button-row--compact">
                <button
                  type="button"
                  className="secondary-button compact-button"
                  disabled={writeDisabled}
                  onClick={() => void handleFinishGame("interrupted")}
                >
                  Spiel unterbrochen
                </button>
                <button
                  type="button"
                  className="secondary-button compact-button"
                  disabled={writeDisabled}
                  onClick={() => void handleFinishGame("abandoned")}
                >
                  Spiel abgebrochen
                </button>
                <button
                  type="button"
                  className="secondary-button compact-button"
                  disabled={writeDisabled}
                  onClick={() => void handleFinishGame("player-1-conceded")}
                >
                  {game.players[0].name} hat aufgegeben
                </button>
                <button
                  type="button"
                  className="secondary-button compact-button"
                  disabled={writeDisabled}
                  onClick={() => void handleFinishGame("player-2-conceded")}
                >
                  {game.players[1].name} hat aufgegeben
                </button>
                <button
                  type="button"
                  className="secondary-button compact-button"
                  disabled={writeDisabled}
                  onClick={() => void handleFinishGame("draw")}
                >
                  Unentschieden
                </button>
                <button
                  type="button"
                  className="primary-button compact-button"
                  disabled={writeDisabled}
                  onClick={() => void handleFinishGame("completed")}
                >
                  Spiel beendet
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {startingPlayerPromptOpen ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="stack">
              <div>
                <h2>Startspieler auswaehlen</h2>
                <p className="muted-copy">Vor Zug 1 muss feststehen, wer beginnt.</p>
              </div>
              <label className="field">
                <span>Startspieler</span>
                <select
                  value={startingPlayerPromptSlot}
                  disabled={writeDisabled}
                  autoFocus
                  onChange={(event) => setStartingPlayerPromptSlot(event.target.value as CreateGameInput["startingSlot"])}
                >
                  <option value="">Bitte auswaehlen</option>
                  <option value="player1">{game.players[0].name || "Spieler 1"}</option>
                  <option value="player2">{game.players[1].name || "Spieler 2"}</option>
                </select>
              </label>
              <div className="button-row button-row--compact">
                <button
                  type="button"
                  className="primary-button compact-button"
                  disabled={writeDisabled || !startingPlayerPromptSlot}
                  onClick={() => void continueFromSetup(startingPlayerPromptSlot)}
                >
                  Weiter zu Zug 1
                </button>
                <button
                  type="button"
                  className="ghost-button compact-button"
                  disabled={writeDisabled}
                  onClick={() => {
                    setStartingPlayerPromptOpen(false);
                    setStartingPlayerPromptSlot("");
                  }}
                >
                  Abbrechen
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <section className={`stack game-page ${roundThemeClassName}`}>
        {errorMessage ? (
          <article className="notice-card notice-card--error">
            <div className="stack">
              <div>
                <h2>Aktion fehlgeschlagen</h2>
                <p>{errorMessage}</p>
              </div>
              <button type="button" className="ghost-button" onClick={clearError}>
                Meldung ausblenden
              </button>
            </div>
          </article>
        ) : null}

        {showOverview ? (
          <GameOverview game={game} />
        ) : isSetupScreen ? (
          <div className="stack">
            <article className="scoreboard setup-scoreboard is-emphasized">
              <div className="scoreboard__head">
                <div>
                  <h2>Aufstellung</h2>
                  <p>Runde 0</p>
                </div>
                <div className="scoreboard__meta">
                  <span className="meta-chip meta-chip--accent">
                    {setupRunning ? "Aktiv" : setupPaused ? "Pausiert" : "Bereit"}
                  </span>
                </div>
              </div>
              <div className="scoreboard__grid scoreboard__grid--compact setup-scoreboard__grid">
                <div className="scoreboard-stat scoreboard-stat--time">
                  <div className="scoreboard-stat__top">
                    <span>Zeit</span>
                    <strong>{formatDuration(setupDurationMs)}</strong>
                  </div>
                  <span className="scoreboard-stat__meta">Zaehlt zur Gesamtzeit</span>
                </div>
              </div>
            </article>
          </div>
        ) : (
          <div className="stack">
            {orderedPlayers.map((player) => (
              <PlayerScoreboard
                key={player.id}
                game={game}
                player={player}
                roundNumber={currentRoundNumber}
                emphasized={activePlayerId === player.id}
                defender={game.defenderPlayerId === player.id}
                noteAction={
                  <button
                    type="button"
                    className="ghost-button compact-button scoreboard__note-button"
                    disabled={writeDisabled}
                      onClick={() => {
                        void (async () => {
                          if (isTimerRunning) {
                            await pauseActiveTimer(
                              game.id,
                              selectedTurn
                                ? {
                                    roundNumber: selectedTurn.roundNumber,
                                    turnNumber: selectedTurn.turnNumber
                                  }
                                : undefined
                            );
                          }
                          setNoteDialogPlayerId(player.id);
                        })();
                      }}
                  >
                    Notiz
                  </button>
                }
                controls={
                  <QuickAdjustControls
                    player={player}
                    currentCommandPoints={getPlayerCommandPoints(game, player.id)}
                    isSubmitting={writeDisabled || isClosed}
                    canSpendCommandPoints
                    onCommandPointChange={async (playerId, direction, amount) => {
                      const currentCommandPoints = getPlayerCommandPoints(game, playerId);
                      const safeAmount =
                        direction === "minus" ? Math.min(amount, currentCommandPoints) : amount;
                      if (safeAmount <= 0) {
                        return;
                      }

                      await addCommandPointEvent({
                        gameId,
                        playerId,
                        value: safeAmount,
                        cpType: direction === "plus" ? "gained" : "spent",
                        roundNumber: selectedRound?.roundNumber,
                        turnNumber: selectedTurn?.turnNumber
                      });
                      setActionFlash("cp");
                    }}
                    onScoreChange={async (playerId, scoreType, direction, amount) => {
                      const currentScore =
                        scoreType === "primary"
                          ? getPlayerPrimaryTotal(game, playerId)
                          : scoreType === "secondary"
                            ? getPlayerSecondaryTotal(game, playerId)
                            : getPlayerChallengeTotal(game, playerId);
                      const currentPrimarySecondaryScore =
                        getPlayerPrimaryTotal(game, playerId) + getPlayerSecondaryTotal(game, playerId);
                      const safeAmount =
                        direction === "minus" ? Math.min(amount, currentScore) : amount;
                      if (safeAmount <= 0) {
                        return;
                      }

                      await addScoreEvent({
                        gameId,
                        playerId,
                        value: direction === "plus" ? safeAmount : safeAmount * -1,
                        scoreType,
                        roundNumber: selectedRound?.roundNumber,
                        turnNumber: selectedTurn?.turnNumber
                      });
                      if (direction === "plus") {
                        const crossedLimits = getCrossedScoreLimits(
                          scoreType,
                          currentScore,
                          currentScore + safeAmount
                        );
                        if (crossedLimits.length) {
                          const playerName =
                            game.players.find((entry) => entry.id === playerId)?.name ?? "Spieler";
                          setScoreLimitWarning({
                            id: `${playerId}-${scoreType}-${crossedLimits.join("-")}-${Date.now()}`,
                            playerName,
                            scoreLabel: getScoreLimitLabel(scoreType),
                            thresholds: crossedLimits,
                            total: currentScore + safeAmount
                          });
                        }
                        if (scoreType === "primary" || scoreType === "secondary") {
                          const crossedCombinedLimits = getCrossedThresholds(
                            COMBINED_PRIMARY_SECONDARY_LIMITS,
                            currentPrimarySecondaryScore,
                            currentPrimarySecondaryScore + safeAmount
                          );
                          if (crossedCombinedLimits.length) {
                            const playerName =
                              game.players.find((entry) => entry.id === playerId)?.name ?? "Spieler";
                            setScoreLimitWarning({
                              id: `${playerId}-primary-secondary-${crossedCombinedLimits.join("-")}-${Date.now()}`,
                              playerName,
                              scoreLabel: "Primary + Secondary",
                              thresholds: crossedCombinedLimits,
                              total: currentPrimarySecondaryScore + safeAmount
                            });
                          }
                        }
                      }
                      setActionFlash("score");
                    }}
                  />
                }
              />
            ))}
          </div>
        )}
      </section>

      {noteDialogPlayerId ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="stack">
              <div>
                <h2>Notiz hinzufuegen</h2>
                <p className="muted-copy">{selectedNotePlayer?.name ?? "Spieler"}</p>
              </div>
              <textarea
                rows={4}
                value={noteDraft}
                disabled={writeDisabled}
                onChange={(event) => setNoteDraft(event.target.value)}
              />
              <div className="button-row button-row--compact">
                <button
                  type="button"
                  className="primary-button compact-button"
                  disabled={writeDisabled || !noteDraft.trim()}
                  onClick={() => void handleAddNote()}
                >
                  Speichern
                </button>
                <button
                  type="button"
                  className="ghost-button compact-button"
                  disabled={writeDisabled}
                  onClick={closeNoteDialog}
                >
                  Abbrechen
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {detailsOpen ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="stack">
              <div className="list-row">
                <div>
                  <h2>Spieldetails</h2>
                  <p className="muted-copy">
                    {formatDateLabel(game.scheduledDate, game.scheduledTime)}
                  </p>
                </div>
                <div className="button-row button-row--compact game-details-actions">
                  {!isEditingGame && !isClosed ? (
                    <button
                      type="button"
                      className="ghost-button compact-button"
                      onClick={() => void openGameEditor()}
                      disabled={writeDisabled}
                    >
                      Bearbeiten
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="ghost-button compact-button"
                    onClick={closeGameDetails}
                  >
                    Schliessen
                  </button>
                </div>
              </div>

              {isEditingGame ? (
                <form className="stack" onSubmit={handleGameSave}>
                  <GamePlayerFields
                    title="Spieler 1"
                    nameValue={gameForm.playerOneName}
                    armyValue={gameForm.playerOneArmy}
                    detachmentValue={gameForm.playerOneDetachment}
                    playerOptions={playerOptions}
                    detachmentOptions={detachmentOptionsByArmy.get(gameForm.playerOneArmy) ?? []}
                    disabled={writeDisabled}
                    onNameChange={(value) => updateGameField("playerOneName", value)}
                    onSelectRememberedName={(value) => applyRememberedGamePlayerName("player1", value)}
                    onArmyChange={(value) => applyGameFormArmySelection("player1", value)}
                    onDetachmentChange={(value) => updateGameField("playerOneDetachment", value)}
                  />
                  <GamePlayerFields
                    title="Spieler 2"
                    nameValue={gameForm.playerTwoName}
                    armyValue={gameForm.playerTwoArmy}
                    detachmentValue={gameForm.playerTwoDetachment}
                    playerOptions={playerOptions}
                    detachmentOptions={detachmentOptionsByArmy.get(gameForm.playerTwoArmy) ?? []}
                    disabled={writeDisabled}
                    onNameChange={(value) => updateGameField("playerTwoName", value)}
                    onSelectRememberedName={(value) => applyRememberedGamePlayerName("player2", value)}
                    onArmyChange={(value) => applyGameFormArmySelection("player2", value)}
                    onDetachmentChange={(value) => updateGameField("playerTwoDetachment", value)}
                  />
                  <GameMetaFields
                    value={gameForm}
                    deploymentOptions={deploymentOptions}
                    primaryMissionOptions={primaryMissionOptions}
                    autoCommandPointOn={game.autoCommandPointOn}
                    disabled={writeDisabled}
                    onChange={updateGameField}
                    onToggleAutoCommandPoint={(nextValue) =>
                      void setAutoCommandPointEnabled(game.id, nextValue)
                    }
                  />

                  <div className="button-row button-row--compact">
                    <button type="submit" className="primary-button compact-button" disabled={writeDisabled}>
                      Speichern
                    </button>
                    <button
                      type="button"
                      className="ghost-button compact-button"
                      disabled={writeDisabled}
                      onClick={() => {
                        setGameForm(createGameFormState(game));
                        setIsEditingGame(false);
                      }}
                    >
                      Abbrechen
                    </button>
                  </div>
                </form>
              ) : (
                <div className="scoreboard__grid scoreboard__grid--details">
                  <div>
                    <span>Datum</span>
                    <strong>{game.scheduledDate || "-"}</strong>
                  </div>
                  <div>
                    <span>Uhrzeit</span>
                    <strong>{game.scheduledTime || "-"}</strong>
                  </div>
                  <div>
                    <span>Aufstellung</span>
                    <strong>{game.deployment || "-"}</strong>
                  </div>
                  <div>
                    <span>Primaermission</span>
                    <strong>{game.primaryMission || "-"}</strong>
                  </div>
                  <div>
                    <span>Spielpunkte</span>
                    <strong>{game.gamePoints}</strong>
                  </div>
                  <div>
                    <span>Spieler 1</span>
                    <strong>{game.players[0].name}</strong>
                    <p>{game.players[0].army.name}</p>
                    <p>{game.players[0].army.detachment || "-"}</p>
                  </div>
                  <div>
                    <span>Spieler 2</span>
                    <strong>{game.players[1].name}</strong>
                    <p>{game.players[1].army.name}</p>
                    <p>{game.players[1].army.detachment || "-"}</p>
                  </div>
                  <div>
                    <span>Defender</span>
                    <strong>
                      {game.defenderPlayerId === game.players[0].id
                        ? game.players[0].name
                        : game.defenderPlayerId === game.players[1].id
                          ? game.players[1].name
                          : "-"}
                    </strong>
                  </div>
                  <div>
                    <span>Startspieler</span>
                    <strong>
                      {game.startingPlayerId === game.players[0].id
                        ? game.players[0].name
                        : game.startingPlayerId === game.players[1].id
                          ? game.players[1].name
                          : "-"}
                    </strong>
                  </div>
                  <div>
                    <span>Startzeit</span>
                    <strong>{formatClockTime(game.startedAt)}</strong>
                  </div>
                  <div>
                    <span>Match-Zeit</span>
                    <strong>{formatDuration(getGameDurationMs(game))}</strong>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {notesOpen ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="stack">
              <div className="list-row">
                <div>
                  <h2>Notizen</h2>
                  <p className="muted-copy">{game.noteEvents.length} Eintraege</p>
                </div>
                <button
                  type="button"
                  className="ghost-button compact-button"
                  onClick={() => setNotesOpen(false)}
                >
                  Schliessen
                </button>
              </div>
              {game.noteEvents.length ? (
                <div className="event-list modal-list">
                  {game.noteEvents
                    .slice()
                    .reverse()
                    .map((event) => {
                      const playerName =
                        game.players.find((player) => player.id === event.playerId)?.name ?? "-";
                      return (
                        <article
                          key={event.id}
                          className={`event-list__row ${getRoundSurfaceClassName(event.roundNumber)}`}
                        >
                          <div className="event-editor__meta">
                            <div className="event-editor__summary">
                              <strong>{playerName}</strong>
                              <p className="event-editor__context">
                                R{event.roundNumber ?? "-"} / Z{event.turnNumber ?? "-"}
                              </p>
                            </div>
                            <span className="event-editor__stamp">
                              {formatClockTimeWithSeconds(event.createdAt)}
                            </span>
                          </div>
                          <p className="event-list__detail">{event.note}</p>
                        </article>
                      );
                    })}
                </div>
              ) : (
                <p className="muted-copy">Noch keine Notizen.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {entriesOpen ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="stack">
              <div className="list-row">
                <div>
                  <h2>Eintraege</h2>
                  <p className="muted-copy">
                    {filteredEditableEvents.length} von {editableEvents.length} sichtbar
                  </p>
                </div>
                <button
                  type="button"
                  className="ghost-button compact-button"
                  onClick={() => {
                    closeEditor();
                    setEntriesOpen(false);
                  }}
                >
                  Schliessen
                </button>
              </div>
              <div className="button-row button-row--compact">
                <button
                  type="button"
                  className="ghost-button compact-button"
                  onClick={() => void handleUndoLastEvent()}
                  disabled={writeDisabled || !undoActionLabel}
                  title={undoLabel}
                >
                  {undoLabel}
                </button>
                <button
                  type="button"
                  className="ghost-button compact-button"
                  onClick={() => void handleRedoEvent()}
                  disabled={writeDisabled || !redoActionLabel || isClosed}
                  title={redoLabel}
                >
                  {redoLabel}
                </button>
              </div>
              <div className="modal-filters">
                <label className="field">
                  <span>Spieler</span>
                  <select
                    value={entryFilterPlayerId}
                    disabled={!editableEvents.length}
                    onChange={(event) =>
                      setEntryFilterPlayerId(event.target.value as "all" | PlayerId)
                    }
                  >
                    <option value="all">Alle Spieler</option>
                    {game.players.map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Ereignisart</span>
                  <select
                    value={entryFilterType}
                    disabled={!editableEvents.length}
                    onChange={(event) =>
                      setEntryFilterType(event.target.value as EditableEventFilterType)
                    }
                  >
                    <option value="all">Alle Ereignisse</option>
                    <option value="time">Zeit</option>
                    <option value="primary">Primary</option>
                    <option value="secondary">Secondary</option>
                    <option value="challenge">Challenge</option>
                    <option value="legacy-total">Gesamt</option>
                    <option value="cp-gained">CP +</option>
                    <option value="cp-spent">CP -</option>
                    <option value="note">Notizen</option>
                  </select>
                </label>
              </div>
              {filteredEditableEvents.length ? (
                <div className="event-list event-list--editable modal-list">
                  {filteredEditableEvents.map((event) => (
                    <article
                      key={event.id}
                      className={`event-list__row ${getRoundSurfaceClassName(event.roundNumber)}`}
                    >
                      <div className="event-editor__meta">
                        <div className="event-editor__summary">
                          <strong>{event.playerName}</strong>
                          <p className="event-editor__context">
                            {event.label} | R{event.roundNumber ?? "-"} / Z{event.turnNumber ?? "-"}
                          </p>
                        </div>
                        <span className="event-editor__stamp">
                          {formatClockTimeWithSeconds(event.createdAt)}
                        </span>
                        <div className="button-row button-row--compact event-editor__actions">
                          <button
                            type="button"
                            className="ghost-button compact-button"
                            disabled={writeDisabled || isClosed}
                            onClick={() => void openEditor(event)}
                          >
                            Bearbeiten
                          </button>
                          <button
                            type="button"
                            className="danger-button compact-button"
                            disabled={writeDisabled || isClosed}
                            onClick={() => void handleDeleteEvent(event)}
                          >
                            Loeschen
                          </button>
                        </div>
                      </div>

                      {editingEventId === event.id ? (
                        <div className="event-editor__form">
                          {event.kind === "time" ? (
                            <input
                              type="datetime-local"
                              step={1}
                              value={editingValue}
                              disabled={writeDisabled}
                              onChange={(editEvent) => setEditingValue(editEvent.target.value)}
                            />
                          ) : event.kind !== "note" ? (
                            <input
                              type="number"
                              min={0}
                              inputMode="numeric"
                              value={editingValue}
                              disabled={writeDisabled}
                              onChange={(editEvent) => setEditingValue(editEvent.target.value)}
                            />
                          ) : null}
                          {event.kind !== "time" ? (
                            <textarea
                              rows={2}
                              value={editingNote}
                              disabled={writeDisabled}
                              onChange={(editEvent) => setEditingNote(editEvent.target.value)}
                            />
                          ) : null}
                          <div className="button-row button-row--compact">
                            <button
                              type="button"
                              className="primary-button compact-button"
                              disabled={writeDisabled}
                              onClick={() => void saveEditedEvent(event)}
                            >
                              Speichern
                            </button>
                            <button
                              type="button"
                              className="ghost-button compact-button"
                              disabled={writeDisabled}
                              onClick={closeEditor}
                            >
                              Abbrechen
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="event-list__detail">
                          {event.kind === "time"
                            ? `Zeitpunkt ${formatClockTimeWithSeconds(event.createdAt)}`
                            : typeof event.displayValue === "number"
                            ? `${event.displayValue}`
                            : event.note || "Keine Notiz"}
                          {event.note && typeof event.displayValue === "number" ? ` | ${event.note}` : ""}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="muted-copy">
                  {editableEvents.length
                    ? "Keine Eintraege passend zum aktuellen Filter."
                    : "Noch keine editierbaren Eintraege."}
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {!showOverview ? (
        <>
          {timeoutActive ? (
            <div className="game-timeout-dock">
              <button
                type="button"
                className="danger-button compact-button"
                onClick={() => void handleEndTimeout()}
                disabled={writeDisabled}
              >
                Time-out beenden
              </button>
            </div>
          ) : null}
          <div className="game-bottom-dock">
            <button
              type="button"
              className="primary-button compact-button"
              onClick={() => void handleAdvance()}
              disabled={!canNavigateTurns || (isReadOnly && !canGoForwardToExistingTurn)}
            >
              Weiter
            </button>
            <button
              type="button"
              className="ghost-button compact-button"
              onClick={() => void handleGoBack()}
              disabled={!canNavigateTurns || !canGoBack}
            >
              Zurueck
            </button>
            <div className="game-bottom-dock__undo-wrap">
              {redoHoldOpen ? (
                <button
                  type="button"
                  className="secondary-button compact-button game-bottom-dock__redo-popover"
                  onClick={() => {
                    setRedoHoldOpen(false);
                    void handleRedoEvent();
                  }}
                  disabled={writeDisabled || !redoActionLabel || isClosed}
                  title={redoLabel}
                >
                  {redoLabel}
                </button>
              ) : null}
              <button
                type="button"
                className="ghost-button compact-button game-bottom-dock__undo"
                onPointerDown={(event) => {
                  if (event.pointerType === "mouse" && event.button !== 0) {
                    return;
                  }
                  startRedoHold();
                }}
                onPointerUp={cancelRedoHold}
                onPointerLeave={cancelRedoHold}
                onPointerCancel={cancelRedoHold}
                onContextMenu={(event) => event.preventDefault()}
                onClick={(event) => {
                  if (redoHoldTriggeredRef.current) {
                    event.preventDefault();
                    redoHoldTriggeredRef.current = false;
                    return;
                  }
                  setRedoHoldOpen(false);
                  void handleUndoLastEvent();
                }}
                disabled={writeDisabled || !undoActionLabel}
                title={`${undoLabel}${redoActionLabel ? " | Halten fuer Redo" : ""}`}
              >
                {undoLabel}
              </button>
            </div>
            <div className="game-bottom-dock__timer-wrap">
              {timeoutHoldOpen ? (
                <button
                  type="button"
                  className="danger-button compact-button game-bottom-dock__timeout-popover"
                  onClick={() => void handleStartTimeoutFromHold()}
                  disabled={writeDisabled || !isTimerRunning || timeoutActive}
                  title="Time-out starten"
                >
                  Time-out starten
                </button>
              ) : null}
              <button
                type="button"
                className="secondary-button compact-button"
                onPointerDown={(event) => {
                  if (!isTimerRunning || timeoutActive) {
                    return;
                  }
                  if (event.pointerType === "mouse" && event.button !== 0) {
                    return;
                  }
                  startTimeoutHold();
                }}
                onPointerUp={cancelTimeoutHold}
                onPointerLeave={cancelTimeoutHold}
                onPointerCancel={cancelTimeoutHold}
                onContextMenu={(event) => event.preventDefault()}
                onClick={(event) => {
                  if (timeoutHoldTriggeredRef.current) {
                    event.preventDefault();
                    timeoutHoldTriggeredRef.current = false;
                    return;
                  }

                  setTimeoutHoldOpen(false);
                  void (
                    isTimerRunning
                      ? pauseActiveTimer(
                          game.id,
                          selectedTurn
                            ? {
                                roundNumber: selectedTurn.roundNumber,
                                turnNumber: selectedTurn.turnNumber
                              }
                            : undefined
                        )
                      : startGameTimer(
                          game.id,
                          selectedTurn
                            ? {
                                roundNumber: selectedTurn.roundNumber,
                                turnNumber: selectedTurn.turnNumber
                              }
                            : undefined
                        )
                  );
                }}
                disabled={writeDisabled}
              >
                {isTimerRunning ? "Timer aus" : "Timer an"}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </Layout>
  );
};
