import type { Game } from "../types/game";
import { getCurrentRoundNumber, getCurrentTurnNumber, getPlayerComparableTotalScore,
  getPlayerComparablePrimaryScore, getPlayerComparableSecondaryScore, getPlayerRoundScoreTotal,
  getPlayerTurnDurationTotalMs, getTurnDurationMs } from "./gameCalculations";
import { getGameOutcome } from "./headToHead";
import { syncDerivedGameState } from "./gameState";

export interface TvSnapshot {
  phaseKey: string; round: number; completed: boolean; winnerId: string | null;
  total: (number | null)[]; primary: (number | null)[]; secondary: (number | null)[];
  timeMs: number[]; roundPoints: (number | null)[][]; leaderId: string | null;
  // Carries the last non-tied leader across a tied phase boundary.
  lastLeaderId: string | null;
}
export interface TvHighlight { id: string; kind: string; title: string; subtitle: string; playerId?: string }
export type HighlightRule = (prev: TvSnapshot, next: TvSnapshot, game: Game) => TvHighlight[];
export const createTvSnapshot = (game: Game, nowIso: string): TvSnapshot => {
  const round = getCurrentRoundNumber(game), completed = game.status === "completed";
  const total = game.players.map(p => getPlayerComparableTotalScore(game, p.id));
  const leaderId = total[0] !== null && total[1] !== null && total[0] !== total[1] ? game.players[total[0] > total[1] ? 0 : 1].id : null;
  // Supply an explicit end fallback to existing timer calculations, keeping this pure.
  const atNow = { ...game, endedAt: game.endedAt ?? nowIso };
  return { phaseKey: `r${round}t${getCurrentTurnNumber(game)}:${completed}`, round, completed,
    winnerId: getGameOutcome(game)?.winnerId ?? null, total, leaderId, lastLeaderId: leaderId,
    primary: game.players.map(p => getPlayerComparablePrimaryScore(game, p.id)),
    secondary: game.players.map(p => getPlayerComparableSecondaryScore(game, p.id)),
    timeMs: game.players.map(p => getPlayerTurnDurationTotalMs(atNow, p.id)),
    roundPoints: Array.from({ length: 5 }, (_, r) => game.players.map(p => game.scoreDetailLevel === "full" || game.scoreEvents.some(e => e.scoreType === "legacy-total" && e.roundNumber !== undefined) ? getPlayerRoundScoreTotal(game, p.id, r + 1) : null)) };
};
const highlight = (next: TvSnapshot, kind: string, title: string, subtitle: string, playerId?: string): TvHighlight =>
  ({ id: `${kind}:${next.phaseKey}`, kind, title, subtitle, playerId });
