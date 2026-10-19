# Umzugsseite für battle-cal.netlify.app (vorbereitet, NICHT deployt)

Stand 19.10.2026. Nur gebaut und lokal getestet (`tests/battleCalApp.e2e.cjs`, Teil „Umzug“). Auf der alten Netlify-Site ist **nichts** geändert,
es gibt **keine** Weiterleitung.

## Was die Seite tut
- Liest im Browser der alten Origin die lokalen Daten: `wh40k-prob-history-v1` (Historie), `wh40k-army-compare-history-v1`
  (Armeevergleiche) und vom gespeicherten Cloud-Profil nur `id`/`name` (**nie** das alte Löschpasswort).
- **Daten mitnehmen**: öffnet `https://40k-match-tracker.netlify.app/battle-cal/?umzug=1`. Die neue Seite meldet `bc-umzug-ready`,
  die alte schickt die Daten per `postMessage` **nur** an die Match-Tracker-Origin. Die neue Seite nimmt nur Nachrichten von
  `https://battle-cal.netlify.app` an, fragt vor dem Übernehmen nach, überspringt doppelte IDs und bereinigt das HTML der Armeevergleiche.
  Ist ein Cloud-Profil aktiv, gehen neue Historien-Einträge mit dem Profil-Passwort per `bc_results_upsert_many` in die Cloud.
- **Als Datei sichern**: JSON im Format `source: "battle-cal-umzug"`. Die neue App liest sie unter Historie → Importieren ein.

## Später (Stufe E, eigene Freigabe)
1. `umzug.html` ins battle-cal-Repo (Root) legen. Optional in `index.html` einen Hinweis-Banner mit Link auf `/umzug.html`.
2. Erst danach über `_redirects` entscheiden. Die Umzugsseite muss erreichbar bleiben, z. B.
   `/umzug.html  /umzug.html  200` vor `/*  https://40k-match-tracker.netlify.app/#/battle-cal  301!`.
3. Voraussetzung: Der Battle-Cal-Schalter im Match-Tracker ist dann für alle an (oder entfernt). Mit Schalter AUS zeigt `/battle-cal/`
   nur den Hinweis „noch nicht freigeschaltet“.
