# 公众号排版助手 by Yoru · 接手提示词（给下一个 AI）

> 用法：把本文件整段贴给另一个窗口的 AI，或让它先读这个文件再动手。

---

你是接手「公众号排版助手 by Yoru」（曾用名「墨排」，公众号 Markdown 排版工具，准备开源）的本地 Agent。它**已经上线并在正常使用**，线上地址 <https://wechat.yoru-and-akari.dev>（旧域名 mopai.yoru-and-akari.dev 已于 2026-10-07 下线）。你的任务是**找 bug、做优化**，不是重写。

先通读本文件，再读代码。**不要凭空假设结构。**

**先说最重要的一条工作方式**：这个项目前一轮交了三轮才把功能做对，原因全都一样——**靠读代码推理，而不是把界面真跑起来看**。所以：

> **改任何前端行为，必须在真实浏览器里点一遍再交付。** 用无头 Chrome + CDP 驱动真实应用（本文件末尾有可复制的脚本骨架），不要只跑 tsc 和单元测试就说"好了"。前一轮的假绿就是这么来的。

---

## 一、项目位置与环境

```
仓库根目录：<umbrella repo root>   ← git 仓库（伞仓库）
应用代码：  <umbrella repo root>\app   ← npm/构建/部署都在这里跑
```

