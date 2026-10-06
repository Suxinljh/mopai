import { useRef } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { MaterialItem } from '@/lib/render'
import type { SignatureConfig } from '@/lib/types'

interface Props {
  materials: MaterialItem[]
  titles: string[]
  cover: string
  sig: SignatureConfig
  onSig: (s: SignatureConfig) => void
  onJump: (line: number) => void
  onCopyTitle: (t: string) => void
  onUpload: (files: File[], item: MaterialItem) => void
  uploadingKey: string | null
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[#9A9A9A]">{children}</p>
}

export default function SidePanel(p: Props) {  const fileRef = useRef<HTMLInputElement>(null)
  const pendingRef = useRef<MaterialItem | null>(null)

  const pick = (item: MaterialItem) => {
    pendingRef.current = item
    fileRef.current?.click()
  }

  // 一个轮播里已经定下的比例，用于给同轮播的每张图提示
  const carouselRatio = new Map<number, string>()
  for (const m of p.materials) {
    if (m.carouselOrdinal && m.ratio) carouselRatio.set(m.carouselOrdinal, m.ratio)
  }

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col border-l border-black/8 bg-white">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || [])
          if (files.length && pendingRef.current) p.onUpload(files, pendingRef.current)
          e.target.value = ''
        }}
      />
      <Tabs defaultValue="materials" className="flex h-full flex-col">
        <div className="border-b border-black/8 px-3 pt-3">
          <TabsList className="h-8 w-full bg-black/4">
            <TabsTrigger value="materials" className="flex-1 text-[12px]">素材</TabsTrigger>
            <TabsTrigger value="titles" className="flex-1 text-[12px]">标题</TabsTrigger>
            <TabsTrigger value="settings" className="flex-1 text-[12px]">设置</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="materials" className="m-0 min-h-0 flex-1 overflow-y-auto p-3">
          <Label>素材清单 · 点击上传直接回填</Label>
          {p.materials.length === 0 ? (
            <p className="rounded-lg bg-black/3 p-3 text-[12px] leading-relaxed text-[#9A9A9A]">
              正文中还没有图片。用 <code className="rounded bg-black/5 px-1">![图注说明]()</code> 添加占位，或直接把图片拖进编辑器。
            </p>
          ) : (
            <ul className="space-y-1.5">
              {p.materials.map((m, i) => {
                const uploading = p.uploadingKey === `${m.no}-${m.alt}`
                return (
                  <li key={i} className="rounded-lg border border-black/6 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => p.onJump(m.line)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        title="点击定位到编辑器对应行"
                      >
                        <span className="shrink-0 rounded bg-[#1677FF]/10 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-[#1677FF]">{m.no}</span>
                        <span className="text-[11px] text-[#9A9A9A]">{m.kind}</span>
                        {m.kind === '轮播' && m.ratio && (
                          <span
                            className="shrink-0 rounded bg-black/5 px-1.5 py-0.5 text-[10px] tabular-nums text-[#555]"
                            title={`这个轮播统一裁成 ${m.ratio}，同轮播内所有图片必须一致`}
                          >
                            {m.ratio}
                          </span>
                        )}
                        {m.hasSrc ? (
                          <span className="ml-auto shrink-0 rounded bg-emerald-500/10 px-1.5 text-[10px] text-emerald-600">已传图</span>
                        ) : (
                          <span className="ml-auto shrink-0 rounded bg-amber-500/10 px-1.5 text-[10px] text-amber-600">待插图</span>
                        )}
                      </button>
                      <button
                        onClick={() => pick(m)}
                        disabled={uploading}
                        className="shrink-0 rounded-md border border-black/10 px-2 py-0.5 text-[11px] text-[#333] transition-colors hover:border-black/25 disabled:opacity-50"
                      >
                        {uploading ? '上传中…' : m.hasSrc ? '替换' : '上传'}
                      </button>
                    </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-[#333]">{m.desc}</p>
                    {m.carouselOrdinal && (
                      <p className="mt-1 text-[11px] leading-relaxed text-[#9A9A9A]">
                        {m.hasSrc
                          ? `轮播 ${m.carouselOrdinal} · 统一 ${m.ratio}`
                          : `轮播 ${m.carouselOrdinal} · 点上传时选比例，同一轮播共用`}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="titles" className="m-0 min-h-0 flex-1 overflow-y-auto p-3">
          <Label>标题候选 · 不进正文</Label>
          {p.titles.filter(Boolean).length === 0 ? (
            <p className="rounded-lg bg-black/3 p-3 text-[12px] leading-relaxed text-[#9A9A9A]">
              在稿件开头的 front matter 里写 <code className="rounded bg-black/5 px-1">titles:</code> 列表，候选标题会出现在这里。
            </p>
          ) : (
            <ul className="space-y-1.5">
              {p.titles.filter(Boolean).map((t, i) => (
                <li key={i} className="flex items-start gap-2 rounded-lg border border-black/6 px-3 py-2">
                  {i === 0 && <span className="mt-0.5 shrink-0 rounded bg-[#1677FF]/10 px-1.5 text-[10px] text-[#1677FF]">推荐</span>}
                  <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-[#333]">{t}</p>
                  <button
                    onClick={() => p.onCopyTitle(t)}
                    className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-[#9A9A9A] transition-colors hover:bg-black/4 hover:text-[#111]"
                  >
                    复制
                  </button>
                </li>
              ))}
            </ul>
          )}
          {p.cover && (
            <>
              <div className="mt-4"><Label>封面说明</Label></div>
              <p className="rounded-lg bg-black/3 p-3 text-[12px] leading-relaxed text-[#707070]">{p.cover}</p>
            </>
          )}
        </TabsContent>

        <TabsContent value="settings" className="m-0 min-h-0 flex-1 overflow-y-auto p-3">
          <Label>署名 · @signature 展开内容</Label>
          <div className="space-y-2">
            {(
              [
                ['layout', '排版'],
                ['proof', '校对'],
                ['review', '审核'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 rounded-lg border border-black/6 px-3 py-2">
                <span className="w-8 shrink-0 text-[12px] text-[#707070]">{label}</span>
                <input
                  value={p.sig[key]}
                  onChange={(e) => p.onSig({ ...p.sig, [key]: e.target.value })}
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-[#111] outline-none"
                  placeholder="姓名"
                />
              </label>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-[#9A9A9A]">
            署名保存在本机浏览器，对所有稿件生效。数据不会上传，清除浏览器数据会丢失。
          </p>
        </TabsContent>
      </Tabs>
    </aside>
  )
}
