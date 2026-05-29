"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTimeoutActive = exports.getOfficialStatsGameDurationMs = exports.getCompletedGameDurationMs = exports.getGameDurationMs = exports.getGameBaseDurationMs = exports.getCompletedRoundDurationMs = exports.getRoundDurationMs = exports.getRoundBaseDurationMs = exports.isSetupRunning = exports.isSetupPaused = exports.isSetupActive = exports.getSetupDurationMs = exports.getSetupBaseDurationMs = exports.getCompletedTurnDurationMs = exports.getTurnDurationMs = exports.getSetupCorrectionMs = exports.getTotalCorrectionMs = exports.getRoundCorrectionMs = exports.getTurnCorrectionMs = exports.getTurnBaseDurationMs = exports.getPlayerCurrentRoundCommandPointsSpent = exports.getPlayerCurrentRoundCommandPointsGained = exports.getPlayerCommandPointsSpent = exports.getPlayerCommandPointsGained = exports.getPlayerCommandPoints = exports.getPlayerCommandPointEvents = exports.getPlayerCurrentRoundTotalScore = exports.getPlayerCurrentRoundChallengeTotal = exports.getPlayerCurrentRoundSecondaryTotal = exports.getPlayerCurrentRoundPrimaryTotal = exports.getPlayerRoundScoreTotal = exports.hasComparableCommandPointData = exports.getPlayerComparableTotalScore = exports.getPlayerComparableSecondaryScore = exports.getPlayerComparablePrimaryScore = exports.hasLegacyRoundTotalScoreData = exports.hasComparableTotalScoreData = exports.hasDetailedScoreData = exports.getPlayerTotalScore = exports.getPlayerLegacyRoundTotal = exports.getPlayerChallengeTotal = exports.getPlayerSecondaryTotal = exports.getPlayerPrimaryTotal = exports.getPlayerScoreTotal = exports.getPlayerScoreEvents = exports.prepareGamesForStats = exports.prepareGameForStats = exports.isStatsEligibleGame = exports.getCountedRounds = exports.createStatsEligibilityReport = void 0;
exports.getTurnRecords = exports.createCpScoreCorrelationPoints = exports.createPlayerTurnDurationAggregates = exports.createRoundScoreAggregates = exports.createRoundDurationAggregates = exports.createMatchupAggregates = exports.createArmyAggregates = exports.createStatsOverview = exports.filterGames = exports.getFilterOptions = exports.createInitialGameFilters = exports.createScenarioPerformanceAggregates = exports.createDeploymentLeaders = exports.createMissionLeaders = exports.createPlayerAggregates = exports.createGameSummary = exports.getCurrentTurnNumber = exports.getCurrentRoundNumber = exports.isTurnPaused = exports.isTurnActive = exports.isRoundActive = exports.getLatestTurn = exports.getLatestRound = exports.getPlayerTurnDurationTotalMs = void 0;
exports.getTimeoutDurationMs = getTimeoutDurationMs;
const time_1 = require("./time");
const sumValues = (items) => items.reduce((total, item) => total + item.value, 0);
const clampFloor = (value) => Math.max(value, 0);
const getRoundCorrectionKey = (roundNumber) => String(roundNumber);
const getTurnCorrectionKey = (roundNumber, turnNumber) => `${roundNumber}:${turnNumber}`;
const averageOrNull = (values) => values.length ? sumValues(values.map((value) => ({ value }))) / values.length : null;
const MIN_STATS_TURN_DURATION_MS = 10 * 1000;
const getTurnKey = (roundNumber, turnNumber) => roundNumber && turnNumber ? `${roundNumber}:${turnNumber}` : null;
const isValidTurnShape = (turn) => Number.isFinite(turn.roundNumber) && Number.isFinite(turn.turnNumber) && Boolean(turn.playerId);
const hasTurnScoreEvents = (game, turn) => game.scoreEvents.some((event) => event.playerId === turn.playerId &&
    event.roundNumber === turn.roundNumber &&
    event.turnNumber === turn.turnNumber);
const hasTurnNoteEvents = (game, turn) => game.noteEvents.some((event) => event.playerId === turn.playerId &&
    event.roundNumber === turn.roundNumber &&
    event.turnNumber === turn.turnNumber);
const hasRoundLevelStatsEvents = (game, round) => game.scoreEvents.some((event) => event.roundNumber === round.roundNumber && !event.turnNumber) ||
    game.noteEvents.some((event) => event.roundNumber === round.roundNumber && !event.turnNumber);
const hasRelevantStatsEventsInTurn = (game, turn) => hasTurnScoreEvents(game, turn) ||
    hasTurnNoteEvents(game, turn);
