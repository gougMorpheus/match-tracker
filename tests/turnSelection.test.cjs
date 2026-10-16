const assert = require("node:assert/strict");
const { resolveSelectedTurnKey: r } = require("../.test-dist/utils/turnSelection.js");
const base = { snapToLatest: false, setupStarted: true };
const runTurnSelectionTests = () => {
  // Start: keine Auswahl -> neuester Zug
  assert.equal(r({ ...base, current: null, previousLatestKey: null, latestKey: "1:1", turnKeys: ["1:1"] }), "1:1");
  // Fehlerbild: Cache zeigt R1Z1 als neuesten Zug, Server liefert R1Z2 -> Auswahl folgt (vorher blieb sie auf 1:1)
  assert.equal(r({ ...base, current: "1:1", previousLatestKey: "1:1", latestKey: "1:2", turnKeys: ["1:1", "1:2"] }), "1:2");
  // Zweites Gerät drückt Weiter (R1Z2 -> R2Z1)
  assert.equal(r({ ...base, current: "1:2", previousLatestKey: "1:2", latestKey: "2:1", turnKeys: ["1:1", "1:2", "2:1"] }), "2:1");
  // Bewusst älteren Zug angesehen: bleibt, auch wenn ein neuer Zug dazukommt
  assert.equal(r({ ...base, current: "1:1", previousLatestKey: "1:2", latestKey: "2:1", turnKeys: ["1:1", "1:2", "2:1"] }), "1:1");
  // Gleicher neuester Zug (z. B. Pause/Weiterlaufen) -> Auswahl unverändert
  assert.equal(r({ ...base, current: "1:1", previousLatestKey: "1:2", latestKey: "1:2", turnKeys: ["1:1", "1:2"] }), "1:1");
  assert.equal(r({ ...base, current: "1:2", previousLatestKey: "1:2", latestKey: "1:2", turnKeys: ["1:1", "1:2"] }), "1:2");
  // Aufstellung ausgewählt bleibt
  assert.equal(r({ ...base, current: "setup", previousLatestKey: "1:1", latestKey: "1:2", turnKeys: ["1:1", "1:2"] }), "setup");
  // Snap nach eigener Aktion
  assert.equal(r({ ...base, snapToLatest: true, current: "1:1", previousLatestKey: "1:2", latestKey: "2:1", turnKeys: ["1:1", "1:2", "2:1"] }), "2:1");
  // Zug entfernt (Zurück/Undo) -> neuester
  assert.equal(r({ ...base, current: "2:1", previousLatestKey: "2:1", latestKey: "1:2", turnKeys: ["1:1", "1:2"] }), "1:2");
  // Keine Züge
  assert.equal(r({ ...base, current: "1:1", previousLatestKey: "1:1", latestKey: null, turnKeys: [] }), null);
};
module.exports = { runTurnSelectionTests };
