import { esc, type Theme } from './themes'

/**
 * Capabilities a theme may optionally implement.
 *
 * Declared here rather than on `Theme` itself so new block kinds can ship
 * without editing `themes.ts`: every one of the nine themes keeps working
 * through the defaults below, and a theme that wants its own look adds the
 * method later. This also keeps the theme files free to change underneath us -
 * the renderer never requires a method that a theme must provide.
 */
export interface ThemeExtensions {
  /** Superscript marker left behind where a link used to be. */
  footnoteRef?(index: number): string
  /** The reference list appended to the end of the article. */
  footnotes?(items: FootnoteItem[]): string
  /** A display equation. `inner` is rendered SVG, or a pending TeX placeholder. */
  math?(tex: string, inner: string, display: boolean): string
}

export type ExtendedTheme = Theme & ThemeExtensions

export interface FootnoteItem {
  index: number
  /** Link text, kept so the reader can tell two references to the same host apart. */
  text: string
  url: string
}

/**
 * WeChat makes body links unclickable, so a link rendered as coloured text loses
 * the URL outright - the reader has no way to recover it. Numbering the link in
 * place and listing the URLs at the end keeps the citation reachable on paper.
 */
export function defaultFootnoteRef(index: number): string {
  return `<span style="font-size:11px;line-height:1;color:#1677FF;vertical-align:super;"><span leaf="">[${index}]</span></span>`
}

export function defaultFootnotes(items: FootnoteItem[]): string {
  const rows = items
    .map(
      (f) =>
        `<p style="margin:6px 0 0;font-size:12px;line-height:1.7;letter-spacing:.5px;color:#888888;text-align:left;text-indent:0;word-break:break-all;"><span leaf="">${f.index}. ${esc(f.url)}</span></p>`,
    )
    .join('')
  return `<section style="margin:0;padding-top:14px;border-top:1px solid #E6EDF6;"><p style="margin:0;font-size:12px;line-height:1.5;letter-spacing:2px;color:#888888;text-indent:0;"><span leaf="">参考链接</span></p>${rows}</section>`
}

/**
 * A display equation, centred like every other display element.
 *
 * The explicit `color` is load-bearing: MathJax's glyphs are drawn with
 * `currentColor`, and the WeChat paste target's inherited colour is not something
 * we control. Measured to survive the paste with the colour set this way.
 */
export function defaultMath(_tex: string, inner: string, _display: boolean): string {
  return `<section style="margin:0;padding:12px 0;color:#1F2937;text-align:center;text-indent:0;overflow-x:auto;">${inner}</section>`
}

/**
 * What the author sees when a formula does not compile.
 *
 * MathJax's own default is to typeset the problem as a red merror box holding a
 * mirrored <text> node and a data-mjx-error attribute - markup that would be
 * pasted straight into the article. The renderer rethrows instead and shows the
 * TeX back. Same one-paragraph shape as the pending placeholder in render.ts, so
 * the block mapping does not shift when a formula fails.
 */
export function mathFailure(tex: string): string {
  return `<p style="margin:0;font-family:Menlo,Consolas,monospace;font-size:12px;line-height:1.6;color:#B42318;text-align:center;text-indent:0;word-break:break-all;"><span leaf="">公式无法编译 ${esc(tex)}</span></p>`
}

/** Read an optional theme method, falling back to the default implementation. */
export function ext(theme: Theme): Required<ThemeExtensions> {
  const t = theme as ExtendedTheme
  return {
    footnoteRef: t.footnoteRef ?? defaultFootnoteRef,
    footnotes: t.footnotes ?? defaultFootnotes,
    math: t.math ?? defaultMath,
  }
}
