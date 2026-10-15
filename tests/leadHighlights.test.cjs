const assert = require("node:assert/strict");
const { createBaseGame } = require("./helpers/gameFixtures.cjs");
const { deriveGameHighlights, deriveScoreLeadHighlights } = require("../.test-dist/utils/tvHighlights.js");

// Verlauf wie Testspiel 5e761c75 (ZZ-A Necrons vs. ZZ-B Orks, 15.10.): alle Punkte in Runde 1 / Zug 1.
const PEPPER = [[1, "primary", 5], [2, "primary", 8], [1, "secondary", 4], [2, "challenge", 3], [1, "challenge", 5],
  [2, "primary", 6], [1, "secondary", 3], [2, "secondary", 2], [1, "primary", 2], [2, "challenge", 2]];

const buildGame = (steps = PEPPER) => {
  const game = createBaseGame();
  game.players[0].name = "ZZ-A"; game.players[1].name = "ZZ-B";
  game.scoreEvents = steps.map(([slot, scoreType, value], i) => ({
    id: `s${String(i).padStart(2, "0")}`, type: "score", playerId: game.players[slot - 1].id, scoreType, value,
    createdAt: new Date(Date.parse("2026-10-15T11:28:18Z") + i * 1000).toISOString(), roundNumber: 1, turnNumber: 1
  }));
  return game;
};

const runLeadHighlightsTests = () => {
  const game = buildGame();
  const lead = deriveScoreLeadHighlights(game);
  const changes = lead.filter((h) => h.kind === "lead-change");
  assert.deepEqual(changes.map((h) => h.subtitle), [
    "ZZ-B übernimmt die Führung · 5 : 8 VP",
    "ZZ-A übernimmt die Führung · 9 : 8 VP",
    "ZZ-B übernimmt die Führung · 9 : 11 VP",
    "ZZ-A übernimmt die Führung · 14 : 11 VP",
    "ZZ-B übernimmt die Führung · 14 : 17 VP"
  ]);
  assert.deepEqual(lead.filter((h) => h.kind === "equalizer").map((h) => h.subtitle), ["17 : 17 VP", "19 : 19 VP"]);
  // Nach Ausgleich fuehrt wieder derselbe Spieler: kein Fuehrungswechsel.
  assert.ok(!changes.some((h) => /19 VP$/.test(h.subtitle)));
  // Erste Fuehrung ist kein Wechsel.
  assert.ok(!lead.some((h) => /5 : 0/.test(h.subtitle)));
  // Auch in deriveGameHighlights (Liste/Verlauf) enthalten, ohne Phasengrenzen, eindeutige IDs.
  const all = deriveGameHighlights(game);
  assert.equal(all.filter((h) => h.kind === "lead-change").length, 5);
  assert.equal(all.filter((h) => h.kind === "equalizer").length, 2);
  assert.equal(new Set(all.map((h) => h.id)).size, all.length);
  assert.ok(all.every((h, i) => i === 0 || Date.parse(all[i - 1].createdAt) <= Date.parse(h.createdAt)), "chronologisch");
  assert.equal(changes[0].createdAt, game.scoreEvents[1].createdAt, "Zeit = ausloesendes Event");
  // Undo (widerrufenes Event fehlt in scoreEvents): Wechsel verschwindet.
  const undone = buildGame(PEPPER.slice(0, 2));
  assert.equal(deriveScoreLeadHighlights(undone).length, 1);
  assert.equal(deriveScoreLeadHighlights(buildGame(PEPPER.slice(0, 1))).length, 0);
  // Gegenereignis (negative Korrektur) fuehrt zum Ausgleich bzw. Wechsel zurueck.
  const corrected = deriveScoreLeadHighlights(buildGame([[1, "primary", 5], [2, "primary", 8], [2, "primary", -3], [2, "primary", -1]]));
  assert.deepEqual(corrected.map((h) => [h.kind, h.subtitle]), [
    ["lead-change", "ZZ-B übernimmt die Führung · 5 : 8 VP"],
    ["equalizer", "5 : 5 VP"],
    ["lead-change", "ZZ-A übernimmt die Führung · 5 : 4 VP"]
  ]);
  // Gleicher Zeitstempel = ein Schritt.
  const same = buildGame([[1, "primary", 5], [2, "primary", 8], [1, "primary", 4]]);
  same.scoreEvents[2].createdAt = same.scoreEvents[1].createdAt;
  assert.equal(deriveScoreLeadHighlights(same).length, 0);
};

module.exports = { runLeadHighlightsTests };
