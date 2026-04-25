"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportGamesAsJson = exports.parseImportedGames = void 0;
const isObject = (value) => typeof value === "object" && value !== null;
const looksLikeGame = (value) => {
    if (!isObject(value)) {
        return false;
    }
    return (typeof value.id === "string" &&
        Array.isArray(value.players) &&
        Array.isArray(value.rounds) &&
        Array.isArray(value.scoreEvents) &&
        Array.isArray(value.commandPointEvents) &&
        Array.isArray(value.noteEvents) &&
        Array.isArray(value.timeEvents));
};
const parseImportedGames = (rawContent) => {
    const parsed = JSON.parse(rawContent);
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
exports.parseImportedGames = parseImportedGames;
const exportGamesAsJson = (games) => {
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
exports.exportGamesAsJson = exportGamesAsJson;
