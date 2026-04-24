import type { Game } from "../types/game";
import { createId } from "../utils/id";

const createdAt = "2026-04-20T18:00:00.000Z";

export const seedGames: Game[] = [
  {
    id: createId("game"),
    createdAt,
    updatedAt: createdAt,
    status: "completed",
    gamePoints: 1000,
    scheduledDate: "2026-04-20",
    scheduledTime: "19:00",
    deployment: "Hammer and Anvil",
    primaryMission: "Take and Hold",
    defenderPlayerId: "player-1",
    startingPlayerId: "player-2",
    currentPlayerId: "player-1",
    startedAt: "2026-04-20T17:05:00.000Z",
    endedAt: "2026-04-20T20:10:00.000Z",
    players: [
      {
        id: "player-1",
        name: "Nora",
        army: {
          name: "Adepta Sororitas",
          maxPoints: 1000
        }
      },
      {
        id: "player-2",
        name: "Tim",
        army: {
          name: "Necrons",
          maxPoints: 1000
        }
      }
    ],
    rounds: [
      {
        id: createId("round"),
        roundNumber: 1,
        startedAt: "2026-04-20T17:05:00.000Z",
        endedAt: "2026-04-20T18:10:00.000Z",
        turns: [
          {
            id: createId("turn"),
            roundNumber: 1,
            turnNumber: 1,
            playerId: "player-2",
            timing: {
              startedAt: "2026-04-20T17:05:00.000Z",
              endedAt: "2026-04-20T17:28:00.000Z",
              pauses: []
            }
          },
          {
            id: createId("turn"),
            roundNumber: 1,
            turnNumber: 2,
            playerId: "player-1",
            timing: {
              startedAt: "2026-04-20T17:31:00.000Z",
              endedAt: "2026-04-20T18:10:00.000Z",
              pauses: []
            }
          }
        ]
      }
    ],
    scoreEvents: [
      {
        id: createId("score"),
        type: "score",
        playerId: "player-1",
        roundNumber: 1,
        turnNumber: 2,
        scoreType: "primary",
        value: 8,
        note: "Objective secured",
        createdAt: "2026-04-20T18:08:00.000Z"
      },
      {
        id: createId("score"),
        type: "score",
        playerId: "player-2",
        roundNumber: 1,
        turnNumber: 1,
        scoreType: "secondary",
        value: 5,
        note: "Cleanse",
        createdAt: "2026-04-20T17:25:00.000Z"
      }
    ],
    commandPointEvents: [
      {
        id: createId("cp"),
        type: "command-point",
        playerId: "player-1",
        roundNumber: 1,
        turnNumber: 2,
        cpType: "gained",
        value: 1,
        note: "Battle round gain",
        createdAt: "2026-04-20T17:31:00.000Z"
      },
      {
        id: createId("cp"),
        type: "command-point",
        playerId: "player-2",
        roundNumber: 1,
        turnNumber: 1,
        cpType: "spent",
        value: 2,
        note: "Overwatch",
        createdAt: "2026-04-20T17:15:00.000Z"
      }
    ],
    noteEvents: [
      {
        id: createId("note"),
        type: "note",
        playerId: "player-1",
        roundNumber: 1,
        turnNumber: 2,
        note: "Mission deck felt swingy.",
        createdAt: "2026-04-20T18:09:00.000Z"
      }
    ],
    timeEvents: [
      {
        id: createId("time"),
        type: "time",
        action: "game-start",
        createdAt: "2026-04-20T17:05:00.000Z"
      },
      {
        id: createId("time"),
        type: "time",
        action: "round-start",
        roundNumber: 1,
        createdAt: "2026-04-20T17:05:00.000Z"
      },
      {
        id: createId("time"),
        type: "time",
        action: "turn-start",
        roundNumber: 1,
        turnNumber: 1,
        playerId: "player-2",
        createdAt: "2026-04-20T17:05:00.000Z"
      },
      {
        id: createId("time"),
        type: "time",
        action: "turn-end",
        roundNumber: 1,
        turnNumber: 1,
        playerId: "player-2",
        createdAt: "2026-04-20T17:28:00.000Z"
      },
      {
        id: createId("time"),
        type: "time",
        action: "turn-start",
        roundNumber: 1,
        turnNumber: 2,
        playerId: "player-1",
        createdAt: "2026-04-20T17:31:00.000Z"
      },
      {
        id: createId("time"),
        type: "time",
        action: "turn-end",
        roundNumber: 1,
        turnNumber: 2,
        playerId: "player-1",
        createdAt: "2026-04-20T18:10:00.000Z"
      },
      {
        id: createId("time"),
        type: "time",
        action: "round-end",
        roundNumber: 1,
        createdAt: "2026-04-20T18:10:00.000Z"
      },
      {
        id: createId("time"),
        type: "time",
        action: "game-end",
        createdAt: "2026-04-20T20:10:00.000Z"
      }
    ]
  }
];
