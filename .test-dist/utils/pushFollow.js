"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFollowedGameIds = exports.applyAutoFollow = exports.setAutoFollowNew = exports.toggleGameFollowed = exports.setGameFollowed = exports.isFollowingGame = exports.savePushFollowSettings = exports.loadPushFollowSettings = exports.parsePushFollowSettings = exports.createPushFollowSettings = exports.PUSH_SETTINGS_KEY = void 0;
const id_1 = require("./id");
// Folge-Einstellungen pro Geraet (Stufe a: nur localStorage, kein Login).
// Stufe (b) synchronisiert diese Struktur spaeter per device_id in die DB (Tabelle fuer Abos),
// deshalb: stabile UUID, Zeitstempel je Eintrag, explizit entfolgte Spiele, Schema-Version.
exports.PUSH_SETTINGS_KEY = "match-tracker.push-follow.v1";
const nowIso = () => new Date().toISOString();
const createPushFollowSettings = (deviceId = (0, id_1.createUuid)(), at = nowIso()) => ({
    schema: 1,
    deviceId,
    autoFollowNew: false,
    autoFollowSince: null,
    follows: {},
    unfollowed: {},
    updatedAt: at
});
exports.createPushFollowSettings = createPushFollowSettings;
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const parsePushFollowSettings = (raw) => {
    if (!raw)
        return null;
    try {
        const value = JSON.parse(raw);
        if (!isRecord(value) || value.schema !== 1 || typeof value.deviceId !== "string" || !value.deviceId)
            return null;
        const follows = {};
        if (isRecord(value.follows)) {
            for (const [gameId, entry] of Object.entries(value.follows)) {
                if (isRecord(entry) && typeof entry.followedAt === "string") {
                    follows[gameId] = { followedAt: entry.followedAt, source: entry.source === "auto" ? "auto" : "manual" };
                }
            }
        }
        const unfollowed = {};
        if (isRecord(value.unfollowed)) {
            for (const [gameId, at] of Object.entries(value.unfollowed))
                if (typeof at === "string")
                    unfollowed[gameId] = at;
        }
        return {
            schema: 1,
            deviceId: value.deviceId,
            autoFollowNew: value.autoFollowNew === true,
            autoFollowSince: typeof value.autoFollowSince === "string" ? value.autoFollowSince : null,
            follows,
            unfollowed,
            updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : nowIso()
        };
    }
    catch {
        return null;
    }
};
exports.parsePushFollowSettings = parsePushFollowSettings;
const loadPushFollowSettings = (storage) => {
    const parsed = storage ? (0, exports.parsePushFollowSettings)(storage.getItem(exports.PUSH_SETTINGS_KEY)) : null;
    if (parsed)
        return parsed;
    const fresh = (0, exports.createPushFollowSettings)();
    try {
        storage?.setItem(exports.PUSH_SETTINGS_KEY, JSON.stringify(fresh));
    }
    catch { /* privater Modus */ }
    return fresh;
};
exports.loadPushFollowSettings = loadPushFollowSettings;
const savePushFollowSettings = (storage, settings) => {
    try {
        storage?.setItem(exports.PUSH_SETTINGS_KEY, JSON.stringify(settings));
    }
    catch { /* privater Modus */ }
};
exports.savePushFollowSettings = savePushFollowSettings;
const isFollowingGame = (settings, gameId) => Boolean(settings.follows[gameId]);
exports.isFollowingGame = isFollowingGame;
const setGameFollowed = (settings, gameId, follow, at = nowIso()) => {
    const { [gameId]: _removed, ...restFollows } = settings.follows;
    const { [gameId]: _wasUnfollowed, ...restUnfollowed } = settings.unfollowed;
    return follow
        ? { ...settings, follows: { ...restFollows, [gameId]: { followedAt: at, source: "manual" } }, unfollowed: restUnfollowed, updatedAt: at }
        : { ...settings, follows: restFollows, unfollowed: { ...restUnfollowed, [gameId]: at }, updatedAt: at };
};
exports.setGameFollowed = setGameFollowed;
const toggleGameFollowed = (settings, gameId, at = nowIso()) => (0, exports.setGameFollowed)(settings, gameId, !(0, exports.isFollowingGame)(settings, gameId), at);
exports.toggleGameFollowed = toggleGameFollowed;
const setAutoFollowNew = (settings, enabled, at = nowIso()) => ({
    ...settings,
    autoFollowNew: enabled,
    autoFollowSince: enabled ? settings.autoFollowSince ?? at : null,
    updatedAt: at
});
exports.setAutoFollowNew = setAutoFollowNew;
// Neue Spiele (angelegt nach dem Einschalten) automatisch folgen, ausser sie wurden bewusst entfolgt.
const applyAutoFollow = (settings, games, at = nowIso()) => {
    if (!settings.autoFollowNew || !settings.autoFollowSince)
        return settings;
    const since = Date.parse(settings.autoFollowSince);
    const additions = {};
    for (const game of games) {
        if (!game.createdAt || settings.follows[game.id] || settings.unfollowed[game.id])
            continue;
        const created = Date.parse(game.createdAt);
        if (Number.isFinite(created) && created >= since)
            additions[game.id] = { followedAt: at, source: "auto" };
    }
    return Object.keys(additions).length
        ? { ...settings, follows: { ...settings.follows, ...additions }, updatedAt: at }
        : settings;
};
exports.applyAutoFollow = applyAutoFollow;
const getFollowedGameIds = (settings) => Object.entries(settings.follows)
    .sort(([, a], [, b]) => b.followedAt.localeCompare(a.followedAt))
    .map(([gameId]) => gameId);
exports.getFollowedGameIds = getFollowedGameIds;
