import { createHash, randomBytes } from 'node:crypto'
import * as cookie from 'cookie'
import { getSessionCookieOptions } from './cookies'

/**
 * Anonymous visitors get an identity too.
 *
 * Uploads no longer require a login, but "who owns this image" still has to be
 * answerable — otherwise every visitor would see (and could delete) everybody
 * else's pictures. A first-party cookie carries a random id; only its hash is
 * stored, so a leaked database cannot be used to reach someone else's images.
 */
const VISITOR_COOKIE = 'mopai_vid'
const VISITOR_MAX_AGE_S = 365 * 24 * 60 * 60

export function readVisitorId(headers: Headers): string | null {
  const raw = cookie.parse(headers.get('cookie') || '')[VISITOR_COOKIE]
  return raw && /^[0-9a-f]{32}$/.test(raw) ? raw : null
}

export function newVisitorId(): string {
  return randomBytes(16).toString('hex')
}

/** Stable owner key for an anonymous visitor. Never store the cookie value itself. */
export function visitorKey(id: string): string {
  return createHash('sha256').update(`mopai-visitor:${id}`).digest('hex').slice(0, 32)
}

export function visitorCookie(id: string, headers: Headers, url: string): string {
  const opts = getSessionCookieOptions(headers, url)
  return cookie.serialize(VISITOR_COOKIE, id, {
    httpOnly: opts.httpOnly,
    path: opts.path,
    sameSite: opts.sameSite?.toLowerCase() as 'lax' | 'none',
    secure: opts.secure,
    maxAge: VISITOR_MAX_AGE_S,
  })
}
