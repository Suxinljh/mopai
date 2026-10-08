import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { trpc } from '@/providers/trpc'
import { createDoc, createSampleDoc, loadDocs, loadActiveId, saveDocs, saveActiveId, type DocRecord } from '@/lib/store'

export type SyncState = 'loading' | 'synced' | 'saving' | 'local' | 'error'

/** How long a delete stays reversible. */
export const UNDO_DELETE_MS = 10_000

interface Options {
  /** Server sync needs a session; anonymous visitors stay on localStorage. */
  enabled: boolean
  /**
   * Article to open, from a `?doc=<id>` link — that is how an agent hands its
   * pushed draft to the owner. Applied once the list it should be in has
   * arrived, then reported back through `onDeepLinkSettled` so the caller can
   * drop the parameter from the URL.
   */
  deepLinkId?: string | null
  onDeepLinkSettled?: (found: boolean) => void
}

/**
 * 稿件真相源是服务器数据库，localStorage 只当离线缓存。
 *
 * 写盘分两条路，刻意分开：
 *   - 浏览器本地：每次改动都写，纯本地、即时，用来防丢
 *   - 云端：只在该稿件已经被保存过（savedAt 有值）时随改动更新；
 *     没保存过的稿件要等用户点「保存到草稿箱」才会出现在云端和草稿箱里
 *
 * 这样打字时不会有网络请求一直跑，草稿箱里也只有主动保存过的东西。
 */
