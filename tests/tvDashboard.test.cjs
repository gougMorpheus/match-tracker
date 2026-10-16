const assert = require('node:assert/strict');
const { createBaseGame } = require('./helpers/gameFixtures.cjs');
const { buildTvEventFeed, getDeficitInfo } = require('../.test-dist/utils/tvDashboard.js');
const runTvDashboardTests = () => {
  const g = createBaseGame();
  const [a,b] = g.players;
  assert.equal(getDeficitInfo(g).text, 'Gleichstand');
  g.rounds = [{ id:'r3', roundNumber:3, turns:[] }];
  g.scoreEvents = [{ id:'score', type:'score', playerId:b.id, scoreType:'primary', value:7, roundNumber:3, createdAt:'2026-10-01T10:00:00Z' }];
  assert.deepEqual(getDeficitInfo(g), { text:'Alice liegt 7 VP zurück', deficit:7, playerId:a.id, remainingRounds:2, perRound:4 });
  g.rounds[0].roundNumber = 5;
  assert.equal(getDeficitInfo(g).perRound, null);
  g.rounds[0].roundNumber = 3; g.status = 'completed';
  assert.equal(getDeficitInfo(g).perRound, null);
  g.scoreDetailLevel = 'none'; assert.equal(getDeficitInfo(g).deficit, null); g.scoreDetailLevel = 'full';
  g.scoreEvents.push({ ...g.scoreEvents[0], id:'negative', value:-2, createdAt:'2026-10-01T10:01:00Z' });
  g.commandPointEvents = [{ id:'cp', type:'command-point', playerId:a.id, cpType:'spent', value:1, roundNumber:3, createdAt:'2026-10-01T10:02:00Z' }];
  g.timeEvents = [
    { id:'start', type:'time', action:'turn-start', playerId:a.id, roundNumber:3, turnNumber:2, createdAt:'2026-10-01T10:03:00Z' },
    { id:'round', type:'time', action:'round-start', roundNumber:4, createdAt:'2026-10-01T10:04:00Z' },
    { id:'end', type:'time', action:'game-end', createdAt:'2026-10-01T10:05:00Z' },
    { id:'ignored', type:'time', action:'turn-end', createdAt:'2026-10-01T10:06:00Z' }
  ];
  const feed = buildTvEventFeed(g);
  // Ohne Zug: direkt aufeinanderfolgende gleiche SP werden zusammengefasst (+7, −2 -> +5).
  assert.deepEqual(feed.map(e => e.id), ['end','round','start',`group:cp|${a.id}|-|cp`,`group:score|primary|${b.id}|-|score`]);
  assert.equal(feed[0].text, 'Spiel beendet');
  assert.equal(feed[1].text, 'Runde 4 beginnt');
  assert.equal(feed[2].text, 'Runde 3 · Zug 2: Alice ist am Zug');
  assert.equal(feed[3].text, 'Runde 3 · Alice: −1 CP');
  assert.equal(feed[4].text, 'Runde 3 · Bob: +5 Primär');
  assert.match(feed[0].time, /^\d{2}:\d{2}$/);
  assert.equal(buildTvEventFeed(g, 2).length, 2);
  assert.equal(buildTvEventFeed(g, -1).length, 0);
  // Notizen werden nicht mehr angezeigt.
  g.noteEvents = [{ id:'note', type:'note', playerId:a.id, note:'Notiz', createdAt:'2026-10-01T10:09:00Z' }];
  assert.ok(!buildTvEventFeed(g, 100).some(e => e.id === 'note'));
  g.timeEvents.push(...Array.from({ length:12 }, (_, i) => ({ id:`p-${String(i).padStart(2,'0')}`, type:'time', action:'turn-pause', playerId:a.id, createdAt:'2026-10-01T10:07:00Z' })));
  assert.equal(buildTvEventFeed(g).length, 8, 'Standard: acht Eintraege');
  assert.equal(buildTvEventFeed(g, 100).length, 17, 'View only: scrollbare Liste mit allen Eintraegen');
  assert.equal(buildTvEventFeed(g)[0].id, 'p-11');
  const before = JSON.stringify(g); buildTvEventFeed(g); getDeficitInfo(g);
  assert.equal(JSON.stringify(g), before, 'Pure derivations must not mutate the source');
};
module.exports = { runTvDashboardTests };
