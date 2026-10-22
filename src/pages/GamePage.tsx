import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { loadRememberedAccessMode, rememberAccessMode } from "../utils/accessModeMemory";
import { sortEventsNewestFirst } from "../utils/eventOrder";
import { resolveSelectedTurnKey, SETUP_TURN_KEY } from "../utils/turnSelection";

// Verlaufseintraege, die den Timer-Zustand aendern (Timer an/aus, Time-out starten/beenden)
const isTimerHistoryLabel = (label: string): boolean => label.startsWith("Timer ") || label.startsWith("Time-out");
import { useServerSecondTick } from "../utils/useServerSecondTick";
import { TvGameView } from "../components/TvGameView";
import { FloatingMenu } from "../components/FloatingMenu";
import { openNotificationsOverview, updatePushFollowSettings, usePushFollowSettings } from "../pwa/pushFollowStore";
import { isFollowingGame, setGameFollowed } from "../utils/pushFollow";
import { GameMetaFields } from "../components/GameMetaFields";
import { GameOverview } from "../components/GameOverview";
import { GamePlayerFields } from "../components/GamePlayerFields";
import { Layout } from "../components/Layout";
import { PasswordDialog } from "../components/PasswordDialog";
import { PlayerScoreboard } from "../components/PlayerScoreboard";
import { QuickAdjustControls } from "../components/QuickAdjustControls";
import { useGameStore } from "../store/GameStore";
import type {
  CreateGameInput,
  Game,
  GameFinishReason,
  PlayerId,
  ScoreType,
  StatsEligibilityArea,
  StatsEligibilityMode,
  StatsEligibilityOverrides,
  TimeEventAction
} from "../types/game";
import { buildGameFormOptions, getPlayerArmyComboKey } from "../utils/gameFormOptions";
import {
  getCurrentRoundNumber,
  getGameDurationMs,
  getActiveTurn,
  getLatestTurn,
  getPlayerChallengeTotal,
  getPlayerCommandPoints,
  getPlayerPrimaryTotal,
  getPlayerSecondaryTotal,
  getSetupDurationMs,
  getTurnDurationMs,
  isSetupActive,
  getShownActivePlayerId,
  isSetupPaused,
  isSetupRunning,
  isTimeoutActive,
  isTurnPaused,
  createStatsEligibilityReport
} from "../utils/gameCalculations";
import {
  getDisplayedRoundTurns,
  getTimerFocusTurn,
  shouldRunTimerRenderTicker
} from "../utils/timerFocus";
import { isGameAdminPassword } from "../utils/gameSecurity";
import { buildSpectatorLink, shareResultMessage, shareSpectatorLink } from "../utils/shareLink";
import { AUTO_CP_SUFFIX, formatCpGroup, formatScoreValue, groupDisplayEvents } from "../utils/eventGrouping";
import { HIGHLIGHT_ICON, deriveGameHighlights } from "../utils/tvHighlights";
import { getTvModeHash, isGameCompletedForDisplay, shouldAskGameAccessMode, shouldShowClosedGameTv, shouldShowViewOnly } from "../utils/gameAccessMode";
import { formatClockTime, formatClockTimeWithSeconds, formatDateLabel, formatDuration } from "../utils/time";

