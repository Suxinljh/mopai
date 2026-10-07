import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Toaster, toast } from 'sonner'
import { THEMES, type Theme } from '@/lib/themes'
import { parseMarkdown } from '@/lib/parse'
import { renderDoc } from '@/lib/render'
import { loadSettings, saveSettings } from '@/lib/store'
import { YoruMark } from '@/components/YoruMark'
import { APP_NAME, APP_BYLINE } from '@/lib/brand'

// 模板预览样例：覆盖各主题的主要语义节点（章节标题/重点/金句卡/引文框/居中/图片占位/署名）。
const SAMPLE = `## KICKER | 章节标题示例

正文段落：把 **加粗**、==下划线重点== 和 *斜体* 渲染成公众号能接受的内联样式。

### 小标题

> 金句卡片：一句话说清重点。

:::quote
引文框：适合放他人的观点，或者一段需要被看见的话。
:::

:::center
居中强调句。
:::

![图片占位说明]()

@signature
`

/** 把 375px 宽的渲染结果等比缩进卡片宽度的容器。 */
function ScaledPreview({ html }: { html: string }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.5)

  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const update = () => setScale(el.clientWidth / 375)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div
      ref={boxRef}
      className="relative h-56 overflow-hidden rounded-xl bg-white"
      style={{ boxShadow: 'var(--shadow-inset)' }}
    >
      <div
        className="pointer-events-none absolute left-0 top-0 origin-top-left"
        style={{ width: 375, transform: `scale(${scale})` }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {/* 底部渐隐，示意「内容未完」 */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-14"
        style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0.92))' }}
      />
    </div>
  )
}

function ThemeCard({
  theme,
  active,
  previewHtml,
  onUse,
}: {
  theme: Theme
  active: boolean
  previewHtml: string
  onUse: () => void
}) {
  return (
    <div
      className={`ya-well flex flex-col gap-3 p-3.5 transition-all ${active ? 'ya-selected' : ''}`}
    >
      <div className="flex items-baseline gap-2 px-0.5">
        <span className="ya-dot" style={{ background: theme.ui.accent }} />
        <span className="text-[14px] font-semibold text-[#0E1525]">{theme.name}</span>
        <span className="text-[11px] text-[#6B7793]">{theme.desc}</span>
        {active && (
          <span
            className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium"
            style={{ background: 'var(--primary-500)', color: '#fff' }}
          >
            使用中
          </span>
        )}
      </div>
      <ScaledPreview html={previewHtml} />
      <button
        onClick={onUse}
        disabled={active}
        className={`ya-btn ${active ? 'ya-btn-ghost' : 'ya-btn-primary'} w-full`}
      >
        {active ? '当前模板' : '使用此模板'}
      </button>
    </div>
  )
}

export default function Themes() {
  const navigate = useNavigate()
  const [themeId, setThemeId] = useState(() => loadSettings().themeId)
  const sig = useMemo(() => loadSettings().sig, [])

  // 每个主题渲染一遍样例，一次性算好（主题数量少，开销可忽略）
  const previews = useMemo(() => {
    const doc = parseMarkdown(SAMPLE)
    return Object.fromEntries(THEMES.map((t) => [t.id, renderDoc(doc, t, sig).html]))
  }, [sig])

  const useTheme = (t: Theme) => {
    const s = loadSettings()
    saveSettings({ ...s, themeId: t.id })
    setThemeId(t.id)
    toast.success(`已换成「${t.name}」`, { description: '回到编辑器后正文会按新模板重新排版' })
    setTimeout(() => navigate('/'), 450)
  }

  return (
    <div className="ya-page min-h-screen text-[#0E1525]">
      <header className="ya-glass sticky top-0 z-10 flex h-14 items-center gap-3 px-4">
        <button onClick={() => navigate('/')} className="ya-btn ya-btn-secondary ya-btn-sm !h-8">
          ← 回到编辑器
        </button>
        <div className="flex items-center gap-2.5">
          <YoruMark size={24} />
          <span className="text-[15px] font-bold tracking-wide text-[#0E1525]">模板</span>
          <span className="ya-eyebrow">{APP_NAME} · {APP_BYLINE}</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <p className="mb-4 text-[13px] leading-relaxed text-[#6B7793]">
          同一段样例文字，按各模板真实渲染。选中后回到编辑器，你的正文会立刻换成新模板；随时可换回来。
        </p>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {THEMES.map((t) => (
            <ThemeCard
              key={t.id}
              theme={t}
              active={t.id === themeId}
              previewHtml={previews[t.id]}
              onUse={() => useTheme(t)}
            />
          ))}
        </div>
        <p className="mt-6 text-center text-[12px] text-[#6B7793]">
          新模板在路上了——开源之后也欢迎贡献你自己的排版主题。
        </p>
      </main>
      <Toaster position="bottom-center" toastOptions={{ style: { borderRadius: 10 } }} />
    </div>
  )
}
