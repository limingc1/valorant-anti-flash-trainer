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
    get innerHTML(){return ''},
    set innerHTML(v){ if(v==='') this.children.length=0; },
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
  Audio: function(){ return el('audio'); }
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

  console.log('[13] 侧栏隐藏');
  ok(run('$("side").classList.contains("hide")')===false,'默认显示数据栏');
  run('toggleSide()');
  ok(run('$("side").classList.contains("hide")')===true,'可隐藏');
  ok(run('$("bSide").textContent')==='◂','按钮图标随之切换');
  run('toggleSide()');
  ok(run('$("side").classList.contains("hide")')===false,'再按恢复显示');

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
    ys.push(run('flashes[0].pts[4].y'));
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
    if(run('flashVisible(flashes[0].pts[4])')) v++;
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

  console.log('\n'+(fails?('有 '+fails+' 项失败'):'全部通过'));
  process.exit(fails?1:0);
}catch(e){
  console.log('运行时异常: '+e.message);
  console.log(e.stack.split('\n').slice(0,6).join('\n'));
  process.exit(1);
}
