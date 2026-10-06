import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Toaster, toast } from 'sonner'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import TopBar from '@/components/TopBar'
import EditorPane, { type EditorHandle } from '@/components/EditorPane'
import PreviewPane from '@/components/PreviewPane'
import SidePanel from '@/components/SidePanel'
import RatioPicker from '@/components/RatioPicker'
import ManualCropper from '@/components/ManualCropper'
import { parseMarkdown } from '@/lib/parse'
import {
  renderDoc,
  collectMaterials,
  fillImageSrc,
  clearImageSrc,
  removeImageLine,
  setCarouselRatio,
  canLocateImage,
  type MaterialItem,
} from '@/lib/render'
import { getTheme } from '@/lib/themes'
import { cleanHtml, copyPlain, copyRichText, downloadFile, previewPage } from '@/lib/clipboard'
import { loadSettings, saveSettings, type DocRecord } from '@/lib/store'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import { useDocs, UNDO_DELETE_MS } from '@/hooks/useDocs'
import { CHEATSHEET } from '@/lib/sample'
import { useAuth } from '@/hooks/useAuth'
import { trpc } from '@/providers/trpc'
import { blobToBase64, cropToRatio, fileFromImageUrl, filenameForMime } from '@/lib/image'
import { DEFAULT_CAROUSEL_RATIO, type CarouselRatio } from '@/lib/types'

function plainTextOf(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent || ''
}

// 三栏各自的拖拽宽度，跨刷新记住。布局以 panel id 为键；侧栏折叠时它的记录
// 留着，下次打开先按 defaultSize 恢复。
const LAYOUT_KEY = 'mopai.layout.v1'
function loadLayout(): Record<string, number> | undefined {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY)
    return raw ? (JSON.parse(raw) as Record<string, number>) : undefined
  } catch {
    return undefined
  }
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

/** One pending upload: the files, where they go, and whether a ratio is required. */
interface FrameTask {
  files: File[]
  mode: 'carousel' | 'loose'
  /** Which sidebar slot was clicked; absent for a plain drag-and-drop. */
  item?: MaterialItem
  /** Ratio already fixed by the carousel, if it has one. */
  locked?: CarouselRatio
  /** Ratio chosen in the picker, carried over to the manual cropper. */
  ratio?: CarouselRatio | null
  /**
   * Set when re-cropping an existing image. The stored object keeps its old key
   * after the new one is uploaded, so this is what lets us tell the owner that
   * the previous copy is now unreferenced.
   */
  replacedKey?: string
}

