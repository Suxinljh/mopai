/**
 * Per-IP burst limit for the open upload endpoint.
 *
 * Cloudflare's free plan allows exactly one rate limiting rule per zone, and on
 * the upstream deployment that rule was already spent by another project in the
 * same zone. The daily quota in anon-quota.ts bounds how much one visitor can
 * store, but not how fast they can hammer the endpoint; this is the other half.
 *
 * Deliberately in-memory: it is best-effort, resets on restart, and is not
 * shared between instances. That is enough to stop a flood, and it costs a
 * self-hosted deployment nothing.
 */
const WINDOW_MS = 60 * 1000
const MAX_PER_WINDOW = Number(process.env.ANON_BURST_PER_MINUTE || 12)
/** Past this many tracked IPs, sweep the ones whose window has expired. */
const SWEEP_AT = 5000

const hits = new Map<string, number[]>()

export interface BurstVerdict {
  ok: boolean
  message?: string
}

/** Pure so the window arithmetic can be tested without touching the shared map. */
export function allowBurst(
  store: Map<string, number[]>,
  key: string,
  now: number,
  limit = MAX_PER_WINDOW,
): boolean {
  const recent = (store.get(key) ?? []).filter((t) => now - t < WINDOW_MS)
  if (recent.length >= limit) {
    store.set(key, recent)
    return false
  }
  recent.push(now)
  store.set(key, recent)

  if (store.size > SWEEP_AT) {
    for (const [k, times] of store) {
      const live = times.filter((t) => now - t < WINDOW_MS)
      if (live.length === 0) store.delete(k)
      else store.set(k, live)
    }
  }
  return true
}

export function checkBurst(ip: string): BurstVerdict {
  if (!allowBurst(hits, ip, Date.now())) {
    return { ok: false, message: `上传太频繁了，每分钟最多 ${MAX_PER_WINDOW} 张，稍等一下再试` }
  }
  return { ok: true }
}

/**
 * The address the request really came from. The app only listens on loopback and
 * is reached through the Cloudflare Tunnel, so CF-Connecting-IP is set by the
 * edge and cannot be forged by the client; the fallbacks are for local runs and
 * self-hosted deployments without Cloudflare in front.
 */
export function clientIp(headers: Headers): string {
  return (
    headers.get('cf-connecting-ip') ||
    headers.get('x-real-ip') ||
    headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    'unknown'
  )
}
