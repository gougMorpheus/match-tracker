import { parseSyncConflict, type SyncConflictInfo, type SyncRpcResult } from "../utils/syncVersioning";
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
import { orderTimeEventsForEvaluation } from "../utils/timeEventOrder";
import { getPlayerTotalScore } from "../utils/gameCalculations";
import { getNowIso, toLocalDateInput, toLocalTimeInput } from "../utils/time";
import type { ScoreDetailLevel, StatsEligibilityArea, StatsEligibilityMode, StatsEligibilityOverrides, TimerCorrections } from "../types/game";

export * from "../utils/supabaseGameMapping";
import {
  SupabaseGameRecord, SupabaseEventRecord, CreateSupabaseGamePayload, UpdateSupabaseGamePayload, CreateSupabaseEventPayload, UpdateSupabaseEventPayload, getPlayerSlotFromId, combineScheduledDateTime, normalizeOptionalTimestamp, normalizeRequiredTimestamp, normalizeTimerCorrections, serializeTimerCorrections, serializeStatsEligibilityMode, serializeStatsEligibilityOverrides, createPlayerDetachmentsFromInput, parseTimerCorrections, isSupabaseGameDeleted, serializeSoftDeletedNotes, serializeGameNotes, mapSupabaseGameToAppGame
} from "../utils/supabaseGameMapping";
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

const hasMissingStatsEligibilityColumnError = (message: string): boolean => {
  const normalizedMessage = message.toLowerCase();
  return normalizedMessage.includes("stats_eligibility_mode") || normalizedMessage.includes("stats_eligibility_overrides");
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
    stats_eligibility_mode?: string | null;
    stats_eligibility_overrides?: Json | null;
    notes?: string | null;
  }
>(
  payload: T,
  missingTimerCorrections: boolean
) => {
  const {
    deployment: _deployment,
    primary_mission: _primaryMission,
    timer_corrections: timerCorrections,
    stats_eligibility_mode: _statsEligibilityMode,
    stats_eligibility_overrides: _statsEligibilityOverrides,
    ...rest
  } = payload;
  if (!missingTimerCorrections) {
    // A different optional column is absent: keep corrections in their column.
    return { ...rest, ...(timerCorrections !== undefined ? { timer_corrections: timerCorrections } : {}) };
  }
  if (timerCorrections == null) return rest;
  const notes = normalizeJsonString(payload.notes);
  const metadata = notes && typeof notes === "object" && !Array.isArray(notes)
    ? notes : payload.notes ? { legacyNotes: payload.notes } : {};
  // Only legacy schemas without the column need the old notes representation.
  return { ...rest, notes: JSON.stringify({ ...metadata, timerCorrections: normalizeTimerCorrections(timerCorrections) }) };
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
  stats_eligibility_mode: payload.stats_eligibility_mode ?? null,
  stats_eligibility_overrides: payload.stats_eligibility_overrides ?? null,
  timer_corrections: parseTimerCorrections(payload.timer_corrections, payload.notes),
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
    throw new Error(`Spiel konnte nicht für Vergleich geladen werden: ${error.message}`);
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
    throw new Error(`Event konnte nicht für Vergleich geladen werden: ${error.message}`);
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
  stats_eligibility_mode: serializeStatsEligibilityMode(payload.statsEligibilityMode),
  stats_eligibility_overrides: null,
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
  starting_player: payload.startingSlot === "player1" ? 1 : payload.startingSlot === "player2" ? 2 : null,
  stats_eligibility_mode: serializeStatsEligibilityMode(payload.statsEligibilityMode)
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

const getPersistedGameEndedAt = (game: Game): string | undefined =>
  game.endedAt ??
  game.timeEvents
    .filter((event) => event.action === "game-end")
    .map((event) => event.createdAt)
    .sort((left, right) => left.localeCompare(right))[0];

export const createImportedGamePayload = (game: Game): CreateSupabaseGamePayload => {
  const endedAt = getPersistedGameEndedAt(game);

  return {
    id: game.id,
    created_at: normalizeRequiredTimestamp(game.createdAt, getNowIso()),
    started_at: normalizeRequiredTimestamp(game.startedAt, normalizeRequiredTimestamp(game.createdAt, getNowIso())),
    ended_at: normalizeOptionalTimestamp(endedAt),
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
    winner_player: endedAt ? getWinnerPlayerSlot(game) : null,
    stats_eligibility_mode: serializeStatsEligibilityMode(game.statsEligibilityMode),
    stats_eligibility_overrides: serializeStatsEligibilityOverrides(game.statsEligibilityOverrides),
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
  };
};

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

export const createSyncedGamePayload = (game: Game): CreateSupabaseGamePayload => {
  const endedAt = getPersistedGameEndedAt(game);

  return {
    id: game.id,
    created_at: normalizeRequiredTimestamp(game.createdAt, getNowIso()),
    started_at: normalizeRequiredTimestamp(game.startedAt, normalizeRequiredTimestamp(game.createdAt, getNowIso())),
    ended_at: normalizeOptionalTimestamp(endedAt),
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
    winner_player: endedAt ? getWinnerPlayerSlot(game) : null,
    stats_eligibility_mode: serializeStatsEligibilityMode(game.statsEligibilityMode),
    stats_eligibility_overrides: serializeStatsEligibilityOverrides(game.statsEligibilityOverrides),
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
  };
};

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
  const pageSize = 100;
  const events: SupabaseEventRecord[] = [];

  for (let page = 0; ; page += 1) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .in("game_id", gameIds)
      .order("occurred_at", { ascending: true })
      .order("created_at", { ascending: true })
      // Eindeutiger Tiebreaker: Ohne ihn ist die Reihenfolge bei gleichem Zeitstempel nicht stabil, und das
      // Seiten-Laden (range) übersprang bzw. verdoppelte Events an Seitengrenzen (abhängig von der Gesamtzahl).
      .order("id", { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(`Events konnten nicht geladen werden: ${error.message}`);
    }

    const pageEvents = (data ?? []) as SupabaseEventRecord[];
    events.push(...pageEvents);

    if (import.meta.env.DEV) {
      console.debug("[supabase-events] fetched page", {
        gameCount: gameIds.length,
        page,
        pageSize: pageEvents.length,
        total: events.length
      });
    }

    if (pageEvents.length < pageSize) {
      break;
    }
  }

  return events;
};

