"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPushDispatch = exports.toPushPayload = exports.isZzOnlyGame = void 0;
// Ablauf der Netlify Function push-dispatch (ohne Netz-Details, damit testbar):
// 1) Spiel + sichtbare Events laden  2) Meldungen fuer das ausloesende Event ableiten (pushHighlights.ts =
// dieselbe Ableitung wie die Anzeige)  3) ERST in der Dedupe-Tabelle eintragen (claim, Unique(game_id, highlight_key))
// 4) nur gewonnene Meldungen senden  5) Abos mit 404/410 entfernen.
const supabaseGameMapping_1 = require("./supabaseGameMapping");
const pushHighlights_1 = require("./pushHighlights");
// Testspiele: alle Spielernamen beginnen mit "ZZ" -> kein Push (kein Claim, keine Dedupe-Zeile, kein Versand).
// "Statistik: Nicht zaehlen" allein ist KEIN Ausschlussgrund; Spiele mit mindestens einem echten Spieler werden gepusht.
const isZzOnlyGame = (row) => {
    const names = [row.player1_name, row.player2_name].map((n) => (n ?? "").trim());
    return names.every((n) => n.startsWith("ZZ"));
};
exports.isZzOnlyGame = isZzOnlyGame;
const toPushPayload = (m) => JSON.stringify({ title: m.title, body: m.body, gameId: m.gameId, tag: `${m.gameId}:${m.key}`, url: m.url });
exports.toPushPayload = toPushPayload;
const runPushDispatch = async (gameId, eventId, deps) => {
    const empty = (status, candidates = 0) => ({ status, candidates, claimed: [], recipients: 0, delivered: 0, failed: 0, gone: 0 });
    const loaded = await deps.loadGame(gameId);
    if (!loaded)
        return empty("no-game");
    if ((0, supabaseGameMapping_1.isSupabaseGameDeleted)(loaded.row))
        return empty("deleted");
    if ((0, exports.isZzOnlyGame)(loaded.row))
        return empty("test-game");
    const game = (0, pushHighlights_1.buildGameFromRows)(loaded.row, loaded.events);
    const messages = (0, pushHighlights_1.selectPushMessagesForEvent)(game, eventId, (deps.now ?? Date.now)());
    if (!messages.length)
        return empty("nothing");
    const won = new Set(await deps.claim(gameId, eventId, messages));
    const toSend = messages.filter((m) => won.has(m.key));
    if (!toSend.length)
        return empty("duplicate", messages.length);
    const targets = await deps.targets(gameId);
    let delivered = 0, failed = 0;
    const gone = new Set(), ok = new Set();
    for (const m of toSend) {
        const payload = (0, exports.toPushPayload)(m);
        await Promise.all(targets.filter((t) => !gone.has(t.device_id)).map(async (t) => {
            try {
                const res = await deps.send(t, payload);
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    delivered++;
                    ok.add(t.device_id);
                }
                else
                    failed++;
            }
            catch (error) {
                const code = error.statusCode;
                failed++;
                if (code === 404 || code === 410)
                    gone.add(t.device_id);
            }
        }));
    }
    await deps.report(gameId, toSend.map((m) => m.key), { recipients: targets.length, delivered, failed, gone: [...gone], ok: [...ok] });
    return { status: "sent", candidates: messages.length, claimed: toSend.map((m) => m.key), recipients: targets.length, delivered, failed, gone: gone.size };
};
exports.runPushDispatch = runPushDispatch;
