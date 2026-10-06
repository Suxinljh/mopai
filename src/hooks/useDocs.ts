import { useCallback, useEffect, useRef, useState } from 'react'
import { trpc } from '@/providers/trpc'
import { createDoc, loadDocs, loadActiveId, saveDocs, saveActiveId, type DocRecord } from '@/lib/store'

export type SyncState = 'loading' | 'synced' | 'saving' | 'local' | 'error'

interface Options {
  /** Server sync needs a session; anonymous visitors stay on localStorage. */
  enabled: boolean
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
export function useDocs({ enabled }: Options) {
  const [docs, setDocs] = useState<DocRecord[]>([])
  const [activeId, setActiveId] = useState('')
  const [syncState, setSyncState] = useState<SyncState>('loading')
  const [notice, setNotice] = useState<string | null>(null)
  /** 内容变过但还没写进数据库的稿件 id，用来点亮保存按钮。 */
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set())

  const utils = trpc.useUtils()
  const readyRef = useRef(false)
  const migratedRef = useRef(false)
  const saveTimer = useRef<number | null>(null)
  const pendingRef = useRef<Set<string>>(new Set())
  // 最近一次已落库的内容，用来判断是否真的需要再写一次
  const lastSavedRef = useRef<Map<string, string>>(new Map())

  const listQuery = trpc.docs.list.useQuery(undefined, { enabled, retry: false })
  const importMutation = trpc.docs.importLocal.useMutation()
  const saveMutation = trpc.docs.save.useMutation()
  const saveToDraftsMutation = trpc.docs.saveToDrafts.useMutation()
  const removeMutation = trpc.docs.remove.useMutation()

  // 1. 首次加载：先显示本地缓存，服务器结果到了再覆盖
  useEffect(() => {
    if (readyRef.current) return
    readyRef.current = true
    const local = loadDocs()
    setDocs(local.docs)
    setActiveId(local.activeId)
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
          if (local.docs.length > 0) {
            await importMutation.mutateAsync({ docs: local.docs })
            setNotice(`已把浏览器里的 ${local.docs.length} 篇稿件同步到账号`)
          }
          setDocs(local.docs)
          setActiveId(local.activeId)
        } else {
          const mapped: DocRecord[] = remote.map((d) => ({
            id: d.id,
            name: d.name,
            content: d.content,
            updatedAt: d.updatedAt.getTime(),
            savedAt: d.savedAt ? d.savedAt.getTime() : null,
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
    if (!docs.length) return
    saveDocs(docs, activeId)
  }, [docs, activeId])

  useEffect(() => {
    if (activeId) saveActiveId(activeId)
  }, [activeId])

  const flush = useCallback(
    async (ids: string[]) => {
      if (!enabled) return
      // 只把已经进过草稿箱的稿件同步上去，未保存的等用户主动保存
      const targets = docs.filter((d) => ids.includes(d.id) && d.savedAt !== null)
      if (!targets.length) return
      setSyncState('saving')
      try {
        for (const d of targets) {
          await saveMutation.mutateAsync({
            id: d.id,
            name: d.name,
            content: d.content,
            updatedAt: d.updatedAt,
          })
          lastSavedRef.current.set(d.id, d.content)
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

  const removeDoc = useCallback(
    async (id: string) => {
      const rest = docs.filter((d) => d.id !== id)
      const next = rest.length ? rest : [createDoc()]
      setDocs(next)
      if (activeId === id) setActiveId(next[0].id)
      lastSavedRef.current.delete(id)
      if (enabled) {
        try {
          await removeMutation.mutateAsync({ id })
          await utils.docs.drafts.invalidate()
        } catch {
          setNotice('删除没同步到云端，下次打开可能还在')
        }
      }
    },
    [docs, activeId, enabled, removeMutation, utils],
  )

  const refresh = useCallback(() => {
    void utils.docs.list.invalidate()
    void utils.docs.drafts.invalidate()
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
    syncState,
    notice,
    clearNotice: () => setNotice(null),
    hasUnsavedChanges,
    neverSaved,
    dirtyCount: dirtyIds.size,
    addDoc,
    removeDoc,
    saveCurrentToDrafts,
    refresh,
  }
}
