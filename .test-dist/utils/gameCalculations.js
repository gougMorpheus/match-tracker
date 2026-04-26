"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDeploymentLeaders = exports.createMissionLeaders = exports.createPlayerAggregates = exports.createGameSummary = exports.getCurrentTurnNumber = exports.getCurrentRoundNumber = exports.isTurnPaused = exports.isTurnActive = exports.isRoundActive = exports.getLatestTurn = exports.getLatestRound = exports.getPlayerTurnDurationTotalMs = exports.isTimeoutActive = exports.isSessionRunning = exports.getSessionDurationMs = exports.getCompletedGameDurationMs = exports.getGameDurationMs = exports.getGameBaseDurationMs = exports.getCompletedRoundDurationMs = exports.getRoundDurationMs = exports.getRoundBaseDurationMs = exports.getCompletedTurnDurationMs = exports.getTurnDurationMs = exports.getTotalCorrectionMs = exports.getRoundCorrectionMs = exports.getTurnCorrectionMs = exports.getTurnBaseDurationMs = exports.getPlayerCurrentRoundCommandPointsSpent = exports.getPlayerCurrentRoundCommandPointsGained = exports.getPlayerCommandPointsSpent = exports.getPlayerCommandPointsGained = exports.getPlayerCommandPoints = exports.getPlayerCommandPointEvents = exports.getPlayerCurrentRoundTotalScore = exports.getPlayerCurrentRoundSecondaryTotal = exports.getPlayerCurrentRoundPrimaryTotal = exports.getPlayerRoundScoreTotal = exports.hasComparableCommandPointData = exports.getPlayerComparableTotalScore = exports.getPlayerComparableSecondaryScore = exports.getPlayerComparablePrimaryScore = exports.hasLegacyRoundTotalScoreData = exports.hasComparableTotalScoreData = exports.hasDetailedScoreData = exports.getPlayerTotalScore = exports.getPlayerLegacyRoundTotal = exports.getPlayerSecondaryTotal = exports.getPlayerPrimaryTotal = exports.getPlayerScoreTotal = exports.getPlayerScoreEvents = void 0;
exports.getTurnRecords = exports.createCpScoreCorrelationPoints = exports.createPlayerTurnDurationAggregates = exports.createRoundScoreAggregates = exports.createRoundDurationAggregates = exports.createMatchupAggregates = exports.createArmyAggregates = exports.createStatsOverview = exports.filterGames = exports.getFilterOptions = exports.createInitialGameFilters = exports.createScenarioPerformanceAggregates = void 0;
exports.getTimeoutDurationMs = getTimeoutDurationMs;
const time_1 = require("./time");
const sumValues = (items) => items.reduce((total, item) => total + item.value, 0);
const clampFloor = (value) => Math.max(value, 0);
const getRoundCorrectionKey = (roundNumber) => String(roundNumber);
const getTurnCorrectionKey = (roundNumber, turnNumber) => `${roundNumber}:${turnNumber}`;
const averageOrNull = (values) => values.length ? sumValues(values.map((value) => ({ value }))) / values.length : null;
const getPlayerScoreEvents = (game, playerId, scoreType) => game.scoreEvents.filter((event) => event.playerId === playerId && (!scoreType || event.scoreType === scoreType));
exports.getPlayerScoreEvents = getPlayerScoreEvents;
const getPlayerScoreTotal = (game, playerId, scoreType) => clampFloor(sumValues((0, exports.getPlayerScoreEvents)(game, playerId, scoreType)));
exports.getPlayerScoreTotal = getPlayerScoreTotal;
const getPlayerPrimaryTotal = (game, playerId) => (0, exports.getPlayerScoreTotal)(game, playerId, "primary");
exports.getPlayerPrimaryTotal = getPlayerPrimaryTotal;
const getPlayerSecondaryTotal = (game, playerId) => (0, exports.getPlayerScoreTotal)(game, playerId, "secondary");
exports.getPlayerSecondaryTotal = getPlayerSecondaryTotal;
const getPlayerLegacyRoundTotal = (game, playerId) => (0, exports.getPlayerScoreTotal)(game, playerId, "legacy-total");
exports.getPlayerLegacyRoundTotal = getPlayerLegacyRoundTotal;
const hasLegacyRoundTotals = (game) => game.scoreEvents.some((event) => event.scoreType === "legacy-total");
const getPlayerTotalScore = (game, playerId) => game.scoreDetailLevel === "total-only"
    ? clampFloor(hasLegacyRoundTotals(game)
        ? (0, exports.getPlayerLegacyRoundTotal)(game, playerId)
        : game.legacyScoreTotals[playerId] ?? 0)
    : (0, exports.getPlayerPrimaryTotal)(game, playerId) + (0, exports.getPlayerSecondaryTotal)(game, playerId);
