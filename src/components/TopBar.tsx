import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { THEMES } from '@/lib/themes'
import type { DocRecord } from '@/lib/store'

interface Props {
  docs: DocRecord[]
  activeId: string
  docName: string
  onRename: (name: string) => void
  onSelectDoc: (id: string) => void
  onCreateDoc: () => void
  onDeleteDoc: (id: string) => void
  syncState: 'loading' | 'synced' | 'saving' | 'local' | 'error'
  /** Put the open article into 草稿箱. Nothing else does that. */
  onSaveDraft: () => void
  saving: boolean
  /** Edited since the last explicit save, or never saved at all. */
  unsaved: boolean
  onOpenDrafts: () => void
  onOpenMaterials: () => void
  themeId: string
  onTheme: (id: string) => void
  miniPreview: (themeId: string) => string
  copying: boolean
  onCopy: () => void
  onExport: (kind: 'clean' | 'page') => void
  panelOpen: boolean
  onTogglePanel: () => void
  userName: string
  onLogin: () => void
  onLogout: () => void
}

const THEME_DOT: Record<string, string> = {
  golden: '#4F6CE8',
  minimal: '#0E1525',
  steady: '#1EA8A0',
}

const SYNC_LABEL: Record<Props['syncState'], { text: string; color: string; title: string }> = {
  loading: { text: '读取中', color: 'var(--ink-3)', title: '正在从云端读取稿件' },
  saving: { text: '保存中', color: 'var(--primary-500)', title: '正在写入草稿箱' },
  synced: { text: '已保存', color: 'var(--success-500)', title: '这篇已经在草稿箱里了' },
  local: { text: '仅本机', color: 'var(--warning-700)', title: '未登录：内容只存在这个浏览器里' },
  error: { text: '未保存', color: 'var(--error-500)', title: '写入草稿箱失败，本地内容仍保留' },
}

