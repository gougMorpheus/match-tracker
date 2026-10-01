"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isGameWriteBlocked = exports.getGameRouteAccess = exports.shouldOpenGameViewOnly = exports.shouldAskGameAccessMode = exports.isGameCompletedForDisplay = exports.isGameViewOnlyInState = exports.getGameAccessMode = exports.setGameAccessModeInState = void 0;
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
// Route policy also protects initial cache/queue flushes before page effects run.
const getGameRouteAccess = (hash, search = "") => {
    const [path, query = ""] = hash.replace(/^#/, "").split("?");
    return {
        gameId: path.startsWith("/game/") ? path.split("/")[2] || null : null,
        tv: new URLSearchParams(query).get("tv") === "1" || new URLSearchParams(search).get("tv") === "1"
    };
};
exports.getGameRouteAccess = getGameRouteAccess;
const isGameWriteBlocked = (modes, gameId, route = { gameId: null, tv: false }) => (0, exports.isGameViewOnlyInState)(modes, gameId) ||
    (route.gameId === gameId && (route.tv || (0, exports.getGameAccessMode)(modes, gameId) !== "edit"));
exports.isGameWriteBlocked = isGameWriteBlocked;
