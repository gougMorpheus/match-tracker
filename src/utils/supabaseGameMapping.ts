// Reine Abbildung DB-Zeilen (games/events) -> App-Spiel. Ohne Supabase-Client und ohne import.meta,
// damit App (gamesRepository) UND Netlify Function (Push) GENAU dieselbe Abbildung benutzen.
import type {
  CommandPointEvent,
  CreateGameInput,
  Game,
  GameFinishReason,
  NoteEvent,
  PlayerId,
  Round,
  ScoreEvent,
  TimeEvent,
  TimeEventAction,
  Turn
} from "../types/game";
import type { Database } from "../types/supabase";
import type { Json } from "../types/supabase";
import { createId } from "./id";
import { orderTimeEventsForEvaluation } from "./timeEventOrder";
import { createTurnTimingTracker } from "./turnTiming";
import { berlinWallClockToMs, toLocalDateInput, toLocalTimeInput } from "./time";
import type { ScoreDetailLevel, StatsEligibilityArea, StatsEligibilityMode, StatsEligibilityOverrides, TimerCorrections } from "../types/game";

export type SupabaseGameRecord = Database["public"]["Tables"]["games"]["Row"];
export type SupabaseEventRecord = Database["public"]["Tables"]["events"]["Row"];
export type CreateSupabaseGamePayload = Database["public"]["Tables"]["games"]["Insert"];
export type UpdateSupabaseGamePayload = Database["public"]["Tables"]["games"]["Update"];
export type CreateSupabaseEventPayload = Database["public"]["Tables"]["events"]["Insert"];
export type UpdateSupabaseEventPayload = Database["public"]["Tables"]["events"]["Update"];

export const scoreTypeByEventType = {
  "score-primary": "primary",
  "score-secondary": "secondary",
  "score-challenge": "challenge",
  "score-total": "legacy-total"
} as const;

export const cpTypeByEventType = {
  "cp-gained": "gained",
  "cp-spent": "spent"
} as const;

export const timeActions = new Set<TimeEventAction>([
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

export const createPlayerId = (gameId: string, slot: 1 | 2): PlayerId => `${gameId}:player-${slot}`;

export const getPlayerSlotFromId = (game: Game, playerId: PlayerId): 1 | 2 =>
  game.players[0].id === playerId ? 1 : 2;

export const getPlayerIdFromSlot = (gameId: string, slot: 1 | 2): PlayerId =>
  createPlayerId(gameId, slot);

export const combineScheduledDateTime = (date: string, time: string): string | null => {
  if (!date || !time) {
    return null;
  }

  // Geplante Zeit ist Berliner Wanduhr (#45), unabhaengig von der Browser-Zeitzone.
  const ms = berlinWallClockToMs(date, time);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date(`${date}T${time}:00`).toISOString();
};

export const normalizeOptionalTimestamp = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue ? trimmedValue : null;
};

export const normalizeRequiredTimestamp = (value: string | null | undefined, fallback: string): string =>
  normalizeOptionalTimestamp(value) ?? fallback;

export const getScheduledDateParts = (value: string | null): { date: string; time: string } => {
  if (!value) {
    return {
      date: "",
      time: ""
    };
  }

  const date = new Date(value);
  return {
    date: toLocalDateInput(date),
    time: toLocalTimeInput(date)
  };
};

export const getNumericValue = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const parsedValue = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(parsedValue) ? parsedValue : null;
};

export const createEmptyTimerCorrections = (): TimerCorrections => ({
  totalMs: 0,
  rounds: {},
  turns: {}
});

export const normalizeTimerCorrections = (value: unknown): TimerCorrections => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createEmptyTimerCorrections();
  }

  const timerCorrections = value as {
    totalMs?: unknown;
    rounds?: Record<string, unknown>;
    turns?: Record<string, unknown>;
  };

  return {
    totalMs: typeof timerCorrections.totalMs === "number" ? timerCorrections.totalMs : 0,
    rounds: Object.fromEntries(
      Object.entries(timerCorrections.rounds ?? {}).filter(([, amount]) => typeof amount === "number")
    ) as Record<string, number>,
    turns: Object.fromEntries(
      Object.entries(timerCorrections.turns ?? {}).filter(([, amount]) => typeof amount === "number")
    ) as Record<string, number>
  };
};

