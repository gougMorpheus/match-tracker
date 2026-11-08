const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadBrowserModule } = require("./helpers/loadBrowserModule.cjs");
const { createBaseGame } = require("./helpers/gameFixtures.cjs");
const {
  appendLocalCommandPointEvent,
  appendLocalScoreEvent,
  appendLocalTimeEvents
} = require("../.test-dist/utils/gameState.js");
const calc = require("../.test-dist/utils/gameCalculations.js");
const { formatDuration } = require("../.test-dist/utils/time.js");

const textOf = (node) => {
  if (node == null || node === false || node === true) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object") return textOf(node.props?.children);
  return "";
};

const nodes = (node) =>
  !node || typeof node !== "object"
    ? []
    : Array.isArray(node)
      ? node.flatMap(nodes)
      : [node, ...nodes(node.props?.children)];

const byClass = (tree, className) =>
  nodes(tree).filter((node) => String(node.props?.className || "").split(/\s+/).includes(className));

const buildLocalGame = () => {
  const base = createBaseGame({
    id: "11111111-1111-4111-8111-111111111111",
    scheduledDate: undefined,
    scheduledTime: undefined
  });
  base.players[0].name = "Tim · LOKAL";
  base.players[0].army.name = "Tau Empire";
  base.players[1].name = "Gegner · LOKAL";
  const [tim, opponent] = base.players.map((player) => player.id);
  const at = (minute) => new Date(Date.parse("2026-11-08T08:00:00.000Z") + minute * 60000).toISOString();
  const ev = (action, playerId, roundNumber, turnNumber, minute) => ({
    action,
    playerId,
    roundNumber,
    turnNumber,
    createdAt: at(minute)
  });
  let game = appendLocalTimeEvents(base, [
    { action: "game-start", playerId: tim, createdAt: at(0) },
    { action: "setup-start", createdAt: at(0) },
    { action: "setup-end", createdAt: at(5) },
    { action: "round-start", playerId: tim, roundNumber: 1, createdAt: at(5) },
    ev("turn-start", tim, 1, 1, 5),
    ev("turn-end", tim, 1, 1, 125),
    ev("turn-start", opponent, 1, 2, 125),
    ev("turn-end", opponent, 1, 2, 165),
    { action: "round-end", playerId: opponent, roundNumber: 1, createdAt: at(165) },
    { action: "round-start", playerId: tim, roundNumber: 2, createdAt: at(165) },
    ev("turn-start", tim, 2, 1, 165),
    ev("turn-end", tim, 2, 1, 241),
    ev("turn-start", opponent, 2, 2, 241),
    ev("turn-end", opponent, 2, 2, 261),
    { action: "round-end", playerId: opponent, roundNumber: 2, createdAt: at(261) },
    { action: "round-start", playerId: tim, roundNumber: 3, createdAt: at(261) },
    ev("turn-start", tim, 3, 1, 261),
    ev("turn-pause", tim, 3, 1, 279)
  ]);
  const score = (playerId, scoreType, value, roundNumber, turnNumber, minute) => {
    game = appendLocalScoreEvent(game, {
      playerId,
      scoreType,
      value,
      roundNumber,
      turnNumber,
      createdAt: at(minute)
    });
  };
  score(tim, "primary", 35, 1, 1, 20);
  score(tim, "secondary", 16, 1, 1, 30);
  score(tim, "primary", 5, 3, 1, 270);
  const cp = (playerId, cpType, value, roundNumber, turnNumber, minute) => {
    game = appendLocalCommandPointEvent(game, {
      playerId,
      cpType,
      value,
      roundNumber,
      turnNumber,
      createdAt: at(minute)
    });
  };
  cp(tim, "gained", 10, 1, 1, 15);
  cp(tim, "spent", 9, 1, 1, 40);
  cp(tim, "gained", 1, 3, 1, 270);
  return game;
};

const renderScoreboard = (PlayerScoreboard, game, player) => {
  const tree = PlayerScoreboard({
    game,
    player,
    roundNumber: 3,
    emphasized: player.id === game.players[0].id,
    defender: player.id === game.defenderPlayerId
  });
  return tree;
};

