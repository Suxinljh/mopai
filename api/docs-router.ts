import { z } from "zod";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { docs } from "../db/schema";

const DocInput = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(200),
  content: z.string().max(2_000_000),
  updatedAt: z.number(),
});

/**
 * Load one owned doc, or undefined.
 *
 * Uses a core select rather than `db.query.docs.findFirst`: the relational API
 * maps rows by column name while drizzle's sqlite-proxy driver hands it
 * positional values, so findFirst returns garbage with this driver. Core
 * queries go through the positional path that actually works.
 */
async function findOwnedDoc(ownerId: number, id: string) {
  const rows = await getDb()
    .select()
    .from(docs)
    .where(and(eq(docs.id, id), eq(docs.ownerId, ownerId)))
    .limit(1);
  return rows.at(0);
}

export const docsRouter = createRouter({
  /**
   * Every document for this owner, saved or not. The editor needs the unsaved
   * ones too; 草稿箱 filters on `savedAt`.
   */
  list: authedQuery.query(async ({ ctx }) => {
    return getDb()
      .select({
        id: docs.id,
        name: docs.name,
        content: docs.content,
        updatedAt: docs.updatedAt,
        savedAt: docs.savedAt,
        source: docs.source,
      })
      .from(docs)
      .where(and(eq(docs.ownerId, ctx.user.id), isNull(docs.deletedAt)))
      .orderBy(desc(docs.updatedAt));
  }),

  /** 草稿箱：只有主动保存过的。 */
  drafts: authedQuery.query(async ({ ctx }) => {
    return getDb()
      .select({
        id: docs.id,
        name: docs.name,
        content: docs.content,
        updatedAt: docs.updatedAt,
        savedAt: docs.savedAt,
        source: docs.source,
      })
      .from(docs)
      .where(and(eq(docs.ownerId, ctx.user.id), isNotNull(docs.savedAt), isNull(docs.deletedAt)))
      .orderBy(desc(docs.savedAt));
  }),

  /**
   * Working write. Keeps `savedAt` untouched, so editing an archived article
   * does not silently pass it off as freshly saved.
   *
   * Deliberately update-only: new rows come from saveToDrafts / importLocal.
   * An auto-save arriving after the article was deleted (on this device or
   * another) must not re-create it — the upsert this used to be made deleted
   * articles come back from the dead. `missing` tells the client the row is
   * gone so it can stop retrying and downgrade the article to a local draft.
   */
  save: authedQuery.input(DocInput).mutation(async ({ ctx, input }) => {
    const now = new Date(input.updatedAt || Date.now());
    const existing = await findOwnedDoc(ctx.user.id, input.id);
    if (!existing) {
      return { ok: true, savedAt: null, missing: true };
    }
    await getDb()
      .update(docs)
      .set({ name: input.name, content: input.content, updatedAt: now })
      .where(eq(docs.id, input.id));
    return { ok: true, savedAt: existing.savedAt ? existing.savedAt.getTime() : null, missing: false };
  }),

  /**
   * 保存到草稿箱. This is the only thing that puts an article in the archive.
   */
  saveToDrafts: authedQuery.input(DocInput).mutation(async ({ ctx, input }) => {
    const now = new Date(input.updatedAt || Date.now());
    const existing = await findOwnedDoc(ctx.user.id, input.id);
    if (!existing) {
      await getDb().insert(docs).values({
        id: input.id,
        ownerId: ctx.user.id,
        name: input.name,
        content: input.content,
        createdAt: now,
        updatedAt: now,
        savedAt: now,
      });
    } else {
      await getDb()
        .update(docs)
        .set({
          name: input.name,
          content: input.content,
          updatedAt: now,
          savedAt: now,
          // Saving is an explicit act of keeping the article, so a row trashed
          // from another device mid-session comes back rather than being
          // archived somewhere the owner cannot see.
          deletedAt: null,
        })
        .where(eq(docs.id, input.id));
    }
    return { ok: true, savedAt: now.getTime() };
  }),

  /** One-shot import of whatever the browser had in localStorage. */
  importLocal: authedQuery
    .input(z.object({ docs: z.array(DocInput).max(500) }))
    .mutation(async ({ ctx, input }) => {
      if (input.docs.length === 0) return { imported: 0 };
      const existing = await getDb()
        .select({ id: docs.id })
        .from(docs)
        .where(
          and(
            eq(docs.ownerId, ctx.user.id),
            inArray(
              docs.id,
              input.docs.map((d) => d.id),
            ),
          ),
        );
      const known = new Set(existing.map((r) => r.id));
      const fresh = input.docs.filter((d) => !known.has(d.id));
      if (fresh.length === 0) return { imported: 0 };

      await getDb()
        .insert(docs)
        .values(
          fresh.map((d) => ({
            id: d.id,
            ownerId: ctx.user.id,
            name: d.name,
            content: d.content,
            createdAt: new Date(d.updatedAt || Date.now()),
            updatedAt: new Date(d.updatedAt || Date.now()),
            // Imported work is not archived until the user saves it; savedAt is
            // left out so it defaults to NULL.
          })),
        )
        .onConflictDoNothing();
      return { imported: fresh.length };
    }),

  /**
   * 移入回收站，不是销毁。行还在，`list` / `drafts` 跳过它，`restore` 能把它
   * 原样请回来。
   */
  remove: authedQuery
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      await getDb()
        .update(docs)
        .set({ deletedAt: new Date() })
        .where(and(eq(docs.id, input.id), eq(docs.ownerId, ctx.user.id)));
      return { ok: true };
    }),

  /** 回收站： newest first, without the content — the bin only needs names. */
  trash: authedQuery.query(async ({ ctx }) => {
    return getDb()
      .select({
        id: docs.id,
        name: docs.name,
        savedAt: docs.savedAt,
        deletedAt: docs.deletedAt,
      })
      .from(docs)
      .where(and(eq(docs.ownerId, ctx.user.id), isNotNull(docs.deletedAt)))
      .orderBy(desc(docs.deletedAt));
  }),

  restore: authedQuery
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      await getDb()
        .update(docs)
        .set({ deletedAt: null })
        .where(and(eq(docs.id, input.id), eq(docs.ownerId, ctx.user.id)));
      // The bin only carries names, so the restored article's content has to
      // come back with this response.
      const row = await findOwnedDoc(ctx.user.id, input.id);
      return { ok: true, doc: row };
    }),

  /**
   * 彻底删除。它引用的图片随后会出现在素材库的「没在用的旧图」里，那是既有
   * 的清理入口，不在这里连带删图。
   */
  purge: authedQuery
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      await getDb()
        .delete(docs)
        .where(and(eq(docs.id, input.id), eq(docs.ownerId, ctx.user.id)));
      return { ok: true };
    }),
});
