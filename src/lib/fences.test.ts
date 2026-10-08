import { describe, expect, it } from 'vitest'
import { fencedRanges, isInFence } from './fences'
import { parseMarkdown } from './parse'
import { collectMaterials, fillImageSrc, removeImageLine } from './render'

describe('fencedRanges', () => {
  it('covers the fence lines themselves', () => {
    const src = 'a\n```\nb\n```\nc\n'
    const [range] = fencedRanges(src)
    expect(src.slice(range[0], range[1])).toBe('```\nb\n```\n')
  })

  it('finds several blocks and leaves prose outside them', () => {
    const src = '前言\n\n```js\nx\n```\n\n中间\n\n~~~\ny\n~~~\n\n后语\n'
    const ranges = fencedRanges(src)
    expect(ranges).toHaveLength(2)
    expect(isInFence(ranges, src.indexOf('前言'))).toBe(false)
    expect(isInFence(ranges, src.indexOf('中间'))).toBe(false)
    expect(isInFence(ranges, src.indexOf('后语'))).toBe(false)
    expect(isInFence(ranges, src.indexOf('x'))).toBe(true)
    expect(isInFence(ranges, src.indexOf('y'))).toBe(true)
  })

  it('swallows the rest of the document when a fence is never closed', () => {
    const src = 'a\n```\nnever closed\n'
    const ranges = fencedRanges(src)
    expect(ranges).toHaveLength(1)
    expect(isInFence(ranges, src.indexOf('never closed'))).toBe(true)
  })

  it('does not close on a shorter or different fence', () => {
    // CommonMark: the closer must be the same character and at least as long.
    expect(fencedRanges('````\n```\nstill inside\n````\n')).toHaveLength(1)
    expect(isInFence(fencedRanges('```\n~~~\nx\n```\n'), 8)).toBe(true)
  })

  it('treats an indented fence as a fence, up to three spaces', () => {
    expect(isInFence(fencedRanges('   ```\nx\n```\n'), 5)).toBe(true)
  })

  it('finds nothing in a document without fences', () => {
    expect(fencedRanges('# 标题\n\n正文\n')).toEqual([])
  })
})

describe('images inside code blocks', () => {
  // Regression: the occurrence counter and the locator both scanned the raw
  // source with a bare regex, so an image example in a fenced block shifted
  // every real image after it and an upload wrote to the wrong one.
  const DOC = `教程正文。

\`\`\`md
![示例图注](https://example.com/demo.png)
\`\`\`

![真图甲]()

![真图乙]()
`

  it('numbers only the images outside the fence', () => {
    const materials = collectMaterials(parseMarkdown(DOC))
    expect(materials.map((m) => m.alt)).toEqual(['真图甲', '真图乙'])
    expect(materials.map((m) => m.occurrence)).toEqual([1, 2])
  })

  it('fills the first real placeholder, not the example in the code block', () => {
    const filled = fillImageSrc(DOC, '真图甲', 1, 'img:key-a.png')
    expect(filled).toContain('![真图甲](img:key-a.png)')
    // The documented example must survive untouched.
    expect(filled).toContain('![示例图注](https://example.com/demo.png)')
  })

  it('fills the second real placeholder by its own number', () => {
    const filled = fillImageSrc(DOC, '真图乙', 2, 'img:key-b.png')
    expect(filled).toContain('![真图乙](img:key-b.png)')
    expect(filled).toContain('![真图甲]()')
  })

  it('refuses to address the example inside the fence', () => {
    expect(fillImageSrc(DOC, '示例图注', 1, 'img:nope')).toBe(DOC)
  })

  it('removes the right line when an image above it was only an example', () => {
    const removed = removeImageLine(DOC, '真图甲', 1)
    expect(removed).not.toContain('![真图甲]')
    expect(removed).toContain('![真图乙]()')
    expect(removed).toContain('![示例图注](https://example.com/demo.png)')
  })
})
