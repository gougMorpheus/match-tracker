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
import type { CreateGameInput, Game, PlayerId } from "../types/game";
import { buildGameFormOptions, getPlayerArmyComboKey } from "../utils/gameFormOptions";
import {
  getCurrentRoundNumber,
  getGameDurationMs,
  getLatestTurn,
  getPlayerCommandPoints,
  getPlayerPrimaryTotal,
  getPlayerSecondaryTotal,
  getRoundCorrectionMs,
  getSessionDurationMs,
  getTotalCorrectionMs,
  getTurnBaseDurationMs,
  getTurnDurationMs,
  isTurnPaused
} from "../utils/gameCalculations";
import { isGameAdminPassword } from "../utils/gameSecurity";
import { formatClockTime, formatClockTimeWithSeconds, formatDateLabel, formatDuration } from "../utils/time";

interface GamePageProps {
  gameId: string;
  onBack: () => void;
  forceOverview?: boolean;
}

type EditableEventFilterType =
  | "all"
  | "cp-gained"
  | "cp-spent"
  | "primary"
  | "secondary"
  | "legacy-total"
  | "note";

interface EditableEventItem {
  id: string;
  playerId: string;
  playerName: string;
  kind: "cp" | "score" | "note";
  eventType: Exclude<EditableEventFilterType, "all">;
  label: string;
  value?: number;
  displayValue?: number;
  note?: string;
  roundNumber?: number;
  turnNumber?: number;
  createdAt: string;
}

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
  defenderSlot: game.defenderPlayerId === game.players[0].id ? "player1" : "player2",
  startingSlot: game.startingPlayerId === game.players[0].id ? "player1" : "player2"
});

