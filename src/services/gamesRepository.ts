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
import { getSupabaseClient } from "../lib/supabase";
import type { Database } from "../types/supabase";
import type { Json } from "../types/supabase";
import { createId } from "../utils/id";
import { getPlayerTotalScore } from "../utils/gameCalculations";
import { getNowIso, toLocalDateInput, toLocalTimeInput } from "../utils/time";
import type { ScoreDetailLevel, TimerCorrections } from "../types/game";

export type SupabaseGameRecord = Database["public"]["Tables"]["games"]["Row"];
export type SupabaseEventRecord = Database["public"]["Tables"]["events"]["Row"];
export type CreateSupabaseGamePayload = Database["public"]["Tables"]["games"]["Insert"];
export type UpdateSupabaseGamePayload = Database["public"]["Tables"]["games"]["Update"];
export type CreateSupabaseEventPayload = Database["public"]["Tables"]["events"]["Insert"];
export type UpdateSupabaseEventPayload = Database["public"]["Tables"]["events"]["Update"];

const scoreTypeByEventType = {
  "score-primary": "primary",
  "score-secondary": "secondary",
  "score-challenge": "challenge",
  "score-total": "legacy-total"
} as const;

const cpTypeByEventType = {
  "cp-gained": "gained",
  "cp-spent": "spent"
} as const;

