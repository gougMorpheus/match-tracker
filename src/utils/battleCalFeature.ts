// Battle-Cal (Vorschau) hinter einem Schalter, standardmaessig AUS.
// Einschalten: einmal die App mit ?battlecal=1 (oder #/...?battlecal=1) oeffnen -> merkt sich das Geraet im localStorage.
// Ausschalten: ?battlecal=0. Ohne Schalter: kein Menueeintrag, /#/battle-cal fuehrt zur Spieleliste.
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
  else if (value === "0") s.removeItem(BATTLE_CAL_FLAG_KEY);
};

export const isBattleCalEnabled = (): boolean => storage()?.getItem(BATTLE_CAL_FLAG_KEY) === "1";

export const getBattleCalMenuItems = (): Array<{ label: string; onClick: () => void }> =>
  isBattleCalEnabled() ? [{ label: "Battle-Cal", onClick: () => { window.location.hash = BATTLE_CAL_ROUTE; } }] : [];
