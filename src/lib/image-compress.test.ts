import { describe, expect, it } from 'vitest'
import { compressImage, needsMatte, pickMime, targetSize } from './image-compress'

// The default maxEdge is 2048: WeChat renders a body image at most 657 CSS px
// wide, and 657 * 3 DPR = 1971.

describe('targetSize', () => {
  it('shrinks a landscape photo to the pixel budget', () => {
    expect(targetSize(4000, 3000)).toEqual({ width: 2048, height: 1536, scaled: true })
  })

  it('shrinks a portrait photo to the pixel budget', () => {
    expect(targetSize(3000, 4000)).toEqual({ width: 1536, height: 2048, scaled: true })
  })

  it('shrinks a square image on both edges', () => {
    expect(targetSize(3000, 3000)).toEqual({ width: 2048, height: 2048, scaled: true })
  })

  it('never upscales a smaller image', () => {
    // Same principle manualOutputSize() in image.ts is tested against.
    expect(targetSize(800, 600)).toEqual({ width: 800, height: 600, scaled: false })
  })

  it('never upscales even when the budget is generous', () => {
    expect(targetSize(800, 600, { maxEdge: 4096 })).toEqual({
      width: 800,
      height: 600,
      scaled: false,
    })
  })

  it('leaves a landscape image sitting exactly on the budget alone', () => {
    expect(targetSize(2048, 1536)).toEqual({ width: 2048, height: 1536, scaled: false })
  })

  it('leaves a portrait image sitting exactly on the budget alone', () => {
    expect(targetSize(1536, 2048)).toEqual({ width: 1536, height: 2048, scaled: false })
  })

  it('shrinks an image one pixel over the budget', () => {
    // 2048 / 2049 = 0.99951, so the short edge rounds back to 1000.
    expect(targetSize(2049, 1000)).toEqual({ width: 2048, height: 1000, scaled: true })
  })

  it('keeps the aspect ratio after scaling', () => {
    const out = targetSize(1920, 1080, { maxEdge: 960 })
    expect(out).toEqual({ width: 960, height: 540, scaled: true })
    expect(out.width / out.height).toBeCloseTo(1920 / 1080, 6)
  })

  it('honours a custom budget', () => {
    // 657 px is the actual WeChat content width, before any DPR headroom.
    expect(targetSize(4000, 3000, { maxEdge: 657 })).toEqual({
      width: 657,
      height: 493,
      scaled: true,
    })
  })

  it('keeps at least 1px on a thin edge instead of rounding to zero', () => {
    expect(targetSize(1, 10000, { maxEdge: 100 })).toEqual({ width: 1, height: 100, scaled: true })
  })

  it('handles an extreme sliver without producing a zero-width canvas', () => {
    expect(targetSize(100, 100000)).toEqual({ width: 2, height: 2048, scaled: true })
  })
})

describe('needsMatte', () => {
  it('requires a backdrop for JPEG, which has no alpha channel', () => {
    expect(needsMatte('image/jpeg')).toBe(true)
  })

  it('requires no backdrop for the formats that carry alpha', () => {
    expect(needsMatte('image/webp')).toBe(false)
    expect(needsMatte('image/png')).toBe(false)
    expect(needsMatte('image/gif')).toBe(false)
    expect(needsMatte('image/svg+xml')).toBe(false)
  })
})

describe('pickMime', () => {
  it('picks JPEG for portrait and WebP for everything else', () => {
    expect(pickMime(1536, 2048)).toBe('image/jpeg')
    expect(pickMime(2048, 1536)).toBe('image/webp')
  })

  it('treats a square as non-portrait', () => {
    expect(pickMime(1000, 1000)).toBe('image/webp')
  })

  it('matches image.ts preferredMime() across every carousel ratio', () => {
    // CAROUSEL_RATIOS from lib/types.ts, spelled out so a change to either rule
    // fails here rather than silently drifting apart.
    expect(pickMime(4, 3)).toBe('image/webp') // 4:3
    expect(pickMime(3, 4)).toBe('image/jpeg') // 3:4
    expect(pickMime(16, 9)).toBe('image/webp') // 16:9
    expect(pickMime(9, 16)).toBe('image/jpeg') // 9:16
    expect(pickMime(1, 1)).toBe('image/webp') // 1:1
  })

  it('passes animated GIFs through regardless of orientation', () => {
    expect(pickMime(600, 800, 'image/gif')).toBe('image/gif')
    expect(pickMime(800, 600, 'image/gif')).toBe('image/gif')
  })

  it('passes vectors through regardless of orientation', () => {
    expect(pickMime(600, 800, 'image/svg+xml')).toBe('image/svg+xml')
  })

  it('still applies the orientation rule to lossy sources', () => {
    // A landscape JPEG is re-encoded as WebP because that is smaller; only the
    // formats a canvas cannot reproduce are passed through untouched.
    expect(pickMime(2048, 1536, 'image/jpeg')).toBe('image/webp')
    expect(pickMime(1536, 2048, 'image/webp')).toBe('image/jpeg')
    expect(pickMime(2048, 1536, 'image/png')).toBe('image/webp')
  })
})

describe('compressImage under Node', () => {
  const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })

  it('rejects with an explicit environment error, not an incidental TypeError', async () => {
    const err: unknown = await compressImage(png).then(
      () => null,
      (e: unknown) => e,
    )

    expect(err).toBeInstanceOf(Error)
    // The point of the guard: a naive implementation leaks
    // "TypeError: document is not defined" from its first canvas touch, which
    // reads like a bug in the caller rather than a wrong runtime.
    expect(err).not.toBeInstanceOf(TypeError)
    expect((err as Error).message).toMatch(/browser DOM/)
    expect((err as Error).message).toMatch(/cannot run under Node/)
  })

  it('checks the environment before the GIF short-circuit', async () => {
    const gif = new Blob([new Uint8Array([0x47, 0x49, 0x46])], { type: 'image/gif' })
    await expect(compressImage(gif)).rejects.toThrow(/browser DOM/)
  })

  it('reports the same error for custom options', async () => {
    await expect(
      compressImage(png, { maxEdge: 657, targetBytes: 1024, minQuality: 0.5, mime: 'image/jpeg' }),
    ).rejects.toThrow(/browser DOM/)
  })
})
