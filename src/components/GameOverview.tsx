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
  getTurnDurationMs
} from "../utils/gameCalculations";
import { formatClockTime, formatDuration } from "../utils/time";

interface GameOverviewProps {
  game: Game;
}

interface RoundScoreRow {
  roundNumber: number;
  label: string;
  values: Record<
    string,
    {
      primary: number;
      secondary: number;
      roundTotal: number;
      cumulativeTotal: number;
    }
  >;
}

interface RoundTimeRow {
  roundNumber: number;
  label: string;
  values: Record<string, number>;
}

const CHART_WIDTH = 320;
const CHART_HEIGHT = 150;
const CHART_PADDING = 20;
const SCORE_CHART_WIDTH = 360;
const SCORE_CHART_HEIGHT = 190;
const SCORE_CHART_PADDING = 24;

const buildLinePath = (points: Array<{ x: number; y: number }>): string =>
  points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");

export const GameOverview = ({ game }: GameOverviewProps) => {
  const orderedPlayers =
    game.players[0].id === game.startingPlayerId ? game.players : [game.players[1], game.players[0]];

  const roundRows = game.rounds.map((round) => ({
    id: round.id,
    label: `Runde ${round.roundNumber}`,
    durationMs: getRoundDurationMs(round)
  }));
  const maxRoundDuration = Math.max(...roundRows.map((round) => round.durationMs), 1);
  const roundScoreRows: RoundScoreRow[] = game.rounds.map((round) => {
    const values = Object.fromEntries(
      orderedPlayers.map((player) => [
        player.id,
        {
          primary: 0,
          secondary: 0,
          roundTotal: 0,
          cumulativeTotal: 0
        }
      ])
    ) as RoundScoreRow["values"];

    game.scoreEvents.forEach((event) => {
      if (event.roundNumber !== round.roundNumber) {
        return;
      }

      const nextValue = values[event.playerId];
      if (!nextValue) {
        return;
      }

      if (event.scoreType === "primary") {
        nextValue.primary += event.value;
      } else {
        nextValue.secondary += event.value;
      }
      nextValue.roundTotal += event.value;
    });

    return {
      roundNumber: round.roundNumber,
      label: `R${round.roundNumber}`,
      values
    };
  });

  orderedPlayers.forEach((player) => {
    let runningTotal = 0;
    roundScoreRows.forEach((roundRow) => {
      runningTotal += roundRow.values[player.id]?.roundTotal ?? 0;
      roundRow.values[player.id].cumulativeTotal = runningTotal;
    });
  });

  const roundTimeRows: RoundTimeRow[] = game.rounds.map((round) => {
    const values = Object.fromEntries(
      orderedPlayers.map((player) => [player.id, 0])
    ) as RoundTimeRow["values"];

    round.turns.forEach((turn) => {
      if (values[turn.playerId] === undefined) {
        return;
      }

      values[turn.playerId] += getTurnDurationMs(turn);
    });

    return {
      roundNumber: round.roundNumber,
      label: `R${round.roundNumber}`,
      values
    };
  });

  orderedPlayers.forEach((player) => {
    let runningTotal = 0;
    roundTimeRows.forEach((roundRow) => {
      runningTotal += roundRow.values[player.id] ?? 0;
      roundRow.values[player.id] = runningTotal;
    });
  });

  const renderRoundScoreChart = () => {
    if (!roundScoreRows.length) {
      return (
        <article className="card stack">
          <div className="list-row">
            <h2>Score-Verlauf</h2>
            <span>0 Runden</span>
          </div>
          <p className="muted-copy">Noch keine abgeschlossenen Runden vorhanden.</p>
        </article>
      );
    }

    const plotWidth = SCORE_CHART_WIDTH - SCORE_CHART_PADDING * 2;
    const plotHeight = SCORE_CHART_HEIGHT - SCORE_CHART_PADDING * 2;
    const groupWidth = plotWidth / roundScoreRows.length;
    const barWidth = Math.max(10, Math.min(18, groupWidth * 0.14));
    const playerGap = barWidth * 0.45;
    const groupCenterOffset = barWidth * 2 + playerGap / 2;
    const maxRoundValue = Math.max(
      ...roundScoreRows.flatMap((roundRow) =>
        orderedPlayers.flatMap((player) => [
          roundRow.values[player.id]?.primary ?? 0,
          roundRow.values[player.id]?.secondary ?? 0
        ])
      ),
      1
    );
    const maxTotalValue = Math.max(
      ...roundScoreRows.flatMap((roundRow) =>
        orderedPlayers.map((player) => roundRow.values[player.id]?.cumulativeTotal ?? 0)
      ),
      1
    );

    const lineSeries = orderedPlayers.map((player) => {
      const points = roundScoreRows.map((roundRow, roundIndex) => ({
        x: SCORE_CHART_PADDING + groupWidth * roundIndex + groupWidth / 2,
        y:
          SCORE_CHART_HEIGHT -
          SCORE_CHART_PADDING -
          ((roundRow.values[player.id]?.cumulativeTotal ?? 0) / maxTotalValue) * plotHeight,
        value: roundRow.values[player.id]?.cumulativeTotal ?? 0
      }));

      return {
        player,
        path: buildLinePath(points),
        points
      };
    });

    return (
      <article className="card stack">
        <div className="list-row">
          <h2>Score-Verlauf</h2>
          <span>{roundScoreRows.length} Runden</span>
        </div>
        <section className="overview-chart-card">
          <div className="overview-chart-card__head">
            <strong>Runden-Score + Gesamt</strong>
            <div className="overview-chart-legend overview-chart-legend--score">
              <span className="overview-chart-legend__item is-player-1 is-bar-primary">
                {orderedPlayers[0]?.name} Prim
              </span>
              <span className="overview-chart-legend__item is-player-1 is-bar-secondary">
                {orderedPlayers[0]?.name} Sek
              </span>
              <span className="overview-chart-legend__item is-player-2 is-bar-primary">
                {orderedPlayers[1]?.name} Prim
              </span>
              <span className="overview-chart-legend__item is-player-2 is-bar-secondary">
                {orderedPlayers[1]?.name} Sek
              </span>
              {orderedPlayers.map((player, playerIndex) => (
                <span key={`${player.id}-line`} className={`overview-chart-legend__item is-player-${playerIndex + 1}`}>
                  {player.name} Gesamt
                </span>
              ))}
            </div>
          </div>
          <svg
            viewBox={`0 0 ${SCORE_CHART_WIDTH} ${SCORE_CHART_HEIGHT}`}
            className="overview-chart overview-chart--score"
            role="img"
            aria-label="Score-Verlauf pro Runde mit Primary, Secondary und kumulierter Gesamtpunktzahl"
          >
            {[0.25, 0.5, 0.75].map((marker) => {
              const y = SCORE_CHART_HEIGHT - SCORE_CHART_PADDING - marker * plotHeight;
              return (
                <line
                  key={marker}
                  x1={SCORE_CHART_PADDING}
                  y1={y}
                  x2={SCORE_CHART_WIDTH - SCORE_CHART_PADDING}
                  y2={y}
                  className="overview-chart__guide"
                />
              );
            })}
            <line
              x1={SCORE_CHART_PADDING}
              y1={SCORE_CHART_HEIGHT - SCORE_CHART_PADDING}
              x2={SCORE_CHART_WIDTH - SCORE_CHART_PADDING}
              y2={SCORE_CHART_HEIGHT - SCORE_CHART_PADDING}
              className="overview-chart__axis"
            />
            <line
              x1={SCORE_CHART_PADDING}
              y1={SCORE_CHART_PADDING}
              x2={SCORE_CHART_PADDING}
              y2={SCORE_CHART_HEIGHT - SCORE_CHART_PADDING}
              className="overview-chart__axis"
            />
            <line
              x1={SCORE_CHART_WIDTH - SCORE_CHART_PADDING}
              y1={SCORE_CHART_PADDING}
              x2={SCORE_CHART_WIDTH - SCORE_CHART_PADDING}
              y2={SCORE_CHART_HEIGHT - SCORE_CHART_PADDING}
              className="overview-chart__axis overview-chart__axis--right"
            />
            {roundScoreRows.map((roundRow, roundIndex) =>
              orderedPlayers.map((player, playerIndex) => {
                const playerOffset = playerIndex === 0 ? -groupCenterOffset : playerGap / 2;
                const primaryX =
                  SCORE_CHART_PADDING + groupWidth * roundIndex + groupWidth / 2 + playerOffset;
                const secondaryX = primaryX + barWidth;
                const primaryHeight = ((roundRow.values[player.id]?.primary ?? 0) / maxRoundValue) * plotHeight;
                const secondaryHeight = ((roundRow.values[player.id]?.secondary ?? 0) / maxRoundValue) * plotHeight;

                return (
                  <g key={`${roundRow.roundNumber}-${player.id}`}>
                    <rect
                      x={primaryX}
                      y={SCORE_CHART_HEIGHT - SCORE_CHART_PADDING - primaryHeight}
                      width={barWidth - 1}
                      height={Math.max(primaryHeight, 1)}
                      rx="3"
                      className={`overview-score-bar is-player-${playerIndex + 1} is-primary`}
                    />
                    <rect
                      x={secondaryX}
                      y={SCORE_CHART_HEIGHT - SCORE_CHART_PADDING - secondaryHeight}
                      width={barWidth - 1}
                      height={Math.max(secondaryHeight, 1)}
                      rx="3"
                      className={`overview-score-bar is-player-${playerIndex + 1} is-secondary`}
                    />
                  </g>
                );
              })
            )}
            {lineSeries.map((series, playerIndex) => (
              <path
                key={`${series.player.id}-score-line`}
                d={series.path}
                className={`overview-chart__line is-player-${playerIndex + 1}`}
              />
            ))}
            {roundScoreRows.map((roundRow, roundIndex) => (
              <text
                key={roundRow.roundNumber}
                x={SCORE_CHART_PADDING + groupWidth * roundIndex + groupWidth / 2}
                y={SCORE_CHART_HEIGHT - 5}
                textAnchor="middle"
                className="overview-chart__label"
              >
                {roundRow.label}
              </text>
            ))}
            <text
              x={SCORE_CHART_PADDING - 5}
              y={SCORE_CHART_PADDING + 4}
              textAnchor="end"
              className="overview-chart__scale"
            >
              {maxRoundValue}
            </text>
            <text
              x={SCORE_CHART_PADDING - 5}
              y={SCORE_CHART_HEIGHT - SCORE_CHART_PADDING + 4}
              textAnchor="end"
              className="overview-chart__scale"
            >
              0
            </text>
            <text
              x={SCORE_CHART_WIDTH - SCORE_CHART_PADDING + 5}
              y={SCORE_CHART_PADDING + 4}
              textAnchor="start"
              className="overview-chart__scale"
            >
              {maxTotalValue}
            </text>
            <text
              x={SCORE_CHART_WIDTH - SCORE_CHART_PADDING + 5}
              y={SCORE_CHART_HEIGHT - SCORE_CHART_PADDING + 4}
              textAnchor="start"
              className="overview-chart__scale"
            >
              0
            </text>
          </svg>
          <div className="overview-chart-card__totals">
            {orderedPlayers.map((player, playerIndex) => {
              const latestRound = roundScoreRows[roundScoreRows.length - 1];
              const roundValue = latestRound?.values[player.id];
              return (
                <div key={player.id} className="overview-chart-total">
                  <span className={`overview-chart-total__marker is-player-${playerIndex + 1}`} />
                  <span>{player.name}</span>
                  <strong>
                    {roundValue?.primary ?? 0}P / {roundValue?.secondary ?? 0}S / {roundValue?.cumulativeTotal ?? 0} G
                  </strong>
                </div>
              );
            })}
          </div>
        </section>
      </article>
    );
  };

  const renderRoundTimeChart = () => (
    <article className="card stack">
      <div className="list-row">
        <h2>Zeit-Verlauf</h2>
        <span>{roundTimeRows.length} Runden</span>
      </div>
      {!roundTimeRows.length ? (
        <p className="muted-copy">Noch keine abgeschlossenen Runden vorhanden.</p>
      ) : (
        <section className="overview-chart-card">
          <div className="overview-chart-card__head">
            <strong>Runden-Zeit kumuliert</strong>
            <div className="overview-chart-legend">
              {orderedPlayers.map((player, playerIndex) => (
                <span key={player.id} className={`overview-chart-legend__item is-player-${playerIndex + 1}`}>
                  {player.name}
                </span>
              ))}
            </div>
          </div>
          {(() => {
            const maxValue = Math.max(
              ...roundTimeRows.flatMap((roundRow) =>
                orderedPlayers.map((player) => roundRow.values[player.id] ?? 0)
              ),
              1
            );
            const stepX =
              roundTimeRows.length > 1
                ? (CHART_WIDTH - CHART_PADDING * 2) / (roundTimeRows.length - 1)
                : 0;
            const playerSeries = orderedPlayers.map((player) => {
              const points = roundTimeRows.map((roundRow, roundIndex) => {
                const value = roundRow.values[player.id] ?? 0;
                return {
                  x: roundTimeRows.length > 1 ? CHART_PADDING + roundIndex * stepX : CHART_WIDTH / 2,
                  y:
                    CHART_HEIGHT -
                    CHART_PADDING -
                    (value / maxValue) * (CHART_HEIGHT - CHART_PADDING * 2),
                  value
                };
              });

              return {
                player,
                path: buildLinePath(points),
                points
              };
            });

            return (
              <>
                <svg
                  viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                  className="overview-chart"
                  role="img"
                  aria-label="Zeit-Verlauf pro Runde als kumulierte Spielzeit je Spieler"
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
                  {playerSeries.map((series, playerIndex) => (
                    <path
                      key={`${series.player.id}-time-line`}
                      d={series.path}
                      className={`overview-chart__line is-player-${playerIndex + 1}`}
                    />
                  ))}
                  {roundTimeRows.map((roundRow, roundIndex) => (
                    <text
                      key={roundRow.roundNumber}
                      x={roundTimeRows.length > 1 ? CHART_PADDING + roundIndex * stepX : CHART_WIDTH / 2}
                      y={CHART_HEIGHT - 5}
                      textAnchor="middle"
                      className="overview-chart__label"
                    >
                      {roundRow.label}
                    </text>
                  ))}
                  <text x={CHART_PADDING - 4} y={CHART_PADDING + 4} textAnchor="end" className="overview-chart__scale">
                    {formatDuration(maxValue)}
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
                      <div key={player.id} className="overview-chart-total">
                        <span className={`overview-chart-total__marker is-player-${playerIndex + 1}`} />
                        <span>{player.name}</span>
                        <strong>{formatDuration(latestPoint?.value ?? 0)}</strong>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </section>
      )}
    </article>
  );

  return (
    <section className="stack game-overview">
      <article className="card stack">
        <div className="overview-summary-grid overview-summary-grid--compact">
          <div>
            <span>Datum</span>
            <strong>{game.scheduledDate || "-"}</strong>
          </div>
          <div>
            <span>Uhrzeit</span>
            <strong>{game.scheduledTime || "-"}</strong>
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
            <span>Ende</span>
            <strong>{formatClockTime(game.endedAt)}</strong>
          </div>
          {game.deployment ? (
            <div>
              <span>Aufstellung</span>
              <strong>{game.deployment}</strong>
            </div>
          ) : null}
          {game.primaryMission ? (
            <div>
              <span>Primaermission</span>
              <strong>{game.primaryMission}</strong>
            </div>
          ) : null}
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

      {renderRoundScoreChart()}
      {renderRoundTimeChart()}

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
    </section>
  );
};
