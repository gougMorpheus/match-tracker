import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { GameCard } from "../components/GameCard";
import { Layout } from "../components/Layout";
import { seedGames } from "../data/seedGames";
import { useGameStore } from "../store/GameStore";
import { createInitialGameFilters, filterGames, getFilterOptions } from "../utils/gameCalculations";
import { parseImportedGames, exportGamesAsJson } from "../utils/importExport";

interface GamesPageProps {
  onOpenGame: (gameId: string) => void;
}

export const GamesPage = ({ onOpenGame }: GamesPageProps) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { games, importGames, isLoading, isMutating, errorMessage, clearError, refreshGames } =
    useGameStore();
  const [filters, setFilters] = useState(createInitialGameFilters);
  const filterOptions = useMemo(() => getFilterOptions(games), [games]);
  const filteredGames = useMemo(() => filterGames(games, filters), [games, filters]);

  const updateFilter = <K extends keyof typeof filters,>(key: K, value: (typeof filters)[K]) => {
    setFilters((current) => ({
      ...current,
      [key]: value
    }));
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const content = await file.text();
      const payload = parseImportedGames(content);
      await importGames(payload.games);
      window.alert(`${payload.games.length} Spiele importiert.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import fehlgeschlagen.";
      window.alert(message);
    } finally {
      event.target.value = "";
    }
  };

  return (
    <Layout title="40K Match-Tracker">
      <section className="stack">
        <div className="button-row button-row--compact">
          <button
            type="button"
            className="secondary-button compact-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isMutating}
          >
            Import
          </button>
          <button
            type="button"
            className="secondary-button compact-button"
            onClick={() => exportGamesAsJson(games)}
            disabled={!games.length || isLoading}
          >
            Export
          </button>
          <button
            type="button"
            className="secondary-button compact-button"
            onClick={() => void refreshGames()}
            disabled={isLoading || isMutating}
          >
            Update
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          hidden
          onChange={handleImport}
        />

        <section className="card stack">
          <div className="list-row">
            <h2>Filter</h2>
            <button
              type="button"
              className="ghost-button compact-button"
              onClick={() => setFilters(createInitialGameFilters())}
              disabled={isLoading}
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
          <p className="muted-copy">{filteredGames.length} Spiele sichtbar</p>
        </section>

        {errorMessage ? (
          <article className="notice-card notice-card--error">
            <div className="stack">
              <div>
                <h2>Verbindung fehlgeschlagen</h2>
                <p>{errorMessage}</p>
              </div>
              <button type="button" className="ghost-button" onClick={clearError}>
                Meldung ausblenden
              </button>
            </div>
          </article>
        ) : null}

        {isLoading ? (
          <article className="empty-state">
            <h2>Spiele werden geladen</h2>
            <p>Die Daten kommen direkt aus Supabase.</p>
          </article>
        ) : filteredGames.length ? (
          <div className="stack">
            {filteredGames.map((game) => (
              <GameCard key={game.id} game={game} onOpen={() => onOpenGame(game.id)} />
            ))}
          </div>
        ) : games.length ? (
          <article className="empty-state">
            <h2>Keine Treffer</h2>
            <p>Die aktuellen Filter passen zu keinem gespeicherten Spiel.</p>
          </article>
        ) : (
          <article className="empty-state">
            <h2>Noch keine Spiele</h2>
            <p>Lege ein Match an oder importiere vorhandene JSON-Daten.</p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void importGames(seedGames)}
              disabled={isMutating}
            >
              Demo laden
            </button>
          </article>
        )}
      </section>
    </Layout>
  );
};
