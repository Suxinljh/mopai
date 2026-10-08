// Smoke check for the import/export menus. Radix dropdowns open on pointerdown,
// so a plain .click() leaves them shut - the pattern here matches the one the
// main acceptance script already uses successfully.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PORT = 9337
const appUrl = 'http://127.0.0.1:3202/'
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-'))
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
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); reject(new Error('timeout ' + method)) } }, 20000)
  })
}

const ws = new WebSocket(await wsUrl())
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
const send = client(ws)
const { targetId } = await send('Target.createTarget', { url: appUrl })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Page.enable', {}, sessionId)
await send('Runtime.enable', {}, sessionId)
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result.value
}
await sleep(4500)

async function menu(label) {
  await ev(`(() => {
    const b = [...document.querySelectorAll('header button')].find(x => x.textContent.trim() === ${JSON.stringify(label)})
    if (!b) return 'no button'
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    b.click()
    return 'ok'
  })()`)
  await sleep(800)
  const items = await ev(`JSON.stringify([...document.querySelectorAll('[role=menuitem]')].map(i => i.textContent.trim()))`)
  await ev(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); document.body.click()`)
  await sleep(500)
  return JSON.parse(items)
}

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`)
}

const imp = await menu('导入')
console.log('导入菜单:', JSON.stringify(imp))
check('导入 offers Markdown', imp.some((t) => t.includes('Markdown')), JSON.stringify(imp))
check('导入 offers Word', imp.some((t) => t.includes('Word')), JSON.stringify(imp))
check('导入 offers a bundle', imp.some((t) => t.includes('整包')), JSON.stringify(imp))

const exp = await menu('导出')
console.log('导出菜单:', JSON.stringify(exp))
check('导出 offers Markdown source', exp.some((t) => t.includes('Markdown 源稿')), JSON.stringify(exp))
check('导出 keeps clean HTML', exp.some((t) => t.includes('干净正文')), JSON.stringify(exp))
check('导出 keeps the preview page', exp.some((t) => t.includes('预览页')), JSON.stringify(exp))
check('导出 offers a whole-bundle backup', exp.some((t) => t.includes('整包备份')), JSON.stringify(exp))

const userMenu = await ev(`JSON.stringify([...document.querySelectorAll('header button, header [role=menuitem]')].length)`)
check('header still renders its controls', Number(userMenu) > 5, userMenu)

chrome.kill()
try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* Chrome may hold it */ }
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`)
process.exit(failures === 0 ? 0 : 1)
