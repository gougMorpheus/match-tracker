import { Layout } from "../components/Layout";
import { StatCard } from "../components/StatCard";
import { useGameStore } from "../store/GameStore";
import { createPlayerAggregates } from "../utils/gameCalculations";
import { formatDuration } from "../utils/time";

export const StatsPage = () => {
  const { games, isLoading, errorMessage, clearError } = useGameStore();
  const aggregates = createPlayerAggregates(games);

  return (
    <Layout title="Statistik" subtitle="Einfacher MVP-Ueberblick ueber synchronisierte Spiele">
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

        <div className="stats-grid">
          <StatCard label="Anzahl Spiele" value={games.length} />
          <StatCard
            label="Spieler"
            value={aggregates.length}
            helper="auf Basis der lokalen Namen"
          />
        </div>

        {isLoading ? (
          <article className="empty-state">
            <h2>Statistik wird geladen</h2>
            <p>Spiele und Events werden aus Supabase gelesen.</p>
          </article>
        ) : aggregates.length ? (
          <div className="stack">
            {aggregates.map((player) => (
              <article key={player.name} className="card stack">
                <div className="list-row">
                  <strong>{player.name}</strong>
                  <span>{player.games} Spiele</span>
                </div>
                <div className="stats-grid">
                  <StatCard label="W / L / T" value={`${player.wins} / ${player.losses} / ${player.ties}`} />
                  <StatCard label="Avg Primary" value={player.averagePrimary.toFixed(1)} />
                  <StatCard label="Avg Secondary" value={player.averageSecondary.toFixed(1)} />
                  <StatCard label="Avg Dauer" value={formatDuration(player.averageDurationMs)} />
                  <StatCard label="Avg CP spent" value={player.averageSpentCp.toFixed(1)} />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <article className="empty-state">
            <h2>Keine Statistik verfuegbar</h2>
            <p>Die Werte erscheinen automatisch, sobald Spiele gespeichert sind.</p>
          </article>
        )}
      </section>
    </Layout>
  );
};
