// End-to-end check for the savedAt backfill, from the owner's point of view.
//
// Seeds a database the way an existing install looks *before* this change: an
// article in docs with savedAt = NULL. Then starts nothing and mutates nothing
// itself — it drives the running app and reads what the owner would see.

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
const PORT = 9335
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-cdp3-'))
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

// ---- inspect the "existing install" state ----------------------------------
// The database must be seeded *before* the server starts, because the migration
// runs on the server's first database call. Seeding from here would race it.
const nowSec = Math.floor(Date.now() / 1000)
const db = new DatabaseSync(DB_PATH)
const before = db.prepare('SELECT id, name, updatedAt, savedAt FROM docs').all()
console.log('rows before the app opens:', JSON.stringify(before))
const marksBefore = db.prepare('SELECT COUNT(*) c FROM _migrations').get().c
console.log('migration runs before:', marksBefore)
db.close()
if (before.length === 0 || before.some((r) => r.savedAt !== null) || marksBefore !== 0) {
  console.error('seed the database with one savedAt=NULL article and an empty _migrations first')
  process.exit(2)
}

// ---- drive the app ---------------------------------------------------------
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

console.log('\n=== first visit after the upgrade ===')
await go(APP)
if (ACCESS_KEY) {
  await evaluate(`fetch('/api/trpc/auth.login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({json:{accessKey:${JSON.stringify(ACCESS_KEY)}}})}).then(r=>r.text())`)
}
await go(APP)

console.log('\n=== 草稿箱 ===')
await go(APP + '/drafts')
const draftsText = String(await evaluate(`document.body.innerText`))
console.log('  visible text:', draftsText.replace(/\n+/g, ' | ').slice(0, 300))
check('drafts', 'the article list is not empty', !/草稿箱还是空的/.test(draftsText))
check('drafts', 'the legacy article is shown by name', draftsText.includes('升级前写的老稿'))

console.log('\n=== database after the app opened ===')
const after = new DatabaseSync(DB_PATH)
const row = after.prepare('SELECT id, name, updatedAt, savedAt FROM docs LIMIT 1').get()
console.log('  row:', JSON.stringify(row))
if (row) {
  check('db', 'savedAt was backfilled', row.savedAt !== null)
  check('db', 'savedAt equals updatedAt', row.savedAt === row.updatedAt)
}
const marks = after.prepare('SELECT COUNT(*) c FROM _migrations').get().c
check('db', 'the migration recorded exactly one run', marks === 1, `count=${marks}`)
after.close()

console.log('\n=== page errors ===')
check('runtime', 'no uncaught exceptions', pageErrors.length === 0, pageErrors.join(' | '))

ws.close(); chrome.kill()
const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)`)
process.exit(failed.length === 0 ? 0 : 1)