export const serializeTimerCorrections = (timerCorrections: TimerCorrections): Json => ({
  totalMs: timerCorrections.totalMs,
  rounds: timerCorrections.rounds,
  turns: timerCorrections.turns
});

export const createDefaultScoreMeta = (): {
  scoreDetailLevel: ScoreDetailLevel;
  legacyScoreTotals: Record<string, number>;
} => ({
  scoreDetailLevel: "full",
  legacyScoreTotals: {}
});

export const parseStatsEligibilityMode = (value: unknown): StatsEligibilityMode =>
  value === "include" || value === "exclude" ? value : "auto";

export const serializeStatsEligibilityMode = (value: StatsEligibilityMode): string | null =>
  value === "auto" ? null : value;

export const statsEligibilityAreas: StatsEligibilityArea[] = ["result", "scoring", "cp", "time"];
export const statsEligibilityTurnAreas: Exclude<StatsEligibilityArea, "result">[] = ["scoring", "cp", "time"];

export const parseStatsEligibilityOverrides = (value: unknown): StatsEligibilityOverrides => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const raw = value as StatsEligibilityOverrides;
  const areas = Object.fromEntries(
    statsEligibilityAreas.flatMap((area) => {
      const mode = raw.areas?.[area];
      return mode === "include" || mode === "exclude" ? [[area, mode]] : [];
    })
  ) as Partial<Record<StatsEligibilityArea, StatsEligibilityMode>>;
  const turns = Object.fromEntries(
    Object.entries(raw.turns ?? {}).flatMap(([turnKey, modes]) => {
      const normalizedModes = Object.fromEntries(
        statsEligibilityTurnAreas.flatMap((area) => {
          const mode = modes?.[area];
          return mode === "include" || mode === "exclude" ? [[area, mode]] : [];
        })
      ) as Partial<Record<Exclude<StatsEligibilityArea, "result">, StatsEligibilityMode>>;
      return Object.keys(normalizedModes).length ? [[turnKey, normalizedModes]] : [];
    })
  );

  return {
    ...(Object.keys(areas).length ? { areas } : {}),
    ...(Object.keys(turns).length ? { turns } : {})
  };
};

export const serializeStatsEligibilityOverrides = (value: StatsEligibilityOverrides): Json | null =>
  value.areas && Object.keys(value.areas).length || value.turns && Object.keys(value.turns).length
    ? value as Json
    : null;

export const createDefaultPlayerDetachments = (): Record<string, string> => ({
  "player-1": "",
  "player-2": ""
});

export const createDefaultScenarioMeta = (): { deployment: string; primaryMission: string } => ({
  deployment: "",
  primaryMission: ""
});

export const createDefaultFinishMeta = (): { finishReason: GameFinishReason | undefined } => ({
  finishReason: undefined
});

export const parseJsonObject = (value: string | null): Record<string, unknown> => {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
};

export const createPlayerDetachmentsFromInput = (payload: CreateGameInput): Record<string, string> => ({
  "player-1": payload.playerOneDetachment.trim(),
  "player-2": payload.playerTwoDetachment.trim()
});

export const parseTimerCorrections = (value: unknown, legacyNotes?: string | null): TimerCorrections => {
  const normalizedValue = normalizeTimerCorrections(value);
  const hasTimerCorrectionValue =
    normalizedValue.totalMs !== 0 ||
    Object.keys(normalizedValue.rounds).length > 0 ||
    Object.keys(normalizedValue.turns).length > 0;
  if (hasTimerCorrectionValue) {
    return normalizedValue;
  }

  if (legacyNotes !== undefined) {
    const legacyCorrections = parseTimerCorrectionsFromNotes(legacyNotes);
    const hasLegacyTimerCorrectionValue =
      legacyCorrections.totalMs !== 0 ||
      Object.keys(legacyCorrections.rounds).length > 0 ||
      Object.keys(legacyCorrections.turns).length > 0;
    if (hasLegacyTimerCorrectionValue) {
      return legacyCorrections;
    }
  }

  return normalizedValue;
};

