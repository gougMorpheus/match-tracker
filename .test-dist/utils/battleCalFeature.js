"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBattleCalMenuItems = exports.isBattleCalEnabled = exports.syncBattleCalFlagFromUrl = exports.BATTLE_CAL_ROUTE = exports.BATTLE_CAL_FLAG_KEY = void 0;
// Battle-Cal (Vorschau) hinter einem Schalter, standardmaessig AUS.
// Einschalten: einmal die App mit ?battlecal=1 (oder #/...?battlecal=1) oeffnen -> merkt sich das Geraet im localStorage.
// Ausschalten: ?battlecal=0. Ohne Schalter: kein Menueeintrag, /#/battle-cal fuehrt zur Spieleliste.
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
        s.removeItem(exports.BATTLE_CAL_FLAG_KEY);
};
exports.syncBattleCalFlagFromUrl = syncBattleCalFlagFromUrl;
const isBattleCalEnabled = () => storage()?.getItem(exports.BATTLE_CAL_FLAG_KEY) === "1";
exports.isBattleCalEnabled = isBattleCalEnabled;
const getBattleCalMenuItems = () => (0, exports.isBattleCalEnabled)() ? [{ label: "Battle-Cal", onClick: () => { window.location.hash = exports.BATTLE_CAL_ROUTE; } }] : [];
exports.getBattleCalMenuItems = getBattleCalMenuItems;
