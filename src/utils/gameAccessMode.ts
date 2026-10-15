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

// Zwei Modi: "Edit" und "View only". View only ist die TV-Ansicht (komplett schreibgeschuetzt).
// - Abgeschlossene Spiele: immer View only. Entsperren eroeffnet das Spiel wieder; erst dann (Spiel offen) Edit.
//   Es gibt keine alte Nur-Lesen-Uebersicht mehr, auch nicht im Modus "edit".
// - Laufende Spiele: View only per Dialogwahl ("view") oder View-only-Link (?tv=1).
export const shouldShowViewOnly = (
  game: Game | undefined,
  mode: GameAccessMode | null,
  forceTv = false
): boolean => {
  if (!game) return false;
  if (isGameCompletedForDisplay(game)) return true;
  return forceTv || mode === "view";
};

// Kompatibel: frueherer Name fuer laufende Spiele.
export const shouldShowSpectatorTv = (
  game: Game | undefined,
  mode: GameAccessMode | null,
  forceTv = false
): boolean => Boolean(game && !isGameCompletedForDisplay(game) && shouldShowViewOnly(game, mode, forceTv));

// Abgeschlossene Spiele in View only (fuer Menue "Entsperren").
export const shouldShowClosedGameTv = (
  game: Game | undefined,
  _mode: GameAccessMode | null
): boolean => Boolean(game && isGameCompletedForDisplay(game));

// Menue der View-only-Ansicht: gleiche Navigation wie ueberall, Entsperren nur bei abgeschlossenem Spiel.
export const getViewOnlyMenuLabels = (game: Game | undefined): { navigation: string[]; options: string[] } => ({
  navigation: ["Main", "Neues Spiel", "Statistik"],
  options: ["Verlauf", "Notizen", "Einstellungen", "Folgen", "Benachrichtigungen", ...(isGameCompletedForDisplay(game) ? ["Entsperren"] : [])]
});

// Entsperren (Passwort) bei abgeschlossenem Spiel: nur im Modus "edit" darf die eigene Seite wieder eroeffnen.
export const canReopenFromGamePage = (completed: boolean, openedHere: boolean, mode: GameAccessMode | null): boolean =>
  completed && (!openedHere || mode === "edit");

// Ziel des Buttons "TV-Modus" im Spiel (auch im Abschlussbildschirm).
export const getTvModeHash = (gameId: string): string => `/game/${gameId}?tv=1`;

// Alte Links (?mode=view, ?view=1, ?readonly=1, /overview) fuehren zu View only statt zur alten Ansicht.
const isLegacyViewParam = (params: URLSearchParams): boolean =>
  params.get("tv") === "1" || params.get("mode") === "view" || params.get("view") === "1" || params.get("readonly") === "1";

// Route policy also protects initial cache/queue flushes before page effects run.
export const getGameRouteAccess = (hash: string, search = ""): { gameId: string | null; tv: boolean } => {
  const [path, query = ""] = hash.replace(/^#/, "").split("?");
  return {
    gameId: path.startsWith("/game/") ? path.split("/")[2] || null : null,
    tv: isLegacyViewParam(new URLSearchParams(query)) || isLegacyViewParam(new URLSearchParams(search)) ||
      path.split("/")[3] === "overview"
  };
};
export const isGameWriteBlocked = (
  modes: GameAccessModeState, gameId: string,
  route: { gameId: string | null; tv: boolean } = { gameId: null, tv: false }
): boolean => isGameViewOnlyInState(modes, gameId) ||
  (route.gameId === gameId && (route.tv || getGameAccessMode(modes, gameId) !== "edit"));
