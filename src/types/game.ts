export type PlayerId = string;
export type GameStatus = "active" | "completed";
export type ScoreType = "primary" | "secondary";
export type CommandPointType = "gained" | "spent";
export type TimeEventAction =
  | "game-start"
  | "game-end"
  | "round-start"
  | "round-end"
  | "turn-start"
  | "turn-end";
export type GameResult = "win" | "loss" | "tie";

export interface Army {
  name: string;
  maxPoints: number;
}

export interface Player {
  id: PlayerId;
  name: string;
  army: Army;
}

export interface TurnTiming {
  startedAt?: string;
  endedAt?: string;
}

export interface Turn {
  id: string;
  roundNumber: number;
  turnNumber: number;
  playerId: PlayerId;
  timing: TurnTiming;
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

export interface Game {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: GameStatus;
  gamePoints: number;
  scheduledDate: string;
  scheduledTime: string;
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
}

export interface GameSummaryPlayer {
  playerId: PlayerId;
  name: string;
  armyName: string;
  primaryScore: number;
  secondaryScore: number;
  totalScore: number;
  commandPointsGained: number;
  commandPointsSpent: number;
  commandPointBalance: number;
  result: GameResult;
}

export interface GameSummary {
  gameId: string;
  status: GameStatus;
  scheduledDate: string;
  scheduledTime: string;
  totalDurationMs: number;
  roundCount: number;
  players: [GameSummaryPlayer, GameSummaryPlayer];
}

export interface CreateGameInput {
  playerOneName: string;
  playerOneArmy: string;
  playerTwoName: string;
  playerTwoArmy: string;
  gamePoints: number;
  scheduledDate: string;
  scheduledTime: string;
  defenderSlot: "player1" | "player2";
  startingSlot: "player1" | "player2";
}

export interface GameImportPayload {
  games: Game[];
}