export class SyncRpcError extends Error {
  constructor(message: string, readonly conflict: SyncConflictInfo | null, readonly status?: number) {
    super(message);
    this.name = "SyncRpcError";
  }
}

const runSyncRpc = async (fn: string, args: Record<string, unknown>, canWrite: () => boolean, label: string): Promise<SyncRpcResult> => {
  const { data, error } = await getSupabaseClient().rpc<SyncRpcResult>(fn, args, canWrite);
  if (error) {
    throw new SyncRpcError(`${label}: ${error.message}`, parseSyncConflict(error), error.status);
  }
  return data ?? { matched: false };
};

// Schreibweg ab Schema 2 (supabase/migrations/20261012_01_sync_absicherung.sql).
export const syncRepository = {
  saveGame(game: Game, expectedVersion: number, canWrite: () => boolean = () => true): Promise<SyncRpcResult> {
    return runSyncRpc("mt_save_game", { p_game: createSyncedGamePayload(game), p_expected_version: expectedVersion },
      canWrite, "Spiel konnte nicht gespeichert werden");
  },
  putEvent(payload: CreateSupabaseEventPayload, expectedFlowVersion: number, queuedMs: number,
    canWrite: () => boolean = () => true): Promise<SyncRpcResult> {
    return runSyncRpc("mt_put_event", { p_event: payload, p_expected_flow: expectedFlowVersion, p_queued_ms: queuedMs },
      canWrite, "Event konnte nicht gespeichert werden");
  },
  revokeEvent(gameId: string, eventId: string, expectedFlowVersion: number,
    canWrite: () => boolean = () => true): Promise<SyncRpcResult> {
    return runSyncRpc("mt_revoke_event", { p_game_id: gameId, p_event_id: eventId, p_expected_flow: expectedFlowVersion },
      canWrite, "Event konnte nicht zurückgenommen werden");
  },
  async deleteGame(gameId: string, canWrite: () => boolean = () => true): Promise<SyncRpcResult> {
    const gameRecord = await fetchGameRecordById(gameId);
    if (!gameRecord || isSupabaseGameDeleted(gameRecord)) {
      return { matched: true, noop: true };
    }
    return runSyncRpc("mt_delete_game", { p_game_id: gameId,
      p_notes: serializeSoftDeletedNotes(gameRecord.notes, getNowIso()) }, canWrite, "Spiel konnte nicht gelöscht werden");
  },
  async getSchemaInfo(): Promise<{ schema_version: number; min_app_schema: number } | null> {
    const { data, error } = await getSupabaseClient().rpc<{ schema_version: number; min_app_schema: number }>(
      "mt_schema_info", {});
    return error ? null : data;
  }
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
      .eq("id", gameId);

    if (error) {
      throw new Error(`Spiel konnte nicht geladen werden: ${error.message}`);
    }

    const rows = Array.isArray(data) ? data : data ? [data] : [];
    const gameRecord = (rows[0] as SupabaseGameRecord | undefined) ?? null;
    if (!gameRecord) {
      throw new Error("Spiel konnte nicht geladen werden: Spiel nicht gefunden.");
    }

    if (isSupabaseGameDeleted(gameRecord)) {
      throw new Error("Spiel wurde gelöscht.");
    }

    const events = await fetchEventsForGameIds([gameId]);
    return mapSupabaseGameToAppGame(gameRecord, events);
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

    if (
      error &&
      (
        hasMissingScenarioColumnError(error.message) ||
        hasMissingTimerCorrectionsColumnError(error.message) ||
        hasMissingStatsEligibilityColumnError(error.message)
      )
    ) {
      ({ data, error } = await supabase
        .from("games")
        .insert(stripOptionalGameFields(insertPayload, hasMissingTimerCorrectionsColumnError(error.message)))
        .select("*")
        .single());
    }

    if (error && hasMissingTimerCorrectionsColumnError(error.message)) {
      ({ data, error } = await supabase.from("games").insert(stripOptionalGameFields(insertPayload, true)).select("*").single());
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

    if (
      error &&
      (
        hasMissingScenarioColumnError(error.message) ||
        hasMissingTimerCorrectionsColumnError(error.message) ||
        hasMissingStatsEligibilityColumnError(error.message)
      )
    ) {
      ({ data, error } = await supabase
        .from("games")
        .update(stripOptionalGameFields(updatePayload, hasMissingTimerCorrectionsColumnError(error.message)))
        .eq("id", gameId)
        .select("*")
        .single());
    }

    if (error && hasMissingTimerCorrectionsColumnError(error.message)) {
      ({ data, error } = await supabase.from("games").update(stripOptionalGameFields(updatePayload, true)).eq("id", gameId).select("*").single());
    }

    if (error) {
      throw new Error(`Spiel konnte nicht aktualisiert werden: ${error.message}`);
    }

    const events = await fetchEventsForGameIds([gameId]);
    return mapSupabaseGameToAppGame(data as SupabaseGameRecord, events);
  },

  async upsertGameSnapshot(game: Game, canWrite: () => boolean = () => true): Promise<Game> {
    if (!(await hasRemoteGameSnapshotChanged(game))) {
      return game;
    }

    const supabase = getSupabaseClient();
    const upsertPayload = createSyncedGamePayload(game);
    let { data, error } = await supabase
      .from("games").guardWrite(canWrite)
      .upsert(upsertPayload, {
        onConflict: "id"
      })
      .select("*")
      .single();

    if (
      error &&
      (
        hasMissingScenarioColumnError(error.message) ||
        hasMissingTimerCorrectionsColumnError(error.message) ||
        hasMissingStatsEligibilityColumnError(error.message)
      )
    ) {
      ({ data, error } = await supabase
        .from("games").guardWrite(canWrite)
        .upsert(stripOptionalGameFields(upsertPayload, hasMissingTimerCorrectionsColumnError(error.message)), {
          onConflict: "id"
        })
        .select("*")
        .single());
    }

    if (error && hasMissingTimerCorrectionsColumnError(error.message)) {
      ({ data, error } = await supabase.from("games").guardWrite(canWrite).upsert(stripOptionalGameFields(upsertPayload, true), { onConflict: "id" }).select("*").single());
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

    if (
      error &&
      (
        hasMissingScenarioColumnError(error.message) ||
        hasMissingTimerCorrectionsColumnError(error.message) ||
        hasMissingStatsEligibilityColumnError(error.message)
      )
    ) {
      ({ error } = await supabase.from("games").upsert(stripOptionalGameFields(upsertPayload, hasMissingTimerCorrectionsColumnError(error.message)), {
        onConflict: "id"
      }));
    }

    if (error && hasMissingTimerCorrectionsColumnError(error.message)) {
      ({ error } = await supabase.from("games").upsert(stripOptionalGameFields(upsertPayload, true), { onConflict: "id" }));
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

  async deleteGame(gameId: string, canWrite: () => boolean = () => true): Promise<void> {
    const supabase = getSupabaseClient();
    const { data, error: loadError } = await supabase
      .from("games").guardWrite(canWrite)
      .select("*")
      .eq("id", gameId);

    if (loadError) {
      throw new Error(`Spiel konnte nicht geladen werden: ${loadError.message}`);
    }

    const rows = Array.isArray(data) ? data : data ? [data] : [];
    const gameRecord = (rows[0] as SupabaseGameRecord | undefined) ?? null;
    if (!gameRecord || isSupabaseGameDeleted(gameRecord)) {
      return;
    }

    const deletedAt = getNowIso();
    const softDeletePayload: UpdateSupabaseGamePayload = {
      deleted_at: deletedAt,
      notes: serializeSoftDeletedNotes(gameRecord.notes, deletedAt)
    };

    let { error } = await supabase.from("games").guardWrite(canWrite).update(softDeletePayload).eq("id", gameId);

    if (error && hasMissingDeletedAtColumnError(error.message)) {
      ({ error } = await supabase
        .from("games").guardWrite(canWrite)
        .update({
          notes: softDeletePayload.notes
        })
        .eq("id", gameId));
    }

    if (error) {
      throw new Error(`Spiel konnte nicht gelöscht werden: ${error.message}`);
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

  async upsertEvent(payload: CreateSupabaseEventPayload, canWrite: () => boolean = () => true): Promise<SupabaseEventRecord> {
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
      .from("events").guardWrite(canWrite)
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

  async deleteEvent(eventId: string, canWrite: () => boolean = () => true): Promise<void> {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("events").guardWrite(canWrite).delete().eq("id", eventId);

    if (error) {
      throw new Error(`Event konnte nicht gelöscht werden: ${error.message}`);
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
