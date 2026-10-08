// Throwaway: prove src/lib/diagram-raster.ts really rasterises mermaid in a real
// browser. Bundles the module with esbuild, serves it from a static server on
// 3210, drives headless Chrome over CDP, and writes every PNG to
// node_modules/.tmp/diagram-probe/ so the labels can be checked by eye.
//
// The label check is the point of this script: a diagram whose boxes and arrows
// paint but whose text silently disappeared is still "not blank", so every label
// in mermaid's own SVG (<text>, or a <foreignObject> when HTML labels are on) is
// measured in the live DOM and then looked for, pixel by pixel, inside the PNG.
//
// The last section re-measures the traps this module was written around, so the
// choices in it are backed by numbers rather than by v10-era documentation.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const APP_ROOT = path.resolve(fileURLToPath(import.meta.url), '../..')
const TMP = path.join(APP_ROOT, 'node_modules', '.tmp', 'diagram-probe')
const PORT = 3210
const CDP = 9345
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const MAX_DIAGRAM_WIDTH = 677

// ---------------------------------------------------------------- probe page

const ENTRY = String.raw`
import { renderDiagramPng, rasterSize } from '../../../src/lib/diagram-raster'

interface Pixels { width: number; height: number; data: Uint8ClampedArray }

// Mirrors the module's raster path exactly. Kept here rather than exported from
// the module because it has to run on hand-edited SVG, not on mermaid output.
async function rasterize(markup: string): Promise<Pixels> {
  const img = new Image()
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup)
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('SVG did not load into Image'))
  })
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0)
  const loaded = { width: img.naturalWidth, height: img.naturalHeight }
  return { ...loaded, data: ctx.getImageData(0, 0, loaded.width, loaded.height).data }
}

function decode(blob: Blob): Promise<Pixels> {
  return createImageBitmap(blob).then((bmp) => {
    const canvas = document.createElement('canvas')
    canvas.width = bmp.width
    canvas.height = bmp.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bmp, 0, 0)
    const data = ctx.getImageData(0, 0, bmp.width, bmp.height).data
    // width and height read 0 after close(), so keep them first.
    const size = { width: bmp.width, height: bmp.height }
    bmp.close()
    return { ...size, data }
  })
}

function isInk(img: Pixels, i: number) {
  return img.data[i] < 245 || img.data[i + 1] < 245 || img.data[i + 2] < 245
}

function inkRatio(img: Pixels, x: number, y: number, w: number, h: number) {
  const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y))
  const x1 = Math.min(img.width, Math.ceil(x + w)), y1 = Math.min(img.height, Math.ceil(y + h))
  if (x1 <= x0 || y1 <= y0) return 0
  let ink = 0
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      if (isInk(img, (py * img.width + px) * 4)) ink++
    }
  }
  return ink / ((x1 - x0) * (y1 - y0))
}

function stats(img: Pixels) {
  let nonWhite = 0
  let minAlpha = 255
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] < minAlpha) minAlpha = img.data[i + 3]
    if (isInk(img, i)) nonWhite++
  }
  return { nonWhiteRatio: nonWhite / (img.data.length / 4), minAlpha }
}

function base64(buf: Uint8Array) {
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) {
    bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

// Every label mermaid drew, as a box in PNG pixels plus the ink actually found
// there. Both placements are covered: <text> when HTML labels are off,
// <foreignObject> when they are on.
function labelBoxes(markup: string, naturalWidth: number, scale: number) {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;top:0;left:-100000px;'
  host.innerHTML = markup
  document.body.appendChild(host)
  try {
    const root = host.querySelector('svg') as SVGSVGElement
    root.setAttribute('width', String(naturalWidth))
    root.removeAttribute('style')
    const base = root.getBoundingClientRect()
    const out: { text: string; x: number; y: number; w: number; h: number }[] = []
    for (const el of root.querySelectorAll('text, foreignObject')) {
      const text = (el.textContent || '').trim()
      if (!text) continue
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) continue
      out.push({
        text,
        x: (r.left - base.left) * scale,
        y: (r.top - base.top) * scale,
        w: r.width * scale,
        h: r.height * scale,
      })
    }
    return out
  } finally {
    host.remove()
  }
}

function measureLabels(markup: string, img: Pixels, naturalWidth: number) {
  const scale = img.width / naturalWidth
  return labelBoxes(markup, naturalWidth, scale).map((b) => ({
    text: b.text,
    box: [Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h)],
    ink: inkRatio(img, b.x - 1, b.y - 1, b.w + 2, b.h + 2),
  }))
}

function naturalBox(markup: string) {
  const root = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement
  const box = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number)
  return { root, width: box[2], height: box[3] }
}

let seq = 0
async function renderMarkup(code: string) {
  const mermaid = (await import('mermaid')).default
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;top:0;left:-100000px;'
  document.body.appendChild(host)
  try {
    return (await mermaid.render('probe-ref-' + ++seq, code, host)).svg
  } finally {
    host.remove()
  }
}

// Does <foreignObject> paint at all when an SVG is drawn through new Image()?
// One black <rect> as the control, one black HTML <div> in a foreignObject beside
// it, same raster path.
async function foreignObjectPaint() {
  const markup =
    '<svg xmlns="http://www.w3.org/2000/svg" width="140" height="60">' +
    '<rect x="10" y="10" width="40" height="40" fill="#000000"/>' +
    '<foreignObject x="90" y="10" width="40" height="40">' +
    '<div xmlns="http://www.w3.org/1999/xhtml" style="width:40px;height:40px;background:#000000"></div>' +
    '</foreignObject></svg>'
  const img = await rasterize(markup)
  return {
    size: [img.width, img.height],
    controlInk: inkRatio(img, 10, 10, 40, 40),
    foreignObjectInk: inkRatio(img, 90, 10, 40, 40),
  }
}

async function inspect(code: string) {
  const { blob, width, height } = await renderDiagramPng(code)
  const img = await decode(blob)

  // Re-render the same source for its markup. renderDiagramPng already loaded and
  // configured mermaid and this is the same ESM singleton, so the reference SVG is
  // produced under the module's own config rather than under a copy of it.
  const markup = await renderMarkup(code)
  const { root, width: naturalWidth, height: naturalHeight } = naturalBox(markup)
  const style = root.querySelector('style')
  const rootId = root.getAttribute('id')

  return {
    blobType: blob.type,
    blobBytes: blob.size,
    width,
    height,
    pxWidth: img.width,
    pxHeight: img.height,
    naturalWidth,
    naturalHeight,
    ...stats(img),
    foreignObjectCount: root.getElementsByTagName('foreignObject').length,
    rootStyle: root.getAttribute('style'),
    rootWidthAttr: root.getAttribute('width'),
    // mermaid scopes its CSS with #<id>, and DOMPurify runs over the markup under
    // securityLevel 'strict'. Losing either would leave a structurally fine but
    // completely unstyled diagram.
    styleScopedToRoot: !!style && !!rootId && (style.textContent || '').includes('#' + rootId),
    labels: measureLabels(markup, img, naturalWidth),
    base64: base64(new Uint8Array(await blob.arrayBuffer())),
  }
}

async function rejects(code: string) {
  try {
    await renderDiagramPng(code)
    return { rejected: false, message: '' }
  } catch (e) {
    return { rejected: true, message: String((e as Error)?.message ?? e).slice(0, 200) }
  }
}

async function concurrent(a: string, b: string) {
  const [ra, rb] = await Promise.all([renderDiagramPng(a), renderDiagramPng(b)])
  return {
    a: { bytes: ra.blob.size, width: ra.width, height: ra.height, type: ra.blob.type },
    b: { bytes: rb.blob.size, width: rb.width, height: rb.height, type: rb.blob.type },
    leftovers: document.querySelectorAll(
      '[id^="mopai-diagram-"], [id^="dmopai-diagram-"], [id^="probe-ref-"], [id^="dprobe-ref-"]',
    ).length,
    bodyChildren: document.body.childElementCount,
  }
}

// Runs last: it re-initialises mermaid with the settings the module deliberately
// turned off, which would poison every later module render.
async function htmlLabelTrap(code: string) {
  const mermaid = (await import('mermaid')).default
  mermaid.initialize({ htmlLabels: true, sequence: { textPlacement: 'fo' } })
  const markup = await renderMarkup(code)
  const { root, width: naturalWidth, height: naturalHeight } = naturalBox(markup)
  const foreignObjectCount = root.getElementsByTagName('foreignObject').length

  // Rasterise that markup the same way the module does, so the only difference
  // between this and the module's own PNG is the label placement.
  root.setAttribute('width', String(Math.round(naturalWidth) * 2))
  root.setAttribute('height', String(Math.round(naturalHeight) * 2))
  root.removeAttribute('style')
  const img = await rasterize(new XMLSerializer().serializeToString(root))
  const labels = measureLabels(markup, img, naturalWidth)
  return {
    foreignObjectCount,
    labelCount: labels.length,
    blankLabels: labels.filter((l) => l.ink < 0.02).map((l) => l.text),
    lowestInk: labels.length ? Math.min(...labels.map((l) => l.ink)) : 0,
    ...stats(img),
  }
}

async function svgRewriteTrap(code: string) {
  const markup = await renderMarkup(code)
  const { root, width: naturalWidth, height: naturalHeight } = naturalBox(markup)
  const rootStyle = root.getAttribute('style')
  const { pixelWidth: tw, pixelHeight: th } = rasterSize(naturalWidth, naturalHeight)
  const target = { w: tw, h: th }

  // 1. mermaid's markup untouched: width="100%", no height, a max-width style.
  const untouched = await rasterize(markup)

  // 2. explicit size but the root style left in place: max-width is a CSS clamp on
  //    the root element, so it wins over the width attribute inside the image.
  const withStyle = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement
  withStyle.setAttribute('width', String(target.w))
  withStyle.setAttribute('height', String(target.h))
  const clamped = await rasterize(new XMLSerializer().serializeToString(withStyle))

  // Where the ink actually ends up, as a fraction of the canvas on each axis.
  const extent = (img: Pixels) => {
    let minX = img.width, maxX = -1, minY = img.height, maxY = -1
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        if (isInk(img, (y * img.width + x) * 4)) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    return maxX < 0 ? null : [minX / img.width, minY / img.height, (maxX + 1) / img.width, (maxY + 1) / img.height].map((n) => Number(n.toFixed(3)))
  }

  root.setAttribute('width', String(target.w))
  root.setAttribute('height', String(target.h))
  root.removeAttribute('style')
  const stripped = await rasterize(new XMLSerializer().serializeToString(root))

  return {
    target,
    rootStyle,
    untouchedLoadedAt: [untouched.width, untouched.height],
    untouchedInkExtent: extent(untouched),
    styleKeptLoadedAt: [clamped.width, clamped.height],
    styleKeptInkExtent: extent(clamped),
    styleKeptNonWhite: stats(clamped).nonWhiteRatio,
    styleStrippedInkExtent: extent(stripped),
    styleStrippedNonWhite: stats(stripped).nonWhiteRatio,
  }
}

;(window as unknown as Record<string, unknown>).__probe = {
  foreignObjectPaint,
  inspect,
  rejects,
  concurrent,
  htmlLabelTrap,
  svgRewriteTrap,
}
`

