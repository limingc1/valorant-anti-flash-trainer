/* 冒烟测试：在最小 DOM 桩环境里跑真实游戏脚本，验证关键行为 */
const fs=require('fs'), vm=require('vm'), path=require('path');
const file=path.resolve(__dirname,'..','valorant-anti-flash-trainer.html');
const html=fs.readFileSync(file,'utf8');
const m=html.match(/<script>([\s\S]*?)<\/script>/);
if(!m){ console.log('FAIL: 找不到 script 块'); process.exit(1); }
const code=m[1];

let fails=0, assertions=0;
const ok=(c,msg)=>{ assertions++; console.log((c?'  OK   ':'  FAIL ')+msg); if(!c) fails++; };

/* ---- 语法 ---- */
try{ new vm.Script(code,{filename:'game.js'}); console.log('[1] 语法检查'); ok(true,'脚本可解析'); }
catch(e){ console.log('[1] 语法检查'); ok(false,e.message); process.exit(1); }

/* ---- DOM 桩 ---- */
const ctxStub=new Proxy({},{
  get(t,k){
    if(k==='createRadialGradient'||k==='createLinearGradient') return ()=>({addColorStop(){}});
    if(k in t) return t[k];
    return function(){};
  },
  set(t,k,v){ t[k]=v; return true; }
});
function el(id){
  const cls=new Set();               /* 真实维护 class，方便断言 UI 状态 */
  return {
    id, tagName:'DIV', style:{}, dataset:{}, children:[],
    classList:{
      add(c){cls.add(c)},
      remove(){for(const c of arguments) cls.delete(c)},
      toggle(c,f){ const want=(f===undefined)?!cls.has(c):!!f; if(want) cls.add(c); else cls.delete(c); return want; },
      contains(c){return cls.has(c)}
    },
    get className(){return [...cls].join(' ')},
    set className(v){ cls.clear(); String(v).split(/\s+/).forEach(c=>c&&cls.add(c)); },
    _text:'', title:'', volume:1, currentTime:0, src:'',
    get innerHTML(){return this._html||''},
    set innerHTML(v){ this._html=String(v); if(v==='') this.children.length=0; },
    get textContent(){return this._text}, set textContent(v){this._text=v},
    get firstChild(){return this.children[0]},
    appendChild(c){this.children.push(c);return c},
    removeChild(){}, remove(){}, load(){},
    querySelector(){return el('q')}, querySelectorAll(){return []},
    addEventListener(){}, removeEventListener(){},
    getBoundingClientRect(){return {width:1440,height:810,left:0,top:0,right:1440,bottom:810}},
    requestPointerLock(){return Promise.resolve()},
    getContext(){return ctxStub},
    play(){return Promise.resolve()}, pause(){}, cloneNode(){return el(id)},
    focus(){}, blur(){}, contains(){return false}
  };
}
const cache={};
const document={
  getElementById(id){ return cache[id]||(cache[id]=el(id)); },
  createElement(t){ return el(t); },
  querySelector(){ return el('q'); }, querySelectorAll(){ return []; },
  addEventListener(){}, removeEventListener(){},
  pointerLockElement:null, exitPointerLock(){}, body:el('body')
};
let rafCb=null;
const sandbox={
  document, console,
  window:{ addEventListener(){}, devicePixelRatio:1, AudioContext:undefined, webkitAudioContext:undefined },
  requestAnimationFrame(cb){ rafCb=cb; return 1; },
  setTimeout, clearTimeout, setInterval, clearInterval,
  Math, Date, JSON, Promise, Object, Array, String, Number, Boolean, Error, isNaN, parseFloat, parseInt,
  Audio: function(){ return el('audio'); },
  /* 联机代码会用到这些浏览器全局；给最小实现，让启动与降级路径都能跑 */
  localStorage:{ _d:{}, getItem(k){ return k in this._d?this._d[k]:null; }, setItem(k,v){ this._d[k]=String(v); }, removeItem(k){ delete this._d[k]; } },
  sessionStorage:{ _d:{}, getItem(k){ return k in this._d?this._d[k]:null; }, setItem(k,v){ this._d[k]=String(v); }, removeItem(k){ delete this._d[k]; } },
  location:{ search:'', origin:'http://x', pathname:'/index.html', href:'http://x/index.html' },
  navigator:{},
  fetch:()=>Promise.reject(new Error('no-net'))   /* 触发 cloudGet/cloudPost 的降级分支 */
};
sandbox.window.document=document; sandbox.globalThis=sandbox;
const ctx=vm.createContext(sandbox);
let T=0;
const run=s=>vm.runInContext(s,ctx);
const step=n=>{ for(let i=0;i<n;i++){ if(!rafCb) throw new Error('rAF 队列空'); const cb=rafCb; rafCb=null; T+=16.7; cb(T); } };
const aim=t=>run('(function(){var t='+t+';cam.yaw=Math.atan2(t.x,t.z);cam.pitch=Math.atan2(t.y,Math.hypot(t.x,t.z));})()');

/* ---- 执行 ---- */
try{ vm.runInContext(code,ctx,{filename:'game.js'}); console.log('[2] 启动'); ok(true,'脚本执行无异常'); }
catch(e){ console.log('[2] 启动'); ok(false,e.message); console.log(e.stack.split('\n').slice(0,4).join('\n')); process.exit(1); }