exports.getPlayerTotalScore = getPlayerTotalScore;
const hasDetailedScoreData = (game) => game.scoreDetailLevel === "full";
exports.hasDetailedScoreData = hasDetailedScoreData;
const hasComparableTotalScoreData = (game) => game.scoreDetailLevel === "total-only"
    ? hasLegacyRoundTotals(game) ||
        game.players.every((player) => typeof game.legacyScoreTotals[player.id] === "number")
    : game.scoreDetailLevel === "full";
exports.hasComparableTotalScoreData = hasComparableTotalScoreData;
const hasLegacyRoundTotalScoreData = (game) => game.scoreDetailLevel === "total-only" && hasLegacyRoundTotals(game);
exports.hasLegacyRoundTotalScoreData = hasLegacyRoundTotalScoreData;
const getPlayerComparablePrimaryScore = (game, playerId) => (0, exports.hasDetailedScoreData)(game) ? (0, exports.getPlayerPrimaryTotal)(game, playerId) : null;
exports.getPlayerComparablePrimaryScore = getPlayerComparablePrimaryScore;
const getPlayerComparableSecondaryScore = (game, playerId) => (0, exports.hasDetailedScoreData)(game) ? (0, exports.getPlayerSecondaryTotal)(game, playerId) : null;
exports.getPlayerComparableSecondaryScore = getPlayerComparableSecondaryScore;
const getPlayerComparableTotalScore = (game, playerId) => (0, exports.hasComparableTotalScoreData)(game) ? (0, exports.getPlayerTotalScore)(game, playerId) : null;
exports.getPlayerComparableTotalScore = getPlayerComparableTotalScore;
const hasComparableCommandPointData = (game, playerId) => game.commandPointEvents.some((event) => event.playerId === playerId);
exports.hasComparableCommandPointData = hasComparableCommandPointData;
const getPlayerRoundScoreTotal = (game, playerId, roundNumber, scoreType) => sumValues(game.scoreEvents.filter((event) => event.playerId === playerId &&
    event.roundNumber === roundNumber &&
    (!scoreType || event.scoreType === scoreType)));
exports.getPlayerRoundScoreTotal = getPlayerRoundScoreTotal;
const getPlayerCurrentRoundPrimaryTotal = (game, playerId) => (0, exports.getPlayerRoundScoreTotal)(game, playerId, (0, exports.getCurrentRoundNumber)(game), "primary");
exports.getPlayerCurrentRoundPrimaryTotal = getPlayerCurrentRoundPrimaryTotal;
const getPlayerCurrentRoundSecondaryTotal = (game, playerId) => (0, exports.getPlayerRoundScoreTotal)(game, playerId, (0, exports.getCurrentRoundNumber)(game), "secondary");
exports.getPlayerCurrentRoundSecondaryTotal = getPlayerCurrentRoundSecondaryTotal;
const getPlayerCurrentRoundTotalScore = (game, playerId) => game.scoreDetailLevel === "total-only"
    ? (0, exports.getPlayerRoundScoreTotal)(game, playerId, (0, exports.getCurrentRoundNumber)(game), "legacy-total")
    : (0, exports.getPlayerRoundScoreTotal)(game, playerId, (0, exports.getCurrentRoundNumber)(game));
