# Match Tracker MVP

Mobile-first Web-App zum Tracken von Warhammer- und Tabletop-Spielen fuer kleine Spielgruppen. Die App speichert Spiele und Events in Supabase, trennt Primary und Secondary sauber, bietet JSON-Import/Export und ist auf schnelles Bedienen waehrend des Spiels ausgelegt.

## Entscheidungen

- Vite + React + TypeScript ohne UI-Framework, damit die Struktur klein und wartbar bleibt.
- Routing ueber `location.hash`, damit keine zusaetzliche Router-Abhaengigkeit noetig ist und Netlify spaeter unkompliziert bleibt.
- Datenhaltung eventbasiert mit Supabase als Source of Truth hinter einem kleinen Repository-Layer.
- Mobile-first Layout mit grossen Action-Buttons und kompakten Scoreboards fuer die Nutzung waehrend des Spiels.

## Umgebungsvariablen

Lege lokal eine `.env.local` an:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Fuer Netlify spaeter dieselben Variablen im Site-Settings-Bereich unter `Environment variables` setzen.

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
- `src/pages`: Games, Neues Spiel, Live-Tracker, Statistik
- `src/types`: zentrale TypeScript-Modelle
- `src/store`: React Context fuer App-State und Supabase-Sync
- `src/services`: Repository-Layer fuer Spiele und Events
- `src/lib`: Supabase-Client und Konfiguration
- `src/utils`: Berechnungen, Zeit- und Import/Export-Helfer
- `src/data`: Seed-Daten fuer Demo-/Importfaelle
- `src/styles`: globale Styles
