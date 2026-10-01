const assert = require('node:assert/strict');
const { createBaseGame, createPausedActiveGameFixture } = require('./helpers/gameFixtures.cjs');
const { createTvSnapshot, detectTvHighlights, HIGHLIGHT_RULES } = require('../.test-dist/utils/tvHighlights.js');
const runTvHighlightsTests = () => {
  const game = createBaseGame(); const [a,b] = game.players;
  const base = createTvSnapshot(game, '2026-10-01T10:00:00Z');
  const prev = { ...base, phaseKey:'r2t1:false', round:2, total:[10,8], leaderId:a.id, lastLeaderId:a.id, timeMs:[60000,120000] };
  const next = { ...prev, phaseKey:'r2t2:false', total:[10,17], leaderId:b.id, lastLeaderId:b.id };
  const detect = (p=prev, n=next) => detectTvHighlights(p,n,game);
  assert.ok(detect().some(h => h.kind === 'lead-change' && h.playerId === b.id));
  assert.ok(detect({ ...prev, total:[10,10], leaderId:null }).some(h => h.kind === 'lead-change'));
  assert.ok(detect(prev,{ ...next, total:[10,10], leaderId:null }).some(h => h.kind === 'equalizer'));
  assert.ok(detect().some(h => h.kind === 'challenge' && h.playerId === a.id));
  assert.ok(detect(prev,{ ...next, total:[10,16] }).some(h => h.kind === 'challenge'));
  assert.ok(!detect({ ...prev, total:[10,16] }).some(h => h.kind === 'challenge'));
  assert.ok(!detect(prev,{ ...next, total:[10,15] }).some(h => h.kind === 'challenge'));
  assert.ok(!detect({ ...prev, total:[null,null] }).some(h => h.kind === 'challenge'));
  assert.ok(!detect(prev,{ ...next, timeMs:[180000,120000] }).some(h => h.kind === 'time-overtake'));
  assert.ok(!detect({ ...prev, timeMs:[180000,120000] },{ ...next, timeMs:[180000,240000] }).some(h => h.kind === 'time-overtake'));
  const timedRound = (r, minutesA, minutesB, closed = true) => ({id:`r${r}`,roundNumber:r,
    endedAt:closed ? '2026-10-01T12:00:00Z' : undefined,
    turns:[minutesA,minutesB].map((m,i)=>({id:`r${r}t${i+1}`,roundNumber:r,turnNumber:i+1,playerId:game.players[i].id,
      timing:{startedAt:'2026-10-01T10:00:00Z',endedAt:new Date(Date.parse('2026-10-01T10:00:00Z')+m*60000).toISOString(),pauses:[]}}))});
  const atRound3 = { ...next, phaseKey:'r3t1:false',round:3 };
  const timeHighlight = (rounds, p=prev, n=atRound3, corrections=game.timerCorrections) => detectTvHighlights(p,n,{...game,rounds,timerCorrections:corrections}).find(h=>h.kind==='time-overtake');
  let time = timeHighlight([timedRound(1,20,18),timedRound(2,11+5/60,16+10/60)]);
  assert.equal(time.playerId,b.id);
  assert.match(time.subtitle,/34:10 vs. 31:05/);
  assert.equal(timeHighlight([timedRound(1,20,18),timedRound(2,10,12.5)]),undefined,'Under 60 seconds has no leader');
  assert.equal(timeHighlight([timedRound(1,20,18),timedRound(2,10,13)]).playerId,b.id,'Exactly 60 seconds qualifies');
  assert.equal(timeHighlight([timedRound(1,20,18),timedRound(2,10,13)],{...prev,timeMs:[0,999999],leaderId:null}).playerId,b.id,'Independent of baseline times');
  assert.equal(timeHighlight([timedRound(1,10,10),timedRound(2,10,13)]),undefined,'First leader is not an overtake');
  const openRound = timedRound(2,10,13,false); openRound.turns[1].timing.endedAt = undefined;
  assert.equal(timeHighlight([timedRound(1,20,18),openRound]),undefined,'Unfinished turn excluded');
  time = timeHighlight([timedRound(1,20,18),timedRound(2,10,12),timedRound(3,10,12)],
    {...prev,round:3,phaseKey:'r3t2:false'},{...atRound3,round:4,phaseKey:'r4t1:false'});
  assert.equal(time.playerId,b.id,'Empty leader round preserves last non-empty leader');
  const completedRound = {...next,completed:true,phaseKey:'r2t2:true'};
  assert.equal(timeHighlight([timedRound(1,20,18),timedRound(2,10,13)],prev,completedRound).playerId,b.id,'Game end after completed round');
  assert.equal(timeHighlight([timedRound(1,20,18),timedRound(2,10,13,false)],prev,completedRound),undefined);

  for (const minutes of [30,45,60,120,180]) {
    const p = { ...prev, timeMs:[minutes * 60000 - 1,0] };
    const n = { ...next, timeMs:[minutes * 60000,0] };
    assert.ok(detect(p,n).some(h => h.kind === `time-milestone-0-${minutes}`));
    assert.ok(!detect({ ...p, timeMs:n.timeMs },n).some(h => h.kind.startsWith('time-milestone')));
  }
  const round = detect(prev, { ...next, round:3, phaseKey:'r3t1:false', roundPoints:[[0,0],[5,9],[0,0],[0,0],[0,0]] }).find(h => h.kind === 'round-summary');
  assert.equal(round.title, 'Runde 2 abgeschlossen'); assert.match(round.subtitle, /Alice 5 VP · Bob 9 VP/);
  game.status = 'completed'; game.finishReason = 'player-1-conceded';
  let end = detect(prev,{ ...next, completed:true, phaseKey:'r2t2:true' }).find(h => h.kind === 'game-end');
  assert.equal(end.title, 'Bob gewinnt');
  game.finishReason = 'draw';
  end = detect(prev,{ ...next, completed:true, phaseKey:'r2t2:true' }).find(h => h.kind === 'game-end');
  assert.equal(end.title, 'Unentschieden');
  game.finishReason = 'completed';
  game.scoreEvents = [{id:'winner',type:'score',playerId:a.id,scoreType:'primary',value:20,createdAt:'2026-10-01T10:00:00Z'}];
  end = detect(prev,{ ...next, completed:true, phaseKey:'r2t2:true' }).find(h => h.kind === 'game-end');
  assert.equal(end.title, 'Alice gewinnt');
  game.finishReason = 'interrupted';
  end = detect(prev,{ ...next, completed:true, phaseKey:'r2t2:true' }).find(h => h.kind === 'game-end');
  assert.equal(end.title, 'Spiel beendet');
  assert.deepEqual(detectTvHighlights(prev,prev,game), []);
  assert.deepEqual(detectTvHighlights(prev,{ ...prev, phaseKey:'r2t2:false' },game), []);
  assert.deepEqual(detectTvHighlights(prev,next,game,[]), []);
  assert.ok(HIGHLIGHT_RULES.length >= 5);
  const paused = createPausedActiveGameFixture();
  const source = JSON.stringify(paused);
  const s1 = createTvSnapshot(paused, '2026-04-21T19:30:00Z');
  const s2 = createTvSnapshot(paused, '2026-04-21T20:30:00Z');
  assert.equal(s1.timeMs[0], 8 * 60000); assert.equal(s1.timeMs[0], s2.timeMs[0]);
  assert.equal(JSON.stringify(paused), source);
  paused.rounds[0].turns[0].timing.pauses = [];
  assert.equal(createTvSnapshot(paused, '2026-04-21T19:30:00Z').timeMs[0], 30 * 60000);
};
module.exports = { runTvHighlightsTests };
