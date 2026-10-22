"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapSupabaseGameToAppGame = exports.toIsoTimestamp = exports.mapEventRows = exports.getCurrentPlayerId = exports.getUpdatedAt = exports.getDerivedEndedAt = exports.getDerivedStartedAt = exports.buildRoundsFromTimeEvents = exports.ensureTurn = exports.ensureRound = exports.sortEventRecordsByCreation = exports.sortEventRecords = exports.serializeGameNotes = exports.serializeSoftDeletedNotes = exports.isSupabaseGameDeleted = exports.getRowDeletedAt = exports.parseDeletedMeta = exports.parseOptionsMeta = exports.parseFinishMeta = exports.parseScenarioMeta = exports.parsePlayerMeta = exports.parseScoreMeta = exports.parseTimerCorrectionsFromNotes = exports.parseTimerCorrections = exports.createPlayerDetachmentsFromInput = exports.parseJsonObject = exports.createDefaultFinishMeta = exports.createDefaultScenarioMeta = exports.createDefaultPlayerDetachments = exports.serializeStatsEligibilityOverrides = exports.parseStatsEligibilityOverrides = exports.statsEligibilityTurnAreas = exports.statsEligibilityAreas = exports.serializeStatsEligibilityMode = exports.parseStatsEligibilityMode = exports.createDefaultScoreMeta = exports.serializeTimerCorrections = exports.normalizeTimerCorrections = exports.createEmptyTimerCorrections = exports.getNumericValue = exports.getScheduledDateParts = exports.normalizeRequiredTimestamp = exports.normalizeOptionalTimestamp = exports.combineScheduledDateTime = exports.getPlayerIdFromSlot = exports.getPlayerSlotFromId = exports.createPlayerId = exports.timeActions = exports.cpTypeByEventType = exports.scoreTypeByEventType = void 0;
const id_1 = require("./id");
const timeEventOrder_1 = require("./timeEventOrder");
const turnTiming_1 = require("./turnTiming");
const time_1 = require("./time");
exports.scoreTypeByEventType = {
    "score-primary": "primary",
    "score-secondary": "secondary",
    "score-challenge": "challenge",
    "score-total": "legacy-total"
};
exports.cpTypeByEventType = {
    "cp-gained": "gained",
    "cp-spent": "spent"
};
exports.timeActions = new Set([
    "game-start",
    "game-end",
    "setup-start",
    "setup-end",
    "setup-pause",
    "setup-resume",
    "round-start",
    "round-end",
    "turn-start",
    "turn-end",
    "turn-pause",
    "turn-resume",
    "timeout-start",
    "timeout-end"
]);
const createPlayerId = (gameId, slot) => `${gameId}:player-${slot}`;
exports.createPlayerId = createPlayerId;
const getPlayerSlotFromId = (game, playerId) => game.players[0].id === playerId ? 1 : 2;
exports.getPlayerSlotFromId = getPlayerSlotFromId;
const getPlayerIdFromSlot = (gameId, slot) => (0, exports.createPlayerId)(gameId, slot);
exports.getPlayerIdFromSlot = getPlayerIdFromSlot;
const combineScheduledDateTime = (date, time) => {
    if (!date || !time) {
        return null;
    }
    return new Date(`${date}T${time}:00`).toISOString();
};
exports.combineScheduledDateTime = combineScheduledDateTime;
const normalizeOptionalTimestamp = (value) => {
    if (!value) {
        return null;
    }
    const trimmedValue = value.trim();
    return trimmedValue ? trimmedValue : null;
};
exports.normalizeOptionalTimestamp = normalizeOptionalTimestamp;
const normalizeRequiredTimestamp = (value, fallback) => (0, exports.normalizeOptionalTimestamp)(value) ?? fallback;
exports.normalizeRequiredTimestamp = normalizeRequiredTimestamp;
const getScheduledDateParts = (value) => {
    if (!value) {
        return {
            date: "",
            time: ""
        };
    }
    const date = new Date(value);
    return {
        date: (0, time_1.toLocalDateInput)(date),
        time: (0, time_1.toLocalTimeInput)(date)
    };
};
exports.getScheduledDateParts = getScheduledDateParts;
const getNumericValue = (value) => {
    if (value === null || value === undefined) {
        return null;
    }
    const parsedValue = typeof value === "string" ? Number(value) : value;
    return Number.isFinite(parsedValue) ? parsedValue : null;
};
exports.getNumericValue = getNumericValue;
const createEmptyTimerCorrections = () => ({
    totalMs: 0,
    rounds: {},
    turns: {}
});
exports.createEmptyTimerCorrections = createEmptyTimerCorrections;
const normalizeTimerCorrections = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return (0, exports.createEmptyTimerCorrections)();
    }
    const timerCorrections = value;
    return {
        totalMs: typeof timerCorrections.totalMs === "number" ? timerCorrections.totalMs : 0,
        rounds: Object.fromEntries(Object.entries(timerCorrections.rounds ?? {}).filter(([, amount]) => typeof amount === "number")),
        turns: Object.fromEntries(Object.entries(timerCorrections.turns ?? {}).filter(([, amount]) => typeof amount === "number"))
    };
};
exports.normalizeTimerCorrections = normalizeTimerCorrections;
const serializeTimerCorrections = (timerCorrections) => ({
    totalMs: timerCorrections.totalMs,
    rounds: timerCorrections.rounds,
    turns: timerCorrections.turns
});
exports.serializeTimerCorrections = serializeTimerCorrections;
const createDefaultScoreMeta = () => ({
    scoreDetailLevel: "full",
    legacyScoreTotals: {}
});
exports.createDefaultScoreMeta = createDefaultScoreMeta;
const parseStatsEligibilityMode = (value) => value === "include" || value === "exclude" ? value : "auto";
exports.parseStatsEligibilityMode = parseStatsEligibilityMode;
const serializeStatsEligibilityMode = (value) => value === "auto" ? null : value;
exports.serializeStatsEligibilityMode = serializeStatsEligibilityMode;
exports.statsEligibilityAreas = ["result", "scoring", "cp", "time"];
exports.statsEligibilityTurnAreas = ["scoring", "cp", "time"];
const parseStatsEligibilityOverrides = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    const raw = value;
    const areas = Object.fromEntries(exports.statsEligibilityAreas.flatMap((area) => {
        const mode = raw.areas?.[area];
        return mode === "include" || mode === "exclude" ? [[area, mode]] : [];
    }));
    const turns = Object.fromEntries(Object.entries(raw.turns ?? {}).flatMap(([turnKey, modes]) => {
        const normalizedModes = Object.fromEntries(exports.statsEligibilityTurnAreas.flatMap((area) => {
            const mode = modes?.[area];
            return mode === "include" || mode === "exclude" ? [[area, mode]] : [];
        }));
        return Object.keys(normalizedModes).length ? [[turnKey, normalizedModes]] : [];
    }));
    return {
        ...(Object.keys(areas).length ? { areas } : {}),
        ...(Object.keys(turns).length ? { turns } : {})
    };
};
exports.parseStatsEligibilityOverrides = parseStatsEligibilityOverrides;
const serializeStatsEligibilityOverrides = (value) => value.areas && Object.keys(value.areas).length || value.turns && Object.keys(value.turns).length
    ? value
    : null;
