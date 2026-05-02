import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Game, PlayerId } from "../types/game";
import {
  getPlayerComparablePrimaryScore,
  getPlayerComparableSecondaryScore,
  getPlayerComparableTotalScore,
  getPlayerCommandPointsGained,
  getPlayerCommandPointsSpent,
  getGameDurationMs,
  getCountedRounds,
  getPlayerTurnDurationTotalMs,
  getSetupDurationMs,
  hasComparableCommandPointData,
  hasDetailedScoreData,
  hasLegacyRoundTotalScoreData,
  getRoundDurationMs,
  getTurnDurationMs
} from "../utils/gameCalculations";
import { formatDuration } from "../utils/time";

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
      legacyTotal: number;
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

type EventMetric = "primary" | "secondary" | "total" | "cp-gained" | "cp-spent" | "turn" | "round";

interface EventPlotPoint {
  id: string;
  playerId: PlayerId;
  metric: EventMetric;
  label: string;
  createdAt: string;
  elapsedMs: number;
  value: number;
  count: number;
}

type ScoreSelection =
  | {
      kind: "player-line";
      playerId: PlayerId;
    }
  | {
      kind: "metric";
      playerId: PlayerId;
      metric: "primary" | "secondary" | "legacyTotal";
    }
  | {
      kind: "point";
      playerId: PlayerId;
      roundNumber: number;
      metric: "primary" | "secondary" | "legacyTotal" | "roundTotal" | "cumulativeTotal";
    };

type TimeSelection =
  | {
      kind: "player-line";
      playerId: PlayerId;
    }
  | {
      kind: "point";
      playerId: PlayerId;
      roundNumber: number;
    };

const CHART_WIDTH = 320;
const CHART_HEIGHT = 150;
const CHART_PADDING = 20;
const SCORE_CHART_WIDTH = 360;
const SCORE_CHART_HEIGHT = 190;
const SCORE_CHART_PADDING = 24;
const EVENT_CHART_WIDTH = 360;
const EVENT_CHART_HEIGHT = 220;
const EVENT_CHART_PADDING = 28;
const EVENT_GROUP_MS = 10 * 1000;

const EVENT_METRICS: Array<{ key: EventMetric; label: string }> = [
  { key: "primary", label: "Prim" },
  { key: "secondary", label: "Sek" },
  { key: "total", label: "Ges" },
  { key: "cp-gained", label: "CP+" },
  { key: "cp-spent", label: "CP-" },
  { key: "turn", label: "Zug weiter" },
  { key: "round", label: "Runde weiter" }
];

const buildLinePath = (points: Array<{ x: number; y: number }>): string =>
  points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");

const formatBucketLabel = (startMs: number, endMs: number): string => {
  const startMinutes = Math.floor(startMs / 60000);
  const endMinutes = Math.ceil(endMs / 60000);
  return `${startMinutes} - ${endMinutes} min`;
};

