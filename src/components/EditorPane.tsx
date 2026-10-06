import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react'
import { EditorState } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

export interface EditorHandle {
  jumpToLine: (line: number) => void
  insertText: (text: string) => void
}

// 公众号专用语法高亮（暗色编辑器内）
const syntaxDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildDeco(view)
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = buildDeco(u.view)
    }
  },
  { decorations: (v) => v.decorations },
)

function buildDeco(view: EditorView): DecorationSet {
  const marks: { from: number; to: number; deco: Decoration }[] = []
  const doc = view.state.doc
  let inFrontMatter = false
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i)
    const text = line.text
    if (i === 1 && text.trim() === '---') inFrontMatter = true
    else if (inFrontMatter && text.trim() === '---') {
      marks.push({ from: line.from, to: line.to, deco: Decoration.line({ class: 'cm-md-fm' }) })
      inFrontMatter = false
      continue
    }
    if (inFrontMatter) {
      marks.push({ from: line.from, to: line.to, deco: Decoration.line({ class: 'cm-md-fm' }) })
      continue
    }
    if (/^\s*:::/.test(text)) {
      marks.push({ from: line.from, to: line.to, deco: Decoration.line({ class: 'cm-md-directive' }) })
      continue
    }
    if (/^\s*@signature\s*$/.test(text)) {
      marks.push({ from: line.from, to: line.to, deco: Decoration.line({ class: 'cm-md-signature' }) })
      continue
    }
    // kicker：## 之后 | 之前的部分
    const hm = text.match(/^(\s*##\s+)([^|]+)(\|)/)
    if (hm) {
      const start = line.from + hm[1].length
      marks.push({ from: start, to: start + hm[2].length, deco: Decoration.mark({ class: 'cm-md-kicker' }) })
    }
    // ==重点==
    for (const m of text.matchAll(/==[^=]+==/g)) {
      marks.push({ from: line.from + m.index!, to: line.from + m.index! + m[0].length, deco: Decoration.mark({ class: 'cm-md-mark' }) })
    }
    // ![图注](src)
    for (const m of text.matchAll(/!\[[^\]]*\]\([^)]*\)/g)) {
      marks.push({ from: line.from + m.index!, to: line.from + m.index! + m[0].length, deco: Decoration.mark({ class: 'cm-md-image' }) })
    }
  }
  marks.sort((a, b) => a.from - b.from)
  return Decoration.set(marks.map((m) => m.deco.range(m.from, m.to)))
}

const editorTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: '#14161B',
      color: '#D8DCE3',
      height: '100%',
      fontSize: '13.5px',
    },
    '.cm-content': {
      fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
      padding: '16px 0',
      caretColor: '#1677FF',
      lineHeight: '1.75',
    },
    '.cm-cursor': { borderLeftColor: '#1677FF', borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: 'rgba(22,119,255,.22) !important',
    },
    '.cm-gutters': {
      backgroundColor: '#14161B',
      color: '#3D434F',
      border: 'none',
      paddingLeft: '8px',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,.035)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#6B7285' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { overflow: 'auto' },
  },
  { dark: true },
)

const mdHighlight = HighlightStyle.define([
  { tag: tags.heading, color: '#7DB4FF', fontWeight: '700' },
  { tag: tags.strong, color: '#FFFFFF', fontWeight: '700' },
  { tag: tags.emphasis, color: '#E5C07B' },
  { tag: tags.strikethrough, color: '#7C818C', textDecoration: 'line-through' },
  { tag: tags.monospace, color: '#98C379' },
  { tag: tags.quote, color: '#8FBCA5' },
  { tag: tags.link, color: '#61AFEF' },
  { tag: tags.processingInstruction, color: '#5C6370' },
  { tag: tags.list, color: '#D8DCE3' },
])

interface Props {
  value: string
  onChange: (v: string) => void
}

const EditorPane = forwardRef<EditorHandle, Props>(function EditorPane({ value, onChange }, ref) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!hostRef.current) return
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(mdHighlight),
        editorTheme,
        syntaxDecorations,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString())
        }),
        EditorView.lineWrapping,
      ],
    })
    const view = new EditorView({ state, parent: hostRef.current })
    viewRef.current = view
    return () => view.destroy()
    // 仅在挂载时创建；文档切换通过下方 effect 同步
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 外部内容切换（换稿/新建）时同步进编辑器
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const cur = view.state.doc.toString()
    if (cur !== value) {
      view.dispatch({ changes: { from: 0, to: cur.length, insert: value } })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  useImperativeHandle(ref, () => ({
    jumpToLine: (line: number) => {
      const view = viewRef.current
      if (!view) return
      const ln = Math.max(1, Math.min(view.state.doc.lines, line + 1))
      const pos = view.state.doc.line(ln).from
      view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
      view.focus()
    },
    insertText: (text: string) => {
      const view = viewRef.current
      if (!view) return
      const pos = view.state.selection.main.head
      // 保证插入的图片语法独占段落
      const line = view.state.doc.lineAt(pos)
      const before = line.text.trim() ? '\n\n' : line.from > 0 ? '\n' : ''
      const after = '\n'
      view.dispatch({
        changes: { from: pos, insert: before + text + after },
        selection: { anchor: pos + (before + text + after).length },
      })
      view.focus()
    },
  }))

  return <div ref={hostRef} className="h-full w-full overflow-hidden" />
})

export default EditorPane
