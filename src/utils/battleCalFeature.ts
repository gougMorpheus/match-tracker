// Battle-Cal hinter einem Schalter, seit Stufe E (19.10.2026) standardmaessig AN.
// Ausschalten: einmal die App mit ?battlecal=0 (oder #/...?battlecal=0) oeffnen -> merkt sich das Geraet im localStorage ("0").
// Wieder einschalten: ?battlecal=1. Ausgeschaltet: kein Menueeintrag, /#/battle-cal fuehrt zur Spieleliste.
export const BATTLE_CAL_FLAG_KEY = "match-tracker.feature.battle-cal";
export const BATTLE_CAL_ROUTE = "/battle-cal";

const storage = (): Storage | null => {
  try { return typeof window !== "undefined" && window.localStorage ? window.localStorage : null; } catch { return null; }
};

const readUrlFlag = (): string | null => {
  if (typeof window === "undefined") return null;
  const fromSearch = new URLSearchParams(window.location.search || "").get("battlecal");
  const hashQuery = (window.location.hash || "").split("?")[1] || "";
  const fromHash = new URLSearchParams(hashQuery).get("battlecal");
  return fromHash ?? fromSearch;
};

export const syncBattleCalFlagFromUrl = (): void => {
  const value = readUrlFlag(); const s = storage();
  if (!s || value === null) return;
  if (value === "1") s.setItem(BATTLE_CAL_FLAG_KEY, "1");
  else if (value === "0") s.setItem(BATTLE_CAL_FLAG_KEY, "0");
};

// Standard AN: nur ein ausdrueckliches "0" schaltet aus (ohne localStorage ebenfalls AN).
export const isBattleCalEnabled = (): boolean => storage()?.getItem(BATTLE_CAL_FLAG_KEY) !== "0";

export const getBattleCalMenuItems = (): Array<{ label: string; onClick: () => void }> =>
  isBattleCalEnabled() ? [{ label: "Battle-Cal", onClick: () => { window.location.hash = BATTLE_CAL_ROUTE; } }] : [];