const runPlayerScoreboardTests = () => {
  const jsx = (type, props, key) => ({ type, props, key });
  const { PlayerScoreboard } = loadBrowserModule("src/components/PlayerScoreboard.tsx", {
    react: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" }
  });
  const game = buildLocalGame();
  const before = JSON.stringify(game);
  const tim = game.players[0];
  const opponent = game.players[1];
  const activeTurn = calc.getActiveTurn(game);
  assert.equal(activeTurn.playerId, tim.id, "Fixture: der aktive Zug gehoert Tim");
  assert.equal(calc.getPlayerPrimaryTotal(game, tim.id), 40);
  assert.equal(calc.getPlayerSecondaryTotal(game, tim.id), 16);
  assert.equal(calc.getPlayerChallengeTotal(game, tim.id), 0);
  assert.equal(calc.getPlayerTotalScore(game, tim.id), 56);
  assert.equal(calc.getPlayerCurrentRoundPrimaryTotal(game, tim.id, 3), 5);
  assert.equal(calc.getPlayerCommandPoints(game, tim.id), 2);
  assert.equal(formatDuration(calc.getPlayerTurnDurationTotalMs(game, tim.id)), "3h 34m");
  assert.equal(formatDuration(calc.getTurnDurationMs(activeTurn, game)), "18m 0s");

  const timTree = renderScoreboard(PlayerScoreboard, game, tim);
  const opponentTree = renderScoreboard(PlayerScoreboard, game, opponent);
  assert.equal(JSON.stringify(game), before, "Rendern aendert das Spiel nicht");

  const timText = textOf(timTree);
  assert.equal(timText.includes("Gesamt aktiv"), false);
  assert.ok(timText.includes("Gesamt"));
  assert.ok(timText.includes("56"));
  assert.ok(timText.includes("Konto"));
  assert.ok(byClass(timTree, "scoreboard-stat__badge").some((node) => textOf(node) === "CP"));

  const timTime = byClass(timTree, "scoreboard-stat--time")[0];
  const timLines = byClass(timTime, "scoreboard-stat__line").map(textOf);
  assert.equal(timLines.length, 2);
  assert.match(timLines[0], /Σ Zeit/);
  assert.match(timLines[0], /3h 34m/);
  assert.match(timLines[1], /Zug/);
  assert.match(timLines[1], /18m 0s/);
  assert.equal(timLines.join(" ").includes("Gesamt aktiv"), false);

  const opponentLines = byClass(byClass(opponentTree, "scoreboard-stat--time")[0], "scoreboard-stat__line").map(textOf);
  assert.match(opponentLines[0], /1h 0m/);
  assert.match(opponentLines[1], /Zug/);
  assert.match(opponentLines[1], /0m/);
  assert.equal(/18m/.test(opponentLines[1]), false, "Zugzeit nur beim Spieler des aktiven Zugs");

  const total = byClass(timTree, "scoreboard-stat--total")[0];
  assert.match(textOf(total), /Gesamt/);
  assert.match(textOf(total), /56/);
  assert.match(textOf(byClass(timTree, "scoreboard-stat--primary")[0]), /Prim/);
  assert.match(textOf(byClass(timTree, "scoreboard-stat--primary")[0]), /40/);
  assert.equal(byClass(byClass(timTree, "scoreboard-stat--primary")[0], "scoreboard-stat__kind").length, 0);
  assert.equal(byClass(byClass(timTree, "scoreboard-stat--cp")[0], "scoreboard-stat__kind").length, 1);

  const header = fs.readFileSync(path.join(__dirname, "../src/pages/GamePage.tsx"), "utf8");
  const start = header.indexOf('className="game-header-stats"');
  const block = header.slice(start, header.indexOf("</div>", start));
  assert.deepEqual(
    [...block.matchAll(/data-header-slot="([^"]+)"/g)].map((match) => match[1]),
    ["turn", "round", "total"]
  );
  assert.match(block, /Zug \$\{displayTurn/);
  assert.match(block, /Runde \$\{displayRound/);
  assert.match(block, /Gesamt \{formatDuration\(getGameDurationMs\(game\)\)\}/);
  const turnSlot = block.slice(block.indexOf('data-header-slot="turn"'), block.indexOf('data-header-slot="round"'));
  const roundSlot = block.slice(block.indexOf('data-header-slot="round"'), block.indexOf('data-header-slot="total"'));
  assert.match(turnSlot, /Phase pausiert/);
  assert.match(turnSlot, /Runde 0/);
  assert.match(roundSlot, /Aufstellung \(/);
};

module.exports = { runPlayerScoreboardTests };
