/* Independent two-client regression harness: real inline game + real Pages Function, no dependencies. */
const fs=require('fs'), path=require('path'), vm=require('vm'), assert=require('assert');
const root=path.resolve(__dirname,'..');
const game=fs.readFileSync(path.join(root,'valorant-anti-flash-trainer.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
let checks=0;
function ok(value,msg){assert.ok(value,msg); checks++; console.log('  OK '+msg);}
function client(name,offset=0){
  let mono=10000, wall=1000000+offset, tid=0, raf=[];
  const timers=new Map(), nodes=new Map(), events={};
  const canvas=new Proxy({},{get:(o,k)=>k==='createImageData'?(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)}):k.startsWith('create')?()=>({addColorStop(){}}):()=>{},set:(o,k,v)=>(o[k]=v,true)});
  function el(id){
    const cls=new Set();
    return {id,style:{},dataset:{},children:[],value:'',textContent:'',innerHTML:'',
      classList:{add:k=>cls.add(k),remove:k=>cls.delete(k),contains:k=>cls.has(k),toggle(k,b){if(b===undefined)b=!cls.has(k);b?cls.add(k):cls.delete(k);}},
      getContext:()=>canvas, getBoundingClientRect:()=>({width:1440,height:810,left:0,top:0}),
      get firstChild(){return this.children[0];},
      appendChild(n){this.children.push(n);return n;},removeChild(){},remove(){},focus(){},select(){},contains(){return false;},
      addEventListener(){},querySelectorAll:()=>[],querySelector:()=>el('q'),
      requestPointerLock:()=>Promise.reject(Error('gesture required'))};
  }
  const doc={getElementById(id){if(!nodes.has(id))nodes.set(id,el(id));return nodes.get(id);},
    createElement:el,querySelectorAll:()=>[],querySelector:()=>el('q'),
    addEventListener(k,f){(events[k]||(events[k]=[])).push(f);},exitPointerLock(){},pointerLockElement:null,hidden:false,body:el('body')};
  const storage=()=>({_:{},getItem(k){return this._[k]||null;},setItem(k,v){this._[k]=String(v);},removeItem(k){delete this._[k];}});
  class Clock extends Date{static now(){return wall;}}
  const ctx=vm.createContext({document:doc,console,Math,Date:Clock,performance:{now:()=>mono},
    window:{devicePixelRatio:1,addEventListener(){}},localStorage:storage(),sessionStorage:storage(),
    location:{search:'',origin:'http://test',pathname:'/game.html'},navigator:{},
    fetch:()=>Promise.reject(Error('offline')),AbortController,
    setTimeout(fn,delay=0){const id=++tid;timers.set(id,{fn,at:mono+delay});return id;},clearTimeout:id=>timers.delete(id),
    setInterval(){return ++tid;},clearInterval(){},requestAnimationFrame(fn){raf.push(fn);return raf.length;}});
  const run=s=>vm.runInContext(s,ctx);
  run(game);
  run('localStorage.setItem(LS_NAME,'+JSON.stringify(name)+');');
  return {run,doc,nodes,ctx,timers,
    apply(s){ctx.incoming=JSON.parse(JSON.stringify(s));run('applyState(incoming)');},
    async advance(ms){mono+=ms;wall+=ms;for(let n=0;n<30;n++){const due=[...timers].filter(([,t])=>t.at<=mono);if(!due.length)break;for(const [id,t] of due){timers.delete(id);t.fn();}await Promise.resolve();}await Promise.resolve();},
    frame(){const batch=raf;raf=[];for(const cb of batch)cb(mono);},
    jumpWall(ms){wall+=ms;},
    dispose(){run('match.cloud=false;leaveMatch(true)');timers.clear();}};
}
async function main(){
  let serverNow=1000000,writes=0;
  class ServerClock extends Date{static now(){return serverNow;}}
  const backend=vm.createContext({Response,Request,URL,Date:ServerClock,console});
  vm.runInContext(fs.readFileSync(path.join(root,'functions/api/room.js'),'utf8').replace(/export async function/g,'async function'),backend);
  const store=new Map();
  const env={ROOMS:{get:async k=>store.get(k)||null,put:async(k,v)=>{writes++;store.set(k,v);}}};
  async function post(body){backend.req={env,request:new Request('http://test/api/room',{method:'POST',body:JSON.stringify(body)})};return (await vm.runInContext('onRequestPost(req)',backend)).json();}
  async function get(){backend.req={env,request:new Request('http://test/api/room?code=ABCDEF')};return (await vm.runInContext('onRequestGet(req)',backend)).json();}
  const host=client('A',3600000),friend=client('B',-7200000);
  const cfg={agents:{phoenix:true},diff:1,mode:0,vis:0,roundIdx:1,rate:0.8,targetN:7};
  const made=await post({code:'ABCDEF',who:'host',name:'A',cfg});
  const joined=await post({code:'ABCDEF',who:'join',name:'B'});
  for(const [c,name] of [[host,'A'],[friend,'B']]){c.run(`enterMatch('ABCDEF');match.you='${name}';match.cloud=true;lobbyOpen();`);c.apply(joined);}
  const oneReady=await post({code:'ABCDEF',who:'ready',name:'B',ready:true});friend.apply(oneReady);
  const bothReady=await post({code:'ABCDEF',who:'ready',name:'A',ready:true});host.apply(bothReady);
  ok(host.run('match.phase')==='countdown','host starts countdown on ready response');
  host.apply(oneReady);
  ok(host.run('match.startAt')===bothReady.startAt&&host.run('match.iReady'),'delayed pre-ready snapshot cannot roll host back');
  host.jumpWall(86400000);
  await host.advance(3300);host.frame();await host.advance(300);host.frame();
  ok(host.run('match.phase')==='playing','countdown uses monotonic elapsed time despite wall clock jump');
  friend.apply(oneReady);serverNow+=65000;
  // Regional KV cache eventually refreshes; server now is fresh even when room snapshot was cached.
  const late=await get();friend.run("playing=true;paused=true;$('ovl').style.display='flex';$('result').style.display='flex';");friend.apply(late);
  ok(friend.run('match.phase')==='countdown','start received 62 seconds late still offers playable full round');
  ok(friend.run('cfg.diff===1&&cfg.targetN===7&&cfg.rate===0.8'),'fresh state synchronizes joiner fair settings before launch');
  await friend.advance(3300);friend.frame();await friend.advance(300);friend.frame();
  ok(friend.run("playing&&!paused&&match.phase==='playing'"),'friend enters playable round');
  ok(friend.run("!menuIsOpen()&&$('result').style.display==='none'&&!lobbyIsOpen()"),'existing-practice branch closes all blocking overlays');
  await Promise.resolve();await Promise.resolve();await friend.advance(500);
  ok(friend.run("$('mTag').textContent.includes('锁定')"),'pointer lock rejection has visible retry guidance');
  ok(friend.run('pollDelay()===0')&&host.run('pollDelay()===0'),'neither client polls in game');
  ok(friend.run('matchSeed()')===host.run('matchSeed()'),'both clients use same round content seed');
  friend.apply(oneReady);
  ok(friend.run('match.startAt')===bothReady.startAt,'late stale poll cannot undo started round');
  await post({code:'ABCDEF',who:'score',name:'A',score:100});await post({code:'ABCDEF',who:'score',name:'B',score:90});
  ok(writes===6,'complete two-client lifecycle retains exactly six KV writes');
  const again=await post({code:'ABCDEF',who:'again',name:'A'});friend.run("match.phase='result';roundOver=true;");friend.apply(again);friend.apply(late);
  ok(friend.run('match.round')===2,'older round cannot roll rematch back');
  const timeoutClient=client('timeout');
  timeoutClient.run("fetch=()=>new Promise(()=>{});globalThis.pending=cloudGet('ABCDEF');");
  await timeoutClient.advance(8001);
  ok(await timeoutClient.run('pending')===null,'hung fetch terminates within eight seconds');
  const polling=client('B');
  polling.run("enterMatch('ABCDEF');match.you='B';match.cloud=true;lobbyOpen();");polling.apply(oneReady);
  polling.ctx.oldSnapshot=joined;
  polling.run("globalThis.reads=0;cloudGet=()=>{reads++;return new Promise(resolve=>{globalThis.releasePoll=resolve;});};startPoll();");
  await polling.advance(2500);
  ok(polling.run('reads')===1,'poll starts one asynchronous read');
  polling.run('stopPoll();releasePoll(oldSnapshot);');await Promise.resolve();await polling.advance(10000);
  ok(polling.run('match.iReady')&&polling.run('reads')===1,'stopped in-flight poll cannot apply stale response or restart polling');
  polling.run("globalThis.posts=0;cloudPost=()=>{posts++;return new Promise(resolve=>{globalThis.releaseReady=resolve;});};globalThis.readyPromise=toggleReady();toggleReady();");
  ok(polling.run('posts')===1,'double ready click issues only one write');
  polling.ctx.readyResponse=oneReady;
  polling.run('releaseReady(readyResponse);');await polling.run('readyPromise');
  polling.run("match.iReady=false;cloudPost=async()=>null;");await polling.run('toggleReady()');
  ok(polling.run("match.cloud&&match.syncNote.includes('未确认')"),'unconfirmed ready stays cloud-connected and queries instead of retrying write');
  await polling.advance(16000);polling.run('renderLobby();');
  ok(polling.run("$('lbReady').textContent==='改为离线开局'"),'long synchronization delay exposes explicit offline fallback');
  await polling.run('toggleReady()');
  ok(polling.run("!match.cloud&&match.phase==='playing'"),'explicit fallback opens same-code local match');
  const background=client('B');
  background.run("enterMatch('ABCDEF');match.you='B';match.cloud=true;lobbyOpen();");background.apply(bothReady);
  await background.advance(100000);
  ok(background.run('match.phase')==='countdown','timer cannot launch gameplay without a foreground animation frame');
  background.frame();
  ok(background.run('roundEndAt-T')>59,'foreground launch receives full round after suspended animation frames');
  background.run('globalThis.savedScore=score;startMatchRound();');
  ok(background.run('score===savedScore'),'duplicate round start is idempotent');
  background.run('lobbyOpen();startPoll();');
  ok(background.run("match.phase==='playing'&&pollDelay()===0&&!lobbyIsOpen()"),'mid-round lobby navigation cannot resume polling or strand the running match');
  // Demonstrate the KV limit honestly: two regions can both read the same old record.
  // Revision metadata prevents client rollback; it is NOT a transaction/CAS mechanism.
  const staleRoom=JSON.stringify({cfg,host:'A',players:[{name:'A',ready:false},{name:'B',ready:false}],startAt:0,round:1,revision:2});
  let lastRegionalWrite=null,regionalWrites=0;
  const regionalEnv={ROOMS:{get:async()=>staleRoom,put:async(k,v)=>{lastRegionalWrite=JSON.parse(v);regionalWrites++;}}};
  for(const name of ['A','B']){
    backend.regionalRequest={env:regionalEnv,request:new Request('http://test/api/room',{method:'POST',body:JSON.stringify({code:'ABCDEF',who:'ready',name,ready:true})})};
    await vm.runInContext('onRequestPost(regionalRequest)',backend);
  }
  ok(regionalWrites===2 && lastRegionalWrite.startAt===0,'KV stale concurrent writes remain a documented limitation, not falsely solved by revisions');
  host.dispose();friend.dispose();timeoutClient.dispose();polling.dispose();background.dispose();
  console.log(`全部通过 (${checks})`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
