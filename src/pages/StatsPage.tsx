import { useMemo, useState } from "react";
import { CollapsibleSection } from "../components/CollapsibleSection";
import { FloatingMenu } from "../components/FloatingMenu";
import { Layout } from "../components/Layout";
import { StatCard } from "../components/StatCard";
import { useGameStore } from "../store/GameStore";
import {
  createArmyAggregates,
  createCpScoreCorrelationPoints,
  createDeploymentLeaders,
  createPlayerTurnDurationAggregates,
  createInitialGameFilters,
  createMatchupAggregates,
  createMissionLeaders,
  createPlayerAggregates,
  createRoundDurationAggregates,
  createRoundScoreAggregates,
  createScenarioPerformanceAggregates,
  createStatsOverview,
  filterGames,
  getCompletedRoundDurationMs,
  getCompletedTurnDurationMs,
  getFilterOptions,
  getPlayerCommandPointsSpent,
  getPlayerPrimaryTotal,
  getPlayerSecondaryTotal,
  getPlayerTotalScore,
  getPlayerTurnDurationTotalMs,
  getTurnRecords,
  prepareGamesForStats,
  type TurnRecord
} from "../utils/gameCalculations";
import type { Game, Player } from "../types/game";
import { formatDateLabel, formatDuration } from "../utils/time";

interface StatsPageProps {
  onBack: () => void;
  onCreateGame: () => void;
}

type StatsSectionKey = "overview" | "players" | "armies" | "rounds" | "records" | "matchups";
type ExtendedStatsSectionKey = StatsSectionKey | "missions" | "deployments";
type StatTone = "default" | "score" | "time" | "success" | "warning";

interface MiniBarItem {
  label: string;
  value: number | null;
  display: string;
  max: number;
  tone: StatTone;
}

interface RankedChartItem {
  label: string;
  value: number;
  display: string;
  tone: StatTone;
  detail?: string;
}

interface SplitChartRow {
  label: string;
  primary: number | null;
  secondary: number | null;
  total?: number | null;
}

interface ScatterChartPoint {
  id: string;
  x: number;
  y: number;
  label: string;
  tone: StatTone;
  detail: string;
}

type TableGroupMode = "players" | "armies";
type TableRange = "3m" | "6m" | "12m" | "all";
type OpponentFilter = "all" | `player:${string}` | `army:${string}`;

interface TableRow {
  label: string;
  games: number;
  wins: number;
  losses: number;
  ties: number;
  winRate: number | null;
  averageOwnTurnDurationMs: number | null;
}

interface SingleLineChartRow {
  label: string;
  value: number | null;
  min?: number | null;
  max?: number | null;
}

interface ScenarioSummary {
  label: string;
  leaderName: string;
  leaderWinRate: number | null;
  games: number;
  averageScore: number | null;
  averageSpentCp: number | null;
  averageDurationMs: number | null;
}

const defaultOpenSections: Record<ExtendedStatsSectionKey, boolean> = {
  overview: true,
  players: true,
  armies: false,
  rounds: false,
  records: true,
  matchups: false,
  missions: false,
  deployments: false
};

const getMetricMax = (values: Array<number | null | undefined>, fallback = 1): number =>
  Math.max(...values.map((value) => value ?? 0), fallback);

const CHART_WIDTH = 360;
const CHART_HEIGHT = 170;
const CHART_PADDING = 22;

const buildLinePath = (points: Array<{ x: number; y: number }>): string =>
  points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");

const getToneColor = (tone: StatTone): string => {
  if (tone === "time") {
    return "#34d399";
  }

  if (tone === "success") {
    return "#5eead4";
  }

  if (tone === "warning") {
    return "#f59e0b";
  }

  return "#38bdf8";
};

const MiniBarChart = ({ items }: { items: MiniBarItem[] }) => (
  <div className="stats-mini-bar-list">
    {items.map((item) => {
      const ratio =
        item.value === null || item.max <= 0 ? 0 : Math.max(Math.min((item.value / item.max) * 100, 100), 0);

      return (
        <div key={`${item.label}-${item.display}`} className="stats-mini-bar">
          <div className="stats-mini-bar__meta">
            <span>{item.label}</span>
            <strong>{item.display}</strong>
          </div>
          <div className="stats-mini-bar__track">
            <div
              className={`stats-mini-bar__fill stats-mini-bar__fill--${item.tone}`}
              style={{ width: `${ratio}%` }}
            />
          </div>
        </div>
      );
    })}
  </div>
);

const defaultMetricCardChart = (
  value: number | null | undefined,
  display: string,
  max: number,
  tone: StatTone,
  label = "Trend"
) => (
  <MiniBarChart
    items={[
      {
        label,
        value: value ?? null,
        display,
        max,
        tone
      }
    ]}
  />
);

const RankedBarChart = ({
  title,
  subtitle,
  items,
  emptyLabel,
  activeLabel,
  onActivate
}: {
  title: string;
  subtitle: string;
  items: RankedChartItem[];
  emptyLabel: string;
  activeLabel?: string | null;
  onActivate?: (label: string) => void;
}) => {
  if (!items.length) {
    return (
      <article className="overview-chart-card">
        <div className="overview-chart-card__head">
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
        <p className="muted-copy">{emptyLabel}</p>
      </article>
    );
  }

  const maxValue = Math.max(...items.map((item) => item.value), 1);
  const activeItem = items.find((item) => item.label === activeLabel) ?? items[0];

  return (
    <article className="overview-chart-card">
      <div className="overview-chart-card__head">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      <div className="stats-ranked-list" role="list" aria-label={title}>
        {items.map((item) => {
          const ratio = Math.max(Math.min((item.value / maxValue) * 100, 100), 0);
          const isActive = activeItem?.label === item.label;

          return (
            <button
              key={`${item.label}-${item.display}`}
              type="button"
              className={`stats-ranked-list__row ${isActive ? "is-active" : ""}`}
              onMouseEnter={() => onActivate?.(item.label)}
              onFocus={() => onActivate?.(item.label)}
              onClick={() => onActivate?.(item.label)}
            >
              <span className="stats-ranked-list__label">{item.label}</span>
              <span className="stats-ranked-list__track">
                <span
                  className="stats-ranked-list__fill"
                  style={{ width: `${ratio}%`, background: getToneColor(item.tone) }}
                />
              </span>
              <strong className="stats-ranked-list__value">{item.display}</strong>
            </button>
          );
        })}
      </div>
      {activeItem ? (
        <div className="overview-chart-card__totals">
          <div className="overview-chart-total">
            <span className={`overview-chart-total__marker is-${activeItem.tone}`} />
            <span>{activeItem.display}</span>
            <strong>{activeItem.detail ?? subtitle}</strong>
          </div>
        </div>
      ) : null}
    </article>
  );
};

const AverageMetricCard = ({
  label,
  value,
  details,
  tone
}: {
  label: string;
  value: string;
  details: Array<{ label: string; value: string }>;
  tone: "score" | "time";
}) => (
  <article className={`stats-average-card stats-average-card--${tone}`}>
    <div>
      <span className="stats-average-card__label">{label}</span>
      <strong className="stats-average-card__value">{value}</strong>
    </div>
    <div className="stats-average-card__details">
      {details.map((detail) => (
        <div key={detail.label} className="stats-average-card__detail">
          <span>{detail.label}</span>
          <strong>{detail.value}</strong>
        </div>
      ))}
    </div>
  </article>
);

