# Changelog

Kurz, chronologisch absteigend. Jede Code- oder Projektbearbeitung bekommt einen Eintrag.
Bei Bugfixes immer Fehlerbild und Ursache nennen.

## 2026-10-16 – Kleinigkeiten: Match öffnen merken, Enter im Namensfeld, „+ Spieler“
- „Match öffnen“ (Edit / View only) wird pro Spiel und Gerät gemerkt (localStorage `match-tracker.access-mode.v1`, `src/utils/accessModeMemory.ts`). Fehlerbild vorher: Nach jedem Neuladen fragte der Dialog erneut, weil die Wahl nur im Arbeitsspeicher lag. Gilt nur für laufende Spiele; View-only-Links (?tv=1) und der Passwortschutz (Entsperren) bleiben unverändert. Wer „View only“ gewählt hat, findet im Menü „Match öffnen …“, um neu zu wählen.
- Enter im Feld „Neuen Namen eingeben“ übernimmt den Namen und springt zum nächsten Feld. Fehlerbild vorher: Enter schickte das ganze Formular ab (Standardverhalten eines Eingabefelds im Formular).
- Das „+“ neben dem Spielerfeld heißt jetzt „+ Spieler“, mit Tooltip „Neuen Spieler anlegen (Namen eingeben)“. Passt bei 375 px.

## 2026-10-16 – Stufe (b): echte Web-Push-Meldungen + Touch-Ziele im Verlauf
- Push: Neues Event → DB-Trigger (pg_net) → Netlify Function `push-dispatch` → Web-Push (VAPID) an alle Geräte, die dem Spiel folgen (manuell oder Auto-Follow für neue Spiele). Gemeldet: Spielstart, Führungswechsel, Ausgleich, Herausforderungskarten, Zeit-Duell, Zeit-Meilensteine, Rundenabschluss, Spielende. Tipp auf die Meldung öffnet das Spiel in View only.
- Gleiche Meldungen wie in der App: Die Function nutzt dieselbe Abbildung (`supabaseGameMapping.ts`, aus `gamesRepository.ts` herausgelöst, Ausgabe identisch) und dieselbe Highlight-Ableitung (`deriveGameHighlights`). Test an 16 echten Spielen.
- Dedupe: Tabelle `push_sent_highlights` mit Unique(game_id, highlight_key); erst eintragen, dann senden. Parallel getestet (genau ein Versand). Undo zieht nichts zurück und pusht nicht erneut.
- Fehlertolerant: Ist die Function nicht erreichbar, wird das Event trotzdem gespeichert (getestet).
- Notifications-Dialog: echte Zustände („Notifications erlaubt“, „Notifications sind blockiert“ mit Hinweis, Abo-Status, „Erneut versuchen“), der Text „kommen in einem nächsten Schritt“ entfällt.
- Verlauf „Einzeln (n)“: Bearbeiten/Löschen auf Touch-Geräten mindestens 44 × 44 px (vorher 26 px hoch). Desktop unverändert.
- Migration `supabase/migrations/20261016_02_web_push.sql`, Rollback `20261016_02_web_push.rollback.sql`. Backup `/home/box/ops/backup/match-tracker-2026-10-16-vor-push-b/`.

## 2026-10-16 – Retest-Fixes (Pepper, 6ad1a84a)
- Zuschaueransicht: Aufstellung pausiert bzw. pausierter Zugstart heißt „Zug noch nicht gestartet“ (vorher „Pausiert“). Echte Pausen mitten im Zug bleiben „Pausiert“. Zusätzlich gilt die feste Reihenfolge bei gleichem Zeitstempel jetzt auch für die Aufstellung (game-/setup-start vor setup-pause).
- Full screen ist immer sichtbar (vorher nach 3,5 s ohne Bewegung ausgeblendet, auf Touch nur nach Tippen sichtbar).
- „Link teilen“: am Handy nur der Teilen-Dialog (navigator.share); kopiert wird nur ohne Teilen-Dialog oder bei technischem Fehler. Abbruch im Dialog ohne Meldung. Desktop kopiert.
- Falschalarm „Konflikt: Ein anderes Gerät …“ bei nur einem Gerät. Ursache (per Playwright auf dem alten Prod reproduziert): Ging die Antwort auf ein bereits gespeichertes Ablauf-Ereignis (z. B. Timer an/aus) verloren, sendete der Client es erneut. Der Server meldete „schon vorhanden“ (noop) mit matched=false, weil der eigene erste Versuch die Ablauf-Version schon erhöht hatte. Der Client hielt deshalb seine alte Version, und die nächste Aktion (z. B. Pause) wurde als Konflikt verworfen. Lösung: `resolveOwnRetryResult` wertet noop mit Serverversion = Basis + 1 als eigenes Schreiben. Zusätzlich ersetzen ältere Neulade-Antworten den lokalen Stand nicht mehr (`keepNewerLocalGames`). Fremde Änderungen ergeben Basis + 2 oder mehr, der Konfliktschutz bei zwei Geräten bleibt (getestet).
- Notifications: Gelöschte Spiele verschwinden aus den gefolgten Spielen, sobald die Spieleliste frisch vom Server geladen ist (`pruneDeletedFollows`).

