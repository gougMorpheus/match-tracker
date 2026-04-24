export type PlayerId = string;
export type GameStatus = "active" | "completed";
export type ScoreType = "primary" | "secondary" | "legacy-total";
export type CommandPointType = "gained" | "spent";
export type ScoreDetailLevel = "full" | "total-only" | "none";
export type TimeEventAction =
  | "session-start"
  | "session-end"
  | "game-start"
  | "game-end"
  | "round-start"
  | "round-end"
  | "turn-start"
  | "turn-end"
  | "turn-pause"
  | "turn-resume";
export type GameResult = "win" | "loss" | "tie";

export interface Army {
  name: string;
  maxPoints: number;
  detachment: string;
}

export interface Player {
  id: PlayerId;
  name: string;
  army: Army;
}

export interface TurnPauseWindow {
  startedAt: string;
  endedAt?: string;
}

export interface TurnTiming {
  startedAt?: string;
  endedAt?: string;
  pauses: TurnPauseWindow[];
}

export interface Turn {
  id: string;
  roundNumber: number;
  turnNumber: number;
  playerId: PlayerId;
  timing: TurnTiming;
}

export interface TurnRef {
  roundNumber: number;
  turnNumber: number;
}

export interface Round {
  id: string;
  roundNumber: number;
  startedAt?: string;
  endedAt?: string;
  turns: Turn[];
}

export interface EventBase {
  id: string;
  playerId: PlayerId;
  roundNumber?: number;
  turnNumber?: number;
  createdAt: string;
  note?: string;
}

export interface ScoreEvent extends EventBase {
  type: "score";
  scoreType: ScoreType;
  value: number;
}

export interface CommandPointEvent extends EventBase {
  type: "command-point";
  cpType: CommandPointType;
  value: number;
}

export interface NoteEvent extends EventBase {
  type: "note";
  note: string;
}

export interface TimeEvent {
  id: string;
  type: "time";
  action: TimeEventAction;
  playerId?: PlayerId;
  roundNumber?: number;
  turnNumber?: number;
  createdAt: string;
}

export interface TimerCorrections {
  totalMs: number;
  rounds: Record<string, number>;
  turns: Record<string, number>;
}

export interface Game {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: GameStatus;
  scoreDetailLevel: ScoreDetailLevel;
  gamePoints: number;
  scheduledDate: string;
  scheduledTime: string;
  deployment: string;
  primaryMission: string;
  defenderPlayerId: PlayerId;
  startingPlayerId: PlayerId;
  currentPlayerId: PlayerId;
  startedAt?: string;
  endedAt?: string;
  players: [Player, Player];
  rounds: Round[];
  scoreEvents: ScoreEvent[];
  commandPointEvents: CommandPointEvent[];
  noteEvents: NoteEvent[];
  timeEvents: TimeEvent[];
  timerCorrections: TimerCorrections;
  legacyScoreTotals: Record<string, number>;
}

export interface GameSummaryPlayer {
  playerId: PlayerId;
  name: string;
  armyName: string;
  primaryScore: number | null;
  secondaryScore: number | null;
  totalScore: number | null;
  commandPointsGained: number | null;
  commandPointsSpent: number | null;
  commandPointBalance: number | null;
  result: GameResult | null;
}

export interface GameSummary {
  gameId: string;
  status: GameStatus;
  scheduledDate: string;
  scheduledTime: string;
  totalDurationMs: number | null;
  roundCount: number;
  players: [GameSummaryPlayer, GameSummaryPlayer];
}

export interface CreateGameInput {
  playerOneName: string;
  playerOneArmy: string;
  playerOneDetachment: string;
  playerTwoName: string;
  playerTwoArmy: string;
  playerTwoDetachment: string;
  gamePoints: number;
  scheduledDate: string;
  scheduledTime: string;
  deployment: string;
  primaryMission: string;
  defenderSlot: "player1" | "player2";
  startingSlot: "player1" | "player2";
}

export interface GameImportPayload {
  games: Game[];
}
