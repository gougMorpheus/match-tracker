# Legacy Total-Only Import

Datei: [legacy-total-only-import-template.json](/C:/user/tim/codex/match-tracker/templates/legacy-total-only-import-template.json)

Diese Vorlage ist fuer alte Spiele gedacht, bei denen nur der Endstand bekannt ist.

Wofuer sie geeignet ist:
- Spielername
- Armee
- Detachment
- Datum / Uhrzeit
- Spielpunkte
- Defender / Startspieler
- Gesamtpunkte je Spieler

Wofuer sie nicht gedacht ist:
- genaue `Primary` / `Secondary` Trennung
- Runden- oder Zugzeiten
- CP-Verlauf
- Score-Verlauf pro Runde

## Regeln fuer das LLM

- Gib **valide JSON** zurueck.
- Lasse die Feldnamen **exakt** wie in der Vorlage.
- Verwende bei `players` immer genau diese IDs:
  - `player-1`
  - `player-2`
- Verwende dieselben IDs auch in `legacyScoreTotals`.
- Setze `army.detachment` auf den echten Detachment-Namen oder `""`, wenn unbekannt.
- Setze `scoreDetailLevel` immer auf `"total-only"`.
- Lasse `rounds`, `scoreEvents`, `commandPointEvents`, `noteEvents` und `timeEvents` leer, wenn dazu keine sicheren Daten vorliegen.
- Wenn `deployment` oder `primaryMission` unbekannt sind, setze `""`.
- Wenn `startedAt` oder `endedAt` unbekannt sind, setze `""`.
- Wenn `defenderPlayerId`, `startingPlayerId` oder `currentPlayerId` unbekannt sind:
  - verwende `player-1` als Default.

## Minimalbeispiel

```json
{
  "games": [
    {
      "id": "legacy-game-001",
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
      "scoreEvents": [],
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
