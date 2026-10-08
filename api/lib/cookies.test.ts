import { describe, expect, it } from 'vitest'
import { getSessionCookieOptions } from './cookies'

const h = (init: Record<string, string> = {}) => new Headers(init)

describe('getSessionCookieOptions', () => {
  /**
   * The regression this file exists for: a NAS on the LAN serves plain http, and
   * the old host allow-list ("secure unless localhost") marked the session
   * cookie Secure there. Browsers drop a Secure cookie delivered over http, so
   * login answered success and every later request still arrived anonymous.
   */
  it('does not mark the cookie Secure on plain http, even off localhost', () => {
    const opts = getSessionCookieOptions(h(), 'http://192.168.3.32:3100/api/trpc/auth.login')
    expect(opts.secure).toBe(false)
    expect(opts.sameSite).toBe('Lax')
  })

  it('keeps Secure + SameSite=None on a real https request', () => {
    const opts = getSessionCookieOptions(h(), 'https://wechat.example.com/api/trpc/auth.login')
    expect(opts.secure).toBe(true)
    expect(opts.sameSite).toBe('None')
  })

  /**
   * A tunnel terminates TLS and then speaks http to the app, so the URL alone
   * would look insecure and downgrade the cookie on a genuinely https site.
   */
  it('trusts x-forwarded-proto over an http URL', () => {
    const opts = getSessionCookieOptions(
      h({ 'x-forwarded-proto': 'https' }),
      'http://app:3100/api/trpc/auth.login',
    )
    expect(opts.secure).toBe(true)
    expect(opts.sameSite).toBe('None')
  })

  it('reads the first hop of a chained x-forwarded-proto', () => {
    expect(getSessionCookieOptions(h({ 'x-forwarded-proto': 'https, http' }), 'http://app:3100/').secure).toBe(true)
    expect(getSessionCookieOptions(h({ 'x-forwarded-proto': 'http, https' }), 'https://app/').secure).toBe(false)
  })

  it('stays http-only and same-site on every path', () => {
    const opts = getSessionCookieOptions(h(), 'http://127.0.0.1:3100/')
    expect(opts.httpOnly).toBe(true)
    expect(opts.path).toBe('/')
  })
})
