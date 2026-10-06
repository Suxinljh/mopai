import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, desc } from "drizzle-orm";
import { createRouter, authedQuery } from "./middleware";
import { storage } from "./lib/storage";
import { getDb } from "./queries/connection";
import { files } from "../db/schema";

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

  remove: authedQuery
    .input(z.object({ key: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await getDb().query.files.findFirst({ where: eq(files.key, input.key) });
      if (!row || row.ownerId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
      await getDb().delete(files).where(eq(files.key, input.key));
      return { ok: await storage.deleteFile({ fileKey: input.key }) };
    }),
});
