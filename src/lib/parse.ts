import MarkdownIt from 'markdown-it'
import type { Token } from 'markdown-it'
import markdownItMark from 'markdown-it-mark'
import markdownItContainer from 'markdown-it-container'
import type { Block, CarouselRatio, Doc, DocMeta, InlineSeg } from './types'
import { DEFAULT_CAROUSEL_RATIO, isCarouselRatio } from './types'

// ---------- front matter ----------
// 只支持简单键值与列表，刻意不引入 YAML 依赖：
// ---
// titles:
//   - 标题一
//   - 标题二
// cover: 封面说明
// ---

function parseFrontMatter(src: string): { meta: DocMeta; body: string } {
  const meta: DocMeta = { titles: [], cover: '', author: '' }
  const m = src.match(/^\s*---\n([\s\S]*?)\n---\n?/)
  if (!m) return { meta, body: src }
  const lines = m[1].split('\n')
  let curKey = ''
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    const listItem = line.match(/^\s+-\s+(.*)$/)
    if (listItem && curKey) {
      if (curKey === 'titles') meta.titles.push(listItem[1].trim())
      continue
    }
    const kv = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/)
    if (kv) {
      curKey = kv[1]
      const v = kv[2].trim()
      if (curKey === 'cover') meta.cover = v
      else if (curKey === 'author') meta.author = v
      else if (curKey === 'titles' && v) meta.titles.push(v)
    }
  }
  return { meta, body: src.slice(m[0].length) }
}

// ---------- markdown-it ----------

const md = new MarkdownIt({ html: false, linkify: false, breaks: false })
  .use(markdownItMark)
  .use(markdownItContainer, 'quote')
  .use(markdownItContainer, 'center')
  .use(markdownItContainer, 'carousel')

// ---------- inline ----------

interface Flags {
  bold?: boolean
  mark?: boolean
  code?: boolean
  italic?: boolean
  strike?: boolean
  link?: string
}

function pushSeg(out: InlineSeg[], text: string, flags: Flags) {
  if (!text) return
  const prev = out[out.length - 1]
  const key = JSON.stringify(flags)
  if (prev && JSON.stringify({ bold: prev.bold, mark: prev.mark, code: prev.code, italic: prev.italic, strike: prev.strike, link: prev.link }) === key && prev.text !== '\n' && text !== '\n') {
    prev.text += text
    return
  }
  out.push({ text, ...flags })
}

export function walkInline(children: Token[] | null): InlineSeg[] {
  const out: InlineSeg[] = []
  if (!children) return out
  const flags: Flags = {}
  const stack: Flags[] = []
  for (const t of children) {
    switch (t.type) {
      case 'text':
        pushSeg(out, t.content, flags)
        break
      case 'code_inline':
        pushSeg(out, t.content, { ...flags, code: true })
        break
      case 'strong_open':
        stack.push({ ...flags }); flags.bold = true
        break
      case 'strong_close':
        Object.assign(flags, stack.pop())
        break
      case 'em_open':
        stack.push({ ...flags }); flags.italic = true
        break
      case 'em_close':
        Object.assign(flags, stack.pop())
        break
      case 's_open':
        stack.push({ ...flags }); flags.strike = true
        break
      case 's_close':
        Object.assign(flags, stack.pop())
        break
      case 'mark_open':
        stack.push({ ...flags }); flags.mark = true
        break
      case 'mark_close':
        Object.assign(flags, stack.pop())
        break
      case 'link_open':
        stack.push({ ...flags }); flags.link = String(t.attrGet('href') ?? '')
        break
      case 'link_close':
        Object.assign(flags, stack.pop())
        break
      case 'softbreak':
        pushSeg(out, '', flags) // CJK：段内软换行直接接合
        break
      case 'hardbreak':
        pushSeg(out, '\n', flags)
        break
      default:
        break
    }
  }
  return out
}

function imageFromInline(t: Token): { alt: string; src: string } | null {
  if (!t.children || t.children.length !== 1) return null
  const img = t.children[0]
  if (img.type !== 'image') return null
  return { alt: img.content.trim(), src: String(img.attrGet('src') ?? '') }
}

// ---------- block ----------

