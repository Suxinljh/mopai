import { describe, expect, it } from 'vitest'

// env.ts reads process.env once at import time, and dotenv never overrides a
// value that is already set, so the ceilings are fixed before the module loads.
process.env.ANON_DAILY_IMAGES = '3'
process.env.ANON_DAILY_BYTES = '1000'
process.env.ANON_TOTAL_BYTES = '4000'

const { checkAnonQuota } = await import('./anon-quota')

const usage = (over: Partial<{ windowCount: number; windowBytes: number; totalBytes: number }> = {}) => ({
  windowCount: 0,
  windowBytes: 0,
  totalBytes: 0,
  ...over,
})

describe('checkAnonQuota', () => {
  it('lets an upload through while every ceiling has room', () => {
    expect(checkAnonQuota(usage({ windowCount: 2, windowBytes: 900, totalBytes: 3000 }), 100).ok).toBe(true)
  })

  it('counts the incoming image against the 24 h allowance', () => {
    const verdict = checkAnonQuota(usage({ windowCount: 3 }), 10)
    expect(verdict.ok).toBe(false)
    expect(verdict.message).toContain('3 张')
  })

  it('counts the incoming bytes against the 24 h allowance', () => {
    const verdict = checkAnonQuota(usage({ windowBytes: 950 }), 100)
    expect(verdict.ok).toBe(false)
    expect(verdict.message).toContain('24 小时')
  })

  it('stops everything once the shared anonymous budget is full', () => {
    const verdict = checkAnonQuota(usage({ totalBytes: 3990 }), 20)
    expect(verdict.ok).toBe(false)
    expect(verdict.message).toContain('存满')
  })

  it('reports the shared budget before a per-visitor allowance, since it is the harder stop', () => {
    const verdict = checkAnonQuota(usage({ windowCount: 9, totalBytes: 4000 }), 20)
    expect(verdict.message).toContain('存满')
  })
})
