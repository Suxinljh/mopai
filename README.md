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
| `:::carousel 标题` … `:::` | 轮播，内部每行一张 `![](…)` |
| `@signature` | 署名块 |
| front matter `titles` / `cover` | 标题候选与封面建议，只进侧栏，不进正文 |

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

稿件正文仍存在**浏览器 localStorage**，不跟账号走。

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
