/* 独立训练回归：真实 HTML 内联脚本 + 最小 DOM/事件/rAF，无依赖。
 * node .workbuddy/training-test.js
 * 不替换产品函数，不截取局部实现；数值 fixture 只设置状态和视角。
 * 等待输入与完整回合单独走真实按钮、mousemove、keydown、visibilitychange 和 frame。
 */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const file=path.resolve(__dirname,'..','valorant-anti-flash-trainer.html');
const html=fs.readFileSync(file,'utf8');
const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);
if(!scripts.length) throw Error('找不到真实产品脚本：'+file);
let checks=0,fails=0;
function ok(value,message){checks++;if(!value)fails++;console.log((value?'  OK   ':'  FAIL ')+message);}
function equal(actual,expected,message){ok(JSON.stringify(actual)===JSON.stringify(expected),message+' [实际 '+JSON.stringify(actual)+']');}
function near(actual,expected,message,tolerance=1e-7){ok(Number.isFinite(actual)&&Math.abs(actual-expected)<=tolerance,message+' [实际 '+actual+']');}
const groups=[];
function test(name,body){groups.push({name,body});}
const plain=value=>JSON.parse(JSON.stringify(value));
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

/* 由 match-start client / smoke qualityBoot 派生。与宽松 getElementById 桩不同，
 * 节点来自真实 HTML；遗漏 ID 返回 null，按钮没有绑定就不会偷偷调用测试替身。
 * 这不是完整浏览器/CSS 实现；只模拟本产品使用的 DOM 子集，不做像素验收。 */
function boot(options={}){
  let mono=10000,wall=1800000000000,timerId=0,rafId=0;
  const timers=new Map(),raf=new Map(),nodes=new Map(),requests=[],writes=[];
  const store={...(options.store||{})},session={...(options.session||{})};
  if(options.cfg!==undefined)store.aft_cfg=JSON.stringify(options.cfg);
  if(options.trackCfg!==undefined)store.aft_tracking_cfg=JSON.stringify(options.trackCfg);
  const memory=data=>({getItem:k=>Object.prototype.hasOwnProperty.call(data,k)?data[k]:null,
    setItem(k,v){data[k]=String(v);writes.push({key:k,value:String(v),session:data===session});},removeItem:k=>{delete data[k];}});
  const drawing=new Proxy({}, {get(o,k){
    if(k in o)return o[k];
    if(k==='createImageData')return (w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)});
    if(k==='createLinearGradient'||k==='createRadialGradient')return ()=>({addColorStop(){}});
    if(k==='measureText')return text=>({width:String(text).length*6});
    return ()=>{};
  },set(o,k,v){o[k]=v;return true;}});
  function eventTarget(target){
    const listeners={};
    target.addEventListener=(type,fn)=>{(listeners[type]||(listeners[type]=[])).push(fn);};
    target.removeEventListener=(type,fn)=>{listeners[type]=(listeners[type]||[]).filter(f=>f!==fn);};
    target._listeners=listeners;
    target.dispatchEvent=e=>{
      if(!e.target)e.target=target;e.currentTarget=target;
      if(!e.preventDefault)e.preventDefault=function(){this.defaultPrevented=true;};
      if(!e.stopPropagation)e.stopPropagation=function(){this.cancelBubble=true;};
      const fn=target['on'+e.type];if(typeof fn==='function')fn.call(target,e);
      for(const cb of [...(listeners[e.type]||[])])cb.call(target,e);
      if(e.bubbles&&!e.cancelBubble&&target.parentNode)target.parentNode.dispatchEvent(e);
      return !e.defaultPrevented;
    };
    return target;
  }
  function matches(node,selector){
    if(!node.tagName)return false;
    const tag=selector.match(/^[\w-]+/);if(tag&&node.tagName!==tag[0].toUpperCase())return false;
    const id=selector.match(/#([\w-]+)/);if(id&&node.id!==id[1])return false;
    for(const m of selector.matchAll(/\.([\w-]+)/g))if(!node.classList.contains(m[1]))return false;
    for(const m of selector.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)){
      const value=node.getAttribute(m[1]);if(value===null||(m[2]!==undefined&&value!==m[2]))return false;
    }
    return true;
  }
  function query(root,selector){
    const result=[],selectors=selector.split(',').map(s=>s.trim().split(/\s+/));
    function visit(node){for(const child of node.children||[]){
      for(const chain of selectors){
        let cursor=child,index=chain.length-1;
        if(!matches(cursor,chain[index]))continue;
        while(--index>=0){cursor=cursor.parentNode;while(cursor&&cursor!==root&&!matches(cursor,chain[index]))cursor=cursor.parentNode;if(!cursor||!matches(cursor,chain[index]))break;}
        if(index<0){result.push(child);break;}
      }
      visit(child);
    }}
    visit(root);return result;
  }
  function element(tag='div'){
    const cls=new Set(),attrs={};let id='',text='',inner='';
    const node=eventTarget({tagName:tag.toUpperCase(),style:{},dataset:{},children:[],parentNode:null,
      value:'',disabled:false,width:300,height:150,title:'',
      classList:{add(...values){values.forEach(v=>cls.add(v));},remove(...values){values.forEach(v=>cls.delete(v));},
        contains:v=>cls.has(v),toggle(v,want){if(want===undefined)want=!cls.has(v);want?cls.add(v):cls.delete(v);return !!want;}},
      get className(){return [...cls].join(' ');},set className(v){cls.clear();String(v).split(/\s+/).filter(Boolean).forEach(x=>cls.add(x));},
      get id(){return id;},set id(v){if(id)nodes.delete(id);id=String(v);if(id)nodes.set(id,node);},
      get textContent(){return text+this.children.map(n=>n.textContent).join('');},set textContent(v){text=String(v);this.children=[];inner='';},
      get innerHTML(){return inner;},set innerHTML(v){inner=String(v);text='';this.children=[];parse(inner,this);},
      get firstChild(){return this.children[0]||null;},get lastChild(){return this.children[this.children.length-1]||null;},
      appendChild(child){if(child.parentNode)child.parentNode.removeChild(child);child.parentNode=this;this.children.push(child);return child;},
      removeChild(child){const i=this.children.indexOf(child);if(i>=0)this.children.splice(i,1);child.parentNode=null;return child;},
      remove(){if(this.parentNode)this.parentNode.removeChild(this);},
      contains(child){for(let n=child;n;n=n.parentNode)if(n===this)return true;return false;},
      querySelectorAll(selector){return query(this,selector);},querySelector(selector){return query(this,selector)[0]||null;},
      getAttribute(k){if(k==='id')return id||null;if(k==='class')return this.className||null;return k in attrs?attrs[k]:null;},
      setAttribute(k,v){v=String(v);attrs[k]=v;if(k==='id')this.id=v;else if(k==='class')this.className=v;
        else if(k==='value')this.value=v;else if(k==='disabled')this.disabled=true;
        else if(k==='width'||k==='height')this[k]=Number(v);
        else if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=v;
        else if(k==='style')for(const part of v.split(';')){const pair=part.split(':');if(pair.length>=2)this.style[pair[0].trim().replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=pair.slice(1).join(':').trim();}},
      click(){if(!this.disabled)this.dispatchEvent({type:'click',target:this,bubbles:true});},
      focus(){doc.activeElement=this;},blur(){if(doc.activeElement===this)doc.activeElement=null;},select(){},
      getContext:()=>drawing,getBoundingClientRect:()=>({width:1440,height:810,left:0,top:0,right:1440,bottom:810}),
      requestPointerLock(){if(options.lock){doc.pointerLockElement=this;doc.dispatchEvent({type:'pointerlockchange'});return Promise.resolve();}return Promise.reject(Error('gesture required'));}
    });
    node._appendText=v=>{text+=v;};return node;
  }
  function parse(markup,parent){
    const stack=[parent],voidTags=new Set(['AREA','BASE','BR','COL','EMBED','HR','IMG','INPUT','LINK','META','PARAM','SOURCE','TRACK','WBR']);
    for(const m of markup.replace(/<!--[\s\S]*?-->/g,'').matchAll(/<\/?[a-zA-Z][^>]*>|[^<]+/g)){
      const token=m[0];
      if(token.startsWith('</')){const tag=token.slice(2).match(/^[\w:-]+/)[0].toUpperCase();for(let i=stack.length-1;i>0;i--)if(stack[i].tagName===tag){stack.length=i;break;}continue;}
      if(token[0]==='<'){
        const tag=token.match(/^<([\w:-]+)/)[1],node=element(tag);
        const attrs=token.slice(tag.length+1,-1);
        for(const a of attrs.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))node.setAttribute(a[1],a[2]??a[3]??a[4]??'');
        stack[stack.length-1].appendChild(node);
        if(!voidTags.has(node.tagName)&&!token.endsWith('/>'))stack.push(node);
      }else stack[stack.length-1]._appendText(token);
    }
  }
  const doc=eventTarget({hidden:false,pointerLockElement:null,activeElement:null,
    getElementById:id=>nodes.get(id)||null,createElement:element,
    querySelectorAll:selector=>query(doc.body,selector),querySelector:selector=>query(doc.body,selector)[0]||null,
    exitPointerLock(){if(this.pointerLockElement){this.pointerLockElement=null;this.dispatchEvent({type:'pointerlockchange'});}},execCommand:()=>true});
  doc.body=element('body');doc.body.parentNode=doc;
  parse(html.match(/<body\b[^>]*>([\s\S]*?)<script\b/i)[1],doc.body);
  class Clock extends Date{constructor(...args){super(...(args.length?args:[wall]));}static now(){return wall;}}
  const win=eventTarget({devicePixelRatio:1,document:doc});
  const env={document:doc,window:win,console,Date:Clock,performance:{now:()=>mono},
    localStorage:memory(store),sessionStorage:memory(session),AbortController,URL,
    location:{search:'',origin:'http://training.test',pathname:'/game.html',href:'http://training.test/game.html'},navigator:{},
    confirm:()=>true,fetch(url,init){requests.push({url:String(url),method:init&&init.method||'GET',body:init&&init.body});return Promise.reject(Error('test offline'));},
    setTimeout(fn,delay=0){const id=++timerId;timers.set(id,{fn,at:mono+delay});return id;},clearTimeout:id=>timers.delete(id),
    setInterval(){return ++timerId;},clearInterval(){},
    requestAnimationFrame(fn){const id=++rafId;raf.set(id,fn);return id;},cancelAnimationFrame:id=>raf.delete(id)};
  env.globalThis=env;const context=vm.createContext(env);
  const run=source=>vm.runInContext(source,context,{filename:'training-fixture.js'});
  for(const source of scripts)vm.runInContext(source,context,{filename:file});
  const h={run,doc,win,nodes,store,session,requests,writes,context,
    json:source=>plain(run(source)),
    click(id){const n=nodes.get(id);if(!n)throw Error('真实 HTML 缺少 #'+id);n.click();},
    input(id,value){const n=nodes.get(id);if(!n)throw Error('真实 HTML 缺少 #'+id);n.value=String(value);n.dispatchEvent({type:'input',target:n,bubbles:true});},
    key(key){doc.dispatchEvent({type:'keydown',key,code:key===' '?'Space':'Key'+key.toUpperCase(),target:doc.body});},
    move(dx=1,dy=0,target=nodes.get('scene')){doc.dispatchEvent({type:'mousemove',target,movementX:dx,movementY:dy});},
    mouseDown(target=nodes.get('scene')){doc.dispatchEvent({type:'mousedown',target,button:0});},
    frame(ms=1000/60){mono+=ms;wall+=ms;const batch=[...raf.values()];raf.clear();if(!batch.length)throw Error('真实 rAF 队列为空');for(const fn of batch)fn(mono);
      for(const [id,t] of [...timers])if(t.at<=mono){timers.delete(id);t.fn();}},
    frames(count,ms=1000/60){for(let i=0;i<count;i++)h.frame(ms);},
    tab(name){const n=nodes.get('menuTabs').children.find(b=>b.dataset.tab===name);if(!n)throw Error('真实菜单缺少 '+name);n.click();},
    segment(id,index){const n=nodes.get(id).children[index];if(!n)throw Error(id+' 未创建第 '+index+' 个按钮');n.click();}
  };
  h.frame(0);return h;
}
function records(h,rows){h.run('saveRecords('+JSON.stringify({best:{},log:rows})+');');}
function row(id,by,extra={}){return {id,scope:'solo',diff:0,mode:0,by,...extra};}
function assessment(h,current,entry){return h.json('coachAssessment('+JSON.stringify(current)+','+JSON.stringify(entry||null)+')');}
const gameplay=h=>h.json('Object.fromEntries(PRACTICE_KEYS.map(k=>[k,cfg[k]]))');
function recommend(h,key='gekko'){
  h.run('cfg.auto=false;start();st.trials=4;st.by={'+JSON.stringify(key)+':{n:4,dg:0}};endRound();');
}
function numericTrack(h){h.run('startTracking();TRACK.waiting=false;TRACK.skip=false;');}
/* 用真实轨迹计算可控的持续命中/脱靶，绝不覆写 trackPosition/updateTracking。
 * 一个采样内微小运动小于最小半径；首末视角相同避免把人为瞬移算成真实扫过。 */
