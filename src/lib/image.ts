import { carouselFrame } from './themes'
import type { CarouselRatio } from './types'

export interface CroppedImage {
  blob: Blob
  width: number
  height: number
  mime: string
}

/** Output type per ratio: portrait frames look better as JPEG, the rest as WebP. */
function preferredMime(ratio: CarouselRatio): string {
  const [w, h] = ratio.split(':').map(Number)
  return h > w ? 'image/jpeg' : 'image/webp'
}

/** Pixel rectangle in the source image, as react-easy-crop reports it. */
export interface CropArea {
  x: number
  y: number
  width: number
  height: number
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('图片解码失败，换一张试试'))
      img.src = url
    })
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('导出裁切结果失败'))),
      mime,
      quality,
    )
  })
}

/** Draw a source rectangle onto a canvas at the requested output size. */
async function renderCrop(
  img: HTMLImageElement,
  area: CropArea,
  outW: number,
  outH: number,
  mime: string,
): Promise<CroppedImage> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(outW))
  canvas.height = Math.max(1, Math.round(outH))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 canvas 裁切')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(
    img,
    Math.round(area.x),
    Math.round(area.y),
    Math.round(area.width),
    Math.round(area.height),
    0,
    0,
    canvas.width,
    canvas.height,
  )
  const blob = await canvasToBlob(canvas, mime, 0.92)
  return { blob, width: canvas.width, height: canvas.height, mime }
}

/**
 * Centre-crop an image to the carousel's uniform frame.
 *
 * The crop happens here, before upload, because the published HTML must not rely
 * on object-fit or a fixed height to fake a common ratio — WeChat would drop
 * those. What lands in R2 is already the right shape.
 */
export async function cropToRatio(file: File, ratio: CarouselRatio): Promise<CroppedImage> {
  const img = await loadImage(file)
  const { cropWidth: targetW, cropHeight: targetH } = carouselFrame(ratio)

  const sourceRatio = img.naturalWidth / img.naturalHeight
  const targetRatio = targetW / targetH

  let sx = 0
  let sy = 0
  let sw = img.naturalWidth
  let sh = img.naturalHeight
  if (sourceRatio > targetRatio) {
    // too wide: trim both sides
    sw = Math.round(img.naturalHeight * targetRatio)
    sx = Math.round((img.naturalWidth - sw) / 2)
  } else if (sourceRatio < targetRatio) {
    // too tall: trim top and bottom
    sh = Math.round(img.naturalWidth / targetRatio)
    sy = Math.round((img.naturalHeight - sh) / 2)
  }

  // Never upscale past the source; a smaller frame still keeps the exact ratio.
  const scale = Math.min(1, img.naturalWidth / targetW, img.naturalHeight / targetH)
  const outW = Math.max(1, Math.round(targetW * scale))
  const outH = Math.max(1, Math.round(targetH * scale))

  return renderCrop(img, { x: sx, y: sy, width: sw, height: sh }, outW, outH, preferredMime(ratio))
}

/**
 * Output pixel size for a manual crop. Pure, so the sizing rules are testable
 * outside a browser.
 *
 * - a carousel slide locks the frame ratio and the output width
 * - a free crop keeps the area's own shape and is taken at its natural size
 * - the source pixels are the hard limit: the frame is never upscaled
 */
export function manualOutputSize(
  area: { width: number; height: number },
  opts?: { ratio?: CarouselRatio | null; targetWidth?: number },
): { width: number; height: number } {
  const ratio = opts?.ratio ?? null
  const targetW = opts?.targetWidth ?? carouselFrame(ratio ?? '4:3').cropWidth
  const targetH = ratio
    ? Math.round((targetW * Number(ratio.split(':')[1])) / Number(ratio.split(':')[0]))
    : Math.round((targetW * area.height) / area.width)

  const scale = Math.min(1, area.width / targetW, area.height / targetH)
  return {
    width: Math.max(1, Math.round(targetW * scale)),
    height: Math.max(1, Math.round(targetH * scale)),
  }
}

/**
 * Crop to a rectangle the user picked by hand.
 *
 * `targetWidth` keeps carousel slides at a known output size; without it the
 * crop is taken at its natural resolution. The frame is never upscaled.
 */
export async function cropToArea(
  file: File,
  area: CropArea,
  opts?: { ratio?: CarouselRatio | null; targetWidth?: number },
): Promise<CroppedImage> {
  const img = await loadImage(file)
  const { width: outW, height: outH } = manualOutputSize(area, opts)

  const ratio = opts?.ratio ?? null
  const mime = ratio
    ? preferredMime(ratio)
    : area.height > area.width
      ? 'image/jpeg'
      : 'image/webp'

  return renderCrop(img, area, outW, outH, mime)
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = () => reject(new Error('读取裁切结果失败'))
    r.readAsDataURL(blob)
  })
}

/** "photo.png" + "image/jpeg" -> "photo.jpg" */
export function filenameForMime(name: string, mime: string): string {
  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png'
  return `${name.replace(/\.[^.]+$/, '')}.${ext}`
}
