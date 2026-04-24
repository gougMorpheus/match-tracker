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

interface TurnRow {
  id: string;
  index: number;
  roundNumber: number;
  turnNumber: number;
  playerId: string;
  playerName: string;
  durationMs: number;
  primary: number;
  secondary: number;
  total: number;
}

interface ChartPoint {
  label: string;
  values: Record<string, number>;
}

const CHART_WIDTH = 320;
const CHART_HEIGHT = 150;
const CHART_PADDING = 20;
const TURN_CHUNK_SIZE = 5;

const chunkItems = <T,>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const buildLinePath = (points: Array<{ x: number; y: number }>): string =>
  points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");

export const GameOverview = ({ game }: GameOverviewProps) => {
  const orderedPlayers =
    game.players[0].id === game.startingPlayerId ? game.players : [game.players[1], game.players[0]];

  const turnRows: TurnRow[] = game.rounds.flatMap((round) =>
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
        index: 0,
        roundNumber: round.roundNumber,
        turnNumber: turn.turnNumber,
        playerId: turn.playerId,
        playerName: player?.name ?? "-",
        durationMs: getTurnDurationMs(turn),
        primary,
        secondary,
        total: primary + secondary
      };
    })
  ).map((turn, index) => ({ ...turn, index: index + 1 }));

  const roundRows = game.rounds.map((round) => ({
    id: round.id,
    label: `Runde ${round.roundNumber}`,
    durationMs: getRoundDurationMs(round)
  }));
  const maxRoundDuration = Math.max(...roundRows.map((round) => round.durationMs), 1);

  const scoreTimeline = [...game.scoreEvents].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const cpTimeline = [...game.commandPointEvents].sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  const buildChartSegments = (valueSelector: (turn: TurnRow) => number): ChartPoint[][] => {
    const runningTotals = Object.fromEntries(orderedPlayers.map((player) => [player.id, 0]));
    const points = turnRows.map((turn) => {
      runningTotals[turn.playerId] += valueSelector(turn);
      return {
        label: `Z${turn.index}`,
        values: { ...runningTotals }
      };
    });

    return chunkItems(points, TURN_CHUNK_SIZE);
  };

  const scoreSegments = buildChartSegments((turn) => turn.total);
  const timeSegments = buildChartSegments((turn) => turn.durationMs);

  const renderLineChart = (
    title: string,
    segments: ChartPoint[][],
    valueLabel: string,
    formatter: (value: number) => string
  ) => (
    <article className="card stack">
      <div className="list-row">
        <h2>{title}</h2>
        <span>{turnRows.length} Zuege</span>
      </div>
      {segments.length === 0 ? (
        <p className="muted-copy">Noch keine abgeschlossenen Zuege vorhanden.</p>
      ) : (
        <div className="overview-chart-grid">
          {segments.map((segment, chunkIndex) => {
            const maxValue = Math.max(
              ...segment.flatMap((point) => orderedPlayers.map((player) => point.values[player.id] ?? 0)),
              1
            );
          const stepX =
            segment.length > 1
              ? (CHART_WIDTH - CHART_PADDING * 2) / (segment.length - 1)
              : 0;

          const playerSeries = orderedPlayers.map((player) => {
            const points = segment.map((point, pointIndex) => {
              const value = point.values[player.id] ?? 0;
              return {
                x:
                  segment.length > 1
                    ? CHART_PADDING + pointIndex * stepX
                    : CHART_WIDTH / 2,
                y:
                  CHART_HEIGHT -
                  CHART_PADDING -
                  (value / maxValue) * (CHART_HEIGHT - CHART_PADDING * 2),
                label: point.label,
                value
              };
            });

            return {
              player,
              points,
              path: buildLinePath(points)
            };
          });

          return (
            <section key={`${title}-${chunkIndex}`} className="overview-chart-card">
              <div className="overview-chart-card__head">
                <strong>
                  Zuege {chunkIndex * TURN_CHUNK_SIZE + 1}-
                  {chunkIndex * TURN_CHUNK_SIZE + segment.length}
                </strong>
                <div className="overview-chart-legend">
                  {orderedPlayers.map((player, playerIndex) => (
                    <span key={player.id} className={`overview-chart-legend__item is-player-${playerIndex + 1}`}>
                      {player.name}
                    </span>
                  ))}
                </div>
              </div>
              <svg
                viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                className="overview-chart"
                role="img"
                aria-label={`${title} fuer Zuege ${chunkIndex * TURN_CHUNK_SIZE + 1} bis ${chunkIndex * TURN_CHUNK_SIZE + segment.length}`}
              >
                {[0.25, 0.5, 0.75].map((marker) => {
                  const y = CHART_HEIGHT - CHART_PADDING - marker * (CHART_HEIGHT - CHART_PADDING * 2);
                  return (
                    <line
                      key={marker}
                      x1={CHART_PADDING}
                      y1={y}
                      x2={CHART_WIDTH - CHART_PADDING}
                      y2={y}
                      className="overview-chart__guide"
                    />
                  );
                })}
                <line
                  x1={CHART_PADDING}
                  y1={CHART_HEIGHT - CHART_PADDING}
                  x2={CHART_WIDTH - CHART_PADDING}
                  y2={CHART_HEIGHT - CHART_PADDING}
                  className="overview-chart__axis"
                />
                <line
                  x1={CHART_PADDING}
                  y1={CHART_PADDING}
                  x2={CHART_PADDING}
                  y2={CHART_HEIGHT - CHART_PADDING}
                  className="overview-chart__axis"
                />
                {playerSeries.map((series, playerIndex) =>
                  <path
                    key={`${series.player.id}-path`}
                    d={series.path}
                    className={`overview-chart__line is-player-${playerIndex + 1}`}
                  />
                )}
                {playerSeries.map((series, playerIndex) =>
                  series.points.map((point) => (
                    <g key={`${series.player.id}-${point.label}-${chunkIndex}`}>
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r="4"
                        className={`overview-chart__dot is-player-${playerIndex + 1}`}
                      />
                    </g>
                  ))
                )}
                {segment.map((point, pointIndex) => (
                  <text
                    key={`${point.label}-label-${chunkIndex}`}
                    x={segment.length > 1 ? CHART_PADDING + pointIndex * stepX : CHART_WIDTH / 2}
                    y={CHART_HEIGHT - 5}
                    textAnchor="middle"
                    className="overview-chart__label"
                  >
                    {point.label}
                  </text>
                ))}
                <text x={CHART_PADDING - 4} y={CHART_PADDING + 4} textAnchor="end" className="overview-chart__scale">
                  {formatter(maxValue)}
                </text>
                <text
                  x={CHART_PADDING - 4}
                  y={CHART_HEIGHT - CHART_PADDING + 4}
                  textAnchor="end"
                  className="overview-chart__scale"
                >
                  0
                </text>
              </svg>
              <div className="overview-chart-card__totals">
                {orderedPlayers.map((player, playerIndex) => {
                  const latestPoint = playerSeries[playerIndex]?.points[playerSeries[playerIndex].points.length - 1];
                  return (
                    <div key={`${player.id}-${chunkIndex}`} className="overview-chart-total">
                      <span className={`overview-chart-total__marker is-player-${playerIndex + 1}`} />
                      <span>{player.name}</span>
                      <strong>
                        {formatter(latestPoint?.value ?? 0)}
                        {valueLabel ? ` ${valueLabel}` : ""}
                      </strong>
                    </div>
                  );
                })}
              </div>
            </section>
          );
          })}
        </div>
      )}
    </article>
  );

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

      {renderLineChart("Score-Verlauf", scoreSegments, "Pkt", (value) => String(value))}
      {renderLineChart("Zeit-Verlauf", timeSegments, "", (value) => formatDuration(value))}

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
