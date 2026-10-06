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
  golden: '#1677FF',
  minimal: '#111111',
  steady: '#1F4E8C',
}

const SYNC_LABEL: Record<Props['syncState'], { text: string; className: string; title: string }> = {
  loading: { text: '读取中', className: 'text-[#9A9A9A]', title: '正在从云端读取稿件' },
  saving: { text: '保存中', className: 'text-[#1677FF]', title: '正在写入云端' },
  synced: { text: '已同步', className: 'text-emerald-600', title: '稿件已保存到账号，换设备也能打开' },
  local: { text: '仅本机', className: 'text-amber-600', title: '未登录：稿件只存在这个浏览器里' },
  error: { text: '未同步', className: 'text-[#D93F3F]', title: '云端写入失败，本地改动仍保留' },
}

export default function TopBar(p: Props) {
  const [themeOpen, setThemeOpen] = useState(false)
  const activeTheme = THEMES.find((t) => t.id === p.themeId) || THEMES[0]

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-black/8 bg-white/85 px-4 backdrop-blur-md">
      {/* 左：标识 + 稿件 */}
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[15px] font-bold tracking-wide text-[#111]">墨排</span>
          <span className="hidden text-[10px] uppercase tracking-[0.18em] text-[#9A9A9A] lg:inline">WeChat MD Studio</span>
        </div>
        <span className="h-4 w-px bg-black/10" />
        <div className="flex items-center rounded-md transition-colors hover:bg-black/4">
          <input
            value={p.docName}
            onChange={(e) => p.onRename(e.target.value)}
            placeholder="未命名稿件"
            className="w-44 bg-transparent px-1.5 py-1 text-[13px] text-[#333] outline-none placeholder:text-black/25"
            title="稿件名称"
          />
          <DropdownMenu>
            <DropdownMenuTrigger className="rounded-r-md px-1.5 py-1 outline-none" title="切换稿件">
              <svg width="10" height="6" viewBox="0 0 10 6" fill="none" className="text-[#9A9A9A]">
                <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              {p.docs.map((d) => (
                <DropdownMenuItem key={d.id} onSelect={() => p.onSelectDoc(d.id)} className="flex items-center justify-between gap-2">
                  <span className="truncate">{d.name || '未命名稿件'}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-1">
                    {d.id === p.activeId && <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#1677FF' }} />}
                    {p.docs.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          if (window.confirm(`删掉「${d.name || '未命名稿件'}」？这一步不能撤销。`)) p.onDeleteDoc(d.id)
                        }}
                        className="rounded px-1 text-[11px] text-[#9A9A9A] transition-colors hover:bg-black/5 hover:text-[#D93F3F]"
                        title="删除这篇稿件"
                      >
                        删除
                      </button>
                    )}
                  </span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={p.onCreateDoc}>新建稿件</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <span
          className={`shrink-0 text-[11px] tabular-nums ${SYNC_LABEL[p.syncState].className}`}
          title={SYNC_LABEL[p.syncState].title}
        >
          {SYNC_LABEL[p.syncState].text}
        </span>
      </div>

      <div className="flex-1" />

      {/* 中：主题切换（实时缩略预览） */}
      <Popover open={themeOpen} onOpenChange={setThemeOpen}>
        <PopoverTrigger asChild>
          <button className="flex items-center gap-2 rounded-lg border border-black/8 bg-white px-3 py-1.5 text-[13px] text-[#333] transition-colors hover:border-black/16">
            <span className="h-2 w-2 rounded-full" style={{ background: THEME_DOT[activeTheme.id] || '#1677FF' }} />
            {activeTheme.name}
            <svg width="10" height="6" viewBox="0 0 10 6" fill="none" className="text-[#9A9A9A]">
              <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </PopoverTrigger>
        <PopoverContent align="center" className="w-[560px] p-3">
          <p className="mb-2 px-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[#9A9A9A]">排版主题 · 当前稿件实时预览</p>
          <div className="grid grid-cols-3 gap-2">
            {THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  p.onTheme(t.id)
                  setThemeOpen(false)
                }}
                className={`group rounded-xl border p-2 text-left transition-all ${
                  t.id === p.themeId ? 'border-[#1677FF] ring-1 ring-[#1677FF]/30' : 'border-black/8 hover:border-black/20'
                }`}
              >
                <div className="relative h-32 overflow-hidden rounded-lg bg-white ring-1 ring-black/6">
                  <div
                    className="pointer-events-none absolute left-0 top-0 origin-top-left"
                    style={{ width: 677, transform: 'scale(0.32)' }}
                    dangerouslySetInnerHTML={{ __html: p.miniPreview(t.id) }}
                  />
                </div>
                <div className="mt-2 flex items-center gap-1.5 px-0.5">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.ui.accent }} />
                  <span className="text-[12px] font-medium text-[#111]">{t.name}</span>
                </div>
                <p className="px-0.5 text-[11px] text-[#9A9A9A]">{t.desc}</p>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* 右：动作区 */}
      <div className="flex items-center gap-2">
        <button
          onClick={p.onOpenMaterials}
          className="rounded-lg border border-black/8 bg-white px-3 py-1.5 text-[13px] text-[#333] transition-colors hover:border-black/16"
          title="查看图片用量、清理没在用的旧图"
        >
          素材库
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="rounded-lg border border-black/8 bg-white px-3 py-1.5 text-[13px] text-[#333] transition-colors hover:border-black/16">
              导出
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={() => p.onExport('clean')}>
              干净正文 HTML
              <span className="ml-auto text-[11px] text-[#9A9A9A]">仅 section</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => p.onExport('page')}>
              预览页 HTML
              <span className="ml-auto text-[11px] text-[#9A9A9A]">带复制按钮</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          onClick={p.onCopy}
          className={`flex items-center gap-2 rounded-lg px-4 py-1.5 text-[13px] font-medium text-white transition-all ${
            p.copying ? 'bg-[#1677FF]' : 'bg-[#111111] hover:bg-black'
          }`}
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
          className={`rounded-lg border p-1.5 transition-colors ${
            p.panelOpen ? 'border-black/16 bg-black/4 text-[#111]' : 'border-black/8 bg-white text-[#707070] hover:text-[#111]'
          }`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
            <path d="M15 4v16" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>

        <span className="h-4 w-px bg-black/10" />
        {p.userName ? (
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-[#333] outline-none transition-colors hover:bg-black/4">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#1677FF]/12 text-[10px] font-medium text-[#1677FF]">
                {p.userName.slice(0, 1)}
              </span>
              <span className="max-w-[80px] truncate">{p.userName}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={p.onLogout}>退出登录</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <button
            onClick={p.onLogin}
            className="rounded-lg px-2.5 py-1.5 text-[12px] text-[#707070] transition-colors hover:bg-black/4 hover:text-[#111]"
            title="登录后可上传图片；编辑、复制、导出无需登录"
          >
            登录
          </button>
        )}
      </div>
    </header>
  )
}