export const GameOverview = ({ game }: GameOverviewProps) => {
  const [selectedScore, setSelectedScore] = useState<ScoreSelection | null>(null);
  const [selectedTime, setSelectedTime] = useState<TimeSelection | null>(null);
  const [selectedRoundDuration, setSelectedRoundDuration] = useState<string | null>(null);
  const [selectedEventMetrics, setSelectedEventMetrics] = useState<EventMetric[]>(
    EVENT_METRICS.map((metric) => metric.key)
  );
  const [selectedEventPointId, setSelectedEventPointId] = useState<string | null>(null);
  const [openCharts, setOpenCharts] = useState<Record<string, boolean>>({
    score: true,
    time: true,
    events: true,
    rounds: true
  });
  const formatScoreValue = (value: number | null) => (value === null ? "-" : value);
  const orderedPlayers =
    game.players[0].id === game.startingPlayerId ? game.players : [game.players[1], game.players[0]];
  const countedRounds = getCountedRounds(game);

  useEffect(() => {
    setSelectedScore(null);
    setSelectedTime(null);
    setSelectedRoundDuration(null);
    setSelectedEventMetrics(EVENT_METRICS.map((metric) => metric.key));
    setSelectedEventPointId(null);
    setOpenCharts({
      score: true,
      time: true,
      events: true,
      rounds: true
    });
  }, [game.id]);

  const setupDurationMs = getSetupDurationMs(game);
  const totalDurationMs = getGameDurationMs(game);
  const roundRows = [
    ...(setupDurationMs > 0
      ? [
          {
            id: "setup",
            label: "Runde 0 / Aufstellung",
            durationMs: setupDurationMs
          }
        ]
      : []),
    ...countedRounds.map((round) => ({
      id: round.id,
      label: `Runde ${round.roundNumber}`,
      durationMs: getRoundDurationMs(round, game)
    }))
  ];
  const maxRoundDuration = Math.max(...roundRows.map((round) => round.durationMs), 1);
  const roundDurationTotalMs = roundRows.reduce((total, round) => total + round.durationMs, 0);
  const roundScoreRows: RoundScoreRow[] = countedRounds.map((round) => {
    const values = Object.fromEntries(
      orderedPlayers.map((player) => [
        player.id,
        {
          primary: 0,
          secondary: 0,
          legacyTotal: 0,
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
      } else if (event.scoreType === "secondary") {
        nextValue.secondary += event.value;
      } else {
        nextValue.legacyTotal += event.value;
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

  const roundTimeRows: RoundTimeRow[] = countedRounds.map((round) => {
    const values = Object.fromEntries(
      orderedPlayers.map((player) => [player.id, 0])
    ) as RoundTimeRow["values"];

    round.turns.forEach((turn) => {
      if (values[turn.playerId] === undefined) {
        return;
      }

      values[turn.playerId] += getTurnDurationMs(turn, game);
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

  const eventPlotPoints = useMemo<EventPlotPoint[]>(() => {
    const allTimestamps = [
      ...game.timeEvents.map((event) => event.createdAt),
      ...game.scoreEvents.map((event) => event.createdAt),
      ...game.commandPointEvents.map((event) => event.createdAt)
    ].sort((left, right) => left.localeCompare(right));
    const startTime = new Date(game.startedAt ?? allTimestamps[0] ?? game.createdAt).getTime();
    const points: EventPlotPoint[] = [];
    const pushPoint = (
      playerId: PlayerId | undefined,
      metric: EventMetric,
      createdAt: string,
      value: number,
      label: string
    ) => {
      if (!playerId || !orderedPlayers.some((player) => player.id === playerId)) {
        return;
      }

      points.push({
        id: `${metric}-${playerId}-${createdAt}-${points.length}`,
        playerId,
        metric,
        label,
        createdAt,
        elapsedMs: Math.max(new Date(createdAt).getTime() - startTime, 0),
        value: Math.abs(value) || 1,
        count: 1
      });
    };

    game.scoreEvents.forEach((event) => {
      const metric =
        event.scoreType === "primary"
          ? "primary"
          : event.scoreType === "secondary"
            ? "secondary"
            : "total";
      pushPoint(event.playerId, metric, event.createdAt, event.value, `${event.value > 0 ? "+" : ""}${event.value}`);
    });

    game.commandPointEvents.forEach((event) => {
      pushPoint(
        event.playerId,
        event.cpType === "gained" ? "cp-gained" : "cp-spent",
        event.createdAt,
        event.value,
        `${event.cpType === "gained" ? "+" : "-"}${event.value}`
      );
    });

    game.timeEvents.forEach((event) => {
      if (event.action === "turn-start") {
        pushPoint(event.playerId, "turn", event.createdAt, 1, "Zug");
      } else if (event.action === "round-start") {
        pushPoint(event.playerId ?? game.startingPlayerId, "round", event.createdAt, 1, "Runde");
      }
    });

    return points
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .reduce<EventPlotPoint[]>((groups, point) => {
        const previous = [...groups]
          .reverse()
          .find(
            (group) =>
              group.playerId === point.playerId &&
              group.metric === point.metric &&
              point.elapsedMs - group.elapsedMs <= EVENT_GROUP_MS
          );
        if (
          previous
        ) {
          previous.value += point.value;
          previous.count += point.count;
          previous.label =
            previous.metric === "turn" || previous.metric === "round"
              ? `${EVENT_METRICS.find((metric) => metric.key === previous.metric)?.label ?? "Event"} ${previous.count}x`
              : `${previous.metric === "cp-spent" ? "-" : "+"}${previous.value} (${previous.count})`;
          return groups;
        }

        groups.push({ ...point });
        return groups;
      }, []);
  }, [game, orderedPlayers]);

  const getPlayerName = (playerId: string): string =>
    orderedPlayers.find((player) => player.id === playerId)?.name ?? "Spieler";

  const scoreSelectionLabel =
    selectedScore?.kind === "player-line"
      ? `${getPlayerName(selectedScore.playerId)} Gesamt`
      : selectedScore?.kind === "metric"
        ? `${getPlayerName(selectedScore.playerId)} ${selectedScore.metric === "primary" ? "Prim" : selectedScore.metric === "secondary" ? "Sek" : "Gesamt"}`
        : selectedScore
          ? `${getPlayerName(selectedScore.playerId)} Runde ${selectedScore.roundNumber}`
          : null;

  const timeSelectionLabel = (() => {
    if (selectedTime?.kind === "player-line") {
      return `${getPlayerName(selectedTime.playerId)} Gesamtzeit`;
    }

    if (selectedTime?.kind === "point") {
      return `${getPlayerName(selectedTime.playerId)} Runde ${selectedTime.roundNumber}`;
    }

    return null;
  })();

  const selectedEventPoint = selectedEventPointId
    ? eventPlotPoints.find((point) => point.id === selectedEventPointId)
    : undefined;
  const eventSelectionLabel = selectedEventPoint
    ? `${getPlayerName(selectedEventPoint.playerId)} ${selectedEventPoint.label}`
    : null;

  const isSameScoreSelection = (left: ScoreSelection | null, right: ScoreSelection) => {
    if (!left || left.kind !== right.kind || left.playerId !== right.playerId) {
      return false;
    }

    if (left.kind === "player-line") {
      return true;
    }

    if (left.kind === "metric" && right.kind === "metric") {
      return left.metric === right.metric;
    }

    if (left.kind === "point" && right.kind === "point") {
      return left.roundNumber === right.roundNumber && left.metric === right.metric;
    }

    return false;
  };

  const isSameTimeSelection = (left: TimeSelection | null, right: TimeSelection) => {
    if (!left || left.kind !== right.kind || left.playerId !== right.playerId) {
      return false;
    }

    if (left.kind === "player-line") {
      return true;
    }

    if (left.kind === "point" && right.kind === "point") {
      return left.roundNumber === right.roundNumber;
    }

    return false;
  };

  const toggleScoreSelection = (next: ScoreSelection) => {
    setSelectedScore((current) => (isSameScoreSelection(current, next) ? null : next));
  };

  const toggleTimeSelection = (next: TimeSelection) => {
    setSelectedTime((current) => (isSameTimeSelection(current, next) ? null : next));
  };

  const toggleEventMetric = (metric: EventMetric | "all") => {
    setSelectedEventPointId(null);
    setSelectedEventMetrics((current) => {
      if (metric === "all") {
        return current.length === EVENT_METRICS.length ? [] : EVENT_METRICS.map((entry) => entry.key);
      }

      return current.includes(metric)
        ? current.filter((entry) => entry !== metric)
        : [...current, metric];
    });
  };

  const toggleEventPoint = (pointId: string) => {
    setSelectedEventPointId((current) => (current === pointId ? null : pointId));
  };

  const toggleChartOpen = (chartKey: string) => {
    setOpenCharts((current) => ({
      ...current,
      [chartKey]: current[chartKey] === false
    }));
  };

  const renderChartSection = (
    chartKey: string,
    title: string,
    summary: string,
    content: ReactNode
  ) => {
    const isOpen = openCharts[chartKey] !== false;

    return (
      <article className="card stack overview-collapsible-chart">
        <button
          type="button"
          className="overview-collapsible-chart__toggle"
          onClick={() => toggleChartOpen(chartKey)}
          aria-expanded={isOpen}
        >
          <span>{title}</span>
          <strong>{summary}</strong>
          <span aria-hidden="true">{isOpen ? "Zu" : "Auf"}</span>
        </button>
        {isOpen ? content : null}
      </article>
    );
  };

  const renderRoundScoreChart = () => {
    if (!roundScoreRows.length || (!hasDetailedScoreData(game) && !hasLegacyRoundTotalScoreData(game))) {
      return renderChartSection(
        "score",
        "Score-Verlauf",
        "0 Runden",
        <>
          <p className="muted-copy">Noch keine abgeschlossenen Runden vorhanden.</p>
        </>
      );
    }

    const plotWidth = SCORE_CHART_WIDTH - SCORE_CHART_PADDING * 2;
    const plotHeight = SCORE_CHART_HEIGHT - SCORE_CHART_PADDING * 2;
    const groupWidth = plotWidth / roundScoreRows.length;
    const barWidth = Math.max(10, Math.min(18, groupWidth * 0.14));
    const playerGap = barWidth * 0.45;
    const groupCenterOffset = barWidth * 2 + playerGap / 2;
    const showDetailedBars = hasDetailedScoreData(game);
    const maxRoundValue = Math.max(
      ...roundScoreRows.flatMap((roundRow) =>
        orderedPlayers.flatMap((player) =>
          showDetailedBars
            ? [roundRow.values[player.id]?.primary ?? 0, roundRow.values[player.id]?.secondary ?? 0]
            : [roundRow.values[player.id]?.legacyTotal ?? 0]
        )
      ),
      1
    );
    const maxTotalValue = Math.max(
      ...roundScoreRows.flatMap((roundRow) => orderedPlayers.map((player) => roundRow.values[player.id]?.cumulativeTotal ?? 0)),
      1
    );
    const latestRound = roundScoreRows[roundScoreRows.length - 1];
    const selectedRound =
      selectedScore?.kind === "point"
        ? roundScoreRows.find((roundRow) => roundRow.roundNumber === selectedScore.roundNumber)
        : undefined;

    const selectedScoreValue = (() => {
      if (!selectedScore) {
        return null;
      }

      const latestValue = latestRound?.values[selectedScore.playerId];
      if (selectedScore.kind === "player-line") {
        return formatScoreValue(latestValue?.cumulativeTotal ?? 0);
      }

      if (selectedScore.kind === "metric") {
        return formatScoreValue(
          latestValue?.[
            selectedScore.metric === "primary"
              ? "primary"
              : selectedScore.metric === "secondary"
                ? "secondary"
                : "legacyTotal"
          ] ?? 0
        );
      }

      const roundValue = selectedRound?.values[selectedScore.playerId];
      return formatScoreValue(
        roundValue?.[
          selectedScore.metric === "primary"
            ? "primary"
            : selectedScore.metric === "secondary"
              ? "secondary"
              : selectedScore.metric === "legacyTotal"
                ? "legacyTotal"
                : selectedScore.metric === "roundTotal"
                  ? "roundTotal"
                  : "cumulativeTotal"
        ] ?? 0
      );
    })();

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

    return renderChartSection(
      "score",
      "Score-Verlauf",
      scoreSelectionLabel ?? `${roundScoreRows.length} Runden`,
      <>
        <section className="overview-chart-card">
          <div className="overview-chart-card__head">
            <strong>{showDetailedBars ? "Runden-Score + Gesamt" : "Runden-Gesamt + Gesamt"}</strong>
            <div className="overview-chart-legend overview-chart-legend--score">
              {showDetailedBars ? (
                <>
                  {orderedPlayers.map((player, playerIndex) => (
                    <button
                      key={`${player.id}-prim`}
                      type="button"
                      className={`overview-chart-legend__item is-player-${playerIndex + 1} is-bar-primary${
                        selectedScore?.kind === "metric" && selectedScore.playerId === player.id && selectedScore.metric === "primary"
                          ? " is-active"
                          : ""
                      }`}
                      onClick={() =>
                        toggleScoreSelection({
                          kind: "metric",
                          playerId: player.id,
                          metric: "primary"
                        })
                      }
                    >
                      {player.name} Prim
                    </button>
                  ))}
                  {orderedPlayers.map((player, playerIndex) => (
                    <button
                      key={`${player.id}-sek`}
                      type="button"
                      className={`overview-chart-legend__item is-player-${playerIndex + 1} is-bar-secondary${
                        selectedScore?.kind === "metric" && selectedScore.playerId === player.id && selectedScore.metric === "secondary"
                          ? " is-active"
                          : ""
                      }`}
                      onClick={() =>
                        toggleScoreSelection({
                          kind: "metric",
                          playerId: player.id,
                          metric: "secondary"
                        })
                      }
                    >
                      {player.name} Sek
                    </button>
                  ))}
                </>
              ) : (
                orderedPlayers.map((player, playerIndex) => (
                  <button
                    key={`${player.id}-round-total`}
                    type="button"
                    className={`overview-chart-legend__item is-player-${playerIndex + 1} is-bar-total${
                      selectedScore?.kind === "metric" &&
                      selectedScore.playerId === player.id &&
                      selectedScore.metric === "legacyTotal"
                        ? " is-active"
                        : ""
                    }`}
                    onClick={() =>
                      toggleScoreSelection({
                        kind: "metric",
                        playerId: player.id,
                        metric: "legacyTotal"
                      })
                    }
                  >
                    {player.name} Runde
                  </button>
                ))
              )}
              {orderedPlayers.map((player, playerIndex) => (
                <button
                  key={`${player.id}-line`}
                  type="button"
                  className={`overview-chart-legend__item is-player-${playerIndex + 1}${
                    selectedScore?.kind === "player-line" && selectedScore.playerId === player.id ? " is-active" : ""
                  }`}
                  onClick={() =>
                    toggleScoreSelection({
                      kind: "player-line",
                      playerId: player.id
                    })
                  }
                >
                  {player.name} Gesamt
                </button>
              ))}
            </div>
          </div>
          <svg
            viewBox={`0 0 ${SCORE_CHART_WIDTH} ${SCORE_CHART_HEIGHT}`}
            className="overview-chart overview-chart--score overview-chart--interactive"
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
                const playerDimmed = Boolean(selectedScore && selectedScore.playerId !== player.id);

                if (showDetailedBars) {
                  const playerOffset = playerIndex === 0 ? -groupCenterOffset : playerGap / 2;
                  const primaryX = SCORE_CHART_PADDING + groupWidth * roundIndex + groupWidth / 2 + playerOffset;
                  const secondaryX = primaryX + barWidth;
                  const primaryHeight = ((roundRow.values[player.id]?.primary ?? 0) / maxRoundValue) * plotHeight;
                  const secondaryHeight = ((roundRow.values[player.id]?.secondary ?? 0) / maxRoundValue) * plotHeight;
                  const primaryActive =
                    selectedScore?.kind === "metric" &&
                    selectedScore.playerId === player.id &&
                    selectedScore.metric === "primary";
                  const secondaryActive =
                    selectedScore?.kind === "metric" &&
                    selectedScore.playerId === player.id &&
                    selectedScore.metric === "secondary";

                  return (
                    <g key={`${roundRow.roundNumber}-${player.id}`}>
                      <rect
                        x={primaryX}
                        y={SCORE_CHART_HEIGHT - SCORE_CHART_PADDING - primaryHeight}
                        width={barWidth - 1}
                        height={Math.max(primaryHeight, 1)}
                        rx="3"
                        onClick={() =>
                          toggleScoreSelection({
                            kind: "metric",
                            playerId: player.id,
                            metric: "primary"
                          })
                        }
                        className={`overview-score-bar is-player-${playerIndex + 1} is-primary${primaryActive ? " is-active" : ""}${
                          playerDimmed && !primaryActive ? " is-dimmed" : ""
                        }`}
                      />
                      <rect
                        x={secondaryX}
                        y={SCORE_CHART_HEIGHT - SCORE_CHART_PADDING - secondaryHeight}
                        width={barWidth - 1}
                        height={Math.max(secondaryHeight, 1)}
                        rx="3"
                        onClick={() =>
                          toggleScoreSelection({
                            kind: "metric",
                            playerId: player.id,
                            metric: "secondary"
                          })
                        }
                        className={`overview-score-bar is-player-${playerIndex + 1} is-secondary${secondaryActive ? " is-active" : ""}${
                          playerDimmed && !secondaryActive ? " is-dimmed" : ""
                        }`}
                      />
                    </g>
                  );
                }

                const singleGroupWidth = Math.max(18, Math.min(28, groupWidth * 0.28));
                const baseOffset = playerIndex === 0 ? -(singleGroupWidth + playerGap / 2) : playerGap / 2;
                const roundTotalHeight = ((roundRow.values[player.id]?.legacyTotal ?? 0) / maxRoundValue) * plotHeight;
                const isActiveTotal =
                  selectedScore?.kind === "metric" &&
                  selectedScore.playerId === player.id &&
                  selectedScore.metric === "legacyTotal";

                return (
                  <rect
                    key={`${roundRow.roundNumber}-${player.id}`}
                    x={SCORE_CHART_PADDING + groupWidth * roundIndex + groupWidth / 2 + baseOffset}
                    y={SCORE_CHART_HEIGHT - SCORE_CHART_PADDING - roundTotalHeight}
                    width={singleGroupWidth}
                    height={Math.max(roundTotalHeight, 1)}
                    rx="4"
                    onClick={() =>
                      toggleScoreSelection({
                        kind: "metric",
                        playerId: player.id,
                        metric: "legacyTotal"
                      })
                    }
                    className={`overview-score-bar is-player-${playerIndex + 1} is-total${isActiveTotal ? " is-active" : ""}${
                      playerDimmed && !isActiveTotal ? " is-dimmed" : ""
                    }`}
                  />
                );
              })
            )}
            {lineSeries.map((series, playerIndex) => {
              const isActiveLine = selectedScore?.kind === "player-line" && selectedScore.playerId === series.player.id;
              const isDimmed = Boolean(selectedScore && selectedScore.playerId !== series.player.id);

              return (
                <g key={`${series.player.id}-score-line`}>
                  <path
                    d={series.path}
                    onClick={() =>
                      toggleScoreSelection({
                        kind: "player-line",
                        playerId: series.player.id
                      })
                    }
                    className={`overview-chart__line is-player-${playerIndex + 1}${isActiveLine ? " is-active" : ""}${isDimmed ? " is-dimmed" : ""}`}
                  />
                  {series.points.map((point, pointIndex) => {
                    const roundRow = roundScoreRows[pointIndex];
                    const isActivePoint =
                      selectedScore?.kind === "point" &&
                      selectedScore.playerId === series.player.id &&
                      selectedScore.roundNumber === roundRow?.roundNumber &&
                      selectedScore.metric === "cumulativeTotal";

                    return (
                      <circle
                        key={`${series.player.id}-${pointIndex}`}
                        cx={point.x}
                        cy={point.y}
                        r={isActivePoint ? 4.5 : 3.2}
                        onClick={() =>
                          toggleScoreSelection({
                            kind: "point",
                            playerId: series.player.id,
                            roundNumber: roundRow?.roundNumber ?? 0,
                            metric: "cumulativeTotal"
                          })
                        }
                        className={`overview-chart__point is-player-${playerIndex + 1} overview-chart__point--scatter is-score${
                          isActivePoint ? " is-active" : ""
                        }${isDimmed && !isActivePoint ? " is-dimmed" : ""}`}
                      />
                    );
                  })}
                </g>
              );
            })}
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
            <text x={SCORE_CHART_PADDING - 5} y={SCORE_CHART_PADDING + 4} textAnchor="end" className="overview-chart__scale">
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
            <div className="overview-chart-total overview-chart-total--selection">
              <span className="overview-chart-total__marker is-score" />
              <span>{scoreSelectionLabel ?? "Auswahl"}</span>
              <strong>{selectedScoreValue ?? "-"}</strong>
            </div>
            {orderedPlayers.map((player, playerIndex) => {
              const roundValue = latestRound?.values[player.id];
              return (
                <div key={player.id} className="overview-chart-total">
                  <span className={`overview-chart-total__marker is-player-${playerIndex + 1}`} />
                  <span>{player.name}</span>
                  <strong>
                    {showDetailedBars
                      ? `${roundValue?.primary ?? 0}P / ${roundValue?.secondary ?? 0}S / ${roundValue?.cumulativeTotal ?? 0} G`
                      : `${roundValue?.legacyTotal ?? 0}R / ${roundValue?.cumulativeTotal ?? 0} G`}
                  </strong>
                </div>
              );
            })}
          </div>
        </section>
      </>
    );
  };

  const renderRoundTimeChart = () => {
    if (!roundTimeRows.length) {
      return renderChartSection(
        "time",
        "Zeit-Verlauf",
        "0 Runden",
        <>
          <p className="muted-copy">Noch keine abgeschlossenen Runden vorhanden.</p>
        </>
      );
    }

    return renderChartSection(
      "time",
      "Zeit-Verlauf",
      timeSelectionLabel ?? `${roundTimeRows.length} Runden`,
      <>
        <section className="overview-chart-card">
          <div className="overview-chart-card__head">
            <strong>Runden-Zeit kumuliert</strong>
            <div className="overview-chart-legend">
              {orderedPlayers.map((player, playerIndex) => (
                <button
                  type="button"
                  key={player.id}
                  className={`overview-chart-legend__item is-player-${playerIndex + 1}${
                    selectedTime?.kind === "player-line" && selectedTime.playerId === player.id ? " is-active" : ""
                  }`}
                  onClick={() =>
                    toggleTimeSelection({
                      kind: "player-line",
                      playerId: player.id
                    })
                  }
                >
                  {player.name}
                </button>
              ))}
            </div>
          </div>
          {(() => {
            const maxValue = Math.max(
              ...roundTimeRows.flatMap((roundRow) => orderedPlayers.map((player) => roundRow.values[player.id] ?? 0)),
              1
            );
            const stepX = roundTimeRows.length > 1 ? (CHART_WIDTH - CHART_PADDING * 2) / (roundTimeRows.length - 1) : 0;
            const playerSeries = orderedPlayers.map((player) => {
              const points = roundTimeRows.map((roundRow, roundIndex) => {
                const value = roundRow.values[player.id] ?? 0;
                return {
                  x: roundTimeRows.length > 1 ? CHART_PADDING + roundIndex * stepX : CHART_WIDTH / 2,
                  y: CHART_HEIGHT - CHART_PADDING - (value / maxValue) * (CHART_HEIGHT - CHART_PADDING * 2),
                  value
                };
              });

              return {
                player,
                path: buildLinePath(points),
                points
              };
            });
            const selectedRound =
              selectedTime?.kind === "point"
                ? roundTimeRows.find((roundRow) => roundRow.roundNumber === selectedTime.roundNumber)
                : undefined;
            const selectedTimeValue =
              selectedTime?.kind === "player-line"
                ? formatDuration(roundTimeRows[roundTimeRows.length - 1]?.values[selectedTime.playerId] ?? 0)
                : selectedTime?.kind === "point"
                  ? formatDuration(selectedRound?.values[selectedTime.playerId] ?? 0)
                  : formatDuration(roundTimeRows[roundTimeRows.length - 1]?.values[orderedPlayers[0]?.id ?? ""] ?? 0);

            return (
              <>
                <svg
                  viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                  className="overview-chart overview-chart--interactive"
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
                  {playerSeries.map((series, playerIndex) => {
                    const isActiveLine = selectedTime?.kind === "player-line" && selectedTime.playerId === series.player.id;
                    const isDimmed = Boolean(selectedTime && selectedTime.playerId !== series.player.id);

                    return (
                      <g key={`${series.player.id}-time-line`}>
                        <path
                          d={series.path}
                          onClick={() =>
                            toggleTimeSelection({
                              kind: "player-line",
                              playerId: series.player.id
                            })
                          }
                          className={`overview-chart__line is-player-${playerIndex + 1}${isActiveLine ? " is-active" : ""}${isDimmed ? " is-dimmed" : ""}`}
                        />
                        {series.points.map((point, pointIndex) => {
                          const roundRow = roundTimeRows[pointIndex];
                          const isActivePoint =
                            selectedTime?.kind === "point" &&
                            selectedTime.playerId === series.player.id &&
                            selectedTime.roundNumber === roundRow?.roundNumber;

                          return (
                            <circle
                              key={`${series.player.id}-${pointIndex}`}
                              cx={point.x}
                              cy={point.y}
                              r={isActivePoint ? 4.4 : 3.1}
                              onClick={() =>
                                toggleTimeSelection({
                                  kind: "point",
                                  playerId: series.player.id,
                                  roundNumber: roundRow?.roundNumber ?? 0
                                })
                              }
                              className={`overview-chart__point is-player-${playerIndex + 1} overview-chart__point--scatter is-time${
                                isActivePoint ? " is-active" : ""
                              }${isDimmed && !isActivePoint ? " is-dimmed" : ""}`}
                            />
                          );
                        })}
                      </g>
                    );
                  })}
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
                  <div className="overview-chart-total overview-chart-total--selection">
                    <span className="overview-chart-total__marker is-time" />
                    <span>{timeSelectionLabel ?? "Auswahl"}</span>
                    <strong>{selectedTimeValue}</strong>
                  </div>
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
                  <div className="overview-chart-total">
                    <span className="overview-chart-total__marker is-warning" />
                    <span>Aufstellung</span>
                    <strong>{formatDuration(setupDurationMs)}</strong>
                  </div>
                  <div className="overview-chart-total">
                    <span className="overview-chart-total__marker is-score" />
                    <span>Gesamtzeit</span>
                    <strong>{formatDuration(totalDurationMs)}</strong>
                  </div>
                </div>
              </>
            );
          })()}
        </section>
      </>
    );
  };

  const eventTimelineBuckets: Array<{
    index: number;
    startMs: number;
    endMs: number;
    counts: Record<string, number>;
    count: number;
  }> = [];
  const selectedEventCategory: any = "all";
  const selectedEventBucket: number | null = null;
  const toggleEventCategory = (_category: any) => undefined;
  const toggleEventBucket = (_bucketIndex: number) => undefined;

  const renderEventScatterChart = () => {
    if (!eventPlotPoints.length) {
      return renderChartSection(
        "events",
        "Event-Verlauf",
        "0 Events",
        <p className="muted-copy">Noch keine Zeit- oder Punkteereignisse vorhanden.</p>
      );
    }

    const visiblePoints = eventPlotPoints.filter((point) => selectedEventMetrics.includes(point.metric));
    const maxElapsedMs = Math.max(...eventPlotPoints.map((point) => point.elapsedMs), 1);
    const maxValue = Math.max(...eventPlotPoints.map((point) => point.value), 1);
    const plotWidth = EVENT_CHART_WIDTH - EVENT_CHART_PADDING * 2;
    const plotHeight = EVENT_CHART_HEIGHT - EVENT_CHART_PADDING * 2;
    const yStep = plotHeight / Math.max(EVENT_METRICS.length - 1, 1);
    const getY = (metric: EventMetric) =>
      EVENT_CHART_PADDING + EVENT_METRICS.findIndex((entry) => entry.key === metric) * yStep;
    const getX = (elapsedMs: number) => EVENT_CHART_PADDING + (elapsedMs / maxElapsedMs) * plotWidth;
    const pointRadius = (value: number) => 4 + (value / maxValue) * 8;
    const allMetricsSelected = selectedEventMetrics.length === EVENT_METRICS.length;
    const metricSummary = `${visiblePoints.length} Events`;

    return renderChartSection(
      "events",
      "Event-Verlauf",
      eventSelectionLabel ?? metricSummary,
      <section className="overview-chart-card">
        <div className="overview-chart-card__head">
          <div className="overview-chart-legend overview-chart-legend--events">
            <button
              type="button"
              className={`overview-chart-legend__item${allMetricsSelected ? " is-active" : ""}`}
              onClick={() => toggleEventMetric("all")}
            >
              Alle {eventPlotPoints.length}
            </button>
            {EVENT_METRICS.map((metric) => (
              <button
                key={metric.key}
                type="button"
                className={`overview-chart-legend__item is-event-${metric.key}${selectedEventMetrics.includes(metric.key) ? " is-active" : ""}`}
                onClick={() => toggleEventMetric(metric.key)}
              >
                {metric.label} {eventPlotPoints.filter((point) => point.metric === metric.key).length}
              </button>
            ))}
          </div>
        </div>
        <div className="overview-event-chart-grid">
          {orderedPlayers.map((player, playerIndex) => {
            const playerPoints = visiblePoints.filter((point) => point.playerId === player.id);

            return (
              <div key={player.id} className="overview-event-chart">
                <div className="overview-event-chart__title">
                  <strong>{player.name}</strong>
                  <span>{playerPoints.length} Events</span>
                </div>
                <svg
                  viewBox={`0 0 ${EVENT_CHART_WIDTH} ${EVENT_CHART_HEIGHT}`}
                  className="overview-chart overview-chart--interactive overview-chart--events"
                  role="img"
                  aria-label={`Event-Verlauf ${player.name}`}
                >
                  {EVENT_METRICS.map((metric) => {
                    const y = getY(metric.key);
                    return (
                      <g key={metric.key}>
                        <line
                          x1={EVENT_CHART_PADDING}
                          y1={y}
                          x2={EVENT_CHART_WIDTH - EVENT_CHART_PADDING}
                          y2={y}
                          className="overview-chart__guide"
                        />
                        <text x={EVENT_CHART_PADDING - 6} y={y + 3} textAnchor="end" className="overview-chart__label">
                          {metric.label}
                        </text>
                      </g>
                    );
                  })}
                  <line
                    x1={EVENT_CHART_PADDING}
                    y1={EVENT_CHART_HEIGHT - EVENT_CHART_PADDING}
                    x2={EVENT_CHART_WIDTH - EVENT_CHART_PADDING}
                    y2={EVENT_CHART_HEIGHT - EVENT_CHART_PADDING}
                    className="overview-chart__axis"
                  />
                  <line
                    x1={EVENT_CHART_PADDING}
                    y1={EVENT_CHART_PADDING}
                    x2={EVENT_CHART_PADDING}
                    y2={EVENT_CHART_HEIGHT - EVENT_CHART_PADDING}
                    className="overview-chart__axis"
                  />
                  {[0, 0.5, 1].map((marker) => (
                    <text
                      key={marker}
                      x={EVENT_CHART_PADDING + marker * plotWidth}
                      y={EVENT_CHART_HEIGHT - 7}
                      textAnchor="middle"
                      className="overview-chart__scale"
                    >
                      {Math.round((marker * maxElapsedMs) / 60000)}
                    </text>
                  ))}
                  {playerPoints.map((point) => {
                    const isActive = selectedEventPointId === point.id;
                    const isDimmed = Boolean(selectedEventPointId && !isActive);

                    return (
                      <g key={point.id} className={`overview-chart__point-group${isActive ? " is-active" : ""}`}>
                        <circle
                          cx={getX(point.elapsedMs)}
                          cy={getY(point.metric)}
                          r={pointRadius(point.value)}
                          className={`overview-chart__point overview-chart__point--event is-event-${point.metric} is-player-${playerIndex + 1}${
                            isActive ? " is-active" : ""
                          }${isDimmed ? " is-dimmed" : ""}`}
                          onClick={() => toggleEventPoint(point.id)}
                        />
                        {isActive ? (
                          <text
                            x={Math.min(getX(point.elapsedMs) + 10, EVENT_CHART_WIDTH - EVENT_CHART_PADDING)}
                            y={getY(point.metric) - 8}
                            className="overview-chart__label"
                          >
                            {point.label}
                          </text>
                        ) : null}
                      </g>
                    );
                  })}
                </svg>
              </div>
            );
          })}
        </div>
        <div className="overview-chart-card__totals">
          <div className="overview-chart-total overview-chart-total--selection">
            <span className={`overview-chart-total__marker ${selectedEventPoint ? `is-event-${selectedEventPoint.metric}` : "is-warning"}`} />
            <span>{selectedEventPoint ? getPlayerName(selectedEventPoint.playerId) : "Auswahl"}</span>
            <strong>{selectedEventPoint ? selectedEventPoint.label : metricSummary}</strong>
          </div>
        </div>
      </section>
    );
  };

  const renderEventTimelineChart = () => {
    if (!eventTimelineBuckets.length) {
      return (
        <article className="card stack">
          <div className="list-row">
            <h2>Event-Verlauf</h2>
            <span>0 Events</span>
          </div>
          <p className="muted-copy">Noch keine Zeit-, Punkte- oder Notizereignisse vorhanden.</p>
        </article>
      );
    }

    const selectedEventCountKey = selectedEventCategory === "all" ? null : selectedEventCategory;
    const visibleBuckets = eventTimelineBuckets.map((bucket) => ({
      ...bucket,
      count: selectedEventCountKey ? bucket.counts[selectedEventCountKey] : bucket.count
    }));
    const maxCount = Math.max(...visibleBuckets.map((bucket) => bucket.count), 1);
    const totalCount = visibleBuckets.reduce((total, bucket) => total + bucket.count, 0);
    const selectedBucket =
      selectedEventBucket !== null ? eventTimelineBuckets[selectedEventBucket] : undefined;
    const selectedBucketCount =
      selectedBucket && !selectedEventCountKey
        ? selectedBucket.count
        : selectedBucket
          ? selectedBucket.counts[selectedEventCountKey ?? "time"]
          : 0;
    const selectedCategoryLabel =
      selectedEventCategory === "all"
        ? "Alle Ereignisse"
        : selectedEventCategory === "time"
          ? "Zeit"
          : selectedEventCategory === "score"
            ? "Punkte"
            : selectedEventCategory === "cp"
              ? "CP"
              : "Notizen";
    const barWidth = Math.max(8, Math.min(18, (CHART_WIDTH - CHART_PADDING * 2) / Math.max(visibleBuckets.length, 1) - 2));
    const selectedRound = undefined as { label: string; durationMs: number } | undefined;

    return renderChartSection(
      "rounds",
      `Rundenzeiten (Gesamt: ${formatDuration(roundDurationTotalMs)})`,
      selectedRound ? `${selectedRound.label} - ${formatDuration(selectedRound.durationMs)}` : `${roundRows.length} Runden`,
      <>
        <div hidden>
        </div>
        <div hidden>
        </div>
        <div className="list-row">
          <h2>Event-Verlauf</h2>
          <span>{eventSelectionLabel ?? `${totalCount} Events`}</span>
        </div>
        <section className="overview-chart-card">
          <div className="overview-chart-card__head">
            <div className="overview-chart-legend overview-chart-legend--events">
              {(["all", "time", "score", "cp", "note"] as const).map((category) => {
                const label =
                  category === "all"
                    ? "Alle"
                    : category === "time"
                      ? "Zeit"
                      : category === "score"
                        ? "Score"
                        : category === "cp"
                          ? "CP"
                          : "Notizen";
                const count =
                  category === "all"
                    ? totalCount
                    : eventTimelineBuckets.reduce((sum, bucket) => sum + bucket.counts[category], 0);

                return (
                  <button
                    key={category}
                    type="button"
                    className={`overview-chart-legend__item${selectedEventCategory === category ? " is-active" : ""}`}
                    onClick={() => toggleEventCategory(category)}
                  >
                    {label} {count}
                  </button>
                );
              })}
            </div>
          </div>
          <svg
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            className="overview-chart overview-chart--interactive"
            role="img"
            aria-label="Event-Verlauf über die Zeit"
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
            {visibleBuckets.map((bucket, bucketIndex) => {
              const x =
                visibleBuckets.length > 1
                  ? CHART_PADDING + bucketIndex * ((CHART_WIDTH - CHART_PADDING * 2) / (visibleBuckets.length - 1)) - barWidth / 2
                  : CHART_WIDTH / 2 - barWidth / 2;
              const height = (bucket.count / maxCount) * (CHART_HEIGHT - CHART_PADDING * 2);
              const isActiveBucket = selectedEventBucket === bucket.index;
              const isDimmed = selectedEventBucket !== null && !isActiveBucket;

              return (
                <rect
                  key={bucket.index}
                  x={x}
                  y={CHART_HEIGHT - CHART_PADDING - height}
                  width={barWidth}
                  height={Math.max(height, 1)}
                  rx="4"
                  onClick={() => toggleEventBucket(bucket.index)}
                  className={`overview-chart__bar overview-chart__bar--events${isActiveBucket ? " is-active" : ""}${
                    isDimmed ? " is-dimmed" : ""
                  }`}
                />
              );
            })}
            {visibleBuckets.map((bucket, bucketIndex) => (
              <text
                key={`${bucket.index}-label`}
                x={
                  visibleBuckets.length > 1
                    ? CHART_PADDING + bucketIndex * ((CHART_WIDTH - CHART_PADDING * 2) / (visibleBuckets.length - 1))
                    : CHART_WIDTH / 2
                }
                y={CHART_HEIGHT - 5}
                textAnchor="middle"
                className="overview-chart__label"
              >
                {bucketIndex % 2 === 0 ? `${Math.floor(bucket.startMs / 60000)}` : ""}
              </text>
            ))}
            <text x={CHART_PADDING - 4} y={CHART_PADDING + 4} textAnchor="end" className="overview-chart__scale">
              {maxCount}
            </text>
            <text x={CHART_PADDING - 4} y={CHART_HEIGHT - CHART_PADDING + 4} textAnchor="end" className="overview-chart__scale">
              0
            </text>
          </svg>
          <div className="overview-chart-card__totals">
            <div className="overview-chart-total overview-chart-total--selection">
              <span className="overview-chart-total__marker is-warning" />
              <span>{selectedBucket ? formatBucketLabel(selectedBucket.startMs, selectedBucket.endMs) : selectedCategoryLabel}</span>
              <strong>{selectedBucket ? `${selectedBucketCount} Events` : `${totalCount} Events`}</strong>
            </div>
            {selectedBucket ? (
              <>
                <div className="overview-chart-total">
                  <span className="overview-chart-total__marker is-time" />
                  <span>Zeit</span>
                  <strong>{selectedBucket.counts.time}</strong>
                </div>
                <div className="overview-chart-total">
                  <span className="overview-chart-total__marker is-score" />
                  <span>Punkte</span>
                  <strong>{selectedBucket.counts.score}</strong>
                </div>
                <div className="overview-chart-total">
                  <span className="overview-chart-total__marker is-success" />
                  <span>CP</span>
                  <strong>{selectedBucket.counts.cp}</strong>
                </div>
                <div className="overview-chart-total">
                  <span className="overview-chart-total__marker is-warning" />
                  <span>Notizen</span>
                  <strong>{selectedBucket.counts.note}</strong>
                </div>
              </>
            ) : null}
          </div>
        </section>
      </>
    );
  };

  const renderRoundDurationChart = () => {
    const selectedRound = selectedRoundDuration !== null ? roundRows.find((round) => round.id === selectedRoundDuration) : undefined;

    return renderChartSection(
      "rounds",
      "Rundenzeiten",
      selectedRound ? `${selectedRound.label} - ${formatDuration(selectedRound.durationMs)}` : `${roundRows.length} Runden`,
      <>
        <div hidden>
          <span>{selectedRound ? `${selectedRound.label} · ${formatDuration(selectedRound.durationMs)}` : `${roundRows.length} Runden`}</span>
        </div>
        <div className="overview-bar-list">
          {roundRows.map((round) => (
            <button
              key={round.id}
              type="button"
              className={`overview-bar-row${selectedRoundDuration === round.id ? " is-active" : ""}`}
              onClick={() => setSelectedRoundDuration(round.id)}
            >
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
            </button>
          ))}
        </div>
      </>
    );
  };

  return (
    <section className="stack game-overview">
      <article className="card stack">
        <div className="overview-summary-grid overview-summary-grid--compact">
          <div className="overview-summary-item">
            <span>Datum</span>
            <strong>{game.scheduledDate || "-"}</strong>
          </div>
          <div className="overview-summary-item">
            <span>Uhrzeit</span>
            <strong>{game.scheduledTime || "-"}</strong>
          </div>
          <div className="overview-summary-item">
            <span>Gesamtzeit</span>
            <strong>{formatDuration(getGameDurationMs(game))}</strong>
          </div>
          <div className="overview-summary-item">
            <span>Punkte</span>
            <strong>{game.gamePoints}</strong>
          </div>
          {game.deployment ? (
            <div className="overview-summary-item overview-summary-item--compact">
              <span>Aufstellung</span>
              <strong>{game.deployment}</strong>
            </div>
          ) : null}
          {game.primaryMission ? (
            <div className="overview-summary-item overview-summary-item--compact">
              <span>Primärmission</span>
              <strong>{game.primaryMission}</strong>
            </div>
          ) : null}
        </div>
      </article>

      <div className="overview-player-grid">
        {orderedPlayers.map((player) => (
          <article key={player.id} className="card stack overview-player-card">
            <div className="overview-player-card__head">
              <div className="overview-player-card__identity">
                <strong>{player.name}</strong>
                <p>{player.army.name}</p>
              </div>
              <span className="meta-chip">
                {player.id === game.startingPlayerId ? "Start" : "Second"}
              </span>
            </div>
            <div className="overview-player-card__stats">
              <div className="overview-player-stat overview-player-stat--score">
                <span>Prim</span>
                <strong>{formatScoreValue(getPlayerComparablePrimaryScore(game, player.id))}</strong>
              </div>
              <div className="overview-player-stat overview-player-stat--score">
                <span>Sek</span>
                <strong>{formatScoreValue(getPlayerComparableSecondaryScore(game, player.id))}</strong>
              </div>
              <div className="overview-player-stat overview-player-stat--score overview-player-stat--total">
                <span>Ges</span>
                <strong>{formatScoreValue(getPlayerComparableTotalScore(game, player.id))}</strong>
              </div>
              <div className="overview-player-stat">
                <span>Zeit</span>
                <strong>{formatDuration(getPlayerTurnDurationTotalMs(game, player.id))}</strong>
              </div>
              <div className="overview-player-stat">
                <span>CP + / -</span>
                <strong>
                  {hasComparableCommandPointData(game, player.id)
                    ? `${getPlayerCommandPointsGained(game, player.id)} / ${getPlayerCommandPointsSpent(game, player.id)}`
                    : "-"}
                </strong>
              </div>
            </div>
          </article>
        ))}
      </div>

      {renderRoundScoreChart()}
      {renderRoundTimeChart()}
      {renderEventScatterChart()}
      {renderRoundDurationChart()}
    </section>
  );
};
