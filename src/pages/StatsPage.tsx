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
  getFilterOptions,
  getTurnRecords,
  type TurnRecord
} from "../utils/gameCalculations";
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
            <span>{activeItem.label}</span>
            <strong>{activeItem.display}</strong>
          </div>
          <div className="overview-chart-total">
            <span>Details</span>
            <strong>{activeItem.detail ?? subtitle}</strong>
          </div>
        </div>
      ) : null}
    </article>
  );
};

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
  accentClassName = "",
  highlightTone: StatTone = "score"
) => {
  if (!record) {
    return null;
  }

  const scoreMax = getMetricMax([record.primaryScore, record.secondaryScore, record.totalScore]);

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
      <MiniBarChart
        items={[
          {
            label: "Primary",
            value: record.primaryScore,
            display: String(record.primaryScore),
            max: scoreMax,
            tone: "score"
          },
          {
            label: "Secondary",
            value: record.secondaryScore,
            display: String(record.secondaryScore),
            max: scoreMax,
            tone: "success"
          },
          {
            label: "Gesamt",
            value: record.totalScore,
            display: String(record.totalScore),
            max: scoreMax,
            tone: highlightTone
          }
        ]}
      />
      <div className="record-card__metrics">
        <div>
          <span>Dauer</span>
          <strong>{formatDuration(record.durationMs)}</strong>
        </div>
        <div>
          <span>Primary</span>
          <strong>{record.primaryScore}</strong>
        </div>
        <div>
          <span>Secondary</span>
          <strong>{record.secondaryScore}</strong>
        </div>
      </div>
    </article>
  );
};