## 2026-10-16 – Feste Reihenfolge „Start vor Pause“ bei gleichem Zeitstempel
- Fehlerbild: Nach „Weiter“ zeigte die Zuschaueransicht nach Neuladen „Läuft“ mit tickender Zugzeit, der Editor nach Neuladen „Timer läuft“, obwohl der Zug pausiert startet.
- Ursache: `turn-start` und `turn-pause` bekommen denselben Server-Zeitstempel; die DB liefert gleiche Zeitstempel in beliebiger Reihenfolge. Kam die Pause zuerst, wurde sie ignoriert (Zug noch nicht gestartet) und der Zug galt als laufend.
- Lösung (nur Auswertung, Daten und Timer-Logik unverändert): `orderTimeEventsForEvaluation` (src/utils/timeEventOrder.ts) sortiert nach Zeitstempel und setzt bei Gleichstand game-/round-/turn-start (desselben Zugs) vor `turn-pause`. Genutzt beim Aufbau der Zug-/Rundenzeiten (gamesRepository und gameState `buildRoundsFromTimeEvents`), damit für Editor, Zuschauer, Statistik und Highlights; die Event-Listen selbst bleiben unverändert. Test: tests/timeEventOrder.test.cjs.
- Auswirkung Statistik (echte Spiele, Daten unverändert): 7 von 41 Spielen anders ausgewertet. 6 Alt-Importe (März–April) verlieren Phantom-Zeiten unter 3 s (Rundendauer-Chart 75 → 52 Werte > 0). 80ea1342 (Tim vs Janis, beendet 15.10.): Runde 1 70,7 → 49,9 min, Tim 2483,5 → 2448,3 min, Janis 60,5 → 60,1 min, Dauer 2562,0 → 2526,4 min. Vorher hing das Ergebnis von der zufälligen DB-Reihenfolge ab.

## 2026-10-16 – Schritt 2: Schreibschutz für Alt-Backup-Tabellen
- `events_backup_before_timer_corrections` und `games_backup_before_timer_corrections`: INSERT/UPDATE/DELETE/TRUNCATE für `anon` und `authenticated` entzogen (vorher `arwdDxtm`, RLS an, keine Policies). SELECT, REFERENCES, TRIGGER, MAINTAIN unverändert.
- Ursache: Die Tabellen hatten volle Schreibrechte für öffentliche Rollen, obwohl App, RPCs und Keepalive sie nicht nutzen.
- Angewendet am 16.10.2026 06:44 (Berlin) über die Management-API; Migration `supabase/migrations/20261016_01_backup_tabellen_schreibschutz.sql`, Rollback `…rollback.sql`.
- Daten unverändert (1685 bzw. 35 Zeilen), Backup unter `/home/box/ops/backup/match-tracker-2026-10-16-vor-rechte/`.

## 2026-10-16

### Schritt 1: Hinweis, Full screen, Umlaute, Zugstart, Bündelung, Link teilen, ohne Notizen/Scoreboard

