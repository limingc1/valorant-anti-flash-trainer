/* 后端接口测试：用内存假 KV 把 functions/api/room.js 的完整对局生命周期跑一遍。
 * 跑法：node .workbuddy/api-test.mjs
 * 重点验证两件事：
 *   1. 大厅流程正确（加入会被房主看见、双方 ready 才定 startAt、再战会清状态）
 *   2. KV 写次数受控 —— 免费额度只有 1000 写/天，一局不能烧掉几十次
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* functions/api/room.js 是 ESM，但仓库没有 package.json（smoke-test.js 走 CJS），
   Node 会把 .js 当 CJS 解析。所以复制成临时 .mjs 再动态 import。 */
const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '..', 'functions', 'api', 'room.js');
const tmp = path.join(here, '_api_under_test.mjs');
fs.writeFileSync(tmp, fs.readFileSync(src, 'utf8'));
const cleanup = () => { try { fs.unlinkSync(tmp); } catch (e) {} };
process.on('exit', cleanup);
const { onRequestGet, onRequestPost } = await import('./_api_under_test.mjs');

let fails = 0;
const ok = (c, msg) => { console.log((c ? '  OK   ' : '  FAIL ') + msg); if (!c) fails++; };

/* 假 KV：顺带统计读写次数，用来给免费额度把关 */
const store = new Map();
let reads = 0, writes = 0;
const env = {
  ROOMS: {
    async get(k) { reads++; return store.has(k) ? store.get(k) : null; },
    async put(k, v) { writes++; store.set(k, v); }
  }
};
const CODE = 'ABCDEF';
const post = async body => (await onRequestPost({
  request: new Request('http://x/api/room', { method: 'POST', body: JSON.stringify(body) }), env
})).json();
const get = async (code = CODE) => (await onRequestGet({
  request: new Request('http://x/api/room?code=' + code), env
})).json();
const statusOf = async body => (await onRequestPost({
  request: new Request('http://x/api/room', { method: 'POST', body: JSON.stringify(body) }), env
})).status;

console.log('[A] 建房与加入');
let r = await post({ code: CODE, who: 'host', name: '房主', cfg: { agents: { phoenix: true }, diff: 1, mode: 0, vis: 0, roundIdx: 1, rate: 0.8, targetN: 5 } });
ok(r.ok === true, '建房成功');
ok(r.players.length === 1 && r.players[0].name === '房主', '房主被登记为第一个玩家');
ok(r.cfg && r.cfg.diff === 1 && r.cfg.rate === 0.8, '公平设置已存云端（加入者会套用）');

r = await post({ code: CODE, who: 'join', name: '朋友' });
ok(r.players.length === 2, '加入后房间有两人 —— 房主的大厅能看到对手（v1 的核心 bug）');
const wAfterJoinTwice = writes;
await post({ code: CODE, who: 'join', name: '朋友' });
ok(writes === wAfterJoinTwice, '重复加入不再写 KV（幂等，省写额度）');

console.log('[B] 准备与开局时刻');
r = await post({ code: CODE, who: 'ready', name: '房主', ready: true });
ok(r.startAt === 0, '只有一方准备时不定开局时刻');
r = await post({ code: CODE, who: 'ready', name: '朋友', ready: true });
ok(r.startAt > 0, '双方都准备 → 服务端定下 startAt');
ok(typeof r.now === 'number' && r.startAt - r.now > 1000, '响应带 now，startAt-now 是倒计时剩余（绕开时钟偏差）');
const startAt1 = r.startAt;
r = await post({ code: CODE, who: 'ready', name: '朋友', ready: true });
ok(r.startAt === startAt1, '重复 ready 不会把开局时刻往后推');
r = await post({ code: CODE, who: 'ready', name: '朋友', ready: false });
ok(r.startAt === 0, '有人取消准备 → 开局时刻撤销');
r = await post({ code: CODE, who: 'ready', name: '朋友', ready: true });
ok(r.startAt > 0, '重新准备 → 重新定开局时刻');

console.log('[C] 交卷与判定');
await post({ code: CODE, who: 'score', name: '房主', score: 4200, detail: { dodge: '80%', acc: '70%', best: 9, blind: 2 } });
r = await post({ code: CODE, who: 'score', name: '朋友', score: 5000, detail: { dodge: '90%', acc: '65%', best: 12, blind: 1 } });
const scored = r.players.filter(p => p.score != null);
ok(scored.length === 2, '两份成绩都在（前端据此判胜负）');
ok(r.players.find(p => p.name === '朋友').score === 5000, '分数按昵称对上号');
r = await post({ code: CODE, who: 'score', name: '房主', score: 9999, detail: {} });
ok(r.players.filter(p => p.name === '房主').length === 1, '同名再交卷是原位更新，不会多出一条');

console.log('[D] 再战与清理');
r = await post({ code: CODE, who: 'again', name: '房主' });
ok(r.round === 2, '再战 round+1（前端据此换种子，重赛不再是同一串闪光）');
ok(r.players.every(p => !p.ready && p.score == null), '再战清掉双方准备与分数');
ok(r.startAt === 0, '再战回到未开局状态');