function sample(h,seconds,hit=true,dt=0.05){
  h.run(`(()=>{let remaining=${seconds};while(remaining>1e-9){const dt=Math.min(${dt},remaining),p=trackPosition(TRACK.elapsed+dt/2,TRACK.settings);
    cam.yaw=${hit?'Math.atan2(p.x-cam.x,p.z-cam.z)':'Math.PI'};cam.pitch=${hit?'Math.atan2(p.y-cam.y,Math.hypot(p.x-cam.x,p.z-cam.z))':'0'};
    TRACK.yaw=cam.yaw;TRACK.pitch=cam.pitch;updateTracking(dt);remaining-=dt;}})()`);
}
function followFrame(h,ms=50){
  const move=h.json(`(()=>{const p=trackPosition(TRACK.elapsed+${ms/1000},TRACK.settings),yaw=Math.atan2(p.x-cam.x,p.z-cam.z),pitch=Math.atan2(p.y-cam.y,Math.hypot(p.x-cam.x,p.z-cam.z));
    return [(yaw-cam.yaw)/(SENS_BASE*cfg.sens),(pitch-cam.pitch)/((cfg.invertY?1:-1)*SENS_BASE*cfg.sens)];})()`);
  h.move(move[0],move[1]);h.frame(ms);
}

test('A 冷启动、真实节点与绑定',()=>{
  const h=boot();
  ok(h.run("typeof coachAssessment==='function'&&typeof startAgentPractice==='function'&&typeof startTracking==='function'"),'训练核心函数来自真实产品脚本');
  ok(h.doc.getElementById('deliberately-missing-training-id')===null,'缺失 ID 不自动造假节点');
  ok(typeof h.nodes.get('coachTrain').onclick==='function','一键专项按钮已绑定真实 onclick');
  ok(typeof h.nodes.get('trackStart').onclick==='function','跟枪开始按钮已绑定');
  ok((h.doc._listeners.mousemove||[]).length===1,'document 只有一个鼠标位移监听');
  equal(h.json('trackCfg'),{path:0,speed:1,size:1,seconds:60},'默认跟枪设置');
  for(const [id,n] of [['segTrackPath',3],['segTrackSpeed',3],['segTrackSize',3],['segTrackDuration',2]])equal(h.nodes.get(id).children.length,n,id+' 按真实初始化构建按钮');
  h.tab('track');
  ok(h.nodes.get('tab-track').classList.contains('act')&&!h.nodes.get('tab-solo').classList.contains('act'),'真实页签点击切到跟枪页并关闭单人页');
  /* 改版：跟枪页自带「开始跟枪训练」，底部主操作不再重复同一个红按钮 ——
     曾经上下两个一模一样的红按钮并排，玩家不知道该点哪个。 */
  ok(h.nodes.get('ovlBtn').style.display==='none','跟枪页不重复显示第二个「开始跟枪训练」按钮');
  ok(/开始跟枪训练/.test(h.nodes.get('trackStart').textContent),'跟枪页唯一的开始入口是页内按钮');
  h.click('trackStart');
  ok(h.run("PRACTICE.kind==='track'&&playing&&!paused&&!roundOver"),'页内开始按钮启动跟枪而不是普通训练');
  h.run("openMenu('track',true);");          /* 训练中再开菜单：入口仍只有页内那一个 */
  ok(/继续跟枪训练/.test(h.nodes.get('trackStart').textContent)&&h.nodes.get('ovlBtn').style.display==='none','训练中重开菜单仍不出现第二个重复按钮');
  ok(h.nodes.get('trackStart').disabled===false,'进行中的跟枪可以由页内按钮继续');
});

