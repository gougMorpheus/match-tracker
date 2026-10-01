const assert = require('node:assert/strict');
const { createBaseGame } = require('./helpers/gameFixtures.cjs');
const { normalizePlayerName, getGameOutcome, getHeadToHead, getPlayerWinRate } = require('../.test-dist/utils/headToHead.js');
const completed = (id, a, b, reason = 'completed') => {
  const game = createBaseGame({ id });
  game.status = 'completed'; game.finishReason = reason;
  game.scoreDetailLevel = 'total-only';
  game.legacyScoreTotals = { [game.players[0].id]: a, [game.players[1].id]: b };
  return game;
};
const runHeadToHeadTests = () => {
  assert.equal(normalizePlayerName('  TIM   Müller  '), 'tim müller');
  const win = completed('win', 10, 5), loss = completed('loss', 1, 5), draw = completed('draw', 4, 4);
  assert.equal(getGameOutcome(win).winnerId, win.players[0].id);
  assert.equal(getGameOutcome(loss).winnerId, loss.players[1].id);
  assert.equal(getGameOutcome(draw).draw, true);
  assert.equal(getGameOutcome(completed('explicit-draw', 10, 0, 'draw')).draw, true);
  for (const [reason, slot] of [['player-1-conceded', 1], ['player-2-conceded', 0]]) {
    const g = completed(reason, 90, 0, reason); g.scoreDetailLevel = 'none';
    assert.equal(getGameOutcome(g).winnerId, g.players[slot].id);
  }
  for (const reason of ['interrupted', 'abandoned']) assert.equal(getGameOutcome(completed(reason, 5, 0, reason)), null);
  assert.equal(getGameOutcome(createBaseGame()), null);
  const unknown = completed('unknown', 0, 0); unknown.legacyScoreTotals = {};
  assert.equal(getGameOutcome(unknown), null);
  assert.equal(getGameOutcome({ ...unknown, scoreDetailLevel: 'none' }), null);
  const reversed = completed('reversed', 8, 2);
  reversed.players[0].name = ' bOB '; reversed.players[1].name = '  ALICE  ';
  const games = [win, loss, draw, reversed, unknown, createBaseGame(), completed('skip', 8, 2, 'interrupted'), completed('skip2', 8, 2, 'abandoned')];
  assert.deepEqual(getHeadToHead(games, ' ALIce ', 'BOB'), { winsA: 1, winsB: 2, draws: 1, games: 4 });
  assert.deepEqual(getHeadToHead(games, 'Alice', 'Bob', 'reversed'), { winsA: 1, winsB: 1, draws: 1, games: 3 });
  assert.deepEqual(getPlayerWinRate(games, 'alice'), { wins: 1, games: 4, percent: 25 });
  assert.deepEqual(getPlayerWinRate(games, 'alice', 'reversed'), { wins: 1, games: 3, percent: 33 });
  assert.deepEqual(getPlayerWinRate(games, 'Unknown'), { wins: 0, games: 0, percent: null });
  const spaced = completed('spaced', 2, 1); spaced.players[0].name = '  Alice   Smith ';
  assert.equal(getHeadToHead([spaced], 'alice smith', 'bob').winsA, 1);
  assert.equal(getPlayerWinRate([spaced], 'ALICE  SMITH').percent, 100);
  assert.equal(getHeadToHead(games, 'Alice', ' alice ').games, 0);
};
module.exports = { runHeadToHeadTests, completed };
