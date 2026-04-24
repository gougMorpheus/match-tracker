import type { Game } from "../types/game";

const PLAYER_PRESETS_KEY = "match-tracker.player-presets.v1";

const normalizeEntries = (entries: string[]): string[] =>
  Array.from(
    new Set(entries.map((entry) => entry.trim()).filter(Boolean))
  ).sort((left, right) => left.localeCompare(right));

export const loadRememberedPlayerNames = (): string[] => {
  try {
    const rawValue = window.localStorage.getItem(PLAYER_PRESETS_KEY);
    if (!rawValue) {
      return [];
    }

    const parsedValue = JSON.parse(rawValue);
    return Array.isArray(parsedValue) ? normalizeEntries(parsedValue.filter((entry) => typeof entry === "string")) : [];
  } catch {
    return [];
  }
};

export const rememberPlayerNames = (names: string[]): string[] => {
  const nextNames = normalizeEntries([...loadRememberedPlayerNames(), ...names]);
  window.localStorage.setItem(PLAYER_PRESETS_KEY, JSON.stringify(nextNames));
  return nextNames;
};

export const syncRememberedPlayerNames = (games: Game[]): string[] => {
  const nextNames = normalizeEntries(
    games.flatMap((game) => game.players.map((player) => player.name))
  );
  window.localStorage.setItem(PLAYER_PRESETS_KEY, JSON.stringify(nextNames));
  return nextNames;
};