const scoreLabel = (next: TvSnapshot) => `${next.total[0] ?? "–"} : ${next.total[1] ?? "–"} VP`;
// Round time leaders are derived from the complete round history, independent of
// the viewer's initial snapshot. A margin below one minute has no leader.
const roundTimeChange: HighlightRule = (prev, next, game) => {
  const roundNumber = next.round > prev.round ? next.round - 1 :
    !prev.completed && next.completed ? next.round : 0;
  if (roundNumber < 2) return [];
  const totals = [0, 0];
  let lastLeader: number | null = null;
  for (let r = 1; r <= roundNumber; r++) {
    const round = game.rounds.find(item => item.roundNumber === r);
    // Never evaluate an unfinished round at an early concession/game end.
    if (!round || !(next.round > r || round.endedAt || game.timeEvents.some(e => e.action === "round-end" && e.roundNumber === r)) ||
        round.turns.some(t => !t.timing.endedAt)) return [];
    game.players.forEach((p, i) => {
      totals[i] += round.turns.filter(t => t.playerId === p.id).reduce((sum, t) => sum + getTurnDurationMs(t, game), 0);
    });
    const leader = Math.abs(totals[0] - totals[1]) >= 60000 ? (totals[0] > totals[1] ? 0 : 1) : null;
    if (r === roundNumber && leader !== null && lastLeader !== null && leader !== lastLeader) {
      const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
      const player = game.players[leader];
      return [{ id: `time-overtake:r${r}`, kind: "time-overtake", title: "Zeit-Duell",
        subtitle: `${player.name} hat jetzt mehr Spielerzeit verbraucht · ${clock(totals[leader])} vs. ${clock(totals[1 - leader])}`, playerId: player.id }];
    }
    if (leader !== null) lastLeader = leader;
  }
  return [];
};
export const HIGHLIGHT_RULES: HighlightRule[] = [
  roundTimeChange,
  (prev, next, game) => {
    const before = prev.leaderId ?? prev.lastLeaderId;
    if (before && next.leaderId && before !== next.leaderId)
      return [highlight(next, "lead-change", "Führungswechsel", `${game.players.find(p => p.id === next.leaderId)?.name} übernimmt die Führung · ${scoreLabel(next)}`, next.leaderId)];
    if (prev.leaderId && !next.leaderId && next.total.every(v => v !== null) && next.total[0] === next.total[1])
      return [highlight(next, "equalizer", "Ausgleich", scoreLabel(next))];
    return [];
  },
  (prev, next, game) => {
    if ([...prev.total, ...next.total].some(v => v === null)) return [];
    const oldGap = Math.abs(prev.total[0]! - prev.total[1]!), gap = Math.abs(next.total[0]! - next.total[1]!);
    if (oldGap >= 6 || gap < 6) return [];
    const player = game.players[next.total[0]! < next.total[1]! ? 0 : 1];
    return [highlight(next, "challenge", "Herausforderungskarten verfügbar", `${player.name} liegt ${gap} VP zurück`, player.id)];
  },
  (prev, next, game) => {
    const result: TvHighlight[] = [];
    game.players.forEach((p, i) => {
      const minutes = next.timeMs[i] / 60000;
      const thresholds = [30, 45, 60];
      for (let m = 120; m <= minutes; m += 60) thresholds.push(m);
      for (const m of thresholds) if (prev.timeMs[i] < m * 60000 && next.timeMs[i] >= m * 60000)
        result.push(highlight(next, `time-milestone-${i}-${m}`, m < 60 ? `${m} Minuten` : `${m / 60} ${m === 60 ? "Stunde" : "Stunden"}`, `${p.name} · verbrauchte Spielerzeit`, p.id));
    });
    return result;
  },
  (prev, next, game) => {
    if (next.round <= prev.round || prev.round < 1) return [];
    const points = next.roundPoints[prev.round - 1];
    return [highlight(next, "round-summary", `Runde ${prev.round} abgeschlossen`, `${game.players[0].name} ${points[0] ?? "–"} VP · ${game.players[1].name} ${points[1] ?? "–"} VP · Stand ${scoreLabel(next)}`)];
  },
  (prev, next, game) => {
    if (prev.completed || !next.completed) return [];
    const outcome = getGameOutcome(game);
    const winner = game.players.find(p => p.id === outcome?.winnerId);
    return [highlight(next, "game-end", winner ? `${winner.name} gewinnt` : outcome?.draw ? "Unentschieden" : "Spiel beendet", `Endstand ${scoreLabel(next)}`, winner?.id)];
  }
];
export const detectTvHighlights = (prev: TvSnapshot, next: TvSnapshot, game: Game, rules = HIGHLIGHT_RULES): TvHighlight[] =>
  prev.phaseKey === next.phaseKey ? [] : rules.flatMap(rule => rule(prev, next, game));

// Abgeleitete Highlights fuer Ereignisliste und Verlauf: werden aus den bestehenden (nicht widerrufenen) Events
// berechnet, nie gespeichert. Ablauf: Spielstand an jeder Phasengrenze (Runden-/Zugstart, Spielende) rekonstruieren
// und dieselben HIGHLIGHT_RULES wie die TV-Einblendung anwenden. Undo/Gegenereignisse wirken dadurch automatisch.
export interface DerivedHighlight extends TvHighlight { createdAt: string; roundNumber?: number; turnNumber?: number }
const PHASE_ACTIONS = new Set(["round-start", "turn-start", "game-end"]);
export const getGameAsOf = (game: Game, iso: string): Game => {
  const until = Date.parse(iso);
  const keep = <T extends { createdAt: string }>(items: T[]) => items.filter(e => Date.parse(e.createdAt) <= until);
  const timeEvents = keep(game.timeEvents);
  const ended = timeEvents.some(e => e.action === "game-end");
  return syncDerivedGameState({ ...game, timeEvents, scoreEvents: keep(game.scoreEvents),
    commandPointEvents: keep(game.commandPointEvents), noteEvents: keep(game.noteEvents),
    endedAt: ended ? game.endedAt : undefined, finishReason: ended ? game.finishReason : undefined,
    // Altdaten-Summen ohne Zeitstempel gehoeren zum Endstand.
    legacyScoreTotals: ended ? game.legacyScoreTotals : {} });
};
export const deriveGameHighlights = (game: Game, rules = HIGHLIGHT_RULES): DerivedHighlight[] => {
  const boundaries = [...new Set(game.timeEvents.filter(e => PHASE_ACTIONS.has(e.action)).map(e => e.createdAt))]
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  const result: DerivedHighlight[] = [];
  const seen = new Set<string>();
  let prev: TvSnapshot | null = null;
  for (const at of boundaries) {
    const asOf = getGameAsOf(game, at);
    const next = createTvSnapshot(asOf, asOf.endedAt ?? at);
    if (!prev) { prev = next; continue; }
    if (prev.phaseKey === next.phaseKey) continue;
    for (const h of detectTvHighlights(prev, next, asOf, rules)) {
      // Fuehrungswechsel/Ausgleich kommen aus deriveScoreLeadHighlights (pro Punkte-Event).
      if (SCORE_DRIVEN_KINDS.has(h.kind)) continue;
      if (seen.has(h.id)) continue;
      seen.add(h.id);
      result.push({ ...h, id: `highlight:${h.id}`, createdAt: at, roundNumber: getCurrentRoundNumber(asOf), turnNumber: getCurrentTurnNumber(asOf) });
    }
    next.lastLeaderId = next.leaderId ?? prev.lastLeaderId;
    prev = next;
  }
  return [...result, ...deriveScoreLeadHighlights(game)]
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
};

