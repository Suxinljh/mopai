import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Toaster, toast } from 'sonner'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import TopBar from '@/components/TopBar'
import EditorPane, { type EditorHandle } from '@/components/EditorPane'
import PreviewPane from '@/components/PreviewPane'
import SidePanel from '@/components/SidePanel'
import RatioPicker from '@/components/RatioPicker'
import { parseMarkdown } from '@/lib/parse'
import {
  renderDoc,
  collectMaterials,
  fillImageSrc,
  setCarouselRatio,
  type MaterialItem,
} from '@/lib/render'
import { getTheme } from '@/lib/themes'
import { cleanHtml, copyPlain, copyRichText, downloadFile, previewPage } from '@/lib/clipboard'
import { loadSettings, saveSettings, type DocRecord } from '@/lib/store'
import { useDocs } from '@/hooks/useDocs'
import { CHEATSHEET } from '@/lib/sample'
import { useAuth } from '@/hooks/useAuth'
import { trpc } from '@/providers/trpc'
import { blobToBase64, cropToRatio, filenameForMime } from '@/lib/image'
import type { CarouselRatio } from '@/lib/types'

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

/** One pending carousel upload: the files plus exactly which slot they fill. */
interface CarouselFrameTask {
  files: File[]
  item: MaterialItem
  /** Ratio already fixed by the carousel, if it has one. */
  locked?: CarouselRatio
}