exports.serializeStatsEligibilityOverrides = serializeStatsEligibilityOverrides;
const createDefaultPlayerDetachments = () => ({
    "player-1": "",
    "player-2": ""
});
exports.createDefaultPlayerDetachments = createDefaultPlayerDetachments;
const createDefaultScenarioMeta = () => ({
    deployment: "",
    primaryMission: ""
});
exports.createDefaultScenarioMeta = createDefaultScenarioMeta;
const createDefaultFinishMeta = () => ({
    finishReason: undefined
});
exports.createDefaultFinishMeta = createDefaultFinishMeta;
const parseJsonObject = (value) => {
    if (!value) {
        return {};
    }
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed
            : {};
    }
    catch {
        return {};
    }
};
exports.parseJsonObject = parseJsonObject;
const createPlayerDetachmentsFromInput = (payload) => ({
    "player-1": payload.playerOneDetachment.trim(),
    "player-2": payload.playerTwoDetachment.trim()
});
exports.createPlayerDetachmentsFromInput = createPlayerDetachmentsFromInput;
const parseTimerCorrections = (value, legacyNotes) => {
    const normalizedValue = (0, exports.normalizeTimerCorrections)(value);
    const hasTimerCorrectionValue = normalizedValue.totalMs !== 0 ||
        Object.keys(normalizedValue.rounds).length > 0 ||
        Object.keys(normalizedValue.turns).length > 0;
    if (hasTimerCorrectionValue) {
        return normalizedValue;
    }
    if (legacyNotes !== undefined) {
        const legacyCorrections = (0, exports.parseTimerCorrectionsFromNotes)(legacyNotes);
        const hasLegacyTimerCorrectionValue = legacyCorrections.totalMs !== 0 ||
            Object.keys(legacyCorrections.rounds).length > 0 ||
            Object.keys(legacyCorrections.turns).length > 0;
        if (hasLegacyTimerCorrectionValue) {
            return legacyCorrections;
        }
    }
    return normalizedValue;
};
exports.parseTimerCorrections = parseTimerCorrections;
const parseTimerCorrectionsFromNotes = (value) => {
    if (!value) {
        return (0, exports.createEmptyTimerCorrections)();
    }
    try {
        const parsed = JSON.parse(value);
        const timerCorrections = parsed?.timerCorrections;
        return (0, exports.normalizeTimerCorrections)(timerCorrections);
    }
    catch {
        return (0, exports.createEmptyTimerCorrections)();
    }
};
exports.parseTimerCorrectionsFromNotes = parseTimerCorrectionsFromNotes;
const parseScoreMeta = (value) => {
    if (!value) {
        return (0, exports.createDefaultScoreMeta)();
    }
    try {
        const parsed = JSON.parse(value);
        const scoreMeta = parsed?.scoreMeta;
        return {
            scoreDetailLevel: scoreMeta?.scoreDetailLevel === "total-only" || scoreMeta?.scoreDetailLevel === "none"
                ? scoreMeta.scoreDetailLevel
                : "full",
            legacyScoreTotals: Object.fromEntries(Object.entries(scoreMeta?.legacyScoreTotals ?? {}).filter(([, amount]) => typeof amount === "number"))
        };
    }
    catch {
        return (0, exports.createDefaultScoreMeta)();
    }
};
exports.parseScoreMeta = parseScoreMeta;
const parsePlayerMeta = (value) => {
    if (!value) {
        return (0, exports.createDefaultPlayerDetachments)();
    }
    try {
        const parsed = JSON.parse(value);
        return {
            ...(0, exports.createDefaultPlayerDetachments)(),
            ...Object.fromEntries(Object.entries(parsed?.playerMeta?.detachments ?? {}).filter(([, detachment]) => typeof detachment === "string"))
        };
    }
    catch {
        return (0, exports.createDefaultPlayerDetachments)();
    }
};
exports.parsePlayerMeta = parsePlayerMeta;
const parseScenarioMeta = (value) => {
    if (!value) {
        return (0, exports.createDefaultScenarioMeta)();
    }
    try {
        const parsed = JSON.parse(value);
        return {
            deployment: typeof parsed?.scenarioMeta?.deployment === "string" ? parsed.scenarioMeta.deployment : "",
            primaryMission: typeof parsed?.scenarioMeta?.primaryMission === "string" ? parsed.scenarioMeta.primaryMission : ""
        };
    }
    catch {
        return (0, exports.createDefaultScenarioMeta)();
    }
};
exports.parseScenarioMeta = parseScenarioMeta;
const parseFinishMeta = (value) => {
    if (!value) {
        return (0, exports.createDefaultFinishMeta)();
    }
    try {
        const parsed = JSON.parse(value);
        const reason = parsed?.finishMeta?.finishReason;
        return {
            finishReason: reason === "completed" ||
                reason === "draw" ||
                reason === "interrupted" ||
                reason === "abandoned" ||
                reason === "player-1-conceded" ||
                reason === "player-2-conceded"
                ? reason
                : undefined
        };
    }
    catch {
        return (0, exports.createDefaultFinishMeta)();
    }
};
exports.parseFinishMeta = parseFinishMeta;
const parseOptionsMeta = (value) => {
    if (!value) {
        return { autoCommandPointOn: true, autoCommandPointAwards: {} };
    }
    try {
        const parsed = JSON.parse(value);
        return {
            autoCommandPointOn: parsed?.optionsMeta?.autoCommandPointOn ?? true,
            autoCommandPointAwards: Object.fromEntries(Object.entries(parsed?.optionsMeta?.autoCommandPointAwards ?? {}).filter(([, value]) => value === true))
        };
    }
    catch {
        return { autoCommandPointOn: true, autoCommandPointAwards: {} };
    }
};
exports.parseOptionsMeta = parseOptionsMeta;
const parseDeletedMeta = (value) => {
    const parsed = (0, exports.parseJsonObject)(value);
    const deletedMeta = parsed.deletedMeta;
    if (!deletedMeta || typeof deletedMeta !== "object" || Array.isArray(deletedMeta)) {
        return {
            deletedAt: undefined
        };
    }
    const deletedAt = deletedMeta.deletedAt;
    return {
        deletedAt: typeof deletedAt === "string" && deletedAt.trim() ? deletedAt : undefined
    };
};
exports.parseDeletedMeta = parseDeletedMeta;
const getRowDeletedAt = (row) => {
    const deletedAt = row.deleted_at;
    return typeof deletedAt === "string" && deletedAt.trim()
        ? deletedAt
        : (0, exports.parseDeletedMeta)(row.notes).deletedAt;
};
exports.getRowDeletedAt = getRowDeletedAt;
const isSupabaseGameDeleted = (row) => Boolean((0, exports.getRowDeletedAt)(row));
exports.isSupabaseGameDeleted = isSupabaseGameDeleted;
const serializeSoftDeletedNotes = (value, deletedAt) => {
    const parsed = (0, exports.parseJsonObject)(value);
    const existingDeletedMeta = parsed.deletedMeta && typeof parsed.deletedMeta === "object" && !Array.isArray(parsed.deletedMeta)
        ? parsed.deletedMeta
        : {};
    return JSON.stringify({
        ...parsed,
        deletedMeta: {
            ...existingDeletedMeta,
            deletedAt
        }
    });
};
exports.serializeSoftDeletedNotes = serializeSoftDeletedNotes;
const serializeGameNotes = (scoreDetailLevel, legacyScoreTotals, optionsMeta, playerDetachments, scenarioMeta, finishReason) => {
    const hasScoreMeta = scoreDetailLevel !== "full" || Object.keys(legacyScoreTotals).length > 0;
    const hasOptionsMeta = optionsMeta.autoCommandPointOn !== true ||
        Object.keys(optionsMeta.autoCommandPointAwards).length > 0;
    const hasPlayerMeta = Object.values(playerDetachments).some((value) => value.trim().length > 0);
    const hasScenarioMeta = Boolean(scenarioMeta?.deployment.trim() || scenarioMeta?.primaryMission.trim());
    const hasFinishMeta = Boolean(finishReason && finishReason !== "completed");
    if (!hasScoreMeta &&
        !hasOptionsMeta &&
        !hasPlayerMeta &&
        !hasScenarioMeta &&
        !hasFinishMeta) {
        return null;
    }
    return JSON.stringify({
        scoreMeta: {
            scoreDetailLevel,
            legacyScoreTotals
        },
        optionsMeta: {
            autoCommandPointOn: optionsMeta.autoCommandPointOn,
            autoCommandPointAwards: optionsMeta.autoCommandPointAwards
        },
        playerMeta: {
            detachments: playerDetachments
        },
        scenarioMeta: {
            deployment: scenarioMeta?.deployment.trim() ?? "",
            primaryMission: scenarioMeta?.primaryMission.trim() ?? ""
        },
        finishMeta: {
            finishReason: finishReason ?? "completed"
        }
    });
};
exports.serializeGameNotes = serializeGameNotes;
const sortEventRecords = (events) => [...events].sort((left, right) => {
    const leftRound = left.round_number ?? 0;
    const rightRound = right.round_number ?? 0;
    if (leftRound !== rightRound) {
        return leftRound - rightRound;
    }
    const leftTurn = left.turn_number ?? 0;
    const rightTurn = right.turn_number ?? 0;
    if (leftTurn !== rightTurn) {
        return leftTurn - rightTurn;
    }
    return left.occurred_at.localeCompare(right.occurred_at) || left.created_at.localeCompare(right.created_at);
});
exports.sortEventRecords = sortEventRecords;
const sortEventRecordsByCreation = (events) => [...events].sort((left, right) => left.created_at.localeCompare(right.created_at) ||
    left.occurred_at.localeCompare(right.occurred_at));