export default function TopBar(p: Props) {
  const [themeOpen, setThemeOpen] = useState(false)
  const activeTheme = THEMES.find((t) => t.id === p.themeId) || THEMES[0]

  return (
    <header className="ya-glass flex h-14 shrink-0 items-center gap-3 px-4">
      {/* 左：标识 + 稿件 */}
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex items-baseline gap-2">
          {/* 灯与夜：brand mark，暖圆切于冷圆 */}
          <span className="relative inline-flex h-4 w-5 self-center" aria-hidden>
            <span className="absolute bottom-0 left-0 h-4 w-4 rounded-full bg-[#4F6CE8]/85" />
            <span className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full bg-[#F06A20]" />
          </span>
          <span className="text-[15px] font-bold tracking-wide text-[#0E1525]">墨排</span>
          <span className="ya-eyebrow hidden lg:inline">wechat md studio</span>
        </div>
        <span className="h-4 w-px bg-black/10" />
        <div className="flex items-center rounded-lg transition-colors hover:bg-black/4">
          <input
            value={p.docName}
            onChange={(e) => p.onRename(e.target.value)}
            placeholder="未命名稿件"
            className="w-44 bg-transparent px-1.5 py-1 text-[13px] text-[#0E1525] outline-none placeholder:text-[#A1ABBF]"
            title="稿件名称"
          />
          <DropdownMenu>
            <DropdownMenuTrigger className="rounded-r-lg px-1.5 py-1 outline-none" title="切换稿件">
              <svg width="10" height="6" viewBox="0 0 10 6" fill="none" className="text-[#6B7793]">
                <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="ya-pop w-64 border-none">
              {p.docs.map((d) => (
                <DropdownMenuItem key={d.id} onSelect={() => p.onSelectDoc(d.id)} className="flex items-center justify-between gap-2 rounded-lg">
                  <span className="truncate">{d.name || '未命名稿件'}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-1">
                    {d.id === p.activeId && <span className="ya-dot" style={{ background: 'var(--primary-500)' }} />}
                    {p.docs.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          // No confirm here: the delete is reversible via the undo toast.
                          p.onDeleteDoc(d.id)
                        }}
                        className="ya-link-btn danger"
                        title="删除这篇稿件"
                      >
                        删除
                      </button>
                    )}
                  </span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={p.onCreateDoc} className="rounded-lg">新建稿件</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <span
          className="shrink-0 text-[11px] tabular-nums"
          style={{ color: SYNC_LABEL[p.syncState].color, fontFamily: 'var(--font-mono)' }}
          title={SYNC_LABEL[p.syncState].title}
        >
          {SYNC_LABEL[p.syncState].text}
        </span>
      </div>

      <div className="flex-1" />

      {/* 中：主题切换（实时缩略预览） */}
      <Popover open={themeOpen} onOpenChange={setThemeOpen}>
        <PopoverTrigger asChild>
          <button className="ya-btn-secondary ya-btn">
            <span className="h-2 w-2 rounded-full" style={{ background: THEME_DOT[activeTheme.id] || '#4F6CE8' }} />
            {activeTheme.name}
            <svg width="10" height="6" viewBox="0 0 10 6" fill="none" className="text-[#6B7793]">
              <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </PopoverTrigger>
        <PopoverContent align="center" className="ya-pop w-[560px] border-none p-3">
          <p className="ya-eyebrow mb-2 px-1">排版主题 · 当前稿件实时预览</p>
          <div className="grid grid-cols-3 gap-2">
            {THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  p.onTheme(t.id)
                  setThemeOpen(false)
                }}
                className={`group rounded-2xl p-2 text-left transition-all ${
                  t.id === p.themeId ? 'ya-selected bg-[#EFF2F8]' : 'hover:bg-[#F1F4FB]'
                }`}
              >
                <div className="relative h-32 overflow-hidden rounded-xl bg-white" style={{ boxShadow: 'var(--shadow-inset)' }}>
                  <div
                    className="pointer-events-none absolute left-0 top-0 origin-top-left"
                    style={{ width: 677, transform: 'scale(0.32)' }}
                    dangerouslySetInnerHTML={{ __html: p.miniPreview(t.id) }}
                  />
                </div>
                <div className="mt-2 flex items-center gap-1.5 px-0.5">
                  <span className="ya-dot" style={{ background: t.ui.accent }} />
                  <span className="text-[12px] font-medium text-[#0E1525]">{t.name}</span>
                </div>
                <p className="px-0.5 text-[11px] text-[#6B7793]">{t.desc}</p>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* 右：动作区 */}
      <div className="flex items-center gap-2">
        <button
          onClick={p.onOpenDrafts}
          className="ya-btn-secondary ya-btn"
          title="看保存过的所有文章"
        >
          草稿箱
        </button>

        <button
          onClick={p.onOpenMaterials}
          className="ya-btn-secondary ya-btn"
          title="查看图片用量、清理没在用的旧图"
        >
          素材库
        </button>

        <button
          onClick={p.onSaveDraft}
          disabled={p.saving}
          title={p.unsaved ? '这篇有改动还没进草稿箱' : '已经在草稿箱里了，再存一次会更新内容'}
          className={`ya-btn ${p.unsaved ? 'ya-btn-primary' : 'ya-btn-secondary'}`}
        >
          {/* warning 小黄点是唯一的未保存指示 */}
          {p.unsaved && <span className="ya-unsaved-dot" />}
          {p.saving ? '保存中…' : p.unsaved ? '保存到草稿箱' : '已保存'}
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ya-btn-secondary ya-btn">
              导出
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="ya-pop w-52 border-none">
            <DropdownMenuItem onSelect={() => p.onExport('clean')} className="rounded-lg">
              干净正文 HTML
              <span className="ml-auto text-[11px] text-[#6B7793]">仅 section</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => p.onExport('page')} className="rounded-lg">
              预览页 HTML
              <span className="ml-auto text-[11px] text-[#6B7793]">带复制按钮</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          onClick={p.onCopy}
          className="ya-btn ya-btn-primary px-4"
        >
          {p.copying ? (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <path d="M4 12.5l5 5L20 6.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              已复制
            </>
          ) : (
            '复制到公众号'
          )}
        </button>

        <button
          onClick={p.onTogglePanel}
          title={p.panelOpen ? '收起侧栏' : '展开侧栏'}
          className={`ya-btn ya-btn-sm !h-9 !w-9 !p-0 ${p.panelOpen ? 'ya-btn-ghost text-[#0E1525]' : 'ya-btn-secondary'}`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
            <path d="M15 4v16" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>

        <span className="h-4 w-px bg-black/10" />
        {p.userName ? (
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-[#0E1525] outline-none transition-colors hover:bg-black/4">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#4F6CE8]/12 text-[10px] font-medium text-[#4F6CE8]">
                {p.userName.slice(0, 1)}
              </span>
              <span className="max-w-[80px] truncate">{p.userName}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="ya-pop border-none">
              <DropdownMenuItem onSelect={p.onLogout} className="rounded-lg">退出登录</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <button
            onClick={p.onLogin}
            className="ya-link-btn !px-2.5 !py-1.5 !text-[12px]"
            title="登录后可上传图片；编辑、复制、导出无需登录"
          >
            登录
          </button>
        )}
      </div>
    </header>
  )
}
