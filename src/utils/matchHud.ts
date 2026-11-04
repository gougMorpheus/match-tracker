import type { Game, PlayerId } from "../types/game";
import {
  getActiveTurn,
  getCurrentRoundNumber,
  getPlayerChallengeTotal,
  getPlayerCommandPoints,
  getPlayerCommandPointsGained,
  getPlayerCommandPointsSpent,
  getPlayerPrimaryTotal,
  getPlayerSecondaryTotal,
  getPlayerTotalScore,
  isSetupActive,
  isTurnPaused
} from "./gameCalculations";

// Lesender HUD-Stand für die Gelände-Layout-App (Forge).
// match_id = games.id. Dieselbe Ableitung wie die Anzeige: getPlayerTotalScore, getPlayerCommandPoints,
// getActiveTurn, isSetupActive. Die SQL-Funktion public.mt_match_hud(uuid) liefert dasselbe als JSON
// (snake_case). Gelände schreibt hier nichts.

export type MatchHudPhase = "setup" | "turn" | "ended" | "pending";

export interface MatchHudTurn {
  playerSlot: 1 | 2;
  round: number;
  turn: number;
  // true: der Timer zählt in diesem Zug. false: Zug ist markiert/pausiert oder das Spiel ist zu.
  running: boolean;
}

export interface MatchHudPlayer {
  slot: 1 | 2;
  name: string;
  score: number;
  primary: number;
  secondary: number;
  challenge: number;
  cp: number;
  cpGained: number;
  cpSpent: number;
}

export interface MatchHud {
  matchId: string;
  isOnline: boolean;
  status: Game["status"];
  phase: MatchHudPhase;
  round: number;
  activeTurn: MatchHudTurn | null;
  activePlayerSlot: 1 | 2 | null;
  scores: { 1: number; 2: number };
  cp: { 1: number; 2: number };
  players: [MatchHudPlayer, MatchHudPlayer];
}

// Forge hängt diese Query an die Gelände-URL. Den Host legt Match-Tracker nicht fest.
export const terrainMatchQuery = (matchId: string): string => `?match=${matchId}`;

const slotOf = (game: Game, playerId: PlayerId): 1 | 2 =>
  playerId === game.players[1].id ? 2 : 1;

const isTurnRunning = (turn: NonNullable<ReturnType<typeof getActiveTurn>>): boolean =>
  Boolean(turn.timing.startedAt && !turn.timing.endedAt && !isTurnPaused(turn));

const playerSnapshot = (game: Game, slot: 1 | 2): MatchHudPlayer => {
  const player = game.players[slot - 1];
  const detail = game.scoreDetailLevel === "full";
  return {
    slot,
    name: player.name,
    score: getPlayerTotalScore(game, player.id),
    primary: detail ? getPlayerPrimaryTotal(game, player.id) : 0,
    secondary: detail ? getPlayerSecondaryTotal(game, player.id) : 0,
    challenge: detail ? getPlayerChallengeTotal(game, player.id) : 0,
    cp: getPlayerCommandPoints(game, player.id),
    cpGained: getPlayerCommandPointsGained(game, player.id),
    cpSpent: getPlayerCommandPointsSpent(game, player.id)
  };
};

export const buildMatchHud = (game: Game): MatchHud => {
  const ended = Boolean(game.endedAt) || game.timeEvents.some((event) => event.action === "game-end");
  const setup = !ended && isSetupActive(game);
  const turn = getActiveTurn(game);
  const phase: MatchHudPhase = ended ? "ended" : setup ? "setup" : turn ? "turn" : "pending";
  const showTurn = phase === "turn" || phase === "ended" ? turn : undefined;
  const activeTurn: MatchHudTurn | null = showTurn
    ? {
        playerSlot: slotOf(game, showTurn.playerId),
        round: showTurn.roundNumber,
        turn: showTurn.turnNumber,
        running: !ended && isTurnRunning(showTurn)
      }
    : null;
  const round = activeTurn?.round ?? (phase === "turn" || phase === "ended" ? getCurrentRoundNumber(game) : 0);
  const shownPlayerId = showTurn
    ? showTurn.playerId
    : game.startingPlayerId || game.defenderPlayerId || game.players[0].id;
  const players: [MatchHudPlayer, MatchHudPlayer] = [playerSnapshot(game, 1), playerSnapshot(game, 2)];

  return {
    matchId: game.id,
    isOnline: game.isOnline === true,
    status: ended ? "completed" : "active",
    phase,
    round,
    activeTurn,
    activePlayerSlot: shownPlayerId ? slotOf(game, shownPlayerId) : null,
    scores: { 1: players[0].score, 2: players[1].score },
    cp: { 1: players[0].cp, 2: players[1].cp },
    players
  };
};
