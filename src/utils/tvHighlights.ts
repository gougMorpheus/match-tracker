import type { Game } from "../types/game";
import { getCurrentRoundNumber, getCurrentTurnNumber, getPlayerComparableTotalScore,
  getPlayerComparablePrimaryScore, getPlayerComparableSecondaryScore, getPlayerRoundScoreTotal,
  getPlayerTurnDurationTotalMs, getTurnDurationMs } from "./gameCalculations";
import { getGameOutcome } from "./headToHead";

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
