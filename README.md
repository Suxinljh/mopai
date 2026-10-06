# 墨排 · WeChat MD Studio

公众号 Markdown 排版工具。左侧写 Markdown，右侧 375 / 677 实时预览，三套主题一键切换，一键复制富文本进公众号后台。

线上地址：<https://mopai.yoru-and-akari.dev>

## 核心设计

语义与视觉分离，这条线不能破：

```
Markdown → 语义 AST（src/lib/parse.ts）→ 主题模板（src/lib/themes.ts）→ 全内联样式 HTML
```

新增一套主题 = 在 `src/lib/themes.ts` 加一个 `Theme` 对象，解析层和已有稿件零改动。

## 公众号专用语法

| 语法 | 效果 |
|---|---|
| `==重点==` | 关键词标记 |
| `## KICKER \| 标题` | 章节标题，序号自动编号 |
| `> 金句卡片` | 金句卡片 |
| `:::quote` … `:::` | 引文框 |
| `:::center` … `:::` | 居中强调句 |
| `![图注](src)` | 图片；`src` 留空 = 占位，图号自动编排 |
| `:::carousel 4:3 标题` … `:::` | 轮播，内部每行一张 `![](…)` |
| `@signature` | 署名块 |
| front matter `titles` / `cover` | 标题候选与封面建议，只进侧栏，不进正文 |

### 轮播画幅比例

`:::carousel` 后面可以跟一个比例：`4:3`（默认）、`3:4`、`16:9`、`9:16`、`1:1`。省略就用 4:3，老稿件不用改。

一个轮播里所有图片必须同比例——混比例就不叫统一了。所以流程是：在轮播里点第一张图的「上传」，先选比例，图片会**在浏览器里居中裁切**成该比例再上传，之后这个轮播里剩下的图自动沿用同一比例。

裁切发生在上传前，因为公众号会丢掉 `object-fit` 和固定高度那类"假装统一"的写法。真正进 R2 的已经是裁好的图，正文里按属性给出确定宽高，微信把宽度压小后高度按固有比例走，画框比例任何宽度下都不变。

裁掉的部分不保留。想换比例要重新上传原图——这是刻意的取舍，换的是存储干净。

## 图片链路

```
上传（编辑器拖拽 / 右侧素材清单按钮）
  → tRPC storage.upload → mopai-images Worker → R2 桶 mopai-assets
  → Markdown 回填 img:<key>
渲染时 resolveImg 把 img:<key> 展开为 https://mopai.yoru-and-akari.dev/api/img/<key>
  → 站点 302 → https://mopai-img.yoru-and-akari.dev/img/<key>（R2 真图）
```

复制/导出的 HTML 里是**稳定绝对地址**，微信粘贴时自行转存。key 永不过期，所以这个地址可以一直用。

## 部署形态

| 部件 | 位置 |
|---|---|
| 站点 | cc-tokyo-01 `/opt/mopai/app`，Node 直跑 `dist/boot.js`，监听 127.0.0.1:3100 |
| 进程 | `mopai.service`（systemd，内存上限 384M）+ `cloudflared-mopai.service` |
| 入口 | Cloudflare Tunnel → `mopai.yoru-and-akari.dev` |
| 门禁 | Cloudflare Access 邮箱验证码，策略只放行 `<ACCESS_ALLOW_EMAIL>`；`/api/img/*` 走 bypass 应用，公网可读（微信抓图需要） |
| 图片 | Worker `mopai-images` → R2 `mopai-assets`；Worker 持有 R2 binding，**服务器上不存在任何 S3 凭证** |
| 数据 | SQLite（Node 内置 `node:sqlite`），文件在 `/opt/mopai/app/data/mopai.db` |

## 稿件存储

写盘分两条路，刻意分开：

| 存在哪 | 什么时候写 | 作用 |
|---|---|---|
| 浏览器 localStorage | 每次改动 | 防丢。关页面、断电，回来内容还在 |
| 云端数据库 | 分两种，见下 | 跨设备可见 |

云端只在两种情况下写：

1. **自动同步**：这篇已经被保存过（`savedAt` 有值），编辑后 900ms 防抖更新同一条记录
2. **手动保存**：点顶栏「保存到草稿箱」，写内容并把 `savedAt` 打上时间戳

`docs.savedAt` 为 null 表示只是编辑中的工作稿。**草稿箱只列 `savedAt` 有值的**，所以自动同步的工作稿不会混进归档，一篇稿件也永远只占一条记录（不会因为多存几次就多出几条）。

- 登录后首次打开：如果云端一篇都没有、浏览器里有，会把浏览器里的一次性推上云（`docs.importLocal`），**但不会标记成已保存**——要进草稿箱得你点保存。
- 顶栏状态：`已保存` / `保存中` / `未保存`（有改动还没进草稿箱，按钮会变蓝）/ `仅本机`（未登录）。
- 未登录照样能编辑，只是内容只在这个浏览器里。

## 草稿箱

