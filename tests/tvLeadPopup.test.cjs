const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const h = require("../.test-dist/utils/tvHighlights.js");
const { createBaseGame } = require("./helpers/gameFixtures.cjs");

const mk = (kind, id, createdAt = "2026-10-15T12:00:00Z") => ({ id, kind, title: kind, subtitle: "", createdAt });

const runTvLeadPopupTests = () => {
  // Neue Fuehrungswechsel mitten im Zug -> Einblendung; Historie nicht nachspielen.
  const game = createBaseGame(); const [a, b] = game.players;
  const ev = (i, p, v) => ({ id: `e${i}`, type: "score", playerId: p.id, scoreType: "primary", value: v, roundNumber: 1, turnNumber: 1,
    createdAt: new Date(Date.parse("2026-10-15T12:00:00Z") + i * 1000).toISOString() });
  game.scoreEvents = [ev(0, a, 5), ev(1, b, 8)];
  const seen = new Set(h.deriveScoreLeadHighlights(game).map((x) => x.id));
  const until = h.getScoreEventIds(game);
  game.scoreEvents = [...game.scoreEvents, ev(2, a, 4)];
  const fresh = h.findNewScoreLeadHighlights(seen, h.deriveScoreLeadHighlights(game), until);
  assert.equal(fresh.length, 1); assert.equal(fresh[0].kind, "lead-change"); assert.match(fresh[0].subtitle, /9 : 8/);
  // Undo mitten im Verlauf: neue IDs fuer alte Events werden nicht eingeblendet.
  const seen2 = new Set(h.deriveScoreLeadHighlights(game).map((x) => x.id)); const until2 = h.getScoreEventIds(game);
  const undone = { ...game, scoreEvents: game.scoreEvents.filter((e) => e.id !== "e1") };
  assert.equal(h.findNewScoreLeadHighlights(seen2, h.deriveScoreLeadHighlights(undone), until2).length, 0);

  // Undo entfernt ungueltige (auch aktive) Einblendung, andere bleiben.
  const queue = [mk("lead-change", "L1"), mk("round-summary", "R1"), mk("equalizer", "E1")];
  assert.deepEqual(h.reconcileTvHighlightQueue(queue, new Set(["E1"])).map((x) => x.id), ["R1", "E1"]);
  assert.equal(h.reconcileTvHighlightQueue(queue, new Set(["L1", "E1"])), queue, "unveraendert -> gleiches Objekt");

  // Kein Stau: aktive bleibt, nur das neueste Punkte-Highlight wartet.
  let q = h.enqueueTvHighlights([], [mk("lead-change", "A")]);
  q = h.enqueueTvHighlights(q, [mk("equalizer", "B")]);
  q = h.enqueueTvHighlights(q, [mk("lead-change", "C")]);
  q = h.enqueueTvHighlights(q, [mk("lead-change", "D"), mk("equalizer", "E")]);
  assert.deepEqual(q.map((x) => x.id), ["A", "E"], "aktive A bleibt (kein Flackern), nur neuestes wartet");
  q = h.enqueueTvHighlights(q, [mk("round-summary", "R"), mk("time-milestone-0-30", "T")]);
  assert.ok(q.length <= h.MAX_TV_HIGHLIGHT_QUEUE); assert.equal(q[0].id, "A");
  assert.deepEqual(h.enqueueTvHighlights([mk("round-summary", "R")], [mk("game-end", "G")]).map((x) => x.id), ["R", "G"]);

  // TvGameView nutzt die gemeinsame Logik, Phasengrenzen liefern keine doppelten Fuehrungswechsel.
  const view = fs.readFileSync(path.join(__dirname, "..", "src/components/TvGameView.tsx"), "utf8");
  assert.match(view, /deriveScoreLeadHighlights\(game\)/);
  assert.match(view, /!SCORE_DRIVEN_KINDS\.has\(h\.kind\)/);
  assert.match(view, /reconcileTvHighlightQueue\(queue, ids\)/);

  // Mobil kompakte Zeilen, Desktop-Regel unveraendert.
  const css = fs.readFileSync(path.join(__dirname, "..", "src/styles/index.css"), "utf8");
  assert.match(css, /\.tv-event \{ display: flex; gap: \.65em; align-items: center; height: 12\.5%;/);
  assert.match(css, /@media \(orientation: portrait\), \(max-width: 900px\), \(max-height: 500px\) \{\s*\.tv-events__list \{ flex: none; height: min\(60vh, 440px\)[^}]*\}\s*\.tv-event, \.tv-event--highlight \{ height: auto;/);
};
module.exports = { runTvLeadPopupTests };
