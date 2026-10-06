import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, desc } from "drizzle-orm";
import { createRouter, authedQuery } from "./middleware";
import { storage } from "./lib/storage";
import { env } from "./lib/env";
import { getDb } from "./queries/connection";
import { docs, files } from "../db/schema";

// 单图上限 20MB（base64 约 4/3 倍）
const MAX_BYTES = 20 * 1024 * 1024;

function toTrpcError(e: unknown): never {
  const err = e as { code?: string; message?: string };
  const code = err?.code || "";
  if (code === "STORAGE_FILE_TOO_LARGE")
    throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "图片超过大小限制" });
  if (code === "STORAGE_UNAUTHORIZED")
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "图床鉴权失败：请检查 IMG_ADMIN_KEY 与 Worker 是否一致" });
  if (code === "STORAGE_NOT_CONFIGURED")
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "图床未配置：请检查 IMG_BASE_URL 与 IMG_ADMIN_KEY" });
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `上传失败（${code || "UNKNOWN"}）` });
}

export const storageRouter = createRouter({
  upload: authedQuery
    .input(
      z.object({
        name: z.string().max(200),
        contentBase64: z.string().max(MAX_BYTES * 2),
        contentType: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const bytes = Uint8Array.from(Buffer.from(input.contentBase64, "base64"));
      if (bytes.byteLength > MAX_BYTES)
        throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "图片超过 20MB 限制" });
      try {
        const saved = await storage.uploadFile({
          fileContent: bytes,
          fileName: `mopai/${ctx.user.id}/${input.name}`,
          contentType: input.contentType,
        });
        await getDb().insert(files).values({
          key: saved.key,
          ownerId: ctx.user.id,
          name: saved.fileName,
          size: saved.size,
        });
        return { key: saved.key, size: saved.size };
      } catch (e) {
        toTrpcError(e);
      }
    }),

  list: authedQuery.query(async ({ ctx }) => {
    return getDb()
      .select()
      .from(files)
      .where(eq(files.ownerId, ctx.user.id))
      .orderBy(desc(files.createdAt))
      .limit(200);
  }),

  /** Storage usage for the materials page. */
  stats: authedQuery.query(async ({ ctx }) => {
    const rows = await getDb()
      .select({ size: files.size, createdAt: files.createdAt })
      .from(files)
      .where(eq(files.ownerId, ctx.user.id));
    const totalBytes = rows.reduce((n, r) => n + (r.size || 0), 0);
    const oldest = rows.reduce<number | null>(
      (min, r) => (min === null || r.createdAt.getTime() < min ? r.createdAt.getTime() : min),
      null,
    );
    return {
      count: rows.length,
      totalBytes,
      oldestAt: oldest,
      quotaBytes: env.storageQuotaBytes,
    };
  }),

  /**
   * Images no longer referenced by any saved 稿件.
   *
   * `alsoKeep` carries keys referenced by drafts that only exist in the browser
   * (the editor keeps working offline), so an image someone is still using is
   * never offered up for deletion just because it is not saved yet.
   */
  orphans: authedQuery
    .input(z.object({ alsoKeep: z.array(z.string()).max(5000).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const [rows, savedDocs] = await Promise.all([
        getDb()
          .select({ key: files.key, name: files.name, size: files.size, createdAt: files.createdAt })
          .from(files)
          .where(eq(files.ownerId, ctx.user.id))
          .orderBy(desc(files.createdAt)),
        getDb()
          .select({ content: docs.content })
          .from(docs)
          .where(eq(docs.ownerId, ctx.user.id)),
      ]);
      const referenced = new Set<string>(input?.alsoKeep ?? []);
      for (const d of savedDocs) {
        for (const m of d.content.matchAll(/img:([^\s)\]]+)/g)) referenced.add(m[1]);
      }
      return rows.filter((r) => !referenced.has(r.key));
    }),

  removeOrphans: authedQuery
    .input(z.object({ keys: z.array(z.string()).max(500) }))
    .mutation(async ({ ctx, input }) => {
      if (input.keys.length === 0) return { deleted: 0, freedBytes: 0, skipped: [] as string[] };

      const [rows, savedDocs] = await Promise.all([
        getDb()
          .select({ key: files.key, size: files.size })
          .from(files)
          .where(eq(files.ownerId, ctx.user.id)),
        getDb()
          .select({ content: docs.content })
          .from(docs)
          .where(eq(docs.ownerId, ctx.user.id)),
      ]);
      const owned = new Map(rows.map((r) => [r.key, r.size]));

      // Never delete something a saved 稿件 still points at, whatever the caller
      // asked for. This is what stops a bad client (or a careless script) from
      // wiping images that are in use.
      const referenced = new Set<string>();
      for (const d of savedDocs) {
        for (const m of d.content.matchAll(/img:([^\s)\]]+)/g)) referenced.add(m[1]);
      }

      let deleted = 0;
      let freedBytes = 0;
      const skipped: string[] = [];
      for (const key of input.keys) {
        const size = owned.get(key);
        if (size === undefined) continue;
        if (referenced.has(key)) {
          skipped.push(key);
          continue;
        }
        await storage.deleteFile({ fileKey: key });
        await getDb().delete(files).where(eq(files.key, key));
        deleted++;
        freedBytes += size;
      }
      return { deleted, freedBytes, skipped };
    }),

  remove: authedQuery
    .input(z.object({ key: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await getDb().query.files.findFirst({ where: eq(files.key, input.key) });
      if (!row || row.ownerId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
      await getDb().delete(files).where(eq(files.key, input.key));
      return { ok: await storage.deleteFile({ fileKey: input.key }) };
    }),
});
