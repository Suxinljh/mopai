// Throwaway: render the sample doc with all three themes and assert the
// WeChat platform red lines. Bundled by esbuild so it can import src/lib/*.
import { parseMarkdown } from '../src/lib/parse'
import { renderDoc, setCarouselRatio, clearImageSrc, removeImageLine, collectMaterials } from '../src/lib/render'
import { THEMES, carouselFrame } from '../src/lib/themes'
import { previewPage, cleanHtml } from '../src/lib/clipboard'
import { SAMPLE_DOC } from '../src/lib/sample'
import { CAROUSEL_RATIOS, DEFAULT_CAROUSEL_RATIO } from '../src/lib/types'
import { manualOutputSize } from '../src/lib/image'
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

// --- carousel aspect ratios -------------------------------------------------
{
  console.log('\n=== carousel ratios ===')
  const withRatio = (r: string) =>
    `:::carousel ${r} 演示\n![A](img:a.png)\n![B](img:b.png)\n:::\n`
  const placeholders = (r: string) => `:::carousel ${r} 演示\n![A]()\n![B]()\n:::\n`

  for (const r of CAROUSEL_RATIOS) {
    const f = carouselFrame(r)
    const html = renderDoc(parseMarkdown(withRatio(r)), THEMES[0], sig, resolveImg).html
    const dims = new RegExp(`width="${f.width}" height="${f.height}"`, 'g')
    const found = (html.match(dims) || []).length
    check(r, 'every image carries the frame width/height attributes', found === 2, `${found}/2`)
    check(r, 'height:auto keeps the ratio when WeChat shrinks the width', /width:\d+px;height:auto/.test(html))
    const ph = renderDoc(parseMarkdown(placeholders(r)), THEMES[0], sig, resolveImg).html
    const phFrame = new RegExp(`width:${f.width}px;height:${f.height}px`, 'g')
    check(r, 'placeholder box uses the same frame', (ph.match(phFrame) || []).length === 2)
    // 宽高比真的对得上
    const implied = f.width / f.height
    const target = Number(r.split(':')[0]) / Number(r.split(':')[1])
    check(r, 'frame width/height matches the requested ratio', Math.abs(implied - target) < 0.02,
      `${f.width}x${f.height} vs ${r}`)
    // 轮播里的 img:key 也必须被解析成绝对地址（曾经漏掉，导致整条轮播裂图）
    check(r, 'carousel slides resolve img:key to an absolute URL',
      !/src="img:/.test(html) && (html.match(/src="https:\/\/mopai\.yoru-and-akari\.dev\/api\/img\//g) || []).length === 2)
  }

  // 老稿件没写比例，必须照旧能渲染
  const legacy = renderDoc(
    parseMarkdown(`:::carousel 老稿\n![A](img:a.png)\n:::\n`),
    THEMES[0], sig, resolveImg,
  ).html
  const dflt = carouselFrame(DEFAULT_CAROUSEL_RATIO)
  check('legacy', 'carousel without a ratio falls back to the default frame',
    legacy.includes(`width="${dflt.width}" height="${dflt.height}"`))

  // 无法识别的比例不能把标题吃掉
  const weird = renderDoc(parseMarkdown(`:::carousel 7:5 奇怪的比例\n![A](img:a.png)\n:::\n`), THEMES[0], sig, resolveImg).html
  check('legacy', 'unknown ratio is kept as part of the title',
    weird.includes('7:5 奇怪的比例') && weird.includes(`width="${dflt.width}" height="${dflt.height}"`))

  // 写回比例：只改目标轮播，别动别的
  const two = `:::carousel 4:3 第一个\n![A]()\n:::\n\n正文\n\n:::carousel 1:1 第二个\n![B]()\n:::\n`
  const rewritten = setCarouselRatio(two, 2, '16:9')
  check('rewrite', 'second carousel gets the new ratio', rewritten.includes(':::carousel 16:9 第二个'))
  check('rewrite', 'first carousel is untouched', rewritten.includes(':::carousel 4:3 第一个'))
  const first = setCarouselRatio(two, 1, '9:16')
  check('rewrite', 'first carousel gets the new ratio', first.includes(':::carousel 9:16 第一个'))
  check('rewrite', 'second carousel is untouched', first.includes(':::carousel 1:1 第二个'))
  check('rewrite', 'out-of-range occurrence is a no-op', setCarouselRatio(two, 9, '1:1') === two)
}

// --- per-image deletion -----------------------------------------------------
{
  console.log('\n=== delete / clear an image ===')
  const doc = `前面一段。\n\n![要删的单图](img:aaa.png)\n\n后面一段。\n`
  const removed = removeImageLine(doc, '要删的单图', 2)
  check('remove', 'standalone image line is gone', !removed.includes('img:aaa.png'))
  check('remove', 'surrounding prose survives',
    removed.includes('前面一段。') && removed.includes('后面一段。'))
  check('remove', 'no run of blank lines left behind', !/\n\n\n/.test(removed))
  check('remove', 'unknown alt is a no-op', removeImageLine(doc, '不存在', 0) === doc)

  const carousel = `:::carousel 4:3 组\n![甲](img:a.png)\n![乙](img:b.png)\n:::\n`
  const cleared = clearImageSrc(carousel, '甲', 1)
  check('clear', 'slide keeps its line but loses the src', cleared.includes('![甲]()'))
  check('clear', 'the other slide is untouched', cleared.includes('![乙](img:b.png)'))
  check('clear', 'carousel container survives',
    cleared.includes(':::carousel 4:3 组') && cleared.trimEnd().endsWith(':::'))

  // After clearing, the slide must render as a placeholder again, not a broken img.
  const reparsed = parseMarkdown(cleared)
  const mats = collectMaterials(reparsed)
  check('clear', 'cleared slide is reported as 待插图', mats[0].hasSrc === false && mats[1].hasSrc === true)
  const html = renderDoc(reparsed, THEMES[0], sig, resolveImg).html
  check('clear', 'no broken img left after clearing', (html.match(/<img /g) || []).length === 1)

  // Changing a whole carousel's ratio keeps its slides.
  const changed = setCarouselRatio(carousel, 1, '16:9')
  check('ratio-change', 'carousel ratio rewritten', changed.includes(':::carousel 16:9 组'))
  check('ratio-change', 'slides survive the ratio change',
    changed.includes('![甲](img:a.png)') && changed.includes('![乙](img:b.png)'))
  check('ratio-change', 'new ratio applies to the rendered frame',
    renderDoc(parseMarkdown(changed), THEMES[0], sig, resolveImg).html.includes(`width="${carouselFrame('16:9').width}"`))
}

// --- manual crop sizing -----------------------------------------------------
{
  console.log('\n=== manual crop sizing ===')
  // A carousel slide must come out at the frame ratio regardless of what the
  // user dragged, and the output width must match the automatic crop so slides
  // line up whichever route produced them.
  for (const r of CAROUSEL_RATIOS) {
    const f = carouselFrame(r)
    const out = manualOutputSize({ width: 3000, height: 2000 }, { ratio: r, targetWidth: f.cropWidth })
    check(r, 'manual crop matches the automatic frame size',
      out.width === f.cropWidth && out.height === f.cropHeight, `${out.width}x${out.height} vs ${f.cropWidth}x${f.cropHeight}`)
  }

  // Free crop keeps the dragged shape.
  const free = manualOutputSize({ width: 1200, height: 900 }, { ratio: null, targetWidth: 720 })
  check('free', 'free crop keeps the dragged aspect', Math.abs(free.width / free.height - 1200 / 900) < 0.01,
    `${free.width}x${free.height}`)

  // Never upscale: a small selection stays small.
  const small = manualOutputSize({ width: 100, height: 75 }, { ratio: '4:3', targetWidth: 720 })
  check('free', 'a small selection is not upscaled', small.width === 100, `${small.width}x${small.height}`)

  const tiny = manualOutputSize({ width: 10, height: 10 }, { ratio: null, targetWidth: 720 })
  check('free', 'a degenerate selection still yields at least 1px',
    tiny.width >= 1 && tiny.height >= 1, `${tiny.width}x${tiny.height}`)

  // Portrait free crop would be enormous at natural size, so it is capped.
  const portrait = manualOutputSize({ width: 2000, height: 4000 }, { ratio: null, targetWidth: 720 })
  check('free', 'portrait free crop is capped by the target width',
    portrait.width === 720 && portrait.height === 1440, `${portrait.width}x${portrait.height}`)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`)
process.exit(failures === 0 ? 0 : 1)
