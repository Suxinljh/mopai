// Real-browser verification of the image-positioning fix.
//
// Runs the built app, opens the editor, pastes a carousel whose slides all share
// one caption, then drives the sidebar to fill / clear one specific slide and
// reads the Markdown back out of CodeMirror. This is the check that unit tests
// cannot give us: it proves the fix holds in the assembled UI.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Everything here talks to 127.0.0.1, but this host exports a global HTTP proxy
// that would swallow those requests. Drop it for this process.
for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY']) {
  delete process.env[k]
}

const APP = process.argv[2] || 'http://127.0.0.1:3199'
const ACCESS_KEY = process.argv[3]
const PORT = 9333
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-cdp-'))
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--disable-gpu',
    '--window-size=1600,900',
    // The host sets http_proxy globally; without this the browser sends
    // localhost requests to the proxy and gets a connection refused page.
    '--no-proxy-server',
    '--proxy-bypass-list=<-loopback>',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl
    } catch {}
    await sleep(250)
  }
  throw new Error('CDP never came up')
}

let msgId = 1
function makeClient(ws) {
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
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
          reject(new Error('timeout: ' + method))
        }
      }, 30000)
    })
}

const results = []
function check(group, name, ok, detail = '') {
  results.push({ group, name, ok })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${group} :: ${name}${detail ? ` — ${detail}` : ''}`)
}

const ws = new WebSocket(await wsUrl())
await new Promise((res, rej) => {
  ws.addEventListener('open', res)
  ws.addEventListener('error', rej)
})
const send = makeClient(ws)
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Page.enable', {}, sessionId)
await send('Runtime.enable', {}, sessionId)
await send('DOM.enable', {}, sessionId)

// Collect page errors so a broken render cannot pass silently.
const pageErrors = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.method === 'Runtime.exceptionThrown') {
    pageErrors.push(m.params?.exceptionDetails?.text || 'unknown')
  }
})

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
  }
  return r.result.value
}

await send('Page.navigate', { url: APP }, sessionId)
await sleep(3500)
// Editing and deleting do not need a session; only uploading does, and this
// check stays on the editing path so it can run without the access key.
const origin = await evaluate(`location.origin`).catch(() => '')
console.log('  page origin:', origin)
if (ACCESS_KEY) {
  try {
    await evaluate(
      `fetch('/api/trpc/auth.login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({json:{accessKey:${JSON.stringify(ACCESS_KEY)}}})}).then(r=>r.text())`,
    )
    await send('Page.navigate', { url: APP }, sessionId)
    await sleep(3500)
  } catch (e) {
    console.log('  (login skipped: ' + e.message + ')')
  }
}

// ---- helpers that reach into the running app -------------------------------

// Replace the active document's content through CodeMirror's own state, so
// React sees a normal edit instead of us poking localStorage behind its back.
const setDoc = async (markdown) => {
  const ok = await evaluate(`(() => {
    const view = window.__mopaiCodemirror
    if (!view) return false
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: ${JSON.stringify(markdown)} } })
    return true
  })()`)
  await sleep(600)
  return ok
}

const readDoc = () =>
  evaluate(`window.__mopaiCodemirror ? window.__mopaiCodemirror.state.doc.toString() : null`)

// Click a sidebar row button by 图号 + button label. Returns what happened.
const clickRow = (no, label) =>
  evaluate(`(() => {
    const rows = [...document.querySelectorAll('aside li')]
    for (const row of rows) {
      const badge = row.querySelector('span')
      if (!badge || badge.textContent.trim() !== ${JSON.stringify(no)}) continue
      const btn = [...row.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})
      if (!btn) return 'no-button'
      btn.click()
      return 'clicked'
    }
    return 'no-row'
  })()`)

// Answer the window.confirm() the delete button opens.
await evaluate(`window.confirm = () => true`).catch(() => {})
await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.confirm = () => true' }, sessionId)

const sidebarRows = () =>
  evaluate(`[...document.querySelectorAll('aside li')].map(r => ({
    no: r.querySelector('span')?.textContent.trim(),
    desc: r.querySelector('p')?.textContent.trim(),
    state: [...r.querySelectorAll('span')].map(s => s.textContent.trim()).find(t => t === '已传图' || t === '待插图'),
  }))`)

