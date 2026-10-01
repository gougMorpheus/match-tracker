const assert = require('node:assert/strict');
const { loadBrowserModule } = require('./helpers/loadBrowserModule.cjs');
const runTvEventFeedTests = () => {
  const saved = Object.fromEntries(['window','setTimeout','clearTimeout'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const state=[], effects=[], pending=[], timers=new Map(), movements=[];
  let cursor=0, dirty=false, timerId=0, reduce=false;
  const react={
    useState:initial=>{const i=cursor++; if(!(i in state)) state[i]=typeof initial==='function'?initial():initial;
      return [state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value;dirty=true;}];},
    useRef:initial=>{const i=cursor++;return state[i]??(state[i]={current:initial});},
    useLayoutEffect:(fn,deps)=>{const i=cursor++,old=effects[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))) pending.push(()=>{
      old?.cleanup?.();effects[i]={deps,cleanup:fn()};});}
  };
  const jsx=(type,props,key)=>({type,props,key});
  try {
    globalThis.window={matchMedia:()=>({matches:reduce})};
    globalThis.setTimeout=(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;};
    globalThis.clearTimeout=id=>timers.delete(id);
    const {TvEventFeed}=loadBrowserModule('src/components/TvEventFeed.tsx',{react,'react/jsx-runtime':{jsx,jsxs:jsx}});
    const event=id=>({id,createdAt:'2026-10-01T10:00:00Z',time:'12:00',text:id});
    let props={gameId:'game',feed:Array.from({length:8},(_,i)=>event(`old-${i}`))};
    const render=()=>{
      let tree,passes=0;
      do {
        dirty=false;cursor=0;tree=TvEventFeed(props);
        const children=tree.props.children[0];
        tree.props.ref.current={getBoundingClientRect:()=>({top:100}),querySelectorAll:()=>children.filter(n=>n.props.className==='tv-event').map((n,i)=>({
          offsetTop:i*25,dataset:{eventId:n.props['data-event-id']},getBoundingClientRect:()=>({top:100+i*25}),
          animate:(frames,options)=>{movements.push({id:n.key,frames,options});return{cancel:()=>{}};}
        }))};
        while(pending.length) pending.shift()();
        assert.ok(++passes<10,'Effects settle without a render loop');
      } while(dirty);
      return tree.props.children[0];
    };
    let rows=render();assert.equal(rows.length,8);assert.equal(movements.length,0);
    props={...props,feed:[event('new-1'),...props.feed].slice(0,8)};
    rows=render();
    assert.equal(rows.filter(n=>n.props.className==='tv-event').length,8);
    const leaving=rows.find(n=>n.props.className==='tv-event tv-event--leaving');
    assert.equal(leaving.key,'old-7');assert.equal(leaving.props.style.top,175);
    assert.ok(movements.some(m=>m.id==='old-0'&&m.frames[0].transform==='translateY(-25px)'&&m.options.duration===400),'Retained rows move with FLIP');
    assert.equal([...timers.values()][0].ms,400);
    props={...props,feed:[event('new-2'),...props.feed].slice(0,8)};rows=render();
    assert.equal(rows.filter(n=>n.props.className==='tv-event').length,8,'Rapid updates keep max eight active rows');
    assert.equal(rows.filter(n=>n.props.className.endsWith('--leaving')).length,2);
    for(const [id,t] of [...timers]){timers.delete(id);t.fn();}rows=render();
    assert.equal(rows.length,8,'Leaving rows are removed after their fade');
    reduce=true;movements.length=0;
    props={...props,feed:[event('reduced'),...props.feed].slice(0,8)};rows=render();
    assert.equal(rows.length,8);assert.equal(movements.length,0);assert.equal(timers.size,0);
    reduce=false;
    props={...props,feed:props.feed.slice(0,1)};render();assert.ok(timers.size>0);
    props={gameId:'other',feed:[event('other')]};rows=render();
    assert.equal(rows.length,1);assert.equal(rows[0].key,'other');assert.equal(timers.size,0);
    props={...props,feed:Array.from({length:12},(_,i)=>event(`limit-${i}`))};rows=render();
    assert.equal(rows.filter(n=>n.props.className==='tv-event').length,8);
    for(const effect of effects) effect?.cleanup?.();
    assert.equal(timers.size,0,'Unmount clears pending removal timers');
  } finally {
    for(const effect of effects) effect?.cleanup?.();
    for(const [key,descriptor] of Object.entries(saved)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  }
};
module.exports={runTvEventFeedTests};