test('B 分特工快照、记录隔离与旧记录兼容',()=>{
  const h=boot();
  h.run('globalThis.sourceBy={phoenix:{n:4,dg:2,extra:99},alien:{n:20,dg:0}};globalThis.snap=agentStatsSnapshot(sourceBy);');
  equal(h.json('snap'),{phoenix:{n:4,dg:2}},'仅快照已知特工的 n/dg，不保存未知字段');
  h.run('sourceBy.phoenix.n=99;sourceBy.phoenix.dg=99;');
  equal(h.json('snap'),{phoenix:{n:4,dg:2}},'快照不引用原始可变 st.by 对象');
  for(const [n,dg] of [[0,0],[-1,0],[1.2,0],[10001,0],[3,-1],[3,4],[3,0.5],['3',1],[3,'1'],[null,0]]){
    equal(h.json('agentStatsSnapshot({phoenix:'+JSON.stringify({n,dg})+'})'),{},'非法计数 '+JSON.stringify([n,dg])+' 不参与诊断');
  }
  equal(h.json('agentStatsSnapshot({phoenix:{n:10000,dg:10000}})'),{phoenix:{n:10000,dg:10000}},'允许合法样本上界与100%成功率');
  equal(h.json('agentStatsSnapshot(null)'),{},'空或旧快照安全降级');
  recommend(h,'vyse');
  const entry=h.json('loadRecords().log[0]');
  ok(!!entry.id&&entry.scope==='solo'&&typeof entry.profile==='string','普通新记录保存唯一 ID、scope 和配置签名');
  equal(entry.by,{vyse:{n:4,dg:0}},'recordRound 保存真实分特工快照');
  h.run('resetStats(true);');
  equal(h.json('loadRecords().log[0].by'),entry.by,'重置统计不修改已持久化的历史快照');
  const old={t:1700000000000,ri:1,diff:0,mode:0,score:17,tr:100,dg:0,ag:'phoenix',rf:1000};
  records(h,[old,null,{...old,id:'missing-by',scope:'solo'}]);
  ok(assessment(h,{}).recommendation===null,'旧记录没有 by 时不从总背闪率猜特工弱项');
  equal(h.json('coachHistory(0,0)'),[],'无明细旧记录不占近期训练样本');
  h.run('renderAgentHistory();');
  ok(/旧记录|积累/.test(h.nodes.get('recAgentHistory').innerHTML),'记录页解释旧数据不补猜');
});

test('C 加权统计、最小样本、20局上限与本轮去重',()=>{
  const h=boot();
  records(h,[row('a',{phoenix:{n:100,dg:100}}),row('b',{phoenix:{n:1,dg:0}})]);
  let a=assessment(h,{phoenix:{n:1,dg:0}});
  equal(a.totals.phoenix,{n:102,dg:100,rounds:3},'近期按成功总数/样本总数加权，不平均各局百分比');
  ok(a.recommendation===null,'100/102 不会被两局单样本失败误判为弱项');
  records(h,[row('a',{phoenix:{n:100,dg:0}}),row('b',{phoenix:{n:1,dg:1}})]);
  a=assessment(h,{phoenix:{n:1,dg:1}});
  ok(a.recommendation&&a.recommendation.key==='phoenix'&&a.recommendation.origin==='近期','2/102 长期弱项不被两局100%小样本掩盖');
  records(h,[]);
  for(const [n,dg,recommended] of [[2,0,false],[3,0,true],[5,3,false],[5,2,true]]){
    const result=assessment(h,{phoenix:{n,dg}}).recommendation;
    ok(!!result===recommended,'本轮 '+dg+'/'+n+' 严格要求至少3次且低于60%');
  }
  records(h,[row('a',{phoenix:{n:8,dg:0}})]);
  ok(assessment(h,{phoenix:{n:2,dg:0}}).recommendation===null,'10次但只有2局不作长期诊断，本轮也未满3次');
  records(h,[row('a',{phoenix:{n:4,dg:0}}),row('b',{phoenix:{n:3,dg:0}})]);
  ok(assessment(h,{phoenix:{n:2,dg:0}}).recommendation===null,'3局但只有9次仍不作长期诊断');
  records(h,[row('a',{phoenix:{n:4,dg:0}}),row('b',{phoenix:{n:4,dg:0}})]);
  ok(assessment(h,{phoenix:{n:2,dg:0}}).recommendation?.origin==='近期','3局10次恰好达到长期门槛');
  records(h,[row('a',{phoenix:{n:4,dg:3}}),row('b',{phoenix:{n:4,dg:3}})]);
  ok(assessment(h,{phoenix:{n:2,dg:0}}).recommendation===null,'长期恰好60%不推荐弱项');
  records(h,[row('saved-current',{phoenix:{n:5,dg:0}}),row('a',{phoenix:{n:5,dg:1}}),row('b',{phoenix:{n:5,dg:1}})]);
  a=assessment(h,{phoenix:{n:5,dg:0}},{id:'saved-current'});
  equal(a.totals.phoenix,{n:15,dg:2,rounds:3},'已入库的本轮 ID 排除后仅累计一次');
  const excluded=[row('daily',{phoenix:{n:100,dg:0}},{scope:'daily'}),row('match',{phoenix:{n:100,dg:0}},{scope:'match'}),row('track',{phoenix:{n:100,dg:0}},{scope:'track'}),row('hard',{phoenix:{n:100,dg:0}},{diff:1}),row('range',{phoenix:{n:100,dg:0}},{mode:2}),row('legacy',{phoenix:{n:100,dg:0}},{scope:undefined})];
  records(h,[...excluded,row('solo',{phoenix:{n:4,dg:2}}),row('drill',{phoenix:{n:5,dg:3}},{scope:'agent'})]);
  equal(h.json('coachHistory(0,0).map(e=>e.id)'),['solo','drill'],'只合并同难度同模式 solo/agent，不混每日、联机、跟枪与未知旧 scope');
  records(h,Array.from({length:25},(_,i)=>row(String(i),{phoenix:{n:1,dg:1}})));
  a=assessment(h,{phoenix:{n:1,dg:1}});
  equal(a.totals.phoenix,{n:20,dg:20,rounds:20},'近期20局包含本轮，而不是历史20局再加本轮');
  equal(h.json('coachHistory(0,0).map(e=>e.id)'),Array.from({length:20},(_,i)=>String(i)),'记录页也仅使用最近20局');
  records(h,[row('a',{phoenix:{n:4,dg:1}}),row('b',{phoenix:{n:4,dg:1}})]);
  a=assessment(h,{phoenix:{n:2,dg:0},skye:{n:3,dg:0}});
  ok(a.recommendation?.key==='phoenix'&&a.recommendation.origin==='近期','满足门槛的长期弱项优先于本轮小样本弱项');
});

test('D 严格回靶对比、特工建议及每日/联机结算隔离',()=>{
  const h=boot(),profile=h.run('coachProfile()');
  h.run('st.rfN=1;st.rfSum=1.4;');
  records(h,[row('a',{}, {profile,rf:900}),row('b',{}, {profile,rf:1100}),row('wrong',{}, {profile:'other',rf:1}),{rf:1}]);
  ok(/慢 400ms/.test(h.run('buildCoachNotes()')),'相同完整配置下1400ms对比1000ms均值仍提示慢400ms');
  records(h,[{rf:900},{rf:1100},row('x',{}, {profile:'different',rf:1})]);
  ok(!/均值/.test(h.run('buildCoachNotes()')),'旧记录与不同完整配置不会进入回靶均值');
  ok(/无法背闪/.test(h.run("coachAdvice('gekko')"))&&/射出后/.test(h.run("coachAdvice('gekko')")),'盖克建议明确必须发射前击毁，不能靠转身');
  ok(/一枪/.test(h.run("coachAdvice('vyse')"))&&/转身/.test(h.run("coachAdvice('vyse')")),'维斯建议同时提供击毁与转身策略');
  ok(/两枪/.test(h.run("coachAdvice('reyna')"))&&/近视/.test(h.run("coachAdvice('reyna')")),'蕾娜建议保留两枪与近视规则');
  for(const kind of ['daily','match']){
    const c=boot();
    if(kind==='daily')c.run('dailyStart();');else c.run('enterMatch(newRoomCode());start();');
    c.run("st.trials=4;st.by={gekko:{n:4,dg:0}};endRound();");
    ok(c.run('lastResultKind')===kind,kind+' 结算保留来源，不因恢复配置误作普通训练');
    ok(c.run('COACH.recommendation===null')&&c.nodes.get('resCoach').style.display==='none',kind+' 真实结算隐藏专项推荐并清掉旧推荐');
    if(kind==='daily'){
      ok(!c.run('DAILY.active'),'每日结算正常结束并恢复活动状态');
      equal(c.json('loadRecords().log'),[],'每日成绩不进入普通背闪记录');
      ok(/不进行跨轮/.test(c.nodes.get('resNote').textContent),'每日结算解释不参与普通跨轮弱项诊断');
    }else{
      equal(c.run('loadRecords().log[0].scope'),'match','联机普通记录标记 match 供诊断排除');
      c.run('leaveMatch(true);renderCoachCard();');
      ok(c.nodes.get('resCoach').style.display==='none'&&c.run('COACH.recommendation===null'),'退出房间后旧联机结算仍不开放专项卡片');
      ok(!/最弱项/.test(c.run('buildCoachNotes()')),'退出房间后旧联机结算仍不生成普通弱项文本');
    }
  }
});