const timeActions = new Set<TimeEventAction>([
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

const createPlayerId = (gameId: string, slot: 1 | 2): PlayerId => `${gameId}:player-${slot}`;

const getPlayerSlotFromId = (game: Game, playerId: PlayerId): 1 | 2 =>
  game.players[0].id === playerId ? 1 : 2;

const getPlayerIdFromSlot = (gameId: string, slot: 1 | 2): PlayerId =>
  createPlayerId(gameId, slot);

const combineScheduledDateTime = (date: string, time: string): string | null => {
  if (!date || !time) {
    return null;
  }

  return new Date(`${date}T${time}:00`).toISOString();
};

const normalizeOptionalTimestamp = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue ? trimmedValue : null;
};

const normalizeRequiredTimestamp = (value: string | null | undefined, fallback: string): string =>
  normalizeOptionalTimestamp(value) ?? fallback;

const getScheduledDateParts = (value: string | null): { date: string; time: string } => {
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

const getNumericValue = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const parsedValue = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(parsedValue) ? parsedValue : null;
};

const createEmptyTimerCorrections = (): TimerCorrections => ({
  totalMs: 0,
  rounds: {},
  turns: {}
});

const normalizeTimerCorrections = (value: unknown): TimerCorrections => {
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

const serializeTimerCorrections = (timerCorrections: TimerCorrections): Json => ({
  totalMs: timerCorrections.totalMs,
  rounds: timerCorrections.rounds,
  turns: timerCorrections.turns
});

const createDefaultScoreMeta = (): {
  scoreDetailLevel: ScoreDetailLevel;
  legacyScoreTotals: Record<string, number>;
} => ({
  scoreDetailLevel: "full",
  legacyScoreTotals: {}
});

const createDefaultPlayerDetachments = (): Record<string, string> => ({
  "player-1": "",
  "player-2": ""
});

const createDefaultScenarioMeta = (): { deployment: string; primaryMission: string } => ({
  deployment: "",
  primaryMission: ""
});

const createDefaultFinishMeta = (): { finishReason: GameFinishReason | undefined } => ({
  finishReason: undefined
});

const parseJsonObject = (value: string | null): Record<string, unknown> => {
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

const createPlayerDetachmentsFromInput = (payload: CreateGameInput): Record<string, string> => ({
  "player-1": payload.playerOneDetachment.trim(),
  "player-2": payload.playerTwoDetachment.trim()
});

const parseTimerCorrections = (value: unknown, legacyNotes?: string | null): TimerCorrections => {
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

const parseTimerCorrectionsFromNotes = (value: string | null): TimerCorrections => {
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

const parseScoreMeta = (
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

const parsePlayerMeta = (value: string | null): Record<string, string> => {
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

const parseScenarioMeta = (value: string | null): { deployment: string; primaryMission: string } => {
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

const parseFinishMeta = (value: string | null): { finishReason: GameFinishReason | undefined } => {
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

const parseOptionsMeta = (
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

const parseDeletedMeta = (value: string | null): { deletedAt: string | undefined } => {
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

const getRowDeletedAt = (row: SupabaseGameRecord): string | undefined => {
  const deletedAt = (row as SupabaseGameRecord & { deleted_at?: string | null }).deleted_at;
  return typeof deletedAt === "string" && deletedAt.trim()
    ? deletedAt
    : parseDeletedMeta(row.notes).deletedAt;
};

const isSupabaseGameDeleted = (row: SupabaseGameRecord): boolean =>
  Boolean(getRowDeletedAt(row));

const serializeSoftDeletedNotes = (value: string | null, deletedAt: string): string => {
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

const serializeGameNotes = (
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

const hasMissingScenarioColumnError = (message: string): boolean => {
  const normalizedMessage = message.toLowerCase();
  return (
    normalizedMessage.includes("deployment") ||
    normalizedMessage.includes("primary_mission")
  );
};

const hasMissingDeletedAtColumnError = (message: string): boolean => {
  const normalizedMessage = message.toLowerCase();
  return normalizedMessage.includes("deleted_at");
};

const hasMissingTimerCorrectionsColumnError = (message: string): boolean => {
  const normalizedMessage = message.toLowerCase();
  return normalizedMessage.includes("timer_corrections");
};

const stripOptionalScenarioFields = <
  T extends {
    deployment?: string | null;
    primary_mission?: string | null;
  }
>(
  payload: T
): Omit<T, "deployment" | "primary_mission"> => {
  const { deployment: _deployment, primary_mission: _primaryMission, ...rest } = payload;
  return rest;
};

const stripTimerCorrectionsField = <
  T extends {
    timer_corrections?: Json | null;
  }
>(
  payload: T
): Omit<T, "timer_corrections"> => {
  const { timer_corrections: _timerCorrections, ...rest } = payload;
  return rest;
};

const stripOptionalGameFields = <
  T extends {
    deployment?: string | null;
    primary_mission?: string | null;
    timer_corrections?: Json | null;
  }
>(
  payload: T
): Omit<T, "deployment" | "primary_mission" | "timer_corrections"> => {
  const {
    deployment: _deployment,
    primary_mission: _primaryMission,
    timer_corrections: _timerCorrections,
    ...rest
  } = payload;
  return rest;
};

const normalizeJsonString = (value: string | null | undefined): unknown => {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
};

const normalizeComparableValue = (value: unknown): unknown => {
  if (value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value.map(normalizeComparableValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, normalizeComparableValue(entryValue)])
    );
  }

  return value ?? null;
};

const getComparableSignature = (value: Record<string, unknown>): string =>
  JSON.stringify(normalizeComparableValue(value));

const getComparableGamePayload = (
  payload: CreateSupabaseGamePayload | SupabaseGameRecord
): Record<string, unknown> => ({
  started_at: payload.started_at ?? null,
  ended_at: payload.ended_at ?? null,
  deleted_at: "deleted_at" in payload ? payload.deleted_at ?? null : null,
  game_date: payload.game_date ?? null,
  player1_name: payload.player1_name,
  player1_army: payload.player1_army,
  player1_max_points: payload.player1_max_points,
  player2_name: payload.player2_name,
  player2_army: payload.player2_army,
  player2_max_points: payload.player2_max_points,
  deployment: payload.deployment ?? null,
  primary_mission: payload.primary_mission ?? null,
  defender_player: payload.defender_player ?? null,
  starting_player: payload.starting_player ?? null,
  winner_player: payload.winner_player ?? null,
  notes: normalizeJsonString(payload.notes)
});

const getComparableEventPayload = (
  payload: CreateSupabaseEventPayload | SupabaseEventRecord
): Record<string, unknown> => ({
  game_id: payload.game_id,
  round_number: payload.round_number ?? null,
  turn_number: payload.turn_number ?? null,
  player_slot: payload.player_slot,
  event_type: payload.event_type,
  value_number: payload.value_number ?? null,
  note: payload.note ?? null,
  occurred_at: payload.occurred_at ?? null
});

export const getGameSnapshotFingerprint = (game: Game): string =>
  getComparableSignature(getComparableGamePayload(createSyncedGamePayload(game)));

export const getEventPayloadFingerprint = (payload: CreateSupabaseEventPayload): string =>
  getComparableSignature(getComparableEventPayload(payload));

const fetchGameRecordById = async (gameId: string): Promise<SupabaseGameRecord | null> => {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("games")
    .select("*")
    .eq("id", gameId);

  if (error) {
    throw new Error(`Spiel konnte nicht fuer Vergleich geladen werden: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return (rows[0] as SupabaseGameRecord | undefined) ?? null;
};

const fetchEventRecordById = async (eventId: string): Promise<SupabaseEventRecord | null> => {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("id", eventId);

  if (error) {
    throw new Error(`Event konnte nicht fuer Vergleich geladen werden: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return (rows[0] as SupabaseEventRecord | undefined) ?? null;
};

const hasRemoteGameSnapshotChanged = async (game: Game): Promise<boolean> => {
  const existingRecord = await fetchGameRecordById(game.id);
  if (!existingRecord) {
    return true;
  }

  return getComparableSignature(getComparableGamePayload(existingRecord)) !== getGameSnapshotFingerprint(game);
};

const hasRemoteEventChanged = async (payload: CreateSupabaseEventPayload): Promise<boolean> => {
  if (!payload.id) {
    return true;
  }

  const existingRecord = await fetchEventRecordById(payload.id);
  if (!existingRecord) {
    return true;
  }

  return getComparableSignature(getComparableEventPayload(existingRecord)) !== getEventPayloadFingerprint(payload);
};

const sortEventRecords = (events: SupabaseEventRecord[]): SupabaseEventRecord[] =>
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

const sortEventRecordsByCreation = (events: SupabaseEventRecord[]): SupabaseEventRecord[] =>
  [...events].sort(
    (left, right) =>
      left.created_at.localeCompare(right.created_at) ||
      left.occurred_at.localeCompare(right.occurred_at)
  );

const ensureRound = (roundsByNumber: Map<number, Round>, roundNumber: number): Round => {
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

const ensureTurn = (
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

const buildRoundsFromTimeEvents = (gameId: string, timeEvents: TimeEvent[]): Round[] => {
  const roundsByNumber = new Map<number, Round>();

  timeEvents
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
    if (event.event_type === "turn-start") {
      turn.playerId = playerId;
      if (round.endedAt && round.endedAt <= event.occurred_at) {
        round.endedAt = undefined;
      }
      if (turn.timing.endedAt && turn.timing.endedAt <= event.occurred_at) {
        turn.timing.pauses.push({
          startedAt: turn.timing.endedAt,
          endedAt: event.occurred_at
        });
        turn.timing.endedAt = undefined;
      }
      if (!turn.timing.startedAt) {
        turn.timing.startedAt = event.occurred_at;
      } else {
        const latestPause = turn.timing.pauses[turn.timing.pauses.length - 1];
        if (latestPause && !latestPause.endedAt) {
          latestPause.endedAt = event.occurred_at;
        }
      }
      return;
    }

    if (event.event_type === "turn-resume") {
      turn.playerId = playerId;
      if (round.endedAt && round.endedAt <= event.occurred_at) {
        round.endedAt = undefined;
      }
      const latestPause = turn.timing.pauses[turn.timing.pauses.length - 1];
      if (latestPause && !latestPause.endedAt) {
        latestPause.endedAt = event.occurred_at;
      } else if (turn.timing.endedAt && turn.timing.endedAt <= event.occurred_at) {
        turn.timing.pauses.push({
          startedAt: turn.timing.endedAt,
          endedAt: event.occurred_at
        });
        turn.timing.endedAt = undefined;
      }
      return;
    }

    if (event.event_type === "turn-pause") {
      turn.playerId = playerId;
      const latestPause = turn.timing.pauses[turn.timing.pauses.length - 1];
      if (!latestPause || latestPause.endedAt) {
        turn.timing.pauses.push({
          startedAt: event.occurred_at
        });
      }
      return;
    }

    if (event.event_type === "turn-end") {
      turn.playerId = playerId;
      const latestPause = turn.timing.pauses[turn.timing.pauses.length - 1];
      if (latestPause && !latestPause.endedAt) {
        latestPause.endedAt = event.occurred_at;
      }
      turn.timing.endedAt = event.occurred_at;
    }
  });

  return Array.from(roundsByNumber.values())
    .sort((left, right) => left.roundNumber - right.roundNumber)
    .map((round) => ({
      ...round,
      turns: [...round.turns].sort((left, right) => left.turnNumber - right.turnNumber)
    }));
};

const getDerivedStartedAt = (row: SupabaseGameRecord, timeEvents: TimeEvent[]): string | undefined => {
  const explicitStart =
    timeEvents.find((event) => event.action === "game-start")?.createdAt ??
    timeEvents.find((event) => event.action === "setup-start")?.createdAt ??
    timeEvents.find((event) => event.action === "round-start")?.createdAt;

  if (explicitStart) {
    return explicitStart;
  }

  return row.ended_at ? row.started_at : undefined;
};

const getDerivedEndedAt = (row: SupabaseGameRecord, timeEvents: TimeEvent[]): string | undefined =>
  timeEvents.find((event) => event.action === "game-end")?.createdAt ?? row.ended_at ?? undefined;

const getUpdatedAt = (row: SupabaseGameRecord, events: SupabaseEventRecord[]): string => {
  const timestamps = [row.created_at, row.started_at, row.ended_at ?? undefined, ...events.map((event) => event.occurred_at)]
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => left.localeCompare(right));

  return timestamps[timestamps.length - 1] ?? row.created_at;
};

const getCurrentPlayerId = (
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

const mapEventRows = (gameId: string, events: SupabaseEventRecord[]) => {
  const scoreEvents: ScoreEvent[] = [];
  const commandPointEvents: CommandPointEvent[] = [];
  const noteEvents: NoteEvent[] = [];
  const timeEvents: TimeEvent[] = [];

  sortEventRecordsByCreation(events).forEach((event) => {
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

export const mapSupabaseGameToAppGame = (
  row: SupabaseGameRecord,
  events: SupabaseEventRecord[]
): Game => {
  const playerOneId = createPlayerId(row.id, 1);
  const playerTwoId = createPlayerId(row.id, 2);
  const { date, time } = getScheduledDateParts(row.game_date);
  const mappedEvents = mapEventRows(row.id, events);
  const rounds = buildRoundsFromTimeEvents(row.id, mappedEvents.timeEvents);
  const startingPlayerId = row.starting_player ? getPlayerIdFromSlot(row.id, row.starting_player) : "";
  const defenderPlayerId = row.defender_player ? getPlayerIdFromSlot(row.id, row.defender_player) : "";
  const startedAt = getDerivedStartedAt(row, mappedEvents.timeEvents);
  const endedAt = getDerivedEndedAt(row, mappedEvents.timeEvents);
  const scoreMeta = parseScoreMeta(row.notes);
  const optionsMeta = parseOptionsMeta(row.notes);
  const playerDetachments = parsePlayerMeta(row.notes);
  const scenarioMeta = parseScenarioMeta(row.notes);
  const finishMeta = parseFinishMeta(row.notes);

  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: getUpdatedAt(row, events),
    status: endedAt ? "completed" : "active",
    finishReason: endedAt ? finishMeta.finishReason ?? "completed" : undefined,
    scoreDetailLevel: scoreMeta.scoreDetailLevel,
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

const mapGameInputToInsert = (payload: CreateGameInput): CreateSupabaseGamePayload => ({
  game_date: combineScheduledDateTime(payload.scheduledDate, payload.scheduledTime),
  player1_name: payload.playerOneName.trim(),
  player1_army: payload.playerOneArmy.trim(),
  player1_max_points: payload.gamePoints,
  player2_name: payload.playerTwoName.trim(),
  player2_army: payload.playerTwoArmy.trim(),
  player2_max_points: payload.gamePoints,
  deployment: payload.deployment.trim() || null,
  primary_mission: payload.primaryMission.trim() || null,
  defender_player: payload.defenderSlot === "player1" ? 1 : payload.defenderSlot === "player2" ? 2 : null,
  starting_player: payload.startingSlot === "player1" ? 1 : payload.startingSlot === "player2" ? 2 : null,
  started_at: getNowIso(),
  ended_at: null,
  winner_player: null,
  notes: serializeGameNotes(
    "full",
    {},
    { autoCommandPointOn: true, autoCommandPointAwards: {} },
    createPlayerDetachmentsFromInput(payload),
    {
      deployment: payload.deployment,
      primaryMission: payload.primaryMission
    },
    "completed"
  )
});

export const createGameUpdatePayload = (payload: CreateGameInput): UpdateSupabaseGamePayload => ({
  game_date: combineScheduledDateTime(payload.scheduledDate, payload.scheduledTime),
  player1_name: payload.playerOneName.trim(),
  player1_army: payload.playerOneArmy.trim(),
  player1_max_points: payload.gamePoints,
  player2_name: payload.playerTwoName.trim(),
  player2_army: payload.playerTwoArmy.trim(),
  player2_max_points: payload.gamePoints,
  deployment: payload.deployment.trim() || null,
  primary_mission: payload.primaryMission.trim() || null,
  defender_player: payload.defenderSlot === "player1" ? 1 : payload.defenderSlot === "player2" ? 2 : null,
  starting_player: payload.startingSlot === "player1" ? 1 : payload.startingSlot === "player2" ? 2 : null
});

const getWinnerPlayerSlot = (game: Game): 1 | 2 | null => {
  if (game.finishReason === "draw") {
    return null;
  }

  const playerOneScore = getPlayerTotalScore(game, game.players[0].id);
  const playerTwoScore = getPlayerTotalScore(game, game.players[1].id);

  if (playerOneScore > playerTwoScore) {
    return 1;
  }

  if (playerTwoScore > playerOneScore) {
    return 2;
  }

  return null;
};

export const createImportedGamePayload = (game: Game): CreateSupabaseGamePayload => ({
  id: game.id,
  created_at: normalizeRequiredTimestamp(game.createdAt, getNowIso()),
  started_at: normalizeRequiredTimestamp(game.startedAt, normalizeRequiredTimestamp(game.createdAt, getNowIso())),
  ended_at: normalizeOptionalTimestamp(game.endedAt),
  game_date: combineScheduledDateTime(game.scheduledDate, game.scheduledTime),
  player1_name: game.players[0].name,
  player1_army: game.players[0].army.name,
  player1_max_points: game.gamePoints ?? game.players[0].army.maxPoints,
  player2_name: game.players[1].name,
  player2_army: game.players[1].army.name,
  player2_max_points: game.gamePoints ?? game.players[1].army.maxPoints,
  deployment: game.deployment || null,
  primary_mission: game.primaryMission || null,
  defender_player: game.defenderPlayerId === game.players[0].id ? 1 : game.defenderPlayerId === game.players[1].id ? 2 : null,
  starting_player: game.startingPlayerId === game.players[0].id ? 1 : game.startingPlayerId === game.players[1].id ? 2 : null,
  winner_player: getWinnerPlayerSlot(game),
  timer_corrections: serializeTimerCorrections(game.timerCorrections),
  notes: serializeGameNotes(game.scoreDetailLevel, game.legacyScoreTotals, {
    autoCommandPointOn: game.autoCommandPointOn,
    autoCommandPointAwards: game.autoCommandPointAwards
  }, {
    "player-1": game.players[0].army.detachment,
    "player-2": game.players[1].army.detachment
  }, {
    deployment: game.deployment,
    primaryMission: game.primaryMission
  }, game.finishReason)
});

export const createImportedEventPayloads = (persistedGame: Game, importedGame: Game): CreateSupabaseEventPayload[] => {
  const importedPlayerOneId = importedGame.players[0].id;
  const toPlayerSlot = (playerId?: PlayerId): 1 | 2 =>
    !playerId || playerId === importedPlayerOneId ? 1 : 2;
  const defaultOccurredAt = normalizeRequiredTimestamp(importedGame.createdAt, getNowIso());

  const payloads: CreateSupabaseEventPayload[] = [];

  importedGame.timeEvents.forEach((event) => {
    const occurredAt = normalizeRequiredTimestamp(event.createdAt, defaultOccurredAt);
    payloads.push({
      id: event.id,
      created_at: occurredAt,
      game_id: persistedGame.id,
      round_number: event.roundNumber ?? null,
      turn_number: event.turnNumber ?? null,
      player_slot: toPlayerSlot(event.playerId),
      event_type: event.action,
      occurred_at: occurredAt
    });
  });

  importedGame.commandPointEvents.forEach((event) => {
    const occurredAt = normalizeRequiredTimestamp(event.createdAt, defaultOccurredAt);
    payloads.push({
      id: event.id,
      created_at: occurredAt,
      game_id: persistedGame.id,
      round_number: event.roundNumber ?? null,
      turn_number: event.turnNumber ?? null,
      player_slot: toPlayerSlot(event.playerId),
      event_type: event.cpType === "gained" ? "cp-gained" : "cp-spent",
      value_number: event.value,
      note: event.note ?? null,
      occurred_at: occurredAt
    });
  });

  importedGame.scoreEvents.forEach((event) => {
    const occurredAt = normalizeRequiredTimestamp(event.createdAt, defaultOccurredAt);
    payloads.push({
      id: event.id,
      created_at: occurredAt,
      game_id: persistedGame.id,
      round_number: event.roundNumber ?? null,
      turn_number: event.turnNumber ?? null,
      player_slot: toPlayerSlot(event.playerId),
      event_type:
        event.scoreType === "primary"
          ? "score-primary"
          : event.scoreType === "secondary"
            ? "score-secondary"
            : event.scoreType === "challenge"
              ? "score-challenge"
              : "score-total",
      value_number: event.value,
      note: event.note ?? null,
      occurred_at: occurredAt
    });
  });

  importedGame.noteEvents.forEach((event) => {
    const occurredAt = normalizeRequiredTimestamp(event.createdAt, defaultOccurredAt);
    payloads.push({
      id: event.id,
      created_at: occurredAt,
      game_id: persistedGame.id,
      round_number: event.roundNumber ?? null,
      turn_number: event.turnNumber ?? null,
      player_slot: toPlayerSlot(event.playerId),
      event_type: "note",
      note: event.note,
      occurred_at: occurredAt
    });
  });

  return payloads;
};

export const createSyncedGamePayload = (game: Game): CreateSupabaseGamePayload => ({
  id: game.id,
  created_at: normalizeRequiredTimestamp(game.createdAt, getNowIso()),
  started_at: normalizeRequiredTimestamp(game.startedAt, normalizeRequiredTimestamp(game.createdAt, getNowIso())),
  ended_at: normalizeOptionalTimestamp(game.endedAt),
  game_date: combineScheduledDateTime(game.scheduledDate, game.scheduledTime),
  player1_name: game.players[0].name,
  player1_army: game.players[0].army.name,
  player1_max_points: game.gamePoints,
  player2_name: game.players[1].name,
  player2_army: game.players[1].army.name,
  player2_max_points: game.gamePoints,
  deployment: game.deployment || null,
  primary_mission: game.primaryMission || null,
  defender_player: game.defenderPlayerId === game.players[0].id ? 1 : game.defenderPlayerId === game.players[1].id ? 2 : null,
  starting_player: game.startingPlayerId === game.players[0].id ? 1 : game.startingPlayerId === game.players[1].id ? 2 : null,
  winner_player: game.endedAt ? getWinnerPlayerSlot(game) : null,
  notes: serializeGameNotes(game.scoreDetailLevel, game.legacyScoreTotals, {
    autoCommandPointOn: game.autoCommandPointOn,
    autoCommandPointAwards: game.autoCommandPointAwards
  }, {
    "player-1": game.players[0].army.detachment,
    "player-2": game.players[1].army.detachment
  }, {
    deployment: game.deployment,
    primaryMission: game.primaryMission
  }, game.finishReason)
});

export const createSyncedEventPayloads = (game: Game): CreateSupabaseEventPayload[] => {
  const playerOneId = game.players[0].id;
  const toPlayerSlot = (playerId?: PlayerId): 1 | 2 =>
    !playerId || playerId === playerOneId ? 1 : 2;

  return [
    ...game.timeEvents.map(
      (event): CreateSupabaseEventPayload => ({
        id: event.id,
        created_at: event.createdAt,
        game_id: game.id,
        round_number: event.roundNumber ?? null,
        turn_number: event.turnNumber ?? null,
        player_slot: toPlayerSlot(event.playerId),
        event_type: event.action,
        occurred_at: event.createdAt
      })
    ),
    ...game.commandPointEvents.map(
      (event): CreateSupabaseEventPayload => ({
        id: event.id,
        created_at: event.createdAt,
        game_id: game.id,
        round_number: event.roundNumber ?? null,
        turn_number: event.turnNumber ?? null,
        player_slot: toPlayerSlot(event.playerId),
        event_type: event.cpType === "gained" ? "cp-gained" : "cp-spent",
        value_number: event.value,
        note: event.note ?? null,
        occurred_at: event.createdAt
      })
    ),
    ...game.scoreEvents.map(
      (event): CreateSupabaseEventPayload => ({
        id: event.id,
        created_at: event.createdAt,
        game_id: game.id,
        round_number: event.roundNumber ?? null,
        turn_number: event.turnNumber ?? null,
        player_slot: toPlayerSlot(event.playerId),
        event_type:
          event.scoreType === "primary"
            ? "score-primary"
            : event.scoreType === "secondary"
              ? "score-secondary"
              : event.scoreType === "challenge"
                ? "score-challenge"
                : "score-total",
        value_number: event.value,
        note: event.note ?? null,
        occurred_at: event.createdAt
      })
    ),
    ...game.noteEvents.map(
      (event): CreateSupabaseEventPayload => ({
        id: event.id,
        created_at: event.createdAt,
        game_id: game.id,
        round_number: event.roundNumber ?? null,
        turn_number: event.turnNumber ?? null,
        player_slot: toPlayerSlot(event.playerId),
        event_type: "note",
        note: event.note,
        occurred_at: event.createdAt
      })
    )
  ];
};

export const getSyncedEventPayload = (
  game: Game,
  eventId: string
): CreateSupabaseEventPayload | null =>
  createSyncedEventPayloads(game).find((event) => event.id === eventId) ?? null;

const fetchEventsForGameIds = async (gameIds: string[]): Promise<SupabaseEventRecord[]> => {
  if (!gameIds.length) {
    return [];
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .in("game_id", gameIds)
    .order("occurred_at", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Events konnten nicht geladen werden: ${error.message}`);
  }

  return (data ?? []) as SupabaseEventRecord[];
};

export const gamesRepository = {
  async listGames(): Promise<Game[]> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("games")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`Spiele konnten nicht geladen werden: ${error.message}`);
    }

    const games = ((data ?? []) as SupabaseGameRecord[]).filter(
      (game) => !isSupabaseGameDeleted(game)
    );
    const events = await fetchEventsForGameIds(games.map((game) => game.id));

    return games.map((game) =>
      mapSupabaseGameToAppGame(
        game,
        events.filter((event) => event.game_id === game.id)
      )
    );
  },

  async getGameById(gameId: string): Promise<Game> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("games")
      .select("*")
      .eq("id", gameId)
      .single();

    if (error) {
      throw new Error(`Spiel konnte nicht geladen werden: ${error.message}`);
    }

    if (isSupabaseGameDeleted(data as SupabaseGameRecord)) {
      throw new Error("Spiel wurde geloescht.");
    }

    const events = await fetchEventsForGameIds([gameId]);
    return mapSupabaseGameToAppGame(data as SupabaseGameRecord, events);
  },

  async createGame(payload: CreateGameInput | CreateSupabaseGamePayload): Promise<Game> {
    const supabase = getSupabaseClient();
    const insertPayload: CreateSupabaseGamePayload =
      "playerOneName" in payload ? mapGameInputToInsert(payload) : payload;

    let { data, error } = await supabase
      .from("games")
      .insert(insertPayload)
      .select("*")
      .single();

    if (error && (hasMissingScenarioColumnError(error.message) || hasMissingTimerCorrectionsColumnError(error.message))) {
      ({ data, error } = await supabase
        .from("games")
        .insert(stripOptionalGameFields(insertPayload))
        .select("*")
        .single());
    }

    if (error) {
      throw new Error(`Spiel konnte nicht angelegt werden: ${error.message}`);
    }

    return mapSupabaseGameToAppGame(data as SupabaseGameRecord, []);
  },

  async updateGame(gameId: string, patch: UpdateSupabaseGamePayload): Promise<Game> {
    const supabase = getSupabaseClient();
    const updatePayload: UpdateSupabaseGamePayload = patch;
    let { data, error } = await supabase
      .from("games")
      .update(updatePayload)
      .eq("id", gameId)
      .select("*")
      .single();

    if (error && (hasMissingScenarioColumnError(error.message) || hasMissingTimerCorrectionsColumnError(error.message))) {
      ({ data, error } = await supabase
        .from("games")
        .update(stripOptionalGameFields(updatePayload))
        .eq("id", gameId)
        .select("*")
        .single());
    }

    if (error) {
      throw new Error(`Spiel konnte nicht aktualisiert werden: ${error.message}`);
    }

    const events = await fetchEventsForGameIds([gameId]);
    return mapSupabaseGameToAppGame(data as SupabaseGameRecord, events);
  },

  async upsertGameSnapshot(game: Game): Promise<Game> {
    if (!(await hasRemoteGameSnapshotChanged(game))) {
      return game;
    }

    const supabase = getSupabaseClient();
    const upsertPayload = createSyncedGamePayload(game);
    let { data, error } = await supabase
      .from("games")
      .upsert(upsertPayload, {
        onConflict: "id"
      })
      .select("*")
      .single();

    if (error && (hasMissingScenarioColumnError(error.message) || hasMissingTimerCorrectionsColumnError(error.message))) {
      ({ data, error } = await supabase
        .from("games")
        .upsert(stripOptionalGameFields(upsertPayload), {
          onConflict: "id"
        })
        .select("*")
        .single());
    }

    if (error) {
      throw new Error(`Spiel konnte nicht synchronisiert werden: ${error.message}`);
    }

    const events = await fetchEventsForGameIds([game.id]);
    return mapSupabaseGameToAppGame(data as SupabaseGameRecord, events);
  },

  async syncGame(game: Game): Promise<Game> {
    if (!(await hasRemoteGameSnapshotChanged(game))) {
      return game;
    }

    const supabase = getSupabaseClient();
    const upsertPayload = createSyncedGamePayload(game);
    let { error } = await supabase.from("games").upsert(upsertPayload, {
      onConflict: "id"
    });

    if (error && (hasMissingScenarioColumnError(error.message) || hasMissingTimerCorrectionsColumnError(error.message))) {
      ({ error } = await supabase.from("games").upsert(stripOptionalGameFields(upsertPayload), {
        onConflict: "id"
      }));
    }

    if (error) {
      throw new Error(`Spiel konnte nicht synchronisiert werden: ${error.message}`);
    }

    const { error: deleteEventsError } = await supabase.from("events").delete().eq("game_id", game.id);
    if (deleteEventsError) {
      throw new Error(`Events konnten nicht ersetzt werden: ${deleteEventsError.message}`);
    }

    const eventPayloads = createSyncedEventPayloads(game);
    if (eventPayloads.length) {
      const { error: insertEventsError } = await supabase.from("events").insert(eventPayloads);
      if (insertEventsError) {
        throw new Error(`Events konnten nicht synchronisiert werden: ${insertEventsError.message}`);
      }
    }

    return gamesRepository.getGameById(game.id);
  },

  async deleteGame(gameId: string): Promise<void> {
    const supabase = getSupabaseClient();
    const { data, error: loadError } = await supabase
      .from("games")
      .select("*")
      .eq("id", gameId)
      .single();

    if (loadError) {
      throw new Error(`Spiel konnte nicht geladen werden: ${loadError.message}`);
    }

    const deletedAt = getNowIso();
    const softDeletePayload: UpdateSupabaseGamePayload = {
      deleted_at: deletedAt,
      notes: serializeSoftDeletedNotes((data as SupabaseGameRecord).notes, deletedAt)
    };

    let { error } = await supabase.from("games").update(softDeletePayload).eq("id", gameId);

    if (error && hasMissingDeletedAtColumnError(error.message)) {
      ({ error } = await supabase
        .from("games")
        .update({
          notes: softDeletePayload.notes
        })
        .eq("id", gameId));
    }

    if (error) {
      throw new Error(`Spiel konnte nicht geloescht werden: ${error.message}`);
    }
  },

  async listEvents(gameId: string): Promise<SupabaseEventRecord[]> {
    return fetchEventsForGameIds([gameId]);
  },

  async addEvent(payload: CreateSupabaseEventPayload): Promise<SupabaseEventRecord> {
    const supabase = getSupabaseClient();
    const insertPayload: CreateSupabaseEventPayload = {
      ...payload,
      occurred_at: payload.occurred_at ?? getNowIso()
    };
    const { data, error } = await supabase
      .from("events")
      .insert(insertPayload)
      .select("*")
      .single();

    if (error) {
      throw new Error(`Event konnte nicht gespeichert werden: ${error.message}`);
    }

    return data as SupabaseEventRecord;
  },

  async upsertEvent(payload: CreateSupabaseEventPayload): Promise<SupabaseEventRecord> {
    const supabase = getSupabaseClient();
    const upsertPayload: CreateSupabaseEventPayload = {
      ...payload,
      occurred_at: payload.occurred_at ?? getNowIso()
    };

    if (!(await hasRemoteEventChanged(upsertPayload))) {
      const existingRecord = await fetchEventRecordById(upsertPayload.id ?? "");
      if (existingRecord) {
        return existingRecord;
      }
    }

    const { data, error } = await supabase
      .from("events")
      .upsert(upsertPayload, {
        onConflict: "id"
      })
      .select("*")
      .single();

    if (error) {
      throw new Error(`Event konnte nicht synchronisiert werden: ${error.message}`);
    }

    return data as SupabaseEventRecord;
  },

  async addEvents(payloads: CreateSupabaseEventPayload[]): Promise<SupabaseEventRecord[]> {
    if (!payloads.length) {
      return [];
    }

    const supabase = getSupabaseClient();
    const insertPayloads: CreateSupabaseEventPayload[] = payloads.map((payload) => ({
      ...payload,
      occurred_at: payload.occurred_at ?? getNowIso()
    }));
    const { data, error } = await supabase
      .from("events")
      .insert(insertPayloads)
      .select("*");

    if (error) {
      throw new Error(`Events konnten nicht gespeichert werden: ${error.message}`);
    }

    return (data ?? []) as SupabaseEventRecord[];
  },

  async deleteEvent(eventId: string): Promise<void> {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("events").delete().eq("id", eventId);

    if (error) {
      throw new Error(`Event konnte nicht geloescht werden: ${error.message}`);
    }
  },

  async updateEvent(eventId: string, patch: UpdateSupabaseEventPayload): Promise<SupabaseEventRecord> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("events")
      .update(patch)
      .eq("id", eventId)
      .select("*")
      .single();

    if (error) {
      throw new Error(`Event konnte nicht aktualisiert werden: ${error.message}`);
    }

    return data as SupabaseEventRecord;
  }
};

export const createEventPayload = (
  game: Game,
  payload: {
    playerId?: PlayerId;
    roundNumber?: number;
    turnNumber?: number;
    eventType: string;
    value?: number;
    note?: string;
    occurredAt?: string;
  }
): CreateSupabaseEventPayload => ({
  game_id: game.id,
  round_number: payload.roundNumber ?? null,
  turn_number: payload.turnNumber ?? null,
  player_slot: payload.playerId ? getPlayerSlotFromId(game, payload.playerId) : 1,
  event_type: payload.eventType,
  value_number: payload.value ?? null,
  note: payload.note?.trim() || null,
  occurred_at: payload.occurredAt ?? getNowIso()
});
