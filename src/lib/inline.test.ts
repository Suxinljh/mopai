import { describe, expect, it } from 'vitest'
import { parseMarkdown, walkInline } from './parse'
import { renderDoc } from './render'
import { THEMES } from './themes'
import type { InlineSeg } from './types'

const sig = { layout: '排版', proof: '校对', review: '审核' }

/** Segs of the first paragraph of a one-paragraph document. */
function segsOf(src: string): InlineSeg[] {
  const block = parseMarkdown(src).blocks[0]
  if (block.type !== 'paragraph') throw new Error(`expected a paragraph, got ${block.type}`)
  return block.segs
}

describe('inline emphasis stops where it is closed', () => {
  // Regression: the flag stack was restored with Object.assign(flags, snapshot),
  // and the snapshot has no key for the flag that was just set - Object.assign
  // never deletes one. Every marker therefore leaked to the end of the paragraph.
  it.each([
    ['bold', '**粗** 普通', { bold: true }],
    ['italic', '*斜* 普通', { italic: true }],
    ['strike', '~~删~~ 普通', { strike: true }],
    ['mark', '==重点== 普通', { mark: true }],
  ])('%s does not run past its closing marker', (_name, src, flag) => {
    const segs = segsOf(src)
    expect(segs).toHaveLength(2)
    expect(segs[0]).toMatchObject(flag)
    expect(segs[1].text).toBe(' 普通')
    for (const key of ['bold', 'italic', 'strike', 'mark'] as const) {
      expect(segs[1][key], `${key} leaked`).toBeFalsy()
    }
  })

  it('keeps a link href off the text that follows it', () => {
    const segs = segsOf('[链接](https://a.com) 普通')
    expect(segs).toHaveLength(2)
    expect(segs[0]).toEqual({ text: '链接', link: 'https://a.com' })
    expect(segs[1]).toEqual({ text: ' 普通' })
  })

  it('gives each of two links its own href', () => {
    // The old restore popped an older snapshot, so trailing text could inherit
    // the *first* link's href - a citation pointing at the wrong source.
    const segs = segsOf('正常 [a](https://a.com) 中间 [b](https://b.com) 结尾')
    expect(segs).toEqual([
      { text: '正常 ' },
      { text: 'a', link: 'https://a.com' },
      { text: ' 中间 ' },
      { text: 'b', link: 'https://b.com' },
      { text: ' 结尾' },
    ])
  })

  it('unwinds nested emphasis one level at a time', () => {
    const segs = segsOf('**粗里的*斜*回到粗**出来')
    expect(segs).toEqual([
      { text: '粗里的', bold: true },
      { text: '斜', bold: true, italic: true },
      { text: '回到粗', bold: true },
      { text: '出来' },
    ])
  })

  it('leaves inline code alone, which never used an open/close pair', () => {
    expect(segsOf('`代码` 普通')).toEqual([{ text: '代码', code: true }, { text: ' 普通' }])
  })

  it('merges runs across a soft break, which is what CJK text needs', () => {
    // A single newline inside a paragraph must join without a space; that only
    // works because the empty softbreak seg lets the two runs merge.
    expect(segsOf('甲\n乙')).toEqual([{ text: '甲乙' }])
  })

  it('splits runs that are styled differently', () => {
    expect(segsOf('甲**乙**丙')).toEqual([
      { text: '甲' },
      { text: '乙', bold: true },
      { text: '丙' },
    ])
  })

  it('does not merge across a hard break', () => {
    const segs = segsOf('甲  \n乙')
    expect(segs.map((s) => s.text)).toEqual(['甲', '\n', '乙'])
  })

  it('survives an unbalanced marker without throwing', () => {
    expect(() => walkInline(null)).not.toThrow()
    expect(segsOf('**没有闭合')).toEqual([{ text: '**没有闭合' }])
  })
})

describe('the fix reaches the published HTML', () => {
  it('highlights only the marked phrase in the sample-style sentence', () => {
    const { html } = renderDoc(
      parseMarkdown('围绕排版效果，==这段文字被标记==，其余部分保持干净。\n'),
      THEMES[0],
      sig,
      (s) => s,
    )
    // The marked phrase carries the highlight border; the tail must not.
    const marked = html.indexOf('这段文字被标记')
    const tail = html.indexOf('其余部分保持干净')
    expect(marked).toBeGreaterThan(0)
    expect(tail).toBeGreaterThan(marked)
    const borderAfterTail = html.slice(tail).indexOf('border-bottom')
    expect(borderAfterTail, 'highlight styling leaked past the marker').toBe(-1)
  })

  it('renders identically in every theme', () => {
    for (const theme of THEMES) {
      const { html } = renderDoc(parseMarkdown('**粗** 普通\n'), theme, sig, (s) => s)
      expect(html, theme.id).toContain('粗')
      expect(html, theme.id).toContain('普通')
    }
  })
})
