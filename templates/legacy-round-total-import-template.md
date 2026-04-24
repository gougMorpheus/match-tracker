# Legacy Round-Total Import

Datei: [legacy-round-total-import-template.json](/C:/user/tim/codex/match-tracker/templates/legacy-round-total-import-template.json)

Diese Vorlage ist fuer alte Spiele gedacht, bei denen der Score pro Runde bekannt ist, aber keine saubere Trennung zwischen `Primary` und `Secondary`.

Wofuer sie geeignet ist:
- Spielername
- Armee
- Detachment
- Datum / Uhrzeit
- Spielpunkte
- Defender / Startspieler
- Gesamtpunkte je Spieler
- Rundengesamtscore je Spieler

Wofuer sie nicht gedacht ist:
- genaue `Primary` / `Secondary` Trennung
- Runden- oder Zugzeiten
- CP-Verlauf
- Score-Verlauf pro Zug

## Regeln fuer das LLM

- Gib **valide JSON** zurueck.
- Lasse die Feldnamen **exakt** wie in der Vorlage.
- Verwende bei `players` immer genau diese IDs:
  - `player-1`
  - `player-2`
- Verwende dieselben IDs auch in `legacyScoreTotals` und `scoreEvents.playerId`.
- Setze `scoreDetailLevel` immer auf `"total-only"`.
- Verwende fuer Rundenscores in `scoreEvents` immer:
  - `"type": "score"`
  - `"scoreType": "legacy-total"`
- Lege pro erkannter Spieler-Runde ein eigenes Event an.
- Wenn die Reihenfolge innerhalb einer Runde unklar ist, nutze einfach sinnvolle aufsteigende Zeitstempel.
- `roundNumber` setzen, `turnNumber` weglassen oder leer lassen, wenn nicht sicher bekannt.
- Lasse `commandPointEvents`, `noteEvents` und `timeEvents` leer, wenn dazu keine sicheren Daten vorliegen.
- Wenn `deployment` oder `primaryMission` unbekannt sind, setze `""`.
- Wenn `startedAt` oder `endedAt` unbekannt sind, setze `""`.
- Wenn `defenderPlayerId`, `startingPlayerId` oder `currentPlayerId` unbekannt sind:
  - verwende `player-1` als Default.
- Setze `army.detachment` auf den echten Detachment-Namen oder `""`, wenn unbekannt.
- `legacyScoreTotals` soll die Endsumme enthalten, auch wenn die Rundenscores ebenfalls vorhanden sind.

## Minimalbeispiel

```json
{
  "games": [
    {
      "id": "legacy-game-rounds-001",
      "createdAt": "2026-04-24T18:00:00.000Z",
      "updatedAt": "2026-04-24T18:00:00.000Z",
      "status": "completed",
      "scoreDetailLevel": "total-only",
      "gamePoints": 1000,
      "scheduledDate": "2026-04-24",
      "scheduledTime": "19:30",
      "deployment": "",
      "primaryMission": "",
      "defenderPlayerId": "player-1",
      "startingPlayerId": "player-1",
      "currentPlayerId": "player-1",
      "startedAt": "",
      "endedAt": "",
      "players": [
        {
          "id": "player-1",
          "name": "Alice",
          "army": {
            "name": "Necrons",
            "maxPoints": 1000,
            "detachment": "Awakened Dynasty"
          }
        },
        {
          "id": "player-2",
          "name": "Bob",
          "army": {
            "name": "Astra Militarum",
            "maxPoints": 1000,
            "detachment": ""
          }
        }
      ],
      "rounds": [],
      "scoreEvents": [
        {
          "id": "legacy-score-1",
          "type": "score",
          "playerId": "player-1",
          "scoreType": "legacy-total",
          "value": 10,
          "roundNumber": 1,
          "createdAt": "2026-04-24T18:30:00.000Z"
        },
        {
          "id": "legacy-score-2",
          "type": "score",
          "playerId": "player-2",
          "scoreType": "legacy-total",
          "value": 5,
          "roundNumber": 1,
          "createdAt": "2026-04-24T18:31:00.000Z"
        }
      ],
      "commandPointEvents": [],
      "noteEvents": [],
      "timeEvents": [],
      "timerCorrections": {
        "totalMs": 0,
        "rounds": {},
        "turns": {}
      },
      "legacyScoreTotals": {
        "player-1": 78,
        "player-2": 64
      }
    }
  ]
}
```
