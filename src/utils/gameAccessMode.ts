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

// Route policy also protects initial cache/queue flushes before page effects run.
export const getGameRouteAccess = (hash: string, search = ""): { gameId: string | null; tv: boolean } => {
  const [path, query = ""] = hash.replace(/^#/, "").split("?");
  return {
    gameId: path.startsWith("/game/") ? path.split("/")[2] || null : null,
    tv: new URLSearchParams(query).get("tv") === "1" || new URLSearchParams(search).get("tv") === "1"
  };
};
export const isGameWriteBlocked = (
  modes: GameAccessModeState, gameId: string,
  route: { gameId: string | null; tv: boolean } = { gameId: null, tv: false }
): boolean => isGameViewOnlyInState(modes, gameId) ||
  (route.gameId === gameId && (route.tv || getGameAccessMode(modes, gameId) !== "edit"));
