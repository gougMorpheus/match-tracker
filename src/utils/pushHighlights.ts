// Push-Meldungen (Stufe b). Quelle ist GENAU dieselbe Ableitung wie Ereignisliste/Verlauf und TV-Einblendung:
// deriveGameHighlights (tvHighlights.ts). Dazu kommt nur der Spielstart. Wird von der App (Tests, Anzeige-Gleichheit)
// und von der Netlify Function (netlify/functions/push-dispatch.mts) importiert – keine zweite Implementierung.
import type { Game } from "../types/game";
import { getPlayerComparableTotalScore } from "./gameCalculations";
import { deriveGameHighlights, getGameAsOf, type DerivedHighlight } from "./tvHighlights";
import { mapSupabaseGameToAppGame, type SupabaseEventRecord, type SupabaseGameRecord } from "./supabaseGameMapping";

export interface PushMessage {
  // Eindeutig pro Spiel; Grundlage fuer die Dedupe-Tabelle (Unique game_id + highlight_key).
  key: string;
  highlightId: string;
  kind: string;
  title: string;
  body: string;
  createdAt: string;
  gameId: string;
  url: string;
}

const START_ACTIONS = ["game-start", "setup-start", "round-start", "turn-start"];

// Spielstart: fruehester Start (game-start, Aufstellung, Runde oder Zug). Einmal pro Spiel (Schluessel "game-start").
export const getGameStartHighlight = (game: Game): DerivedHighlight | null => {
  const pick = game.timeEvents.filter((e) => START_ACTIONS.includes(e.action))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
  if (!pick) return null;
  const [a, b] = game.players;
  const army = (name: string) => (name ? ` (${name})` : "");
  return { id: "highlight:game-start", kind: "game-start", title: "Spiel gestartet",
    subtitle: `${a.name}${army(a.army.name)} vs. ${b.name}${army(b.army.name)}`, createdAt: pick.createdAt };
};

// Alles, was gepusht werden kann: Spielstart + exakt die angezeigten Highlights.
export const derivePushHighlights = (game: Game): DerivedHighlight[] => {
  const start = getGameStartHighlight(game);
  return [...(start ? [start] : []), ...deriveGameHighlights(game)];
};

// Dedupe-Schluessel: Art + Zeitpunkt. Die Anzeige-IDs haengen an Event-ID bzw. Phase (z. B. r4t1). Live kommen
// Events derselben Sekunde aber nacheinander an (Rundenstart, dann Zugstart mit identischem Zeitstempel; mehrere
// Punkte-Events gleichzeitig) – die ID wuerde dann zwischen r4t0 und r4t1 wechseln und doppelt pushen.
// Art + Zeitpunkt bleibt dabei gleich. Innerhalb eines Spiels eindeutig (Zeit-Meilensteine tragen Spieler + Minuten in der Art).
export const getPushKey = (h: DerivedHighlight): string =>
  h.kind === "game-start" ? "game-start" : `${h.kind}@${new Date(Date.parse(h.createdAt)).toISOString()}`;

export const getViewOnlyPath = (gameId: string): string => `/#/game/${encodeURIComponent(gameId)}?tv=1`;

const scoreAt = (game: Game, iso: string): string => {
  const asOf = getGameAsOf(game, iso);
  const total = asOf.players.map((p) => getPlayerComparableTotalScore(asOf, p.id));
  return `${total[0] ?? "–"} : ${total[1] ?? "–"} VP`;
};

export const toPushMessage = (game: Game, h: DerivedHighlight): PushMessage => {
  const names = `${game.players[0].name} vs. ${game.players[1].name}`;
  // Spielstart nennt die Spieler schon; sonst Spieler + Text der Anzeige, Stand ergaenzen, falls er fehlt.
  const body = h.kind === "game-start" ? h.subtitle
    : `${names} · ${h.subtitle}${/VP/.test(h.subtitle) ? "" : ` · Stand ${scoreAt(game, h.createdAt)}`}`;
  return { key: getPushKey(h), highlightId: h.id, kind: h.kind, title: h.title, body, createdAt: h.createdAt,
    gameId: game.id, url: getViewOnlyPath(game.id) };
};

export const derivePushMessages = (game: Game): PushMessage[] => derivePushHighlights(game).map((h) => toPushMessage(game, h));

// Welche Meldungen loest das Event `triggerEventId` aus? Nur Highlights ab dessen Zeitpunkt (spaeter eintreffende
// Events derselben Folge werden mitgenommen, der Dedupe verhindert Doppelte). Fruehere Highlights – auch solche,
// die sich durch ein Undo neu ergeben – werden nie (erneut) gepusht. maxAgeMs schuetzt vor Nachmeldungen alter
// Spiele (Import, lange offline gepufferte Events).
export const RECENT_PUSH_WINDOW_MS = 30 * 60 * 1000;
export const selectPushMessagesForEvent = (game: Game, triggerEventId: string, nowMs: number,
  maxAgeMs = RECENT_PUSH_WINDOW_MS): PushMessage[] => {
  const all = [...game.timeEvents, ...game.scoreEvents, ...game.commandPointEvents, ...game.noteEvents];
  const trigger = all.find((e) => e.id === triggerEventId);
  // Nicht (mehr) sichtbar, z. B. schon per Undo zurueckgenommen: nichts senden.
  if (!trigger) return [];
  const from = Date.parse(trigger.createdAt);
  return derivePushMessages(game).filter((m) => {
    const at = Date.parse(m.createdAt);
    return at >= from && nowMs - at <= maxAgeMs;
  });
};

// Sichtbare Zeilen wie fuer anon (RLS): widerrufene Events und Audit-Zeilen sind ausgeblendet.
export const isVisibleEventRow = (e: SupabaseEventRecord): boolean =>
  !e.revoked_by && e.event_type !== "revoke" && e.event_type !== "restore";

export const buildGameFromRows = (row: SupabaseGameRecord, events: SupabaseEventRecord[]): Game =>
  mapSupabaseGameToAppGame(row, events.filter(isVisibleEventRow));