const getStatsEligibilityMode = (game) => game.statsEligibilityMode ?? "auto";
const STATS_AREAS = ["result", "scoring", "cp", "time"];
const STATS_TURN_AREAS = ["scoring", "cp", "time"];
const getAreaMode = (game, area) => game.statsEligibilityOverrides?.areas?.[area] ?? getStatsEligibilityMode(game);
const getTurnOverrideMode = (game, area, turn) => game.statsEligibilityOverrides?.turns?.[`${turn.roundNumber}:${turn.turnNumber}`]?.[area] ?? "auto";
const isBaseStatsEligibleGame = (game) => game.finishReason !== "interrupted" && game.finishReason !== "abandoned";
const isStatsEligibleTurn = (game, turn) => {
    const durationMs = turn.timing.startedAt && (turn.timing.endedAt || game.endedAt)
        ? (0, exports.getTurnDurationMs)(turn, game)
        : null;
    return ((durationMs !== null && durationMs >= MIN_STATS_TURN_DURATION_MS) ||
        hasRelevantStatsEventsInTurn(game, turn));
};
const isStatsDurationEligibleTurn = (game, turn) => {
    const durationMs = turn.timing.startedAt && (turn.timing.endedAt || game.endedAt)
        ? (0, exports.getTurnDurationMs)(turn, game)
        : null;
    return durationMs !== null && durationMs >= MIN_STATS_TURN_DURATION_MS;
};
const getTurnAutoReasons = (game, turn, area) => {
    const durationMs = turn.timing.startedAt && (turn.timing.endedAt || game.endedAt)
        ? (0, exports.getTurnDurationMs)(turn, game)
        : null;
    const hasDuration = durationMs !== null && durationMs >= MIN_STATS_TURN_DURATION_MS;
    const hasScore = hasTurnScoreEvents(game, turn);
    const hasNote = hasTurnNoteEvents(game, turn);
    if (area === "time") {
        return hasDuration ? ["verwertbare Dauer"] : ["keine verwertbare Dauer"];
    }
    if (area === "cp") {
        return hasDuration ? ["verwertbare Dauer"] : ["CP allein erzeugt keine Wertung"];
    }
    const reasons = [
        ...(hasDuration ? ["verwertbare Dauer"] : []),
        ...(hasScore ? ["Score-Event"] : []),
        ...(hasNote ? ["Notiz"] : [])
    ];
    return reasons.length ? reasons : ["keine verwertbare Dauer und keine Score-/Notiz-Events"];
};
const getAutoTurnDecision = (game, turn, area) => area === "cp" || area === "time"
    ? isStatsDurationEligibleTurn(game, turn)
    : isStatsEligibleTurn(game, turn);
const getEffectiveTurnDecision = (game, turn, area) => {
    const areaMode = getAreaMode(game, area);
    if (areaMode === "exclude") {
        return false;
    }
    if (areaMode === "auto" && !isBaseStatsEligibleGame(game)) {
        return false;
    }
    const turnMode = getTurnOverrideMode(game, area, turn);
    if (turnMode === "include") {
        return true;
    }
    if (turnMode === "exclude") {
        return false;
    }
    return getAutoTurnDecision(game, turn, area);
};
const getEffectiveTurnKeys = (game, area) => new Set(game.rounds.flatMap((round) => round.turns
    .filter((turn) => getEffectiveTurnDecision(game, turn, area))
    .map((turn) => `${turn.roundNumber}:${turn.turnNumber}`)));
const hasEffectiveArea = (game, area) => {
    const areaMode = getAreaMode(game, area);
    if (areaMode === "exclude") {
        return false;
    }
    if (areaMode === "include") {
        return true;
    }
    if (!isBaseStatsEligibleGame(game)) {
        return false;
    }
    if (area === "result") {
        return (0, exports.hasComparableTotalScoreData)(game);
    }
    const keys = getEffectiveTurnKeys(game, area);
    if (keys.size) {
        return true;
    }
    return area === "scoring" && game.scoreDetailLevel !== "full" && (0, exports.hasComparableTotalScoreData)(game);
};
const getEligibleCommandPointTurnEvents = (game, playerId) => game.rounds.flatMap((round) => round.turns.flatMap((turn) => {
    if (turn.playerId !== playerId || !getEffectiveTurnDecision(game, turn, "cp")) {
        return [];
    }
    return game.commandPointEvents.filter((event) => event.playerId === playerId &&
        event.roundNumber === turn.roundNumber &&
        event.turnNumber === turn.turnNumber);
}));
const getEligibleCommandPointsSpent = (game, playerId) => sumValues(getEligibleCommandPointTurnEvents(game, playerId).filter((event) => event.cpType === "spent"));
const hasEligibleCommandPointData = (game, playerId) => game.rounds.some((round) => round.turns.some((turn) => turn.playerId === playerId && getEffectiveTurnDecision(game, turn, "cp")));
const getAreaLabel = (area) => area === "result"
    ? "Ergebniswertung"
    : area === "scoring"
        ? "Scoring-Wertung"
        : area === "cp"
            ? "CP-Wertung"
            : "Zeitwertung";
