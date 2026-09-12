/* 冒烟测试：在最小 DOM 桩环境里跑真实游戏脚本，验证关键行为 */
const fs=require('fs'), vm=require('vm'), path=require('path');
const file=path.resolve(__dirname,'..','valorant-anti-flash-trainer.html');
const html=fs.readFileSync(file,'utf8');
const m=html.match(/<script>([\s\S]*?)<\/script>/);
if(!m){ console.log('FAIL: 找不到 script 块'); process.exit(1); }
const code=m[1];

let fails=0;
const ok=(c,msg)=>{ console.log((c?'  OK   ':'  FAIL ')+msg); if(!c) fails++; };

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

  console.log('[10] 六特工全开 + 9 靶点长跑');
  run('cfg.targetN=9;fillTargets();cfg.agents.kayo=true;cfg.agents.yoru=true;');
  for(const k of ['phoenix','skye','breach','kayo','yoru','reyna']) run('spawnFlash("'+k+'")');
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
  ok(left0>29 && left0<=30,'倒计时设为 30s（'+left0.toFixed(2)+'s）');
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

  console.log('\n'+(fails?('有 '+fails+' 项失败'):'全部通过'));
  process.exit(fails?1:0);
}catch(e){
  console.log('运行时异常: '+e.message);
  console.log(e.stack.split('\n').slice(0,6).join('\n'));
  process.exit(1);
}
