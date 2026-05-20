"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldOpenGameViewOnly = exports.shouldAskGameAccessMode = exports.isGameViewOnlyInState = exports.getGameAccessMode = exports.setGameAccessModeInState = void 0;
const setGameAccessModeInState = (currentModes, gameId, mode) => {
    const { [gameId]: _currentMode, ...rest } = currentModes;
    return mode ? { ...rest, [gameId]: mode } : rest;
};
exports.setGameAccessModeInState = setGameAccessModeInState;
const getGameAccessMode = (modes, gameId) => modes[gameId] ?? null;
exports.getGameAccessMode = getGameAccessMode;
const isGameViewOnlyInState = (modes, gameId) => (0, exports.getGameAccessMode)(modes, gameId) === "view";
exports.isGameViewOnlyInState = isGameViewOnlyInState;
const shouldAskGameAccessMode = (game, mode) => Boolean(game && game.status === "active" && !mode);
exports.shouldAskGameAccessMode = shouldAskGameAccessMode;
const shouldOpenGameViewOnly = (game, mode) => Boolean(game && (game.status === "completed" || mode === "view"));
exports.shouldOpenGameViewOnly = shouldOpenGameViewOnly;
