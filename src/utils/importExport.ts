import type { Game, GameImportPayload } from "../types/game";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const looksLikeGame = (value: unknown): value is Game => {
  if (!isObject(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    Array.isArray(value.players) &&
    Array.isArray(value.rounds) &&
    Array.isArray(value.scoreEvents) &&
    Array.isArray(value.commandPointEvents) &&
    Array.isArray(value.noteEvents) &&
    Array.isArray(value.timeEvents)
  );
};

export const parseImportedGames = (rawContent: string): GameImportPayload => {
  const parsed = JSON.parse(rawContent) as unknown;

  if (Array.isArray(parsed)) {
    const games = parsed.filter(looksLikeGame);
    if (games.length !== parsed.length) {
      throw new Error("Die Datei enthaelt ungueltige Spieleintraege.");
    }

    return { games };
  }

  if (isObject(parsed) && Array.isArray(parsed.games)) {
    const games = parsed.games.filter(looksLikeGame);
    if (games.length !== parsed.games.length) {
      throw new Error("Die Datei enthaelt ungueltige Spieleintraege.");
    }

    return { games };
  }

  throw new Error("Die Datei hat kein gueltiges Match-Tracker-Format.");
};

export const exportGamesAsJson = (games: Game[]): void => {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), games }, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `match-tracker-export-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
};