exports.getPlayerCurrentRoundTotalScore = getPlayerCurrentRoundTotalScore;
const getPlayerCommandPointEvents = (game, playerId, cpType) => game.commandPointEvents.filter((event) => event.playerId === playerId && (!cpType || event.cpType === cpType));
exports.getPlayerCommandPointEvents = getPlayerCommandPointEvents;
const getPlayerCommandPoints = (game, playerId) => {
    const gained = sumValues((0, exports.getPlayerCommandPointEvents)(game, playerId, "gained"));
    const spent = sumValues((0, exports.getPlayerCommandPointEvents)(game, playerId, "spent"));
    return clampFloor(gained - spent);
};
exports.getPlayerCommandPoints = getPlayerCommandPoints;
const getPlayerCommandPointsGained = (game, playerId) => sumValues((0, exports.getPlayerCommandPointEvents)(game, playerId, "gained"));
exports.getPlayerCommandPointsGained = getPlayerCommandPointsGained;
const getPlayerCommandPointsSpent = (game, playerId) => sumValues((0, exports.getPlayerCommandPointEvents)(game, playerId, "spent"));
exports.getPlayerCommandPointsSpent = getPlayerCommandPointsSpent;
const getPlayerCurrentRoundCommandPointsGained = (game, playerId) => (0, exports.getPlayerCommandPointEvents)(game, playerId, "gained").filter((event) => event.roundNumber === (0, exports.getCurrentRoundNumber)(game)).reduce((total, event) => total + event.value, 0);
exports.getPlayerCurrentRoundCommandPointsGained = getPlayerCurrentRoundCommandPointsGained;
const getPlayerCurrentRoundCommandPointsSpent = (game, playerId) => (0, exports.getPlayerCommandPointEvents)(game, playerId, "spent").filter((event) => event.roundNumber === (0, exports.getCurrentRoundNumber)(game)).reduce((total, event) => total + event.value, 0);
exports.getPlayerCurrentRoundCommandPointsSpent = getPlayerCurrentRoundCommandPointsSpent;
const getTurnBaseDurationMs = (turn) => {
    const totalDuration = (0, time_1.getDurationMs)(turn.timing.startedAt, turn.timing.endedAt ?? new Date().toISOString());
    const pausedDuration = turn.timing.pauses.reduce((total, pause) => total + (0, time_1.getDurationMs)(pause.startedAt, pause.endedAt ?? new Date().toISOString()), 0);
    return Math.max(totalDuration - pausedDuration, 0);
};
exports.getTurnBaseDurationMs = getTurnBaseDurationMs;
const getTurnCorrectionMs = (game, roundNumber, turnNumber) => game.timerCorrections.turns[getTurnCorrectionKey(roundNumber, turnNumber)] ?? 0;
exports.getTurnCorrectionMs = getTurnCorrectionMs;
const getRoundCorrectionMs = (game, roundNumber) => game.timerCorrections.rounds[getRoundCorrectionKey(roundNumber)] ?? 0;
exports.getRoundCorrectionMs = getRoundCorrectionMs;
const getTotalCorrectionMs = (game) => game.timerCorrections.totalMs ?? 0;
exports.getTotalCorrectionMs = getTotalCorrectionMs;
const getTurnDurationMs = (turn, game) => clampFloor((0, exports.getTurnBaseDurationMs)(turn) +
    (game ? (0, exports.getTurnCorrectionMs)(game, turn.roundNumber, turn.turnNumber) : 0));
exports.getTurnDurationMs = getTurnDurationMs;
const getCompletedTurnDurationMs = (turn, game) => turn.timing.startedAt && turn.timing.endedAt ? (0, exports.getTurnDurationMs)(turn, game) : null;
exports.getCompletedTurnDurationMs = getCompletedTurnDurationMs;
const getRoundBaseDurationMs = (round) => round.turns.reduce((total, turn) => total + (0, exports.getTurnBaseDurationMs)(turn), 0);
exports.getRoundBaseDurationMs = getRoundBaseDurationMs;
const getRoundDurationMs = (round, game) => clampFloor(round.turns.reduce((total, turn) => total + (0, exports.getTurnDurationMs)(turn, game), 0) +
    (game ? (0, exports.getRoundCorrectionMs)(game, round.roundNumber) + getTimeoutDurationMs(game, round.roundNumber) : 0));
exports.getRoundDurationMs = getRoundDurationMs;
const getCompletedRoundDurationMs = (round, game) => round.startedAt && round.endedAt ? (0, exports.getRoundDurationMs)(round, game) : null;
exports.getCompletedRoundDurationMs = getCompletedRoundDurationMs;
const getGameBaseDurationMs = (game) => game.rounds.reduce((total, round) => total + (0, exports.getRoundBaseDurationMs)(round), 0);
exports.getGameBaseDurationMs = getGameBaseDurationMs;
const getGameDurationMs = (game) => clampFloor(game.rounds.reduce((total, round) => total + (0, exports.getRoundDurationMs)(round, game), 0) +
    (0, exports.getTotalCorrectionMs)(game));