export function parseMarkdown(src: string): Doc {
  const { meta, body } = parseFrontMatter(src)
  const tokens = md.parse(body, {})
  const blocks: Block[] = []

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]

    if (t.type === 'heading_open') {
      const inline = tokens[i + 1]
      const level = Number(t.tag.slice(1))
      const content = inline?.content || ''
      if (level === 2) {
        const pipe = content.indexOf('|')
        const kicker = pipe >= 0 ? content.slice(0, pipe).trim() : ''
        const title = (pipe >= 0 ? content.slice(pipe + 1) : content).trim()
        blocks.push({ type: 'heading', kicker, title, numbered: true })
      } else if (level === 1) {
        blocks.push({ type: 'heading', kicker: '', title: content.trim(), numbered: false })
      } else {
        blocks.push({ type: 'subheading', title: content.trim() })
      }
      i += 2
      continue
    }

    if (t.type === 'paragraph_open') {
      const inline = tokens[i + 1]
      const img = inline ? imageFromInline(inline) : null
      if (img) {
        blocks.push({ type: 'image', alt: img.alt, src: img.src, line: t.map?.[0] ?? 0 })
      } else {
        const text = inline?.content.trim() || ''
        if (text === '@signature') {
          blocks.push({ type: 'signature' })
        } else {
          const segs = walkInline(inline?.children || null)
          if (segs.length) blocks.push({ type: 'paragraph', segs })
        }
      }
      i += 2
      continue
    }

    if (t.type === 'blockquote_open') {
      // > 金句卡片：收集到 blockquote_close 之间的段落
      const paras: InlineSeg[][] = []
      while (i < tokens.length && tokens[i].type !== 'blockquote_close') {
        if (tokens[i].type === 'inline') paras.push(walkInline(tokens[i].children))
        i++
      }
      const segs: InlineSeg[] = []
      paras.forEach((p, idx) => {
        if (idx > 0) segs.push({ text: '\n' })
        segs.push(...p)
      })
      blocks.push({ type: 'quoteCard', segs })
      continue
    }

    if (t.type === 'container_quote_open') {
      const paras: InlineSeg[][] = []
      i++
      while (i < tokens.length && tokens[i].type !== 'container_quote_close') {
        if (tokens[i].type === 'inline') paras.push(walkInline(tokens[i].children))
        i++
      }
      blocks.push({ type: 'quoteBox', paras })
      continue
    }

    if (t.type === 'container_center_open') {
      const paras: InlineSeg[][] = []
      i++
      while (i < tokens.length && tokens[i].type !== 'container_center_close') {
        if (tokens[i].type === 'inline') paras.push(walkInline(tokens[i].children))
        i++
      }
      const segs: InlineSeg[] = []
      paras.forEach((p, idx) => {
        if (idx > 0) segs.push({ text: '\n' })
        segs.push(...p)
      })
      blocks.push({ type: 'center', segs })
      continue
    }

    if (t.type === 'container_carousel_open') {
      // :::carousel [比例] 标题 —— 比例可省略，老稿件照旧按默认比例渲染
      let rest = (t.info || '').replace(/^carousel\s*/, '').trim()
      let ratio: CarouselRatio = DEFAULT_CAROUSEL_RATIO
      const ratioMatch = rest.match(/^(\d+\s*:\s*\d+)\s*/)
      if (ratioMatch) {
        const candidate = ratioMatch[1].replace(/\s+/g, '')
        // 只吃下确实是受支持的比例；「7:5 说明」这种要原样留在标题里
        if (isCarouselRatio(candidate)) {
          ratio = candidate
          rest = rest.slice(ratioMatch[0].length).trim()
        }
      }
      const title = rest
      const items: { alt: string; src: string }[] = []
      i++
      while (i < tokens.length && tokens[i].type !== 'container_carousel_close') {
        // 同一行的多张图（软换行分隔）也要全部收集
        if (tokens[i].type === 'inline' && tokens[i].children) {
          for (const c of tokens[i].children!) {
            if (c.type === 'image') items.push({ alt: c.content.trim(), src: String(c.attrGet('src') ?? '') })
          }
        }
        i++
      }
      blocks.push({ type: 'carousel', title, ratio, items, line: t.map?.[0] ?? 0 })
      continue
    }

    if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') {
      const ordered = t.type === 'ordered_list_open'
      const close = ordered ? 'ordered_list_close' : 'bullet_list_close'
      const items: InlineSeg[][] = []
      while (i < tokens.length && tokens[i].type !== close) {
        if (tokens[i].type === 'inline') items.push(walkInline(tokens[i].children))
        i++
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    if (t.type === 'fence') {
      blocks.push({ type: 'code', lang: t.info.trim(), code: t.content.replace(/\n$/, '') })
      continue
    }

    if (t.type === 'hr') {
      blocks.push({ type: 'hr' })
      continue
    }
  }

  return { meta, blocks }
}