`/drafts`（顶栏「草稿箱」按钮）。按保存时间倒序列出所有保存过的文章，显示保存时间、字数、图片数、轮播数、前三个小标题。

支持：搜索标题或正文、打开继续编辑、复制 Markdown、删除。

一篇文章一条记录，没有版本历史——点保存是更新那一条，不会堆出多个版本。

## 编辑器补全

按 `Ctrl/⌘ + Space` 主动唤出，或在行首、`:::`、`@`、`#`、`>`、`![`、`==` 之后自动出现。覆盖全部公众号语法，插图模板会把光标停在图注位置。

## 素材库

`/materials`（顶栏「素材库」按钮）。看得到：

- **存储用量**：张数、总字节、上限进度条。上限由 `STORAGE_QUOTA_BYTES` 控制，默认 2 GB——R2 免费额度是 10 GB 且桶与其他项目共用。
- **没在用的旧图**：不再被任何一篇云端稿件引用的图，勾选后批量清理。删除前会把勾选列表原样回传，界面上看到的就是会被删的。
- **全部图片**：最近 200 张，标注「在用 / 没在用」，可单张删除。

删图不影响已经粘贴到公众号的文章——微信发布时已把图转存到它自己的服务器。

## 环境变量

复制 `.env.example` 为 `.env`。生产环境必需的六项：

| 变量 | 用途 |
|---|---|
| `NODE_ENV` | 生产下必须为 `production` |
| `PORT` | 默认 3100 |
| `DATABASE_URL` | `file:./data/mopai.db` |
| `ACCESS_KEY` | 站内上传口令。`openssl rand -hex 24` |
| `SESSION_SECRET` | 会话签名。`openssl rand -hex 32` |
| `IMG_BASE_URL` | 图片 Worker 地址 |
| `IMG_ADMIN_KEY` | 与 Worker secret 同值。`openssl rand -hex 32` |

## 本地开发

```bash
npm ci
cp .env.example .env      # 填好上面的变量
npm run dev               # Vite + Hono 同端口 3000
```

## 常用命令

```bash
npm run check             # tsc -b，零错误
npm run build             # 产出 dist/boot.js（自包含）+ dist/public/
npm start                 # 生产模式跑 dist/boot.js
npm run verify:themes     # 三套主题渲染 + 公众号红线校验
```

`npm run verify:themes` 会把三套主题的干净正文与预览页写到 `verify-out/`，可直接用浏览器打开检查排版。

## 部署

构建产物是自包含的，**服务器上不需要 `npm ci`**（Tokyo 机器只有 2 GB 内存，装依赖会 OOM）：

```bash
# 本地
npm run build
tar -czf /tmp/mopai-release.tar.gz dist
scp /tmp/mopai-release.tar.gz cc-tokyo-01:/tmp/

# 服务器
bash scripts/server-install-release.sh
```

`scripts/` 下的脚本按用途分三类，都是幂等的：

- `cf-create-bucket.sh` / `cf-create-tunnel.sh` / `cf-create-access.sh` — Cloudflare 侧资源
- `server-bootstrap.sh` — 用户、目录、systemd 单元、cloudflared 配置
- `server-install-release.sh` — 解包、安装、重启
- `server-acceptance-test.sh` — 服务器上跑一遍上传回路验收

Cloudflare 脚本从 WSL 执行并读取 `~/.config/codex/private.env` 里的 `CLOUDFLARE_API_TOKEN`：

```bash
wsl -e bash scripts/cf-create-access.sh
```

往服务器推脚本时用 `scripts/stage-to-tokyo.sh`，不要直接用 PowerShell 管道：

```bash
wsl -e bash scripts/stage-to-tokyo.sh 'E:\...\scripts\server-install-release.sh' /tmp/install.sh
```

PowerShell 管道会把末尾换行转成 CRLF，bash 会在最后一行报 `$'\r': command not found`。上面的脚本走 Windows → WSL → ssh，字节原样过去，并在远端复查 CR 数量。

## 公众号兼容红线

改动渲染层时必须守住，`npm run verify:themes` 会逐条机器校验：

- 正文根节点唯一 `<section>`（嵌套 `<section>` 允许，顶层只能一个）
- 全内联样式；所有文字节点包在 `<span leaf="">` 里
- 不用 `class` / `id` / `<script>` / `<style>` / `<div>`
- 不用 `position:fixed|absolute|sticky`、`float`、`display:grid`、`@media`、`@keyframes`
- 卡片 / 引文框 / 轮播等盒式模块前后自动插独立空行 `<p style="margin:0;"><span leaf="">&nbsp;</span></p>`
- 无 `src` 的图片占位渲染为独立普通段落（`图N 说明`），删掉即可在公众号后台直接插图
- `img:<key>` 协议形状不变

golden 主题的每个组件样式与示范稿 `公众号排版示范稿_GoldenSample_修正版.html` 逐段一致（该文件如另有提供，以提供版本为准）。
