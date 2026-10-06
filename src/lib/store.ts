import type { SignatureConfig } from './types'
import { SAMPLE_DOC } from './sample'

export interface DocRecord {
  id: string
  name: string
  content: string
  updatedAt: number
  /** When this article was last put into 草稿箱; null = never explicitly saved. */
  savedAt: number | null
}

export interface AppSettings {
  themeId: string
  sig: SignatureConfig
}

const DOCS_KEY = 'mopai.docs.v1'
const ACTIVE_KEY = 'mopai.active.v1'
const SETTINGS_KEY = 'mopai.settings.v1'

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function loadDocs(): { docs: DocRecord[]; activeId: string } {
  try {
    const raw = localStorage.getItem(DOCS_KEY)
    const activeId = localStorage.getItem(ACTIVE_KEY) || ''
    if (raw) {
      const docs = JSON.parse(raw) as DocRecord[]
      if (Array.isArray(docs) && docs.length) {
        // Tolerate records written before savedAt existed.
        const normalised = docs.map((d) => ({ ...d, savedAt: d.savedAt ?? null }))
        return { docs: normalised, activeId: normalised.some((d) => d.id === activeId) ? activeId : normalised[0].id }
      }
    }
  } catch {
    // fallthrough
  }
  const first: DocRecord = {
    id: uid(),
    name: '<SAMPLE_COMPANY>生态稿 · 示例',
    content: SAMPLE_DOC,
    updatedAt: Date.now(),
    savedAt: null,
  }
  return { docs: [first], activeId: first.id }
}

export function saveDocs(docs: DocRecord[], activeId: string) {
  try {
    localStorage.setItem(DOCS_KEY, JSON.stringify(docs))
    localStorage.setItem(ACTIVE_KEY, activeId)
  } catch {
    // 存储失败不阻塞编辑
  }
}

/** 当前选中的稿件 id。服务器接管后它只用来记住「上次看的是哪篇」。 */
export function loadActiveId(): string {
  try {
    return localStorage.getItem(ACTIVE_KEY) || ''
  } catch {
    return ''
  }
}

export function saveActiveId(id: string) {
  try {
    localStorage.setItem(ACTIVE_KEY, id)
  } catch {
    // 忽略
  }
}

export function loadSettings(): AppSettings {
  const def: AppSettings = { themeId: 'golden', sig: { layout: 'Yoru', proof: 'Yoru', review: 'Yoru' } }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return { ...def, ...(JSON.parse(raw) as AppSettings) }
  } catch {
    // fallthrough
  }
  return def
}

export function saveSettings(s: AppSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    // 忽略
  }
}

export function createDoc(): DocRecord {
  return {
    id: uid(),
    name: '未命名稿件',
    content: '---\ntitles:\n  - \n---\n\n',
    updatedAt: Date.now(),
    savedAt: null,
  }
}
