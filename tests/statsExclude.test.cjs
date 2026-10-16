const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { mapSupabaseGameToAppGame } = require("../.test-dist/utils/supabaseGameMapping.js");
const gc = require("../.test-dist/utils/gameCalculations.js");
const { getHeadToHead, getPlayerWinRate } = require("../.test-dist/utils/headToHead.js");

const FIXTURES = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/push-real-games.json"), "utf8"));

const clone = (value) => JSON.parse(JSON.stringify(value));
const statsSnapshot = (games) => {
  const filters = gc.createInitialGameFilters();
  const source = gc.filterGames(gc.removeExcludedStatsGames(games), filters);
  const prepared = gc.prepareGamesForStats(source);
  const ids = new Set(prepared.map((game) => game.id));
  const statsSource = source.filter((game) => ids.has(game.id));
  return JSON.stringify({
    options: gc.getFilterOptions(gc.removeExcludedStatsGames(games)),
    overview: gc.createStatsOverview(prepared, statsSource),
    players: gc.createPlayerAggregates(prepared, statsSource),
    armies: gc.createArmyAggregates(prepared, statsSource),
    matchups: gc.createMatchupAggregates(prepared, statsSource)
  });
};

const runStatsExcludeTests = () => {
  const real = FIXTURES.map(({ row, events }) => mapSupabaseGameToAppGame(row, events));
  assert.ok(real.length >= 10);
  assert.equal(real.filter(gc.isGameExcludedFromStats).length, 0, "Fixture-Spiele haben kein Nicht-zählen-Flag");
  const baseline = statsSnapshot(real);

  // „Nicht zählen“-Kopien echter Spiele mit eigenen Namen/Armeen – auch mit Overrides, die Bereiche wieder einschließen würden.
  const zz = real.slice(0, 4).map((game, index) => {
    const copy = clone(game);
    copy.id = `zz-exclude-${index}`;
    copy.players[0].name = `ZZ-${index}-A`;
    copy.players[1].name = `ZZ-${index}-B`;
    copy.players[0].army = { ...(copy.players[0].army || {}), faction: "ZZ-Armee", name: "ZZ-Armee" };
    copy.statsEligibilityMode = "exclude";
    if (index % 2) copy.statsEligibilityOverrides = { areas: { result: "include", scoring: "include", cp: "include", time: "include" } };
    return copy;
  });
  // Kopie mit echten Spielernamen: darf Tim/Guido/Janis-Werte nicht verschieben.
  const realNamesExcluded = clone(real[0]);
  realNamesExcluded.id = "zz-real-names";
  realNamesExcluded.statsEligibilityMode = "exclude";
  realNamesExcluded.statsEligibilityOverrides = { areas: { time: "include" } };
  const mixed = [...zz, ...real, realNamesExcluded];

  for (const game of [...zz, realNamesExcluded]) {
    assert.equal(gc.isGameExcludedFromStats(game), true);
    assert.equal(gc.prepareGameForStats(game), null, "auch Overrides holen ein Nicht-zählen-Spiel nicht zurück");
  }
  assert.equal(gc.removeExcludedStatsGames(mixed).length, real.length);
  const options = gc.getFilterOptions(gc.removeExcludedStatsGames(mixed));
  assert.equal(options.playerNames.some((name) => name.startsWith("ZZ-")), false, "keine ZZ-Namen im „vs …“-Filter");
  assert.equal(JSON.stringify(options).includes("ZZ-Armee"), false, "keine ZZ-Armee in den Filtern");
  assert.equal(statsSnapshot(mixed), baseline, "Durchschnitte, Charts, Rekorde, Matchups unverändert");

  // Head-to-Head / Siegquote (TV-Ansicht) ignorieren Nicht-zählen-Spiele ebenfalls.
  const [a, b] = real.find((game) => game.status === "completed").players.map((player) => player.name);
  assert.deepEqual(getHeadToHead(mixed, a, b), getHeadToHead(real, a, b));
  assert.deepEqual(getPlayerWinRate(mixed, a), getPlayerWinRate(real, a));

  // Spiele ohne Flag (auto/include, Bereichs-Overrides) bleiben unverändert drin.
  const includeGame = clone(real[0]); includeGame.statsEligibilityMode = "include";
  assert.equal(gc.isGameExcludedFromStats(includeGame), false);
  const partial = clone(real[0]); partial.statsEligibilityOverrides = { areas: { time: "exclude" } };
  assert.equal(gc.isGameExcludedFromStats(partial), false);
};

module.exports = { runStatsExcludeTests };
