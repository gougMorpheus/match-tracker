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

const clampFloor = (value: number): number => Math.max(value, 0);
const getRoundCorrectionKey = (roundNumber: number): string => String(roundNumber);
const getTurnCorrectionKey = (roundNumber: number, turnNumber: number): string =>
  `${roundNumber}:${turnNumber}`;
const averageOrNull = (values: number[]): number | null =>
  values.length ? sumValues(values.map((value) => ({ value }))) / values.length : null;
const MIN_STATS_TURN_DURATION_MS = 10 * 1000;
const getTurnKey = (roundNumber?: number, turnNumber?: number): string | null =>
  roundNumber && turnNumber ? `${roundNumber}:${turnNumber}` : null;

const hasCommandPointEarnedInTurn = (game: Game, turn: Turn): boolean =>
  game.commandPointEvents.some(
    (event) =>
      event.cpType === "gained" &&
      event.playerId === turn.playerId &&
      event.roundNumber === turn.roundNumber &&
      event.turnNumber === turn.turnNumber
  );

const isStatsEligibleTurn = (game: Game, turn: Turn): boolean =>
  getTurnDurationMs(turn, game) >= MIN_STATS_TURN_DURATION_MS && hasCommandPointEarnedInTurn(game, turn);

export const getCountedRounds = (game: Game): Round[] => {
  if (game.scoreDetailLevel !== "full") {
    return game.rounds;
  }

  return game.rounds.filter((round) =>
    round.turns.some((turn) => isStatsEligibleTurn(game, turn))
  );
};

const hasStatsTurnKey = (
  validTurnKeys: Set<string>,
  event: { roundNumber?: number; turnNumber?: number }
): boolean => {
  const turnKey = getTurnKey(event.roundNumber, event.turnNumber);
  return turnKey ? validTurnKeys.has(turnKey) : false;
};

export const isStatsEligibleGame = (game: Game): boolean =>
  game.finishReason !== "interrupted" && game.finishReason !== "abandoned";

export const prepareGameForStats = (game: Game): Game | null => {
  if (!isStatsEligibleGame(game)) {
    return null;
  }

  if (game.scoreDetailLevel !== "full") {
    return game;
  }

  const validTurns = game.rounds.flatMap((round) =>
    round.turns.filter((turn) => isStatsEligibleTurn(game, turn))
  );
  const validTurnKeys = new Set(
    validTurns.map((turn) => `${turn.roundNumber}:${turn.turnNumber}`)
  );

  if (!validTurnKeys.size) {
    return null;
  }

  const rounds = game.rounds
    .map((round) => ({
      ...round,
      turns: round.turns.filter((turn) =>
        validTurnKeys.has(`${turn.roundNumber}:${turn.turnNumber}`)
      )
    }))
    .filter((round) => round.turns.length > 0);
  const validRoundKeys = new Set(rounds.map((round) => String(round.roundNumber)));

  return {
    ...game,
    rounds,
    scoreEvents: game.scoreEvents.filter((event) => hasStatsTurnKey(validTurnKeys, event)),
    commandPointEvents: game.commandPointEvents.filter((event) => hasStatsTurnKey(validTurnKeys, event)),
    noteEvents: game.noteEvents.filter((event) => hasStatsTurnKey(validTurnKeys, event)),
    timeEvents: game.timeEvents.filter((event) => {
      const turnKey = getTurnKey(event.roundNumber, event.turnNumber);
      if (turnKey) {
        return validTurnKeys.has(turnKey);
      }

      return event.roundNumber ? validRoundKeys.has(String(event.roundNumber)) : true;
    }),
    timerCorrections: {
      totalMs: 0,
      rounds: {},
      turns: Object.fromEntries(
        Object.entries(game.timerCorrections.turns).filter(([turnKey]) => validTurnKeys.has(turnKey))
      )
    }
  };
};

export const prepareGamesForStats = (games: Game[]): Game[] =>
  games.map((game) => prepareGameForStats(game)).filter((game): game is Game => Boolean(game));

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
): number => clampFloor(sumValues(getPlayerScoreEvents(game, playerId, scoreType)));

export const getPlayerPrimaryTotal = (game: Game, playerId: PlayerId): number =>
  getPlayerScoreTotal(game, playerId, "primary");

export const getPlayerSecondaryTotal = (game: Game, playerId: PlayerId): number =>
  getPlayerScoreTotal(game, playerId, "secondary");

export const getPlayerChallengeTotal = (game: Game, playerId: PlayerId): number =>
  getPlayerScoreTotal(game, playerId, "challenge");

export const getPlayerLegacyRoundTotal = (game: Game, playerId: PlayerId): number =>
  getPlayerScoreTotal(game, playerId, "legacy-total");

const hasLegacyRoundTotals = (game: Game): boolean =>
  game.scoreEvents.some((event) => event.scoreType === "legacy-total");

export const getPlayerTotalScore = (game: Game, playerId: PlayerId): number =>
  game.scoreDetailLevel === "total-only"
    ? clampFloor(
        hasLegacyRoundTotals(game)
          ? getPlayerLegacyRoundTotal(game, playerId)
          : game.legacyScoreTotals[playerId] ?? 0
      )
    : getPlayerPrimaryTotal(game, playerId) + getPlayerSecondaryTotal(game, playerId) + getPlayerChallengeTotal(game, playerId);

export const hasDetailedScoreData = (game: Game): boolean => game.scoreDetailLevel === "full";

export const hasComparableTotalScoreData = (game: Game): boolean =>
  game.scoreDetailLevel === "total-only"
    ? hasLegacyRoundTotals(game) ||
      game.players.every((player) => typeof game.legacyScoreTotals[player.id] === "number")
    : game.scoreDetailLevel === "full";

export const hasLegacyRoundTotalScoreData = (game: Game): boolean =>
  game.scoreDetailLevel === "total-only" && hasLegacyRoundTotals(game);

export const getPlayerComparablePrimaryScore = (game: Game, playerId: PlayerId): number | null =>
  hasDetailedScoreData(game) ? getPlayerPrimaryTotal(game, playerId) : null;

