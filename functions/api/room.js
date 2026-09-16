/* Cloudflare Pages Function -- 联机对战房间同步后端 v2
 * 路由：functions/api/room.js -> /api/room（与游戏同源，无需 CORS）
 * 绑定：Pages 项目 KV namespace binding，变量名 ROOMS；未绑定返回 503，前端自动降级离线
 *
 * v2 相对 v1 的三处改动，都是实测踩出来的：
 *   1. 「加入」会真正写一条 player 记录 —— v1 的 join 只做 GET 不写，
 *      房主那边永远看不到有人进来，一直显示「等待对手」。
 *   2. 大厅准备流程：双方都 ready -> 服务端写下 startAt（绝对毫秒）->
 *      两边同时倒计时开局。响应里带 now，客户端用 startAt-now 算剩余，
 *      绕开两台机器的时钟偏差（不能直接比本地 Date.now()）。
 *   3. KV 免费额度很小（写 1000/天、读 10 万/天），所以只在状态真的变化时才 put，
 *      读的节流放在前端（自适应轮询 + 页面隐藏暂停 + 429 立即降级）。
 *
 * 房间记录：
 *   { cfg, host, players:[{name,ready,score,detail,at}], startAt, round, created }
 */

var TtlSec = 7200;                       // 房间 2 小时后自动过期，无需清理任务
var DailyTtlSec = 172800;                // 每日榜保留 2 天（跨零点后昨天的榜还能看一会儿）
var DailyMaxRows = 50;                   // 榜单上限：只留前 50 名
var DailyScoreMax = 100000;              // 每日挑战分数服务端夹取（防手滑/防恶作剧）
var RoomRe = /^[0-9A-HJ-NP-TV-Z]{6}$/;   // Crockford Base32，6 位，与前端一致
var DateRe = /^\d{8}$/;                  // 每日挑战日期串 YYYYMMDD（客户端本地日期）
var MaxPlayers = 2;                       // 好友对战；要办多人赛改这里
var CountdownMs = 3000;                   // 双方都准备后的开局倒计时

var Hdr = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function reply(obj, code) {
  return new Response(JSON.stringify(obj), { status: code || 200, headers: Hdr });
}
function bad(msg, code) { return reply({ error: msg }, code || 400); }
function keyOf(code) { return 'room:' + code; }
function numClamp(v, lo, hi, d) {
  var n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
}

/* 昵称：去掉 <> 和控制字符，最长 12 字符 */
function cleanName(s) {
  s = String(s == null ? '' : s);
  var out = '';
  for (var i = 0; i < s.length; i++) {
    var c = s[i];
    if (c === '<' || c === '>' || c === '\n' || c === '\r' || c === '\t') continue;
    out += c;
  }
  return out.slice(0, 12);
}

/* 公平设置清洗：只留双方必须一致的字段，且夹到合法范围 —— 这些值会直接驱动
   前端的 DIFF[..]/MODES[..]/ROUNDS[..]，被写坏会让对方页面崩掉 */
function cleanCfg(o) {
  if (!o || typeof o !== 'object') return null;
  var out = {};
  if (o.agents && typeof o.agents === 'object') {
    var a = {};
    for (var k in o.agents) if (typeof o.agents[k] === 'boolean') a[k] = o.agents[k];
    out.agents = a;
  }
  out.diff = numClamp(o.diff, 0, 1, 0) | 0;
  out.mode = numClamp(o.mode, 0, 2, 0) | 0;
  out.vis = numClamp(o.vis, 0, 2, 0) | 0;
  out.roundIdx = numClamp(o.roundIdx, 0, 3, 1) | 0;
  out.rate = numClamp(o.rate, 0.3, 1, 1);
  out.targetN = numClamp(o.targetN, 1, 9, 5) | 0;
  return out;
}

