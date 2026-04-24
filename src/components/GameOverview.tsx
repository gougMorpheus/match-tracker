import type { Game } from "../types/game";
import {
  getGameDurationMs,
  getPlayerCommandPointsGained,
  getPlayerCommandPointsSpent,
  getPlayerPrimaryTotal,
  getPlayerSecondaryTotal,
  getPlayerTotalScore,
  getPlayerTurnDurationTotalMs,
  getRoundDurationMs,
  getSessionDurationMs,
  getTurnDurationMs
} from "../utils/gameCalculations";
import { formatClockTime, formatDateLabel, formatDuration } from "../utils/time";

interface GameOverviewProps {
  game: Game;
}

export const GameOverview = ({ game }: GameOverviewProps) => {
  const orderedPlayers =
    game.players[0].id === game.startingPlayerId ? game.players : [game.players[1], game.players[0]];

  const turnRows = game.rounds.flatMap((round) =>
    round.turns.map((turn) => {
      const player = game.players.find((entry) => entry.id === turn.playerId);
      const primary = game.scoreEvents
        .filter(
          (event) =>
            event.playerId === turn.playerId &&
            event.roundNumber === round.roundNumber &&
            event.turnNumber === turn.turnNumber &&
            event.scoreType === "primary"
        )
        .reduce((total, event) => total + event.value, 0);
      const secondary = game.scoreEvents
        .filter(
          (event) =>
            event.playerId === turn.playerId &&
            event.roundNumber === round.roundNumber &&
            event.turnNumber === turn.turnNumber &&
            event.scoreType === "secondary"
        )
        .reduce((total, event) => total + event.value, 0);

      return {
        id: turn.id,
        label: `R${round.roundNumber} / Zug ${turn.turnNumber}`,
        playerName: player?.name ?? "-",
        durationMs: getTurnDurationMs(turn),
        primary,
        secondary,
        total: primary + secondary
      };
    })
  );

  const maxTurnScore = Math.max(...turnRows.map((turn) => turn.total), 1);
  const maxTurnDuration = Math.max(...turnRows.map((turn) => turn.durationMs), 1);
  const roundRows = game.rounds.map((round) => ({
    id: round.id,
    label: `Runde ${round.roundNumber}`,
    durationMs: getRoundDurationMs(round)
  }));
  const maxRoundDuration = Math.max(...roundRows.map((round) => round.durationMs), 1);

  const scoreTimeline = [...game.scoreEvents].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const cpTimeline = [...game.commandPointEvents].sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  return (
    <section className="stack game-overview">
      <article className="card stack">
        <div className="overview-summary-grid">
          <div>
            <span>Datum</span>
            <strong>{formatDateLabel(game.scheduledDate, game.scheduledTime)}</strong>
          </div>
          <div>
            <span>Punkte</span>
            <strong>{game.gamePoints}</strong>
          </div>
          <div>
            <span>Match-Zeit</span>
            <strong>{formatDuration(getGameDurationMs(game))}</strong>
          </div>
          <div>
            <span>Gesamt offen</span>
            <strong>{formatDuration(getSessionDurationMs(game))}</strong>
          </div>
          <div>
            <span>Start</span>
            <strong>{formatClockTime(game.startedAt)}</strong>
          </div>
          <div>
            <span>Ende</span>
            <strong>{formatClockTime(game.endedAt)}</strong>
          </div>
        </div>
      </article>

      <div className="overview-player-grid">
        {orderedPlayers.map((player) => (
          <article key={player.id} className="card stack overview-player-card">
            <div className="overview-player-card__head">
              <div>
                <strong>{player.name}</strong>
                <p>{player.army.name}</p>
              </div>
              <span className="meta-chip">
                {player.id === game.startingPlayerId ? "Start" : "Second"}
              </span>
            </div>
            <div className="overview-stat-line">
              <span>Prim</span>
              <strong>{getPlayerPrimaryTotal(game, player.id)}</strong>
            </div>
            <div className="overview-stat-line">
              <span>Sek</span>
              <strong>{getPlayerSecondaryTotal(game, player.id)}</strong>
            </div>
            <div className="overview-stat-line">
              <span>Ges</span>
              <strong>{getPlayerTotalScore(game, player.id)}</strong>
            </div>
            <div className="overview-stat-line">
              <span>Zeit</span>
              <strong>{formatDuration(getPlayerTurnDurationTotalMs(game, player.id))}</strong>
            </div>
            <div className="overview-stat-line">
              <span>CP + / -</span>
              <strong>
                {getPlayerCommandPointsGained(game, player.id)} / {getPlayerCommandPointsSpent(game, player.id)}
              </strong>
            </div>
          </article>
        ))}
      </div>

      <article className="card stack">
        <div className="list-row">
          <h2>Score-Verlauf</h2>
          <span>{turnRows.length} Zuege</span>
        </div>
        <div className="overview-bar-list">
          {turnRows.map((turn) => (
            <div key={`score-${turn.id}`} className="overview-bar-row">
              <div className="overview-bar-row__meta">
                <strong>{turn.playerName}</strong>
                <p>{turn.label}</p>
              </div>
              <div className="overview-bar">
                <div
                  className="overview-bar__fill overview-bar__fill--score"
                  style={{ width: `${(turn.total / maxTurnScore) * 100}%` }}
                />
              </div>
              <span>{turn.primary} / {turn.secondary} / {turn.total}</span>
            </div>
          ))}
        </div>
      </article>

      <article className="card stack">
        <div className="list-row">
          <h2>Zeit-Verlauf</h2>
          <span>{turnRows.length} Zuege</span>
        </div>
        <div className="overview-bar-list">
          {turnRows.map((turn) => (
            <div key={`time-${turn.id}`} className="overview-bar-row">
              <div className="overview-bar-row__meta">
                <strong>{turn.playerName}</strong>
                <p>{turn.label}</p>
              </div>
              <div className="overview-bar">
                <div
                  className="overview-bar__fill overview-bar__fill--time"
                  style={{ width: `${(turn.durationMs / maxTurnDuration) * 100}%` }}
                />
              </div>
              <span>{formatDuration(turn.durationMs)}</span>
            </div>
          ))}
        </div>
      </article>

      <article className="card stack">
        <div className="list-row">
          <h2>Rundenzeiten</h2>
          <span>{roundRows.length} Runden</span>
        </div>
        <div className="overview-bar-list">
          {roundRows.map((round) => (
            <div key={round.id} className="overview-bar-row">
              <div className="overview-bar-row__meta">
                <strong>{round.label}</strong>
              </div>
              <div className="overview-bar">
                <div
                  className="overview-bar__fill overview-bar__fill--round"
                  style={{ width: `${(round.durationMs / maxRoundDuration) * 100}%` }}
                />
              </div>
              <span>{formatDuration(round.durationMs)}</span>
            </div>
          ))}
        </div>
      </article>

      <article className="card stack">
        <div className="list-row">
          <h2>Score-Ereignisse</h2>
          <span>{scoreTimeline.length}</span>
        </div>
        <div className="modal-list">
          {scoreTimeline.map((event) => {
            const playerName = game.players.find((player) => player.id === event.playerId)?.name ?? "-";
            return (
              <article key={event.id} className="event-editor">
                <div className="event-editor__meta">
                  <div>
                    <strong>{playerName}</strong>
                    <p>
                      {event.scoreType === "primary" ? "Primary" : "Secondary"} | R{event.roundNumber ?? "-"} / Z{event.turnNumber ?? "-"}
                    </p>
                  </div>
                  <span>{formatClockTime(event.createdAt)}</span>
                </div>
                <p className="muted-copy">
                  {event.value} {event.note ? `| ${event.note}` : ""}
                </p>
              </article>
            );
          })}
        </div>
      </article>

      <article className="card stack">
        <div className="list-row">
          <h2>CP-Ereignisse</h2>
          <span>{cpTimeline.length}</span>
        </div>
        <div className="modal-list">
          {cpTimeline.map((event) => {
            const playerName = game.players.find((player) => player.id === event.playerId)?.name ?? "-";
            return (
              <article key={event.id} className="event-editor">
                <div className="event-editor__meta">
                  <div>
                    <strong>{playerName}</strong>
                    <p>
                      {event.cpType === "gained" ? "CP +" : "CP -"} | R{event.roundNumber ?? "-"} / Z{event.turnNumber ?? "-"}
                    </p>
                  </div>
                  <span>{formatClockTime(event.createdAt)}</span>
                </div>
                <p className="muted-copy">
                  {event.value} {event.note ? `| ${event.note}` : ""}
                </p>
              </article>
            );
          })}
        </div>
      </article>
    </section>
  );
};
