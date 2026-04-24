import { useEffect, useMemo, useState, type FormEvent } from "react";
import { FloatingMenu } from "../components/FloatingMenu";
import { Layout } from "../components/Layout";
import { PlayerScoreboard } from "../components/PlayerScoreboard";
import { QuickAdjustControls } from "../components/QuickAdjustControls";
import { RememberedNameField } from "../components/RememberedNameField";
import { ARMY_OPTIONS } from "../data/armies";
import { useGameStore } from "../store/GameStore";
import type { CreateGameInput, Game, PlayerId } from "../types/game";
import {
  getCurrentRoundNumber,
  getCurrentTurnNumber,
  getGameDurationMs,
  getLatestTurn,
  getPlayerCommandPoints,
  getPlayerPrimaryTotal,
  getPlayerSecondaryTotal,
  getRoundDurationMs,
  getTurnDurationMs,
  isTurnPaused
} from "../utils/gameCalculations";
import { loadRememberedPlayerNames } from "../utils/presets";
import { formatClockTime, formatDateLabel, formatDuration } from "../utils/time";

interface GamePageProps {
  gameId: string;
  onBack: () => void;
}

interface EditableEventItem {
  id: string;
  playerId: string;
  playerName: string;
  kind: "cp" | "score" | "note";
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
  playerTwoName: game.players[1].name,
  playerTwoArmy: game.players[1].army.name,
  gamePoints: game.gamePoints,
  scheduledDate: game.scheduledDate,
  scheduledTime: game.scheduledTime,
  deployment: game.deployment,
  primaryMission: game.primaryMission,
  defenderSlot: game.defenderPlayerId === game.players[0].id ? "player1" : "player2",
  startingSlot: game.startingPlayerId === game.players[0].id ? "player1" : "player2"
});

