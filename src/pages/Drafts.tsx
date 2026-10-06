import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Toaster, toast } from 'sonner'
import { trpc } from '@/providers/trpc'
import { useAuth } from '@/hooks/useAuth'
import { loadDocs, saveActiveId } from '@/lib/store'
import { UNDO_DELETE_MS } from '@/hooks/useDocs'

interface DraftCard {
  id: string
  name: string
  content: string
  savedAt: number
  chars: number
  images: number
  carousels: number
  headings: string[]
  hasImages: boolean
}

function toCard(d: { id: string; name: string; content: string; savedAt: Date | null }): DraftCard {
  const headings = [...d.content.matchAll(/^##\s+(?:\S+\s*\|\s*)?(.+)$/gm)].map((m) => m[1].trim())
  return {
    id: d.id,
    name: d.name,
    content: d.content,
    savedAt: d.savedAt ? d.savedAt.getTime() : 0,
    chars: d.content.replace(/\s/g, '').length,
    images: (d.content.match(/!\[[^\]]*\]\(/g) || []).length,
    carousels: (d.content.match(/:::carousel/g) || []).length,
    headings: headings.slice(0, 3),
    hasImages: /!\[[^\]]*\]\(/.test(d.content),
  }
}

function formatDate(ts: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function Drafts() {
  const navigate = useNavigate()
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const utils = trpc.useUtils()
  const [query, setQuery] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'savedAt' | 'chars' | 'images'>('savedAt')
  const [onlyWithImages, setOnlyWithImages] = useState(false)
  // Cards awaiting their deferred server delete; hidden from the list but
  // restorable until the timer fires.
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set())
  const deleteTimers = useRef<Map<string, number>>(new Map())

  const draftsQuery = trpc.docs.drafts.useQuery(undefined, { enabled: isAuthenticated, retry: false })
  const removeMutation = trpc.docs.remove.useMutation({
    onSuccess: async () => {
      await utils.docs.drafts.invalidate()
      await utils.docs.list.invalidate()
    },
    onError: () => toast.error('删除失败'),
  })

  /** Soft delete: hide the card now, delete on the server only after the undo window. */
  const deleteDraft = (card: DraftCard) => {
    setPendingDeletes((prev) => new Set(prev).add(card.id))
    const timer = window.setTimeout(() => {
      deleteTimers.current.delete(card.id)
      removeMutation.mutate({ id: card.id })
    }, UNDO_DELETE_MS)
    deleteTimers.current.set(card.id, timer)
    toast(`已删除「${card.name || '未命名稿件'}」`, {
      description: '10 秒内可以撤销',
      duration: UNDO_DELETE_MS,
      action: {
        label: '撤销',
        onClick: () => {
          const t = deleteTimers.current.get(card.id)
          if (t === undefined) return
          window.clearTimeout(t)
          deleteTimers.current.delete(card.id)
          setPendingDeletes((prev) => {
            const next = new Set(prev)
            next.delete(card.id)
            return next
          })
          toast.success('已恢复')
        },
      },
    })
  }

  const cards = useMemo(() => (draftsQuery.data ?? []).map(toCard), [draftsQuery.data])

  const sorted = useMemo(() => {
    const key = sortBy === 'chars' ? 'chars' : sortBy === 'images' ? 'images' : 'savedAt'
    return [...cards].sort((a, b) => b[key] - a[key])
  }, [cards, sortBy])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sorted.filter((c) => {
      if (pendingDeletes.has(c.id)) return false
      if (onlyWithImages && !c.hasImages) return false
      if (!q) return true
      return c.name.toLowerCase().includes(q) || c.content.toLowerCase().includes(q)
    })
  }, [sorted, query, onlyWithImages, pendingDeletes])

  /** 打开这篇：写进本地「当前稿件」，回到编辑器。 */
  const openDraft = (card: DraftCard) => {
    try {
      const local = loadDocs()
      const others = local.docs.filter((d) => d.id !== card.id)
      const doc = {
        id: card.id,
        name: card.name,
        content: card.content,
        updatedAt: Date.now(),
        savedAt: card.savedAt,
      }
      localStorage.setItem('mopai.docs.v1', JSON.stringify([doc, ...others]))
      saveActiveId(card.id)
    } catch {
      // 本地写不进去也让编辑器去云端拉
    }
    navigate('/')
  }

  const copyBody = async (card: DraftCard) => {
    try {
      await navigator.clipboard.writeText(card.content)
      setCopiedId(card.id)
      setTimeout(() => setCopiedId(null), 1500)
      toast.success('Markdown 已复制')
    } catch {
      toast.error('复制失败')
    }
  }

  if (authLoading) {
    return <Shell onBack={() => navigate('/')} count={null}><p className="text-[13px] text-[#9A9A9A]">读取中…</p></Shell>
  }

  if (!isAuthenticated) {
    return (
      <Shell onBack={() => navigate('/')} count={null}>
        <div className="rounded-xl border border-black/8 bg-white p-6">
          <p className="text-[13px] leading-relaxed text-[#333]">
            草稿箱需要登录——稿件是跟着账号存的，这样换设备也能打开。
          </p>
          <button
            onClick={() => navigate('/login')}
            className="mt-4 rounded-lg bg-[#111] px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-black"
          >
            去登录
          </button>
        </div>
      </Shell>
    )
  }

  return (
    <Shell onBack={() => navigate('/')} count={cards.length}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜标题或正文…"
          className="min-w-0 flex-1 rounded-lg border border-black/8 bg-white px-3 py-2 text-[13px] text-[#111] outline-none placeholder:text-black/25 focus:border-[#1677FF]/40"
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          title="按什么排序"
          className="shrink-0 rounded-lg border border-black/8 bg-white px-2.5 py-2 text-[13px] text-[#333] outline-none focus:border-[#1677FF]/40"
        >
          <option value="savedAt">最近保存</option>
          <option value="chars">字数最多</option>
          <option value="images">图片最多</option>
        </select>
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-black/8 bg-white px-3 py-2 text-[13px] text-[#333]">
          <input
            type="checkbox"
            checked={onlyWithImages}
            onChange={(e) => setOnlyWithImages(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          只看有图
        </label>
        <button
          onClick={() => navigate('/')}
          className="shrink-0 rounded-lg bg-[#111] px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-black"
        >
          新建一篇
        </button>
      </div>

      {draftsQuery.isLoading ? (
        <p className="text-[13px] text-[#9A9A9A]">读取中…</p>
      ) : cards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-black/12 bg-white p-8 text-center">
          <p className="text-[13px] font-medium text-[#333]">草稿箱还是空的</p>
          <p className="mt-2 text-[12px] leading-relaxed text-[#9A9A9A]">
            在编辑器里写完一篇，点顶栏的「保存到草稿箱」，它就会出现在这里。<br />
            编辑过程中的自动保存不会往这里塞东西。
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="rounded-xl border border-black/8 bg-white p-6 text-[13px] text-[#9A9A9A]">
          没有匹配「{query}」的稿件。
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((c) => (
            <li key={c.id} className="rounded-xl border border-black/8 bg-white p-4 transition-colors hover:border-black/16">
              <div className="flex items-start gap-3">
                <button onClick={() => openDraft(c)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-[14px] font-semibold text-[#111]">{c.name || '未命名稿件'}</p>
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[#9A9A9A]">
                    <span>保存于 {formatDate(c.savedAt)}</span>
                    <span className="text-black/15">·</span>
                    <span>{c.chars} 字</span>
                    <span className="text-black/15">·</span>
                    <span>{c.images} 图</span>
                    {c.carousels > 0 && (
                      <>
                        <span className="text-black/15">·</span>
                        <span>{c.carousels} 轮播</span>
                      </>
                    )}
                  </p>
                  {c.headings.length > 0 && (
                    <p className="mt-2 truncate text-[12px] text-[#707070]">
                      {c.headings.join(' / ')}
                    </p>
                  )}
                </button>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <button
                    onClick={() => openDraft(c)}
                    className="rounded-md border border-black/10 px-2.5 py-1 text-[11px] text-[#333] transition-colors hover:border-black/25"
                  >
                    打开
                  </button>
                  <button
                    onClick={() => void copyBody(c)}
                    className="rounded-md px-2.5 py-1 text-[11px] text-[#9A9A9A] transition-colors hover:bg-black/4 hover:text-[#111]"
                  >
                    {copiedId === c.id ? '已复制' : '复制 md'}
                  </button>
                  <button
                    onClick={() => deleteDraft(c)}
                    className="rounded-md px-2.5 py-1 text-[11px] text-[#9A9A9A] transition-colors hover:bg-black/4 hover:text-[#D93F3F]"
                  >
                    删除
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Toaster position="bottom-center" toastOptions={{ style: { borderRadius: 10 } }} />
    </Shell>
  )
}

function Shell({
  children,
  onBack,
  count,
}: {
  children: React.ReactNode
  onBack: () => void
  count: number | null
}) {
  return (
    <div className="min-h-screen bg-[#F7F7F9] text-[#111]">
      <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-black/8 bg-white/85 px-4 backdrop-blur-md">
        <button
          onClick={onBack}
          className="rounded-lg border border-black/8 bg-white px-3 py-1.5 text-[13px] text-[#333] transition-colors hover:border-black/16"
        >
          ← 回到编辑器
        </button>
        <div className="flex items-baseline gap-2">
          <span className="text-[15px] font-bold tracking-wide text-[#111]">草稿箱</span>
          <span className="text-[10px] uppercase tracking-[0.18em] text-[#9A9A9A]">Drafts</span>
          {count !== null && <span className="text-[12px] text-[#9A9A9A]">{count} 篇</span>}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  )
}