**仓库结构（2026-10-07 变更）**：app 原本是独立 git 仓库（项目最早只有它，`git init` 在 app/ 里）；为了让 harness 能在父目录层级建分支并行开发，仓库已上移到父目录——app/ 的**全部提交历史原样保留**（hash 不变，作为 merge commit `767661c` 的第二父）。app/.git 已删除，现在全目录只有一个 `.git`（父目录）。旧 .git 备份在 `<local archive>\app-git-backup-20261007\`（确认稳定后可删）。父目录下还有 signin/、vote-slider/、媒体拼图/ 等小项目，已一并纳入版本管理。

品牌：产品名「公众号排版助手」、署名「by Yoru」，常量在 `app/src/lib/brand.ts`；logo 是 YORU 设计系统的月相行「新月-上弦-满月-下弦」（`app/src/components/YoruMark.tsx`，3b 变体，满月用品牌靛青 #2E4A68），favicon 是弦月（`app/public/favicon.svg`）。localStorage key 沿用历史前缀 `mopai.*`（内部标识，用户不可见，不要改，改了丢老数据）。

### 多 AI 并行纪律（分支/worktree 都在这个伞仓库上开）

harness 会在父仓库自建分支或 worktree。并行干活必须遵守：

1. **工作目录**：不管哪棵树、哪个分支，npm 命令（check/build/test/CDP）都在其 `app/` 子目录里跑。新 worktree 建好后要在其 `app/` 里 `npm ci`，并从主工作区复制 `app/.env`（gitignore 不随仓库走）。
2. **端口错开**：本地测试服与 CDP 调试端口不能撞车。主工作区用 `PORT=3200` + CDP `9333`；第二棵树用 `PORT=3201` + CDP `9334`（CDP 脚本接受端口参数或改文件内常量）。测试数据库按惯例用环境变量覆盖成独立文件（`DATABASE_URL=file:./data/test-xxx.db`），绝不共享。
3. **部署只许从 master 主工作区执行**：线上只有一个。功能在分支上验证全绿（check + verify:themes + test + CDP）后合回 `master`，由主工作区统一构建、scp、`install.sh`。分支上的人不碰服务器。
4. **合并顺序**：分支开工前先 `git merge master` 同步；交付在分支上提交，回合由主工作区执行，冲突按功能归属取舍。

- Node 20+（本机 v24），`npm ci` 装依赖
- `.env` 从 `.env.example` 复制（`.env` 已被 gitignore，**永远不要提交**）
- 常用命令：
  - `npm run check` — tsc，必须 0 错误
  - `npm run build` — 产出 `dist/boot.js`（自包含）+ `dist/public/`
  - `npm run verify:themes` — 111 项离线校验（主题红线、比例、删除、驱动契约）
  - `npm run import:themes` — 从上游克隆重新生成 `src/lib/themes-imported/`（上游位置见 THEME-SOURCES.md）
  - `node scripts/cdp-verify-theme-library.mjs <url> <key> 9334` — 模板库页的真实浏览器验收
  - `npm run dev` — 本地开发

本地身份可以随便填，`ACCESS_KEY` / `SESSION_SECRET` 用 `.env.example` 里的占位值即可。

---

## 二、它在做什么

左侧 CodeMirror 6 写 Markdown，右侧 375/677 实时预览，三套主题一键切换，一键复制富文本进公众号后台。

### 根本设计（改动时不得破坏）

```
Markdown → 语义 AST（src/lib/parse.ts）→ 主题模板函数（src/lib/themes.ts）→ 全内联样式 HTML
```

**新增主题 = 加一个 Theme 对象**，解析层和已有稿件零改动。这条线是这个项目存在的理由，别绕过去在解析层塞视觉判断。

主题库在 2026-10-07 扩成多来源聚合（219 套），分层如下，改主题相关代码先看清归属：

| 文件 | 职责 |
|---|---|
| `src/lib/theme-kit.ts` | Theme 契约、渲染原语（esc / carouselFrame / baseTableBlock / makeCarousel / makeImageBlock）、微信红线消毒 `sanitizeStyle`、由样式规格装配 Theme 的 `buildTheme` |
| `src/lib/theme-meta.ts` | 分类维度（风格标签 / 复杂度 / 色系）与来源档案类型；许可证白名单 |
| `src/lib/themes.ts` | 三套自研主题 + `THEMES` 总注册表 |
| `src/lib/themes-extra.ts` | 六套 gzh-design-skill 移植主题（AGPL，见 THEME-SOURCES.md） |
| `src/lib/themes-imported/*.ts` | **生成物**，由 `npm run import:themes` 产出，不要手改 |
| `scripts/themes/import.ts` + `scripts/themes/lib/*` | 各来源的 importer：抽取 → 归一 → 色板反推 → 分类推导 → 落盘 |

每套 Theme 必须带 `meta`（风格标签、复杂度、色系、来源项目/作者/仓库/许可证/署名/lineage）。
`npm run verify:themes` 会校验 catalog 完整性与许可证文件存在性——**新加主题不写 meta 过不了校验**，这是刻意的。
来源审计、未接入清单与「应用整体许可证」的待拍板事项都在 `THEME-SOURCES.md`。

### 自研公众号语法

| 语法 | 效果 |
|---|---|
| `==重点==` | 关键词下划线标记 |
| `## KICKER \| 标题` | 章节标题，序号自动编号 |
| `> 金句卡片` | 金句卡片 |
| `:::quote` … `:::` | 引文框 |
| `:::center` … `:::` | 居中强调句 |
| `![图注](src)` | 图片；`src` 留空 = 占位，图号自动编排 |
| `:::carousel 4:3 标题` … `:::` | 轮播；比例可省略，默认 4:3 |
| GFM 表格（`\|` 分隔，支持 `:---` 逐列对齐） | 真 `<table>`，逐列对齐落到单元格 |
| `@signature` | 署名块 |
| front matter `titles` / `cover` | 只进侧栏，不进正文 |

### 图片链路

```
上传（编辑器拖拽 / 侧栏素材清单按钮）
  → 浏览器内裁切（可选：自动居中裁切 or 手动拖拽裁切）
  → tRPC storage.upload → mopai-images Worker → R2 桶 mopai-assets
  → Markdown 回填 img:<key>
渲染时 resolveImg 把 img:<key> 展开为 `<当前访问域>/api/img/<key>`（`window.location.origin`，无硬编码域名，换域不用改代码）
  → 站点 302 → https://mopai-img.yoru-and-akari.dev/img/<key>（R2 真图）
```

`img:<key>` 是内部协议，**渲染前必须过 `resolveImg`**（轮播的 items 曾经漏了，整条轮播裂图）。

### 稿件与草稿箱

| 存哪 | 什么时候写 |
|---|---|
| 浏览器 localStorage | 每次改动（防丢，纯本地） |
| 云端数据库 | 只在该稿件**已经保存过**（`docs.savedAt` 有值）时随改动更新 |
| 云端 + 打 `savedAt` 时间戳 | **只有点顶栏「保存到草稿箱」** |

`docs.savedAt` 为 null = 编辑中的工作稿，不进草稿箱。一篇稿件一条记录，**没有版本历史**（这是用户明确的选择）。

---

## 三、部署形态（这些细节踩过坑，照做）

| 部件 | 位置 |
|---|---|
| 站点 | cc-tokyo-01 `/opt/mopai/app`，Node 直跑 `dist/boot.js`，监听 **127.0.0.1:3100** |
| 进程 | `mopai.service`（systemd，内存上限 384M，实测吃 ~35MB）+ `cloudflared-mopai.service` |
| 入口 | Cloudflare Tunnel → `wechat.yoru-and-akari.dev`，tunnel id `1c05edf4-f1f1-4156-9aa2-8a1ddca0fa14`（ingress 在服务器 `/etc/cloudflared/mopai.yml`） |
| 门禁 | Cloudflare Access 邮箱验证（只放行仓库所有者的邮箱，168h 会话；具体地址不进仓库） |
| 图片公网读 | 独立 Access 应用放行 `wechat.yoru-and-akari.dev/api/img/*`（**微信抓图必须能匿名访问**，否则粘贴到公众号后图全丢）。换域名时这条必须同步改，Zero Trust → Access → Applications |
| 图片存储 | Worker `mopai-images` → R2 `mopai-assets`；Worker 持有 R2 binding，**服务器上不存在任何 S3 凭证** |
| 数据 | SQLite，`/opt/mopai/app/data/mopai.db` |
| SSH | `ssh cc-tokyo-01` |
| Cloudflare token | WSL 里 `~/.config/codex/private.env` 的 `CLOUDFLARE_API_TOKEN`，**不要硬编码、不要提交** |

### 部署流程（**服务器上不要跑 npm ci**，2GB 内存会 OOM）

```powershell
# 本地
npm run build
tar -czf $env:TEMP\mopai.tar.gz dist
scp $env:TEMP\mopai.tar.gz cc-tokyo-01:/tmp/mopai-release.tar.gz

# 服务器
ssh cc-tokyo-01 'bash /tmp/install.sh'
```

`scripts/server-install-release.sh` 就是那个 install 脚本（解包 → 装到 /opt/mopai/app → **restart** → 健康检查）。

**部署后必须核对**：本地与线上的 `dist/boot.js` sha256、以及 `dist/public/index.html` 引用的 js/css 文件名是否一致。前一轮出现过"以为部署了、其实服务器还在跑旧包"。

### 公开仓库与发布流水线

公开仓库：<https://github.com/yoruuuchan/wechat-md-studio>（master，AGPL-3.0-or-later，
`src/lib/brand.ts` 的 `REPO_URL` 已指向它，顶栏 GitHub 图标因此出现）。
**伞仓库继续私有，是唯一事实来源**；公开仓库只装 app 子树，不含 signin/、vote-slider/、
媒体拼图/、WTO 报道文件与那批大二进制。

公开历史的形状：app 原始仓库的 31 个提交（合并提交 `767661c` 的第二父链）+ 伞时代触及
`app/` 的提交 + 一个补 LICENSE 的提交。全量重建步骤（幂等，约半分钟）：

```bash
# 在伞仓库里
SP=$(git rev-parse 767661c^2)
git format-patch --binary 767661c..HEAD -- app/   # 补丁会落在仓库根，记得移走
# 在构建目录里（<local workspace>/Projects/wechat-md-studio 是现成的克隆，remote 已指向公开仓库）
git init && git fetch <伞仓库路径> $SP && git reset --hard FETCH_HEAD
git am -p2 <那些补丁>                              # -p2 剥掉 a/app/ 前缀
git rev-parse HEAD^{tree}                          # 必须等于伞仓库的 git rev-parse HEAD:app
python -m git_filter_repo --force \
  --replace-text  <伞根>/publish-scrub-expressions.txt \
  --replace-message <伞根>/publish-scrub-expressions.txt
# 补一个 LICENSE 提交，然后 push
```

`publish-scrub-expressions.txt` 在**伞仓库根目录**（刻意放在 app/ 之外，不进公开仓库）：
它把个人邮箱、真实姓名、WSL 用户名与本机路径从全部历史里替换成占位符。
新增敏感串时先加进这张表再重发布。

**红线：全量重建会改写公开历史，只有在确认还没有外部 clone/fork 时才允许 force push。**
一旦有了外部克隆者，停止重建，改为在公开仓库里直接接收提交（伞仓库退居归档），
或从伞仓库 cherry-pick。

### ⚠️ 往服务器推脚本的坑

**不要用 PowerShell 管道推脚本**——它会把末尾换行变成 CRLF，bash 会在最后一行报 `$'\r': command not found`。

用 `scripts/stage-to-tokyo.sh`，且**必须在 WSL 里跑**：

```powershell
wsl -e bash -lc "bash '<umbrella repo root>/app/scripts/stage-to-tokyo.sh' '<脚本的 /mnt/e/... 路径>' /tmp/xxx.sh"
```

### 服务器上的验收脚本

`/opt/mopai/scripts/` 下有三套，`verify-all.sh` 一次跑完：

- `server-acceptance-test.sh` — 站点可达、登录、上传、公网 302→200、未登录被拦
- `server-e2e-check.sh` — 图片全链路（上传→公网取回→删除）
- `server-round2-check.sh` — 稿件 CRUD、草稿箱语义、存储统计、孤儿图清理

改了 API 或数据结构后，**改完必须重跑并让 exit code 保持 0**。

---

## 四、绝对不能破坏的约束（验收红线）

这些都是公众号平台的硬要求，破坏了粘贴到公众号会掉样式或裂图：

- 正文根节点唯一 `<section>`（**嵌套 section 允许**，顶层只能一个）
- 全内联样式；所有文字节点包 `<span leaf="">`
- 不用 `class` / `id` / `<script>` / `<style>` / `<div>`
- 不用 `position:fixed|absolute|sticky`、`float`、`display:grid`、`@media`、`@keyframes`
- 盒式模块（卡片 / 引文框 / 轮播）前后必须有独立空行 `<p style="margin:0;"><span leaf="">&nbsp;</span></p>`
- 无 src 的图片占位渲染为独立普通段落（`图N 说明`），删掉即可在公众号后台直接插图
- 轮播里所有图必须同比例——**比例靠上传前真实裁切保证**，不许用 `object-fit` / 固定高度 / 留白补框伪造
- `img:<key>` 协议形状不变

`npm run verify:themes` 会机器校验以上大部分，**每次改渲染层都要跑**。

---

## 五、已经踩过的坑（别再踩）

1. **drizzle 的关系查询 `findFirst` 在这个驱动上根本不能用。** 关系层按列名取字段，而 `drizzle-orm/sqlite-proxy` 给的是按位置的值数组 → `findFirst` 必然返回空值。**用普通 `select().limit(1)`**。三处调用已经改过，`api/queries/connection.ts` 顶部有注释说明。
2. **sqlite 驱动的命/未命中契约**：`get` 命中要返回 `Object.values(row)`，未命中要返回 `undefined`。返回 `[]` 会让 drizzle 把它读成"一行全 null"，于是「先查再插」永远以为记录已存在、静默不插入。
3. **`DialogContent` 没有 max-height 和滚动**（`src/components/ui/dialog.tsx`）。弹窗比窗口高时上下被裁且够不到。现有两个弹窗自己加了 `max-h-[90vh] overflow-y-auto` 和吸底按钮——**新加弹窗要注意同样问题**。
4. **`react-easy-crop` 的样式表必须手动 import**（`import 'react-easy-crop/react-easy-crop.css'`），否则裁切框不可见。
5. **tRPC 的错误是 HTTP 200 + error 信封**，`curl | head -c` 会吞掉信号。测试脚本要显式检查有没有 `result` 信封、有没有 `NaN`。
6. **会话 cookie 是 `Secure`**，本地/服务器上用纯 HTTP 测试时 curl 的 cookie jar 会静默丢弃它——改成手工捕获 `set-cookie` 头回放。
7. **round2 验收脚本**断言的是"增量"而不是绝对值（别的脚本会留下自己的测试图），并且预清理只删**它自己生成的文件名**。别改成"把现有的都删掉"——前一轮就是这样误删了用户的真实上传。
8. **服务器数据库里有一篇示例稿**（`<SAMPLE_COMPANY>生态稿 · 示例`），`savedAt` 为 null。别在诊断时对它跑无差别 DELETE。

---

## 六、已知但**没修**的问题（建议从这里开始）

> 2026-10-06 更新：撤销删除、删稿复活竞态、轮播批量传图定位、编辑器快捷键、Home.tsx 残留已修（`scripts/cdp-verify-round5.mjs` 是验收脚本）。另外 **`docs.save` 现在是 update-only**：新行只能走 `saveToDrafts` / `importLocal`，别给 `save` 加回 insert 分支——那是删稿复活的闸门。
>
> 2026-10-07 更新（主题库分支）：修掉 `src/lib/parse.ts` 的 `walkInline` 状态恢复 bug——
> 关闭行内标记时用 `Object.assign(flags, stack.pop())` 恢复，空快照不会清掉已置位的键，
> 导致**加粗/下划线/斜体在标记结束后泄漏到同段剩余文字**（线上一直存在，截图可见整段被划线）。
> 现改为整体换回快照，回归测试在 `src/lib/parse.test.ts`。
>
> 2026-10-07 发现但**没修**（属编辑器分支的文件范围）：`src/components/EditorPane.tsx` 的
> `buildDeco` 给 `Decoration.line()` 传了 `(line.from, line.to)`，而 CodeMirror 要求行装饰区间
> 零长度，于是任何含 front matter / `:::` / `@signature` 的稿件每次更新都抛
> `RangeError: Line decoration ranges must be zero-length`。CodeMirror 会吞掉异常，
> 编辑器仍可用，但**语法高亮静默失效**。修法是把四处 `to: line.to` 改成 `to: line.from`。
> 主题库分支的 CDP 验收对它单独归因，不算主题库的失败。
>
> 2026-10-07 更新：更名「公众号排版助手 by Yoru」+ Yoru 阴文印 logo + 弦月 favicon（`src/lib/brand.ts`、`src/components/YoruMark.tsx`）；新增模板专区页 `/themes`（`src/pages/Themes.tsx`，验收 `scripts/cdp-verify-rebrand.mjs`）；前端按设计系统铁律进一步内凹化（carriers 用 `ya-well`/inset，`ya-selected` 自带 sunken 底+1.5px 描边）；域名从 mopai 切到 wechat（Tunnel ingress + DNS + Access 放行三处都要动）。同日晚些时候 `/themes` 升级为多来源模板库（见上表与 THEME-SOURCES.md）。

### 产品方向（用户明确拍板的）

- **准备开源**：功能完善后开源，GitHub 仓库地址定了之后填进 `src/lib/brand.ts` 的 `REPO_URL`（顶栏 GitHub 图标自动出现）。
- **许可证已定（2026-10-07）**：仓库整体 **AGPL-3.0-or-later**。三处声明：根目录 `LICENSE`、
  `app/package.json` 的 `license` 字段、`app/README.md` 的「许可证与第三方主题署名」章节。
  选它是因为主题库含 6 套 AGPL 与 2 套 GPL-3.0 主题（兼容性逐族核对见 `THEME-SOURCES.md` 第四节）。
  操作红线：**开源发布不得晚于部署**——AGPL 第 13 条覆盖线上服务，仓库没公开之前
  部署含 copyleft 主题的构建就是未履行源码提供义务。
- **多人登录 / 收费**：远期方向，**先不做**。现在只记录意向：等功能完善、开源之后，再考虑多用户与付费模式。届时现在的「单口令 + 单用户空间」要拆成真实账号体系，这是大工程，别提前埋半吊子抽象。

按价值排序：

### 中

1. **`storage.orphans` 不覆盖另一台设备的未同步草稿**：本地草稿 key 通过 `alsoKeep` 传，但只覆盖**本机** localStorage。另一台设备的草稿引用的图可能被误判为孤儿。要根治得让草稿也同步。

### 低

2. **没有导出/导入整包稿件**：多设备迁移或备份只能靠逐篇复制。
3. **`useDocs` 脏标记全量比较**：`lastSavedRef` 是 Map<id, content>，每次改动全量比较，稿多了可能变慢。
4. **代码块里的 `![](...)` 会被图片扫描器计数**：`scanImageOccurrences` 对原文做纯正则、不剔除 ``` 围栏，正文里贴 markdown 示例代码会让 occurrence 错位（上传回填/轮播比例可能写错位置）。概率低，修法是把 fence 区间从扫描里排除。

### 探索性

5. **轮播比例改动后，旧图需手动重裁**：现在只提示"N 张图还是旧比例"。能不能批量重裁？或自动提示？
6. **`img:` 协议跨域**：复制到公众号后，微信转存图片，但如果 R2 挂了，正文会裂图。是否有降级方案？

---

## 七、交付要求

改任何东西之后：

1. `npm run check` → 0 错误
2. `npm run verify:themes` → `ALL CHECKS PASSED`
3. **前端行为改动**：用无头 Chrome + CDP 在真实应用里点一遍，截图或贴出实测数据
4. **API / 数据改动**：在服务器上重跑 `sudo bash /opt/mopai/scripts/verify-all.sh`，exit code 必须是 0
5. 部署后核对本地与线上的文件 hash
6. `git commit`，commit message 用**英文**，写清楚"为什么"而不只是"改了什么"

**报告时区分「实测到的」和「推断的」。** 这个项目最贵的教训就是拿推断当结论。

---

## 八、无头 Chrome + CDP 骨架（可直接改用）

这是前一轮用来发现真 bug 的手段，比读代码可靠得多。

```js
import { spawn } from 'node:child_process'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'

const [appUrl, accessKey] = process.argv.slice(2)
const PORT = 9333
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-cdp-'))
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-gpu', '--window-size=1440,820', 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
async function wsUrl() {
  for (let i = 0; i < 40; i++) {
    try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl } catch {}
    await sleep(250)
  }
  throw new Error('no CDP')
}

let id = 1
function client(ws) {
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id); pending.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
    }
  })
  return (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const i = id++; pending.set(i, { resolve, reject })
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }))
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); reject(new Error('timeout ' + method)) } }, 30000)
  })
}

const ws = new WebSocket(await wsUrl())
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
const send = client(ws)
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Page.enable', {}, sessionId)
await send('Runtime.enable', {}, sessionId)
await send('DOM.enable', {}, sessionId)

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
  return r.result.value
}

await send('Page.navigate', { url: appUrl }, sessionId)
await sleep(3000)
// 在被测页面里登录（同源 fetch，避免处理 Access 与 cookie）
await evaluate(`fetch('/api/trpc/auth.login',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({json:{accessKey:${JSON.stringify(accessKey)}}})}).then(r=>r.text())`)
await send('Page.navigate', { url: appUrl }, sessionId)
await sleep(3500)

// 直接给隐藏的 file input 塞文件
async function feedFile(filePath) {
  const { root } = await send('DOM.getDocument', {}, sessionId)
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' }, sessionId)
  await send('DOM.setFileInputFiles', { nodeId, files: [filePath] }, sessionId)
  await sleep(2000)
}

// 断言示例：量弹窗是否被窗口裁掉
console.log(await evaluate(`(() => {
  const d = document.querySelector('[role=dialog]')
  if (!d) return 'no dialog'
  const r = d.getBoundingClientRect()
  return JSON.stringify({
    viewportH: innerHeight,
    clipped: r.top < 0 || r.bottom > innerHeight,
    buttons: [...d.querySelectorAll('button')].map(b => b.textContent.trim()),
  })
})()`))

chrome.kill()
```

调试要点：

- 用**本地生产模式**跑（`NODE_ENV=production node dist/boot.js`）+ 独立 `DATABASE_URL`，别对线上库做破坏性测试
- 想让上传真的落到 R2，本地 `.env` 的 `IMG_ADMIN_KEY` 要和 Worker 的 secret 一致
- 测完删掉临时数据库和脚本

---

## 九、工作方式

- **改了就在真实应用里验一遍**，再决定要不要报"完成"
- **不确定用户想要什么就问一句**，别自己拍方案（"一轮播一个比例 vs 每张各自选"这种分叉，问一句省一小时）
- 报告要区分**实测**和**推断**；失败和不确定性照实说
- 用户是代码小白，说人话，技术概念翻译成她能懂的
- 代码注释和 commit message 用**英文**