export const getPlayerComparableSecondaryScore = (game: Game, playerId: PlayerId): number | null =>
  hasDetailedScoreData(game) ? getPlayerSecondaryTotal(game, playerId) : null;

export const getPlayerComparableTotalScore = (game: Game, playerId: PlayerId): number | null =>
  hasComparableTotalScoreData(game) ? getPlayerTotalScore(game, playerId) : null;

export const hasComparableCommandPointData = (game: Game, playerId: PlayerId): boolean =>
  game.commandPointEvents.some((event) => event.playerId === playerId);

export const getPlayerRoundScoreTotal = (
  game: Game,
  playerId: PlayerId,
  roundNumber: number,
  scoreType?: ScoreEvent["scoreType"]
): number =>
  sumValues(
    game.scoreEvents.filter(
      (event) =>
        event.playerId === playerId &&
        event.roundNumber === roundNumber &&
        (!scoreType || event.scoreType === scoreType)
    )
  );

export const getPlayerCurrentRoundPrimaryTotal = (
  game: Game,
  playerId: PlayerId,
  roundNumber = getCurrentRoundNumber(game)
): number => getPlayerRoundScoreTotal(game, playerId, roundNumber, "primary");

export const getPlayerCurrentRoundSecondaryTotal = (
  game: Game,
  playerId: PlayerId,
  roundNumber = getCurrentRoundNumber(game)
): number => getPlayerRoundScoreTotal(game, playerId, roundNumber, "secondary");

export const getPlayerCurrentRoundChallengeTotal = (
  game: Game,
  playerId: PlayerId,
  roundNumber = getCurrentRoundNumber(game)
): number => getPlayerRoundScoreTotal(game, playerId, roundNumber, "challenge");

export const getPlayerCurrentRoundTotalScore = (
  game: Game,
  playerId: PlayerId,
  roundNumber = getCurrentRoundNumber(game)
): number =>
  game.scoreDetailLevel === "total-only"
    ? getPlayerRoundScoreTotal(game, playerId, roundNumber, "legacy-total")
    : getPlayerRoundScoreTotal(game, playerId, roundNumber);

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
  return clampFloor(gained - spent);
};

export const getPlayerCommandPointsGained = (game: Game, playerId: PlayerId): number =>
  sumValues(getPlayerCommandPointEvents(game, playerId, "gained"));

export const getPlayerCommandPointsSpent = (game: Game, playerId: PlayerId): number =>
  sumValues(getPlayerCommandPointEvents(game, playerId, "spent"));

export const getPlayerCurrentRoundCommandPointsGained = (
  game: Game,
  playerId: PlayerId,
  roundNumber = getCurrentRoundNumber(game)
): number =>
  getPlayerCommandPointEvents(game, playerId, "gained")
    .filter((event) => event.roundNumber === roundNumber)
    .reduce((total, event) => total + event.value, 0);

export const getPlayerCurrentRoundCommandPointsSpent = (
  game: Game,
  playerId: PlayerId,
  roundNumber = getCurrentRoundNumber(game)
): number =>
  getPlayerCommandPointEvents(game, playerId, "spent")
    .filter((event) => event.roundNumber === roundNumber)
    .reduce((total, event) => total + event.value, 0);

export const getTurnBaseDurationMs = (turn: Turn, fallbackEndedAt?: string): number => {
  const effectiveEndedAt = turn.timing.endedAt ?? fallbackEndedAt ?? new Date().toISOString();
  const totalDuration = getDurationMs(turn.timing.startedAt, effectiveEndedAt);
  const pausedDuration = turn.timing.pauses.reduce(
    (total, pause) => total + getDurationMs(pause.startedAt, pause.endedAt ?? effectiveEndedAt),
    0
  );
  return Math.max(totalDuration - pausedDuration, 0);
};

export const getTurnCorrectionMs = (game: Game, roundNumber: number, turnNumber: number): number =>
  game.timerCorrections.turns[getTurnCorrectionKey(roundNumber, turnNumber)] ?? 0;

export const getRoundCorrectionMs = (game: Game, roundNumber: number): number =>
  game.timerCorrections.rounds[getRoundCorrectionKey(roundNumber)] ?? 0;

export const getTotalCorrectionMs = (game: Game): number => game.timerCorrections.totalMs ?? 0;

export const getSetupCorrectionMs = (game: Game): number => getTurnCorrectionMs(game, 0, 1);

export const getTurnDurationMs = (turn: Turn, game?: Game): number =>
  clampFloor(
    getTurnBaseDurationMs(turn, game?.endedAt) +
      (game ? getTurnCorrectionMs(game, turn.roundNumber, turn.turnNumber) : 0)
  );

export const getCompletedTurnDurationMs = (turn: Turn, game?: Game): number | null =>
  turn.timing.startedAt && turn.timing.endedAt ? getTurnDurationMs(turn, game) : null;

