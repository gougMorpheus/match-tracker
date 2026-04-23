import { useMemo, useState } from "react";
import { Layout } from "../components/Layout";
import { StatCard } from "../components/StatCard";
import { useGameStore } from "../store/GameStore";
import {
  createArmyAggregates,
  createInitialGameFilters,
  createMatchupAggregates,
  createPlayerAggregates,
  createStatsOverview,
  filterGames,
  getFilterOptions
} from "../utils/gameCalculations";
import { formatDuration } from "../utils/time";

interface StatsPageProps {
  onBack: () => void;
}

export const StatsPage = ({ onBack }: StatsPageProps) => {
  const { games, isLoading, errorMessage, clearError } = useGameStore();
  const [filters, setFilters] = useState(createInitialGameFilters);
  const filteredGames = useMemo(() => filterGames(games, filters), [games, filters]);
  const filterOptions = useMemo(() => getFilterOptions(games), [games]);
  const overview = useMemo(() => createStatsOverview(filteredGames), [filteredGames]);
  const playerAggregates = useMemo(() => createPlayerAggregates(filteredGames), [filteredGames]);
  const armyAggregates = useMemo(() => createArmyAggregates(filteredGames), [filteredGames]);
  const matchupAggregates = useMemo(() => createMatchupAggregates(filteredGames), [filteredGames]);

  const updateFilter = <K extends keyof typeof filters,>(key: K, value: (typeof filters)[K]) => {
    setFilters((current) => ({
      ...current,
      [key]: value
    }));
  };

  return (
    <Layout title="Statistik" subtitle="Filterbare Auswertung ueber alle synchronisierten Spiele" onBack={onBack}>
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

        <section className="card stack">
          <div className="list-row">
            <h2>Filter</h2>
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

        <div className="stats-grid">
          <StatCard label="Spiele" value={overview.games} />
          <StatCard label="Spieler" value={overview.players} />
          <StatCard label="Armeen" value={overview.armies} />
          <StatCard label="Avg Dauer" value={formatDuration(overview.averageDurationMs)} />
          <StatCard label="Avg Runden" value={overview.averageRounds.toFixed(1)} />
          <StatCard label="Avg Score gesamt" value={overview.averageCombinedScore.toFixed(1)} />
          <StatCard label="Avg CP spent" value={overview.averageSpentCp.toFixed(1)} />
        </div>

        {isLoading ? (
          <article className="empty-state">
            <h2>Statistik wird geladen</h2>
            <p>Spiele und Events werden aus Supabase gelesen.</p>
          </article>
        ) : filteredGames.length ? (
          <>
            <section className="stack">
              <div className="list-row">
                <h2>Spieler</h2>
                <span>{playerAggregates.length}</span>
              </div>
              {playerAggregates.map((player) => (
                <article key={player.name} className="card stack">
                  <div className="list-row">
                    <strong>{player.name}</strong>
                    <span>{player.games} Spiele</span>
                  </div>
                  <div className="stats-grid">
                    <StatCard label="W / L / T" value={`${player.wins} / ${player.losses} / ${player.ties}`} />
                    <StatCard label="Winrate" value={`${player.winRate.toFixed(0)}%`} />
                    <StatCard label="Avg Primary" value={player.averagePrimary.toFixed(1)} />
                    <StatCard label="Avg Secondary" value={player.averageSecondary.toFixed(1)} />
                    <StatCard label="Avg Total" value={player.averageTotal.toFixed(1)} />
                    <StatCard label="Avg Dauer" value={formatDuration(player.averageDurationMs)} />
                    <StatCard label="Avg CP spent" value={player.averageSpentCp.toFixed(1)} />
                  </div>
                </article>
              ))}
            </section>

            <section className="stack">
              <div className="list-row">
                <h2>Armeen</h2>
                <span>{armyAggregates.length}</span>
              </div>
              {armyAggregates.map((army) => (
                <article key={army.armyName} className="card stack">
                  <div className="list-row">
                    <strong>{army.armyName}</strong>
                    <span>{army.games} Spiele</span>
                  </div>
                  <div className="stats-grid">
                    <StatCard label="W / L / T" value={`${army.wins} / ${army.losses} / ${army.ties}`} />
                    <StatCard label="Winrate" value={`${army.winRate.toFixed(0)}%`} />
                    <StatCard label="Avg Primary" value={army.averagePrimary.toFixed(1)} />
                    <StatCard label="Avg Secondary" value={army.averageSecondary.toFixed(1)} />
                    <StatCard label="Avg Total" value={army.averageTotal.toFixed(1)} />
                  </div>
                </article>
              ))}
            </section>

            <section className="stack">
              <div className="list-row">
                <h2>Matchups</h2>
                <span>{matchupAggregates.length}</span>
              </div>
              {matchupAggregates.map((matchup) => (
                <article key={matchup.label} className="card stack">
                  <div className="list-row">
                    <strong>{matchup.label}</strong>
                    <span>{matchup.games} Spiele</span>
                  </div>
                  <div className="stats-grid">
                    <StatCard label="Avg Dauer" value={formatDuration(matchup.averageDurationMs)} />
                    <StatCard label="Avg Score gesamt" value={matchup.averageCombinedScore.toFixed(1)} />
                    <StatCard label="Avg Score-Diff" value={matchup.averageScoreDifference.toFixed(1)} />
                  </div>
                </article>
              ))}
            </section>
          </>
        ) : (
          <article className="empty-state">
            <h2>Keine Statistik verfuegbar</h2>
            <p>Mit den aktuellen Filtern wurden keine Spiele gefunden.</p>
          </article>
        )}
      </section>
    </Layout>
  );
};