exports.getGameDurationMs = getGameDurationMs;
const getCompletedGameDurationMs = (game) => game.startedAt && game.endedAt ? (0, exports.getGameDurationMs)(game) : null;
exports.getCompletedGameDurationMs = getCompletedGameDurationMs;
const getSessionDurationMs = (game) => {
    const sessionEvents = [...game.timeEvents]
        .filter((event) => event.action === "session-start" || event.action === "session-end")
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    let openStartedAt = null;
    let total = 0;
    sessionEvents.forEach((event) => {
        if (event.action === "session-start") {
            openStartedAt = event.createdAt;
            return;
        }
        if (event.action === "session-end" && openStartedAt) {
            total += (0, time_1.getDurationMs)(openStartedAt, event.createdAt);
            openStartedAt = null;
        }
    });
    if (openStartedAt) {
        total += (0, time_1.getDurationMs)(openStartedAt, new Date().toISOString());
    }
    return total;
};
exports.getSessionDurationMs = getSessionDurationMs;
const isSessionRunning = (game) => {
    const sessionEvents = [...game.timeEvents]
        .filter((event) => event.action === "session-start" || event.action === "session-end")
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const latestSessionEvent = sessionEvents[sessionEvents.length - 1];
    return latestSessionEvent?.action === "session-start";
};
exports.isSessionRunning = isSessionRunning;
const isTimeoutActive = (game) => {
    const timeoutEvents = [...game.timeEvents]
        .filter((event) => event.action === "timeout-start" || event.action === "timeout-end")
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const latestTimeoutEvent = timeoutEvents[timeoutEvents.length - 1];
    return latestTimeoutEvent?.action === "timeout-start";
};
exports.isTimeoutActive = isTimeoutActive;
function getTimeoutDurationMs(game, roundNumber) {
    const timeoutEvents = [...game.timeEvents]
        .filter((event) => (event.action === "timeout-start" || event.action === "timeout-end") &&
        (!roundNumber || event.roundNumber === roundNumber))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    let openStartedAt = null;
    let total = 0;
    timeoutEvents.forEach((event) => {
        if (event.action === "timeout-start") {
            openStartedAt = event.createdAt;
            return;
        }
        if (event.action === "timeout-end" && openStartedAt) {
            total += (0, time_1.getDurationMs)(openStartedAt, event.createdAt);
            openStartedAt = null;
        }
    });
    if (openStartedAt) {
        total += (0, time_1.getDurationMs)(openStartedAt, new Date().toISOString());
    }
    return total;
}
const getPlayerTurnDurationTotalMs = (game, playerId) => game.rounds.reduce((total, round) => total +
    round.turns.reduce((turnTotal, turn) => turnTotal + (turn.playerId === playerId ? (0, exports.getTurnDurationMs)(turn, game) : 0), 0), 0);
exports.getPlayerTurnDurationTotalMs = getPlayerTurnDurationTotalMs;
const getLatestRound = (game) => game.rounds[game.rounds.length - 1];
exports.getLatestRound = getLatestRound;
const getLatestTurn = (game) => (() => {
    const latestRound = (0, exports.getLatestRound)(game);
    return latestRound ? latestRound.turns[latestRound.turns.length - 1] : undefined;
})();
exports.getLatestTurn = getLatestTurn;
const isRoundActive = (game) => {
    const round = (0, exports.getLatestRound)(game);
    return Boolean(round?.startedAt && !round.endedAt);
};
exports.isRoundActive = isRoundActive;
const isTurnActive = (game) => {
    const turn = (0, exports.getLatestTurn)(game);
    return Boolean(turn?.timing.startedAt && !turn.timing.endedAt && !(0, exports.isTurnPaused)(turn));
};
exports.isTurnActive = isTurnActive;
const isTurnPaused = (turn) => {
    const latestPause = turn?.timing.pauses[turn.timing.pauses.length - 1];
    return Boolean(turn?.timing.startedAt && !turn.timing.endedAt && latestPause && !latestPause.endedAt);
};
exports.isTurnPaused = isTurnPaused;
const getCurrentRoundNumber = (game) => (0, exports.getLatestRound)(game)?.roundNumber ?? 0;
exports.getCurrentRoundNumber = getCurrentRoundNumber;
const getCurrentTurnNumber = (game) => (0, exports.getLatestTurn)(game)?.turnNumber ?? 0;
exports.getCurrentTurnNumber = getCurrentTurnNumber;
const getPlayerResult = (playerScore, opponentScore) => {
    if (playerScore > opponentScore) {
        return "win";
    }
    if (playerScore < opponentScore) {
        return "loss";
    }
    return "tie";
};
const createSummaryPlayer = (game, playerId) => {
    const player = game.players.find((entry) => entry.id === playerId);
    const opponent = game.players.find((entry) => entry.id !== playerId);
    const primaryScore = (0, exports.getPlayerComparablePrimaryScore)(game, playerId);
    const secondaryScore = (0, exports.getPlayerComparableSecondaryScore)(game, playerId);
    const totalScore = (0, exports.getPlayerComparableTotalScore)(game, playerId);
    const opponentTotal = (0, exports.getPlayerComparableTotalScore)(game, opponent.id);
    const hasCpData = (0, exports.hasComparableCommandPointData)(game, playerId);
    const commandPointsGained = hasCpData ? sumValues((0, exports.getPlayerCommandPointEvents)(game, playerId, "gained")) : null;
    const commandPointsSpent = hasCpData ? sumValues((0, exports.getPlayerCommandPointEvents)(game, playerId, "spent")) : null;
    return {
        playerId,
        name: player.name,
        armyName: player.army.name,
        primaryScore,
        secondaryScore,
        totalScore,
        commandPointsGained,
        commandPointsSpent,
        commandPointBalance: hasCpData ? (0, exports.getPlayerCommandPoints)(game, playerId) : null,
        result: totalScore !== null && opponentTotal !== null ? getPlayerResult(totalScore, opponentTotal) : null
    };
};
const createGameSummary = (game) => ({
    gameId: game.id,
    status: game.status,
    scheduledDate: game.scheduledDate,
    scheduledTime: game.scheduledTime,
    totalDurationMs: hasCompletedTimingData(game) ? (0, exports.getGameDurationMs)(game) : null,
    roundCount: game.rounds.length,
    players: [
        createSummaryPlayer(game, game.players[0].id),
        createSummaryPlayer(game, game.players[1].id)
    ]
});
exports.createGameSummary = createGameSummary;
const hasPlayerScoreData = (game, playerId, scoreType) => game.scoreDetailLevel === "full" &&
    (!scoreType ||
        scoreType === "primary" ||
        scoreType === "secondary") &&
    game.players.some((player) => player.id === playerId);