export const parseTimerCorrectionsFromNotes = (value: string | null): TimerCorrections => {
  if (!value) {
    return createEmptyTimerCorrections();
  }

  try {
    const parsed = JSON.parse(value) as {
      timerCorrections?: {
        totalMs?: number;
        rounds?: Record<string, number>;
        turns?: Record<string, number>;
      };
    };
    const timerCorrections = parsed?.timerCorrections;
    return normalizeTimerCorrections(timerCorrections);
  } catch {
    return createEmptyTimerCorrections();
  }
};

export const parseScoreMeta = (
  value: string | null
): { scoreDetailLevel: ScoreDetailLevel; legacyScoreTotals: Record<string, number> } => {
  if (!value) {
    return createDefaultScoreMeta();
  }

  try {
    const parsed = JSON.parse(value) as {
      scoreMeta?: {
        scoreDetailLevel?: ScoreDetailLevel;
        legacyScoreTotals?: Record<string, number>;
      };
    };
    const scoreMeta = parsed?.scoreMeta;
    return {
      scoreDetailLevel:
        scoreMeta?.scoreDetailLevel === "total-only" || scoreMeta?.scoreDetailLevel === "none"
          ? scoreMeta.scoreDetailLevel
          : "full",
      legacyScoreTotals: Object.fromEntries(
        Object.entries(scoreMeta?.legacyScoreTotals ?? {}).filter(([, amount]) => typeof amount === "number")
      )
    };
  } catch {
    return createDefaultScoreMeta();
  }
};

export const parsePlayerMeta = (value: string | null): Record<string, string> => {
  if (!value) {
    return createDefaultPlayerDetachments();
  }

  try {
    const parsed = JSON.parse(value) as {
      playerMeta?: {
        detachments?: Record<string, string>;
      };
    };
    return {
      ...createDefaultPlayerDetachments(),
      ...Object.fromEntries(
        Object.entries(parsed?.playerMeta?.detachments ?? {}).filter(([, detachment]) => typeof detachment === "string")
      )
    };
  } catch {
    return createDefaultPlayerDetachments();
  }
};

export const parseScenarioMeta = (value: string | null): { deployment: string; primaryMission: string } => {
  if (!value) {
    return createDefaultScenarioMeta();
  }

  try {
    const parsed = JSON.parse(value) as {
      scenarioMeta?: {
        deployment?: string;
        primaryMission?: string;
      };
    };
    return {
      deployment:
        typeof parsed?.scenarioMeta?.deployment === "string" ? parsed.scenarioMeta.deployment : "",
      primaryMission:
        typeof parsed?.scenarioMeta?.primaryMission === "string" ? parsed.scenarioMeta.primaryMission : ""
    };
  } catch {
    return createDefaultScenarioMeta();
  }
};

export const parseFinishMeta = (value: string | null): { finishReason: GameFinishReason | undefined } => {
  if (!value) {
    return createDefaultFinishMeta();
  }

  try {
    const parsed = JSON.parse(value) as {
      finishMeta?: {
        finishReason?: GameFinishReason;
      };
    };
    const reason = parsed?.finishMeta?.finishReason;
    return {
      finishReason:
        reason === "completed" ||
        reason === "draw" ||
        reason === "interrupted" ||
        reason === "abandoned" ||
        reason === "player-1-conceded" ||
        reason === "player-2-conceded"
          ? reason
          : undefined
    };
  } catch {
    return createDefaultFinishMeta();
  }
};

export const parseOptionsMeta = (
  value: string | null
): { autoCommandPointOn: boolean; autoCommandPointAwards: Record<string, boolean> } => {
  if (!value) {
    return { autoCommandPointOn: true, autoCommandPointAwards: {} };
  }

  try {
    const parsed = JSON.parse(value) as {
      optionsMeta?: {
        autoCommandPointOn?: boolean;
        autoCommandPointAwards?: Record<string, boolean>;
      };
    };
  return {
    autoCommandPointOn: parsed?.optionsMeta?.autoCommandPointOn ?? true,
    autoCommandPointAwards: Object.fromEntries(
      Object.entries(parsed?.optionsMeta?.autoCommandPointAwards ?? {}).filter(([, value]) => value === true)
    )
    };
  } catch {
    return { autoCommandPointOn: true, autoCommandPointAwards: {} };
  }
};

