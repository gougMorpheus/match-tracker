# Project Context

## Zweck der App

Match Tracker ist eine mobile-first Web-App zum Tracken von Warhammer- und Tabletop-Spielen fuer kleine Spielgruppen. Die App verwaltet Spiele, Spieler, Armeen, Mission/Deployment, Scores, Command Points, Notizen, Runden, Zuege, Timer, Time-outs, Undo/Redo, Statistik sowie JSON-Import/Export.

Supabase ist die Remote-Source-of-Truth. Die App arbeitet aber optimistisch mit lokalem Cache und Sync-Queue, damit Aktionen waehrend eines Spiels schnell bleiben und spaeter synchronisiert werden koennen.

## Tech-Stack

- Vite 5, React 18, TypeScript, React DOM.
- Kein UI-Framework; globale Styles liegen in `src/styles/index.css`.
- Routing passiert manuell ueber `window.location.hash` in `src/App.tsx`.
- Supabase-Zugriff laeuft ueber einen lokalen REST-Client in `src/lib/supabaseRestClient.ts` und die Konfiguration in `src/lib/supabase.ts`.
- Tests sind Node/CommonJS-Testdateien unter `tests/`. Vorher kompiliert TypeScript nach `.test-dist`.

## Wichtige Ordner

- `src/pages`: Seiten fuer Spieleliste, neues Spiel, Live-Spiel/Editieransicht und Statistik.
- `src/components`: Wiederverwendbare UI-Bausteine wie Layout, Scoreboards, Formfelder, Karten, Dialoge und Charts.
- `src/store`: Globaler React Context fuer App-State, Mutationen, Undo/Redo, Cache und Sync.
- `src/services`: Repository-Layer fuer Supabase-Mapping und Datenzugriff.
- `src/types`: Zentrale TypeScript-Domain-Modelle.
- `src/utils`: Pure Logik fuer Berechnungen, lokale State-Updates, Import/Export, Sync-Persistenz, Zeitformatierung, Presets und Sicherheitshelfer.
- `src/data`: Statische Daten wie Armee-Optionen und Seed-Spiele.
- `supabase`: Datenbankschema, RLS-Policies und Realtime-Publication.
- `tests`: Kleine Node-Test-Suites fuer Berechnungen, Timer-Fokus und Sicherheitsregeln.
- `templates`: JSON/Markdown-Importvorlagen fuer Legacy-Daten.

## Wichtige Dateien

- `src/main.tsx`: Rendert die React-App und umschliesst sie mit `GameStoreProvider`.
- `src/App.tsx`: Hash-Routing fuer `#/games`, `#/new`, `#/stats`, `#/game/:id` und `#/game/:id/overview`.
- `src/store/GameStore.tsx`: Zentrale Orchestrierung von Spielen, Mutationen, Optimistic Updates, Undo/Redo, localStorage-Cache und Supabase-Sync-Queue.
- `src/services/gamesRepository.ts`: Uebersetzt zwischen Supabase-Tabellen und App-Modell, baut Events/Payloads und kapselt CRUD gegen `games` und `events`.
- `src/types/game.ts`: Domain-Modell fuer `Game`, Spieler, Runden, Zuege, Score-/CP-/Note-/Time-Events, Timer-Korrekturen und Importpayloads.
- `src/utils/gameState.ts`: Lokale State-Transformationen; baut aus Time-Events Runden/Zuege und haelt abgeleitete Felder synchron.
- `src/utils/gameCalculations.ts`: Scores, CP, Timer-Dauern, Filter, Summaries und Statistik-Aggregate.
- `src/utils/localSync.ts`: localStorage-Keys, Cache-Load/Save und Sync-Queue-Items.
- `src/utils/importExport.ts`: JSON-Importvalidierung und Browser-Download fuer Exporte.
- `src/utils/gameSecurity.ts`: Aktuell ein hart codiertes Admin-Passwort fuer geschuetzte Spielaktionen.
- `supabase/schema.sql`: Tabellen `games` und `events`, Indizes, Constraints, RLS-Policies und Realtime-Publication.
- `package.json`: Lokale Skripte fuer Dev, Build, Preview, Typecheck und Tests.

## State, Logik und Datenzugriff

Der App-State liegt in `GameStoreProvider` (`src/store/GameStore.tsx`). Komponenten greifen ueber `useGameStore()` darauf zu. Der Store startet aus `loadCachedGames()` und `loadSyncQueue()` aus `src/utils/localSync.ts`, schreibt Aenderungen wieder in `localStorage`, fuehrt Mutationen lokal aus und versucht danach die Queue gegen Supabase zu flushen.

Das Domain-Modell ist eventbasiert: Score-, Command-Point-, Note- und Time-Events werden gespeichert. Runden, Zuege, aktueller Spieler, Status, Start-/Endzeiten und Dauerwerte werden daraus abgeleitet. Zentrale Ableitung passiert in `syncDerivedGameState()` in `src/utils/gameState.ts`; Berechnungen fuer UI und Stats liegen in `src/utils/gameCalculations.ts`.

