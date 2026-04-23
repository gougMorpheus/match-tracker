import { useEffect, useMemo, useState } from "react";
import { ActionPanel, type ActionKind } from "../components/ActionPanel";
import { Layout } from "../components/Layout";
import { PlayerScoreboard } from "../components/PlayerScoreboard";
import { useGameStore } from "../store/GameStore";
import {
  getCurrentRoundNumber,
  getCurrentTurnNumber,
  getGameDurationMs,
  getLatestTurn,
  getRoundDurationMs,
  getTurnDurationMs,
  isRoundActive,
  isTurnActive
} from "../utils/gameCalculations";
import { formatClockTime, formatDateLabel, formatDuration } from "../utils/time";

interface GamePageProps {
  gameId: string;
}

export const GamePage = ({ gameId }: GamePageProps) => {
  const {
    getGame,
    startRound,
    endRound,
    startTurn,
    endTurn,
    addScoreEvent,
    addCommandPointEvent,
    addNoteEvent,
    finishGame
  } = useGameStore();
  const [action, setAction] = useState<ActionKind | null>(null);
  const [, setTick] = useState(0);
  const game = getGame(gameId);

  const latestTurn = useMemo(() => (game ? getLatestTurn(game) : undefined), [game]);

  useEffect(() => {
    if (!game || game.status === "completed" || !game.startedAt) {
      return;
    }

    const interval = window.setInterval(() => {
      setTick((current) => current + 1);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [game]);

  if (!game) {
    return (
      <Layout title="Spiel nicht gefunden" subtitle="Das lokale Match ist nicht mehr verfuegbar." />
    );
  }

  const roundActive = isRoundActive(game);
  const turnActive = isTurnActive(game);
  const activePlayerId = latestTurn && turnActive ? latestTurn.playerId : game.currentPlayerId;
  const latestRound = game.rounds[game.rounds.length - 1];

  const handleActionSubmit = ({
    playerId,
    value,
    note
  }: {
    playerId: string;
    value?: number;
    note?: string;
  }) => {
    if (!action) {
      return;
    }

    if (action === "primary" || action === "secondary") {
      addScoreEvent({
        gameId,
        playerId,
        value,
        note,
        scoreType: action
      });
    }

    if (action === "cp-gained" || action === "cp-spent") {
      addCommandPointEvent({
        gameId,
        playerId,
        value,
        note,
        cpType: action === "cp-gained" ? "gained" : "spent"
      });
    }

    if (action === "note") {
      addNoteEvent({
        gameId,
        playerId,
        note
      });
    }

    setAction(null);
  };

  return (
    <Layout
      title="Live Tracker"
      subtitle={formatDateLabel(game.scheduledDate, game.scheduledTime)}
      actions={
        <span className={`status-pill status-pill--${game.status}`}>{game.status}</span>
      }
    >
      <section className="stack">
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

        <div className="stack">
          {game.players.map((player) => (
            <PlayerScoreboard
              key={player.id}
              game={game}
              player={player}
              emphasized={activePlayerId === player.id}
              defender={game.defenderPlayerId === player.id}
            />
          ))}
        </div>

        <section className="card stack">
          <h2>Spielsteuerung</h2>
          <div className="button-grid">
            <button
              type="button"
              className="secondary-button"
              onClick={() => startRound(game.id)}
              disabled={roundActive || game.status === "completed"}
            >
              Runde starten
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => endRound(game.id)}
              disabled={!roundActive || game.status === "completed"}
            >
              Runde beenden
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => startTurn(game.id)}
              disabled={!roundActive || turnActive || game.status === "completed"}
            >
              Zug starten
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => endTurn(game.id)}
              disabled={!turnActive || game.status === "completed"}
            >
              Zug beenden
            </button>
            <button type="button" className="secondary-button" onClick={() => setAction("cp-gained")}>
              CP erhalten
            </button>
            <button type="button" className="secondary-button" onClick={() => setAction("cp-spent")}>
              CP ausgeben
            </button>
            <button type="button" className="secondary-button" onClick={() => setAction("primary")}>
              Primary
            </button>
            <button type="button" className="secondary-button" onClick={() => setAction("secondary")}>
              Secondary
            </button>
            <button type="button" className="secondary-button" onClick={() => setAction("note")}>
              Notiz
            </button>
            <button
              type="button"
              className="danger-button"
              onClick={() => finishGame(game.id)}
              disabled={game.status === "completed"}
            >
              Spiel beenden
            </button>
          </div>
        </section>

        <ActionPanel
          players={game.players}
          action={action}
          onCancel={() => setAction(null)}
          onSubmit={handleActionSubmit}
        />

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
      </section>
    </Layout>
  );
};
