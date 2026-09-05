/* Cloudflare Pages Function -- 联机对战房间同步后端
 * 路由：functions/api/room.js 自动映射到 /api/room，与游戏同源，无需 CORS。
 * 需在 Pages 项目绑定 KV 命名空间，变量名 ROOMS；未绑定时返回 503，前端自动降级。
 * 数据模型（一条 KV = 一个房间，2 小时 TTL 自动清理）：
 *   { cfg, host, results, created }
 */

var TtlSec = 7200;                       // 房间 2 小时后自动过期
var RoomRe = /^[0-9A-HJ-NP-TV-Z]{6}$/;   // Crockford Base32，6 位，与前端一致
var MaxPlayers = 2;                       // 好友对战；要办多人赛改这里即可
var JSONHdr = { headers: { 'content-type': 'application/json; charset=utf-8' } };

function bad(msg, code) {
  var h = { 'content-type': 'application/json; charset=utf-8' };
  return new Response(JSON.stringify({ error: msg }), { status: code || 400, headers: h });
}
function ok(obj) {
  return new Response(JSON.stringify(obj), { status: 200, headers: JSONHdr });
}
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

/* 公平设置清洗：只保留双方要一致的字段，其余丢掉或夹到合法范围 */
function cleanCfg(o) {
  if (!o || typeof o !== 'object') return null;
  var out = {};
  if (o.agents && typeof o.agents === 'object') {
    var a = {};
    for (var k in o.agents) if (typeof o.agents[k] === 'boolean') a[k] = o.agents[k];
    out.agents = a;
  }
  out.diff     = numClamp(o.diff, 0, 1, 0) | 0;
  out.mode     = numClamp(o.mode, 0, 2, 0) | 0;
  out.vis      = numClamp(o.vis, 0, 2, 0) | 0;
  out.roundIdx = numClamp(o.roundIdx, 0, 3, 1) | 0;
  out.rate     = numClamp(o.rate, 0.3, 1, 1);
  out.targetN  = numClamp(o.targetN, 1, 9, 5) | 0;
  return out;
}

async function readRoom(env, code) {
  var raw = await env.ROOMS.get(keyOf(code));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}
async function writeRoom(env, code, room) {
  await env.ROOMS.put(keyOf(code), JSON.stringify(room), { expirationTtl: TtlSec });
}

/* GET /api/room?code=ABCDEF
 * 200 {cfg, host, results}；房间不存在 404；未绑定 KV 503 */
export async function onRequestGet(context) {
  var env = context.env;
  if (!env.ROOMS) return bad('KV 未绑定（ROOMS）', 503);
  var code = new URL(context.request.url).searchParams.get('code');
  code = (code || '').toUpperCase();
  if (!RoomRe.test(code)) return bad('房码格式不对');
  var room = await readRoom(env, code);
  if (!room) return bad('房间不存在', 404);
  return ok({ cfg: room.cfg, host: room.host, results: room.results || [] });
}

/* POST JSON:
 *   { code, who:'host',  cfg }              建房：写入房主设置
 *   { code, who:'score', name, score, detail }  交卷：更新或新增本人成绩
 * 返回 { ok:true, results } */
export async function onRequestPost(context) {
  var env = context.env;
  if (!env.ROOMS) return bad('KV 未绑定（ROOMS）', 503);
  var b;
  try { b = await context.request.json(); } catch (e) { return bad('请求体不是 JSON'); }
  var code = String(b.code || '').toUpperCase();
  if (!RoomRe.test(code)) return bad('房码格式不对');
  var room = await readRoom(env, code) || { cfg: null, host: null, results: [], created: Date.now() };
  if (!Array.isArray(room.results)) room.results = [];

  if (b.who === 'host') {
    room.cfg = cleanCfg(b.cfg);
    room.host = cleanName(b.name || '房主');
    await writeRoom(env, code, room);
    return ok({ ok: true, results: room.results });
  }

  if (b.who === 'score') {
    var name = cleanName(b.name);
    if (!name) return bad('昵称不能为空');
    var score = numClamp(b.score, 0, 1e9, 0) | 0;
    var d = b.detail || {};
    var detail = {
      dodge: String(d.dodge || '').slice(0, 6),
      acc:   String(d.acc   || '').slice(0, 6),
      best:  numClamp(d.best, 0, 9999, 0) | 0,
      blind: numClamp(d.blind, 0, 9999, 0) | 0
    };
    var idx = -1;
    for (var i = 0; i < room.results.length; i++) {
      if (room.results[i].name === name) { idx = i; break; }
    }
    var entry = { name: name, score: score, detail: detail, at: Date.now() };
    if (idx >= 0) room.results[idx] = entry;
    else {
      if (room.results.length >= MaxPlayers) return bad('房间已满（上限 ' + MaxPlayers + ' 人）', 403);
      room.results.push(entry);
    }
    await writeRoom(env, code, room);
    return ok({ ok: true, results: room.results });
  }

  return bad('who 字段必须是 host 或 score');
}
