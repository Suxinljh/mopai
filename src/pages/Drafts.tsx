import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Toaster, toast } from 'sonner'
import { trpc } from '@/providers/trpc'
import { useAuth } from '@/hooks/useAuth'
import { loadDocs, saveActiveId, type DocRecord } from '@/lib/store'
import { UNDO_DELETE_MS } from '@/hooks/useDocs'
import { ThemeToggle } from '@/components/ThemeToggle'

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
  /** `agent:<token name>` when it arrived through /api/agent; null when written here. */
  source: string | null
}

function toCard(d: {
  id: string
  name: string
  content: string
  savedAt: Date | null
  source?: string | null
}): DraftCard {
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
    source: d.source ?? null,
  }
}

function formatDate(ts: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

interface BinRow {
  id: string
  name: string
  deletedAt: number
}

function BinSection({
  rows,
  onRestore,
  onPurge,
}: {
  rows: BinRow[]
  onRestore: (id: string) => void
  onPurge: (id: string, name: string) => void
}) {
  if (!rows.length) return null
  return (
    <section className="mt-8">
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-[13px] font-bold tracking-wide text-[#0E1525]">回收站</h2>
        <span className="text-[11px] text-[#6B7793]">
          {rows.length} 篇 · 彻底删除之前都找得回来
        </span>
      </div>
      <ul className="space-y-2">
        {rows.map((t) => (
          <li key={t.id} className="ya-well flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-[#394560]">
                {t.name || '未命名稿件'}
              </p>
              <p className="text-[11px] text-[#6B7793]" style={{ fontFamily: 'var(--font-mono)' }}>
                删除于 {formatDate(t.deletedAt)}
              </p>
            </div>
            <button
              onClick={() => onRestore(t.id)}
              className="ya-btn-secondary ya-btn ya-btn-sm shrink-0"
            >
              恢复
            </button>
            <button onClick={() => onPurge(t.id, t.name)} className="ya-link-btn danger shrink-0">
              彻底删除
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function Drafts() {
  const navigate = useNavigate()
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const utils = trpc.useUtils()
  const [query, setQuery] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'savedAt' | 'chars' | 'images'>('savedAt')
  const [onlyWithImages, setOnlyWithImages] = useState(false)

  const draftsQuery = trpc.docs.drafts.useQuery(undefined, { enabled: isAuthenticated, retry: false })
  const trashQuery = trpc.docs.trash.useQuery(undefined, { enabled: isAuthenticated, retry: false })
  const removeMutation = trpc.docs.remove.useMutation({
    onSuccess: async () => {
      await utils.docs.trash.invalidate()
      await utils.docs.drafts.invalidate()
      await utils.docs.list.invalidate()
    },
    onError: () => toast.error('删除失败'),
  })
  const restoreMutation = trpc.docs.restore.useMutation({
    onSuccess: async () => {
      await utils.docs.trash.invalidate()
      await utils.docs.drafts.invalidate()
      await utils.docs.list.invalidate()
    },
    onError: () => toast.error('恢复失败'),
  })
  const purgeMutation = trpc.docs.purge.useMutation({
    onSuccess: async () => {
      await utils.docs.trash.invalidate()
    },
    onError: () => toast.error('彻底删除失败'),
  })

  /** 移入回收站；撤销走 restore，10 秒窗口之外还能在回收站里找回。 */
  const deleteDraft = (card: DraftCard) => {
    removeMutation.mutate({ id: card.id })
    toast(`「${card.name || '未命名稿件'}」已移入回收站`, {
      description: '10 秒内可以撤销，之后去回收站找回',
      duration: UNDO_DELETE_MS,
      action: {
        label: '撤销',
        onClick: () => restoreMutation.mutate({ id: card.id }),
      },
    })
  }

  // Signed-out visitors keep their bin in localStorage; without this the only
  // way back from a delete there would be the 10-second toast.
  const [localBin, setLocalBin] = useState<BinRow[]>(() =>
    loadDocs()
      .docs.filter((d) => d.deletedAt)
      .map((d) => ({ id: d.id, name: d.name, deletedAt: d.deletedAt as number })),
  )
  const rewriteLocal = (fn: (docs: DocRecord[]) => DocRecord[]) => {
    try {
      const next = fn(loadDocs().docs)
      localStorage.setItem('mopai.docs.v1', JSON.stringify(next))
      setLocalBin(
        next
          .filter((d) => d.deletedAt)
          .map((d) => ({ id: d.id, name: d.name, deletedAt: d.deletedAt as number })),
      )
    } catch {
      // 本地写不进去就算了，回收站这层只是保险
    }
  }
  const restoreBin = (id: string) => {
    if (isAuthenticated) restoreMutation.mutate({ id })
    else rewriteLocal((ds) => ds.map((d) => (d.id === id ? { ...d, deletedAt: null } : d)))
  }
  const purgeBin = (id: string, name: string) => {
    if (!window.confirm(`彻底删除「${name || '未命名稿件'}」？这一步找不回来。`)) return
    if (isAuthenticated) purgeMutation.mutate({ id })
    else rewriteLocal((ds) => ds.filter((d) => d.id !== id))
  }
  const binRows: BinRow[] = isAuthenticated
    ? (trashQuery.data ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        deletedAt: t.deletedAt ? t.deletedAt.getTime() : 0,
      }))
    : localBin

  const cards = useMemo(() => (draftsQuery.data ?? []).map(toCard), [draftsQuery.data])

  const sorted = useMemo(() => {
    const key = sortBy === 'chars' ? 'chars' : sortBy === 'images' ? 'images' : 'savedAt'
    return [...cards].sort((a, b) => b[key] - a[key])
  }, [cards, sortBy])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sorted.filter((c) => {
      if (onlyWithImages && !c.hasImages) return false
      if (!q) return true
      return c.name.toLowerCase().includes(q) || c.content.toLowerCase().includes(q)
    })
  }, [sorted, query, onlyWithImages])

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
        deletedAt: null,
        source: card.source,
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
    return <Shell onBack={() => navigate('/')} count={null}><p className="text-[13px] text-ink-3">读取中…</p></Shell>
  }

  if (!isAuthenticated) {
    return (
      <Shell onBack={() => navigate('/')} count={null}>
        <div className="ya-well p-6">
          <p className="text-[13px] leading-relaxed text-ink-2">
            草稿箱需要登录——稿件是跟着账号存的，这样换设备也能打开。
          </p>
          <button
            onClick={() => navigate('/login')}
            className="ya-btn ya-btn-primary mt-4"
          >
            去登录
          </button>
        </div>
        <BinSection rows={binRows} onRestore={restoreBin} onPurge={purgeBin} />
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
          className="ya-input min-w-0 flex-1"
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          title="按什么排序"
          className="ya-input shrink-0 cursor-pointer appearance-none !w-auto pr-8"
        >
          <option value="savedAt">最近保存</option>
          <option value="chars">字数最多</option>
          <option value="images">图片最多</option>
        </select>
        <label className="ya-btn-ghost ya-btn shrink-0 cursor-pointer !gap-1.5">
          <input
            type="checkbox"
            checked={onlyWithImages}
            onChange={(e) => setOnlyWithImages(e.target.checked)}
            className="h-3.5 w-3.5 accent-brand"
          />
          只看有图
        </label>
        <button
          onClick={() => navigate('/')}
          className="ya-btn ya-btn-primary shrink-0"
        >
          新建一篇
        </button>
      </div>

      {draftsQuery.isLoading ? (
        <p className="text-[13px] text-ink-3">读取中…</p>
      ) : cards.length === 0 ? (
        <div className="ya-well p-8 text-center">
          <p className="text-[13px] font-medium text-ink-2">草稿箱还是空的</p>
          <p className="mt-2 text-[12px] leading-relaxed text-ink-3">
            在编辑器里写完一篇，点顶栏的「保存到草稿箱」，它就会出现在这里。<br />
            编辑过程中的自动保存不会往这里塞东西。
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="ya-well p-6 text-[13px] text-ink-3">
          没有匹配「{query}」的稿件。
        </p>
      ) : (
        <ul className="space-y-2.5">
          {filtered.map((c) => (
            <li key={c.id} className="ya-well p-4">
              <div className="flex items-start gap-3">
                <button onClick={() => openDraft(c)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-[14px] font-semibold text-ink-1">{c.name || '未命名稿件'}</p>
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-3" style={{ fontFamily: 'var(--font-mono)' }}>
                    <span>保存于 {formatDate(c.savedAt)}</span>
                    <span className="text-ink-4">·</span>
                    <span>{c.chars} 字</span>
                    <span className="text-ink-4">·</span>
                    <span>{c.images} 图</span>
                    {c.carousels > 0 && (
                      <>
                        <span className="text-ink-4">·</span>
                        <span>{c.carousels} 轮播</span>
                      </>
                    )}
                    {c.source?.startsWith('agent:') && (
                      <>
                        <span className="text-black/15">·</span>
                        <span title="由 Agent 通过 /api/agent 推进来，在编辑器里改动会自动同步回云端">
                          Agent 推的（{c.source.slice('agent:'.length)}）
                        </span>
                      </>
                    )}
                  </p>
                  {c.headings.length > 0 && (
                    <p className="mt-2 truncate text-[12px] text-ink-2">
                      {c.headings.join(' / ')}
                    </p>
                  )}
                </button>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <button
                    onClick={() => openDraft(c)}
                    className="ya-btn-secondary ya-btn ya-btn-sm"
                  >
                    打开
                  </button>
                  <button
                    onClick={() => void copyBody(c)}
                    className="ya-link-btn"
                  >
                    {copiedId === c.id ? '已复制' : '复制 md'}
                  </button>
                  <button
                    onClick={() => deleteDraft(c)}
                    className="ya-link-btn danger"
                  >
                    删除
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <BinSection rows={binRows} onRestore={restoreBin} onPurge={purgeBin} />
      <Toaster position="bottom-center" />
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
    <div className="ya-page min-h-screen">
      <header className="ya-glass sticky top-0 z-10 flex h-14 items-center gap-3 px-4">
        <button
          onClick={onBack}
          className="ya-btn-secondary ya-btn ya-btn-sm !h-8"
        >
          ← 回到编辑器
        </button>
        <div className="flex items-baseline gap-2">
          <span className="text-[15px] font-bold tracking-wide text-ink-1">草稿箱</span>
          <span className="ya-eyebrow">drafts</span>
          {count !== null && <span className="text-[12px] text-ink-3" style={{ fontFamily: 'var(--font-mono)' }}>{count} 篇</span>}
        </div>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  )
}
