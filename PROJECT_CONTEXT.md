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
- Wichtige Regression vermeiden: Das Oeffnen von Einstellungen/Spieldetails in einem aktiven Spiel darf den Timer nicht pausieren, keine `setup-pause`-/`turn-pause`-Events erzeugen und den UI-Ticker nicht einfrieren. Bearbeiten von Spieldetails ist keine Timer-Aktion.
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

## Gemeinsame Timer, Nur-Lese-Ansicht und TV-Modus

- Offene Spiele sind vor der Modusauswahl und in `view` strikt schreibgeschuetzt: zentrale Store-/Queue-Sperren (auch Import, Undo/Redo, Loeschen und Wiedereroeffnen), keine automatischen Zeitereignisse. REST-Sync prueft die Berechtigung direkt vor dem Senden erneut, auch nach asynchronen Vorab-Leseanfragen. Abgeschlossene Spielanzeigen sind ebenfalls nur lesbar. Bestehende Queue-Eintraege bleiben kompatibel erhalten, werden beim Zuschauen aber weder gesendet noch ueber Serverdaten gelegt.
- Timer bleiben eventbasiert (`timeEvents`, Pausen, `timer_corrections`). Anzeigen berechnen Zeiten aus gemeinsamen Zeitstempeln; Render-Ticks richten sich per erneut geplantem Timeout an vollen Sekunden der korrigierten Serveruhr aus. `serverClock.ts` schaetzt den Serverzeitversatz aus REST-`Date`-Headern durch Schnitt der Offset-Intervalle `[Serversekunde - Empfang, Serversekunde + 1000 - Versand]` juengster kompatibler Antworten (Reset bei leerem Schnitt, best effort, Fallback 0). `getNowIso()` korrigiert neue Ereigniszeitpunkte und Berechnungen. HTTP-Date hat Sekundenaufloesung und muss per CORS lesbar sein. Legacy-Timerkorrekturen werden in normalen Snapshots ebenfalls persistiert, nur im Retry bei nachweislich fehlender Spalte kompatibel im bereits vorhandenen Notes-JSON. Zuschauer erhalten keine blockierenden Timerzustands-Hinweise; der Status bleibt in der Statusanzeige.
- Der lokale REST-Client implementiert Supabase Realtime ueber Phoenix-Websocket ohne Zusatzpakete, mit Heartbeat, Backoff, Rejoin und Cleanup. Rejoin/Online/Sichtbarkeit laden erneut; neben dem 15-s-Fallback wird das offene, nicht abgeschlossene Zuschauer-Spiel bei sichtbarem Tab alle 3 s gelesen. Laufende lokale Timer-Snapshots blockieren keine Serveraktualisierungen mehr.
- `TvGameView.tsx`: viewport-skaliertes 16:9-Nur-Lese-Dashboard im App-Kartenstil, mit Spieler-/Phaseninfos, kumulativem VP-Chart, Rundentabelle, Zeit-Duell, Missionskarte, Ereignissen, Bilanz und Highlights. Vollbild (inkl. WebKit-Fallback), ausblendende Bedienelemente und optionaler Screen Wake Lock bleiben erhalten. Aufruf aus der Ansicht oder `#/game/<id>?tv=1`, alternativ `?tv=1` vor dem Hash. TV-URLs erzwingen Nur-Lese-Modus bereits vor Seiteneffekten; Verlassen bleibt in der Nur-Lese-Ansicht.
- Tests bleiben Node/CommonJS; pure Utils werden mit `tsconfig.test.json` kompiliert. Store-/Websocket-Integrationstests laden Browsermodule mit dem bereits installierten Vite-esbuild und lokalen Hook-/Websocket-Adaptern, ohne Netzwerkzugriff.

## TV-Dashboard: Auswertungen und Highlights