test('E 一键专项真实开局、幂等、保存隔离、暂停与自然结束恢复',()=>{
  const h=boot({cfg:{mode:0,diff:1,rate:0.6,vis:1,roundIdx:0,targetN:7,targetR:0.12,sens:1.1,gain:0.65,flashGuard:false}});
  recommend(h,'gekko');const original=gameplay(h);
  ok(h.run("COACH.recommendation.key==='gekko'")&&h.nodes.get('coachTrain').style.display!=='none','结算真实生成盖克弱项与可点专项按钮');
  h.click('coachTrain');
  ok(h.run("PRACTICE.kind==='agent'&&PRACTICE.key==='gekko'&&playing&&!paused&&!roundOver"),'点击一键专项即启动独立 agent 训练');
  equal(h.json('enabledAgents()'),['gekko'],'专项完整特工表只启用推荐的一位');
  ok(h.run('cfg.mode===1&&cfg.diff===1&&cfg.auto&&roundSec()===60'),'专项固定纯躲闪60秒，难度沿用推荐');
  near(h.run('roundEndAt-T'),60,'专项真实倒计时为60秒');
  const started=h.run('roundEndAt');h.click('coachTrain');
  near(h.run('roundEndAt'),started,'重复点击旧一键按钮不重启计时或覆写快照');
  equal(h.json('PRACTICE.snapshot'),original,'专项快照完整保留原玩法设置');
  h.input('rGain',0.31);h.input('rSens',1.37);h.segment('segFlashGuard',1);h.segment('segCross',2);
  const saved=JSON.parse(h.store.aft_cfg||'{}');
  equal(Object.fromEntries(Object.keys(original).map(k=>[k,saved[k]])),original,'专项中保存个人设置不把临时单特工/mode1/60秒写入普通玩法存档');
  ok(saved.gain===0.31&&saved.sens===1.37&&saved.flashGuard===true&&saved.crossKind===2,'个人音量、灵敏度、护眼、准星修改正常持久化');
  h.frames(140,50);
  ok(h.run('st.trials>0&&Object.keys(st.by).every(k=>k==="gekko")'),'真实帧调度只生成专项目标，不混入其他特工');
  const left=h.run('roundEndAt-T');h.key('Escape');
  ok(h.run('paused&&menuIsOpen()'),'专项 Esc 暂停通过真实键盘事件生效');
  h.frame(70000);
  ok(h.run('paused&&!roundOver'),'专项暂停超过原时限仍不结算');
  h.key('Escape');
  ok(!h.run('paused'),'再次 Esc 恢复专项');
  near(h.run('roundEndAt-T'),left,'专项恢复平移 roundEndAt，暂停不吃剩余时长',1e-6);
  h.frame((left+0.01)*1000);
  ok(h.run("roundOver&&lastResultKind==='agent'&&PRACTICE.kind===''")&&h.nodes.get('result').style.display==='flex','专项满时自然结算并自动退出临时玩法');
  equal(gameplay(h),original,'自然结束恢复原玩法全部字段');
  ok(h.run('cfg.gain===0.31&&cfg.sens===1.37&&cfg.flashGuard&&cfg.crossKind===2'),'恢复玩法不回滚专项期间的个人设置');
  equal(h.run('loadRecords().log[0].scope'),'agent','专项成绩保留 agent 来源及特工明细');
  ok(!h.nodes.get('bFlash').disabled&&!h.nodes.get('bMatch').disabled,'结束恢复普通入口可用状态');
  h.click('resAgain');
  ok(h.run("PRACTICE.kind==='agent'&&PRACTICE.key==='gekko'&&!roundOver"),'结算再练此专项使用上次推荐，而非恢复后的普通模式');
  equal(gameplay(h).agents,h.json("dailyOnlyAgents(['gekko'])"),'重复专项仍只有原推荐特工');
  const n=h.run('loadRecords().log.length');h.click('practiceExit');
  equal(gameplay(h),original,'主动退出再次恢复原玩法');
  ok(h.run("!playing&&!roundOver&&PRACTICE.kind===''&&lastResultKind==='solo'"),'主动退出清掉专项与回合状态');
  equal(h.run('loadRecords().log.length'),n,'中途退出专项不伪造完整成绩');
  const reloaded=boot({store:h.store});
  equal(gameplay(reloaded),original,'刷新仍载入专项前的普通玩法');
  ok(reloaded.run('cfg.gain===0.31&&cfg.sens===1.37&&cfg.flashGuard&&cfg.crossKind===2'),'刷新保留新个人设置');
});

test('F 跟枪设置实际点击、独立存档和运行中锁定',()=>{
  const h=boot(),original=gameplay(h);
  h.tab('track');
  for(const [id,index,key,value] of [['segTrackPath',2,'path',2],['segTrackSpeed',0,'speed',0],['segTrackSize',2,'size',2],['segTrackDuration',0,'seconds',30]]){
    h.segment(id,index);equal(h.run('trackCfg.'+key),value,id+' 点击更新对应参数');
    ok(h.nodes.get(id).children[index].classList.contains('act'),id+' 回显选中态');
  }
  equal(JSON.parse(h.store.aft_tracking_cfg||'null'),{path:2,speed:0,size:2,seconds:30},'跟枪参数保存到独立 aft_tracking_cfg');
  equal(gameplay(h),original,'配置跟枪不修改普通玩法');
  const restored=boot({store:h.store});
  equal(restored.json('trackCfg'),{path:2,speed:0,size:2,seconds:30},'冷启动从独立存档还原跟枪设置');
  ok(restored.nodes.get('segTrackDuration').children[0].classList.contains('act'),'冷启动时长选中态与存档一致');
  h.click('trackStart');
  equal(h.json('TRACK.settings'),{path:2,speed:0,size:2,seconds:30},'开局使用设置的独立快照');
  for(const id of ['segTrackPath','segTrackSpeed','segTrackSize','segTrackDuration'])ok(h.nodes.get(id).children.every(b=>b.disabled),id+' 在训练中禁改');
  h.segment('segTrackPath',0);
  equal(h.run('trackCfg.path'),2,'点击禁用轨迹按钮不会悄悄修改下一局参数');
  h.input('rGain',0.23);h.input('rFov',111);
  const saved=JSON.parse(h.store.aft_cfg||'{}');
  equal(Object.fromEntries(Object.keys(original).map(k=>[k,saved[k]])),original,'跟枪中保存音画参数不污染普通 mode/auto/时长');
  ok(saved.gain===0.23&&saved.fov===111,'跟枪中个人音量和FOV照常保存');
  h.key('Escape');h.click('menuPracticeExit');
  equal(gameplay(h),original,'菜单退出跟枪恢复普通玩法');
  ok(h.run("!playing&&PRACTICE.kind===''")&&h.nodes.get('tab-track').classList.contains('act'),'菜单退出返回跟枪设置页而不是残留暂停局');
  equal(h.json('loadTrackRecords()'),[],'未完成跟枪不会产生独立记录');
  for(const value of [null,{}, {path:-1,speed:3,size:1.5,seconds:120},{path:'2',speed:null,size:true,seconds:'30'}]){
    equal(h.json('cleanTrackCfg('+JSON.stringify(value)+')'),{path:0,speed:1,size:1,seconds:60},'非法跟枪设置 '+JSON.stringify(value)+' 回退安全默认');
  }
  const corrupt=boot({store:{aft_tracking_cfg:'{bad',aft_tracking_records:'{bad'}});
  equal(corrupt.json('trackCfg'),{path:0,speed:1,size:1,seconds:60},'损坏设置存档不阻断启动');
  equal(corrupt.json('loadTrackRecords()'),[],'损坏独立历史安全视为空');
});