export const getSetupBaseDurationMs = (game: Game, includeOpenSetup = true): number => {
  const setupEvents = [...game.timeEvents]
    .filter(
      (event) =>
        event.action === "setup-start" ||
        event.action === "setup-end" ||
        event.action === "setup-pause" ||
        event.action === "setup-resume"
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  let startedAt: string | null = null;
  let pauseStartedAt: string | null = null;
  let pausedDuration = 0;
  let total = 0;

  setupEvents.forEach((event) => {
    if (event.action === "setup-start") {
      startedAt = event.createdAt;
      pauseStartedAt = null;
      pausedDuration = 0;
      return;
    }

    if (!startedAt) {
      return;
    }

    if (event.action === "setup-pause" && !pauseStartedAt) {
      pauseStartedAt = event.createdAt;
      return;
    }

    if (event.action === "setup-resume" && pauseStartedAt) {
      pausedDuration += getDurationMs(pauseStartedAt, event.createdAt);
      pauseStartedAt = null;
      return;
    }

    if (event.action === "setup-end") {
      const endedAt = event.createdAt;
      if (pauseStartedAt) {
        pausedDuration += getDurationMs(pauseStartedAt, endedAt);
        pauseStartedAt = null;
      }
      total += Math.max(getDurationMs(startedAt, endedAt) - pausedDuration, 0);
      startedAt = null;
      pausedDuration = 0;
    }
  });

  if (startedAt && includeOpenSetup) {
    const now = game.endedAt ?? new Date().toISOString();
    const openPausedDuration = pauseStartedAt
      ? pausedDuration + getDurationMs(pauseStartedAt, now)
      : pausedDuration;
    total += Math.max(getDurationMs(startedAt, now) - openPausedDuration, 0);
  }

  return total;
};

export const getSetupDurationMs = (game: Game): number =>
  clampFloor(getSetupBaseDurationMs(game) + getSetupCorrectionMs(game));

export const isSetupActive = (game: Game): boolean => {
  const setupEvents = [...game.timeEvents]
    .filter(
      (event) =>
        event.action === "setup-start" ||
        event.action === "setup-end" ||
        event.action === "setup-pause" ||
        event.action === "setup-resume"
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const latest = setupEvents[setupEvents.length - 1];

  return Boolean(setupEvents.length && latest?.action !== "setup-end");
};

export const isSetupPaused = (game: Game): boolean => {
  const setupEvents = [...game.timeEvents]
    .filter(
      (event) =>
        event.action === "setup-start" ||
        event.action === "setup-end" ||
        event.action === "setup-pause" ||
        event.action === "setup-resume"
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const latest = setupEvents[setupEvents.length - 1];

  return latest?.action === "setup-pause";
};

export const isSetupRunning = (game: Game): boolean => isSetupActive(game) && !isSetupPaused(game);

export const getRoundBaseDurationMs = (round: Round): number =>
  round.turns.reduce((total, turn) => total + getTurnBaseDurationMs(turn), 0);

const getRoundBaseDurationMsForGame = (round: Round, game: Game): number =>
  round.turns.reduce((total, turn) => total + getTurnBaseDurationMs(turn, game.endedAt), 0);

export const getRoundDurationMs = (round: Round, game?: Game): number =>
  clampFloor(
    round.turns.reduce((total, turn) => total + getTurnDurationMs(turn, game), 0) +
      (game ? getRoundCorrectionMs(game, round.roundNumber) + getTimeoutDurationMs(game, round.roundNumber) : 0)
  );

export const getCompletedRoundDurationMs = (round: Round, game?: Game): number | null =>
  round.startedAt && round.endedAt ? getRoundDurationMs(round, game) : null;

export const getGameBaseDurationMs = (game: Game): number =>
  getSetupDurationMs(game) + game.rounds.reduce((total, round) => total + getRoundBaseDurationMsForGame(round, game), 0);

export const getGameDurationMs = (game: Game): number =>
  clampFloor(
    getSetupDurationMs(game) +
    game.rounds.reduce((total, round) => total + getRoundDurationMs(round, game), 0) +
      getTotalCorrectionMs(game)
  );

export const getCompletedGameDurationMs = (game: Game): number | null =>
  game.startedAt && game.endedAt ? getGameDurationMs(game) : null;

export const getOfficialStatsGameDurationMs = (game: Game): number | null => {
  if (!game.endedAt || game.scoreDetailLevel !== "full") {
    return null;
  }

  if (!game.rounds.some((round) => round.turns.some((turn) => turn.timing.startedAt))) {
    return null;
  }

  return getGameDurationMs(game);
};

export const isTimeoutActive = (game: Game): boolean => {
  const timeoutEvents = [...game.timeEvents]
    .filter((event) => event.action === "timeout-start" || event.action === "timeout-end")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const latestTimeoutEvent = timeoutEvents[timeoutEvents.length - 1];

  return latestTimeoutEvent?.action === "timeout-start";
};

export function getTimeoutDurationMs(game: Game, roundNumber?: number): number {
  const timeoutEvents = [...game.timeEvents]
    .filter(
      (event) =>
        (event.action === "timeout-start" || event.action === "timeout-end") &&
        (!roundNumber || event.roundNumber === roundNumber)
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  let openStartedAt: string | null = null;
  let total = 0;

  timeoutEvents.forEach((event) => {
    if (event.action === "timeout-start") {
      openStartedAt = event.createdAt;
      return;
    }

    if (event.action === "timeout-end" && openStartedAt) {
      total += getDurationMs(openStartedAt, event.createdAt);
      openStartedAt = null;
    }
  });

  if (openStartedAt) {
    total += getDurationMs(openStartedAt, new Date().toISOString());
  }

  return total;
}

export const getPlayerTurnDurationTotalMs = (game: Game, playerId: PlayerId): number =>
  game.rounds.reduce(
    (total, round) =>
      total +
      round.turns.reduce(
        (turnTotal, turn) =>
          turnTotal + (turn.playerId === playerId ? getTurnDurationMs(turn, game) : 0),
        0
      ),
    0
  );

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
  return Boolean(turn?.timing.startedAt && !turn.timing.endedAt && !isTurnPaused(turn));
};

export const isTurnPaused = (turn?: Turn): boolean => {
  const latestPause = turn?.timing.pauses[turn.timing.pauses.length - 1];
  return Boolean(turn?.timing.startedAt && !turn.timing.endedAt && latestPause && !latestPause.endedAt);
};

export const getCurrentRoundNumber = (game: Game): number => getLatestRound(game)?.roundNumber ?? 0;

export const getCurrentTurnNumber = (game: Game): number => getLatestTurn(game)?.turnNumber ?? 0;

const getPlayerResult = (
  game: Game,
  playerScore: number,
  opponentScore: number
): GameResult => {
  if (game.finishReason === "draw") {
    return "tie";
  }

  if (playerScore > opponentScore) {
    return "win";
  }

  if (playerScore < opponentScore) {
    return "loss";
  }

  return "tie";
};

const getPlayerGameResult = (game: Game, playerId: PlayerId): GameResult => {
  if (game.finishReason === "draw") {
    return "tie";
  }

  const opponent = game.players.find((entry) => entry.id !== playerId)!;
  return getPlayerResult(game, getPlayerTotalScore(game, playerId), getPlayerTotalScore(game, opponent.id));
};

const createSummaryPlayer = (game: Game, playerId: PlayerId): GameSummaryPlayer => {
  const player = game.players.find((entry) => entry.id === playerId)!;
  const opponent = game.players.find((entry) => entry.id !== playerId)!;
  const primaryScore = getPlayerComparablePrimaryScore(game, playerId);
  const secondaryScore = getPlayerComparableSecondaryScore(game, playerId);
  const totalScore = getPlayerComparableTotalScore(game, playerId);
  const opponentTotal = getPlayerComparableTotalScore(game, opponent.id);
  const hasCpData = hasComparableCommandPointData(game, playerId);
  const commandPointsGained = hasCpData ? sumValues(getPlayerCommandPointEvents(game, playerId, "gained")) : null;
  const commandPointsSpent = hasCpData ? sumValues(getPlayerCommandPointEvents(game, playerId, "spent")) : null;

  return {
    playerId,
    name: player.name,
    armyName: player.army.name,
    primaryScore,
    secondaryScore,
    totalScore,
    commandPointsGained,
    commandPointsSpent,
    commandPointBalance: hasCpData ? getPlayerCommandPoints(game, playerId) : null,
    result:
      game.finishReason === "draw"
        ? "tie"
        : totalScore !== null && opponentTotal !== null
          ? getPlayerResult(game, totalScore, opponentTotal)
          : null
  };
};

export const createGameSummary = (game: Game): GameSummary => ({
  gameId: game.id,
  status: game.status,
  scheduledDate: game.scheduledDate,
  scheduledTime: game.scheduledTime,
  totalDurationMs: hasCompletedTimingData(game) ? getGameDurationMs(game) : null,
  roundCount: getCountedRounds(game).length,
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
  winRate: number | null;
  winRateWhenGoFirst: number | null;
  winRateWhenStartFirst: number | null;
  averagePrimary: number | null;
  averageSecondary: number | null;
  averageTotal: number | null;
  averageDurationMs: number | null;
  averageSpentCp: number | null;
}

export interface ArmyAggregate {
  armyName: string;
  games: number;
  wins: number;
  losses: number;
  ties: number;
  winRate: number | null;
  averagePrimary: number | null;
  averageSecondary: number | null;
  averageTotal: number | null;
  averageDurationMs: number | null;
}

export interface MatchupAggregate {
  label: string;
  armyA: string;
  armyB: string;
  games: number;
  winsA: number;
  winsB: number;
  ties: number;
  averageDurationMs: number | null;
  averageDurationAms: number | null;
  averageDurationBms: number | null;
  averageCombinedScore: number | null;
  averageScoreA: number | null;
  averageScoreB: number | null;
  averageScoreDifference: number | null;
}

export interface RoundDurationAggregate {
  roundNumber: number;
  games: number;
  minDurationMs: number | null;
  averageDurationMs: number | null;
  maxDurationMs: number | null;
}

export interface RoundScoreAggregate {
  roundNumber: number;
  games: number;
  averagePlayerOneScore: number | null;
  averagePlayerTwoScore: number | null;
  averageCombinedScore: number | null;
}

export interface TurnRecord {
  gameId: string;
  scheduledDate: string;
  scheduledTime: string;
  playerName: string;
  armyName: string;
  roundNumber: number;
  turnNumber: number;
  durationMs: number;
  primaryScore: number;
  secondaryScore: number;
  totalScore: number;
}

export interface ScenarioLeader {
  label: string;
  playerName: string;
  winRate: number | null;
  games: number;
}

export interface ScenarioPerformanceAggregate {
  label: string;
  leaderName: string;
  leaderWinRate: number | null;
  games: number;
  averageCombinedScore: number | null;
  averageDurationMs: number | null;
}

export interface PlayerTurnDurationAggregate {
  playerName: string;
  turns: number;
  averageTurnDurationMs: number | null;
  longestTurnMs: number | null;
}

export interface CpScorePoint {
  playerName: string;
  gameId: string;
  scheduledDate: string;
  scheduledTime: string;
  cpSpent: number;
  totalScore: number;
  primaryScore: number | null;
  secondaryScore: number | null;
}

export interface GameFilterState {
  query: string;
  playerName: string;
  armyName: string;
  pointsFrom: string;
  pointsTo: string;
  status: "all" | "active" | "completed";
  dateFrom: string;
  dateTo: string;
}

export interface StatsOverview {
  games: number;
  players: number;
  armies: number;
  averageDurationMs: number | null;
  averagePlayerDurationMs: number | null;
  averageDurationGameCount: number;
  averageRounds: number | null;
  averageCombinedScore: number | null;
  averagePlayerScore: number | null;
  averagePlayerOneScore: number | null;
  averagePlayerTwoScore: number | null;
  averageScoreGameCount: number;
  averageSpentCp: number | null;
}

const hasPlayerScoreData = (
  game: Game,
  playerId: PlayerId,
  scoreType?: ScoreEvent["scoreType"]
): boolean =>
  game.scoreDetailLevel === "full" &&
  (!scoreType ||
    scoreType === "primary" ||
    scoreType === "secondary" ||
    scoreType === "challenge") &&
  game.players.some((player) => player.id === playerId);

const hasComparableScoreData = (game: Game): boolean =>
  hasComparableTotalScoreData(game);

const hasPlayerCommandPointData = (game: Game, playerId: PlayerId): boolean =>
  hasComparableCommandPointData(game, playerId);

const hasCompletedTimingData = (game: Game): boolean =>
  getOfficialStatsGameDurationMs(game) !== null;

const hasDetailedTimingStats = (game: Game): boolean =>
  game.scoreDetailLevel === "full" && hasCompletedTimingData(game);

const getStatsGameDurationMs = (game: Game): number | null => {
  if (!game.endedAt || !hasDetailedTimingStats(game)) {
    return null;
  }

  return getOfficialStatsGameDurationMs(game);
};

const createGameSourceById = (games: Game[]): Map<string, Game> =>
  new Map(games.map((game) => [game.id, game]));

export const createPlayerAggregates = (games: Game[], durationSourceGames: Game[] = games): PlayerAggregate[] => {
  const durationSourceById = createGameSourceById(durationSourceGames);
  const playerNames = Array.from(new Set(games.flatMap((game) => game.players.map((player) => player.name))));

  return playerNames
    .map((name) => {
      const playerGames = games
        .map((game) => ({
          game,
          player: game.players.find((player) => player.name === name)
        }))
        .filter((entry): entry is { game: Game; player: Game["players"][number] } => Boolean(entry.player));
      const gamesCount = playerGames.length;
      const scoredGames = playerGames.filter(({ game }) => hasComparableScoreData(game));
      const goFirstGames = scoredGames.filter(({ game, player }) => game.rounds[0]?.turns[0]?.playerId === player.id);
      const startFirstGames = scoredGames.filter(({ game, player }) => game.startingPlayerId === player.id);
      const wins = scoredGames.filter(({ game, player }) => getPlayerGameResult(game, player.id) === "win").length;
      const losses = scoredGames.filter(({ game, player }) => getPlayerGameResult(game, player.id) === "loss").length;
      const ties = scoredGames.length - wins - losses;
      const primaryValues = playerGames
        .filter(({ game, player }) => hasPlayerScoreData(game, player.id, "primary"))
        .map(({ game, player }) => getPlayerPrimaryTotal(game, player.id));
      const secondaryValues = playerGames
        .filter(({ game, player }) => hasPlayerScoreData(game, player.id, "secondary"))
        .map(({ game, player }) => getPlayerSecondaryTotal(game, player.id));
      const totalValues = playerGames
        .filter(({ game, player }) => getPlayerComparableTotalScore(game, player.id) !== null)
        .map(({ game, player }) => getPlayerTotalScore(game, player.id));
      const durationValues = playerGames
        .filter(({ game }) => game.scoreDetailLevel === "full")
        .map(({ game }) => getStatsGameDurationMs(durationSourceById.get(game.id) ?? game))
        .filter((value): value is number => value !== null);
      const spentCpValues = playerGames
        .filter(({ game, player }) => game.scoreDetailLevel === "full" && hasPlayerCommandPointData(game, player.id))
        .map(({ game, player }) => getPlayerCommandPointsSpent(game, player.id));

      return {
        name,
        games: gamesCount,
        wins,
        losses,
        ties,
        winRate: scoredGames.length ? (wins / scoredGames.length) * 100 : null,
        winRateWhenGoFirst: goFirstGames.length
          ? (goFirstGames.filter(({ game, player }) => getPlayerGameResult(game, player.id) === "win").length /
              goFirstGames.length) *
            100
          : null,
        winRateWhenStartFirst: startFirstGames.length
          ? (startFirstGames.filter(({ game, player }) => getPlayerGameResult(game, player.id) === "win").length /
              startFirstGames.length) *
            100
          : null,
        averagePrimary: averageOrNull(primaryValues),
        averageSecondary: averageOrNull(secondaryValues),
        averageTotal: averageOrNull(totalValues),
        averageDurationMs: averageOrNull(durationValues),
        averageSpentCp: averageOrNull(spentCpValues)
      };
    })
    .sort((left, right) => right.games - left.games || left.name.localeCompare(right.name));
};

const createScenarioLeaders = (
  games: Game[],
  scenarioSelector: (game: Game) => string
): ScenarioLeader[] => {
  const grouped = new Map<string, Map<string, { wins: number; games: number }>>();

  games.forEach((game) => {
    const label = scenarioSelector(game).trim();
    if (!label || !hasComparableScoreData(game)) {
      return;
    }

    const scenarioPlayers = grouped.get(label) ?? new Map<string, { wins: number; games: number }>();
    game.players.forEach((player) => {
      const existing = scenarioPlayers.get(player.name) ?? { wins: 0, games: 0 };
      scenarioPlayers.set(player.name, {
        wins:
          existing.wins +
          (getPlayerGameResult(game, player.id) === "win" ? 1 : 0),
        games: existing.games + 1
      });
    });

    grouped.set(label, scenarioPlayers);
  });

  return Array.from(grouped.entries())
    .map(([label, scenarioPlayers]) => {
      const leader = Array.from(scenarioPlayers.entries())
        .map(([playerName, stats]) => ({
          playerName,
          games: stats.games,
          winRate: stats.games ? (stats.wins / stats.games) * 100 : 0
        }))
        .sort((left, right) => right.winRate - left.winRate || right.games - left.games || left.playerName.localeCompare(right.playerName))[0];

      return {
        label,
        playerName: leader?.playerName ?? "-",
        games: leader?.games ?? 0,
        winRate: leader?.winRate ?? null
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
};

export const createMissionLeaders = (games: Game[]): ScenarioLeader[] =>
  createScenarioLeaders(games, (game) => game.primaryMission);

export const createDeploymentLeaders = (games: Game[]): ScenarioLeader[] =>
  createScenarioLeaders(games, (game) => game.deployment);

export const createScenarioPerformanceAggregates = (
  games: Game[],
  scenarioSelector: (game: Game) => string,
  durationSourceGames: Game[] = games
): ScenarioPerformanceAggregate[] => {
  const leaders = createScenarioLeaders(games, scenarioSelector);
  const leaderByLabel = new Map(leaders.map((leader) => [leader.label, leader]));
  const grouped = new Map<string, { scores: number[]; durations: number[]; games: number }>();
  const durationSourceById = createGameSourceById(durationSourceGames);

  games.forEach((game) => {
    const label = scenarioSelector(game).trim();
    if (!label || !hasComparableScoreData(game)) {
      return;
    }

    const existing = grouped.get(label) ?? { scores: [], durations: [], games: 0 };
    existing.games += 1;
    existing.scores.push(getPlayerTotalScore(game, game.players[0].id) + getPlayerTotalScore(game, game.players[1].id));
    const duration =
      game.scoreDetailLevel === "full"
        ? getStatsGameDurationMs(durationSourceById.get(game.id) ?? game)
        : null;
    if (duration !== null) {
      existing.durations.push(duration);
    }
    grouped.set(label, existing);
  });

  return Array.from(grouped.entries())
    .map(([label, values]) => {
      const leader = leaderByLabel.get(label);
      return {
        label,
        leaderName: leader?.playerName ?? "-",
        leaderWinRate: leader?.winRate ?? null,
        games: values.games,
        averageCombinedScore: averageOrNull(values.scores),
        averageDurationMs: averageOrNull(values.durations)
      };
    })
    .sort((left, right) => right.games - left.games || left.label.localeCompare(right.label));
};

export const createInitialGameFilters = (): GameFilterState => ({
  query: "",
  playerName: "all",
  armyName: "all",
  pointsFrom: "all",
  pointsTo: "all",
  status: "all",
  dateFrom: "",
  dateTo: ""
});

export const getFilterOptions = (games: Game[]) => ({
  playerNames: Array.from(new Set(games.flatMap((game) => game.players.map((player) => player.name)))).sort((left, right) =>
    left.localeCompare(right)
  ),
  armyNames: Array.from(new Set(games.flatMap((game) => game.players.map((player) => player.army.name)))).sort((left, right) =>
    left.localeCompare(right)
  ),
  gamePoints: Array.from(new Set(games.map((game) => game.gamePoints))).sort((left, right) => left - right)
});

export const filterGames = (games: Game[], filters: GameFilterState): Game[] => {
  const normalizedQuery = filters.query.trim().toLocaleLowerCase();

  return games.filter((game) => {
    const matchesQuery =
      !normalizedQuery ||
      [
        game.scheduledDate,
        game.scheduledTime,
        String(game.gamePoints),
        game.deployment,
        game.primaryMission,
        ...game.players.map((player) => player.name),
        ...game.players.map((player) => player.army.name)
      ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));

    const matchesPlayer =
      filters.playerName === "all" || game.players.some((player) => player.name === filters.playerName);

    const matchesArmy =
      filters.armyName === "all" || game.players.some((player) => player.army.name === filters.armyName);

    const matchesStatus = filters.status === "all" || game.status === filters.status;
    const pointsFrom = !filters.pointsFrom || filters.pointsFrom === "all" ? null : Number(filters.pointsFrom);
    const pointsTo = !filters.pointsTo || filters.pointsTo === "all" ? null : Number(filters.pointsTo);
    const matchesPointsFrom = pointsFrom === null || game.gamePoints >= pointsFrom;
    const matchesPointsTo = pointsTo === null || game.gamePoints <= pointsTo;

    const matchesDateFrom = !filters.dateFrom || game.scheduledDate >= filters.dateFrom;
    const matchesDateTo = !filters.dateTo || game.scheduledDate <= filters.dateTo;

    return (
      matchesQuery &&
      matchesPlayer &&
      matchesArmy &&
      matchesStatus &&
      matchesPointsFrom &&
      matchesPointsTo &&
      matchesDateFrom &&
      matchesDateTo
    );
  });
};

export const createStatsOverview = (games: Game[], durationSourceGames: Game[] = games): StatsOverview => {
  const durationSourceById = createGameSourceById(durationSourceGames);
  const playerEntries = games.flatMap((game) => game.players);
  const playerCount = new Set(playerEntries.map((player) => player.name)).size;
  const armyCount = new Set(playerEntries.map((player) => player.army.name)).size;
  const completedDurations = games
    .map((game) => getStatsGameDurationMs(durationSourceById.get(game.id) ?? game))
    .filter((duration): duration is number => duration !== null);
  const playerDurationValues = games.flatMap((game) => {
    const durationSourceGame = durationSourceById.get(game.id) ?? game;
    if (durationSourceGame.scoreDetailLevel !== "full" || getStatsGameDurationMs(durationSourceGame) === null) {
      return [];
    }

    return durationSourceGame.players.map((player) => getPlayerTurnDurationTotalMs(durationSourceGame, player.id));
  });
  const roundsValues = games
    .filter((game) => game.scoreDetailLevel === "full" && game.rounds.length > 0)
    .map((game) => game.rounds.length);
  const comparableScoreGames = games.filter((game) => hasComparableScoreData(game));
  const combinedScoreValues = comparableScoreGames.map(
    (game) => getPlayerTotalScore(game, game.players[0].id) + getPlayerTotalScore(game, game.players[1].id)
  );
  const playerOneScoreValues = comparableScoreGames.map((game) => getPlayerTotalScore(game, game.players[0].id));
  const playerTwoScoreValues = comparableScoreGames.map((game) => getPlayerTotalScore(game, game.players[1].id));
  const playerScoreValues = comparableScoreGames.flatMap((game) =>
    game.players.map((player) => getPlayerTotalScore(game, player.id))
  );
  const spentCpValues = games.flatMap((game) =>
    game.scoreDetailLevel === "full"
      ? game.players
          .filter((player) => hasPlayerCommandPointData(game, player.id))
          .map((player) => getPlayerCommandPointsSpent(game, player.id))
      : []
  );

  return {
    games: games.length,
    players: playerCount,
    armies: armyCount,
    averageDurationMs: averageOrNull(completedDurations),
    averagePlayerDurationMs: averageOrNull(playerDurationValues),
    averageDurationGameCount: completedDurations.length,
    averageRounds: averageOrNull(roundsValues),
    averageCombinedScore: averageOrNull(combinedScoreValues),
    averagePlayerScore: averageOrNull(playerScoreValues),
    averagePlayerOneScore: averageOrNull(playerOneScoreValues),
    averagePlayerTwoScore: averageOrNull(playerTwoScoreValues),
    averageScoreGameCount: comparableScoreGames.length,
    averageSpentCp: averageOrNull(spentCpValues)
  };
};

export const createArmyAggregates = (games: Game[], durationSourceGames: Game[] = games): ArmyAggregate[] => {
  const durationSourceById = createGameSourceById(durationSourceGames);
  const armyNames = Array.from(new Set(games.flatMap((game) => game.players.map((player) => player.army.name))));

  return armyNames
    .map((armyName) => {
      const armyGames = games
        .map((game) => ({
          game,
          player: game.players.find((player) => player.army.name === armyName)
        }))
        .filter((entry): entry is { game: Game; player: Game["players"][number] } => Boolean(entry.player));
      const gamesCount = armyGames.length;
      const scoredGames = armyGames.filter(({ game }) => hasComparableScoreData(game));
      const wins = scoredGames.filter(({ game, player }) => getPlayerGameResult(game, player.id) === "win").length;
      const losses = scoredGames.filter(({ game, player }) => getPlayerGameResult(game, player.id) === "loss").length;
      const ties = scoredGames.length - wins - losses;
      const primaryValues = armyGames
        .filter(({ game, player }) => hasPlayerScoreData(game, player.id, "primary"))
        .map(({ game, player }) => getPlayerPrimaryTotal(game, player.id));
      const secondaryValues = armyGames
        .filter(({ game, player }) => hasPlayerScoreData(game, player.id, "secondary"))
        .map(({ game, player }) => getPlayerSecondaryTotal(game, player.id));
      const totalValues = armyGames
        .filter(({ game, player }) => getPlayerComparableTotalScore(game, player.id) !== null)
        .map(({ game, player }) => getPlayerTotalScore(game, player.id));
      const durationValues = armyGames
        .filter(({ game }) => game.scoreDetailLevel === "full")
        .map(({ game }) => getStatsGameDurationMs(durationSourceById.get(game.id) ?? game))
        .filter((value): value is number => value !== null);

      return {
        armyName,
        games: gamesCount,
        wins,
        losses,
        ties,
        winRate: scoredGames.length ? (wins / scoredGames.length) * 100 : null,
        averagePrimary: averageOrNull(primaryValues),
        averageSecondary: averageOrNull(secondaryValues),
        averageTotal: averageOrNull(totalValues),
        averageDurationMs: averageOrNull(durationValues)
      };
    })
    .sort((left, right) => right.games - left.games || left.armyName.localeCompare(right.armyName));
};

export const createMatchupAggregates = (games: Game[], durationSourceGames: Game[] = games): MatchupAggregate[] => {
  const grouped = new Map<string, {
    armyA: string;
    armyB: string;
    count: number;
    winsA: number;
    winsB: number;
    ties: number;
    durations: number[];
    durationsA: number[];
    durationsB: number[];
    combinedScores: number[];
    scoresA: number[];
    scoresB: number[];
    scoreDifferences: number[];
  }>();
  const durationSourceById = createGameSourceById(durationSourceGames);

  games.forEach((game) => {
    const [armyA, armyB] = game.players.map((player) => player.army.name).sort((left, right) => left.localeCompare(right));
    const label = `${armyA} vs ${armyB}`;
    const existing = grouped.get(label) ?? {
      armyA,
      armyB,
      count: 0,
      winsA: 0,
      winsB: 0,
      ties: 0,
      durations: [],
      durationsA: [],
      durationsB: [],
      combinedScores: [],
      scoresA: [],
      scoresB: [],
      scoreDifferences: []
    };
    const playerA = game.players.find((player) => player.army.name === armyA) ?? game.players[0];
    const playerB = game.players.find((player) => player.id !== playerA.id) ?? game.players[1];
    const scoreA = getPlayerTotalScore(game, playerA.id);
    const scoreB = getPlayerTotalScore(game, playerB.id);

    existing.count += 1;
    const durationSourceGame = durationSourceById.get(game.id) ?? game;
    const completedDuration = game.scoreDetailLevel === "full" ? getStatsGameDurationMs(durationSourceGame) : null;
    if (completedDuration !== null) {
      existing.durations.push(completedDuration);
    }
    if (hasComparableScoreData(game)) {
      if (scoreA > scoreB) {
        existing.winsA += 1;
      } else if (scoreB > scoreA) {
        existing.winsB += 1;
      } else {
        existing.ties += 1;
      }
      existing.combinedScores.push(scoreA + scoreB);
      existing.scoresA.push(scoreA);
      existing.scoresB.push(scoreB);
      existing.scoreDifferences.push(Math.abs(scoreA - scoreB));
    }
    if (durationSourceGame.scoreDetailLevel === "full") {
      const durationA = getPlayerTurnDurationTotalMs(durationSourceGame, playerA.id);
      const durationB = getPlayerTurnDurationTotalMs(durationSourceGame, playerB.id);
      if (durationA > 0) {
        existing.durationsA.push(durationA);
      }
      if (durationB > 0) {
        existing.durationsB.push(durationB);
      }
    }
    grouped.set(label, existing);
  });

  return Array.from(grouped.entries())
    .map(([label, values]) => ({
      label,
      armyA: values.armyA,
      armyB: values.armyB,
      games: values.count,
      winsA: values.winsA,
      winsB: values.winsB,
      ties: values.ties,
      averageDurationMs: averageOrNull(values.durations),
      averageDurationAms: averageOrNull(values.durationsA),
      averageDurationBms: averageOrNull(values.durationsB),
      averageCombinedScore: averageOrNull(values.combinedScores),
      averageScoreA: averageOrNull(values.scoresA),
      averageScoreB: averageOrNull(values.scoresB),
      averageScoreDifference: averageOrNull(values.scoreDifferences)
    }))
    .sort((left, right) => right.games - left.games || left.label.localeCompare(right.label));
};

export const createRoundDurationAggregates = (games: Game[]): RoundDurationAggregate[] => {
  const grouped = new Map<number, number[]>();

  games.forEach((game) => {
    if (game.scoreDetailLevel !== "full") {
      return;
    }

    game.rounds.forEach((round) => {
      const duration = getCompletedRoundDurationMs(round, game);
      if (duration === null) {
        return;
      }
      const durations = grouped.get(round.roundNumber) ?? [];
      durations.push(duration);
      grouped.set(round.roundNumber, durations);
    });
  });

  return Array.from(grouped.entries())
    .map(([roundNumber, durations]) => ({
      roundNumber,
      games: durations.length,
      minDurationMs: durations.length ? Math.min(...durations) : null,
      averageDurationMs: averageOrNull(durations),
      maxDurationMs: durations.length ? Math.max(...durations) : null
    }))
    .sort((left, right) => left.roundNumber - right.roundNumber);
};

export const createRoundScoreAggregates = (games: Game[]): RoundScoreAggregate[] => {
  const grouped = new Map<number, { playerOneScores: number[]; playerTwoScores: number[]; combinedScores: number[] }>();

  games.forEach((game) => {
    if (!hasComparableScoreData(game)) {
      return;
    }

    game.rounds.forEach((round) => {
      const playerOneScore = getPlayerRoundScoreTotal(game, game.players[0].id, round.roundNumber);
      const playerTwoScore = getPlayerRoundScoreTotal(game, game.players[1].id, round.roundNumber);
      const existing = grouped.get(round.roundNumber) ?? {
        playerOneScores: [],
        playerTwoScores: [],
        combinedScores: []
      };

      existing.playerOneScores.push(playerOneScore);
      existing.playerTwoScores.push(playerTwoScore);
      existing.combinedScores.push(playerOneScore + playerTwoScore);
      grouped.set(round.roundNumber, existing);
    });
  });

  return Array.from(grouped.entries())
    .map(([roundNumber, values]) => ({
      roundNumber,
      games: values.combinedScores.length,
      averagePlayerOneScore: averageOrNull(values.playerOneScores),
      averagePlayerTwoScore: averageOrNull(values.playerTwoScores),
      averageCombinedScore: averageOrNull(values.combinedScores)
    }))
    .sort((left, right) => left.roundNumber - right.roundNumber);
};

export const createPlayerTurnDurationAggregates = (games: Game[]): PlayerTurnDurationAggregate[] => {
  const grouped = new Map<string, number[]>();

  games.forEach((game) => {
    if (game.scoreDetailLevel !== "full") {
      return;
    }

    game.rounds.forEach((round) => {
      round.turns.forEach((turn) => {
        const player = game.players.find((entry) => entry.id === turn.playerId);
        const duration = getCompletedTurnDurationMs(turn, game);
        if (!player || duration === null) {
          return;
        }

        const durations = grouped.get(player.name) ?? [];
        durations.push(duration);
        grouped.set(player.name, durations);
      });
    });
  });

  return Array.from(grouped.entries())
    .map(([playerName, durations]) => ({
      playerName,
      turns: durations.length,
      averageTurnDurationMs: averageOrNull(durations),
      longestTurnMs: durations.length ? Math.max(...durations) : null
    }))
    .sort((left, right) => right.turns - left.turns || left.playerName.localeCompare(right.playerName));
};

export const createCpScoreCorrelationPoints = (games: Game[]): CpScorePoint[] =>
  games.flatMap((game) =>
    game.scoreDetailLevel === "full"
      ? game.players
          .filter(
            (player) =>
              hasPlayerCommandPointData(game, player.id) &&
              getPlayerComparableTotalScore(game, player.id) !== null
          )
          .map((player) => ({
            playerName: player.name,
            gameId: game.id,
            scheduledDate: game.scheduledDate,
            scheduledTime: game.scheduledTime,
            cpSpent: getPlayerCommandPointsSpent(game, player.id),
            totalScore: getPlayerTotalScore(game, player.id),
            primaryScore: getPlayerComparablePrimaryScore(game, player.id),
            secondaryScore: getPlayerComparableSecondaryScore(game, player.id)
          }))
      : []
  );

export const getTurnRecords = (
  games: Game[]
): { longestTurn: TurnRecord | null; fastestTurn: TurnRecord | null; highestScoringTurn: TurnRecord | null } => {
  const turnRecords = games.flatMap((game) =>
    game.scoreDetailLevel === "full"
      ? game.rounds.flatMap((round) =>
          round.turns
            .map((turn) => {
              const player = game.players.find((entry) => entry.id === turn.playerId);
              const durationMs = getCompletedTurnDurationMs(turn, game);
              if (!player || durationMs === null) {
                return null;
              }

              return {
                gameId: game.id,
                scheduledDate: game.scheduledDate,
                scheduledTime: game.scheduledTime,
                playerName: player.name,
                armyName: player.army.name,
                roundNumber: round.roundNumber,
                turnNumber: turn.turnNumber,
                durationMs,
                primaryScore: sumValues(
                  game.scoreEvents
                    .filter(
                      (event) =>
                        event.playerId === turn.playerId &&
                        event.roundNumber === round.roundNumber &&
                        event.turnNumber === turn.turnNumber &&
                        event.scoreType === "primary"
                    )
                    .map((event) => ({ value: event.value }))
                ),
                secondaryScore: sumValues(
                  game.scoreEvents
                    .filter(
                      (event) =>
                        event.playerId === turn.playerId &&
                        event.roundNumber === round.roundNumber &&
                        event.turnNumber === turn.turnNumber &&
                        event.scoreType === "secondary"
                    )
                    .map((event) => ({ value: event.value }))
                ),
                totalScore: sumValues(
                  game.scoreEvents
                    .filter(
                      (event) =>
                        event.playerId === turn.playerId &&
                        event.roundNumber === round.roundNumber &&
                        event.turnNumber === turn.turnNumber &&
                        event.scoreType !== "legacy-total"
                    )
                    .map((event) => ({ value: event.value }))
                )
              } satisfies TurnRecord;
            })
            .filter((record): record is TurnRecord => Boolean(record))
        )
      : []
  );

  if (!turnRecords.length) {
    return {
      longestTurn: null,
      fastestTurn: null,
      highestScoringTurn: null
    };
  }

  const sortedByDuration = [...turnRecords].sort((left, right) => left.durationMs - right.durationMs);
  const sortedByScore = [...turnRecords].sort(
    (left, right) => left.totalScore - right.totalScore || left.secondaryScore - right.secondaryScore
  );

  return {
    fastestTurn: sortedByDuration[0] ?? null,
    longestTurn: sortedByDuration[sortedByDuration.length - 1] ?? null,
    highestScoringTurn: sortedByScore[sortedByScore.length - 1] ?? null
  };
};
