import { describe, expect, it } from 'vitest'
import { ACCEPTED_IMAGE_MIMES, sniffImageMime } from './image-type'

const u8 = (...bytes: number[]) => Uint8Array.from(bytes)

/** Minimal valid headers, padded so length checks cannot pass by accident. */
const JPEG = u8(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0)
const PNG = u8(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d)
const GIF87 = u8(0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 1, 0, 1, 0)
const GIF89 = u8(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0)
const WEBP = u8(0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50)
const HTML = new TextEncoder().encode('<html><script>alert(1)</script></html>')
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')

describe('sniffImageMime', () => {
  it('recognises the four formats the public image domain is allowed to serve', () => {
    expect(sniffImageMime(JPEG)).toBe('image/jpeg')
    expect(sniffImageMime(PNG)).toBe('image/png')
    expect(sniffImageMime(GIF87)).toBe('image/gif')
    expect(sniffImageMime(GIF89)).toBe('image/gif')
    expect(sniffImageMime(WEBP)).toBe('image/webp')
  })

  it('rejects markup, which would be stored XSS on the image domain', () => {
    expect(sniffImageMime(HTML)).toBe(null)
    expect(sniffImageMime(SVG)).toBe(null)
  })

  it('rejects a RIFF container that is not WebP', () => {
    const wav = u8(0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45)
    expect(sniffImageMime(wav)).toBe(null)
  })

  it('rejects a truncated header instead of reading past the buffer', () => {
    expect(sniffImageMime(u8(0x89, 0x50, 0x4e))).toBe(null)
    expect(sniffImageMime(u8())).toBe(null)
  })

  it('keeps the accepted list in sync with the sniff', () => {
    expect(ACCEPTED_IMAGE_MIMES).toEqual(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
  })
})