const getRoundSurfaceClassName = (roundNumber?: number) =>
  roundNumber && roundNumber % 2 === 0 ? "round-surface round-surface--even" : "round-surface round-surface--odd";

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
    setTimerCorrections,
    resetAllGameTimers,
    addScoreEvent,
    addCommandPointEvent,
    addNoteEvent,
    updateGameEvent,
    deleteGameEvent,
    updateGameDetails,
    pauseActiveTimer,
    startGameTimer,
    reopenGame,
    finishGame,
    deleteGame,
    undoGameAction,
    redoGameAction,
    getUndoActionLabel,
    getRedoActionLabel
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
  const [timerAdjustOpen, setTimerAdjustOpen] = useState(false);
  const [timerAdjustTurnSeconds, setTimerAdjustTurnSeconds] = useState("0");
  const [timerAdjustRoundSeconds, setTimerAdjustRoundSeconds] = useState("0");
  const [timerAdjustTotalSeconds, setTimerAdjustTotalSeconds] = useState("0");
  const [actionFlash, setActionFlash] = useState<"cp" | "score" | null>(null);
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
  const previousRoundRef = useRef<number | null>(null);
  const snapToLatestTurnRef = useRef(false);
  const game = getGame(gameId);
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

  useEffect(() => {
    if (detailsOpen || isEditingGame) {
      return;
    }

    const runningTurn = latestTurn;
    if (
      !runningTurn?.timing.startedAt ||
      runningTurn.timing.endedAt ||
      isTurnPaused(runningTurn)
    ) {
      return;
    }

    const interval = window.setInterval(() => {
      setTick((current) => current + 1);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [detailsOpen, isEditingGame, latestTurn]);

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
    if (roundChangePulse === null) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setRoundChangePulse(null);
    }, 1500);

    return () => window.clearTimeout(timeout);
  }, [roundChangePulse]);

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
    allTurns.find((turn) => turn.key === selectedTurnKey) ?? latestTurn;
  const selectedTurnIndex = selectedTurn
    ? allTurns.findIndex((turn) => turn.key === `${selectedTurn.roundNumber}:${selectedTurn.turnNumber}`)
    : -1;
  const selectedRound =
    game.rounds.find((round) => round.roundNumber === selectedTurn?.roundNumber) ?? latestRound;
  const canGoBack = selectedTurnIndex > 0;
  const canGoForwardToExistingTurn =
    selectedTurnIndex >= 0 && selectedTurnIndex < allTurns.length - 1;
  const selectedRoundTurns =
    selectedRound?.turns.filter((turn) =>
      selectedTurn ? turn.turnNumber <= selectedTurn.turnNumber : true
    ) ?? [];
  const selectedRoundDurationMs = selectedRound
    ? Math.max(
        selectedRoundTurns.reduce((total, turn) => total + getTurnDurationMs(turn, game), 0) +
          getRoundCorrectionMs(game, selectedRound.roundNumber),
        0
      )
    : 0;
  const orderedPlayers =
    game.players[0].id === game.startingPlayerId ? game.players : [game.players[1], game.players[0]];
  const activePlayerId = selectedTurn?.playerId ?? game.currentPlayerId;
  const isClosed = game.status === "completed";
  const showOverview = isClosed || forceOverview;
  const isPaused = isTurnPaused(selectedTurn);
  const hasActiveTurn = Boolean(selectedTurn?.timing.startedAt && !selectedTurn.timing.endedAt);
  const isTimerRunning = !isClosed && hasActiveTurn && !isPaused;
  const timerStatusLabel = isTimerRunning ? "Laeuft" : "Gestoppt";
  const currentRoundNumber = selectedRound?.roundNumber ?? getCurrentRoundNumber(game);
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
    if (isClosed) {
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
    setEditingEventId(event.id);
    setEditingValue(typeof event.displayValue === "number" ? String(event.displayValue) : "");
    setEditingNote(event.note ?? "");
  };

  const closeEditor = () => {
    setEditingEventId(null);
    setEditingValue("");
    setEditingNote("");
  };

  const saveEditedEvent = async (event: EditableEventItem) => {
    const parsedValue = event.kind === "note" ? undefined : Math.abs(Number(editingValue));
    const nextValue =
      event.kind === "note"
        ? undefined
        : typeof parsedValue === "number" && Number.isFinite(parsedValue)
          ? event.kind === "score" && (event.value ?? 0) < 0
            ? parsedValue * -1
            : parsedValue
          : event.value ?? 0;

    await updateGameEvent(game.id, event.id, {
      value_number: nextValue,
      note: editingNote.trim() || null
    });
    closeEditor();
  };

  const handleGameSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await updateGameDetails(game.id, gameForm);
    setDetailsOpen(false);
    setIsEditingGame(false);
  };

  const handleRequestDeleteGame = () => {
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
    await deleteGame(game.id);
    window.location.hash = "/games";
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

  const openTimerAdjustDialog = async () => {
    if (!selectedTurn || !selectedRound) {
      return;
    }

    if (isTimerRunning) {
      await pauseActiveTimer(game.id, {
        roundNumber: selectedTurn.roundNumber,
        turnNumber: selectedTurn.turnNumber
      });
    }

    setTimerAdjustTurnSeconds(String(Math.round(getTurnDurationMs(selectedTurn, game) / 1000)));
    setTimerAdjustRoundSeconds(String(Math.round(selectedRoundDurationMs / 1000)));
    setTimerAdjustTotalSeconds(String(Math.round(getGameDurationMs(game) / 1000)));
    setTimerAdjustOpen(true);
  };

  const closeTimerAdjustDialog = () => {
    setTimerAdjustOpen(false);
  };

  const handleSaveTimerAdjustments = async () => {
    if (!selectedTurn || !selectedRound) {
      return;
    }

    const targetTurnMs = Math.max(0, Math.round(Number(timerAdjustTurnSeconds) || 0) * 1000);
    const targetRoundMs = Math.max(0, Math.round(Number(timerAdjustRoundSeconds) || 0) * 1000);
    const targetTotalMs = Math.max(0, Math.round(Number(timerAdjustTotalSeconds) || 0) * 1000);
    const turnBaseMs = getTurnBaseDurationMs(selectedTurn);
    const roundBaseMs = selectedRoundTurns.reduce((total, turn) => total + getTurnDurationMs(turn, game), 0);
    const totalBaseMs = Math.max(getGameDurationMs(game) - getTotalCorrectionMs(game), 0);

    await setTimerCorrections({
      gameId: game.id,
      turnRef: {
        roundNumber: selectedTurn.roundNumber,
        turnNumber: selectedTurn.turnNumber
      },
      turnMs: targetTurnMs - turnBaseMs,
      roundMs: targetRoundMs - roundBaseMs,
      totalMs: targetTotalMs - totalBaseMs
    });

    closeTimerAdjustDialog();
  };

  const handleResetTimerAdjustments = async () => {
    await resetAllGameTimers(game.id);

    setTimerAdjustTurnSeconds("0");
    setTimerAdjustRoundSeconds("0");
    setTimerAdjustTotalSeconds("0");
    closeTimerAdjustDialog();
  };

  const handleDeleteEvent = async (event: EditableEventItem) => {
    if (!window.confirm("Eintrag wirklich loeschen?")) {
      return;
    }

    await deleteGameEvent(game.id, event.id);
    if (editingEventId === event.id) {
      closeEditor();
    }
  };

  const handleAddNote = async () => {
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
    if (!undoActionLabel) {
      return;
    }

    closeEditor();
    await undoGameAction(game.id);
  };

  const handleRedoEvent = async () => {
    if (!redoActionLabel) {
      return;
    }

    closeEditor();
    await redoGameAction(game.id);
  };

  const handleAdvance = async () => {
    if (canGoForwardToExistingTurn) {
      const nextTurn = allTurns[selectedTurnIndex + 1];
      if (nextTurn) {
        if (isTimerRunning) {
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
    if (!canGoBack) {
      return;
    }

    const previousTurn = allTurns[selectedTurnIndex - 1];
    if (previousTurn) {
      if (isTimerRunning) {
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
    }
  };

  return (
    <Layout
      title="Tracker"
      subtitle={
        <div className="game-header-stats">
          <span>
            Runde {selectedRound?.roundNumber ?? 0} ({formatDuration(selectedRoundDurationMs)})
          </span>
          <span>
            Zug {selectedTurn?.turnNumber ?? 0} ({formatDuration(selectedTurn ? getTurnDurationMs(selectedTurn, game) : 0)})
          </span>
          <span>Gesamt {formatDuration(getGameDurationMs(game))}</span>
        </div>
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
              <span className={`status-pill ${isTimerRunning ? "status-pill--active" : ""}`}>
                Timer: {timerStatusLabel}
              </span>
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
                  { label: "Spieldetails", onClick: openGameDetails },
                  { label: "Verlauf", onClick: () => setEntriesOpen(true) },
                  {
                    label: redoLabel,
                    onClick: () => void handleRedoEvent(),
                    disabled: isMutating || !redoActionLabel || isClosed
                  },
                  { label: "Notizen", onClick: () => setNotesOpen(true) },
                  ...(!showOverview
                    ? [
                        {
                          label: "Timer korrigieren",
                          onClick: () => void openTimerAdjustDialog(),
                          disabled: !selectedTurn
                        }
                      ]
                    : []),
                  isClosed
                    ? {
                        label: "Spiel wieder eroeffnen",
                        onClick: handleRequestReopenGame
                      }
                    : {
                        label: "Spiel beenden",
                        onClick: () => void finishGame(game.id),
                        disabled: isMutating,
                        danger: true
                      },
                  {
                    label: "Spiel loeschen",
                    onClick: handleRequestDeleteGame,
                    disabled: isMutating,
                    danger: true
                  }
                ]
              }
            ]}
          />
        </>
      }
    >
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
      {reopenPasswordOpen ? (
        <PasswordDialog
          title="Spiel wieder eroeffnen"
          confirmLabel="Wieder eroeffnen"
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
          title="Spiel loeschen"
          confirmLabel="Spiel loeschen"
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
      {timerAdjustOpen ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="stack">
              <div className="list-row">
                <div>
                  <h2>Timer korrigieren</h2>
                  <p className="muted-copy">
                    Runde {selectedTurn?.roundNumber ?? "-"} / Zug {selectedTurn?.turnNumber ?? "-"}
                  </p>
                </div>
                <button
                  type="button"
                  className="ghost-button compact-button"
                  onClick={closeTimerAdjustDialog}
                >
                  Schliessen
                </button>
              </div>
              <label className="field">
                <span>Zug in Sekunden</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={timerAdjustTurnSeconds}
                  disabled={isMutating}
                  onChange={(event) => setTimerAdjustTurnSeconds(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Runde in Sekunden</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={timerAdjustRoundSeconds}
                  disabled={isMutating}
                  onChange={(event) => setTimerAdjustRoundSeconds(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Gesamt in Sekunden</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={timerAdjustTotalSeconds}
                  disabled={isMutating}
                  onChange={(event) => setTimerAdjustTotalSeconds(event.target.value)}
                />
              </label>
              <div className="button-row button-row--compact">
                <button
                  type="button"
                  className="primary-button compact-button"
                  disabled={isMutating}
                  onClick={() => void handleSaveTimerAdjustments()}
                >
                  Speichern
                </button>
                <button
                  type="button"
                  className="danger-button compact-button"
                  disabled={isMutating}
                  onClick={() => void handleResetTimerAdjustments()}
                >
                  Zuruecksetzen
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
        ) : (
          <div className="stack">
            {orderedPlayers.map((player) => (
              <PlayerScoreboard
                key={player.id}
                game={game}
                player={player}
                emphasized={activePlayerId === player.id}
                defender={game.defenderPlayerId === player.id}
                timerRunning={isTimerRunning && activePlayerId === player.id}
                noteAction={
                  <button
                    type="button"
                    className="ghost-button compact-button scoreboard__note-button"
                    disabled={isMutating}
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
                    isSubmitting={isMutating || isClosed}
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
                          : getPlayerSecondaryTotal(game, playerId);
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
                disabled={isMutating}
                onChange={(event) => setNoteDraft(event.target.value)}
              />
              <div className="button-row button-row--compact">
                <button
                  type="button"
                  className="primary-button compact-button"
                  disabled={isMutating || !noteDraft.trim()}
                  onClick={() => void handleAddNote()}
                >
                  Speichern
                </button>
                <button
                  type="button"
                  className="ghost-button compact-button"
                  disabled={isMutating}
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
                      disabled={isMutating}
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
                    disabled={isMutating}
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
                    disabled={isMutating}
                    onNameChange={(value) => updateGameField("playerTwoName", value)}
                    onSelectRememberedName={(value) => applyRememberedGamePlayerName("player2", value)}
                    onArmyChange={(value) => applyGameFormArmySelection("player2", value)}
                    onDetachmentChange={(value) => updateGameField("playerTwoDetachment", value)}
                  />
                  <GameMetaFields
                    value={gameForm}
                    deploymentOptions={deploymentOptions}
                    primaryMissionOptions={primaryMissionOptions}
                    disabled={isMutating}
                    onChange={updateGameField}
                  />

                  <div className="button-row button-row--compact">
                    <button type="submit" className="primary-button compact-button" disabled={isMutating}>
                      Speichern
                    </button>
                    <button
                      type="button"
                      className="ghost-button compact-button"
                      disabled={isMutating}
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
                    <span>Ende</span>
                    <strong>{formatClockTime(game.endedAt)}</strong>
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
                      {game.defenderPlayerId === game.players[0].id ? game.players[0].name : game.players[1].name}
                    </strong>
                  </div>
                  <div>
                    <span>Startspieler</span>
                    <strong>
                      {game.startingPlayerId === game.players[0].id ? game.players[0].name : game.players[1].name}
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
                  <div>
                    <span>Gesamt offen</span>
                    <strong>{formatDuration(getSessionDurationMs(game))}</strong>
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
                <div className="stack modal-list">
                  {game.noteEvents
                    .slice()
                    .reverse()
                    .map((event) => {
                      const playerName =
                        game.players.find((player) => player.id === event.playerId)?.name ?? "-";
                      return (
                        <article
                          key={event.id}
                          className={`event-editor ${getRoundSurfaceClassName(event.roundNumber)}`}
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
                          <p className="muted-copy">{event.note}</p>
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
                    <option value="primary">Primary</option>
                    <option value="secondary">Secondary</option>
                    <option value="legacy-total">Gesamt</option>
                    <option value="cp-gained">CP +</option>
                    <option value="cp-spent">CP -</option>
                    <option value="note">Notizen</option>
                  </select>
                </label>
              </div>
              {filteredEditableEvents.length ? (
                <div className="stack modal-list">
                  {filteredEditableEvents.map((event) => (
                    <article
                      key={event.id}
                      className={`event-editor ${getRoundSurfaceClassName(event.roundNumber)}`}
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
                            disabled={isMutating || isClosed}
                            onClick={() => void openEditor(event)}
                          >
                            Bearbeiten
                          </button>
                          <button
                            type="button"
                            className="danger-button compact-button"
                            disabled={isMutating || isClosed}
                            onClick={() => void handleDeleteEvent(event)}
                          >
                            Loeschen
                          </button>
                        </div>
                      </div>

                      {editingEventId === event.id ? (
                        <div className="event-editor__form">
                          {event.kind !== "note" ? (
                            <input
                              type="number"
                              min={0}
                              inputMode="numeric"
                              value={editingValue}
                              disabled={isMutating}
                              onChange={(editEvent) => setEditingValue(editEvent.target.value)}
                            />
                          ) : null}
                          <textarea
                            rows={2}
                            value={editingNote}
                            disabled={isMutating}
                            onChange={(editEvent) => setEditingNote(editEvent.target.value)}
                          />
                          <div className="button-row button-row--compact">
                            <button
                              type="button"
                              className="primary-button compact-button"
                              disabled={isMutating}
                              onClick={() => void saveEditedEvent(event)}
                            >
                              Speichern
                            </button>
                            <button
                              type="button"
                              className="ghost-button compact-button"
                              disabled={isMutating}
                              onClick={closeEditor}
                            >
                              Abbrechen
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="muted-copy">
                          {typeof event.displayValue === "number"
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
        <div className="game-bottom-dock">
          <button
            type="button"
            className="primary-button compact-button"
            onClick={() => void handleAdvance()}
            disabled={isMutating}
          >
            Weiter
          </button>
          <button
            type="button"
            className="ghost-button compact-button"
            onClick={() => void handleGoBack()}
            disabled={isMutating || !canGoBack}
          >
            Zurueck
          </button>
          <button
            type="button"
            className="ghost-button compact-button game-bottom-dock__undo"
            onClick={() => void handleUndoLastEvent()}
            disabled={isMutating || !undoActionLabel}
            title={undoLabel}
          >
            {undoLabel}
          </button>
          <button
            type="button"
            className="secondary-button compact-button"
            onClick={() =>
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
              )
            }
            disabled={isMutating}
          >
            {isTimerRunning ? "Timer aus" : "Timer an"}
          </button>
        </div>
      ) : null}
    </Layout>
  );
};
