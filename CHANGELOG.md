# Changelog

Kurz, chronologisch absteigend. Jede Code- oder Projektbearbeitung bekommt einen Eintrag.
Bei Bugfixes immer Fehlerbild und Ursache nennen.

## 2026-10-22 – TV und Übersicht zeigen den aktiven Zug; Verlaufs-Label, Rückgängig von Timer an/aus, Startspieler nach Neuladen
- Fehlerbild (Pepper-Retest von 6ada487d): Nach Zurück bzw. Rückgängig war R1Z1 mit ZZ-B aktiv und die Zeiten stimmten. Die TV-Ansicht zeigte aber „Runde 1 · Zug 2“ und ZZ-A „Am Zug“. Ursache: Kopfzeile und „Am Zug“ (TV) sowie „aktueller Zug“ (Übersicht) kamen aus dem neuesten Zug (`getCurrentRoundNumber`/`getCurrentTurnNumber`/`currentPlayerId`), die Zeiten aus `getActiveTurn`. Lösung: alles aus `getActiveTurn`.
- Rückgängig von „Timer aus“/„Timer an“/Time-out nach einem Zugwechsel bei gestopptem Timer: Der Timer lief danach wieder im alten Zug, die Anzeige blieb aber auf dem angewählten Zug, also verdeckt. Jetzt wird der laufende Zug bzw. die Aufstellung angewählt. Das Label „Timer aus“ bleibt nach einer Navigation bei gestopptem Timer korrekt stehen: Die Navigation schreibt nichts und ist kein Verlaufseintrag.
- Verlaufs-Label: Weiter aus der Aufstellung hieß „Weiter R1 Z1“ (Ziel), sonst nennt das Label den verlassenen Zug. Jetzt heißt es „Weiter Aufstellung“.
- Startspieler-Dialog: Beim Laden aus dem lokalen Cache (offline/ausstehend) wurde ein noch leerer Startspieler still auf Spieler 1 gesetzt, sodass der Dialog nicht mehr kam. Jetzt bleibt er leer, wie beim DB-Laden. Altdaten ohne das Feld fallen weiter auf Spieler 1 zurück.
- Tests: E2E 23 Schritte (neu: TV nach Zurück, Undo „Timer aus“ nach Zugwechsel, Label, Startspieler-Dialog aus laufender und gestoppter Aufstellung), Unit-/Statiktests in `tests/zurueckTimer.test.cjs`. Der TV-Schritt schlägt gegen den alten Code an („Runde 1 · Zug 2“). Keine Änderung an Zeit- oder Statistikberechnung.

