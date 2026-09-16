'use strict';
/* Run the actual inline music subsystem with deterministic network/audio/DOM fakes. */
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync(path.join(__dirname,'..','valorant-anti-flash-trainer.html'),'utf8');
const code=html.slice(html.indexOf('const MUSIC_DIR='),html.indexOf('/* ---------- 表面着色'));
let count=0;
function ok(value,label){ assert.ok(value,label); count++; console.log('OK '+label); }
const deferred=()=>{ let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; };
const flush=async()=>{ for(let i=0;i<40;i++) await Promise.resolve(); };
function harness(){
  const nodes=new Map(),requests=[],decodes=[],sources=[],timers=new Map(),logs=[]; let timer=0;
  function node(){ return {children:[],style:{},classList:{toggle(){}},textContent:'',appendChild(n){this.children.push(n);},set innerHTML(v){this.children=[];}}; }
  const audio={currentTime:0,state:'running',createGain:()=>({connect(){},gain:{value:1}}),
    createBufferSource(){const s={connect(){},disconnect(){},stop(){this.stopped=true;},start(at,off){this.started=off;}};sources.push(s);return s;},
    decodeAudioData(ab){const d=deferred();decodes.push({ab,...d});return d.promise;}};
  const ctx=vm.createContext({console,Map,Set,Uint8Array,ArrayBuffer,Promise,AbortController,Date,Math,Number,
    setTimeout(fn,ms){ const id=++timer;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},
    fetch(url,opts){const d=deferred();requests.push({url,opts,...d});return d.promise;},
    document:{createElement:node,addEventListener(){}},$:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},
    navigator:{connection:{}},audio:()=>audio,AC:audio,master:{},
    cfg:{sound:true,musicWhen:2,musicVol:.4,musicDuck:0},playing:false,paused:false,roundOver:false,T:0,flashes:[],
    menuIsOpen:()=>true,clamp:(v,a,b)=>Math.min(b,Math.max(a,v)),log:(...a)=>logs.push(a)});
  vm.runInContext(code,ctx);
  const run=s=>vm.runInContext(s,ctx);
  return {ctx,run,requests,decodes,sources,nodes,timers,logs,
    list(){run('mlist=["a","b","c"].map(x=>({id:x,name:x+".mp3",file:x+".mp3",dur:0,src:"dir"}));mcur=0;mActive=true;');},
    bytes(i,n=8){requests[i].resolve({ok:true,headers:{get:()=>null},arrayBuffer:()=>Promise.resolve(new ArrayBuffer(n))});},
    manifest(i,rows){requests[i].resolve({ok:true,json:()=>Promise.resolve(rows)});},
    expire(ms){for(const [id,t] of [...timers])if(t.ms===ms){timers.delete(id);t.fn();}}
  };
}
(async()=>{
  {
    const h=harness();const p=h.run('musicRefresh()');await flush();
    ok(h.requests.length===1&&/manifest.json$/.test(h.requests[0].url),'listing requests only the small manifest');
    h.manifest(0,['a.mp3','b.mp3',{file:'c.mp3',dur:123,size:1024},'a.mp3','../bad.mp3']);await p;
    ok(h.run('mlist.length')===3,'manifest supports legacy strings and optional metadata, deduplicates unsafe names');
    ok(h.run('mlist[2].dur')===123,'provided duration needs no media download');
    ok(h.requests.length===1&&h.decodes.length===0,'scan never fetches or decodes songs for duration');
    ok(h.nodes.get('musicList').children[0].children[1].textContent.includes('待播放'),'unknown duration is not a misleading zero length');
  }
  {
    const h=harness();h.run('idbGo=()=>new Promise(()=>{})');
    const p=h.run('musicRefresh()');await flush();h.manifest(0,['a.mp3']);await flush();
    ok(h.run('mlist.length')===1,'folder songs are selectable even while IndexedDB is stalled');
    h.expire(10000);await p;
    ok(h.run('mlist.length')===1,'IndexedDB timeout gracefully preserves folder songs');
  }
  {
    const h=harness();const old=h.run('musicRefresh(true)');await flush();const newer=h.run('musicRefresh(true)');await flush();
    h.manifest(1,['new.mp3']);await newer;h.manifest(0,['old.mp3']);await old;
    ok(h.run('mlist[0].file')==='new.mp3','late old rescan cannot overwrite the newest playlist');
  }
  {
    const h=harness();h.list();h.run('musicStart()');await flush();
    ok(h.run('mPending')&&h.nodes.get('musicNow').textContent.includes('正在加载'),'visible foreground loading status');
    ok(h.requests.length===1,'foreground download is not competing with playlist preloads');
    const reader={parts:[{done:false,value:new Uint8Array(4)},{done:false,value:new Uint8Array(4)},{done:true}],read(){return Promise.resolve(this.parts.shift());},cancel(){},releaseLock(){}};
    h.requests[0].resolve({ok:true,headers:{get:()=>8},body:{getReader:()=>reader}});await flush();
    ok(h.decodes.length===1&&h.nodes.get('musicNow').textContent.includes('正在解码'),'full selected download transitions to decode status');
    h.decodes[0].resolve({duration:120});await flush();
    ok(h.sources.length===1&&h.run('mbufId')==='a','selected song starts using WebAudio and owns sole decoded cache');
    ok(h.requests.length===2&&/b.mp3$/.test(h.requests[1].url),'only the next song prefetches after current playback starts');
    h.run('musicJump(1)');await flush();
    ok(h.requests.length===2,'selecting in-flight prefetched song reuses its request');
    ok(h.run('mbuf===null')&&h.sources[0].buffer===null,'switch releases previous decoded buffer and stopped source reference');
    h.bytes(1);await flush();h.decodes[1].resolve({duration:100});await flush();
    ok(h.run('mbufId')==='b'&&h.requests.length===3,'next track plays and prefetch window advances by just one');
    h.bytes(2);await flush();
    ok(h.decodes.length===2,'completed background download remains compressed, not decoded');
    h.run('musicToggle()');await flush();
    ok(!h.run('mPending')&&h.run('mWarm===null'),'pause cancels downloads and releases prefetched cache');
  }
  {
    const h=harness();h.list();h.run('musicStart()');await flush();h.run('musicJump(1)');await flush();
    ok(h.requests.length===2&&h.requests[0].opts.signal.aborted,'track switch immediately aborts old download instead of waiting for mPending');
    h.bytes(0);await flush();
    ok(h.decodes.length===0&&h.run('mPending'),'late cancelled response neither decodes nor clears new pending state');
    h.bytes(1);await flush();h.decodes[0].resolve({duration:90});await flush();
    ok(h.run('mbufId')==='b','latest selection wins');
  }
  {
    const h=harness();h.list();h.run('musicStart()');await flush();h.bytes(0);await flush();
    h.run('musicJump(1)');await flush();h.bytes(1);await flush();
    ok(h.decodes.length===1,'only one decode can run while an uncancellable old decode is pending');
    h.decodes[0].resolve({duration:111});await flush();
    ok(h.decodes.length===2&&h.sources.length===0,'stale decode result never starts playback or occupies cache');
    h.decodes[1].resolve({duration:222});await flush();
    ok(h.run('mDur')===222&&h.run('mbufId')==='b','queued current decode starts after stale decode finishes');
  }
  {
    const h=harness();h.list();h.run('musicStart()');await flush();h.expire(90000);await flush();
    ok(!h.run('mPending')&&!h.run('mActive')&&h.requests[0].opts.signal.aborted,'network timeout aborts request and exits loading');
    ok(h.nodes.get('musicNow').textContent.includes('超时'),'timeout gives actionable retry feedback');
    h.run('for(let i=0;i<100;i++)musicTick(.016)');await flush();
    ok(h.requests.length===1,'failed download is not retried by every game frame');
    h.run('musicToggle()');await flush();ok(h.requests.length===2,'play retries only on user intent');
  }
  {
    const h=harness();h.list();h.run('musicStart()');await flush();h.bytes(0);await flush();h.expire(30000);await flush();
    ok(!h.run('mPending')&&!h.run('mActive'),'decode timeout does not leave an eternal loading gate');
    h.decodes[0].resolve({duration:120});await flush();
    ok(h.sources.length===0&&h.run('mbuf===null'),'late timed-out decode cannot start playback');
  }
  {
    const h=harness();h.list();h.run('musicStart()');await flush();h.run('cfg.musicWhen=0;musicTick(.016)');await flush();
    ok(h.requests[0].opts.signal.aborted&&!h.run('mPending'),'playback-scope change cancels an in-flight load');
    h.bytes(0);await flush();ok(h.decodes.length===0,'disabled music cannot wake up on a late download');
  }
  {
    const h=harness();h.list();h.run('navigator.connection.saveData=true;musicStart()');await flush();h.bytes(0);await flush();h.decodes[0].resolve({duration:120});await flush();
    ok(h.requests.length===1,'data-saver disables speculative downloading');
    h.run('mLoop="shuffle";navigator.connection.saveData=false;musicPrefetch()');await flush();
    ok(h.requests.length===1,'shuffle does not waste bytes guessing next song');
  }
  {
    const h=harness();h.list();h.run('musicStart()');await flush();
    h.requests[0].resolve({ok:true,headers:{get:()=>26*1048576}});await flush();
    ok(h.run('mError').includes('25MB')&&!h.run('mPending'),'oversized song is rejected before allocating an unbounded buffer');
  }
  {
    const h=harness();h.list();h.run('musicPanelOpen=true;musicRenderP()');h.nodes.get('musicPList').children[1].children[1].onclick({stopPropagation(){}});await flush();
    ok(h.run('mcur')===1&&/b.mp3$/.test(h.requests[0].url),'play button on a different row actually selects that row');
  }
  {
    const h=harness();h.ctx.localBytes=new ArrayBuffer(12);h.run('idbGo=()=>Promise.resolve(localBytes);mlist=[{id:"u",name:"local.mp3",src:"idb"}];mcur=0;mActive=true;musicStart()');await flush();
    ok(h.decodes.length===1&&h.requests.length===0,'imported raw ArrayBuffer is read correctly without network');
  }
  {
    const h=harness();h.ctx.puts=[];h.ctx.files=[{name:'local.mp3',size:8,type:'audio/mpeg',arrayBuffer:()=>Promise.resolve(new ArrayBuffer(8))}];
    h.run('idbGo=(store,mode,fn)=>Promise.resolve(fn({getAll:()=>[],put:m=>{if(store===\"meta\")puts.push(m)}}));mFolder=[]');
    await h.run('musicImport(files)');
    ok(h.decodes.length===0&&h.ctx.puts[0].dur===0,'import stores compressed bytes without decoding the whole selection for metadata');
  }
  {
    const h=harness();h.list();h.run('musicStart()');await flush();
    const next=deferred();let reads=0;
    const reader={read(){return ++reads===1?Promise.resolve({done:false,value:new Uint8Array(4)}):next.promise;},cancel(){},releaseLock(){}};
    h.requests[0].resolve({ok:true,headers:{get:()=>8},body:{getReader:()=>reader}});await flush();
    ok(h.nodes.get('musicNow').textContent.includes('50%'),'streamed byte progress is visible before download completes');
    h.run('musicToggle()');next.resolve({done:true});await flush();
    ok(h.decodes.length===0,'cancelling midway through streamed body prevents decode');
  }
  {
    const h=harness();h.ctx.AbortController=undefined;const p=h.run('musicRefresh()');await flush();h.expire(10000);await p;
    ok(h.run('mlist.length')===0,'manifest timeout settles even without AbortController');
    ok(h.nodes.get('musicList').children[0].textContent.includes('重扫'),'unavailable manifest gives a rescan/import fallback');
  }
  {
    const h=harness();h.list();h.run('musicStart()');await flush();h.bytes(0);await flush();h.decodes[0].reject(new Error('unsupported'));await flush();
    ok(!h.run('mPending')&&!h.run('mActive')&&h.run('mError').includes('解码失败'),'unsupported media reports failure without an automatic retry loop');
  }
  ok(!code.includes('new Audio(')&&!code.includes("createElement('audio')"),'music playback never uses HTML audio elements');
  console.log('全部通过（'+count+' 条断言）');
})().catch(e=>{console.error(e);process.exitCode=1;});
