"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rememberAccessMode = exports.loadRememberedAccessMode = exports.setAccessModeInMemory = exports.parseAccessModeMemory = exports.ACCESS_MODE_MEMORY_KEY = void 0;
// Gemerkte Auswahl "Match öffnen" (Edit / View only) pro Spiel und Gerät (localStorage).
// Gilt nur für laufende Spiele; der Passwortschutz (Entsperren abgeschlossener Spiele) bleibt unverändert.
exports.ACCESS_MODE_MEMORY_KEY = "match-tracker.access-mode.v1";
const MAX_ENTRIES = 200;
const isEntry = (value) => Boolean(value && typeof value === "object" &&
    (value.mode === "edit" || value.mode === "view") && typeof value.at === "string");
const parseAccessModeMemory = (raw) => {
    if (!raw)
        return {};
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            return {};
        return Object.fromEntries(Object.entries(parsed).filter(([, v]) => isEntry(v)));
    }
    catch {
        return {};
    }
};
exports.parseAccessModeMemory = parseAccessModeMemory;
const setAccessModeInMemory = (memory, gameId, mode, nowIso) => {
    const { [gameId]: _old, ...rest } = memory;
    if (!mode)
        return rest;
    const next = { ...rest, [gameId]: { mode, at: nowIso } };
    const keys = Object.keys(next);
    if (keys.length <= MAX_ENTRIES)
        return next;
    // Älteste Einträge zuerst verwerfen.
    const keep = keys.sort((a, b) => next[b].at.localeCompare(next[a].at)).slice(0, MAX_ENTRIES);
    return Object.fromEntries(keep.map((k) => [k, next[k]]));
};
exports.setAccessModeInMemory = setAccessModeInMemory;
const read = () => {
    try {
        return (0, exports.parseAccessModeMemory)(window.localStorage.getItem(exports.ACCESS_MODE_MEMORY_KEY));
    }
    catch {
        return {};
    }
};
const loadRememberedAccessMode = (gameId) => read()[gameId]?.mode ?? null;
exports.loadRememberedAccessMode = loadRememberedAccessMode;
const rememberAccessMode = (gameId, mode) => {
    try {
        window.localStorage.setItem(exports.ACCESS_MODE_MEMORY_KEY, JSON.stringify((0, exports.setAccessModeInMemory)(read(), gameId, mode, new Date().toISOString())));
    }
    catch {
        // Ohne localStorage fragt die App wie bisher.
    }
};
exports.rememberAccessMode = rememberAccessMode;