export function useDocs({ enabled, deepLinkId, onDeepLinkSettled }: Options) {
  const [docs, setDocs] = useState<DocRecord[]>([])
  const [activeId, setActiveId] = useState('')
  const [syncState, setSyncState] = useState<SyncState>('loading')
  const [notice, setNotice] = useState<string | null>(null)
  /** 内容变过但还没写进数据库的稿件 id，用来点亮保存按钮。 */
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set())
  /**
   * Trashed docs this browser holds while anonymous. Once signed in the server's
   * bin is the truth and this stays empty; purely local trashed drafts (never
   * saved) live here so they survive a reload.
   */
  const [localTrash, setLocalTrash] = useState<DocRecord[]>(() =>
    loadDocs().docs.filter((d) => d.deletedAt),
  )

  const utils = trpc.useUtils()
  const readyRef = useRef(false)
  const migratedRef = useRef(false)
  /** A `?doc=<id>` link is applied once, then forgotten. */
  const deepLinkRef = useRef<string | null>(deepLinkId ?? null)
  const deepLinkDone = useRef(false)
  const saveTimer = useRef<number | null>(null)
  const pendingRef = useRef<Set<string>>(new Set())
  // 最近一次已落库的内容，用来判断是否真的需要再写一次
  const lastSavedRef = useRef<Map<string, string>>(new Map())

  const listQuery = trpc.docs.list.useQuery(undefined, { enabled, retry: false })
  const trashQuery = trpc.docs.trash.useQuery(undefined, { enabled, retry: false })
  const importMutation = trpc.docs.importLocal.useMutation()
  const saveMutation = trpc.docs.save.useMutation()
  const saveToDraftsMutation = trpc.docs.saveToDrafts.useMutation()
  const removeMutation = trpc.docs.remove.useMutation()
  const restoreMutation = trpc.docs.restore.useMutation()
  const purgeMutation = trpc.docs.purge.useMutation()

  // 1. 首次加载：先显示本地缓存，服务器结果到了再覆盖
  useEffect(() => {
    if (readyRef.current) return
    readyRef.current = true
    const local = loadDocs()
    const live = local.docs.filter((d) => !d.deletedAt)
    const shown = live.length ? live : [createDoc()]
    setDocs(shown)
    setActiveId(shown.some((d) => d.id === local.activeId) ? local.activeId : shown[0].id)
    if (!enabled) setSyncState('local')
  }, [enabled])

  // 2. 服务器数据到达 → 一次性导入 + 接管
  useEffect(() => {
    if (!enabled || !listQuery.isSuccess || migratedRef.current) return
    migratedRef.current = true

    const run = async () => {
      const remote = listQuery.data ?? []
      for (const d of remote) lastSavedRef.current.set(d.id, d.content)

      try {
        if (remote.length === 0) {
          const local = loadDocs()
          const live = local.docs.filter((d) => !d.deletedAt)
          if (live.length > 0) {
            await importMutation.mutateAsync({ docs: live })
            setNotice(`已把浏览器里的 ${live.length} 篇稿件同步到账号`)
          }
          const shown = live.length ? live : [createDoc()]
          setDocs(shown)
          setActiveId(shown.some((d) => d.id === local.activeId) ? local.activeId : shown[0].id)
        } else {
          const mapped: DocRecord[] = remote.map((d) => ({
            id: d.id,
            name: d.name,
            content: d.content,
            updatedAt: d.updatedAt.getTime(),
            savedAt: d.savedAt ? d.savedAt.getTime() : null,
            deletedAt: null,
            source: d.source ?? null,
          }))
          setDocs(mapped)
          const stored = loadActiveId()
          setActiveId(mapped.some((d) => d.id === stored) ? stored : mapped[0].id)
        }
        setSyncState('synced')
      } catch {
        setSyncState('error')
        setNotice('读取云端稿件失败，当前在本地编辑')
      }
    }
    void run()
  }, [enabled, listQuery.isSuccess, listQuery.data, importMutation])

  // 3. 本地缓存始终跟着写一份（每次改动都写，纯本地，不碰网络）
  useEffect(() => {
    if (!docs.length && !localTrash.length) return
    saveDocs([...docs, ...localTrash], activeId)
  }, [docs, localTrash, activeId])

  useEffect(() => {
    if (activeId) saveActiveId(activeId)
  }, [activeId])

  // 5. Agent 推来的链接（?doc=<id>）优先于「上次看的那篇」，但要等列表落地：
  //    那篇稿子在服务器上，本地缓存里还没有它。未登录时不消费它 —— 匿名根本看
  //    不到服务端的稿件，说「不在这个账号里」是把原因说错了，EditorPage 会先带
  //    她去登录，登录后再回到这个链接。
  useEffect(() => {
    const id = deepLinkRef.current
    if (!id || deepLinkDone.current || !enabled || syncState === 'loading') return
    deepLinkDone.current = true
    deepLinkRef.current = null
    const found = docs.some((d) => d.id === id)
    if (found) {
      setActiveId(id)
    } else {
      setNotice('链接指向的稿件不在这个账号里，可能已经被删掉了')
    }
    onDeepLinkSettled?.(found)
  }, [docs, syncState, enabled, onDeepLinkSettled])

  const flush = useCallback(
    async (ids: string[]) => {
      if (!enabled) return
      // 只把已经进过草稿箱的稿件同步上去，未保存的等用户主动保存
      const targets = docs.filter((d) => ids.includes(d.id) && d.savedAt !== null)
      if (!targets.length) return
      setSyncState('saving')
      try {
        for (const d of targets) {
          const res = await saveMutation.mutateAsync({
            id: d.id,
            name: d.name,
            content: d.content,
            updatedAt: d.updatedAt,
          })
          lastSavedRef.current.set(d.id, d.content)
          if (res.missing) {
            // The row is gone server-side (deleted on another device). Keep
            // the article as a local, unarchived draft instead of retrying
            // forever or reviving it — re-archiving is the owner's call.
            setDocs((ds) => ds.map((x) => (x.id === d.id ? { ...x, savedAt: null } : x)))
            setNotice(`「${d.name || '未命名稿件'}」在云端已被删除，已转为本地稿；需要时点「保存到草稿箱」重新归档`)
          }
        }
        setDirtyIds((prev) => {
          const next = new Set(prev)
          for (const d of targets) if (lastSavedRef.current.get(d.id) === d.content) next.delete(d.id)
          return next
        })
        setSyncState('synced')
      } catch {
        setSyncState('error')
        setNotice('有一处改动没同步上，稍后会自动重试')
      }
    },
    [enabled, docs, saveMutation],
  )

  // 4. 编辑后防抖同步（只针对已保存过的稿件）
  useEffect(() => {
    if (!enabled || syncState === 'loading') return
    const dirty = docs.filter((d) => lastSavedRef.current.get(d.id) !== d.content)
    setDirtyIds((prev) => {
      const next = new Set<string>()
      for (const d of dirty) next.add(d.id)
      if (next.size === prev.size && [...next].every((id) => prev.has(id))) return prev
      return next
    })

    const syncable = dirty.filter((d) => d.savedAt !== null)
    if (!syncable.length) {
      pendingRef.current.clear()
      return
    }
    for (const d of syncable) pendingRef.current.add(d.id)
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const ids = [...pendingRef.current]
      pendingRef.current.clear()
      void flush(ids)
    }, 900)
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [docs, enabled, syncState, flush])

  const addDoc = useCallback(() => {
    const d = createDoc()
    setDocs((ds) => [d, ...ds])
    setActiveId(d.id)
    return d
  }, [])

  const addSampleDoc = useCallback(() => {
    const d = createSampleDoc()
    setDocs((ds) => [d, ...ds])
    setActiveId(d.id)
    return d
  }, [])

  /** 保存到草稿箱：这是唯一让文章进入归档的动作。 */
  const saveCurrentToDrafts = useCallback(async () => {
    const doc = docs.find((d) => d.id === activeId)
    if (!doc) return { ok: false as const, message: '没有打开的稿件' }
    if (!enabled) {
      return { ok: false as const, message: '未登录：草稿箱需要登录后才能用，当前内容已存在浏览器里' }
    }
    setSyncState('saving')
    try {
      const res = await saveToDraftsMutation.mutateAsync({
        id: doc.id,
        name: doc.name,
        content: doc.content,
        updatedAt: doc.updatedAt,
      })
      lastSavedRef.current.set(doc.id, doc.content)
      setDirtyIds((prev) => {
        const next = new Set(prev)
        next.delete(doc.id)
        return next
      })
      setDocs((ds) => ds.map((d) => (d.id === doc.id ? { ...d, savedAt: res.savedAt } : d)))
      await utils.docs.drafts.invalidate()
      setSyncState('synced')
      return { ok: true as const, savedAt: res.savedAt }
    } catch {
      setSyncState('error')
      return { ok: false as const, message: '保存失败，检查一下网络' }
    }
  }, [docs, activeId, enabled, saveToDraftsMutation, utils])

  /**
   * 移入回收站：列表里立刻消失，但服务端只做软删除，所以回收站能原样请回来。
   * 未登录时回收站只存在这个浏览器里。
   */
  const removeDoc = useCallback(
    (id: string) => {
      const doc = docs.find((d) => d.id === id)
      if (!doc) return
      const rest = docs.filter((d) => d.id !== id)
      const next = rest.length ? rest : [createDoc()]
      setDocs(next)
      if (activeId === id) setActiveId(next[0].id)
      lastSavedRef.current.delete(id)
      pendingRef.current.delete(id)
      if (enabled) {
        removeMutation
          .mutateAsync({ id })
          .then(() => utils.docs.trash.invalidate())
          .catch(() => setNotice('删除没同步到云端，回收站里可能还看不到'))
      } else {
        setLocalTrash((t) => [{ ...doc, deletedAt: Date.now() }, ...t])
      }
    },
    [docs, activeId, enabled, removeMutation, utils],
  )

  /** 从回收站请回来。匿名时是纯本地操作。 */
  const restoreDoc = useCallback(
    async (id: string): Promise<boolean> => {
      const local = localTrash.find((d) => d.id === id)
      if (local) {
        setLocalTrash((t) => t.filter((d) => d.id !== id))
        setDocs((ds) => (ds.some((d) => d.id === id) ? ds : [{ ...local, deletedAt: null }, ...ds]))
        return true
      }
      if (!enabled) return false
      try {
        const row = (await restoreMutation.mutateAsync({ id })).doc
        if (row) {
          lastSavedRef.current.set(row.id, row.content)
          setDocs((ds) =>
            ds.some((d) => d.id === row.id)
              ? ds
              : [
                  {
                    id: row.id,
                    name: row.name,
                    content: row.content,
                    updatedAt: row.updatedAt.getTime(),
                    savedAt: row.savedAt ? row.savedAt.getTime() : null,
                    deletedAt: null,
                    source: row.source ?? null,
                  },
                  ...ds,
                ],
          )
        }
        await utils.docs.trash.invalidate()
        return true
      } catch {
        setNotice('恢复失败，稍后再试')
        return false
      }
    },
    [localTrash, enabled, restoreMutation, utils],
  )

  /** The 10-second toast action; the bin page calls restoreDoc directly. */
  const undoRemove = useCallback((id: string) => restoreDoc(id), [restoreDoc])

  /** 彻底删除。图不会被连带删，它们会进素材库的「没在用的旧图」。 */
  const purgeDoc = useCallback(
    async (id: string): Promise<boolean> => {
      if (localTrash.some((d) => d.id === id)) {
        setLocalTrash((t) => t.filter((d) => d.id !== id))
        return true
      }
      if (!enabled) return false
      try {
        await purgeMutation.mutateAsync({ id })
        await utils.docs.trash.invalidate()
        return true
      } catch {
        setNotice('彻底删除失败，稍后再试')
        return false
      }
    },
    [localTrash, enabled, purgeMutation, utils],
  )

  const trashDocs = useMemo(
    () =>
      enabled
        ? (trashQuery.data ?? []).map((t) => ({
            id: t.id,
            name: t.name,
            content: '',
            updatedAt: 0,
            savedAt: t.savedAt ? t.savedAt.getTime() : null,
            deletedAt: t.deletedAt ? t.deletedAt.getTime() : null,
          }))
        : localTrash,
    [enabled, trashQuery.data, localTrash],
  )

  const refresh = useCallback(() => {
    void utils.docs.list.invalidate()
    void utils.docs.drafts.invalidate()
    void utils.docs.trash.invalidate()
  }, [utils])

  const activeDoc = docs.find((d) => d.id === activeId) || null
  // 保存过、但之后又改过内容 -> 提示需要再存一次
  const hasUnsavedChanges = Boolean(activeDoc && dirtyIds.has(activeDoc.id))
  const neverSaved = Boolean(activeDoc && activeDoc.savedAt === null)

  return {
    docs,
    setDocs,
    activeId,
    setActiveId,
    activeDoc,
    trashDocs,
    syncState,
    notice,
    clearNotice: () => setNotice(null),
    hasUnsavedChanges,
    neverSaved,
    dirtyCount: dirtyIds.size,
    addDoc,
    addSampleDoc,
    removeDoc,
    undoRemove,
    restoreDoc,
    purgeDoc,
    saveCurrentToDrafts,
    refresh,
  }
}