test('G 轨迹边界、速度/大小、确定性及随机流独立',()=>{
  const h=boot();
  h.run('globalThis.randomCalls=0;globalThis.contentCalls=0;Math.random=()=>{randomCalls++;return 0.5;};contentRnd=()=>{contentCalls++;return 0.5;};');
  const result=h.json(`(()=>{const out=[];for(let path=0;path<3;path++)for(let speed=0;speed<3;speed++)for(let size=0;size<3;size++){
    const settings={path,speed,size,seconds:60};let bounded=true,moves=false,last=null;
    for(let t=0;t<=60;t+=0.03125){const p=trackPosition(t,settings),opening=p.y>ARCH.ys?Math.sqrt(Math.max(0,ARCH.r*ARCH.r-(p.y-ARCH.ys)*(p.y-ARCH.ys))):ARCH.r;
      bounded=bounded&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.z===ROOM.zW&&Math.abs(p.x)+p.r<opening&&p.y-p.r>ROOM.yF&&p.r===TRACK_SIZES[size].r;
      if(last&&Math.hypot(p.x-last.x,p.y-last.y)>1e-4)moves=true;last=p;
    }out.push({path,speed,size,bounded,moves});}return out;})()`);
  for(const r of result)ok(r.bounded&&r.moves,'轨迹'+r.path+' 速度'+r.speed+' 大小'+r.size+' 全60秒球体位于拱门内且持续运动');
  ok(h.run('randomCalls===0&&contentCalls===0'),'轨迹采样不消耗真随机或内容种子流');
  const positions=h.json('TRACK_SPEEDS.map((s,speed)=>trackPosition(0.7/s.omega,{path:0,speed,size:1}))');
  equal(positions[0],positions[1],'慢/标准速度同相位落在相同位置');
  equal(positions[1],positions[2],'标准/快速速度同相位落在相同位置');
  const paths=h.json('TRACK_PATHS.map((_,path)=>trackPosition(1,{path,speed:1,size:1}))');
  ok(paths[0].x!==paths[1].x&&paths[0].y!==paths[2].y,'平滑变速与八字并非左右往返的重复标签');
  equal(h.json('trackPosition(1,{path:2,speed:1,size:1})'),paths[2],'重复采样确定且不依赖历史调用顺序');
});

test('H 数值积分：覆盖、最长连续、首次获取和重捕获',()=>{
  const h=boot();numericTrack(h);
  sample(h,1,true);sample(h,0.5,false);sample(h,2,true);
  near(h.run('TRACK.elapsed'),3.5,'累计有效时间1+0.5+2秒');
  near(h.run('TRACK.on'),3,'覆盖时长1+2秒');
  near(h.run('TRACK.streak'),2,'当前连续2秒');
  near(h.run('TRACK.best'),2,'最长连续2秒，不把两段拼接');
  near(h.run('TRACK.reacquireSum'),0.5,'脱靶0.5秒后重捕获计时');
  equal(h.run('TRACK.reacquireN'),1,'首次命中不算重捕获，仅第二段加一次');
  near(h.run('score'),50,'独立分数按覆盖/60秒折算1000分');
  h.run('updateTrackingHUD(true);');
  equal(h.nodes.get('trackHudRate').textContent,'85.7%','HUD显示覆盖率而非普通点射命中率');
  equal(h.nodes.get('trackHudReacquire').textContent,'500ms','HUD显示重新跟住耗时');
  const first=boot();numericTrack(first);sample(first,0.4,false);sample(first,0.6,true);
  equal(first.run('TRACK.reacquireN'),0,'开场先脱靶再首次获取不制造重捕获数据');
  near(first.run('TRACK.on'),0.6,'首次获取只累计实际覆盖时间');
  h.run('trackingBreak();TRACK.waiting=false;');
  const before=h.run('TRACK.elapsed');sample(h,0.05,true);
  near(h.run('TRACK.elapsed'),before,'trackingBreak 后首帧只同步视角，不计时');
  sample(h,0.2,true);
  near(h.run('TRACK.best'),2,'暂停断开当前连续但保留已完成的最长连续');
  equal(h.run('TRACK.reacquireN'),1,'暂停恢复后的首次获取不被误计为重捕获');
  near(h.run('TRACK.streak'),0.2,'暂停后连续时间从零重新累计');
});

test('I 异常间隔/暂停/后台防刷与跨帧率一致性',()=>{
  const h=boot();numericTrack(h);sample(h,0.3,true);
  for(const dt of ['0','-0.02','NaN','Infinity','0.100001','15']){
    h.run('TRACK.skip=false;TRACK.waiting=false;');const before=h.json('[TRACK.elapsed,TRACK.on,TRACK.best,score]');
    h.run('updateTracking('+dt+');');
    equal(h.json('[TRACK.elapsed,TRACK.on,TRACK.best,score]'),before,'异常 dt='+dt+' 不计有效时长或分数');
    ok(h.run('TRACK.skip&&TRACK.streak===0&&!TRACK.onTarget'),'异常 dt='+dt+' 断开连续并要求跳过恢复首帧');
  }
  for(const condition of ['paused=true','document.hidden=true','playing=false','roundOver=true','TRACK.waiting=true']){
    h.run('paused=false;document.hidden=false;playing=true;roundOver=false;TRACK.waiting=false;TRACK.skip=false;'+condition+';');
    const before=h.json('[TRACK.elapsed,TRACK.on,score]');h.run('updateTracking(0.05);');
    equal(h.json('[TRACK.elapsed,TRACK.on,score]'),before,condition+' 时 updateTracking 不计时不加分');
  }
  const a=boot(),b=boot();numericTrack(a);numericTrack(b);
  sample(a,5,true,1/30);sample(b,5,true,1/144);
  near(a.run('TRACK.elapsed'),b.run('TRACK.elapsed'),'30FPS与144FPS累计有效时间相同');
  near(a.run('TRACK.on'),b.run('TRACK.on'),'30FPS与144FPS持续跟住覆盖时间相同');
  near(a.run('TRACK.best'),b.run('TRACK.best'),'30FPS与144FPS最长连续相同');
  near(a.run('TRACK.target.x'),b.run('TRACK.target.x'),'轨迹按 elapsed 推进，不按帧数或全局T推进');
  const wrap=boot();numericTrack(wrap);
  wrap.run('cam.yaw=-Math.PI+0.01;TRACK.yaw=Math.PI-0.01;cam.pitch=TRACK.pitch=0;updateTracking(0.05);');
  near(wrap.run('TRACK.on'),0,'视角跨±π按最短弧插值，不虚构经过正前方的命中');
});

