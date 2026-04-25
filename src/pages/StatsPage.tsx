import { useMemo, useState } from "react";
import { CollapsibleSection } from "../components/CollapsibleSection";
import { FloatingMenu } from "../components/FloatingMenu";
import { Layout } from "../components/Layout";
import { StatCard } from "../components/StatCard";
import { useGameStore } from "../store/GameStore";
import {
  createArmyAggregates,
  createDeploymentLeaders,
  createInitialGameFilters,
  createMatchupAggregates,
  createMissionLeaders,
  createPlayerAggregates,
  createRoundDurationAggregates,
  createStatsOverview,
  filterGames,
  getTurnRecords,
  getFilterOptions,
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
  emptyLabel
}: {
  title: string;
  subtitle: string;
  items: RankedChartItem[];
  emptyLabel: string;
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

  const rowHeight = 20;
  const labelWidth = 96;
  const valueWidth = 38;
  const barHeight = 10;
  const chartHeight = CHART_PADDING * 2 + items.length * rowHeight;
  const plotWidth = CHART_WIDTH - CHART_PADDING * 2 - labelWidth - valueWidth;
  const maxValue = Math.max(...items.map((item) => item.value), 1);

  return (
    <article className="overview-chart-card">
      <div className="overview-chart-card__head">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      <svg
        className="overview-chart stats-ranked-chart"
        viewBox={`0 0 ${CHART_WIDTH} ${chartHeight}`}
        role="img"
        aria-label={title}
      >
        {items.map((item, index) => {
          const y = CHART_PADDING + index * rowHeight + rowHeight / 2;
          const width = (item.value / maxValue) * plotWidth;
          const barX = CHART_PADDING + labelWidth;

          return (
            <g key={`${item.label}-${item.display}`}>
              <text x={CHART_PADDING} y={y + 3} className="stats-ranked-chart__label">
                {item.label}
              </text>
              <rect
                x={barX}
                y={y - barHeight / 2}
                width={plotWidth}
                height={barHeight}
                rx={barHeight / 2}
                className="stats-ranked-chart__track"
              />
              <rect
                x={barX}
                y={y - barHeight / 2}
                width={Math.max(width, 4)}
                height={barHeight}
                rx={barHeight / 2}
                fill={getToneColor(item.tone)}
              />
              <text x={barX + plotWidth + 8} y={y + 3} className="stats-ranked-chart__value">
                {item.display}
              </text>
            </g>
          );
        })}
      </svg>
    </article>
  );
};

