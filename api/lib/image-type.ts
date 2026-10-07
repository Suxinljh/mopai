/**
 * What an upload actually is, decided by its bytes.
 *
 * The browser's `Content-Type` and the file extension are both attacker-chosen,
 * and whatever we store here is later served from the public image domain. An
 * HTML or SVG file with a `.png` name would become stored XSS on that domain,
 * so the served type always comes from this sniff and never from the request.
 */
export type ImageMime = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

export const ACCEPTED_IMAGE_MIMES: ImageMime[] = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.byteLength < offset + signature.length) return false
  return signature.every((byte, i) => bytes[offset + i] === byte)
}

export function sniffImageMime(bytes: Uint8Array): ImageMime | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61])) return 'image/gif'
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return 'image/gif'
  // RIFF....WEBP
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp'
  }
  return null
}

export const ACCEPTED_IMAGE_LABEL = 'jpg / png / gif / webp'