interface GamePageProps {
  gameId: string;
  onBack: () => void;
  forceTv?: boolean;
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
  | "note"
  | "highlight";

interface EditableEventItem {
  id: string;
  playerId?: string;
  playerName: string;
  // "highlight": abgeleitet (deriveGameHighlights), nie gespeichert, nicht bearbeitbar/loeschbar.
  kind: "cp" | "score" | "note" | "time" | "highlight";
  eventType: Exclude<EditableEventFilterType, "all">;
  label: string;
  value?: number;
  displayValue?: number;
  note?: string;
  roundNumber?: number;
  turnNumber?: number;
  createdAt: string;
  // Fuer die Anzeige-Buendelung (eventGrouping).
  timeAction?: string;
  cpType?: "gained" | "spent";
  scoreType?: string;
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

const SETUP_TURN_REF = {
  roundNumber: 0,
  turnNumber: 0
};
const STATS_ELIGIBILITY_AREAS: StatsEligibilityArea[] = ["result", "scoring", "cp", "time"];
const STATS_ELIGIBILITY_TURN_AREAS: Exclude<StatsEligibilityArea, "result">[] = ["scoring", "cp", "time"];

const statsEligibilityStatusLabel = (status: "included" | "excluded" | "partial"): string =>
  status === "included" ? "zählt" : status === "partial" ? "teilweise" : "zählt nicht";

const normalizeStatsEligibilityDraft = (value: StatsEligibilityOverrides): StatsEligibilityOverrides => {
  const areas = Object.fromEntries(
    STATS_ELIGIBILITY_AREAS.flatMap((area) => {
      const mode = value.areas?.[area];
      return mode === "include" || mode === "exclude" ? [[area, mode]] : [];
    })
  ) as Partial<Record<StatsEligibilityArea, StatsEligibilityMode>>;
  const turns = Object.fromEntries(
    Object.entries(value.turns ?? {}).flatMap(([turnKey, turnModes]) => {
      const modes = Object.fromEntries(
        STATS_ELIGIBILITY_TURN_AREAS.flatMap((area) => {
          const mode = turnModes?.[area];
          return mode === "include" || mode === "exclude" ? [[area, mode]] : [];
        })
      ) as Partial<Record<Exclude<StatsEligibilityArea, "result">, StatsEligibilityMode>>;
      return Object.keys(modes).length ? [[turnKey, modes]] : [];
    })
  );

  return {
    ...(Object.keys(areas).length ? { areas } : {}),
    ...(Object.keys(turns).length ? { turns } : {})
  };
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
  statsEligibilityMode: game.statsEligibilityMode,
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

const exitTvToGames = () => {
  const url = new URL(window.location.href);
  url.searchParams.delete("tv");
  url.hash = "/games";
  window.history.replaceState(null, "", url);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
};

export const GamePage = (props: GamePageProps) => {
  const { getGame, isLoading, errorMessage, getGameAccessMode, setGameAccessMode } = useGameStore();
  const game = getGame(props.gameId);
  useEffect(() => () => setGameAccessMode(props.gameId, null), [props.gameId, setGameAccessMode]);
  useEffect(() => {
    if (props.forceTv) setGameAccessMode(props.gameId, "view");
  }, [props.forceTv, props.gameId, setGameAccessMode]);
  // Gemerkte Auswahl "Match öffnen" (pro Spiel und Gerät) vor dem ersten Zeichnen übernehmen, damit der Dialog
  // beim Neuladen nicht erneut erscheint. Nur laufende Spiele, nicht bei View-only-Links (?tv=1).
  const hasGame = Boolean(game);
  const [restoredFor, setRestoredFor] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (!hasGame || restoredFor === props.gameId) return;
    if (!props.forceTv && !isGameCompletedForDisplay(game) && !getGameAccessMode(props.gameId)) {
      const remembered = loadRememberedAccessMode(props.gameId);
      if (remembered) {
        setGameAccessMode(props.gameId, remembered);
        if (remembered === "view") window.location.hash = getTvModeHash(props.gameId);
      }
    }
    setRestoredFor(props.gameId);
  }, [hasGame, props.gameId, props.forceTv, restoredFor, game, getGameAccessMode, setGameAccessMode]);
  if (game && restoredFor !== props.gameId) return null;
  if (!game) return <Layout title={isLoading ? "Tracker" : "Spiel nicht gefunden"}
    subtitle={isLoading ? "Spiel wird geladen" : errorMessage ?? "Das Match ist nicht verfügbar."} />;
  return <LoadedGamePage key={props.gameId} {...props} game={game} />;
};

const LoadedGamePage = ({ gameId, onBack, forceTv = false, game }: GamePageProps & { game: Game }) => {
  const {
    games,
    getGame,
    isMutating,
    errorMessage,
    clearError,
    advanceGame,
    rewindLastTurn,
    selectPhase,
    addScoreEvent,
    addCommandPointEvent,
    addNoteEvent,
    updateGameEvent,
    deleteGameEvent,
    updateGameDetails,
    updateStatsEligibilityOverrides,
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
  const [finishDialogError, setFinishDialogError] = useState("");
  const [startingPlayerPromptOpen, setStartingPlayerPromptOpen] = useState(false);
  const [startingPlayerPromptSlot, setStartingPlayerPromptSlot] = useState<CreateGameInput["startingSlot"]>("");
  const [statsEligibilityEditorOpen, setStatsEligibilityEditorOpen] = useState(false);
  const [statsEligibilityDraft, setStatsEligibilityDraft] = useState<StatsEligibilityOverrides>({});
  const [redoHoldOpen, setRedoHoldOpen] = useState(false);
  const [timeoutHoldOpen, setTimeoutHoldOpen] = useState(false);
  const [timerStateNotice, setTimerStateNotice] = useState<{ title: string; message: string } | null>(null);
  const previousRoundRef = useRef<number | null>(null);
  const previousTimerStateRef = useRef<string | null>(null);
  const snapToLatestTurnRef = useRef(false);
  const previousLatestTurnKeyRef = useRef<string | null>(null);
  const redoHoldTimerRef = useRef<number | null>(null);
  const redoHoldTriggeredRef = useRef(false);
  const timeoutHoldTimerRef = useRef<number | null>(null);
  const timeoutHoldTriggeredRef = useRef(false);
  const advanceInFlightRef = useRef(false);
  const accessMode = getGameAccessMode(gameId);
  const viewOnlyActive = isGameCompletedForDisplay(game) || isGameViewOnly(game.id);
  const shouldShowAccessModeDialog = shouldAskGameAccessMode(game, accessMode) && !forceTv;
  // View only (= TV-Ansicht) fuer abgeschlossene Spiele und laufende Spiele mit Wahl "View only" bzw. ?tv=1.
  const viewOnlyTv = shouldShowViewOnly(game, accessMode, forceTv);
  // Abgeschlossenes Spiel in View only: Menue bietet "Entsperren" (Passwort).
  const closedTv = shouldShowClosedGameTv(game, accessMode);
  // Folgen (Push Stufe a): nur lokal pro Geraet, nach dem Einschalten Hinweis zur Verfuegbarkeit.
  // "Match öffnen …": für jedes laufende Spiel erreichbar (Edit und View only), um die gemerkte Wahl zu ändern.
  const accessChoiceMenuItems = isGameCompletedForDisplay(game) ? [] : [{ label: "Match öffnen …", onClick: () => { reopenAccessChoice(); } }];
  const reopenAccessChoice = () => {
    rememberAccessMode(game.id, null);
    setGameAccessMode(game.id, null);
    const url = new URL(window.location.href);
    url.searchParams.delete("tv");
    url.hash = `/game/${game.id}`;
    window.history.replaceState(null, "", url);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };
  const pushFollowSettings = usePushFollowSettings();
  const followingGame = isFollowingGame(pushFollowSettings, game.id);
  const followMenuItems = [
    {
      label: followingGame ? "Entfolgen" : "Folgen",
      onClick: () => {
        updatePushFollowSettings((current) => setGameFollowed(current, game.id, !followingGame));
        if (!followingGame) openNotificationsOverview("hint");
      }
    },
    { label: "Notifications", onClick: () => openNotificationsOverview() }
  ];
  const [gameForm, setGameForm] = useState<CreateGameInput>(createGameFormState(game));

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
  // Aktiver Zug = der Zug, in dem die Zeit zaehlt (laufend bzw. zuletzt gestoppt). Auswahl/Zuschauer folgen ihm.
  const activeTurn = useMemo(() => (game ? getActiveTurn(game) : undefined), [game]);
  const statsEligibilityReport = useMemo(
    () => {
      if (!game) {
        return null;
      }

      try {
        return createStatsEligibilityReport(game);
      } catch (error) {
        console.error("[stats-eligibility] report failed", {
          gameId: game.id,
          error
        });
        return null;
      }
    },
    [game]
  );
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
        ? sortEventsNewestFirst([
            ...game.timeEvents.map((event) => ({
              id: event.id,
              playerId: event.playerId,
              playerName: event.playerId
                ? game.players.find((player) => player.id === event.playerId)?.name ?? "-"
                : "Timer",
              kind: "time" as const,
              eventType: "time" as const,
              label: getTimeEventActionLabel(event.action),
              timeAction: event.action,
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
              cpType: event.cpType,
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
              scoreType: event.scoreType,
              value: event.value,
              displayValue: Math.abs(event.value),
              note: event.note,
              roundNumber: event.roundNumber,
              turnNumber: event.turnNumber,
              createdAt: event.createdAt
            })),
            ...deriveGameHighlights(game).map((highlight) => ({
              id: highlight.id,
              playerId: highlight.playerId,
              playerName: `${HIGHLIGHT_ICON} Highlight`,
              kind: "highlight" as const,
              eventType: "highlight" as const,
              label: highlight.title,
              note: highlight.subtitle,
              roundNumber: highlight.roundNumber,
              turnNumber: highlight.turnNumber,
              createdAt: highlight.createdAt
            }))
          ])
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
  // Anzeige-Buendelung im Verlauf (Events bleiben einzeln gespeichert und einzeln bearbeitbar ueber "Einzeln").
  const groupedEditableEvents = useMemo(() => groupDisplayEvents(filteredEditableEvents, game.autoCommandPointAwards), [filteredEditableEvents, game.autoCommandPointAwards]);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
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

    const latestKey = activeTurn ? `${activeTurn.roundNumber}:${activeTurn.turnNumber}` : null;
    const previousLatestKey = previousLatestTurnKeyRef.current;
    previousLatestTurnKeyRef.current = latestKey;
    const snapToLatest = snapToLatestTurnRef.current;
    if (latestKey) snapToLatestTurnRef.current = false;
    setSelectedTurnKey((current) => resolveSelectedTurnKey({
      current,
      previousLatestKey,
      latestKey,
      turnKeys: allTurns.map((turn) => turn.key),
      snapToLatest,
      setupStarted: game.timeEvents.some((event) => event.action === "setup-start"),
      setupRunning: isSetupRunning(game),
      followActive: !viewOnlyActive,
      setupActive: isSetupActive(game)
    }));
  }, [activeTurn, allTurns, game, viewOnlyActive]);

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