const getStatusFromTurns = (turns, area, key) => {
    if (!turns.length) {
        return "excluded";
    }
    const counted = turns.filter((turn) => turn.areas[area]?.[key]).length;
    return counted === 0 ? "excluded" : counted === turns.length ? "included" : "partial";
};
const createStatsEligibilityReport = (game) => {
    const turns = (game.rounds ?? []).flatMap((round) => (round.turns ?? []).filter(isValidTurnShape).map((turn) => {
        const playerName = game.players.find((player) => player.id === turn.playerId)?.name ?? "-";
        const areas = Object.fromEntries(STATS_TURN_AREAS.map((area) => {
            const mode = getTurnOverrideMode(game, area, turn);
            return [
                area,
                {
                    mode,
                    auto: getAutoTurnDecision(game, turn, area),
                    effective: getEffectiveTurnDecision(game, turn, area),
                    reasons: getTurnAutoReasons(game, turn, area)
                }
            ];
        }));
        return {
            key: `${turn.roundNumber}:${turn.turnNumber}`,
            label: `R${turn.roundNumber} Z${turn.turnNumber}`,
            roundNumber: turn.roundNumber,
            turnNumber: turn.turnNumber,
            playerName,
            areas
        };
    }));
    const areas = Object.fromEntries(STATS_AREAS.map((area) => {
        const mode = getAreaMode(game, area);
        if (area === "result") {
            const autoIncluded = isBaseStatsEligibleGame(game) && (0, exports.hasComparableTotalScoreData)(game);
            const effective = mode === "exclude" ? false : mode === "include" || autoIncluded;
            return [
                area,
                {
                    area,
                    label: getAreaLabel(area),
                    mode,
                    auto: autoIncluded ? "included" : "excluded",
                    effective: effective ? "included" : "excluded",
                    countedTurns: [],
                    excludedTurns: [],
                    reasons: autoIncluded
                        ? ["Spiel ist nicht abgebrochen/unterbrochen und hat vergleichbare Score-Daten"]
                        : ["Spiel ist abgebrochen/unterbrochen oder hat keine vergleichbaren Score-Daten"]
                }
            ];
        }
        const countedTurns = turns.filter((turn) => turn.areas[area]?.effective).map((turn) => turn.label);
        const excludedTurns = turns.filter((turn) => !turn.areas[area]?.effective).map((turn) => turn.label);
        return [
            area,
            {
                area,
                label: getAreaLabel(area),
                mode,
                auto: getStatusFromTurns(turns, area, "auto"),
                effective: mode === "exclude" ? "excluded" : getStatusFromTurns(turns, area, "effective"),
                countedTurns,
                excludedTurns,
                reasons: area === "cp"
                    ? ["CP-Events zaehlen nur in zeitlich validen oder manuell eingeschlossenen Zuegen"]
                    : area === "time"
                        ? ["Zeitwertung nutzt die Mindestdauer je Zug"]
                        : ["Score-/Notiz-Events oder verwertbare Dauer machen Zuege wertbar"]
            }
        ];
    }));
    return { areas, turns };
};
exports.createStatsEligibilityReport = createStatsEligibilityReport;
const getCountedRounds = (game) => {
    if (game.scoreDetailLevel !== "full") {
        return game.rounds;
    }
    return game.rounds.filter((round) => round.turns.some((turn) => getEffectiveTurnDecision(game, turn, "scoring")) || hasRoundLevelStatsEvents(game, round));
};
exports.getCountedRounds = getCountedRounds;
const hasStatsTurnKey = (validTurnKeys, event) => {
    const turnKey = getTurnKey(event.roundNumber, event.turnNumber);
    return turnKey ? validTurnKeys.has(turnKey) : false;
};
const isStatsEligibleGame = (game) => STATS_AREAS.some((area) => hasEffectiveArea(game, area));
exports.isStatsEligibleGame = isStatsEligibleGame;
const prepareGameForStats = (game) => {
    if (!(0, exports.isStatsEligibleGame)(game)) {
        return null;
    }
    if (getStatsEligibilityMode(game) === "include" &&
        !Object.keys(game.statsEligibilityOverrides?.areas ?? {}).length &&
        !Object.keys(game.statsEligibilityOverrides?.turns ?? {}).length) {
        return game;
    }
    if (game.scoreDetailLevel !== "full") {
        return game;
    }
    const scoringTurnKeys = getEffectiveTurnKeys(game, "scoring");
    const cpTurnKeys = getEffectiveTurnKeys(game, "cp");
    const timeTurnKeys = getEffectiveTurnKeys(game, "time");
    const validTurnKeys = new Set([...scoringTurnKeys, ...cpTurnKeys, ...timeTurnKeys]);
    const rounds = game.rounds
        .map((round) => ({
        ...round,
        turns: round.turns.filter((turn) => validTurnKeys.has(`${turn.roundNumber}:${turn.turnNumber}`))
    }))
        .filter((round) => round.turns.length > 0 || hasRoundLevelStatsEvents(game, round));
    const validRoundKeys = new Set(rounds.map((round) => String(round.roundNumber)));
    if (!validTurnKeys.size && !validRoundKeys.size) {
        return null;
    }
    return {
        ...game,
        rounds,
        scoreEvents: game.scoreEvents.filter((event) => hasStatsTurnKey(scoringTurnKeys, event) ||
            (!event.turnNumber && event.roundNumber ? validRoundKeys.has(String(event.roundNumber)) : false)),
        commandPointEvents: game.commandPointEvents.filter((event) => hasStatsTurnKey(cpTurnKeys, event)),
        noteEvents: game.noteEvents.filter((event) => hasStatsTurnKey(validTurnKeys, event) ||
            (!event.turnNumber && event.roundNumber ? validRoundKeys.has(String(event.roundNumber)) : false)),
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
            turns: Object.fromEntries(Object.entries(game.timerCorrections.turns).filter(([turnKey]) => validTurnKeys.has(turnKey)))
        }
    };
};
exports.prepareGameForStats = prepareGameForStats;
const prepareGamesForStats = (games) => games.map((game) => (0, exports.prepareGameForStats)(game)).filter((game) => Boolean(game));
exports.prepareGamesForStats = prepareGamesForStats;
const getPlayerScoreEvents = (game, playerId, scoreType) => game.scoreEvents.filter((event) => event.playerId === playerId && (!scoreType || event.scoreType === scoreType));
exports.getPlayerScoreEvents = getPlayerScoreEvents;
const getPlayerScoreTotal = (game, playerId, scoreType) => clampFloor(sumValues((0, exports.getPlayerScoreEvents)(game, playerId, scoreType)));
exports.getPlayerScoreTotal = getPlayerScoreTotal;
const getPlayerPrimaryTotal = (game, playerId) => (0, exports.getPlayerScoreTotal)(game, playerId, "primary");
exports.getPlayerPrimaryTotal = getPlayerPrimaryTotal;
const getPlayerSecondaryTotal = (game, playerId) => (0, exports.getPlayerScoreTotal)(game, playerId, "secondary");
exports.getPlayerSecondaryTotal = getPlayerSecondaryTotal;
const getPlayerChallengeTotal = (game, playerId) => (0, exports.getPlayerScoreTotal)(game, playerId, "challenge");
exports.getPlayerChallengeTotal = getPlayerChallengeTotal;
const getPlayerLegacyRoundTotal = (game, playerId) => (0, exports.getPlayerScoreTotal)(game, playerId, "legacy-total");
exports.getPlayerLegacyRoundTotal = getPlayerLegacyRoundTotal;
const hasLegacyRoundTotals = (game) => game.scoreEvents.some((event) => event.scoreType === "legacy-total");
const getPlayerTotalScore = (game, playerId) => game.scoreDetailLevel === "total-only"
    ? clampFloor(hasLegacyRoundTotals(game)
        ? (0, exports.getPlayerLegacyRoundTotal)(game, playerId)
        : game.legacyScoreTotals[playerId] ?? 0)
    : (0, exports.getPlayerPrimaryTotal)(game, playerId) + (0, exports.getPlayerSecondaryTotal)(game, playerId) + (0, exports.getPlayerChallengeTotal)(game, playerId);
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
const hasComparableCommandPointData = (game, playerId) => hasEligibleCommandPointData(game, playerId);
exports.hasComparableCommandPointData = hasComparableCommandPointData;
const getPlayerRoundScoreTotal = (game, playerId, roundNumber, scoreType) => sumValues(game.scoreEvents.filter((event) => event.playerId === playerId &&
    event.roundNumber === roundNumber &&
    (!scoreType || event.scoreType === scoreType)));
