# 部署与更新

纯静态单文件，任何静态托管都能跑，**不需要后端、不需要数据库**。

## 结论先说

**主分享链接用 Cloudflare Pages（连 GitHub 自动部署）**，GitHub 仓库是唯一的源码与构建入口，
workbuddy 那份逐步退役。

理由：它是唯一一个既能「`git push` 就自动上线」、又能让国内朋友直接打开的选项。

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

> 短链 `https://tinyurl.com/2yhunzc6` 本身也被墙，**已失效，不要再发**。

## 三个链接的分工

| 链接 | 国内直连 | 自动更新 | 定位 |
|---|---|---|---|
| GitHub 仓库 | 打不开 | push 即更新 | 源码 + CI，唯一编辑入口 |
| `https://limingc1.github.io/valorant-anti-flash-trainer/` | 打不开 | push 即上线 | 备用链接，零维护 |
| Cloudflare Pages（待部署） | 可，默认域名偏慢 | 连 Git 后 push 即上线 | **主分享链接** |
| workbuddy | 可，2.0s | 需回平台手动重发 | 旧链接，确认 CF 可用后删掉 |

GitHub Pages 已经配好并在跑（`.github/workflows/deploy.yml`），不用管它。

## 日常更新流程

改完 `valorant-anti-flash-trainer.html`，在这个目录里：

```
node .workbuddy/smoke-test.js
git add -A
git commit -m "说清楚改了什么"
git push
```

push 完 GitHub Actions 自动构建并发布 GitHub Pages；Cloudflare Pages 接了 Git 集成之后
也会同时自动更新。**不需要手动 cp 文件、不需要去网页上传、不需要重新部署。**

> 这台机器上 git 必须走代理。已经给本仓库配好了
> `http.proxy = http://127.0.0.1:10808`，所以**代理客户端要开着**才能 push/fetch。
> 换网络或换端口时改这两行：
>
> ```
> git config http.proxy http://127.0.0.1:<你的端口>
> git config https.proxy http://127.0.0.1:<你的端口>
> ```

`dist/` 已进 `.gitignore`，由 CI 现场生成，不再需要手工同步。
只有手动 wrangler 上传、或本地起服务器自测时才需要跑：

```
powershell -ExecutionPolicy Bypass -File build-dist.ps1
```

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