const INDEX = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>diagram raster probe</title></head>
<body><script type="module" src="./entry.js"></script></body></html>
`

const DIAGRAMS = [
  {
    type: 'flowchart',
    code: [
      'graph TD',
      '  A[作者输入 Markdown] -->|解析| B{含 mermaid 代码块?}',
      '  B -->|是| C[栅格化为 PNG]',
      '  B -->|否| D[直接排版]',
      '  C -->|上传 R2| E[插入图片块]',
      '  D --> E',
    ].join('\n'),
  },
  {
    type: 'sequenceDiagram',
    code: [
      'sequenceDiagram',
      '  participant E as 编辑器',
      '  participant R as 渲染器',
      '  participant S as 对象存储',
      '  E->>R: 提交 Markdown 源码',
      '  R->>S: 上传栅格化后的 PNG',
      '  S-->>R: 返回图片地址',
      '  R-->>E: 插入图片块',
      '  Note over E,S: 全流程都在浏览器里完成',
    ].join('\n'),
  },
  {
    type: 'classDiagram',
    code: [
      'classDiagram',
      '  class DiagramPng {',
      '    +Blob blob',
      '    +number width',
      '    +number height',
      '  }',
      '  class Renderer {',
      '    +renderDiagramPng(code) Promise',
      '  }',
      '  class Theme {',
      '    +imageBlock(src, caption) string',
      '  }',
      '  Renderer ..> DiagramPng : produces',
      '  Renderer --> Theme : hands the image to',
    ].join('\n'),
  },
  {
    type: 'stateDiagram-v2',
    code: [
      'stateDiagram-v2',
      '  [*] --> Draft',
      '  Draft: 源码待渲染',
      '  Draft --> Rendering: mermaid.render',
      '  Rendering: 正在栅格化',
      '  Rendering --> Rasterised: canvas.toBlob',
      '  Rendering --> Failed: 语法错误',
      '  Failed: 解析失败，回显源码',
      '  Failed --> Draft: 作者修改后重试',
      '  Rasterised --> Uploaded: 进入素材库',
      '  Uploaded: 已上传',
      '  Uploaded --> [*]',
    ].join('\n'),
  },
  {
    type: 'pie',
    code: [
      'pie showData title 公众号文章配图来源',
      '  "作者上传的照片" : 42',
      '  "截图与录屏" : 27',
      '  "mermaid 图表" : 19',
      '  "AI 生成插图" : 12',
    ].join('\n'),
  },
]

// ---------------------------------------------------------------- build + serve

fs.rmSync(TMP, { recursive: true, force: true })
fs.mkdirSync(TMP, { recursive: true })
fs.writeFileSync(path.join(TMP, 'entry.ts'), ENTRY, 'utf8')
fs.writeFileSync(path.join(TMP, 'index.html'), INDEX, 'utf8')

console.log('bundling probe entry with esbuild (splitting on, so mermaid stays a lazy chunk)...')
const built = await build({
  entryPoints: [path.join(TMP, 'entry.ts')],
  outdir: TMP,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  logLevel: 'warning',
  metafile: true,
})
const outputs = Object.entries(built.metafile?.outputs ?? {})
  .map(([f, o]) => `${path.basename(f)} ${(o.bytes / 1024 / 1024).toFixed(2)} MB`)
  .sort()
  .join(', ')
console.log(`  -> ${outputs}`)

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
}
const pct = (n) => (n * 100).toFixed(2) + '%'

console.log('\n=== importing the module must not pull mermaid into the eager graph ===')
const outByName = new Map(
  Object.entries(built.metafile?.outputs ?? {}).map(([f, o]) => [path.basename(f), o]),
)
const eager = new Set()
const walk = (name) => {
  if (eager.has(name)) return
  eager.add(name)
  for (const imp of outByName.get(name)?.imports ?? []) {
    // A dynamic import is only fetched once renderDiagramPng actually runs.
    if (imp.kind !== 'dynamic-import') walk(path.basename(imp.path))
  }
}
walk('entry.js')
const eagerBytes = [...eager].reduce((n, b) => n + (outByName.get(b)?.bytes ?? 0), 0)
const eagerCode = [...eager].map((b) => fs.readFileSync(path.join(TMP, b), 'utf8')).join('\n')
console.log(`  eagerly loaded: ${[...eager].join(', ')} = ${(eagerBytes / 1024).toFixed(1)} KB`)
check('the eager graph is the probe and the module, not mermaid', eagerBytes < 200 * 1024, `${(eagerBytes / 1024).toFixed(1)} KB`)
check('no mermaid source in the eager graph', !eagerCode.includes('No diagram type detected'))

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
}
const server = http.createServer((req, res) => {
  const rel = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
  const file = path.join(TMP, rel === '/' ? 'index.html' : rel.slice(1))
  if (!file.startsWith(TMP) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found')
    return
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise((r) => server.listen(PORT, '127.0.0.1', r))
console.log(`static probe server on http://127.0.0.1:${PORT}/`)

