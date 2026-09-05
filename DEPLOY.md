# 部署与更新

纯静态单文件，任何静态托管都能跑。**训练功能不需要后端**；
只有「联机对战自动比分数」用到 Cloudflare Pages Functions + KV（免费额度），见文末。

> GitHub Pages 部署已移除（国内连不上，也没用上）。现在是 **Cloudflare Pages 单一发布**。
> `.github/workflows/ci.yml` 只跑冒烟测试，不再发布任何东西。

## 结论先说

**主分享链接（已部署并验证可用）：**

```
https://valorant-anti-flash-trainer.pages.dev/
```

GitHub 仓库是唯一的源码与构建入口，workbuddy 那份逐步退役。
Cloudflare Pages 已连上仓库，**`git push` 之后约 1 分钟自动上线**，不需要任何手动操作。

理由：它是唯一一个既能「push 就自动上线」、又能让国内朋友直接打开的选项。

### 关于发布目录（重要，别再踩）

当前 CF Pages 实际发布的是**仓库根目录**，不是 `dist/`。
根目录的 `index.html` 是一个 30 行的跳转页，负责把访客送到
`valorant-anti-flash-trainer.html`（游戏本体）。所以根目录那个 `index.html`
**不是冗余文件，删了线上立刻 404**。

另外 Cloudflare Pages 默认开 clean URL：访问 `xxx.html` 会被 308 跳到去掉扩展名的
`xxx`，浏览器自动跟随，但用 `curl` 验证时要记得加 `-L`，否则会误判成失败。

如果你把 CF 改成发布 `dist/`（配合 Build command，见下文方案 A），两种配置都能正常工作，
因为 `dist/index.html` 是游戏本体、根目录 `index.html` 只是跳转页。

## 实测数据

2026-08-31 在本机用 `curl --noproxy "*"` 强制直连（不走代理，模拟国内普通访客）：

| 目标 | 结果 |
|---|---|
| `limingc1.github.io` | **000 连不上**（4.2s） |
| `github.com` | 000 连不上 |
| `raw.githubusercontent.com` | 000 连不上 |
| `tinyurl.com` | 000 连不上 |
| workbuddy 链接 | **200，2.0s，91151 字节全量到达** |
| `pages.dev`（CF 默认域名） | 200 但很慢，15s 超时截断 |
| `speed.cloudflare.com` | 200，2.4s |
| `developers.cloudflare.com` | 000 连不上 |
| `edgeone.app` | 404，1.9s 完成握手（能连） |
| `baidu.com`（基线） | 200，0.2s |

部署完成后复测（同一台机器、同样不走代理）：

```
valorant-anti-flash-trainer.pages.dev/            200  1572 字节（跳转页）
.../valorant-anti-flash-trainer                   200  91151 字节  text/html  ✅ 游戏本体
```

国内直连可用，握手约 2–4 秒。

> 短链 `https://tinyurl.com/2yhunzc6` 本身也被墙，**已失效，不要再发**。

## 部署入口（只有一个）

| 链接 | 国内直连 | 自动更新 | 定位 |
|---|---|---|---|
| `https://valorant-anti-flash-trainer.pages.dev/` | **可** | push 约 1 分钟自动上线 | **主分享链接，发这个** |
| GitHub 仓库 | 打不开 | push 即触发 CI + CF 构建 | 源码 + CI，唯一编辑入口 |

Cloudflare Pages 由 CF 侧的 Git 集成负责，push 到 `main` 自动构建发布，**不用管**。
GitHub 上的 CI（`.github/workflows/ci.yml`）只跑冒烟测试，不再发布 GitHub Pages。

> 关于 Functions（`/api/room`）：CF Pages 会自动识别仓库根的 `functions/` 目录，
> 无需额外构建步骤。但要完成文末「联机对战后端一次性设置」里的 KV 绑定，
> 否则 `/api/room` 返回 503，联机对战会降级成「离线同房码 + 口头比分」。

## 日常更新流程

改完 `valorant-anti-flash-trainer.html`，在这个目录里：

```
node .workbuddy/smoke-test.js
git add -A
git commit -m "说清楚改了什么"
git push
```

push 完 Cloudflare Pages 自动重新部署上线。**不需要手动 cp 文件、不需要去网页上传、
不需要重新部署。**

> 这台机器上 git 必须走代理。已经给本仓库配好了
> `http.proxy = http://127.0.0.1:10808`，所以**代理客户端要开着**才能 push/fetch。
> 换网络或换端口时改这两行：
>
> ```
> git config http.proxy http://127.0.0.1:<你的端口>
> git config https.proxy http://127.0.0.1:<你的端口>
> ```

## 部署到 Cloudflare Pages

### 方案 A：连 GitHub（推荐，一次配好永久自动）

