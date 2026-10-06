import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Toaster, toast } from 'sonner'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import TopBar from '@/components/TopBar'
import EditorPane, { type EditorHandle } from '@/components/EditorPane'
import PreviewPane from '@/components/PreviewPane'
import SidePanel from '@/components/SidePanel'
import { parseMarkdown } from '@/lib/parse'
import { renderDoc, collectMaterials, fillImageSrc, type MaterialItem } from '@/lib/render'
import { getTheme } from '@/lib/themes'
import { cleanHtml, copyPlain, copyRichText, downloadFile, previewPage } from '@/lib/clipboard'
import { createDoc, loadDocs, loadSettings, saveDocs, saveSettings, type DocRecord } from '@/lib/store'
import { CHEATSHEET } from '@/lib/sample'
import { useAuth } from '@/hooks/useAuth'
import { trpc } from '@/providers/trpc'

function plainTextOf(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent || ''
}

// img:key → 本站稳定图片地址（复制进公众号后由微信转存）
function resolveImg(src: string): string {
  if (src.startsWith('img:')) return `${window.location.origin}/api/img/${src.slice(4)}`
  return src
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

export default function EditorPage() {
  const [docs, setDocs] = useState<DocRecord[]>([])
  const [activeId, setActiveId] = useState('')
  const [settings, setSettings] = useState(loadSettings)
  const [panelOpen, setPanelOpen] = useState(true)
  const [previewWidth, setPreviewWidth] = useState<375 | 677>(375)
  const [copied, setCopied] = useState(false)
  const [uploadingKey, setUploadingKey] = useState<string | null>(null)
  const editorRef = useRef<EditorHandle>(null)
  const navigate = useNavigate()
  const { user, isAuthenticated, logout } = useAuth()
  const uploadMutation = trpc.storage.upload.useMutation()

  useEffect(() => {
    const { docs: d, activeId: a } = loadDocs()
    setDocs(d)
    setActiveId(a)
  }, [])

  useEffect(() => {
    if (docs.length) saveDocs(docs, activeId)
  }, [docs, activeId])

  useEffect(() => saveSettings(settings), [settings])

  const activeDoc = docs.find((d) => d.id === activeId) || null
  const theme = getTheme(settings.themeId)

  const parsed = useMemo(() => parseMarkdown(activeDoc?.content || ''), [activeDoc?.content])
  const rendered = useMemo(
    () => renderDoc(parsed, theme, settings.sig, resolveImg),
    [parsed, theme, settings.sig],
  )
  const materials = useMemo(() => collectMaterials(parsed), [parsed])

  const updateActive = (patch: Partial<DocRecord>) => {
    setDocs((ds) => ds.map((d) => (d.id === activeId ? { ...d, ...patch, updatedAt: Date.now() } : d)))
  }

  const handleCopy = async () => {
    const ok = await copyRichText(cleanHtml(rendered.html), plainTextOf(rendered.html))
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast.success(`已复制 ${rendered.stats.chars} 字 · ${rendered.stats.images} 图`, {
        description: '直接粘贴进公众号后台正文即可',
      })
    } else {
      toast.error('复制失败', { description: '浏览器拒绝了剪贴板权限，请改用「导出」' })
    }
  }

  const handleExport = (kind: 'clean' | 'page') => {
    const name = (activeDoc?.name || '推文').replace(/[\\/:*?"<>|]/g, '')
    if (kind === 'clean') downloadFile(`${name}_正文.html`, cleanHtml(rendered.html))
    else downloadFile(`${name}_预览页.html`, previewPage(rendered.html, name))
    toast.success(kind === 'clean' ? '已导出干净正文 HTML' : '已导出预览页 HTML')
  }

  // 上传一张图；target 为空表示拖拽新增，否则回填到对应占位
  const uploadImage = async (file: File, target?: MaterialItem) => {
    if (!isAuthenticated) {
      toast.error('上传图片需要先登录', {
        description: '编辑和复制不需要登录',
        action: { label: '去登录', onClick: () => navigate('/login') },
      })
      return
    }
    if (!/^image\//.test(file.type)) {
      toast.error('只支持图片文件')
      return
    }
    const key = target ? `${target.no}-${target.alt}` : `drop-${file.name}`
    setUploadingKey(key)
    try {
      const contentBase64 = await fileToBase64(file)
      const res = await uploadMutation.mutateAsync({
        name: file.name.replace(/[^\w.一-鿿-]+/g, '_'),
        contentBase64,
        contentType: file.type,
      })
      const ref = `img:${res.key}`
      if (target && activeDoc) {
        updateActive({ content: fillImageSrc(activeDoc.content, target.alt, target.line, ref) })
      } else {
        const alt = file.name.replace(/\.[^.]+$/, '')
        editorRef.current?.insertText(`![${alt}](${ref})`)
      }
      toast.success(target ? `${target.no} 已上传并回填` : '图片已插入光标位置')
    } catch (e) {
      toast.error('上传失败', { description: e instanceof Error ? e.message : '请稍后重试' })
    } finally {
      setUploadingKey(null)
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#F7F7F9] text-[#111]">
      <TopBar
        docs={docs}
        activeId={activeId}
        docName={activeDoc?.name || ''}
        onRename={(name) => updateActive({ name })}
        onSelectDoc={setActiveId}
        onCreateDoc={() => {
          const d = createDoc()
          setDocs((ds) => [d, ...ds])
          setActiveId(d.id)
        }}
        themeId={settings.themeId}
        onTheme={(id) => setSettings((s) => ({ ...s, themeId: id }))}
        miniPreview={(id) => renderDoc(parsed, getTheme(id), settings.sig, resolveImg).html}
        copying={copied}
        onCopy={handleCopy}
        onExport={handleExport}
        panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen((v) => !v)}
        userName={user?.name || ''}
        onLogin={() => navigate('/login')}
        onLogout={logout}
      />

      <div className="flex min-h-0 flex-1">
        {/* 左：Markdown 编辑（支持拖图上传） */}
        <div
          className="flex min-w-0 flex-1 flex-col bg-[#14161B]"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const file = e.dataTransfer.files?.[0]
            if (file) uploadImage(file)
          }}
        >
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-white/6 px-4">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#5C6370]">
              Markdown · 语义源稿<span className="ml-2 normal-case tracking-normal text-[#3D434F]">可拖拽图片上传</span>
            </span>
            <Popover>
              <PopoverTrigger asChild>
                <button className="rounded-md px-2 py-1 text-[11px] text-[#8A919E] transition-colors hover:bg-white/6 hover:text-white">
                  语法速查
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-0">
                <p className="border-b border-black/8 px-3 py-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[#9A9A9A]">
                  公众号专用语法
                </p>
                <ul className="max-h-80 overflow-y-auto p-2">
                  {CHEATSHEET.map((c) => (
                    <li key={c.syntax} className="flex items-baseline gap-3 rounded-md px-2 py-1.5 hover:bg-black/3">
                      <code className="shrink-0 rounded bg-[#1677FF]/8 px-1.5 py-0.5 font-mono text-[11px] text-[#1677FF]">{c.syntax}</code>
                      <span className="text-[12px] text-[#555]">{c.desc}</span>
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          </div>
          <div className="min-h-0 flex-1">
            <EditorPane ref={editorRef} value={activeDoc?.content || ''} onChange={(content) => updateActive({ content })} />
          </div>
        </div>

        {/* 右：预览 */}
        <div className="w-[460px] shrink-0 border-l border-black/8 xl:w-[500px]">
          <PreviewPane html={rendered.html} stats={rendered.stats} width={previewWidth} onWidthChange={setPreviewWidth} />
        </div>

        {/* 折叠侧栏 */}
        {panelOpen && (
          <SidePanel
            materials={materials}
            titles={parsed.meta.titles}
            cover={parsed.meta.cover}
            sig={settings.sig}
            onSig={(sig) => setSettings((s) => ({ ...s, sig }))}
            onJump={(line) => editorRef.current?.jumpToLine(line)}
            onCopyTitle={(t) => {
              copyPlain(t)
              toast.success('标题已复制')
            }}
            onUpload={(file, item) => uploadImage(file, item)}
            uploadingKey={uploadingKey}
          />
        )}
      </div>

      <Toaster position="bottom-center" toastOptions={{ style: { borderRadius: 10 } }} />
    </div>
  )
}
