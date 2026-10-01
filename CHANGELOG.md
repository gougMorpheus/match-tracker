# Changelog

Kurz, chronologisch absteigend. Jede Code- oder Projektbearbeitung bekommt einen Eintrag.
Bei Bugfixes immer Fehlerbild und Ursache nennen.

## 2026-10-01

### Zwei-Geraete-Sync und TV-Anzeige

- Fehlerbild: Zuschauer zeigten abweichende/lokal weiterlaufende Timer und konnten ueber einzelne Pfade Spielzustand veraendern. Ursache: Realtime war ein No-op, laufende lokale Snapshots verdraengten Polling-Daten, Geraete verwendeten unkorrigierte Uhren; Wiedereroeffnen, Loeschen und Import umgingen die Ansichts-Sperre.
- Fix: Serverdaten ersetzen alte laufende Snapshots; zentrale Mutations-/Queue-Sperren gelten auch vor Modusauswahl, bei direkter TV-URL, Undo/Redo, Import und abgeschlossenen Spielanzeigen. Zuschauer senden keine vorhandenen Queue-Eintraege und ueberlagern damit keine Serverdaten; alte Caches/Queues/Exporte bleiben kompatibel.
- REST-Schreibberechtigung wird unmittelbar vor jeder Store-Sync-Anfrage erneut geprueft, auch nach asynchronen Vorab-Leseanfragen und bei Schema-Fallbacks.
- Gemeinsame Timer bleiben aus Zeitereignissen/Pausen/Korrekturen abgeleitet. REST-Date-Header liefern eine robuste, best-effort Uhrkorrektur fuer neue Ereignisse und Anzeigezeit (Schnitt der durch Sekundenaufloesung und Request-Zeiten begrenzten Offset-Intervalle, Reset auf juengste kompatible Samples bei leerem Schnitt, Fallback 0); an korrigierten vollen Serversekunden ausgerichtete, erneut geplante Timeouts dienen nur dem Rendering; Zuschauer folgen beim Ticken dem neuesten Server-Zug, auch wenn die lokale Zugauswahl noch auf einem abgeschlossenen Zug steht. Offene Time-outs enden fuer die Anzeige spaetestens am Spielende. Legacy-Timerkorrekturen waren in normalen Snapshot-Payloads ausgelassen; sie werden jetzt ebenfalls synchronisiert und in `getComparableGamePayload` verglichen. Notes bleiben im normalen Payload frei von Timerkorrekturen; nur bei nachweislich fehlender DB-Spalte schreibt der Schema-Retry sie kompatibel ins bestehende Notes-JSON.
- Nachtest-Fehlerbild: Timeranzeigen unterschieden sich zeitweise um bis zu 2 s; Ursache waren Median-Schaetzung abgeschnittener HTTP-Date-Werte und unterschiedliche lokale Intervallphasen. Intervallschnitt und gemeinsamer Sekunden-Takt beheben diese Ursachen; Tests pruefen Konvergenz unter 250 ms, Uhrsprung/Outlier-Reset, +47-s/-90-s-Geraete und Tick-Neuausrichtung nach Verzoegerung.
- Nachtest-Fehlerbild: Remote-Pause/Resume blockierte Zuschauer durch Timer-Hinweisdialoge. Ursache: Hinweis-Effekt unterschied nicht zwischen Bearbeiten und Ansehen. Zuschauer erzeugen/zeigen keine blockierenden Timerhinweise; Editor-Verhalten bleibt erhalten. Die zusaetzliche normale Notes-Duplizierung widersprach der SQL-Migration aus Notes in `timer_corrections`; Notes-Fallback ist jetzt auf die tatsaechlich fehlende Spalte beschraenkt.
- Leichter Phoenix-Realtime-Client ohne neue Abhaengigkeiten: `games`/`events`, Heartbeats, Reconnect mit Backoff/Rejoin, Refresh beim Beitritt und Cleanup. Sichtbare aktive Zuschauer-Spiele pollen zusaetzlich alle 3 s. `supabase/schema.sql` enthaelt bereits beide Tabellen in `supabase_realtime`; keine Schemaaenderung oder Migration erforderlich/ausgefuehrt.
- TV-Modus ueber Ansichts-Button oder `#/game/<id>?tv=1` (auch `?tv=1` vor dem Hash): strikt nur lesbar, grosse kontrastreiche Anzeige, aktiver Spieler, VP/Primaer/Sekundaer/CP, Spieler-/Phasenzeit, Status und Mission/Aufstellung; Vollbild, automatisch versteckte Overlay-Steuerung/Cursor und Screen Wake Lock mit Sichtbarkeits-Reaktivierung, soweit unterstuetzt.
- Regressionstests fuer echte Store-Mutationen/Queues/Remote-Pausen, Uhrversatz und Timer/Pausen sowie Websocket-Protokoll, Heartbeat/Rejoin/Backoff/Cleanup. Laden/TV-Wechsel trennt die Tracker-Komponente, damit Hooks auch bei fehlendem Spiel stabil bleiben.

