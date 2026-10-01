const assert = require('node:assert/strict');
const { loadBrowserModule } = require('./helpers/loadBrowserModule.cjs');
const { createBaseGame } = require('./helpers/gameFixtures.cjs');

const runTvGameViewTests = () => {
  const saved = Object.fromEntries(['document','navigator','setTimeout','clearTimeout'].map(k => [k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const state = [], effects = [], pending = [], timers = new Map();
  let cursor = 0, timerId = 0;
  const react = {
    createContext: () => ({}),
    useMemo: fn => fn(),
    useContext: () => new Proxy({ games: [] }, { get: (obj,key) => {
      assert.equal(key, 'games', 'TV must only read the already loaded games list from the store'); return obj[key];
    }}),
    useState: initial => { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial;
      return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
    useRef: initial => { const i = cursor++; return state[i] ?? (state[i] = {current:initial}); },
    useEffect: (fn,deps) => { const i = cursor++; const old = effects[i];
      if (!old || deps.some((v,j) => !Object.is(v,old.deps[j]))) pending.push(() => {
        old?.cleanup?.(); effects[i] = { deps, cleanup:fn() };
      }); }
  };
  const jsx = (type,props,key) => ({type,props,key});
  const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) :
    [node,...nodes(node.props?.children)];
  const render = (component,game) => { cursor = 0; const tree = component({game,onExit:()=>{}}); while (pending.length) pending.shift()(); return tree; };
  try {
    globalThis.setTimeout = (fn,ms) => { const id = ++timerId; timers.set(id,{fn,ms}); return id; };
    globalThis.clearTimeout = id => timers.delete(id);
    globalThis.document = {hidden:true,documentElement:{requestFullscreen:()=>{}},addEventListener:()=>{},removeEventListener:()=>{}};
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:{}});
    const { TvGameView } = loadBrowserModule('src/components/TvGameView.tsx', { react,'react/jsx-runtime':{jsx,jsxs:jsx} });
    const base = createBaseGame(); base.rounds = [{ id:'r1',roundNumber:1,turns:[{id:'t1',roundNumber:1,turnNumber:1,playerId:base.players[0].id,timing:{pauses:[]}}]}];
    base.scoreEvents = [{id:'s1',type:'score',playerId:base.players[0].id,scoreType:'primary',value:5,roundNumber:1,createdAt:'2026-10-01T10:00:00Z'}];
    const before = JSON.stringify(base);
    let tree = render(TvGameView,base);
    assert.equal(nodes(tree).filter(n => n.props?.className === 'tv-highlight').length,0, 'Initial load shows no historical highlights');
    assert.deepEqual(nodes(tree).filter(n => n.type === 'button').map(n => n.props.children),['Vollbild','TV-Modus verlassen']);
    const samePhase = structuredClone(base);
    samePhase.scoreEvents.push({...samePhase.scoreEvents[0],id:'s2',playerId:base.players[1].id,value:12});
    tree = render(TvGameView,samePhase);
    assert.equal(nodes(tree).filter(n => n.props?.className === 'tv-highlight').length,0,'Scores alone do not trigger an overlay');
    const next = structuredClone(samePhase);
    next.rounds[0].turns.push({id:'t2',roundNumber:1,turnNumber:2,playerId:next.players[1].id,timing:{pauses:[]}});
    render(TvGameView,next); tree = render(TvGameView,next);
    assert.equal(nodes(tree).find(n => n.props?.className === 'tv-highlight').props['data-kind'],'lead-change');
    const advanceOverlay = () => {
      const entry = [...timers].find(([,t]) => t.ms === 4000);
      assert.ok(entry,'Overlay expires after four seconds'); timers.delete(entry[0]); entry[1].fn();
      return render(TvGameView,next);
    };
    tree = advanceOverlay();
    assert.equal(nodes(tree).find(n => n.props?.className === 'tv-highlight').props['data-kind'],'challenge','Highlights appear sequentially');
    tree = advanceOverlay();
    assert.equal(nodes(tree).filter(n => n.props?.className === 'tv-highlight').length,0);
    render(TvGameView,structuredClone(next));
    assert.ok(![...timers.values()].some(t=>t.ms===4000),'No duplicate highlights on synchronized re-renders');
    const reset = structuredClone(next); reset.id = 'other';
    render(TvGameView,reset); tree = render(TvGameView,reset);
    assert.equal(nodes(tree).filter(n => n.props?.className === 'tv-highlight').length,0,'Changing game resets the baseline');
    assert.equal(JSON.stringify(base),before,'Rendering must not mutate game props');
    assert.ok(nodes(tree).find(n => n.props?.className === 'tv-phase__title'));
    assert.equal(nodes(tree).filter(n => n.props?.className === 'tv-player__time').length, 2);
    const text = nodes(tree).flatMap(n=>typeof n.props?.children === 'string' ? [n.props.children] : []);
    assert.ok(text.includes('Gesamtspielzeit'));
    const emptyMission = structuredClone(reset);
    emptyMission.players.forEach(p=>p.army.detachment='');
    emptyMission.startingPlayerId = ''; emptyMission.defenderPlayerId = ''; emptyMission.gamePoints = 0;
    tree = render(TvGameView,emptyMission);
    const labels = nodes(tree).filter(n=>n.type==='dt').map(n=>n.props.children);
    assert.deepEqual(labels,['Primärmission','Aufstellung']);
    const content = node => node === undefined || node === null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(content).join('') :
      typeof node === 'object' ? content(node.props?.children) : String(node);
    const phase = tree => nodes(tree).find(n=>n.props?.className==='tv-phase__clock');
    const deficit = tree => nodes(tree).find(n=>n.props?.className==='tv-deficit');
    assert.match(content(phase(tree)),/Laufende Zugzeit/);
    assert.match(content(deficit(tree)),/Alice liegt 7 VP zurück/);
    assert.match(content(tree),/Aktueller Zug · Bob/);
    const finished = structuredClone(emptyMission);
    finished.status='completed'; finished.finishReason='completed';
    finished.scoreEvents[0].value=27;
    finished.players[0].army.name='Necrons'; finished.players[1].army.name='Dark Angels';
    tree=render(TvGameView,finished);
    assert.match(content(phase(tree)),/Letzte Zugzeit/);
    assert.equal(content(deficit(tree)),'Alice gewinnt mit 15 VP Vorsprung');
    assert.match(content(tree),/Letzter Zug · Bob/);
    assert.doesNotMatch(content(tree),/Laufende Zugzeit|Aktueller Zug|VP zurück|verbleibender Runde/);
    const cards=nodes(tree).filter(n=>n.props?.className==='tv-panel tv-player');
    assert.notEqual(cards[0].props.style['--player-color'],cards[1].props.style['--player-color']);
    finished.finishReason='draw'; tree=render(TvGameView,structuredClone(finished));
    assert.equal(content(deficit(tree)),'Unentschieden');
    finished.finishReason='player-1-conceded'; tree=render(TvGameView,structuredClone(finished));
    assert.equal(content(deficit(tree)),'Bob gewinnt durch Aufgabe','Conceding overrides points without inventing a VP advantage');
    finished.finishReason='interrupted'; tree=render(TvGameView,structuredClone(finished));
    assert.equal(content(deficit(tree)),'Spiel beendet');

  } finally {
    for(const effect of effects) effect?.cleanup?.();
    for(const [key,descriptor] of Object.entries(saved)) {
      if(descriptor) Object.defineProperty(globalThis,key,descriptor); else delete globalThis[key];
    }
  }
};
module.exports = { runTvGameViewTests };
