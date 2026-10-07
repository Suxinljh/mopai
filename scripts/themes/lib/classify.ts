// 分类维度推导：风格标签、复杂度、模板专区分组。
//
// 两百多套主题不可能逐套人工打标，所以标签由两处证据推出来：
// 上游自带的描述/标签字段（多数来源都有），加上对样式本身的度量。
// 推导规则集中在这里，改了重跑 importer 就能整套重算，不会散落成一堆手写常量。

import { STYLE_TAGS, type ColorFamily, type Complexity, type StyleTag } from '../../../src/lib/theme-meta'
import { isDark } from './color'

interface KeywordRule {
  tag: StyleTag
  re: RegExp
}

/** 中英文关键词都收：上游描述有中文的、有英文的，也有只给主题名的。 */
const KEYWORDS: KeywordRule[] = [
  { tag: '科技', re: /科技|技术|极客|程序|代码|开发|终端|未来|赛博|数字|蓝图|数码|评测|效率工具|tech|geek|code|dev(eloper)?|terminal|cyber|future|linear|stripe|github|notion|vercel|claude|apple|nvidia|matrix|blueprint|review/i },
  { tag: '商务', re: /商务|企业|职场|商业|报告|专业|金融|财经|投行|数据|日报|榜单|品牌|营销|展示|默认|通用|business|corporate|report|finance|bloomberg|professional|economist|brand|marketing|data/i },
  { tag: '政务', re: /政务|党政|机关|公文|时政|宣传|官方|正式|government|official|native/i },
  { tag: '杂志', re: /杂志|报纸|新闻|刊物|编辑|内刊|专栏|深度|评论|时尚|女性|金融时报|少数派|media|magazine|editorial|news|press|journal|nyt|guardian|nikkei|lemonde|latepost|broadsheet|vogue|fashion|sspai|medium|pie|ft\b/i },
  { tag: '文艺复古', re: /文艺|复古|怀旧|散文|诗歌|书卷|人文|手帐|手账|留白|呼吸|克制|发丝|极简|优雅|北欧|原研哉|安藤|letterpress|retro|vintage|literary|classic|serif|poem|essay|humanit|typewriter|nostalg|minimal|whitespace|elegant|nordic|kenya|ando|jony|ive/i },
  { tag: '中国风', re: /中国风|国风|国潮|水墨|宣纸|宋|唐诗|三国|青竹|竹|禅|茶|汉服|古风|chinese|ink(wash)?|washi|zen|tang|song|bamboo|kami|sanguo|guochao|porcelain/i },
  { tag: '学术', re: /学术|论文|科普|知识|研究|学院|课程|讲义|教程|指南|academic|paper|science|scholar|research|academy|lecture|bauhaus|swiss|tutorial|guide/i },
  { tag: '运动', re: /运动|体育|健身|赛事|跑|球|sport|fitness|velocity|race|match|athletic/i },
  { tag: '卡通', re: /卡通|像素|漫画|游戏|动漫|活泼|pixel|cartoon|comic|game|storybook|arcade|quest|colorful|lively/i },
  { tag: '治愈', re: /治愈|可爱|少女|温柔|甜美|温暖|柔和|清新|奶油|樱花|粉|薄荷|暖|情感|生活|cute|sweet|sakura|pastel|warm|cozy|latte|mint|soft|peach|candy|cream|dream|aurora|emotion|life/i },
  { tag: '节日', re: /节日|新年|春节|圣诞|国庆|中秋|festive|holiday|christmas|festival|newyear|celebrat/i },
]

/** 只按关键词命中的标签，不含暗色/多彩这类从配色推出来的。 */
export function keywordHits(text: string): StyleTag[] {
  const found = new Set<StyleTag>()
  for (const rule of KEYWORDS) {
    if (rule.re.test(text)) found.add(rule.tag)
  }
  return STYLE_TAGS.filter((t) => found.has(t))
}

export function styleTagsFrom(
  text: string,
  extra: { background: string; accent: string; hues: number[] },
): StyleTag[] {
  const found = new Set<StyleTag>(keywordHits(text))
  if (isDark(extra.background)) found.add('暗色')
  // 配色横跨五个以上彼此拉开距离的色相，视觉气质才是活泼的；
  // 数"出现了几次饱和色"不行，那几乎每套主题都会命中。
  const hueBuckets = new Set(extra.hues.map((h) => Math.round(h / 45) % 8))
  if (hueBuckets.size >= 5) found.add('卡通')
  const tags = STYLE_TAGS.filter((t) => found.has(t))
  return tags.length ? tags : ['商务']
}

export interface ComplexityInput {
  /** 所有元素样式拼起来的总长度 */
  cssLength: number
  /** 声明条数 */
  declarations: number
  gradients: number
  shadows: number
  radii: number
  /** 上游给了自定义列表符号 / 标题装饰件 */
  customMarkers: boolean
  /** 带背景图（含 data-URI SVG 装饰） */
  backgroundImage: boolean
  styledElements: number
}

/**
 * 复杂度按"装饰密度"度量，而不是按主观印象。
 * 三档的边界是从现有九套手写主题反推的：极简/石墨/留白落在 1，
 * golden/稳重/红与白落在 2，摸鱼绿/票据/橄榄落在 3。
 */
export function complexityOf(c: ComplexityInput): Complexity {
  let score = 0
  score += Math.min(2, c.gradients * 0.7)
  score += Math.min(1.5, c.shadows * 0.4)
  score += Math.min(1, c.radii * 0.15)
  if (c.customMarkers) score += 1
  if (c.backgroundImage) score += 0.8
  score += Math.min(1.5, c.declarations / 90)
  score += Math.min(1, c.styledElements / 22)
  if (score < 2.6) return 1
  if (score < 5.2) return 2
  return 3
}

export function measureStyles(styles: Record<string, string>): ComplexityInput {
  const all = Object.values(styles).join(';')
  const declarations = all.split(';').filter((d) => d.includes(':')).length
  return {
    cssLength: all.length,
    declarations,
    gradients: (all.match(/linear-gradient|radial-gradient/g) || []).length,
    shadows: (all.match(/box-shadow|text-shadow/g) || []).length,
    radii: (all.match(/border-radius/g) || []).length,
    customMarkers: Boolean(styles.listBullet || styles.olBullet || styles.listItemRow || styles.list_item_bullet),
    backgroundImage: /url\(/.test(all),
    styledElements: Object.values(styles).filter((v) => v && v.trim()).length,
  }
}

/** 模板专区的四个粗分组：编辑器顶栏快速切换用，细粒度浏览走 meta.styles。 */
export function categoryOf(tags: StyleTag[], complexity: Complexity, color: ColorFamily): '简约' | '商务' | '杂志' | '活力' {
  if (tags.includes('杂志') || tags.includes('文艺复古')) return '杂志'
  if (tags.includes('商务') || tags.includes('政务') || tags.includes('学术')) return '商务'
  if (complexity === 1 || color === '中性') return '简约'
  return '活力'
}