try{
  step(3); run('start()');
  console.log('[3] 开局');
  ok(run('playing===true && paused===false'),'start() 后进入游戏（不再因 started 崩溃）');
  ok(run('targets.length===cfg.targetN'),'开局即生成 '+run('cfg.targetN')+' 个靶点');
  /* 默认一轮 60s，而整套用例要跑几千帧游戏时钟。
     一旦累计时间越过 60s，updateRound() 会 endRound() -> roundOver=true，
     frame() 随即跳过 updateFlashes()，飞行中的闪光和紫眼就永远不结算，
     表现为 [7]「超时后紫眼消散 / 近视随之解除」随机失败。
     这里统一切成「不限」；[10] 单轮计时那组自己会重设 roundIdx。 */
  run('cfg.roundIdx=3; startRound();');
  ok(run('roundEndAt')===0 && run('roundOver')===false,'测试环境切到不限时，倒计时不会中途掐表');

  step(120);
  console.log('[4] 多靶点命中与补位');
  const before=run('JSON.stringify(targets.map(t=>[t.x,t.y]))');
  aim('targets[0]');
  const h0=run('st.hits'), s0=run('st.shots');
  run('shoot()');
  ok(run('st.hits')===h0+1,'瞄准后射击判为命中');
  ok(run('st.shots')===s0+1,'出手计数 +1');
  ok(run('targets.length')===run('cfg.targetN'),'命中后靶点数量不变（补了一颗）');
  ok(run('JSON.stringify(targets.map(t=>[t.x,t.y]))')!==before,'被击中的那颗换了位置');
  const n0=run('targets.length');
  run('cfg.targetN=7; fillTargets();');
  ok(run('targets.length')===7,'调整数量滑块后补齐到 7 个');

  console.log('[5] 靶点互不重叠');
  const minGap=run('(function(){var g=1e9;for(var i=0;i<targets.length;i++)for(var j=i+1;j<targets.length;j++)g=Math.min(g,Math.hypot(targets[i].x-targets[j].x,targets[i].y-targets[j].y));return g;})()');
  ok(minGap>run('targetR()')*0.9,'最小间距 '+minGap.toFixed(3)+' > 靶点半径');

  console.log('[6] 蕾娜之眼：凭空出现 + 睁眼 + 近视');
  /* 自动闪光必须在这整段之前就关掉：[6]/[6b]/[7] 里有几十次 step，
     此时 reyna 已被启用，自动派发的若又是一只紫眼，
     [7] 的 flashes.length===0 与 nearUntil===0 会一起随机红。 */
  run('cfg.auto=false;');
  run('flashes=[];pops=[];blindUntil=0;blindDur=0;nearUntil=0;nearSrc=0;cfg.agents.reyna=true;spawnFlash("reyna");');
  const home=run('JSON.stringify(flashes[0].home)');
  step(10);
  ok(run('JSON.stringify(flashes[0].pos)')===home,'没有飞行轨迹：位置固定在浮现点');
  ok(run('flashes[0].trail.length')===0,'不产生拖尾');
  ok(run('flashes[0].opened')===false,'浮现阶段尚未睁开');
  aim('flashes[0].pos');
  run('shoot()');
  ok(run('flashes[0].popped')===false,'没睁开时打不掉');
  step(30);                                    /* 越过 spawn=0.5s */
  ok(run('flashes[0].opened')===true,'0.5s 后睁开');
  ok(run('nearUntil>T'),'睁开后进入近视状态');
  ok(run('nearSrc')===run('flashes[0].id'),'近视来源记录为该眼');
  ok(run('nearAmount()>0'),'nearAmount() 生效');
  ok(run('blindUntil')===0,'不是白屏致盲');
  ok(run('flashes[0].hp')===2,'之眼需要两下才能摧毁');
  const sc0=run('score');
  aim('flashes[0].pos');
  run('shoot()');
  ok(run('flashes[0].popped')===false,'第一下只是打裂，不会摧毁');
  ok(run('flashes[0].hp')===1,'血量从 2 减到 1');
  ok(run('flashes[0].hitAt>0'),'记录受击时间（用于受击闪白与抖动）');
  aim('flashes[0].pos');
  run('shoot()');
  ok(run('flashes[0].popped')===true,'第二下才摧毁');
  ok(run('score')>sc0,'击毁得分');
  ok(run('nearUntil')===0 && run('nearSrc')===0,'击毁后近视立即解除');
  ok(run('nearAmount()')===0,'nearAmount() 归零');

  console.log('[6b] 近视期间靶球看不见也打不到');
  run('flashes=[];spawnFlash("reyna");');
  step(55);                       /* 越过 spawn 0.5s，再等近视淡入完成 */
  ok(run('nearUntil>T'),'进入近视');
  ok(run('fogNear>0.15'),'fogNear 生效（'+run('fogNear').toFixed(2)+'）');
  aim('targets[0]');
  const hb=run('st.hits');
  run('shoot()');
  ok(run('st.hits')===hb,'近视期间打靶不计命中');
  run('flashes=[];nearUntil=0;nearSrc=0;nearStart=0;fogNear=0;relocateTarget();');
  step(2);

  console.log('[7] 紫眼超时自动消散（兜底）');
  run('flashes=[];spawnFlash("reyna");');
  step(30);
  ok(run('nearUntil>T'),'再次进入近视');
  run('cfg.auto=false;');
  step(Math.ceil(run('flashes[0].dieAt-T')*1000/16.7)+12);
  ok(run('roundOver')===false && run('paused')===false,
     '消散等待期间未被结算/暂停打断（否则 updateFlashes 不跑）');
  ok(run('flashes.length')===0,'超时后紫眼消散');
  ok(run('nearUntil')===0,'近视随之解除');

  console.log('[7b] 白屏致盲不会被紫眼击毁误清');
  run('flashes=[];spawnFlash("reyna");');
  step(30);
  run('var f=flashes[0]; blindUntil=T+2.0; blindDur=2.0; blindSrc=f.id+999;');
  aim('flashes[0].pos');
  run('shoot()');
  ok(run('blindUntil>0'),'致盲来自其他闪光时保持白屏');
  run('blindUntil=0;blindDur=0;blindSrc=0;nearUntil=0;nearSrc=0;cfg.auto=true;');

  console.log('[8] 暂停 / 恢复 的时间平移');
  run('flashes=[];spawnFlash("phoenix");');
  step(5);
  const leadBefore=run('flashes[0].popAt-T');
  run('pause()');
  step(60);                       /* 暂停 1 秒，T 继续走 */
  run('resume()');
  const leadAfter=run('flashes[0].popAt-T');
  ok(Math.abs(leadBefore-leadAfter)<0.05,'恢复后剩余飞行时间保持 '+
     leadBefore.toFixed(3)+'s → '+leadAfter.toFixed(3)+'s（不再瞬爆）');
  ok(run('flashes[0].popAt>T'),'闪光不会在恢复瞬间立即引爆');

  console.log('[8b] 暂停期间近视计时同步平移');
  run('flashes=[];spawnFlash("reyna");');
  step(30);
  const nearLeft=run('nearUntil-T');
  run('pause()'); step(60); run('resume()');
  ok(Math.abs(run('nearUntil-T')-nearLeft)<0.05,'恢复后近视剩余时长保持 '+
     nearLeft.toFixed(2)+'s → '+(run('nearUntil-T')).toFixed(2)+'s');
  run('flashes=[];nearUntil=0;nearSrc=0;');

  console.log('[9] 靶点不再有存活时间限制');
  run('cfg.mode=0;cfg.auto=false;flashes=[];relocateTarget();');
  step(10);
  const snap=run('JSON.stringify(targets.map(t=>[t.x,t.y]))');
  step(400);                      /* 跑 6.7 秒，早超过原先 4s 的存活时间 */
  ok(run('JSON.stringify(targets.map(t=>[t.x,t.y]))')===snap,'靶点不会因超时消失或重掷');
  ok(run('targets.length')===run('cfg.targetN'),'数量始终为 '+run('cfg.targetN'));

  console.log('[9b] 单帧转动预算（防止视角瞬移）');
  run('cam.yaw=0;cam.pitch=0;mdx=100000;mdy=0;lastDt=0.0167;applyLook();');
  const y1=run('cam.yaw'), budget1=800*0.0012217*run('cfg.sens');
  ok(Math.abs(y1)<=budget1+1e-6,'60fps 下单帧转动被限制在 '+(budget1*57.3).toFixed(0)+'° 内（实际 '+(y1*57.3).toFixed(1)+'°）');
  run('cam.yaw=0;mdx=100000;mdy=0;lastDt=0.05;applyLook();');
  const y2=run('cam.yaw'), budget2=budget1*3;
  ok(Math.abs(y2)>Math.abs(y1),'低帧率时预算放宽（'+(y2*57.3).toFixed(0)+'°）');
  ok(Math.abs(y2)<=budget2+1e-6,'但仍不超过 3 倍上限');
  run('cam.yaw=0;cam.pitch=0;mdx=0;mdy=0;');

  console.log('[10] 七特工全开 + 9 靶点长跑');
  run('cfg.targetN=9;fillTargets();cfg.agents.kayo=true;cfg.agents.yoru=true;cfg.agents.vyse=true;');
  for(const k of ['phoenix','skye','breach','kayo','yoru','reyna','vyse']) run('spawnFlash("'+k+'")');
  step(400);
  ok(true,'400 帧无异常（含穿墙闪充能、恺滴答、夜露高抛）');
  run('cfg.mode=1'); step(40); run('cfg.mode=2'); step(40); run('cfg.mode=0');
  run('resetStats()'); step(60);
  ok(run('targets.length')===9,'重置统计后靶点恢复 9 个');

  console.log('[11] 单轮计时与结算');
  run('flashes=[];nearUntil=0;nearSrc=0;fogNear=0;blindUntil=0;blindDur=0;cfg.mode=0;cfg.roundIdx=0;');
  run('startRound()');
  ok(run('roundOver')===false,'新一轮开始，未结束');
  const left0=run('roundEndAt-T');
  ok(left0>29 && left0<30.01,'倒计时设为 30s（'+left0.toFixed(2)+'s）');   /* 上限放宽：浮点噪声可到 30.000000000000014 */
  ok(run('score')===0,'开轮清零分数');
  step(60);
  ok(run('roundOver')===false,'中途不会结算');
  ok(run('$("roundTag").textContent')!=='','倒计时 HUD 有值（'+run('$("roundTag").textContent')+'）');
  run('roundEndAt=T+0.05;');           /* 直接把终点挪到眼前，省得跑 1800 帧 */
  step(10);
  ok(run('roundOver')===true,'到点自动结束');
  ok(run('$("result").style.display')==='flex','结算面板弹出');
  ok(String(run('$("resScore").textContent'))===String(run('score')),'结算总分与本局一致');
  ok(String(run('$("resTrials").textContent'))===String(run('st.trials')),'结算回显闪光总数');
  ok(String(run('$("resDodge").textContent'))!=='','背闪率有值：'+run('$("resDodge").textContent')+'');
  ok(run('$("resNote").textContent').length>0,'给出本轮点评');
  const sh=run('st.shots');
  run('shoot()');
  ok(run('st.shots')===sh,'结算面板打开时出手无效');
  run('$("resAgain").onclick({stopPropagation:function(){}})');
  ok(run('roundOver')===false,'「再来一轮」重新开始');
  ok(run('$("result").style.display')==='none','面板关闭');
  ok(run('score')===0,'分数已清零');
  run('roundEndAt=T+0.05;'); step(10);
  ok(run('roundOver')===true,'再次到点');
  run('$("resClose").onclick({stopPropagation:function(){}})');
  ok(run('cfg.roundIdx')===3,'关闭后切到「不限」');
  ok(run('roundOver')===false,'恢复自由练习');
  step(30);
  ok(run('roundOver')===false,'不限时不会重复结算');

  console.log('[12] 计分规则');
  run('resetStats();cfg.mode=0;fillTargets();combo=0;reflickBase=T;');
  step(3);
  aim('targets[0]');
  const before12=run('score');
  run('shoot()');
  const gain=run('score')-before12;
  ok(gain>0,'命中加分');
  ok(gain>=10 && gain<=56,'单球得分落在 10–56（实际 +'+gain+'）');
  ok(run('SCORE.hitBase+SCORE.hitSpeed+SCORE.hitPrec')===35,'完美单球裸分 35');
  run('combo=15;');
  ok(Math.abs(run('comboMult()')-1.6)<1e-9,'连击倍率封顶 1.60×');
  ok(Math.round(35*run('comboMult()'))===56,'理论单球封顶 56 分');
  run('combo=0;');

  console.log('[13] 统一菜单：页签 / 开合 / 常驻统计折叠');
  run('openMenu("solo", false);');
  ok(run('menuIsOpen()')===true,'openMenu 能打开菜单');
  run('selectTab("set")');
  ok(run('$("tab-set").classList.contains("act")')===true,'可切到「设置」页');
  ok(run('$("tab-solo").classList.contains("act")')===false,'切页时其它页隐藏');
  run('selectTab("battle")');
  ok(run('$("tab-battle").classList.contains("act")')===true,'可切到「联机对战」页');
  run('selectTab("solo"); closeMenu();');
  ok(run('menuIsOpen()')===false,'closeMenu 能关闭菜单');
  run('openMenu("set", false);');
  ok(run('menuIsOpen()')===true && run('$("tab-set").classList.contains("act")')===true,
     'openMenu 能打开并定位到指定页');
  closeMenuSafe();
  function closeMenuSafe(){ run('closeMenu();'); }
  /* 常驻精简统计：默认显示，H 折叠 */
  ok(run('$("miniStats").classList.contains("hide")')===false,'默认显示常驻统计');
  run('toggleMini()');
  ok(run('$("miniStats").classList.contains("hide")')===true,'toggleMini 可折叠统计');
  run('toggleMini()');
  ok(run('$("miniStats").classList.contains("hide")')===false,'再按恢复显示');

  console.log('[13b] 设置默认值与音量字段');
  ok(run('cfg.sens')===0.8,'默认灵敏度 0.8');
  ok(/id="rSens"[^>]*value="0.8"/.test(html)&&/<b id="vSens">0.80<\/b>/.test(html),
     '灵敏度滑块/标签初始值也是 0.8');
  ok(typeof run('cfg.gain')==='number'&&run('cfg.gain')>0&&run('cfg.gain')<=1,'有全局音量 cfg.gain');
  ok(typeof run('cfg.flashGain')==='number','有闪光音量 cfg.flashGain');
  ok(/id="rGain"/.test(html)&&/id="rFgain"/.test(html),'设置面板里有全局/闪光两个音量滑杆');
  ok(/saveCfg/.test(code)&&/loadCfg/.test(code)&&/applyCfgToUI/.test(code),'cfg 持久化三件套存在');

  console.log('[14] FOV 与靶点尺寸');
  ok(run('cfg.fov')===103,'默认 103°（瓦罗兰特锁定的水平 FOV）');
  ok(run('cfg.targetR')===0.1,'靶点默认 0.10');
  run('cfg.fov=103;updateF();');
  const vt=run('$("vFov").textContent');
  ok(/垂直/.test(vt),'同时显示垂直换算：'+vt);
  ok(/垂直 7[01]/.test(vt),'16:9 下 103° 水平 ≈ 垂直 70°');

  console.log('[15] 准星');
  ok(run('CROSS_KINDS.length')===5,'提供 5 种样式');
  ok(run('CROSS_COLORS.length')===5,'提供 5 种颜色');
  for(let i=0;i<5;i++){
    run('cfg.crossKind='+i+';drawCrosshair();');
  }
  ok(true,'5 种样式逐一绘制均不报错');
  run('cfg.crossColor=4;cfg.crossLen=22;cfg.crossThick=6;cfg.crossGap=20;cfg.crossDot=false;drawCrosshair();');
  run('cfg.crossColor=0;cfg.crossLen=2;cfg.crossThick=1;cfg.crossGap=0;cfg.crossDot=true;drawCrosshair();');
  ok(true,'极端参数组合不报错');
  /* 默认值直接从源码断言，而不是读 cfg —— 上面的用例已经改过 cfg 了 */
  const dm=code.match(/crossKind:(\d+),\s*crossColor:(\d+),\s*crossLen:(\d+),\s*crossThick:(\d+),\s*crossGap:(\d+),\s*crossDot:(\w+)/);
  ok(!!dm,'找到准星默认值声明');
  if(dm){
    ok(dm[1]==='0'&&dm[3]==='4'&&dm[4]==='2'&&dm[5]==='2'&&dm[6]==='false',
       '默认准星 = 十字 / 长度4 / 粗细2 / 间隙2 / 中心点关闭（实际 '+
       ['十字','长度'+dm[3],'粗细'+dm[4],'间隙'+dm[5],'中心点'+(dm[6]==='true'?'开':'关')].join(' · ')+'）');
  }
  ok(/id="rCLen"[^>]*value="4"/.test(html)&&/id="rCGap"[^>]*value="2"/.test(html),
     '侧栏滑块初始值与 cfg 默认一致');
  ok(/<b id="vCLen">4<\/b>/.test(html)&&/<b id="vCGap">2<\/b>/.test(html),
     '侧栏数值标签与默认一致');
  ok(/id="segCrossDot"/.test(html),'准星区有独立的中心点开关');
  ok(!/data-k="crossDot"/.test(html),'中心点已从「辅助」勾选区迁走，避免两处控制同一项');
  run('cfg.crossKind=0;cfg.crossColor=0;cfg.crossLen=4;cfg.crossThick=2;cfg.crossGap=2;cfg.crossDot=false;');
  run('drawCrosshair();');
  ok(true,'默认参数绘制不报错');

  /* 分段控件的初始高亮依赖 syncSegs 在所有 buildSeg 之后调用 */
  const kids=id=>[...document.getElementById(id).children];
  const dotSeg=kids('segCrossDot');
  ok(dotSeg.length===2,'中心点开关有「关闭 / 开启」两项');
  ok(dotSeg[0].classList.contains('act') && !dotSeg[1].classList.contains('act'),
     '中心点默认高亮在「关闭」');
  ok(kids('segCross')[0].classList.contains('act'),'准星样式初始即高亮「十字」');
  ok(kids('segCrossC')[0].classList.contains('act'),'准星颜色初始即高亮「白」');
  ok(kids('segQual')[1].classList.contains('act'),'渲染画质初始即高亮「标准」');
  ok(kids('segMode')[0].classList.contains('act'),'训练模式初始即高亮「综合」');

  console.log('[16] 卡顿帧不兑现累积位移');
  run('cam.yaw=0;mdx=600;mdy=0;lastDt=0.20;applyLook();');
  ok(run('cam.yaw')===0,'dt=200ms 的卡顿帧丢弃位移，视角纹丝不动');
  run('cam.yaw=0;mdx=600;mdy=0;lastDt=0.0167;applyLook();');
  ok(Math.abs(run('cam.yaw'))>0,'正常帧照常转动');
  run('cam.yaw=0;cam.pitch=0;mdx=0;mdy=0;');

  console.log('[17] 靶球与重新锁定');
  ok(run('BALL_R')>0,'靶球位图半径常量存在');
  run('cfg.mode=0;fillTargets();render();');
  ok(true,'带靶球渲染一帧不报错');
  run('relock()');
  ok(run('mdx')===0 && run('mdy')===0,'relock 清空累积位移');

  /* 以下三组是 2026-09-01 四项改动的回归锁，别删 */
  {   /* 块级作用域：避免与前面用例的 const 变量重名 */
  console.log('[18] 致盲叠加不再续满白屏 / 射击及时恢复');
  run('cfg.auto=false; resetStats(true);');
  run('flashes=[]; spawnFlash("phoenix")');
  for(let i=0;i<300 && run('flashes.length>0 && !flashes[0].popped');i++){ aim('flashes[0].pos'); step(1); }
  ok(run('blindAmount()')>0.9,'正对闪光会被致盲');
  step(8);
  run('flashes=[]; spawnFlash("phoenix")');
  let bAmt=0,aAmt=0,rem=0,saw=false;
  for(let i=0;i<400;i++){
    aim('flashes[0].pos');
    const wasPopped=run('flashes[0].popped');
    const a0=run('blindAmount()'), r0=run('blindUntil-T');
    step(1);
    if(!wasPopped && run('flashes[0].popped')){ bAmt=a0; aAmt=run('blindAmount()'); rem=r0; saw=true; break; }
  }
  ok(saw && rem>0.05,'第二发在第一发致盲结束前引爆（剩余 '+rem.toFixed(2)+'s）');
  ok(aAmt<0.95,'叠加不再把白屏拉回满值：'+bAmt.toFixed(3)+' -> '+aAmt.toFixed(3)+'（旧实现必然 1.000）');
  let prev=aAmt, mono=true;
  for(let i=0;i<600 && run('blindAmount()')>0;i++){
    step(1); const a=run('blindAmount()'); if(a>prev+1e-6) mono=false; prev=a;
  }
  ok(mono,'叠加后强度单调衰减，不会反复续满');
  ok(run('blindAmount()')===0,'致盲最终结束');
  aim('targets[0]');
  const hb=run('st.hits'); run('shoot()');
  ok(run('st.hits')===hb+1,'致盲结束后左键立即恢复命中');
  run('blindStart=T; blindUntil=T+2; blindDur=2;');
  const hs=run('st.shots'), hh=run('st.hits');
  aim('targets[0]');
  run('shoot()');
  ok(run('st.shots')===hs+1 && run('st.hits')===hh,'满强度致盲期间出手记为 MISS（不白送分）');
  /* 淡出尾声（amount 约 0.3）必须已经允许命中，否则就是「看着能打其实点不动」 */
  run('blindStart=T-1.4; blindUntil=T+0.6; blindDur=2.0;');
  const amtTail=run('blindAmount()');
  aim('targets[0]');
  const hb2=run('st.hits'), hs2=run('st.shots');
  run('shoot()');
  ok(amtTail<0.35 && run('st.hits')===hb2+1 && run('st.shots')===hs2+1,
     '淡出尾声 amount='+amtTail.toFixed(2)+' 已放开命中（旧阈值 0.12 会一直卡到 88% 时长）');
  run('resetStats(true);');

  console.log('[19] 闪光落点铺满整个拱门区域');
  const ys=[];
  for(let i=0;i<3000;i++){
    run('flashes=[]; spawnFlash("phoenix")');
    ys.push(run('flashes[0].home.y'));      /* 用 home 而不是 pts[i]：曲球的控制点数量不同 */
  }
  const yLo=Math.min.apply(null,ys), yHi=Math.max.apply(null,ys);
  const below=(v)=>ys.filter(y=>y<v).length/ys.length*100;
  ok(yLo<-0.7,'会出现低处落点 y>='+yLo.toFixed(2)+'（左下/右下）');
  ok(yHi>1.9,'会出现高处落点 y<='+yHi.toFixed(2)+'（左上/右上）');
  ok(below(0.5)>25,'拱门下半区覆盖率 '+below(0.5).toFixed(1)+'%（旧实现恒为 0）');
  run('cam.yaw=0;cam.pitch=0;computeArchScreen();');
  let v=0;
  for(let i=0;i<600;i++){
    run('flashes=[]; spawnFlash("phoenix")');
    if(run('flashVisible(flashes[0].home)')) v++;
  }
  ok(v/600>0.5,'低落点仍在拱门洞内可见 '+Math.round(v/600*100)+'%');

  console.log('[20] 夜露提速改深蓝 / 斯凯降速');
  ok(run('AGENTS.yoru.travel')<1.10,'夜露 travel 1.50 -> '+run('AGENTS.yoru.travel'));
  ok(run('AGENTS.yoru.popFrac')<0.80,'夜露 popFrac 0.86 -> '+run('AGENTS.yoru.popFrac'));
  ok(run('AGENTS.yoru.color')==='#2f6fe4','夜露颜色 -> 深蓝 #2f6fe4');
  ok(run('AGENTS.yoru.rgb')==='47,111,228','夜露光晕 rgb 同步深蓝');
  ok(run('AGENTS.skye.travel')>1.00,'斯凯 travel 0.88 -> '+run('AGENTS.skye.travel'));
  const yPop=run('AGENTS.yoru.travel*DIFF[0].speed*AGENTS.yoru.popFrac');
  const sPop=run('AGENTS.skye.travel*DIFF[0].speed*AGENTS.skye.popFrac');
  const pPop=run('AGENTS.phoenix.travel*DIFF[0].speed*AGENTS.phoenix.popFrac');
  ok(yPop<pPop,'夜露引爆早于菲尼克斯（'+yPop.toFixed(2)+'s < '+pPop.toFixed(2)+'s）');
  ok(sPop<pPop,'斯凯引爆仍早于菲尼克斯（'+sPop.toFixed(2)+'s < '+pPop.toFixed(2)+'s）');
  run('cfg.auto=true; resetStats(true);');
  }

  /* 曲球光束：既要沿真实轨迹画出来（不能是直线），又要卡在墙面切开（不能穿模） */
  console.log('[21] 曲球光束：轨迹折线 + 墙面切开');
  run('flashes=[];cfg.agents.phoenix=true;cfg.mode=0;spawnFlash("phoenix");');
  ok(run('flashes[0].a.shape')==='curve','菲尼克斯走曲球形态');
  ok(run('!!flashes[0].a.hook')===true,'曲球带回头弧控制点');
  step(40);
  const beamInfo=()=>JSON.parse(run(
    '(function(){var f=flashes[0];var b=buildBeam(f);return JSON.stringify({'
    +'n:f.trail.length, fp:b&&b.front?b.front.length:0, bp:b&&b.back?b.back.length:0,'
    +'same:(b&&b.front&&b.front.length&&b.back&&b.back.length)?(b.front[b.front.length-1].x===b.back[0].x'
    +'&&b.front[b.front.length-1].y===b.back[0].y):null});})()'));
  const bm=beamInfo();
  ok(bm.n>3,'轨迹有足够采样点（'+bm.n+' 个）');
  /* 球在墙后时 front 只有一个墙面交点是正确行为（整条光束靠 back 裁剪） */
  ok(bm.fp>=2 || bm.bp>=2,'光束是多点折线而非两端点直线（front '+bm.fp+' / back '+bm.bp+' 点）');
  if(bm.fp===1 && bm.bp>0) ok(run('flashes[0].pos.z>ROOM.zW'),'front 仅有交点时球应在墙后');
  if(bm.bp>0 && bm.fp>=2) ok(bm.same===true,'两段共用墙面交点：back 从墙面画起，不会从球心穿墙');
  else ok(true,'本帧无需跨墙切分（front '+bm.fp+' 点：球在墙后整条光束靠裁剪，或全在墙前）');

  /* 光束折线不得出现 V 形钩：采样越过拐点时方向翻转接近 180°，
     参考图里光束是「从拐角平滑拉到球」的一条弧（尾巴钉在拐角） */
  run('flashes=[];spawnFlash("phoenix");');
  let hooks=0, checked=0;
  for(let i=0;i<260 && run('flashes.length && flashes[0].popped===false');i++){
    step(1);
    const segs=JSON.parse(run(
      '(function(){var f=flashes[0];if(!f||f.popped)return "null";var b=buildBeam(f);'
      +'if(!b)return "null";return JSON.stringify([b.front||[],b.back||[]]);})()'));
    if(!segs) continue;
    for(const seg of segs){
      const L=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y);
      for(let k=1;k<seg.length-1;k++){
        if(L(seg[k-1],seg[k])<3 || L(seg[k],seg[k+1])<3) continue;   /* 过短段方向无意义 */
        const a1=Math.atan2(seg[k].y-seg[k-1].y,seg[k].x-seg[k-1].x);
        const a2=Math.atan2(seg[k+1].y-seg[k].y,seg[k+1].x-seg[k].x);
        let d=Math.abs(a2-a1); if(d>Math.PI) d=2*Math.PI-d;
        if(d>2.27) hooks++;               /* >130° 视为钩 */
        checked++;
      }
    }
  }
  ok(checked>50,'光束逐帧检查了 '+checked+' 个转角');
  ok(hooks===0,'光束上没有方向翻转的 V 形钩（发现 '+hooks+' 个）');

  /* 过墙面那一刻 |x| 必须落在拱门半宽内，否则球会从实体墙里冒出来 */
  const wallX=run('(function(){var f=flashes[0];var best=null,bd=1e9;'
    +'for(var i=0;i<=400;i++){var p=pathAt(f,i/400);var d=Math.abs(p.z-ROOM.zW);'
    +'if(d<bd){bd=d;best=p;}}return Math.abs(best.x);})()');
  ok(wallX<run('ARCH.r'),'过墙面时 |x|='+wallX.toFixed(2)+' 在拱门半宽内（'+run('ARCH.r')+'）');

  /* 球飞进房间后最容易穿模：光束尾部伸到墙后，切分必须生效 */
  let gd=0;
  while(run('flashes.length && flashes[0].pos.z>6.2 && flashes[0].popped===false') && gd++<300) step(1);
  if(run('flashes.length && flashes[0].popped===false')){
    const b2=beamInfo();
    ok(b2.fp>=2,'球进房间后墙前段仍在（'+b2.fp+' 点）');
    if(b2.bp>0) ok(b2.same===true,'球在房间内时越墙那段仍从墙面起画，不从球心穿墙');
    else ok(true,'球在房间内时整条光束都在墙前');
  }
  run('flashes=[];');

  /* 联机对战：房码编解码 + 同种子确定性（这是「两人打同一局」能否成立的根） */
  console.log('[22] 联机对战：房码编解码 + 同种子确定性');
  let codecOK=true, samples=0;
  for(let r=0;r<4;r++){ for(let k=0;k<9;k++){
    const seed=(k*1000+r*7+1)&0xFFFFF;
    const code=run('encodeRoom('+r+','+seed+')');
    const dec=JSON.parse(run('JSON.stringify(decodeRoom("'+code+'"))'));
    samples++;
    if(!dec||dec.roundIdx!==r||dec.seed20!==seed) codecOK=false;
  }}
  ok(codecOK,'房码 encode/decode 往返一致（时长位+种子位，'+samples+' 组）');
  ok(run('newRoomCode().length')===6,'生成的房码是 6 位');
  ok(run('ROOM_RE.test(newRoomCode())')===true,'房码只用去混淆的 Crockford 字母表');

  run('match.active=true; playing=true; paused=false; roundOver=false; cfg.auto=false;');
  run('for(const k in cfg.agents) cfg.agents[k]=true; buildAgents();');
  const seqScript=s=>'(function(){var a=[];match.seed='+s+';contentRnd=mulberry32(match.seed);flashes=[];flashSeq=0;'
    +'for(var i=0;i<24;i++){var f=spawnFlash();a.push([f.key,f.side,+f.popFrac.toFixed(6),f.pts.length,'
    +'+f.home.x.toFixed(3),+f.home.y.toFixed(3),+(f.turnAt||0).toFixed(4)]);}return JSON.stringify(a);})()';
  const listA=JSON.parse(run(seqScript('424242')));
  const listA2=JSON.parse(run(seqScript('424242')));
  const listB=JSON.parse(run(seqScript('98765')));
  ok(listA.length===24,'同一 seed 采样到 24 发闪光');
  ok(JSON.stringify(listA)===JSON.stringify(listA2),'同一 seed → 两次逐字段完全一致（特工/左右/引爆时机/轨迹/落点）');
  ok(JSON.stringify(listA)!==JSON.stringify(listB),'不同 seed → 序列不同（seed 确实生效）');
  ok(run('(function(){match.seed=424242;var a=0,b=0;for(var i=0;i<8;i++)a+=gapFor(i);match.seed=424242;for(var i=0;i<8;i++)b+=gapFor(i);return a===b;})()')===true,'出闪光节奏 gapFor 是次数的纯函数，两人算出同一节奏');
  const nAfterManual=run('(function(){flashes=[];manualFlash();return flashes.length;})()');
  ok(nAfterManual===0,'对战中手动丢闪被禁用（否则一发就把两人序列错位）');

  // 离线进房 → 结算对比渲染 → 退出复位（fetch 桩会 reject，走的正是降级分支）
  run('match.active=false;');
  const enterOK=run('(function(){try{var c=newRoomCode();var r=enterMatch(c);return (r&&match.active&&match.code===c&&ROOM_RE.test(c))?1:0;}catch(e){return -1;}})()');
  ok(enterOK===1,'enterMatch 离线进房正常激活（房码合法、不抛异常）');
  ok(run('$("bFlash").style.display')==='none','对战中隐藏手动闪光按钮（防破坏同步）');
  const cmpOK=run('(function(){match.cloud=false;match.you="我";score=1234;st.trials=5;st.dodges=4;st.hits=3;st.shots=4;st.best=2;st.blinds=1;endRound();return (/1234/.test($("mCmp").innerHTML)&&$("mCmp").style.display!=="none")?1:0;})()');
  ok(cmpOK===1,'离线结算：本局分数渲染进对战对比块（口头核对模式）');
  const leaveOK=run('(function(){leaveMatch();return (!match.active&&contentRnd===Math.random&&$("bFlash").style.display==="")?1:0;})()');
  ok(leaveOK===1,'退出对战：状态复位、内容流退回真随机、按钮恢复');

  /* 大厅 / 准备 / 倒计时 / 每轮换种子 —— 对应实测「朋友进来了但房主一直等待」那次修复 */
  console.log('[23] 对战大厅：准备流程 + 倒计时 + 每轮换种子');
  run('(function(){var c=newRoomCode();enterMatch(c);match.you="房主";match.cloud=true;'
     +'match.players=[{name:"房主",ready:false,score:null},{name:"朋友",ready:false,score:null}];'
     +'lobbyOpen();})()');
  ok(run('$("lobby").style.display')==='flex','大厅弹窗打开');
  ok(/朋友/.test(run('$("lbList").innerHTML')),'玩家列表里能看到对手（v1 的 bug：房主永远看不到）');
  ok(/房码/.test(run('$("lbCodeK").textContent'))||run('$("lbCode").textContent').length===6,'大厅展示 6 位房码');

  /* 服务端下发 startAt/now → 本地按「差值」倒计时，不依赖两台机器时钟一致 */
  const cdStarted=run('(function(){var now=1000000;applyState({players:['
    +'{name:"房主",ready:true,score:null},{name:"朋友",ready:true,score:null}],'
    +'startAt:now+3000,now:now,round:1});return match.phase==="countdown"?1:0;})()');
  ok(cdStarted===1,'双方都 ready + 服务端给了 startAt → 进入倒计时阶段');
  ok(run('$("lbCount").style.display')!=='none','倒计时数字可见');

  /* 每轮换种子：同房码第 2 轮不再是同一串闪光，但两人仍然一致 */
  const seedRound=run('(function(){match.round=1;var a=matchSeed();match.round=2;var b=matchSeed();'
    +'match.round=2;var c=matchSeed();return (a!==b&&b===c)?1:0;})()');
  ok(seedRound===1,'matchSeed 随 round 变化但对同一 round 稳定（重赛换新局、两人仍同步）');
  const gapRound=run('(function(){match.round=1;var a=gapFor(3);match.round=2;var b=gapFor(3);return a!==b?1:0;})()');
  ok(gapRound===1,'出闪光节奏也随 round 变（否则重赛节奏一模一样）');

  /* 对战中不轮询、大厅才轮询：这是 KV 免费额度的关键闸门 */
  run('roundOver=false; match.phase="playing";');
  ok(run('pollDelay()')===0,'对战进行中不轮询云端（省 KV 读额度）');
  run('match.phase="lobby";');
  ok(run('pollDelay()')>0,'大厅阶段才轮询');
  run('roundOver=true; match.phase="result";');
  ok(run('pollDelay()')>0,'等对手交卷时轮询');
  run('roundOver=false;');

  /* 429 / 额度耗尽：必须立刻停手转离线，不能继续打接口 */
  const gaveUp=run('(function(){match.cloud=true;startPoll();cloudGaveUp("测试 429");'
    +'return (match.cloud===false&&pollTimer===0)?1:0;})()');
  ok(gaveUp===1,'429 时立即停轮询并转离线（不再消耗额度）');
  /* 长时间无变化自动歇手 */
  const quietStop=run('(function(){match.cloud=true;match.quiet=999;match.phase="lobby";'
    +'startPoll();var had=pollTimer!==0;return had?1:0;})()');
  ok(quietStop===1,'轮询以 setTimeout 单链驱动（可被 quiet 上限掐断，不会常驻 setInterval）');
  run('leaveMatch(true); match.cloud=false; roundOver=false;');

  /* ↓ 这一组是花了 939 次 KV 写（免费额度 1000/天）换来的回归，别删 ↓
     旧 updateRound 的闸门是 if(roundOver && roundEndAt) return —— roundEndAt 为 0 时失效，
     left 恒为 0，于是每帧 endRound() -> 每帧 submitMyResult() -> 每帧一次 KV 写。
     触发路径：刚开页面还没点开始（roundEndAt=0）+ 进房把时长设成 60s。 */
  console.log('[24] 每帧重复结算 / 重复上报的防线（KV 额度事故回归）');
  run('playing=false; paused=false; roundOver=false; roundEndAt=0; cfg.roundIdx=1;');
  ok(run('roundSec()')>0,'前提：当前模式有时长（roundSec>0）');
  const noEnd=run('(function(){var n=0;var real=endRound;endRound=function(){n++;};'
    +'for(var i=0;i<40;i++) updateRound();endRound=real;return n;})()');
  ok(noEnd===0,'未开局(playing=false, roundEndAt=0)时 updateRound 不会结算（旧代码此处每帧一次）');

  run('playing=true; roundOver=false; roundEndAt=0;');
  const noEnd2=run('(function(){var n=0;var real=endRound;endRound=function(){n++;};'
    +'for(var i=0;i<40;i++) updateRound();endRound=real;return n;})()');
  ok(noEnd2===0,'roundEndAt=0（这一轮没真开过）时也不结算');

  /* endRound 幂等 + 每轮只上报一次 */
  run('playing=true; startRound();');
  const posts=run('(function(){var n=0;match.active=true;match.cloud=true;match.you="我";'
    +'var realPost=cloudPost;cloudPost=function(){n++;return Promise.resolve(null);};'
    +'for(var i=0;i<30;i++) endRound();'
    +'cloudPost=realPost;return n;})()');
  ok(posts===1,'连调 30 次 endRound 只上报 1 次比分（幂等 + match.sent 闸门），实测得到 '+posts);
  run('startRound();');
  const posts2=run('(function(){var n=0;var realPost=cloudPost;'
    +'cloudPost=function(){n++;return Promise.resolve(null);};'
    +'endRound();cloudPost=realPost;return n;})()');
  ok(posts2===1,'新一轮开始后允许再上报一次（match.sent 已复位）');

  /* 兜底：客户端写预算 —— 任何同类 bug 都不该再烧穿额度 */
  const budget=run('(function(){postLog=[];var okN=0;'
    +'for(var i=0;i<40;i++){ if(postBudgetOK()) okN++; }return okN;})()');
  ok(budget<=12,'写预算闸门把 20s 内的写请求压在 '+budget+' 次（上限 12）');
  const degrade=run('(function(){postLog=[];match.active=true;match.cloud=true;'
    +'for(var i=0;i<20;i++) postBudgetOK();'
    +'var realGave=cloudGaveUp,hit=0;cloudGaveUp=function(){hit++;match.cloud=false;};'
    +'cloudPost({code:"AAAAAA",who:"score",name:"x"});cloudGaveUp=realGave;return hit;})()');
  ok(degrade===1,'预算超限时触发降级（cloudGaveUp），不再打接口');
  run('postLog=[]; playing=false; roundOver=false; roundEndAt=0;');

  run('match.active=false; contentRnd=Math.random; flashes=[];');

  /* 出手音效时机：游戏时钟判定（updateFlashes 里 T-t0>=audOff 播一次），
     audOff = 球可见时刻 - cfg.audioLead。这样声音可比画面「提前」固定秒数，
     且与渲染同一套时钟 —— 掉帧时一起慢，不会像 setTimeout 那样漂移。 */
  console.log('[25] 出手音效时机：游戏时钟 + 可配置提前量');
  run('flashes=[];cfg.vis=0;cfg.diff=0;contentRnd=mulberry32(7);');

  /* 1) spawnFlash 只算 audOff，不立刻出声 */
  const reg=run('(function(){var realThrow=sfx.throw;var n=0;'
    +'sfx.throw=function(){n++;};'
    +'cfg.audioLead=0.35;flashes=[];flashSeq=0;var f=spawnFlash("phoenix");'
    +'sfx.throw=realThrow;return (n===0&&typeof f.audOff==="number"&&f.audioPlayed===false)?1:0;})()');
  ok(reg===1,'spawnFlash 不立刻播，只登记 audOff/audioPlayed=false');

  /* 2) audOff = 可见时刻 - 提前量；提前量越大 audOff 越小（每次 spawn 前重播种，
        否则两次闪光的 travel/popFrac 随机不同，gap 就不是精确的提前量） */
  const offPair=JSON.parse(run('(function(){var realThrow=sfx.throw;sfx.throw=function(){};'
    +'flashes=[];flashSeq=0;contentRnd=mulberry32(7);cfg.audioLead=0;var a=spawnFlash("phoenix").audOff;'
    +'flashes=[];flashSeq=0;contentRnd=mulberry32(7);cfg.audioLead=0.35;var b=spawnFlash("phoenix").audOff;'
    +'sfx.throw=realThrow;return JSON.stringify([a,b,a-b]);})()'));
  const [lead0,lead35,gap]=offPair;
  ok(lead35<lead0,'提前量 0.35s 让 audOff 变小（声音更早）：'+lead0.toFixed(2)+'→'+lead35.toFixed(2));
  ok(Math.abs(gap-0.35)<0.02,'audOff 差正好等于提前量 0.35s（实测 '+gap.toFixed(3)+'）');

  /* 3) updateFlashes 在 T-t0>=audOff 时恰好播一次，不重复 */
  const fireOnce=run('(function(){var realThrow=sfx.throw;var n=0;sfx.throw=function(){n++;};'
    +'cfg.audioLead=0;flashes=[];flashSeq=0;var f=spawnFlash("phoenix");'
    +'T=f.t0+f.audOff+0.01;updateFlashes();var first=n;'    /* 到点 */
    +'updateFlashes();updateFlashes();'                    /* 后续帧 */
    +'sfx.throw=realThrow;return (first===1&&n===1)?1:0;})()');
  ok(fireOnce===1,'到点播一次，后续帧不重复（audioPlayed 闸门）');

  /* 4) 球还在墙后（T-t0 < audOff）→ 不播 */
  const notYet=run('(function(){var realThrow=sfx.throw;var n=0;sfx.throw=function(){n++;};'
    +'cfg.audioLead=0;flashes=[];flashSeq=0;var f=spawnFlash("kayo");'
    +'T=f.t0+f.audOff*0.5;updateFlashes();'   /* 到一半，还不可见 */
    +'sfx.throw=realThrow;return n;})()');
  ok(notYet===0,'球尚不可见的帧不播（T-t0 未到 audOff）');

  /* 5) 提前量过大时钳到 0（投掷瞬间出声），绝不早于 t0；且仍早于可见时刻 */
  const leadClamp=JSON.parse(run('(function(){var realThrow=sfx.throw;sfx.throw=function(){};'
    +'cfg.audioLead=0.5;flashes=[];flashSeq=0;contentRnd=mulberry32(11);var f=spawnFlash("yoru");'
    +'var visTime=f.travel*(f.popFrac-(f.a.vf||0.25)*1.45);'
    +'sfx.throw=realThrow;return JSON.stringify([f.audOff,visTime]);})()'));
  ok(leadClamp[0]>=0 && leadClamp[0]<leadClamp[1]-0.05,
     'yoru 可见窗口('+leadClamp[1].toFixed(2)+'s)比提前量 0.5s 短 → audOff 钳到 '+leadClamp[0].toFixed(2)+'s，'
     +'仍不晚于可见，且不会早于投掷瞬间');
  const leadPlay=run('(function(){var realThrow=sfx.throw;var n=0;sfx.throw=function(){n++;};'
    +'cfg.audioLead=0.5;flashes=[];flashSeq=0;contentRnd=mulberry32(11);var f=spawnFlash("yoru");'
    +'T=f.t0+f.audOff+0.005;updateFlashes();'
    +'sfx.throw=realThrow;return n;})()');
  ok(leadPlay===1,'钳后的 audOff 到点照样准时播一次');
  run('cfg.audioLead=0.35;flashes=[];');

  /* 回靶计时起点修正：白屏没散尽就躲开下一发，不该把「还打不了」的时间算进回靶 */
  console.log('[26] 回靶计时起点 = 最早能出手的时刻（不是完全散尽/引爆瞬间）');
  // 场景：正在被闪（blindDur=2.0, blindUntil=T+2.0），此刻躲开下一发
  run('flashes=[];playing=true;paused=false;roundOver=false;cfg.auto=false;');
  const dodgeDuringBlind=run('(function(){'
    +'blindStart=T; blindDur=2.0; blindUntil=T+2.0;'
    +'var f={id:999,a:{zh:"测",key:"phoenix",coneHalf:60,dur:[0.35,2.05]},pos:P(9,0,9),'
    +'popPos:P(9,0,9),popped:false,dead:false,deadAt:0,t0:T,trail:[],dodgeAt:T,visAt:T,lookedAtVis:true,'
    +'home:P(9,0,9)};'
    +'st.dodges=0;st.rfSum=0;st.rfN=0;combo=0;'
    +'popFlash(f);'
    +'return Math.round((reflickBase-T)*1000);'
    +'})()');
  ok(dodgeDuringBlind>500&&dodgeDuringBlind<1400,
     '残余白屏中躲开 → 回靶基线推到有 35% 白屏能出手时（+'+dodgeDuringBlind+'ms，非 0 非满 2000）');
  // 反证：完全没被闪时躲开，基线就在当下
  const dodgeClean=run('(function(){'
    +'blindUntil=0;blindDur=0;flashes=[];'
    +'var f={id:998,a:{zh:"测",key:"phoenix",coneHalf:60,dur:[0.35,2.05]},pos:P(9,0,9),'
    +'popPos:P(9,0,9),popped:false,dead:false,deadAt:0,t0:T,trail:[],dodgeAt:T,visAt:T,lookedAtVis:true,'
    +'home:P(9,0,9)};'
    +'combo=0;popFlash(f);return Math.round((reflickBase-T)*1000);})()');
  ok(dodgeClean>=-1&&dodgeClean<=1,'无白屏时躲开 → 基线就在当下（回靶从这一刻算）');
  run('blindUntil=0;blindDur=0;blindStart=0;playing=false;');

  /* 背闪角度 → 白屏程度分档（新逻辑）：
     完全背过去 = 不白（判躲开）；擦闪 = 白一下但不断连击；擦边 = 轻白；正脸 = 全白。
     强度=blindPeak×剩余占比，peak=0.5+0.5×cover，cover=(1-ang/cone)^0.7 */
  console.log('[27] 致盲强度按背闪角度分档');
  run('flashes=[];playing=true;paused=false;roundOver=false;cfg.auto=false;');
  // 造一个引爆在正前方 0° 的闪光 → peak 应≈1.0
  const faceWhite=run('(function(){'
    +'blindUntil=0;blindDur=0;blindStart=0;blindPeak=1;'
    +'var f={id:1,a:{zh:"测",key:"phoenix",coneHalf:60,dur:[0.35,2.05]},'
    +'pos:P(0,0,5),popPos:P(0,0,5),popped:false,dead:false,deadAt:0,t0:T,trail:[],'
    +'dodgeAt:0,visAt:0,lookedAtVis:false,home:P(0,0,5)};'
    +'cam.yaw=0;cam.pitch=0;combo=0;st.blinds=0;st.dodges=0;'
    +'popFlash(f);'   /* 正脸：引爆点在正前方 */
    +'return +blindPeak.toFixed(2);})()');
  ok(faceWhite>0.9,'正对引爆 → 起跳近全白（peak='+faceWhite+'）');
  // 造一个引爆在锥角边缘（约 55°）的闪光 → peak 应明显低于全白
  const edgeWhite=run('(function(){'
    +'blindUntil=0;blindDur=0;blindStart=0;blindPeak=1;'
    +'var ang=55*RAD;'   /* 菲尼克斯锥角60°，55°=擦边但仍会被闪 */
    +'var f={id:1,a:{zh:"测",key:"phoenix",coneHalf:60,dur:[0.35,2.05]},'
    +'pos:P(Math.sin(ang)*5,0,Math.cos(ang)*5),popPos:P(Math.sin(ang)*5,0,Math.cos(ang)*5),'
    +'popped:false,dead:false,deadAt:0,t0:T,trail:[],'
    +'dodgeAt:0,visAt:0,lookedAtVis:false,home:P(0,0,5)};'
    +'cam.yaw=0;cam.pitch=0;combo=0;st.blinds=0;st.dodges=0;'
    +'popFlash(f);'
    +'return +blindPeak.toFixed(2);})()');
  ok(edgeWhite>0.5&&edgeWhite<0.75,'擦边引爆(55°) → 半白起跳（peak='+edgeWhite+'，非满白）');
  // 完全背过去（>锥角）：不致盲，判躲开
  const backAway=run('(function(){'
    +'blindUntil=0;blindDur=0;blindStart=0;'
    +'var ang=100*RAD;'   /* 远超 60° 锥角 = 正背着 */
    +'var f={id:1,a:{zh:"测",key:"phoenix",coneHalf:60,dur:[0.35,2.05]},'
    +'pos:P(Math.sin(ang)*5,0,Math.cos(ang)*5),popPos:P(Math.sin(ang)*5,0,Math.cos(ang)*5),'
    +'popped:false,dead:false,deadAt:0,t0:T,trail:[],'
    +'dodgeAt:0,visAt:0,lookedAtVis:false,home:P(0,0,5)};'
    +'cam.yaw=0;cam.pitch=0;var b0=st.blinds,d0=st.dodges;combo=0;'
    +'popFlash(f);'
    +'return (blindUntil<=T+0.001 && st.dodges===d0+1 && st.blinds===b0)?1:0;})()');
  ok(backAway===1,'完全背过去(100°) → 不致盲，判为躲开+分');

  /* 擦闪档（cover ≤ GRAZE_COVER=0.20）：白照旧来一下，但算背闪成功 —— 不断连击、计躲开。
     实测来由：布雷奇锥角 70° > 屏幕半 FOV(103°/2=51.5°)，光点在屏幕外也被判「被闪」，
     白零点几秒还断连击。这里用两个特工各取档内/档外一点钉死边界。 */
  const grazeProbe=run('(function(){'
    +'function mk(a,angDeg){var ang=angDeg*RAD;return {id:1,a:a,'
    +'pos:P(Math.sin(ang)*5,0,Math.cos(ang)*5),popPos:P(Math.sin(ang)*5,0,Math.cos(ang)*5),'
    +'popped:false,dead:false,deadAt:0,t0:T,trail:[],dodgeAt:0,visAt:0,lookedAtVis:false,'
    +'home:P(0,0,5)};}'
    +'function trial(f){blindUntil=0;blindDur=0;blindStart=0;blindPeak=1;'
    +'st.blinds=0;st.dodges=0;st.graze=0;combo=7;cam.yaw=0;cam.pitch=0;'
    +'popFlash(f);'
    +'return {bl:st.blinds,dg:st.dodges,gz:st.graze,cb:combo,'
    +'white:+(blindUntil-T).toFixed(2),peak:+blindPeak.toFixed(2)};}'
    +'var PH={zh:"菲尼克斯",key:"phoenix",coneHalf:60,dur:[0.35,2.05]};'
    +'var BR={zh:"布雷奇",key:"breach",coneHalf:70,dur:[0.40,2.20],throughWall:true};'
    +'return JSON.stringify({ph55:trial(mk(PH,55)),ph45:trial(mk(PH,45)),'
    +'br65:trial(mk(BR,65)),br55:trial(mk(BR,55))});})()');
  const gz=JSON.parse(grazeProbe);
  ok(gz.ph55.gz===1&&gz.ph55.bl===0&&gz.ph55.dg===1&&gz.ph55.cb===8,
     '菲尼克斯 55°(cover≈0.18) → 判擦闪：连击 7→8 不断、计躲开、不计被闪');
  ok(gz.ph55.white>0.3&&gz.ph55.white<0.8&&gz.ph55.peak<0.7,
     '擦闪也照白一下（'+gz.ph55.white+'s / peak='+gz.ph55.peak+'）—— 宽容但不骗人');
  ok(gz.ph45.bl===1&&gz.ph45.cb===0&&gz.ph45.gz===0,
     '菲尼克斯 45°(cover≈0.38，档外) → 仍算被闪，连击清零');
  ok(gz.br65.gz===1&&gz.br65.bl===0&&gz.br65.cb===8,
     '布雷奇 65°(cover≈0.16，屏幕外) → 擦闪不断连击（实测问题的正主）');
  ok(gz.br55.bl===1&&gz.br55.cb===0,
     '布雷奇 55°(cover≈0.34，档外) → 仍算被闪，没把宽容档放宽到这一圈');
  run('blindUntil=0;blindDur=0;blindStart=0;blindPeak=1;st.graze=0;playing=false;');

  /* 个人训练记录：只有「计时回合自然打完」才入库 */
  console.log('[28] 个人记录：计时回合才记 + 分组最佳 + PB 标记');
  run('localStorage.removeItem("aft_records");');
  /* 「不限」打完不记 */
  run('playing=true;roundOver=false;cfg.roundIdx=3;roundEndAt=0;score=999;st.trials=5;st.shots=3;');
  run('endRound();');
  ok(JSON.parse(run('JSON.stringify(loadRecords().log)')).length===0,
     '「不限」回合结束不产生记录');
  /* 计时回合但整轮没动过（st.trials=0 且 st.shots=0）不记 */
  run('cfg.roundIdx=0; startRound(); score=0; st.trials=0; st.shots=0; endRound();');
  ok(JSON.parse(run('JSON.stringify(loadRecords().log)')).length===0,
     '整轮没出手没闪光 → 不记（防挂机/防误触空局占榜）');
  /* 正经打完 30s 普通：入库 + 成为该组最佳 + pb=true */
  run('cfg.roundIdx=0; startRound(); score=1234; combo=7; st.best=7; st.trials=6; st.dodges=5; st.hits=9; st.shots=10; st.blinds=1; cfg.diff=0;');
  run('endRound();');
  let R1=JSON.parse(run('JSON.stringify(loadRecords())'));
  ok(R1.log.length===1 && R1.log[0].score===1234,'打完计时回合 → 入库一条 1234');
  ok(R1.best['0_0'] && R1.best['0_0'].score===1234,'30s×普通 组最佳已建立');
  ok(R1.log[0].pb===true,'首局自动是新纪录（pb=true）');
  /* 更低分不刷新最佳，但进流水、pb=false */
  run('cfg.roundIdx=0; startRound(); score=500; st.trials=6; st.dodges=4; st.hits=8; st.shots=10; endRound();');
  let R2=JSON.parse(run('JSON.stringify(loadRecords())'));
  ok(R2.best['0_0'].score===1234,'更低分不覆盖组最佳');
  ok(R2.log[0].pb===false && R2.log.length===2,'流水仍有第二条且 pb=false');
  /* 不同组（60s×困难）互不干扰 */
  run('cfg.roundIdx=1; cfg.diff=1; startRound(); score=3000; st.trials=10; st.dodges=9; st.hits=15; st.shots=17; endRound();');
  let R3=JSON.parse(run('JSON.stringify(loadRecords())'));
  ok(R3.best['1_1'] && R3.best['1_1'].score===3000,'60s×困难 是另一张榜（组间互不占用）');
  /* 流水上限 100 条 */
  run('(function(){var r={best:{},log:[]};for(var i=0;i<150;i++)r.log.push({t:i,ri:0,diff:0,mode:0,score:i,cb:0,bl:0,ag:"",dg:1,tr:1,hs:1,ss:1,pb:false});'
    +'localStorage.setItem("aft_records",JSON.stringify(r));})();');
  run('cfg.roundIdx=0; cfg.diff=0; startRound(); score=1; st.trials=2; st.shots=1; endRound();');
  ok(JSON.parse(run('JSON.stringify(loadRecords().log)')).length===100,'流水封顶 100 条');
  run('localStorage.removeItem("aft_records"); playing=false; roundOver=false;');

  /* 结算面板内嵌记录 + 走势多维度（分数/背闪率/准度） */
  run('cfg.roundIdx=0;cfg.diff=0;startRound();score=800;st.trials=10;st.dodges=8;st.hits=9;st.shots=10;endRound();');
  run('startRound();score=1200;st.trials=10;st.dodges=5;st.hits=10;st.shots=10;endRound();');
  const resRecHtml=run('$("resRecList").innerHTML');
  ok(/800/.test(resRecHtml)&&/1200/.test(resRecHtml),'结算面板内嵌列表含最近两局分数');
  ok(/闪10/.test(resRecHtml),'列表行带绝对量指标（闪N）');
  const mVals=JSON.parse(run('(function(){var R=loadRecords();return JSON.stringify(['
    +'metricVal(R.log[0],"dodge"), metricVal(R.log[0],"acc"), metricVal(R.log[0],"score")]);})()'));
  ok(Math.abs(mVals[0]-50)<0.01 && Math.abs(mVals[1]-100)<0.01 && mVals[2]===1200,
     '走势三维度取值正确（躲50% 准100% 分1200）');
  run('recChartMetric="acc";drawRecChart(loadRecords(),"recChart");recChartMetric="score";');
  ok(true,'切到准度维度画图不抛异常');
  run('localStorage.removeItem("aft_records");');

  /* [28b] 星标只标「当前仍是该组纪录」的那局 + 破纪录横幅
     （旧实现读流水里永久存储的 pb 标志，历史纪录全部带星；改成渲染时现算） */
  console.log('[28b] 星标只标当前纪录持有者 + 破纪录横幅');
  run('localStorage.removeItem("aft_records");');
  /* 该组首局 800：横幅亮起，写「首项纪录」 */
  run('cfg.roundIdx=0;cfg.diff=0;startRound();score=800;st.trials=10;st.dodges=8;st.hits=9;st.shots=10;endRound();');
  let pb1=JSON.parse(run('JSON.stringify({hide:$("resPB").classList.contains("hide"),sub:$("resPBSub").textContent})'));
  ok(pb1.hide===false && /首项纪录/.test(pb1.sub),'首项纪录：横幅亮起并标注「首项纪录」（实际 '+JSON.stringify(pb1.sub)+'）');
  /* 更低分 600：横幅不亮，流水行不带星 */
  run('startRound();score=600;st.trials=8;st.dodges=5;st.hits=7;st.shots=8;endRound();');
  let pb2=JSON.parse(run('JSON.stringify({hide:$("resPB").classList.contains("hide"),html:$("resRecList").innerHTML})'));
  ok(pb2.hide===true,'未破纪录：横幅保持隐藏');
  ok(!/★ 600/.test(pb2.html) && /★ 800/.test(pb2.html),'星在旧纪录 800 上，600 不带星');
  /* 破纪录 1500：横幅写「超越旧纪录 800 · +700」，星移到 1500 */
  run('startRound();score=1500;st.trials=12;st.dodges=9;st.hits=11;st.shots=12;endRound();');
  let pb3=JSON.parse(run('JSON.stringify({hide:$("resPB").classList.contains("hide"),sub:$("resPBSub").textContent,html:$("resRecList").innerHTML})'));
  ok(pb3.hide===false && /超越旧纪录 800/.test(pb3.sub) && /\+700/.test(pb3.sub),
     '破纪录：横幅写「超越旧纪录 800 · +700」（实际 '+JSON.stringify(pb3.sub)+'）');
  ok(/★ 1500/.test(pb3.html) && !/★ 800/.test(pb3.html),'星移到 1500，旧纪录 800 不再带星');
  /* 打平 1500：不算破纪录（横幅不亮），但两局并列持有最佳、都带星 */
  run('startRound();score=1500;st.trials=12;st.dodges=9;st.hits=11;st.shots=12;endRound();');
  let pb4=JSON.parse(run('JSON.stringify({hide:$("resPB").classList.contains("hide"),html:$("resRecList").innerHTML})'));
  ok(pb4.hide===true,'打平最佳：不算破纪录，横幅不亮');
  ok((pb4.html.match(/★ 1500/g)||[]).length===2,'并列最佳两局都带星（星星不靠存储标志，现算的）');
  /* 菜单页那份列表走同一个 recRowHtml，语义一致 */
  run('renderRecords();');
  let menuHtml=run('$("recList").innerHTML');
  ok(/★ 1500/.test(menuHtml) && !/★ 800/.test(menuHtml) && !/★ 600/.test(menuHtml),
     '菜单页最近训练列表同样只星当前纪录');
  run('localStorage.removeItem("aft_records"); playing=false; roundOver=false;');

  /* [29] 音乐盒：双来源曲库 + 播放闸门 + 出手声压低（帧内插值，不是 setTimeout） */
  console.log('[29] 音乐盒：曲库来源 + 播放闸门 + 出手声压低');
  ok(/data-tab="music"/.test(html)&&/id="tab-music"/.test(html),'菜单里有「音乐盒」页签和页面');
  ok(/id="musicAdd"/.test(html)&&/id="musicFile"[^>]*multiple/.test(html)&&/id="musicRescan"/.test(html),
     '添加歌曲/多选文件/重扫 music/ 三件套齐全');
  ok(/id="rMusicVol"[^>]*value="0.4"/.test(html)&&/音乐音量 <b id="vMusicVol">40%<\/b>/.test(html),
     '音乐音量滑杆默认 0.4 且带百分比标签');
  run('selectTab("music");');
  ok(run('$("tab-music").classList.contains("act")')===true,'selectTab 能定位到音乐盒页');
  ok(run('cfg.musicVol===0.4&&cfg.musicDuck===1&&cfg.musicWhen===2')===true,
     '默认：音量0.4 / 出手声压低开 / 播放范围=菜单+训练');
  run('localStorage.setItem("aft_cfg",JSON.stringify({musicVol:5,musicWhen:9,musicDuck:2}));loadCfg();');
  ok(run('cfg.musicVol===1&&cfg.musicWhen===2&&cfg.musicDuck===1')===true,
     'loadCfg 把越界音乐设置钳回合法范围');
  run('applyCfgToUI();');
  ok(+run('$("rMusicVol").value')===1&&run('$("vMusicVol").textContent')==='100%',
     'applyCfgToUI 把音乐音量刷回控件和标签');
  run('localStorage.removeItem("aft_cfg");loadCfg();applyCfgToUI();');
  ok(run('$("segMusicWhen").children.length')===3,'播放范围分段控件有 3 档');
  ok(run('$("segMusicDuck").children.length')===2,'出手声压低分段控件有 2 档');
  ok(!!run('musicScanDir()')&&typeof run('musicScanDir()').then==='function',
     'musicScanDir 返回 Promise（fetch 失败→空表，不抛异常）');
  /* 播放闸门矩阵：范围 × 场景 × 静音 × 暂停意图 */
  run('mlist.length=0;mlist.push({id:1,name:"t",dur:60,src:"dir"});mActive=true;');
  run('playing=true;$("ovl").style.display="none";roundOver=false;cfg.musicWhen=1;');
  ok(run('musicShouldPlay()')===false,'仅菜单模式：对局中不播放');
  run('$("ovl").style.display="flex";');
  ok(run('musicShouldPlay()')===true,'仅菜单模式：菜单打开时播放');
  ok(run('cfg.musicWhen=0;musicShouldPlay()')===false,'播放范围=关闭：不播放');
  run('cfg.musicWhen=2;$("ovl").style.display="none";');
  ok(run('musicShouldPlay()')===true,'播放范围=菜单+训练：对局中也播放');
  ok(run('cfg.sound=false;musicShouldPlay()')===false,'M 键静音时音乐一起停');
  run('cfg.sound=true;');
  ok(run('mActive=false;musicShouldPlay()')===false,'按了暂停(⏸)后不播放');
  run('mActive=true;');
  /* 续播索引 */
  const mni=JSON.parse(run('JSON.stringify(['
    +'musicNextIdx(0,0,"list",false,Math.random),'
    +'musicNextIdx(2,5,"list",false,Math.random),'
    +'musicNextIdx(4,5,"list",false,Math.random),'
    +'musicNextIdx(3,5,"one",false,Math.random),'
    +'musicNextIdx(3,5,"one",true,Math.random),'
    +'musicNextIdx(0,3,"shuffle",false,()=>0),'
    +'musicNextIdx(1,3,"shuffle",false,()=>0.99)'
    +'])'));
  ok(JSON.stringify(mni)===JSON.stringify([-1,3,0,3,4,1,2]),
     '续播索引：空表-1 / 列表循环回绕 / 单曲自动不换手动换 / 随机避开当前');
  /* 出手声压低：帧内插值收敛，不掉帧不瞬跳 */
  run('flashes.length=0;flashes.push({t0:T-1,audOff:0,popped:false});');
  run('playing=true;paused=false;roundOver=false;cfg.musicDuck=1;mduck=1;');
  run('for(var i=0;i<60;i++) musicTick(0.05);');
  ok(Math.abs(+run('mduck')-0.22)<0.02,'出手声可闻窗口内音乐收敛到压低档 0.22');
  run('flashes.length=0;');
  run('for(var i=0;i<60;i++) musicTick(0.05);');
  ok(Math.abs(+run('mduck')-1)<0.01,'窗口结束音乐收敛回全量');
  run('cfg.musicDuck=0;flashes.push({t0:T-1,audOff:0,popped:false});');
  run('for(var i=0;i<60;i++) musicTick(0.05);');
  ok(Math.abs(+run('mduck')-1)<0.01,'压低开关关闭时保持全量');
  run('flashes.length=0;cfg.musicDuck=1;playing=false;');
  /* 名称清洗 / 文件校验 / 时长 */
  ok(run('musicCleanName("C:\\\\fakepath\\\\My<>Song.mp3")')==='MySong.mp3',
     '导入名清洗：去路径去尖括号');
  ok(run('musicCleanName("")')==='未命名','空名兜底「未命名」');
  ok(run('musicValidateFile({name:"a.mp3",size:1024,type:"audio/mpeg"},3)')==='','合法音频通过校验');
  ok(/超过/.test(run('musicValidateFile({name:"a.mp3",size:30*1024*1024,type:"audio/mpeg"},3)')),
     '超过 25MB 的文件被拒');
  ok(/已满/.test(run('musicValidateFile({name:"a.mp3",size:1024,type:"audio/mpeg"},50)')),
     '歌单满 50 首后拒绝再导入');
  ok(/音频/.test(run('musicValidateFile({name:"a.txt",size:1024,type:"text/plain"},3)')),
     '非音频文件被拒');
  ok(run('musicValidateFile({name:"a.flac",size:1024,type:""},3)')==='',
     'MIME 缺失但扩展名合法 → 放行');
  ok(run('fmtDur(83)')==='1:23'&&run('fmtDur(0)')==='0:00','时长格式化 m:ss');
  /* 列表渲染：行结构 + 当前曲高亮 + 空态 */
  run('mlist.length=0;mlist.push({id:1,name:"曲A",dur:61,src:"dir"},{id:2,name:"曲B",dur:122,src:"idb"});mcur=0;musicRender();');
  ok(run('$("musicList").children.length')===2,'曲库列表渲染两行');
  ok(/(^| )act( |$)/.test(run('$("musicList").children[0].className')),'当前曲高亮 act');
  ok(run('$("musicList").children[0].children[1].textContent')==='📁 1:01','文件夹曲目带📁标和时长');
  ok(run('$("musicList").children[0].children[2].style.display')==='none',
     '文件夹曲目不显示删除钮（删文件+改 manifest）');
  ok(run('$("musicList").children[1].children[2].style.display')!=='none','导入曲目有删除钮');
  run('mlist.length=0;musicRender();');
  ok(run('$("musicList").children.length')===1&&/还没有曲目/.test(run('$("musicList").children[0].textContent')),
     '空曲库显示引导提示');

  /* [29b] 悬浮条 + 播放列表面板（三角洲样式：曲名/来源/进度条/共享控制） */
  console.log('[29b] 悬浮条与播放列表面板');
  ok(/id="musicBall"/.test(html)&&/id="musicBallPlay"/.test(html)&&/id="musicBallList"/.test(html)&&/id="musicBallMeta"/.test(html),
     '悬浮条结构齐全（曲名/播放/上一首/下一首/列表钮）');
  ok(/id="musicPanel"/.test(html)&&/id="musicPList"/.test(html)&&/id="musicPBar"/.test(html)&&/id="musicPFill"/.test(html)
     &&/id="musicPT"/.test(html)&&/id="musicPDur"/.test(html)&&/id="musicPLoop"/.test(html),
     '播放列表面板结构齐全（行区/进度条/时间/循环钮）');
  run('mlist.length=0;mcur=-1;musicRender();');
  ok(run('$("musicBall").classList.contains("hide")')===true,'空曲库时悬浮条隐藏');
  run('mlist.push({id:1,name:"In The Summer.mp3",dur:181,src:"dir"},{id:2,name:"Leave No Man Behind.m4a",dur:207,src:"idb"});mcur=0;musicRender();');
  ok(run('$("musicBall").classList.contains("hide")')===false,'有曲目后悬浮条出现');
  ok(run('$("musicBallTitle").textContent')==='In The Summer','悬浮条标题去掉扩展名');
  ok(run('$("musicBallSub").textContent')==='music/ 文件夹 · 列表循环','悬浮条副行=来源+循环模式');
  ok(run('musicPrettyName("Blazefall（焰火）.flac")')==='Blazefall（焰火）','PrettyName 兼容中文括号与扩展名');
  ok(run('musicSrcLabel(mlist[1])')==='本机导入','来源标注：导入曲=本机导入');
  run('mDur=0;mPlayOff=0;');
  ok(run('musicCalcPos()')===0,'未播放时进度位置=0');
  run('mDur=100;mPlayOff=25;');
  ok(run('musicCalcPos()')===25,'暂停时进度停在偏移处');
  run('musicSeek(0.5);');
  ok(run('mPlayOff')===50,'seek(0.5) 落在 50s');
  run('musicSeek(3);');
  ok(run('mPlayOff')===100,'seek 超界钳到曲长');
  run('musicSeek(-1);');
  ok(run('mPlayOff')===0,'seek 负值钳到 0');
  run('musicPanelToggle();');
  ok(run('musicPanelOpen')===true&&run('$("musicPanel").classList.contains("open")')===true,'面板能打开');
  ok(run('$("musicPList").children.length')===2,'面板渲染曲目行');
  ok(/(^| )act( |$)/.test(run('$("musicPList").children[0].className')),'面板当前曲行高亮');
  ok(run('$("musicPTitle").textContent')==='In The Summer','迷你条标题同步');
  run('musicCycleLoop();');
  ok(run('mLoop')==='one'&&run('$("musicPLoop").textContent')==='单曲循环','循环切换同步到迷你条');
  run('musicCycleLoop();musicCycleLoop();');
  ok(run('mLoop')==='list'&&run('$("musicLoop").textContent')==='列表循环','循环三档转回列表循环，页签按钮文案同步');
  run('musicJump(1);');
  ok(run('mcur')===1,'musicJump(1) 前进一首');
  run('musicJump(-1);');
  ok(run('mcur')===0,'musicJump(-1) 退回一首');
  run('musicJump(-1);');
  ok(run('mcur')===1,'musicJump(-1) 从 0 回绕到末首');
  run('musicPanelToggle(false);');
  ok(run('musicPanelOpen')===false&&run('$("musicPanel").classList.contains("open")')===false,'面板能关闭');
  run('mlist.length=0;mcur=-1;mDur=0;mPlayOff=0;');

  /* [29c] 破纪录音效：recordRound 在真破纪录时响一次；自定义 sfx/record.wav 可覆盖合成音 */
  console.log('[29c] 破纪录音效');
  ok(run('SFX_NAMES.includes("record")')===true,'SFX_NAMES 注册了 record（可被 sfx/record.wav 覆盖）');
  ok(run('typeof sfx.record')==='function','sfx.record 存在');
  run('cfg.sound=true;sfx.record();cfg.sound=false;sfx.record();cfg.sound=true;');
  ok(true,'破纪录音效在静音/发声两态下都不抛异常');
  /* 音乐盒页底部提示已删（随仓库入库后提示失去意义） */
  ok(!/导入的歌保存在/.test(html),'音乐盒页的导入提示文字已删除');
  /* 触发闸门：破纪录响一次，更低分不响 */
  run('var __recN=0; sfx.record=function(){__recN++;};');
  run('localStorage.removeItem("aft_records");cfg.roundIdx=0;cfg.diff=0;playing=true;');
  run('startRound();score=9999;st.trials=5;st.hits=4;st.shots=5;endRound();');
  ok(run('__recN')===1,'破纪录时音效触发一次');
  run('startRound();score=10;st.trials=5;st.hits=4;st.shots=5;endRound();');
  ok(run('__recN')===1,'未破纪录不再触发');
  run('startRound();score=20000;st.trials=5;st.hits=4;st.shots=5;endRound();');
  ok(run('__recN')===2,'再次破纪录再触发');
  run('delete sfx.record; sfx.record=function(){}; localStorage.removeItem("aft_records"); playing=false; roundOver=false;');

  /* [30] 对战断线重连：sessionStorage 存档 + 开机自动挂回 + 缺席轮次自动重赛 */
  console.log('[30] 对战断线重连');
  (async()=>{                                                     /* 尾部转异步：await vm 里的重连 promise */
  run('match.active=true;match.cloud=true;match.code="AB3K7M";match.you="我";matchStateSave();');
  ok((JSON.parse(run('sessionStorage.getItem("aft_match")'))||{}).code==='AB3K7M','对局状态已写入 sessionStorage');
  run('leaveMatch(true);');
  ok(run('sessionStorage.getItem("aft_match")')===null,'退出对战清掉存档');
  run('match.active=true;match.cloud=true;match.code="AB3K7M";match.you="我";');
  run('applyState({players:[{name:"我",ready:true},{name:"他",ready:false}],round:1,now:Date.now()});');
  ok((JSON.parse(run('sessionStorage.getItem("aft_match")')||'null')||{}).code==='AB3K7M','applyState 每次同步都自动续写存档');
  /* 缺席轮次的四分支（直接喂 match 状态， spy 掉 matchAgain） */
  run('var __ag=0; matchAgain=function(){__ag++;};');
  run('match.startAt=0; resumeResolveInterrupted();');
  ok(run('__ag')===0,'未开局：不触发重赛，大厅等着就行');
  run('cfg.roundIdx=0; match.startAt=Date.now()-60000;');
  run('match.players=[{name:"我",score:800},{name:"他",score:900}]; resumeResolveInterrupted();');
  ok(run('__ag')===0,'双方都已交卷：报比分，不重赛');
  run('match.players=[{name:"我",score:null},{name:"他",score:900}]; resumeResolveInterrupted();');
  ok(run('__ag')===1,'我缺席且对手已交卷：自动发起重赛');
  run('match.players=[{name:"我",score:null},{name:"他",score:null}]; match.startAt=Date.now()-5000; match.phase="lobby"; resumeResolveInterrupted();');
  ok(run('resumePending')===true,'对手还在打：进入等待态');
  run('applyState({players:[{name:"我",score:null},{name:"他",score:1234}],round:match.round,now:Date.now()});');
  ok(run('__ag')===2,'对手交卷后 applyState 自动发起重赛');
  /* 我在等交卷(result)时对方推进 round → 自动回大厅 */
  run('resumePending=false; match.phase="result"; match.round=2; lobbyClose();');
  run('match.players=[{name:"我",score:50},{name:"他",score:60}];');
  run('applyState({players:[{name:"我",ready:false,score:null},{name:"他",ready:false,score:null}],round:3,now:Date.now()});');
  ok(run('lobbyIsOpen()')===true,'result 相位收到对方重赛 → 自动回大厅');
  run('leaveMatch(true);');
  /* 开机自动重连：云端不可达 → 同房码转离线，不强行开大厅 */
  run('sessionStorage.setItem("aft_match",JSON.stringify({code:"ZZ9K2M",you:"我",ts:Date.now()}));');
  await run('resumeMatch()');
  ok(run('match.active')===true&&run('match.code')==='ZZ9K2M','开机自动重连：用存档房码挂回对局');
  ok(run('match.cloud')===false,'云端不可达 → 自动转离线模式');
  ok(run('lobbyIsOpen()')===false,'云端不可达时不强行弹大厅');
  run('leaveMatch(true);');

  /* [31] 每日挑战：日期种子 + 配置快照还原 + 独立榜单 + 常规纪录隔离 */
  console.log('[31] 每日挑战');
  ok(/^\d{8}$/.test(run('dailyKeyDate()'))===true,'日期串 YYYYMMDD');
  ok(/id="dailyStrip"/.test(html)&&/id="dailyStart2"/.test(html)&&!/id="dailyStart"/.test(html),
     '入口在「单人训练」开屏页；记录页只留榜单（无开始按钮）');
  const ds1=run('dailySeedOf(dailyKeyDate())'), ds2=run('dailySeedOf(dailyKeyDate())'),
        ds3=run('dailySeedOf("19990101")');
  ok(ds1===ds2&&ds1!==ds3&&ds1>0,'同日种子稳定、跨日不同、非零');
  run('renderDaily();');
  ok(run('$("dailyDate2").textContent')===run('dailyKeyDate()')
     &&run('DAILY_MODS.some(m=>m.n===$("dailyModName").textContent)')===true
     &&run('$("dailyBest2").textContent')==='—',
     '开屏挑战条：日期/当日修饰规则名/今日最佳（未挑战=—）同步');
  run('cfg.rate=0.8;cfg.targetN=5;cfg.diff=0;cfg.targetR=0.09;cfg.agents={phoenix:true,skye:false,breach:false,kayo:false,yoru:false,reyna:false};');
  run('DAILY.mod=dailyModOf(dailyKeyDate()); dailyApplyCfg();');
  ok(run('cfg.rate')===run('DAILY.applied.rate')&&run('cfg.targetN')===run('DAILY.applied.targetN')
     &&run('cfg.targetR')===run('DAILY.applied.targetR')
     &&run('cfg.agents.kayo')===run('DAILY.applied.agents.kayo')
     &&run('cfg.diff')===1,'挑战配置=基础+当日修饰规则合并（含靶径字段）');
  ok(run('DAILY_MODS.indexOf(DAILY.mod)')>=0
     &&run('dailyModOf(dailyKeyDate())')===run('DAILY.mod'),'当日修饰规则抽取确定且在池内');
  run('dailyRestoreCfg();');
  ok(run('cfg.rate')===0.8&&run('cfg.targetN')===5&&run('cfg.diff')===0&&run('cfg.targetR')===0.09
     &&run('cfg.agents.kayo')===false,'结算后配置按快照还原（含靶径）');
  /* 每日挑战加入维斯与盖克。坑在「限定特工」类规则：它们直接写死一份特工表，
     基础池新增的特工会漏进去（本该只有两只特工的规则里冒出维斯和盖克），
     所以那些规则必须显式把它们关掉。这里把合并结果与规则表都钉住。
     断言期间一律用 apply/restore 成对调用，别把全局 cfg 留在挑战配置上。 */
  ok(run('DAILY_BASE.agents.vyse===true && DAILY_BASE.agents.gekko===true'),
     '每日挑战基础配置已登记维斯与盖克');
  run('DAILY.mod=DAILY_MODS[0]; dailyApplyCfg();');
  const dailyMainOn=run('cfg.agents.vyse===true && cfg.agents.gekko===true');
  run('dailyRestoreCfg();');
  ok(dailyMainOn,'常规规则下维斯与盖克进入挑战出闪光池');
  for(const nm of ['五只眼','铁幕试炼']){
    run('DAILY.mod=DAILY_MODS.find(m=>m.n==='+JSON.stringify(nm)+'); dailyApplyCfg();');
    const excluded=run('cfg.agents.vyse===false && cfg.agents.gekko===false');
    const onlyTwo=run('Object.values(cfg.agents).filter(Boolean).length===2');
    run('dailyRestoreCfg();');
    ok(excluded, nm+' 显式排除维斯与盖克（新增特工不漏进限定规则）');
    ok(onlyTwo, nm+' 仍然只出规则指定的两只特工');
  }
  /* 特殊特工专场规则（丢丢/玫瑰/飞鸟）。限定规则的表必须写全所有特工键，
     否则合并时会继承基础表的 true。dailyOnlyAgents 就是为了根治这个坑，
     但规则可能被手写整表，所以逐条按「实际抽签结果」验证，而不是只读配置。 */
  for(const [nm,expect] of [['丢丢疯潮',['gekko']],['荆棘玫瑰',['vyse']],['群鸟乱舞',['skye']],
                            ['一枪一个',['gekko','vyse']],['三色闪光',['gekko','vyse','skye']]]){
    run('DAILY.mod=DAILY_MODS.find(m=>m.n==='+JSON.stringify(nm)+'); dailyApplyCfg();');
    const pool=run('enabledAgents().slice().sort().join(",")');
    run('dailyRestoreCfg();');
    ok(pool===expect.slice().sort().join(','), nm+' 只出指定特工（实际 '+pool+'）');
  }
  ok(run('DAILY_MODS.length===11'),'规则池共 11 条（原 6 条 + 5 条特工专场）');
  ok(run('DAILY_MODS.every(m=>Object.values(m.cfg.agents||{}).some(Boolean)||!m.cfg.agents)'),
     '限定类规则的 cfg.agents 不会全 false（否则抽出一条空池子、开局没有闪光）');
  run('dailyStart();');
  ok(run('DAILY.active')===true&&run('cfg.rate')===run('DAILY.applied.rate')&&run('playing')===true,
     '开始挑战：按当日修饰规则生效并直接开局');
  ok(run('$("bFlash").style.display')==='none'&&run('$("bReset").style.display')==='none',
     '挑战中隐藏手动闪光/刷新靶点按钮（防破坏全网同序列）');
  run('localStorage.removeItem("aft_records");');
  run('score=777; st.trials=6; st.hits=5; st.shots=6; endRound();');
  ok(run('DAILY.active')===false&&run('cfg.rate')===0.8,'结算后退出挑战态、配置还原');
  ok(run('loadRecords().log.length')===0,'挑战结算不进常规纪录（配置不可比）');
  ok(JSON.parse(run('localStorage.getItem("aft_daily")')).best===777,'本地今日最佳已记 777');
  ok(+run('$("dailyBest2").textContent')===777,'开屏挑战条的今日最佳结算后实时同步');
  ok(run('$("mCmp").style.display')===''&&/每日挑战/.test(run('$("mCmp").innerHTML')),
     '结算面板直接显示当日榜（离线兜底=本地最佳）');
  /* 普通回合：结算面板不放每日榜 */
  run('startRound(); score=60; st.trials=2; st.shots=2; endRound();');
  ok(run('$("mCmp").style.display')==='none','普通回合结算不显示每日榜');
  run('localStorage.setItem("aft_name","我");');
  run('renderDailyBoard([{name:"我",score:900},{name:"他",score:100}]);');
  const boardHtml=run('$("dailyBoard").innerHTML');
  ok(/1\. 我/.test(boardHtml)&&/class="recRow mine"/.test(boardHtml)&&/2\. 他/.test(boardHtml),
     '榜单渲染：名次排序、我的行带高亮');
  /* 昵称：没起名自动分配并持久化（榜单名称稳定，不会每局换编号） */
  run('localStorage.removeItem("aft_name"); ensureName();');
  const autoNm=run('myName()');
  ok(typeof autoNm==='string'&&autoNm.indexOf('训练者')===0,'未起名自动分配「训练者XXXX」');
  run('ensureName();');
  ok(run('myName()')===autoNm,'分配的昵称持久化 → 榜单名称跨局稳定');
  run('localStorage.removeItem("aft_name");');

  /* [32] 战绩记录 + 弱项诊断 */
  console.log('[32] 战绩记录 + 弱项诊断');
  run('localStorage.removeItem("aft_matchstats");');
  run('match.active=true;match.cloud=true;match.code="AB3K7M";match.you="我";match.round=1;match.phase="result";');
  run('applyState({players:[{name:"我",score:800},{name:"他",score:900}],round:1,now:Date.now()});');
  let ms=JSON.parse(run('JSON.stringify(loadMatchStats())'));
  ok(ms.total===1&&ms.losses===1&&ms.streak===-1,'输一局：总场/负/连负计入');
  run('applyState({players:[{name:"我",score:800},{name:"他",score:900}],round:1,now:Date.now()});');
  ok(JSON.parse(run('JSON.stringify(loadMatchStats())')).total===1,'同轮重复轮询不重复计');
  run('applyState({players:[{name:"我",score:1000},{name:"他",score:900}],round:2,now:Date.now()});');
  ms=JSON.parse(run('JSON.stringify(loadMatchStats())'));
  ok(ms.total===2&&ms.wins===1&&ms.streak===1,'赢一局：连胜从 -1 翻回 1');
  run('renderMatchStats();');
  ok(/总场次/.test(run('$("mstatCard").innerHTML'))&&/胜率/.test(run('$("mstatCard").innerHTML')),'战绩卡渲染');
  run('leaveMatch(true); localStorage.removeItem("aft_matchstats");');
  /* 弱项诊断：同配置历史均值对比 + 点名最弱特工 */
  run('localStorage.removeItem("aft_records");');
  run('(function(){var r={best:{},log:[]};for(var i=0;i<3;i++)r.log.push({t:i,ri:0,diff:0,mode:0,score:i,cb:0,bl:0,ag:"kayo",dg:5,tr:10,hs:5,ss:10,rf:1000,rt:null,pb:false});localStorage.setItem("aft_records",JSON.stringify(r));})();');
  run('cfg.roundIdx=0;cfg.diff=0;startRound();');
  run('st.rfN=4;st.rfSum=5.6;st.by={phoenix:{n:5,dg:4},kayo:{n:4,dg:1}};');
  const note=run('buildCoachNotes()');
  ok(/均值/.test(note)&&/慢\s*400/.test(note),'回靶对比：1400ms vs 均值1000 → 慢 400ms');
  ok(/KO/.test(note)&&/25%/.test(note)&&/最弱项/.test(note),'最弱特工点名（KO 只躲 25%）');
  run('localStorage.removeItem("aft_records"); playing=false; roundOver=false;');

  /* [33] 蕾娜之眼擦边宽容档：贴锥角边缘瞥到 → 近视但连击不断；正对 → 仍断；击毁 → 返还连击 */
  console.log('[33] 蕾娜之眼擦边宽容档');
  run('cfg.auto=false;cfg.agents.reyna=true;flashes=[];pops=[];nearUntil=0;nearSrc=0;playing=true;paused=false;roundOver=false;roundEndAt=0;');
  step(1);                                            /* 先同步时钟：此前的段落可能推过 vm 的 T 造成漂移 */
  run('spawnFlash("reyna");');
  aim('flashes[0].pos');
  run('cam.yaw+=0.85*flashes[0].a.coneHalf*RAD;');   /* 偏到锥角 85% 处 → cover≈0.27 ≤ 0.30 */
  run('combo=5; st.best=5;');
  step(33);                                          /* 睁眼需 0.5s=30 帧，留 3 帧余量 */
  ok(run('flashes[0].opened')===true,'擦边角度：眼睛睁开');
  ok(run('nearUntil>T')===true,'擦边：近视仍生效');
  ok(run('combo')===6,'擦边：连击不断（5→6）');
  const blBefore=+run('st.blinds');
  ok(+run('st.blinds')===blBefore,'擦边：不计被闪');
  run('flashes=[];pops=[];nearUntil=0;nearSrc=0;combo=5;spawnFlash("reyna");');
  aim('flashes[0].pos'); step(33);
  ok(+run('st.blinds')>blBefore&&run('combo')===0,'正对眼睛：仍断连击（保持威慑）');
  aim('flashes[0].pos'); run('shoot();');
  aim('flashes[0].pos'); run('shoot();');   /* 两发击毁紫眼 */
  ok(run('combo')===5,'击毁紫眼：致盲前连击返还（5）');
  ok(run('nearUntil<=T')===true,'击毁后近视解除');
  run('flashes=[];pops=[];nearUntil=0;nearSrc=0;cfg.agents.reyna=false;playing=false;roundOver=false;');

  /* [34] 维斯金属玫瑰：贴墙绽放（预警窗口）→ 绽放完成爆闪；直视致盲、背对算躲 */
  console.log('[34] 维斯金属玫瑰');
  const Z_WALL=+run('ROOM.zW');                       /* 墙面 z，贴墙位置按它校验 */
  ok(Z_WALL>0,'墙面常量可读（z='+Z_WALL+'）');
  ok(run('!!AGENTS.vyse')===true,'AGENTS 注册了 vyse');
  ok(run('AGENTS.vyse.shape')==='rose'&&run('AGENTS.vyse.coneHalf')>0&&run('AGENTS.vyse.noPath')===true,
     '玫瑰形态：放置型（无飞行段）');
  /* 默认值看源码声明 —— 跑到这里时 cfg 已被前面的用例改过，只能查常量字面量 */
  ok(/agents:\{phoenix:true,skye:true,breach:true,kayo:false,yoru:false,reyna:false,vyse:false,gekko:false\}/.test(html),
     '维斯默认关闭（与 KO/夜露/蕾娜 一致）');
  run('cfg.agents.vyse=true;');
  ok(run('enabledAgents().indexOf("vyse")>=0')===true,'开启后进入抽签池');
  run('cfg.agents.vyse=false;');
  ok(run('enabledAgents().indexOf("vyse")<0')===true,'关闭后不在抽签池');
  ok(run('SFX_NAMES.indexOf("vyse_pop")>=0')===true,
     '引爆音已注册可被 sfx/vyse_pop.wav 覆盖（放置音走合成，不登记）');
  /* 放置形态 */
  run('cfg.agents.vyse=true;cfg.auto=false;flashes=[];pops=[];blindUntil=0;blindDur=0;playing=true;paused=false;roundOver=false;roundEndAt=0;');
  step(1);                                            /* 对齐时钟后再生成 */
  run('spawnFlash("vyse")');
  const vy=JSON.parse(run('JSON.stringify({pos:flashes[0].pos,travel:flashes[0].travel,audOff:flashes[0].audOff,trail:flashes[0].trail.length,popAt:flashes[0].popAt,t0:flashes[0].t0,bloomAt:flashes[0].bloomAt,bloomDur:flashes[0].bloomDur,det:!!flashes[0].a.destructible,hp:flashes[0].hp})'));
  ok(vy.trail===0,'贴墙金属滴不留拖尾');
  ok(Math.abs(vy.pos.z-(Z_WALL-0.05))<0.02,'紧贴墙面（z=6.45，玩家一侧）');
  ok(Math.abs(vy.pos.x)>=1.9&&Math.abs(vy.pos.x)<=3.4,'落在拱门两侧实墙面（不悬在门洞空中）');
  ok(vy.audOff===0,'放置声立刻响（放置型没有可见窗口可提前）');
  ok(vy.det===true&&vy.hp===1,'玫瑰可击毁且一击即毁');
  /* 蓄势：放置后藏成半透明花蕊，过一段随机时间才突然绽放 */
  ok(vy.bloomAt>vy.t0+2&&vy.bloomAt<vy.t0+7,'蓄势时长落在 2~7 秒随机区间（不是立刻引爆）');
  ok(vy.popAt>vy.bloomAt&&vy.bloomDur>0.3&&vy.bloomDur<1.0,'引爆 = 绽放开始 + 很短的绽放时长');
  run('T=flashes[0].t0+0.8;updateFlashes();');
  ok(run('flashes[0].popped')===false,'蓄势期：不引爆');
  ok(run('blindUntil')===0,'蓄势期不致盲');
  ok(run('flashes[0].visAt')===0,'蓄势期不计入「看得见」（不污染转身反应统计）');
  ok(run('flashes.length')===1,'蓄势期玫瑰仍在场（花蕊未消失）');
  /* 突然绽放 → 引爆 */
  aim('flashes[0].pos');
  run('T=flashes[0].bloomAt+flashes[0].bloomDur*0.5;updateFlashes();');
  ok(run('flashes[0].popped')===false,'绽放中（半程）仍未引爆');
  run('T=flashes[0].popAt;updateFlashes();');
  ok(run('flashes[0].popped')===true,'绽放完成即引爆');
  ok(run('blindUntil>T')===true,'直视爆闪 → 白屏致盲');
  ok(run('pops.length')>=1,'爆闪粒子已生成（亮白 + 淡紫）');
  /* 背对 → 同一朵玫瑰判躲开、连击不断 */
  run('flashes=[];pops=[];blindUntil=0;blindDur=0;combo=3;');
  step(1);
  run('spawnFlash("vyse")');
  aim('flashes[0].pos');
  run('cam.yaw+=1.5;');                                /* 转身背对（> 锥角 +4） */
  const dgBefore=+run('st.dodges');
  run('T=flashes[0].popAt;updateFlashes();');
  ok(run('flashes[0].popped')===true,'背对时玫瑰照常引爆');
  ok(run('st.dodges')>dgBefore&&run('combo')===4,'背对爆闪 → 判躲开、连击 3→4');
  ok(run('blindUntil')===0,'背对不致盲');
  run('flashes=[];pops=[];blindUntil=0;blindDur=0;cfg.agents.vyse=false;playing=false;roundOver=false;');

  console.log('[35] 维斯开满后亮光预警');
  ok(run('roseStage(0.5).bloom')<1&&run('roseStage(0.5).charge')===0,'未开满时不进入充能段');
  ok(run('roseStage(0.65).bloom')===1&&run('roseStage(0.65).charge')===0,'65% 时间花瓣开满');
  ok(run('roseStage(0.8).bloom')===1&&run('roseStage(0.8).charge')>0,'开满后保持花形并发出预警光');
  ok(run('roseStage(1).charge')===1,'引爆时预警亮度到峰值');
  /* 引爆音 = 用户提供的录音素材；放置音 = 自制合成音（故意不放 wav） */
  const popWav=fs.readFileSync(path.resolve(__dirname,'..','sfx','vyse_pop.wav'));
  ok(popWav.toString('ascii',0,4)==='RIFF'&&popWav.length<70000,
     '引爆音用录音素材且 ≤70KB（实际 '+popWav.length+' 字节）');
  ok(!fs.existsSync(path.resolve(__dirname,'..','sfx','vyse_throw.wav')),
     '放置音不放 wav 文件 → 自动回退到合成音（用户要求放置音自制）');
  ok(run('SFX_NAMES.indexOf("vyse_pop")>=0&&SFX_NAMES.indexOf("vyse_throw")<0'),
     'SFX_NAMES 只登记引爆音：放置音走合成，避免误用录音');
  ok(run('typeof THROW_SYNTH.vyse')==='function'&&run('typeof POP_SYNTH.vyse')==='function',
     '放置/引爆都有合成音兜底（素材缺失时也不会哑）');
  ok(run('playFile("vyse_throw",0.9)')===false,'放置时刻拿不到 vyse_throw 素材 → 落到合成音');
  run('playing=true;paused=false;roundOver=false;roundEndAt=0;spawnFlash("vyse");');
  run('T=flashes[0].bloomAt+flashes[0].bloomDur*0.8;updateFlashes();');
  ok(run('flashes[0].popped')===false,'开满并亮光预警期间仍不引爆');
  const warningLeft=run('flashes[0].popAt-T');
  const bloomLeft=run('flashes[0].bloomAt-T');
  run('shiftTime(3);T+=3;updateFlashes();');
  ok(Math.abs(run('flashes[0].popAt-T')-warningLeft)<1e-8,'暂停平移保留预警剩余时间');
  ok(Math.abs(run('flashes[0].bloomAt-T')-bloomLeft)<1e-8,'暂停平移同时保留绽放时刻（恢复后不会立刻绽放）');
  run('T=flashes[0].popAt;updateFlashes();');
  ok(run('pops.some(p=>p.rose)')===true,'到点才生成维斯专属紫光爆闪');
  run('playing=false;flashes=[];pops=[];');

  /* [36] 维斯玫瑰可击毁：蓄势期打掉终止生成，绽放期打掉取消爆闪 */
  console.log('[36] 维斯玫瑰可击毁');
  run('cfg.agents.vyse=true;cfg.auto=false;playing=true;paused=false;roundOver=false;roundEndAt=0;flashes=[];pops=[];blindUntil=0;blindDur=0;combo=0;');
  step(1);
  run('spawnFlash("vyse")');
  aim('flashes[0].pos');
  const dg0=+run('st.dodges'), sc0=+run('score'), pop0=+run('flashes[0].popAt');
  run('shoot();');
  ok(run('flashes[0].popped')===true&&run('flashes[0].dead')===true,'蓄势期一枪打掉（一击即毁）');
  ok(+run('score')>sc0,'击毁给分（+'+run('SCORE.roseKill')+'）');
  ok(+run('st.dodges')===dg0+1,'击毁算一次成功应对（躲闪率不被稀释）');
  run('updateFlashes();');
  ok(run('flashes.length')===0,'打掉后该闪光消失，不再继续生成');
  run('T='+pop0+'+0.5;updateFlashes();');
  ok(run('blindUntil')===0,'越过了原引爆时刻也不会爆闪致盲');
  /* 绽放期打掉：同样取消爆闪 */
  run('flashes=[];pops=[];blindUntil=0;blindDur=0;combo=0;spawnFlash("vyse")');
  run('T=flashes[0].bloomAt+flashes[0].bloomDur*0.4;updateFlashes();');
  ok(run('flashes[0].popped')===false,'绽放中还没爆');
  aim('flashes[0].pos');
  const pop1=+run('flashes[0].popAt');
  run('shoot();');
  ok(run('flashes[0].dead')===true,'绽放期打掉玫瑰');
  run('T='+pop1+'+0.5;updateFlashes();');
  ok(run('blindUntil')===0,'引爆前打掉 → 不会爆闪');
  /* 引爆之后打不到（不再重复给分） */
  run('flashes=[];pops=[];blindUntil=0;spawnFlash("vyse");T=flashes[0].popAt;updateFlashes();');
  ok(run('flashes[0].popped')===true,'已引爆');
  const scAfter=+run('score'), hpAfter=+run('flashes[0].hp');
  aim('flashes[0].pos');
  run('shoot();');
  ok(+run('flashes[0].hp')===hpAfter&&+run('score')===scAfter,'引爆后无法再击毁（不重复给分）');
  run('flashes=[];pops=[];blindUntil=0;cfg.agents.vyse=false;playing=false;roundOver=false;');

  /* [37] 「边缘提示」已按用户要求整体删除（不是关闭，是移除）
     —— 顺带记下它当年被误当成 bug 的原因：维斯蓄势期长达数秒，
     若照常提示，屏幕边缘会长期挂着一个维斯色小箭头随视角滑动。 */
  console.log('[37] 边缘提示功能已移除');
  ok(run('typeof drawEdgeHints')==='undefined','drawEdgeHints 已删除（不是留个空壳）');
  ok(run('cfg.edge')===undefined,'cfg.edge 配置项已删除');
  ok(/data-k="edge"/.test(html)===false,'设置页的「边缘提示」开关已删除');
  ok(/边缘提示/.test(html)===false,'源码里不再有「边缘提示」字样');
  ok(run('(function(){ render(); return 1; })()')===1,'渲染主流程不依赖它（render() 正常跑完）');

  /* [38] 花蕊的光点必须落在花蕊上：平移块内误用屏幕坐标会画到 (2x,2y)
     —— 实测表现为「花蕊右下角一颗幽灵淡紫小白点」，只有维斯出现过。
     要点：光记原始参数分不清「平移前用屏幕坐标」与「平移内用局部坐标」，
     必须跟着追踪 translate/save/restore 的累积，比对**有效屏幕位置**。 */
  console.log('[38] 花蕊光点不跑到别处');
  run('window.__tx=0; window.__ty=0; window.__glows=[]; window.__st=[];'
     +'if(!window.__realGlow) window.__realGlow=glowDot;'
     +'ctx.translate=function(x,y){ window.__tx+=x; window.__ty+=y; };'
     +'ctx.save=function(){ window.__st.push([window.__tx,window.__ty]); };'
     +'ctx.restore=function(){ var s=window.__st.pop(); if(s){ window.__tx=s[0]; window.__ty=s[1]; } };'
     +'glowDot=function(x,y,r,rgb,a0,a1){'
     +'  window.__glows.push([Math.round(x+window.__tx),Math.round(y+window.__ty)]);'
     +'  return window.__realGlow(x,y,r,rgb,a0,a1); };');
  run('drawRoseBud(300,200,20,"205,170,255",1);');
  const budGlows=JSON.parse(run('JSON.stringify(window.__glows)'));
  ok(budGlows.length>=2,'花蕊确实画了多处光点（实测 '+budGlows.length+' 处）');
  ok(budGlows.every(g=>g[0]===300&&g[1]===200),
     '每处光点的有效屏幕位置都落在花蕊 (300,200)，实测 '+JSON.stringify(budGlows));
  ok(budGlows.some(g=>g[0]===600&&g[1]===400)===false,
     '没有画到 (2x,2y)=(600,400) —— 平移叠加的幽灵点');
  /* 绽放态同理（它的光点在平移之外，顺手一起钉住） */
  run('window.__glows=[]; drawRose(300,200,20,"205,170,255",0.9,1);');
  const roseGlows=JSON.parse(run('JSON.stringify(window.__glows)'));
  ok(roseGlows.every(g=>g[0]===300&&g[1]===200),
     '绽放态的光点同样都落在花体位置，实测 '+JSON.stringify(roseGlows));
  run('glowDot=window.__realGlow; delete ctx.translate; delete ctx.save; delete ctx.restore;');

  /* [39] 每日榜单：新开页面也要能渲染（曾经 DAILY.date 是空串，守卫永远不成立，
     拉回来的榜单被丢弃 = 「等多久都不出榜单」）+ 缓存避免每次切页重拉 */
  console.log('[39] 每日榜单渲染与缓存');
  run('window.__fetchN=0; window.__board=[{name:"甲",score:300},{name:"我",score:200}];'
     +'dailyFetchBoard=function(){ window.__fetchN++; return Promise.resolve(window.__board); };'
     +'localStorage.setItem("aft_name","我");'
     +'DAILY.date=""; DAILY.rows=null; DAILY.rowsDate=""; DAILY.rowsAt=0;');
  run('renderDaily();');
  await run('new Promise(r=>setTimeout(r,25))');
  const boardHtml2=run('$("dailyBoard").innerHTML');
  ok(/甲/.test(boardHtml2)&&/300/.test(boardHtml2),'DAILY.date 为空（新开页面）也能把榜单渲染出来');
  ok(/class="recRow mine"/.test(boardHtml2),'我的那一行带高亮');
  const fetchN1=+run('window.__fetchN');
  ok(fetchN1===1,'首次进入发起 1 次请求（实测 '+fetchN1+'）');
  run('renderDaily();renderDaily();');
  await run('new Promise(r=>setTimeout(r,25))');
  ok(+run('window.__fetchN')===fetchN1,'缓存有效期内反复切页不重复请求（实测仍 '+fetchN1+' 次）');
  run('DAILY.rowsAt=0; renderDaily();');
  await run('new Promise(r=>setTimeout(r,25))');
  ok(+run('window.__fetchN')===fetchN1+1,'缓存过期后重新拉一次');
  run('DAILY.rows=null; DAILY.rowsDate=""; DAILY.rowsAt=0;'
     +'dailyFetchBoard=function(){ return new Promise(function(){}); }; renderDaily();');
  ok(/加载中/.test(run('$("dailyBoard").innerHTML')),'数据未到时显示「加载中」，不是空白');
  run('DAILY.rows=null; DAILY.rowsDate=""; DAILY.rowsAt=0;'
     +'dailyFetchBoard=function(){ return Promise.resolve(null); }; renderDaily();');
  await run('new Promise(r=>setTimeout(r,25))');
  const notAvail=run('$("dailyBoard").innerHTML');
  ok(/拉不到/.test(notAvail),'云端不可用时给明确兜底文案（实测: '+String(notAvail).slice(0,110)+'）');
  run('dailyFetchBoard=function(){ return Promise.resolve([]); };');

  /* [40] 走势图吸附：画布被 CSS 缩放后，鼠标的 CSS 像素必须换算成位图像素
     —— 混用会让吸附点整体横移，「移到圆点上大多数不显示」 */
  console.log('[40] 走势图悬停命中');
  run('$("recChart").width=560; $("recChart").height=150;');   /* vm 的 canvas 桩没有尺寸，图表几何要靠它 */
  run('localStorage.setItem("aft_records", JSON.stringify({best:{},log:'
     +'[0,1,2,3,4].map(function(i){return {t:Date.now()-(5-i)*3600e3,ri:0,diff:0,mode:0,'
     +'score:100+i*10,cb:1,bl:0,ag:"phoenix",dg:5,tr:10,hs:8,ss:10,rf:1000,rt:null,pb:false};})}));');
  run('recChartDiff=0; recChartMetric="score"; drawRecChart(loadRecords(),"recChart");');
  const pxArr=JSON.parse(run('JSON.stringify(recDrawCache["recChart"].px)'));
  const pyArr=JSON.parse(run('JSON.stringify(recDrawCache["recChart"].py)'));
  const mid=pxArr.length>>1;
  ok(pxArr.length===5&&pxArr.every(v=>typeof v==='number'&&isFinite(v)),
     '画布缓存了 5 个有效点位（实测 px='+JSON.stringify(pxArr)+'）');
  /* 情况一：CSS 与位图同尺寸（无缩放）——老逻辑在这种情况才是对的 */
  run('$("recChart").getBoundingClientRect=function(){ return {left:0,top:0,width:560,height:150}; };');
  ok(run('chartHitIndex($("recChart"),"recChart",'+pxArr[mid].toFixed(1)+','+pyArr[mid].toFixed(1)+')')===mid,
     '不缩放时命中中间点（位图 '+pxArr[mid].toFixed(0)+','+pyArr[mid].toFixed(0)+'）');
  /* 情况二：CSS 只有位图的一半宽（width:100% 的真实情形）——修好后仍要命中 */
  run('$("recChart").getBoundingClientRect=function(){ return {left:0,top:0,width:280,height:75}; };');
  const cx2=(pxArr[mid]/2).toFixed(1), cy2=(pyArr[mid]/2).toFixed(1);
  ok(run('chartHitIndex($("recChart"),"recChart",'+cx2+','+cy2+')')===mid,
     'CSS 缩到一半宽时同样命中（鼠标 ('+cx2+','+cy2+') → 位图 ('+pxArr[mid].toFixed(0)+','+pyArr[mid].toFixed(0)+')）');
  ok(run('chartHitIndex($("recChart"),"recChart",'+cx2+','+(+cy2+45)+')')===-1,
     '离数据点够远时不吸附（不会乱弹提示框）');
  run('localStorage.removeItem("aft_records"); recChartDiff=0;');

  console.log('[41] 引爆间隔保护');
  for(const difficulty of [0,1]){
    const spacing=JSON.parse(run(`(function(){
      match.active=true;match.seed=12345;match.round=1;DAILY.active=false;
      const gapDbg=${difficulty===0?1.2:0.9};cfg.diff=${difficulty};T=100;resetStats(true);window.__trace=[];
      const seq=['vyse','reyna','phoenix','kayo','vyse','skye','yoru','breach'];
      window.__viol=[];
      const checkAll=function(){
        const L=flashes.map(function(f){return {k:f.key,b:f.a.shape==='rose'?f.bloomAt:f.t0,e:flashImpactAt(f),c:flashClearAt(f)};});
        for(let x=0;x<L.length;x++) for(let y=0;y<L.length;y++){
          if(x===y) continue;
          if(Math.abs(L[x].e-L[y].e)<gapDbg-1e-9)
            return 'S'+x+'('+L[x].k+'@'+L[x].e.toFixed(2)+') 与 S'+y+'('+L[y].k+'@'+L[y].e.toFixed(2)+')';
          if(L[x].b>=L[y].e-1e-9&&L[x].b<L[y].c-1e-9)
            return 'begin: S'+x+'('+L[x].k+' b='+L[x].b.toFixed(2)+') 落在 S'+y+'('+L[y].k+' @'+L[y].e.toFixed(2)+') 恢复窗口';
        }
        return null;
      };
      for(let i=0;i<40;i++){ spawnFlash(seq[i%seq.length],true,100+i*0.25);
        const bad=checkAll(); if(bad) window.__viol.push('第'+(i+1)+'发: '+bad); if(window.__viol.length>3) break; }
      /* 生成完再采样：玫瑰的引爆会被「后续预留」推后，spawn 当时的快照是过期的 */
      const plans=flashes.map(function(f){ return {key:f.key,
        begin:f.a.shape==='rose'?f.bloomAt:f.t0, end:flashImpactAt(f), clear:flashClearAt(f), travel:f.travel,
        duration:f.a.nearsight?f.openAt-f.launchAt:f.a.shape==='rose'?f.popAt-f.bloomAt:f.popAt-f.t0,
        expected:f.a.nearsight?f.a.spawn:f.a.shape==='rose'?f.bloomDur:f.travel*f.popFrac}; });
      window.spacingDbg=plans;
      plans.sort((a,b)=>a.end-b.end);   /* 按引爆时刻排序：相邻项才是真正要比较的一对 */
      return JSON.stringify(plans);
    })()`));
    const gap=difficulty===0?1.2:0.9;
    const viol=JSON.parse(run('JSON.stringify(window.__viol)'));
    ok(viol.length===0,'每加一发都校验不变式：全程无违例（实测 '+viol.length+' 条：'+viol.join(' / ')+'）');
    const details=run(`(function(){
      var s=JSON.parse(JSON.stringify(window.spacingDbg));var out=[];
      for(var i=1;i<s.length;i++){var d=s[i].end-s[i-1].end;
        if(d<${gap}-1e-8) out.push(s[i-1].key+'@'+s[i-1].end.toFixed(2)+' → '+s[i].key+'@'+s[i].end.toFixed(2)+' gap='+d.toFixed(2)+' begin='+s[i].begin.toFixed(2));}
      return out.join(' ｜ ');
    })()`);
    if(details) console.log('       引爆间隔违例: '+details);

    ok(spacing.every((f,i)=>!i||f.end-spacing[i-1].end>=gap-1e-8),'混合40发：引爆至少间隔 '+gap+'s');
    /* 规则③：不得在别人引爆后的恢复窗口里出手/绽放（对方已在飞行/绽放时除外） */
    const intrude=spacing.filter(a=>spacing.some(b=>b!==a&&a.begin>=b.end-1e-9&&a.begin<b.clear-1e-8));
    ok(intrude.length===0,'没有闪光在别人引爆后的恢复窗口里冒头（违例 '+intrude.length+' 例）');
    const dBad=spacing.filter(f=>Math.abs(f.duration-f.expected)>=1e-8).slice(0,4).map(f=>f.key+' dur='+f.duration.toFixed(2)+' 期望='+f.expected.toFixed(2));
    ok(dBad.length===0,'排期不改变飞行、睁眼及绽放速度'+(dBad.length?'（'+dBad.join(' / ')+'）':''));
  }
  const deterministic=run(`(function(){
    function sample(destroy,dailyMode){
      T=100;match.active=!dailyMode;DAILY.active=dailyMode;DAILY.seed=9876;
      match.seed=12345;match.round=1;cfg.diff=0;flashSeq=destroy?888:12;resetStats(true);
      const out=[];
      for(let i=0;i<12;i++){
        const f=spawnFlash(i%2?'reyna':'vyse',true,100+i*0.4);
        out.push([f.key,f.t0,f.bloomAt,flashImpactAt(f)]);
        if(destroy){f.dead=true;f.popped=true;flashes=[];Math.random();}
      }
      return JSON.stringify(out);
    }
    return sample(false,false)===sample(true,false)&&sample(false,true)===sample(true,true);
  })()`);
  ok(deterministic,'练习历史/击毁操作不同，同房间和每日挑战排期仍一致');
  run('match.active=false;DAILY.active=false;T=100;resetStats(true);spawnFlash("vyse",true);spawnFlash("reyna",true);');
  /* 账本真实字段是 t/clear；旧 begin/end 为 undefined，减 T 后 NaN 被 JSON 写成 null，
     原断言实际只比较了 null。保留这一条断言，改查有限数值和真实剩余窗口。 */
  const ledgerLeft=()=>JSON.parse(run('JSON.stringify([impactSlots.map(s=>[s.t-T,s.clear-T]),flashes.map(f=>[f.t0-T,flashImpactAt(f)-T])])'));
  const frozen=ledgerLeft();
  run('shiftTime(8);T+=8;');
  const shifted=ledgerLeft();
  ok(frozen.flat(2).every(Number.isFinite) && shifted.flat(2).every(Number.isFinite) &&
     frozen.flat(2).length===shifted.flat(2).length &&
     frozen.flat(2).every((v,i)=>Math.abs(v-shifted.flat(2)[i])<1e-8),
     '暂停统一平移排期与闪光，剩余窗口不变');
  run('T=100;resetStats(true);spawnFlash("reyna",true);spawnFlash("reyna",true);');
  ok(run('flashes[1].t0>T'),'冲突眼睛延后出手，不提前显示');
  const announced=run('st.trials');
  run('updateFlashes();');
  ok(run('st.trials')===announced,'待出手闪光不提前计入统计');
  run('T=flashes[1].t0;updateFlashes();');
  ok(run('st.trials')===announced+1,'到出手时刻只登记一次');
  run('updateFlashes();');
  ok(run('st.trials')===announced+1,'重复帧不重复登记闪光');
  run('resetStats(true);');
  ok(run('impactSlots.length===0&&flashSeq===0'),'新回合清空排期和序号');
  /* 恢复窗口必须按「那一发的最长致盲 + 转回视野」算，不是固定 1.2s：
     被布雷奇白 2.2 秒时，1.2s 里冒出来的闪光玩家根本看不见也来不及背。 */
  const recov=JSON.parse(run(`(function(){
    match.active=true;match.seed=777;match.round=1;DAILY.active=false;cfg.diff=0;T=100;resetStats(true);
    const out={};
    for(const k of ['breach','reyna','phoenix','vyse']){
      const f=spawnFlash(k,true,100);
      out[k]={impact:+flashImpactAt(f).toFixed(2),clear:+flashClearAt(f).toFixed(2),
              blindMax:f.a.dur?f.a.dur[1]:(f.a.life||0),lead:+(flashClearAt(f)-flashImpactAt(f)).toFixed(2)};
    }
    return JSON.stringify(out);
  })()`));
  ok(recov.breach.lead>=2.2,'布雷奇（正脸白 2.2s）后的恢复窗口 ≥2.2s（实测 '+recov.breach.lead+'s）');
  ok(recov.reyna.lead>=2.6,'蕾娜之眼（近视最长 2.6s）后的恢复窗口 ≥2.6s（实测 '+recov.reyna.lead+'s）');
  ok(recov.phoenix.lead>=2.0,'菲尼克斯（白 2.05s）后的恢复窗口 ≥其最长致盲（实测 '+recov.phoenix.lead+'s）');
  /* 正确的不变式（按引爆时刻配对，不是生成顺序 —— 维斯随机蓄势会让后生成的先炸）：
     任何一发的「预警开始」都不许落在另一发「引爆 → 白屏 → 转回」的整段时间里。 */
  const pairwise=JSON.parse(run(`(function(){
    match.active=true;match.seed=4242;match.round=1;DAILY.active=false;cfg.diff=1;T=100;resetStats(true);
    for(let i=0;i<60;i++) spawnFlash(['breach','reyna','vyse','kayo','yoru','phoenix','skye'][i%7],true,100+i*0.1);
    const L=flashes.map(function(g){return {k:g.key,b:g.a.shape==='rose'?g.bloomAt:g.t0,
                                            e:flashImpactAt(g),c:flashClearAt(g)};});
    var bad=null;
    for(var i=0;i<L.length&&!bad;i++) for(var j=0;j<L.length;j++){
      if(i===j) continue;
      if(L[i].b>=L[j].e-1e-9 && L[i].b<L[j].c-1e-9)
        bad=L[i].k+' 预警@'+L[i].b.toFixed(2)+' 撞上 '+L[j].k+' 恢复窗['+L[j].e.toFixed(2)+','+L[j].c.toFixed(2)+')';
    }
    return JSON.stringify({bad:bad, n:L.length});
  })()`));
  ok(pairwise.bad===null,'60 发高难密集：任何预警都不落在别人「引爆+白屏+转回」窗口内'+(pairwise.bad?'（'+pairwise.bad+'）':''));
  run('DAILY.active=false;match.active=false;flashes=[];impactSlots.length=0;playing=false;');
  /* [42] 排期锚点回归：这轮真正的根因是「蓄势时长锚在 T 而不是计划出手时刻」。
     排期是提前几十秒算好的，用当前帧 T 当锚点会把绽放算到自己出现之前
     （实测 bloomMin=3.92 而 t0=10.25），整条时间轴错乱 ——
     用户表现就是「背完维斯回正，别的闪光动画已经在脸上」。 */
  console.log('[42] 排期锚点与反应时间');
  const REACT_MIN=0.7, TURN_BACK_MIN=0.5;
  const anchor=JSON.parse(run("(function(){"
    +"match.active=true;match.seed=1847;match.round=1;DAILY.active=false;cfg.diff=1;T=100;resetStats(true);"
    +"var out=[];"
    +"for(var i=0;i<40;i++){"
    +"  var at=100+i*2.4;"
    +"  var f=spawnFlash(['vyse','phoenix','yoru','breach','kayo','skye','reyna'][i%7],true,at);"
    +"  out.push({k:f.key,launch:+f.launchAt.toFixed(3),t0:+f.t0.toFixed(3),"
    +"    b:+(f.a.shape==='rose'?f.bloomAt:f.launchAt).toFixed(3), e:+flashImpactAt(f).toFixed(3),"
    +"    min:f.bloomMin?+f.bloomMin.toFixed(3):null,"
    +"    blind:+(f.a.nearsight?(f.a.life||0):f.a.dur[1]).toFixed(2)});"
    +"}"
    +"return JSON.stringify(out);})()"));
  const beforeSelf=anchor.filter(a=>a.k==='vyse'&&a.b<a.min-1e-6);
  ok(beforeSelf.length===0,'玫瑰绽放不早于它的随机最早时刻（也不早于出手）'+(beforeSelf.length?'（'+JSON.stringify(beforeSelf[0])+'）':''));
  const preLaunch=anchor.filter(a=>a.e<a.launch-1e-6);
  ok(preLaunch.length===0,'任何闪光的引爆都不早于自己的出手时刻');
  const drifted=anchor.filter(a=>a.t0<a.launch-1e-6);
  ok(drifted.length===0,'排期不会把出手时刻挪到计划之前');
  let worst=99;
  for(const a of anchor) for(const b of anchor){
    if(a===b) continue;
    if(b.e<a.b){ const react=a.b-(b.e+b.blind+TURN_BACK_MIN); if(react<worst) worst=react; }
  }
  ok(worst>=REACT_MIN-1e-6,'40 发真实节奏排期下，玩家转回后至少还有 '+REACT_MIN+'s 看到下一发（实测 '+worst.toFixed(2)+'s）');
  run('match.active=false;flashes=[];impactSlots.length=0;');

  console.log('[43] 盖克丢丢：击毁时机与独立电浆');
  /* 直跳时钟用于精确边界；pause/混合排期另用真实 rAF step，不替换游戏逻辑。 */
  const gekkoReset=()=>run(`
    match.active=false;DAILY.active=false;cfg.auto=false;cfg.roundIdx=3;
    cfg.diff=0;cfg.mode=0;cfg.vis=0;playing=true;paused=false;roundOver=false;
    T=100;roundEndAt=0;resetStats(true);contentRnd=mulberry32(2468);
    var g=spawnFlash('gekko');
  `);
  gekkoReset();
  ok(run('g.a.shape==="dizzy" && g.a.destructible && g.hp===1'),'盖克注册为一枪可击毁的丢丢');
  /* 旧测试把扫描锚在 arriveAt，还要求到达后才锁定/开火；新反馈要求飞行中
     t0+0.25s 就锁定，普通难度 t0+0.60s 发射，不能再以旧慢节奏为期望。 */
  ok(run('g.t0<g.lockAt && g.lockAt<g.arriveAt && g.lockAt<g.fireAt && g.fireAt<g.popAt'),
     '出手 → 飞行中锁定 → 发射 → 电浆命中，锁定不等待飞抵');
  ok(run('Math.abs(g.lockAt-g.t0-0.25)<1e-8 && Math.abs(g.fireAt-g.lockAt-0.35)<1e-8 && Math.abs(g.popAt-g.fireAt-0.28)<1e-8'),
     '普通难度出手0.25s锁定、前摇0.35s、电浆飞行0.28s');
  run('cfg.agents.gekko=true;');
  ok(run('enabledAgents().includes("gekko")'),'盖克开启后进入抽签池');
  run('cfg.agents.gekko=false;');
  ok(run('!enabledAgents().includes("gekko")'),'盖克关闭后退出抽签池');
  ok(run('["gekko_throw","gekko_lock","gekko_fire","gekko_pop"].every(k=>SFX_NAMES.includes(k))'),
     '出手、锁定、发射、命中四种音效都已注册');
  /* 用户录制的素材要真的入库：放置（出手）与引爆（电浆命中）各一段。
     只断言「名字在 SFX_NAMES 里」是不够的 —— 名字早就登记了，文件没放时
     玩家听到的全是合成音（实测反馈过「怎么都变成合成音了」）。 */
  for(const n of ['gekko_throw','gekko_lock','gekko_pop']){
    const fp=path.resolve(__dirname,'..','sfx',n+'.wav');
    const size=fs.existsSync(fp)?fs.statSync(fp).size:0;
    ok(size>0 && size<=200*1024, '用户录音 sfx/'+n+'.wav 已入库且压到 200KB 内（实际 '+size+' 字节）');
  }
  ok(run('typeof THROW_SYNTH.gekko==="function" && typeof POP_SYNTH.gekko==="function"'),
     '录音缺失或加载失败时，放置音与引爆音都有合成音兜底');
  ok(run('typeof sfx.dizzyLock==="function" && typeof sfx.dizzyFire==="function"'),
     '锁定与发射保留独立入口：锁定用切分录音，缺素材时合成音兜底');

  for(const phase of ['flight','scan','lock']){
    gekkoReset();
    run(`T=${phase==='flight'?'g.t0+0.05':phase==='scan'?'g.t0+(g.lockAt-g.t0)*0.75':'g.fireAt-0.001'};updateFlashes();combo=4;`);
    ok(run(phase==='lock'?'g.locked&&!g.fired':'!g.locked&&!g.fired'),phase+' 阶段确实尚未发射');
    aim('g.pos');run('shoot();');
    ok(run('g.dead && g.popped && g.hp===0 && st.hits===1 && st.shots===1'),phase+' 一枪击毁计有效命中');
    ok(run('score===SCORE.dizzyKill && st.dodges===1 && st.by.gekko.dg===1 && combo===5 && st.best===5'),
       phase+' 发射前击毁给25分、一次成功应对、保持连击');
    ok(run('st.rtN===0 && st.rtSum===0 && reflickBase===T'),phase+' 击毁只开始回靶，不伪造转身反应');
    run('T=g.popAt+3;updateFlashes();updateFlashes();');
    ok(run('dizzyPlasmas.length===0 && dizzyBlindAmount()===0 && st.blinds===0 && flashes.length===0'),
       phase+' 击毁后越过命中时刻仍不会生成电浆或致盲');
  }
  for(const boundary of [false,true]){
    gekkoReset();
    run('T=g.lockAt;updateFlashes();combo=4;');
    if(boundary) run('T=g.fireAt;'); // 刻意不 updateFlashes：模拟两帧间点击
    else run('T=g.fireAt+0.01;updateFlashes();');
    ok(run(boundary?'!g.fired && dizzyPlasmas.length===0':'g.fired && dizzyPlasmas.length===1'),
       boundary?'恰好 fireAt 点击前尚未跑发射帧':'发射后电浆已独立入场');
    /* fireAt 时本体可能还在飞；shoot 内会刷新位置，不能再瞄准 home。 */
    aim('pathAt(g,(T-g.t0)/g.travel)');run('shoot();');
    ok(run('g.fired && g.dead && dizzyPlasmas.length===1'),
       boundary?'fireAt 边界先按时发射再击毁，不可撤销电浆':'发射后本体可击毁，电浆仍保留');
    ok(run('st.hits===1 && score===0 && st.dodges===0 && st.by.gekko.dg===0 && combo===4'),
       '发射后击毁只计命中，不白送躲闪分/连击');
    run('T=g.popAt-0.001;updateFlashes();');
    ok(run('st.blinds===0 && dizzyPlasmas.length===1'),'命中时刻之前不提前致盲');
    run('T=g.popAt;updateFlashes();');
    ok(run('st.blinds===1 && combo===0 && dizzyBlindAmount()===1 && dizzyPlasmas.length===0'),
       '本体已死仍准时蓝屏致盲，电浆仅结算一次');
    const blindEnd=run('dizzyBlindUntil');
    run('updateFlashes();updateFlashes();T+=0.1;updateFlashes();');
    ok(run('st.blinds===1 && dizzyBlindUntil')===blindEnd,'重复更新不重复结算或延长蓝屏');
  }

  console.log('[44] 盖克不能背闪、蓝屏与回靶恢复');
  gekkoReset();
  run('T=g.t0+0.1;updateFlashes();');aim('g.pos');
  run('T=g.lockAt;updateFlashes();cam.yaw+=Math.PI;T=g.fireAt;updateFlashes();T=g.popAt;updateFlashes();');
  ok(run('st.blinds===1 && st.dodges===0 && st.by.gekko.dg===0 && combo===0'),'转身180°仍被电浆命中，永远不算背闪成功');
  ok(run('g.visAt===0 && g.dodgeAt===0 && !g.lookedAtVis && st.rtN===0 && st.rtSum===0'),
     '正视再转身不登记可见/躲闪时刻，不污染转身RT');
  ok(run('blindUntil===0 && nearUntil===0 && dizzyBlindStart===g.popAt && Math.abs(dizzyBlindUntil-g.popAt-1.8)<1e-8'),
     '电浆独立蓝屏持续1.8s，不借用白屏或近视');
  ok(run('Math.abs(reflickBase-(dizzyBlindUntil-0.35*0.45))<1e-8'),'蓝屏回靶基线 = 最后0.45s淡出降到35%的可射击时刻');
  aim('targets[0]');run('shoot();');
  ok(run('st.hits===0 && st.shots===1'),'满蓝屏不能打靶');
  run('T=dizzyBlindUntil-0.45*0.36;');aim('targets[0]');run('shoot();');
  ok(run('st.hits===0'),'蓝屏36%仍吞弹');
  run('T=dizzyBlindUntil-0.45*0.34;');aim('targets[0]');run('shoot();');
  ok(run('st.hits===1 && st.rfN===1 && st.rfSum<0.01'),'蓝屏34%已可命中，回靶不多计致盲时间');
  run('T=dizzyBlindUntil;updateFlashes();');
  ok(run('dizzyBlindAmount()===0 && st.blinds===1 && flashes.length===0'),'蓝屏到期归零，本体退场且不会再结算');
  gekkoReset();run('T=g.fireAt;updateFlashes();');
  ok(run('dizzyPlasmas.length===1'),'重置测试前确有飞行中的电浆');
  run('resetStats(true);T+=5;updateFlashes();');
  ok(run('dizzyPlasmas.length===0 && dizzyBlindUntil===0 && dizzyBlindStart===0 && st.blinds===0'),
     '重置清掉在途电浆，不会跨局命中');
  gekkoReset();run('T=g.popAt;updateFlashes();');
  ok(run('dizzyBlindAmount()===1'),'重置测试前确有蓝屏');
  run('resetStats(true);');
  ok(run('dizzyBlindAmount()===0 && dizzyBlindUntil===0 && dizzyBlindStart===0 && flashes.length===0'),
     '重置清掉蓝屏状态和本体');

  console.log('[45] 盖克暂停：阶段、电浆、蓝屏的剩余时间');
  const syncFrameClock=()=>{ T=run('T')*1000;run('lastTs=T;'); };
  for(const phase of ['flight','scan','lock','plasma','blind']){
    gekkoReset();
    run(`T=${({flight:'g.t0+0.05',scan:'g.t0+(g.lockAt-g.t0)*0.75',lock:'g.lockAt+0.1',plasma:'g.fireAt+0.05',blind:'g.popAt+1.5'})[phase]};updateFlashes();`);
    syncFrameClock();
    /* 蓝屏尾声本体已经退场；shiftTime 只需平移仍在场的对象，不能检查已删除的 g。 */
    const remaining=()=>JSON.parse(run(`JSON.stringify([
      ...flashes.flatMap(f=>[f.t0-T,f.arriveAt-T,f.lockAt-T,f.fireAt-T,f.popAt-T]),
      ...dizzyPlasmas.flatMap(p=>[p.fireAt-T,p.hitAt-T]),
      ...(dizzyBlindUntil?[dizzyBlindStart-T,dizzyBlindUntil-T,reflickBase-T]:[])])`));
    const left=remaining(), frozenAmount=run('dizzyBlindAmount()'), frozenTime=run('T');
    const state=run('JSON.stringify([g.locked,g.fired,st.blinds,dizzyPlasmas.length])');
    run('pause();');step(90);
    ok(run('JSON.stringify([g.locked,g.fired,st.blinds,dizzyPlasmas.length])')===state,
       phase+' 暂停90帧不推进阶段或电浆结算');
    ok(run('dizzyRenderTime()')===frozenTime && run('dizzyBlindAmount()')===frozenAmount,
       phase+' 暂停期间动画时钟和蓝屏强度冻结');
    run('resume();');
    const after=remaining();
    ok(left.length===after.length && left.every((v,i)=>Number.isFinite(after[i])&&Math.abs(v-after[i])<1e-8),
       phase+' 恢复保持全部阶段/电浆/蓝屏/回靶剩余时间');
    step(1);
    ok(run('JSON.stringify([g.locked,g.fired,st.blinds,dizzyPlasmas.length])')===state,
       phase+' 恢复第一帧不跳阶段或重复命中');
  }

  console.log('[46] 盖克可见性与未来计划激活');
  gekkoReset();run('cfg.vis=2;T=g.t0+g.travel/2;updateFlashes();');aim('g.pos');
  /* 只包裹绘制入口计数，仍执行真实画法；不能仅凭 render 不抛错判定“看得见”。 */
  run('var originalDrawDizzy=drawDizzy, dizzyDraws=0;drawDizzy=function(...args){dizzyDraws++;return originalDrawDizzy(...args);};');
  try{
    run('drawFlashes();');
    ok(run('dizzyDraws===1'),'cfg.vis=2 隐藏普通轨迹时丢丢仍进入真实绘制');
    run('shoot();');
    ok(run('g.dead && st.dodges===1'),'cfg.vis=2 飞行中的丢丢仍可瞄准击毁');
    gekkoReset();
    run('resetStats(true);cfg.vis=2;g=spawnFlash("gekko",true,T+5);dizzyDraws=0;');
    const planned=run('g.t0');
    run('updateFlashes();');aim('g.pos');run('drawFlashes();shoot();');
    ok(run('!g.announced && st.trials===0 && !st.by.gekko && !g.audioPlayed'),'未来计划不提前统计或播出手声');
    ok(run('dizzyDraws===0 && !g.dead && g.hp===1 && dizzyPlasmas.length===0'),'未来丢丢不画、不可击毁、不生成电浆');
    ok(run('g.t0')===planned && run('g.t0===g.launchAt && g.lockAt<g.arriveAt && Math.abs(g.lockAt-g.t0-0.25)<1e-8 && Math.abs(g.fireAt-g.lockAt-0.35)<1e-8'),
       '未来计划整体平移，保持阶段顺序与出手锚点');
    run('T=g.t0;updateFlashes();updateFlashes();');aim('g.pos');run('drawFlashes();');
    ok(run('g.announced && g.audioPlayed && st.trials===1 && st.by.gekko.n===1 && dizzyDraws===1'),
       '到计划时刻才显示、播声、且只登记一次');
    run('shoot();');
    ok(run('g.dead && st.dodges===1'),'计划出手边界已经可击毁');
  }finally{ run('drawDizzy=originalDrawDizzy;'); }

  console.log('[47] 盖克与维斯混合：真实帧循环、操作无关排期');
  /* 每4秒新增计划，期间真的 shoot 击毁。保留账本对象引用而非 spawn 时快照，
     后续 reserveFlash 可能调整玫瑰的 t/clear；事件在真实 updateFlashes 之后收集。 */
  function mixedFrames(destroy,dailyMode){
    run(`T=200;cfg.auto=false;cfg.diff=${dailyMode?1:0};cfg.vis=2;cfg.roundIdx=3;
      playing=true;paused=false;roundOver=false;roundEndAt=0;
      match.active=${!dailyMode};match.seed=4731;match.round=2;
      DAILY.active=${dailyMode};DAILY.seed=7321;resetStats(true);
      var mixedSlots=[], mixedEvents=[], mixedSeen=new Set(), mixedKills=0;
      var mixedAim=function(p){cam.yaw=Math.atan2(p.x,p.z);cam.pitch=Math.atan2(p.y,Math.hypot(p.x,p.z));};
    `);
    syncFrameClock();
    let spawned=0, frames=0;
    while(frames++<6000){
      if(spawned<8 && run('T')>=200+spawned*4){
        run(`var mf=spawnFlash(${spawned<4?JSON.stringify(['gekko','vyse','phoenix','gekko'][spawned]):'gpickEl(["gekko","vyse","breach","skye"])'},true,T+0.1);
          mixedSlots.push(impactSlots.find(s=>s.f===mf));`);
        spawned++;
      }
      if(destroy) run(`for(const s of mixedSlots){const f=s.f;
        if(f.dead||f.popped||T<f.t0) continue;
        if((f.key==='gekko'&&T>=f.lockAt&&!f.fired)||(f.key==='vyse'&&T<f.bloomAt)){
          mixedAim(f.pos);shoot();if(f.dead) mixedKills++;
        }
      }`);
      step(1);
      run(`for(const s of mixedSlots){const f=s.f;
        const hit=f.key==='gekko'?dizzyBlindStart===s.t:(f.popped&&f.hp>0);
        if(hit&&!mixedSeen.has(f.id)){mixedSeen.add(f.id);mixedEvents.push({id:f.id,k:f.key,at:T,t:s.t,clear:s.clear});}
      }`);
      if(spawned===8 && run('mixedSlots.every(s=>T>s.clear+0.1)')) break;
    }
    return JSON.parse(run(`JSON.stringify({frames:${frames},kills:mixedKills,blinds:st.blinds,
      events:mixedEvents,plans:mixedSlots.map(s=>({id:s.f.id,k:s.f.key,t:s.t,clear:s.clear,
        begin:s.f.key==='vyse'?s.f.bloomAt:s.f.t0,impact:flashImpactAt(s.f),
        expectedClear:flashClearAt(s.f),home:s.f.home,pts:s.f.pts,
        phases:[s.f.arriveAt-s.f.t0,s.f.lockAt?s.f.lockAt-s.f.t0:0,
                s.f.fireAt?s.f.fireAt-s.f.lockAt:0,s.f.key==='gekko'?s.f.popAt-s.f.fireAt:0]}))})`));
  }
  for(const dailyMode of [false,true]){
    const untouched=mixedFrames(false,dailyMode), killed=mixedFrames(true,dailyMode);
    const label=dailyMode?'每日种子/困难':'房间种子/普通';
    ok(untouched.frames<6000 && killed.frames<6000 && untouched.plans.length===8,label+' 真实 step 循环跑完8发混合闪光');
    ok(killed.kills>=3 && untouched.kills===0,label+' 两次运行确实采用不同的击毁操作');
    ok(JSON.stringify(untouched.plans)===JSON.stringify(killed.plans),label+' 不同击毁下最终排期、轨迹、落点和阶段时长完全一致');
    ok(untouched.events.length===8 && new Set(untouched.events.map(e=>e.id)).size===8,
       label+' 未击毁局逐发收集8次实际命中/引爆，无遗漏或重复');
    ok(untouched.events.some(e=>e.k==='gekko') && untouched.events.some(e=>e.k==='vyse'),
       label+' 实际事件包含电浆命中和维斯引爆');
    ok(killed.events.length===8-killed.kills,label+' 发射前击毁恰好取消对应事件');
    ok(untouched.events.concat(killed.events).every(e=>e.at>=e.t-1e-8 && e.at-e.t<0.0168),
       label+' 实际事件发生在更新后的账本时刻首帧内（非过期生成快照）');
    ok(untouched.plans.every(s=>Math.abs(s.t-s.impact)<1e-8 && Math.abs(s.clear-s.expectedClear)<1e-8),
       label+' 账本 t/clear 与最终本体排期一致');
    const sorted=[...untouched.plans].sort((a,b)=>a.t-b.t);
    ok(sorted.every((s,i)=>!i||s.t-sorted[i-1].t>=(dailyMode?0.9:1.2)-1e-8),label+' 真实帧循环满足引爆最小间隔');
    ok(sorted.every((s,i)=>!i||s.begin>=sorted[i-1].clear+0.7-1e-8),label+' 后一发预警在恢复窗口+0.7s反应余量之后');
    const gs=sorted.filter(s=>s.k==='gekko');
    ok(gs.length>=2 && gs.every(s=>Math.abs(s.clear-s.t-2.3)<1e-8),label+' 盖克恢复界限包含1.8s蓝屏+0.5s转回');
    ok(gs.every(s=>Math.abs(s.phases[3]-0.28)<1e-8 &&
       Math.abs(s.phases[1]-0.25)<1e-8 &&
       Math.abs(s.phases[2]-0.35*run('DIFF[cfg.diff].speed/1.35'))<1e-8),
       label+' 排期保持出手后0.25s锁定、难度缩放前摇与固定电浆飞行');
  }
  run('match.active=false;DAILY.active=false;cfg.auto=false;resetStats(true);playing=false;');

  console.log('[48] 丢丢直线匀速、飞行中锁定与发射原点');
  for(const diff of [0,1]){
    const label=diff?'困难':'普通';
    gekkoReset();run(`resetStats(true);cfg.diff=${diff};contentRnd=mulberry32(2468);g=spawnFlash('gekko');`);
    ok(run('AGENTS.gekko.travel===0.55 && g.travel>=0.55*DIFF[cfg.diff].speed*0.92 && g.travel<=0.55*DIFF[cfg.diff].speed*1.10'),
       label+' 飞行基准0.55s，仅乘难度和既有随机抖动');
    ok(run('Math.abs(g.lockAt-g.t0-0.25)<1e-8 && Math.abs(g.fireAt-g.lockAt-0.35*DIFF[cfg.diff].speed/1.35)<1e-8 && g.fireAt-g.t0<=0.60+1e-8 && g.fireAt<g.arriveAt'),
       label+' 0.25s锁定，不等飞抵，普通最多0.60s已发射');
    const samples=JSON.parse(run(`JSON.stringify(Array.from({length:41},(_,i)=>{
      const u=i/40, p=pathAt(g,u), a=g.pts[1], b=g.home;
      return {p,expected:{x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u,z:a.z+(b.z-a.z)*u}};
    }))`));
    ok(samples.every(s=>['x','y','z'].every(k=>Math.abs(s.p[k]-s.expected[k])<1e-10)),
       label+' 41个采样逐轴等于起点到home的线性插值，无弧线/样条拐弯');
    ok(samples.slice(1).every((s,i)=>['x','y','z'].every(k=>Math.abs((s.p[k]-samples[i].p[k])-(samples[1].p[k]-samples[0].p[k]))<1e-10)),
       label+' 等时间步长位移相等，无缓入缓出或中途加速');
    ok(run('JSON.stringify(pathAt(g,-0.1))===JSON.stringify(g.pts[1]) && ["x","y","z"].every(k=>Math.abs(pathAt(g,1.1)[k]-g.home[k])<1e-10)'),
       label+' 飞行前后夹在起点和home，不外推');
    run('T=g.lockAt-0.001;updateFlashes();');
    ok(run('!g.locked && !g.fired'),'锁定边界前不提前锁定 '+label);
    run('T=g.lockAt;updateFlashes();');
    ok(run('g.locked && !g.fired && T<g.arriveAt'),'锁定边界即在飞行中锁定 '+label);
    run('T=g.fireAt-0.001;updateFlashes();');
    ok(run('!g.fired && dizzyPlasmas.length===0'),'发射边界前没有电浆 '+label);
    /* 故意迟一帧：电浆原点须用计划fireAt的位置，而非当前帧位置或home。 */
    run('T=g.fireAt+0.02;updateFlashes();');
    ok(run('dizzyPlasmas.length===1 && ["x","y","z"].every(k=>Math.abs(dizzyPlasmas[0].from[k]-pathAt(g,(g.fireAt-g.t0)/g.travel)[k])<1e-10)'),
       label+' 掉帧后电浆仍从计划发射时的飞行位置出发');
    ok(run('Math.hypot(...["x","y","z"].map(k=>dizzyPlasmas[0].from[k]-g.home[k]))>0.01 && Math.hypot(...["x","y","z"].map(k=>dizzyPlasmas[0].from[k]-g.pos[k]))>0.01'),
       label+' 原点既不是home，也不是延迟更新后的本体位置');
    run('var plasmaOrigin=JSON.stringify(dizzyPlasmas[0].from);g.home.x+=10;g.pos.x+=10;updateFlashes();');
    ok(run('dizzyPlasmas.length===1 && JSON.stringify(dizzyPlasmas[0].from)===plasmaOrigin'),label+' 电浆原点为独立快照，不随本体修改');
    run('resetStats(true);spawnFlash("breach",true,T+5);var plannedDizzyAt=T+5;g=spawnFlash("gekko",true,plannedDizzyAt);');
    ok(run('g.t0>plannedDizzyAt && Math.abs(g.lockAt-g.t0-0.25)<1e-8 && Math.abs(g.fireAt-g.lockAt-0.35*DIFF[cfg.diff].speed/1.35)<1e-8 && Math.abs(g.popAt-g.fireAt-0.28)<1e-8 && Math.abs(g.arriveAt-g.t0-g.travel)<1e-8'),
       label+' 真实排期冲突整体后移，保留新锁定/前摇/飞行/电浆时长');
  }

  console.log('[49] 丢丢录音切分：WAV头、逐样本内容、时长');
  /* _sfx_split 是本地原始素材，不随仓库部署；固定原始PCM哈希使CI也能
     校验逐样本无损拼回。原件存在时另直接比较字节，不跳过任何断言。 */
  const pcmHash=b=>require('crypto').createHash('sha256').update(b).digest('hex');
  function readWav(fp){
    const b=fs.readFileSync(fp);let fmt=null,data=null;
    if(b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WAVE'||b.readUInt32LE(4)!==b.length-8) throw new Error('无效WAV头 '+fp);
    for(let at=12;at+8<=b.length;){
      const size=b.readUInt32LE(at+4),end=at+8+size;
      if(end>b.length) throw new Error('WAV块越界 '+fp);
      const id=b.toString('ascii',at,at+4);
      if(id==='fmt ') fmt=b.subarray(at+8,end);
      if(id==='data') data=b.subarray(at+8,end);
      at=end+(size%2);
    }
    if(!fmt||fmt.length<16||!data) throw new Error('WAV缺少fmt/data '+fp);
    return {b,fmt,data};
  }
  const wavs={};
  for(const name of ['gekko_throw','gekko_lock','gekko_pop']){
    try{ wavs[name]=readWav(path.resolve(__dirname,'..','sfx',name+'.wav')); }
    catch(e){ console.log(e.message); }
    const w=wavs[name];
    ok(!!w && w.fmt.readUInt16LE(0)===1 && w.fmt.readUInt16LE(2)===1 && w.fmt.readUInt32LE(4)===44100 && w.fmt.readUInt32LE(8)===88200 && w.fmt.readUInt16LE(12)===2 && w.fmt.readUInt16LE(14)===16 && w.data.length%2===0,
       name+' WAV头有效，保持原录音44.1kHz/16bit/单声道PCM格式');
  }
  const throwPCM=wavs.gekko_throw?.data,lockPCM=wavs.gekko_lock?.data,popPCM=wavs.gekko_pop?.data;
  ok(throwPCM?.length===11025*2,'出手音恰好11025样本 = 0.25s');
  ok(lockPCM?.length===77616*2,'锁定音保留余下77616样本 = 1.76s');
  ok(popPCM?.length===31750*2,'命中音保留原始31750样本，时长不变');
  const joined=throwPCM&&lockPCM?Buffer.concat([throwPCM,lockPCM]):null;
  ok(!!joined && pcmHash(joined)==='b15408ef354d5539ca7582c1bdaef453ad076b2a7430465b384bb7f32700cb3f',
     '出手+锁定逐样本无损拼回原录音，无重采样、间隙、重叠或淡变');
  ok(!!popPCM && pcmHash(popPCM)==='33a3a10abbeaa921c592dab62bf47e51ac012d97cbc702028bb57ce8297ddacd' && pcmHash(wavs.gekko_pop.b)==='79c2d7bdee221700736e119e1317095d60fe03f64a80d72cf64dec6e2bd1b734',
     '命中录音PCM与完整WAV均逐字节保持原样');
  const originalPath=path.resolve(__dirname,'_sfx_split','gekko_throw.wav');
  const original=fs.existsSync(originalPath)?readWav(originalPath).data:joined;
  ok(!!original && !!throwPCM && !!lockPCM && original.subarray(0,11025*2).equals(throwPCM) && original.subarray(11025*2).equals(lockPCM),
     '切分点精确落在原录音第11025样本，前缀用于出手、后缀用于锁定');

  console.log('[50] 丢丢声音路由与弱拖尾');
  gekkoReset();
  run(`var savedDizzyAudio={playFile,tone,noise,sound:cfg.sound,buf:{...sfxBuf}};
    var dizzyAudioEvents=[];cfg.sound=true;
    for(const k of Object.keys(sfxBuf)) delete sfxBuf[k];
    playFile=function(name){if(!sfxBuf[name]) return false;dizzyAudioEvents.push([name,T]);return true;};
    tone=function(){dizzyAudioEvents.push(['tone',T]);};noise=function(){dizzyAudioEvents.push(['noise',T]);};
    sfxBuf.gekko_throw={};sfxBuf.gekko_lock={};sfxBuf.gekko_pop={};`);
  try{
    run('T=g.t0;updateFlashes();updateFlashes();');
    ok(run('JSON.stringify(dizzyAudioEvents.map(e=>e[0]))===JSON.stringify(["gekko_throw"])'),'出手帧仅播一次前0.25s录音');
    run('T=g.lockAt-0.001;updateFlashes();');
    ok(run('dizzyAudioEvents.length===1'),'锁定前不提前播后段录音');
    run('T=g.lockAt;updateFlashes();updateFlashes();');
    ok(run('dizzyAudioEvents.length===2 && dizzyAudioEvents[1][0]==="gekko_lock" && Math.abs(dizzyAudioEvents[1][1]-g.t0-0.25)<1e-8'),
       '锁定边界0.25s仅播一次后段录音');
    run('T=g.fireAt;updateFlashes();updateFlashes();');
    ok(run('dizzyAudioEvents.length===2'),'锁定录音已含发射声，不叠播发射合成音');
    run('T=g.popAt;updateFlashes();updateFlashes();');
    ok(run('JSON.stringify(dizzyAudioEvents.map(e=>e[0]))===JSON.stringify(["gekko_throw","gekko_lock","gekko_pop"])'),'命中仅播一次原始pop录音，全程无合成音混入');
    run('delete sfxBuf.gekko_lock;dizzyAudioEvents=[];sfx.dizzyLock();sfx.dizzyFire();');
    ok(run('dizzyAudioEvents.filter(e=>e[0]==="tone").length===3 && dizzyAudioEvents.filter(e=>e[0]==="noise").length===1'),
       '锁定素材缺失时，锁定/发射合成音各自兜底');
    run('sfxBuf.gekko_fire={};dizzyAudioEvents=[];sfx.dizzyFire();');
    ok(run('dizzyAudioEvents.length===1 && dizzyAudioEvents[0][0]==="gekko_fire"'),'没有锁定素材时仍支持独立发射文件');
  }finally{
    run('playFile=savedDizzyAudio.playFile;tone=savedDizzyAudio.tone;noise=savedDizzyAudio.noise;cfg.sound=savedDizzyAudio.sound;for(const k of Object.keys(sfxBuf)) delete sfxBuf[k];Object.assign(sfxBuf,savedDizzyAudio.buf);');
  }
  gekkoReset();run('T=g.t0+0.2;updateFlashes();');aim('g.pos');
  const oldTrailArc=ctxStub.arc, trailArcs=[];
  run('var savedTrailDizzy=drawDizzy;drawDizzy=function(){};g.trail=[0,0.09,0.181].map(age=>({...g.pos,t:T-age}));');
  ctxStub.arc=(x,y,r)=>trailArcs.push({r,alpha:ctxStub.globalAlpha});
  try{
    run('drawFlashes();');
    ok(trailArcs.length===2,'丢丢拖尾寿命0.18s，超过0.18s的点不再绘制');
    ok(trailArcs.length===2 && Math.abs(trailArcs[0].alpha-0.5*0.16)<1e-10 && Math.abs(trailArcs[1].alpha-0.5*0.25*0.16)<1e-10,
       '丢丢拖尾强度乘0.16，半寿命按平方衰减');
    const rr=run('Math.max(2.5,F*0.13/toCam(g.pos).z)');
    ok(trailArcs.length===2 && Math.abs(trailArcs[0].r-rr*0.62*0.16)<1e-10 && Math.abs(trailArcs[1].r-rr*0.36*0.16)<1e-10,
       '丢丢拖尾半径也乘0.16，避免留下一串大亮点');
  }finally{ctxStub.arc=oldTrailArc;run('drawDizzy=savedTrailDizzy;');}
  run('match.active=false;DAILY.active=false;cfg.auto=false;resetStats(true);playing=false;');

  console.log('[51] 丢丢录音句柄：真实播放链路、按本体清理与独立命中');
  gekkoReset();
  /* 只替换 WebAudio 边界，不替换 playFile/snd/sfx 或游戏逻辑。
     stop 不同步触发 ended（浏览器异步派发）；自然结束由测试显式派发。 */
  run(`var savedOwnedAudio={audio,bus,sound:cfg.sound,buf:{...sfxBuf}};
    var ownedSources=[], ownedGains=[];
    audio=function(){return {
      createBufferSource(){
        const src={buffer:null,onended:null,starts:0,stops:0,disconnects:0,
          connect(dest){this.dest=dest;},
          start(){this.starts++;this.startedAt=T;},
          stop(){this.stops++;if(this.stops>1) throw new Error('重复 stop');},
          disconnect(){this.disconnects++;},
          end(){if(this.onended) this.onended();}
        };
        ownedSources.push(src);return src;
      },
      createGain(){const gain={gain:{value:0},connect(dest){this.dest=dest;}};
        ownedGains.push(gain);return gain;}
    };};
    cfg.sound=true;
    for(const k of Object.keys(sfxBuf)) delete sfxBuf[k];
    for(const k of SFX_NAMES) sfxBuf[k]={name:k};
    var ownedNamed=name=>ownedSources.filter(s=>s.buffer.name===name);
    var ownedStopped=s=>s.stops===1 && s.disconnects===1 && s.onended===null;
  `);
  try{
    run('var startedHandles=[];var playResult=playFile("gekko_lock",0.7,src=>startedHandles.push(src));');
    ok(run('playResult===true && startedHandles.length===1 && startedHandles[0]===ownedSources[0] && startedHandles[0].starts===1'),
       'playFile 保留 boolean true，回调只收到一次已启动的真实句柄');
    ok(run('ownedSources[0].buffer===sfxBuf.gekko_lock && ownedSources[0].dest.gain.value===0.7'),
       '句柄使用预解码缓存并保留音量路由');
    ok(run('playFile("gekko_throw",0.9)===true'),'不传回调的旧 playFile 调用仍返回 true');
    ok(run('playFile("missing-owned-test",1,src=>startedHandles.push(src))===false && startedHandles.length===1'),
       '缺素材返回 false，不回调或伪造句柄');
    run('var ownedAudioImpl=audio;audio=()=>null;');
    ok(run('playFile("gekko_lock",1,src=>startedHandles.push(src))===false && startedHandles.length===1'),
       '无 AudioContext 返回 false，不回调');
    run('audio=ownedAudioImpl;var genericHandles=[];snd("missing-owned-test","throw",0.4,()=>{throw new Error("不应合成");},"flash",src=>genericHandles.push(src));');
    ok(run('genericHandles.length===1 && genericHandles[0].buffer===sfxBuf.throw && genericHandles[0].starts===1'),
       'snd 通用文件回退也转发 onStart');
    run('cfg.sound=false;sfx.dizzyLock(src=>startedHandles.push(src));cfg.sound=true;');
    ok(run('startedHandles.length===1'),'静音不调用句柄回调');

    gekkoReset();run('ownedSources=[];T=g.lockAt;updateFlashes();updateFlashes();var preHandles=g.audioSources.slice();');
    ok(run('g.locked && !g.fired && preHandles.length===2 && preHandles[0].buffer.name==="gekko_throw" && preHandles[1].buffer.name==="gekko_lock" && preHandles.every(s=>s.starts===1)'),
       '真实出手/锁定链路登记两只句柄，重复帧不重播');
    /* 第二只本体保留自己的录音；排期可把它推到未来，不依赖随机重叠。 */
    run('var otherBody=spawnFlash("gekko",true,T+5);sfx.dizzyLock(src=>trackDizzySound(otherBody,src));var otherHandle=otherBody.audioSources[0];');
    aim('g.pos');run('shoot();');
    ok(run('g.dead && !g.fired && g.audioSources.length===0 && preHandles.every(ownedStopped)'),
       '锁定前摇击毁停止并断开该本体全部录音，清空所有权');
    ok(run('otherBody.audioSources.length===1 && otherBody.audioSources[0]===otherHandle && otherHandle.stops===0 && otherHandle.disconnects===0'),
       '击毁一只不停止另一只本体的录音');
    run('T=g.popAt+0.1;updateFlashes();updateFlashes();stopDizzySounds(g);stopDizzySounds(g);');
    ok(run('dizzyPlasmas.length===0 && st.blinds===0 && dizzyBlindAmount()===0 && ownedNamed("gekko_pop").length===0'),
       '前摇击毁越过原命中时刻，无电浆、蓝屏或命中录音');
    ok(run('preHandles.every(ownedStopped) && otherHandle.stops===0'),
       '击毁后的重复清理安全，不重复 stop/disconnect 或波及别的本体');

    gekkoReset();run('ownedSources=[];T=g.fireAt+0.01;updateFlashes();var postHandles=g.audioSources.slice();var livePlasma=dizzyPlasmas[0];');
    ok(run('g.fired && !g.dead && postHandles.length===2 && postHandles.every(s=>s.stops===0) && dizzyPlasmas.length===1'),
       '发射后、命中前锁定录音仍在播放，电浆已独立存在');
    aim('g.pos');run('shoot();');
    /* 用户的规则：只要电浆已经射出，就必须有声音。录音后段本身就含发射声，
       所以发射后击毁**不能**掐掉它（旧断言写反了，实测被报「打慢一步就没声音」）。 */
    ok(run('g.dead && g.fired && postHandles.every(s=>s.stops===0) && g.audioSources.length===2'),
       '发射后击毁不切断本体录音：电浆已射出就必须听得见');
    ok(run('dizzyPlasmas.length===1 && dizzyPlasmas[0]===livePlasma && st.dodges===0 && score===0'),
       '停止声音不撤销已发射电浆，也不送躲闪分');
    run('T=g.popAt-0.001;updateFlashes();');
    ok(run('st.blinds===0 && ownedNamed("gekko_pop").length===0 && dizzyPlasmas.length===1'),
       '击毁后独立电浆不提前命中或播命中音');
    run('T=g.popAt;updateFlashes();var postBlindEnd=dizzyBlindUntil;');
    ok(run('st.blinds===1 && dizzyBlindAmount()===1 && dizzyPlasmas.length===0 && ownedNamed("gekko_pop").length===1'),
       '击毁后独立电浆准时结算一次，命中录音只启动一次');
    /* 本体已被击毁 → updateDizzy 不会再跑，所以命中时也不会去切它的录音：
       那段录音就让它自然播完（含发射声），这正是用户要的。 */
    run('updateFlashes();T+=0.1;updateFlashes();');
    ok(run('st.blinds===1 && dizzyBlindUntil===postBlindEnd && ownedNamed("gekko_pop").length===1 && ownedNamed("gekko_pop")[0].stops===0 && postHandles.every(s=>s.stops===0)'),
       '重复更新不重复命中、不延长蓝屏；已击毁本体的录音也不被命中流程切断');
    run('for(const s of g.audioSources.slice()) s.end();');
    ok(run('g.audioSources.length===0 && postHandles.every(s=>s.stops===0 && s.disconnects===0)'),
       '录音自然播完即自行摘除句柄，不需要额外强制停止');

    gekkoReset();run('ownedSources=[];T=g.lockAt;updateFlashes();var impactHandles=g.audioSources.slice();T=g.popAt-0.001;updateFlashes();');
    ok(run('impactHandles.length===2 && impactHandles.every(s=>s.stops===0)'),
       '未击毁本体的录音在真实命中前不会被提前切断');
    run('T=g.popAt;updateFlashes();updateFlashes();');
    /* 用户规则：电浆射出后音频必须播完。这段录音后半就是发射声，
       命中时刻只叠加一次独立命中音，不去切断它（旧断言要求「命中即切断」，写反了）。 */
    ok(run('!g.dead && st.blinds===1 && impactHandles.every(s=>s.stops===0) && g.audioSources.length===2'),
       '真实命中不禁音：发射声自然播完，只叠加一次独立命中音');
    ok(run('ownedNamed("gekko_pop").length===1 && ownedNamed("gekko_pop")[0].stops===0'),
       '自然命中只播一次独立 pop，不被本体清理误停');
    run('resetStats(true);');
    ok(run('impactHandles.every(s=>s.stops===1 && s.disconnects===1)'),
       '重开训练统一收掉仍在播的录音，且每只只停一次');

    gekkoReset();run('ownedSources=[];T=g.lockAt;updateFlashes();var endedThrow=g.audioSources[0], survivingLock=g.audioSources[1];endedThrow.end();');
    ok(run('g.audioSources.length===1 && g.audioSources[0]===survivingLock && endedThrow.stops===0 && survivingLock.stops===0'),
       '自然 onended 只移除已结束句柄，保留同本体其他录音');
    run('endedThrow.end();');
    ok(run('g.audioSources.length===1 && g.audioSources[0]===survivingLock'),
       '重复 ended 不误删仍在播放的锁定录音');
    run('survivingLock.end();stopDizzySounds(g);stopDizzySounds(g);');
    ok(run('g.audioSources.length===0 && endedThrow.stops===0 && survivingLock.stops===0'),
       '全部自然结束后清理安全，不再 stop 已移除的句柄');

    /* 发射后击毁的真 bug：本体已从 flashes 移除、updateDizzy 不再跑，
       录音句柄只挂在它身上 → 重开训练时原来收不到，会跨局继续响。
       现在重开要顺着「还在飞的电浆」把它的本体录音一并收掉。 */
    gekkoReset();
    run('ownedSources=[];T=g.fireAt+0.01;updateFlashes();var killedBodyHandles=g.audioSources.slice();');
    aim('g.pos');run('shoot();T+=0.02;updateFlashes();');
    ok(run('g.dead && flashes.every(f=>f!==g) && killedBodyHandles.length===2 && killedBodyHandles.every(s=>s.stops===0) && dizzyPlasmas.length===1'),
       '发射后击毁：本体已退场，但录音仍在播、电浆仍在飞');
    run('resetStats(true);resetStats(true);');
    ok(run('killedBodyHandles.every(s=>s.stops===1 && s.disconnects===1)'),
       '重开训练顺着飞行中的电浆收掉已击毁本体的录音（否则跨局继续响）');

    for(const phase of ['lock','plasma']){
      gekkoReset();run(`ownedSources=[];T=${phase==='lock'?'g.lockAt':'g.fireAt+0.01'};updateFlashes();var resetHandles=g.audioSources.slice();`);
      ok(run('!g.dead && resetHandles.length===2 && resetHandles.every(s=>s.stops===0)'),phase+' 重开前确有存活本体与录音');
      run('resetStats(true);resetStats(true);stopDizzySounds(g);T+=5;updateFlashes();');
      ok(run('resetHandles.every(ownedStopped) && g.audioSources.length===0 && flashes.length===0'),
         phase+' 重置停止并断开存活本体录音，重复重置安全');
      ok(run('dizzyPlasmas.length===0 && st.blinds===0 && ownedNamed("gekko_pop").length===0'),
         phase+' 重置后不会跨局生成电浆或命中音');
    }
  }finally{
    run('resetStats(true);audio=savedOwnedAudio.audio;bus=savedOwnedAudio.bus;cfg.sound=savedOwnedAudio.sound;for(const k of Object.keys(sfxBuf)) delete sfxBuf[k];Object.assign(sfxBuf,savedOwnedAudio.buf);');
  }

  console.log('[52] 丢丢蓝幕：缓存复用与暂停绘制时钟');
  const oldBlindDrawImage=ctxStub.drawImage, blindDrawCalls=[];
  run('var savedBlindArtTest={art:dizzyBlindArt,T,paused,pauseT,W,H};dizzyBlindArt=null;paused=false;T=100;');
  ctxStub.drawImage=(...args)=>blindDrawCalls.push(args);
  try{
    run('drawDizzyBlind(1);var firstBlindArt=dizzyBlindArt;');
    ok(run('!!firstBlindArt && firstBlindArt.w===W && firstBlindArt.h===H') && blindDrawCalls.length===1,
       '首次蓝幕绘制生成并使用缓存画布');
    run('T+=0.1;drawDizzyBlind(1);');
    ok(run('dizzyBlindArt===firstBlindArt') && blindDrawCalls[0][0]===blindDrawCalls[1][0],
       '连续流纹逐帧复用同一缓存画布，不每帧重烘');
    ok(JSON.stringify(blindDrawCalls[0].slice(1))!==JSON.stringify(blindDrawCalls[1].slice(1)),
       '未暂停时蓝幕绘制随游戏时钟变化');
    run('paused=true;pauseT=T;drawDizzyBlind(1);T+=2;drawDizzyBlind(1);');
    ok(JSON.stringify(blindDrawCalls[2].slice(1))===JSON.stringify(blindDrawCalls[3].slice(1)),
       '暂停时即使帧时钟前进，蓝幕实际 drawImage 坐标保持冻结');
    run('W+=1;drawDizzyBlind(1);');
    ok(run('dizzyBlindArt!==firstBlindArt && dizzyBlindArt.w===W') && blindDrawCalls[4][0]!==blindDrawCalls[0][0],
       '视口尺寸改变才重建蓝幕缓存');
  }finally{
    ctxStub.drawImage=oldBlindDrawImage;
    run('dizzyBlindArt=savedBlindArtTest.art;T=savedBlindArtTest.T;paused=savedBlindArtTest.paused;pauseT=savedBlindArtTest.pauseT;W=savedBlindArtTest.W;H=savedBlindArtTest.H;');
  }
  run('match.active=false;DAILY.active=false;cfg.auto=false;resetStats(true);playing=false;');

  console.log('\n'+(fails?('有 '+fails+' 项失败'):'全部通过')+'（'+assertions+' 条断言）');
  process.exit(fails?1:0);
  })().catch(e=>{ console.log('运行时异常: '+e.message); console.log(e.stack.split('\n').slice(0,6).join('\n')); process.exit(1); });
}catch(e){
  console.log('运行时异常: '+e.message);
  console.log(e.stack.split('\n').slice(0,6).join('\n'));
  process.exit(1);
}