exports.getPlayerRoundScoreTotal = getPlayerRoundScoreTotal;
const getPlayerCurrentRoundPrimaryTotal = (game, playerId, roundNumber = (0, exports.getCurrentRoundNumber)(game)) => (0, exports.getPlayerRoundScoreTotal)(game, playerId, roundNumber, "primary");
exports.getPlayerCurrentRoundPrimaryTotal = getPlayerCurrentRoundPrimaryTotal;
const getPlayerCurrentRoundSecondaryTotal = (game, playerId, roundNumber = (0, exports.getCurrentRoundNumber)(game)) => (0, exports.getPlayerRoundScoreTotal)(game, playerId, roundNumber, "secondary");
exports.getPlayerCurrentRoundSecondaryTotal = getPlayerCurrentRoundSecondaryTotal;
const getPlayerCurrentRoundChallengeTotal = (game, playerId, roundNumber = (0, exports.getCurrentRoundNumber)(game)) => (0, exports.getPlayerRoundScoreTotal)(game, playerId, roundNumber, "challenge");
exports.getPlayerCurrentRoundChallengeTotal = getPlayerCurrentRoundChallengeTotal;
const getPlayerCurrentRoundTotalScore = (game, playerId, roundNumber = (0, exports.getCurrentRoundNumber)(game)) => game.scoreDetailLevel === "total-only"
    ? (0, exports.getPlayerRoundScoreTotal)(game, playerId, roundNumber, "legacy-total")
    : (0, exports.getPlayerRoundScoreTotal)(game, playerId, roundNumber);
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
const getPlayerCurrentRoundCommandPointsGained = (game, playerId, roundNumber = (0, exports.getCurrentRoundNumber)(game)) => (0, exports.getPlayerCommandPointEvents)(game, playerId, "gained")
    .filter((event) => event.roundNumber === roundNumber)
    .reduce((total, event) => total + event.value, 0);
exports.getPlayerCurrentRoundCommandPointsGained = getPlayerCurrentRoundCommandPointsGained;
const getPlayerCurrentRoundCommandPointsSpent = (game, playerId, roundNumber = (0, exports.getCurrentRoundNumber)(game)) => (0, exports.getPlayerCommandPointEvents)(game, playerId, "spent")
    .filter((event) => event.roundNumber === roundNumber)
    .reduce((total, event) => total + event.value, 0);
