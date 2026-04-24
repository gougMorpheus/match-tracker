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
  getFilterOptions
} from "../utils/gameCalculations";
import { formatDateLabel, formatDuration } from "../utils/time";

interface StatsPageProps {
  onBack: () => void;
  onCreateGame: () => void;
}

type StatsSectionKey = "overview" | "players" | "armies" | "rounds" | "records" | "matchups";
type ExtendedStatsSectionKey = StatsSectionKey | "missions" | "deployments";

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
                <span>Gefilterte Spiele</span>
                <strong>{overview.games}</strong>
                <p>{overview.players} Spieler | {overview.armies} Armeen</p>
              </article>
              <article className="stats-hero__feature">
                <span>Avg Dauer</span>
                <strong>{formatDuration(overview.averageDurationMs)}</strong>
                <p>{overview.averageRounds.toFixed(1)} Runden pro Spiel</p>
              </article>
              <article className="stats-hero__feature">
                <span>Avg Score gesamt</span>
                <strong>{overview.averageCombinedScore.toFixed(1)}</strong>
                <p>{overview.averageSpentCp.toFixed(1)} CP spent je Spieler</p>
              </article>
            </section>

            <CollapsibleSection
              title="Uebersicht"
              helper="Schneller Einstieg in die wichtigsten Kennzahlen"
              count={overview.games}
              open={openSections.overview}
              onToggle={() => toggleSection("overview")}
            >
              <div className="stats-grid">
                <StatCard label="Spiele" value={overview.games} />
                <StatCard label="Spieler" value={overview.players} />
                <StatCard label="Armeen" value={overview.armies} />
                <StatCard label="Avg Dauer" value={formatDuration(overview.averageDurationMs)} />
                <StatCard label="Avg Runden" value={overview.averageRounds.toFixed(1)} />
                <StatCard label="Avg Score gesamt" value={overview.averageCombinedScore.toFixed(1)} />
                <StatCard label="Avg CP spent" value={overview.averageSpentCp.toFixed(1)} />
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="Spieler"
              helper="Winrate, Score und Tempo pro Spieler"
              count={playerAggregates.length}
              open={openSections.players}
              onToggle={() => toggleSection("players")}
            >
              <div className="stack">
                {playerAggregates.map((player) => (
                  <article key={player.name} className="card stack stats-group-card">
                    <div className="stats-group-card__head">
                      <div>
                        <strong>{player.name}</strong>
                        <p>{player.games} Spiele</p>
                      </div>
                      <span className="meta-chip meta-chip--accent">{player.winRate.toFixed(0)}% Winrate</span>
                    </div>
                    <div className="stats-grid">
                      <StatCard label="W / L / T" value={`${player.wins} / ${player.losses} / ${player.ties}`} />
                      <StatCard label="Win% when go first" value={`${player.winRateWhenGoFirst.toFixed(0)}%`} />
                      <StatCard label="Win% when start first" value={`${player.winRateWhenStartFirst.toFixed(0)}%`} />
                      <StatCard label="Avg Primary" value={player.averagePrimary.toFixed(1)} />
                      <StatCard label="Avg Secondary" value={player.averageSecondary.toFixed(1)} />
                      <StatCard label="Avg Total" value={player.averageTotal.toFixed(1)} />
                      <StatCard label="Avg Dauer" value={formatDuration(player.averageDurationMs)} />
                      <StatCard label="Avg CP spent" value={player.averageSpentCp.toFixed(1)} />
                    </div>
                  </article>
                ))}
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="Primaermissionen"
              helper="Wer hat auf welcher Mission die beste Winrate"
              count={missionLeaders.length}
              open={openSections.missions}
              onToggle={() => toggleSection("missions")}
            >
              <div className="stack">
                {missionLeaders.map((mission) => (
                  <article key={mission.label} className="stats-row-card">
                    <div>
                      <strong>{mission.label}</strong>
                      <p>{mission.playerName}</p>
                    </div>
                    <div className="stats-row-card__metrics">
                      <div>
                        <span>Win%</span>
                        <strong>{mission.winRate.toFixed(0)}%</strong>
                      </div>
                      <div>
                        <span>Spiele</span>
                        <strong>{mission.games}</strong>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="Aufstellungen"
              helper="Wer performt auf welcher Aufstellung am besten"
              count={deploymentLeaders.length}
              open={openSections.deployments}
              onToggle={() => toggleSection("deployments")}
            >
              <div className="stack">
                {deploymentLeaders.map((deployment) => (
                  <article key={deployment.label} className="stats-row-card">
                    <div>
                      <strong>{deployment.label}</strong>
                      <p>{deployment.playerName}</p>
                    </div>
                    <div className="stats-row-card__metrics">
                      <div>
                        <span>Win%</span>
                        <strong>{deployment.winRate.toFixed(0)}%</strong>
                      </div>
                      <div>
                        <span>Spiele</span>
                        <strong>{deployment.games}</strong>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="Armeen"
              helper="Performance nach Fraktion / Armee"
              count={armyAggregates.length}
              open={openSections.armies}
              onToggle={() => toggleSection("armies")}
            >
              <div className="stack">
                {armyAggregates.map((army) => (
                  <article key={army.armyName} className="card stack stats-group-card">
                    <div className="stats-group-card__head">
                      <div>
                        <strong>{army.armyName}</strong>
                        <p>{army.games} Spiele</p>
                      </div>
                      <span className="meta-chip meta-chip--accent">{army.winRate.toFixed(0)}% Winrate</span>
                    </div>
                    <div className="stats-grid">
                      <StatCard label="W / L / T" value={`${army.wins} / ${army.losses} / ${army.ties}`} />
                      <StatCard label="Avg Primary" value={army.averagePrimary.toFixed(1)} />
                      <StatCard label="Avg Secondary" value={army.averageSecondary.toFixed(1)} />
                      <StatCard label="Avg Total" value={army.averageTotal.toFixed(1)} />
                    </div>
                  </article>
                ))}
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="Rundenzeiten"
              helper="Durchschnitt und Maximum je Rundennummer"
              count={roundDurationAggregates.length}
              open={openSections.rounds}
              onToggle={() => toggleSection("rounds")}
            >
              <div className="stack">
                {roundDurationAggregates.map((round) => (
                  <article key={round.roundNumber} className="stats-row-card">
                    <div>
                      <strong>Runde {round.roundNumber}</strong>
                      <p>{round.games} Spiele</p>
                    </div>
                    <div className="stats-row-card__metrics">
                      <div>
                        <span>Avg</span>
                        <strong>{formatDuration(round.averageDurationMs)}</strong>
                      </div>
                      <div>
                        <span>Max</span>
                        <strong>{formatDuration(round.maxDurationMs)}</strong>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="Zugrekorde"
              helper="Extremwerte ueber alle gefilterten Spiele"
              open={openSections.records}
              onToggle={() => toggleSection("records")}
            >
              <div className="record-grid">
                {turnRecords.longestTurn ? (
                  <article className="record-card">
                    <span className="record-card__label">Laengster Zug</span>
                    <strong className="record-card__value">
                      {formatDuration(turnRecords.longestTurn.durationMs)}
                    </strong>
                    <p>{turnRecords.longestTurn.playerName} | {turnRecords.longestTurn.armyName}</p>
                    <p>{formatDateLabel(turnRecords.longestTurn.scheduledDate, turnRecords.longestTurn.scheduledTime)}</p>
                    <p>R{turnRecords.longestTurn.roundNumber} / Z{turnRecords.longestTurn.turnNumber}</p>
                    <p className="record-card__scoreline">
                      Punkte im Zug: {turnRecords.longestTurn.totalScore} | Secondary: {turnRecords.longestTurn.secondaryScore}
                    </p>
                    <div className="record-card__metrics">
                      <div>
                        <span>Secondary</span>
                        <strong>{turnRecords.longestTurn.secondaryScore}</strong>
                      </div>
                      <div>
                        <span>Primary</span>
                        <strong>{turnRecords.longestTurn.primaryScore}</strong>
                      </div>
                      <div>
                        <span>Gesamt</span>
                        <strong>{turnRecords.longestTurn.totalScore}</strong>
                      </div>
                    </div>
                  </article>
                ) : null}
                {turnRecords.fastestTurn ? (
                  <article className="record-card record-card--accent">
                    <span className="record-card__label">Schnellster Zug</span>
                    <strong className="record-card__value">
                      {formatDuration(turnRecords.fastestTurn.durationMs)}
                    </strong>
                    <p>{turnRecords.fastestTurn.playerName} | {turnRecords.fastestTurn.armyName}</p>
                    <p>{formatDateLabel(turnRecords.fastestTurn.scheduledDate, turnRecords.fastestTurn.scheduledTime)}</p>
                    <p>R{turnRecords.fastestTurn.roundNumber} / Z{turnRecords.fastestTurn.turnNumber}</p>
                    <p className="record-card__scoreline">
                      Punkte im Zug: {turnRecords.fastestTurn.totalScore} | Secondary: {turnRecords.fastestTurn.secondaryScore}
                    </p>
                    <div className="record-card__metrics">
                      <div>
                        <span>Secondary</span>
                        <strong>{turnRecords.fastestTurn.secondaryScore}</strong>
                      </div>
                      <div>
                        <span>Primary</span>
                        <strong>{turnRecords.fastestTurn.primaryScore}</strong>
                      </div>
                      <div>
                        <span>Gesamt</span>
                        <strong>{turnRecords.fastestTurn.totalScore}</strong>
                      </div>
                    </div>
                  </article>
                ) : null}
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="Matchups"
              helper="Paarungen, Spieldauer und Score-Differenz"
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
                    <div className="stats-grid">
                      <StatCard label="Avg Dauer" value={formatDuration(matchup.averageDurationMs)} />
                      <StatCard label="Avg Score gesamt" value={matchup.averageCombinedScore.toFixed(1)} />
                      <StatCard label="Avg Score-Diff" value={matchup.averageScoreDifference.toFixed(1)} />
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
