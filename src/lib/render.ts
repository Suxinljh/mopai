import type { Block, CarouselRatio, Doc, InlineSeg, RenderStats, SignatureConfig } from './types'
import { baseTableBlock, BLANK, esc, type Theme } from './themes'

// 盒式模块的前后空行由 pushBlock(boxed=true) 统一插入

function renderSegs(theme: Theme, segs: InlineSeg[]): string {
  return segs
    .map((s) => {
      if (s.text === '\n') return '<br/>'
      return theme.seg(s)
    })
    .join('')
}

export type ImageResolver = (src: string) => string

export function renderDoc(
  doc: Doc,
  theme: Theme,
  sig: SignatureConfig,
  resolveImg: ImageResolver = (s) => s,
): { html: string; stats: RenderStats } {
  const warnings: string[] = []
  let chars = 0
  let images = 0
  let carousels = 0
  let headingNo = 0
  let imageNo = 0

  const parts: string[] = []

  const pushBlock = (html: string, boxed: boolean) => {
    const isFirst = parts.length === 0
    if (boxed && !isFirst) parts.push(BLANK)
    parts.push(html)
    if (boxed) parts.push(BLANK)
  }

  for (const b of doc.blocks) {
    switch (b.type) {
      case 'paragraph': {
        chars += countSegs(b.segs)
        warnLinks(b.segs, warnings)
        parts.push(theme.paragraph(renderSegs(theme, b.segs)))
        break
      }
      case 'heading': {
        headingNo += b.numbered ? 1 : 0
        chars += b.title.length + b.kicker.length
        parts.push(theme.heading(b.numbered ? headingNo : null, b.kicker, b.title))
        break
      }
      case 'subheading':
        chars += b.title.length
        parts.push(theme.subheading(b.title))
        break
      case 'center':
        chars += countSegs(b.segs)
        warnLinks(b.segs, warnings)
        parts.push(theme.center(renderSegs(theme, b.segs)))
        break
      case 'quoteCard':
        chars += countSegs(b.segs)
        pushBlock(theme.quoteCard(renderSegs(theme, b.segs)), true)
        break
      case 'quoteBox':
        b.paras.forEach((p) => (chars += countSegs(p)))
        pushBlock(theme.quoteBox(b.paras.map((p) => renderSegs(theme, p))), true)
        break
      case 'image': {
        images++
        imageNo++
        const alt = b.alt || '未命名图片'
        if (!b.alt) warnings.push(`图${imageNo} 缺少说明文字（![说明](src)）`)
        const caption = `图${imageNo} ${alt}`
        parts.push(theme.imageBlock(b.src ? resolveImg(b.src) : '', caption))
        break
      }
      case 'carousel': {
        carousels++
        imageNo++
        images += b.items.length
        if (b.items.length < 2) warnings.push('轮播至少需要 2 张图片')
        const caption = `图${imageNo} ${b.title || '多图轮播'}（共 ${b.items.length} 张）`
        // Carousel slides go through the same resolver as single images; skipping
        // it left `img:key` untouched and the slides rendered as broken images.
        const items = b.items.map((it) => ({ ...it, src: it.src ? resolveImg(it.src) : '' }))
        pushBlock(theme.carousel(b.title, caption, items, b.ratio), true)
        break
      }
      case 'signature':
        pushBlock(theme.signature(sig), true)
        break
      case 'list':
        b.items.forEach((it) => {
          chars += countSegs(it)
          warnLinks(it, warnings)
        })
        parts.push(theme.listBlock(b.ordered, b.items.map((it) => renderSegs(theme, it))))
        break
      case 'table': {
        const cells = [...b.head, ...b.rows.flat()]
        cells.forEach((c) => {
          chars += countSegs(c)
          warnLinks(c, warnings)
        })
        const tableBlock = theme.tableBlock ?? ((h, r, a) => baseTableBlock(h, r, a))
        pushBlock(
          tableBlock(
            b.head.map((c) => renderSegs(theme, c)),
            b.rows.map((r) => r.map((c) => renderSegs(theme, c))),
            b.align,
          ),
          true,
        )
        break
      }
      case 'code':
        pushBlock(theme.codeBlock(b.lang, b.code), true)
        break
      case 'hr':
        parts.push(theme.hr())
        break
    }
  }

  // 收尾：连续空行去重、去掉末尾多余空行
  const cleaned: string[] = []
  for (const p of parts) {
    if (p === BLANK && cleaned[cleaned.length - 1] === BLANK) continue
    cleaned.push(p)
  }
  while (cleaned.length && cleaned[cleaned.length - 1] === BLANK) cleaned.pop()

  const html = theme.root(cleaned.join('\n'))
  return { html, stats: { chars, images, carousels, warnings: [...new Set(warnings)] } }
}

