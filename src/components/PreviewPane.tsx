import { useMemo } from 'react'
import type { RenderStats } from '@/lib/types'

interface Props {
  html: string
  stats: RenderStats
  width: 375 | 677
  onWidthChange: (w: 375 | 677) => void
}

// 预览 DOM 即复制 DOM：dangerouslySetInnerHTML 渲染的就是复制出去的同一字符串
export default function PreviewPane({ html, stats, width, onWidthChange }: Props) {
  const article = useMemo(() => ({ __html: html }), [html])

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-black/6 px-4">
        <span className="ya-eyebrow">预览 · 所见即所复制</span>
        {/* 分段选择：凹陷轨道 + 选中项 1.5px primary 描边，不用实心底色 */}
        <div className="flex items-center rounded-xl bg-[#DEE3EC] p-0.5" style={{ boxShadow: 'var(--shadow-inset)' }}>
          {([375, 677] as const).map((w) => (
            <button
              key={w}
              onClick={() => onWidthChange(w)}
              className={`rounded-[10px] px-2.5 py-0.5 text-[11px] tabular-nums transition-all ${
                width === w ? 'bg-[#EFF2F8] text-[#0E1525]' : 'text-[#6B7793] hover:text-[#0E1525]'
              }`}
              style={width === w ? { boxShadow: 'inset 0 0 0 1.5px var(--primary-500)' } : undefined}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      {/* 预览区是一口凹陷的井：纸张浮在井里，页面本身是 carrier */}
      <div className="min-h-0 flex-1 overflow-y-auto" style={{ background: 'var(--bg-sunken)', boxShadow: 'var(--shadow-inset)' }}>
        <div className="flex justify-center px-4 py-6">
          <div
            className="shrink-0 rounded-[4px] bg-white transition-all duration-300"
            style={{ width, boxShadow: 'var(--shadow-lifted)' }}
          >
            <div className="px-1 py-6" dangerouslySetInnerHTML={article} />
          </div>
        </div>
      </div>

      <div className="flex h-8 shrink-0 items-center justify-between border-t border-black/6 px-4 text-[11px] text-[#6B7793]">
        <span className={stats.warnings.length ? 'text-[#A57427]' : ''}>
          {stats.warnings.length ? `${stats.warnings.length} 条提醒：${stats.warnings[0]}` : '格式检查通过'}
        </span>
        <span className="tabular-nums" style={{ fontFamily: 'var(--font-mono)' }}>
          {stats.chars} 字 · {stats.images} 图{stats.carousels ? ` · ${stats.carousels} 轮播` : ''}
        </span>
      </div>
    </div>
  )
}
