# Game Scoring and Stats Overview

Kurzfassung: Ein Zug oder eine Runde wird für die statistische Auswertung nur dann gewertet, wenn die Daten dafür belastbar sind. Für neue Vollspiele heißt das: Ein Zug muss mindestens 1 Minute dauern und in diesem Zug muss `CP gained` vorkommen. Fehlt eines davon, wird der Zug wie "nicht stattgefunden" behandelt. Eine Runde zählt nur dann, wenn sie mindestens einen gewerteten Zug enthält. Legacy-Spiele bleiben grundsätzlich in den Statistiken enthalten, aber nur dort, wo ihre gespeicherten Werte dafür ausreichen.

## Verhalten

- Spiele mit `finishReason = "interrupted"` oder `finishReason = "abandoned"` werden komplett aus den Statistiken entfernt.
- Vollspiele (`scoreDetailLevel === "full"`) werden auf Zug-Ebene gefiltert.
- Ein Zug zählt nur, wenn er mindestens 60 Sekunden lang ist und in diesem Zug mindestens ein `CP gained` existiert.
- Züge unter 1 Minute zählen nicht.
- Züge ohne `CP gained` zählen nicht.
- Eine Runde zählt nur, wenn nach dem Zug-Filter noch mindestens ein gewerteter Zug in der Runde übrig bleibt.
- Runden ohne gewerteten Zug tauchen in Rundenzählung, Rundenzeiten und Zug-basierten Statistiken nicht auf.
- Legacy-Spiele (`scoreDetailLevel === "total-only"` oder `"none"`) bleiben in der Statistik grundsätzlich drin, werden aber nicht für Metriken verwendet, die Zug-, Runden- oder detaillierte Timing-Daten brauchen.
- Primär- und Sekundärwerte tauchen nur bei Vollspielen auf.
- Gesamtwerte und Win/Loss/Tie-Auswertungen können auch Legacy-Spiele nutzen, wenn dort ein Gesamtwert vorhanden ist.
- Durchschnittliche Spielzeit basiert auf der echten sichtbaren Spielzeit, also Setup + Runden + Züge + Korrekturen, nicht auf dem versteckten Session-Timer.
- Durchschnittliche Rundenzeit und Zugzeit tauchen nur auf, wenn vollständige Timing-Daten vorhanden sind.
- CP-Statistiken tauchen nur auf, wenn echte CP-Einträge vorhanden sind; für Durchschnittswerte werden sie aktuell nur mit Vollspielen berechnet.

## Welche Werte wann auftauchen

- `Primary` / `Secondary`
  - tauchen nur bei Vollspielen auf
  - tauchen nicht bei Legacy-Spielen auf
- `Gesamtwert`
  - taucht bei Vollspielen auf
  - taucht bei Legacy-`total-only`-Spielen auf, wenn Gesamtscore-Daten vorhanden sind
  - taucht nicht bei `none`
- `Winrate`, `Wins`, `Losses`, `Ties`
  - werden aus Spielen gebildet, bei denen ein Gesamtwert vergleichbar ist
  - Legacy-`total-only`-Spiele können dazugehören
  - Spiele ohne belastbaren Gesamtwert tauchen nicht auf
- `Gesamtzeit`
  - taucht nur bei Vollspielen mit vollständigen Timing-Daten auf
  - wird aus Setup/Runden/Zügen berechnet
- `Rundenzahl`
  - taucht bei Vollspielen nur mit gewerteten Runden auf
  - Legacy-Spiele behalten ihre gespeicherten Runden, sofern vorhanden
- `Rundenzeit` / `Zugzeit`
  - tauchen nur bei Vollspielen mit vollständigen Timing-Daten auf
  - nicht bei Legacy
- `CP`
  - taucht nur auf, wenn CP-Daten vorhanden sind
  - in Durchschnittswerten aktuell nur für Vollspiele
- Szenario-Auswertungen wie Mission / Deployment
  - folgen der gleichen Grundlogik wie Gesamtwerte
  - Zeiten dazu tauchen nur bei Vollspielen auf

## Technische Umsetzung

- Der Kern liegt in `src/utils/gameCalculations.ts`.
- `prepareGameForStats(game)` entfernt:
  - unterbrochene und abgebrochene Spiele komplett
  - bei Vollspielen die ungewerteten Züge, Runden und abhängigen Events
  - bei Legacy-Spielen keine Daten, die für Totals noch brauchbar sind
- `getCountedRounds(game)` liefert für Vollspiele nur Runden mit mindestens einem gewerteten Zug.
- `isStatsEligibleTurn(game, turn)` ist die Regel für einen gewerteten Zug:
  - Dauer mindestens 60 Sekunden
  - `CP gained` im Zug vorhanden
- `hasDetailedScoreData(game)` bedeutet: Vollspiel.
- `hasComparableTotalScoreData(game)` bedeutet: Gesamtwerte sind auswertbar, auch bei Legacy-`total-only`.
- `getPlayerComparablePrimaryScore` und `getPlayerComparableSecondaryScore` liefern nur bei Vollspielen Werte.
- `getPlayerComparableTotalScore` liefert Vollspiel- und Legacy-Total-Werte, sofern verfügbar.
- `hasDetailedTimingStats(game)` stellt sicher, dass Timing-Metriken nur bei Vollspielen mit echten Timing-Daten berechnet werden.
- `getGameDurationMs(game)` ist die sichtbare Spielzeit und nicht der Session-Timer.
- `createStatsOverview(...)` und die Aggregationsfunktionen verwenden die vorbereiteten Spiele und/oder eine separate Timing-Quelle, wenn für Zeitwerte das Originalspiel gebraucht wird.
- `src/pages/StatsPage.tsx` filtert zunächst die sichtbaren Spiele und gibt sie dann an `prepareGamesForStats(...)` weiter.

## Wie man das Verhalten sicher anpasst

- Wenn ein neuer Wert auf Zug-, Runden- oder Timing-Daten basiert, sollte er Vollspiele voraussetzen.
- Wenn ein neuer Wert nur auf Gesamtpunkten basiert, kann er Legacy-`total-only`-Spiele mitverwenden.
- Wenn ein Wert in Statistiken auftauchen soll, aber Legacy-Spiele keine Daten dafür haben, dann muss die Funktion die Legacy-Fälle explizit auf `null` oder leer setzen.
- Für neue Zeitmetriken immer `getGameDurationMs(game)` prüfen, nicht den Session-Timer, wenn die Anzeige die reale Spielzeit spiegeln soll.
- Für Zug- und Rundenmetriken immer zuerst `prepareGameForStats(...)` und `getCountedRounds(...)` mitdenken.
- Für Undo/Redo, Import und Sync darauf achten, dass die Statistikregeln aus `gameCalculations.ts` nicht lokal dupliziert werden.
- Bei neuen Tests immer mindestens diese Fälle abdecken:
  - Vollspiel mit gewertetem Zug
  - Vollspiel mit zu kurzem Zug
  - Vollspiel ohne `CP gained`
  - Legacy-`total-only`-Spiel
  - `interrupted` / `abandoned` Spiel

