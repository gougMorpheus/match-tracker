const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createCompletedGameFixture } = require("./helpers/gameFixtures.cjs");
const { deriveGameHighlights } = require("../.test-dist/utils/tvHighlights.js");
const { buildTvEventFeed, TV_FEED_SCROLL_LIMIT } = require("../.test-dist/utils/tvDashboard.js");
const { getPlayerScoreTotal } = require("../.test-dist/utils/gameCalculations.js");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

const runHighlightsScrollTests = () => {
  // Highlights werden aus vorhandenen Ereignissen abgeleitet, nicht gespeichert.
  const game = createCompletedGameFixture();
  const before = JSON.stringify(game);
  const highlights = deriveGameHighlights(game);
  assert.equal(JSON.stringify(game), before, "Ableitung veraendert das Spiel nicht");
  const kinds = highlights.map((h) => h.kind);
  assert.ok(kinds.includes("lead-change"), "Fuehrungswechsel erkannt");
  assert.ok(kinds.includes("game-end"), "Spielende erkannt");
  assert.ok(highlights.every((h) => h.id.startsWith("highlight:") && h.createdAt), "eigene IDs + Zeit");
  assert.equal(new Set(highlights.map((h) => h.id)).size, highlights.length, "keine Duplikate");

  // Undo/Loeschen der Ursache entfernt das abgeleitete Highlight.
  const undone = { ...game, scoreEvents: game.scoreEvents.filter((e) => e.playerId === game.players[0].id) };
  assert.ok(!deriveGameHighlights(undone).some((h) => h.kind === "lead-change"), "nach Undo kein Fuehrungswechsel");

  // Keine Auswirkung auf Punkte/Statistik.
  const totals = game.players.map((p) => getPlayerScoreTotal(game, p.id));
  buildTvEventFeed(game, TV_FEED_SCROLL_LIMIT, highlights);
  assert.deepEqual(game.players.map((p) => getPlayerScoreTotal(game, p.id)), totals);

  // Feed: Highlights als eigene Art, Begrenzung ueber limit.
  const feed = buildTvEventFeed(game, TV_FEED_SCROLL_LIMIT, highlights);
  assert.ok(feed.some((item) => item.kind === "highlight" && /Führungswechsel/.test(item.text)));
  assert.ok(buildTvEventFeed(game, 2, highlights).length <= 2);

  // Verlauf: Highlights nicht bearbeit-/loeschbar.
  const gamePage = read("src/pages/GamePage.tsx");
  assert.match(gamePage, /!isReadOnly && event\.kind !== "highlight"/);
  assert.equal((gamePage.match(/isReadOnly \|\| event\.kind === "highlight"/g) || []).length, 2, "Editor + Loeschen sperren Highlights");
  assert.match(gamePage, /<option value="highlight">Highlights<\/option>/);

  // Scrollbare Liste ohne sichtbare Scrollbar, per Tastatur fokussierbar.
  const css = read("src/styles/index.css");
  assert.match(css, /\.tv-events__list[^}]*overflow-y:\s*auto/);
  assert.match(css, /scrollbar-width:\s*none/);
  assert.match(css, /\.tv-events__list::-webkit-scrollbar\s*\{\s*display:\s*none/);
  const feedComponent = read("src/components/TvEventFeed.tsx");
  assert.match(feedComponent, /tabIndex=\{0\}/);

  // Menue: ein Bauteil, per Portal unabhaengig vom Kontext; einheitliche Basisschrift.
  const menu = read("src/components/FloatingMenu.tsx");
  assert.match(menu, /createPortal/);
  assert.match(css, /\.floating-menu \{\s*font-family:[^}]*font-size: 1rem/);
  for (const page of ["GamesPage", "StatsPage", "GamePage"]) {
    const src = read(`src/pages/${page}.tsx`);
    assert.match(src, /label: "Main"[\s\S]*label: "Neues Spiel"[\s\S]*label: "Statistik"[\s\S]*label: "Optionen"/, page);
  }
  // Entsperren ohne Unterzeile.
  assert.match(gamePage, /\{ label: "Entsperren", onClick/);
  assert.doesNotMatch(gamePage, /Passwort, danach Edit/);

  // Unlock: keine alte Nur-Lesen-Ansicht, Rueckfall auf View only wenn das Spiel zu bleibt.
  assert.equal((gamePage.match(/<GameOverview game=\{game\} \/>/g) || []).length, 1, "nur noch im Scoreboard-Dialog");
  assert.match(gamePage, /\{viewOnlyTv \|\| showOverview \? null :/);
  assert.match(gamePage, /isGameCompletedForDisplay\(reopened\)\) \{\s*setGameAccessMode\(game\.id, "view"\)/);
  const app = read("src/App.tsx");
  assert.match(app, /normalizeLegacyGameHash/);
  assert.doesNotMatch(app, /forceOverview/);
};

module.exports = { runHighlightsScrollTests };