export const StatsPage = ({ onBack, onCreateGame }: StatsPageProps) => {
  const { games, isLoading, errorMessage, clearError } = useGameStore();
  const [filters, setFilters] = useState(createInitialGameFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openSections, setOpenSections] = useState(defaultOpenSections);
  const [gamePickerOpen, setGamePickerOpen] = useState(false);
  const [playerChartMode, setPlayerChartMode] = useState<"winRate" | "score" | "duration">("winRate");
  const [armyChartMode, setArmyChartMode] = useState<"usage" | "winRate" | "score">("usage");
  const [topCount, setTopCount] = useState(6);
  const [activePlayerChartLabel, setActivePlayerChartLabel] = useState<string | null>(null);
  const [activeArmyChartLabel, setActiveArmyChartLabel] = useState<string | null>(null);
  const [activeDurationRoundLabel, setActiveDurationRoundLabel] = useState<string | null>(null);
  const [activeScoreRoundLabel, setActiveScoreRoundLabel] = useState<string | null>(null);
  const [activeCpPointId, setActiveCpPointId] = useState<string | null>(null);
  const filteredGames = useMemo(() => filterGames(games, filters), [games, filters]);
  const filterOptions = useMemo(() => getFilterOptions(games), [games]);
  const overview = useMemo(() => createStatsOverview(filteredGames), [filteredGames]);
  const playerAggregates = useMemo(() => createPlayerAggregates(filteredGames), [filteredGames]);
  const armyAggregates = useMemo(() => createArmyAggregates(filteredGames), [filteredGames]);
  const missionLeaders = useMemo(() => createMissionLeaders(filteredGames), [filteredGames]);
  const deploymentLeaders = useMemo(() => createDeploymentLeaders(filteredGames), [filteredGames]);
  const deploymentPerformance = useMemo(
    () => createScenarioPerformanceAggregates(filteredGames, (game) => game.deployment),
    [filteredGames]
  );
  const matchupAggregates = useMemo(() => createMatchupAggregates(filteredGames), [filteredGames]);
  const roundDurationAggregates = useMemo(() => createRoundDurationAggregates(filteredGames), [filteredGames]);
  const roundScoreAggregates = useMemo(() => createRoundScoreAggregates(filteredGames), [filteredGames]);
  const playerTurnDurationAggregates = useMemo(
    () => createPlayerTurnDurationAggregates(filteredGames),
    [filteredGames]
  );
  const cpScorePoints = useMemo(() => createCpScoreCorrelationPoints(filteredGames), [filteredGames]);
  const turnRecords = useMemo(() => getTurnRecords(filteredGames), [filteredGames]);

  const overviewGamesMax = getMetricMax([overview.games, overview.players, overview.armies]);
  const overviewDurationMax = getMetricMax([
    overview.averageDurationMs,
    overview.averageRounds,
    overview.averageSpentCp
  ]);
  const overviewScoreMax = getMetricMax([
    overview.averageCombinedScore,
    overview.averagePlayerOneScore,
    overview.averagePlayerTwoScore
  ]);
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

  const playerChartItems = useMemo(() => {
    if (playerChartMode === "duration") {
      return playerAggregates
        .filter((player) => player.games > 0 && player.averageDurationMs !== null)
        .sort(
          (left, right) => (right.averageDurationMs ?? 0) - (left.averageDurationMs ?? 0) || right.games - left.games
        )
        .slice(0, topCount)
        .map((player) => ({
          label: player.name,
          value: player.averageDurationMs ?? 0,
          display: formatDurationMetric(player.averageDurationMs),
          tone: "time" as const,
          detail: `${player.games} Spiele`
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
          detail: `Prim ${formatMetric(player.averagePrimary)} | Sek ${formatMetric(player.averageSecondary)}`
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
        detail: `${player.wins}/${player.losses}/${player.ties}`
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
          detail: `Prim ${formatMetric(army.averagePrimary)} | Sek ${formatMetric(army.averageSecondary)}`
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
          detail: `${army.games} Spiele`
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
        detail: `Winrate ${formatPercent(army.winRate)}`
      }));
  }, [armyAggregates, armyChartMode, topCount]);

  const roundDurationRows = roundDurationAggregates.map((round) => ({
    label: `R${round.roundNumber}`,
    primary: round.averageDurationMs,
    secondary: round.maxDurationMs
  }));
  const roundScoreRows = roundScoreAggregates.map((round) => ({
    label: `R${round.roundNumber}`,
    primary: round.averagePlayerOneScore,
    secondary: round.averagePlayerTwoScore
  }));
  const playerSplitRows = playerAggregates
    .filter((player) => player.games > 0)
    .map((player) => ({
      label: player.name,
      primary: player.averagePrimary,
      secondary: player.averageSecondary,
      total: player.averageTotal
    }));
  const playerTurnDurationItems = playerTurnDurationAggregates
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
              <article
                className="stats-hero__feature stats-hero__feature--clickable"
                onClick={() => setGamePickerOpen(true)}
              >
                <span>Spiele</span>
                <strong>{overview.games}</strong>
                <p>
                  {overview.players} Spieler | {overview.armies} Armeen
                </p>
                <MiniBarChart
                  items={[
                    {
                      label: "Spiele",
                      value: overview.games,
                      display: String(overview.games),
                      max: overviewGamesMax,
                      tone: "score"
                    },
                    {
                      label: "Spieler",
                      value: overview.players,
                      display: String(overview.players),
                      max: overviewGamesMax,
                      tone: "success"
                    },
                    {
                      label: "Armeen",
                      value: overview.armies,
                      display: String(overview.armies),
                      max: overviewGamesMax,
                      tone: "warning"
                    }
                  ]}
                />
              </article>
              <article className="stats-hero__feature">
                <span>Avg Dauer</span>
                <strong>{formatDurationMetric(overview.averageDurationMs)}</strong>
                <p>
                  {formatMetric(overview.averageRounds)} Runden | {formatMetric(overview.averageSpentCp)} CP spent
                </p>
                <MiniBarChart
                  items={[
                    {
                      label: "Dauer",
                      value: overview.averageDurationMs,
                      display: formatDurationMetric(overview.averageDurationMs),
                      max: overviewDurationMax,
                      tone: "time"
                    },
                    {
                      label: "Runden",
                      value: overview.averageRounds,
                      display: formatMetric(overview.averageRounds),
                      max: overviewDurationMax,
                      tone: "warning"
                    },
                    {
                      label: "CP",
                      value: overview.averageSpentCp,
                      display: formatMetric(overview.averageSpentCp),
                      max: overviewDurationMax,
                      tone: "success"
                    }
                  ]}
                />
              </article>
              <article className="stats-hero__feature">
                <span>Avg Score gesamt</span>
                <strong>{formatMetric(overview.averageCombinedScore)}</strong>
                <p>
                  P1 {formatMetric(overview.averagePlayerOneScore)} | P2 {formatMetric(overview.averagePlayerTwoScore)}
                </p>
                <MiniBarChart
                  items={[
                    {
                      label: "Gesamt",
                      value: overview.averageCombinedScore,
                      display: formatMetric(overview.averageCombinedScore),
                      max: overviewScoreMax,
                      tone: "score"
                    },
                    {
                      label: "P1",
                      value: overview.averagePlayerOneScore,
                      display: formatMetric(overview.averagePlayerOneScore),
                      max: overviewScoreMax,
                      tone: "success"
                    },
                    {
                      label: "P2",
                      value: overview.averagePlayerTwoScore,
                      display: formatMetric(overview.averagePlayerTwoScore),
                      max: overviewScoreMax,
                      tone: "warning"
                    }
                  ]}
                />
              </article>
            </section>

            <CollapsibleSection
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
                  {(["usage", "winRate", "score"] as const).map((mode) => (
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
                  {[5, 6, 10].map((count) => (
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
                <TrendLineChart
                  title="Score nach Runde"
                  rows={roundScoreRows}
                  primaryLabel="P1"
                  secondaryLabel="P2"
                  emptyLabel="Noch keine Rundenscores vorhanden."
                  formatValue={(value) => value.toFixed(1)}
                  activeLabel={activeScoreRoundLabel}
                  onActivate={setActiveScoreRoundLabel}
                />
              </div>
              <div className="stats-grid stats-grid--stats-page">
                <StatCard
                  label="Spiele"
                  value={overview.games}
                  tone="score"
                  chart={defaultMetricCardChart(overview.games, String(overview.games), overviewGamesMax, "score")}
                />
                <StatCard
                  label="Spieler"
                  value={overview.players}
                  tone="success"
                  chart={defaultMetricCardChart(overview.players, String(overview.players), overviewGamesMax, "success")}
                />
                <StatCard
                  label="Armeen"
                  value={overview.armies}
                  tone="warning"
                  chart={defaultMetricCardChart(overview.armies, String(overview.armies), overviewGamesMax, "warning")}
                />
                <StatCard
                  label="Avg Dauer"
                  value={formatDurationMetric(overview.averageDurationMs)}
                  tone="time"
                  chart={defaultMetricCardChart(
                    overview.averageDurationMs,
                    formatDurationMetric(overview.averageDurationMs),
                    overviewDurationMax,
                    "time"
                  )}
                />
                <StatCard
                  label="Avg Runden"
                  value={formatMetric(overview.averageRounds)}
                  tone="warning"
                  chart={defaultMetricCardChart(
                    overview.averageRounds,
                    formatMetric(overview.averageRounds),
                    overviewDurationMax,
                    "warning"
                  )}
                />
                <StatCard
                  label="Avg CP spent"
                  value={formatMetric(overview.averageSpentCp)}
                  tone="success"
                  chart={defaultMetricCardChart(
                    overview.averageSpentCp,
                    formatMetric(overview.averageSpentCp),
                    overviewDurationMax,
                    "success"
                  )}
                />
                <StatCard
                  label="Avg Score ges"
                  value={formatMetric(overview.averageCombinedScore)}
                  tone="score"
                  chart={defaultMetricCardChart(
                    overview.averageCombinedScore,
                    formatMetric(overview.averageCombinedScore),
                    overviewScoreMax,
                    "score"
                  )}
                />
                <StatCard
                  label="Avg Score P1"
                  value={formatMetric(overview.averagePlayerOneScore)}
                  tone="success"
                  chart={defaultMetricCardChart(
                    overview.averagePlayerOneScore,
                    formatMetric(overview.averagePlayerOneScore),
                    overviewScoreMax,
                    "success"
                  )}
                />
                <StatCard
                  label="Avg Score P2"
                  value={formatMetric(overview.averagePlayerTwoScore)}
                  tone="warning"
                  chart={defaultMetricCardChart(
                    overview.averagePlayerTwoScore,
                    formatMetric(overview.averagePlayerTwoScore),
                    overviewScoreMax,
                    "warning"
                  )}
                />
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="Spieler"
              helper="Kompaktwerte und Score-Splits je Spieler"
              count={playerAggregates.length}
              open={openSections.players}
              onToggle={() => toggleSection("players")}
            >
              <div className="stack">
                <div className="overview-chart-grid stats-chart-grid">
                  <SplitBarChart
                    title="Primary vs Secondary je Spieler"
                    rows={playerSplitRows}
                    emptyLabel="Noch keine Spieler-Scores vorhanden."
                  />
                  <RankedBarChart
                    title="Dauer pro Spielerzug"
                    subtitle={`Top ${topCount}`}
                    items={playerTurnDurationItems}
                    emptyLabel="Noch keine abgeschlossenen Zuege vorhanden."
                  />
                  <ScatterChart
                    title="CP-Spent vs Score"
                    points={cpScatterPoints}
                    emptyLabel="Noch keine kombinierten CP- und Score-Daten vorhanden."
                    activePointId={activeCpPointId}
                    onActivate={setActiveCpPointId}
                  />
                </div>
                {playerAggregates.map((player) => (
                  <article key={player.name} className="card stack stats-group-card">
                    <div className="stats-group-card__head">
                      <div>
                        <strong>{player.name}</strong>
                        <p>{player.games} Spiele</p>
                      </div>
                      <span className="meta-chip meta-chip--accent">{formatPercent(player.winRate)} Winrate</span>
                    </div>
                    <MiniBarChart
                      items={[
                        {
                          label: "Avg Prim",
                          value: player.averagePrimary,
                          display: formatMetric(player.averagePrimary),
                          max: playerPrimaryMax,
                          tone: "score"
                        },
                        {
                          label: "Avg Sek",
                          value: player.averageSecondary,
                          display: formatMetric(player.averageSecondary),
                          max: playerSecondaryMax,
                          tone: "success"
                        },
                        {
                          label: "Avg CP",
                          value: player.averageSpentCp,
                          display: formatMetric(player.averageSpentCp),
                          max: playerCpMax,
                          tone: "warning"
                        }
                      ]}
                    />
                    <div className="stats-grid stats-grid--stats-page">
                      <StatCard
                        label="Spiele"
                        value={player.games}
                        tone="score"
                        chart={defaultMetricCardChart(player.games, String(player.games), overview.games, "score")}
                      />
                      <StatCard
                        label="Avg Dauer"
                        value={formatDurationMetric(player.averageDurationMs)}
                        tone="time"
                        chart={defaultMetricCardChart(
                          player.averageDurationMs,
                          formatDurationMetric(player.averageDurationMs),
                          playerDurationMax,
                          "time"
                        )}
                      />
                      <StatCard
                        label="Avg Gesamt"
                        value={formatMetric(player.averageTotal)}
                        tone="score"
                        chart={defaultMetricCardChart(
                          player.averageTotal,
                          formatMetric(player.averageTotal),
                          playerTotalMax,
                          "score"
                        )}
                      />
                      <StatCard
                        label="Avg Primary"
                        value={formatMetric(player.averagePrimary)}
                        tone="score"
                        chart={defaultMetricCardChart(
                          player.averagePrimary,
                          formatMetric(player.averagePrimary),
                          playerPrimaryMax,
                          "score"
                        )}
                      />
                      <StatCard
                        label="Avg Secondary"
                        value={formatMetric(player.averageSecondary)}
                        tone="success"
                        chart={defaultMetricCardChart(
                          player.averageSecondary,
                          formatMetric(player.averageSecondary),
                          playerSecondaryMax,
                          "success"
                        )}
                      />
                      <StatCard
                        label="Avg CP spent"
                        value={formatMetric(player.averageSpentCp)}
                        tone="warning"
                        chart={defaultMetricCardChart(
                          player.averageSpentCp,
                          formatMetric(player.averageSpentCp),
                          playerCpMax,
                          "warning"
                        )}
                      />
                      <StatCard
                        label="W / L / T"
                        value={`${player.wins} / ${player.losses} / ${player.ties}`}
                        tone="default"
                        chart={
                          <MiniBarChart
                            items={[
                              {
                                label: "W",
                                value: player.wins,
                                display: String(player.wins),
                                max: getMetricMax([player.games]),
                                tone: "success"
                              },
                              {
                                label: "L",
                                value: player.losses,
                                display: String(player.losses),
                                max: getMetricMax([player.games]),
                                tone: "warning"
                              },
                              {
                                label: "T",
                                value: player.ties,
                                display: String(player.ties),
                                max: getMetricMax([player.games]),
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
                  </article>
                ))}
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="Primaermissionen"
              helper="Leader, Winrate und Stichprobengroesse"
              count={missionLeaders.length}
              open={openSections.missions}
              onToggle={() => toggleSection("missions")}
            >
              <div className="stack">
                {missionLeaders.map((mission) => (
                  <article key={mission.label} className="stats-row-card stats-row-card--stacked">
                    <div className="stats-row-card__title-block">
                      <strong>{mission.label}</strong>
                      <p>{mission.playerName}</p>
                    </div>
                    <div className="stats-grid stats-grid--stats-page">
                      <StatCard label="Leader" value={mission.playerName} />
                      <StatCard
                        label="Win%"
                        value={formatPercent(mission.winRate)}
                        tone="success"
                        chart={defaultMetricCardChart(mission.winRate, formatPercent(mission.winRate), 100, "success")}
                      />
                      <StatCard
                        label="Spiele"
                        value={mission.games}
                        tone="warning"
                        chart={defaultMetricCardChart(mission.games, String(mission.games), missionGamesMax, "warning")}
                      />
                    </div>
                  </article>
                ))}
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="Aufstellungen"
              helper="Leader, Winrate, Score und Tempo"
              count={deploymentLeaders.length}
              open={openSections.deployments}
              onToggle={() => toggleSection("deployments")}
            >
              <div className="stack">
                <RankedBarChart
                  title="Winrate nach Aufstellung"
                  subtitle={`Top ${topCount}`}
                  items={deploymentWinRateItems}
                  emptyLabel="Noch keine Aufstellungsdaten vorhanden."
                />
                {deploymentPerformance.map((deployment) => (
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
                        value={formatMetric(deployment.averageCombinedScore)}
                        tone="score"
                        chart={defaultMetricCardChart(
                          deployment.averageCombinedScore,
                          formatMetric(deployment.averageCombinedScore),
                          deploymentScoreMax,
                          "score"
                        )}
                      />
                      <StatCard
                        label="Avg Dauer"
                        value={formatDurationMetric(deployment.averageDurationMs)}
                        tone="time"
                        chart={defaultMetricCardChart(
                          deployment.averageDurationMs,
                          formatDurationMetric(deployment.averageDurationMs),
                          deploymentScoreMax,
                          "time"
                        )}
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

            <CollapsibleSection
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
            </CollapsibleSection>

            <CollapsibleSection
              title="Rundenzeiten"
              helper="Je Runde kompakt mit Avg/Max-Vergleich"
              count={roundDurationAggregates.length}
              open={openSections.rounds}
              onToggle={() => toggleSection("rounds")}
            >
              <div className="stack">
                <div className="overview-chart-grid stats-chart-grid">
                  <TrendLineChart
                    title="Rundenzeiten Verlauf"
                    rows={roundDurationRows}
                    primaryLabel="Avg"
                    secondaryLabel="Max"
                    emptyLabel="Noch keine Rundenzeiten vorhanden."
                    formatValue={formatDuration}
                    activeLabel={activeDurationRoundLabel}
                    onActivate={setActiveDurationRoundLabel}
                  />
                  <TrendLineChart
                    title="Score nach Runde"
                    rows={roundScoreRows}
                    primaryLabel="P1"
                    secondaryLabel="P2"
                    emptyLabel="Noch keine Rundenscores vorhanden."
                    formatValue={(value) => value.toFixed(1)}
                    activeLabel={activeScoreRoundLabel}
                    onActivate={setActiveScoreRoundLabel}
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
                        label="Avg"
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
                {renderTurnRecordCard(turnRecords.longestTurn, "Laengster Zug", "", "score")}
                {renderTurnRecordCard(turnRecords.fastestTurn, "Schnellster Zug", "record-card--accent", "success")}
                {renderTurnRecordCard(turnRecords.highestScoringTurn, "Punktreichster Zug", "record-card--warning", "warning")}
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