- Notifications: Solange Push nicht live ist, steht nur noch ein Hinweis da („Du folgst dem Spiel. Benachrichtigungen aufs Handy kommen in einem nächsten Schritt.“). Fehlerbild vorher: „blockiert“ und „kommen bald“ standen widersprüchlich untereinander (Statushinweis plus Bald-Text). Statushinweise (blockiert, Home-Bildschirm …) erst mit `PUSH_DELIVERY_AVAILABLE`.
- Full screen: Ursache: Button war absolut unten rechts über dem Dashboard positioniert (Desktop über der letzten Ereigniszeile, mobil fixed über der Spielerzeit von Spieler B). Jetzt im Fluss der Mitte-Kachel, belegt eigenen Platz.
- Umlaute/ß in allen sichtbaren Texten (nur String-Literale/JSX-Text per AST, Code-Bezeichner und DB-Werte unverändert).
- Zuschaueransicht: „Zug noch nicht gestartet“ statt „Pausiert 00:00:00“, wenn der Zug nach „Weiter“ aus der Aufstellung (gewollt) pausiert ist und noch keine Zugzeit lief. Timer-Logik unverändert.
- Letzte Ereignisse und Verlauf bündeln (nur Anzeige, `src/utils/eventGrouping.ts`): Auto-CP im Zugwechsel „(auto CP each)“, pro Zug und Spieler ein CP-Eintrag (+x / −y) und je SP-Art ein Eintrag; Highlights bleiben eigene Zeilen. Verlauf: gebündelte Zeile mit „Einzeln (n)“, darunter die Einzel-Events mit Bearbeiten/Löschen. Undo wirkt weiter auf das letzte Einzel-Event.
- Menü im Spiel (Edit und View only): „Link teilen“ (Direktlink `#/game/<id>?tv=1`, kopieren + „Link kopiert“, mobil zusätzlich Teilen-Dialog). „Scoreboard“ und „Notizen“ entfernt; Notizen werden nirgends mehr angezeigt oder eingegeben. Vorhandene Notiz-Daten bleiben in der DB; das Bearbeiten eines Events übernimmt die vorhandene Notiz unverändert.

## 2026-10-15

### TV-Einblendung Führungswechsel/Ausgleich mitten im Zug, kompakte Ereigniszeilen mobil

