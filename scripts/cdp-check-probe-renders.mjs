// Throwaway: confirm the probe page actually paints before it is handed over for
// a WeChat test. The first probe was blank in every browser because its viewBox
// did not contain its path data, and that made the WeChat result meaningless.
// Measures each SVG's box on screen and checks its painted geometry falls inside
// the viewBox it declares.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const file = path.resolve(process.argv[2] || '../粘贴验证2.html')
const PORT = 9338
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-'))
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-gpu', '--no-proxy-server', '--window-size=1200,1400',
  'file:///' + file.replace(/\\/g, '/'),
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl
    } catch { /* not up yet */ }
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
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
    }
  })
  return (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const i = id++
    pending.set(i, { resolve, reject })
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }))
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); reject(new Error('timeout ' + method)) } }, 20000)
  })
}

const ws = new WebSocket(await wsUrl())
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
const send = client(ws)
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Page.enable', {}, sessionId)
await send('Runtime.enable', {}, sessionId)
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
  return r.result.value
}
await send('Page.navigate', { url: 'file:///' + file.replace(/\\/g, '/') }, sessionId)
await sleep(2500)

const report = await ev(`(() => {
  const out = []
  document.querySelectorAll('svg').forEach((svg, i) => {
    const r = svg.getBoundingClientRect()
    const vb = (svg.getAttribute('viewBox') || '').split(/[\\s,]+/).map(Number)
    let inside = null, painted = 0
    try {
      const bb = svg.getBBox()
      painted = bb.width * bb.height
      // Does the painted geometry fall inside the declared viewBox?
      inside = bb.x >= vb[0] - 1 && bb.y >= vb[1] - 1 &&
               bb.x + bb.width <= vb[0] + vb[2] + 1 && bb.y + bb.height <= vb[1] + vb[3] + 1
    } catch (e) { inside = 'err:' + e.message }
    out.push({
      i,
      screenW: Math.round(r.width), screenH: Math.round(r.height),
      viewBox: svg.getAttribute('viewBox'),
      paths: svg.querySelectorAll('path').length,
      paintedArea: Math.round(painted),
      geometryInsideViewBox: inside,
      widthAttr: svg.getAttribute('width'),
      style: svg.getAttribute('style'),
      fill: svg.getAttribute('fill') || (svg.querySelector('g') && svg.querySelector('g').getAttribute('fill')),
    })
  })
  return JSON.stringify(out)
})()`)

const rows = JSON.parse(report)
let failures = 0
for (const r of rows) {
  const visible = r.screenW > 4 && r.screenH > 4 && r.paintedArea > 0 && r.geometryInsideViewBox === true
  if (!visible) failures++
  console.log(
    `  [${visible ? 'PAINTS' : 'BLANK '}] svg#${r.i} screen=${r.screenW}x${r.screenH} paths=${r.paths} paintedArea=${r.paintedArea} insideViewBox=${r.geometryInsideViewBox} width=${r.widthAttr} fill=${r.fill}`,
  )
}
console.log(`\n${rows.length} svg element(s), ${failures} blank`)

// A screenshot is the honest evidence: a non-zero bbox could still paint nothing
// if the fill resolved to transparent.
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId)
const shotPath = path.join(path.dirname(file), 'paste-probe-render.png')
fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))
console.log('screenshot:', shotPath)

chrome.kill()
try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* Chrome may hold it */ }
process.exit(failures === 0 ? 0 : 1)