- Die TV-Komponente liest ausschliesslich `game` aus Props und `games` aus `useGameStore()`. Keine Store-Aktionen, Queue-Schreibzugriffe oder automatischen Zeitereignisse; `gameAccessMode`, `forceTv` und Editor bleiben unveraendert. Server-Sekundenticker und bestehende Score-/Timerfunktionen berechnen die Anzeigen mit Pausen und Timerkorrekturen.
- Landscape nutzt ein proportional skaliertes Grid mit fester Viewporthoehe ohne Scrollen (Ziel 1920x1080 und 1280x720); Hochkant und kleine Viewports wechseln in einen scrollbaren Einspalten-Fallback. Fraktionsfarben aus `src/data/factionColors.ts` decken alle Armeen ab, trim/case-insensitive, mit Slot-Fallback. `getPlayerColors` behaelt Spieler 1 bei und ersetzt bei RGB-Abstand unter 100 Spieler 2 durch den weiter entfernten violetten/goldenen App-Akzent, auch bei gleicher oder unbekannter Fraktion. Styling verwendet App-Variablen, Karten und SVG-Chart-Stile; reduzierte Bewegung wird respektiert.
- `tvDashboard.ts`: Rueckstand statt Prognose. Verbleibende Runden = 5 minus aktuelle Runde; benoetigte VP pro Runde werden aufgerundet, nur solange Runden verbleiben und das Spiel aktiv ist. Fehlende vergleichbare VP werden als fehlend angezeigt. Ereignisse aus Score-/CP-/relevanten Zeit-/Notiz-Events sind absteigend nach Zeitpunkt, bei Gleichstand nach ID sortiert, auf maximal acht aktive DOM-Eintraege begrenzt; herausfallende Eintraege bleiben fuer ihren 400-ms-Fade kurz absolut positioniert als `tv-event--leaving` erhalten. Event-ID bleibt React-Key und `data-event-id`; neue Eintraege gleiten herein, bestehende ruecken per `useLayoutEffect`/Web Animations API (FLIP) nach unten, die Liste verblasst nach unten. Reduzierte Bewegung entfernt Austritte sofort und deaktiviert Animationen.
- `headToHead.ts`: Namen werden getrimmt, in Kleinschreibung gewandelt und mehrfache Leerzeichen zusammengefasst; Spieler-Slots spielen fuer Namensmatching keine Rolle. Nur `status === "completed"` wird gewertet; `interrupted`/`abandoned` und aktive Spiele werden ignoriert. `draw` ist explizit ein Unentschieden, `player-1-conceded`/`player-2-conceded` ein Sieg des jeweils anderen Spielers. Sonst entscheiden die vorhandenen vergleichbaren Gesamt-VP, Gleichstand zaehlt als Unentschieden; ohne vergleichbare Punkte wird das Spiel nicht gewertet. Statistik-Overrides beeinflussen diese Bilanz nicht. Siegquote = Siege / gewertete Spiele, gerundet auf ganze Prozent; Unentschieden zaehlen im Nenner. Keine gewerteten Spiele ergibt keine Prozentangabe. Das aktuelle Spiel ist waehrend des Laufens ausgeschlossen, als abgeschlossenes Store-Spiel wird es mitgezaehlt.
- `tvHighlights.ts`: Pure Snapshots mit explizitem `nowIso` und erweiterbare `HIGHLIGHT_RULES` fuer Fuehrungswechsel/Ausgleich, erstmaliges Erreichen von mindestens 6 VP Rueckstand, Zeit-Meilensteine (30/45/60 Minuten, danach volle Stunden) bei Phasenwechseln und seltenes Zeit-Ueberholen nur an Rundenabschluessen, Rundenabschluss und Endergebnis. Der letzte nicht-ausgeglichene Fuehrende bleibt ueber Gleichstaende hinweg bekannt. Fehlende Ergebnisse werden nicht als Unentschieden erfunden.
- Highlight-Ausloesung: Beim Laden nur Basis-Snapshot merken. Erst wenn sich Runde/Zug/completed im Phasen-Schluessel aendert, Regeln gegen den letzten Phasenwechsel-Snapshot auswerten und diesen erneuern; Scoreupdates und Sekundenticks allein loesen nichts aus. Zeit-Snapshots fuer Highlights verwenden den gespeicherten Phasenwechsel-Zeitpunkt (Fallback Serveruhr), damit Empfangs-/Renderverzoegerungen keine Zeit-Schwellen veraendern; die sichtbaren Timer bleiben live. Deterministische Highlight-IDs werden je Ansicht dedupliziert. Overlays stehen in einer lokalen Anzeige-Queue, jeweils vier Sekunden; Spielwechsel setzt Basis/Queue/IDs zurueck. Queue und Timer sind reine UI-Zustaende, keine Spielmutationen. Neu laden wiederholt keine vergangenen Highlights.
- Node/CommonJS-Tests fuer Bilanz, Rueckstand, Eventfeed, Highlight-Regeln und die echte TV-Komponente (Nur-Lese-Storezugriff, kein Overlay beim Laden, Phasenwechsel, Vier-Sekunden-Queue, Deduplizierung). Der bestehende Utils-Glob in `tsconfig.test.json` kompiliert alle neuen reinen Funktionen bereits mit.

- TV-Nachbesserung nach Browser-Screenshots: Grid-Zeilen 37/30/33, hoehenfuellende Rundentabelle mit groesseren fetten VP und nebeneinander angeordnete Siegquoten, Mindestschrift 1,7 vh (mindestens 12 px), fast deckendes Highlight mit deckender Karte und 300-ms-Ein-/Ausblendung. `TvScoreChart.tsx` passt seinen SVG-viewBox per ResizeObserver an die tatsaechliche Panelflaeche an; breite deckende Primaer/Sekundaer-Rundenbalken (Sekundaer gestreift) und dicke Gesamtlinien, Achsenlabels ohne Skalierungsverlust. Zeit-Duell zeigt Gesamtspielzeit und benannten aktuellen Zug; leere Missionsdaten ausser Mission/Aufstellung werden ausgelassen. Stabile E2E-Hooks: `tv-phase__title`, `tv-phase__clock strong`, `strong.tv-player__time`.
- Zeit-Ueberholen: Nur bei Wechsel nach Runde N zu N+1 oder Spielende nach abgeschlossener Runde N, N >= 2. Fuer jede abgeschlossene Runde werden korrigierte Zugzeiten der Runden 1..N kumuliert; ein Zeitfuehrer existiert nur ab 60 Sekunden Abstand. Highlight bei Wechsel gegenueber dem letzten nicht-leeren Zeitfuehrer aus 1..N-1, inklusive beider Zeiten. Die gesamte Rundengeschichte entscheidet unabhaengig vom initialen Zuschauer-Snapshot; normales Hin-und-Her bei Zugwechseln erzeugt keine Zeit-Ueberholen-Highlights.

- Abgeschlossene TV-Spiele zeigen letzte Zugzeit/letzten Spielerzug und das Ergebnis aus `getGameOutcome` statt Rueckstand. Wertbare Siege zeigen den positiven VP-Vorsprung, explizite Draws Unentschieden, Concede-Siege den Hinweis auf Aufgabe; nicht wertbare Enden nur Spiel beendet. Laufende Anzeigen bleiben unveraendert.