- Wunsch: Die große TV-Einblendung zeigte Führungswechsel/Ausgleich nur an Runden-/Zugstarts (Ursache: Effekt verglich nur Phasen-Snapshots). Jetzt dieselbe Logik wie Liste/Verlauf (PR #10, `deriveScoreLeadHighlights`) nach jedem gültigen Punkte-Event.
- Undo nimmt die Einblendung sofort zurück (auch die gerade sichtbare). Undo mitten im Verlauf erzeugt keine Einblendungen für alte Events. Mehrere schnelle Punkte-Highlights: die sichtbare läuft zu Ende, nur das neueste wartet (kein Stau, kein Flackern).
- Mobil: Zeilen in „Letzte Ereignisse“ richten sich nach dem Inhalt statt 1/8 der Listenhöhe; Desktop unverändert.

### Menü: „Notifications“ statt „Benachrichtigungen“

- Wunsch Tim: Menüpunkt war zu breit. Umbenannt in Menü (Start, Statistik, Edit, View only), Dialogtitel und Hinweisen. Nur der Name der Browser-Einstellung („Benachrichtigungen“ → „Zulassen“) bleibt, weil Chrome/Edge ihn auf Deutsch so anzeigen.
- „Nicht mehr folgen“ brach im Menü um; heißt jetzt „Entfolgen“. Geprüft bei 375 px und Desktop: alle Menüpunkte einzeilig.


### Fix: Führungswechsel und Ausgleich innerhalb eines Zugs

- Fehlerbild (Retest Pepper, Testspiel ZZ-A vs. ZZ-B): 5 Führungswechsel und 2 Ausgleiche, aber in „Letzte Ereignisse“ und Verlauf nur „★ ZZ-B gewinnt“.
- Ursache (echte Events gelesen): alle 10 Punkte-Events lagen in Runde 1 / Zug 1 zwischen Zugstart und Spielende. `deriveGameHighlights` verglich den Stand nur an Phasengrenzen (Runden-/Zugstart, Spielende); dazwischen war 0 : 0 -> 19 : 21, also kein Wechsel (erste Führung zählt nicht).
- Fix: `deriveScoreLeadHighlights` prüft den Stand nach jedem nicht widerrufenen Punkte-Event (Undo entfernt das Highlight, negative Korrekturen zählen; gleiche Zeitstempel = ein Schritt). Führungswechsel/Ausgleich aus den Phasengrenzen entfallen dafür. Zeit = auslösendes Event.


### Push-Ticker Stufe (a): installierbare PWA und Folgen pro Gerät (ohne DB)

- PWA: `public/manifest.webmanifest` (standalone, start_url `/#/games`, Farben der App), Icons 192/512/maskable/apple-touch-icon und favicon, `public/_headers` (Manifest-MIME, sw.js no-cache) (`scripts/generate-icons.py`; ein eigenes Logo gab es im Repo nicht, live lief das Netlify-Standard-Favicon), iOS-Meta-Tags.
- Service Worker (`src/pwa/sw.template.js`, beim Build als `/sw.js` mit Build-Kennung): Navigation network-first, `/assets` cache-first, fremde Hosts (Supabase-API/Realtime), `version.json` und `sw.js` nie gecacht. Neuer Build => neuer Cache, `skipWaiting` + `clients.claim`, alte Caches geloescht; Update-Pruefung bei Sichtbarwerden. `push`- und `notificationclick`-Handler vorbereitet (Klick oeffnet das Spiel in View only).
- Folgen pro Gerät (localStorage `match-tracker.push-follow.v1`, `deviceId` UUID, Schema 1): Menuepunkt „Folgen“/„Nicht mehr folgen“ im Spiel (Edit und View only), „Benachrichtigungen“ unter Optionen auf allen Seiten mit Liste der gefolgten Spiele und „Neuen Spielen automatisch folgen“ (nur nach dem Einschalten angelegte, bewusst entfolgte bleiben aus).
- Hinweise (iOS ohne Installation, Berechtigung blockiert, Browser ohne Push, nur https) und ehrlich „Benachrichtigungen kommen bald“. Berechtigung kann erfragt werden; kein Push-Abo (kommt mit Stufe b).


### Entsperren: keine alte Nur-Lesen-Ansicht mehr, Spiel wird wirklich wieder eroeffnet

- Fehlerbild: Nach "Entsperren" eines abgeschlossenen Spiels erschien die alte Nur-Lesen-Ansicht, das Spiel blieb "zu".
- Ursache (per Playwright mit Mock belegt): `handleConfirmReopenGame` setzte den Modus "edit", bevor das Wiedereroeffnen gelang. Abgeschlossen + "edit" renderte die alte Uebersicht (`GameOverview`). Schlug das Wiedereroeffnen fehl (409-Konflikt bei `mt_revoke_event`, Reload auf den Serverstand) oder wurde es blockiert (App-Stand vor PR #7: `shouldBlockGameWrite` blockierte still, keine RPC), blieb genau diese Ansicht mit "Spiel: zu" stehen.
- Fix: Abgeschlossene Spiele zeigen immer View only (auch im Modus "edit"). Edit erst, wenn das Spiel danach wirklich offen ist; sonst zurueck auf View only mit Meldung. Die alte Uebersicht wird nirgends mehr gerendert (auch nicht unter dem Modus-Dialog). Alte Links (`/game/ID/overview`, `?mode=view`, `?view=1`, `?readonly=1`) werden auf View only umgeleitet; Statistik verlinkt nicht mehr auf `/overview`. Der Modus wird nicht in localStorage gespeichert (geprueft).

### Highlights in Ereignisliste und Verlauf, scrollbare Ereignisliste

- Die TV-Highlights (Fuehrungswechsel, Ausgleich, Herausforderungskarten, Zeit-Duell, Zeit-Meilensteine, Rundenabschluss, Spielende) erscheinen als eigene Art "Highlight" (★) in "Letzte Ereignisse" und im Verlauf (Filter "Highlights").
- Abgeleitet aus den vorhandenen Ereignissen (`deriveGameHighlights`), nicht in der DB gespeichert, nicht bearbeit-/loeschbar, ohne Einfluss auf Punkte/Statistik. Undo der Ursache entfernt das Highlight.
- Ereignisliste in View only (laufend und beendet) scrollbar per Touch, Mausrad und Tastatur (fokussierbar), ohne sichtbare Scrollbar, auch im Full screen.

### Menue einheitlich

- Ursache: Gleiches Bauteil `FloatingMenu`, aber im Spiel-Header (Edit) lag das feste Menue in einem Vorfahren mit `backdrop-filter` (Position relativ zur Header-Karte statt zum Fenster), in View only im TV-Raster mit skalierter Schrift (`--tv-unit`, z. B. 11,8 px statt 16 px auf dem Handy) und eigener Position. Statistik hatte keinen Optionen-Bereich.
- Fix: Festes Menue per Portal an `<body>` (im Element-Vollbild an das Vollbild-Element), feste Basisschrift. Statistik bekommt Optionen -> Update. Reihenfolge ueberall Main, Neues Spiel, Statistik, dann Optionen.
- "Entsperren" ohne Unterzeile "Passwort, danach Edit" (einzige Unterzeile in den Menues).

## 2026-10-14

### Nur noch zwei Modi: "Edit" und "View only"

- View only ist die bisherige TV-Ansicht; die separate Nur-ansehen-Ansicht, der Button "TV-Modus" und "TV-Modus verlassen" entfallen. "Full screen" / "Full screen verlassen" bleiben. Scoreboard im Edit oeffnet View only.
- Laufendes Spiel: Dialog "Edit" / "View only". Abgeschlossenes Spiel: immer direkt View only.
- View only komplett schreibgeschuetzt: Verlauf ohne Bearbeiten/Loeschen/Undo/Redo (nicht nur deaktiviert), Store blockiert weiterhin alle Schreibaktionen.
- Menue in View only wie ueberall (Main, Neues Spiel, Statistik, darunter Optionen), im Full screen ausgeblendet. "Entsperren" (Passwort) nur bei abgeschlossenem Spiel; laufende Spiele in View only ohne Entsperren/Edit (Edit nur ueber Main -> Spiel -> Edit).
- Fehlerbild: Entsperren eines abgeschlossenen Spiels bewirkte nichts. Ursache: `shouldBlockGameWrite` blockierte `reopenGame` immer, wenn das Spiel auf der eigenen Seite offen war. Jetzt erlaubt, sobald per Passwort der Modus "edit" gesetzt ist (`canReopenFromGamePage`); danach Edit mit gestopptem Timer.
- Serverseite: RPCs pruefen weder Sperre noch Passwort; das Passwort liegt im Klartext im Client. Vorschlag (nicht ausgefuehrt) unter `supabase/proposed/20261014_01_sperre_passwort.sql` samt Rollback.

## 2026-10-12

### Escape schliesst Menue/Dialoge, Vollbild bleibt bei Menueklick

- Fehlerbild: Im TV-Menue beendete jeder Klick das Vollbild; Escape schloss Dialoge nicht. Ursache: Das Vollbild galt nur der TV-Flaeche, die Dialoge liegen ausserhalb und waeren im Vollbild unsichtbar; deshalb beendete das Menue (PR #5) das Vollbild vor jedem Dialog. Fuer Escape gab es keinen Handler.
- Jetzt: Bei beendeten Spielen gilt das Vollbild dem ganzen Dokument (`TvGameView` `fullscreenDocument`), Menueklicks lassen es an. Escape schliesst zuerst ein offenes Menue (`FloatingMenu`), sonst den obersten Dialog der Spielseite. Hinweis: Im echten Browser-Vollbild beendet Escape zusaetzlich das Vollbild (Browser-Verhalten, nicht abschaltbar).
- Geprueft, unveraendert: Liste und Statistik zaehlen dieselben sichtbaren (nicht geloeschten) Spiele.

### Beendete Spiele oeffnen im TV-Modus mit Spielmenue (ersetzt Abschlussbildschirm)

- Fehlerbild nach dem vorigen Eintrag: Im Abschlussbildschirm passierte beim Klick auf "TV-Modus" nichts. Ursache: `shouldShowSpectatorTv` lieferte fuer beendete Spiele immer `false`, `?tv=1` renderte daher wieder den Abschlussbildschirm (nur der Button verschwand).
- Neu: Ein beendetes Spiel oeffnet fuer alle (Klick in der Liste, `?tv=1`) direkt die TV-Ansicht (`TvGameView`, Zustand "Spiel beendet"); der fruehere Abschlussbildschirm entfaellt. Neues Spielmenue oben rechts in der TV-Ansicht mit allen Funktionen des alten Abschlussbildschirms: Zur Uebersicht, Neues Spiel, Statistik, Scoreboard (frueher Inhalt des Abschlussbildschirms), Verlauf, Notizen, Einstellungen (Details) sowie "Entsperren (Passwort)" = Spiel wieder eroeffnen mit Passwort, danach wie bisher Bearbeitung. Vollbild und "TV-Modus verlassen" (zur Spieleliste) bleiben. Ohne Passwort keine Schreibaktion; Loeschen war im Abschlussbildschirm nicht erreichbar und bleibt es. Laufende Spiele unveraendert. Neue Hilfsfunktionen `shouldShowClosedGameTv`, `getTvModeHash`; Tests angepasst.

### Beendete Spiele zeigen auch im TV-Modus den Abschlussbildschirm

- Ein beendetes Spiel mit TV-Link (`#/game/<id>?tv=1`) zeigt jetzt den gesperrten Abschlussbildschirm (Ergebnis) statt der TV-Ansicht. Laufende Spiele im TV-Modus unveraendert. `shouldShowSpectatorTv` liefert fuer beendete Spiele immer `false`; der Button "TV-Modus" wird im Abschlussbildschirm unter TV-Link ausgeblendet (sonst Schleife). Wiedereroeffnen/Loeschen/Bearbeiten bleiben gesperrt; die TV-Route blockiert Schreibzugriffe weiterhin. Kein Schema-, RPC- oder Versionswechsel. Tests ergaenzt.

### Sync-Absicherung (Versionen, Server-RPCs, strengere RLS)

- Fehlerbild: Zwei Geraete konnten gleichzeitig "Weiter" druecken (doppelte Zugwechsel), gekreuztes Start/Stop mit falscher Geraeteuhr verfaelschte Zeiten, Upserts mit dem oeffentlichen Key ueberschrieben fremde Aenderungen. Ursache: direkte Tabellen-Upserts ohne Versions- oder Zeitpruefung, offene RLS-Policies.
- Neu: `games.version` und `games.flow_version`, RPCs `mt_save_game`, `mt_put_event`, `mt_revoke_event`, `mt_delete_game`, `mt_schema_info` mit Versionspruefung (HTTP 409) und Serverzeit fuer Ablauf-Ereignisse; eindeutiger Index fuer Zug-/Rundenstart; Undo als Gegen-Ereignis (`revoke`); Altdaten als `legacy` markiert.
- App: Queue-Eintraege tragen Basisversionen und Aktionsgruppe; bei 409 wird neu geladen und ein kurzer Hinweis gezeigt; kommutative Ereignisse (Punkte, CP, Notizen) werden nachgespielt. Schema-/Build-Pruefung (`mt_schema_info`, `/version.json`) laedt veraltete Versionen einmal neu. Offline-Queue wird auch bei gesperrter Ansicht nicht ueberschrieben.
- RLS: anon/authenticated duerfen nur noch lesen; Schreiben ausschliesslich ueber die RPCs. Migrationen und Rollback-SQL unter `supabase/migrations/`, SQL-Tests unter `supabase/tests/`.
- `package-lock.json` synchronisiert (`npm ci` gruen).

### Zuschauer sehen nur noch den TV-Modus

- Wer ein laufendes Match mit "Nur ansehen" oeffnet, landet direkt in `#/game/<id>?tv=1`; die klassische Nur-Lese-Ansicht fuer Zuschauer entfaellt. Alte TV-Links (`#/game/<id>?tv=1`, `?tv=1#/game/<id>`, auch mit `/overview`) bleiben TV. "TV-Modus verlassen" fuehrt jetzt zur Spieleliste statt in die Nur-Lese-Ansicht. Spielereingabe ("Bearbeiten") und Uebersicht beendeter Spiele unveraendert. Neue Hilfsfunktion `shouldShowSpectatorTv` mit Tests.

## 2026-10-01

### TV-Modus als 16:9-Dashboard

- Live-Smoke-Fix: Necrons/Dark Angels und Spiegelmatches waren durch aehnliche Fraktionsfarben schwer unterscheidbar; bisher wurde jede Farbe unabhaengig gewaehlt. Gemeinsame Farbwahl erkennt RGB-Abstand unter 100 und waehlt fuer Spieler 2 den weiter entfernten App-Akzent; gilt konsistent fuer Karten, Charts, Zeiten und Highlights. Tests fuer alle Armeepaare, Normalisierung, unbekannte Fraktionen und unveraenderte unterscheidbare Farben.
- Beendete Spiele zeigten weiterhin laufenden/aktuellen Zug und Rueckstand, weil ihre Beschriftungen nicht nach Abschluss unterschieden. Jetzt letzte Zugzeit/letzter Zug und Ergebnis aus `getGameOutcome`, mit VP-Vorsprung bzw. Unentschieden; Aufgabe wird ohne erfundenen Punkte-Vorsprung angezeigt. Laufende Spiele bleiben unveraendert; Komponententests ergaenzt.

- TV-Feinschliff nach Browser-Runde 2: Unteres Panel lief durch knappe Zeilenhoehe/vertikale Zeitabstaende noch wenige Pixel ueber; mehr untere Grid-Reserve und kompaktere Zeitabstaende schaffen Luft. Rundentabelle fuellt ihren eigenen Hoehen-Wrapper mit gleichmaessigen Zeilen und groesseren fetten VP; Missionswerte sind 1,4-mal so gross wie Labels. Breitere, deckende Spielerbalken mit gestreiften Sekundaersegmenten und rechter R5-Reserve verbessern die Chart-Lesbarkeit; Legende angepasst.

- Browser-Nachbesserung: Panels schnitten Stat-Kacheln/Phaseninfos/Tabelle/Siegquoten ab; zu kleine Schrift und transparente Highlights erschwerten TV-Lesbarkeit. Ursache: zu niedrige obere Grid-Zeile, unkompakte Flex-/Tabelleninhalte, unter 1,7 vh skalierte Labels und transparente Overlay-Karte. Fix: 38/30/32-Grid, kompakte Tabelle/Bilanz, Mindestschrift, deckender Overlay-Hintergrund/Karte und kurze Ein-/Ausblendung; neue stabile E2E-Hooks.
- SVG-Verlauf fuellt die gemessene Panelflaeche mit groesseren Achsen, dicken Linien/Punkten und gestapelten Primaer-/Sekundaer-Rundenbalken. Zeit-Duell zeigt Gesamtspielzeit und aktuellen Spielerzug; leere Missionsfelder/Detachments werden ausgelassen.
- Zeit-Ueberholen feuerte durch laufende Spielerzeiten praktisch bei jedem Zugwechsel. Neue rein datenbasierte Regel: nur abgeschlossene Runden, mindestens 60 s Vorsprung und Wechsel gegenueber dem letzten eindeutigen kumulierten Zeitfuehrer; Meilensteine bleiben erhalten. Tests decken Zug-Hin-und-Her, Rundengeschichte, 60-s-Grenze und Spielende ab.
- Ereignisse ruecken per FLIP/Web Animations API sanft nach; Austritte bleiben 400 ms als absolut positionierte `tv-event--leaving` erhalten, maximal acht aktive Eintraege. Tests fuer schnelle Updates, Removal/Cleanup, Spielwechsel und reduzierte Bewegung. Keine neuen Abhaengigkeiten, Spielmutationen oder Schemaaenderungen.

- Fehlerbild: Der TV-Modus wirkte wie ein vergroessertes mobiles Scoreboard mit fremden Farben und wenig genutzter Bildschirmflaeche. Ursache: zweispaltiges Mobil-Layout und fest codierte TV-Oberflaechen statt App-Designvariablen.
- Neu: proportional skaliertes Landscape-Grid im App-Kartenstil mit Fraktionsakzenten, grossen VP-/Phasenwerten, Primaer/Sekundaer/CP/Spielerzeiten, kumulativem SVG-Verlauf, kompakter Rundentabelle, Zeit-Duell, Missionskarte und Rueckstand ohne Prognose. Scrollbarer Fallback fuer Hochkant/kleine Viewports.
- Pure Auswertungen fuer die letzten acht Ereignisse (neueste oben, deutsche Texte, stabile IDs/Einblendung/Fade), direkte Spielerbilanz und Gesamt-Siegquoten nach normalisierten Namen; nur abgeschlossene, wertbare Spiele, explizite Draw-/Concede-Regeln.
- Erweiterbare Highlight-Regeln mit deterministischen IDs: Fuehrungswechsel/Ausgleich, 6-VP-Schwelle, Zeit-Ueberholen/Meilensteine, Rundenstand und Endergebnis. Nur bei Phasenwechseln nach dem Laden, deduplizierte lokale Vier-Sekunden-Queue, reduzierte Bewegung respektiert.
- Strikt lesend: nur Spiel-Props und bereits geladene Store-Spiele; Server-Ticker, bestehende Timer-/Scoreberechnungen, Wake Lock, Vollbild/WebKit und die zwei ausblendenden Bedienelemente bleiben erhalten. Keine Aenderung an Editor, Schreibsperren, Schema oder Abhaengigkeiten; kein Netzwerk.
- Neue Node/CommonJS-Tests fuer Auswertungen und TV-Komponentenablaeufe; PROJECT_CONTEXT um Wertungsdefinition und Highlight-Ausloesung ergaenzt.

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
