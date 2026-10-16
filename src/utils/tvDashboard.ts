import type { Game } from "../types/game";
import { getCurrentRoundNumber, getPlayerComparableTotalScore } from "./gameCalculations";
import { formatClockTime } from "./time";
import { AUTO_CP_SUFFIX, formatCpGroup, groupDisplayEvents, type EventGroup, type GroupableEvent } from "./eventGrouping";

export const TV_EVENT_LIMIT = 8;
// View only: Ereignisliste scrollbar, bis zu so vielen Eintraegen.
export const TV_FEED_SCROLL_LIMIT = 500;
export const getDeficitInfo = (game: Game) => {
  const [a, b] = game.players.map(p => getPlayerComparableTotalScore(game, p.id));
  const remainingRounds = Math.max(0, 5 - getCurrentRoundNumber(game));
  if (a === null || b === null) return { text: "Keine vergleichbaren VP", deficit: null, playerId: null, remainingRounds, perRound: null };
  if (a === b) return { text: "Gleichstand", deficit: 0, playerId: null, remainingRounds, perRound: null };
  const player = game.players[a < b ? 0 : 1], deficit = Math.abs(a - b);
  return { text: `${player.name} liegt ${deficit} VP zurück`, deficit, playerId: player.id, remainingRounds,
    perRound: remainingRounds > 0 && game.status !== "completed" ? Math.ceil(deficit / remainingRounds) : null };
};
export interface TvFeedEvent { id: string; createdAt: string; time: string; text: string; kind?: "highlight" }
const signed = (n: number) => `${n < 0 ? "−" : "+"}${Math.abs(n)}`;
// highlights: abgeleitete Highlights (deriveGameHighlights), erscheinen als eigene Ereignisart.
const SCORE_LABEL: Record<string, string> = { primary: "Primär", secondary: "Sekundär", challenge: "Herausforderung" };
const TIME_TEXT: Record<string, true> = { "round-start": true, "turn-start": true, "setup-start": true, "game-end": true, "timeout-start": true, "timeout-end": true, "turn-pause": true, "turn-resume": true };
type FeedSource = GroupableEvent & { highlightText?: string };
export const buildTvEventFeed = (game: Game, limit = TV_EVENT_LIMIT,
  highlights: { id: string; createdAt: string; title: string; subtitle: string }[] = []): TvFeedEvent[] => {
  const name = (id?: string) => game.players.find(p => p.id === id)?.name ?? "Spieler";
  const round = (n?: number) => n ? `Runde ${n} · ` : "";
  // Notizen werden nicht mehr angezeigt (Daten bleiben in der DB).
  const sources: FeedSource[] = [
    ...highlights.map(h => ({ id: h.id, createdAt: h.createdAt, kind: "highlight" as const, highlightText: `${h.title}: ${h.subtitle}` })),
    ...game.scoreEvents.map(e => ({ id: e.id, createdAt: e.createdAt, kind: "score" as const, playerId: e.playerId, roundNumber: e.roundNumber, turnNumber: e.turnNumber, scoreType: e.scoreType, value: e.value })),
    ...game.commandPointEvents.map(e => ({ id: e.id, createdAt: e.createdAt, kind: "cp" as const, playerId: e.playerId, roundNumber: e.roundNumber, turnNumber: e.turnNumber, cpType: e.cpType, value: e.value })),
    ...game.timeEvents.filter(e => TIME_TEXT[e.action]).map(e => ({ id: e.id, createdAt: e.createdAt, kind: "time" as const, playerId: e.playerId, roundNumber: e.roundNumber, turnNumber: e.turnNumber, timeAction: e.action }))
  ];
  const textOf = (g: EventGroup<FeedSource>): string => {
    const e = g.first;
    switch (g.kind) {
      case "highlight": return e.highlightText ?? "";
      case "score": return `${round(e.roundNumber)}${name(e.playerId)}: ${signed(g.scoreSum)} ${SCORE_LABEL[e.scoreType ?? ""] ?? "VP"}`;
      case "cp": return `${round(e.roundNumber)}${name(e.playerId)}: ${formatCpGroup(g)}`;
      default: {
        const auto = g.autoCp.length ? AUTO_CP_SUFFIX : "";
        switch (e.timeAction) {
          case "round-start": return `Runde ${e.roundNumber} beginnt`;
          case "turn-start": return `${round(e.roundNumber)}Zug ${e.turnNumber}: ${name(e.playerId)} ist am Zug${auto}`;
          case "setup-start": return "Aufstellung beginnt";
          case "game-end": return "Spiel beendet";
          case "timeout-start": return "Time-out beginnt";
          case "timeout-end": return "Time-out beendet";
          case "turn-pause": return `${name(e.playerId)}: Zug pausiert`;
          default: return `${name(e.playerId)}: Zug fortgesetzt`;
        }
      }
    }
  };
  // ID einer Gruppe = juengstes Event (stabil fuer Animationen, aendert sich, wenn ein Event dazukommt).
  return groupDisplayEvents(sources)
    .slice(0, Math.max(0, Math.floor(limit)))
    .map(g => ({ id: g.kind === "cp" || g.kind === "score" ? `group:${g.key}` : g.first.id, createdAt: g.createdAt, text: textOf(g), time: formatClockTime(g.createdAt), ...(g.kind === "highlight" ? { kind: "highlight" as const } : {}) }));
};

// Status-Chip der Zuschaueransicht. Der Zug startet nach "Weiter" aus der Aufstellung bewusst pausiert;
// solange noch keine Zugzeit gelaufen ist, heisst das "Zug noch nicht gestartet" statt "Pausiert".
export const getTvStatusLabel = (s: { completed: boolean; timeout: boolean; running: boolean; started: boolean; hasTurn: boolean; turnMs: number }): string => {
  if (s.completed) return "Beendet";
  if (s.timeout) return "Time-out";
  if (s.running) return "Läuft";
  if (!s.started) return "Bereit";
  if (s.hasTurn && s.turnMs < 1000) return "Zug noch nicht gestartet";
  return "Pausiert";
};