  const latestRound = game.rounds[game.rounds.length - 1];
  const selectedTurn =
    selectedTurnKey === SETUP_TURN_KEY
      ? undefined
      : allTurns.find((turn) => turn.key === selectedTurnKey) ?? activeTurn;
  const selectedTurnIndex = selectedTurn
    ? allTurns.findIndex((turn) => turn.key === `${selectedTurn.roundNumber}:${selectedTurn.turnNumber}`)
    : -1;
  const selectedRound =
    game.rounds.find((round) => round.roundNumber === selectedTurn?.roundNumber) ?? latestRound;
  const hasSetupPhase = game.timeEvents.some((event) => event.action === "setup-start");
  const isSetupSelected = selectedTurnKey === SETUP_TURN_KEY;
  const needsStartingPlayerBeforeFirstTurn = !game.startingPlayerId && (isSetupSelected || !latestRound);
  const timerFocusTurn = isSetupSelected ? undefined : getTimerFocusTurn(selectedTurn, activeTurn);
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
  const activePlayerId = getShownActivePlayerId(game, selectedTurn, isSetupSelected);
  const isClosed = isGameCompletedForDisplay(game);
  const isReadOnly = viewOnlyActive;
  const writeDisabled = isMutating || isReadOnly;
  const canNavigateTurns = !isMutating;
  const showOverview = isClosed || isReadOnly;
  // Timer-Regel (Tim 22.10.): genau EIN Zug bzw. die Aufstellung zaehlt; der Timer-Zustand (laeuft/gestoppt) ist einer fuer
  // das ganze Spiel. Navigation nimmt ihn mit (Weiter/Zurueck/Rueckgaengig), gestoppt nur per Timer-Knopf, Time-out, Abschluss.
  const runningTurn =
    activeTurn?.timing.startedAt && !activeTurn.timing.endedAt && !isTurnPaused(activeTurn) ? activeTurn : undefined;
  const isSetupScreen = !showOverview && (isSetupSelected || !latestRound);
  const isTimerRunning = !isClosed && !timeoutActive && (Boolean(runningTurn) || setupRunning);
  // Ziel fuer Timer an/aus und Time-out: laeuft er, die laufende Phase; ist er gestoppt, die angewaehlte Phase.
  const timerTargetTurn = setupRunning ? undefined : runningTurn ?? (isSetupSelected ? undefined : selectedTurn);
  const timerTargetRef = timerTargetTurn
    ? { roundNumber: timerTargetTurn.roundNumber, turnNumber: timerTargetTurn.turnNumber }
    : undefined;
  const selectedTurnRef = selectedTurn
    ? { roundNumber: selectedTurn.roundNumber, turnNumber: selectedTurn.turnNumber }
    : undefined;
  const timerStatusLabel = timeoutActive ? "Time-out" : isTimerRunning ? "Läuft" : "Gestoppt";
  const timerStateKey = isClosed ? "closed" : timeoutActive ? "timeout" : isTimerRunning ? "running" : "stopped";

  useEffect(() => {
    if (!isTimerRunning || timeoutActive || isMutating || viewOnlyActive || isGameCompletedForDisplay(game)) {
      setTimeoutHoldOpen(false);
      clearTimeoutHoldTimer();
    }
  }, [game, isMutating, isTimerRunning, timeoutActive, viewOnlyActive]);

