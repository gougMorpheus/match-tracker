import type {
  CommandPointEvent,
  Game,
  GameResult,
  GameSummary,
  GameSummaryPlayer,
  PlayerId,
  Round,
  ScoreEvent,
  Turn
} from "../types/game";
import { getDurationMs } from "./time";

const sumValues = <T extends { value: number }>(items: T[]): number =>
  items.reduce((total, item) => total + item.value, 0);

export const getPlayerScoreEvents = (
  game: Game,
  playerId: PlayerId,
  scoreType?: ScoreEvent["scoreType"]
): ScoreEvent[] =>
  game.scoreEvents.filter(
    (event) => event.playerId === playerId && (!scoreType || event.scoreType === scoreType)
  );

export const getPlayerScoreTotal = (
  game: Game,
  playerId: PlayerId,
  scoreType?: ScoreEvent["scoreType"]
): number => sumValues(getPlayerScoreEvents(game, playerId, scoreType));

export const getPlayerPrimaryTotal = (game: Game, playerId: PlayerId): number =>
  getPlayerScoreTotal(game, playerId, "primary");

export const getPlayerSecondaryTotal = (game: Game, playerId: PlayerId): number =>
  getPlayerScoreTotal(game, playerId, "secondary");

export const getPlayerTotalScore = (game: Game, playerId: PlayerId): number =>
  getPlayerPrimaryTotal(game, playerId) + getPlayerSecondaryTotal(game, playerId);

export const getPlayerCommandPointEvents = (
  game: Game,
  playerId: PlayerId,
  cpType?: CommandPointEvent["cpType"]
): CommandPointEvent[] =>
  game.commandPointEvents.filter(
    (event) => event.playerId === playerId && (!cpType || event.cpType === cpType)
  );

export const getPlayerCommandPoints = (game: Game, playerId: PlayerId): number => {
  const gained = sumValues(getPlayerCommandPointEvents(game, playerId, "gained"));
  const spent = sumValues(getPlayerCommandPointEvents(game, playerId, "spent"));
  return gained - spent;
};

export const getTurnDurationMs = (turn: Turn): number =>
  getDurationMs(turn.timing.startedAt, turn.timing.endedAt ?? new Date().toISOString());

export const getRoundDurationMs = (round: Round): number => {
  if (round.startedAt && round.endedAt) {
    return getDurationMs(round.startedAt, round.endedAt);
  }

  if (round.startedAt && !round.endedAt) {
    return getDurationMs(round.startedAt, new Date().toISOString());
  }

  return round.turns.reduce((total, turn) => total + getTurnDurationMs(turn), 0);
};

export const getGameDurationMs = (game: Game): number => {
  if (game.startedAt && game.endedAt) {
    return getDurationMs(game.startedAt, game.endedAt);
  }

  if (game.startedAt && !game.endedAt) {
    return getDurationMs(game.startedAt, new Date().toISOString());
  }

  return game.rounds.reduce((total, round) => total + getRoundDurationMs(round), 0);
};

export const getLatestRound = (game: Game): Round | undefined =>
  game.rounds[game.rounds.length - 1];

export const getLatestTurn = (game: Game): Turn | undefined =>
  (() => {
    const latestRound = getLatestRound(game);
    return latestRound ? latestRound.turns[latestRound.turns.length - 1] : undefined;
  })();

export const isRoundActive = (game: Game): boolean => {
  const round = getLatestRound(game);
  return Boolean(round?.startedAt && !round.endedAt);
};

export const isTurnActive = (game: Game): boolean => {
  const turn = getLatestTurn(game);
  return Boolean(turn?.timing.startedAt && !turn.timing.endedAt);
};

export const getCurrentRoundNumber = (game: Game): number => getLatestRound(game)?.roundNumber ?? 0;

export const getCurrentTurnNumber = (game: Game): number => getLatestTurn(game)?.turnNumber ?? 0;

const getPlayerResult = (
  playerScore: number,
  opponentScore: number
): GameResult => {
  if (playerScore > opponentScore) {
    return "win";
  }

  if (playerScore < opponentScore) {
    return "loss";
  }

  return "tie";
};

const createSummaryPlayer = (game: Game, playerId: PlayerId): GameSummaryPlayer => {
  const player = game.players.find((entry) => entry.id === playerId)!;
  const opponent = game.players.find((entry) => entry.id !== playerId)!;
  const primaryScore = getPlayerPrimaryTotal(game, playerId);
  const secondaryScore = getPlayerSecondaryTotal(game, playerId);
  const totalScore = primaryScore + secondaryScore;
  const opponentTotal = getPlayerTotalScore(game, opponent.id);
  const commandPointsGained = sumValues(getPlayerCommandPointEvents(game, playerId, "gained"));
  const commandPointsSpent = sumValues(getPlayerCommandPointEvents(game, playerId, "spent"));

  return {
    playerId,
    name: player.name,
    armyName: player.army.name,
    primaryScore,
    secondaryScore,
    totalScore,
    commandPointsGained,
    commandPointsSpent,
    commandPointBalance: commandPointsGained - commandPointsSpent,
    result: getPlayerResult(totalScore, opponentTotal)
  };
};

export const createGameSummary = (game: Game): GameSummary => ({
  gameId: game.id,
  status: game.status,
  scheduledDate: game.scheduledDate,
  scheduledTime: game.scheduledTime,
  totalDurationMs: getGameDurationMs(game),
  roundCount: game.rounds.length,
  players: [
    createSummaryPlayer(game, game.players[0].id),
    createSummaryPlayer(game, game.players[1].id)
  ]
});

export interface PlayerAggregate {
  name: string;
  games: number;
  wins: number;
  losses: number;
  ties: number;
  averagePrimary: number;
  averageSecondary: number;
  averageDurationMs: number;
  averageSpentCp: number;
}

export const createPlayerAggregates = (games: Game[]): PlayerAggregate[] => {
  const summaries = games.map(createGameSummary);
  const grouped = new Map<string, GameSummaryPlayer[]>();
  const durations = new Map<string, number[]>();

  summaries.forEach((summary) => {
    summary.players.forEach((player) => {
      const existing = grouped.get(player.name) ?? [];
      grouped.set(player.name, [...existing, player]);

      const playerDurations = durations.get(player.name) ?? [];
      durations.set(player.name, [...playerDurations, summary.totalDurationMs]);
    });
  });

  return Array.from(grouped.entries())
    .map(([name, players]) => {
      const playerDurations = durations.get(name) ?? [];
      const gamesCount = players.length;
      const wins = players.filter((player) => player.result === "win").length;
      const losses = players.filter((player) => player.result === "loss").length;
      const ties = players.filter((player) => player.result === "tie").length;

      return {
        name,
        games: gamesCount,
        wins,
        losses,
        ties,
        averagePrimary: gamesCount ? sumValues(players.map((player) => ({ value: player.primaryScore }))) / gamesCount : 0,
        averageSecondary: gamesCount
          ? sumValues(players.map((player) => ({ value: player.secondaryScore }))) / gamesCount
          : 0,
        averageDurationMs: playerDurations.length
          ? sumValues(playerDurations.map((value) => ({ value }))) / playerDurations.length
          : 0,
        averageSpentCp: gamesCount
          ? sumValues(players.map((player) => ({ value: player.commandPointsSpent }))) / gamesCount
          : 0
      };
    })
    .sort((left, right) => right.games - left.games || left.name.localeCompare(right.name));
};
