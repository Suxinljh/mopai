import { timingSafeEqual } from 'node:crypto'
import * as cookie from 'cookie'
import { z } from 'zod'
import { Session } from '@contracts/constants'
import { getSessionCookieOptions } from './lib/cookies'
import { env } from './lib/env'
import { createRouter, publicQuery } from './middleware'
import { signSessionToken } from './session'

function keyMatches(candidate: string): boolean {
  const expected = Buffer.from(env.accessKey, 'utf8')
  const given = Buffer.from(candidate, 'utf8')
  if (expected.length !== given.length) return false
  return timingSafeEqual(expected, given)
}

export const authRouter = createRouter({
  // Anonymous is a valid, expected answer here — the editor works without a session.
  me: publicQuery.query(({ ctx }) => ctx.user ?? null),

  login: publicQuery
    .input(z.object({ accessKey: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      if (!keyMatches(input.accessKey)) {
        return { success: false as const, message: '口令不对' }
      }
      const token = await signSessionToken({ uid: 1 })
      const opts = getSessionCookieOptions(ctx.req.headers)
      ctx.resHeaders.append(
        'set-cookie',
        cookie.serialize(Session.cookieName, token, {
          httpOnly: opts.httpOnly,
          path: opts.path,
          sameSite: opts.sameSite?.toLowerCase() as 'lax' | 'none',
          secure: opts.secure,
          maxAge: Session.maxAgeMs / 1000,
        }),
      )
      return { success: true as const }
    }),

  logout: publicQuery.mutation(({ ctx }) => {
    const opts = getSessionCookieOptions(ctx.req.headers)
    ctx.resHeaders.append(
      'set-cookie',
      cookie.serialize(Session.cookieName, '', {
        httpOnly: opts.httpOnly,
        path: opts.path,
        sameSite: opts.sameSite?.toLowerCase() as 'lax' | 'none',
        secure: opts.secure,
        maxAge: 0,
      }),
    )
    return { success: true }
  }),
})