## 2026-10-22 – Nachtrag zu #40: gleiche Zug-Zeitlogik auch für aus der DB geladene Spiele
- Fehlerbild: Nach #40 zählte die neue Timer-Regel nur in der lokalen Auswertung (`gameState.buildRoundsFromTimeEvents`). Spiele aus der DB (Laden, Neuladen, andere Geräte, Zuschauer/TV, Statistik) liefen über die zweite Auswertung `supabaseGameMapping.buildRoundsFromTimeEvents` mit der alten Logik (`turn-resume` nach `turn-end` ignoriert) → je nach Weg unterschiedliche Zeiten.
- Lösung: Zug-Zeitlogik (Wiederöffnen, nie zwei laufende Züge, Aufstellung als zählende Phase) in `utils/turnTiming.ts`, beide Auswertungen nutzen sie.
- Alte Spiele (offline, Backup nach-loeschen-zz-1a1a73cf, 44 Spiele ohne deleted_at): 21 mit geänderten Zeitwerten. Abgeschlossene Spiele bekommen die Zeit nach „Zurück“ im damals angewählten Zug (z. B. dd87ec49 R3Z1 +8,6 min). Offene Altspiele vom Mai, in denen ein beendeter Zug fortgesetzt und nie gestoppt wurde, zählen jetzt bis heute (laufender Zug). Statistik: 47 Werte ändern sich (Dauer, Zugzeiten und, weil Züge unter 10 s nicht in die Statistik eingehen, einige Ø-CP-Werte); Siege/Niederlagen unverändert. Keine Datenänderung.
- Test: `tests/zurueckTimer.test.cjs` prüft für alle Szenarien DB-Abbildung = lokale Auswertung (schlägt gegen #40 an).

## 2026-10-22 – Timer: genau ein aktiver Zug, Navigation nimmt den Timer mit (Regel Tim 22.10., ersetzt #39 und die Regel vom 15.10.)
- Regel: Es zählt immer genau der angewählte Zug bzw. die Aufstellung. Weiter/Zurück/Rückgängig (auch Aufstellung ↔ R1Z1) stoppen und starten den Timer nie: läuft er, läuft er im neuen Zug weiter; ist er gestoppt, bleibt er gestoppt. Gestoppt wird nur per Timer-Knopf, Time-out oder Abschluss. Kein Zug läuft verdeckt weiter.
- Fehlerbilder: (1) #39: Nach „Zurück“ lief R1Z2 verdeckt weiter (Pepper). (2) Rundenzeit sprang auf dem Vorzug bei „Timer aus“ von 1m 54s auf 3s (Anzeige summierte bei gestopptem Timer nur Züge bis zum angewählten). (3) Ursache dd87ec49: `turn-resume` auf einen beendeten Zug wurde in `buildRoundsFromTimeEvents` ignoriert → Zeit zählte nirgends; ein zweiter Aufstellungs-Abschnitt (Zurück in die Aufstellung) wurde in `getSetupBaseDurationMs` ignoriert. (4) Rückgängig von „Weiter“ setzte den Vorzug auch bei gestopptem Timer fort und sprang zur Anzeige auf den neuesten Zug. (5) „Weiter“ über den Startspieler-Dialog aus gestoppter Aufstellung ließ R1Z1 laufend starten.
- Auswertung (`gameState.ts`): `turn-resume` auf einen beendeten Zug öffnet ihn wieder (Lücke = Pause). Startet/läuft ein anderer Zug oder die Aufstellung, wird ein laufender anderer Zug implizit pausiert und ein wieder geöffneter wieder beendet → nie zwei laufende Züge. Aufstellung mit mehreren Abschnitten (`gameCalculations.ts`), `isSetupActive` endet auch mit `turn-start`/`turn-resume`.
- Spielseite: ein Timer-Zustand pro Spiel; Timer-Knopf/Time-out wirken auf die laufende bzw. (gestoppt) die angewählte Phase; „Zurück“/„Weiter“ schreiben nur bei laufendem Timer Events (Pause alter Zug + Fortsetzen neuer Zug); Rückgängig/Redo von Weiter/Zurück = gleiche Navigation ab dem angewählten Zug. Auswahl nach dem Laden, Zuschauer und TV folgen dem aktiven Zug (`getActiveTurn`). Time-out-Ende setzt im angewählten Zug fort. Rundenzeit = alle Züge der Runde. `getTimerControlTurn` (#39) entfernt. Wiedereröffnetes Spiel: „Timer an“ zählt wieder (vorher ignoriert).
- Keine Schemaänderung, keine Datenkorrektur. Alte Spiele: Offline-Vergleich alt/neu (Backup nach-pr39, 44 Spiele ohne deleted_at): 11 Spiele mit geänderten Zeitwerten (Details Deploy-Notizen), Statistikseite nur 2 Zeitwerte um 1 min (Ø Dauer 3h 11m → 3h 10m, Matchup Aeldari vs Necrons 3h 45m → 3h 44m), Siege/Punkte/CP unverändert.
- TV-Knopf „Link teilen“ (#39) bleibt.
- Tests: `tests/zurueckTimer.test.cjs` (alle Navigationswege mit laufendem/gestopptem Timer, Aufstellung, Timer-Knopf, Time-out, Abschluss + Wiedereröffnen, Anzeige = Statistik, Verdrahtung), E2E `npm run test:zurueck-e2e` (19 Schritte offline, schlägt gegen main an).

## 2026-10-22 – „Zurück“ bei laufendem Timer verliert keine Zeit mehr; TV-Knopf „Link teilen“
- Fehlerbild (Spiel dd87ec49, 16.10.): Nach „Zurück“ bei laufendem Timer zählten ca. 8,6 min von Tims Zug R3Z2 nirgends.
- Ursache: `handleGoBack` (GamePage) rief `rewindLastTurn(…, keepTimerRunning = true)` auf. Das schrieb `turn-pause` für den laufenden Zug und `turn-resume` für den bereits beendeten Vorzug. Die Auswertung (`buildRoundsFromTimeEvents` in `gameState.ts`) ignoriert `turn-resume` nach `turn-end`, Anzeige und Statistik zählten die Zeit bis zum nächsten „Weiter“ daher keinem Zug zu.
- Lösung: „Zurück“ auf einen älteren Zug ist nur noch Ansicht und schreibt keine Timer-Events; der laufende Zug läuft weiter (wie im Bearbeiten-Modus). Beim Ansehen eines beendeten älteren Zugs wirken Status, „Timer an/aus“ und Time-out auf den neuesten Zug (`getTimerControlTurn`), ein beendeter Zug wird nie fortgesetzt. „Weiter“ auf einen vorhandenen Folgezug und „Zurück“ in die Aufstellung unverändert. Keine Schemaänderung, alte Spieldaten (dd87ec49) unverändert.
- TV-Ansicht: Knopf „Link teilen“ in der TV-Leiste neben „Full screen“ (auch bei beendetem Spiel und pausierter Live-Ansicht); gleiche Funktion wie der Menüpunkt (Direktlink `#/game/<id>?tv=1`, kopieren + „Link kopiert“, mobil Teilen-Dialog).
- Tests: `tests/zurueckTimer.test.cjs` (Ursache mit App-Auswertung belegt, Timer-Ziel, Verdrahtung), `tvGameView` (Knopf), E2E `npm run test:zurueck-e2e` (offline, ZZ-Spiel im lokalen Cache; schlägt gegen den alten Code mit `turn-pause R1Z2` + `turn-resume R1Z1` an).

## 2026-10-19 – Stufe E: Battle-Cal für alle an, alte Site leitet um
- Schalter Battle-Cal jetzt standardmäßig AN (Menüeintrag, `#/battle-cal`, `/battle-cal/`). `?battlecal=0` schaltet auf dem Gerät aus (gemerkt als "0"), `?battlecal=1` wieder ein. Ohne localStorage: AN.
- Hinweis bei ausgeschaltetem Schalter: „Battle-Cal ist auf diesem Gerät ausgeschaltet.“ mit Link zum Einschalten.
- Alte Site battle-cal.netlify.app (direkter Netlify-Deploy, nicht aus dem Repo): `/umzug.html` (Umzugsseite aus `tools/battle-cal/umzug/`) bleibt erreichbar, alles andere `301` auf `https://40k-match-tracker.netlify.app/?battlecal=1#/battle-cal`.
- Tests: Standard AN, AUS gemerkt, Wiedereinschalten, ohne localStorage AN; E2E frischer Browser ohne Schalter.

## 2026-10-19 – Battle-Cal: Passwort ändern fragt das alte Passwort immer ab (Bugfix aus Peppers Retest von #35)
- Fehlerbild: Nach „Passwort setzen“ oder Speichern in derselben Sitzung meldete „Passwort ändern“ auch mit falschem altem Passwort „Passwort geändert.“.
- Ursache: `setCloudProfilePassword` nahm `oldPassword = cloudProfilePassword || await requestPassword(...)`. Das gemerkte Sitzungs-Passwort (nach „Passwort setzen“ das gerade gesetzte) wurde als altes Passwort geschickt, die Abfrage des alten Passworts entfiel; der erste sichtbare Dialog war schon „Neues Passwort …“. Die DB-Prüfung in `bc_profile_set_password` war korrekt, sie bekam nur das richtige Passwort.
- Fix: Beim Ändern wird das bisherige Passwort (oder Admin-Passwort) immer neu abgefragt. Bei falschem altem Passwort bleibt das gemerkte Sitzungs-Passwort unverändert (weder geleert noch überschrieben). Keine DB-/Schemaänderung.
- Tests: statischer Test (kein `cloudProfilePassword ||` in `setCloudProfilePassword`), E2E-Fall ohne Neuladen mit „falsch-123“.

## 2026-10-19 – Egress: Vollabzug seltener und schlanker (SPIELTAG-2026-10-19.md, Vorschläge 1 und 2)
- Anlass: Nach #27/#28 machte der Vollabzug (alle Spiele mit allen Events, ≈ 0,97 MB) ≈ 85 % des Spieltags-Egress aus (alle 10 min und bei jeder Rückkehr in den Tab).
- Vollabzug spätestens alle 30 min (vorher 10). Bei Rückkehr in den Vordergrund nur nach mehr als 5 min im Hintergrund, sonst normaler Delta-Abgleich.
- Der Vollabzug lädt alle Spielzeilen, Events aber nur für Spiele mit Aktivität in den letzten 7 Tagen sowie neue/geänderte/markierte Spiele; ältere behalten die Events aus dem Cache. Bewusste Grenze: Revoke eines Nicht-Ablauf-Events in einem älteren Spiel ohne Versionserhöhung erscheint erst nach Neustart der App.
- Unverändert: Delta-Abgleich, Aktivfenster 12 h, Takt 60/15 s bzw. TV 30/10 s, Vollabzug bei Start, online und Realtime-(Wieder-)Verbindung, TV-Verhalten aus #29–#31.
- Mock-Messung (Backup-Daten): Rückkehr nach 1 s 3 KB statt ≈ 0,9 MB; Vollabzug ≈ 0,2 MB statt ≈ 0,9 MB. Echte Messung am ersten Spieltag.

## 2026-10-19 – Battle-Cal: Profile ohne Passwort wie im Original, Passwort setzen/ändern
- Fehlerbild: Tims importiertes Profil hatte im Original kein Passwort; im Match-Tracker war es gesperrt (nur Lesen). Ursache: `password_hash` war Pflicht, der Import setzte einen Sperrwert.
- DB-Migration `20261019_03_battlecal_ohne_passwort.sql` (separat ausgeführt): `password_hash` darf NULL sein (= kein Passwort), Sperrwert → NULL. Profile ohne Passwort speichern und umbenennen ohne Passwort (wie im Original). Profil ohne Passwort löschen nur mit Admin-Passwort (Schutz).
- Neu `bc_profile_set_password`: ohne bisheriges Passwort frei setzbar, sonst nur mit altem oder Admin-Passwort; nur bcrypt-Hash gespeichert. Profil-Liste zeigt `has_password`, nie den Hash.
- App: keine Passwortabfrage bei Profilen ohne Passwort; Knopf „Passwort setzen“ bzw. „Passwort ändern“ im Profil-Dialog.
- Profil anlegen verlangt weiterhin ein Passwort (wie das Löschpasswort im Original).

## 2026-10-19 – Battle-Cal UX (Peppers Befunde A/B/C, freigegeben von Cosy)
- A: Auf der Battle-Cal-Seite gibt es kein zweites ☰ mehr. Fehlerbild: zwei gleiche ☰ ohne Beschriftung (Match-Tracker und Battle-Cal). „Zurück“ bleibt.
- B: Eingebettet ist der Hintergrund jetzt durchsichtig, und der iframe endet am unteren Fensterrand. Fehlerbild: dunklerer Kasten mit harter Kante; „Berechnen“ war nur nach Scrollen sichtbar (E). Ursache: Der iframe war höher als das sichtbare Fenster, dadurch lag die feste Leiste unten außerhalb.
- C: Der Match-Tracker-Titel „Battle-Cal“ ist auf dieser Seite nur optisch ausgeblendet (bleibt für Screenreader). Fehlerbild: Überschrift dreifach.
- D bleibt wie im Original (Entscheidung Cosy 19.10.): „Berechnen“ speichert den Eintrag lokal im Verlauf (Original a8ce471 `calculateAndStore`, `saveHistory()`).
- Keine DB-Änderung.

## 2026-10-19 – Battle-Cal-App im Match-Tracker (D2, hinter Schalter, Standard AUS)
- `/#/battle-cal` bettet jetzt die Battle-Cal-App ein (statische Seite `/battle-cal/`, erzeugt aus `src/battle-cal/battle-cal.html`). Funktionsumfang wie das Original (gougMorpheus/battle-cal `index.html`, Commit a8ce471). Erzeugt mit `tools/battle-cal/patch-original.py`; die Rechenlogik ist unverändert.
- Daten nur noch über `public.bc_*` (ein `fetch` auf `/rest/v1/rpc/bc_*`), kein direkter Tabellenzugriff. Altes Projekt und alter Key sind entfernt. URL und Key des Match-Trackers setzt der Build ein (`vite.config.mjs`).
- Passwörter:
  - Schreiben (Historie, Armeen) verlangt das Profil-Passwort. Es wird einmal pro Sitzung abgefragt, serverseitig geprüft und nur im Arbeitsspeicher gehalten (nie localStorage/sessionStorage).
  - Umbenennen und Löschen eines Profils gehen mit Profil-Passwort oder Admin-Passwort. Das alte Master-Passwort und die Prüfung im Browser entfallen.
  - Löschen ist weich.
- Armeeliste importieren ersetzt jetzt in einem Aufruf (`bc_roster_import`). Eine Armee wird mit `bc_roster_get` in einem Aufruf geladen (vorher je Einheit ein Aufruf).
- Umzug vorbereitet:
  - Die neue Seite nimmt mit `?umzug=1` Daten per postMessage nur von `https://battle-cal.netlify.app` an. Sie fragt vorher nach, überspringt doppelte Einträge und bereinigt das Vergleichs-HTML.
  - Datei-Import im Format `battle-cal-umzug` ist möglich.
  - Die Umzugsseite für die alte Site liegt in `tools/battle-cal/umzug/`. Sie ist NICHT deployt, es gibt keine Weiterleitung.
- DB-Migration `20261019_02_battlecal_app.sql` (separat ausgeführt):
  - ID-Grenzen auf 500 Zeichen, weil die Original-App längere IDs erzeugt
  - `bc_roster_import`, `bc_results_upsert_many`
  - Rollback: `…battlecal_app.rollback.sql`
  - MT-Tabellen, mt_* und Realtime unverändert.
- Tests:
  - battleCal ist um statische Regeln für App, Umzug und Migration 02 erweitert (lokaler SQL-Lauf inkl. 02 und Rollback).
  - Neu `npm run test:battlecal-e2e`: Browser gegen den lokalen RPC-Mock mit lokalem Postgres, 16 Schritte, alles außerhalb localhost blockiert.

## 2026-10-19 – Battle-Cal Basis (hinter Schalter, Standard AUS)
- Service Worker: Nur „/“ bzw. „/index.html“ werden als App-Hülle gespeichert. Unterseiten (z. B. /battle-cal/) bekommen einen eigenen Cache-Eintrag und überschreiben die Match-Tracker-App nicht mehr. Offline-Verhalten der App unverändert.
- Neue Route `/#/battle-cal` (Platzhalter) und Menüeintrag „Battle-Cal“ im Hauptmenü (Liste, Statistik), nur sichtbar mit Schalter: `?battlecal=1` einmal öffnen (merkt sich das Gerät), `?battlecal=0` schaltet ab. Ohne Schalter ändert sich nichts.
- DB-Migration `20261019_01_battlecal_basis.sql` (separat ausgeführt): Schema `battlecal` (nicht per REST freigegeben, keine anon-Rechte, RLS ohne Policies), leere Tabellen, RPCs `public.bc_*` (SECURITY DEFINER, bcrypt per pgcrypto, Profil-Passwort für Schreiben, Admin-Passwort serverseitig per Vault-Hash, weich löschen). Rollback: `…battlecal_basis.rollback.sql`. MT-Tabellen, mt_* und Realtime unverändert.
- Tests: swNavigation, battleCal (Schalter, Menü, SQL-Regeln; mit `BC_LOCAL_PG` zusätzlich echter Lauf gegen lokales Test-Postgres).

## 2026-10-18 – TV: bei Spielende nur „Spiel beendet“
- In der TV-Live-Ansicht zeigt die Pause wegen Spielende nur noch „Spiel beendet“ (kein „Weiter live“, kein Pausentext). Wiederaufnahme kommt weiter per Realtime an (#29/#30 unverändert).
- „15 min ohne Ereignis“: Hinweis und „Weiter live“ unverändert.

## 2026-10-18 – TV folgt auch nach Spielende (Undo)
- In der TV-/Ansichts-Live-Ansicht kommen bei Pause „Spiel beendet“ Realtime-Meldungen des eigenen Spiels weiter durch; eine echte Änderung (z. B. Undo des Spielendes) lädt das Spiel und hebt die Pause auf.
- Nachtrag (#30): Das Laden der Live-Ansicht war bei jeder Pause gesperrt; jetzt nur bei „15 min ohne Ereignis“, damit die Meldung bei Spielende auch wirklich lädt.
- Hinweis mit „Weiter live“ erscheint jetzt auch bei Spielende. „15 min ohne Ereignis“ und Realtime fremder Spiele unverändert.

## 2026-10-18 – Delta-Abgleich: alte Löschungen nicht jedes Mal neu laden
- Fehlerbild: Nach #27 lud jeder Abgleich 24 Spielzeilen und ~770 Events erneut.
- Ursache: 24 alte Spiele sind nur über `notes.deletedMeta` gelöscht (`deleted_at` leer). Sie stehen in der schlanken Liste, wurden aber (richtig) nicht angezeigt und daher nicht im Cache gehalten → jedes Mal „neu“.
- Jetzt: Platzhalter im Cache (nicht angezeigt); erneut geladen nur bei geänderter Version. Vollabzug lädt für sie keine Events (wie vor #27).

## 2026-10-18 – Delta-Abgleich, seltener abfragen, Live-Ansicht nur ein Spiel (Egress, #679)
- Fehlerbild: Supabase-Org über dem Egress-Kontingent (12,4 von 5,5 GB). Jeder Abgleich lud alle Spiele (auch gelöschte) mit allen Events in 100er-Seiten (~1 MB roh / ~120 KB gzip), alle 15 s und zusätzlich nach jeder Realtime-Meldung, in jedem sichtbaren Tab, auch in TV-/View-only-Ansichten (Smart-TV ~250 Vollabzüge/h).
- Ursache: kein Delta, Polling unabhängig von Realtime, TV lud alles.
- Jetzt (`src/utils/deltaPull.ts`, `listGamesDelta`): schlanke Liste `id,version,flow_version` mit `deleted_at=is.null`; volle Zeile/Events nur für neue Spiele, geänderte `version`/`flow_version`, markierte Spiele (eigenes Schreiben, Realtime-Payload mit `game_id`) und aktive Spiele (< 12 h). Vollabzug als Sicherheitsnetz alle 10 min sowie beim Start, Tab-Rückkehr, online und Realtime-(Wieder)verbindung. Fehlt ein Spiel in der Liste, gilt es als gelöscht. Abgleiche laufen nacheinander. Zusammenführung (#23/#25/#26, Konflikte) unverändert.
- Warum aktive Spiele immer: `mt_put_event`/`mt_revoke_event` erhöhen `flow_version` nur bei Ablauf-Events; CP/Punkte/Notizen ändern keine Version, und ein Revoke ist für anon per RLS unsichtbar (kein Realtime).
- Takt: 60 s mit verbundenem Realtime, sonst 15 s. Realtime lädt gezielt das betroffene Spiel.
- Live-Ansicht (View only/TV, ?tv=1): nur das gezeigte Spiel (30 s mit Realtime, sonst 10 s; statt bisher 3 s + Vollabzug). Nach Spielende angehalten; nach 15 min ohne neues Event Hinweis „Live-Aktualisierung pausiert“ mit Knopf „Weiter live“.
- Event-Seiten 1000 statt 100 (PostgREST `max_rows` = 1000 geprüft; Seitengröße darf nie größer als `max_rows` sein).
- Keine Schemaänderung. Tests `tests/deltaAbgleich.test.cjs`.

## 2026-10-16 – Spielzeile nach langsamem Speichern nachsenden
- Fehlerbild: Wurde „Weiter“ gedrückt, während die Spielzeile noch gespeichert wurde, fehlte der Auto-CP-Merker (`notes.optionsMeta.autoCommandPointAwards`) in der DB, obwohl die CP-Events gespeichert waren. Die Anzeige bündelte dann nicht als „(auto CP each)“.
- Ursache: `enqueueSyncQueueItem` überspringt ein neues `upsert-game`, solange schon eines für das Spiel in der Queue steht – auch wenn dieses gerade gesendet wird. Nach dem Speichern wurde der Eintrag entfernt; die Änderung während des Speicherns ging nie raus.
- Jetzt: Nach erfolgreichem Speichern vergleicht `flushSyncQueue` den Fingerabdruck der gesendeten mit der aktuellen lokalen Spielzeile (`decideAfterGameSave`). Abweichung → Eintrag bleibt, sofort erneut senden (mit mitgezogener Version), max. 5× pro Durchlauf, danach Retry statt Endlosschleife. Keine Schemaänderung.
- Tests `tests/spielzeileNachsenden.test.cjs` (langsames `mt_save_game`, Änderung währenddessen).

## 2026-10-16 – Abgleich nach dem Anlegen, Auto-CP nach Zug Start, Bearbeiten ohne Pause
- Fehlerbild 1: Direkt nach „Spiel anlegen“ kurz „Spiel nicht gefunden“, bis neu geladen wurde.
- Ursache 1: Ein Abgleich (15-s-Polling, Realtime, Tab-Wechsel), der VOR dem Speichern gelesen hatte, kam NACH dem Leeren der Queue zurück. Das neue Spiel fehlte in der Antwort und stand nicht mehr in der Queue – `mergeRemoteWithPending` verwarf es.
- Jetzt: Zähler für eigenes Schreiben und lokales Anlegen (`isPullOutdated`). Ein Abgleich, während dessen selbst gespeichert/angelegt wurde, wird verworfen und sofort wiederholt (max. 3×, sonst Refresh in 600 ms). Zusätzlich verwirft `keepLocallyCreatedGames` ein lokal angelegtes Spiel nur, wenn das Laden nach dessen letztem eigenen Speichern begann.
- Fehlerbild 2: Im Editor standen automatische CP+ des neuen Zugs zwischen Runde Ende und Zug Ende (CP wenige ms vor Zug Start gespeichert, Bündelung fehlte).
- Jetzt (`eventOrder.ts`, nur Anzeige): CP und Punkte derselben Runde/desselben Zugs bis 2 s vor dessen Zug Start werden auf Zug Start einsortiert (Rang 55: nach Zug Start, vor Pause). Genutzt von Verlauf, Letzte Ereignisse, TV-Feed (`createEventComparators`, `sortEventsNewestFirst`). Highlights, Push und Zeitauswertung (`timeEventOrder.ts`) unverändert.
- Entscheidung Tim: Bearbeiten eines Punkte-/CP-Eintrags pausiert die Uhr nicht mehr (`openEditor`); Öffnen, Speichern und Abbrechen erzeugen keine Timer-Events. „Zurück“ und Zugauswahl unverändert.
- Tests `tests/abgleichAutoCp.test.cjs`.

## 2026-10-16 – Push: reine ZZ-Testspiele lösen keinen Push aus
- Fehlerbild: Prod-Live-Checks mit ZZ-Testspielen schickten „Spiel gestartet“ und Rundenabschluss an echte Abos.
- Ursache: push-dispatch kannte keinen Ausschluss für Testspiele.
- Jetzt: `isZzOnlyGame` (`src/utils/pushDispatch.ts`): beginnen alle Spielernamen mit „ZZ“, endet der Dispatch mit Status `test-game` vor dem Claim – kein Eintrag in push_sent_highlights, kein Versand. „Statistik: Nicht zählen“ allein schließt nicht aus; gemischte Spiele und echte Spieler werden weiter gepusht. Keine Schemaänderung. Test `tests/pushZz.test.cjs`.

## 2026-10-16 – Aufstellung: kein „Timer gestoppt“ von selbst; feste Reihenfolge bei gleichem Zeitstempel
- Fehlerbild 1: Kurz nach „Spiel anlegen“ erschien in der Aufstellung ohne Eingabe „Timer gestoppt – Der Timer wurde angehalten“, ohne Verlaufseintrag; die Aufstellungszeit lief nicht weiter (in der Rundenphase nicht).
- Ursache 1: `createGame` (GameStore) speicherte nur die Spielzeile (mt_save_game). Die lokal erzeugten Start-Events (game-start, setup-start) standen nicht in der Sync-Queue. Der erste Abgleich nach dem Speichern (Realtime + Pull, `mergeRemoteWithPending`) ersetzt das Spiel durch den Serverstand und behält nur Events aus der Queue – die laufende Aufstellung wurde zu „Bereit“, der Timer-Hinweis zeigte „gestoppt“. setup-start kam erst bei erneutem „Timer an“, game-start erst beim ersten „Weiter“ in die DB. Nicht die Zug-Auswahl aus PR #19.
- Jetzt: `createGame` reiht alle Start-Events ein und speichert sie mit dem Spiel. Folge: Push „Spiel gestartet“ kommt beim Anlegen statt beim ersten „Weiter“. Timer-Logik unverändert. Test `tests/aufstellungOrder.test.cjs`.
- Fehlerbild 2: Gleichzeitige Ereignisse (Zugende, Rundenabschluss, Rundenbeginn, Zugstart, Pause, Highlights) standen je nach Ansicht in unterschiedlicher, teils unlogischer Reihenfolge.
- Jetzt: zentrale Vergleichsfunktion `src/utils/eventOrder.ts` (`compareEventsAsc`/`compareEventsDesc`): Zug Ende → Runde abgeschlossen (★ Rundenabschluss, Zeit-Duell, Meilensteine) → Spielende → Spielstart → Runde beginnt → Aufstellung/Zug Start → Pause, Fortsetzen, CP, Punkte, sonstige Highlights; Anzeige „neueste oben“ genau umgekehrt. Genutzt von Editor-Verlauf, Zuschaueransicht (Letzte Ereignisse, Verlauf), TV-Feed und TV-Einblendungen, Highlights und Push-Reihenfolge. Auswertungsregel „Start vor Pause“ (`timeEventOrder.ts`) bleibt unverändert und passt dazu. Daten unverändert.
- Echte Spiele (49): Highlights inhaltlich, Spiel-, Runden-, Aufstellungs- und Spielerzeiten identisch; nur die Reihenfolge gleichzeitiger Highlights/Pushes ändert sich.

## 2026-10-16 – Push-Abo: Browser und Server abgleichen
- Fehlerbild: Fehlte das Abo im Browser (Berechtigung zurückgenommen, Browser hat es verworfen) oder hatte der Server es nach 404/410 beim Versand entfernt, zeigte die App weiter „Push-Abo auf diesem Gerät ist aktiv“ und meldete das alte, tote Abo erneut an. Ursache: Der Abgleich prüfte nur den Server (mt_push_set_follows), nie `pushManager.getSubscription()`.
- Jetzt: Beim Abgleich (Laden, Änderung der Folgen, Öffnen des Panels) wird zuerst das Browser-Abo geprüft. Fehlt es, wird ein neues angelegt und gespeichert; ein geänderter Endpoint wird gespeichert; kennt der Server das Abo nicht mehr, wird das Browser-Abo erneuert. „Aktiv“ erscheint nur nach erfolgreichem Abgleich, sonst „Push ist auf diesem Gerät nicht aktiv“ mit „Erneut versuchen“. Test `tests/pushAbo.test.cjs`.
## 2026-10-16 – Timer: Zug-Auswahl folgt dem neuen Zug (Timer an nach Neustart, „Timer gestoppt“ von selbst)
- Fehlerbild: Nach Browser-Neustart schrieb „Timer an“ turn-pause für den laufenden Zug (R1Z2) und turn-resume für den alten (R1Z1). Zweitens erschien im Editor „Timer gestoppt – Der Timer wurde angehalten“, ohne dass jemand gestoppt hatte (kein Pause-Event in der DB).
- Ursache: Die Zug-Auswahl (`selectedTurnKey`, GamePage) blieb auf dem bisher neuesten Zug stehen, wenn ein neuer Zug nicht auf diesem Gerät entstand (App startet aus veraltetem lokalem Stand und bekommt dann den neueren Serverstand, oder ein anderes Gerät drückt „Weiter“). Der alte, beendete Zug wurde als „Gestoppt“ angezeigt (daher der Hinweis), und „Timer an“ setzte ihn fort.
- Jetzt (`resolveSelectedTurnKey`, `src/utils/turnSelection.ts`): Wer auf dem bisher neuesten Zug stand, folgt dem neuen neuesten Zug. Bewusste Auswahl älterer Züge (Zurück) und die Aufstellung bleiben erhalten. Timer-Logik unverändert; nach „Weiter“ startet der Zug weiterhin pausiert („Zug noch nicht gestartet“). Test `tests/turnSelection.test.cjs`.
- Echte Spiele: 70 auffällige pause/resume-Paare in 22 Spielen bleiben unverändert (Entscheidung Cosy/Tim).

## 2026-10-16 – „Statistik: Nicht zählen“ nimmt Spiele komplett aus der Statistik
- Fehlerbild: Nicht gelöschte „Nicht zählen“-Spiele (z. B. ZZ-Testspiele) tauchten in den „vs …“-Filtern (Spieler und Armeen) und der Datumsauswahl der Statistik auf und verschoben einzelne Werte (u. a. Spielzähler und Ø-Dauer in einer Detailansicht, Anzahl der Werte bei „Rundendauer über Zeit“). Ursache: Die Statistikseite baute Filteroptionen und Datumsliste aus allen Spielen; nur die Aggregate liefen über `prepareGamesForStats`.
- Jetzt: `isGameExcludedFromStats` / `removeExcludedStatsGames` (gameCalculations.ts). Die Statistikseite arbeitet nur noch mit Spielen ohne das Flag; `prepareGameForStats` gibt für sie immer `null` zurück, auch wenn Bereichs-Overrides etwas einschließen würden. Bilanz und Siegquote (TV-Ansicht, headToHead.ts) überspringen sie ebenfalls.
- Events laden: `fetchEventsForGameIds` sortiert zusätzlich nach `id`. Fehlerbild: Beim seitenweisen Laden (je 100) fehlten an Seitengrenzen einzelne Events, andere kamen doppelt, sobald mehrere Events denselben Zeitstempel hatten (z. B. Rundenende/Rundenstart/Zugstart). Welche Events betroffen waren, hing von der Gesamtzahl ab – deshalb verschoben auch „Nicht zählen“-Spiele die Statistik echter Spiele (am 16.10. je 1 Event in 9e2234ac und 6821b02a; u. a. Runde 4: 9 statt 10 Spiele). Nur Anzeige/Lesen, in der DB fehlte nichts.
- Spiele mit `auto`/`include` oder nur einzelnen Bereichs-Overrides sind unverändert. Test `tests/statsExclude.test.cjs` mit 16 echten Spielen: Statistik mit und ohne zusätzliche Nicht-zählen-Spiele identisch.

## 2026-10-16 – Retest Pepper 2: Match öffnen, erste Führung als ★, Öffnen aus Notifications, Reihenfolge
- „Match öffnen …“ steht jetzt bei jedem laufenden Spiel im Menü, in Edit und in View only. Fehlerbild vorher: Der Punkt erschien nur in View only und nur, wenn auf diesem Gerät „View only“ gemerkt war (Bundle 6ad1cc5c war korrekt live).
- Führung: Die erste Führung im Spiel (z. B. 0 : 0 → 1 : 0) ist jetzt ein ★-Highlight „Führung · … geht in Führung“ und wird gepusht (gleiche Funktion `deriveScoreLeadHighlights` für Liste, Verlauf, TV-Einblendung und Push). Fehlerbild vorher: Nur echte Wechsel (anderer Führender als zuletzt) waren ★; die erste Führung stand nur als Punktezeile da. Wieder-Führung desselben Spielers nach Ausgleich bleibt ohne ★ (der Ausgleich selbst ist ★).
- Notifications → Gefolgte Spiele → „Öffnen“ öffnet View only (wie der Klick auf den Push), vorher Edit.
- Reihenfolge bei gleichem Zeitstempel: „★ Runde n abgeschlossen“ steht jetzt unter (= vor) „Runde n+1 beginnt“ (`getSameTimeRank` in eventGrouping, auch im Verlauf). Ursache: Gleichstand wurde in der Endsortierung (neueste zuerst) nach ID entschieden; „highlight:…“ ist im Vergleich größer als jede Event-UUID und landete deshalb oben. Gilt für Verlauf und TV-Ereignisse.

## 2026-10-16 – Kleinigkeiten: Match öffnen merken, Enter im Namensfeld, „+ Spieler“
- „Match öffnen“ (Edit / View only) wird pro Spiel und Gerät gemerkt (localStorage `match-tracker.access-mode.v1`, `src/utils/accessModeMemory.ts`). Fehlerbild vorher: Nach jedem Neuladen fragte der Dialog erneut, weil die Wahl nur im Arbeitsspeicher lag. Gilt nur für laufende Spiele; View-only-Links (?tv=1) und der Passwortschutz (Entsperren) bleiben unverändert. Wer ein Spiel anlegt, ist auf diesem Gerät gleich in Edit gemerkt. Wer „View only“ gewählt hat, findet im Menü „Match öffnen …“, um neu zu wählen.
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
