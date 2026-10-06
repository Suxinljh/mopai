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
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  type Completion,
  type CompletionContext,
} from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

export interface EditorHandle {
  jumpToLine: (line: number) => void
  insertText: (text: string) => void
}

// ---------- 公众号语法 snippets ----------
// "|" 标记插入后光标落点。模板刻意保持短小，插入后直接就能接着写。
const SNIPPETS: { label: string; detail: string; template: string }[] = [
  { label: ':::quote', detail: '引文框', template: ':::quote\n|\n:::\n' },
  { label: ':::center', detail: '居中强调句', template: ':::center\n|\n:::\n' },
  { label: ':::carousel', detail: '图片轮播（上传时选画幅比例）', template: ':::carousel 4:3 |\n![]()\n![]()\n:::\n' },
  { label: ':::结束', detail: '闭合当前模块', template: ':::\n|' },
  { label: '##KICKER', detail: '章节标题，序号自动编号', template: '## KICKER | |\n' },
  { label: '###', detail: '次级标题，无序号', template: '### |\n' },
  { label: '>', detail: '金句卡片', template: '> |\n' },
  { label: '![]()', detail: '图片占位，图号自动编排', template: '![|]()\n' },
  { label: '==', detail: '下划线重点', template: '==|==' },
  { label: '@signature', detail: '署名块（人员在设置里配置）', template: '@signature\n' },
  { label: '---frontmatter', detail: '标题候选与封面说明', template: '---\ntitles:\n  - |\ncover: \n---\n' },
  { label: '<!--', detail: '编辑备注，不渲染', template: '<!-- | -->' },
]

/** Split "a|b" into the text before and after the cursor. */
function splitTemplate(template: string): { before: string; after: string } {
  const i = template.indexOf('|')
  if (i < 0) return { before: template, after: '' }
  return { before: template.slice(0, i), after: template.slice(i + 1) }
}

function toCompletion(s: (typeof SNIPPETS)[number]): Completion {
  const { before, after } = splitTemplate(s.template)
  return {
    label: s.label,
    detail: s.detail,
    type: 'keyword',
    apply: (view, _completion, from, to) => {
      view.dispatch({
        changes: { from, to, insert: before + after },
        selection: { anchor: from + before.length },
      })
    },
  }
}

/**
 * 只在明显该出语法的时候给建议，避免打字时刷屏：
 * 行首、已经在 ::: / @ / # / > / ! 里、或者手动按了 Ctrl+Space。
 */
function gzhCompletions(context: CompletionContext) {
  const line = context.state.doc.lineAt(context.pos)
  const before = line.text.slice(0, context.pos - line.from)
  // context.explicit 为真表示用户主动按了 Ctrl+Space
  const manual = context.explicit

  const trimmed = before.trimStart()
  const atLineStart = trimmed.length === 0
  const looksLikeSyntax = /^(:{1,3}|@|#{1,3}\s?|>\s?$|!\[?|==)/.test(trimmed)

  if (!atLineStart && !looksLikeSyntax && !manual) return null

  // 匹配光标前的语法前缀，替换掉已输入的部分
  const word = context.matchBefore(/[:@#!>=\-[\]\w]*/)
  if (!word) return null
  if (word.from === word.to && !manual) return null

  // 已经在 ::: 容器里时，把「闭合」排在最前
  const inContainer = /^\s*:::/.test(before)
  const options = inContainer
    ? [...SNIPPETS].sort((a, b) => (a.label === ':::结束' ? -1 : b.label === ':::结束' ? 1 : 0))
    : SNIPPETS

  return {
    from: word.from,
    options: options.map(toCompletion),
    validFor: /^[:@#!>=\-[\]\w]*$/,
  }
}

// ---------- 快捷键 ----------
// 包一层选区：有选中就包住它，没有就放入占位文字并选中，方便直接打字覆盖。
function wrapSelection(view: EditorView, before: string, after: string, placeholder: string): boolean {
  const { from, to } = view.state.selection.main
  const text = view.state.sliceDoc(from, to) || placeholder
  view.dispatch({
    changes: { from, to, insert: before + text + after },
    selection: { anchor: from + before.length, head: from + before.length + text.length },
  })
  view.focus()
  return true
}

const gzhKeymap = keymap.of([
  { key: 'Mod-b', run: (v) => wrapSelection(v, '**', '**', '加粗文字') },
  { key: 'Mod-i', run: (v) => wrapSelection(v, '*', '*', '斜体文字') },
  {
    key: 'Mod-k',
    run: (v) => {
      const { from, to } = v.state.selection.main
      const selected = v.state.sliceDoc(from, to)
      if (selected) {
        // 选中文字变链接文字，光标落进括号里填地址
        v.dispatch({
          changes: { from, to, insert: `[${selected}]()` },
          selection: { anchor: from + selected.length + 3 },
        })
      } else {
        v.dispatch({
          changes: { from, insert: '[链接文字]()' },
          selection: { anchor: from + 1, head: from + 5 },
        })
      }
      v.focus()
      return true
    },
  },
  {
    key: 'Mod-Shift-i',
    run: (v) => {
      const pos = v.state.selection.main.head
      const line = v.state.doc.lineAt(pos)
      const before = line.text.trim() ? '\n\n' : ''
      const mark = '![图注]()'
      v.dispatch({
        changes: { from: pos, insert: before + mark + '\n' },
        selection: { anchor: pos + before.length + 2, head: pos + before.length + 4 },
      })
      v.focus()
      return true
    },
  },
])

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
    // 自动补全弹层（跟随暗色编辑器，不用 CodeMirror 默认的浅色）
    '.cm-tooltip': {
      backgroundColor: '#1B1E25',
      border: '1px solid rgba(255,255,255,.12)',
      borderRadius: '8px',
      boxShadow: '0 12px 32px rgba(0,0,0,.45)',
      overflow: 'hidden',
    },
    '.cm-tooltip-autocomplete ul': { fontFamily: 'inherit', maxHeight: '260px' },
    '.cm-tooltip-autocomplete ul li': {
      padding: '4px 8px',
      color: '#D8DCE3',
      fontSize: '12.5px',
      lineHeight: '1.5',
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: 'rgba(22,119,255,.28)',
      color: '#FFFFFF',
    },
    '.cm-completionLabel': { fontFamily: 'ui-monospace, Menlo, Consolas, monospace' },
    '.cm-completionDetail': {
      color: '#8A919E',
      fontStyle: 'normal',
      marginLeft: '10px',
      fontSize: '11px',
    },
    '.cm-tooltip-autocomplete ul li[aria-selected] .cm-completionDetail': { color: '#C9D4E4' },
    '.cm-completionMatchedText': { textDecoration: 'none', color: '#7DB4FF', fontWeight: '700' },
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
        gzhKeymap,
        keymap.of([...completionKeymap, ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(mdHighlight),
        closeBrackets(),
        autocompletion({
          override: [gzhCompletions],
          activateOnTyping: true,
          closeOnBlur: true,
          icons: false,
          maxRenderedOptions: 12,
        }),
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
    // Exposed so the headless-browser check in scripts/cdp-verify-image-ops.mjs
    // can type into the real editor instead of guessing at the DOM.
    ;(window as unknown as { __mopaiCodemirror?: EditorView }).__mopaiCodemirror = view
    return () => {
      ;(window as unknown as { __mopaiCodemirror?: EditorView }).__mopaiCodemirror = undefined
      view.destroy()
    }
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