test('J 等待输入、指针锁回退、Esc/后台/失焦真实事件',()=>{
  const h=boot();h.tab('track');h.click('trackStart');h.frames(20,50);
  ok(h.run('TRACK.waiting&&TRACK.elapsed===0&&score===0'),'开始后未移动鼠标不计时、不扣表现');
  ok(h.nodes.get('trackPrompt').style.display!=='none'&&/移动/.test(h.nodes.get('trackPrompt').textContent),'无锁定回退有明确移动开始提示');
  h.move(5,0,h.nodes.get('rGain'));h.frame(50);
  ok(h.run('TRACK.waiting&&TRACK.elapsed===0'),'菜单控件外部移动不能启动跟枪');
  h.move(0,0);h.move(1600,0);h.frame(50);
  ok(h.run('TRACK.waiting&&TRACK.elapsed===0'),'零位移及驱动尖峰均不是有效开始动作');
  h.click('trackPrompt');h.frame(50);
  ok(h.run('TRACK.waiting&&TRACK.elapsed===0'),'点击重试锁定不替代真实鼠标移动');
  h.move(1,0);h.frame(1000/60);
  ok(h.run('!TRACK.waiting&&TRACK.elapsed===0'),'有效画布移动解除等待，但 updateTracking 首帧必须跳过');
  h.frame(1000/60);
  ok(h.run('TRACK.elapsed>0'),'下一有效帧才开始累计');
  const before=h.run('TRACK.elapsed');h.key('Escape');
  ok(h.run('paused&&TRACK.waiting')&&h.nodes.get('tab-track').classList.contains('act'),'Esc 暂停同时回到跟枪页并重新等待输入');
  h.frame(30000);near(h.run('TRACK.elapsed'),before,'暂停30秒不消耗训练时长');
  h.key('Escape');h.frames(10,50);
  ok(h.run('!paused&&TRACK.waiting'),'恢复后仍要求移动鼠标继续');
  near(h.run('TRACK.elapsed'),before,'恢复后未移动不累计挂机时间');
  h.move(1,0);h.frame(50);near(h.run('TRACK.elapsed'),before,'恢复有效移动首帧仍跳过');h.frame(50);
  near(h.run('TRACK.elapsed'),before+0.05,'恢复后第二有效帧继续累计');
  h.doc.hidden=true;h.doc.dispatchEvent({type:'visibilitychange'});
  ok(h.run('paused&&TRACK.waiting'),'真实 visibilitychange 自动暂停跟枪');
  const hidden=h.run('TRACK.elapsed');h.frames(4,5000);
  near(h.run('TRACK.elapsed'),hidden,'后台 rAF 即使被调用也不计时');
  h.doc.hidden=false;h.doc.dispatchEvent({type:'visibilitychange'});h.frame(50);
  ok(h.run('paused'),'回到前台不擅自恢复计分');
  h.click('ovlBtn');h.move(1,0);h.frame(50);h.frame(50);
  h.win.dispatchEvent({type:'blur'});
  ok(h.run('paused&&TRACK.waiting'),'真实 window blur 自动暂停并清连续状态');
  const locked=boot({lock:true});locked.click('trackStart');locked.move(1,0);locked.frames(2,50);
  locked.doc.exitPointerLock();
  ok(locked.run('paused&&TRACK.waiting'),'实际 pointerlockchange 失锁暂停跟枪');
});

test('K 完整 start→mousemove→frame→finish、独立记录与幂等',()=>{
  const h=boot({cfg:{mode:0,roundIdx:2,auto:true,targetN:7,gain:0.6},trackCfg:{path:0,speed:1,size:1,seconds:30}});
  const original=gameplay(h);records(h,[{t:1700000000000,score:123,ri:1,diff:0,mode:0}]);
  const ordinary=h.store.aft_records;
  h.run(`globalThis.cleanupStops=0;globalThis.cleanupDisconnects=0;
    const oldDizzy=spawnFlash('gekko');
    const source=()=>({stop(){cleanupStops++;},disconnect(){cleanupDisconnects++;}});
    trackDizzySound(oldDizzy,source());dizzyAudios.push(source());
    dizzyPlasmas=[{from:{x:0,y:0,z:6.5},fireAt:T,hitAt:T+0.5,dur:1.8}];
    blindUntil=T+100;blindDur=2;nearUntil=T+100;fogNear=1;dizzyBlindUntil=T+100;`);
  h.tab('track');h.click('trackStart');
  ok(h.run('flashes.length===0&&dizzyPlasmas.length===0&&blindUntil===0&&nearUntil===0&&fogNear===0&&dizzyBlindUntil===0'),'跟枪开局清理旧闪光/电浆/白屏/近视残留');
  ok(h.run('cleanupStops===2&&cleanupDisconnects===2&&dizzyAudios.length===0'),'跟枪开局停止本体与失主的全局盖克音源，不让录音跨玩法继续响');
  ok(h.run('targets.length===0&&!!TRACK.target&&roundEndAt===0'),'只保留独立移动靶，不生成旧点射球或普通倒计时');
  h.frames(10,50);near(h.run('TRACK.elapsed'),0,'完整回合也先等待真实移动');
  // 50ms 恰好卡在 applyLook 的异常输入阈值，浮点舍入可能触发主动丢位移。
  // 完整鼠标流程用正常约60FPS；数值长帧边界在 I 组独立验证。
  followFrame(h,16);near(h.run('TRACK.elapsed'),0,'完整回合首个鼠标帧不计时');
  for(let i=0;i<1890&&!h.run('roundOver');i++)followFrame(h,16);
  ok(h.run("roundOver&&lastResultKind==='track'&&PRACTICE.kind===''")&&h.nodes.get('trackResult').style.display==='flex','完整30秒真实帧自动进入独立跟枪结算');
  near(h.run('TRACK.elapsed'),30,'完整流程按30秒有效时间准确截断');
  ok(h.run('TRACK.on>29&&score>=966&&score<=1000'),'持续真实 mousemove 跟住目标获得对应高覆盖率成绩');
  equal(h.run('st.shots'),0,'无需任何点击/开枪也能获得跟枪成绩');
  equal(h.run('st.trials'),0,'跟枪完整回合不产生普通闪光题目');
  equal(h.store.aft_records,ordinary,'跟枪结算不改普通记录或最佳榜');
  equal(h.run('loadTrackRecords().length'),1,'跟枪只保存一条独立记录');
  const rec=h.json('loadTrackRecords()[0]');
  ok(rec.seconds===30&&rec.path===0&&rec.speed===1&&rec.size===1&&rec.score===h.run('score'),'独立记录保存本局实际设置与分数');
  equal(gameplay(h),original,'跟枪自然结束恢复原玩法');
  ok(h.nodes.get('result').style.display==='none'&&h.nodes.get('resCoach').style.display==='none','跟枪结算不显示旧背闪结算或推荐卡');
  const savedWrites=h.writes.filter(w=>w.key==='aft_tracking_records').length;
  h.frames(12,50);h.run('finishTracking();endRound();recordRound();');
  equal(h.run('loadTrackRecords().length'),1,'结算后重复帧/finish/endRound/recordRound 不重复记录');
  equal(h.writes.filter(w=>w.key==='aft_tracking_records').length,savedWrites,'幂等结算没有额外 localStorage 写');
  ok(!h.requests.some(r=>r.method==='POST'),'完整跟枪不写每日榜或联机云端');
  h.click('trackAgain');
  ok(h.run("PRACTICE.kind==='track'&&!roundOver&&TRACK.elapsed===0&&TRACK.on===0&&TRACK.waiting"),'独立结算再来按钮清零新局并等待输入');
  equal(h.json('TRACK.settings'),{path:0,speed:1,size:1,seconds:30},'再来沿用独立设置而非普通轮次时长');
  h.click('practiceExit');
  equal(h.run('loadTrackRecords().length'),1,'重开后中途退出不增加记录');
});

test('L 时长边界、60秒完整帧、结算导航和历史上限',()=>{
  const h=boot({trackCfg:{path:0,speed:1,size:1,seconds:30}});numericTrack(h);
  h.run('TRACK.elapsed=29.99;TRACK.on=12;TRACK.best=3;TRACK.streak=0;');sample(h,0.02,true);
  near(h.run('TRACK.elapsed'),30,'末帧超过剩余时长时截断到30秒');
  near(h.run('TRACK.on'),12.01,'末帧只加剩余0.01秒覆盖');
  equal(h.run('loadTrackRecords()[0].score'),400,'边界成绩按完整配置时长作分母');
  h.click('trackSetup');
  ok(h.run("!playing&&!roundOver&&lastResultKind==='solo'")&&h.nodes.get('tab-track').classList.contains('act'),'结算调整参数返回跟枪页并清回合');
  h.segment('segTrackDuration',1);h.click('trackStart');
  h.move(1,0);h.frame(50);
  for(let i=0;i<1210&&!h.run('roundOver');i++)h.frame(50);
  ok(h.run('roundOver'),'60秒配置也经完整 frame 流程自然结束');
  near(h.run('TRACK.elapsed'),60,'60秒完整帧只累计配置时长，容忍浮点尾差');
  equal(h.run('loadTrackRecords()[0].seconds'),60,'60秒成绩独立保存正确时长');
  const finalScore=h.run('score');h.mouseDown();h.key(' ');
  equal(h.run('score'),finalScore,'独立结算后的点击与空格不能刷普通分');
  h.key('Escape');
  ok(h.nodes.get('trackResult').style.display==='none'&&h.run("!playing&&!roundOver&&lastResultKind==='solo'"),'跟枪结算 Esc 走独立退出，而不是旧 resClose 自由练习');
  const valid={t:1700000000000,path:0,speed:1,size:1,seconds:30,on:15,best:4,score:500,reacquire:null};
  h.run('localStorage.setItem(LS_TRACK_REC,'+JSON.stringify(JSON.stringify(Array.from({length:105},(_,i)=>({...valid,t:valid.t+i}))))+');');
  equal(h.run('loadTrackRecords().length'),100,'独立历史最多读取100条');
  h.run('renderTrackHistory();');
  equal((h.nodes.get('trackHistory').innerHTML.match(/class="trackHistoryRow"/g)||[]).length,20,'设置页仅显示最近20条独立记录');
  const invalid=[null,{...valid,path:9},{...valid,on:31},{...valid,on:-1},{...valid,best:31},{...valid,seconds:120},{...valid,score:null}];
  h.run('localStorage.setItem(LS_TRACK_REC,'+JSON.stringify(JSON.stringify([...invalid,valid]))+');');
  equal(h.run('loadTrackRecords().length'),1,'非法历史条目被排除，合法旧跟枪记录仍可读取');
});

