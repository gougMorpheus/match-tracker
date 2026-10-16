// Stufe (b): echtes Web-Push-Abo dieses Geraets anlegen und gefolgte Spiele/Auto-Follow per RPC abgleichen.
// Endpoints/Schluessel gehen nur an mt_push_subscribe (security definer); lesbar sind sie mit dem Publishable Key nicht.
import { getSupabaseClient } from "../lib/supabase";
import { getPushFollowRpcArgs, getPushFollowSyncKey, urlBase64ToUint8Array, type PushFollowSettings } from "../utils/pushFollow";

export const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY ?? "").trim();

export type PushSyncState = "idle" | "working" | "subscribed" | "error";

const getRegistration = async (): Promise<ServiceWorkerRegistration | null> => {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) return navigator.serviceWorker.ready;
  // Dev/Preview ohne Registrierung: jetzt registrieren.
  await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  return navigator.serviceWorker.ready;
};

const toJson = (subscription: PushSubscription) => {
  const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  return { endpoint: json.endpoint ?? subscription.endpoint, p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" };
};

let lastSyncedKey: string | null = null;

// Legt das Abo an (falls noetig) und speichert es samt Folgen in der DB. Nur nach erteilter Berechtigung aufrufen.
export const subscribeAndSync = async (settings: PushFollowSettings): Promise<{ ok: boolean; message?: string }> => {
  if (!VAPID_PUBLIC_KEY) return { ok: false, message: "Push ist auf dieser Version nicht eingerichtet." };
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return { ok: false, message: "Notifications sind nicht erlaubt." };
  try {
    const registration = await getRegistration();
    if (!registration?.pushManager) return { ok: false, message: "Dieser Browser kann keine Push-Meldungen." };
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource });
    }
    const keys = toJson(subscription);
    const { error } = await getSupabaseClient().rpc("mt_push_subscribe", {
      ...getPushFollowRpcArgs(settings),
      p_endpoint: keys.endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth,
      p_user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 300) : null
    });
    if (error) return { ok: false, message: "Anmeldung beim Server fehlgeschlagen. Bitte später erneut versuchen." };
    lastSyncedKey = getPushFollowSyncKey(settings);
    return { ok: true };
  } catch {
    return { ok: false, message: "Push-Anmeldung fehlgeschlagen. Bitte später erneut versuchen." };
  }
};

// Folgen/Auto-Follow abgleichen (bei jeder Aenderung). Gibt es serverseitig noch kein Abo, wird es angelegt.
export const syncFollowsIfSubscribed = async (settings: PushFollowSettings): Promise<boolean> => {
  if (!VAPID_PUBLIC_KEY || typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  const key = getPushFollowSyncKey(settings);
  if (key === lastSyncedKey) return true;
  const { data, error } = await getSupabaseClient().rpc<{ subscribed?: boolean }>("mt_push_set_follows", getPushFollowRpcArgs(settings));
  if (error) return false;
  if (!data?.subscribed) return (await subscribeAndSync(settings)).ok;
  lastSyncedKey = key;
  return true;
};

// Abmelden: Abo im Browser kuendigen und in der DB entfernen.
export const unsubscribePush = async (settings: PushFollowSettings): Promise<void> => {
  try {
    const registration = await navigator.serviceWorker?.getRegistration("/");
    const subscription = await registration?.pushManager?.getSubscription();
    await getSupabaseClient().rpc("mt_push_unsubscribe", { p_device_id: settings.deviceId, p_endpoint: subscription?.endpoint ?? null });
    await subscription?.unsubscribe();
  } catch { /* ignoriert */ }
  lastSyncedKey = null;
};
