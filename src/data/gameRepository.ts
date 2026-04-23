import type { Game } from "../types/game";
import { STORAGE_KEY } from "./storage";

export interface GameRepository {
  load(): Game[];
  save(games: Game[]): void;
}

export const localGameRepository: GameRepository = {
  load() {
    try {
      const rawValue = window.localStorage.getItem(STORAGE_KEY);
      if (!rawValue) {
        return [];
      }

      const parsed = JSON.parse(rawValue);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed as Game[];
    } catch {
      return [];
    }
  },
  save(games) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(games));
  }
};