// Fehlerbild 15.10.: Fuehrungswechsel innerhalb eines Zugs fehlten, weil der Stand nur an Phasengrenzen
// verglichen wurde. Jetzt: Stand nach JEDEM (nicht widerrufenen) Punkte-Event. Widerrufene Events (Undo)
// sind schon aus game.scoreEvents entfernt, negative Korrekturen gehen in die Summe ein.
export const SCORE_DRIVEN_KINDS = new Set(["lead-change", "equalizer"]);
export const deriveScoreLeadHighlights = (game: Game): DerivedHighlight[] => {
  const events = [...game.scoreEvents].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
  const result: DerivedHighlight[] = [];
  let leader: number | null = null;
  let lastLeader: number | null = null;
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    // Mehrere Events mit identischem Zeitstempel als einen Schritt werten.
    if (i + 1 < events.length && events[i + 1].createdAt === event.createdAt) continue;
    const until = Date.parse(event.createdAt);
    const partial = { ...game, legacyScoreTotals: {}, scoreEvents: events.filter(e => Date.parse(e.createdAt) <= until) };
    const total = game.players.map(p => getPlayerComparableTotalScore(partial, p.id) ?? 0);
    const now = total[0] === total[1] ? null : total[0] > total[1] ? 0 : 1;
    const label = `${total[0]} : ${total[1]} VP`;
    const meta = { createdAt: event.createdAt, roundNumber: event.roundNumber, turnNumber: event.turnNumber };
    if (now !== null && lastLeader !== null && now !== lastLeader) {
      const player = game.players[now];
      result.push({ id: `highlight:lead-change:${event.id}`, kind: "lead-change", title: "Führungswechsel",
        subtitle: `${player.name} übernimmt die Führung · ${label}`, playerId: player.id, ...meta });
    } else if (now === null && leader !== null) {
      result.push({ id: `highlight:equalizer:${event.id}`, kind: "equalizer", title: "Ausgleich", subtitle: label, ...meta });
    }
    leader = now;
    if (now !== null) lastLeader = now;
  }
  return result;
};
export const HIGHLIGHT_ICON = "★";

// TV-Einblendung fuer Fuehrungswechsel/Ausgleich mitten im Zug (gleiche Logik wie Liste/Verlauf).
// - Neu sind nur Highlights, die beim letzten Stand noch nicht existierten (kein Nachspielen der Historie).
// - Undo: Einblendungen, deren ausloesendes Event nicht mehr gilt, werden aus der Warteschlange entfernt
//   (auch die gerade sichtbare).
// - Kein Stau: von mehreren schnell aufeinanderfolgenden Punkte-Highlights wartet nur das neueste;
//   die sichtbare Einblendung wird nicht ersetzt (kein Flackern). Warteschlange hoechstens 3 Eintraege.
export const MAX_TV_HIGHLIGHT_QUEUE = 3;
// knownEventIds: nur Highlights von Punkte-Events, die beim letzten Stand noch nicht existierten
// (ein Undo mitten im Verlauf erzeugt so keine Einblendungen fuer alte Events).
const sourceEventId = (h: TvHighlight) => h.id.replace(/^highlight:(lead-change|equalizer):/, "");
export const findNewScoreLeadHighlights = <T extends TvHighlight>(seen: Set<string>, current: T[], knownEventIds: Set<string> | null = null): T[] =>
  current.filter(h => !seen.has(h.id) && (!knownEventIds || !knownEventIds.has(sourceEventId(h))));
export const getScoreEventIds = (game: Game): Set<string> => new Set(game.scoreEvents.map(e => e.id));
export const reconcileTvHighlightQueue = <T extends TvHighlight>(queue: T[], validScoreIds: Set<string>): T[] => {
  const next = queue.filter(h => !SCORE_DRIVEN_KINDS.has(h.kind) || validScoreIds.has(h.id));
  return next.length === queue.length ? queue : next;
};
export const enqueueTvHighlights = <T extends TvHighlight>(queue: T[], incoming: T[]): T[] => {
  if (!incoming.length) return queue;
  const scoreIncoming = incoming.filter(h => SCORE_DRIVEN_KINDS.has(h.kind));
  const other = incoming.filter(h => !SCORE_DRIVEN_KINDS.has(h.kind));
  const [active, ...pending] = queue;
  const latestScore = scoreIncoming.slice(-1);
  const keptPending = latestScore.length ? pending.filter(h => !SCORE_DRIVEN_KINDS.has(h.kind)) : pending;
  const merged = [...(active ? [active] : []), ...keptPending, ...other, ...latestScore];
  if (merged.length <= MAX_TV_HIGHLIGHT_QUEUE) return merged;
  // Aktive behalten, aelteste wartende verwerfen.
  return [merged[0], ...merged.slice(merged.length - (MAX_TV_HIGHLIGHT_QUEUE - 1))];
};