exports.sortEventRecordsByCreation = sortEventRecordsByCreation;
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
exports.ensureRound = ensureRound;
const ensureTurn = (round, turnNumber, playerId) => {
    const existingTurn = round.turns.find((turn) => turn.turnNumber === turnNumber);
    if (existingTurn) {
        return existingTurn;
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
exports.ensureTurn = ensureTurn;
const buildRoundsFromTimeEvents = (gameId, timeEvents, fallbackEndedAt) => {
    const roundsByNumber = new Map();
    const timing = (0, turnTiming_1.createTurnTimingTracker)(); // gleiche Zug-Zeitlogik wie gameState (Timer-Regel Tim 22.10.)
    const gameEndAt = timeEvents
        .filter((event) => event.action === "game-end")
        .map((event) => event.createdAt)
        .sort((left, right) => left.localeCompare(right))[0] ?? fallbackEndedAt;
    (0, timeEventOrder_1.orderTimeEventsForEvaluation)(timeEvents
        .filter((event) => !gameEndAt || event.createdAt <= gameEndAt || event.action === "game-end"))
        .map((event) => ({
        id: event.id,
        created_at: event.createdAt,
        game_id: gameId,
        round_number: event.roundNumber ?? null,
        turn_number: event.turnNumber ?? null,
        player_slot: (event.playerId?.endsWith("player-2") ? 2 : 1),
        event_type: event.action,
        value_number: null,
        note: null,
        occurred_at: event.createdAt
    }))
        .forEach((event) => {
        if (event.event_type === "setup-start" || event.event_type === "setup-resume") {
            timing.setupActivated(event.occurred_at);
            return;
        }
        if (!event.round_number) {
            return;
        }
        const round = (0, exports.ensureRound)(roundsByNumber, event.round_number);
        if (event.event_type === "round-start") {
            round.startedAt = event.occurred_at;
            return;
        }
        if (event.event_type === "round-end") {
            round.endedAt = event.occurred_at;
            return;
        }
        if (!event.turn_number) {
            return;
        }
        const playerId = (0, exports.getPlayerIdFromSlot)(gameId, event.player_slot);
        const turn = (0, exports.ensureTurn)(round, event.turn_number, playerId);
        if (event.event_type === "turn-start" ||
            event.event_type === "turn-resume" ||
            event.event_type === "turn-pause" ||
            event.event_type === "turn-end") {
            turn.playerId = playerId;
            timing.apply(event.event_type, turn, event.occurred_at);
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
exports.buildRoundsFromTimeEvents = buildRoundsFromTimeEvents;
const getDerivedStartedAt = (row, timeEvents) => {
    const explicitStart = [
        row.started_at,
        ...timeEvents
            .filter((event) => event.action === "game-start" ||
            event.action === "setup-start" ||
            event.action === "setup-end" ||
            event.action === "round-start" ||
            event.action === "turn-start")
            .map((event) => event.createdAt)
    ]
        .filter((value) => Boolean(value))
        .sort((left, right) => left.localeCompare(right))[0];
    if (explicitStart) {
        return explicitStart;
    }
    return row.ended_at ? row.started_at : undefined;
};
exports.getDerivedStartedAt = getDerivedStartedAt;
const getDerivedEndedAt = (row, timeEvents) => timeEvents
    .filter((event) => event.action === "game-end")
    .map((event) => event.createdAt)
    .sort((left, right) => left.localeCompare(right))[0] ?? row.ended_at ?? undefined;
exports.getDerivedEndedAt = getDerivedEndedAt;
const getUpdatedAt = (row, events) => {
    const timestamps = [row.created_at, row.started_at, row.ended_at ?? undefined, ...events.map((event) => event.occurred_at)]
        .filter((value) => Boolean(value))
        .sort((left, right) => left.localeCompare(right));
    return timestamps[timestamps.length - 1] ?? row.created_at;
};
exports.getUpdatedAt = getUpdatedAt;
const getCurrentPlayerId = (gameId, startingPlayerId, rounds, endedAt) => {
    const fallbackPlayerId = (0, exports.getPlayerIdFromSlot)(gameId, 1);
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
    return latestTurn.playerId === (0, exports.getPlayerIdFromSlot)(gameId, 1)
        ? (0, exports.getPlayerIdFromSlot)(gameId, 2)
        : (0, exports.getPlayerIdFromSlot)(gameId, 1);
};
exports.getCurrentPlayerId = getCurrentPlayerId;
const mapEventRows = (gameId, events) => {
    const scoreEvents = [];
    const commandPointEvents = [];
    const noteEvents = [];
    const timeEvents = [];
    // Zurueckgenommene Ereignisse und Audit-Zeilen (Schema 2) nie anzeigen; RLS blendet sie bereits aus.
    (0, exports.sortEventRecordsByCreation)(events.filter((event) => !event.revoked_by && event.event_type !== "revoke" && event.event_type !== "restore")).forEach((event) => {
        const playerId = (0, exports.getPlayerIdFromSlot)(gameId, event.player_slot);
        const eventNote = event.note ?? undefined;
        const baseEvent = {
            id: event.id,
            playerId,
            roundNumber: event.round_number ?? undefined,
            turnNumber: event.turn_number ?? undefined,
            createdAt: event.occurred_at
        };
        if (event.event_type in exports.scoreTypeByEventType) {
            scoreEvents.push({
                ...baseEvent,
                type: "score",
                scoreType: exports.scoreTypeByEventType[event.event_type],
                value: (0, exports.getNumericValue)(event.value_number) ?? 0,
                note: eventNote
            });
            return;
        }
        if (event.event_type in exports.cpTypeByEventType) {
            commandPointEvents.push({
                ...baseEvent,
                type: "command-point",
                cpType: exports.cpTypeByEventType[event.event_type],
                value: (0, exports.getNumericValue)(event.value_number) ?? 0,
                note: eventNote
            });
            return;
        }
        if (event.event_type === "note") {
            noteEvents.push({
                ...baseEvent,
                type: "note",
                note: eventNote ?? ""
            });
            return;
        }
        if (exports.timeActions.has(event.event_type)) {
            const includePlayer = event.event_type === "turn-start" ||
                event.event_type === "turn-end" ||
                event.event_type === "turn-pause" ||
                event.event_type === "turn-resume" ||
                event.event_type === "timeout-start" ||
                event.event_type === "timeout-end";
            timeEvents.push({
                id: event.id,
                type: "time",
                action: event.event_type,
                playerId: includePlayer ? playerId : undefined,
                roundNumber: event.round_number ?? undefined,
                turnNumber: event.turn_number ?? undefined,
                createdAt: event.occurred_at
            });
        }
    });
    return {
        scoreEvents,
        commandPointEvents,
        noteEvents,
        timeEvents
    };
};
exports.mapEventRows = mapEventRows;
// Server liefert Zeitstempel als "+00:00" mit variabler Nachkommastelle, Clients als "...Z".
// Einheitliches ISO-Format, damit Stringvergleiche/Sortierung (startedAt, Timer) stabil bleiben.
const toIsoTimestamp = (value) => {
    if (!value)
        return value;
    const parsed = Date.parse(value);
    return (Number.isFinite(parsed) ? new Date(parsed).toISOString() : value);
};
exports.toIsoTimestamp = toIsoTimestamp;
const mapSupabaseGameToAppGame = (rawRow, rawEvents) => {
    const row = { ...rawRow, created_at: (0, exports.toIsoTimestamp)(rawRow.created_at),
        started_at: (0, exports.toIsoTimestamp)(rawRow.started_at), ended_at: (0, exports.toIsoTimestamp)(rawRow.ended_at) };
    const events = rawEvents.map((event) => ({ ...event, created_at: (0, exports.toIsoTimestamp)(event.created_at),
        occurred_at: (0, exports.toIsoTimestamp)(event.occurred_at) }));
    const playerOneId = (0, exports.createPlayerId)(row.id, 1);
    const playerTwoId = (0, exports.createPlayerId)(row.id, 2);
    const { date, time } = (0, exports.getScheduledDateParts)(row.game_date);
    const mappedEvents = (0, exports.mapEventRows)(row.id, events);
    const startingPlayerId = row.starting_player ? (0, exports.getPlayerIdFromSlot)(row.id, row.starting_player) : "";
    const defenderPlayerId = row.defender_player ? (0, exports.getPlayerIdFromSlot)(row.id, row.defender_player) : "";
    const startedAt = (0, exports.getDerivedStartedAt)(row, mappedEvents.timeEvents);
    const endedAt = (0, exports.getDerivedEndedAt)(row, mappedEvents.timeEvents);
    const rounds = (0, exports.buildRoundsFromTimeEvents)(row.id, mappedEvents.timeEvents, endedAt);
    const scoreMeta = (0, exports.parseScoreMeta)(row.notes);
    const optionsMeta = (0, exports.parseOptionsMeta)(row.notes);
    const playerDetachments = (0, exports.parsePlayerMeta)(row.notes);
    const scenarioMeta = (0, exports.parseScenarioMeta)(row.notes);
    const finishMeta = (0, exports.parseFinishMeta)(row.notes);
    const statsEligibilityMode = (0, exports.parseStatsEligibilityMode)(row.stats_eligibility_mode);
    const statsEligibilityOverrides = (0, exports.parseStatsEligibilityOverrides)(row.stats_eligibility_overrides);
    return {
        id: row.id,
        syncVersion: typeof row.version === "number" ? row.version : undefined,
        syncFlowVersion: typeof row.flow_version === "number" ? row.flow_version : undefined,
        createdAt: row.created_at,
        updatedAt: (0, exports.getUpdatedAt)(row, events),
        status: endedAt ? "completed" : "active",
        finishReason: endedAt ? finishMeta.finishReason ?? "completed" : undefined,
        scoreDetailLevel: scoreMeta.scoreDetailLevel,
        statsEligibilityMode,
        statsEligibilityOverrides,
        gamePoints: row.player1_max_points,
        scheduledDate: date,
        scheduledTime: time,
        deployment: row.deployment ?? scenarioMeta.deployment,
        primaryMission: row.primary_mission ?? scenarioMeta.primaryMission,
        defenderPlayerId,
        startingPlayerId,
        currentPlayerId: (0, exports.getCurrentPlayerId)(row.id, startingPlayerId, rounds, endedAt),
        startedAt,
        endedAt,
        players: [
            {
                id: playerOneId,
                name: row.player1_name,
                army: {
                    name: row.player1_army,
                    maxPoints: row.player1_max_points,
                    detachment: playerDetachments["player-1"] ?? ""
                }
            },
            {
                id: playerTwoId,
                name: row.player2_name,
                army: {
                    name: row.player2_army,
                    maxPoints: row.player2_max_points,
                    detachment: playerDetachments["player-2"] ?? ""
                }
            }
        ],
        rounds,
        scoreEvents: mappedEvents.scoreEvents,
        commandPointEvents: mappedEvents.commandPointEvents,
        noteEvents: mappedEvents.noteEvents,
        timeEvents: mappedEvents.timeEvents,
        timerCorrections: (0, exports.parseTimerCorrections)(row.timer_corrections, row.notes),
        autoCommandPointOn: optionsMeta.autoCommandPointOn,
        autoCommandPointAwards: optionsMeta.autoCommandPointAwards,
        legacyScoreTotals: scoreMeta.legacyScoreTotals
    };
};
exports.mapSupabaseGameToAppGame = mapSupabaseGameToAppGame;
