# 自定义音效目录

把音频文件放进这个文件夹，刷新页面（重新打开 HTML）即可替换内置的 WebAudio 合成音。
**文件缺失时自动回退到合成音，不会报错。**

## 支持格式

`mp3` / `wav` / `ogg` / `m4a` —— 同名文件按这个顺序查找，找到第一个能播的就停。

## 命名规则

先找**特工专属名**，找不到再找**通用名**，都没有才用内置合成音。

### 通用名

| 文件名 | 触发时机 |
|---|---|
| `throw` | 闪光出手 |
| `pop` | 闪光引爆 |
| `charge` | 布雷奇墙面充能预警 |
| `beep` | 恺闪光弹飞行滴答 |
| `hit` | 命中靶球 |
| `miss` | 打空 |
| `dodge` | 成功躲闪 |
| `breakEye` | 击毁蕾娜致盲之眼 |
| `over` | 靶点超时 |

### 特工专属名

`<特工>_<动作>`，特工名为 `phoenix` / `skye` / `breach` / `kayo` / `yoru` / `reyna`，
动作为 `throw` / `pop`，另外 `kayo_beep`、`breach_charge` 也支持。

例如：

```
sfx/
  phoenix_pop.mp3      菲尼克斯曲球引爆
  phoenix_throw.mp3    菲尼克斯出手
  skye_pop.wav         斯凯飞鸟引爆
  breach_charge.mp3    布雷奇墙面充能
  kayo_beep.mp3        恺飞行滴答
  reyna_pop.mp3        蕾娜之眼引爆
  hit.mp3              所有命中共用
```

## 去哪里弄这些音频

这个目录**不附带任何音频文件**。游戏原声属于 Riot Games 的版权内容，不建议也不方便从网上抓取。
下面是**从你自己电脑上已安装的客户端里提取**的做法，仅供个人练习使用，请勿传播提取出的文件。

### 用 FModel 从本地客户端解包

1. 下载 [FModel](https://fmodel.app)（免费，专门用于解包 UE4/UE5 资源）
2. 首次启动设置游戏目录，指向你本地的 VALORANT 安装路径，通常类似：

   ```
   C:\Riot Games\VALORANT\live\ShooterGame\Content\Paks
   ```

   版本选 UE4.27 左右，让 FModel 自动检测也行。

3. 在 FModel 里按关键字定位音频资产：

   | 想找的音 | 搜索关键字 |
   |---|---|
   | 菲尼克斯曲球 | `Curveball` |
   | 斯凯飞鸟 | `GuidingLight` / `Skye` |
   | 布雷奇闪光点 | `FlashPoint` / `Breach` |
   | 恺闪光驱动 | `KAYO` / `FlashDrive` |
   | 夜露致盲球 | `Yoru` / `Blindside` |
   | 蕾娜之眼 | `Leer` / `Reyna` |

   音频一般在 `.uasset` / `.uexp` 里，是 Wwise 的 `.wem` 容器。

4. 导出音频：用 `vgmstream-cli` 或 `ww2ogg` 把 `.wem` 转成 `wav`，需要的话再压成 `mp3`。

   ```
   vgmstream-cli -o out.wav input.wem
   ```

5. 按上面的命名表重命名，丢进这个目录，刷新页面。

### 更省事的办法

不想折腾解包就直接录，这是**推荐路线**：

1. 开着游戏进训练场，把要用的技能挨个放一遍，每个之间停一下
2. 用 OBS（音源选「桌面音频」或「应用程序音频捕获」）或系统录音录下来
3. 转成 wav：

   ```
   ffmpeg -i 录音.m4a -ac 1 -ar 44100 -sample_fmt s16 录音.wav
   ```

4. 用本目录里的脚本按静音自动切成一段段：

   ```
   python split-recorded.py 录音.wav clips
   ```

   它会打印每段的起点和时长，照你录制时的顺序重命名成 `phoenix_pop.wav` 之类的名字，
   放回这个目录即可。切得不对就调 `--threshold`（底噪大调小、录得干净调大）
   或 `--gap`（技能间隔太近调大）。

缺点是会混进环境音，但在这个练习器里听起来差别不大。

### 确认是否生效

侧栏「辅助」区底部会显示当前载入状态：显示「自定义音效 N 个已载入」说明生效了，
显示「使用内置合成音」说明没找到文件。

## 排错

- 改完文件一定要**刷新页面**，游戏只在启动时扫描一次目录
- 用 `file://` 直接打开 HTML 时，浏览器对本地文件有安全限制；若一直显示「使用内置合成音」，
  在本目录起一个静态服务器再访问，例如：

  ```
  python -m http.server 8000
  ```

  然后浏览器打开 `http://localhost:8000/valorant-anti-flash-trainer.html`
- 音频太吵可调小文件本身的音量，游戏不做额外增益
