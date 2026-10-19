"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBattleCalMenuItems = exports.isBattleCalEnabled = exports.syncBattleCalFlagFromUrl = exports.BATTLE_CAL_ROUTE = exports.BATTLE_CAL_FLAG_KEY = void 0;
// Battle-Cal hinter einem Schalter, seit Stufe E (19.10.2026) standardmaessig AN.
// Ausschalten: einmal die App mit ?battlecal=0 (oder #/...?battlecal=0) oeffnen -> merkt sich das Geraet im localStorage ("0").
// Wieder einschalten: ?battlecal=1. Ausgeschaltet: kein Menueeintrag, /#/battle-cal fuehrt zur Spieleliste.
exports.BATTLE_CAL_FLAG_KEY = "match-tracker.feature.battle-cal";
exports.BATTLE_CAL_ROUTE = "/battle-cal";
const storage = () => {
    try {
        return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
    }
    catch {
        return null;
    }
};
const readUrlFlag = () => {
    if (typeof window === "undefined")
        return null;
    const fromSearch = new URLSearchParams(window.location.search || "").get("battlecal");
    const hashQuery = (window.location.hash || "").split("?")[1] || "";
    const fromHash = new URLSearchParams(hashQuery).get("battlecal");
    return fromHash ?? fromSearch;
};
const syncBattleCalFlagFromUrl = () => {
    const value = readUrlFlag();
    const s = storage();
    if (!s || value === null)
        return;
    if (value === "1")
        s.setItem(exports.BATTLE_CAL_FLAG_KEY, "1");
    else if (value === "0")
        s.setItem(exports.BATTLE_CAL_FLAG_KEY, "0");
};
exports.syncBattleCalFlagFromUrl = syncBattleCalFlagFromUrl;
// Standard AN: nur ein ausdrueckliches "0" schaltet aus (ohne localStorage ebenfalls AN).
const isBattleCalEnabled = () => storage()?.getItem(exports.BATTLE_CAL_FLAG_KEY) !== "0";
exports.isBattleCalEnabled = isBattleCalEnabled;
const getBattleCalMenuItems = () => (0, exports.isBattleCalEnabled)() ? [{ label: "Battle-Cal", onClick: () => { window.location.hash = exports.BATTLE_CAL_ROUTE; } }] : [];
exports.getBattleCalMenuItems = getBattleCalMenuItems;