function emptyRoom() {
  return { cfg: null, host: null, players: [], startAt: 0, round: 1, created: Date.now() };
}
function findPlayer(room, name) {
  for (var i = 0; i < room.players.length; i++) if (room.players[i].name === name) return i;
  return -1;
}
function newPlayer(name, ready) {
  return { name: name, ready: !!ready, score: null, detail: null, at: Date.now() };
}
/* 发给客户端的视图。now 必须带上：客户端靠 startAt-now 算倒计时剩余毫秒 */
function view(room) {
  return {
    cfg: room.cfg, host: room.host, players: room.players,
    startAt: room.startAt || 0, round: room.round || 1, revision: room.revision || 0, now: Date.now()
  };
}
async function readRoom(env, code) {
  var raw = await env.ROOMS.get(keyOf(code));
  if (!raw) return null;
  try {
    var r = JSON.parse(raw);
    if (!Array.isArray(r.players)) r.players = [];
    return r;
  } catch (e) { return null; }
}
async function writeRoom(env, code, room) {
  // 随已有写入携带版本，不增加 KV 写。只能挡客户端旧快照回滚，不能让 KV 变强一致。
  room.revision = (room.revision || 0) + 1;
  await env.ROOMS.put(keyOf(code), JSON.stringify(room), { expirationTtl: TtlSec });
}

/* ---------- 每日挑战榜单 ----------
   key = daily:YYYYMMDD（客户端本地日期，同城朋友天然同一天）。
   值 = [{name,score,detail,at}] 按分数降序，最多 DailyMaxRows 行。
   同名只在「更高分」时覆盖 —— 每人每天最多贡献 1 次 KV 写，额度账：玩家数 × 1 ≪ 1000/天。 */
function dailyKey(date) { return 'daily:' + date; }
async function readDaily(env, date) {
  var raw = await env.ROOMS.get(dailyKey(date));
  if (!raw) return [];
  try {
    var r = JSON.parse(raw);
    return Array.isArray(r) ? r : [];
  } catch (e) { return []; }
}
async function writeDaily(env, date, rows) {
  await env.ROOMS.put(dailyKey(date), JSON.stringify(rows), { expirationTtl: DailyTtlSec });
}

/* GET /api/room?code=ABCDEF -> 房间视图；不存在 404；未绑定 KV 503
 * GET /api/room?daily=YYYYMMDD -> 每日挑战榜单 */
export async function onRequestGet(context) {
  var env = context.env;
  if (!env.ROOMS) return bad('KV 未绑定（ROOMS）', 503);
  var sp = new URL(context.request.url).searchParams;
  var d = String(sp.get('daily') || '');
  if (d) {
    if (!DateRe.test(d)) return bad('日期格式不对（YYYYMMDD）');
    return reply({ ok: true, date: d, rows: await readDaily(env, d) });
  }
  var code = (sp.get('code') || '').toUpperCase();
  if (!RoomRe.test(code)) return bad('房码格式不对');
  var room = await readRoom(env, code);
  if (!room) return bad('房间不存在', 404);
  return reply(view(room));
}

/* POST /api/room  JSON: { code, who, name, ... }
 *   who=host   建房：写房主设置，并把房主登记为第一个玩家
 *   who=join   加入：登记一条 player（房主的大厅才看得见有人进来）
 *   who=ready  准备：{ready:bool}；全部就绪时服务端定下 startAt
 *   who=score  交卷：{score, detail}
 *   who=again  再战：清准备与分数、round+1，回大厅
 *   who=leave  离开
 *   who=daily  每日挑战交成绩：{date, score, detail}，同名留最高分，返回整张榜
 * 统一返回 { ok:true, ...房间视图 } */
