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
  const { games, importGames } = useGameStore();

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const content = await file.text();
      const payload = parseImportedGames(content);
      importGames(payload.games);
      window.alert(`${payload.games.length} Spiele importiert.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import fehlgeschlagen.";
      window.alert(message);
    } finally {
      event.target.value = "";
    }
  };

  return (
    <Layout
      title="Spiele"
      subtitle="Alle lokalen Matches im Browser"
      actions={
        <button type="button" className="primary-button" onClick={onCreateGame}>
          Neues Spiel
        </button>
      }
    >
      <section className="stack">
        <div className="button-row">
          <button
            type="button"
            className="secondary-button"
            onClick={() => fileInputRef.current?.click()}
          >
            Import
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => exportGamesAsJson(games)}
            disabled={!games.length}
          >
            Export all
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          hidden
          onChange={handleImport}
        />

        {games.length ? (
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
              onClick={() => importGames(seedGames)}
            >
              Demo laden
            </button>
          </article>
        )}
      </section>
    </Layout>
  );
};
