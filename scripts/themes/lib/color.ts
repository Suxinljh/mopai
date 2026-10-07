// 颜色工具：从上游样式里推出色板，再据色板算出色系分类。
// 上游有的直接给了 colors（xiaohu 系），有的只给 CSS（raphael / huasheng / md-wechat），
// 所以两条路都要能落到同一份 ThemePalette。

export interface Rgb {
  r: number
  g: number
  b: number
}

export function parseColor(value: string): Rgb | null {
  const v = value.trim()
  const hex = v.match(/^#([0-9a-f]{3,8})$/i)
  if (hex) {
    let h = hex[1]
    if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('')
    if (h.length < 6) return null
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    }
  }
  const rgb = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i)
  if (rgb) {
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) }
  }
  const named: Record<string, string> = {
    white: '#ffffff',
    black: '#000000',
    transparent: '#ffffff',
  }
  if (named[v.toLowerCase()]) return parseColor(named[v.toLowerCase()])
  return null
}

export function toHex({ r, g, b }: Rgb): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase()
}

export function hsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === rn) h = 60 * (((gn - bn) / d) % 6)
  else if (max === gn) h = 60 * ((bn - rn) / d + 2)
  else h = 60 * ((rn - gn) / d + 4)
  if (h < 0) h += 360
  return { h, s, l }
}

/** 相对亮度，用来判断主题是不是暗色系（ACKS 用的同一个判据）。 */
export function luminance(c: Rgb): number {
  const f = (n: number) => {
    const v = n / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
}

export function isDark(hex: string): boolean {
  const c = parseColor(hex)
  return c ? luminance(c) < 0.35 : false
}

/** 主色的浅底：往背景色方向混，暗色主题往深混，保证浅底始终比主色淡。 */
export function tint(hex: string, background: string, amount = 0.78): string {
  const a = parseColor(hex)
  const b = parseColor(background) ?? { r: 255, g: 255, b: 255 }
  if (!a) return hex
  return toHex({
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  })
}

export function mix(hex: string, other: string, amount: number): string {
  const a = parseColor(hex)
  const b = parseColor(other)
  if (!a || !b) return hex
  return toHex({
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  })
}

/** 灰阶/近黑近白都算中性，其余按色相分冷暖。 */
export type ColorFamily = '冷色' | '暖色' | '中性' | '多彩'

export function colorFamilyOf(accent: string, background: string, extraHues: number[] = []): ColorFamily {
  const a = parseColor(accent)
  if (!a) return '中性'
  const { h, s, l } = hsl(a)
  const bg = parseColor(background)
  const bgL = bg ? luminance(bg) : 1
  const nearBg = bg ? Math.abs(l - bgL) < 0.08 : false
  if (s < 0.14 || nearBg) return '中性'
  // 主题里出现五个以上彼此拉开距离的饱和色相，才算多彩（彩虹/糖果那类）
  const distinct = new Set(
    extraHues.filter((hue) => hue >= 0).map((hue) => Math.round(hue / 45) % 8).concat(Math.round(h / 45) % 8),
  )
  if (distinct.size >= 5) return '多彩'
  const warm = h >= 320 || h < 70
  return warm ? '暖色' : '冷色'
}

/** 从一段 CSS 里把所有颜色挖出来，用于统计色相分布。 */
export function collectColors(css: string): string[] {
  const out: string[] = []
  for (const m of css.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)) {
    const c = parseColor(m[0])
    if (c) out.push(toHex(c))
  }
  return out
}

/** 饱和度足够、又不太接近黑白灰的颜色，才算一个"有主张"的色相。 */
export function saturatedHues(colors: string[]): number[] {
  const hues: number[] = []
  for (const c of colors) {
    const rgb = parseColor(c)
    if (!rgb) continue
    const { s, l } = hsl(rgb)
    if (s > 0.25 && l > 0.12 && l < 0.92) hues.push(hsl(rgb).h)
  }
  return hues
}