export const parseDeletedMeta = (value: string | null): { deletedAt: string | undefined } => {
  const parsed = parseJsonObject(value);
  const deletedMeta = parsed.deletedMeta;

  if (!deletedMeta || typeof deletedMeta !== "object" || Array.isArray(deletedMeta)) {
    return {
      deletedAt: undefined
    };
  }

  const deletedAt = (deletedMeta as Record<string, unknown>).deletedAt;
  return {
    deletedAt: typeof deletedAt === "string" && deletedAt.trim() ? deletedAt : undefined
  };
};

export const getRowDeletedAt = (row: SupabaseGameRecord): string | undefined => {
  const deletedAt = (row as SupabaseGameRecord & { deleted_at?: string | null }).deleted_at;
  return typeof deletedAt === "string" && deletedAt.trim()
    ? deletedAt
    : parseDeletedMeta(row.notes).deletedAt;
};

export const isSupabaseGameDeleted = (row: SupabaseGameRecord): boolean =>
  Boolean(getRowDeletedAt(row));

export const serializeSoftDeletedNotes = (value: string | null, deletedAt: string): string => {
  const parsed = parseJsonObject(value);
  const existingDeletedMeta =
    parsed.deletedMeta && typeof parsed.deletedMeta === "object" && !Array.isArray(parsed.deletedMeta)
      ? parsed.deletedMeta as Record<string, unknown>
      : {};

  return JSON.stringify({
    ...parsed,
    deletedMeta: {
      ...existingDeletedMeta,
      deletedAt
    }
  });
};

