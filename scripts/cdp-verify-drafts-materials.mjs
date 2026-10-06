// Drive the drafts page and the materials page in a real browser.
//
// Drafts: sort by savedAt/chars/images, and the "只看有图" filter.
// Materials: each row shows a thumbnail loaded from /api/img/<key>.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY']) {
  delete process.env[k]
}

const APP = process.argv[2] || 'http://127.0.0.1:3199'
const ACCESS_KEY = process.argv[3] || ''
const DB_PATH = process.argv[4]
const PORT = 9337
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-cdp5-'))
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-gpu', '--window-size=1600,900',
  '--no-proxy-server', '--proxy-bypass-list=<-loopback>', 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function wsUrl() {
  for (let i = 0; i < 60; i++) {
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
    if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result) }
  })
  return (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const i = id++; pending.set(i, { resolve, reject })
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }))
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); reject(new Error('timeout ' + method)) } }, 30000)
  })
}

const results = []
function check(group, name, ok, detail = '') {
  results.push({ group, name, ok })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${group} :: ${name}${detail ? ` — ${detail}` : ''}`)
}

// ---- seed: three drafts with known stats ----------------------------------
const nowSec = Math.floor(Date.now() / 1000)
const db = new DatabaseSync(DB_PATH)
db.exec(`
  CREATE TABLE IF NOT EXISTS docs (
    id TEXT PRIMARY KEY, ownerId INTEGER NOT NULL, name TEXT NOT NULL,
    content TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
    savedAt INTEGER
  );
  CREATE TABLE IF NOT EXISTS files (
    key TEXT PRIMARY KEY, ownerId INTEGER NOT NULL, name TEXT,
    size INTEGER NOT NULL, createdAt INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, runAt INTEGER NOT NULL);
`)
db.exec('DELETE FROM docs')
db.exec('DELETE FROM files')
db.exec('DELETE FROM _migrations')

const insert = (id, name, content, savedAt) =>
  db.prepare('INSERT INTO docs (id,ownerId,name,content,createdAt,updatedAt,savedAt) VALUES (?,1,?,?,?,?,?)')
    .run(id, name, content, savedAt, savedAt, savedAt)

const longText = '正文'.repeat(200)
insert('d-oldest', '最短 · 最早 · 无图', `---\ntitles:\n  - 老稿\n---\n\n短。\n`, nowSec - 86400 * 10)
insert('d-middle', '中等 · 一张图', `---\ntitles:\n  - 中稿\n---\n\n${'正文'.repeat(50)}\n\n![图](img:AAA)\n`, nowSec - 86400 * 5)
insert('d-newest', '最长 · 三张图 · 最新', `---\ntitles:\n  - 新稿\n---\n\n${longText}\n\n![a](img:A)\n![b](img:B)\n![c](img:C)\n`, nowSec - 86400)

db.prepare('INSERT INTO files (key,ownerId,name,size,createdAt) VALUES (?,1,?,?,?)')
  .run('thumbkey1', 'demo.png', 1234, nowSec)
db.close()
console.log('seeded 3 drafts + 1 file')

// ---- drive the browser -----------------------------------------------------
const ws = new WebSocket(await wsUrl())
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
const send = client(ws)
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Page.enable', {}, sessionId)
await send('Runtime.enable', {}, sessionId)
const pageErrors = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params?.exceptionDetails?.text || '?')
})
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
  return r.result.value
}
const go = async (url) => { await send('Page.navigate', { url }, sessionId); await sleep(3500) }

// A 1×1 PNG for the thumbnails.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const stubSrc = `(() => {
  const raw = window.fetch
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input.url
    if (/\\/api\\/img\\//.test(url)) {
      const bin = Uint8Array.from(atob('${PNG}'), (c) => c.charCodeAt(0))
      return Promise.resolve(new Response(new Blob([bin], { type: 'image/png' }), {
        status: 200, headers: { 'Content-Type': 'image/png' },
      }))
    }
    return raw.apply(this, arguments)
  }
  return true
})()`

await go(APP)
if (ACCESS_KEY) {
  await evaluate(`fetch('/api/trpc/auth.login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({json:{accessKey:${JSON.stringify(ACCESS_KEY)}}})}).then(r=>r.text())`)
  await go(APP)
}
await send('Page.addScriptToEvaluateOnNewDocument', { source: stubSrc }, sessionId)
await evaluate(stubSrc)

const cardNames = () => evaluate(`[...document.querySelectorAll('main li p')].filter(p => p.className.includes('font-semibold')).map(p => p.textContent.trim())`)
const setSelect = (value) =>
  evaluate(`(() => {
    const s = document.querySelector('main select')
    if (!s) return 'no-select'
    s.value = ${JSON.stringify(value)}
    s.dispatchEvent(new Event('change', { bubbles: true }))
    return s.value
  })()`)
const setOnlyImages = (on) =>
  evaluate(`(() => {
    const cb = document.querySelector('main input[type=checkbox]')
    if (!cb) return 'no-cb'
    if (cb.checked !== ${on}) cb.click()
    return cb.checked
  })()`)

console.log('\n=== drafts page: sort ===')
await go(APP + '/drafts')
console.log('  default order (savedAt desc):', await cardNames())
check('sort', 'default is newest first', (await cardNames())[0] === '最长 · 三张图 · 最新')

console.log('  sort by chars:', await setSelect('chars'))
await sleep(800)
const byChars = await cardNames()
console.log('  names by chars:', byChars)
check('sort', 'by chars puts the longest first', byChars[0] === '最长 · 三张图 · 最新' && byChars[2] === '最短 · 最早 · 无图')

console.log('  sort by images:', await setSelect('images'))
await sleep(800)
const byImages = await cardNames()
console.log('  names by images:', byImages)
check('sort', 'by images puts the most-pictured first', byImages[0] === '最长 · 三张图 · 最新')
check('sort', 'the no-image draft is last when sorting by images', byImages[2] === '最短 · 最早 · 无图')

console.log('\n=== drafts page: 只看有图 ===')
await setSelect('savedAt')
await sleep(500)
const filtered = await setOnlyImages(true)
await sleep(800)
const visible = await cardNames()
console.log('  visible with 只看有图:', visible)
check('filter', '只看有图 hides the no-image draft', !visible.includes('最短 · 最早 · 无图'))
check('filter', 'both image drafts remain', visible.includes('最长 · 三张图 · 最新') && visible.includes('中等 · 一张图'))

console.log('\n=== materials page: thumbnails ===')
await go(APP + '/materials')
await sleep(2000)
const thumbs = await evaluate(`[...document.querySelectorAll('main img')].map(img => ({
  src: img.src.slice(-40),
  attempted: img.complete || img.naturalWidth > 0,
  hidden: img.style.visibility === 'hidden',
}))`)
console.log('  thumbnails:', JSON.stringify(thumbs))
check('thumbnails', 'the materials list renders image elements', thumbs.length > 0, `${thumbs.length} found`)
check('thumbnails', 'each thumbnail points at /api/img/<key>', thumbs.length > 0 && thumbs.every((t) => t.src.includes('/api/img/')))
// The seeded key does not exist on R2, so the browser fires onError and our
// handler hides it. That is the graceful fallback for stale rows.
check('thumbnails', 'a missing image is hidden rather than left as a broken icon', thumbs.length > 0 && thumbs.every((t) => t.hidden))

console.log('\n=== page errors ===')
check('runtime', 'no uncaught exceptions', pageErrors.length === 0, pageErrors.join(' | '))

ws.close(); chrome.kill()
const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)`)
process.exit(failed.length === 0 ? 0 : 1)
