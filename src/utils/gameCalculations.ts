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
  return clampFloor(gained - spent);
};

export const getPlayerCommandPointsGained = (game: Game, playerId: PlayerId): number =>
  sumValues(getPlayerCommandPointEvents(game, playerId, "gained"));

export const getPlayerCommandPointsSpent = (game: Game, playerId: PlayerId): number =>
  sumValues(getPlayerCommandPointEvents(game, playerId, "spent"));

export const getTurnDurationMs = (turn: Turn): number =>
  (() => {
    const totalDuration = getDurationMs(turn.timing.startedAt, turn.timing.endedAt ?? new Date().toISOString());
    const pausedDuration = turn.timing.pauses.reduce(
      (total, pause) => total + getDurationMs(pause.startedAt, pause.endedAt ?? new Date().toISOString()),
      0
    );
    return Math.max(totalDuration - pausedDuration, 0);
  })();

export const getCompletedTurnDurationMs = (turn: Turn): number | null =>
  turn.timing.startedAt && turn.timing.endedAt ? getTurnDurationMs(turn) : null;

export const getRoundDurationMs = (round: Round): number => {
  if (round.startedAt && round.endedAt) {
    return getDurationMs(round.startedAt, round.endedAt);
  }

  if (round.startedAt && !round.endedAt) {
    return round.turns.reduce((total, turn) => total + getTurnDurationMs(turn), 0);
  }

  return round.turns.reduce((total, turn) => total + getTurnDurationMs(turn), 0);
};

export const getCompletedRoundDurationMs = (round: Round): number | null =>
  round.startedAt && round.endedAt ? getRoundDurationMs(round) : null;

export const getGameDurationMs = (game: Game): number => {
  if (game.startedAt && game.endedAt) {
    return game.rounds.reduce((total, round) => total + getRoundDurationMs(round), 0);
  }

  if (game.startedAt && !game.endedAt) {
    return game.rounds.reduce((total, round) => total + getRoundDurationMs(round), 0);
  }

  return game.rounds.reduce((total, round) => total + getRoundDurationMs(round), 0);
};

export const getCompletedGameDurationMs = (game: Game): number | null =>
  game.startedAt && game.endedAt ? getGameDurationMs(game) : null;

export const getSessionDurationMs = (game: Game): number => {
  const sessionEvents = [...game.timeEvents]
    .filter((event) => event.action === "session-start" || event.action === "session-end")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  let openStartedAt: string | null = null;
  let total = 0;

  sessionEvents.forEach((event) => {
    if (event.action === "session-start") {
      openStartedAt = event.createdAt;
      return;
    }

    if (event.action === "session-end" && openStartedAt) {
      total += getDurationMs(openStartedAt, event.createdAt);
      openStartedAt = null;
    }
  });

  if (openStartedAt) {
    total += getDurationMs(openStartedAt, new Date().toISOString());
  }

  return total;
};

export const isSessionRunning = (game: Game): boolean => {
  const sessionEvents = [...game.timeEvents]
    .filter((event) => event.action === "session-start" || event.action === "session-end")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const latestSessionEvent = sessionEvents[sessionEvents.length - 1];
  return latestSessionEvent?.action === "session-start";
};

