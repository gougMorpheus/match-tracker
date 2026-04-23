import { useRef, type ChangeEvent } from "react";
import { GameCard } from "../components/GameCard";
import { Layout } from "../components/Layout";
import { seedGames } from "../data/seedGames";
import { useGameStore } from "../store/GameStore";
import { parseImportedGames, exportGamesAsJson } from "../utils/importExport";

interface GamesPageProps {
  onOpenGame: (gameId: string) => void;
  onCreateGame: () => void;
}

export const GamesPage = ({ onOpenGame, onCreateGame }: GamesPageProps) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { games, importGames, isLoading, isMutating, errorMessage, clearError, refreshGames } =
    useGameStore();

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
        ) : games.length ? (
          <div className="stack">
            {games.map((game) => (
              <GameCard key={game.id} game={game} onOpen={() => onOpenGame(game.id)} />
            ))}
          </div>
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
