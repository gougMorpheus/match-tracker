"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isGameWriteBlocked = exports.getGameRouteAccess = exports.getTvModeHash = exports.canReopenFromGamePage = exports.getViewOnlyMenuLabels = exports.shouldShowClosedGameTv = exports.shouldShowSpectatorTv = exports.shouldShowViewOnly = exports.shouldOpenGameViewOnly = exports.shouldAskGameAccessMode = exports.isGameCompletedForDisplay = exports.isGameViewOnlyInState = exports.getGameAccessMode = exports.setGameAccessModeInState = void 0;
const setGameAccessModeInState = (currentModes, gameId, mode) => {
    const { [gameId]: _currentMode, ...rest } = currentModes;
    return mode ? { ...rest, [gameId]: mode } : rest;
};
exports.setGameAccessModeInState = setGameAccessModeInState;
const getGameAccessMode = (modes, gameId) => modes[gameId] ?? null;
exports.getGameAccessMode = getGameAccessMode;
const isGameViewOnlyInState = (modes, gameId) => (0, exports.getGameAccessMode)(modes, gameId) === "view";
exports.isGameViewOnlyInState = isGameViewOnlyInState;
const isGameCompletedForDisplay = (game) => Boolean(game &&
    (game.status === "completed" ||
        game.endedAt ||
        game.timeEvents.some((event) => event.action === "game-end")));
exports.isGameCompletedForDisplay = isGameCompletedForDisplay;
const shouldAskGameAccessMode = (game, mode) => Boolean(game && !(0, exports.isGameCompletedForDisplay)(game) && !mode);
exports.shouldAskGameAccessMode = shouldAskGameAccessMode;
const shouldOpenGameViewOnly = (game, mode) => Boolean(game && ((0, exports.isGameCompletedForDisplay)(game) || mode === "view"));
exports.shouldOpenGameViewOnly = shouldOpenGameViewOnly;
// Zwei Modi: "Edit" und "View only". View only ist die TV-Ansicht (komplett schreibgeschuetzt).
// - Abgeschlossene Spiele: immer View only. Entsperren eroeffnet das Spiel wieder; erst dann (Spiel offen) Edit.
//   Es gibt keine alte Nur-Lesen-Uebersicht mehr, auch nicht im Modus "edit".
// - Laufende Spiele: View only per Dialogwahl ("view") oder View-only-Link (?tv=1).
const shouldShowViewOnly = (game, mode, forceTv = false) => {
    if (!game)
        return false;
    if ((0, exports.isGameCompletedForDisplay)(game))
        return true;
    return forceTv || mode === "view";
};
exports.shouldShowViewOnly = shouldShowViewOnly;
// Kompatibel: frueherer Name fuer laufende Spiele.
const shouldShowSpectatorTv = (game, mode, forceTv = false) => Boolean(game && !(0, exports.isGameCompletedForDisplay)(game) && (0, exports.shouldShowViewOnly)(game, mode, forceTv));
exports.shouldShowSpectatorTv = shouldShowSpectatorTv;
// Abgeschlossene Spiele in View only (fuer Menue "Entsperren").
const shouldShowClosedGameTv = (game, _mode) => Boolean(game && (0, exports.isGameCompletedForDisplay)(game));
exports.shouldShowClosedGameTv = shouldShowClosedGameTv;
// Menue der View-only-Ansicht: gleiche Navigation wie ueberall, Entsperren nur bei abgeschlossenem Spiel.
const getViewOnlyMenuLabels = (game) => ({
    navigation: ["Main", "Neues Spiel", "Statistik"],
    options: ["Verlauf", "Notizen", "Einstellungen", ...((0, exports.isGameCompletedForDisplay)(game) ? ["Entsperren"] : [])]
});
exports.getViewOnlyMenuLabels = getViewOnlyMenuLabels;
// Entsperren (Passwort) bei abgeschlossenem Spiel: nur im Modus "edit" darf die eigene Seite wieder eroeffnen.
const canReopenFromGamePage = (completed, openedHere, mode) => completed && (!openedHere || mode === "edit");
exports.canReopenFromGamePage = canReopenFromGamePage;
// Ziel des Buttons "TV-Modus" im Spiel (auch im Abschlussbildschirm).
const getTvModeHash = (gameId) => `/game/${gameId}?tv=1`;
exports.getTvModeHash = getTvModeHash;
// Alte Links (?mode=view, ?view=1, ?readonly=1, /overview) fuehren zu View only statt zur alten Ansicht.
const isLegacyViewParam = (params) => params.get("tv") === "1" || params.get("mode") === "view" || params.get("view") === "1" || params.get("readonly") === "1";
// Route policy also protects initial cache/queue flushes before page effects run.
const getGameRouteAccess = (hash, search = "") => {
    const [path, query = ""] = hash.replace(/^#/, "").split("?");
    return {
        gameId: path.startsWith("/game/") ? path.split("/")[2] || null : null,
        tv: isLegacyViewParam(new URLSearchParams(query)) || isLegacyViewParam(new URLSearchParams(search)) ||
            path.split("/")[3] === "overview"
    };
};
exports.getGameRouteAccess = getGameRouteAccess;
const isGameWriteBlocked = (modes, gameId, route = { gameId: null, tv: false }) => (0, exports.isGameViewOnlyInState)(modes, gameId) ||
    (route.gameId === gameId && (route.tv || (0, exports.getGameAccessMode)(modes, gameId) !== "edit"));
exports.isGameWriteBlocked = isGameWriteBlocked;
