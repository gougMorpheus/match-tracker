// Ablauf der Netlify Function push-dispatch (ohne Netz-Details, damit testbar):
// 1) Spiel + sichtbare Events laden  2) Meldungen fuer das ausloesende Event ableiten (pushHighlights.ts =
// dieselbe Ableitung wie die Anzeige)  3) ERST in der Dedupe-Tabelle eintragen (claim, Unique(game_id, highlight_key))
// 4) nur gewonnene Meldungen senden  5) Abos mit 404/410 entfernen.
import { isSupabaseGameDeleted, type SupabaseEventRecord, type SupabaseGameRecord } from "./supabaseGameMapping";
import { buildGameFromRows, selectPushMessagesForEvent, type PushMessage } from "./pushHighlights";

export interface PushTarget { device_id: string; endpoint: string; p256dh: string; auth: string }
export interface PushDispatchDeps {
  loadGame: (gameId: string) => Promise<{ row: SupabaseGameRecord; events: SupabaseEventRecord[] } | null>;
  claim: (gameId: string, eventId: string, items: PushMessage[]) => Promise<string[]>;
  targets: (gameId: string) => Promise<PushTarget[]>;
  send: (target: PushTarget, payload: string) => Promise<{ statusCode: number }>;
  report: (gameId: string, keys: string[], stats: { recipients: number; delivered: number; failed: number; gone: string[]; ok: string[] }) => Promise<void>;
  now?: () => number;
}
export interface PushDispatchResult { status: string; candidates: number; claimed: string[]; recipients: number; delivered: number; failed: number; gone: number }

// Testspiele: alle Spielernamen beginnen mit "ZZ" -> kein Push (kein Claim, keine Dedupe-Zeile, kein Versand).
// "Statistik: Nicht zaehlen" allein ist KEIN Ausschlussgrund; Spiele mit mindestens einem echten Spieler werden gepusht.
export const isZzOnlyGame = (row: Pick<SupabaseGameRecord, "player1_name" | "player2_name">): boolean => {
  const names = [row.player1_name, row.player2_name].map((n) => (n ?? "").trim());
  return names.every((n) => n.startsWith("ZZ"));
};

export const toPushPayload = (m: PushMessage): string =>
  JSON.stringify({ title: m.title, body: m.body, gameId: m.gameId, tag: `${m.gameId}:${m.key}`, url: m.url });

export const runPushDispatch = async (gameId: string, eventId: string, deps: PushDispatchDeps): Promise<PushDispatchResult> => {
  const empty = (status: string, candidates = 0): PushDispatchResult => ({ status, candidates, claimed: [], recipients: 0, delivered: 0, failed: 0, gone: 0 });
  const loaded = await deps.loadGame(gameId);
  if (!loaded) return empty("no-game");
  if (isSupabaseGameDeleted(loaded.row)) return empty("deleted");
  if (isZzOnlyGame(loaded.row)) return empty("test-game");
  const game = buildGameFromRows(loaded.row, loaded.events);
  const messages = selectPushMessagesForEvent(game, eventId, (deps.now ?? Date.now)());
  if (!messages.length) return empty("nothing");
  const won = new Set(await deps.claim(gameId, eventId, messages));
  const toSend = messages.filter((m) => won.has(m.key));
  if (!toSend.length) return empty("duplicate", messages.length);
  const targets = await deps.targets(gameId);
  let delivered = 0, failed = 0;
  const gone = new Set<string>(), ok = new Set<string>();
  for (const m of toSend) {
    const payload = toPushPayload(m);
    await Promise.all(targets.filter((t) => !gone.has(t.device_id)).map(async (t) => {
      try {
        const res = await deps.send(t, payload);
        if (res.statusCode >= 200 && res.statusCode < 300) { delivered++; ok.add(t.device_id); } else failed++;
      } catch (error) {
        const code = (error as { statusCode?: number }).statusCode;
        failed++;
        if (code === 404 || code === 410) gone.add(t.device_id);
      }
    }));
  }
  await deps.report(gameId, toSend.map((m) => m.key), { recipients: targets.length, delivered, failed, gone: [...gone], ok: [...ok] });
  return { status: "sent", candidates: messages.length, claimed: toSend.map((m) => m.key), recipients: targets.length, delivered, failed, gone: gone.size };
};