export const GamePage = ({ gameId, onBack }: GamePageProps) => {
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
    pauseActiveTimer,
    startGameTimer,
    reopenGame,
    finishGame,
    deleteGame
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
  const game = getGame(gameId);
  const [gameForm, setGameForm] = useState<CreateGameInput | null>(
    game ? createGameFormState(game) : null
  );

  const latestTurn = useMemo(() => (game ? getLatestTurn(game) : undefined), [game]);
  const playerOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...loadRememberedPlayerNames(),
          ...games.flatMap((item) => item.players.map((player) => player.name))
        ])
      ).sort((left, right) => left.localeCompare(right)),
    [games]
  );
  const editableEvents = useMemo<EditableEventItem[]>(
    () =>
      game
        ? [
            ...game.commandPointEvents.map((event) => ({
              id: event.id,
              playerId: event.playerId,
              playerName: game.players.find((player) => player.id === event.playerId)?.name ?? "-",
              kind: "cp" as const,
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
              label: `${event.scoreType === "primary" ? "Primary" : "Secondary"} ${event.value < 0 ? "-" : "+"}`,
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

  useEffect(() => {
    const runningTurn = game ? getLatestTurn(game) : undefined;
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
  }, [game]);

  useEffect(() => {
    if (!game) {
      setGameForm(null);
      return;
    }

    setGameForm(createGameFormState(game));
  }, [game]);

  if (!game && isLoading) {
    return <Layout title="Live Tracker" subtitle="Spiel wird geladen" />;
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
  const orderedPlayers =
    game.players[0].id === game.startingPlayerId ? game.players : [game.players[1], game.players[0]];
  const activePlayerId =
    latestTurn && latestTurn.timing.startedAt && !latestTurn.timing.endedAt
      ? latestTurn.playerId
      : game.currentPlayerId;
  const isClosed = game.status === "completed";
  const isPaused = isTurnPaused(latestTurn);
  const hasActiveTurn = Boolean(latestTurn?.timing.startedAt && !latestTurn.timing.endedAt);
  const isTimerRunning = !isClosed && hasActiveTurn && !isPaused;
  const timerStatusLabel = isTimerRunning ? "Laeuft" : "Gestoppt";
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

  const openGameEditor = async () => {
    if (isClosed) {
      return;
    }

    if (isTimerRunning) {
      await pauseActiveTimer(game.id);
    }

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
      await pauseActiveTimer(game.id);
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

  const handleDeleteGame = async () => {
    if (!window.confirm("Spiel wirklich loeschen? Alle Events gehen dabei verloren.")) {
      return;
    }

    await deleteGame(game.id);
    window.location.hash = "/games";
  };

  const closeNoteDialog = () => {
    setNoteDialogPlayerId(null);
    setNoteDraft("");
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
      note: noteDraft
    });
    closeNoteDialog();
  };

  const handleReopenGame = async () => {
    await reopenGame(game.id);
  };

  return (
    <Layout
      title="Tracker"
      stickyHeader
      actions={
        <div className="page-tools page-tools--game">
          <div className="game-status-strip">
            <span className={`status-pill status-pill--${isClosed ? "completed" : "active"}`}>
              Spiel: {isClosed ? "zu" : "offen"}
            </span>
            <span className={`status-pill ${isTimerRunning ? "status-pill--active" : ""}`}>
              Timer: {timerStatusLabel}
            </span>
          </div>
          <FloatingMenu
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
                  { label: "Notizen", onClick: () => setNotesOpen(true) },
                  isClosed
                    ? {
                        label: "Spiel wieder eroeffnen",
                        onClick: () => void handleReopenGame()
                      }
                    : {
                        label: "Spiel beenden",
                        onClick: () => void finishGame(game.id),
                        disabled: isMutating,
                        danger: true
                      },
                  {
                    label: "Spiel loeschen",
                    onClick: () => void handleDeleteGame(),
                    disabled: isMutating,
                    danger: true
                  }
                ]
              }
            ]}
          />
        </div>
      }
    >
      <section className="stack game-page">
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

        <article className="tracker-summary tracker-summary--inline">
          <span>
            <strong>R</strong> {getCurrentRoundNumber(game)}
          </span>
          <span>
            <strong>Z</strong> {getCurrentTurnNumber(game)}
          </span>
          <span>
            <strong>Aktiv</strong> {game.players.find((player) => player.id === activePlayerId)?.name ?? "-"}
          </span>
          <span>
            <strong>Gesamt</strong> {formatDuration(getGameDurationMs(game))}
          </span>
          <span>
            <strong>Runde</strong> {formatDuration(latestRound ? getRoundDurationMs(latestRound) : 0)}
          </span>
          <span>
            <strong>Zug</strong> {formatDuration(latestTurn ? getTurnDurationMs(latestTurn) : 0)}
          </span>
        </article>

        <div className="stack">
          {orderedPlayers.map((player) => (
            <PlayerScoreboard
              key={player.id}
              game={game}
              player={player}
              emphasized={activePlayerId === player.id}
              defender={game.defenderPlayerId === player.id}
              noteAction={
                !isClosed ? (
                  <button
                    type="button"
                    className="ghost-button compact-button scoreboard__note-button"
                    disabled={isMutating}
                    onClick={() => {
                      void (async () => {
                        if (isTimerRunning) {
                          await pauseActiveTimer(game.id);
                        }
                        setNoteDialogPlayerId(player.id);
                      })();
                    }}
                  >
                    Notiz
                  </button>
                ) : null
              }
              controls={
                <QuickAdjustControls
                  player={player}
                  currentCommandPoints={getPlayerCommandPoints(game, player.id)}
                  currentPrimary={getPlayerPrimaryTotal(game, player.id)}
                  currentSecondary={getPlayerSecondaryTotal(game, player.id)}
                  isSubmitting={isMutating || isClosed}
                  canSpendCommandPoints={activePlayerId === player.id}
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
                      cpType: direction === "plus" ? "gained" : "spent"
                    });
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
                      scoreType
                    });
                  }}
                />
              }
            />
          ))}
        </div>
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
                  <section className="stack">
                    <RememberedNameField
                      label="Spieler 1"
                      value={gameForm.playerOneName}
                      options={playerOptions}
                      disabled={isMutating}
                      onChange={(value) => updateGameField("playerOneName", value)}
                    />
                    <label className="field">
                      <span>Armee 1</span>
                      <select
                        required
                        value={gameForm.playerOneArmy}
                        onChange={(editEvent) => updateGameField("playerOneArmy", editEvent.target.value)}
                        disabled={isMutating}
                      >
                        <option value="">Armee waehlen</option>
                        {ARMY_OPTIONS.map((army) => (
                          <option key={army} value={army}>
                            {army}
                          </option>
                        ))}
                      </select>
                    </label>
                    <RememberedNameField
                      label="Spieler 2"
                      value={gameForm.playerTwoName}
                      options={playerOptions}
                      disabled={isMutating}
                      onChange={(value) => updateGameField("playerTwoName", value)}
                    />
                    <label className="field">
                      <span>Armee 2</span>
                      <select
                        required
                        value={gameForm.playerTwoArmy}
                        onChange={(editEvent) => updateGameField("playerTwoArmy", editEvent.target.value)}
                        disabled={isMutating}
                      >
                        <option value="">Armee waehlen</option>
                        {ARMY_OPTIONS.map((army) => (
                          <option key={army} value={army}>
                            {army}
                          </option>
                        ))}
                      </select>
                    </label>
                  </section>

                  <div className="two-column-grid">
                    <label className="field">
                      <span>Spielpunkte</span>
                      <input
                        required
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={gameForm.gamePoints}
                        onChange={(editEvent) =>
                          updateGameField("gamePoints", Number(editEvent.target.value) || 0)
                        }
                        disabled={isMutating}
                      />
                    </label>
                    <label className="field">
                      <span>Datum</span>
                      <input
                        required
                        type="date"
                        value={gameForm.scheduledDate}
                        onChange={(editEvent) => updateGameField("scheduledDate", editEvent.target.value)}
                        disabled={isMutating}
                      />
                    </label>
                    <label className="field">
                      <span>Uhrzeit</span>
                      <input
                        required
                        type="time"
                        value={gameForm.scheduledTime}
                        onChange={(editEvent) => updateGameField("scheduledTime", editEvent.target.value)}
                        disabled={isMutating}
                      />
                    </label>
                  </div>
                  <label className="field">
                    <span>Aufstellung (optional)</span>
                    <input
                      value={gameForm.deployment}
                      onChange={(editEvent) => updateGameField("deployment", editEvent.target.value)}
                      disabled={isMutating}
                      placeholder="Kann leer bleiben"
                    />
                  </label>
                  <label className="field">
                    <span>Primaermission (optional)</span>
                    <input
                      value={gameForm.primaryMission}
                      onChange={(editEvent) => updateGameField("primaryMission", editEvent.target.value)}
                      disabled={isMutating}
                      placeholder="Kann leer bleiben"
                    />
                  </label>

                  <div className="field">
                    <span>Defender</span>
                    <div className="segmented-control">
                      <button
                        type="button"
                        className={gameForm.defenderSlot === "player1" ? "is-selected" : ""}
                        onClick={() => updateGameField("defenderSlot", "player1")}
                        disabled={isMutating}
                      >
                        Spieler 1
                      </button>
                      <button
                        type="button"
                        className={gameForm.defenderSlot === "player2" ? "is-selected" : ""}
                        onClick={() => updateGameField("defenderSlot", "player2")}
                        disabled={isMutating}
                      >
                        Spieler 2
                      </button>
                    </div>
                  </div>

                  <div className="field">
                    <span>Startspieler</span>
                    <div className="segmented-control">
                      <button
                        type="button"
                        className={gameForm.startingSlot === "player1" ? "is-selected" : ""}
                        onClick={() => updateGameField("startingSlot", "player1")}
                        disabled={isMutating}
                      >
                        Spieler 1
                      </button>
                      <button
                        type="button"
                        className={gameForm.startingSlot === "player2" ? "is-selected" : ""}
                        onClick={() => updateGameField("startingSlot", "player2")}
                        disabled={isMutating}
                      >
                        Spieler 2
                      </button>
                    </div>
                  </div>

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
                <div className="scoreboard__grid">
                  <div>
                    <span>Spieler 1</span>
                    <strong>{game.players[0].name}</strong>
                    <p>{game.players[0].army.name}</p>
                  </div>
                  <div>
                    <span>Spieler 2</span>
                    <strong>{game.players[1].name}</strong>
                    <p>{game.players[1].army.name}</p>
                  </div>
                  <div>
                    <span>Datum</span>
                    <strong>{game.scheduledDate || "-"}</strong>
                    <p>{game.scheduledTime || "-"}</p>
                  </div>
                  <div>
                    <span>Spielpunkte</span>
                    <strong>{game.gamePoints}</strong>
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
                    <span>Aufstellung</span>
                    <strong>{game.deployment || "-"}</strong>
                  </div>
                  <div>
                    <span>Primaermission</span>
                    <strong>{game.primaryMission || "-"}</strong>
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
                        <article key={event.id} className="event-editor">
                          <div className="event-editor__meta">
                            <div>
                              <strong>{playerName}</strong>
                              <p>
                                R{event.roundNumber ?? "-"} / Z{event.turnNumber ?? "-"}
                              </p>
                            </div>
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
                  <p className="muted-copy">{isClosed ? "geschlossen" : "editierbar"}</p>
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
              {editableEvents.length ? (
                <div className="stack modal-list">
                  {editableEvents.map((event) => (
                    <article key={event.id} className="event-editor">
                      <div className="event-editor__meta">
                        <div>
                          <strong>{event.playerName}</strong>
                          <p>
                            {event.label} | R{event.roundNumber ?? "-"} / Z{event.turnNumber ?? "-"}
                          </p>
                        </div>
                        <div className="button-row button-row--compact">
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
                <p className="muted-copy">Noch keine editierbaren Eintraege.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {!isClosed ? (
        <div className="game-bottom-dock">
          <button
            type="button"
            className="primary-button compact-button"
            onClick={() => void advanceGame(game.id)}
            disabled={isMutating}
          >
            Weiter
          </button>
          <button
            type="button"
            className="ghost-button compact-button"
            onClick={() => void rewindLastTurn(game.id)}
            disabled={isMutating || !latestTurn}
          >
            Zurueck
          </button>
          <button
            type="button"
            className="secondary-button compact-button"
            onClick={() =>
              void (isTimerRunning ? pauseActiveTimer(game.id) : startGameTimer(game.id))
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