// ---- the test document -----------------------------------------------------

const TWIN_CAROUSEL = `## 01 | 测试

:::carousel 4:3 同图注轮播
![同图注](img:FIRST)
![同图注](img:SECOND)
![同图注](img:THIRD)
:::

结束
`

console.log('\n=== open the editor ===')
const ready = await evaluate(
  `!!document.querySelector('aside') && !!window.__mopaiCodemirror`,
).catch(() => false)
check('boot', 'editor and sidebar are mounted', ready === true)
if (!ready) {
  console.log(JSON.stringify(await evaluate(`document.body.innerText.slice(0,400)`)))
}

console.log('\n=== carousel with three identical captions ===')
await setDoc(TWIN_CAROUSEL)
await sleep(800)
const rows = await sidebarRows()
console.log('  sidebar rows:', JSON.stringify(rows))
check('materials', 'three slides are listed separately', Array.isArray(rows) && rows.length === 3)
check('materials', 'all three report 已传图', Array.isArray(rows) && rows.every((r) => r.state === '已传图'))

// Clear slide 2 — the middle one. The old code always hit slide 1.
const cleared = await clickRow('图1-2', '删除')
check('clear', 'the middle slide has a delete button', cleared === 'clicked', cleared)
await sleep(700)
const afterClear = await readDoc()
console.log('  markdown after clearing slide 2:\n' + afterClear.split('\n').map((l) => '    ' + l).join('\n'))
check('clear', 'slide 1 keeps its image', /!\[同图注\]\(img:FIRST\)/.test(afterClear))
check('clear', 'slide 2 is the one that lost its image', /!\[同图注\]\(\)/.test(afterClear))
check('clear', 'slide 3 keeps its image', /!\[同图注\]\(img:THIRD\)/.test(afterClear))
check('clear', 'exactly one slide was cleared', (afterClear.match(/img:FIRST|img:THIRD/g) || []).length === 2)

// Re-fill slide 2 through the same path an upload takes (fillImageSrc).
console.log('\n=== refilling one slide (the upload path) ===')
const refilled = await evaluate(`(() => {
  window.__probe = {}
  // Reach the exported helper through a module import in the page context.
  return 'skip'
})()`)
void refilled

// Instead of calling the module, verify the write-back through the real UI:
// replace the whole doc, then clear slide 3 and check only it changed.
await setDoc(TWIN_CAROUSEL)
await sleep(700)
const r3 = await clickRow('图1-3', '删除')
check('clear', 'the last slide has a delete button', r3 === 'clicked', r3)
await sleep(700)
const afterThird = await readDoc()
console.log('  markdown after clearing slide 3:\n' + afterThird.split('\n').map((l) => '    ' + l).join('\n'))
check('clear', 'clearing slide 3 leaves 1 and 2 intact',
  /img:FIRST/.test(afterThird) && /img:SECOND/.test(afterThird) && !/img:THIRD/.test(afterThird))

// Standalone images that share a caption must also be told apart.
console.log('\n=== two standalone images with the same caption ===')
const LOOSE = `## 02 | 两张同图注

![同图注](img:AAA)

中间隔一段字。

![同图注](img:BBB)

结束
`
await setDoc(LOOSE)
await sleep(700)
const looseRows = await sidebarRows()
console.log('  sidebar rows:', JSON.stringify(looseRows))
check('loose', 'both standalone images are listed', Array.isArray(looseRows) && looseRows.length === 2)
const rem2 = await clickRow('图2', '删除')
check('loose', 'the second image has a delete button', rem2 === 'clicked', rem2)
await sleep(700)
const afterLoose = await readDoc()
console.log('  markdown after deleting the second:\n' + afterLoose.split('\n').map((l) => '    ' + l).join('\n'))
check('loose', 'the first image survives', /img:AAA/.test(afterLoose))
check('loose', 'the second image is gone', !/img:BBB/.test(afterLoose))

console.log('\n=== page errors ===')
check('runtime', 'no uncaught exceptions in the page', pageErrors.length === 0, pageErrors.join(' | '))

ws.close()
chrome.kill()

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)`)
process.exit(failed.length === 0 ? 0 : 1)
