# AGENTS.md — 背闪模拟器 项目约定

无畏契约（VALORANT）背闪训练器。**单文件 Web 游戏 + Cloudflare Pages Function**，零依赖、零构建。

新会话请先读完本文件，再跑一遍基线测试（见下节）确认起点是绿的。

---

## 改完必做

```
node .workbuddy/smoke-test.js     # 期望 264 条 OK，末行「全部通过」
node .workbuddy/api-test.mjs      # 期望 26 条 OK，末行「全部通过」
```

两条都必须全绿。**断言数只增不减** —— 这些数字是回归钉子，一条条对应以前真出过的事故
（每帧重复结算把 KV 额度刷爆、音画不同步、回靶计时虚高、房主看不到对手……）。

如果某次改动确实应该改变一个被钉住的值：改测试，并在提交信息里写清**为什么旧的期望是错的**。
不要为了让测试变绿而删断言。

视觉和手感自动化测不到，改完请让用户在浏览器里打一局确认。

---

## 文件地图

| 路径 | 是什么 |
|---|---|
| `valorant-anti-flash-trainer.html` | **产品本体**。全部 HTML/CSS/JS 内联在这一个文件里 |
| `index.html` | 跳转入口（Pages 输出目录设为仓库根时命中它） |
| `functions/api/room.js` | Pages Function `/api/room`，联机房间；动作 host / join / ready / score / again / leave |
| `.workbuddy/smoke-test.js` | 冒烟测试：Node `vm` + 最小 DOM 桩，跑的是**真实**游戏脚本 |
| `.workbuddy/api-test.mjs` | 后端测试：假 KV 跑完整房间生命周期 |
| `.github/workflows/ci.yml` | CI，跑上面两套 |
| `sfx/` | 自定义音效 wav + 切分脚本 + 说明 |
| `music/` | 音乐盒本地曲目文件夹（**gitignore 不入库**，版权原因；`README.md` 有用法） |
| `build-dist.ps1` | 本地构建 `dist/`（CI 跑同样步骤，平时不用管） |

本地跑游戏：浏览器直接打开 `valorant-anti-flash-trainer.html`。
`file://` 下音效可能加载不了，起个静态服务器即可：`python -m http.server 8000`。

---

## 硬约束（都是踩过的坑，别改回去）

1. **不要引入依赖或构建步骤。** 没有 `package.json` 是故意的 —— 产品必须能双击 HTML 直接跑。

2. **双随机流不能合并。** `contentRnd` / `grand` / `gpickEl` 走种子（内容：特工、轨迹、引爆时机），
   `Math.random` / `rand` / `pickEl` 走真随机（靶点、节奏 `gapFor`）。联机的同种子公平全靠这个划分。

3. **KV 写额度是硬瓶颈。** 免费档 1000 写/天，一整局固定 6 次写，`api-test.mjs` 的 `[F]` 组
   钉死「一局 ≤8 次写」。**加写操作之前先算账**，改后端别让它涨。

4. **闪光的出手声不要用 `setTimeout` 或挂帧回调。** 现行架构：`spawnFlash` 算
   `f.audOff`（相对 `f.t0` 的偏移），`updateFlashes` 每帧查 `T-f.t0>=audOff` 播一次
   （`audioPlayed` 闸门）。这样掉帧、暂停（`shiftTime`）都自动跟着走。
   历史上 `setTimeout` 方案和 `<audio>` 方案各走过一次弯路，别回去。

5. **音效播放必须走 WebAudio 预解码缓存**（`loadSfxFiles` 里 `fetch` + `decodeAudioData`
   烘成 `AudioBuffer`，`playFile` 用 `AudioBufferSource`）。用 `<audio>` + `cloneNode(true).play()`
   会每次重新下载解码，实测延迟数秒、连开多只还会攒着一起响。

6. **`sfx/*.wav|mp3` 不要加进 `.gitignore`。** 音频入库是有意的（用户自己录的，无版权问题），
   push 后线上也听得到。单个音效压到几十 KB 以内，别放整段录屏。

7. **DOM 元素 ID 是 JS 的直接查找目标**（约 70 处 `$('xxx')`）。删或改 ID 会让启动时抛
   null TypeError，表现是**黑屏但能听见声音**。动 UI 结构后务必核对所有 ID。

8. **对战中不轮询云端**（省 KV 读额度），只在开局前和等交卷时轮询。
   `pollDelay()` / `startPoll()` 是额度闸门，`cloudGaveUp()` 是 429 降级入口。

9. **音乐盒的音频文件入库**（2026-09-13 起，与约束 6 的 `sfx/` 同策略）。
   `music/*` 已不再被 gitignore —— push 即部署，线上和朋友的音乐盒里直接就有曲子。
   别按「版权音频不该入库」的老印象把它加回 `.gitignore`。
   技术侧三条别改：
   - 播放走 WebAudio 预解码（同约束 5），但**只缓存当前这首**的解码结果
     （3 分钟曲子解码后约 60MB PCM，整张歌单全缓存会吃光内存）；
   - 「出手声压低音乐」（duck）在 `musicTick` 里做帧内插值，别改成 `setTimeout`；
   - IndexedDB 不可用（vm 测试环境/老浏览器）时必须优雅降级成只有文件夹曲目。

---

## 设计取向（和「更还原游戏」冲突时的取舍）

- **擦闪（`GRAZE_COVER=0.20`）是故意的宽容，不是 bug。**
  布雷奇锥角 70° 比屏幕半 FOV（103°/2=51.5°）还大，51.5°~70° 这圈屏幕上没有光点却仍按角度判被闪。
  用户明确要求：白一下（零点几秒）算背闪成功，**不断连击**。别按「真实游戏就是这样」把它改严。
  要调只动 `GRAZE_COVER` 一个常量。

- **回靶计时的起点 = 「最早能出手的时刻」**（`reflickStart()`），不是引爆瞬间、也不是白屏完全散尽。
  白屏按 `shoot()` 吞弹线 0.35 倒推，近视按 `nearFog>0.15` 倒推。

- **致盲按 `cover` 分档**（背掉锥角的比例：正脸 1、擦边 0），同时决定白多久和白多重。

---

## 部署

push 到 `main` → Cloudflare Pages 自动部署，约 1 分钟生效。**提交即上线，没有单独的发布步骤。**

- 联机需要 Pages Function + KV（绑定名 `ROOMS`）；`file://` 或未绑定 KV 时自动降级成离线对战。
- 本仓库的 `.git/config` 里配了 git 代理 `http://127.0.0.1:10808`（仓库本地配置，跟着文件夹走）。

---

## 已知待办

- **实时比分显示**（现在对战中故意不轮询）。动手前先算 KV 写额度：每 5s 上报一次、60s 一局
  = 每人 12 写、一局 24+ 写，1000/天只够 40 局 —— 大概率该换 **Cloudflare D1**（免费 10 万写/天）。
- `gekko` / `vyse` 两个特工还没实现。
- 靶点布局两人不保证完全一致（各自打掉各自补），这是异步同种子对战的固有权衡，**别当 bug 修**。