export const getPlayerTurnDurationTotalMs = (game: Game, playerId: PlayerId): number =>
  game.rounds.reduce(
    (total, round) =>
      total +
      round.turns.reduce(
        (turnTotal, turn) =>
          turnTotal + (turn.playerId === playerId ? getTurnDurationMs(turn) : 0),
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
    commandPointBalance: getPlayerCommandPoints(game, playerId),
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
  winRate: number;
  winRateWhenGoFirst: number;
  winRateWhenStartFirst: number;
  averagePrimary: number;
  averageSecondary: number;
  averageTotal: number;
  averageDurationMs: number;
  averageSpentCp: number;
}

export interface ArmyAggregate {
  armyName: string;
  games: number;
  wins: number;
  losses: number;
  ties: number;
  winRate: number;
  averagePrimary: number;
  averageSecondary: number;
  averageTotal: number;
}

export interface MatchupAggregate {
  label: string;
  games: number;
  averageDurationMs: number;
  averageCombinedScore: number;
  averageScoreDifference: number;
}

export interface RoundDurationAggregate {
  roundNumber: number;
  games: number;
  averageDurationMs: number;
  maxDurationMs: number;
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
  winRate: number;
  games: number;
}

export interface GameFilterState {
  query: string;
  playerName: string;
  armyName: string;
  status: "all" | "active" | "completed";
  dateFrom: string;
  dateTo: string;
}

export interface StatsOverview {
  games: number;
  players: number;
  armies: number;
  averageDurationMs: number;
  averageRounds: number;
  averageCombinedScore: number;
  averageSpentCp: number;
}

export const createPlayerAggregates = (games: Game[]): PlayerAggregate[] => {
  const summaries = games.map(createGameSummary);
  const grouped = new Map<string, GameSummaryPlayer[]>();
  const durations = new Map<string, number[]>();
  const goFirstGames = new Map<string, { wins: number; games: number }>();
  const startFirstGames = new Map<string, { wins: number; games: number }>();

  summaries.forEach((summary, summaryIndex) => {
    const game = games[summaryIndex];
    const actualFirstPlayerId = game.rounds[0]?.turns[0]?.playerId;
    const completedDuration = getCompletedGameDurationMs(game);

    summary.players.forEach((player) => {
      const existing = grouped.get(player.name) ?? [];
      grouped.set(player.name, [...existing, player]);

      if (completedDuration !== null) {
        const playerDurations = durations.get(player.name) ?? [];
        durations.set(player.name, [...playerDurations, completedDuration]);
      }

      if (actualFirstPlayerId === player.playerId) {
        const existingGoFirst = goFirstGames.get(player.name) ?? { wins: 0, games: 0 };
        goFirstGames.set(player.name, {
          wins: existingGoFirst.wins + (player.result === "win" ? 1 : 0),
          games: existingGoFirst.games + 1
        });
      }

      if (game.startingPlayerId === player.playerId) {
        const existingStartFirst = startFirstGames.get(player.name) ?? { wins: 0, games: 0 };
        startFirstGames.set(player.name, {
          wins: existingStartFirst.wins + (player.result === "win" ? 1 : 0),
          games: existingStartFirst.games + 1
        });
      }
    });
  });

  return Array.from(grouped.entries())
    .map(([name, players]) => {
      const playerDurations = durations.get(name) ?? [];
      const gamesCount = players.length;
      const wins = players.filter((player) => player.result === "win").length;
      const losses = players.filter((player) => player.result === "loss").length;
      const ties = players.filter((player) => player.result === "tie").length;
      const goFirst = goFirstGames.get(name) ?? { wins: 0, games: 0 };
      const startFirst = startFirstGames.get(name) ?? { wins: 0, games: 0 };

      return {
        name,
        games: gamesCount,
        wins,
        losses,
        ties,
        winRate: gamesCount ? (wins / gamesCount) * 100 : 0,
        winRateWhenGoFirst: goFirst.games ? (goFirst.wins / goFirst.games) * 100 : 0,
        winRateWhenStartFirst: startFirst.games ? (startFirst.wins / startFirst.games) * 100 : 0,
        averagePrimary: gamesCount ? sumValues(players.map((player) => ({ value: player.primaryScore }))) / gamesCount : 0,
        averageSecondary: gamesCount
          ? sumValues(players.map((player) => ({ value: player.secondaryScore }))) / gamesCount
          : 0,
        averageTotal: gamesCount ? sumValues(players.map((player) => ({ value: player.totalScore }))) / gamesCount : 0,
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

const createScenarioLeaders = (
  games: Game[],
  scenarioSelector: (game: Game) => string
): ScenarioLeader[] => {
  const grouped = new Map<string, Map<string, { wins: number; games: number }>>();

  games.forEach((game) => {
    const label = scenarioSelector(game).trim();
    if (!label) {
      return;
    }

    const scenarioPlayers = grouped.get(label) ?? new Map<string, { wins: number; games: number }>();
    const summary = createGameSummary(game);

    summary.players.forEach((player) => {
      const existing = scenarioPlayers.get(player.name) ?? { wins: 0, games: 0 };
      scenarioPlayers.set(player.name, {
        wins: existing.wins + (player.result === "win" ? 1 : 0),
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
        winRate: leader?.winRate ?? 0
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
};

export const createMissionLeaders = (games: Game[]): ScenarioLeader[] =>
  createScenarioLeaders(games, (game) => game.primaryMission);

export const createDeploymentLeaders = (games: Game[]): ScenarioLeader[] =>
  createScenarioLeaders(games, (game) => game.deployment);

export const createInitialGameFilters = (): GameFilterState => ({
  query: "",
  playerName: "all",
  armyName: "all",
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
  )
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

    const matchesDateFrom = !filters.dateFrom || game.scheduledDate >= filters.dateFrom;
    const matchesDateTo = !filters.dateTo || game.scheduledDate <= filters.dateTo;

    return (
      matchesQuery &&
      matchesPlayer &&
      matchesArmy &&
      matchesStatus &&
      matchesDateFrom &&
      matchesDateTo
    );
  });
};

export const createStatsOverview = (games: Game[]): StatsOverview => {
  const summaries = games.map(createGameSummary);
  const playerEntries = summaries.flatMap((summary) => summary.players);
  const playerCount = new Set(playerEntries.map((player) => player.name)).size;
  const armyCount = new Set(playerEntries.map((player) => player.armyName)).size;
  const completedDurations = games
    .map((game) => getCompletedGameDurationMs(game))
    .filter((duration): duration is number => duration !== null);

  return {
    games: games.length,
    players: playerCount,
    armies: armyCount,
    averageDurationMs: completedDurations.length
      ? sumValues(completedDurations.map((value) => ({ value }))) / completedDurations.length
      : 0,
    averageRounds: games.length ? sumValues(games.map((game) => ({ value: game.rounds.length }))) / games.length : 0,
    averageCombinedScore: games.length
      ? sumValues(
          summaries.map((summary) => ({
            value: summary.players[0].totalScore + summary.players[1].totalScore
          }))
        ) / games.length
      : 0,
    averageSpentCp: playerEntries.length
      ? sumValues(playerEntries.map((player) => ({ value: player.commandPointsSpent }))) / playerEntries.length
      : 0
  };
};

export const createArmyAggregates = (games: Game[]): ArmyAggregate[] => {
  const grouped = new Map<string, GameSummaryPlayer[]>();

  games.map(createGameSummary).forEach((summary) => {
    summary.players.forEach((player) => {
      const existing = grouped.get(player.armyName) ?? [];
      grouped.set(player.armyName, [...existing, player]);
    });
  });

  return Array.from(grouped.entries())
    .map(([armyName, players]) => {
      const gamesCount = players.length;
      const wins = players.filter((player) => player.result === "win").length;
      const losses = players.filter((player) => player.result === "loss").length;
      const ties = players.filter((player) => player.result === "tie").length;

      return {
        armyName,
        games: gamesCount,
        wins,
        losses,
        ties,
        winRate: gamesCount ? (wins / gamesCount) * 100 : 0,
        averagePrimary: gamesCount ? sumValues(players.map((player) => ({ value: player.primaryScore }))) / gamesCount : 0,
        averageSecondary: gamesCount ? sumValues(players.map((player) => ({ value: player.secondaryScore }))) / gamesCount : 0,
        averageTotal: gamesCount ? sumValues(players.map((player) => ({ value: player.totalScore }))) / gamesCount : 0
      };
    })
    .sort((left, right) => right.games - left.games || left.armyName.localeCompare(right.armyName));
};

export const createMatchupAggregates = (games: Game[]): MatchupAggregate[] => {
  const grouped = new Map<string, { count: number; durations: number[]; combinedScores: number[]; scoreDifferences: number[] }>();

  games.forEach((game) => {
    const [armyA, armyB] = game.players.map((player) => player.army.name).sort((left, right) => left.localeCompare(right));
    const label = `${armyA} vs ${armyB}`;
    const existing = grouped.get(label) ?? {
      count: 0,
      durations: [],
      combinedScores: [],
      scoreDifferences: []
    };
    const scoreA = getPlayerTotalScore(game, game.players[0].id);
    const scoreB = getPlayerTotalScore(game, game.players[1].id);

    existing.count += 1;
    const completedDuration = getCompletedGameDurationMs(game);
    if (completedDuration !== null) {
      existing.durations.push(completedDuration);
    }
    existing.combinedScores.push(scoreA + scoreB);
    existing.scoreDifferences.push(Math.abs(scoreA - scoreB));
    grouped.set(label, existing);
  });

  return Array.from(grouped.entries())
    .map(([label, values]) => ({
      label,
      games: values.count,
      averageDurationMs: values.durations.length
        ? sumValues(values.durations.map((value) => ({ value }))) / values.durations.length
        : 0,
      averageCombinedScore: values.count
        ? sumValues(values.combinedScores.map((value) => ({ value }))) / values.count
        : 0,
      averageScoreDifference: values.count
        ? sumValues(values.scoreDifferences.map((value) => ({ value }))) / values.count
        : 0
    }))
    .sort((left, right) => right.games - left.games || left.label.localeCompare(right.label));
};

export const createRoundDurationAggregates = (games: Game[]): RoundDurationAggregate[] => {
  const grouped = new Map<number, number[]>();

  games.forEach((game) => {
    game.rounds.forEach((round) => {
      const duration = getCompletedRoundDurationMs(round);
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
      averageDurationMs: durations.length
        ? sumValues(durations.map((value) => ({ value }))) / durations.length
        : 0,
      maxDurationMs: durations.length ? Math.max(...durations) : 0
    }))
    .sort((left, right) => left.roundNumber - right.roundNumber);
};

export const getTurnRecords = (
  games: Game[]
): { longestTurn: TurnRecord | null; fastestTurn: TurnRecord | null } => {
  const turnRecords = games.flatMap((game) =>
    game.rounds.flatMap((round) =>
      round.turns
        .map((turn) => {
          const player = game.players.find((entry) => entry.id === turn.playerId);
          const durationMs = getCompletedTurnDurationMs(turn);
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
                    event.turnNumber === turn.turnNumber
                )
                .map((event) => ({ value: event.value }))
            )
          } satisfies TurnRecord;
        })
        .filter((record): record is TurnRecord => Boolean(record))
    )
  );

  if (!turnRecords.length) {
    return {
      longestTurn: null,
      fastestTurn: null
    };
  }

  const sortedByDuration = [...turnRecords].sort((left, right) => left.durationMs - right.durationMs);

  return {
    fastestTurn: sortedByDuration[0] ?? null,
    longestTurn: sortedByDuration[sortedByDuration.length - 1] ?? null
  };
};
