import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { diagramOf, loadDiagramCache, rememberDiagram, saveDiagramCache } from './diagram'
import { parseMarkdown } from './parse'
import { collectMaterials, renderDoc } from './render'
import { THEMES } from './themes'

const sig = { layout: '排版', proof: '校对', review: '审核' }
const FENCE = '```mermaid 架构总览\ngraph TD\n  A --> B\n```\n'
const resolveImg = (s: string) => s.replace('img:', 'https://cdn.test/')

describe('the fence info string', () => {
  it('reads a caption off the fence', () => {
    expect(diagramOf('mermaid')).toEqual({ title: '' })
    expect(diagramOf('mermaid 架构总览')).toEqual({ title: '架构总览' })
    expect(diagramOf('  Mermaid   数据 流  ')).toEqual({ title: '数据 流' })
  })

  it('leaves every other fence alone', () => {
    for (const lang of ['', 'js', 'mermaidx', 'graph TD', '```mermaid']) {
      expect(diagramOf(lang), lang).toBeNull()
    }
  })

  it('keeps the whole info string in lang, caption included', () => {
    const doc = parseMarkdown(FENCE)
    const block = doc.blocks[0]
    if (block.type !== 'code') throw new Error('expected a code block')
    expect(block.lang).toBe('mermaid 架构总览')
    expect(block.code).toBe('graph TD\n  A --> B')
  })
})

describe('the diagram cache', () => {
  const backing = new Map<string, string>()
  const stub = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
    clear: () => backing.clear(),
    key: (i: number) => [...backing.keys()][i] ?? null,
    get length() {
      return backing.size
    },
  }
  beforeEach(() => {
    backing.clear()
    Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true, writable: true })
  })
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage
  })

  it('survives a round trip', () => {
    const cache = loadDiagramCache()
    expect(cache.size).toBe(0)
    rememberDiagram(cache, 'graph TD\n A-->B', 'img:abc')
    saveDiagramCache(cache)
    expect([...loadDiagramCache()]).toEqual([['graph TD\n A-->B', 'img:abc']])
  })

  it('re-remembering a source makes it the newest entry', () => {
    const cache = loadDiagramCache()
    rememberDiagram(cache, 'old', 'img:1')
    rememberDiagram(cache, 'new', 'img:2')
    rememberDiagram(cache, 'old', 'img:3')
    expect([...cache.keys()]).toEqual(['new', 'old'])
    expect(cache.get('old')).toBe('img:3')
  })

  it('drops the oldest entry past the cap', () => {
    const cache = loadDiagramCache()
    for (let i = 0; i < 55; i++) rememberDiagram(cache, `code-${i}`, `img:${i}`)
    expect(cache.size).toBe(50)
    expect(cache.has('code-0')).toBe(false)
    expect(cache.has('code-5')).toBe(true)
    expect(cache.get('code-54')).toBe('img:54')
  })

  it('treats a corrupt cache as an empty one', () => {
    backing.set('mopai.diagrams.v1', '{"not":"an array"}')
    expect(loadDiagramCache().size).toBe(0)
    backing.set('mopai.diagrams.v1', '[[1,2],["ok","img:x"],null]')
    expect([...loadDiagramCache()]).toEqual([['ok', 'img:x']])
  })
})

describe('rendering a diagram', () => {
  const doc = parseMarkdown(`${FENCE}\n![实拍图](img:photo1)\n`)

  it('becomes a numbered figure once it has a PNG', () => {
    const { html } = renderDoc(doc, THEMES[0], sig, resolveImg, () => null, () => 'img:diag1')
    expect(html).toContain('https://cdn.test/diag1')
    expect(html).toContain('图1 架构总览')
    // The photograph after it keeps counting from the diagram.
    expect(html).toContain('图2 实拍图')
  })

  it('stays source code while there is no PNG', () => {
    const { html } = renderDoc(doc, THEMES[0], sig, resolveImg)
    expect(html).toContain('graph TD')
    expect(html).not.toContain('diag1')
    // The only <img> is the photograph that follows the fence.
    expect(html.match(/<img/g)).toHaveLength(1)
    expect(html).toContain('图1 实拍图')
  })

  it('falls back to a generic caption when the fence has none', () => {
    const bare = parseMarkdown('```mermaid\npie\n  "a" : 1\n```\n')
    const { html, stats } = renderDoc(bare, THEMES[0], sig, resolveImg, () => null, () => 'img:d')
    expect(html).toContain('图1 示意图')
    expect(stats.warnings.some((w) => w.includes('mermaid'))).toBe(true)
  })

  it('counts the diagram in the materials numbering without listing it', () => {
    const withDiagram = collectMaterials(doc, () => 'img:diag1')
    expect(withDiagram.map((m) => m.no)).toEqual(['图2'])
    expect(withDiagram[0].alt).toBe('实拍图')
    // No PNG yet means no figure number spent, so the panel agrees with the article.
    expect(collectMaterials(doc).map((m) => m.no)).toEqual(['图1'])
  })

  it('stays inside the platform red lines', () => {
    for (const theme of THEMES) {
      const { html } = renderDoc(doc, theme, sig, resolveImg, () => null, () => 'img:diag1')
      expect(html, theme.id).not.toMatch(/\s(class|id)=|<script|<style|<div/i)
      const bare = html
        .replace(/<span[^>]*>[\s\S]*?<\/span>/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
      expect(bare, theme.id).toEqual([])
    }
  })
})