function countSegs(segs: InlineSeg[]): number {
  return segs.reduce((n, s) => n + (s.text === '\n' ? 0 : s.text.length), 0)
}

function warnLinks(segs: InlineSeg[], warnings: string[]) {
  if (segs.some((s) => s.link)) warnings.push('检测到链接：公众号正文外链不可点击，已渲染为普通文字')
}

// 素材清单：逐张图片一行（轮播拆成单张），供后台插图对照与上传回填
export interface MaterialItem {
  no: string // 图N 或 图N-M
  kind: '单图' | '轮播'
  desc: string
  alt: string // Markdown 中的 alt，用于上传后定位回填
  /** Raw src from the Markdown, e.g. `img:<key>`; empty for a placeholder. */
  src: string
  hasSrc: boolean
  line: number
  /**
   * 1-based index of this image among every `![...](...)` in the raw Markdown.
   * Used to address the exact image back in the source — captions are not
   * unique, and every slide in a carousel shares one line number.
   */
  occurrence: number
  /** Set for carousel items: every image in one carousel shares this frame. */
  ratio?: CarouselRatio
  /** Index of the carousel block, so the UI can group items of the same carousel. */
  carouselOrdinal?: number
}

export function collectMaterials(doc: Doc): MaterialItem[] {
  const out: MaterialItem[] = []
  let imageNo = 0
  let carouselNo = 0
  for (const b of doc.blocks) {
    if (b.type === 'image') {
      imageNo++
      out.push({
        no: `图${imageNo}`,
        kind: '单图',
        desc: b.alt || '未命名图片',
        alt: b.alt,
        src: b.src,
        hasSrc: !!b.src,
        line: b.line,
        occurrence: b.occurrence,
      })
    } else if (b.type === 'carousel') {
      imageNo++
      carouselNo++
      b.items.forEach((it, idx) => {
        out.push({
          no: `图${imageNo}-${idx + 1}`,
          kind: '轮播',
          desc: `${b.title ? b.title + ' · ' : ''}${it.alt || '未命名'}`,
          alt: it.alt,
          src: it.src,
          hasSrc: !!it.src,
          line: b.line,
          occurrence: it.occurrence,
          ratio: b.ratio,
          carouselOrdinal: carouselNo,
        })
      })
    }
  }
  return out
}

/**
 * Locate the exact `![alt](...)` that `occurrence` refers to.
 *
 * The old implementation searched by "nearest line number, then first line whose
 * text contains the caption". Both halves are wrong once captions repeat:
 * a carousel hands every slide the same line, and several images may share a
 * caption, so the search silently edited whichever match it hit first. We now
 * count `![...](` in document order and pick the Nth — the same order the
 * parser numbered them in.
 *
 * Returns null when the index does not exist, so callers can report a failure
 * instead of quietly writing to the wrong image.
 */
interface ImageSpan {
  start: number
  openEnd: number // index just past the opening `![alt](`
  end: number // index of the closing `)`
  alt: string // caption as it appears in the source
}

function findImageSpan(content: string, occurrence: number): ImageSpan | null {
  if (occurrence < 1) return null
  const re = /!\[([^\]]*)\]\(/g
  let m: RegExpExecArray | null
  let seen = 0
  while ((m = re.exec(content))) {
    seen++
    if (seen !== occurrence) continue
    const start = m.index
    const openEnd = m.index + m[0].length
    const end = content.indexOf(')', openEnd)
    if (end < 0) return null
    return { start, openEnd, end, alt: m[1].trim() }
  }
  return null
}

