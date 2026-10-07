// Theme-library expansion + moon-phase logo verification.
// Drives the real built app in headless Chrome via CDP. Usage:
//   node scripts/cdp-verify-themes9.mjs http://127.0.0.1:3200 <shots-dir>

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY']) delete process.env[k]

const APP = process.argv[2] || 'http://127.0.0.1:3200'
const SHOTS = process.argv[3] || ''
const PORT = 9333
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-cdp-t9-'))
const envText = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const KEY = envText.match(/^ACCESS_KEY=(.+)$/m)[1].trim()

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-gpu', '--window-size=1600,900',
  '--no-proxy-server', '--proxy-bypass-list=<-loopback>', 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl } catch {}
    await sleep(250)
  }
  throw new Error('CDP not reachable')
}

let id = 1
const pend = new Map()
const ws = new WebSocket(await wsUrl())
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pend.has(m.id)) { const { resolve, reject } = pend.get(m.id); pend.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result) }
})
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const i = id++
  pend.set(i, { resolve, reject })
  ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }))
  setTimeout(() => { if (pend.has(i)) { pend.delete(i); reject(new Error('timeout ' + method)) } }, 30000)
})

const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Page.enable', {}, sessionId)
await send('Runtime.enable', {}, sessionId)

const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId)
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
  return r.result.value
}
const shot = async (name) => {
  if (!SHOTS) return
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from(data, 'base64'))
  console.log('  [shot]', name)
}
const goto = async (url, wait = 3000) => { await send('Page.navigate', { url }, sessionId); await sleep(wait) }

let pass = 0, fail = 0
const check = (label, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) } else { fail++; console.log(`  FAIL  ${label}  ${detail}`) }
}

try {
  await goto(APP, 3500)
  await evaluate(`fetch('/api/trpc/auth.login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({json:{accessKey:${JSON.stringify(KEY)}}})}).then(r=>r.text())`)

  // ==== 1. moon-phase logo ==================================================
  console.log('\n=== moon-phase logo ===')
  await goto(APP, 4000)
  const logo = await evaluate(`(() => {
    const svg = document.querySelector('header svg[aria-label=Yoru]')
    if (!svg) return null
    const shapes = [...svg.querySelectorAll('circle,path')]
    const fullMoon = shapes.find(s => s.getAttribute('fill') === '#2E4A68')
    return {
      count: shapes.length,
      hasFullMoon: !!fullMoon,
      box: svg.getBoundingClientRect().width,
    }
  })()`)
  check('moon-phase SVG in the top bar', !!logo)
  check('four moon shapes (新月/上弦/满月/下弦)', logo && logo.count === 4, `shapes=${logo && logo.count}`)
  check('full moon uses brand indigo #2E4A68', logo && logo.hasFullMoon)
  await goto(APP + '/login', 2500)
  const loginLogo = await evaluate(`(() => {
    const svg = document.querySelector('svg[aria-label=Yoru]')
    return svg ? svg.getBoundingClientRect().height : 0
  })()`)
  check('login shows the large moon-phase strip', loginLogo >= 28, `h=${loginLogo}`)

  // ==== 2. /themes gallery with 9 cards in 4 categories =====================
  console.log('\n=== /themes: 9 cards, 4 categories ===')
  await goto(APP, 3500)
  // open theme popover (plain click) and check the compact grid
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('header button')].find(x => x.querySelector('span.rounded-full'))
    b.click()
  })()`)
  await sleep(800)
  const pop = await evaluate(`(() => {
    const wrap = document.querySelector('[data-radix-popper-content-wrapper]')
    if (!wrap) return null
    const cards = [...wrap.querySelectorAll('button')].filter(b => b.querySelector('.ya-dot'))
    const cats = [...wrap.querySelectorAll('p')].map(p => p.textContent.trim()).filter(t => ['简约','商务','杂志','活力'].includes(t))
    return { cards: cards.length, cats }
  })()`)
  check('popover lists 9 theme cards', pop && pop.cards === 9, `cards=${pop && pop.cards}`)
  check('popover groups all 4 categories', pop && pop.cats.length === 4, JSON.stringify(pop && pop.cats))
  // enter the gallery through the popover entry
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('[data-radix-popper-content-wrapper] button')].find(x => x.textContent.includes('查看全部模板'))
    if (b) b.click()
  })()`)
  await sleep(2200)
  const gallery = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('main .ya-well')]
    const sections = [...document.querySelectorAll('main section')]
    const catTitles = sections.map(s => s.querySelector('span')?.textContent?.trim()).filter(t => ['简约','商务','杂志','活力'].includes(t))
    return {
      onThemes: location.pathname === '/themes',
      cards: cards.length,
      rendered: cards.filter(c => c.querySelector('section') && c.innerHTML.includes('章节标题示例')).length,
      catTitles,
      names: cards.map(c => c.textContent.slice(0, 10)),
    }
  })()`)
  check('navigated to /themes', gallery.onThemes)
  check('9 template cards render', gallery.cards === 9, `cards=${gallery.cards}`)
  check('every card shows a REAL rendered preview', gallery.rendered === 9, `rendered=${gallery.rendered}`)
  check('4 category groups render', gallery.catTitles.length === 4, JSON.stringify(gallery.catTitles))
  await shot('10-themes-9.png')

  // ==== 3. switching to a new theme applies to the editor ===================
  console.log('\n=== pick 摸鱼绿 and verify in the editor ===')
  const picked = await evaluate(`(() => {
    const card = [...document.querySelectorAll('main .ya-well')].find(c => c.textContent.includes('摸鱼绿'))
    if (!card) return null
    const btn = [...card.querySelectorAll('button')].find(b => b.textContent.includes('使用此模板'))
    if (!btn) return 'no-btn'
    btn.click()
    return 'clicked'
  })()`)
  check('clicked 使用此模板 on 摸鱼绿', picked === 'clicked', String(picked))
  await sleep(2800)
  const applied = await evaluate(`(() => {
    const s = JSON.parse(localStorage.getItem('mopai.settings.v1'))
    // the preview pane should now carry the moyu-green accent somewhere
    const html = document.querySelector('.overflow-y-auto')?.innerHTML || document.body.innerHTML
    return { themeId: s.themeId, green: html.includes('#059669') || html.includes('rgb(5, 150, 105)') }
  })()`)
  check('themeId persisted as moyu-green', applied.themeId === 'moyu-green', applied.themeId)
  check('editor preview re-rendered with 摸鱼绿 accent', applied.green)
  await shot('11-editor-moyu-green.png')
  // restore default for future runs
  await evaluate(`(() => { const s = JSON.parse(localStorage.getItem('mopai.settings.v1')); s.themeId = 'golden'; localStorage.setItem('mopai.settings.v1', JSON.stringify(s)) })()`)

  console.log(`\n==== RESULT: ${pass} passed, ${fail} failed ====`)
  process.exitCode = fail ? 1 : 0
} finally {
  chrome.kill()
}
