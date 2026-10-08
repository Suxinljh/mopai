/**
 * TeX -> inline SVG, lazily.
 *
 * renderDoc stays a pure synchronous function: it never sees MathJax. It asks an
 * injected resolver for the SVG of a formula and gets either the cached markup or
 * null, and the caller re-renders once the cache fills. That keeps the 38 MB
 * dependency off the first-load bundle and keeps the renderer usable in Node.
 *
 * The SVG is MathJax's own output with only its <mjx-container> wrapper removed.
 * Measured against a real paste into the WeChat backend: the raw output, with its
 * `ex` units and currentColor, survives intact, so any further rewriting would
 * only be a chance to introduce an error. currentColor is resolved by an explicit
 * `color` on the wrapper paragraph instead.
 */

import { mathFailure } from './theme-fallbacks'

export interface MathEngine {
  convert(tex: string, display: boolean): string
}

let engine: MathEngine | null = null
let loading: Promise<MathEngine> | null = null

async function loadEngine(): Promise<MathEngine> {
  // mathjax-full's components/version.js reads its own package.json through an
  // eval'd require, which does not exist in a browser bundle. It checks for a
  // PACKAGE_VERSION global first - the escape hatch its own bundlers use - so
  // define one and the require path is never taken. Keep in step with the
  // dependency version in package.json.
  ;(globalThis as Record<string, unknown>).PACKAGE_VERSION ??= '3.2.2'
  const [{ mathjax }, { TeX }, { SVG }, { liteAdaptor }, { RegisterHTMLHandler }, { AllPackages }] =
    await Promise.all([
      import('mathjax-full/js/mathjax.js'),
      import('mathjax-full/js/input/tex.js'),
      import('mathjax-full/js/output/svg.js'),
      import('mathjax-full/js/adaptors/liteAdaptor.js'),
      import('mathjax-full/js/handlers/html.js'),
      import('mathjax-full/js/input/tex/AllPackages.js'),
    ])
  const adaptor = liteAdaptor()
  RegisterHTMLHandler(adaptor)
  // AllPackages turns on noerrors and noundefined, whose whole job is to typeset
  // broken TeX as a red box instead of failing. Without them the error reaches
  // the document hooks below, which rethrow it to the caller.
  const packages = AllPackages.filter((p: string) => p !== 'noerrors' && p !== 'noundefined')
  // fontCache:'none' inlines every glyph as <path>. The alternative shares a
  // global <defs> cache across formulas, which WeChat would strip and leave the
  // article full of dangling <use> references.
  const doc = mathjax.document('', {
    InputJax: new TeX({
      packages,
      // The TeX jax turns a parse error into an merror node here, before the
      // document ever sees it. Rethrow so the failure reaches the caller.
      formatError: (_jax: unknown, err: unknown) => {
        throw err
      },
    }),
    OutputJax: new SVG({ fontCache: 'none' }),
    // The defaults do not fail: they typeset the problem as a red merror box
    // carrying a mirrored <text> node and a data-mjx-error attribute, which would
    // then be pasted into the article as if it were the formula. Rethrow so the
    // caller can show the TeX back instead.
    compileError: (_doc: unknown, _math: unknown, err: unknown) => {
      throw err
    },
    typesetError: (_doc: unknown, _math: unknown, err: unknown) => {
      throw err
    },
  })
  engine = {
    convert: (tex, display) =>
      adaptor
        .outerHTML(doc.convert(tex, { display }) as never)
        .replace(/<mjx-container[^>]*>/g, '')
        .replace(/<\/mjx-container>/g, ''),
  }
  return engine
}

export interface MathSnapshot {
  /**
   * Inner HTML for a formula: its SVG, or a failure box once the TeX is known
   * not to compile. Null only while the formula is still pending.
   */
  get(tex: string, display: boolean): string | null
}

export interface MathRenderer {
  /**
   * Immutable view of the cache. Its identity changes only when a formula lands,
   * so a caller can hold it in state and depend on it directly.
   */
  snapshot(): MathSnapshot
  /** Render one formula now; resolves false if the TeX does not compile. */
  warm(tex: string, display: boolean): Promise<boolean>
  subscribe(fn: () => void): () => void
}

const keyOf = (tex: string, display: boolean) => (display ? 'd' : 'i') + '\u0000' + tex

const EMPTY: MathSnapshot = { get: () => null }

/**
 * One renderer per session. The cache is what makes typing tolerable: re-parsing
 * the document on every keystroke must not re-run MathJax over every formula.
 */
export function createMathRenderer(): MathRenderer {
  const cache = new Map<string, string>()
  const failures = new Set<string>()
  const inflight = new Map<string, Promise<boolean>>()
  const listeners = new Set<() => void>()
  let view: MathSnapshot = EMPTY

  const lookup = (tex: string, display: boolean): string | null => {
    const key = keyOf(tex, display)
    return cache.get(key) ?? (failures.has(key) ? mathFailure(tex) : null)
  }
  const publish = () => {
    // A fresh object every time: its identity is the only signal a React caller
    // has that the cache moved.
    view = { get: lookup }
    listeners.forEach((fn) => fn())
  }

  async function run(key: string, tex: string, display: boolean): Promise<boolean> {
    try {
      const e = engine ?? (await (loading ??= loadEngine()))
      cache.set(key, e.convert(tex, display))
      publish()
      return true
    } catch (e) {
      // A formula that does not compile must not take the whole article down;
      // the renderer falls back to showing the TeX as text. But silence here
      // would leave the author staring at a placeholder with no way to tell a
      // bad formula from a broken loader.
      console.error('[math] render failed', tex, e)
      failures.add(key)
      publish()
      return false
    }
  }

  return {
    snapshot: () => view,
    warm(tex, display) {
      const key = keyOf(tex, display)
      if (cache.has(key)) return Promise.resolve(true)
      if (failures.has(key)) return Promise.resolve(false)
      // The warming effect re-runs on every keystroke, and loading the engine
      // takes seconds; without this the same formula would be converted once
      // per keystroke on the main thread.
      const running = inflight.get(key)
      if (running) return running
      const started = run(key, tex, display).finally(() => inflight.delete(key))
      inflight.set(key, started)
      return started
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}