/**
 * Address one image by its document-order index, checking the caption matches.
 *
 * The index alone is enough to find the Nth `![`, but if the user typed a new
 * image above it the index shifts and we would edit a stranger. Comparing the
 * caption turns that silent corruption into a refused edit.
 */
function locate(content: string, alt: string, occurrence: number): ImageSpan | null {
  const span = findImageSpan(content, occurrence)
  if (!span) return null
  if (span.alt !== alt.trim()) return null
  return span
}

/**
 * Fill the src of the addressed image. Returns the content unchanged when the
 * occurrence cannot be found — the caller is expected to surface that as an
 * error rather than assume success.
 */
export function fillImageSrc(content: string, alt: string, occurrence: number, src: string): string {
  const span = locate(content, alt, occurrence)
  if (!span) return content
  return content.slice(0, span.openEnd) + src + content.slice(span.end)
}

/**
 * Clear the src of one `![alt](...)`, turning it back into a placeholder.
 * Used by 删除 for carousel slides, where the slide line itself should stay so
 * the carousel keeps its shape.
 */
export function clearImageSrc(content: string, alt: string, occurrence: number): string {
  const span = locate(content, alt, occurrence)
  if (!span) return content
  return content.slice(0, span.openEnd) + content.slice(span.end)
}

/**
 * Remove one whole image line / block.
 * A standalone image is a block on its own line, so the line goes; an image
 * inside a carousel is one slide, handled by clearImageSrc instead.
 */
export function removeImageLine(content: string, alt: string, occurrence: number): string {
  const span = locate(content, alt, occurrence)
  if (!span) return content
  const lineStart = content.lastIndexOf('\n', span.start) + 1
  const lineEnd = content.indexOf('\n', span.end)
  // Keep the rest of the line: only drop it when the image is the whole line.
  const before = content.slice(lineStart, span.start).trim()
  const after = content.slice(span.end + 1, lineEnd < 0 ? content.length : lineEnd).trim()
  if (before || after) {
    // Image shares its line with text — remove just the image syntax.
    return content.slice(0, span.start) + content.slice(span.end + 1)
  }
  const cutFrom = lineStart
  let cutTo = lineEnd < 0 ? content.length : lineEnd + 1
  // Collapse one of the blank lines the image used to occupy.
  if (content.slice(cutTo, cutTo + 1) === '\n' && content.slice(cutFrom - 1, cutFrom) === '\n') {
    cutTo += 1
  }
  return content.slice(0, cutFrom) + content.slice(cutTo)
}

/** Whether the addressed occurrence exists and still carries this caption. */
export function canLocateImage(content: string, alt: string, occurrence: number): boolean {
  return locate(content, alt, occurrence) !== null
}

/**
 * Write the chosen frame ratio into the `:::carousel` opener of a given carousel.
 * The opener carries `:::carousel [比例] 标题`; a later `:::carousel-open` marker
 * found after an earlier ratio belongs to a different carousel.
 */
export function setCarouselRatio(
  content: string,
  occurrence: number,
  ratio: CarouselRatio,
): string {
  const lines = content.split('\n')
  const openers: number[] = []
  const OPEN = /^(\s*:::carousel(?:-open)?)(?![-\w])/
  for (let i = 0; i < lines.length; i++) {
    if (!OPEN.test(lines[i])) continue
    // 在遇到本行之前，若最近一个 :::carousel-close 之后已经有开启器，则该行不是新轮播
    const since = openers.length ? openers[openers.length - 1] : -1
    let hasClose = false
    for (let j = since; j < i; j++) {
      if (/^\s*:::carousel-close\s*$/.test(lines[j])) hasClose = true
    }
    if (!hasClose) openers.push(i)
  }
  const target = openers[occurrence - 1]
  if (target === undefined) return content
  lines[target] = lines[target].replace(
    /^(\s*:::carousel(?:-open)?)(?![-\w])\s*(?:\d+\s*:\s*\d+)?\s*/,
    (_m, head: string) => `${head} ${ratio} `,
  )
  return lines.join('\n')
}

export { esc }
export type { Block }
