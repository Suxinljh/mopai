# 公众号排版助手 by Yoru

把 Markdown 写成**可以直接粘进微信公众号后台**的排版。左侧写稿、右侧 375 / 677 实时预览、
一键复制富文本；图片上传后走图床，正文里留下稳定绝对地址，微信粘贴时自行转存。

线上实例：<https://wechat.yoru-and-akari.dev>

## 它能做什么

- **两百余套排版主题**：按风格（商务 / 政务 / 科技 / 杂志 / 中国风 / 暗色 …）、复杂度、色系、
  来源项目筛选；所有主题渲染同一份样例，视觉差异直接可比。每套主题都标注原项目、原作者、
  许可证与 lineage，点「来源」可查完整署名。
- **为公众号而生的 Markdown 方言**：关键词下划线、带序号的章节标题、金句卡片、引文框、
  居中强调句、多图轮播、署名块、GFM 表格，全部映射成全内联样式的 `<section>` 结构。
- **轮播画幅真裁切**：同一轮播里的图在上传前就在浏览器里裁成统一比例（4:3 / 3:4 / 16:9 /
  9:16 / 1:1），不靠 `object-fit` 或固定高度伪造——公众号会丢掉那些写法。
- **稿件双写**：浏览器 localStorage 每次改动防丢；云端数据库跨设备可见，「保存到草稿箱」
  才进归档。草稿箱支持搜索、续写、复制 Markdown、删除。
- **素材库**：存储用量、没在用的旧图批量清理、最近 200 张图在用状态一览。
- **不用注册也不用登录**：排版、上传图片、复制、导出全都直接可用；口令只用来打开站长自己的
  云端草稿箱。匿名上传有额度与内容校验，见「公开之后靠什么挡滥用」。

## 快速开始

```bash
npm ci
cp .env.example .env      # 填好「环境变量」一节的六项
npm run dev               # 本地开发
npm run build && npm start  # 生产模式
```

## 核心设计

语义与视觉分离，这条线不能破：

```
Markdown → 语义 AST（src/lib/parse.ts）→ 主题模板（src/lib/theme-kit.ts）→ 全内联样式 HTML
```

主题库由 `scripts/themes/import.ts` 从多个开源项目聚合生成（`src/lib/themes-imported/`），
来源、授权与移植损耗的完整审计见 [`THEME-SOURCES.md`](./THEME-SOURCES.md)。

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
渲染时 resolveImg 把 img:<key> 展开为 https://wechat.yoru-and-akari.dev/api/img/<key>
  → 站点 302 → https://mopai-img.yoru-and-akari.dev/img/<key>（R2 真图）