const TrendLineChart = ({
  title,
  rows,
  primaryLabel,
  secondaryLabel,
  emptyLabel,
  formatValue,
  activeLabel,
  onActivate
}: {
  title: string;
  rows: Array<{ label: string; primary: number | null; secondary: number | null }>;
  primaryLabel: string;
  secondaryLabel: string;
  emptyLabel: string;
  formatValue: (value: number) => string;
  activeLabel?: string | null;
  onActivate?: (label: string) => void;
}) => {
  if (!rows.length) {
    return (
      <article className="overview-chart-card">
        <div className="overview-chart-card__head">
          <strong>{title}</strong>
          <span>0 Werte</span>
        </div>
        <p className="muted-copy">{emptyLabel}</p>
      </article>
    );
  }

  const plotWidth = CHART_WIDTH - CHART_PADDING * 2;
  const plotHeight = CHART_HEIGHT - CHART_PADDING * 2;
  const maxValue = Math.max(...rows.flatMap((row) => [row.primary ?? 0, row.secondary ?? 0]), 1);
  const primaryPoints = rows.map((row, index) => ({
    x: CHART_PADDING + (rows.length === 1 ? plotWidth / 2 : (plotWidth / Math.max(rows.length - 1, 1)) * index),
    y: CHART_HEIGHT - CHART_PADDING - (((row.primary ?? 0) / maxValue) * plotHeight),
    label: row.label,
    value: row.primary ?? 0
  }));
  const secondaryPoints = rows.map((row, index) => ({
    x: CHART_PADDING + (rows.length === 1 ? plotWidth / 2 : (plotWidth / Math.max(rows.length - 1, 1)) * index),
    y: CHART_HEIGHT - CHART_PADDING - (((row.secondary ?? 0) / maxValue) * plotHeight),
    label: row.label,
    value: row.secondary ?? 0
  }));
  const activeRow = rows.find((row) => row.label === activeLabel) ?? rows[rows.length - 1];

  return (
    <article className="overview-chart-card">
      <div className="overview-chart-card__head">
        <strong>{title}</strong>
        <div className="overview-chart-legend">
          <span className="overview-chart-legend__item is-player-1">{primaryLabel}</span>
          <span className="overview-chart-legend__item is-player-2">{secondaryLabel}</span>
        </div>
      </div>
      <svg className="overview-chart" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-label={title}>
        {[0, 0.5, 1].map((ratio) => {
          const y = CHART_HEIGHT - CHART_PADDING - plotHeight * ratio;
          return (
            <line
              key={`guide-${ratio}`}
              x1={CHART_PADDING}
              x2={CHART_WIDTH - CHART_PADDING}
              y1={y}
              y2={y}
              className="overview-chart__guide"
            />
          );
        })}
        <line
          x1={CHART_PADDING}
          x2={CHART_PADDING}
          y1={CHART_PADDING}
          y2={CHART_HEIGHT - CHART_PADDING}
          className="overview-chart__axis"
        />
        <line
          x1={CHART_PADDING}
          x2={CHART_WIDTH - CHART_PADDING}
          y1={CHART_HEIGHT - CHART_PADDING}
          y2={CHART_HEIGHT - CHART_PADDING}
          className="overview-chart__axis"
        />
        <path d={buildLinePath(primaryPoints)} className="overview-chart__line is-player-1" />
        <path d={buildLinePath(secondaryPoints)} className="overview-chart__line is-player-2" />
        {rows.map((row, index) => {
          const isActive = activeRow?.label === row.label;
          return (
            <g
              key={row.label}
              className={isActive ? "overview-chart__point-group is-active" : "overview-chart__point-group"}
              onMouseEnter={() => onActivate?.(row.label)}
              onClick={() => onActivate?.(row.label)}
            >
              <circle cx={primaryPoints[index]?.x ?? 0} cy={primaryPoints[index]?.y ?? 0} r={isActive ? 5 : 4} className="overview-chart__point is-player-1" />
              <circle cx={secondaryPoints[index]?.x ?? 0} cy={secondaryPoints[index]?.y ?? 0} r={isActive ? 5 : 4} className="overview-chart__point is-player-2" />
              <text x={primaryPoints[index]?.x ?? 0} y={CHART_HEIGHT - 4} textAnchor="middle" className="overview-chart__label">
                {row.label}
              </text>
            </g>
          );
        })}
        <text x={CHART_PADDING - 4} y={CHART_PADDING + 4} textAnchor="end" className="overview-chart__scale">
          {formatValue(maxValue)}
        </text>
        <text x={CHART_PADDING - 4} y={CHART_HEIGHT - CHART_PADDING + 4} textAnchor="end" className="overview-chart__scale">
          {formatValue(0)}
        </text>
      </svg>
      {activeRow ? (
        <div className="overview-chart-card__totals">
          <div className="overview-chart-total">
            <span className="overview-chart-total__marker is-player-1" />
            <span>{activeRow.label}</span>
            <strong>{primaryLabel}: {formatValue(activeRow.primary ?? 0)}</strong>
          </div>
          <div className="overview-chart-total">
            <span className="overview-chart-total__marker is-player-2" />
            <span>{secondaryLabel}</span>
            <strong>{formatValue(activeRow.secondary ?? 0)}</strong>
          </div>
        </div>
      ) : null}
    </article>
  );
};