exports.getPlayerCurrentRoundCommandPointsSpent = getPlayerCurrentRoundCommandPointsSpent;
const getTurnBaseDurationMs = (turn, fallbackEndedAt) => {
    const effectiveEndedAt = turn.timing.endedAt ?? fallbackEndedAt ?? new Date().toISOString();
    const totalDuration = (0, time_1.getDurationMs)(turn.timing.startedAt, effectiveEndedAt);
    const pausedDuration = turn.timing.pauses.reduce((total, pause) => total + (0, time_1.getDurationMs)(pause.startedAt, pause.endedAt ?? effectiveEndedAt), 0);
    return Math.max(totalDuration - pausedDuration, 0);
};
exports.getTurnBaseDurationMs = getTurnBaseDurationMs;
const getTurnCorrectionMs = (game, roundNumber, turnNumber) => game.timerCorrections.turns[getTurnCorrectionKey(roundNumber, turnNumber)] ?? 0;
exports.getTurnCorrectionMs = getTurnCorrectionMs;
const getRoundCorrectionMs = (game, roundNumber) => game.timerCorrections.rounds[getRoundCorrectionKey(roundNumber)] ?? 0;
exports.getRoundCorrectionMs = getRoundCorrectionMs;
const getTotalCorrectionMs = (game) => game.timerCorrections.totalMs ?? 0;
exports.getTotalCorrectionMs = getTotalCorrectionMs;
const getSetupCorrectionMs = (game) => (0, exports.getTurnCorrectionMs)(game, 0, 1);
exports.getSetupCorrectionMs = getSetupCorrectionMs;
const getTurnDurationMs = (turn, game) => clampFloor((0, exports.getTurnBaseDurationMs)(turn, game?.endedAt) +
    (game ? (0, exports.getTurnCorrectionMs)(game, turn.roundNumber, turn.turnNumber) : 0));
exports.getTurnDurationMs = getTurnDurationMs;
const getCompletedTurnDurationMs = (turn, game) => turn.timing.startedAt && turn.timing.endedAt ? (0, exports.getTurnDurationMs)(turn, game) : null;
exports.getCompletedTurnDurationMs = getCompletedTurnDurationMs;
const getSetupBaseDurationMs = (game, includeOpenSetup = true) => {
    const setupEvents = [...game.timeEvents]
        .filter((event) => event.action === "setup-start" ||
        event.action === "setup-end" ||
        event.action === "setup-pause" ||
        event.action === "setup-resume")
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    let startedAt = null;
    let pauseStartedAt = null;
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
            pausedDuration += (0, time_1.getDurationMs)(pauseStartedAt, event.createdAt);
            pauseStartedAt = null;
            return;
        }
        if (event.action === "setup-end") {
            const endedAt = event.createdAt;
            if (pauseStartedAt) {
                pausedDuration += (0, time_1.getDurationMs)(pauseStartedAt, endedAt);
                pauseStartedAt = null;
            }
            total += Math.max((0, time_1.getDurationMs)(startedAt, endedAt) - pausedDuration, 0);
            startedAt = null;
            pausedDuration = 0;
        }
    });
    if (startedAt && includeOpenSetup) {
        const now = game.endedAt ?? new Date().toISOString();
        const openPausedDuration = pauseStartedAt
            ? pausedDuration + (0, time_1.getDurationMs)(pauseStartedAt, now)
            : pausedDuration;
        total += Math.max((0, time_1.getDurationMs)(startedAt, now) - openPausedDuration, 0);
    }
    return total;
};
exports.getSetupBaseDurationMs = getSetupBaseDurationMs;
const getSetupDurationMs = (game) => clampFloor((0, exports.getSetupBaseDurationMs)(game) + (0, exports.getSetupCorrectionMs)(game));
exports.getSetupDurationMs = getSetupDurationMs;
const isSetupActive = (game) => {
    const setupEvents = [...game.timeEvents]
        .filter((event) => event.action === "setup-start" ||
        event.action === "setup-end" ||
        event.action === "setup-pause" ||
        event.action === "setup-resume")
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const latest = setupEvents[setupEvents.length - 1];
    return Boolean(setupEvents.length && latest?.action !== "setup-end");
};
exports.isSetupActive = isSetupActive;
const isSetupPaused = (game) => {
    const setupEvents = [...game.timeEvents]
        .filter((event) => event.action === "setup-start" ||
        event.action === "setup-end" ||
        event.action === "setup-pause" ||
        event.action === "setup-resume")
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const latest = setupEvents[setupEvents.length - 1];
    return latest?.action === "setup-pause";
};
exports.isSetupPaused = isSetupPaused;
const isSetupRunning = (game) => (0, exports.isSetupActive)(game) && !(0, exports.isSetupPaused)(game);
exports.isSetupRunning = isSetupRunning;
const getRoundBaseDurationMs = (round) => round.turns.reduce((total, turn) => total + (0, exports.getTurnBaseDurationMs)(turn), 0);
exports.getRoundBaseDurationMs = getRoundBaseDurationMs;
const getRoundBaseDurationMsForGame = (round, game) => round.turns.reduce((total, turn) => total + (0, exports.getTurnBaseDurationMs)(turn, game.endedAt), 0);
const getRoundDurationMs = (round, game) => clampFloor(round.turns.reduce((total, turn) => total + (0, exports.getTurnDurationMs)(turn, game), 0) +
    (game ? (0, exports.getRoundCorrectionMs)(game, round.roundNumber) + getTimeoutDurationMs(game, round.roundNumber) : 0));
