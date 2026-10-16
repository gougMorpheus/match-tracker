// Netlify Function: wird vom DB-Trigger (pg_net, AFTER INSERT ON events) aufgerufen.
// Prueft das Shared Secret, laedt den Verlauf mit dem Publishable Key (bestehende Leserechte, kein Service-Key),
// leitet die Meldungen mit dem App-Code ab (src/utils/pushHighlights.ts) und sendet per Web Push (VAPID).
import webpush from "web-push";
import { timingSafeEqual } from "node:crypto";
import { runPushDispatch, type PushTarget } from "../../src/utils/pushDispatch";
import type { SupabaseEventRecord, SupabaseGameRecord } from "../../src/utils/supabaseGameMapping";

const env = (name: string) => (process.env[name] ?? "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const sameSecret = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json(405, { error: "method" });
  const secret = env("PUSH_SHARED_SECRET");
  const given = req.headers.get("x-mt-push-secret") ?? "";
  if (secret.length < 32 || !sameSecret(given, secret)) return json(401, { error: "forbidden" });
  const base = env("VITE_SUPABASE_URL").replace(/\/$/, "");
  const key = env("VITE_SUPABASE_PUBLISHABLE_KEY");
  const vapidPublic = env("VAPID_PUBLIC_KEY"), vapidPrivate = env("VAPID_PRIVATE_KEY");
  if (!base || !key || !vapidPublic || !vapidPrivate) return json(500, { error: "config" });
  let body: { game_id?: string; event_id?: string };
  try { body = await req.json(); } catch { return json(400, { error: "json" }); }
  const gameId = String(body.game_id ?? ""), eventId = String(body.event_id ?? "");
  if (!UUID.test(gameId) || !UUID.test(eventId)) return json(400, { error: "ids" });

  const headers = { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" };
  const get = async <T,>(path: string): Promise<T> => {
    const res = await fetch(`${base}/rest/v1/${path}`, { headers });
    if (!res.ok) throw new Error(`GET ${path.split("?")[0]} ${res.status}`);
    return res.json() as Promise<T>;
  };
  const rpc = async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const res = await fetch(`${base}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify({ p_secret: secret, ...args }) });
    if (!res.ok) throw new Error(`rpc ${fn} ${res.status}`);
    return res.json() as Promise<T>;
  };
  webpush.setVapidDetails(env("VAPID_SUBJECT") || "https://40k-match-tracker.netlify.app", vapidPublic, vapidPrivate);

  try {
    const result = await runPushDispatch(gameId, eventId, {
      loadGame: async (id) => {
        const rows = await get<SupabaseGameRecord[]>(`games?select=*&id=eq.${id}`);
        if (!rows.length) return null;
        const events: SupabaseEventRecord[] = [];
        for (let offset = 0; ; offset += 1000) {
          const page = await get<SupabaseEventRecord[]>(`events?select=*&game_id=eq.${id}&order=created_at.asc,id.asc&limit=1000&offset=${offset}`);
          events.push(...page);
          if (page.length < 1000) break;
        }
        return { row: rows[0], events };
      },
      claim: (id, ev, items) => rpc<string[]>("mt_push_claim", { p_game_id: id, p_event_id: ev,
        p_items: items.map((m) => ({ key: m.key, title: m.title, body: m.body })) }),
      targets: (id) => rpc<PushTarget[]>("mt_push_targets", { p_game_id: id }),
      send: (t, payload) => webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, payload,
        { TTL: 3600, urgency: "high" }),
      report: async (id, keys, s) => { await rpc("mt_push_report", { p_game_id: id, p_keys: keys, p_recipients: s.recipients,
        p_delivered: s.delivered, p_failed: s.failed, p_gone: s.gone, p_ok: s.ok }); }
    });
    console.log(JSON.stringify({ game: gameId.slice(0, 8), event: eventId.slice(0, 8), ...result }));
    return json(200, result);
  } catch (error) {
    console.error("push-dispatch", String((error as Error).message ?? error));
    return json(502, { error: "dispatch" });
  }
};
