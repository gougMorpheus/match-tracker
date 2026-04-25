"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncRememberedPlayerNames = exports.rememberPlayerNames = exports.loadRememberedPlayerNames = void 0;
const PLAYER_PRESETS_KEY = "match-tracker.player-presets.v1";
const normalizeEntries = (entries) => Array.from(new Set(entries.map((entry) => entry.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right));
const loadRememberedPlayerNames = () => {
    try {
        const rawValue = window.localStorage.getItem(PLAYER_PRESETS_KEY);
        if (!rawValue) {
            return [];
        }
        const parsedValue = JSON.parse(rawValue);
        return Array.isArray(parsedValue) ? normalizeEntries(parsedValue.filter((entry) => typeof entry === "string")) : [];
    }
    catch {
        return [];
    }
};
exports.loadRememberedPlayerNames = loadRememberedPlayerNames;
const rememberPlayerNames = (names) => {
    const nextNames = normalizeEntries([...(0, exports.loadRememberedPlayerNames)(), ...names]);
    window.localStorage.setItem(PLAYER_PRESETS_KEY, JSON.stringify(nextNames));
    return nextNames;
};
exports.rememberPlayerNames = rememberPlayerNames;
const syncRememberedPlayerNames = (games) => {
    const nextNames = normalizeEntries(games.flatMap((game) => game.players.map((player) => player.name)));
    window.localStorage.setItem(PLAYER_PRESETS_KEY, JSON.stringify(nextNames));
    return nextNames;
};
exports.syncRememberedPlayerNames = syncRememberedPlayerNames;
