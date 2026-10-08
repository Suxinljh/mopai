import { describe, expect, it } from 'vitest'
import { parseMarkdown } from './parse'
import { renderDoc } from './render'
import { THEMES } from './themes'

const sig = { layout: '排版', proof: '校对', review: '审核' }

function render(src: string, theme = THEMES[0]) {
  const doc = parseMarkdown(src)
  return renderDoc(doc, theme, sig, (s) => s)
}

describe('links become footnotes', () => {
  it('keeps the URL reachable instead of dropping it', () => {
    // WeChat makes body links unclickable, so the old behaviour — colour the text
    // and throw the href away — left the reader with no way to find the source.
    const { html } = render('看[这篇报告](https://example.com/report)了解更多。\n')
    expect(html).toContain('这篇报告')
    expect(html).toContain('https://example.com/report')
    expect(html).toContain('[1]')
    expect(html).toContain('参考链接')
  })

  it('numbers distinct URLs in reading order', () => {
    const { html } = render('甲[一](https://a.com)乙[二](https://b.com)丙\n')
    expect(html.indexOf('https://a.com')).toBeLessThan(html.indexOf('https://b.com'))
    expect(html).toContain('1. https://a.com')
    expect(html).toContain('2. https://b.com')
  })

  it('cites the same URL once however often it appears', () => {
    const { html } = render('[甲](https://a.com) 和 [乙](https://a.com) 是同一个来源。\n')
    expect(html.match(/1\. https:\/\/a\.com/g)).toHaveLength(1)
    expect(html).not.toContain('2. https://a.com')
    expect((html.match(/\[1\]/g) || []).length).toBe(2)
  })

  it('leaves a fragment anchor alone, since it points at nothing once published', () => {
    const { html } = render('跳到[下一节](#next)看看。\n')
    expect(html).toContain('下一节')
    expect(html).not.toContain('参考链接')
    expect(html).not.toContain('[1]')
  })

  it('emits no reference list when there are no links', () => {
    const { html } = render('# 标题\n\n没有链接的正文。\n')
    expect(html).not.toContain('参考链接')
  })

  it('warns in terms of what actually happens now', () => {
    const { stats } = render('见[来源](https://a.com)。\n')
    expect(stats.warnings.join(' ')).toContain('文末')
    expect(stats.warnings.join(' ')).not.toContain('普通文字')
  })

  it('counts footnote URLs across every block kind that carries text', () => {
    const { html } = render(
      [
        '段落里的[甲](https://a.com)。',
        '',
        '> 金句里的[乙](https://b.com)',
        '',
        ':::quote',
        '引文里的[丙](https://c.com)',
        ':::',
        '',
        '- 列表里的[丁](https://d.com)',
        '',
      ].join('\n'),
    )
    for (const host of ['a', 'b', 'c', 'd']) expect(html).toContain(`https://${host}.com`)
    expect(html).toContain('4. https://d.com')
  })

  it('keeps the reference list inside the platform red lines', () => {
    const { html } = render('[甲](https://a.com)\n')
    expect(html).not.toMatch(/\sclass=/i)
    expect(html).not.toMatch(/\sid=/i)
    expect(html).not.toMatch(/<div/i)
    expect(html).not.toMatch(/<style/i)
    expect(html).not.toMatch(/<script/i)
    // Every text run, including the new heading and URLs, must sit in a leaf span.
    const bare = html
      .replace(/<span[^>]*>[\s\S]*?<\/span>/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
    expect(bare).toEqual([])
  })

  it('pads the reference list like any other boxed module', () => {
    const { html } = render('正文。\n\n[甲](https://a.com)\n')
    const blanks = (html.match(/<p style="margin:0;"><span leaf="">&nbsp;<\/span><\/p>/g) || []).length
    expect(blanks).toBeGreaterThan(0)
  })

  it('stays out of the scroll-sync mapping', () => {
    // The reference list has no source line of its own, so it must not claim a
    // block offset - otherwise the preview would scroll to a block that is not
    // in the document.
    const doc = parseMarkdown('正文。\n\n[甲](https://a.com)\n')
    const { blockOffsets } = renderDoc(doc, THEMES[0], sig, (s) => s)
    expect(blockOffsets).toHaveLength(doc.blocks.length)
    expect(blockOffsets.every((o) => o >= 0)).toBe(true)
  })

  it('works the same way in every theme', () => {
    for (const theme of THEMES) {
      const { html } = render('[甲](https://a.com)\n', theme)
      expect(html, theme.id).toContain('https://a.com')
      expect(html, theme.id).not.toMatch(/\sclass=/i)
    }
  })
})