exports.getRoundDurationMs = getRoundDurationMs;
const getCompletedRoundDurationMs = (round, game) => round.startedAt && round.endedAt ? (0, exports.getRoundDurationMs)(round, game) : null;
exports.getCompletedRoundDurationMs = getCompletedRoundDurationMs;
const getGameBaseDurationMs = (game) => (0, exports.getSetupDurationMs)(game) + game.rounds.reduce((total, round) => total + getRoundBaseDurationMsForGame(round, game), 0);
exports.getGameBaseDurationMs = getGameBaseDurationMs;
const getGameDurationMs = (game) => clampFloor((0, exports.getSetupDurationMs)(game) +
    game.rounds.reduce((total, round) => total + (0, exports.getRoundDurationMs)(round, game), 0) +
    (0, exports.getTotalCorrectionMs)(game));
exports.getGameDurationMs = getGameDurationMs;
const getCompletedGameDurationMs = (game) => game.startedAt && game.endedAt ? (0, exports.getGameDurationMs)(game) : null;
exports.getCompletedGameDurationMs = getCompletedGameDurationMs;
const getOfficialStatsGameDurationMs = (game) => {
    if (!game.endedAt || game.scoreDetailLevel !== "full") {
        return null;
    }
    if (!game.rounds.some((round) => round.turns.some((turn) => turn.timing.startedAt))) {
        return null;
    }
    return (0, exports.getGameDurationMs)(game);
};
exports.getOfficialStatsGameDurationMs = getOfficialStatsGameDurationMs;
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
const getPlayerResult = (game, playerScore, opponentScore) => {
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
const getPlayerGameResult = (game, playerId) => {
    if (game.finishReason === "draw") {
        return "tie";
    }
    const opponent = game.players.find((entry) => entry.id !== playerId);
    return getPlayerResult(game, (0, exports.getPlayerTotalScore)(game, playerId), (0, exports.getPlayerTotalScore)(game, opponent.id));
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
        result: game.finishReason === "draw"
            ? "tie"
            : totalScore !== null && opponentTotal !== null
                ? getPlayerResult(game, totalScore, opponentTotal)
                : null
    };
};
const createGameSummary = (game) => ({
    gameId: game.id,
    status: game.status,
    scheduledDate: game.scheduledDate,
    scheduledTime: game.scheduledTime,
    totalDurationMs: hasCompletedTimingData(game) ? (0, exports.getGameDurationMs)(game) : null,
    roundCount: (0, exports.getCountedRounds)(game).length,
    players: [
        createSummaryPlayer(game, game.players[0].id),
        createSummaryPlayer(game, game.players[1].id)
    ]
});
exports.createGameSummary = createGameSummary;
const hasPlayerScoreData = (game, playerId, scoreType) => game.scoreDetailLevel === "full" &&
    (!scoreType ||
        scoreType === "primary" ||
        scoreType === "secondary" ||
        scoreType === "challenge") &&
    game.players.some((player) => player.id === playerId);
