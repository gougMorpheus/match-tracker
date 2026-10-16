import type { GameAccessMode } from "./gameAccessMode";

// Gemerkte Auswahl "Match öffnen" (Edit / View only) pro Spiel und Gerät (localStorage).
// Gilt nur für laufende Spiele; der Passwortschutz (Entsperren abgeschlossener Spiele) bleibt unverändert.
export const ACCESS_MODE_MEMORY_KEY = "match-tracker.access-mode.v1";
const MAX_ENTRIES = 200;

type Entry = { mode: GameAccessMode; at: string };
type Memory = Record<string, Entry>;

const isEntry = (value: unknown): value is Entry =>
  Boolean(value && typeof value === "object" &&
    ((value as Entry).mode === "edit" || (value as Entry).mode === "view") && typeof (value as Entry).at === "string");

export const parseAccessModeMemory = (raw: string | null): Memory => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => isEntry(v))) as Memory;
  } catch {
    return {};
  }
};

export const setAccessModeInMemory = (memory: Memory, gameId: string, mode: GameAccessMode | null, nowIso: string): Memory => {
  const { [gameId]: _old, ...rest } = memory;
  if (!mode) return rest;
  const next: Memory = { ...rest, [gameId]: { mode, at: nowIso } };
  const keys = Object.keys(next);
  if (keys.length <= MAX_ENTRIES) return next;
  // Älteste Einträge zuerst verwerfen.
  const keep = keys.sort((a, b) => next[b].at.localeCompare(next[a].at)).slice(0, MAX_ENTRIES);
  return Object.fromEntries(keep.map((k) => [k, next[k]]));
};

const read = (): Memory => {
  try { return parseAccessModeMemory(window.localStorage.getItem(ACCESS_MODE_MEMORY_KEY)); } catch { return {}; }
};

export const loadRememberedAccessMode = (gameId: string): GameAccessMode | null => read()[gameId]?.mode ?? null;

export const rememberAccessMode = (gameId: string, mode: GameAccessMode | null): void => {
  try {
    window.localStorage.setItem(ACCESS_MODE_MEMORY_KEY,
      JSON.stringify(setAccessModeInMemory(read(), gameId, mode, new Date().toISOString())));
  } catch {
    // Ohne localStorage fragt die App wie bisher.
  }
};
