// Throwaway: prove the lazy MathJax path end to end in a real browser. Types a
// display equation into the editor, waits for the chunk to load, and asserts the
// preview ends up holding a real SVG with painted paths - and that the same SVG is
// in the string that would be copied to WeChat.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const appUrl = process.argv[2] || 'http://127.0.0.1:3202/'
const PORT = 9339
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'math-'))
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-gpu', '--no-proxy-server', '--window-size=1440,900', 'about:blank',
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
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
  return r.result.value
}
await send('Page.navigate', { url: appUrl }, sessionId)
await sleep(4000)

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
}

console.log('=== first load does not carry MathJax ===')
const loaded = await ev(`JSON.stringify(performance.getEntriesByType('resource').map(r => r.name.split('/').pop()).filter(n => /mathjax|AllPackages|svg-/.test(n)))`)
check('no MathJax chunk fetched before any formula exists', JSON.parse(loaded).length === 0, loaded)

console.log('\n=== typing a formula loads MathJax and paints it ===')
await ev(`(() => {
  const v = window.__mopaiCodemirror
  v.dispatch({ changes: { from: 0, insert: '$$\\nE = mc^2\\n$$\\n\\n' } })
})()`)
await sleep(6000) // the chunk is over a megabyte; give it room on a cold cache

const state = await ev(`(() => {
  const svgs = [...document.querySelectorAll('div.px-1.py-6 svg')]
  const first = svgs[0]
  let painted = 0, inside = null
  if (first) {
    const bb = first.getBBox()
    painted = Math.round(bb.width * bb.height)
    const vb = (first.getAttribute('viewBox') || '').split(/[\\s,]+/).map(Number)
    inside = bb.x >= vb[0] - 1 && bb.y >= vb[1] - 1 && bb.x + bb.width <= vb[0] + vb[2] + 1 && bb.y + bb.height <= vb[1] + vb[3] + 1
  }
  return JSON.stringify({
    svgCount: svgs.length,
    paths: first ? first.querySelectorAll('path').length : 0,
    painted,
    inside,
    rect: first ? [Math.round(first.getBoundingClientRect().width), Math.round(first.getBoundingClientRect().height)] : null,
    fill: first ? (first.getAttribute('fill') || (first.querySelector('g') || {}).getAttribute?.('fill')) : null,
  })
})()`)
const st = JSON.parse(state)
check('the preview holds an SVG for the formula', st.svgCount >= 1, state)
check('the SVG carries real glyph paths', st.paths > 3, state)
check('the SVG paints inside its viewBox', st.inside === true && st.painted > 0, state)
check('the SVG has a visible size on screen', !!st.rect && st.rect[0] > 20 && st.rect[1] > 8, state)

console.log('\n=== the copied string carries the same SVG ===')
const copied = await ev(`(() => {
  const root = document.querySelector('div.px-1.py-6 > section')
  const html = root.outerHTML
  return JSON.stringify({
    hasSvg: html.includes('<svg'),
    hasPaths: (html.match(/<path /g) || []).length,
    forbidden: (html.match(/\\s(class|id)=|<script|<style|<div/gi) || []).length,
    bytes: html.length,
  })
})()`)
const cp = JSON.parse(copied)
check('the copy payload contains the SVG', cp.hasSvg === true && cp.hasPaths > 3, copied)
check('the copy payload stays inside the red lines', cp.forbidden === 0, copied)

console.log('\n=== MathJax chunk arrived only after the formula ===')
const loadedAfter = await ev(`JSON.stringify(performance.getEntriesByType('resource').map(r => r.name.split('/').pop()).filter(n => /mathjax|AllPackages|^svg-/.test(n)).length)`)
check('MathJax chunks loaded lazily, after the formula appeared', Number(loadedAfter) > 0, loadedAfter)

chrome.kill()
try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* Chrome may hold it */ }
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`)
process.exit(failures === 0 ? 0 : 1)
