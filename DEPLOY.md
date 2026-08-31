# 分享给别人玩

这游戏是纯静态单文件，任何静态托管都能跑，**不需要后端、不需要数据库**。

## 已经部署好一个可以直接分享的链接

```
https://66e587e7751b4693b9d10586ece6a764.app.workbuddy.link
```

嫌太长可以用短链（已建好，301 永久重定向到上面的地址）：

```
https://tinyurl.com/2yhunzc6
```

直接发给朋友就能玩。要下线可以在 **「设置 - 数据管理 - 我发布的应用」** 里删掉。

> 短链只是转发，真正的地址还是平台生成的那个——它的子域按沙箱 ID 写死，**没法自定义**。
> 想要真正属于自己的短地址，得迁到 Cloudflare Pages / EdgeOne Pages 并绑自己的域名，见下文。

> 注意：这个链接是**部署时文件的快照**。你之后改了 `valorant-anti-flash-trainer.html`，
> 需要重新生成 `dist/index.html` 再部署一次才会同步。
>
> 同步命令：
> ```
> cp valorant-anti-flash-trainer.html dist/index.html
> ```

## 关于 Cloudflare —— 先想清楚访客在哪

**如果你和朋友都在中国大陆，Cloudflare 大概率不是最优选。**

Cloudflare 在国内没有优质节点，大陆访问经常出现：延迟 200–400ms、丢包、部分地区直接连不上。
这个游戏对延迟不敏感（纯本地鼠标操作），但**加载不出来**就没法玩了。

| 访客位置 | 推荐 |
|---|---|
| 都在国内 | 腾讯 EdgeOne Pages、腾讯云 COS 静态网站、Vercel（稍慢但稳） |
| 都在海外 | Cloudflare Pages、Netlify、GitHub Pages |
| 混合 | 国内 CDN 为主，或两边各部署一份 |

### 如果你想用 Cloudflare Pages

优点：免费额度大、全球 CDN、自带 HTTPS、连 Git 后推送自动重新部署。

两种方式：

**A. 连 Git（推荐，改完自动更新）**

1. 把这个项目推到 GitHub
2. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git
3. 选中仓库，构建配置留空（纯静态，不需要构建命令）
4. Build output directory 填 `dist`
5. 保存即部署，之后每次 `git push` 自动更新

**B. 用 wrangler 直接上传（不用 Git）**

```bash
npm i -g wrangler
wrangler login
npx wrangler pages deploy dist --project-name=anti-flash-trainer
```

首次会让你选项目名称，之后每次更新都跑最后一行。

### 如果用腾讯 EdgeOne Pages（国内更快）

1. 在 `dist/` 准备好文件
2. 打开 EdgeOne Pages 控制台，选「直接上传」
3. 把 `dist/` 整个目录拖进去
4. 拿到 `*.edgeone.app` 的链接

## 换音需要注意

`sfx/` 目录里的音频**不会自动跟着部署**，需要一起放进 `dist/sfx/`：

```
cp sfx/*.mp3 dist/sfx/
```

再重新部署。浏览器加载音效受同源策略影响，部署到线上反而比 `file://` 本地打开更省事，
不会有本地文件读不到的问题。
