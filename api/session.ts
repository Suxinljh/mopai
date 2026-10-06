import * as jose from 'jose'
import * as cookie from 'cookie'
import { env } from './lib/env'
import { Session } from '@contracts/constants'
import type { SessionPayload } from './auth-types'
import { OWNER } from './auth-types'

const JWT_ALG = 'HS256'

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env.sessionSecret)
}

export async function signSessionToken(payload: SessionPayload): Promise<string> {
  return new jose.SignJWT({ uid: payload.uid })
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime('1 year')
    .sign(secretKey())
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  if (!token) return null
  try {
    const { payload } = await jose.jwtVerify(token, secretKey(), {
      algorithms: [JWT_ALG],
    })
    const uid = payload.uid
    if (typeof uid !== 'number') return null
    return { uid }
  } catch {
    return null
  }
}

/**
 * Returns the signed-in owner, or undefined for anonymous visitors. Anonymous is
 * a normal state here: editing, typesetting, copying and exporting all work
 * without a session; only image upload requires one.
 */
export async function authenticateRequest(headers: Headers): Promise<typeof OWNER | undefined> {
  const cookies = cookie.parse(headers.get('cookie') || '')
  const token = cookies[Session.cookieName]
  if (!token) return undefined
  const claim = await verifySessionToken(token)
  if (!claim) return undefined
  return { ...OWNER, id: claim.uid }
}
