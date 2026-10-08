// Throwaway-free acceptance for the recycle bin on the signed-out path, where
// the bin lives in localStorage. Creates a second article, deletes it, finds it
// in 草稿箱's bin, restores it, deletes it again and purges it for good.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const appUrl = process.argv[2] || 'http://127.0.0.1:3202/'
const PORT = Number(process.argv[3] || 9349)
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'trash-'))
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-gpu', '--no-proxy-server', '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
}

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
const events = []
function client(ws) {
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
      return
    }
    if (m.method) events.push(m)
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
/** For clicks that open a synchronous dialog: the page pauses, so never await. */
const fire = (expression) => {
  void send('Runtime.evaluate', { expression, returnByValue: true }, sessionId)
}
/** Radix menus open on pointerdown, not click(). */
const openDocMenu = () => ev(`(() => {
  const t = document.querySelector('[title="切换稿件"]')
  if (!t) return 'no trigger'
  t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
  return 'opened'
})()`)
const menuItem = (text) => ev(`(() => {
  const items = [...document.querySelectorAll('[role="menuitem"], [role="menu"] button')]
  const hit = items.find(i => i.innerText.includes(${JSON.stringify(text)}))
  if (!hit) return 'missing:' + items.map(i => i.innerText).join('|')
  hit.click()
  return 'clicked'
})()`)

await send('Page.navigate', { url: appUrl }, sessionId)
await sleep(3500)

console.log('=== a second article, then delete it ===')
await openDocMenu()
await sleep(400)
check('the switcher opens', (await menuItem('新建')).startsWith('clicked'), '')
await sleep(800)
const names = await ev(`JSON.stringify(JSON.parse(localStorage.getItem('mopai.docs.v1')).map(d => d.name))`)
check('two articles exist locally', JSON.parse(names).length === 2, names)

await openDocMenu()
await sleep(400)
const del = await ev(`(() => {
  const b = document.querySelector('button[title="删除这篇稿件"]')
  if (!b) return 'no delete button'
  b.click()
  return 'clicked'
})()`)
check('the delete button is there once two docs exist', del === 'clicked', del)
await sleep(600)
check('the toast says where it went', await ev(`document.body.innerText.includes('已移入回收站')`), '')
const afterDelete = await ev(`(() => {
  const all = JSON.parse(localStorage.getItem('mopai.docs.v1'))
  return JSON.stringify({ live: all.filter(d => !d.deletedAt).length, trashed: all.filter(d => d.deletedAt).length })
})()`)
check('one live and one trashed in the local store', JSON.parse(afterDelete).live === 1 && JSON.parse(afterDelete).trashed === 1, afterDelete)

console.log('\n=== the bin is reachable without an account ===')
await send('Page.navigate', { url: `${appUrl}drafts` }, sessionId)
await sleep(1500)
const bin = await ev(`(() => {
  const t = document.body.innerText
  return JSON.stringify({ hasBin: t.includes('回收站'), hasLoginWall: t.includes('草稿箱需要登录') })
})()`)
const b = JSON.parse(bin)
check('the wall still explains the archive', b.hasLoginWall === true, bin)
check('and the bin is shown anyway', b.hasBin === true, bin)

console.log('\n=== restore puts it back ===')
const restored = await ev(`(() => {
  const btn = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === '恢复')
  if (!btn) return 'no restore button'
  btn.click()
  return 'clicked'
})()`)
check('the restore button works', restored === 'clicked', restored)
await sleep(600)
const afterRestore = await ev(`(() => {
  const all = JSON.parse(localStorage.getItem('mopai.docs.v1'))
  return JSON.stringify({ live: all.filter(d => !d.deletedAt).length, trashed: all.filter(d => d.deletedAt).length })
})()`)
check('both articles are live again', JSON.parse(afterRestore).live === 2 && JSON.parse(afterRestore).trashed === 0, afterRestore)
check('the bin section is gone', !(await ev(`document.body.innerText.includes('回收站')`)), '')

console.log('\n=== purge is final ===')
await send('Page.navigate', { url: appUrl }, sessionId)
await sleep(2500)
await openDocMenu()
await sleep(400)
await ev(`document.querySelector('button[title="删除这篇稿件"]').click()`)
await sleep(600)
await send('Page.navigate', { url: `${appUrl}drafts` }, sessionId)
await sleep(1500)
// Stub confirm in the page: a real dialog pauses headless Chrome and every
// later evaluate deadlocks. The recorded message still proves it asked.
await ev(`window.__confirmed = null; window.confirm = (m) => { window.__confirmed = m; return true }; 'stubbed'`)
fire(`(() => {
  const btn = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === '彻底删除')
  if (btn) btn.click()
  return !!btn
})()`)
await sleep(900)
const asked = await ev(`String(window.__confirmed)`)
check('purging asks first', asked.includes('彻底删除'), asked)
await sleep(600)
const afterPurge = await ev(`(() => {
  const all = JSON.parse(localStorage.getItem('mopai.docs.v1'))
  return JSON.stringify({ live: all.filter(d => !d.deletedAt).length, trashed: all.filter(d => d.deletedAt).length })
})()`)
check('the purged article is really gone', JSON.parse(afterPurge).live === 1 && JSON.parse(afterPurge).trashed === 0, afterPurge)

chrome.kill()
try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* Chrome may hold it */ }
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`)
process.exit(failures === 0 ? 0 : 1)
