import type { Block, CarouselRatio, Doc, InlineSeg, RenderStats, SignatureConfig } from './types'
import { BLANK, esc, type Theme } from './themes'

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
        pushBlock(theme.carousel(b.title, caption, b.items, b.ratio), true)
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
  hasSrc: boolean
  line: number
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
      out.push({ no: `图${imageNo}`, kind: '单图', desc: b.alt || '未命名图片', alt: b.alt, hasSrc: !!b.src, line: b.line })
    } else if (b.type === 'carousel') {
      imageNo++
      carouselNo++
      b.items.forEach((it, idx) => {
        out.push({
          no: `图${imageNo}-${idx + 1}`,
          kind: '轮播',
          desc: `${b.title ? b.title + ' · ' : ''}${it.alt || '未命名'}`,
          alt: it.alt,
          hasSrc: !!it.src,
          line: b.line,
          ratio: b.ratio,
          carouselOrdinal: carouselNo,
        })
      })
    }
  }
  return out
}

// 上传成功后把 src 回填到 Markdown 中对应的 ![alt](...) 位置：
// 从大约行号附近开始找第一个 alt 精确匹配的图片语法
export function fillImageSrc(content: string, alt: string, approxLine: number, src: string): string {
  const lines = content.split('\n')
  const needle = `![${alt}](`
  const order = Array.from(lines.keys()).sort((a, b) => Math.abs(a - approxLine) - Math.abs(b - approxLine))
  for (const i of order) {
    const idx = lines[i].indexOf(needle)
    if (idx < 0) continue
    const end = lines[i].indexOf(')', idx + needle.length)
    if (end < 0) continue
    lines[i] = lines[i].slice(0, idx) + `![${alt}](${src}` + lines[i].slice(end)
    return lines.join('\n')
  }
  return content
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
