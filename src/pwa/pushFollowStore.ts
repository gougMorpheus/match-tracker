import { useSyncExternalStore } from "react";
import {
  PUSH_SETTINGS_KEY,
  loadPushFollowSettings,
  savePushFollowSettings,
  type PushFollowSettings
} from "../utils/pushFollow";

// Kleiner Speicher fuer die Folge-Einstellungen (localStorage, tab-uebergreifend per storage-Event).
const storage = (): Storage | null => {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; }
};

let current: PushFollowSettings | null = null;
const listeners = new Set<() => void>();

const read = (): PushFollowSettings => {
  if (!current) current = loadPushFollowSettings(storage());
  return current;
};

export const updatePushFollowSettings = (change: (settings: PushFollowSettings) => PushFollowSettings): void => {
  const next = change(read());
  if (next === current) return;
  current = next;
  savePushFollowSettings(storage(), next);
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== PUSH_SETTINGS_KEY) return;
    current = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
};

export const usePushFollowSettings = (): PushFollowSettings => useSyncExternalStore(subscribe, read, read);

// Oeffnen der Uebersicht bzw. des Hinweises von ueberall (Menues aller Seiten).
export const OPEN_NOTIFICATIONS_EVENT = "mt:open-notifications";
export const openNotificationsOverview = (mode: "overview" | "hint" = "overview"): void => {
  window.dispatchEvent(new CustomEvent(OPEN_NOTIFICATIONS_EVENT, { detail: { mode } }));
};
