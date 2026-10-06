import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { carouselFrame } from '@/lib/themes'
import { CAROUSEL_RATIOS, type CarouselRatio } from '@/lib/types'

interface Props {
  open: boolean
  /** Which slot is being filled, shown so the user knows what they are cropping. */
  label: string
  alt: string
  /** Ratio already written into the carousel opener — locks the choice when set. */
  current?: CarouselRatio
  /**
   * Carousel slides must share one frame, so the choice is mandatory there.
   * A standalone image may keep its own proportions, so offer that too.
   */
  mode: 'carousel' | 'loose'
  busy: boolean
  onCancel: () => void
  onConfirm: (ratio: CarouselRatio | null) => void
  /** Hand the image over to the interactive cropper instead. */
  onManual: () => void
}

/**
 * Every image in one carousel is cropped to a single shared frame, so the
 * published slides line up instead of jumping in height. A standalone image is
 * left alone unless the user asks otherwise.
 */
export default function RatioPicker({ open, label, alt, current, mode, busy, onCancel, onConfirm, onManual }: Props) {
  const [ratio, setRatio] = useState<CarouselRatio | null>(mode === 'loose' ? null : current ?? '4:3')
  const locked = mode === 'carousel' && Boolean(current)

  useEffect(() => {
    if (!open) return
    setRatio(mode === 'loose' ? null : current ?? '4:3')
  }, [open, current, mode])

  const preview = ratio ? carouselFrame(ratio) : null

  return (
    <Dialog open={open} onOpenChange={(v) => (!v && !busy ? onCancel() : undefined)}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[15px]">
            {mode === 'loose' ? '要不要按固定比例裁一下？' : '选一个画幅比例'}
          </DialogTitle>
          <DialogDescription className="text-[12px] leading-relaxed">
            {mode === 'loose' ? (
              <>
                单张图默认保持原样。要是想让它和别的图并排时高度一致，可以选一个比例，图片会居中裁切后再上传。
              </>
            ) : locked ? (
              <>
                这个轮播已经定死 <strong className="text-[#111]">{ratio}</strong>。轮播内所有图片必须同比例，
                换比例请先在正文里改 <code className="rounded bg-black/5 px-1">:::carousel</code> 那一行。
              </>
            ) : (
              <>
                轮播里的图片必须同比例，所以先定一个。图片会按所选比例居中裁切后再上传，
                之后这个轮播里剩下的图自动沿用同一个比例。
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-1">
          <p className="mb-2 text-[11px] text-[#9A9A9A]">
            {label} · {alt || '未命名'}
          </p>

          {mode === 'loose' && (
            <button
              type="button"
              onClick={() => setRatio(null)}
              className={`mb-2 flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-all ${
                ratio === null ? 'border-[#1677FF] bg-[#1677FF]/5 ring-1 ring-[#1677FF]/25' : 'border-black/8 hover:border-black/20'
              }`}
            >
              <span className={`text-[12px] ${ratio === null ? 'font-semibold text-[#1677FF]' : 'text-[#555]'}`}>
                保持原图比例，不裁
              </span>
              <span className="ml-auto text-[11px] text-[#9A9A9A]">推荐</span>
            </button>
          )}

          <div className="grid grid-cols-5 gap-2">
            {CAROUSEL_RATIOS.map((r) => {
              const f = carouselFrame(r)
              const active = r === ratio
              return (
                <button
                  key={r}
                  type="button"
                  disabled={locked}
                  onClick={() => setRatio(r)}
                  title={`${r} → 裁成 ${f.cropWidth}×${f.cropHeight}`}
                  className={`flex flex-col items-center gap-1.5 rounded-lg border px-1 py-2 transition-all ${
                    active ? 'border-[#1677FF] bg-[#1677FF]/5 ring-1 ring-[#1677FF]/25' : 'border-black/8 hover:border-black/20'
                  } ${locked && !active ? 'opacity-40' : ''} disabled:cursor-not-allowed`}
                >
                  <span
                    className={`block rounded-sm border ${active ? 'border-[#1677FF] bg-[#1677FF]/12' : 'border-black/20 bg-black/4'}`}
                    style={{ width: `${(f.width / 240) * 26}px`, height: `${(f.height / 240) * 26}px` }}
                  />
                  <span className={`text-[11px] tabular-nums ${active ? 'font-semibold text-[#1677FF]' : 'text-[#555]'}`}>
                    {r}
                  </span>
                </button>
              )
            })}
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-[#9A9A9A]">
            {preview
              ? `自动居中裁切，尺寸 ${preview.cropWidth}×${preview.cropHeight}。`
              : '原图按自身尺寸上传，正文里按容器宽度自适应。'}
          </p>

          <button
            type="button"
            onClick={onManual}
            disabled={locked}
            title={locked ? '这个轮播的比例已定，先改正文里的 :::carousel 那一行' : undefined}
            className="mt-2 flex w-full items-center justify-between rounded-lg border border-dashed border-black/15 px-3 py-2 text-left transition-colors hover:border-[#1677FF]/50 hover:bg-[#1677FF]/4 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="text-[12px] text-[#333]">手动裁切</span>
            <span className="text-[11px] text-[#9A9A9A]">自己拖，决定留哪一块 →</span>
          </button>
        </div>

        {/* Sticky so the actions stay reachable when the dialog scrolls on a short window. */}
        <div className="sticky bottom-0 -mx-6 -mb-6 mt-2 flex justify-end gap-2 border-t border-black/8 bg-white px-6 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-black/8 px-3 py-1.5 text-[13px] text-[#555] transition-colors hover:border-black/20 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onConfirm(ratio)}
            disabled={busy}
            className="rounded-lg bg-[#111] px-4 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-black disabled:opacity-50"
          >
            {busy ? '处理中…' : ratio ? '按这个比例上传' : '原样上传'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
