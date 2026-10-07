import { and, eq, gte, sql } from 'drizzle-orm'
import { files } from '../../db/schema'
import { getDb } from '../queries/connection'
import { env } from './env'

/**
 * Budget for uploads that arrive without a login.
 *
 * The image bucket is a shared 10 GB free tier, and an open upload endpoint is
 * the one place where a stranger can spend the owner's money and disk. Two
 * ceilings: a rolling 24 h allowance per visitor, and a hard total for every
 * anonymous upload ever kept. The owner's own session is not limited by either.
 */
export const ANON_OWNER_ID = 0

const WINDOW_MS = 24 * 60 * 60 * 1000

export interface AnonUsage {
  /** Uploads by this visitor in the last 24 h. */
  windowCount: number
  windowBytes: number
  /** Every anonymous upload still on record, all visitors. */
  totalBytes: number
}

export interface AnonQuotaVerdict {
  ok: boolean
  message?: string
}

export async function readAnonUsage(visitor: string): Promise<AnonUsage> {
  const db = getDb()
  const since = new Date(Date.now() - WINDOW_MS)
  const mine = await db
    .select({ n: sql<number>`count(*)`, b: sql<number>`coalesce(sum(${files.size}), 0)` })
    .from(files)
    .where(and(eq(files.ownerId, ANON_OWNER_ID), eq(files.visitor, visitor), gte(files.createdAt, since)))
  const total = await db
    .select({ b: sql<number>`coalesce(sum(${files.size}), 0)` })
    .from(files)
    .where(eq(files.ownerId, ANON_OWNER_ID))
  return {
    windowCount: Number(mine.at(0)?.n ?? 0),
    windowBytes: Number(mine.at(0)?.b ?? 0),
    totalBytes: Number(total.at(0)?.b ?? 0),
  }
}

export function mb(bytes: number): string {
  return String(Math.round(bytes / (1024 * 1024)))
}

/** Pure so the ceilings can be tested without a database. */
export function checkAnonQuota(usage: AnonUsage, incomingBytes: number): AnonQuotaVerdict {
  if (usage.totalBytes + incomingBytes > env.anonTotalBytes) {
    return {
      ok: false,
      message: `公共图床已经存满（上限 ${mb(env.anonTotalBytes)} MB），暂时不能再上传`,
    }
  }
  if (usage.windowCount + 1 > env.anonDailyImages) {
    return {
      ok: false,
      message: `24 小时内最多上传 ${env.anonDailyImages} 张图，额度用完了，明天再来`,
    }
  }
  if (usage.windowBytes + incomingBytes > env.anonDailyBytes) {
    return {
      ok: false,
      message: `24 小时内最多上传 ${mb(env.anonDailyBytes)} MB，额度用完了，明天再来`,
    }
  }
  return { ok: true }
}
