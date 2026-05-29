"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapPersistedGame = exports.upsertLocalEventFromSource = exports.overlayLocalGameMetadata = exports.updateLocalEvent = exports.removeLocalEvent = exports.appendLocalTimeEvents = exports.appendLocalNoteEvent = exports.appendLocalCommandPointEvent = exports.appendLocalScoreEvent = exports.updateLocalGameDetails = exports.createLocalGame = exports.syncDerivedGameState = void 0;
const id_1 = require("./id");
const time_1 = require("./time");
const sortByCreatedAt = (items) => [...items].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
const ensureRound = (roundsByNumber, roundNumber) => {
    const existing = roundsByNumber.get(roundNumber);
    if (existing) {
        return existing;
    }
    const nextRound = {
        id: (0, id_1.createId)(`round-${roundNumber}`),
        roundNumber,
        turns: []
    };
    roundsByNumber.set(roundNumber, nextRound);
    return nextRound;
};
const ensureTurn = (round, turnNumber, playerId) => {
    const existing = round.turns.find((turn) => turn.turnNumber === turnNumber);
    if (existing) {
        return existing;
    }
    const nextTurn = {
        id: (0, id_1.createId)(`turn-${round.roundNumber}-${turnNumber}`),
        roundNumber: round.roundNumber,
        turnNumber,
        playerId,
        timing: {
            pauses: []
        }
    };
    round.turns.push(nextTurn);
    return nextTurn;
};
const getFirstGameEndAt = (timeEvents) => timeEvents
    .filter((event) => event.action === "game-end")
    .map((event) => event.createdAt)
    .sort((left, right) => left.localeCompare(right))[0];
