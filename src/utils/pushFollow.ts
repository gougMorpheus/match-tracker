import { createUuid } from "./id";

// Folge-Einstellungen pro Geraet (Stufe a: nur localStorage, kein Login).
// Stufe (b) synchronisiert diese Struktur spaeter per device_id in die DB (Tabelle fuer Abos),
// deshalb: stabile UUID, Zeitstempel je Eintrag, explizit entfolgte Spiele, Schema-Version.
export const PUSH_SETTINGS_KEY = "match-tracker.push-follow.v1";

export interface FollowEntry {
  followedAt: string;
  source: "manual" | "auto";
}

export interface PushFollowSettings {
  schema: 1;
  deviceId: string;
  autoFollowNew: boolean;
  // Ab wann "Neuen Spielen automatisch folgen" gilt (nur danach angelegte Spiele).
  autoFollowSince: string | null;
  follows: Record<string, FollowEntry>;
  // Manuell entfolgt: Auto-Folgen fuegt diese Spiele nicht wieder hinzu.
  unfollowed: Record<string, string>;
  updatedAt: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const nowIso = () => new Date().toISOString();

export const createPushFollowSettings = (deviceId = createUuid(), at = nowIso()): PushFollowSettings => ({
  schema: 1,
  deviceId,
  autoFollowNew: false,
  autoFollowSince: null,
  follows: {},
  unfollowed: {},
  updatedAt: at
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const parsePushFollowSettings = (raw: string | null): PushFollowSettings | null => {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value) || value.schema !== 1 || typeof value.deviceId !== "string" || !value.deviceId) return null;
    const follows: Record<string, FollowEntry> = {};
    if (isRecord(value.follows)) {
      for (const [gameId, entry] of Object.entries(value.follows)) {
        if (isRecord(entry) && typeof entry.followedAt === "string") {
          follows[gameId] = { followedAt: entry.followedAt, source: entry.source === "auto" ? "auto" : "manual" };
        }
      }
    }
    const unfollowed: Record<string, string> = {};
    if (isRecord(value.unfollowed)) {
      for (const [gameId, at] of Object.entries(value.unfollowed)) if (typeof at === "string") unfollowed[gameId] = at;
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
  } catch {
    return null;
  }
};

export const loadPushFollowSettings = (storage: StorageLike | null | undefined): PushFollowSettings => {
  const parsed = storage ? parsePushFollowSettings(storage.getItem(PUSH_SETTINGS_KEY)) : null;
  if (parsed) return parsed;
  const fresh = createPushFollowSettings();
  try { storage?.setItem(PUSH_SETTINGS_KEY, JSON.stringify(fresh)); } catch { /* privater Modus */ }
  return fresh;
};

export const savePushFollowSettings = (storage: StorageLike | null | undefined, settings: PushFollowSettings): void => {
  try { storage?.setItem(PUSH_SETTINGS_KEY, JSON.stringify(settings)); } catch { /* privater Modus */ }
};

export const isFollowingGame = (settings: PushFollowSettings, gameId: string): boolean => Boolean(settings.follows[gameId]);

export const setGameFollowed = (
  settings: PushFollowSettings, gameId: string, follow: boolean, at = nowIso()
): PushFollowSettings => {
  const { [gameId]: _removed, ...restFollows } = settings.follows;
  const { [gameId]: _wasUnfollowed, ...restUnfollowed } = settings.unfollowed;
  return follow
    ? { ...settings, follows: { ...restFollows, [gameId]: { followedAt: at, source: "manual" } }, unfollowed: restUnfollowed, updatedAt: at }
    : { ...settings, follows: restFollows, unfollowed: { ...restUnfollowed, [gameId]: at }, updatedAt: at };
};

export const toggleGameFollowed = (settings: PushFollowSettings, gameId: string, at = nowIso()): PushFollowSettings =>
  setGameFollowed(settings, gameId, !isFollowingGame(settings, gameId), at);

export const setAutoFollowNew = (settings: PushFollowSettings, enabled: boolean, at = nowIso()): PushFollowSettings => ({
  ...settings,
  autoFollowNew: enabled,
  autoFollowSince: enabled ? settings.autoFollowSince ?? at : null,
  updatedAt: at
});

// Neue Spiele (angelegt nach dem Einschalten) automatisch folgen, ausser sie wurden bewusst entfolgt.
export const applyAutoFollow = (
  settings: PushFollowSettings,
  games: Array<{ id: string; createdAt?: string | null }>,
  at = nowIso()
): PushFollowSettings => {
  if (!settings.autoFollowNew || !settings.autoFollowSince) return settings;
  const since = Date.parse(settings.autoFollowSince);
  const additions: Record<string, FollowEntry> = {};
  for (const game of games) {
    if (!game.createdAt || settings.follows[game.id] || settings.unfollowed[game.id]) continue;
    const created = Date.parse(game.createdAt);
    if (Number.isFinite(created) && created >= since) additions[game.id] = { followedAt: at, source: "auto" };
  }
  return Object.keys(additions).length
    ? { ...settings, follows: { ...settings.follows, ...additions }, updatedAt: at }
    : settings;
};

export const getFollowedGameIds = (settings: PushFollowSettings): string[] =>
  Object.entries(settings.follows)
    .sort(([, a], [, b]) => b.followedAt.localeCompare(a.followedAt))
    .map(([gameId]) => gameId);

// Geloeschte Spiele aus den gefolgten Spielen entfernen. Nur mit einer frisch vom Server geladenen Spieleliste
// aufrufen (sonst wuerden z. B. offline noch nicht geladene Spiele entfernt). Gibt bei keiner Aenderung dasselbe Objekt zurueck.
export const pruneDeletedFollows = (settings: PushFollowSettings, existingGameIds: Iterable<string>, at = nowIso()): PushFollowSettings => {
  const existing = new Set(existingGameIds);
  const gone = Object.keys(settings.follows).filter((id) => !existing.has(id));
  if (!gone.length) return settings;
  const follows = { ...settings.follows };
  for (const id of gone) delete follows[id];
  return { ...settings, follows, updatedAt: at };
};
