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
let lastSyncedEndpoint: string | null = null;

const getLocalSubscription = async (): Promise<PushSubscription | null> => {
  try {
    const registration = await getRegistration();
    return (await registration?.pushManager?.getSubscription()) ?? null;
  } catch {
    return null;
  }
};

// Legt das Abo an (falls noetig) und speichert es samt Folgen in der DB. Nur nach erteilter Berechtigung aufrufen.
// renew: vorhandenes Browser-Abo verwerfen und neu anlegen (Server kennt es nicht mehr, z. B. nach 404/410 beim Versand).
export const subscribeAndSync = async (settings: PushFollowSettings, options: { renew?: boolean } = {}): Promise<{ ok: boolean; message?: string }> => {
  if (!VAPID_PUBLIC_KEY) return { ok: false, message: "Push ist auf dieser Version nicht eingerichtet." };
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return { ok: false, message: "Notifications sind nicht erlaubt." };
  try {
    const registration = await getRegistration();
    if (!registration?.pushManager) return { ok: false, message: "Dieser Browser kann keine Push-Meldungen." };
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && options.renew) {
      try { await subscription.unsubscribe(); } catch { /* ignoriert */ }
      subscription = null;
    }
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
    if (error) return { ok: false, message: "Anmeldung beim Server fehlgeschlagen. Push ist auf diesem Gerät nicht aktiv." };
    lastSyncedKey = getPushFollowSyncKey(settings);
    lastSyncedEndpoint = keys.endpoint;
    return { ok: true };
  } catch {
    return { ok: false, message: "Push-Anmeldung fehlgeschlagen. Push ist auf diesem Gerät nicht aktiv." };
  }
};

// Abgleich Browser <-> Server (bei jeder Aenderung und beim Oeffnen):
// - Fehlt das Abo im Browser (z. B. Berechtigung zurueckgenommen, Browser hat es verworfen), wird ein neues angelegt.
// - Hat sich der Endpoint geaendert, wird er neu gespeichert.
// - Kennt der Server das Abo nicht mehr (beim Versand als ungueltig entfernt), wird das Browser-Abo erneuert.
// Nur bei Erfolg gilt Push als aktiv; sonst zeigt die Oberflaeche ehrlich "nicht aktiv".
export const syncFollowsIfSubscribed = async (settings: PushFollowSettings): Promise<boolean> => {
  if (!VAPID_PUBLIC_KEY || typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  const local = await getLocalSubscription();
  if (!local) return (await subscribeAndSync(settings)).ok;
  if (local.endpoint !== lastSyncedEndpoint) return (await subscribeAndSync(settings)).ok;
  const key = getPushFollowSyncKey(settings);
  if (key === lastSyncedKey) return true;
  const { data, error } = await getSupabaseClient().rpc<{ subscribed?: boolean }>("mt_push_set_follows", getPushFollowRpcArgs(settings));
  if (error) return false;
  if (!data?.subscribed) return (await subscribeAndSync(settings, { renew: true })).ok;
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
  lastSyncedEndpoint = null;
};