const buildRoundsFromTimeEvents = (timeEvents, fallbackEndedAt) => {
    const roundsByNumber = new Map();
    const gameEndAt = getFirstGameEndAt(timeEvents) ?? fallbackEndedAt;
    [...timeEvents].sort((left, right) => left.createdAt.localeCompare(right.createdAt)).forEach((event) => {
        if (gameEndAt && event.createdAt > gameEndAt && event.action !== "game-end") {
            return;
        }
        if (!event.roundNumber) {
            return;
        }
        const round = ensureRound(roundsByNumber, event.roundNumber);
        if (event.action === "round-start") {
            round.startedAt = event.createdAt;
            return;
        }
        if (event.action === "round-end") {
            round.endedAt = event.createdAt;
            return;
        }
        if (!event.turnNumber || !event.playerId) {
            return;
        }
        const turn = ensureTurn(round, event.turnNumber, event.playerId);
        if (event.action === "turn-start") {
            turn.playerId = event.playerId;
            if (turn.timing.endedAt && event.createdAt >= turn.timing.endedAt) {
                return;
            }
            if (!turn.timing.startedAt) {
                turn.timing.startedAt = event.createdAt;
            }
            else {
                const latestPause = turn.timing.pauses[turn.timing.pauses.length - 1];
                if (latestPause && !latestPause.endedAt) {
                    latestPause.endedAt = event.createdAt;
                }
            }
            return;
        }
        if (event.action === "turn-resume") {
            turn.playerId = event.playerId;
            if (!turn.timing.startedAt || (turn.timing.endedAt && event.createdAt >= turn.timing.endedAt)) {
                return;
            }
            const latestPause = turn.timing.pauses[turn.timing.pauses.length - 1];
            if (latestPause && !latestPause.endedAt && event.createdAt >= latestPause.startedAt) {
                latestPause.endedAt = event.createdAt;
            }
            return;
        }
        if (event.action === "turn-pause") {
            turn.playerId = event.playerId;
            if (!turn.timing.startedAt || (turn.timing.endedAt && event.createdAt >= turn.timing.endedAt)) {
                return;
            }
            const latestPause = turn.timing.pauses[turn.timing.pauses.length - 1];
            if (!latestPause || latestPause.endedAt) {
                turn.timing.pauses.push({
                    startedAt: event.createdAt
                });
            }
            return;
        }
        if (event.action === "turn-end") {
            turn.playerId = event.playerId;
            if (turn.timing.endedAt && event.createdAt >= turn.timing.endedAt) {
                return;
            }
            const latestPause = turn.timing.pauses[turn.timing.pauses.length - 1];
            if (latestPause && !latestPause.endedAt) {
                latestPause.endedAt = event.createdAt;
            }
            turn.timing.endedAt = event.createdAt;
        }
    });
    if (gameEndAt) {
        roundsByNumber.forEach((round) => {
            if (round.startedAt && !round.endedAt) {
                round.endedAt = gameEndAt;
            }
            round.turns.forEach((turn) => {
                if (!turn.timing.startedAt || turn.timing.endedAt) {
                    return;
                }
                const latestPause = turn.timing.pauses[turn.timing.pauses.length - 1];
                if (latestPause && !latestPause.endedAt) {
                    latestPause.endedAt = gameEndAt;
                }
                turn.timing.endedAt = gameEndAt;
            });
        });
    }
    return Array.from(roundsByNumber.values())
        .sort((left, right) => left.roundNumber - right.roundNumber)
        .map((round) => ({
        ...round,
        turns: [...round.turns].sort((left, right) => left.turnNumber - right.turnNumber)
    }));
};
const getCurrentPlayerId = (gameId, startingPlayerId, rounds, endedAt) => {
    const fallbackPlayerId = `${gameId}:player-1`;
    if (endedAt) {
        return startingPlayerId || fallbackPlayerId;
    }
    const latestRound = rounds[rounds.length - 1];
    const latestTurn = latestRound?.turns[latestRound.turns.length - 1];
    if (!latestTurn) {
        return startingPlayerId || fallbackPlayerId;
    }
    if (latestTurn.timing.startedAt && !latestTurn.timing.endedAt) {
        return latestTurn.playerId;
    }
    return latestTurn.playerId === `${gameId}:player-1`
        ? `${gameId}:player-2`
        : `${gameId}:player-1`;
};
const syncPlayers = (players, gamePoints) => [
    {
        ...players[0],
        army: {
            ...players[0].army,
            maxPoints: gamePoints
        }
    },
    {
        ...players[1],
        army: {
            ...players[1].army,
            maxPoints: gamePoints
        }
    }
];
const createEmptyTimerCorrections = () => ({
    totalMs: 0,
    rounds: {},
    turns: {}
});
const normalizeStatsEligibilityMode = (value) => value === "include" || value === "exclude" ? value : "auto";
const STATS_ELIGIBILITY_AREAS = ["result", "scoring", "cp", "time"];
const STATS_ELIGIBILITY_TURN_AREAS = ["scoring", "cp", "time"];
const normalizeStatsEligibilityOverrides = (value) => {
    if (!value || typeof value !== "object") {
        return {};
    }
    const areas = Object.fromEntries(STATS_ELIGIBILITY_AREAS.flatMap((area) => {
        const mode = value.areas?.[area];
        return mode === "include" || mode === "exclude" ? [[area, mode]] : [];
    }));
    const turns = Object.fromEntries(Object.entries(value.turns ?? {}).flatMap(([turnKey, modes]) => {
        if (!modes || typeof modes !== "object") {
            return [];
        }
        const normalizedModes = Object.fromEntries(STATS_ELIGIBILITY_TURN_AREAS.flatMap((area) => {
            const mode = modes[area];
            return mode === "include" || mode === "exclude" ? [[area, mode]] : [];
        }));
        return Object.keys(normalizedModes).length ? [[turnKey, normalizedModes]] : [];
    }));
    return {
        ...(Object.keys(areas).length ? { areas } : {}),
        ...(Object.keys(turns).length ? { turns } : {})
    };
};
const syncDerivedGameState = (game) => {
    const orderedTimeEvents = [...game.timeEvents];
    const hasTimeEvents = orderedTimeEvents.length > 0;
    const endedAt = getFirstGameEndAt(orderedTimeEvents) ?? game.endedAt;
    const rounds = buildRoundsFromTimeEvents(orderedTimeEvents, endedAt);
    const timestamps = [
        game.createdAt,
        ...game.scoreEvents.map((event) => event.createdAt),
        ...game.commandPointEvents.map((event) => event.createdAt),
        ...game.noteEvents.map((event) => event.createdAt),
        ...orderedTimeEvents.map((event) => event.createdAt)
    ].sort((left, right) => left.localeCompare(right));
    const startCandidates = [
        game.startedAt,
        ...game.scoreEvents.map((event) => event.createdAt),
        ...game.commandPointEvents.map((event) => event.createdAt),
        ...game.noteEvents.map((event) => event.createdAt),
        ...orderedTimeEvents
            .filter((event) => event.action === "game-start" ||
            event.action === "setup-start" ||
            event.action === "setup-end" ||
            event.action === "round-start" ||
            event.action === "turn-start")
            .map((event) => event.createdAt)
    ]
        .filter((value) => Boolean(value))
        .sort((left, right) => left.localeCompare(right));
    const startedAt = startCandidates[0] ?? (hasTimeEvents ? undefined : game.startedAt);
    return {
        ...game,
        updatedAt: timestamps[timestamps.length - 1] ?? game.createdAt,
        status: endedAt ? "completed" : "active",
        finishReason: endedAt ? game.finishReason ?? "completed" : undefined,
        scoreDetailLevel: game.scoreDetailLevel ?? "full",
        statsEligibilityMode: normalizeStatsEligibilityMode(game.statsEligibilityMode),
        statsEligibilityOverrides: normalizeStatsEligibilityOverrides(game.statsEligibilityOverrides),
        players: syncPlayers(game.players, game.gamePoints),
        rounds,
        startedAt,
        endedAt,
        currentPlayerId: getCurrentPlayerId(game.id, game.startingPlayerId, rounds, endedAt),
        timeEvents: orderedTimeEvents,
        scoreEvents: sortByCreatedAt(game.scoreEvents),
        commandPointEvents: sortByCreatedAt(game.commandPointEvents),
        noteEvents: sortByCreatedAt(game.noteEvents),
        timerCorrections: game.timerCorrections ?? createEmptyTimerCorrections(),
        legacyScoreTotals: game.legacyScoreTotals ?? {}
    };
};
exports.syncDerivedGameState = syncDerivedGameState;
const createLocalGame = (input) => {
    const gameId = (0, id_1.createUuid)();
    const createdAt = (0, time_1.getNowIso)();
    const playerOneId = `${gameId}:player-1`;
    const playerTwoId = `${gameId}:player-2`;
    const players = [
        {
            id: playerOneId,
            name: input.playerOneName.trim(),
            army: {
                name: input.playerOneArmy.trim(),
                maxPoints: input.gamePoints,
                detachment: input.playerOneDetachment.trim()
            }
        },
        {
            id: playerTwoId,
            name: input.playerTwoName.trim(),
            army: {
                name: input.playerTwoArmy.trim(),
                maxPoints: input.gamePoints,
                detachment: input.playerTwoDetachment.trim()
            }
        }
    ];
    return (0, exports.syncDerivedGameState)({
        id: gameId,
        createdAt,
        updatedAt: createdAt,
        status: "active",
        finishReason: undefined,
        scoreDetailLevel: "full",
        statsEligibilityMode: normalizeStatsEligibilityMode(input.statsEligibilityMode),
        statsEligibilityOverrides: {},
        gamePoints: input.gamePoints,
        scheduledDate: input.scheduledDate,
        scheduledTime: input.scheduledTime,
        deployment: input.deployment.trim(),
        primaryMission: input.primaryMission.trim(),
        defenderPlayerId: input.defenderSlot === "player1" ? playerOneId : input.defenderSlot === "player2" ? playerTwoId : "",
        startingPlayerId: input.startingSlot === "player1" ? playerOneId : input.startingSlot === "player2" ? playerTwoId : "",
        currentPlayerId: input.startingSlot === "player1" ? playerOneId : input.startingSlot === "player2" ? playerTwoId : playerOneId,
        startedAt: undefined,
        endedAt: undefined,
        players,
        rounds: [],
        scoreEvents: [],
        commandPointEvents: [],
        noteEvents: [],
        timerCorrections: createEmptyTimerCorrections(),
        autoCommandPointOn: true,
        autoCommandPointAwards: {},
        legacyScoreTotals: {},
        timeEvents: [
            {
                id: (0, id_1.createUuid)(),
                type: "time",
                action: "game-start",
                createdAt
            },
            {
                id: (0, id_1.createUuid)(),
                type: "time",
                action: "setup-start",
                createdAt
            }
        ]
    });
};
exports.createLocalGame = createLocalGame;
const updateLocalGameDetails = (game, input) => (0, exports.syncDerivedGameState)({
    ...game,
    statsEligibilityMode: normalizeStatsEligibilityMode(input.statsEligibilityMode),
    gamePoints: input.gamePoints,
    scheduledDate: input.scheduledDate,
    scheduledTime: input.scheduledTime,
    deployment: input.deployment.trim(),
    primaryMission: input.primaryMission.trim(),
    defenderPlayerId: input.defenderSlot === "player1" ? game.players[0].id : input.defenderSlot === "player2" ? game.players[1].id : "",
    startingPlayerId: input.startingSlot === "player1" ? game.players[0].id : input.startingSlot === "player2" ? game.players[1].id : "",
    players: [
        {
            ...game.players[0],
            name: input.playerOneName.trim(),
            army: {
                ...game.players[0].army,
                name: input.playerOneArmy.trim(),
                maxPoints: input.gamePoints,
                detachment: input.playerOneDetachment.trim()
            }
        },
        {
            ...game.players[1],
            name: input.playerTwoName.trim(),
            army: {
                ...game.players[1].army,
                name: input.playerTwoArmy.trim(),
                maxPoints: input.gamePoints,
                detachment: input.playerTwoDetachment.trim()
            }
        }
    ]
});
exports.updateLocalGameDetails = updateLocalGameDetails;
const appendLocalScoreEvent = (game, payload) => {
    const event = {
        id: (0, id_1.createUuid)(),
        type: "score",
        playerId: payload.playerId,
        scoreType: payload.scoreType,
        value: payload.value,
        note: payload.note?.trim() || undefined,
        roundNumber: payload.roundNumber,
        turnNumber: payload.turnNumber,
        createdAt: payload.createdAt ?? (0, time_1.getNowIso)()
    };
    return (0, exports.syncDerivedGameState)({
        ...game,
        scoreEvents: [...game.scoreEvents, event]
    });
};
exports.appendLocalScoreEvent = appendLocalScoreEvent;
const appendLocalCommandPointEvent = (game, payload) => {
    const event = {
        id: (0, id_1.createUuid)(),
        type: "command-point",
        playerId: payload.playerId,
        cpType: payload.cpType,
        value: payload.value,
        note: payload.note?.trim() || undefined,
        roundNumber: payload.roundNumber,
        turnNumber: payload.turnNumber,
        createdAt: payload.createdAt ?? (0, time_1.getNowIso)()
    };
    return (0, exports.syncDerivedGameState)({
        ...game,
        commandPointEvents: [...game.commandPointEvents, event]
    });
};
exports.appendLocalCommandPointEvent = appendLocalCommandPointEvent;
const appendLocalNoteEvent = (game, payload) => {
    const event = {
        id: (0, id_1.createUuid)(),
        type: "note",
        playerId: payload.playerId,
        note: payload.note.trim(),
        roundNumber: payload.roundNumber,
        turnNumber: payload.turnNumber,
        createdAt: payload.createdAt ?? (0, time_1.getNowIso)()
    };
    return (0, exports.syncDerivedGameState)({
        ...game,
        noteEvents: [...game.noteEvents, event]
    });
};
exports.appendLocalNoteEvent = appendLocalNoteEvent;
const appendLocalTimeEvents = (game, timeEvents) => (0, exports.syncDerivedGameState)({
    ...game,
    timeEvents: [
        ...game.timeEvents,
        ...timeEvents.map((timeEvent) => ({
            id: (0, id_1.createUuid)(),
            type: "time",
            action: timeEvent.action,
            playerId: timeEvent.playerId,
            roundNumber: timeEvent.roundNumber,
            turnNumber: timeEvent.turnNumber,
            createdAt: timeEvent.createdAt ?? (0, time_1.getNowIso)()
        }))
    ]
});
exports.appendLocalTimeEvents = appendLocalTimeEvents;
const removeLocalEvent = (game, eventId) => (0, exports.syncDerivedGameState)({
    ...game,
    scoreEvents: game.scoreEvents.filter((event) => event.id !== eventId),
    commandPointEvents: game.commandPointEvents.filter((event) => event.id !== eventId),
    noteEvents: game.noteEvents.filter((event) => event.id !== eventId),
    timeEvents: game.timeEvents.filter((event) => event.id !== eventId)
});
exports.removeLocalEvent = removeLocalEvent;
const updateLocalEvent = (game, eventId, patch) => {
    const nextNote = patch.note?.trim() || undefined;
    const nextCreatedAt = patch.occurred_at?.trim();
    return (0, exports.syncDerivedGameState)({
        ...game,
        scoreEvents: game.scoreEvents.map((event) => event.id === eventId
            ? {
                ...event,
                createdAt: nextCreatedAt || event.createdAt,
                value: typeof patch.value_number === "number" ? patch.value_number : event.value,
                note: nextNote
            }
            : event),
        commandPointEvents: game.commandPointEvents.map((event) => event.id === eventId
            ? {
                ...event,
                createdAt: nextCreatedAt || event.createdAt,
                value: typeof patch.value_number === "number" ? patch.value_number : event.value,
                note: nextNote
            }
            : event),
        noteEvents: game.noteEvents.map((event) => event.id === eventId
            ? {
                ...event,
                createdAt: nextCreatedAt || event.createdAt,
                note: nextNote ?? ""
            }
            : event),
        timeEvents: game.timeEvents.map((event) => event.id === eventId
            ? {
                ...event,
                createdAt: nextCreatedAt || event.createdAt
            }
            : event)
    });
};
exports.updateLocalEvent = updateLocalEvent;
const overlayLocalGameMetadata = (baseGame, localGame) => (0, exports.syncDerivedGameState)({
    ...baseGame,
    autoCommandPointOn: localGame.autoCommandPointOn,
    autoCommandPointAwards: localGame.autoCommandPointAwards,
    statsEligibilityMode: localGame.statsEligibilityMode,
    statsEligibilityOverrides: localGame.statsEligibilityOverrides,
    gamePoints: localGame.gamePoints,
    scheduledDate: localGame.scheduledDate,
    scheduledTime: localGame.scheduledTime,
    deployment: localGame.deployment,
    primaryMission: localGame.primaryMission,
    defenderPlayerId: localGame.defenderPlayerId,
    startingPlayerId: localGame.startingPlayerId,
    currentPlayerId: baseGame.endedAt ? baseGame.currentPlayerId : localGame.currentPlayerId,
    startedAt: localGame.startedAt ?? baseGame.startedAt,
    endedAt: localGame.endedAt ?? baseGame.endedAt,
    timerCorrections: localGame.timerCorrections,
    players: localGame.players
});
exports.overlayLocalGameMetadata = overlayLocalGameMetadata;
const upsertLocalEventFromSource = (baseGame, sourceGame, eventId) => {
    const scoreEvent = sourceGame.scoreEvents.find((event) => event.id === eventId);
    if (scoreEvent) {
        return (0, exports.syncDerivedGameState)({
            ...baseGame,
            scoreEvents: [
                ...baseGame.scoreEvents.filter((event) => event.id !== eventId),
                scoreEvent
            ]
        });
    }
    const commandPointEvent = sourceGame.commandPointEvents.find((event) => event.id === eventId);
    if (commandPointEvent) {
        return (0, exports.syncDerivedGameState)({
            ...baseGame,
            commandPointEvents: [
                ...baseGame.commandPointEvents.filter((event) => event.id !== eventId),
                commandPointEvent
            ]
        });
    }
    const noteEvent = sourceGame.noteEvents.find((event) => event.id === eventId);
    if (noteEvent) {
        return (0, exports.syncDerivedGameState)({
            ...baseGame,
            noteEvents: [
                ...baseGame.noteEvents.filter((event) => event.id !== eventId),
                noteEvent
            ]
        });
    }
    const timeEvent = sourceGame.timeEvents.find((event) => event.id === eventId);
    if (timeEvent) {
        return (0, exports.syncDerivedGameState)({
            ...baseGame,
            timeEvents: [
                ...baseGame.timeEvents.filter((event) => event.id !== eventId),
                timeEvent
            ]
        });
    }
    return baseGame;
};
exports.upsertLocalEventFromSource = upsertLocalEventFromSource;
const mapPersistedGame = (value) => {
    if (!value || typeof value !== "object") {
        return null;
    }
    const rawGame = value;
    const gameId = (0, id_1.isUuid)(rawGame.id) ? rawGame.id : (0, id_1.createUuid)();
    const playerOneId = `${gameId}:player-1`;
    const playerTwoId = `${gameId}:player-2`;
    const playerIdMap = new Map([
        [rawGame.players[0]?.id ?? "player-1", playerOneId],
        [rawGame.players[1]?.id ?? "player-2", playerTwoId],
        ["player-1", playerOneId],
        ["player-2", playerTwoId]
    ]);
    const mapPlayerId = (playerId) => playerId ? playerIdMap.get(playerId) ?? playerId : undefined;
    const nextLegacyScoreTotals = Object.fromEntries(Object.entries(rawGame.legacyScoreTotals ?? {}).map(([playerId, value]) => [
        mapPlayerId(playerId) ?? playerId,
        value
    ]));
    return (0, exports.syncDerivedGameState)({
        ...rawGame,
        id: gameId,
        autoCommandPointOn: rawGame.autoCommandPointOn ?? true,
        autoCommandPointAwards: rawGame.autoCommandPointAwards ?? {},
        statsEligibilityMode: normalizeStatsEligibilityMode(rawGame.statsEligibilityMode),
        statsEligibilityOverrides: normalizeStatsEligibilityOverrides(rawGame.statsEligibilityOverrides),
        defenderPlayerId: mapPlayerId(rawGame.defenderPlayerId) ?? playerOneId,
        startingPlayerId: mapPlayerId(rawGame.startingPlayerId) ?? playerOneId,
        currentPlayerId: mapPlayerId(rawGame.currentPlayerId) ?? playerOneId,
        players: [
            {
                ...rawGame.players[0],
                id: playerOneId,
                army: {
                    ...rawGame.players[0].army,
                    detachment: rawGame.players[0].army?.detachment ?? ""
                }
            },
            {
                ...rawGame.players[1],
                id: playerTwoId,
                army: {
                    ...rawGame.players[1].army,
                    detachment: rawGame.players[1].army?.detachment ?? ""
                }
            }
        ],
        scoreEvents: rawGame.scoreEvents.map((event) => ({
            ...event,
            id: (0, id_1.isUuid)(event.id) ? event.id : (0, id_1.createUuid)(),
            playerId: mapPlayerId(event.playerId) ?? playerOneId
        })),
        commandPointEvents: rawGame.commandPointEvents.map((event) => ({
            ...event,
            id: (0, id_1.isUuid)(event.id) ? event.id : (0, id_1.createUuid)(),
            playerId: mapPlayerId(event.playerId) ?? playerOneId
        })),
        noteEvents: rawGame.noteEvents.map((event) => ({
            ...event,
            id: (0, id_1.isUuid)(event.id) ? event.id : (0, id_1.createUuid)(),
            playerId: mapPlayerId(event.playerId) ?? playerOneId
        })),
        legacyScoreTotals: nextLegacyScoreTotals,
        timerCorrections: rawGame.timerCorrections ?? createEmptyTimerCorrections(),
        timeEvents: rawGame.timeEvents.map((event) => ({
            ...event,
            id: (0, id_1.isUuid)(event.id) ? event.id : (0, id_1.createUuid)(),
            playerId: mapPlayerId(event.playerId)
        }))
    });
};
exports.mapPersistedGame = mapPersistedGame;