export default function EditorPage() {
  const [settings, setSettings] = useState(loadSettings)
  const [panelOpen, setPanelOpen] = useState(true)
  const [previewWidth, setPreviewWidth] = useState<375 | 677>(375)
  const [copied, setCopied] = useState(false)
  const [uploadingKey, setUploadingKey] = useState<string | null>(null)
  const [frameTask, setFrameTask] = useState<CarouselFrameTask | null>(null)
  const editorRef = useRef<EditorHandle>(null)
  const navigate = useNavigate()
  const { user, isAuthenticated, logout } = useAuth()

  const {
    docs,
    setDocs,
    activeId,
    setActiveId,
    activeDoc,
    syncState,
    notice,
    clearNotice,
    addDoc,
    removeDoc,
  } = useDocs({ enabled: isAuthenticated })

  const uploadMutation = trpc.storage.upload.useMutation()

  useEffect(() => saveSettings(settings), [settings])

  useEffect(() => {
    if (!notice) return
    toast.info(notice, { duration: 6000 })
    clearNotice()
  }, [notice, clearNotice])

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

  /** Upload one file, optionally cropping to a carousel frame first. */
  const uploadOne = async (file: File, ratio?: CarouselRatio) => {
    const payload = ratio ? await cropToRatio(file, ratio) : null
    const contentBase64 = payload
      ? await blobToBase64(payload.blob)
      : await fileToBase64(file)
    const uploadName = payload
      ? filenameForMime(file.name, payload.mime)
      : file.name.replace(/[^\w.一-鿿-]+/g, '_')
    const res = await uploadMutation.mutateAsync({
      name: uploadName,
      contentBase64,
      contentType: payload ? payload.mime : file.type,
    })
    return `img:${res.key}`
  }

  /** Loose images: dropped into the editor at the cursor, each keeping its own ratio. */
  const uploadLoose = async (files: File[]) => {
    if (!isAuthenticated) {
      toast.error('上传图片需要先登录', {
        description: '编辑和复制不需要登录',
        action: { label: '去登录', onClick: () => navigate('/login') },
      })
      return
    }
    for (const file of files) {
      if (!/^image\//.test(file.type)) {
        toast.error(`${file.name} 不是图片，已跳过`)
        continue
      }
      setUploadingKey(`drop-${file.name}`)
      try {
        const ref = await uploadOne(file)
        const alt = file.name.replace(/\.[^.]+$/, '')
        editorRef.current?.insertText(`![${alt}](${ref})`)
        toast.success(files.length > 1 ? `${file.name} 已插入` : '图片已插入光标位置')
      } catch (e) {
        toast.error(`${file.name} 上传失败`, {
          description: e instanceof Error ? e.message : '请稍后重试',
        })
      } finally {
        setUploadingKey(null)
      }
    }
  }

  /** Carousel images: every one gets the same frame, so the slides line up. */
  const uploadToCarousel = async (files: File[], item: MaterialItem, ratio: CarouselRatio) => {
    if (!activeDoc || !item.carouselOrdinal) return
    let content = activeDoc.content
    if (item.ratio !== ratio) {
      content = setCarouselRatio(content, item.carouselOrdinal, ratio)
    }
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const target = i === 0 ? item : { ...item, alt: file.name.replace(/\.[^.]+$/, '') }
      setUploadingKey(`${target.no}-${target.alt}`)
      try {
        const ref = await uploadOne(file, ratio)
        content = fillImageSrc(content, target.alt, target.line, ref)
      } catch (e) {
        toast.error(`${file.name} 上传失败`, {
          description: e instanceof Error ? e.message : '请稍后重试',
        })
      } finally {
        setUploadingKey(null)
      }
    }
    updateActive({ content })
    if (files.length > 1) {
      toast.success(`${files.length} 张已按 ${ratio} 裁切上传`, {
        description: '这个轮播里剩下的占位请逐张点上传，会自动沿用同一比例',
      })
    } else {
      toast.success(`${item.no} 已按 ${ratio} 裁切上传并回填`)
    }
  }

  /** Entry point from the sidebar: decide whether a ratio has to be chosen first. */
  const startUpload = (files: File[], item: MaterialItem) => {
    if (!isAuthenticated) {
      toast.error('上传图片需要先登录', {
        description: '编辑和复制不需要登录',
        action: { label: '去登录', onClick: () => navigate('/login') },
      })
      return
    }
    const bad = files.find((f) => !/^image\//.test(f.type))
    if (bad) {
      toast.error(`${bad.name} 不是图片`)
      return
    }
    if (item.kind !== '轮播') {
      void uploadLoose(files)
      return
    }
    // 轮播里只要已经有一张图，比例就定死了；否则先让用户选。
    const carouselHasImage = materials.some((m) => m.carouselOrdinal === item.carouselOrdinal && m.hasSrc)
    if (carouselHasImage && item.ratio) {
      void uploadToCarousel(files, item, item.ratio)
      return
    }
    setFrameTask({ files, item, locked: carouselHasImage ? item.ratio : undefined })
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#F7F7F9] text-[#111]">
      <TopBar
        docs={docs}
        activeId={activeId}
        docName={activeDoc?.name || ''}
        onRename={(name) => updateActive({ name })}
        onSelectDoc={setActiveId}
        onCreateDoc={() => addDoc()}
        onDeleteDoc={(id) => void removeDoc(id)}
        syncState={syncState}
        onOpenMaterials={() => navigate('/materials')}
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
            const files = Array.from(e.dataTransfer.files || [])
            if (files.length) void uploadLoose(files)
          }}
        >
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-white/6 px-4">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#5C6370]">
              Markdown · 语义源稿
              <span className="ml-2 normal-case tracking-normal text-[#3D434F]">可拖拽图片上传 · Ctrl/⌘+Space 语法补全</span>
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
            onUpload={(files, item) => startUpload(files, item)}
            uploadingKey={uploadingKey}
          />
        )}
      </div>

      <RatioPicker
        open={frameTask !== null}
        label={frameTask?.item.no ?? ''}
        alt={frameTask?.item.alt ?? ''}
        current={frameTask?.locked}
        busy={uploadingKey !== null}
        onCancel={() => setFrameTask(null)}
        onConfirm={(ratio) => {
          const task = frameTask
          setFrameTask(null)
          if (task) void uploadToCarousel(task.files, task.item, ratio)
        }}
      />

      <Toaster position="bottom-center" toastOptions={{ style: { borderRadius: 10 } }} />
    </div>
  )
}