export async function onRequestPost(context) {
  var env = context.env;
  if (!env.ROOMS) return bad('KV 未绑定（ROOMS）', 503);
  var b;
  try { b = await context.request.json(); } catch (e) { return bad('请求体不是 JSON'); }
  var who = String(b.who || '');

  if (who === 'daily') {
    var nameD = cleanName(b.name);
    if (!nameD) return bad('昵称不能为空');
    var dateD = String(b.date || '');
    if (!DateRe.test(dateD)) return bad('日期格式不对（YYYYMMDD）');
    var rows = await readDaily(env, dateD);
    var sc = numClamp(b.score, 0, DailyScoreMax, 0) | 0;
    var dd = b.detail || {};
    var detailD = {
      dodge: String(dd.dodge || '').slice(0, 6),
      acc: String(dd.acc || '').slice(0, 6)
    };
    var at = Date.now(), changed = true, k = -1;
    for (var i = 0; i < rows.length; i++) if (rows[i].name === nameD) { k = i; break; }
    if (k >= 0) {
      if (sc > (rows[k].score | 0)) { rows[k].score = sc; rows[k].detail = detailD; rows[k].at = at; }
      else changed = false;                        // 没破自己的当日纪录：不写 KV，省额度
    } else {
      rows.push({ name: nameD, score: sc, detail: detailD, at: at });
    }
    if (changed) {
      rows.sort(function (a, c) { return (c.score | 0) - (a.score | 0); });
      if (rows.length > DailyMaxRows) rows.length = DailyMaxRows;
      await writeDaily(env, dateD, rows);
    }
    return reply({ ok: true, date: dateD, mine: sc, rows: rows });
  }

  var code = String(b.code || '').toUpperCase();
  if (!RoomRe.test(code)) return bad('房码格式不对');
  var name = cleanName(b.name);
  var room = await readRoom(env, code) || emptyRoom();
  var okView = function () { return reply(Object.assign({ ok: true }, view(room))); };

  if (who === 'host') {
    room.cfg = cleanCfg(b.cfg);
    room.host = name || '房主';
    if (findPlayer(room, room.host) < 0) room.players = [newPlayer(room.host, false)];
    room.startAt = 0;
    await writeRoom(env, code, room);
    return okView();
  }

  if (!name) return bad('昵称不能为空');

  if (who === 'join') {
    if (findPlayer(room, name) < 0) {
      if (room.players.length >= MaxPlayers) return bad('房间已满（上限 ' + MaxPlayers + ' 人）', 403);
      room.players.push(newPlayer(name, false));
      await writeRoom(env, code, room);      // 只在真的新增时写，省 KV 写额度
    }
    return okView();
  }

  if (who === 'ready') {
    var j = findPlayer(room, name);
    if (j < 0) {
      if (room.players.length >= MaxPlayers) return bad('房间已满（上限 ' + MaxPlayers + ' 人）', 403);
      room.players.push(newPlayer(name, false));
      j = room.players.length - 1;
    }
    var want = b.ready !== false;
    var dirty = room.players[j].ready !== want;
    room.players[j].ready = want;
    if (!want && room.startAt) { room.startAt = 0; dirty = true; }
    var allReady = room.players.length >= 2 && room.players.every(function (p) { return p.ready; });
    if (allReady && !room.startAt) {
      room.startAt = Date.now() + CountdownMs;      // 服务端定开局时刻，双方同时倒计时
      for (var k2 = 0; k2 < room.players.length; k2++) {
        room.players[k2].score = null; room.players[k2].detail = null;
      }
      dirty = true;
    }
    if (dirty) await writeRoom(env, code, room);
    return okView();
  }

  if (who === 'score') {
    var m = findPlayer(room, name);
    if (m < 0) {
      if (room.players.length >= MaxPlayers) return bad('房间已满（上限 ' + MaxPlayers + ' 人）', 403);
      room.players.push(newPlayer(name, true));
      m = room.players.length - 1;
    }
    var d = b.detail || {};
    room.players[m].score = numClamp(b.score, 0, 1e9, 0) | 0;
    room.players[m].detail = {
      dodge: String(d.dodge || '').slice(0, 6),
      acc: String(d.acc || '').slice(0, 6),
      best: numClamp(d.best, 0, 9999, 0) | 0,
      blind: numClamp(d.blind, 0, 9999, 0) | 0
    };
    room.players[m].at = Date.now();
    await writeRoom(env, code, room);
    return okView();
  }

  if (who === 'again') {
    for (var n2 = 0; n2 < room.players.length; n2++) {
      room.players[n2].ready = false;
      room.players[n2].score = null;
      room.players[n2].detail = null;
    }
    room.startAt = 0;
    room.round = (room.round || 1) + 1;        // 换一轮种子：重赛不再是同一串闪光
    await writeRoom(env, code, room);
    return okView();
  }

  if (who === 'leave') {
    var p = findPlayer(room, name);
    if (p >= 0) {
      room.players.splice(p, 1);
      room.startAt = 0;
      await writeRoom(env, code, room);
    }
    return reply({ ok: true });
  }

  return bad('who 必须是 host / join / ready / score / again / leave');
}
