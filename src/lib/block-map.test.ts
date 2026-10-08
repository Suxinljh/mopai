import { describe, expect, it } from 'vitest'
import { parseMarkdown } from './parse'
import { renderDoc, countRootElements } from './render'
import { THEMES } from './themes'

const sig = { layout: '排版', proof: '校对', review: '审核' }

// Six lines of front matter, then one of every block kind. The front matter is
// the point: it occupies real editor lines that markdown-it never sees, because
// parseMarkdown strips it before parsing.
const DOC = `---
titles:
  - 标题甲
  - 标题乙
cover: 封面说明
---

# 大标题

第一段正文。

### 次级标题

:::center
居中强调句
:::

> 金句卡片

![配图一](img:aaa.png)

:::quote
引文第一段

引文第二段
:::

- 列表项一
- 列表项二

\`\`\`js
const a = 1
\`\`\`

---

:::carousel 4:3 轮播标题
![轮播甲]()
![轮播乙]()
:::

@signature
`

/** The whole source, as lines, for asserting against. */
const lines = DOC.split('\n')

/** Line number (1-based, as an editor shows it) of the first line matching text. */
function sourceLine(text: string): number {
  const i = lines.findIndex((l) => l.includes(text))
  expect(i, `fixture must contain ${JSON.stringify(text)}`).toBeGreaterThanOrEqual(0)
  return i
}

describe('block source spans', () => {
  const { blocks } = parseMarkdown(DOC)

  it('covers every block kind in the fixture', () => {
    expect(blocks.map((b) => b.type)).toEqual([
      'heading',
      'paragraph',
      'subheading',
      'center',
      'quoteCard',
      'image',
      'quoteBox',
      'list',
      'code',
      'hr',
      'carousel',
      'signature',
    ])
  })

  it('counts lines from the top of the file, not from the top of the body', () => {
    // Regression: these used to be body-relative, so with six lines of front
    // matter every "jump to this image" landed six lines early - on the `---`.
    const image = blocks.find((b) => b.type === 'image')!
    expect(image.line).toBe(sourceLine('![配图一]'))
    expect(lines[image.line]).toContain('![配图一]')

    const heading = blocks[0]
    expect(heading.line).toBe(sourceLine('# 大标题'))
    expect(lines[heading.line]).toBe('# 大标题')
  })

  it('spans a container from its opener to its closer', () => {
    const quoteBox = blocks.find((b) => b.type === 'quoteBox')!
    expect(lines[quoteBox.line]).toBe(':::quote')
    expect(lines[quoteBox.lineEnd - 1]).toBe(':::')

    const carousel = blocks.find((b) => b.type === 'carousel')!
    expect(lines[carousel.line]).toContain(':::carousel 4:3')
    expect(lines[carousel.lineEnd - 1]).toBe(':::')

    const center = blocks.find((b) => b.type === 'center')!
    expect(lines[center.line]).toBe(':::center')
    expect(lines[center.lineEnd - 1]).toBe(':::')
  })

  it('spans the block kinds markdown-it itself delimits', () => {
    // These end lines are already exclusive, unlike the ::: containers above.
    const quoteCard = blocks.find((b) => b.type === 'quoteCard')!
    expect(lines[quoteCard.line]).toBe('> 金句卡片')
    expect(quoteCard.lineEnd - quoteCard.line).toBe(1)

    const list = blocks.find((b) => b.type === 'list')!
    expect(lines[list.line]).toBe('- 列表项一')
    // markdown-it folds a list's trailing blank line into its range, so the end
    // lands past the last item. What matters is that both items are inside it.
    expect(list.lineEnd).toBeGreaterThan(sourceLine('- 列表项二'))
    expect(list.lineEnd - list.line).toBeGreaterThanOrEqual(2)

    const hr = blocks.find((b) => b.type === 'hr')!
    expect(lines[hr.line]).toBe('---')
  })

  it('stops at the end of the document when a container is never closed', () => {
    // markdown-it-container auto-closes at EOF and reports an end that is
    // already exclusive, so the extra line for the missing ::: must be clamped
    // rather than running one past the last line.
    const src = '# 标题\n\n:::quote\n没有收尾\n'
    const doc = parseMarkdown(src)
    const box = doc.blocks.find((b) => b.type === 'quoteBox')!
    expect(box.line).toBe(2)
    expect(box.lineEnd).toBeLessThanOrEqual(src.split('\n').length)
    expect(box.lineEnd).toBeGreaterThan(box.line)
  })

  it('spans a fenced code block over all its lines', () => {
    const code = blocks.find((b) => b.type === 'code')!
    expect(lines[code.line]).toBe('```js')
    expect(code.lineEnd - code.line).toBe(3)
  })

  it('never goes backwards, which is what binary search in sync-scroll relies on', () => {
    for (let i = 1; i < blocks.length; i++) {
      expect(blocks[i].line, `block ${i} (${blocks[i].type})`).toBeGreaterThanOrEqual(blocks[i - 1].line)
    }
  })

  it('gives every block at least one line', () => {
    for (const b of blocks) expect(b.lineEnd).toBeGreaterThan(b.line)
  })

  it('reports line zero when there is no front matter', () => {
    const plain = parseMarkdown('# 标题\n\n正文。\n')
    expect(plain.blocks[0].line).toBe(0)
    expect(plain.blocks[1].line).toBe(2)
  })
})

