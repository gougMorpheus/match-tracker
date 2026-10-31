# Match Tracker MVP

Mobile-first Web-App zum Tracken von Warhammer- und Tabletop-Spielen fuer kleine Spielgruppen. Die App speichert Spiele und Events in Supabase, trennt Primary und Secondary sauber, bietet JSON-Import/Export und ist auf schnelles Bedienen waehrend des Spiels ausgelegt.

## Entscheidungen

- Vite + React + TypeScript ohne UI-Framework, damit die Struktur klein und wartbar bleibt.
- Routing ueber `location.hash`, damit keine zusaetzliche Router-Abhaengigkeit noetig ist und Netlify spaeter unkompliziert bleibt.
- Datenhaltung eventbasiert mit Supabase als Source of Truth hinter einem kleinen Repository-Layer.
- Mobile-first Layout mit grossen Action-Buttons und kompakten Scoreboards fuer die Nutzung waehrend des Spiels.
- Spielernamen werden lokal gemerkt und koennen bei neuen oder bestehenden Spielen erneut ausgewaehlt werden.
- Armee-Punkte gelten als gemeinsame Spielpunktzahl pro Match und nicht mehr separat pro Spieler.
- Runde und Zug laufen ueber einen einzigen `Weiter`-Ablauf, damit die Bedienung im Spiel moeglichst schnell bleibt.

## Umgebungsvariablen

Lege lokal eine `.env.local` an:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_DASHBOARD_SUPABASE_URL=
VITE_DASHBOARD_SUPABASE_PUBLISHABLE_KEY=
```

`VITE_SUPABASE_*` bleibt das Spiel-Projekt (privat). `VITE_DASHBOARD_*` ist die Anmeldung an der Projektübersicht (geschäftlich, nur lesen). Beide Dashboard-Variablen leer lassen heißt: kein Login, Edit und View only wie bisher. Für Netlify dieselben Namen unter Environment variables setzen. Der Dashboard-Schlüssel ist der öffentliche Publishable-Key, kein Secret.

## Supabase Setup

Die Datei `supabase/schema.sql` vollstaendig im Supabase SQL Editor ausfuehren. Sie legt Tabellen, Indizes, Constraints, RLS und die einfachen MVP-Policies an.

## Start

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Struktur

- `src/components`: wiederverwendbare UI-Bausteine
- `src/pages`: Games, Neues Spiel, Live-Tracker mit Editierfunktion, Statistik
- `src/types`: zentrale TypeScript-Modelle
- `src/store`: React Context fuer App-State und Supabase-Sync
- `src/services`: Repository-Layer fuer Spiele und Events
- `src/lib`: Supabase-Client und Konfiguration
- `src/utils`: Berechnungen, Zeit- und Import/Export-Helfer
- `src/data`: Seed-Daten fuer Demo-/Importfaelle
- `src/styles`: globale Styles

## Supabase-Keepalive (GitHub Actions)

Das kostenlose Supabase-Projekt `match-tracker` wird sonst nach ca. 7 Tagen zu geringer Datenbankaktivitaet pausiert. Der Workflow `.github/workflows/supabase-keepalive.yml` verhindert das kostenlos:

- Laeuft 4x taeglich (UTC 02:17, 08:17, 14:17, 20:17 = Berlin 04:17, 10:17, 16:17, 22:17 im Sommer bzw. eine Stunde frueher im Winter) sowie manuell (`gh workflow run "Supabase Keepalive"`).
- Fuehrt echte PostgREST-Leseabfragen aus (`games`, `events`, Zaehlung), die bis in Postgres laufen. `/auth/v1/health` zaehlt nicht als Aktivitaet und wird nicht benutzt.
- Prueft HTTP-Status und ein gueltiges JSON-Array. Jeder Fehler macht den Lauf ROT; GitHub schickt dann eine Benachrichtigung bzw. Workflow-Mail (Einstellung: GitHub > Settings > Notifications > Actions > "Send notifications for failed workflows only").
- Schluessel liegen nur als Repository-Secrets `SUPABASE_URL` und `SUPABASE_PUBLISHABLE_KEY` (Settings > Secrets and variables > Actions). Nie im Klartext ins Repo oder in Logs schreiben.

> **WARNUNG: GitHub schaltet Zeitplaene (`schedule`) in Repos nach ca. 60 Tagen ohne Repo-Aktivitaet automatisch ab.** Dann laeuft der Keepalive nicht mehr und Supabase pausiert das Projekt. Gegenmassnahme: Der Job `repo-aktivitaet` im selben Workflow erzeugt automatisch einen kleinen Heartbeat-Commit (`.github/keepalive-heartbeat.txt`) auf `main`, wenn der letzte Commit aelter als 45 Tage ist. Bekommst du von GitHub trotzdem die Mail "scheduled workflow disabled", unter Actions > Supabase Keepalive > "Enable workflow" klicken. Ein Push auf `main` kann einen Netlify-Build ausloesen (gleicher Code, nur eine Textdatei geaendert).