test('M 跟枪与专项禁 F/A/R/点击，重开不混旧统计',()=>{
  const h=boot();numericTrack(h);sample(h,1,true);
  const before=h.json('[score,st,TRACK.elapsed,TRACK.target,cfg.auto,flashSeq]');
  h.key('f');h.key('a');h.key('r');h.key(' ');h.mouseDown();h.click('bFlash');h.click('bAuto');
  equal(h.json('[score,st,TRACK.elapsed,TRACK.target,cfg.auto,flashSeq]'),before,'真实 F/A/R/空格/画布点击与旧按钮不能出闪、换靶或刷分');
  ok(h.nodes.get('bFlash').disabled&&h.nodes.get('bAuto').disabled&&h.nodes.get('bMatch').disabled&&h.nodes.get('dailyStart2').disabled,'跟枪 UI 禁用旧玩法和云端入口');
  h.run('manualFlash();toggleAuto();relocateTarget();spawnFlash("phoenix");shoot();updateAuto();fillTargets();');
  equal(h.json('[score,st,TRACK.elapsed,TRACK.target,cfg.auto,flashSeq]'),before,'功能级守卫阻止绕过禁用按钮调用旧玩法');
  equal(h.run('targets.length+flashes.length'),0,'跟枪底层不生成旧靶点或闪光');
  h.click('bReset');
  ok(h.run("PRACTICE.kind==='track'&&TRACK.elapsed===0&&TRACK.on===0&&TRACK.waiting&&score===0"),'重置按钮真正重开跟枪并等待输入，不只清旧 st');
  equal(h.run('loadTrackRecords().length'),0,'重置不记录未完成回合');
  const agent=boot();recommend(agent,'vyse');agent.click('coachTrain');
  const config=agent.json('[cfg.auto,flashSeq,nextAutoAt]');agent.key('f');agent.key('a');agent.click('bFlash');agent.click('bAuto');agent.run('manualFlash();toggleAuto();');
  equal(agent.json('[cfg.auto,flashSeq,nextAutoAt]'),config,'特工专项同样禁止手动加题和切断自动排期');
  ok(agent.run('spawnFlash("vyse")!==null'),'专项仍允许正常自动调度底层产生自身目标');
});

test('N 云端入口双向隔离、主动退出后恢复普通训练',async()=>{
  for(const kind of ['track','agent']){
    const h=boot();if(kind==='track')h.run('startTracking();');else{recommend(h,'phoenix');h.click('coachTrain');}
    await settle();const original=gameplay(h),net=h.requests.length;
    const code=h.run('newRoomCode()');
    equal(h.run('enterMatch('+JSON.stringify(code)+')'),false,kind+' 不允许底层 enterMatch 插入联机');
    await h.run('createMatch()');await h.run('joinMatch('+JSON.stringify(code)+')');
    h.run('sessionStorage.setItem(LS_MATCH,'+JSON.stringify(JSON.stringify({code})) +');');await h.run('resumeMatch()');
    h.run('dailyStart();');h.click('mCreate');h.nodes.get('mJoin').value=code;h.click('mJoinBtn');h.nodes.get('mJoin').dispatchEvent({type:'keydown',key:'Enter',target:h.nodes.get('mJoin')});
    h.click('dailyStart2');h.click('bMatch');await settle();
    ok(h.run('!match.active&&!DAILY.active'),kind+' 创建/加入/重连/每日/UI入口都不切换专项状态');
    equal(h.requests.length,net,kind+' 禁止入口在守卫前不发任何云端请求');
    equal(gameplay(h),original,kind+' 被拒绝入口不改专项玩法配置');
    h.run("match.active=true;match.cloud=true;match.sent=false;match.code='ABCDEF';match.you='test';");
    await h.run('submitMyResult()');
    equal(h.requests.length,net,kind+' 防御性 submitMyResult 守卫不把专项分数发到云端');
    h.run('match.active=false;match.cloud=false;');
    h.click('practiceExit');h.tab('solo');h.click('ovlBtn');
    ok(h.run("playing&&!paused&&!roundOver&&PRACTICE.kind===''&&lastResultKind==='solo'"),kind+' 主动退出后普通入口可重新开局');
  }
  for(const active of ['daily','match']){
    const h=boot();h.run(active==='daily'?'DAILY.active=true;':'match.active=true;');
    h.run("roundOver=true;COACH.recommendation={key:'phoenix',diff:0};");
    equal(h.run("startAgentPractice('phoenix')"),false,active+' 活动中不能启动特工专项');
    equal(h.run('startTracking()'),false,active+' 活动中不能启动独立跟枪');
    ok(h.run("PRACTICE.kind===''"),active+' 拒绝启动后不遗留专项快照');
  }
  const protocol=boot();equal(protocol.run('MODES.length'),3,'原联机 MODE 协议仍只有0/1/2，不增加跟枪 mode3');
  ok(!Object.keys(protocol.json('packSync()')).some(k=>/track|practice/i.test(k)),'公平同步包不夹带跟枪参数或专项状态');
});

test('O 跟住提示音：真实 WebAudio、切入边沿、静音和冷却',()=>{
  const h=boot();numericTrack(h);
  h.run(`globalThis.trackTones=[];globalThis.trackGains=[];
    AC={currentTime:20,state:'running',createOscillator(){
      const o={frequency:{setValueAtTime(v){o.freq=v;},exponentialRampToValueAtTime(v){o.slide=v;}},
        connect(g){o.gain=g;},start(t){o.startAt=t;trackTones.push(o);},stop(t){o.stopAt=t;}};return o;
    },createGain(){const g={gain:{setValueAtTime(){},linearRampToValueAtTime(v){g.peak=v;},exponentialRampToValueAtTime(){}},connect(target){g.target=target;}};trackGains.push(g);return g;}};
    master={gain:{value:0.5}};busFlash={gain:{value:1}};cfg.sound=true;`);
  sample(h,0.1,true);
  equal(h.run('trackTones.length'),1,'首次真正压住球体只启动一次提示音');
  ok(h.run('trackTones[0].type==="sine"&&trackTones[0].freq===940&&trackTones[0].slide===1380'),'提示使用短促柔和上扬正弦音，而非点击命中或闪光声');
  ok(h.run('trackTones[0].stopAt-trackTones[0].startAt<0.1&&trackGains[0].peak<=0.1'),'短音不足0.1秒且低增益，不持续蜂鸣');
  ok(h.run('trackGains[0].target===master&&bus===null'),'提示音走总音量，不受闪光音量总线控制');
  sample(h,2,true);equal(h.run('trackTones.length'),1,'连续跟住两秒不逐帧重播');
  sample(h,0.25,false);sample(h,0.1,true);
  equal(h.run('trackTones.length'),2,'脱靶后重新压上球体播放一次');
  const before=h.run('trackTones.length');
  for(let i=0;i<10;i++){sample(h,0.01,false,0.01);sample(h,0.01,true,0.01);}
  ok(h.run('trackTones.length')-before<=2,'边界来回抖动受180ms冷却限制，不堆叠音源');
  const muted=h.run('trackTones.length');h.run('cfg.sound=false;');sample(h,0.3,false);sample(h,0.2,true);
  equal(h.run('trackTones.length'),muted,'音效关闭后命中不创建音源');
  h.run('cfg.sound=true;');sample(h,0.2,true);
  equal(h.run('trackTones.length'),muted,'解除静音不补播持续命中期间的旧提示');
  sample(h,0.3,false);sample(h,0.1,true);
  equal(h.run('trackTones.length'),muted+1,'重新开启音效后下一次切入正常播放');
  const paused=h.run('trackTones.length');h.run('pause();');sample(h,0.5,true);
  equal(h.run('trackTones.length'),paused,'暂停不启动新的提示音');
  h.run('resume();');sample(h,0.2,true);
  equal(h.run('trackTones.length'),paused,'恢复等待输入阶段不播放提示音');
  h.run('TRACK.waiting=false;');sample(h,0.05,true);sample(h,0.1,true);
  equal(h.run('trackTones.length'),paused+1,'暂停恢复后实际重新跟住可获得提示');
  h.run('startRound();');ok(h.run('TRACK.cueAt===-Infinity'),'重开清空提示冷却，不继承上一轮');
  h.run('TRACK.waiting=false;TRACK.skip=false;');sample(h,0.1,true);
  equal(h.run('trackTones.length'),paused+2,'新回合第一次压住球体立即有提示');
});

