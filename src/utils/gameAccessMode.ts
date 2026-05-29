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

export const isGameCompletedForDisplay = (game: Game | undefined): boolean =>
  Boolean(
    game &&
      (game.status === "completed" ||
        game.endedAt ||
        game.timeEvents.some((event) => event.action === "game-end"))
  );

export const shouldAskGameAccessMode = (
  game: Game | undefined,
  mode: GameAccessMode | null
): boolean => Boolean(game && !isGameCompletedForDisplay(game) && !mode);

export const shouldOpenGameViewOnly = (
  game: Game | undefined,
  mode: GameAccessMode | null
): boolean => Boolean(game && (isGameCompletedForDisplay(game) || mode === "view"));