1. Cloudflare Dashboard → **Workers & Pages → Create → Pages → Connect to Git**
2. 没授权过就点 *Install and Authorize*，把 Cloudflare 的 GitHub App 授权给
   `limingc1/valorant-anti-flash-trainer` 这一个仓库
3. 构建配置**照下面填，不要留空** —— `dist/` 不入库，必须由 CF 现场生成：

   | 项 | 值 |
   |---|---|
   | Framework preset | `None` |
   | Build command | `mkdir -p dist/sfx && cp valorant-anti-flash-trainer.html dist/index.html && cp logo.svg dist/ && cp sfx/README.md sfx/split-recorded.py dist/sfx/` |
   | Build output directory | `dist` |
   | Root directory | 留空（仓库根） |

4. **Save and Deploy**，拿到 `https://<你的项目名>.pages.dev`
5. 之后每次 `git push` 自动重新部署

### 国内嫌慢就绑自己的域名

`*.pages.dev` 是 Cloudflare 的共享默认域名，国内表现不稳定（实测 15s 都拉不完）。
绑自己的域名后走独立配置，通常明显改善：

- Pages 项目 → **Custom domains → Set up a custom domain**
- 域名已在 Cloudflare：直接选子域，比如 `flash.你的域名.com`，DNS 记录自动加
- 域名在别处：把 CF 给的 CNAME 加到你现有 DNS

### 方案 B：不连 Git，用 wrangler 手动上传

```
npm i -g wrangler
wrangler login
powershell -ExecutionPolicy Bypass -File build-dist.ps1
npx wrangler pages deploy dist --project-name=anti-flash-trainer
```

每次更新都要重跑最后两行，只适合临时救急。

## 备选：腾讯 EdgeOne Pages（国内最快）

1. 跑一次 `build-dist.ps1` 生成 `dist/`
2. EdgeOne Pages 控制台 → 直接上传 → 把 `dist/` 整个目录拖进去
3. 拿 `*.edgeone.app` 链接

它也支持连 GitHub 自动构建，配置思路和 Cloudflare 一样。实测 `edgeone.app` 握手 1.9s，
比 `pages.dev` 快，如果访客基本都在国内，这个比 CF 更值。

## 联机对战后端：一次性设置（只做一次）

「联机对战」的房间同步接口在 `functions/api/room.js`（映射到 `/api/room`），
随 Cloudflare Pages 自动部署，**代码不用你管**。你只需做一次绑定：

1. Cloudflare Dashboard → **Storage & Databases → KV → Create namespace**，
   名字随意（例如 `aft-rooms`）。免费额度（读 10 万/天、写 1000/天）对朋友对战绰绰有余。
2. 进你的 **Pages 项目 → Settings → Functions**（或 Environment variables）→
   **KV namespace bindings** → Add binding：
   - Variable name：`ROOMS`（**必须完全一致**，代码按这个名字取）
   - KV namespace：选第 1 步建的
3. Save and deploy（重新部署一次让绑定生效）。

之后 `/api/room` 就通了：房主点「创建房间」生成房码 + 邀请链接，朋友点开打同一局，
双方打完各自分数自动上报，先交卷的一方轮询到对方分数后直接显示 **胜 / 负 / 平**。

没做这一步会怎样：`/api/room` 返回 503，游戏**照常能玩**——
房码本身已携带「时长 + 种子」，两人手动输同一段房码也能打完全相同的闪光序列，
只是比分得口头核对，面板会提示「离线模式」。

> 防作弊说明：分数由各自浏览器自报，属荣誉制，适合朋友间娱乐，不适合办正规比赛。

## 换音效需要注意

`sfx/` 里的音频文件被 `.gitignore` 排除（Riot 版权内容不入库），所以
**连 Git 自动部署的线上版本只有内置合成音**。

要让线上带自定义音效，只能走手动上传：把音频放进 `sfx/` → 跑 `build-dist.ps1`
（会一起复制进 `dist/sfx/`）→ 用 wrangler 上传 `dist/`。

线上是 https 同源加载，比本地 `file://` 省事，不会有读不到文件的问题。

## 关于 Cloudflare 在国内的取舍

Cloudflare 在国内没有优质节点，常见延迟 200–400ms、丢包、部分地区直接连不上。
这个游戏对延迟不敏感（纯本地鼠标操作），但**加载不出来就没法玩**。

| 访客位置 | 推荐 |
|---|---|
| 都在国内 | EdgeOne Pages、腾讯云 COS 静态网站；或 Cloudflare 绑自有域名 |
| 都在海外 | Cloudflare Pages、Netlify、GitHub Pages |
| 混合 | Cloudflare Pages 为主，国内另挂一份 EdgeOne |