```

复制/导出的 HTML 里是**稳定绝对地址**，微信粘贴时自行转存。key 永不过期，所以这个地址可以一直用。

## 部署形态

| 部件 | 位置 |
|---|---|
| 站点 | cc-tokyo-01 `/opt/mopai/app`，Node 直跑 `dist/boot.js`，监听 127.0.0.1:3100 |
| 进程 | `mopai.service`（systemd，内存上限 384M）+ `cloudflared-mopai.service` |
| 入口 | Cloudflare Tunnel → `wechat.yoru-and-akari.dev` |
| 门禁 | **站点公开**，谁都能打开用；`ACCESS_KEY` 只决定谁能用云端草稿箱。曾经的 Cloudflare Access 邮箱验证已于 2026-10-08 撤掉（当时借已登录的 dashboard 会话删的，因为本机 token 只读；`scripts/cf-open-public.sh` 是可复现路径），要关回去跑 `scripts/cf-create-access.sh` |
| 图片 | Worker `mopai-images` → R2 `mopai-assets`；Worker 持有 R2 binding，**服务器上不存在任何 S3 凭证** |
| 数据 | SQLite（Node 内置 `node:sqlite`），文件在 `/opt/mopai/app/data/mopai.db` |

### 公开之后靠什么挡滥用

站点没有门禁、上传不用登录，所以防护是分层的，每一层都写清楚它挡什么：

| 层 | 措施 | 位置 |
|---|---|---|
| 应用 | 每 IP 每分钟 12 次上传（内存计数，重启即清） | `api/lib/burst.ts` |
| 应用 | 每访客滚动 24 小时 30 张 / 100 MB | `api/lib/anon-quota.ts` |
| 应用 | 全部匿名上传合计 1.5 GB 封顶 | 同上，`ANON_TOTAL_BYTES` |
| 应用 | 只认字节头是 jpeg / png / gif / webp 的图；**对外提供的 Content-Type 由字节决定，不信请求头** | `api/lib/image-type.ts` |
| 应用 | 匿名图片按访客 Cookie 的哈希归属，别人列不出也删不掉 | `api/lib/visitor.ts` |
| 边缘 | 高威胁分数请求走 managed challenge、扫描器 UA 直接拦、路径穿越与危险方法拦掉 | zone 上已有的 WAF 自定义规则 |
| 边缘 | AI 爬虫保护 = block | Cloudflare 账户设置 |

三条刻意**没做**的，别当成遗漏：

- **Bot Fight Mode 不开**。它按 zone 拦已知机器人，而微信抓图的服务端客户端正是这种机器人——开了会导致粘贴到公众号的文章图片全丢。
- **不占 Cloudflare 速率限制规则**。免费计划每个 zone 只有 1 条，已经被同 zone 的另一个项目用掉了；上传的防洪改由上面的应用层承担。
- **Turnstile 先不接**。它免费且不限量，是下一层该加的东西，但验证失败会让大陆访客彻底传不了图，所以等到配额被证明太松再加。

`scripts/cf-open-public.sh` 负责开：撤掉 Access 应用，并把本站域名加进 zone 上那条已有的高威胁分数规则（免费计划只有 5 条自定义规则，已经用满，所以是**并入**而不是新增）。三种模式：

```bash
export CLOUDFLARE_API_TOKEN=...   # 需要 Zone→Rulesets Edit + Account→Access Edit
bash scripts/cf-open-public.sh --check   # 只读，看现在是什么
bash scripts/cf-open-public.sh --plan    # 算出要改成什么，不发请求
bash scripts/cf-open-public.sh           # 执行
```

要重新关回门禁：`bash scripts/cf-create-access.sh`（会重建 Access 应用与 `/api/img/*` 的 bypass）。

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
- 未登录照样能编辑、上传图片、复制和导出，只是稿件内容留在这个浏览器里；云端草稿箱才需要口令。

## 草稿箱

`/drafts`（顶栏「草稿箱」按钮）。按保存时间倒序列出所有保存过的文章，显示保存时间、字数、图片数、轮播数、前三个小标题。

支持：搜索标题或正文、打开继续编辑、复制 Markdown、删除。

一篇文章一条记录，没有版本历史——点保存是更新那一条，不会堆出多个版本。

## 编辑器补全

按 `Ctrl/⌘ + Space` 主动唤出，或在行首、`:::`、`@`、`#`、`>`、`![`、`==` 之后自动出现。覆盖全部公众号语法，插图模板会把光标停在图注位置。

## 素材库

`/materials`（顶栏「素材库」按钮）。看得到：

- **存储用量**：登录时显示张数、总字节与上限进度条，上限由 `STORAGE_QUOTA_BYTES` 控制，默认 2 GB——R2 免费额度是 10 GB 且桶与其他项目共用。未登录时这里换成「这台浏览器上传的图」，列出本浏览器的张数、字节和 24 小时额度。
- **没在用的旧图**：不再被任何一篇云端稿件引用的图，勾选后批量清理。删除前会把勾选列表原样回传，界面上看到的就是会被删的。未登录时判据只有浏览器里的本地稿件（云端稿件本来也读不到）。
- **全部图片**：最近 200 张，标注「在用 / 没在用」，可单张删除。

匿名上传的图片归属那个浏览器 Cookie（服务端只存它的哈希），清掉站点数据就再也列不出来——但已经回填进正文的 `img:<key>` 地址照旧可用，key 不会失效。

删图不影响已经粘贴到公众号的文章——微信发布时已把图转存到它自己的服务器。

## 环境变量

复制 `.env.example` 为 `.env`。生产环境必需的六项：

| 变量 | 用途 |
|---|---|
| `NODE_ENV` | 生产下必须为 `production` |
| `PORT` | 默认 3100 |
| `DATABASE_URL` | `file:./data/mopai.db` |
| `ACCESS_KEY` | 站长口令：登录后才有云端草稿箱。**上传图片不需要它**。`openssl rand -hex 24` |
| `SESSION_SECRET` | 会话签名。`openssl rand -hex 32` |
| `IMG_BASE_URL` | 图片 Worker 地址 |
| `IMG_ADMIN_KEY` | 与 Worker secret 同值。`openssl rand -hex 32` |

可选项，用来收紧「不登录也能上传」的额度（默认值就是线上跑的）：

| 变量 | 默认 | 含义 |
|---|---|---|
| `ANON_DAILY_IMAGES` | 30 | 每个访客（按浏览器 Cookie 认）滚动 24 小时内的张数 |
| `ANON_DAILY_BYTES` | 100 MB | 同上，字节数 |
| `ANON_TOTAL_BYTES` | 1.5 GB | 所有匿名上传加起来的总上限——桶是共享免费额度 |
| `ANON_BURST_PER_MINUTE` | 12 | 每个来源 IP 每分钟，内存计数，用来挡住灌水 |

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
npm run verify:themes     # 全部主题渲染 + 公众号红线 + catalog 完整性/许可证校验
npm test                  # vitest：解析、渲染、上传额度、数据库升级
node scripts/cdp-verify-public-access.mjs http://127.0.0.1:3201 9335
                          # 真浏览器验收：以「从未登录的访客」身份走一遍上传全链路
```

`npm run verify:themes` 会把每套主题的干净正文与预览页写到 `verify-out/`，可直接用浏览器打开检查排版；同时校验 catalog 里每套主题的来源档案齐全、许可证文件真实存在。

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

- `cf-create-bucket.sh` / `cf-create-tunnel.sh` / `cf-create-access.sh` / `cf-open-public.sh` — Cloudflare 侧资源与门禁开关
- `server-bootstrap.sh` — 用户、目录、systemd 单元、cloudflared 配置
- `server-install-release.sh` — 解包、安装、重启
- `server-acceptance-test.sh` — 服务器上跑一遍上传回路验收

Cloudflare 脚本要一个**有写权限**的 token（`Zone → Rulesets Edit`、`Account → Access → Apps and Policies Edit`），自己 export 进环境：

```bash
export CLOUDFLARE_API_TOKEN=...
bash scripts/cf-open-public.sh --check
```

只读 token 不会报「权限不足」，而是写操作统一返回 **HTTP 405 / 错误码 10405 `Method not allowed for this authentication scheme`**——看到它就说明该换 token 了。

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

## 许可证与第三方主题署名

本仓库以 **AGPL-3.0-or-later** 授权，正文见根目录 `LICENSE`。线上服务按 AGPL 第 13 条
向使用者提供完整对应源码：仓库公开、部署分支可对应到公开提交即满足；在仓库公开之前
部署含 copyleft 主题的构建，属于尚未履行该义务的状态。

主题库聚合了多个开源项目，共 219 套。每套主题在模板库卡片上点「来源」可看到原项目、
原作者、许可证、lineage 与移植改动；上游许可证原文留存在 `app/licenses/`；完整来源审计、
未接入清单与移植中的有损转换见 [`THEME-SOURCES.md`](./THEME-SOURCES.md)。

按上游许可证分组：MIT 207 · AGPL-3.0-or-later 6 · GPL-3.0-only 2 · Apache-2.0 1 · 本项目自研 3。

- 6 套 gzh-design-skill 主题（AGPL-3.0-or-later）与 2 套 mdnice 派生主题（GPL-3.0-only）
  是本仓库选择 AGPL 的直接原因：前者有传染性且第 13 条覆盖网络服务，后者依
  AGPL 第 13 条第二段允许与 AGPL 作品组合。
- MIT / Apache-2.0 / WTFPL 来源可单向并入 AGPL 项目，各自的版权声明与许可文本已按要求保留。
