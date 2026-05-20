import type { Game } from "../types/game";

export type GameAccessMode = "edit" | "view";
export type GameAccessModeState = Record<string, GameAccessMode>;

export const setGameAccessModeInState = (
  currentModes: GameAccessModeState,
  gameId: string,
  mode: GameAccessMode | null
): GameAccessModeState => {
  const { [gameId]: _currentMode, ...rest } = currentModes;
  return mode ? { ...rest, [gameId]: mode } : rest;
};

export const getGameAccessMode = (
  modes: GameAccessModeState,
  gameId: string
): GameAccessMode | null => modes[gameId] ?? null;

export const isGameViewOnlyInState = (
  modes: GameAccessModeState,
  gameId: string
): boolean => getGameAccessMode(modes, gameId) === "view";

export const shouldAskGameAccessMode = (
  game: Game | undefined,
  mode: GameAccessMode | null
): boolean => Boolean(game && game.status === "active" && !mode);

export const shouldOpenGameViewOnly = (
  game: Game | undefined,
  mode: GameAccessMode | null
): boolean => Boolean(game && (game.status === "completed" || mode === "view"));
