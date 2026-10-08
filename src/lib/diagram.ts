const CACHE_KEY = 'mopai.diagrams.v1'
const CACHE_MAX = 50

/**
 * A fenced ```mermaid block, plus the caption its author put on the fence.
 *
 * parse.ts keeps a fence's whole info string in Block.lang, so ```mermaid 架构总览
 * arrives as lang 'mermaid 架构总览'. Reading the caption off the fence is what
 * lets a diagram stay an ordinary code block: no new entry in the Block union,
 * which the theme work is editing at the same time.
 */
export function diagramOf(lang: string): { title: string } | null {
  const [name, ...rest] = lang.trim().split(/\s+/)
  return name.toLowerCase() === 'mermaid' ? { title: rest.join(' ') } : null
}

/** mermaid source -> the `img:<key>` it was uploaded as. */
export type DiagramCache = Map<string, string>

/**
 * Rasterizing and uploading a diagram costs seconds and one R2 write, so the
 * result is remembered across sessions. Stored as pairs rather than an object so
 * the recency order survives the round trip.
 */
export function loadDiagramCache(): DiagramCache {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (Array.isArray(parsed)) {
      const entries = parsed.filter(
        (e): e is [string, string] =>
          Array.isArray(e) && e.length === 2 && typeof e[0] === 'string' && typeof e[1] === 'string',
      )
      return new Map(entries.slice(-CACHE_MAX))
    }
  } catch {
    // A corrupt cache costs one re-upload, not a crash.
  }
  return new Map()
}

export function saveDiagramCache(cache: DiagramCache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify([...cache]))
  } catch {
    // Blocked or full storage: this session's diagrams still render.
  }
}

/** Record a diagram as the newest entry, dropping whatever falls off the cap. */
export function rememberDiagram(cache: DiagramCache, code: string, ref: string): void {
  cache.delete(code)
  cache.set(code, ref)
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    cache.delete(oldest.value)
  }
}