## 2026-08-18

### Supabase-Keepalive per GitHub Actions

- Projektpflege: Taeglicher GitHub-Actions-Workflow `supabase-keepalive.yml` liest mit Supabase-URL und Publishable-Key aus Repository-Secrets maximal eine `games`-ID ueber PostgREST, damit das Free-Plan-Projekt aktiv bleibt. Der Workflow schreibt keine Daten und nutzt keinen `service_role`-Key.

## 2026-06-03

### Stabilisierung: Time-Event-Erzeugung und Round-Ableitung

- Fehlerbild: Timer-Verlaeufe konnten fehlende oder doppelte Rahmen-Events enthalten, z. B. fehlendes `game-start`, `round-start` oder `round-end`; dadurch wirkten Spielzeit und Runden-/Zugableitung bei inkonsistenten Spielen instabil.
- Ursache: Neue Time-Events wurden an mehreren Ausloesestellen direkt angehaengt. Dabei gab es keine zentrale Sicherheitsstufe fuer einheitliche Batch-Zeitpunkte, doppelte identische Events oder notwendige Rahmen-Events vor Turn-/Round-Events.
- Fix: `appendLocalTimeEvents` normalisiert neue Time-Event-Batches vor dem Speichern: fehlendes `game-start` wird defensiv ergaenzt, Turn-/Round-Events bekommen bei Bedarf ein fehlendes `round-start`, identische Events im selben Zeitpunkt werden uebersprungen und Events ohne expliziten Zeitpunkt teilen sich einen Batch-Zeitpunkt. Die Round-Ableitung nutzt vorhandene Turn-Starts/-Ends als Fallback fuer fehlende Round-Rahmen, ohne Rohdaten zu veraendern.

## 2026-06-01

### Bugfix: `game-start` wirkt bei fehlendem `setup-start` auf Spielzeit

- Fehlerbild: Nach Bearbeiten von `game-start` aenderte sich die angezeigte Spielzeit nicht.
- Ursache: Die Gesamtzeit wurde aus `setup-start/setup-end` plus Zugzeiten berechnet. Wenn `setup-start` fehlte, hatte `game-start` keinen Einfluss auf die Aufstellungs- und Gesamtzeit.
- Fix: Die Aufstellungszeit nutzt jetzt `game-start` als Fallback-Start, wenn `setup-start` fehlt. Wenn `setup-end` fehlt, endet die Aufstellung defensiv beim ersten `round-start` oder `turn-start`. Dadurch beeinflusst ein bearbeitetes `game-start` die Gesamtzeit bei inkonsistenten Bestandsdaten korrekt.

### Timer-Status im Spiel deutlicher gemacht

- Fehlerbild: Beim Oeffnen der Einstellungen wirkte der Timer unterbrochen, und der laufende/gestoppte Zustand war nicht prominent genug.
- Ursache: Der Render-Ticker wurde waehrend geoeffneter Einstellungen gestoppt; ausserdem gab es nur die kleine Status-Pille im Header.
- Fix: Einstellungen pausieren den Timer nicht mehr und stoppen auch den UI-Ticker nicht. Bei laufendem Timer bekommt der Header einen dicken roten Rand. Timer-Zustandswechsel zeigen ein quittierbares Hinweisfenster fuer `Timer laeuft`, `Timer gestoppt` oder `Time-out aktiv`.
- Projektkontext ergaenzt: Spieldetails/Einstellungen sind keine Timer-Aktion und duerfen keine Pause-Events erzeugen.

