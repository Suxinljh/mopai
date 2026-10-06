// Throwaway: render the sample doc with all three themes and assert the
// WeChat platform red lines. Bundled by esbuild so it can import src/lib/*.
import { parseMarkdown } from '../src/lib/parse'
import { renderDoc } from '../src/lib/render'
import { THEMES } from '../src/lib/themes'
import { previewPage, cleanHtml } from '../src/lib/clipboard'
import { SAMPLE_DOC } from '../src/lib/sample'
import fs from 'node:fs'

const OUT = process.env.MOPAI_VERIFY_OUT || './verify-out'
fs.mkdirSync(OUT, { recursive: true })

const sig = { layout: 'Yoru', proof: 'Yoru', review: 'Yoru' }
// Same resolver the editor uses, pointed at the deployed image host.
const resolveImg = (s: string) =>
  s.startsWith('img:') ? `https://mopai.yoru-and-akari.dev/api/img/${s.slice(4)}` : s

const parsed = parseMarkdown(SAMPLE_DOC)

let failures = 0
function check(theme: string, name: string, ok: boolean, detail = '') {
  if (!ok) failures++
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${theme} :: ${name}${detail ? ' — ' + detail : ''}`)
}

/** Count only top-level <section> elements (nesting-aware). */
function countRootSections(html: string): number {
  let depth = 0
  let roots = 0
  for (const m of html.matchAll(/<(\/?)section\b[^>]*>/g)) {
    if (m[1] === '/') {
      depth--
    } else {
      if (depth === 0) roots++
      depth++
    }
  }
  return roots
}

/** Text that sits outside every <span leaf=""> wrapper is a pasting hazard. */
function bareTextRuns(html: string): string[] {
  const withoutLeafSpans = html.replace(/<span[^>]*>[\s\S]*?<\/span>/g, '')
  return withoutLeafSpans
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** Items across all carousel blocks — each is counted in stats.images but shares one 图N caption. */
function carouselItemCount(doc: ReturnType<typeof parseMarkdown>): number {
  return doc.blocks.reduce((n, b) => n + (b.type === 'carousel' ? b.items.length : 0), 0)
}

console.log('front matter titles:', parsed.meta.titles.length, '| cover:', !!parsed.meta.cover)
console.log('blocks:', parsed.blocks.length)

for (const theme of THEMES) {
  console.log(`\n=== theme: ${theme.id} (${theme.name}) ===`)
  let html: string
  let stats: ReturnType<typeof renderDoc>['stats']
  try {
    const r = renderDoc(parsed, theme, sig, resolveImg)
    html = r.html
    stats = r.stats
  } catch (e) {
    check(theme.id, 'renders without throwing', false, String(e))
    continue
  }
  check(theme.id, 'renders without throwing', true)
  console.log(`  chars=${stats.chars} images=${stats.images} carousels=${stats.carousels}`)

  // --- platform red lines ---
  const roots = countRootSections(html)
  check(theme.id, 'exactly one root <section>', roots === 1, `found ${roots}`)
  check(theme.id, 'starts with <section', html.trimStart().startsWith('<section'))
  check(theme.id, 'no <script>', !/<script/i.test(html))
  check(theme.id, 'no <style>', !/<style/i.test(html))
  check(theme.id, 'no <div>', !/<div/i.test(html))
  check(theme.id, 'no class= attribute', !/\sclass=/i.test(html))
  check(theme.id, 'no id= attribute', !/\sid=/i.test(html))
  check(theme.id, 'no position:fixed/absolute/sticky', !/position:\s*(fixed|absolute|sticky)/i.test(html))
  check(theme.id, 'no display:grid', !/display:\s*grid/i.test(html))
  check(theme.id, 'no @media/@keyframes', !/@media|@keyframes/i.test(html))
  check(theme.id, 'no float', !/float:/i.test(html))

  const bare = bareTextRuns(html)
  check(theme.id, 'every text run wrapped in <span leaf="">', bare.length === 0,
    bare.slice(0, 3).join(' | '))

  const blanks = (html.match(/<p style="margin:0;"><span leaf="">&nbsp;<\/span><\/p>/g) || []).length
  check(theme.id, 'boxed modules padded with blank paragraphs', blanks > 0, `count=${blanks}`)

/** Source-less images become plain placeholder paragraphs. Carousel items are
   * counted in stats.images but share one 图N caption on the carousel module. */
  const standalone = parsed.blocks.filter((b) => b.type === 'image' && !b.src).length
  const carouselsWithoutSrc = parsed.blocks.filter(
    (b) => b.type === 'carousel' && b.items.every((it) => !it.src),
  ).length
  const placeholders = html.match(/<p[^>]*><span leaf="">图\d+ [^<]*<\/span><\/p>/g) || []
  check(theme.id, 'source-less images become standalone 图N paragraphs',
    placeholders.length === standalone + carouselsWithoutSrc,
    `${placeholders.length}/${standalone + carouselsWithoutSrc}`)
  check(theme.id, 'no <img> when nothing is uploaded', !/<img /.test(html))

  const clean = cleanHtml(html)
  const page = previewPage(html, `墨排-${theme.id}`)
  fs.writeFileSync(`${OUT}/${theme.id}_clean.html`, clean, 'utf8')
  fs.writeFileSync(`${OUT}/${theme.id}_preview.html`, page, 'utf8')
  console.log(`  wrote ${theme.id}_clean.html (${clean.length} B), ${theme.id}_preview.html (${page.length} B)`)
}

// --- img:key protocol: a resolved image must reach the output as an absolute URL ---
{
  console.log('\n=== img:key protocol ===')
  const withImg = `# 标题\n\n![配图说明](img:abc123-key.png)\n\n正文一段。\n`
  const doc = parseMarkdown(withImg)
  const html = renderDoc(doc, THEMES[0], sig, resolveImg).html
  const expected = 'https://mopai.yoru-and-akari.dev/api/img/abc123-key.png'
  check('protocol', 'img:key resolves to absolute /api/img/ URL', html.includes(expected),
    html.includes('img:') ? 'raw img: leaked' : '')
  check('protocol', 'resolved image renders a real <img>', /<img [^>]*src="https:\/\/mopai/.test(html))
  check('protocol', 'resolved image keeps its caption text', html.includes('图1 配图说明'))

  const noSrc = renderDoc(parseMarkdown(`![待补图]()\n`), THEMES[0], sig, resolveImg).html
  check('protocol', 'empty src yields placeholder paragraph only', !/<img /.test(noSrc) && noSrc.includes('图1 待补图'))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`)
process.exit(failures === 0 ? 0 : 1)
