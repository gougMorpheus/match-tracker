import type {
  CommandPointEvent,
  CreateGameInput,
  Game,
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
import { createId } from "../utils/id";
import { getPlayerTotalScore } from "../utils/gameCalculations";
import { getNowIso, toLocalDateInput, toLocalTimeInput } from "../utils/time";

export type SupabaseGameRecord = Database["public"]["Tables"]["games"]["Row"];
export type SupabaseEventRecord = Database["public"]["Tables"]["events"]["Row"];
export type CreateSupabaseGamePayload = Database["public"]["Tables"]["games"]["Insert"];
export type UpdateSupabaseGamePayload = Database["public"]["Tables"]["games"]["Update"];
export type CreateSupabaseEventPayload = Database["public"]["Tables"]["events"]["Insert"];
export type UpdateSupabaseEventPayload = Database["public"]["Tables"]["events"]["Update"];

const scoreTypeByEventType = {
  "score-primary": "primary",
  "score-secondary": "secondary"
} as const;

const cpTypeByEventType = {
  "cp-gained": "gained",
  "cp-spent": "spent"
} as const;

const timeActions = new Set<TimeEventAction>([
  "session-start",
  "session-end",
  "game-start",
  "game-end",
  "round-start",
  "round-end",
  "turn-start",
  "turn-end",
  "turn-pause",
  "turn-resume"
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

const hasMissingScenarioColumnError = (message: string): boolean => {
  const normalizedMessage = message.toLowerCase();
  return (
    normalizedMessage.includes("deployment") ||
    normalizedMessage.includes("primary_mission")
  );
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

  sortEventRecords(
    timeEvents.map((event) => ({
      id: event.id,
      created_at: event.createdAt,
      game_id: gameId,
      round_number: event.roundNumber ?? null,
      turn_number: event.turnNumber ?? null,
      player_slot: event.playerId?.endsWith("player-2") ? 2 : 1,
      event_type: event.action,
      value_number: null,
      note: null,
      occurred_at: event.createdAt
    }))
  ).forEach((event) => {
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
      const latestPause = turn.timing.pauses[turn.timing.pauses.length - 1];
      if (latestPause && !latestPause.endedAt) {
        latestPause.endedAt = event.occurred_at;
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
  if (endedAt) {
    return startingPlayerId;
  }

  const latestRound = rounds[rounds.length - 1];
  const latestTurn = latestRound?.turns[latestRound.turns.length - 1];
  if (!latestTurn) {
    return startingPlayerId;
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

  sortEventRecords(events).forEach((event) => {
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
        event.event_type === "turn-resume";

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
  const startingPlayerId = getPlayerIdFromSlot(row.id, row.starting_player ?? 1);
  const defenderPlayerId = getPlayerIdFromSlot(row.id, row.defender_player ?? 1);
  const startedAt = getDerivedStartedAt(row, mappedEvents.timeEvents);
  const endedAt = getDerivedEndedAt(row, mappedEvents.timeEvents);

  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: getUpdatedAt(row, events),
    status: endedAt ? "completed" : "active",
    gamePoints: row.player1_max_points,
    scheduledDate: date,
    scheduledTime: time,
    deployment: row.deployment ?? "",
    primaryMission: row.primary_mission ?? "",
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
          maxPoints: row.player1_max_points
        }
      },
      {
        id: playerTwoId,
        name: row.player2_name,
        army: {
          name: row.player2_army,
          maxPoints: row.player2_max_points
        }
      }
    ],
    rounds,
    scoreEvents: mappedEvents.scoreEvents,
    commandPointEvents: mappedEvents.commandPointEvents,
    noteEvents: mappedEvents.noteEvents,
    timeEvents: mappedEvents.timeEvents
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
  defender_player: payload.defenderSlot === "player1" ? 1 : 2,
  starting_player: payload.startingSlot === "player1" ? 1 : 2,
  started_at: getNowIso(),
  ended_at: null,
  winner_player: null,
  notes: null
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
  defender_player: payload.defenderSlot === "player1" ? 1 : 2,
  starting_player: payload.startingSlot === "player1" ? 1 : 2
});

const getWinnerPlayerSlot = (game: Game): 1 | 2 | null => {
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
  created_at: game.createdAt,
  started_at: game.startedAt ?? game.createdAt,
  ended_at: game.endedAt ?? null,
  game_date: combineScheduledDateTime(game.scheduledDate, game.scheduledTime),
  player1_name: game.players[0].name,
  player1_army: game.players[0].army.name,
  player1_max_points: game.gamePoints ?? game.players[0].army.maxPoints,
  player2_name: game.players[1].name,
  player2_army: game.players[1].army.name,
  player2_max_points: game.gamePoints ?? game.players[1].army.maxPoints,
  deployment: game.deployment || null,
  primary_mission: game.primaryMission || null,
  defender_player: game.defenderPlayerId === game.players[0].id ? 1 : 2,
  starting_player: game.startingPlayerId === game.players[0].id ? 1 : 2,
  winner_player: getWinnerPlayerSlot(game),
  notes: null
});

export const createImportedEventPayloads = (persistedGame: Game, importedGame: Game): CreateSupabaseEventPayload[] => {
  const importedPlayerOneId = importedGame.players[0].id;
  const toPlayerSlot = (playerId?: PlayerId): 1 | 2 =>
    !playerId || playerId === importedPlayerOneId ? 1 : 2;

  const payloads: CreateSupabaseEventPayload[] = [];

  importedGame.timeEvents.forEach((event) => {
    payloads.push({
      id: event.id,
      created_at: event.createdAt,
      game_id: persistedGame.id,
      round_number: event.roundNumber ?? null,
      turn_number: event.turnNumber ?? null,
      player_slot: toPlayerSlot(event.playerId),
      event_type: event.action,
      occurred_at: event.createdAt
    });
  });

  importedGame.commandPointEvents.forEach((event) => {
    payloads.push({
      id: event.id,
      created_at: event.createdAt,
      game_id: persistedGame.id,
      round_number: event.roundNumber ?? null,
      turn_number: event.turnNumber ?? null,
      player_slot: toPlayerSlot(event.playerId),
      event_type: event.cpType === "gained" ? "cp-gained" : "cp-spent",
      value_number: event.value,
      note: event.note ?? null,
      occurred_at: event.createdAt
    });
  });

  importedGame.scoreEvents.forEach((event) => {
    payloads.push({
      id: event.id,
      created_at: event.createdAt,
      game_id: persistedGame.id,
      round_number: event.roundNumber ?? null,
      turn_number: event.turnNumber ?? null,
      player_slot: toPlayerSlot(event.playerId),
      event_type: event.scoreType === "primary" ? "score-primary" : "score-secondary",
      value_number: event.value,
      note: event.note ?? null,
      occurred_at: event.createdAt
    });
  });

  importedGame.noteEvents.forEach((event) => {
    payloads.push({
      id: event.id,
      created_at: event.createdAt,
      game_id: persistedGame.id,
      round_number: event.roundNumber ?? null,
      turn_number: event.turnNumber ?? null,
      player_slot: toPlayerSlot(event.playerId),
      event_type: "note",
      note: event.note,
      occurred_at: event.createdAt
    });
  });

  return payloads;
};

export const createSyncedGamePayload = (game: Game): CreateSupabaseGamePayload => ({
  id: game.id,
  created_at: game.createdAt,
  started_at: game.startedAt ?? game.createdAt,
  ended_at: game.endedAt ?? null,
  game_date: combineScheduledDateTime(game.scheduledDate, game.scheduledTime),
  player1_name: game.players[0].name,
  player1_army: game.players[0].army.name,
  player1_max_points: game.gamePoints,
  player2_name: game.players[1].name,
  player2_army: game.players[1].army.name,
  player2_max_points: game.gamePoints,
  deployment: game.deployment || null,
  primary_mission: game.primaryMission || null,
  defender_player: game.defenderPlayerId === game.players[0].id ? 1 : 2,
  starting_player: game.startingPlayerId === game.players[0].id ? 1 : 2,
  winner_player: game.endedAt ? getWinnerPlayerSlot(game) : null,
  notes: null
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
        event_type: event.scoreType === "primary" ? "score-primary" : "score-secondary",
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

    const games = (data ?? []) as SupabaseGameRecord[];
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

    if (error && hasMissingScenarioColumnError(error.message)) {
      ({ data, error } = await supabase
        .from("games")
        .insert(stripOptionalScenarioFields(insertPayload))
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

    if (error && hasMissingScenarioColumnError(error.message)) {
      ({ data, error } = await supabase
        .from("games")
        .update(stripOptionalScenarioFields(updatePayload))
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
    const supabase = getSupabaseClient();
    const upsertPayload = createSyncedGamePayload(game);
    let { data, error } = await supabase
      .from("games")
      .upsert(upsertPayload, {
        onConflict: "id"
      })
      .select("*")
      .single();

    if (error && hasMissingScenarioColumnError(error.message)) {
      ({ data, error } = await supabase
        .from("games")
        .upsert(stripOptionalScenarioFields(upsertPayload), {
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
    const supabase = getSupabaseClient();
    const upsertPayload = createSyncedGamePayload(game);
    let { error } = await supabase.from("games").upsert(upsertPayload, {
      onConflict: "id"
    });

    if (error && hasMissingScenarioColumnError(error.message)) {
      ({ error } = await supabase.from("games").upsert(stripOptionalScenarioFields(upsertPayload), {
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
    const { error } = await supabase.from("games").delete().eq("id", gameId);

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