### Stabilisierung: Fehlendes `game-start` nutzt Spieltermin

- Fehlerbild: Nachgetragene `game-start` Events konnten fachlich falsch liegen, wenn sie aus spaeteren Bedienaktionen oder vorhandenen Events abgeleitet wurden.
- Ursache: Die Nachtragslogik verwendete zunaechst `now` und danach heuristisch fruehere Events. Fachlich soll `game-start` aber der Start der Aufstellungsphase sein und beim Fehlen aus dem eingestellten Spieltermin kommen.
- Fix: Fehlende `game-start` Events verwenden jetzt Datum und Uhrzeit aus den Spieleinstellungen. Nur wenn diese Werte fehlen oder ungueltig sind, wird der aktuelle technische Fallback verwendet. Neue Spiele schreiben weiterhin `game-start` und `setup-start` direkt zusammen beim Start der Aufstellungsphase.

### Bugfix: Wiedereroeffnen gegen Sync-Rueckschritt abgesichert

- Fehlerbild: Geschlossene Spiele liessen sich teils wiedereroeffnen, wurden danach aber durch Sync-Fehler oder einen Remote-Pull wieder als geschlossen angezeigt.
- Ursache: Wiedereroeffnen bestand aus mehreren indirekten Queue-Aenderungen (`game-end` loeschen und Game-Snapshot auf active setzen). Solange remote noch `game-end`/`ended_at` sichtbar war, konnte der Completed-Zustand beim Pull wieder gewinnen.
- Fix: Wiedereroeffnen ist jetzt eine explizite Sync-Queue-Operation `reopen-game`. Pending Reopen gewinnt beim lokalen Remote-Merge, loescht remote zuerst das `game-end` Event und schreibt danach den aktiven Game-Snapshot.

### Projektprozess

- Changelog-Pflicht eingefuehrt: Jede kuenftige Bearbeitung wird in `CHANGELOG.md` dokumentiert.
- Projektanweisungen in `agents.md` und `PROJECT_CONTEXT.md` ergaenzt.
- Abschlussantworten sollen immer eine passende Git-Commit-Beschreibung enthalten.

### Bugfix: Geschlossene Spiele wiedereroeffnen

- Fehlerbild: Nach korrektem Admin-Passwort schloss sich der Dialog, aber das Spiel blieb im Scoreboard/Completed-Zustand.
- Ursache: `reopenGame` entfernte zwar das letzte `game-end` Event, aber `removeLocalEvent` behielt `endedAt` und `finishReason`. `syncDerivedGameState` leitete daraus sofort wieder `completed` ab.
- Fix: Beim Entfernen des letzten `game-end` werden `endedAt` und `finishReason` geleert. `reopenGame` kann ausserdem Spiele oeffnen, die nur ueber `endedAt` abgeschlossen sind.

### Bugfix: Spiel mit mehr als 100 Events unvollstaendig geladen

- Fehlerbild: Spiel `bfcaf5a5-6a33-40c7-b689-d48429544135` zeigte in der App nur bis Runde 4, obwohl Supabase Events bis Runde 5 und `game-end` enthielt. Die Spielzeit wirkte instabil/falsch.
- Ursache: Die Event-Abfrage lud nur die erste Supabase/PostgREST-Seite. Im Event-Dump begann Runde 5 erst ab Event 101.
- Fix: `fetchEventsForGameIds` laedt Events paginiert in 100er-Seiten. Der lokale Supabase-REST-Client unterstuetzt dafuer `range(from, to)`.

### Bugfix: Completed-Status konnte nach Reload verloren gehen

- Fehlerbild: Ein geschlossenes Spiel sah zunaechst geschlossen aus, wurde nach Reload aber wieder aktiv angezeigt.
- Ursache: `syncDerivedGameState` verwarf ein persistiertes `endedAt`, sobald Time-Events vorhanden waren, aber kein `game-end` Event geladen wurde. Alte lokale/remote Snapshots konnten abgeschlossene Zustaende dadurch ueberdecken.
- Fix: `game-end` oder `endedAt` gelten als dauerhafte Abschlussquelle. Offene abgeleitete Turns/Rounds werden am Spielende geschlossen, ohne Roh-Events zu veraendern. Sync-Merge behandelt Completed-Zustaende defensiv.