export default function EditorPage() {
  const [settings, setSettings] = useState(loadSettings)
  const [panelOpen, setPanelOpen] = useState(true)
  // Read once at mount: the group is uncontrolled, later drags come back
  // through onLayoutChange.
  const [initialLayout] = useState(loadLayout)
  const layoutRef = useRef<Record<string, number>>(initialLayout ?? {})
  const [previewWidth, setPreviewWidth] = useState<375 | 677>(375)
  const [copied, setCopied] = useState(false)
  const [uploadingKey, setUploadingKey] = useState<string | null>(null)
  const [frameTask, setFrameTask] = useState<FrameTask | null>(null)
  const [manualOpen, setManualOpen] = useState(false)
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
    hasUnsavedChanges,
    neverSaved,
    addDoc,
    removeDoc,
    undoRemove,
    saveCurrentToDrafts,
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

  /** Upload one file, optionally auto-cropping to a carousel frame first. */
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

  /** Upload an already-cropped blob produced by the manual cropper. */
  const uploadBlob = async (blob: Blob, mime: string, originalName: string) => {
    const contentBase64 = await blobToBase64(blob)
    const res = await uploadMutation.mutateAsync({
      name: filenameForMime(originalName, mime),
      contentBase64,
      contentType: mime,
    })
    return `img:${res.key}`
  }

  /**
   * Tell the owner their previous upload is now unreferenced.
   *
   * Uploading always mints a fresh key, so a re-crop leaves the old object in R2
   * with nothing pointing at it. We deliberately do not delete it here: another
   * device may hold a local (unsynced) draft that still references it, and the
   * server cannot see those. The materials page can, so point there.
   */
  const announceReplacedImage = () => {
    toast.info('旧的那张图已经不再引用', {
      description: '它还在素材库里，可以去「素材库 → 没在用的旧图」清理',
      duration: 8000,
      action: { label: '去清理', onClick: () => navigate('/materials') },
    })
  }

  /**
   * Put a re-cropped image back into the slot it came from. Distinct from the
   * insert path: the line already exists, so it must be overwritten rather than
   * added alongside.
   */
  const replaceRecropped = (ref: string, task: FrameTask) => {
    if (!task.item || !activeDoc) return
    const next = fillImageSrc(activeDoc.content, task.item.alt, task.item.occurrence, ref)
    if (next === activeDoc.content) {
      toast.error(`${task.item.no} 定位失败`, { description: '正文里找不到这张图，新图没有回填' })
      return
    }
    updateActive({ content: next })
    toast.success(`${task.item.no} 已按新裁切替换`)
    announceReplacedImage()
  }

  /** Loose images: dropped into the editor at the cursor. Cropping is optional. */
  const uploadLoose = async (files: File[], ratio?: CarouselRatio | null, task?: FrameTask | null) => {
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
        const ref = await uploadOne(file, ratio ?? undefined)
        if (task?.item && task.replacedKey) {
          // Re-crop of a standalone image via the ratio picker: replace in place.
          replaceRecropped(ref, task)
          continue
        }
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

  /** Clear one carousel slide back to a placeholder, keeping the slide line. */
  const clearImage = (item: MaterialItem) => {
    if (!activeDoc) return
    const next = clearImageSrc(activeDoc.content, item.alt, item.occurrence)
    if (next === activeDoc.content) {
      toast.error(`${item.no} 定位失败`, { description: '正文里找不到这张图，请手动修改' })
      return
    }
    updateActive({ content: next })
    toast.success(`${item.no} 已清空，占位保留`)
  }

  /** Remove a standalone image line entirely. */
  const removeImage = (item: MaterialItem) => {
    if (!activeDoc) return
    const next = removeImageLine(activeDoc.content, item.alt, item.occurrence)
    if (next === activeDoc.content) {
      toast.error(`${item.no} 定位失败`, { description: '正文里找不到这张图，请手动修改' })
      return
    }
    updateActive({ content: next })
    toast.success(`${item.no} 已从正文移除`)
  }

  /**
   * Change the frame of a whole carousel. Existing images keep their old frame,
   * so they are flagged for re-upload rather than pretending they still fit.
   */
  const changeCarouselRatio = (ordinal: number, ratio: CarouselRatio) => {
    if (!activeDoc) return
    updateActive({ content: setCarouselRatio(activeDoc.content, ordinal, ratio) })
    const stale = materials.filter((m) => m.carouselOrdinal === ordinal && m.hasSrc && m.ratio !== ratio)
    if (stale.length) {
      toast.info(`轮播 ${ordinal} 已改成 ${ratio}`, {
        description: `已有 ${stale.length} 张图还是旧比例，点每张的「重裁」或「替换」重做一次`,
      })
    } else {
      toast.success(`轮播 ${ordinal} 已改成 ${ratio}`)
    }
  }

  /**
   * Re-crop an image that is already uploaded. The stored image is fetched back
   * and re-uploaded under a new key, so the old one can be cleaned up later.
   */
  const recropImage = async (item: MaterialItem) => {
    if (!activeDoc) return
    const key = item.src.startsWith('img:') ? item.src.slice(4) : ''
    if (!key) {
      toast.error('这张图不是本工具上传的，无法重裁')
      return
    }
    setUploadingKey(`${item.no}-${item.alt}`)
    try {
      const file = await fileFromImageUrl(`${window.location.origin}/api/img/${key}`, item.alt || 'image')
      // Hand it to the same manual cropper, which keeps the carousel ratio.
      // Remember the old key so the owner can be told the previous copy is now
      // unused; uploading always mints a new key, so the old object stays behind.
      setFrameTask({
        files: [file],
        item,
        mode: item.kind === '轮播' ? 'carousel' : 'loose',
        replacedKey: key,
      })
      setManualOpen(true)
    } catch (e) {
      toast.error('取回原图失败', { description: e instanceof Error ? e.message : '请稍后重试' })
    } finally {
      setUploadingKey(null)
    }
  }

  /** Result of the manual cropper: a blob instead of the original file. */
  const uploadCroppedBlob = async (blob: Blob, mime: string, task: FrameTask) => {
    const file = task.files[0]
    if (!file) return
    const label = task.item?.no ?? file.name
    const isRecrop = Boolean(task.item && task.replacedKey)
    setUploadingKey(task.item ? `${task.item.no}-${task.item.alt}` : `drop-${file.name}`)
    try {
      const ref = await uploadBlob(blob, mime, file.name)
      if (task.mode === 'carousel' && task.item && activeDoc) {
        let content = activeDoc.content
        if (task.item.ratio !== task.ratio && task.ratio) {
          content = setCarouselRatio(content, task.item.carouselOrdinal!, task.ratio)
        }
        updateActive({ content: fillImageSrc(content, task.item.alt, task.item.occurrence, ref) })
        toast.success(`${label} 已按手动裁切上传并回填`)
        if (isRecrop) announceReplacedImage()
      } else if (isRecrop) {
        replaceRecropped(ref, task)
      } else {
        const alt = file.name.replace(/\.[^.]+$/, '')
        editorRef.current?.insertText(`![${alt}](${ref})`)
        toast.success('已按手动裁切插入')
      }
    } catch (e) {
      toast.error('上传失败', { description: e instanceof Error ? e.message : '请稍后重试' })
    } finally {
      setUploadingKey(null)
    }
  }

  /** Carousel images: every one gets the same frame, so the slides line up. */
  const uploadToCarousel = async (files: File[], item: MaterialItem, ratio: CarouselRatio) => {
    if (!activeDoc || !item.carouselOrdinal) return
    let content = activeDoc.content
    if (item.ratio !== ratio) {
      content = setCarouselRatio(content, item.carouselOrdinal, ratio)
    }
    let okCount = 0
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      // A carousel's slides are consecutive `![` slots in the source. Fill from
      // the clicked slot onward by index, so a multi-file drop lands in order.
      // (The old code substituted the file name as the caption, which never
      // matched the placeholder text and made every file after the first fail
      // silently.)
      const occurrence = item.occurrence + i
      // Each slide is addressed by its own caption, not the clicked one:
      // slides may carry different placeholder text, and checking them all
      // against the clicked caption refused every file after the first.
      const slot = materials.find((m) => m.occurrence === occurrence)
      const staysInCarousel = slot?.kind === '轮播' && slot.carouselOrdinal === item.carouselOrdinal
      if (!slot || !staysInCarousel || !canLocateImage(content, slot.alt, occurrence)) {
        toast.warning(`${file.name} 没有对应的空位`, {
          description: '这个轮播里已经没有更多占位行，多出的图请手动插入',
        })
        continue
      }
      setUploadingKey(`${item.no}-${item.alt}`)
      try {
        const ref = await uploadOne(file, ratio)
        content = fillImageSrc(content, slot.alt, occurrence, ref)
        okCount++
      } catch (e) {
        toast.error(`${file.name} 上传失败`, {
          description: e instanceof Error ? e.message : '请稍后重试',
        })
      } finally {
        setUploadingKey(null)
      }
    }
    updateActive({ content })
    // Only claim success for slides that actually uploaded; every failure has
    // already raised its own error toast, so an all-failed batch stays quiet
    // instead of congratulating itself.
    if (files.length > 1) {
      if (okCount > 0) {
        toast.success(
          okCount === files.length
            ? `${okCount} 张已按 ${ratio} 裁切上传`
            : `${okCount}/${files.length} 张已按 ${ratio} 裁切上传`,
          { description: '这个轮播里剩下的占位请逐张点上传，会自动沿用同一比例' },
        )
      }
    } else if (okCount > 0) {
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
      // 单图不强制裁切，但给一个选项，省得想统一高度时还得重传
      setFrameTask({ files, item, mode: 'loose' })
      return
    }
    // Carousel slides always get the dialog. When the carousel ratio is already
    // fixed the picker locks it, so the choice left is how to frame the shot -
    // auto centre-crop or manual. Uploading straight through would silently skip
    // cropping and break the uniform frame.
    const carouselHasImage = materials.some((m) => m.carouselOrdinal === item.carouselOrdinal && m.hasSrc)
    setFrameTask({
      files,
      item,
      mode: 'carousel',
      locked: carouselHasImage ? item.ratio : undefined,
    })
  }

  return (
    <div className="ya-page flex h-screen flex-col overflow-hidden">
      <TopBar
        docs={docs}
        activeId={activeId}
        docName={activeDoc?.name || ''}
        onRename={(name) => updateActive({ name })}
        onSelectDoc={setActiveId}
        onCreateDoc={() => addDoc()}
        onDeleteDoc={(id) => {
          const name = docs.find((d) => d.id === id)?.name || '未命名稿件'
          removeDoc(id)
          toast(`已删除「${name}」`, {
            description: '10 秒内可以撤销',
            duration: UNDO_DELETE_MS,
            action: {
              label: '撤销',
              onClick: () => {
                if (undoRemove(id)) toast.success('已恢复')
              },
            },
          })
        }}
        syncState={syncState}
        onSaveDraft={() => {
          void saveCurrentToDrafts().then((res) => {
            if (res.ok) toast.success('已保存到草稿箱')
            else toast.error(res.message)
          })
        }}
        saving={syncState === 'saving'}
        unsaved={hasUnsavedChanges || neverSaved}
        onOpenDrafts={() => navigate('/drafts')}
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

      <ResizablePanelGroup
        orientation="horizontal"
        className="min-h-0 flex-1"
        defaultLayout={initialLayout}
        onLayoutChange={(layout) => {
          layoutRef.current = { ...layoutRef.current, ...layout }
          try {
            localStorage.setItem(LAYOUT_KEY, JSON.stringify(layoutRef.current))
          } catch {
            // 宽度记不住也不碍事
          }
        }}
      >
        {/* 左：Markdown 编辑（支持拖图上传） */}
        <ResizablePanel id="editor" defaultSize="55%" minSize="320px" className="min-w-0">
          <div
            data-theme="yoru"
            className="flex h-full min-w-0 flex-col bg-[#0B1020]"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const files = Array.from(e.dataTransfer.files || [])
              if (!files.length) return
              if (!isAuthenticated) {
                toast.error('上传图片需要先登录', {
                  description: '编辑和复制不需要登录',
                  action: { label: '去登录', onClick: () => navigate('/login') },
                })
                return
              }
              setFrameTask({ files, mode: 'loose' })
            }}
          >
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-white/6 px-4">
              <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#6B7691]">
                markdown · 语义源稿
                <span className="ml-2 normal-case tracking-normal text-[#434D67]">可拖拽图片上传 · ctrl/⌘+space 补全 · ⌘B 加粗 · ⌘K 链接</span>
              </span>
              <Popover>
                <PopoverTrigger asChild>
                  <button className="rounded-lg px-2 py-1 text-[11px] text-[#A8B2CC] transition-colors hover:bg-white/6 hover:text-white">
                    语法速查
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="ya-pop w-80 border-none p-0">
                  <p className="ya-eyebrow border-b border-black/8 px-3 py-2">
                    公众号专用语法
                  </p>
                  <ul className="max-h-80 overflow-y-auto p-2">
                    {CHEATSHEET.map((c) => (
                      <li key={c.syntax} className="flex items-baseline gap-3 rounded-lg px-2 py-1.5 hover:bg-black/3">
                        <code className="shrink-0 rounded-md bg-[#4F6CE8]/10 px-1.5 py-0.5 font-mono text-[11px] text-[#4F6CE8]">{c.syntax}</code>
                        <span className="text-[12px] text-[#394560]">{c.desc}</span>
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
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* 中：预览（375/677 是里面手机框的宽度，栏宽随便拖） */}
        <ResizablePanel id="preview" defaultSize="500px" minSize="380px" maxSize="820px" className="min-w-0 border-l border-black/8">
          <PreviewPane html={rendered.html} stats={rendered.stats} width={previewWidth} onWidthChange={setPreviewWidth} />
        </ResizablePanel>

        {/* 右：折叠侧栏 */}
        {panelOpen && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel id="sidebar" defaultSize="300px" minSize="240px" maxSize="520px" className="min-w-0">
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
                onClear={clearImage}
                onRemove={removeImage}
                onRecrop={(item) => void recropImage(item)}
                onCarouselRatio={changeCarouselRatio}
                uploadingKey={uploadingKey}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      <RatioPicker
        open={frameTask !== null && manualOpen === false}
        label={frameTask?.item?.no ?? ''}
        alt={frameTask?.item?.alt || frameTask?.files[0]?.name || ''}
        current={frameTask?.locked}
        mode={frameTask?.mode ?? 'loose'}
        busy={uploadingKey !== null}
        onCancel={() => setFrameTask(null)}
        onManual={() => {
          if (!frameTask) return
          const lockedOrCurrent = frameTask.locked ?? null
          setFrameTask({ ...frameTask, ratio: lockedOrCurrent })
          setManualOpen(true)
        }}
        onConfirm={(ratio) => {
          const task = frameTask
          setFrameTask(null)
          if (!task) return
          if (task.mode === 'carousel' && task.item && ratio) {
            void uploadToCarousel(task.files, task.item, ratio)
          } else {
            // Pass the task so a re-crop replaces the image instead of inserting
            // a second copy at the cursor.
            void uploadLoose(task.files, ratio, task)
          }
        }}
      />

      <ManualCropper
        open={manualOpen && frameTask !== null}
        file={frameTask?.files[0] ?? null}
        label={frameTask?.item?.no ?? ''}
        alt={frameTask?.item?.alt || frameTask?.files[0]?.name || ''}
        ratio={
          // Carousel slides must keep one frame: a locked carousel keeps its
          // ratio, a fresh one starts at the default. Standalone images are free.
          frameTask?.mode === 'carousel'
            ? frameTask?.locked ?? frameTask?.ratio ?? DEFAULT_CAROUSEL_RATIO
            : null
        }
        busy={uploadingKey !== null}
        onCancel={() => {
          setManualOpen(false)
          setFrameTask(null)
        }}
        onConfirm={(blob, mime) => {
          const task = frameTask
          setManualOpen(false)
          setFrameTask(null)
          if (task) void uploadCroppedBlob(blob, mime, task)
        }}
      />

      <Toaster position="bottom-center" toastOptions={{ style: { borderRadius: 10 } }} />
    </div>
  )
}
