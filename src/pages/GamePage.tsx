import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Layout } from "../components/Layout";
import { PlayerScoreboard } from "../components/PlayerScoreboard";
import { QuickAdjustControls } from "../components/QuickAdjustControls";
import { ARMY_OPTIONS } from "../data/armies";
import { useGameStore } from "../store/GameStore";
import type { CreateGameInput, Game } from "../types/game";
import {
  getCurrentRoundNumber,
  getCurrentTurnNumber,
  getGameDurationMs,
  getLatestTurn,
  getRoundDurationMs,
  getTurnDurationMs
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
    addScoreEvent,
    addCommandPointEvent,
    addNoteEvent,
    updateGameEvent,
    updateGameDetails,
    finishGame
  } = useGameStore();
  const [, setTick] = useState(0);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [editingNote, setEditingNote] = useState("");
  const [isEditingGame, setIsEditingGame] = useState(false);
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
              label: event.scoreType === "primary" ? "Primary" : "Secondary",
              value: event.value,
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
          ]
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        : [],
    [game]
  );

  useEffect(() => {
    if (!game || game.status === "completed" || !game.startedAt) {
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
    return <Layout title="Live Tracker" subtitle="Spiel wird geladen" onBack={onBack} />;
  }

  if (!game || !gameForm) {
    return (
      <Layout
        title="Spiel nicht gefunden"
        subtitle={errorMessage ?? "Das Match ist nicht verfuegbar oder konnte nicht geladen werden."}
        onBack={onBack}
      />
    );
  }

  const activePlayerId =
    latestTurn && latestTurn.timing.startedAt && !latestTurn.timing.endedAt
      ? latestTurn.playerId
      : game.currentPlayerId;
  const latestRound = game.rounds[game.rounds.length - 1];

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

  const openEditor = (event: EditableEventItem) => {
    setEditingEventId(event.id);
    setEditingValue(typeof event.value === "number" ? String(event.value) : "");
    setEditingNote(event.note ?? "");
  };

  const closeEditor = () => {
    setEditingEventId(null);
    setEditingValue("");
    setEditingNote("");
  };

  const saveEditedEvent = async (event: EditableEventItem) => {
    const parsedValue = event.kind === "note" ? undefined : Number(editingValue);

    await updateGameEvent(game.id, event.id, {
      value_number:
        event.kind === "note"
          ? undefined
          : Number.isFinite(parsedValue)
            ? parsedValue
            : event.value ?? 0,
      note: editingNote.trim() || null
    });
    closeEditor();
  };

  const handleGameSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await updateGameDetails(game.id, gameForm);
    setIsEditingGame(false);
  };

  return (
    <Layout
      title="Live Tracker"
      subtitle={formatDateLabel(game.scheduledDate, game.scheduledTime)}
      onBack={onBack}
      actions={<span className={`status-pill status-pill--${game.status}`}>{game.status}</span>}
    >
      <section className="stack">
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

        <article className="tracker-summary">
          <div>
            <span>Runde</span>
            <strong>{getCurrentRoundNumber(game)}</strong>
          </div>
          <div>
            <span>Zug</span>
            <strong>{getCurrentTurnNumber(game)}</strong>
          </div>
          <div>
            <span>Gestartet</span>
            <strong>{formatClockTime(game.startedAt)}</strong>
          </div>
          <div>
            <span>Spielpunkte</span>
            <strong>{game.gamePoints}</strong>
          </div>
          <div>
            <span>Gesamtzeit</span>
            <strong>{formatDuration(getGameDurationMs(game))}</strong>
          </div>
          <div>
            <span>Rundenzeit</span>
            <strong>{formatDuration(latestRound ? getRoundDurationMs(latestRound) : 0)}</strong>
          </div>
          <div>
            <span>Zugzeit</span>
            <strong>{formatDuration(latestTurn ? getTurnDurationMs(latestTurn) : 0)}</strong>
          </div>
        </article>

        <section className="card stack">
          <div className="list-row">
            <h2>Spieldetails</h2>
            {!isEditingGame ? (
              <button
                type="button"
                className="ghost-button compact-button"
                onClick={() => setIsEditingGame(true)}
                disabled={isMutating}
              >
                Bearbeiten
              </button>
            ) : null}
          </div>

          {isEditingGame ? (
            <form className="stack" onSubmit={handleGameSave}>
              <section className="stack">
                <label className="field">
                  <span>Spieler 1</span>
                  <input
                    required
                    list={`player-options-${game.id}`}
                    value={gameForm.playerOneName}
                    onChange={(editEvent) => updateGameField("playerOneName", editEvent.target.value)}
                    disabled={isMutating}
                  />
                </label>
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
                <label className="field">
                  <span>Spieler 2</span>
                  <input
                    required
                    list={`player-options-${game.id}`}
                    value={gameForm.playerTwoName}
                    onChange={(editEvent) => updateGameField("playerTwoName", editEvent.target.value)}
                    disabled={isMutating}
                  />
                </label>
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

              <datalist id={`player-options-${game.id}`}>
                {playerOptions.map((playerName) => (
                  <option key={playerName} value={playerName} />
                ))}
              </datalist>
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
                <span>Defender</span>
                <strong>{game.defenderPlayerId === game.players[0].id ? game.players[0].name : game.players[1].name}</strong>
              </div>
              <div>
                <span>Startspieler</span>
                <strong>{game.startingPlayerId === game.players[0].id ? game.players[0].name : game.players[1].name}</strong>
              </div>
            </div>
          )}
        </section>

        <div className="stack">
          {game.players.map((player) => (
            <PlayerScoreboard
              key={player.id}
              game={game}
              player={player}
              emphasized={activePlayerId === player.id}
              defender={game.defenderPlayerId === player.id}
              controls={
                <QuickAdjustControls
                  player={player}
                  isSubmitting={isMutating}
                  onCommandPointChange={async (playerId, direction, amount) => {
                    await addCommandPointEvent({
                      gameId,
                      playerId,
                      value: amount,
                      cpType: direction === "plus" ? "gained" : "spent"
                    });
                  }}
                  onScoreChange={async (playerId, scoreType, direction, amount) => {
                    await addScoreEvent({
                      gameId,
                      playerId,
                      value: direction === "plus" ? amount : amount * -1,
                      scoreType
                    });
                  }}
                  onSaveNote={async (playerId, note) => {
                    await addNoteEvent({
                      gameId,
                      playerId,
                      note
                    });
                  }}
                />
              }
            />
          ))}
        </div>

        <section className="card stack">
          <h2>Spielsteuerung</h2>
          <div className="button-grid button-grid--tracker">
            <button
              type="button"
              className="primary-button primary-button--large"
              onClick={() => void advanceGame(game.id)}
              disabled={game.status === "completed" || isMutating}
            >
              Weiter
            </button>
            <button
              type="button"
              className="danger-button"
              onClick={() => void finishGame(game.id)}
              disabled={game.status === "completed" || isMutating}
            >
              Spiel beenden
            </button>
          </div>
        </section>

        <section className="card stack">
          <h2>Letzte Notizen</h2>
          {game.noteEvents.length ? (
            game.noteEvents
              .slice(-4)
              .reverse()
              .map((event) => {
                const playerName = game.players.find((player) => player.id === event.playerId)?.name ?? "-";
                return (
                  <article key={event.id} className="list-row">
                    <div>
                      <strong>{playerName}</strong>
                      <p>{event.note}</p>
                    </div>
                    <span>
                      R{event.roundNumber ?? "-"} / Z{event.turnNumber ?? "-"}
                    </span>
                  </article>
                );
              })
          ) : (
            <p className="muted-copy">Noch keine Notizen.</p>
          )}
        </section>

        <section className="card stack">
          <div className="list-row">
            <h2>Eintraege</h2>
            <span>editierbar</span>
          </div>
          {editableEvents.length ? (
            editableEvents.map((event) => (
              <article key={event.id} className="event-editor">
                <div className="event-editor__meta">
                  <div>
                    <strong>{event.playerName}</strong>
                    <p>
                      {event.label} | R{event.roundNumber ?? "-"} / Z{event.turnNumber ?? "-"}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="ghost-button compact-button"
                    disabled={isMutating}
                    onClick={() => openEditor(event)}
                  >
                    Bearbeiten
                  </button>
                </div>

                {editingEventId === event.id ? (
                  <div className="event-editor__form">
                    {event.kind !== "note" ? (
                      <input
                        type="number"
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
                    {typeof event.value === "number" ? `${event.value}` : event.note || "Keine Notiz"}
                    {event.note && typeof event.value === "number" ? ` | ${event.note}` : ""}
                  </p>
                )}
              </article>
            ))
          ) : (
            <p className="muted-copy">Noch keine editierbaren Eintraege.</p>
          )}
        </section>
      </section>
    </Layout>
  );
};