  useEffect(() => {
    const previousState = previousTimerStateRef.current;
    previousTimerStateRef.current = timerStateKey;

    if (viewOnlyActive) {
      setTimerStateNotice(null);
      return;
    }
    if (!previousState || previousState === timerStateKey || isClosed) {
      return;
    }

    const nextNotice =
      timerStateKey === "running"
        ? {
            title: "Timer läuft",
            message: "Der Timer wurde gestartet und zählt weiter."
          }
        : timerStateKey === "timeout"
          ? {
              title: "Time-out aktiv",
              message: "Die Spielzeit läuft weiter, die Spielerzeit ist pausiert."
            }
          : {
              title: "Timer gestoppt",
              message: "Der Timer wurde angehalten."
            };

    setTimerStateNotice(nextNotice);
  }, [isClosed, timerStateKey, viewOnlyActive]);

  const displayTurn = timerFocusTurn ?? selectedTurn;
  const displayRound =
    timerFocusTurn ? game.rounds.find((round) => round.roundNumber === timerFocusTurn.roundNumber) ?? selectedRound : selectedRound;
  const selectedRoundTurns = displayRound
    ? getDisplayedRoundTurns(displayRound)
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
  const gameHeaderClassName = `${headerRoundClassName}${isTimerRunning ? " game-header--timer-running" : ""}`;
  const selectedNotePlayer = noteDialogPlayerId
    ? game.players.find((player) => player.id === noteDialogPlayerId)
    : undefined;

  useServerSecondTick(!isClosed && (setupActive || shouldRunTimerRenderTicker(activeTurn, timeoutActive, isClosed)));

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