const RoundTrendChart = ({
  title,
  rows
}: {
  title: string;
  rows: Array<{ label: string; average: number | null; max: number | null }>;
}) => {
  if (!rows.length) {
    return (
      <article className="overview-chart-card">
        <div className="overview-chart-card__head">
          <strong>{title}</strong>
          <span>0 Runden</span>
        </div>
        <p className="muted-copy">Noch keine abgeschlossenen Runden vorhanden.</p>
      </article>
    );
  }

  const plotWidth = CHART_WIDTH - CHART_PADDING * 2;
  const plotHeight = CHART_HEIGHT - CHART_PADDING * 2;
  const maxValue = Math.max(...rows.flatMap((row) => [row.average ?? 0, row.max ?? 0]), 1);
  const averagePoints = rows.map((row, index) => ({
    x: CHART_PADDING + (rows.length === 1 ? plotWidth / 2 : (plotWidth / Math.max(rows.length - 1, 1)) * index),
    y: CHART_HEIGHT - CHART_PADDING - (((row.average ?? 0) / maxValue) * plotHeight),
    label: row.label,
    value: row.average ?? 0
  }));
  const maxPoints = rows.map((row, index) => ({
    x: CHART_PADDING + (rows.length === 1 ? plotWidth / 2 : (plotWidth / Math.max(rows.length - 1, 1)) * index),
    y: CHART_HEIGHT - CHART_PADDING - (((row.max ?? 0) / maxValue) * plotHeight),
    label: row.label,
    value: row.max ?? 0
  }));

  return (
    <article className="overview-chart-card">
      <div className="overview-chart-card__head">
        <strong>{title}</strong>
        <div className="overview-chart-legend">
          <span className="overview-chart-legend__item is-player-1">Avg</span>
          <span className="overview-chart-legend__item is-player-2">Max</span>
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
        <path d={buildLinePath(averagePoints)} className="overview-chart__line is-player-1" />
        <path d={buildLinePath(maxPoints)} className="overview-chart__line is-player-2" />
        {averagePoints.map((point) => (
          <text key={`avg-${point.label}`} x={point.x} y={CHART_HEIGHT - 4} textAnchor="middle" className="overview-chart__label">
            {point.label}
          </text>
        ))}
        <text x={CHART_PADDING - 4} y={CHART_PADDING + 4} textAnchor="end" className="overview-chart__scale">
          {formatDuration(maxValue)}
        </text>
        <text x={CHART_PADDING - 4} y={CHART_HEIGHT - CHART_PADDING + 4} textAnchor="end" className="overview-chart__scale">
          0m
        </text>
      </svg>
      <div className="overview-chart-card__totals">
        <div className="overview-chart-total">
          <span className="overview-chart-total__marker is-player-1" />
          <span>Avg</span>
          <strong>{formatDuration(rows[rows.length - 1]?.average ?? 0)}</strong>
        </div>
        <div className="overview-chart-total">
          <span className="overview-chart-total__marker is-player-2" />
          <span>Max</span>
          <strong>{formatDuration(rows[rows.length - 1]?.max ?? 0)}</strong>
        </div>
      </div>
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
  const filteredGames = useMemo(() => filterGames(games, filters), [games, filters]);
  const filterOptions = useMemo(() => getFilterOptions(games), [games]);
  const overview = useMemo(() => createStatsOverview(filteredGames), [filteredGames]);
  const playerAggregates = useMemo(() => createPlayerAggregates(filteredGames), [filteredGames]);
  const armyAggregates = useMemo(() => createArmyAggregates(filteredGames), [filteredGames]);
  const missionLeaders = useMemo(() => createMissionLeaders(filteredGames), [filteredGames]);
  const deploymentLeaders = useMemo(() => createDeploymentLeaders(filteredGames), [filteredGames]);
  const matchupAggregates = useMemo(() => createMatchupAggregates(filteredGames), [filteredGames]);
  const roundDurationAggregates = useMemo(() => createRoundDurationAggregates(filteredGames), [filteredGames]);
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

  const formatMetric = (value: number | null, digits = 1) =>
    value === null ? "-" : value.toFixed(digits);

  const formatPercent = (value: number | null) =>
    value === null ? "-" : `${value.toFixed(0)}%`;

  const formatDurationMetric = (value: number | null) =>
    value === null ? "-" : formatDuration(value);

  const playerWinRateChartItems = playerAggregates
    .filter((player) => player.games > 0 && player.winRate !== null)
    .sort((left, right) => (right.winRate ?? 0) - (left.winRate ?? 0) || right.games - left.games)
    .slice(0, 6)
    .map((player) => ({
      label: player.name,
      value: player.winRate ?? 0,
      display: formatPercent(player.winRate),
      tone: "success" as const
    }));
  const playerScoreChartItems = playerAggregates
    .filter((player) => player.games > 0 && player.averageTotal !== null)
    .sort((left, right) => (right.averageTotal ?? 0) - (left.averageTotal ?? 0) || right.games - left.games)
    .slice(0, 6)
    .map((player) => ({
      label: player.name,
      value: player.averageTotal ?? 0,
      display: formatMetric(player.averageTotal),
      tone: "score" as const
    }));
  const armyUsageChartItems = armyAggregates
    .filter((army) => army.games > 0)
    .sort((left, right) => right.games - left.games || left.armyName.localeCompare(right.armyName))
    .slice(0, 6)
    .map((army) => ({
      label: army.armyName,
      value: army.games,
      display: String(army.games),
      tone: "warning" as const
    }));
  const armyWinRateChartItems = armyAggregates
    .filter((army) => army.games > 0 && army.winRate !== null)
    .sort((left, right) => (right.winRate ?? 0) - (left.winRate ?? 0) || right.games - left.games)
    .slice(0, 6)
    .map((army) => ({
      label: army.armyName,
      value: army.winRate ?? 0,
      display: formatPercent(army.winRate),
      tone: "success" as const
    }));
  const roundTrendRows = roundDurationAggregates.map((round) => ({
    label: `R${round.roundNumber}`,
    average: round.averageDurationMs,
    max: round.maxDurationMs
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
              <div className="overview-chart-grid stats-chart-grid">
                <RankedBarChart
                  title="Spieler Winrate"
                  subtitle="Top 6"
                  items={playerWinRateChartItems}
                  emptyLabel="Noch keine auswertbaren Spieler."
                />
                <RankedBarChart
                  title="Spieler Avg Score"
                  subtitle="Top 6"
                  items={playerScoreChartItems}
                  emptyLabel="Noch keine Score-Daten vorhanden."
                />
                <RankedBarChart
                  title="Armeen nach Spielen"
                  subtitle="Top 6"
                  items={armyUsageChartItems}
                  emptyLabel="Noch keine Armeen vorhanden."
                />
                <RoundTrendChart title="Rundenzeiten" rows={roundTrendRows} />
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
                  <RankedBarChart
                    title="Winrate Vergleich"
                    subtitle="Spieler"
                    items={playerWinRateChartItems}
                    emptyLabel="Noch keine Spielerstatistik vorhanden."
                  />
                  <RankedBarChart
                    title="Avg Score Vergleich"
                    subtitle="Spieler"
                    items={playerScoreChartItems}
                    emptyLabel="Noch keine Score-Daten vorhanden."
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
              helper="Leader, Winrate und Stichprobengroesse"
              count={deploymentLeaders.length}
              open={openSections.deployments}
              onToggle={() => toggleSection("deployments")}
            >
              <div className="stack">
                {deploymentLeaders.map((deployment) => (
                  <article key={deployment.label} className="stats-row-card stats-row-card--stacked">
                    <div className="stats-row-card__title-block">
                      <strong>{deployment.label}</strong>
                      <p>{deployment.playerName}</p>
                    </div>
                    <div className="stats-grid stats-grid--stats-page">
                      <StatCard label="Leader" value={deployment.playerName} />
                      <StatCard
                        label="Win%"
                        value={formatPercent(deployment.winRate)}
                        tone="success"
                        chart={defaultMetricCardChart(
                          deployment.winRate,
                          formatPercent(deployment.winRate),
                          100,
                          "success"
                        )}
                      />
                      <StatCard
                        label="Spiele"
                        value={deployment.games}
                        tone="warning"
                        chart={defaultMetricCardChart(
                          deployment.games,
                          String(deployment.games),
                          deploymentGamesMax,
                          "warning"
                        )}
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
                    title="Armee Nutzung"
                    subtitle="Spiele"
                    items={armyUsageChartItems}
                    emptyLabel="Noch keine Armeedaten vorhanden."
                  />
                  <RankedBarChart
                    title="Armee Winrate"
                    subtitle="Top 6"
                    items={armyWinRateChartItems}
                    emptyLabel="Noch keine Winrate-Daten vorhanden."
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
                <RoundTrendChart title="Rundenzeiten Verlauf" rows={roundTrendRows} />
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
                        label="Max"
                        value={formatDurationMetric(round.maxDurationMs)}
                        tone="score"
                        chart={defaultMetricCardChart(
                          round.maxDurationMs,
                          formatDurationMetric(round.maxDurationMs),
                          roundDurationMax,
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