export const serializeGameNotes = (
  scoreDetailLevel: ScoreDetailLevel,
  legacyScoreTotals: Record<string, number>,
  optionsMeta: { autoCommandPointOn: boolean; autoCommandPointAwards: Record<string, boolean> },
  playerDetachments: Record<string, string>,
  scenarioMeta?: { deployment: string; primaryMission: string },
  finishReason?: GameFinishReason
): string | null => {
  const hasScoreMeta = scoreDetailLevel !== "full" || Object.keys(legacyScoreTotals).length > 0;
  const hasOptionsMeta =
    optionsMeta.autoCommandPointOn !== true ||
    Object.keys(optionsMeta.autoCommandPointAwards).length > 0;
  const hasPlayerMeta = Object.values(playerDetachments).some((value) => value.trim().length > 0);
  const hasScenarioMeta = Boolean(
    scenarioMeta?.deployment.trim() || scenarioMeta?.primaryMission.trim()
  );
  const hasFinishMeta = Boolean(finishReason && finishReason !== "completed");

  if (
    !hasScoreMeta &&
    !hasOptionsMeta &&
    !hasPlayerMeta &&
    !hasScenarioMeta &&
    !hasFinishMeta
  ) {
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


export const sortEventRecords = (events: SupabaseEventRecord[]): SupabaseEventRecord[] =>
  [...events].sort((left, right) => {
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

export const sortEventRecordsByCreation = (events: SupabaseEventRecord[]): SupabaseEventRecord[] =>
  [...events].sort(
    (left, right) =>
      left.created_at.localeCompare(right.created_at) ||
      left.occurred_at.localeCompare(right.occurred_at)
  );

export const ensureRound = (roundsByNumber: Map<number, Round>, roundNumber: number): Round => {
  const existing = roundsByNumber.get(roundNumber);
  if (existing) {
    return existing;
  }

  const nextRound: Round = {
    id: createId(`round-${roundNumber}`),
    roundNumber,
    turns: []
  };
  roundsByNumber.set(roundNumber, nextRound);
  return nextRound;
};

export const ensureTurn = (
  round: Round,
  turnNumber: number,
  playerId: PlayerId
): Turn => {
  const existingTurn = round.turns.find((turn) => turn.turnNumber === turnNumber);
  if (existingTurn) {
    return existingTurn;
  }

  const nextTurn: Turn = {
    id: createId(`turn-${round.roundNumber}-${turnNumber}`),
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

export const buildRoundsFromTimeEvents = (gameId: string, timeEvents: TimeEvent[], fallbackEndedAt?: string): Round[] => {
  const roundsByNumber = new Map<number, Round>();
  const timing = createTurnTimingTracker(); // gleiche Zug-Zeitlogik wie gameState (Timer-Regel Tim 22.10.)
  const gameEndAt = timeEvents
    .filter((event) => event.action === "game-end")
    .map((event) => event.createdAt)
    .sort((left, right) => left.localeCompare(right))[0] ?? fallbackEndedAt;

  orderTimeEventsForEvaluation(timeEvents
    .filter((event) => !gameEndAt || event.createdAt <= gameEndAt || event.action === "game-end"))
    .map((event) => ({
      id: event.id,
      created_at: event.createdAt,
      game_id: gameId,
      round_number: event.roundNumber ?? null,
      turn_number: event.turnNumber ?? null,
      player_slot: (event.playerId?.endsWith("player-2") ? 2 : 1) as 1 | 2,
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

    const round = ensureRound(roundsByNumber, event.round_number);
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

    const playerId = getPlayerIdFromSlot(gameId, event.player_slot);
    const turn = ensureTurn(round, event.turn_number, playerId);
    if (
      event.event_type === "turn-start" ||
      event.event_type === "turn-resume" ||
      event.event_type === "turn-pause" ||
      event.event_type === "turn-end"
    ) {
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

export const getDerivedStartedAt = (row: SupabaseGameRecord, timeEvents: TimeEvent[]): string | undefined => {
  const explicitStart = [
    row.started_at,
    ...timeEvents
      .filter(
        (event) =>
          event.action === "game-start" ||
          event.action === "setup-start" ||
          event.action === "setup-end" ||
          event.action === "round-start" ||
          event.action === "turn-start"
      )
      .map((event) => event.createdAt)
  ]
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => left.localeCompare(right))[0];

  if (explicitStart) {
    return explicitStart;
  }

  return row.ended_at ? row.started_at : undefined;
};

export const getDerivedEndedAt = (row: SupabaseGameRecord, timeEvents: TimeEvent[]): string | undefined =>
  timeEvents
    .filter((event) => event.action === "game-end")
    .map((event) => event.createdAt)
    .sort((left, right) => left.localeCompare(right))[0] ?? row.ended_at ?? undefined;

export const getUpdatedAt = (row: SupabaseGameRecord, events: SupabaseEventRecord[]): string => {
  const timestamps = [row.created_at, row.started_at, row.ended_at ?? undefined, ...events.map((event) => event.occurred_at)]
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => left.localeCompare(right));

  return timestamps[timestamps.length - 1] ?? row.created_at;
};

export const getCurrentPlayerId = (
  gameId: string,
  startingPlayerId: PlayerId,
  rounds: Round[],
  endedAt?: string
): PlayerId => {
  const fallbackPlayerId = getPlayerIdFromSlot(gameId, 1);
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

  return latestTurn.playerId === getPlayerIdFromSlot(gameId, 1)
    ? getPlayerIdFromSlot(gameId, 2)
    : getPlayerIdFromSlot(gameId, 1);
};

export const mapEventRows = (gameId: string, events: SupabaseEventRecord[]) => {
  const scoreEvents: ScoreEvent[] = [];
  const commandPointEvents: CommandPointEvent[] = [];
  const noteEvents: NoteEvent[] = [];
  const timeEvents: TimeEvent[] = [];

  // Zurueckgenommene Ereignisse und Audit-Zeilen (Schema 2) nie anzeigen; RLS blendet sie bereits aus.
  sortEventRecordsByCreation(events.filter((event) =>
    !event.revoked_by && event.event_type !== "revoke" && event.event_type !== "restore")).forEach((event) => {
    const playerId = getPlayerIdFromSlot(gameId, event.player_slot);
    const eventNote = event.note ?? undefined;
    const baseEvent = {
      id: event.id,
      playerId,
      roundNumber: event.round_number ?? undefined,
      turnNumber: event.turn_number ?? undefined,
      createdAt: event.occurred_at
    };

    if (event.event_type in scoreTypeByEventType) {
      scoreEvents.push({
        ...baseEvent,
        type: "score",
        scoreType: scoreTypeByEventType[event.event_type as keyof typeof scoreTypeByEventType],
        value: getNumericValue(event.value_number) ?? 0,
        note: eventNote
      });
      return;
    }

    if (event.event_type in cpTypeByEventType) {
      commandPointEvents.push({
        ...baseEvent,
        type: "command-point",
        cpType: cpTypeByEventType[event.event_type as keyof typeof cpTypeByEventType],
        value: getNumericValue(event.value_number) ?? 0,
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

    if (timeActions.has(event.event_type as TimeEventAction)) {
      const includePlayer =
        event.event_type === "turn-start" ||
        event.event_type === "turn-end" ||
        event.event_type === "turn-pause" ||
        event.event_type === "turn-resume" ||
        event.event_type === "timeout-start" ||
        event.event_type === "timeout-end";

      timeEvents.push({
        id: event.id,
        type: "time",
        action: event.event_type as TimeEventAction,
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

// Server liefert Zeitstempel als "+00:00" mit variabler Nachkommastelle, Clients als "...Z".
// Einheitliches ISO-Format, damit Stringvergleiche/Sortierung (startedAt, Timer) stabil bleiben.
export const toIsoTimestamp = <T extends string | null | undefined>(value: T): T => {
  if (!value) return value;
  const parsed = Date.parse(value);
  return (Number.isFinite(parsed) ? new Date(parsed).toISOString() : value) as T;
};

export const mapSupabaseGameToAppGame = (
  rawRow: SupabaseGameRecord,
  rawEvents: SupabaseEventRecord[]
): Game => {
  const row: SupabaseGameRecord = { ...rawRow, created_at: toIsoTimestamp(rawRow.created_at),
    started_at: toIsoTimestamp(rawRow.started_at), ended_at: toIsoTimestamp(rawRow.ended_at) };
  const events = rawEvents.map((event) => ({ ...event, created_at: toIsoTimestamp(event.created_at),
    occurred_at: toIsoTimestamp(event.occurred_at) }));
  const playerOneId = createPlayerId(row.id, 1);
  const playerTwoId = createPlayerId(row.id, 2);
  const { date, time } = getScheduledDateParts(row.game_date);
  const mappedEvents = mapEventRows(row.id, events);
  const startingPlayerId = row.starting_player ? getPlayerIdFromSlot(row.id, row.starting_player) : "";
  const defenderPlayerId = row.defender_player ? getPlayerIdFromSlot(row.id, row.defender_player) : "";
  const startedAt = getDerivedStartedAt(row, mappedEvents.timeEvents);
  const endedAt = getDerivedEndedAt(row, mappedEvents.timeEvents);
  const rounds = buildRoundsFromTimeEvents(row.id, mappedEvents.timeEvents, endedAt);
  const scoreMeta = parseScoreMeta(row.notes);
  const optionsMeta = parseOptionsMeta(row.notes);
  const playerDetachments = parsePlayerMeta(row.notes);
  const scenarioMeta = parseScenarioMeta(row.notes);
  const finishMeta = parseFinishMeta(row.notes);
  const statsEligibilityMode = parseStatsEligibilityMode(
    (row as SupabaseGameRecord & { stats_eligibility_mode?: string | null }).stats_eligibility_mode
  );
  const statsEligibilityOverrides = parseStatsEligibilityOverrides(
    (row as SupabaseGameRecord & { stats_eligibility_overrides?: Json | null }).stats_eligibility_overrides
  );

  return {
    id: row.id,
    syncVersion: typeof row.version === "number" ? row.version : undefined,
    syncFlowVersion: typeof row.flow_version === "number" ? row.flow_version : undefined,
    createdAt: row.created_at,
    updatedAt: getUpdatedAt(row, events),
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
    currentPlayerId: getCurrentPlayerId(row.id, startingPlayerId, rounds, endedAt),
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
    timerCorrections: parseTimerCorrections(
      (row as SupabaseGameRecord & { timer_corrections?: Json | null }).timer_corrections,
      row.notes
    ),
    autoCommandPointOn: optionsMeta.autoCommandPointOn,
    autoCommandPointAwards: optionsMeta.autoCommandPointAwards,
    legacyScoreTotals: scoreMeta.legacyScoreTotals
  };
};