const SplitBarChart = ({
  title,
  rows,
  emptyLabel
}: {
  title: string;
  rows: SplitChartRow[];
  emptyLabel: string;
}) => {
  if (!rows.length) {
    return (
      <article className="overview-chart-card">
        <div className="overview-chart-card__head">
          <strong>{title}</strong>
        </div>
        <p className="muted-copy">{emptyLabel}</p>
      </article>
    );
  }

  const maxValue = getMetricMax(
    rows.flatMap((row) => [row.primary, row.secondary, row.total])
  );

  return (
    <article className="overview-chart-card">
      <div className="overview-chart-card__head">
        <strong>{title}</strong>
        <div className="overview-chart-legend">
          <span className="overview-chart-legend__item is-player-1 is-bar-primary">Primary</span>
          <span className="overview-chart-legend__item is-player-2 is-bar-secondary">Secondary</span>
          <span className="overview-chart-legend__item is-player-1 is-bar-total">Gesamt</span>
        </div>
      </div>
      <div className="stats-split-list">
        {rows.map((row) => (
          <div key={row.label} className="stats-split-list__row">
            <div className="stats-split-list__meta">
              <strong>{row.label}</strong>
              {row.total !== undefined ? <span>{(row.total ?? 0).toFixed(1)} ges</span> : null}
            </div>
            <div className="stats-split-list__bars">
              <span className="stats-split-list__track">
                <span className="stats-split-list__fill is-primary" style={{ width: `${(((row.primary ?? 0) / maxValue) * 100).toFixed(2)}%` }} />
              </span>
              <span className="stats-split-list__track">
                <span className="stats-split-list__fill is-secondary" style={{ width: `${(((row.secondary ?? 0) / maxValue) * 100).toFixed(2)}%` }} />
              </span>
              {row.total !== undefined ? (
                <span className="stats-split-list__track">
                  <span className="stats-split-list__fill is-total" style={{ width: `${(((row.total ?? 0) / maxValue) * 100).toFixed(2)}%` }} />
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </article>
  );
};

const SingleLineChart = ({
  title,
  rows,
  emptyLabel,
  formatValue
}: {
  title: string;
  rows: SingleLineChartRow[];
  emptyLabel: string;
  formatValue: (value: number) => string;
}) => {
  const visibleRows = rows.filter((row) => row.value !== null);
  if (!visibleRows.length) {
    return (
      <article className="overview-chart-card">
        <div className="overview-chart-card__head">
          <strong>{title}</strong>
          <span>0 Werte</span>
        </div>
        <p className="muted-copy">{emptyLabel}</p>
      </article>
    );
  }

  const plotWidth = CHART_WIDTH - CHART_PADDING * 2;
  const plotHeight = CHART_HEIGHT - CHART_PADDING * 2;
  const allValues = visibleRows.flatMap((row) => [row.value ?? 0, row.min ?? row.value ?? 0, row.max ?? row.value ?? 0]);
  const maxValue = Math.max(...allValues, 1);
  const points = visibleRows.map((row, index) => ({
    x: CHART_PADDING + (visibleRows.length === 1 ? plotWidth / 2 : (plotWidth / Math.max(visibleRows.length - 1, 1)) * index),
    y: CHART_HEIGHT - CHART_PADDING - (((row.value ?? 0) / maxValue) * plotHeight),
    row
  }));
  const activeRow = visibleRows[visibleRows.length - 1];

  return (
    <article className="overview-chart-card">
      <div className="overview-chart-card__head">
        <strong>{title}</strong>
        <span>{visibleRows.length} Werte</span>
      </div>
      <svg className="overview-chart" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-label={title}>
        {[0, 0.5, 1].map((ratio) => {
          const y = CHART_HEIGHT - CHART_PADDING - plotHeight * ratio;
          return <line key={ratio} x1={CHART_PADDING} x2={CHART_WIDTH - CHART_PADDING} y1={y} y2={y} className="overview-chart__guide" />;
        })}
        <line x1={CHART_PADDING} x2={CHART_PADDING} y1={CHART_PADDING} y2={CHART_HEIGHT - CHART_PADDING} className="overview-chart__axis" />
        <line x1={CHART_PADDING} x2={CHART_WIDTH - CHART_PADDING} y1={CHART_HEIGHT - CHART_PADDING} y2={CHART_HEIGHT - CHART_PADDING} className="overview-chart__axis" />
        <path d={buildLinePath(points)} className="overview-chart__line is-player-1" />
        {points.map((point, index) => (
          <g key={`${point.row.label}-${index}`}>
            <circle cx={point.x} cy={point.y} r={4} className="overview-chart__point is-player-1" />
            <text x={point.x} y={CHART_HEIGHT - 4} textAnchor="middle" className="overview-chart__label">
              {point.row.label}
            </text>
          </g>
        ))}
        <text x={CHART_PADDING - 4} y={CHART_PADDING + 4} textAnchor="end" className="overview-chart__scale">
          {formatValue(maxValue)}
        </text>
        <text x={CHART_PADDING - 4} y={CHART_HEIGHT - CHART_PADDING + 4} textAnchor="end" className="overview-chart__scale">
          {formatValue(0)}
        </text>
      </svg>
      {activeRow ? (
        <div className="overview-chart-card__totals">
          <div className="overview-chart-total">
            <span className="overview-chart-total__marker is-player-1" />
            <span>{activeRow.label}</span>
            <strong>
              {formatValue(activeRow.value ?? 0)}
              {activeRow.min !== undefined || activeRow.max !== undefined
                ? ` | Min ${formatValue(activeRow.min ?? 0)} | Max ${formatValue(activeRow.max ?? 0)}`
                : ""}
            </strong>
          </div>
        </div>
      ) : null}
    </article>
  );
};

const ScatterChart = ({
  title,
  points,
  emptyLabel,
  activePointId,
  onActivate
}: {
  title: string;
  points: ScatterChartPoint[];
  emptyLabel: string;
  activePointId?: string | null;
  onActivate?: (id: string) => void;
}) => {
  if (!points.length) {
    return (
      <article className="overview-chart-card">
        <div className="overview-chart-card__head">
          <strong>{title}</strong>
        </div>
        <p className="muted-copy">{emptyLabel}</p>
      </article>
    );
  }

  const maxX = Math.max(...points.map((point) => point.x), 1);
  const maxY = Math.max(...points.map((point) => point.y), 1);
  const plotWidth = CHART_WIDTH - CHART_PADDING * 2;
  const plotHeight = CHART_HEIGHT - CHART_PADDING * 2;
  const activePoint = points.find((point) => point.id === activePointId) ?? points[0];

  return (
    <article className="overview-chart-card">
      <div className="overview-chart-card__head">
        <strong>{title}</strong>
        <span>CP spent vs Gesamtpunkte</span>
      </div>
      <svg className="overview-chart" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-label={title}>
        <line x1={CHART_PADDING} x2={CHART_PADDING} y1={CHART_PADDING} y2={CHART_HEIGHT - CHART_PADDING} className="overview-chart__axis" />
        <line x1={CHART_PADDING} x2={CHART_WIDTH - CHART_PADDING} y1={CHART_HEIGHT - CHART_PADDING} y2={CHART_HEIGHT - CHART_PADDING} className="overview-chart__axis" />
        {points.map((point) => {
          const x = CHART_PADDING + (point.x / maxX) * plotWidth;
          const y = CHART_HEIGHT - CHART_PADDING - (point.y / maxY) * plotHeight;
          const isActive = activePoint?.id === point.id;

          return (
            <circle
              key={point.id}
              cx={x}
              cy={y}
              r={isActive ? 6 : 4.5}
              className={`overview-chart__point overview-chart__point--scatter is-${point.tone} ${isActive ? "is-active" : ""}`.trim()}
              onMouseEnter={() => onActivate?.(point.id)}
              onClick={() => onActivate?.(point.id)}
            />
          );
        })}
        <text x={CHART_PADDING - 4} y={CHART_PADDING + 4} textAnchor="end" className="overview-chart__scale">
          {maxY}
        </text>
        <text x={CHART_WIDTH - CHART_PADDING} y={CHART_HEIGHT - 6} textAnchor="end" className="overview-chart__scale">
          {maxX} CP
        </text>
      </svg>
      {activePoint ? (
        <div className="overview-chart-card__totals">
          <div className="overview-chart-total">
            <span className={`overview-chart-total__marker is-${activePoint.tone}`} />
            <span>{activePoint.label}</span>
            <strong>{activePoint.detail}</strong>
          </div>
        </div>
      ) : null}
    </article>
  );
};

const renderTurnRecordCard = (
  record: TurnRecord | null,
  label: string,
  accentClassName = ""
) => {
  if (!record) {
    return null;
  }

  return (
    <article className={`record-card ${accentClassName}`.trim()}>
      <span className="record-card__label">{label}</span>
      <strong className="record-card__value">
        {label === "Punktreichster Zug" ? `${record.totalScore} Punkte` : formatDuration(record.durationMs)}
      </strong>
      <p>
        {record.playerName} | {record.armyName}
      </p>
      <p>{formatDateLabel(record.scheduledDate, record.scheduledTime)}</p>
      <p>
        R{record.roundNumber} / Z{record.turnNumber}
      </p>
      <p className="record-card__scoreline">
        Punkte im Zug: {record.totalScore} | Primary: {record.primaryScore} | Secondary: {record.secondaryScore}
      </p>
    </article>
  );
};

const getGroupLabel = (player: Player, mode: TableGroupMode): string =>
  mode === "players" ? player.name : player.army.name;

const getPlayerResult = (game: Game, playerId: string): "win" | "loss" | "tie" | null => {
  const playerScore = getPlayerTotalScore(game, playerId);
  const opponent = game.players.find((player) => player.id !== playerId);
  if (!opponent) {
    return null;
  }

  const opponentScore = getPlayerTotalScore(game, opponent.id);
  if (playerScore > opponentScore) {
    return "win";
  }
  if (playerScore < opponentScore) {
    return "loss";
  }
  return "tie";
};

const matchesOpponentFilter = (game: Game, player: Player, filter: OpponentFilter): boolean => {
  if (filter === "all") {
    return true;
  }

  const opponent = game.players.find((entry) => entry.id !== player.id);
  if (!opponent) {
    return false;
  }

  return filter.startsWith("player:")
    ? opponent.name === filter.replace("player:", "")
    : opponent.army.name === filter.replace("army:", "");
};

const createTableRows = (
  games: Game[],
  mode: TableGroupMode,
  opponentFilter: OpponentFilter
): TableRow[] => {
  const grouped = new Map<string, { games: number; wins: number; losses: number; ties: number; durations: number[] }>();

  games.forEach((game) => {
    game.players.forEach((player) => {
      if (!matchesOpponentFilter(game, player, opponentFilter)) {
        return;
      }

      const label = getGroupLabel(player, mode);
      const result = getPlayerResult(game, player.id);
      const row = grouped.get(label) ?? { games: 0, wins: 0, losses: 0, ties: 0, durations: [] };
      row.games += 1;
      row.wins += result === "win" ? 1 : 0;
      row.losses += result === "loss" ? 1 : 0;
      row.ties += result === "tie" ? 1 : 0;
      if (game.scoreDetailLevel === "full") {
        const duration = getPlayerTurnDurationTotalMs(game, player.id);
        if (duration > 0) {
          row.durations.push(duration);
        }
      }
      grouped.set(label, row);
    });
  });

  return Array.from(grouped.entries())
    .map(([label, row]) => ({
      label,
      games: row.games,
      wins: row.wins,
      losses: row.losses,
      ties: row.ties,
      winRate: row.games ? (row.wins / row.games) * 100 : null,
      averageOwnTurnDurationMs: row.durations.length
        ? row.durations.reduce((total, value) => total + value, 0) / row.durations.length
        : null
    }))
    .sort((left, right) => (right.winRate ?? 0) - (left.winRate ?? 0) || right.games - left.games || left.label.localeCompare(right.label));
};

const createWinRateTrendRows = (
  games: Game[],
  mode: TableGroupMode,
  groupLabel: string | null,
  opponentFilter: OpponentFilter,
  range: TableRange
): SingleLineChartRow[] => {
  const now = new Date();
  const months = range === "3m" ? 3 : range === "6m" ? 6 : range === "12m" ? 12 : null;
  const cutoff = months === null ? null : new Date(now.getFullYear(), now.getMonth() - months, now.getDate());
  let wins = 0;
  let gamesCount = 0;

  return [...games]
    .filter((game) => !cutoff || new Date(`${game.scheduledDate || game.createdAt.slice(0, 10)}T00:00:00`) >= cutoff)
    .sort((left, right) => `${left.scheduledDate}${left.scheduledTime}`.localeCompare(`${right.scheduledDate}${right.scheduledTime}`))
    .flatMap((game) =>
      game.players
        .filter((player) => !groupLabel || getGroupLabel(player, mode) === groupLabel)
        .filter((player) => matchesOpponentFilter(game, player, opponentFilter))
        .map((player) => ({ game, player }))
    )
    .map(({ game, player }) => {
      const result = getPlayerResult(game, player.id);
      gamesCount += 1;
      wins += result === "win" ? 1 : 0;
      return {
        label: game.scheduledDate ? game.scheduledDate.slice(5) : String(gamesCount),
        value: gamesCount ? (wins / gamesCount) * 100 : null
      };
    });
};

const createScenarioSummaries = (
  games: Game[],
  scenarioSelector: (game: Game) => string
): ScenarioSummary[] => {
  const grouped = new Map<
    string,
    {
      games: number;
      scores: number[];
      spentCp: number[];
      durations: number[];
      players: Map<string, { wins: number; games: number }>;
    }
  >();

  games.forEach((game) => {
    const label = scenarioSelector(game).trim();
    if (!label) {
      return;
    }

    const entry = grouped.get(label) ?? {
      games: 0,
      scores: [],
      spentCp: [],
      durations: [],
      players: new Map<string, { wins: number; games: number }>()
    };
    entry.games += 1;

    game.players.forEach((player) => {
      entry.scores.push(getPlayerTotalScore(game, player.id));
      entry.spentCp.push(getPlayerCommandPointsSpent(game, player.id));
      const playerStats = entry.players.get(player.name) ?? { wins: 0, games: 0 };
      const result = getPlayerResult(game, player.id);
      entry.players.set(player.name, {
        wins: playerStats.wins + (result === "win" ? 1 : 0),
        games: playerStats.games + 1
      });
    });

    if (game.scoreDetailLevel === "full") {
      const duration = game.rounds.reduce((total, round) => {
        const roundDuration = getCompletedRoundDurationMs(round, game);
        return total + (roundDuration ?? 0);
      }, 0);
      if (duration > 0) {
        entry.durations.push(duration);
      }
    }

    grouped.set(label, entry);
  });

  return Array.from(grouped.entries())
    .map(([label, entry]) => {
      const leader = Array.from(entry.players.entries())
        .map(([playerName, playerStats]) => ({
          playerName,
          games: playerStats.games,
          winRate: playerStats.games ? (playerStats.wins / playerStats.games) * 100 : null
        }))
        .sort((left, right) => (right.winRate ?? 0) - (left.winRate ?? 0) || right.games - left.games || left.playerName.localeCompare(right.playerName))[0];

      return {
        label,
        leaderName: leader?.playerName ?? "-",
        leaderWinRate: leader?.winRate ?? null,
        games: entry.games,
        averageScore: entry.scores.length ? entry.scores.reduce((total, value) => total + value, 0) / entry.scores.length : null,
        averageSpentCp: entry.spentCp.length ? entry.spentCp.reduce((total, value) => total + value, 0) / entry.spentCp.length : null,
        averageDurationMs: entry.durations.length ? entry.durations.reduce((total, value) => total + value, 0) / entry.durations.length : null
      };
    })
    .sort((left, right) => right.games - left.games || left.label.localeCompare(right.label));
};

export const StatsPage = ({ onBack, onCreateGame }: StatsPageProps) => {
  const { games, isLoading, errorMessage, clearError } = useGameStore();
  const [filters, setFilters] = useState(createInitialGameFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openSections, setOpenSections] = useState(defaultOpenSections);
  const [gamePickerOpen, setGamePickerOpen] = useState(false);
  const [playerChartMode, setPlayerChartMode] = useState<"winRate" | "score" | "duration">("winRate");
  const [armyChartMode, setArmyChartMode] = useState<"usage" | "winRate" | "score">("winRate");
  const [topCount, setTopCount] = useState(5);
  const [activePlayerChartLabel, setActivePlayerChartLabel] = useState<string | null>(null);
  const [activeArmyChartLabel, setActiveArmyChartLabel] = useState<string | null>(null);
  const [activeDurationRoundLabel, setActiveDurationRoundLabel] = useState<string | null>(null);
  const [activeScoreRoundLabel, setActiveScoreRoundLabel] = useState<string | null>(null);
  const [activeCpPointId, setActiveCpPointId] = useState<string | null>(null);
  const [tableGroupMode, setTableGroupMode] = useState<TableGroupMode>("players");
  const [selectedTableOpponent, setSelectedTableOpponent] = useState<OpponentFilter>("all");
  const [selectedTableRow, setSelectedTableRow] = useState<string | null>(null);
  const [tableRange, setTableRange] = useState<TableRange>("all");
  const [playerDetailFilters, setPlayerDetailFilters] = useState<Record<string, OpponentFilter>>({});
  const [openPlayerCards, setOpenPlayerCards] = useState<Record<string, boolean>>({});
  const filteredSourceGames = useMemo(() => filterGames(games, filters), [games, filters]);
  const filteredGames = useMemo(
    () => prepareGamesForStats(filteredSourceGames),
    [filteredSourceGames]
  );
  const filteredStatsSourceGames = useMemo(() => {
    const statsGameIds = new Set(filteredGames.map((game) => game.id));
    return filteredSourceGames.filter((game) => statsGameIds.has(game.id));
  }, [filteredGames, filteredSourceGames]);
  const filterOptions = useMemo(() => getFilterOptions(games), [games]);
  const overview = useMemo(
    () => createStatsOverview(filteredGames, filteredStatsSourceGames),
    [filteredGames, filteredStatsSourceGames]
  );
  const playerAggregates = useMemo(
    () => createPlayerAggregates(filteredGames, filteredStatsSourceGames),
    [filteredGames, filteredStatsSourceGames]
  );
  const armyAggregates = useMemo(
    () => createArmyAggregates(filteredGames, filteredStatsSourceGames),
    [filteredGames, filteredStatsSourceGames]
  );
  const missionLeaders = useMemo(() => createMissionLeaders(filteredGames), [filteredGames]);
  const deploymentLeaders = useMemo(() => createDeploymentLeaders(filteredGames), [filteredGames]);
  const missionSummaries = useMemo(
    () => createScenarioSummaries(filteredGames, (game) => game.primaryMission),
    [filteredGames]
  );
  const deploymentSummaries = useMemo(
    () => createScenarioSummaries(filteredGames, (game) => game.deployment),
    [filteredGames]
  );
  const deploymentPerformance = useMemo(
    () => createScenarioPerformanceAggregates(filteredGames, (game) => game.deployment, filteredStatsSourceGames),
    [filteredGames, filteredStatsSourceGames]
  );
  const matchupAggregates = useMemo(
    () => createMatchupAggregates(filteredGames, filteredStatsSourceGames),
    [filteredGames, filteredStatsSourceGames]
  );
  const roundDurationAggregates = useMemo(() => createRoundDurationAggregates(filteredGames), [filteredGames]);
  const roundScoreAggregates = useMemo(() => createRoundScoreAggregates(filteredGames), [filteredGames]);
  const playerTurnDurationAggregates = useMemo(
    () => createPlayerTurnDurationAggregates(filteredGames),
    [filteredGames]
  );
  const cpScorePoints = useMemo(() => createCpScoreCorrelationPoints(filteredGames), [filteredGames]);
  const turnRecords = useMemo(() => getTurnRecords(filteredGames), [filteredGames]);
  const tableRows = useMemo(
    () => createTableRows(filteredGames, tableGroupMode, selectedTableOpponent),
    [filteredGames, selectedTableOpponent, tableGroupMode]
  );
  const tableTrendRows = useMemo(
    () => createWinRateTrendRows(filteredGames, tableGroupMode, selectedTableRow, selectedTableOpponent, tableRange),
    [filteredGames, selectedTableOpponent, selectedTableRow, tableGroupMode, tableRange]
  );
  const tableOpponentOptions = useMemo(
    () => [
      { value: "all" as OpponentFilter, label: "Alle Gegner" },
      ...filterOptions.playerNames.map((name) => ({ value: `player:${name}` as OpponentFilter, label: `vs ${name}` })),
      ...filterOptions.armyNames.map((name) => ({ value: `army:${name}` as OpponentFilter, label: `vs ${name}` }))
    ],
    [filterOptions.armyNames, filterOptions.playerNames]
  );
  const pointOptions = filterOptions.gamePoints;

  const overviewGamesMax = getMetricMax([overview.games, overview.players, overview.armies]);
  const playerPrimaryMax = getMetricMax(playerAggregates.map((player) => player.averagePrimary));
  const playerSecondaryMax = getMetricMax(playerAggregates.map((player) => player.averageSecondary));
  const playerTotalMax = getMetricMax(playerAggregates.map((player) => player.averageTotal));
  const playerDurationMax = getMetricMax(playerAggregates.map((player) => player.averageDurationMs));
  const playerCpMax = getMetricMax(playerAggregates.map((player) => player.averageSpentCp));
  const armyPrimaryMax = getMetricMax(armyAggregates.map((army) => army.averagePrimary));
  const armySecondaryMax = getMetricMax(armyAggregates.map((army) => army.averageSecondary));
  const armyTotalMax = getMetricMax(armyAggregates.map((army) => army.averageTotal));
  const missionGamesMax = getMetricMax(missionLeaders.map((mission) => mission.games));
  const deploymentGamesMax = getMetricMax(deploymentLeaders.map((deployment) => deployment.games));
  const matchupDurationMax = getMetricMax(matchupAggregates.map((matchup) => matchup.averageDurationMs));
  const matchupScoreMax = getMetricMax(matchupAggregates.map((matchup) => matchup.averageCombinedScore));
  const matchupDiffMax = getMetricMax(matchupAggregates.map((matchup) => matchup.averageScoreDifference));
  const roundDurationMax = getMetricMax(
    roundDurationAggregates.flatMap((round) => [round.averageDurationMs, round.maxDurationMs])
  );
  const roundScoreMax = getMetricMax(
    roundScoreAggregates.flatMap((round) => [
      round.averagePlayerOneScore,
      round.averagePlayerTwoScore,
      round.averageCombinedScore
    ])
  );
  const deploymentScoreMax = getMetricMax(
    deploymentPerformance.flatMap((item) => [item.averageCombinedScore, item.averageDurationMs, item.leaderWinRate])
  );
  const playerTurnDurationMax = getMetricMax(
    playerTurnDurationAggregates.flatMap((item) => [item.averageTurnDurationMs, item.longestTurnMs])
  );

  const formatMetric = (value: number | null, digits = 1) =>
    value === null ? "-" : value.toFixed(digits);

  const formatPercent = (value: number | null) =>
    value === null ? "-" : `${value.toFixed(0)}%`;

  const formatDurationMetric = (value: number | null) =>
    value === null ? "-" : formatDuration(value);
  const formatRecord = (wins: number, losses: number, ties: number) =>
    `W/L/D ${wins}/${losses}/${ties}`;
  const formatGamesAndDuration = (games: number, durationMs: number | null) =>
    `${games} ${games === 1 ? "Spiel" : "Spiele"} | Dauer ${formatDurationMetric(durationMs)}`;

  const playerChartItems = useMemo(() => {
    if (playerChartMode === "duration") {
      return playerAggregates
        .filter((player) => player.games > 0 && player.averageDurationMs !== null)
        .sort(
          (left, right) => (left.averageDurationMs ?? 0) - (right.averageDurationMs ?? 0) || right.games - left.games
        )
        .slice(0, topCount)
        .map((player) => ({
          label: player.name,
          value: player.averageDurationMs ?? 0,
          display: formatDurationMetric(player.averageDurationMs),
          tone: "time" as const,
          detail: formatGamesAndDuration(player.games, player.averageDurationMs)
        }));
    }

    if (playerChartMode === "score") {
      return playerAggregates
        .filter((player) => player.games > 0 && player.averageTotal !== null)
        .sort((left, right) => (right.averageTotal ?? 0) - (left.averageTotal ?? 0) || right.games - left.games)
        .slice(0, topCount)
        .map((player) => ({
          label: player.name,
          value: player.averageTotal ?? 0,
          display: formatMetric(player.averageTotal),
          tone: "score" as const,
          detail: `Prim ${formatMetric(player.averagePrimary)} | Sek ${formatMetric(player.averageSecondary)} | ${formatGamesAndDuration(
            player.games,
            player.averageDurationMs
          )}`
        }));
    }

    return playerAggregates
      .filter((player) => player.games > 0 && player.winRate !== null)
      .sort((left, right) => (right.winRate ?? 0) - (left.winRate ?? 0) || right.games - left.games)
      .slice(0, topCount)
      .map((player) => ({
        label: player.name,
        value: player.winRate ?? 0,
        display: formatPercent(player.winRate),
        tone: "success" as const,
        detail: `${formatRecord(player.wins, player.losses, player.ties)} | ${formatGamesAndDuration(
          player.games,
          player.averageDurationMs
        )}`
      }));
  }, [formatDurationMetric, playerAggregates, playerChartMode, topCount]);

  const armyChartItems = useMemo(() => {
    if (armyChartMode === "score") {
      return armyAggregates
        .filter((army) => army.games > 0 && army.averageTotal !== null)
        .sort((left, right) => (right.averageTotal ?? 0) - (left.averageTotal ?? 0) || right.games - left.games)
        .slice(0, topCount)
        .map((army) => ({
          label: army.armyName,
          value: army.averageTotal ?? 0,
          display: formatMetric(army.averageTotal),
          tone: "score" as const,
          detail: `Prim ${formatMetric(army.averagePrimary)} | Sek ${formatMetric(army.averageSecondary)} | ${formatGamesAndDuration(
            army.games,
            army.averageDurationMs
          )}`
        }));
    }

    if (armyChartMode === "winRate") {
      return armyAggregates
        .filter((army) => army.games > 0 && army.winRate !== null)
        .sort((left, right) => (right.winRate ?? 0) - (left.winRate ?? 0) || right.games - left.games)
        .slice(0, topCount)
        .map((army) => ({
          label: army.armyName,
          value: army.winRate ?? 0,
          display: formatPercent(army.winRate),
          tone: "success" as const,
          detail: `${formatRecord(army.wins, army.losses, army.ties)} | ${formatGamesAndDuration(
            army.games,
            army.averageDurationMs
          )}`
        }));
    }

    return armyAggregates
      .filter((army) => army.games > 0)
      .sort((left, right) => right.games - left.games || left.armyName.localeCompare(right.armyName))
      .slice(0, topCount)
      .map((army) => ({
        label: army.armyName,
        value: army.games,
        display: String(army.games),
        tone: "warning" as const,
        detail: `Winrate ${formatPercent(army.winRate)} | ${formatGamesAndDuration(army.games, army.averageDurationMs)}`
      }));
  }, [armyAggregates, armyChartMode, topCount]);

  const roundDurationRows = roundDurationAggregates.map((round) => ({
    label: `R${round.roundNumber}`,
    primary: round.averageDurationMs,
    secondary: round.maxDurationMs
  }));
  const roundDurationSingleRows: SingleLineChartRow[] = roundDurationAggregates.map((round) => {
    const durations = filteredGames.flatMap((game) =>
      game.rounds
        .filter((entry) => entry.roundNumber === round.roundNumber)
        .map((entry) => getCompletedRoundDurationMs(entry, game))
        .filter((value): value is number => value !== null)
    );
    return {
      label: `R${round.roundNumber}`,
      value: round.averageDurationMs,
      min: durations.length ? Math.min(...durations) : null,
      max: round.maxDurationMs
    };
  });
  const roundScoreRows = roundScoreAggregates.map((round) => {
    const playerScores = filteredGames.flatMap((game) =>
      game.rounds.some((entry) => entry.roundNumber === round.roundNumber)
        ? game.players.map((player) => getPlayerPrimaryTotal(game, player.id) + getPlayerSecondaryTotal(game, player.id))
        : []
    );
    return {
      label: `R${round.roundNumber}`,
      value: playerScores.length ? playerScores.reduce((total, score) => total + score, 0) / playerScores.length : null,
      min: playerScores.length ? Math.min(...playerScores) : null,
      max: playerScores.length ? Math.max(...playerScores) : null
    };
  });
  const playerSplitRows = playerAggregates
    .filter((player) => player.games > 0)
    .map((player) => ({
      label: player.name,
      primary: player.averagePrimary,
      secondary: player.averageSecondary,
      total: player.averageTotal
    }));
  const playerTurnDurationItems = playerTurnDurationAggregates
    .filter((player) => player.averageTurnDurationMs !== null)
    .sort((left, right) => (left.averageTurnDurationMs ?? 0) - (right.averageTurnDurationMs ?? 0) || left.playerName.localeCompare(right.playerName))
    .slice(0, topCount)
    .map((player) => ({
      label: player.playerName,
      value: player.averageTurnDurationMs ?? 0,
      display: formatDurationMetric(player.averageTurnDurationMs),
      tone: "time" as const,
      detail: `${player.turns} Zuege | Max ${formatDurationMetric(player.longestTurnMs)}`
    }));
  const deploymentWinRateItems = deploymentPerformance
    .filter((item) => item.leaderWinRate !== null)
    .slice(0, topCount)
    .map((item) => ({
      label: item.label,
      value: item.leaderWinRate ?? 0,
      display: formatPercent(item.leaderWinRate),
      tone: "success" as const,
      detail: `${item.games} Spiele | Leader ${item.leaderName}`
    }));
  const cpScatterPoints = cpScorePoints.map((point) => ({
    id: `${point.gameId}:${point.playerName}:${point.cpSpent}:${point.totalScore}`,
    x: point.cpSpent,
    y: point.totalScore,
    label: point.playerName,
    tone: (point.primaryScore !== null && point.secondaryScore !== null ? "score" : "warning") as StatTone,
    detail: `${point.cpSpent} CP | ${point.totalScore} Punkte | ${formatDateLabel(point.scheduledDate, point.scheduledTime)}`
  }));
  const matchupDurationTrendRows: SingleLineChartRow[] = filteredGames
    .map((game, index) => {
      const duration = game.rounds.reduce((total, round) => total + (getCompletedRoundDurationMs(round, game) ?? 0), 0);
      return {
        label: game.scheduledDate ? game.scheduledDate.slice(5) : String(index + 1),
        value: duration > 0 ? duration : null
      };
    });
  const matchupScoreTrendRows: SingleLineChartRow[] = filteredGames.map((game, index) => ({
    label: game.scheduledDate ? game.scheduledDate.slice(5) : String(index + 1),
    value: game.players.reduce((total, player) => total + getPlayerTotalScore(game, player.id), 0)
  }));
  const roundDurationTrendRows: SingleLineChartRow[] = filteredGames.map((game, index) => ({
    label: game.scheduledDate ? game.scheduledDate.slice(5) : String(index + 1),
    value: game.rounds.length
      ? game.rounds.reduce((total, round) => total + (getCompletedRoundDurationMs(round, game) ?? 0), 0) / game.rounds.length
      : null
  }));

  const updateFilter = <K extends keyof typeof filters,>(key: K, value: (typeof filters)[K]) => {
    setFilters((current) => ({
      ...current,
      [key]: value
    }));
  };

  const toggleSection = (section: ExtendedStatsSectionKey) => {
    setOpenSections((current) => ({
      ...current,
      [section]: !current[section]
    }));
  };

  return (
    <Layout
      title="Statistik"
      actions={
        <FloatingMenu
          fixed
          ariaLabel="Hauptmenue"
          sections={[
            {
              label: "Navigation",
              items: [
                { label: "Main", onClick: onBack },
                { label: "Neues Spiel", onClick: onCreateGame },
                { label: "Statistik", onClick: () => window.location.hash = "/stats" }
              ]
            },
            {
              label: "Optionen",
              items: [
                {
                  label: filtersOpen ? "Filter schliessen" : "Filter",
                  onClick: () => setFiltersOpen((current) => !current)
                }
              ]
            }
          ]}
        />
      }
    >
      <section className="stack">
        {errorMessage ? (
          <article className="notice-card notice-card--error">
            <div className="stack">
              <div>
                <h2>Statistik nicht verfuegbar</h2>
                <p>{errorMessage}</p>
              </div>
              <button type="button" className="ghost-button" onClick={clearError}>
                Meldung ausblenden
              </button>
            </div>
          </article>
        ) : null}

        {filtersOpen ? (
          <section className="card stack">
            <div className="button-row button-row--compact">
              <button
                type="button"
                className="ghost-button compact-button"
                onClick={() => setFilters(createInitialGameFilters())}
              >
                Reset
              </button>
            </div>
            <label className="field">
              <span>Suche</span>
              <input
                value={filters.query}
                onChange={(event) => updateFilter("query", event.target.value)}
                placeholder="Name, Armee, Punkte"
              />
            </label>
            <div className="two-column-grid">
              <label className="field">
                <span>Status</span>
                <select
                  value={filters.status}
                  onChange={(event) =>
                    updateFilter("status", event.target.value as typeof filters.status)
                  }
                >
                  <option value="all">Alle</option>
                  <option value="active">Aktiv</option>
                  <option value="completed">Abgeschlossen</option>
                </select>
              </label>
              <label className="field">
                <span>Spieler</span>
                <select
                  value={filters.playerName}
                  onChange={(event) => updateFilter("playerName", event.target.value)}
                >
                  <option value="all">Alle</option>
                  {filterOptions.playerNames.map((playerName) => (
                    <option key={playerName} value={playerName}>
                      {playerName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Armee</span>
                <select
                  value={filters.armyName}
                  onChange={(event) => updateFilter("armyName", event.target.value)}
                >
                  <option value="all">Alle</option>
                  {filterOptions.armyNames.map((armyName) => (
                    <option key={armyName} value={armyName}>
                      {armyName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Punkte von</span>
                <select
                  value={filters.pointsFrom}
                  onChange={(event) => updateFilter("pointsFrom", event.target.value)}
                >
                  <option value="all">Alle</option>
                  {pointOptions.map((points) => (
                    <option key={points} value={points}>
                      {points}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Punkte bis</span>
                <select
                  value={filters.pointsTo}
                  onChange={(event) => updateFilter("pointsTo", event.target.value)}
                >
                  <option value="all">Alle</option>
                  {pointOptions.map((points) => (
                    <option key={points} value={points}>
                      {points}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Von</span>
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(event) => updateFilter("dateFrom", event.target.value)}
                />
              </label>
              <label className="field">
                <span>Bis</span>
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={(event) => updateFilter("dateTo", event.target.value)}
                />
              </label>
            </div>
          </section>
        ) : null}

        {isLoading && !filteredGames.length ? (
          <article className="empty-state">
            <h2>Statistik wird geladen</h2>
            <p>Lokale Daten und Supabase werden abgeglichen.</p>
          </article>
        ) : filteredGames.length ? (
          <>
            <section className="stats-hero">
              <article className="stats-hero__feature stats-hero__feature--table">
                <div className="stats-table-card__head">
                  <div>
                    <span>Tabelle</span>
                    <p>{selectedTableRow ? `Auswahl: ${selectedTableRow}` : `${tableRows.length} Eintraege`}</p>
                  </div>
                  <div className="stats-toolbar__group">
                    <button
                      type="button"
                      className={`chip-button ${tableGroupMode === "armies" ? "is-selected" : ""}`}
                      onClick={() => {
                        setTableGroupMode("armies");
                        setSelectedTableRow(null);
                      }}
                    >
                      Armeen
                    </button>
                    <button
                      type="button"
                      className={`chip-button ${tableGroupMode === "players" ? "is-selected" : ""}`}
                      onClick={() => {
                        setTableGroupMode("players");
                        setSelectedTableRow(null);
                      }}
                    >
                      Spieler
                    </button>
                  </div>
                </div>
                <label className="field stats-table-filter">
                  <span>Gegnerfilter</span>
                  <select value={selectedTableOpponent} onChange={(event) => setSelectedTableOpponent(event.target.value as OpponentFilter)}>
                    {tableOpponentOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="stats-table" role="table" aria-label="Tabelle">
                  <div className="stats-table__row stats-table__row--head" role="row">
                    <span>Name</span>
                    <span>Win%</span>
                    <span>W/L/D</span>
                    <span>Spiele</span>
                    <span>Eigene Zuege</span>
                  </div>
                  {tableRows.map((row) => (
                    <button
                      key={row.label}
                      type="button"
                      className={`stats-table__row ${selectedTableRow === row.label ? "is-active" : ""}`}
                      onClick={() => setSelectedTableRow((current) => (current === row.label ? null : row.label))}
                    >
                      <span>{row.label}</span>
                      <strong>{formatPercent(row.winRate)}</strong>
                      <span>{row.wins}/{row.losses}/{row.ties}</span>
                      <span>{row.games}</span>
                      <span>{formatDurationMetric(row.averageOwnTurnDurationMs)}</span>
                    </button>
                  ))}
                </div>
                <div className="button-row button-row--compact stats-toolbar">
                  {(["3m", "6m", "12m", "all"] as const).map((range) => (
                    <button
                      key={range}
                      type="button"
                      className={`chip-button ${tableRange === range ? "is-selected" : ""}`}
                      onClick={() => setTableRange(range)}
                    >
                      {range === "all" ? "Alles" : range === "3m" ? "3 Monate" : range === "6m" ? "6 Monate" : "12 Monate"}
                    </button>
                  ))}
                </div>
                <SingleLineChart
                  title="Win%-Entwicklung"
                  rows={tableTrendRows}
                  emptyLabel="Noch keine Entwicklung vorhanden."
                  formatValue={(value) => `${value.toFixed(0)}%`}
                />
              </article>
              <AverageMetricCard
                label="Avg Dauer"
                value={formatDurationMetric(overview.averageDurationMs)}
                tone="time"
                details={[
                  { label: "Avg Spieler", value: formatDurationMetric(overview.averagePlayerDurationMs) },
                  { label: "Runden", value: formatMetric(overview.averageRounds) },
                  { label: "CP spent", value: formatMetric(overview.averageSpentCp) },
                  { label: "Spiele", value: String(overview.averageDurationGameCount) }
                ]}
              />
              <AverageMetricCard
                label="Avg Score"
                value={formatMetric(overview.averageCombinedScore)}
                tone="score"
                details={[
                  { label: "Avg Spieler", value: formatMetric(overview.averagePlayerScore) },
                  { label: "Spiele", value: String(overview.averageScoreGameCount) }
                ]}
              />
            </section>

            {false ? <CollapsibleSection
              title="Uebersicht"
              helper="Kompakte Kennzahlen zum gefilterten Pool"
              count={overview.games}
              open={openSections.overview}
              onToggle={() => toggleSection("overview")}
            >
              <div className="button-row button-row--compact stats-toolbar">
                <div className="stats-toolbar__group">
                  {(["winRate", "score", "duration"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`chip-button ${playerChartMode === mode ? "is-selected" : ""}`}
                      onClick={() => setPlayerChartMode(mode)}
                    >
                      {mode === "winRate" ? "Spieler Winrate" : mode === "score" ? "Spieler Score" : "Spieler Dauer"}
                    </button>
                  ))}
                </div>
                <div className="stats-toolbar__group">
                  {(["winRate", "score", "usage"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`chip-button ${armyChartMode === mode ? "is-selected" : ""}`}
                      onClick={() => setArmyChartMode(mode)}
                    >
                      {mode === "usage" ? "Armeen Spiele" : mode === "winRate" ? "Armeen Winrate" : "Armeen Score"}
                    </button>
                  ))}
                </div>
                <div className="stats-toolbar__group">
                  {[3, 5, 10].map((count) => (
                    <button
                      key={count}
                      type="button"
                      className={`chip-button ${topCount === count ? "is-selected" : ""}`}
                      onClick={() => setTopCount(count)}
                    >
                      Top {count}
                    </button>
                  ))}
                </div>
              </div>
              <div className="overview-chart-grid stats-chart-grid">
                <RankedBarChart
                  title={
                    playerChartMode === "winRate"
                      ? "Spieler Winrate"
                      : playerChartMode === "score"
                        ? "Spieler Avg Score"
                        : "Spieler Avg Dauer"
                  }
                  subtitle={`Top ${topCount}`}
                  items={playerChartItems}
                  emptyLabel="Noch keine auswertbaren Spieler."
                  activeLabel={activePlayerChartLabel}
                  onActivate={setActivePlayerChartLabel}
                />
                <RankedBarChart
                  title={
                    armyChartMode === "usage"
                      ? "Armeen nach Spielen"
                      : armyChartMode === "winRate"
                        ? "Armee Winrate"
                        : "Armee Avg Score"
                  }
                  subtitle={`Top ${topCount}`}
                  items={armyChartItems}
                  emptyLabel="Noch keine Armeen vorhanden."
                  activeLabel={activeArmyChartLabel}
                  onActivate={setActiveArmyChartLabel}
                />
                <TrendLineChart
                  title="Rundenzeiten"
                  rows={roundDurationRows}
                  primaryLabel="Avg"
                  secondaryLabel="Max"
                  emptyLabel="Noch keine abgeschlossenen Runden vorhanden."
                  formatValue={formatDuration}
                  activeLabel={activeDurationRoundLabel}
                  onActivate={setActiveDurationRoundLabel}
                />
                <SingleLineChart
                  title="Score nach Runde"
                  rows={roundScoreRows}
                  emptyLabel="Noch keine Rundenscores vorhanden."
                  formatValue={(value) => value.toFixed(1)}
                />
              </div>
            </CollapsibleSection> : null}

            <CollapsibleSection
              title="Spieler"
              helper="Kompaktwerte und Score-Splits je Spieler"
              count={playerAggregates.length}
              open={openSections.players}
              onToggle={() => toggleSection("players")}
            >
              <div className="stack">
                <div className="overview-chart-grid stats-chart-grid">
                  <RankedBarChart
                    title="Dauer pro Spielerzug"
                    subtitle={`Top ${topCount}`}
                    items={playerTurnDurationItems}
                    emptyLabel="Noch keine abgeschlossenen Zuege vorhanden."
                  />
                </div>
                {playerAggregates.map((player) => {
                  const playerFilter = playerDetailFilters[player.name] ?? "all";
                  const scopedGames = filteredGames.filter((game) =>
                    game.players.some((entry) => entry.name === player.name && matchesOpponentFilter(game, entry, playerFilter))
                  );
                  const scopedPlayer = createPlayerAggregates(scopedGames).find((entry) => entry.name === player.name) ?? player;
                  const isOpen = openPlayerCards[player.name] ?? false;

                  return (
                  <article key={player.name} className="card stack stats-group-card">
                    <div className="stats-group-card__head">
                      <div>
                        <strong>{player.name}</strong>
                        <p>{scopedPlayer.games} Spiele</p>
                      </div>
                      <div className="stats-group-card__actions">
                        <select
                          value={playerFilter}
                          onChange={(event) =>
                            setPlayerDetailFilters((current) => ({
                              ...current,
                              [player.name]: event.target.value as OpponentFilter
                            }))
                          }
                        >
                          {tableOpponentOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <span className="meta-chip meta-chip--accent">{formatPercent(scopedPlayer.winRate)} Winrate</span>
                        <button
                          type="button"
                          className="ghost-button compact-button"
                          onClick={() => setOpenPlayerCards((current) => ({ ...current, [player.name]: !isOpen }))}
                        >
                          {isOpen ? "Zuklappen" : "Aufklappen"}
                        </button>
                      </div>
                    </div>
                    {isOpen ? (
                    <>
                    <MiniBarChart
                      items={[
                        {
                          label: "Avg Prim",
                          value: scopedPlayer.averagePrimary,
                          display: formatMetric(scopedPlayer.averagePrimary),
                          max: playerPrimaryMax,
                          tone: "score"
                        },
                        {
                          label: "Avg Sek",
                          value: scopedPlayer.averageSecondary,
                          display: formatMetric(scopedPlayer.averageSecondary),
                          max: playerSecondaryMax,
                          tone: "success"
                        },
                        {
                          label: "Avg CP",
                          value: scopedPlayer.averageSpentCp,
                          display: formatMetric(scopedPlayer.averageSpentCp),
                          max: playerCpMax,
                          tone: "warning"
                        }
                      ]}
                    />
                    <div className="stats-grid stats-grid--stats-page">
                      <StatCard
                        label="Spiele"
                        value={scopedPlayer.games}
                        tone="score"
                        chart={defaultMetricCardChart(scopedPlayer.games, String(scopedPlayer.games), overview.games, "score")}
                      />
                      <StatCard
                        label="Avg Dauer"
                        value={formatDurationMetric(scopedPlayer.averageDurationMs)}
                        tone="time"
                        chart={defaultMetricCardChart(
                          scopedPlayer.averageDurationMs,
                          formatDurationMetric(scopedPlayer.averageDurationMs),
                          playerDurationMax,
                          "time"
                        )}
                      />
                      <StatCard
                        label="Avg Gesamt"
                        value={formatMetric(scopedPlayer.averageTotal)}
                        tone="score"
                        chart={defaultMetricCardChart(
                          scopedPlayer.averageTotal,
                          formatMetric(scopedPlayer.averageTotal),
                          playerTotalMax,
                          "score"
                        )}
                      />
                      <StatCard
                        label="Avg Primary"
                        value={formatMetric(scopedPlayer.averagePrimary)}
                        tone="score"
                        chart={defaultMetricCardChart(
                          scopedPlayer.averagePrimary,
                          formatMetric(scopedPlayer.averagePrimary),
                          playerPrimaryMax,
                          "score"
                        )}
                      />
                      <StatCard
                        label="Avg Secondary"
                        value={formatMetric(scopedPlayer.averageSecondary)}
                        tone="success"
                        chart={defaultMetricCardChart(
                          scopedPlayer.averageSecondary,
                          formatMetric(scopedPlayer.averageSecondary),
                          playerSecondaryMax,
                          "success"
                        )}
                      />
                      <StatCard
                        label="Avg CP spent"
                        value={formatMetric(scopedPlayer.averageSpentCp)}
                        tone="warning"
                        chart={defaultMetricCardChart(
                          scopedPlayer.averageSpentCp,
                          formatMetric(scopedPlayer.averageSpentCp),
                          playerCpMax,
                          "warning"
                        )}
                      />
                      <StatCard
                        label="W / L / T"
                        value={`${scopedPlayer.wins} / ${scopedPlayer.losses} / ${scopedPlayer.ties}`}
                        tone="default"
                        chart={
                          <MiniBarChart
                            items={[
                              {
                                label: "W",
                                value: scopedPlayer.wins,
                                display: String(scopedPlayer.wins),
                                max: getMetricMax([scopedPlayer.games]),
                                tone: "success"
                              },
                              {
                                label: "L",
                                value: scopedPlayer.losses,
                                display: String(scopedPlayer.losses),
                                max: getMetricMax([scopedPlayer.games]),
                                tone: "warning"
                              },
                              {
                                label: "T",
                                value: scopedPlayer.ties,
                                display: String(scopedPlayer.ties),
                                max: getMetricMax([scopedPlayer.games]),
                                tone: "time"
                              }
                            ]}
                          />
                        }
                      />
                      <StatCard
                        label="Win% Go First"
                        value={formatPercent(player.winRateWhenGoFirst)}
                        tone="success"
                        chart={defaultMetricCardChart(
                          player.winRateWhenGoFirst,
                          formatPercent(player.winRateWhenGoFirst),
                          100,
                          "success"
                        )}
                      />
                      <StatCard
                        label="Win% Start First"
                        value={formatPercent(player.winRateWhenStartFirst)}
                        tone="success"
                        chart={defaultMetricCardChart(
                          player.winRateWhenStartFirst,
                          formatPercent(player.winRateWhenStartFirst),
                          100,
                          "success"
                        )}
                      />
                    </div>
                    </>
                    ) : null}
                  </article>
                  );
                })}
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="Primaermissionen"
              helper="Leader, Winrate, Spiele, Score, CP und Zeit"
              count={missionSummaries.length}
              open={openSections.missions}
              onToggle={() => toggleSection("missions")}
            >
              <div className="stack">
                {missionSummaries.map((mission) => (
                  <article key={mission.label} className="stats-row-card stats-row-card--stacked">
                    <div className="stats-row-card__title-block">
                      <strong>{mission.label}</strong>
                      <p>{mission.leaderName}</p>
                    </div>
                    <div className="stats-grid stats-grid--stats-page">
                      <StatCard label="Leader" value={mission.leaderName} />
                      <StatCard
                        label="Win%"
                        value={formatPercent(mission.leaderWinRate)}
                        tone="success"
                        chart={defaultMetricCardChart(mission.leaderWinRate, formatPercent(mission.leaderWinRate), 100, "success")}
                      />
                      <StatCard
                        label="Spiele"
                        value={mission.games}
                        tone="warning"
                        chart={defaultMetricCardChart(mission.games, String(mission.games), missionGamesMax, "warning")}
                      />
                      <StatCard label="Avg Score" value={formatMetric(mission.averageScore)} tone="score" />
                      <StatCard label="Avg CP spent" value={formatMetric(mission.averageSpentCp)} tone="warning" />
                      <StatCard label="Avg Time" value={formatDurationMetric(mission.averageDurationMs)} tone="time" />
                    </div>
                  </article>
                ))}
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="Aufstellungen"
              helper="Leader, Winrate, Spiele, Score, CP und Zeit"
              count={deploymentSummaries.length}
              open={openSections.deployments}
              onToggle={() => toggleSection("deployments")}
            >
              <div className="stack">
                {deploymentSummaries.map((deployment) => (
                  <article key={deployment.label} className="stats-row-card stats-row-card--stacked">
                    <div className="stats-row-card__title-block">
                      <strong>{deployment.label}</strong>
                      <p>{deployment.leaderName}</p>
                    </div>
                    <div className="stats-grid stats-grid--stats-page">
                      <StatCard label="Leader" value={deployment.leaderName} />
                      <StatCard
                        label="Win%"
                        value={formatPercent(deployment.leaderWinRate)}
                        tone="success"
                        chart={defaultMetricCardChart(
                          deployment.leaderWinRate,
                          formatPercent(deployment.leaderWinRate),
                          100,
                          "success"
                        )}
                      />
                      <StatCard
                        label="Avg Score ges"
                        value={formatMetric(deployment.averageScore)}
                        tone="score"
                      />
                      <StatCard
                        label="Avg CP spent"
                        value={formatMetric(deployment.averageSpentCp)}
                        tone="warning"
                      />
                      <StatCard
                        label="Avg Time"
                        value={formatDurationMetric(deployment.averageDurationMs)}
                        tone="time"
                      />
                      <StatCard
                        label="Spiele"
                        value={deployment.games}
                        tone="warning"
                        chart={defaultMetricCardChart(deployment.games, String(deployment.games), deploymentGamesMax, "warning")}
                      />
                    </div>
                  </article>
                ))}
              </div>
            </CollapsibleSection>

            {false ? <CollapsibleSection
              title="Armeen"
              helper="Kompaktwerte und Score-Splits je Armee"
              count={armyAggregates.length}
              open={openSections.armies}
              onToggle={() => toggleSection("armies")}
            >
              <div className="stack">
                <div className="overview-chart-grid stats-chart-grid">
                  <RankedBarChart
                    title={
                      armyChartMode === "usage"
                        ? "Armee Nutzung"
                        : armyChartMode === "winRate"
                          ? "Armee Winrate"
                          : "Armee Avg Score"
                    }
                    subtitle={`Top ${topCount}`}
                    items={armyChartItems}
                    emptyLabel="Noch keine Armeedaten vorhanden."
                    activeLabel={activeArmyChartLabel}
                    onActivate={setActiveArmyChartLabel}
                  />
                  <RankedBarChart
                    title="Winrate nach Aufstellung"
                    subtitle={`Top ${topCount}`}
                    items={deploymentWinRateItems}
                    emptyLabel="Noch keine Aufstellungsdaten vorhanden."
                  />
                </div>
                {armyAggregates.map((army) => (
                  <article key={army.armyName} className="card stack stats-group-card">
                    <div className="stats-group-card__head">
                      <div>
                        <strong>{army.armyName}</strong>
                        <p>{army.games} Spiele</p>
                      </div>
                      <span className="meta-chip meta-chip--accent">{formatPercent(army.winRate)} Winrate</span>
                    </div>
                    <MiniBarChart
                      items={[
                        {
                          label: "Avg Prim",
                          value: army.averagePrimary,
                          display: formatMetric(army.averagePrimary),
                          max: armyPrimaryMax,
                          tone: "score"
                        },
                        {
                          label: "Avg Sek",
                          value: army.averageSecondary,
                          display: formatMetric(army.averageSecondary),
                          max: armySecondaryMax,
                          tone: "success"
                        },
                        {
                          label: "Avg Ges",
                          value: army.averageTotal,
                          display: formatMetric(army.averageTotal),
                          max: armyTotalMax,
                          tone: "warning"
                        }
                      ]}
                    />
                    <div className="stats-grid stats-grid--stats-page">
                      <StatCard
                        label="Spiele"
                        value={army.games}
                        tone="score"
                        chart={defaultMetricCardChart(army.games, String(army.games), overview.games, "score")}
                      />
                      <StatCard
                        label="Win%"
                        value={formatPercent(army.winRate)}
                        tone="success"
                        chart={defaultMetricCardChart(army.winRate, formatPercent(army.winRate), 100, "success")}
                      />
                      <StatCard
                        label="W / L / T"
                        value={`${army.wins} / ${army.losses} / ${army.ties}`}
                        chart={
                          <MiniBarChart
                            items={[
                              {
                                label: "W",
                                value: army.wins,
                                display: String(army.wins),
                                max: getMetricMax([army.games]),
                                tone: "success"
                              },
                              {
                                label: "L",
                                value: army.losses,
                                display: String(army.losses),
                                max: getMetricMax([army.games]),
                                tone: "warning"
                              },
                              {
                                label: "T",
                                value: army.ties,
                                display: String(army.ties),
                                max: getMetricMax([army.games]),
                                tone: "time"
                              }
                            ]}
                          />
                        }
                      />
                      <StatCard
                        label="Avg Primary"
                        value={formatMetric(army.averagePrimary)}
                        tone="score"
                        chart={defaultMetricCardChart(
                          army.averagePrimary,
                          formatMetric(army.averagePrimary),
                          armyPrimaryMax,
                          "score"
                        )}
                      />
                      <StatCard
                        label="Avg Secondary"
                        value={formatMetric(army.averageSecondary)}
                        tone="success"
                        chart={defaultMetricCardChart(
                          army.averageSecondary,
                          formatMetric(army.averageSecondary),
                          armySecondaryMax,
                          "success"
                        )}
                      />
                      <StatCard
                        label="Avg Gesamt"
                        value={formatMetric(army.averageTotal)}
                        tone="warning"
                        chart={defaultMetricCardChart(
                          army.averageTotal,
                          formatMetric(army.averageTotal),
                          armyTotalMax,
                          "warning"
                        )}
                      />
                    </div>
                  </article>
                ))}
              </div>
            </CollapsibleSection> : null}

            <CollapsibleSection
              title="Runden"
              helper="Rundendauer und Scoring mit Durchschnitt, Min und Max"
              count={roundDurationAggregates.length}
              open={openSections.rounds}
              onToggle={() => toggleSection("rounds")}
            >
              <div className="stack">
                <div className="overview-chart-grid stats-chart-grid">
                  <TrendLineChart
                    title="Rundenzeiten Verlauf"
                    rows={roundDurationRows}
                    primaryLabel="Durchschnitt"
                    secondaryLabel="Maximum"
                    emptyLabel="Noch keine Rundenzeiten vorhanden."
                    formatValue={formatDuration}
                    activeLabel={activeDurationRoundLabel}
                    onActivate={setActiveDurationRoundLabel}
                  />
                  <SingleLineChart
                    title="Score nach Runde"
                    rows={roundScoreRows}
                    emptyLabel="Noch keine Rundenscores vorhanden."
                    formatValue={(value) => value.toFixed(1)}
                  />
                  <SingleLineChart
                    title="Rundendauer je Runde"
                    rows={roundDurationSingleRows}
                    emptyLabel="Noch keine Rundenzeiten vorhanden."
                    formatValue={formatDuration}
                  />
                  <SingleLineChart
                    title="Rundendauer ueber Zeit"
                    rows={roundDurationTrendRows}
                    emptyLabel="Noch keine Rundendauer-Daten vorhanden."
                    formatValue={formatDuration}
                  />
                  <SingleLineChart
                    title="Scoring ueber Zeit"
                    rows={matchupScoreTrendRows}
                    emptyLabel="Noch keine Scoring-Daten vorhanden."
                    formatValue={(value) => value.toFixed(0)}
                  />
                </div>
                {roundDurationAggregates.map((round) => (
                  <article key={round.roundNumber} className="stats-row-card stats-row-card--stacked">
                    <div className="stats-row-card__title-block">
                      <strong>Runde {round.roundNumber}</strong>
                      <p>{round.games} Spiele</p>
                    </div>
                    <div className="stats-grid stats-grid--stats-page">
                      <StatCard
                        label="Spiele"
                        value={round.games}
                        tone="warning"
                        chart={defaultMetricCardChart(round.games, String(round.games), overview.games, "warning")}
                      />
                      <StatCard
                        label="Dauer Avg"
                        value={formatDurationMetric(round.averageDurationMs)}
                        tone="time"
                        chart={defaultMetricCardChart(
                          round.averageDurationMs,
                          formatDurationMetric(round.averageDurationMs),
                          roundDurationMax,
                          "time"
                        )}
                      />
                      <StatCard
                        label="Dauer Min"
                        value={formatDurationMetric(roundDurationSingleRows.find((entry) => entry.label === `R${round.roundNumber}`)?.min ?? null)}
                        tone="time"
                      />
                      <StatCard
                        label="Dauer Max"
                        value={formatDurationMetric(round.maxDurationMs)}
                        tone="time"
                      />
                      <StatCard
                        label="Avg Score ges"
                        value={formatMetric(
                          roundScoreAggregates.find((entry) => entry.roundNumber === round.roundNumber)?.averageCombinedScore ??
                            null
                        )}
                        tone="score"
                        chart={defaultMetricCardChart(
                          roundScoreAggregates.find((entry) => entry.roundNumber === round.roundNumber)?.averageCombinedScore ??
                            null,
                          formatMetric(
                            roundScoreAggregates.find((entry) => entry.roundNumber === round.roundNumber)?.averageCombinedScore ??
                              null
                          ),
                          roundScoreMax,
                          "score"
                        )}
                      />
                    </div>
                  </article>
                ))}
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="Zugrekorde"
              helper="Dauer und Punkte als kompakte Rekordkarten"
              open={openSections.records}
              onToggle={() => toggleSection("records")}
            >
              <div className="record-grid">
                {renderTurnRecordCard(turnRecords.longestTurn, "Laengster Zug")}
                {renderTurnRecordCard(turnRecords.fastestTurn, "Schnellster Zug", "record-card--accent")}
                {renderTurnRecordCard(turnRecords.highestScoringTurn, "Punktreichster Zug", "record-card--warning")}
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="Matchups"
              helper="Tempo, Score und Diff pro Paarung"
              count={matchupAggregates.length}
              open={openSections.matchups}
              onToggle={() => toggleSection("matchups")}
            >
              <div className="stack">
                <div className="overview-chart-grid stats-chart-grid">
                  <SingleLineChart
                    title="Matchdauer ueber Zeit"
                    rows={matchupDurationTrendRows}
                    emptyLabel="Noch keine Matchdauer-Daten vorhanden."
                    formatValue={formatDuration}
                  />
                  <SingleLineChart
                    title="Scoring ueber Zeit"
                    rows={matchupScoreTrendRows}
                    emptyLabel="Noch keine Scoring-Daten vorhanden."
                    formatValue={(value) => value.toFixed(0)}
                  />
                </div>
                {matchupAggregates.map((matchup) => (
                  <article key={matchup.label} className="card stack stats-group-card">
                    <div className="stats-group-card__head">
                      <div>
                        <strong>{matchup.label}</strong>
                        <p>{matchup.games} Spiele</p>
                      </div>
                    </div>
                    <MiniBarChart
                      items={[
                        {
                          label: "Dauer",
                          value: matchup.averageDurationMs,
                          display: formatDurationMetric(matchup.averageDurationMs),
                          max: matchupDurationMax,
                          tone: "time"
                        },
                        {
                          label: "Score",
                          value: matchup.averageCombinedScore,
                          display: formatMetric(matchup.averageCombinedScore),
                          max: matchupScoreMax,
                          tone: "score"
                        },
                        {
                          label: "Diff",
                          value: matchup.averageScoreDifference,
                          display: formatMetric(matchup.averageScoreDifference),
                          max: matchupDiffMax,
                          tone: "warning"
                        }
                      ]}
                    />
                    <div className="stats-grid stats-grid--stats-page">
                      <StatCard
                        label="Spiele"
                        value={matchup.games}
                        tone="success"
                        chart={defaultMetricCardChart(matchup.games, String(matchup.games), overview.games, "success")}
                      />
                      <StatCard
                        label="Avg Dauer"
                        value={formatDurationMetric(matchup.averageDurationMs)}
                        tone="time"
                        chart={defaultMetricCardChart(
                          matchup.averageDurationMs,
                          formatDurationMetric(matchup.averageDurationMs),
                          matchupDurationMax,
                          "time"
                        )}
                      />
                      <StatCard
                        label="Avg Score ges"
                        value={formatMetric(matchup.averageCombinedScore)}
                        tone="score"
                        chart={defaultMetricCardChart(
                          matchup.averageCombinedScore,
                          formatMetric(matchup.averageCombinedScore),
                          matchupScoreMax,
                          "score"
                        )}
                      />
                    </div>
                  </article>
                ))}
              </div>
            </CollapsibleSection>
          </>
        ) : (
          <article className="empty-state">
            <h2>Keine Statistik verfuegbar</h2>
            <p>Mit den aktuellen Filtern wurden keine Spiele gefunden.</p>
          </article>
        )}
      </section>

      {gamePickerOpen ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="stack">
              <div className="list-row">
                <div>
                  <h2>Spiel auswaehlen</h2>
                  <p className="muted-copy">{filteredGames.length} Treffer</p>
                </div>
                <button
                  type="button"
                  className="ghost-button compact-button"
                  onClick={() => setGamePickerOpen(false)}
                >
                  Schliessen
                </button>
              </div>
              <div className="modal-list">
                {filteredGames.map((game) => (
                  <button
                    key={game.id}
                    type="button"
                    className="game-picker-item"
                    onClick={() => {
                      setGamePickerOpen(false);
                      window.location.hash = `/game/${game.id}/overview`;
                    }}
                  >
                    <strong>
                      {game.players[0].name} vs {game.players[1].name}
                    </strong>
                    <span>{formatDateLabel(game.scheduledDate, game.scheduledTime)}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </Layout>
  );
};