console.log('[E] 边界与校验');
ok(await statusOf({ code: 'abc', who: 'join', name: 'x' }) === 400, '非法房码 400');
ok(await statusOf({ code: CODE, who: 'join', name: '第三人' }) === 403, '第三人加入被拒（上限 2）');
ok(await statusOf({ code: CODE, who: '乱写', name: 'x' }) === 400, '未知 who 400');
ok((await get('ZZZZZZ')).error != null, '不存在的房间返回错误');
const noKv = await onRequestGet({ request: new Request('http://x/api/room?code=' + CODE), env: {} });
ok(noKv.status === 503, '未绑定 KV 时 503（前端据此降级离线）');
r = await post({ code: 'BBBBBB', who: 'join', name: '<img src=x>坏名字' });
ok(r.players.every(p => p.name.indexOf('<') < 0 && p.name.indexOf('>') < 0), '昵称里的尖括号被清掉');
ok(await statusOf({ code: 'BBBBBB', who: 'join', name: '' }) === 400, '空昵称 400');
r = await post({ code: CODE, who: 'host', name: '房主', cfg: { diff: 99, mode: -5, rate: 50, targetN: 999, roundIdx: 7 } });
ok(r.cfg.diff <= 1 && r.cfg.mode >= 0 && r.cfg.rate <= 1 && r.cfg.targetN <= 9 && r.cfg.roundIdx <= 3,
   '越界设置被夹回合法范围（否则会让对方页面 DIFF[99] 崩掉）');

console.log('[F] KV 额度：一整局的写次数');
store.clear(); reads = 0; writes = 0;
await post({ code: 'AAAAAA', who: 'host', name: 'A', cfg: {} });
await post({ code: 'AAAAAA', who: 'join', name: 'B' });
await post({ code: 'AAAAAA', who: 'ready', name: 'A', ready: true });
await post({ code: 'AAAAAA', who: 'ready', name: 'B', ready: true });
await post({ code: 'AAAAAA', who: 'score', name: 'A', score: 1, detail: {} });
await post({ code: 'AAAAAA', who: 'score', name: 'B', score: 2, detail: {} });
console.log('       一局用掉 ' + writes + ' 次写、' + reads + ' 次读');
ok(writes <= 8, '一整局 KV 写 ≤ 8 次（免费额度 1000 写/天 → 每天够打 100+ 局）');

console.log('[G] 每日挑战榜单');
store.clear(); reads = 0; writes = 0;
const DAY = '20260914';
const getDaily = async day => (await onRequestGet({
  request: new Request('http://x/api/room?daily=' + day), env
})).json();
r = await post({ who: 'daily', date: DAY, name: '甲', score: 1200, detail: { dodge: '50%', acc: '90%' } });
ok(r.ok === true && r.rows.length === 1 && r.rows[0].name === '甲', '首个成绩上榜');
r = await post({ who: 'daily', date: DAY, name: '乙', score: 1500, detail: {} });
ok(r.rows.length === 2 && r.rows[0].name === '乙', '榜按分数降序（乙 1500 在前）');
const wBeforeLower = writes;
r = await post({ who: 'daily', date: DAY, name: '甲', score: 800, detail: {} });
ok(writes === wBeforeLower, '没破自己当日纪录 → 不写 KV（每人每天 ≤1 写的额度账）');
ok(r.rows.find(x => x.name === '甲').score === 1200, '低分不覆盖自己当日最佳');
r = await post({ who: 'daily', date: DAY, name: '甲', score: 2000, detail: {} });
ok(r.rows.find(x => x.name === '甲').score === 2000 && r.rows[0].name === '甲', '更高分覆盖并重新排序');
r = await post({ who: 'daily', date: DAY, name: '丙', score: 99999999, detail: {} });
ok(r.rows.find(x => x.name === '丙').score <= 100000, '离谱分数被服务端夹回（防手滑/防恶作剧）');
const gd = await getDaily(DAY);
ok(gd.ok === true && gd.rows.length === 3 && gd.rows[0].score === 100000, 'GET 拉取整张当日榜（丙被夹到上限排第一）');
r = await post({ who: 'daily', date: '2026', name: '甲', score: 1, detail: {} });
ok(r.error === '日期格式不对（YYYYMMDD）', '日期串必须 8 位');
r = await post({ who: 'daily', date: DAY, name: '', score: 1, detail: {} });
ok(r.error === '昵称不能为空', '空昵称拒绝');
/* 榜单上限 50 行：55 人首次投稿 = 恰 55 写（每人每天首投 1 写） */
const wBeforeLoop = writes;
for (let i = 0; i < 55; i++) await post({ who: 'daily', date: '20270101', name: '玩家' + i, score: i, detail: {} });
const capped = await getDaily('20270101');
ok(capped.rows.length === 50 && capped.rows[0].name === '玩家54', '榜单封顶 50 行，只留前 50 名');
ok(writes - wBeforeLoop === 55, '55 人首次投稿恰好 55 写（每人每天 1 写的额度账）');
const wAfterLoop = writes;
await post({ who: 'daily', date: '20270101', name: '玩家50', score: 49, detail: {} });
ok(writes === wAfterLoop, '重复投稿未破自己纪录 → 零 KV 写（榜内幸存者验证）');

console.log('\n' + (fails ? ('有 ' + fails + ' 项失败') : '全部通过'));
process.exit(fails ? 1 : 0);
