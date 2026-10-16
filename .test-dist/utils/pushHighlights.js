"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildGameFromRows = exports.isVisibleEventRow = exports.selectPushMessagesForEvent = exports.RECENT_PUSH_WINDOW_MS = exports.derivePushMessages = exports.toPushMessage = exports.getViewOnlyPath = exports.getPushKey = exports.derivePushHighlights = exports.getGameStartHighlight = void 0;
const gameCalculations_1 = require("./gameCalculations");
const eventOrder_1 = require("./eventOrder");
const tvHighlights_1 = require("./tvHighlights");
const supabaseGameMapping_1 = require("./supabaseGameMapping");
const START_ACTIONS = ["game-start", "setup-start", "round-start", "turn-start"];
// Spielstart: fruehester Start (game-start, Aufstellung, Runde oder Zug). Einmal pro Spiel (Schluessel "game-start").
const getGameStartHighlight = (game) => {
    const pick = game.timeEvents.filter((e) => START_ACTIONS.includes(e.action))
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
    if (!pick)
        return null;
    const [a, b] = game.players;
    const army = (name) => (name ? ` (${name})` : "");
    return { id: "highlight:game-start", kind: "game-start", title: "Spiel gestartet",
        subtitle: `${a.name}${army(a.army.name)} vs. ${b.name}${army(b.army.name)}`, createdAt: pick.createdAt };
};
exports.getGameStartHighlight = getGameStartHighlight;
// Alles, was gepusht werden kann: Spielstart + exakt die angezeigten Highlights.
const derivePushHighlights = (game) => {
    const start = (0, exports.getGameStartHighlight)(game);
    return [...(start ? [start] : []), ...(0, tvHighlights_1.deriveGameHighlights)(game)].sort(eventOrder_1.compareEventsAsc);
};
exports.derivePushHighlights = derivePushHighlights;
// Dedupe-Schluessel: Art + Zeitpunkt. Die Anzeige-IDs haengen an Event-ID bzw. Phase (z. B. r4t1). Live kommen
// Events derselben Sekunde aber nacheinander an (Rundenstart, dann Zugstart mit identischem Zeitstempel; mehrere
// Punkte-Events gleichzeitig) – die ID wuerde dann zwischen r4t0 und r4t1 wechseln und doppelt pushen.
// Art + Zeitpunkt bleibt dabei gleich. Innerhalb eines Spiels eindeutig (Zeit-Meilensteine tragen Spieler + Minuten in der Art).
const getPushKey = (h) => h.kind === "game-start" ? "game-start" : `${h.kind}@${new Date(Date.parse(h.createdAt)).toISOString()}`;
exports.getPushKey = getPushKey;
const getViewOnlyPath = (gameId) => `/#/game/${encodeURIComponent(gameId)}?tv=1`;
exports.getViewOnlyPath = getViewOnlyPath;
const scoreAt = (game, iso) => {
    const asOf = (0, tvHighlights_1.getGameAsOf)(game, iso);
    const total = asOf.players.map((p) => (0, gameCalculations_1.getPlayerComparableTotalScore)(asOf, p.id));
    return `${total[0] ?? "–"} : ${total[1] ?? "–"} VP`;
};
const toPushMessage = (game, h) => {
    const names = `${game.players[0].name} vs. ${game.players[1].name}`;
    // Spielstart nennt die Spieler schon; sonst Spieler + Text der Anzeige, Stand ergaenzen, falls er fehlt.
    const body = h.kind === "game-start" ? h.subtitle
        : `${names} · ${h.subtitle}${/VP/.test(h.subtitle) ? "" : ` · Stand ${scoreAt(game, h.createdAt)}`}`;
    return { key: (0, exports.getPushKey)(h), highlightId: h.id, kind: h.kind, title: h.title, body, createdAt: h.createdAt,
        gameId: game.id, url: (0, exports.getViewOnlyPath)(game.id) };
};
exports.toPushMessage = toPushMessage;
const derivePushMessages = (game) => (0, exports.derivePushHighlights)(game).map((h) => (0, exports.toPushMessage)(game, h));
exports.derivePushMessages = derivePushMessages;
// Welche Meldungen loest das Event `triggerEventId` aus? Nur Highlights ab dessen Zeitpunkt (spaeter eintreffende
// Events derselben Folge werden mitgenommen, der Dedupe verhindert Doppelte). Fruehere Highlights – auch solche,
// die sich durch ein Undo neu ergeben – werden nie (erneut) gepusht. maxAgeMs schuetzt vor Nachmeldungen alter
// Spiele (Import, lange offline gepufferte Events).
exports.RECENT_PUSH_WINDOW_MS = 30 * 60 * 1000;
const selectPushMessagesForEvent = (game, triggerEventId, nowMs, maxAgeMs = exports.RECENT_PUSH_WINDOW_MS) => {
    const all = [...game.timeEvents, ...game.scoreEvents, ...game.commandPointEvents, ...game.noteEvents];
    const trigger = all.find((e) => e.id === triggerEventId);
    // Nicht (mehr) sichtbar, z. B. schon per Undo zurueckgenommen: nichts senden.
    if (!trigger)
        return [];
    const from = Date.parse(trigger.createdAt);
    return (0, exports.derivePushMessages)(game).filter((m) => {
        const at = Date.parse(m.createdAt);
        return at >= from && nowMs - at <= maxAgeMs;
    });
};
exports.selectPushMessagesForEvent = selectPushMessagesForEvent;
// Sichtbare Zeilen wie fuer anon (RLS): widerrufene Events und Audit-Zeilen sind ausgeblendet.
const isVisibleEventRow = (e) => !e.revoked_by && e.event_type !== "revoke" && e.event_type !== "restore";
exports.isVisibleEventRow = isVisibleEventRow;
const buildGameFromRows = (row, events) => (0, supabaseGameMapping_1.mapSupabaseGameToAppGame)(row, events.filter(exports.isVisibleEventRow));
exports.buildGameFromRows = buildGameFromRows;