describe('renderDoc blockOffsets', () => {
  const { blocks } = parseMarkdown(DOC)

  for (const theme of THEMES) {
    it(`${theme.id}: one offset per block, in DOM order`, () => {
      const { blockOffsets } = renderDoc(parseMarkdown(DOC), theme, sig, (s) => s)
      expect(blockOffsets).toHaveLength(blocks.length)
      expect(blockOffsets.every((o) => o >= 0)).toBe(true)
      for (let i = 1; i < blockOffsets.length; i++) {
        expect(blockOffsets[i], `offset ${i}`).toBeGreaterThanOrEqual(blockOffsets[i - 1])
      }
    })

    it(`${theme.id}: every offset points at a real top-level child`, () => {
      const { html, blockOffsets } = renderDoc(parseMarkdown(DOC), theme, sig, (s) => s)
      const childCount = countTopLevelChildren(html)
      expect(childCount).toBeGreaterThan(0)
      for (const o of blockOffsets) expect(o).toBeLessThan(childCount)
    })

    it(`${theme.id}: a boxed module maps to the spacer above it`, () => {
      const { html, blockOffsets } = renderDoc(parseMarkdown(DOC), theme, sig, (s) => s)
      const children = splitTopLevelChildren(html)
      const carouselIndex = blocks.findIndex((b) => b.type === 'carousel')
      // The carousel is boxed, so its offset lands on the blank paragraph that
      // pads it - which is where the eye goes when scrolling anyway.
      expect(children[blockOffsets[carouselIndex]]).toBe(
        '<p style="margin:0;"><span leaf="">&nbsp;</span></p>',
      )
    })
  }
})

// --- helpers: a depth-aware scan of the rendered HTML ------------------------
// There is no DOM in the test environment, and the mapping only has to be right
// about top-level children of the single root <section>.

describe('countRootElements', () => {
  it('counts one plain element', () => {
    expect(countRootElements('<p style="margin:0;"><span leaf="">甲</span></p>')).toBe(1)
  })

  it('counts siblings returned in one string', () => {
    // This is the case that broke the first implementation: theme.carousel hands
    // back three elements in a single string, so a part index is not a child index.
    const three =
      '<section style="margin:0;"><p><span leaf="">标题</span></p></section>' +
      '<section style="margin:0;"><img src="a.png" /></section>' +
      '<p style="margin:0;"><span leaf="">图注</span></p>'
    expect(countRootElements(three)).toBe(3)
  })

  it('does not count nesting as siblings', () => {
    expect(
      countRootElements('<section><section><section><span leaf="">深</span></section></section></section>'),
    ).toBe(1)
  })

  it('treats void and self-closing tags as elements that do not open a level', () => {
    expect(countRootElements('<img src="a.png" /><br><p><span leaf="">甲</span></p>')).toBe(3)
    expect(countRootElements('<p><span leaf="">甲</span><br><img src="b.png" /></p>')).toBe(1)
  })

  it('ignores comments', () => {
    expect(countRootElements('<!-- 备注 --><p><span leaf="">甲</span></p>')).toBe(1)
  })

  it('is zero for an empty fragment', () => {
    expect(countRootElements('')).toBe(0)
  })
})

const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link'])

/** Every top-level child of the root section, as its outer HTML. */
function splitTopLevelChildren(html: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = -1
  const re = /<(\/?)([a-zA-Z0-9]+)\b[^>]*?(\/?)>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const [, close, rawTag, selfClose] = m
    const tag = rawTag.toLowerCase()
    if (close === '/') {
      depth--
      if (depth === 1) out.push(html.slice(start, m.index + m[0].length))
      continue
    }
    if (depth === 1) start = m.index
    if (selfClose === '/' || VOID.has(tag)) {
      if (depth === 1) out.push(m[0])
      continue
    }
    depth++
  }
  return out
}

function countTopLevelChildren(html: string): number {
  return splitTopLevelChildren(html).length
}
