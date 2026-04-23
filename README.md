# Match Tracker MVP

Mobile-first Web-App zum Tracken von Warhammer- und Tabletop-Spielen fuer kleine Spielgruppen. Das MVP speichert Daten lokal im Browser, trennt Primary und Secondary sauber, bietet JSON-Import/Export und ist so strukturiert, dass spaeter ein Supabase-Repository neben dem Local-Repository ergaenzt werden kann.

## Entscheidungen

- Vite + React + TypeScript ohne UI-Framework, damit die Struktur klein und wartbar bleibt.
- Routing ueber `location.hash`, damit keine zusaetzliche Router-Abhaengigkeit noetig ist und Netlify spaeter unkompliziert bleibt.
- Datenhaltung eventbasiert mit lokalem Repository (`localStorage`) hinter einer kleinen Repository-Abstraktion.
- Mobile-first Layout mit grossen Action-Buttons und kompakten Scoreboards fuer die Nutzung waehrend des Spiels.

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
- `src/store`: React Context fuer lokalen State
- `src/utils`: Berechnungen, Zeit- und Import/Export-Helfer
- `src/data`: Repository- und Seed-/Storage-Konstanten
- `src/styles`: globale Styles

## Spaetere Erweiterungen

- Supabase-Repository als Alternative zum Local-Repository einhaengen
- feinere Statistik-Filter
- Bearbeiten oder Duplizieren bestehender Spiele