const hasResultData = (game) => hasEffectiveArea(game, "result") && (0, exports.hasComparableTotalScoreData)(game);
const hasComparableScoreData = (game) => hasEffectiveArea(game, "scoring") && (0, exports.hasComparableTotalScoreData)(game);
const hasPlayerCommandPointData = (game, playerId) => (0, exports.hasComparableCommandPointData)(game, playerId);
const hasCompletedTimingData = (game) => (0, exports.getOfficialStatsGameDurationMs)(game) !== null;
const hasDetailedTimingStats = (game) => game.scoreDetailLevel === "full" && hasCompletedTimingData(game);
const getStatsGameDurationMs = (game) => {
    if (!game.endedAt || !hasEffectiveArea(game, "time") || !hasDetailedTimingStats(game)) {
        return null;
    }
    return (0, exports.getOfficialStatsGameDurationMs)(game);
};
const createGameSourceById = (games) => new Map(games.map((game) => [game.id, game]));
const createPlayerAggregates = (games, durationSourceGames = games) => {
    const durationSourceById = createGameSourceById(durationSourceGames);
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
        const scoredGames = playerGames.filter(({ game }) => hasResultData(game));
        const goFirstGames = scoredGames.filter(({ game, player }) => game.rounds[0]?.turns[0]?.playerId === player.id);
        const startFirstGames = scoredGames.filter(({ game, player }) => game.startingPlayerId === player.id);
        const wins = scoredGames.filter(({ game, player }) => getPlayerGameResult(game, player.id) === "win").length;
        const losses = scoredGames.filter(({ game, player }) => getPlayerGameResult(game, player.id) === "loss").length;
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
            .filter(({ game }) => game.scoreDetailLevel === "full")
            .map(({ game }) => getStatsGameDurationMs(durationSourceById.get(game.id) ?? game))
            .filter((value) => value !== null);
        const spentCpValues = playerGames
            .filter(({ game, player }) => game.scoreDetailLevel === "full" && hasEligibleCommandPointData(game, player.id))
            .map(({ game, player }) => getEligibleCommandPointsSpent(game, player.id));
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
            const existing = scenarioPlayers.get(player.name) ?? { wins: 0, games: 0 };
            scenarioPlayers.set(player.name, {
                wins: existing.wins +
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
const createMissionLeaders = (games) => createScenarioLeaders(games, (game) => game.primaryMission);
exports.createMissionLeaders = createMissionLeaders;
const createDeploymentLeaders = (games) => createScenarioLeaders(games, (game) => game.deployment);
exports.createDeploymentLeaders = createDeploymentLeaders;
const createScenarioPerformanceAggregates = (games, scenarioSelector, durationSourceGames = games) => {
    const leaders = createScenarioLeaders(games, scenarioSelector);
    const leaderByLabel = new Map(leaders.map((leader) => [leader.label, leader]));
    const grouped = new Map();
    const durationSourceById = createGameSourceById(durationSourceGames);
    games.forEach((game) => {
        const label = scenarioSelector(game).trim();
        if (!label || !hasComparableScoreData(game)) {
            return;
        }
        const existing = grouped.get(label) ?? { scores: [], durations: [], games: 0 };
        existing.games += 1;
        existing.scores.push((0, exports.getPlayerTotalScore)(game, game.players[0].id) + (0, exports.getPlayerTotalScore)(game, game.players[1].id));
        const duration = game.scoreDetailLevel === "full"
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
exports.createScenarioPerformanceAggregates = createScenarioPerformanceAggregates;
const createInitialGameFilters = () => ({
    query: "",
    playerName: "all",
    armyName: "all",
    pointsFrom: "all",
    pointsTo: "all",
    status: "all",
    dateFrom: "",
    dateTo: ""
});
exports.createInitialGameFilters = createInitialGameFilters;
const getFilterOptions = (games) => ({
    playerNames: Array.from(new Set(games.flatMap((game) => game.players.map((player) => player.name)))).sort((left, right) => left.localeCompare(right)),
    armyNames: Array.from(new Set(games.flatMap((game) => game.players.map((player) => player.army.name)))).sort((left, right) => left.localeCompare(right)),
    gamePoints: Array.from(new Set(games.map((game) => game.gamePoints))).sort((left, right) => left - right)
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
        const pointsFrom = !filters.pointsFrom || filters.pointsFrom === "all" ? null : Number(filters.pointsFrom);
        const pointsTo = !filters.pointsTo || filters.pointsTo === "all" ? null : Number(filters.pointsTo);
        const matchesPointsFrom = pointsFrom === null || game.gamePoints >= pointsFrom;
        const matchesPointsTo = pointsTo === null || game.gamePoints <= pointsTo;
        const matchesDateFrom = !filters.dateFrom || game.scheduledDate >= filters.dateFrom;
        const matchesDateTo = !filters.dateTo || game.scheduledDate <= filters.dateTo;
        return (matchesQuery &&
            matchesPlayer &&
            matchesArmy &&
            matchesStatus &&
            matchesPointsFrom &&
            matchesPointsTo &&
            matchesDateFrom &&
            matchesDateTo);
    });
};
exports.filterGames = filterGames;
const createStatsOverview = (games, durationSourceGames = games) => {
    const durationSourceById = createGameSourceById(durationSourceGames);
    const playerEntries = games.flatMap((game) => game.players);
    const playerCount = new Set(playerEntries.map((player) => player.name)).size;
    const armyCount = new Set(playerEntries.map((player) => player.army.name)).size;
    const completedDurations = games
        .map((game) => getStatsGameDurationMs(durationSourceById.get(game.id) ?? game))
        .filter((duration) => duration !== null);
    const playerDurationValues = games.flatMap((game) => {
        const durationSourceGame = durationSourceById.get(game.id) ?? game;
        if (durationSourceGame.scoreDetailLevel !== "full" || getStatsGameDurationMs(durationSourceGame) === null) {
            return [];
        }
        return durationSourceGame.players.map((player) => (0, exports.getPlayerTurnDurationTotalMs)(durationSourceGame, player.id));
    });
    const roundsValues = games
        .filter((game) => game.scoreDetailLevel === "full" && game.rounds.length > 0)
        .map((game) => (0, exports.getCountedRounds)(game).length);
    const comparableScoreGames = games.filter((game) => hasComparableScoreData(game));
    const combinedScoreValues = comparableScoreGames.map((game) => (0, exports.getPlayerTotalScore)(game, game.players[0].id) + (0, exports.getPlayerTotalScore)(game, game.players[1].id));
    const playerOneScoreValues = comparableScoreGames.map((game) => (0, exports.getPlayerTotalScore)(game, game.players[0].id));
    const playerTwoScoreValues = comparableScoreGames.map((game) => (0, exports.getPlayerTotalScore)(game, game.players[1].id));
    const playerScoreValues = comparableScoreGames.flatMap((game) => game.players.map((player) => (0, exports.getPlayerTotalScore)(game, player.id)));
    const spentCpValues = games.flatMap((game) => game.scoreDetailLevel === "full"
        ? game.players
            .filter((player) => hasEligibleCommandPointData(game, player.id))
            .map((player) => getEligibleCommandPointsSpent(game, player.id))
        : []);
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
exports.createStatsOverview = createStatsOverview;
const createArmyAggregates = (games, durationSourceGames = games) => {
    const durationSourceById = createGameSourceById(durationSourceGames);
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
        const scoredGames = armyGames.filter(({ game }) => hasResultData(game));
        const wins = scoredGames.filter(({ game, player }) => getPlayerGameResult(game, player.id) === "win").length;
        const losses = scoredGames.filter(({ game, player }) => getPlayerGameResult(game, player.id) === "loss").length;
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
        const durationValues = armyGames
            .filter(({ game }) => game.scoreDetailLevel === "full")
            .map(({ game }) => getStatsGameDurationMs(durationSourceById.get(game.id) ?? game))
            .filter((value) => value !== null);
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
exports.createArmyAggregates = createArmyAggregates;
const createMatchupAggregates = (games, durationSourceGames = games) => {
    const grouped = new Map();
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
        const scoreA = (0, exports.getPlayerTotalScore)(game, playerA.id);
        const scoreB = (0, exports.getPlayerTotalScore)(game, playerB.id);
        existing.count += 1;
        const durationSourceGame = durationSourceById.get(game.id) ?? game;
        const completedDuration = game.scoreDetailLevel === "full" ? getStatsGameDurationMs(durationSourceGame) : null;
        if (completedDuration !== null) {
            existing.durations.push(completedDuration);
        }
        if (hasResultData(game)) {
            if (scoreA > scoreB) {
                existing.winsA += 1;
            }
            else if (scoreB > scoreA) {
                existing.winsB += 1;
            }
            else {
                existing.ties += 1;
            }
            existing.combinedScores.push(scoreA + scoreB);
            existing.scoresA.push(scoreA);
            existing.scoresB.push(scoreB);
            existing.scoreDifferences.push(Math.abs(scoreA - scoreB));
        }
        if (durationSourceGame.scoreDetailLevel === "full") {
            const durationA = (0, exports.getPlayerTurnDurationTotalMs)(durationSourceGame, playerA.id);
            const durationB = (0, exports.getPlayerTurnDurationTotalMs)(durationSourceGame, playerB.id);
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
exports.createMatchupAggregates = createMatchupAggregates;
const createRoundDurationAggregates = (games) => {
    const grouped = new Map();
    games.forEach((game) => {
        if (game.scoreDetailLevel !== "full") {
            return;
        }
        game.rounds.forEach((round) => {
            const eligibleRound = {
                ...round,
                turns: round.turns.filter((turn) => getEffectiveTurnDecision(game, turn, "time"))
            };
            if (!eligibleRound.turns.length) {
                return;
            }
            const duration = (0, exports.getCompletedRoundDurationMs)(eligibleRound, game);
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
exports.createRoundDurationAggregates = createRoundDurationAggregates;
const createRoundScoreAggregates = (games) => {
    const grouped = new Map();
    games.forEach((game) => {
        if (!hasComparableScoreData(game)) {
            return;
        }
        game.rounds.forEach((round) => {
            if (!round.turns.some((turn) => getEffectiveTurnDecision(game, turn, "scoring")) &&
                !game.scoreEvents.some((event) => event.roundNumber === round.roundNumber && !event.turnNumber)) {
                return;
            }
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
        if (game.scoreDetailLevel !== "full") {
            return;
        }
        game.rounds.forEach((round) => {
            round.turns.forEach((turn) => {
                const player = game.players.find((entry) => entry.id === turn.playerId);
                const duration = (0, exports.getCompletedTurnDurationMs)(turn, game);
                if (!player || duration === null || !getEffectiveTurnDecision(game, turn, "time")) {
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
const createCpScoreCorrelationPoints = (games) => games.flatMap((game) => game.scoreDetailLevel === "full"
    ? game.players
        .filter((player) => hasEligibleCommandPointData(game, player.id) &&
        (0, exports.getPlayerComparableTotalScore)(game, player.id) !== null)
        .map((player) => ({
        playerName: player.name,
        gameId: game.id,
        scheduledDate: game.scheduledDate,
        scheduledTime: game.scheduledTime,
        cpSpent: getEligibleCommandPointsSpent(game, player.id),
        totalScore: (0, exports.getPlayerTotalScore)(game, player.id),
        primaryScore: (0, exports.getPlayerComparablePrimaryScore)(game, player.id),
        secondaryScore: (0, exports.getPlayerComparableSecondaryScore)(game, player.id)
    }))
    : []);
exports.createCpScoreCorrelationPoints = createCpScoreCorrelationPoints;
const getTurnRecords = (games) => {
    const turnRecords = games.flatMap((game) => game.scoreDetailLevel === "full"
        ? game.rounds.flatMap((round) => round.turns
            .map((turn) => {
            const player = game.players.find((entry) => entry.id === turn.playerId);
            const durationMs = (0, exports.getCompletedTurnDurationMs)(turn, game);
            if (!player || durationMs === null || !getEffectiveTurnDecision(game, turn, "time")) {
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
            .filter((record) => Boolean(record)))
        : []);
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
