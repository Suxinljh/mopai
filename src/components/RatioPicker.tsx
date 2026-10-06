import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { carouselFrame } from '@/lib/themes'
import { CAROUSEL_RATIOS, type CarouselRatio } from '@/lib/types'

interface Props {
  open: boolean
  /** Which carousel slot is being filled, shown so the user knows what they are cropping. */
  label: string
  alt: string
  /** Ratio already written into the carousel opener, if any. */
  current?: CarouselRatio
  busy: boolean
  onCancel: () => void
  onConfirm: (ratio: CarouselRatio) => void
}

/**
 * Every image in one carousel gets cropped to a single shared frame, so the
 * published slides line up instead of jumping in height.
 */
export default function RatioPicker({ open, label, alt, current, busy, onCancel, onConfirm }: Props) {
  const [ratio, setRatio] = useState<CarouselRatio>(current ?? '4:3')

  useEffect(() => {
    if (open && current) setRatio(current)
  }, [open, current])

  const fixed = Boolean(current)

  return (
    <Dialog open={open} onOpenChange={(v) => (!v && !busy ? onCancel() : undefined)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[15px]">选一个画幅比例</DialogTitle>
          <DialogDescription className="text-[12px] leading-relaxed">
            {fixed ? (
              <>
                这个轮播已经定死 <strong className="text-[#111]">{ratio}</strong>。轮播内所有图片必须同比例，
                换比例请先在正文里改 <code className="rounded bg-black/5 px-1">:::carousel</code> 那一行。
              </>
            ) : (
              <>
                图片会按所选比例居中裁切后再上传，裁掉的部分不会保留。定好之后，这个轮播里后面的图会自动沿用同一个比例。
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-1">
          <p className="mb-2 text-[11px] text-[#9A9A9A]">
            {label} · {alt || '未命名'}
          </p>
          <div className="grid grid-cols-5 gap-2">
            {CAROUSEL_RATIOS.map((r) => {
              const f = carouselFrame(r)
              const active = r === ratio
              return (
                <button
                  key={r}
                  type="button"
                  disabled={fixed}
                  onClick={() => setRatio(r)}
                  title={`${r} → 裁成 ${f.cropWidth}×${f.cropHeight}`}
                  className={`flex flex-col items-center gap-1.5 rounded-lg border px-1 py-2 transition-all ${
                    active ? 'border-[#1677FF] bg-[#1677FF]/5 ring-1 ring-[#1677FF]/25' : 'border-black/8 hover:border-black/20'
                  } ${fixed && !active ? 'opacity-40' : ''} disabled:cursor-not-allowed`}
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
            裁切尺寸 {carouselFrame(ratio).cropWidth}×{carouselFrame(ratio).cropHeight}，
            正文里显示为 {carouselFrame(ratio).width}×{carouselFrame(ratio).height}。
          </p>
        </div>

        <div className="mt-2 flex justify-end gap-2">
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
            {busy ? '裁切上传中…' : '按这个比例上传'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
