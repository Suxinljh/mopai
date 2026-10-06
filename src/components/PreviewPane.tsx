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
    <div className="flex h-full flex-col bg-[#F7F7F9]">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-black/8 px-4">
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#707070]">预览 · 所见即所复制</span>
        <div className="flex items-center rounded-md border border-black/8 bg-white p-0.5">
          {([375, 677] as const).map((w) => (
            <button
              key={w}
              onClick={() => onWidthChange(w)}
              className={`rounded px-2 py-0.5 text-[11px] tabular-nums transition-colors ${
                width === w ? 'bg-[#111111] text-white' : 'text-[#707070] hover:text-[#111]'
              }`}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex justify-center px-4 py-6">
          <div
            className="shrink-0 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_32px_rgba(0,0,0,0.06)] ring-1 ring-black/8 transition-all duration-300"
            style={{ width }}
          >
            <div className="px-1 py-6" dangerouslySetInnerHTML={article} />
          </div>
        </div>
      </div>

      <div className="flex h-8 shrink-0 items-center justify-between border-t border-black/8 px-4 text-[11px] text-[#707070]">
        <span className={stats.warnings.length ? 'text-amber-600' : ''}>
          {stats.warnings.length ? `${stats.warnings.length} 条提醒：${stats.warnings[0]}` : '格式检查通过'}
        </span>
        <span className="tabular-nums">
          {stats.chars} 字 · {stats.images} 图{stats.carousels ? ` · ${stats.carousels} 轮播` : ''}
        </span>
      </div>
    </div>
  )
}