const hasComparableScoreData = (game) => (0, exports.hasComparableTotalScoreData)(game);
const hasPlayerCommandPointData = (game, playerId) => (0, exports.hasComparableCommandPointData)(game, playerId);
const hasCompletedTimingData = (game) => game.rounds.some((round) => round.turns.some((turn) => (0, exports.getCompletedTurnDurationMs)(turn, game) !== null));
const createPlayerAggregates = (games) => {
    const playerNames = Array.from(new Set(games.flatMap((game) => game.players.map((player) => player.name))));
    return playerNames
        .map((name) => {
        const playerGames = games
            .map((game) => ({
            game,
            player: game.players.find((player) => player.name === name)
        }))
            .filter((entry) => Boolean(entry.player));
        const gamesCount = playerGames.length;
        const scoredGames = playerGames.filter(({ game }) => hasComparableScoreData(game));
        const goFirstGames = scoredGames.filter(({ game, player }) => game.rounds[0]?.turns[0]?.playerId === player.id);
        const startFirstGames = scoredGames.filter(({ game, player }) => game.startingPlayerId === player.id);
        const wins = scoredGames.filter(({ game, player }) => {
            const opponent = game.players.find((entry) => entry.id !== player.id);
            return (0, exports.getPlayerTotalScore)(game, player.id) > (0, exports.getPlayerTotalScore)(game, opponent.id);
        }).length;
        const losses = scoredGames.filter(({ game, player }) => {
            const opponent = game.players.find((entry) => entry.id !== player.id);
            return (0, exports.getPlayerTotalScore)(game, player.id) < (0, exports.getPlayerTotalScore)(game, opponent.id);
        }).length;
        const ties = scoredGames.length - wins - losses;
        const primaryValues = playerGames
            .filter(({ game, player }) => hasPlayerScoreData(game, player.id, "primary"))
            .map(({ game, player }) => (0, exports.getPlayerPrimaryTotal)(game, player.id));
        const secondaryValues = playerGames
            .filter(({ game, player }) => hasPlayerScoreData(game, player.id, "secondary"))
            .map(({ game, player }) => (0, exports.getPlayerSecondaryTotal)(game, player.id));
        const totalValues = playerGames
            .filter(({ game, player }) => (0, exports.getPlayerComparableTotalScore)(game, player.id) !== null)
            .map(({ game, player }) => (0, exports.getPlayerTotalScore)(game, player.id));
        const durationValues = playerGames
            .filter(({ game }) => hasCompletedTimingData(game))
            .map(({ game }) => (0, exports.getCompletedGameDurationMs)(game))
            .filter((value) => value !== null);
        const spentCpValues = playerGames
            .filter(({ game, player }) => hasPlayerCommandPointData(game, player.id))
            .map(({ game, player }) => (0, exports.getPlayerCommandPointsSpent)(game, player.id));
        return {
            name,
            games: gamesCount,
            wins,
            losses,
            ties,
            winRate: scoredGames.length ? (wins / scoredGames.length) * 100 : null,
            winRateWhenGoFirst: goFirstGames.length
                ? (goFirstGames.filter(({ game, player }) => {
                    const opponent = game.players.find((entry) => entry.id !== player.id);
                    return (0, exports.getPlayerTotalScore)(game, player.id) > (0, exports.getPlayerTotalScore)(game, opponent.id);
                }).length /
                    goFirstGames.length) *
                    100
                : null,
            winRateWhenStartFirst: startFirstGames.length
                ? (startFirstGames.filter(({ game, player }) => {
                    const opponent = game.players.find((entry) => entry.id !== player.id);
                    return (0, exports.getPlayerTotalScore)(game, player.id) > (0, exports.getPlayerTotalScore)(game, opponent.id);
                }).length /
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
exports.createPlayerAggregates = createPlayerAggregates;
const createScenarioLeaders = (games, scenarioSelector) => {
    const grouped = new Map();
    games.forEach((game) => {
        const label = scenarioSelector(game).trim();
        if (!label || !hasComparableScoreData(game)) {
            return;
        }
        const scenarioPlayers = grouped.get(label) ?? new Map();
        game.players.forEach((player) => {
            const opponent = game.players.find((entry) => entry.id !== player.id);
            const existing = scenarioPlayers.get(player.name) ?? { wins: 0, games: 0 };
            scenarioPlayers.set(player.name, {
                wins: existing.wins +
                    ((0, exports.getPlayerTotalScore)(game, player.id) > (0, exports.getPlayerTotalScore)(game, opponent.id) ? 1 : 0),
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
const createMissionLeaders = (games) => createScenarioLeaders(games, (game) => game.primaryMission);
exports.createMissionLeaders = createMissionLeaders;
const createDeploymentLeaders = (games) => createScenarioLeaders(games, (game) => game.deployment);
exports.createDeploymentLeaders = createDeploymentLeaders;
const createScenarioPerformanceAggregates = (games, scenarioSelector) => {
    const leaders = createScenarioLeaders(games, scenarioSelector);
    const leaderByLabel = new Map(leaders.map((leader) => [leader.label, leader]));
    const grouped = new Map();
    games.forEach((game) => {
        const label = scenarioSelector(game).trim();
        if (!label || !hasComparableScoreData(game)) {
            return;
        }
        const existing = grouped.get(label) ?? { scores: [], durations: [], games: 0 };
        existing.games += 1;
        existing.scores.push((0, exports.getPlayerTotalScore)(game, game.players[0].id) + (0, exports.getPlayerTotalScore)(game, game.players[1].id));
        const duration = (0, exports.getCompletedGameDurationMs)(game);
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
exports.createScenarioPerformanceAggregates = createScenarioPerformanceAggregates;
const createInitialGameFilters = () => ({
    query: "",
    playerName: "all",
    armyName: "all",
    status: "all",
    dateFrom: "",
    dateTo: ""
});
exports.createInitialGameFilters = createInitialGameFilters;
const getFilterOptions = (games) => ({
    playerNames: Array.from(new Set(games.flatMap((game) => game.players.map((player) => player.name)))).sort((left, right) => left.localeCompare(right)),
    armyNames: Array.from(new Set(games.flatMap((game) => game.players.map((player) => player.army.name)))).sort((left, right) => left.localeCompare(right))
});
exports.getFilterOptions = getFilterOptions;
const filterGames = (games, filters) => {
    const normalizedQuery = filters.query.trim().toLocaleLowerCase();
    return games.filter((game) => {
        const matchesQuery = !normalizedQuery ||
            [
                game.scheduledDate,
                game.scheduledTime,
                String(game.gamePoints),
                game.deployment,
                game.primaryMission,
                ...game.players.map((player) => player.name),
                ...game.players.map((player) => player.army.name)
            ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
        const matchesPlayer = filters.playerName === "all" || game.players.some((player) => player.name === filters.playerName);
        const matchesArmy = filters.armyName === "all" || game.players.some((player) => player.army.name === filters.armyName);
        const matchesStatus = filters.status === "all" || game.status === filters.status;
        const matchesDateFrom = !filters.dateFrom || game.scheduledDate >= filters.dateFrom;
        const matchesDateTo = !filters.dateTo || game.scheduledDate <= filters.dateTo;
        return (matchesQuery &&
            matchesPlayer &&
            matchesArmy &&
            matchesStatus &&
            matchesDateFrom &&
            matchesDateTo);
    });
};
exports.filterGames = filterGames;
const createStatsOverview = (games) => {
    const playerEntries = games.flatMap((game) => game.players);
    const playerCount = new Set(playerEntries.map((player) => player.name)).size;
    const armyCount = new Set(playerEntries.map((player) => player.army.name)).size;
    const completedDurations = games
        .map((game) => (0, exports.getCompletedGameDurationMs)(game))
        .filter((duration) => duration !== null);
    const roundsValues = games.filter((game) => game.rounds.length > 0).map((game) => game.rounds.length);
    const comparableScoreGames = games.filter((game) => hasComparableScoreData(game));
    const combinedScoreValues = comparableScoreGames.map((game) => (0, exports.getPlayerTotalScore)(game, game.players[0].id) + (0, exports.getPlayerTotalScore)(game, game.players[1].id));
    const playerOneScoreValues = comparableScoreGames.map((game) => (0, exports.getPlayerTotalScore)(game, game.players[0].id));
    const playerTwoScoreValues = comparableScoreGames.map((game) => (0, exports.getPlayerTotalScore)(game, game.players[1].id));
    const spentCpValues = games.flatMap((game) => game.players
        .filter((player) => hasPlayerCommandPointData(game, player.id))
        .map((player) => (0, exports.getPlayerCommandPointsSpent)(game, player.id)));
    return {
        games: games.length,
        players: playerCount,
        armies: armyCount,
        averageDurationMs: averageOrNull(completedDurations),
        averageRounds: averageOrNull(roundsValues),
        averageCombinedScore: averageOrNull(combinedScoreValues),
        averagePlayerOneScore: averageOrNull(playerOneScoreValues),
        averagePlayerTwoScore: averageOrNull(playerTwoScoreValues),
        averageSpentCp: averageOrNull(spentCpValues)
    };
};
exports.createStatsOverview = createStatsOverview;
const createArmyAggregates = (games) => {
    const armyNames = Array.from(new Set(games.flatMap((game) => game.players.map((player) => player.army.name))));
    return armyNames
        .map((armyName) => {
        const armyGames = games
            .map((game) => ({
            game,
            player: game.players.find((player) => player.army.name === armyName)
        }))
            .filter((entry) => Boolean(entry.player));
        const gamesCount = armyGames.length;
        const scoredGames = armyGames.filter(({ game }) => hasComparableScoreData(game));
        const wins = scoredGames.filter(({ game, player }) => {
            const opponent = game.players.find((entry) => entry.id !== player.id);
            return (0, exports.getPlayerTotalScore)(game, player.id) > (0, exports.getPlayerTotalScore)(game, opponent.id);
        }).length;
        const losses = scoredGames.filter(({ game, player }) => {
            const opponent = game.players.find((entry) => entry.id !== player.id);
            return (0, exports.getPlayerTotalScore)(game, player.id) < (0, exports.getPlayerTotalScore)(game, opponent.id);
        }).length;
        const ties = scoredGames.length - wins - losses;
        const primaryValues = armyGames
            .filter(({ game, player }) => hasPlayerScoreData(game, player.id, "primary"))
            .map(({ game, player }) => (0, exports.getPlayerPrimaryTotal)(game, player.id));
        const secondaryValues = armyGames
            .filter(({ game, player }) => hasPlayerScoreData(game, player.id, "secondary"))
            .map(({ game, player }) => (0, exports.getPlayerSecondaryTotal)(game, player.id));
        const totalValues = armyGames
            .filter(({ game, player }) => (0, exports.getPlayerComparableTotalScore)(game, player.id) !== null)
            .map(({ game, player }) => (0, exports.getPlayerTotalScore)(game, player.id));
        return {
            armyName,
            games: gamesCount,
            wins,
            losses,
            ties,
            winRate: scoredGames.length ? (wins / scoredGames.length) * 100 : null,
            averagePrimary: averageOrNull(primaryValues),
            averageSecondary: averageOrNull(secondaryValues),
            averageTotal: averageOrNull(totalValues)
        };
    })
        .sort((left, right) => right.games - left.games || left.armyName.localeCompare(right.armyName));
};
exports.createArmyAggregates = createArmyAggregates;
const createMatchupAggregates = (games) => {
    const grouped = new Map();
    games.forEach((game) => {
        const [armyA, armyB] = game.players.map((player) => player.army.name).sort((left, right) => left.localeCompare(right));
        const label = `${armyA} vs ${armyB}`;
        const existing = grouped.get(label) ?? {
            count: 0,
            durations: [],
            combinedScores: [],
            scoreDifferences: []
        };
        const scoreA = (0, exports.getPlayerTotalScore)(game, game.players[0].id);
        const scoreB = (0, exports.getPlayerTotalScore)(game, game.players[1].id);
        existing.count += 1;
        const completedDuration = (0, exports.getCompletedGameDurationMs)(game);
        if (completedDuration !== null) {
            existing.durations.push(completedDuration);
        }
        if (hasComparableScoreData(game)) {
            existing.combinedScores.push(scoreA + scoreB);
            existing.scoreDifferences.push(Math.abs(scoreA - scoreB));
        }
        grouped.set(label, existing);
    });
    return Array.from(grouped.entries())
        .map(([label, values]) => ({
        label,
        games: values.count,
        averageDurationMs: averageOrNull(values.durations),
        averageCombinedScore: averageOrNull(values.combinedScores),
        averageScoreDifference: averageOrNull(values.scoreDifferences)
    }))
        .sort((left, right) => right.games - left.games || left.label.localeCompare(right.label));
};
exports.createMatchupAggregates = createMatchupAggregates;
const createRoundDurationAggregates = (games) => {
    const grouped = new Map();
    games.forEach((game) => {
        game.rounds.forEach((round) => {
            const duration = (0, exports.getCompletedRoundDurationMs)(round, game);
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
        averageDurationMs: averageOrNull(durations),
        maxDurationMs: durations.length ? Math.max(...durations) : null
    }))
        .sort((left, right) => left.roundNumber - right.roundNumber);
};
exports.createRoundDurationAggregates = createRoundDurationAggregates;
const createRoundScoreAggregates = (games) => {
    const grouped = new Map();
    games.forEach((game) => {
        if (!hasComparableScoreData(game)) {
            return;
        }
        game.rounds.forEach((round) => {
            const playerOneScore = (0, exports.getPlayerRoundScoreTotal)(game, game.players[0].id, round.roundNumber);
            const playerTwoScore = (0, exports.getPlayerRoundScoreTotal)(game, game.players[1].id, round.roundNumber);
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
exports.createRoundScoreAggregates = createRoundScoreAggregates;
const createPlayerTurnDurationAggregates = (games) => {
    const grouped = new Map();
    games.forEach((game) => {
        game.rounds.forEach((round) => {
            round.turns.forEach((turn) => {
                const player = game.players.find((entry) => entry.id === turn.playerId);
                const duration = (0, exports.getCompletedTurnDurationMs)(turn, game);
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
exports.createPlayerTurnDurationAggregates = createPlayerTurnDurationAggregates;
const createCpScoreCorrelationPoints = (games) => games.flatMap((game) => game.players
    .filter((player) => hasPlayerCommandPointData(game, player.id) && (0, exports.getPlayerComparableTotalScore)(game, player.id) !== null)
    .map((player) => ({
    playerName: player.name,
    gameId: game.id,
    scheduledDate: game.scheduledDate,
    scheduledTime: game.scheduledTime,
    cpSpent: (0, exports.getPlayerCommandPointsSpent)(game, player.id),
    totalScore: (0, exports.getPlayerTotalScore)(game, player.id),
    primaryScore: (0, exports.getPlayerComparablePrimaryScore)(game, player.id),
    secondaryScore: (0, exports.getPlayerComparableSecondaryScore)(game, player.id)
})));
exports.createCpScoreCorrelationPoints = createCpScoreCorrelationPoints;
const getTurnRecords = (games) => {
    const turnRecords = games.flatMap((game) => game.rounds.flatMap((round) => round.turns
        .map((turn) => {
        const player = game.players.find((entry) => entry.id === turn.playerId);
        const durationMs = (0, exports.getCompletedTurnDurationMs)(turn, game);
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
            primaryScore: sumValues(game.scoreEvents
                .filter((event) => event.playerId === turn.playerId &&
                event.roundNumber === round.roundNumber &&
                event.turnNumber === turn.turnNumber &&
                event.scoreType === "primary")
                .map((event) => ({ value: event.value }))),
            secondaryScore: sumValues(game.scoreEvents
                .filter((event) => event.playerId === turn.playerId &&
                event.roundNumber === round.roundNumber &&
                event.turnNumber === turn.turnNumber &&
                event.scoreType === "secondary")
                .map((event) => ({ value: event.value }))),
            totalScore: sumValues(game.scoreEvents
                .filter((event) => event.playerId === turn.playerId &&
                event.roundNumber === round.roundNumber &&
                event.turnNumber === turn.turnNumber &&
                event.scoreType !== "legacy-total")
                .map((event) => ({ value: event.value })))
        };
    })
        .filter((record) => Boolean(record))));
    if (!turnRecords.length) {
        return {
            longestTurn: null,
            fastestTurn: null,
            highestScoringTurn: null
        };
    }
    const sortedByDuration = [...turnRecords].sort((left, right) => left.durationMs - right.durationMs);
    const sortedByScore = [...turnRecords].sort((left, right) => left.totalScore - right.totalScore || left.secondaryScore - right.secondaryScore);
    return {
        fastestTurn: sortedByDuration[0] ?? null,
        longestTurn: sortedByDuration[sortedByDuration.length - 1] ?? null,
        highestScoringTurn: sortedByScore[sortedByScore.length - 1] ?? null
    };
};
exports.getTurnRecords = getTurnRecords;
