import { useCallback, useEffect, useRef } from 'react'
import { blockIndexAtLine, lineAtProgress, progressInBlock } from '@/lib/sync-scroll'

/** One pane's scroll position and how far it can still go. */
export interface ScrollExtent {
  top: number
  max: number
}

/** What the editor pane must offer for scroll sync to drive it. */
export interface EditorScrollHandle {
  /** 0-based source line at the top of the viewport. Null before the view exists. */
  getTopLine(): number | null
  scrollToLine(line: number): void
  getScroll(): ScrollExtent | null
  setScroll(top: number): void
}

/** What the preview pane must offer for scroll sync to drive it. */
export interface PreviewScrollHandle {
  /** Index of the block at the top of the viewport, and how far through it. */
  getTopBlock(): { index: number; frac: number } | null
  scrollToBlock(index: number, frac: number): void
  getScroll(): ScrollExtent | null
  setScroll(top: number): void
}

interface Options {
  enabled: boolean
  blocks: { line: number }[]
  editorRef: React.RefObject<EditorScrollHandle | null>
  previewRef: React.RefObject<PreviewScrollHandle | null>
}

/**
 * A scroll ends once neither pane has moved for this long, and the pane that
 * started it stops owning the sync. Short enough that deliberately grabbing the
 * other pane right afterwards still works, long enough to swallow the echo of our
 * own programmatic scroll.
 */
const IDLE_MS = 110

/**
 * Two-way scroll sync.
 *
 * The panes own their scroll listeners and call the returned handlers; this hook
 * only decides which direction is active and does the translation. Ownership
 * matters because scrolling one pane scrolls the other, which fires its scroll
 * event, which would scroll the first one back — an oscillation that shows up as
 * the preview jittering and refusing to settle.
 */
export function useSyncScroll({ enabled, blocks, editorRef, previewRef }: Options) {
  const owner = useRef<'editor' | 'preview' | null>(null)
  const idleTimer = useRef<number | null>(null)
  const frame = useRef<number | null>(null)
  // Read inside the rAF callback, so the mapping is always the one that matches
  // the document currently on screen rather than the one captured on subscribe.
  const blocksRef = useRef(blocks)
  useEffect(() => {
    blocksRef.current = blocks
  }, [blocks])

  useEffect(() => {
    return () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current)
      if (frame.current) cancelAnimationFrame(frame.current)
    }
  }, [])

  const take = useCallback(
    (from: 'editor' | 'preview', run: () => void) => {
      if (!enabled) return
      // An event from the other pane is our own scroll coming back; drop it.
      if (owner.current && owner.current !== from) return
      owner.current = from
      if (idleTimer.current) window.clearTimeout(idleTimer.current)
      idleTimer.current = window.setTimeout(() => {
        owner.current = null
      }, IDLE_MS)
      if (frame.current) cancelAnimationFrame(frame.current)
      frame.current = requestAnimationFrame(() => {
        frame.current = null
        run()
      })
    },
    [enabled],
  )

  const onEditorScroll = useCallback(() => {
    take('editor', () => {
      const editor = editorRef.current
      const preview = previewRef.current
      if (!editor || !preview) return
      const from = editor.getScroll()
      const to = preview.getScroll()
      if (!from || !to) return
      // The whitespace above the first block and below the last belongs to no
      // block, so block mapping alone never reaches either end of the preview.
      if (from.top <= 0) return preview.setScroll(0)
      if (from.max - from.top <= 1) return preview.setScroll(to.max)
      const top = editor.getTopLine()
      if (top === null) return
      const blocks = blocksRef.current
      const index = blockIndexAtLine(blocks, top)
      if (index < 0) return
      preview.scrollToBlock(index, progressInBlock(blocks, index, top))
    })
  }, [take, editorRef, previewRef])

  const onPreviewScroll = useCallback(() => {
    take('preview', () => {
      const editor = editorRef.current
      const preview = previewRef.current
      if (!editor || !preview) return
      const from = preview.getScroll()
      const to = editor.getScroll()
      if (!from || !to) return
      if (from.top <= 0) return editor.setScroll(0)
      if (from.max - from.top <= 1) return editor.setScroll(to.max)
      const top = preview.getTopBlock()
      if (!top) return
      editor.scrollToLine(lineAtProgress(blocksRef.current, top.index, top.frac))
    })
  }, [take, editorRef, previewRef])

  return { onEditorScroll, onPreviewScroll }
}