    setGameForm(createGameFormState(getGame(game.id) ?? game));
    setDetailsOpen(true);
    setIsEditingGame(true);
  };

  const openGameDetails = () => {
    setDetailsOpen(true);
    setIsEditingGame(false);
  };

  const openGameSettings = () => {
    if (isClosed || isReadOnly) {
      openGameDetails();
      return;
    }

    void openGameEditor();
  };

  const closeGameDetails = () => {
    setDetailsOpen(false);
    setIsEditingGame(false);
    setGameForm(createGameFormState(game));
  };

  const openEditor = async (event: EditableEventItem) => {
    if (isReadOnly || event.kind === "highlight") {
      return;
    }

    // Bearbeiten eines Punkte-/CP-Eintrags pausiert die Uhr NICHT (Entscheidung Tim 2026-10-16): der aktive Zug laeuft
    // weiter, Oeffnen/Speichern/Abbrechen erzeugen keine Timer-Events.
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

  const openStatsEligibilityEditor = () => {
    setStatsEligibilityDraft(game.statsEligibilityOverrides ?? {});
    setStatsEligibilityEditorOpen(true);
  };

  const updateStatsEligibilityAreaDraft = (area: StatsEligibilityArea, mode: StatsEligibilityMode) => {
    setStatsEligibilityDraft((current) =>
      normalizeStatsEligibilityDraft({
        ...current,
        areas: {
          ...current.areas,
          [area]: mode
        }
      })
    );
  };

  const updateStatsEligibilityTurnDraft = (
    turnKey: string,
    area: Exclude<StatsEligibilityArea, "result">,
    mode: StatsEligibilityMode
  ) => {
    setStatsEligibilityDraft((current) =>
      normalizeStatsEligibilityDraft({
        ...current,
        turns: {
          ...current.turns,
          [turnKey]: {
            ...current.turns?.[turnKey],
            [area]: mode
          }
        }
      })
    );
  };

  const saveStatsEligibilityOverrides = async () => {
    if (isReadOnly) {
      setStatsEligibilityEditorOpen(false);
      return;
    }

    await updateStatsEligibilityOverrides(game.id, normalizeStatsEligibilityDraft(statsEligibilityDraft));
    setStatsEligibilityEditorOpen(false);
  };

  const handleRequestDeleteGame = () => {
    if (isReadOnly) return;
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
    if (isReadOnly) return;
    if (!isGameAdminPassword(deletePassword)) {
      setDeletePasswordError("Falsches Passwort.");
      return;
    }

    try {
      await deleteGame(game.id);
      closeDeleteDialog();
      onBack();
    } catch (error) {
      setDeletePasswordError(error instanceof Error ? error.message : "Spiel konnte nicht gelöscht werden.");
    }
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

    setFinishDialogError("");
    setFinishDialogOpen(true);
  };

  const closeFinishDialog = () => {
    setFinishDialogOpen(false);
    setFinishDialogError("");
  };

  const handleFinishGame = async (finishReason: GameFinishReason) => {
    if (isReadOnly) return;
    try {
      await finishGame(game.id, finishReason);
      closeFinishDialog();
    } catch (error) {
      setFinishDialogError(error instanceof Error ? error.message : "Spiel konnte nicht beendet werden.");
    }
  };

  const handleDeleteEvent = async (event: EditableEventItem) => {
    if (isReadOnly || event.kind === "highlight") {
      return;
    }

    if (!window.confirm("Eintrag wirklich löschen?")) {
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
    if (isReadOnly && !closedTv) return;
    setReopenPasswordOpen(true);
    setReopenPassword("");
    setReopenPasswordError("");
  };

  const handleConfirmReopenGame = async () => {
    if (isReadOnly && !closedTv) return;
    if (!isGameAdminPassword(reopenPassword)) {
      setReopenPasswordError("Falsches Passwort.");
      return;
    }

    try {
      // Erst nach korrektem Passwort: Bearbeiten freigeben und TV-Link verlassen (sonst blockiert die Route das Schreiben).
      if (closedTv) {
        const url = new URL(window.location.href);
        ["tv", "mode", "view", "readonly"].forEach((key) => url.searchParams.delete(key));
        url.hash = `/game/${game.id}`;
        window.history.replaceState(null, "", url);
        setGameAccessMode(game.id, "edit");
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }
      setGameAccessMode(game.id, "edit");
      await reopenGame(game.id);
      // Nachtraegliche Korrektur: Timer bleibt gestoppt.
      await pauseActiveTimer(game.id);
      closeReopenDialog();
      // Nur wenn das Spiel danach wirklich offen ist, bleibt Edit aktiv. Sonst zurueck zu View only.
      const reopened = getGame(game.id);
      if (!reopened || isGameCompletedForDisplay(reopened)) {
        setGameAccessMode(game.id, "view");
        setReopenPasswordError("Spiel konnte nicht wieder eröffnet werden. Es bleibt abgeschlossen (View only).");
        return;
      }
    } catch (error) {
      setGameAccessMode(game.id, "view");
      setReopenPasswordError(error instanceof Error ? error.message : "Spiel konnte nicht wieder eröffnet werden.");
    }
  };

  const handleUndoLastEvent = async () => {
    if (isReadOnly || !undoActionLabel) {
      return;
    }

    closeEditor();
    // Rueckgaengig von Weiter/Zurueck = Navigation in die Gegenrichtung ab dem angewaehlten Zug, gleiche Timer-Regel
    // (laeuft weiter bzw. bleibt gestoppt). Der Store verschiebt nur den Verlaufseintrag.
    if (undoActionLabel.startsWith("Weiter") || undoActionLabel.startsWith("Zurück")) {
      const wasAdvance = undoActionLabel.startsWith("Weiter");
      await undoGameAction(game.id, true);
      await (wasAdvance ? handleGoBack(false) : handleAdvance(false));
      return;
    }
    // Rueckgaengig von Timer an/aus bzw. Time-out stellt den Timer-Zustand wieder her; laeuft er danach in einem anderen
    // Zug, wird dieser angewaehlt (nie verdeckt laufen, Tim 22.10.).
    if (isTimerHistoryLabel(undoActionLabel)) snapToLatestTurnRef.current = true;
    await undoGameAction(game.id);
  };

  const handleRedoEvent = async () => {
    if (isReadOnly || !redoActionLabel) {
      return;
    }

    closeEditor();
    if (redoActionLabel.startsWith("Weiter") || redoActionLabel.startsWith("Zurück")) {
      const wasAdvance = redoActionLabel.startsWith("Weiter");
      await redoGameAction(game.id, true);
      await (wasAdvance ? handleAdvance(false) : handleGoBack(false));
      return;
    }
    if (isTimerHistoryLabel(redoActionLabel)) snapToLatestTurnRef.current = true;
    await redoGameAction(game.id);
  };

  // Scoreboard im Edit-Modus oeffnet die View-only-Ansicht; zurueck nur ueber Main -> Spiel -> Edit.
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!shareNotice) return;
    const timer = window.setTimeout(() => setShareNotice(null), 2500);
    return () => window.clearTimeout(timer);
  }, [shareNotice]);
  const handleShareLink = async () => {
    if (!game) return;
    const url = buildSpectatorLink(window.location.origin, window.location.pathname, game.id);
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    const isMobile = Boolean(window.matchMedia?.("(pointer: coarse)").matches);
    const result = await shareSpectatorLink(url, `${game.players[0].name} vs. ${game.players[1].name}`, {
      clipboardWrite: nav.clipboard?.writeText ? (text) => nav.clipboard.writeText(text) : undefined,
      share: typeof nav.share === "function" ? (data) => nav.share!(data) : undefined,
      isMobile
    });
    const message = shareResultMessage(result, url);
    if (message) setShareNotice(message);
  };
  const openViewOnly = () => {
    setGameAccessMode(game.id, "view");
    window.location.hash = getTvModeHash(game.id);
  };

  const openOverviewWindow = () => {
    setOverviewOpen(true);
  };

  const closeOverviewWindow = () => {
    setOverviewOpen(false);
  };

  const handleStartTimeout = async () => {
    if (isReadOnly || !timerTargetRef || !isTimerRunning) {
      return;
    }

    await startTimeout(game.id, timerTargetRef);
  };

  const handleStartTimeoutFromHold = async () => {
    setTimeoutHoldOpen(false);
    await handleStartTimeout();
  };

  const handleEndTimeout = async () => {
    if (isReadOnly || !timeoutActive) {
      return;
    }

    // Nach dem Time-out laeuft der Timer im angewaehlten Zug weiter (auch wenn waehrenddessen navigiert wurde).
    const resumeTurn = selectedTurn ?? activeTurn;
    await endTimeout(
      game.id,
      resumeTurn ? { roundNumber: resumeTurn.roundNumber, turnNumber: resumeTurn.turnNumber } : undefined
    );
    if (isSetupSelected && resumeTurn) setSelectedTurnKey(`${resumeTurn.roundNumber}:${resumeTurn.turnNumber}`);
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

  const handleAdvance = async (recordHistory = true) => {
    if (isMutating || advanceInFlightRef.current || isClosed) {
      return;
    }

    advanceInFlightRef.current = true;
    try {
      if (needsStartingPlayerBeforeFirstTurn) {
        setStartingPlayerPromptSlot("");
        setStartingPlayerPromptOpen(true);
        return;
      }

      if (isSetupSelected) {
        const firstTurn = allTurns[0];
        if (firstTurn) {
          if (!isReadOnly && isTimerRunning) {
            await advanceGame(game.id, SETUP_TURN_REF, true, recordHistory);
          } else if (!isReadOnly) {
            // Gestoppt (auch im Time-out): Zug 1 wird aktiv, zeitneutral gespeichert, im Verlauf (Pepper 22.10. A/B)
            await selectPhase(game.id, { roundNumber: firstTurn.roundNumber, turnNumber: firstTurn.turnNumber }, "Weiter", null, recordHistory);
          }
          setSelectedTurnKey(firstTurn.key);
          return;
        }
        // noch kein Zug: weiter unten R1Z1 anlegen (laufend bzw. gestoppt wie die Aufstellung)
      }

      if (canGoForwardToExistingTurn) {
        const nextTurn = allTurns[selectedTurnIndex + 1];
        if (nextTurn) {
          if (!isReadOnly && isTimerRunning) {
            // Laufender Timer zieht in den Folgezug mit.
            await advanceGame(game.id, selectedTurnRef, true, recordHistory);
          } else if (!isReadOnly) {
            // Gestoppt bleibt gestoppt, der Folgezug wird aber aktiv (gespeichert, alle Geraete, Rueckgaengig).
            await selectPhase(game.id, { roundNumber: nextTurn.roundNumber, turnNumber: nextTurn.turnNumber }, "Weiter", selectedTurnRef ?? null, recordHistory);
          }
          setSelectedTurnKey(nextTurn.key);
        }
        return;
      }

      if (isReadOnly) {
        return;
      }

      snapToLatestTurnRef.current = true;
      await advanceGame(game.id, selectedTurnRef, isTimerRunning, recordHistory);
    } finally {
      advanceInFlightRef.current = false;
    }
  };

  const handleGoBack = async (recordHistory = true) => {
    if (isMutating || !canGoBack) {
      return;
    }

    const previousTurn = allTurns[selectedTurnIndex - 1];
    const target = previousTurn ? previousTurn.key : selectedTurnIndex === 0 && hasSetupPhase ? SETUP_TURN_KEY : null;
    if (!target) {
      return;
    }

    // Zurueck (Tim 22.10.): der vorherige Zug bzw. die Aufstellung wird aktiv. Laeuft der Timer, zaehlt er ab jetzt dort
    // (rewindLastTurn: laufenden Zug pausieren, Ziel fortsetzen - die Auswertung oeffnet einen beendeten Zug dafuer wieder);
    // ist er gestoppt, bleibt er gestoppt, das Ziel wird aber aktiv (zeitneutrale Markierung, gespeichert, im Verlauf).
    if (!isReadOnly && isTimerRunning) {
      await rewindLastTurn(game.id, selectedTurnRef, true, recordHistory);
    } else if (!isReadOnly) {
      const targetRef = previousTurn ? { roundNumber: previousTurn.roundNumber, turnNumber: previousTurn.turnNumber } : null;
      await selectPhase(game.id, targetRef, "Zurück", selectedTurnRef ?? null, recordHistory);
    }
    setSelectedTurnKey(target);
  };

  // Escape schliesst den obersten offenen Dialog (Menue behandelt FloatingMenu selbst).
  const escapeClosers: Array<[boolean, () => void]> = [
    [reopenPasswordOpen, closeReopenDialog],
    [deletePasswordOpen, closeDeleteDialog],
    [statsEligibilityEditorOpen, () => setStatsEligibilityEditorOpen(false)],
    [noteDialogPlayerId !== null, closeNoteDialog],
    [editingEventId !== null, closeEditor],
    [finishDialogOpen, closeFinishDialog],
    [entriesOpen, () => setEntriesOpen(false)],
    [notesOpen, () => setNotesOpen(false)],
    [detailsOpen, closeGameDetails],
    [overviewOpen, closeOverviewWindow],
    [scoreLimitWarning !== null, () => setScoreLimitWarning(null)],
    [timerStateNotice !== null, () => setTimerStateNotice(null)]
  ];
  const escapeCloseRef = useRef<(() => void) | null>(null);
  escapeCloseRef.current = escapeClosers.find(([open]) => open)?.[1] ?? null;
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !escapeCloseRef.current) return;
      event.preventDefault();
      escapeCloseRef.current();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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
      headerClassName={gameHeaderClassName}
      actions={viewOnlyTv ? undefined :
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
            ariaLabel="Spielmenü"
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
                  { label: "Verlauf", onClick: () => setEntriesOpen(true) },
                  { label: "Link teilen", onClick: () => { void handleShareLink(); } },
                  { label: "Einstellungen", onClick: openGameSettings },
                  ...followMenuItems,
                  ...accessChoiceMenuItems,
                  ...(!isReadOnly ? [isClosed
                    ? {
                        label: "Spiel wieder eröffnen",
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
                    label: "Spiel löschen",
                    onClick: handleRequestDeleteGame,
                    disabled: writeDisabled,
                    danger: true
                  }] : [])
                ]
              }
            ]}
          />
        </>
      }
    >
      {viewOnlyTv ? (
        <TvGameView
          game={game}
          fullscreenDocument
          onShareLink={() => { void handleShareLink(); }}
          menu={
            <FloatingMenu
              fixed
              className="floating-menu--tv"
              ariaLabel="Spielmenü"
              sections={[
                {
                  label: "Navigation",
                  items: [
                    { label: "Main", onClick: () => { exitTvToGames(); } },
                    { label: "Neues Spiel", onClick: () => { window.location.hash = "/new"; } },
                    { label: "Statistik", onClick: () => { window.location.hash = "/stats"; } }
                  ]
                },
                {
                  label: "Optionen",
                  items: [
                    { label: "Verlauf", onClick: () => { setEntriesOpen(true); } },
                    { label: "Link teilen", onClick: () => { void handleShareLink(); } },
                    { label: "Einstellungen", onClick: () => { openGameSettings(); } },
                    ...followMenuItems,
                    ...accessChoiceMenuItems,
                    // Nur bei abgeschlossenem Spiel; laufende Spiele in View only: kein Entsperren/Edit (nur ueber Main).
                    ...(closedTv ? [{ label: "Entsperren", onClick: () => { handleRequestReopenGame(); }, disabled: isMutating }] : [])
                  ]
                }
              ]}
            />
          }
        />
      ) : null}
      {shouldShowAccessModeDialog ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="stack">
              <div>
                <h2>Match öffnen</h2>
                <p className="muted-copy">Dieses Match läuft noch.</p>
              </div>
              <div className="button-row button-row--compact">
                <button
                  type="button"
                  className="primary-button compact-button"
                  onClick={() => { rememberAccessMode(game.id, "edit"); setGameAccessMode(game.id, "edit"); }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="secondary-button compact-button"
                  onClick={() => { rememberAccessMode(game.id, "view"); setGameAccessMode(game.id, "view"); window.location.hash = getTvModeHash(game.id); }}
                >
                  View only
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
              {scoreLimitWarning.thresholds.join(" / ")} Punkte erreicht oder überschritten.
              Bitte prüfen, ob das Limit erreicht ist.
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
          <span>Spielzeit läuft, Spielerzeit ist pausiert.</span>
        </div>
      ) : null}
      {!viewOnlyActive && timerStateNotice ? (
        <div className="modal-backdrop">
          <div className="modal-card timer-state-modal">
            <div className="stack">
              <div>
                <h2>{timerStateNotice.title}</h2>
                <p className="muted-copy">{timerStateNotice.message}</p>
              </div>
              <button
                type="button"
                className="primary-button compact-button"
                onClick={() => setTimerStateNotice(null)}
              >
                Verstanden
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {overviewOpen && (!showOverview || closedTv) ? (
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
                  Schließen
                </button>
              </div>
              <GameOverview game={game} />
            </div>
          </div>
        </div>
      ) : null}
      {reopenPasswordOpen ? (
        <PasswordDialog
          title="Spiel wieder eröffnen"
          confirmLabel="Wieder eröffnen"
          value={reopenPassword}
          error={reopenPasswordError}
          disabled={isMutating}
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
          title="Spiel löschen"
          confirmLabel="Spiel löschen"
          value={deletePassword}
          error={deletePasswordError}
          hint="Alle Events dieses Spiels werden dabei entfernt."
          confirmTone="danger"
          disabled={isMutating}
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
                  Schließen
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
                <h2>Startspieler auswählen</h2>
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
                  <option value="">Bitte auswählen</option>
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

        {/* Die alte Nur-Lesen-Uebersicht gibt es nicht mehr: abgeschlossen/View only => TV-Ansicht,
            laufend ohne Modus => nur der Auswahldialog. */}
        {viewOnlyTv || showOverview ? null : isSetupScreen ? (
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
                  <span className="scoreboard-stat__meta">Zählt zur Gesamtzeit</span>
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
                    Schließen
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
                  {statsEligibilityReport ? (
                    <section className="card stack stats-eligibility-card">
                      <div className="list-row">
                        <h2>Wertung Statistik</h2>
                        <button
                          type="button"
                          className="ghost-button compact-button"
                          disabled={writeDisabled}
                          onClick={openStatsEligibilityEditor}
                        >
                          Wertung bearbeiten
                        </button>
                      </div>
                      <div className="scoreboard__grid scoreboard__grid--details">
                        {STATS_ELIGIBILITY_AREAS.map((area) => {
                          const decision = statsEligibilityReport.areas[area];
                          return (
                            <div key={area}>
                              <span>{decision.label}</span>
                              <strong>{statsEligibilityStatusLabel(decision.effective)}</strong>
                              <p>Modus: {decision.mode === "auto" ? "Auto" : "Manuell"}</p>
                              <p>Auto: {statsEligibilityStatusLabel(decision.auto)}</p>
                              {decision.countedTurns.length ? (
                                <p>Gewertet: {decision.countedTurns.join(", ")}</p>
                              ) : null}
                              {decision.excludedTurns.length ? (
                                <p>Nicht gewertet: {decision.excludedTurns.join(", ")}</p>
                              ) : null}
                              <p>{decision.reasons[0]}</p>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ) : (
                    <section className="card stack stats-eligibility-card">
                      <div className="list-row">
                        <h2>Wertung Statistik</h2>
                      </div>
                      <p className="muted-copy">
                        Wertung konnte für dieses Spiel nicht vollständig berechnet werden. Game-ID: {game.id}
                      </p>
                    </section>
                  )}

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
                    <span>Primärmission</span>
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

      {statsEligibilityEditorOpen && statsEligibilityReport ? (
        <div className="modal-backdrop">
          <div className="modal-card modal-card--wide">
            <div className="stack">
              <div className="list-row">
                <div>
                  <h2>Wertung Statistik bearbeiten</h2>
                  <p className="muted-copy">Overrides verändern nur die Statistikwertung, nicht die Rohdaten.</p>
                </div>
                <button
                  type="button"
                  className="ghost-button compact-button"
                  onClick={() => setStatsEligibilityEditorOpen(false)}
                >
                  Schließen
                </button>
              </div>

              <section className="card stack">
                <h3>Bereiche</h3>
                <div className="scoreboard__grid scoreboard__grid--details">
                  {STATS_ELIGIBILITY_AREAS.map((area) => {
                    const decision = statsEligibilityReport.areas[area];
                    return (
                      <label key={area} className="field">
                        <span>{decision.label}</span>
                        <select
                          value={statsEligibilityDraft.areas?.[area] ?? "auto"}
                          disabled={writeDisabled}
                          onChange={(event) =>
                            updateStatsEligibilityAreaDraft(area, event.target.value as StatsEligibilityMode)
                          }
                        >
                          <option value="auto">Auto</option>
                          <option value="include">Include</option>
                          <option value="exclude">Exclude</option>
                        </select>
                        <p className="muted-copy">
                          Auto: {statsEligibilityStatusLabel(decision.auto)} · Effektiv: {statsEligibilityStatusLabel(decision.effective)}
                        </p>
                      </label>
                    );
                  })}
                </div>
              </section>

              {statsEligibilityReport.turns.length ? (
                <section className="card stack">
                  <h3>Züge</h3>
                  <div className="event-list modal-list">
                    {statsEligibilityReport.turns.map((turn) => (
                      <div key={turn.key} className="event-list__item">
                        <div>
                          <strong>{turn.label}</strong>
                          <p>{turn.playerName}</p>
                        </div>
                        <div className="scoreboard__grid scoreboard__grid--details">
                          {STATS_ELIGIBILITY_TURN_AREAS.map((area) => {
                            const decision = turn.areas[area];
                            return (
                              <label key={area} className="field">
                                <span>{statsEligibilityReport.areas[area].label}</span>
                                <select
                                  value={statsEligibilityDraft.turns?.[turn.key]?.[area] ?? "auto"}
                                  disabled={writeDisabled}
                                  onChange={(event) =>
                                    updateStatsEligibilityTurnDraft(
                                      turn.key,
                                      area,
                                      event.target.value as StatsEligibilityMode
                                    )
                                  }
                                >
                                  <option value="auto">Auto</option>
                                  <option value="include">Include</option>
                                  <option value="exclude">Exclude</option>
                                </select>
                                <p className="muted-copy">
                                  Auto: {decision.auto ? "zählt" : "zählt nicht"} · Effektiv: {decision.effective ? "zählt" : "zählt nicht"}
                                </p>
                                <p className="muted-copy">{decision.reasons.join(", ")}</p>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              <div className="button-row button-row--compact">
                <button
                  type="button"
                  className="primary-button compact-button"
                  disabled={writeDisabled}
                  onClick={() => void saveStatsEligibilityOverrides()}
                >
                  Speichern
                </button>
                <button
                  type="button"
                  className="ghost-button compact-button"
                  onClick={() => setStatsEligibilityEditorOpen(false)}
                >
                  Abbrechen
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}


      {shareNotice ? <div className="share-notice" role="status">{shareNotice}</div> : null}
      {entriesOpen ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="stack">
              <div className="list-row">
                <div>
                  <h2>Einträge</h2>
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
                  Schließen
                </button>
              </div>
              {finishDialogError ? <p className="muted-copy">{finishDialogError}</p> : null}
              {!isReadOnly ? (
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
              ) : null}
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
                    <option value="highlight">Highlights</option>
                  </select>
                </label>
              </div>
              {filteredEditableEvents.length ? (
                <div className="event-list event-list--editable modal-list">
                  {(() => {
                    const renderRow = (event: EditableEventItem, extraClass = "") => (
                      <article
                        key={event.id}
                        className={`event-list__row ${getRoundSurfaceClassName(event.roundNumber)}${event.kind === "highlight" ? " event-list__row--highlight" : ""}${extraClass}`}
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
                          {!isReadOnly && event.kind !== "highlight" ? (
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
                              Löschen
                            </button>
                          </div>
                          ) : null}
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
                            {/* Notizen werden nicht mehr angezeigt/bearbeitet; editingNote bleibt unveraendert, vorhandene Notiz bleibt erhalten. */}
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
                              : event.kind === "highlight" ? event.note ?? "" : ""}
                          </p>
                        )}
                      </article>
                    );
                    return groupedEditableEvents.map((group) => {
                      const expandable = group.items.length > 1 || group.autoCp.length > 0;
                      if (!expandable) return renderRow(group.first);
                      const open = Boolean(expandedGroups[group.key]);
                      const e = group.latest;
                      const label = group.kind === "cp" ? formatCpGroup(group)
                        : group.kind === "score" ? `${group.first.label.replace(/ [+-]$/, "")} ${formatScoreValue(group.scoreSum)}`
                        : `${group.first.label}${AUTO_CP_SUFFIX}`;
                      const count = group.items.length + group.autoCp.length;
                      return (
                        <div key={`group:${group.key}`} className="event-list__group">
                          <article className={`event-list__row event-list__row--group ${getRoundSurfaceClassName(e.roundNumber)}`}>
                            <div className="event-editor__meta">
                              <div className="event-editor__summary">
                                <strong>{group.first.playerName}</strong>
                                <p className="event-editor__context">{label} | R{e.roundNumber ?? "-"} / Z{e.turnNumber ?? "-"}</p>
                              </div>
                              <span className="event-editor__stamp">{formatClockTimeWithSeconds(group.createdAt)}</span>
                              <div className="button-row button-row--compact event-editor__actions">
                                <button type="button" className="ghost-button compact-button" aria-expanded={open}
                                  onClick={() => setExpandedGroups((current) => ({ ...current, [group.key]: !open }))}>
                                  {open ? "Zuklappen" : `Einzeln (${count})`}
                                </button>
                              </div>
                            </div>
                            <p className="event-list__detail">{count} Einträge zusammengefasst</p>
                          </article>
                          {open ? [...group.items, ...group.autoCp].sort((l, r) => r.createdAt.localeCompare(l.createdAt)).map((item) => renderRow(item, " event-list__row--child")) : null}
                        </div>
                      );
                    });
                  })()}
                </div>
              ) : (
                <p className="muted-copy">
                  {editableEvents.length
                    ? "Keine Einträge passend zum aktuellen Filter."
                    : "Noch keine editierbaren Einträge."}
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
              Zurück
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
                title={`${undoLabel}${redoActionLabel ? " | Halten für Redo" : ""}`}
              >
                <span className="game-bottom-dock__primary-label">{undoLabel}</span>
                <small className="game-bottom-dock__hint">(hold Redo)</small>
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
                className="secondary-button compact-button game-bottom-dock__timer"
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
                      ? pauseActiveTimer(game.id, timerTargetRef)
                      : startGameTimer(game.id, timerTargetRef)
                  );
                }}
                disabled={writeDisabled}
              >
                <span className="game-bottom-dock__primary-label">{isTimerRunning ? "Timer aus" : "Timer an"}</span>
                <small className="game-bottom-dock__hint">(hold Time-out)</small>
              </button>
            </div>
          </div>
        </>
      ) : null}
    </Layout>
  );
};