test('P 增强轨迹的幅度、速度、连续性及旧记录标记',()=>{
  const h=boot();
  const motion=h.json(`(()=>{const out=[];for(let path=0;path<2;path++){
    const s={path,speed:1,size:1},dt=0.002;let distance=0,oldDistance=0,minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,maxStep=0;
    let prev=trackPosition(0,s),old=0;
    for(let t=dt;t<=30;t+=dt){const p=trackPosition(t,s),phase=t*TRACK_SPEEDS[1].omega,oldX=1.12*Math.sin(path===1?phase+0.32*Math.sin(phase*1.35):phase);
      const step=Math.hypot(p.x-prev.x,p.y-prev.y);distance+=step;maxStep=Math.max(maxStep,step);oldDistance+=Math.abs(oldX-old);
      minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);prev=p;old=oldX;
    }out.push({path,distance,oldDistance,minX,maxX,minY,maxY,maxStep});}return out;})()`);
  for(const m of motion){
    ok(m.maxX-m.minX>2.7,'轨迹'+m.path+'横向范围扩大至至少2.7世界单位');
    ok(m.distance>m.oldDistance*1.45,'轨迹'+m.path+'同档30秒移动距离比旧版提升至少45%');
    ok(m.maxStep<0.025,'轨迹'+m.path+'高频采样位置连续、无突然瞬移');
  }
  near(motion[0].minY,motion[0].maxY,'左右往返仍保持水平专项，不改成八字');
  ok(motion[1].maxY-motion[1].minY>1,'平滑变速新增超过1世界单位的垂直起伏');
  const old={t:1,path:0,speed:1,size:1,seconds:30,on:15,best:4,score:500};
  ok(/旧版轨迹/.test(h.run('trackSettingsLabel('+JSON.stringify(old)+')')),'旧左右往返记录有旧版标记，不与增强版误比');
  ok(!/旧版/.test(h.run('trackSettingsLabel({...'+JSON.stringify(old)+',motionVersion:TRACK_MOTION_VERSION})')),'新版轨迹记录无旧版标记');
  ok(!/旧版/.test(h.run('trackSettingsLabel({...'+JSON.stringify(old)+',path:2})')),'未改的八字旧成绩仍可比较');
  h.run('startTracking();TRACK.waiting=false;TRACK.skip=false;TRACK.elapsed=30;TRACK.settings.seconds=30;finishTracking();');
  equal(h.run('loadTrackRecords()[0].motionVersion'),h.run('TRACK_MOTION_VERSION'),'新结算保存轨迹版本');
  ok(h.nodes.get('ovlBtn').parentNode===h.nodes.get('menuPracticeExit').parentNode&&h.nodes.get('menuActions'),'两个菜单操作位于同一全宽布局容器');
  ok(/#menuActions\s*\{[^}]*flex-direction:column/.test(html)&&/#menuActions button\s*\{[^}]*width:100%[^}]*margin:0/.test(html),'菜单主操作和退出按钮共享宽度、间距及排版规则');
});

test('Q 菜单重排：页内二级导航、底部操作语义与真实节点映射',()=>{
  const h=boot();
  /* 二级导航：每个按钮都必须指向真实存在的分组容器，且点击后只亮一个分组。
     用 id 显式登记而不是 querySelectorAll —— 测试桩里 querySelectorAll 是空实现。 */
  for(const [barId,groupIds] of [['setTabs',['setGroupPlay','setGroupFeel','setGroupAudio','setGroupHelp']],
                                 ['recTabs',['recGroupBest','recTrend','recDaily','recMatch']]]){
    const bar=h.nodes.get(barId);
    ok(!!bar,'菜单缺少二级导航 '+barId);
    equal([...bar.children].map(b=>b.dataset.page),groupIds,barId+' 每个分类按钮都指向真实分组');
    for(const id of groupIds)ok(!!h.nodes.get(id),barId+' 分组容器 '+id+' 存在于真实 HTML');
    h.tab(barId==='setTabs'?'set':'rec');
    let actCount=0;
    for(const button of bar.children){
      button.click();
      const on=groupIds.filter(id=>h.nodes.get(id).classList.contains('act'));
      actCount+=on.length;
      equal(on,[button.dataset.page],'点击「'+button.textContent+'」只显示对应分组');
      ok(button.classList.contains('act'),'当前分类按钮高亮：'+button.textContent);
      const others=[...bar.children].filter(b=>b!==button).filter(b=>b.classList.contains('act'));
      equal(others.length,0,'其它分类按钮取消高亮');
    }
    ok(actCount===groupIds.length,'每组分类都恰好激活一个分组，没有互相残留');
  }
  /* 底部操作：设置/记录/音乐页不该出现「开始训练」或看不懂的「返回结算」 */
  for(const [tab,label] of [['set','返回游戏'],['rec','返回游戏'],['music','返回游戏']]){
    h.tab(tab);
    equal(h.nodes.get('ovlBtn').textContent,label,tab+' 页底部是「'+label+'」，不是开始训练或返回结算');
    ok(!h.nodes.get('ovlBtn').classList.contains('pri'),tab+' 页底部不用主按钮样式，避免和真正的开始混淆');
    ok(h.nodes.get('ovlBtn').style.display!=='none',tab+' 页底部保留退出菜单的入口');
  }
  h.tab('solo');
  ok(/开始训练|继续训练/.test(h.nodes.get('ovlBtn').textContent),'单人训练页底部才是开始训练');
  ok(h.nodes.get('ovlBtn').classList.contains('pri'),'单人训练页底部使用主按钮样式');
  /* 顶部收窄后菜单内容区更高，且 logo/副标题不应再吃掉大量垂直空间 */
  ok(/#menuHead\{padding:18px/.test(html)&&/#ovlBox \.logo\{width:62px/.test(html),'菜单顶部已收窄，给内容区让出高度');
  ok(/\.subtabs\{[^}]*position:sticky/.test(html),'二级导航吸顶，切分类不用先滚回顶部');
  /* 二级导航要和设置里的分段控件同款：整条等宽平分、文字居中。
     曾经是 flex:none 的小胶囊 —— 左对齐、不占满宽度，看着像标签而不是选择器。 */
  ok(/\.subtabs button\{[^}]*flex:1/.test(html),'二级导航按钮等宽平分整行');
  ok(/\.subtabs button\{[^}]*text-align:center|\.subtabs button\{[^}]*padding:7px 4px/.test(html)&&!/\.subtabs button\{[^}]*flex:none/.test(html),'二级导航按钮居中且不再左对齐成小胶囊');
  ok(/\.subtabs\{[^}]*border-radius:9px[^}]*padding:3px/.test(html),'二级导航轨道与 .seg 同款（同圆角同内边距）');
  ok(/#tab-set #scroll\{padding:0\}/.test(html),'设置页不再多一层缩进，二级导航与其它页对齐');
  /* 每个提供二级导航的页面都必须有一句「这一页做什么」的导读 */
  for(const [tabId,lead] of [['tab-track','跟住红球'],['setGroupPlay','训练题目'],['setGroupFeel','手感'],['setGroupAudio','音乐盒']]){
    const node=h.nodes.get(tabId).querySelector('.pageLead');
    ok(!!node,tabId+' 有页首导读');
    if(node)ok(node.textContent.includes(lead),tabId+' 导读说明了该页范围（含「'+lead+'」）');
  }
});

(async()=>{
  for(const group of groups){console.log('['+group.name+']');try{await group.body();await settle();}catch(error){ok(false,'测试组异常：'+error.message);console.error(String(error.stack).split('\n').slice(0,6).join('\n'));}}
  console.log(fails?'有 '+fails+' 项失败（'+checks+' 条断言）':'全部通过（'+checks+' 条断言）');
  if(fails)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