// ---------------------------------------------------------------- chrome + cdp

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'diagram-raster-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${CDP}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--disable-gpu',
    '--no-proxy-server',
    '--window-size=1440,900',
    '--force-device-scale-factor=1',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json()
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl
    } catch {
      /* not up yet */
    }
    await sleep(250)
  }
  throw new Error('no CDP')
}
let msgId = 1
function client(ws) {
  const pending = new Map()
  ws.addEventListener('message', (event) => {
    const m = JSON.parse(event.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
    }
  })
  return (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const i = msgId++
      pending.set(i, { resolve, reject })
      ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }))
      setTimeout(() => {
        if (pending.has(i)) {
          pending.delete(i)
          reject(new Error('timeout ' + method))
        }
      }, 180000)
    })
}

const consoleLines = []
const ws = new WebSocket(await wsUrl())
await new Promise((res, rej) => {
  ws.addEventListener('open', res)
  ws.addEventListener('error', rej)
})
const send = client(ws)
ws.addEventListener('message', (event) => {
  const m = JSON.parse(event.data)
  if (m.method === 'Runtime.consoleAPICalled' && /error|warning/.test(m.params.type)) {
    const text = (m.params.args ?? [])
      .map((a) => a.value ?? a.description ?? '')
      .join(' ')
      .trim()
    if (text) consoleLines.push(`[${m.params.type}] ${text.slice(0, 300)}`)
  }
})
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Page.enable', {}, sessionId)
await send('Runtime.enable', {}, sessionId)
const ev = async (expression) => {
  const r = await send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  )
  if (r.exceptionDetails) {
    throw new Error(
      r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''),
    )
  }
  return r.result.value
}
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` }, sessionId)
for (let i = 0; i < 120; i++) {
  try {
    if (await ev('!!window.__probe')) break
  } catch {
    /* page still loading */
  }
  await sleep(250)
}

// ---------------------------------------------------------------- checks

const bodyBaseline = await ev('document.body.childElementCount')

console.log('\n=== does <foreignObject> paint through new Image() at all? ===')
const fo = await ev('window.__probe.foreignObjectPaint()')
console.log(
  `  control <rect> ink ${pct(fo.controlInk)}, foreignObject <div> ink ${pct(fo.foreignObjectInk)} (canvas ${fo.size.join('x')})`,
)
check(
  'the control <rect> paints, so the raster path itself works',
  fo.controlInk > 0.9,
  pct(fo.controlInk),
)
check(
  'a plain HTML <div> inside <foreignObject> paints too',
  fo.foreignObjectInk > 0.9,
  pct(fo.foreignObjectInk),
)

console.log('\n=== per diagram type ===')
const summary = []
for (const d of DIAGRAMS) {
  let r
  try {
    r = await ev(`window.__probe.inspect(${JSON.stringify(d.code)})`)
  } catch (e) {
    check(`${d.type}: rendered`, false, String(e.message).slice(0, 400))
    continue
  }
  const file = path.join(TMP, d.type + '.png')
  fs.writeFileSync(file, Buffer.from(r.base64, 'base64'))

  const blank = r.labels.filter((l) => l.ink < 0.02)
  const lowest = r.labels.length ? Math.min(...r.labels.map((l) => l.ink)) : 0
  console.log(
    `\n-- ${d.type}\n   PNG  ${file}\n   logical ${r.width}x${r.height}, png ${r.pxWidth}x${r.pxHeight}, natural ${Math.round(r.naturalWidth)}x${Math.round(r.naturalHeight)}, ${r.blobBytes} bytes\n   non-white ${pct(r.nonWhiteRatio)}, min alpha ${r.minAlpha}, foreignObject ${r.foreignObjectCount}\n   mermaid root: width=${JSON.stringify(r.rootWidthAttr)} style=${JSON.stringify(r.rootStyle)}, css scoped to that root ${r.styleScopedToRoot}\n   labels ${r.labels.length}, lowest label ink ${pct(lowest)}` +
      (blank.length
        ? `\n   UNPAINTED LABELS: ${blank.map((b) => JSON.stringify(b.text)).join(', ')}`
        : ''),
  )

  check(`${d.type}: blob is image/png`, r.blobType === 'image/png', r.blobType)
  check(
    `${d.type}: logical width <= ${MAX_DIAGRAM_WIDTH}`,
    r.width <= MAX_DIAGRAM_WIDTH,
    `${r.width}`,
  )
  check(
    `${d.type}: rasterised at 2x the logical size`,
    r.pxWidth === r.width * 2 && r.pxHeight === r.height * 2,
    `${r.pxWidth}x${r.pxHeight} vs ${r.width}x${r.height}`,
  )
  check(`${d.type}: opaque, no alpha`, r.minAlpha === 255, `min alpha ${r.minAlpha}`)
  check(`${d.type}: not blank`, r.nonWhiteRatio > 0.01, pct(r.nonWhiteRatio))
  check(
    `${d.type}: mermaid SVG carries no <foreignObject>`,
    r.foreignObjectCount === 0,
    `${r.foreignObjectCount}`,
  )
  check(
    `${d.type}: mermaid CSS survived sanitising and is scoped to the SVG root`,
    r.styleScopedToRoot === true,
  )
  check(`${d.type}: SVG carries text labels`, r.labels.length > 0, `${r.labels.length}`)
  check(
    `${d.type}: every label actually painted into the PNG`,
    r.labels.length > 0 && blank.length === 0,
    blank.length
      ? `${blank.length}/${r.labels.length} blank: ${blank.map((b) => b.text).join(' | ')}`
      : `all ${r.labels.length} painted, lowest ink ${pct(lowest)}`,
  )
  summary.push({ type: d.type, file, width: r.width, height: r.height })
}

console.log('\n=== invalid source rejects instead of rasterising an error image ===')
for (const bad of ['graph TD\n  A --> ', 'this is not a diagram at all @@!!']) {
  const r = await ev(`window.__probe.rejects(${JSON.stringify(bad)})`)
  check(`rejects ${JSON.stringify(bad.slice(0, 24))}`, r.rejected === true, r.message)
}

console.log('\n=== two concurrent renders do not collide ===')
const con = await ev(
  `window.__probe.concurrent(${JSON.stringify(DIAGRAMS[0].code)}, ${JSON.stringify(DIAGRAMS[4].code)})`,
)
console.log(`  ${JSON.stringify(con)}`)
check(
  'both concurrent renders produced a PNG',
  con.a.type === 'image/png' && con.b.type === 'image/png' && con.a.bytes > 0 && con.b.bytes > 0,
)
check(
  'the two results are not the same image',
  con.a.bytes !== con.b.bytes || con.a.width !== con.b.width,
)
check('no temporary mermaid DOM left behind', con.leftovers === 0, `${con.leftovers}`)
check(
  'no probe host divs left behind',
  con.bodyChildren === bodyBaseline,
  `body has ${con.bodyChildren} children, started with ${bodyBaseline}`,
)

console.log('\n=== trap measurements (these re-configure mermaid, so they run last) ===')
for (const d of DIAGRAMS.filter((x) => x.type === 'flowchart' || x.type === 'sequenceDiagram')) {
  const r = await ev(`window.__probe.htmlLabelTrap(${JSON.stringify(d.code)})`)
  console.log(
    `  ${d.type} with htmlLabels on: foreignObject ${r.foreignObjectCount}, label boxes ${r.labelCount}, lowest label ink ${pct(r.lowestInk)}, blank ${JSON.stringify(r.blankLabels)}, non-white ${pct(r.nonWhiteRatio)}`,
  )
}
const rw = await ev(`window.__probe.svgRewriteTrap(${JSON.stringify(DIAGRAMS[1].code)})`)
console.log(
  `  sequenceDiagram, target ${rw.target.w}x${rw.target.h}:\n` +
    `    markup untouched -> Image loaded at ${rw.untouchedLoadedAt.join('x')}, ink extent ${JSON.stringify(rw.untouchedInkExtent)}\n` +
    `    width/height set, root style kept -> loaded at ${rw.styleKeptLoadedAt.join('x')}, ink extent ${JSON.stringify(rw.styleKeptInkExtent)}, non-white ${pct(rw.styleKeptNonWhite)}\n` +
    `    width/height set, root style stripped -> ink extent ${JSON.stringify(rw.styleStrippedInkExtent)}, non-white ${pct(rw.styleStrippedNonWhite)}`,
)
check(
  'mermaid markup with no explicit size does not load at the target size (the module sets width/height)',
  rw.untouchedLoadedAt[0] !== rw.target.w,
  `loaded at ${rw.untouchedLoadedAt.join('x')}, wanted ${rw.target.w}x${rw.target.h}`,
)
check(
  'the rewritten SVG fills the canvas it was sized for',
  rw.styleStrippedInkExtent[2] > 0.9 && rw.styleStrippedInkExtent[3] > 0.9,
  `ink extent ${JSON.stringify(rw.styleStrippedInkExtent)}`,
)
console.log(
  `  root style ${JSON.stringify(rw.rootStyle)}: stripping it changed the pixels? ` +
    (JSON.stringify(rw.styleKeptInkExtent) === JSON.stringify(rw.styleStrippedInkExtent)
      ? 'no - Chrome ignores max-width on an SVG-as-image root, so the strip is defensive only'
      : 'YES - kept ' + JSON.stringify(rw.styleKeptInkExtent) + ' vs stripped ' + JSON.stringify(rw.styleStrippedInkExtent)),
)

if (consoleLines.length) {
  console.log('\n=== browser console (errors and warnings) ===')
  for (const line of consoleLines.slice(0, 25)) console.log('  ' + line)
}

console.log('\n=== PNG files to look at ===')
for (const s of summary) console.log(`  ${s.file}  (${s.width}x${s.height} logical)`)

chrome.kill()
server.close()
try {
  fs.rmSync(profile, { recursive: true, force: true })
} catch {
  /* Chrome may hold it */
}
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`)
process.exit(failures === 0 ? 0 : 1)
