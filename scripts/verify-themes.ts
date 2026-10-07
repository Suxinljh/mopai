// Throwaway: render the sample doc with all three themes and assert the
// WeChat platform red lines. Bundled by esbuild so it can import src/lib/*.
import { parseMarkdown } from '../src/lib/parse'
import { renderDoc, setCarouselRatio, clearImageSrc, removeImageLine, fillImageSrc, collectMaterials } from '../src/lib/render'
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
  s.startsWith('img:') ? `https://wechat.yoru-and-akari.dev/api/img/${s.slice(4)}` : s

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
  const expected = 'https://wechat.yoru-and-akari.dev/api/img/abc123-key.png'
  check('protocol', 'img:key resolves to absolute /api/img/ URL', html.includes(expected),
    html.includes('img:') ? 'raw img: leaked' : '')
  check('protocol', 'resolved image renders a real <img>', /<img [^>]*src="https:\/\/wechat/.test(html))
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
      !/src="img:/.test(html) && (html.match(/src="https:\/\/wechat\.yoru-and-akari\.dev\/api\/img\//g) || []).length === 2)
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
  // The third argument is the image's document-order index (the Nth `![`),
  // not a line number: captions repeat and carousel slides share a line, so an
  // index is the only unambiguous handle.
  const doc = `前面一段。\n\n![要删的单图](img:aaa.png)\n\n后面一段。\n`
  const removed = removeImageLine(doc, '要删的单图', 1)
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

  // Two slides with the same caption must still be told apart.
  const twins = `:::carousel 4:3 组\n![同图注](img:a.png)\n![同图注](img:b.png)\n:::\n`
  const clearedSecond = clearImageSrc(twins, '同图注', 2)
  check('clear', 'identical captions: the right slide is cleared',
    clearedSecond.includes('![同图注](img:a.png)') && clearedSecond.includes('![同图注]()'))
  const removedSecond = removeImageLine(twins, '同图注', 2)
  check('remove', 'identical captions: only the addressed line goes',
    removedSecond.includes('img:a.png') && !removedSecond.includes('img:b.png'))

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

// --- uploading an image back into the source --------------------------------
// This is the path the editor takes right after an upload. It used to locate the
// target by caption + nearest line, which filled the wrong image whenever two
// slides shared a caption. Nothing exercised it, so it stayed broken.
{
  console.log('\n=== fill the uploaded src back in ===')
  const slots = `:::carousel 4:3 组\n![同图注]()\n![同图注]()\n![同图注]()\n:::\n`
  const filled2 = fillImageSrc(slots, '同图注', 2, 'img:key2')
  check('fill', 'only the addressed placeholder is filled',
    filled2.includes('![同图注]()\n![同图注](img:key2)\n![同图注]()'))

  const past = `![第一张](img:1)\n\n正文里夹着 ![行内图](img:inline) 一张图。\n\n![第二张]()\n`
  const filledLast = fillImageSrc(past, '第二张', 3, 'img:key3')
  check('fill', 'index counts inline images the AST cannot see',
    filledLast.includes('![第二张](img:key3)') && filledLast.includes('![行内图](img:inline)'))

  check('fill', 'an index with no match leaves the source alone',
    fillImageSrc(past, '第二张', 9, 'img:key9') === past)
  check('fill', 'a caption mismatch refuses the write',
    fillImageSrc(slots, '别的图注', 1, 'img:key1') === slots)

  // End to end: fill one slide of a carousel, re-parse, and confirm the slide
  // that received the key is the one that renders.
  const repo = parseMarkdown(fillImageSrc(slots, '同图注', 2, 'img:key2'))
  const repoMats = collectMaterials(repo)
  check('fill', 'the filled slide is the one reported as uploaded',
    repoMats[0].hasSrc === false && repoMats[1].hasSrc === true && repoMats[2].hasSrc === false)
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

// --- sqlite driver: a miss must be a miss ------------------------------------
{
  console.log('\n=== sqlite driver hit / miss ===')
  // Regression: the driver answered a miss in a way that drizzle read as a row
  // of all-null columns, so a check-then-insert concluded the record already
  // existed and silently updated nothing. Core selects must distinguish hit
  // from miss; the relational API is not usable with this driver at all.
  const { DatabaseSync } = await import('node:sqlite')
  const { drizzle } = await import('drizzle-orm/sqlite-proxy')
  const { sqliteTable, integer, text } = await import('drizzle-orm/sqlite-core')
  const { eq } = await import('drizzle-orm')

  const docs = sqliteTable('docs', {
    id: text('id').primaryKey(),
    ownerId: integer('ownerId').notNull(),
    name: text('name').notNull(),
    createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
  })

  const raw = new DatabaseSync(':memory:')
  raw.exec('CREATE TABLE docs (id TEXT PRIMARY KEY, ownerId INTEGER NOT NULL, name TEXT NOT NULL, createdAt INTEGER NOT NULL)')
  const db = drizzle(
    async (sqlText: string, params: unknown[], method: string) => {
      const stmt = raw.prepare(sqlText)
      if (method === 'run') {
        const r = stmt.run(...(params as never[]))
        return { rows: [{ changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid }] }
      }
      if (method === 'get') {
        const row = stmt.get(...(params as never[]))
        if (row === undefined) return { rows: undefined as unknown as unknown[] }
        return { rows: Object.values(row) as unknown as unknown[] }
      }
      return { rows: stmt.all(...(params as never[])).map((row) => Object.values(row)) }
    },
    { schema: { docs } },
  )

  const one = (id: string) => db.select().from(docs).where(eq(docs.id, id)).limit(1)

  const miss = await one('nope')
  check('driver', 'select on a missing row comes back empty', miss.length === 0, `len=${miss.length}`)
  check('driver', 'a miss is not a row of nulls', miss.at(0) === undefined)

  const now = new Date()
  await db.insert(docs).values({ id: 'a', ownerId: 1, name: 'x', createdAt: now })
  const hit = await one('a')
  check('driver', 'select on a real row returns its values',
    hit.length === 1 && hit[0].id === 'a' && hit[0].name === 'x' && hit[0].ownerId === 1,
    JSON.stringify(hit))
  check('driver', 'timestamp columns come back as Dates', hit[0]?.createdAt instanceof Date)

  const stillMissing = await one('other')
  check('driver', 'a hit does not make later misses look like hits', stillMissing.length === 0)
  check('driver', 'the table really holds one row',
    (raw.prepare('select count(*) c from docs').get() as { c: number }).c === 1)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`)
process.exit(failures === 0 ? 0 : 1)
