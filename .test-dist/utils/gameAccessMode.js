"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isGameWriteBlocked = exports.getGameRouteAccess = exports.getTvModeHash = exports.shouldShowClosedGameTv = exports.shouldShowSpectatorTv = exports.shouldOpenGameViewOnly = exports.shouldAskGameAccessMode = exports.isGameCompletedForDisplay = exports.isGameViewOnlyInState = exports.getGameAccessMode = exports.setGameAccessModeInState = void 0;
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
// Zuschauer sehen bei laufendem Spiel ausschliesslich den TV-Modus (TV-Link oder Wahl "Nur ansehen").
// Beendete Spiele behandelt shouldShowClosedGameTv (TV-Ansicht mit Spielmenue).
const shouldShowSpectatorTv = (game, mode, forceTv = false) => Boolean(game && !(0, exports.isGameCompletedForDisplay)(game) && (forceTv || mode === "view"));
exports.shouldShowSpectatorTv = shouldShowSpectatorTv;
// Beendete Spiele oeffnen fuer alle (Spieler und Zuschauer, mit oder ohne ?tv=1) im TV-Modus mit Menue.
// Nur waehrend des Entsperrens per Passwort (Modus "edit") nicht mehr, danach wie bisher in die Bearbeitung.
const shouldShowClosedGameTv = (game, mode) => Boolean(game && (0, exports.isGameCompletedForDisplay)(game) && mode !== "edit");
exports.shouldShowClosedGameTv = shouldShowClosedGameTv;
// Ziel des Buttons "TV-Modus" im Spiel (auch im Abschlussbildschirm).
const getTvModeHash = (gameId) => `/game/${gameId}?tv=1`;
exports.getTvModeHash = getTvModeHash;
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
