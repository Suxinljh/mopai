/**
 * Fenced code block ranges, in character offsets.
 *
 * Both halves of the image-addressing system count `![...](...)` in the raw
 * source: parse.ts numbers them, render.ts locates them by that number. Neither
 * used to skip code fences, so an article that showed a Markdown image example
 * inside a ``` block shifted every occurrence after it — and an upload then wrote
 * its key into the wrong image. The two counters have to share one definition of
 * "this is code", which is why this lives on its own.
 */

export type Range = readonly [start: number, end: number]

const FENCE = /^\s{0,3}(`{3,}|~{3,})/

/**
 * Every fenced code region, including one left open at the end of the document.
 * Ranges are half-open and cover the fence lines themselves.
 */
export function fencedRanges(content: string): Range[] {
  const out: Range[] = []
  let pos = 0
  let open: { char: string; length: number; start: number } | null = null

  for (const line of content.split('\n')) {
    const next = pos + line.length + 1
    const m = FENCE.exec(line)
    if (m) {
      const run = m[1]
      if (!open) {
        open = { char: run[0], length: run.length, start: pos }
      } else if (
        // CommonMark: the closing fence is the same character, at least as long,
        // and carries no info string.
        run[0] === open.char &&
        run.length >= open.length &&
        line.trim() === run
      ) {
        out.push([open.start, Math.min(next, content.length)])
        open = null
      }
    }
    pos = next
  }

  // An unterminated fence swallows the rest of the document, which is also what
  // a Markdown renderer does with it.
  if (open) out.push([open.start, content.length])
  return out
}

/** Whether a character offset sits inside any fenced code region. */
export function isInFence(ranges: Range[], index: number): boolean {
  return ranges.some(([start, end]) => index >= start && index < end)
}