Datenzugriff liegt in `src/services/gamesRepository.ts`. Supabase speichert Spiel-Metadaten in `games` und einzelne Ereignisse in `events`. App-Spieler-IDs haben das Format `<gameId>:player-1` und `<gameId>:player-2`; Supabase speichert dafuer `player_slot` 1 oder 2. Timer-Korrekturen liegen in `games.timer_corrections` als JSONB; andere Zusatzdaten wie Score-Meta und Detachments werden JSON-codiert im Feld `games.notes` abgelegt.

## Build, Test und Deploy

- Entwicklung: `npm run dev` startet Vite auf Port 5173.
- Build: `npm run build` fuehrt `tsc -b` und danach `vite build` aus.
- Typecheck: `npm run typecheck`.
- Tests: `npm test` kompiliert mit `tsconfig.test.json`, legt `.test-dist/package.json` fuer CommonJS an und startet `tests/run-tests.cjs`.
- Preview: `npm run preview`.
- Supabase Setup: `supabase/schema.sql` komplett im Supabase SQL Editor ausfuehren.
- Environment: `VITE_SUPABASE_URL` und `VITE_SUPABASE_PUBLISHABLE_KEY` lokal in `.env.local` oder beim Hosting, laut README z. B. Netlify Environment Variables.

## Bekannte Prinzipien und Entscheidungen

- Mobile-first und schnelle Bedienung waehrend des Spiels haben Vorrang.
- Jede Code- oder Projektbearbeitung wird in `CHANGELOG.md` dokumentiert. Bei Bugfixes gehoeren Fehlerbild und Ursache in den Eintrag. Abschlussantworten enthalten immer eine passende Git-Commit-Beschreibung.
- Keine Router-Abhaengigkeit: Navigation erfolgt ueber Hash-Routes.
- Kein UI-Framework: Styling bleibt lokal und ueberschaubar.
- Supabase ist Remote-Source-of-Truth, aber die App nutzt optimistische lokale Aenderungen mit Cache und Sync-Queue.
- Spielverlauf ist eventbasiert. Neue Features sollten moeglichst neue/angepasste Events und abgeleitete Berechnungen nutzen statt abgeleitete Daten direkt zu pflegen.
- Primary und Secondary Scores werden getrennt behandelt; Legacy-Total-Daten existieren fuer Import-/Altdaten.
- Statistik-Wertung hat die Bereiche Ergebnis, Scoring, CP und Zeit. Standard ist `auto`; `include`/`exclude` sind manuelle Overrides und veraendern nur die Wertung, nie Score-/CP-/Zeit-Rohdaten. Fehlende Override-Felder bedeuten `auto`. Wertbare Zuege/Runden ohne Score-/CP-Event zaehlen in diesem Bereich mit 0; CP-Events allein erzeugen keine Zug-/Runden-Relevanz.
- Spielpunkte sind gemeinsame Match-Punkte (`gamePoints`) und werden auf beide Spieler-Armeen gespiegelt.
- Runde und Zug werden ueber einen schnellen `Weiter`-Ablauf gesteuert; es gibt maximal 5 Runden in der Store-Logik.
- Wichtige Regression vermeiden: Der In-Game-Button `Zurueck` muss von Runde 1 / Zug 1 immer zur Aufstellungsphase zurueckkommen. Das darf nicht davon abhaengen, ob der Timer gerade laeuft; auch bei pausiertem/gestopptem Timer muss `rewindLastTurn(..., keepTimerRunning: true)` die fachliche Phase wieder auf Aufstellung setzen.
- Supabase RLS ist im MVP offen fuer Select/Insert/Update/Delete (`using true` / `with check true`).

## Sicher neue Features oder Bugfixes angehen

1. Zuerst klaeren, ob die Aenderung UI, Domain-Logik, Persistenz oder Statistik betrifft.
2. Fuer Domain-Aenderungen zuerst `src/types/game.ts`, `src/utils/gameState.ts` und `src/utils/gameCalculations.ts` pruefen. Abgeleitete Felder nicht an mehreren Stellen manuell pflegen.
3. Fuer persistierte Daten `src/services/gamesRepository.ts`, `src/types/supabase.ts` und `supabase/schema.sql` gemeinsam betrachten. Mapping zwischen App-IDs und Supabase-`player_slot` nicht brechen.
4. Bei Spielmutationen im Store die lokale Aenderung, Undo/Redo-Historie und Sync-Queue zusammen betrachten.
5. Bei Import/Legacy-Daten `mapPersistedGame()` und `parseImportedGames()` beachten, damit alte Exporte weiterhin normalisiert werden.
6. Bei Timer- oder Rundenlogik Tests ergaenzen oder anpassen, vor allem in `tests/gameCalculations.test.cjs` und `tests/timerFocus.test.cjs`.
7. Nach Aenderungen mindestens `npm run typecheck` und bei Logik-/Timer-/Security-Aenderungen `npm test` ausfuehren.
8. Nur noetige Dateien anfassen; bestehende lokale Aenderungen nicht zuruecksetzen.
