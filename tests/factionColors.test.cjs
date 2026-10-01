const assert = require('node:assert/strict');
const { getFactionColor, getPlayerColors } = require('../.test-dist/data/factionColors.js');
const { ARMY_OPTIONS } = require('../.test-dist/data/armies.js');
const rgb = color => (color === 'var(--accent)' ? '#38bdf8' : color).slice(1).match(/../g).map(v=>parseInt(v,16));
const distance = (a,b) => Math.hypot(...rgb(a).map((v,i)=>v-rgb(b)[i]));
const runFactionColorsTests = () => {
  const [necrons,darkAngels] = getPlayerColors(' Necrons ', ' DARK ANGELS ');
  assert.equal(necrons,getFactionColor('Necrons',0));
  assert.notEqual(darkAngels,getFactionColor('Dark Angels',1));
  assert.ok(distance(necrons,darkAngels)>=100);
  assert.deepEqual(getPlayerColors('Unknown A','Unknown B'),['var(--accent)','#c4b5fd']);
  assert.deepEqual(getPlayerColors('Space Marines','Orks'),[getFactionColor('Space Marines',0),getFactionColor('Orks',1)]);
  assert.ok(distance(...getPlayerColors('Unknown','Thousand Sons'))>=100,'Unknown slot-one accent participates in collision detection');
  assert.ok(distance(...getPlayerColors('Genestealer Cults','Unknown'))>=100,'Unknown slot-two fallback can also collide');
  // Every mirror match and army combination remains distinguishable, including
  // A's purple/gold colors which themselves match one of the fallback accents.
  for (const a of ARMY_OPTIONS) for (const b of ARMY_OPTIONS) {
    const pair=getPlayerColors(a,b);
    assert.equal(pair[0],getFactionColor(a,0));
    assert.ok(distance(...pair)>=100,`${a} vs ${b}`);
    if(distance(getFactionColor(a,0),getFactionColor(b,1))>=100)
      assert.equal(pair[1],getFactionColor(b,1));
  }
};
module.exports = { runFactionColorsTests };
