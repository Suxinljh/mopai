// 语义 IR：Markdown 解析后的中间结构，与任何视觉样式无关。
// 主题渲染器只消费这些节点，新增主题不需要改稿件。

export interface InlineSeg {
  text: string // '\n' 表示段内换行
  bold?: boolean
  mark?: boolean // ==下划线重点==
  code?: boolean
  italic?: boolean
  strike?: boolean
  link?: string // 公众号正文外链不可点，渲染降级并产生警告
}

export type CellAlign = 'left' | 'center' | 'right'

export type Block =
  | { type: 'paragraph'; segs: InlineSeg[] }
  | { type: 'heading'; kicker: string; title: string; numbered: boolean } // ## KICKER | 标题
  | { type: 'subheading'; title: string } // ###
  | { type: 'center'; segs: InlineSeg[] } // :::center 居中强调句
  | { type: 'quoteCard'; segs: InlineSeg[] } // > 金句卡片
  | { type: 'quoteBox'; paras: InlineSeg[][] } // :::quote 引文框
  | { type: 'image'; alt: string; src: string; line: number; occurrence: number } // ![图注](src)
  | { type: 'carousel'; title: string; ratio: CarouselRatio; items: CarouselItem[]; line: number; occurrence: number } // :::carousel [比例] 标题
  | { type: 'signature' } // @signature
  | { type: 'list'; ordered: boolean; items: InlineSeg[][] }
  | { type: 'table'; align: CellAlign[]; head: InlineSeg[][]; rows: InlineSeg[][][] } // GFM 表格
  | { type: 'code'; lang: string; code: string }
  | { type: 'hr' }

export interface CarouselItem {
  alt: string
  src: string
  /**
   * 1-based index of this image among every `![...](...)` in the raw Markdown,
   * counted in document order. This is the only unambiguous way to address one
   * image back in the source: captions repeat, and a carousel gives all its
   * slides the same line number.
   */
  occurrence: number
}

/** Uniform frame every image in one carousel is cropped to at upload time. */
export const CAROUSEL_RATIOS = ['4:3', '3:4', '16:9', '9:16', '1:1'] as const

export type CarouselRatio = (typeof CAROUSEL_RATIOS)[number]

export const DEFAULT_CAROUSEL_RATIO: CarouselRatio = '4:3'

export function isCarouselRatio(v: string): v is CarouselRatio {
  return (CAROUSEL_RATIOS as readonly string[]).includes(v)
}

/** "4:3" -> 4/3, used for cropping and for sizing the frame. */
export function ratioValue(ratio: string): number {
  const [w, h] = ratio.split(':').map(Number)
  return w > 0 && h > 0 ? w / h : 4 / 3
}

export interface DocMeta {
  titles: string[] // 标题候选，渲染进侧栏而非正文
  cover: string
  author: string
}

export interface Doc {
  meta: DocMeta
  blocks: Block[]
}

export interface RenderStats {
  chars: number
  images: number
  carousels: number
  warnings: string[]
}

export interface SignatureConfig {
  layout: string // 排版
  proof: string // 校对
  review: string // 审核
}
