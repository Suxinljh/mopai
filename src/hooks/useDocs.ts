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
 * 首次登录时做一次性导入：把浏览器里已有的稿子推上服务器，之后不再回灌，
 * 避免每次打开都把本地旧副本盖回线上。
 */
export function useDocs({ enabled }: Options) {
  const [docs, setDocs] = useState<DocRecord[]>([])
  const [activeId, setActiveId] = useState('')
  const [syncState, setSyncState] = useState<SyncState>('loading')
  const [notice, setNotice] = useState<string | null>(null)

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
          }))
          setDocs(mapped)
          const stored = loadActiveId()
          setActiveId(mapped.some((d) => d.id === stored) ? stored : mapped[0].id)
        }
        setSyncState('synced')
      } catch {
        setSyncState('error')
        setNotice('读取云端稿件失败，当前在本地编辑，改动会在下次打开时重试')
      }
    }
    void run()
  }, [enabled, listQuery.isSuccess, listQuery.data, importMutation])

  // 3. 本地缓存始终跟着写一份，断网/未登录时仍有稿子
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
      const targets = docs.filter((d) => ids.includes(d.id))
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
        setSyncState('synced')
      } catch {
        setSyncState('error')
        setNotice('有一处改动没存上，正在重试')
      }
    },
    [enabled, docs, saveMutation],
  )

  // 4. 编辑后防抖落库
  useEffect(() => {
    if (!enabled || syncState === 'loading') return
    const dirty = docs.filter((d) => lastSavedRef.current.get(d.id) !== d.content)
    if (!dirty.length) {
      pendingRef.current.clear()
      return
    }
    for (const d of dirty) pendingRef.current.add(d.id)
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
        } catch {
          setNotice('删除没同步到云端，下次打开可能还在')
        }
      }
    },
    [docs, activeId, enabled, removeMutation],
  )

  const refresh = useCallback(() => {
    void utils.docs.list.invalidate()
  }, [utils])

  return {
    docs,
    setDocs,
    activeId,
    setActiveId,
    activeDoc: docs.find((d) => d.id === activeId) || null,
    syncState,
    notice,
    clearNotice: () => setNotice(null),
    addDoc,
    removeDoc,
    refresh,
  }
}
