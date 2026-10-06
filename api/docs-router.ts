import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { docs } from "../db/schema";

const DocInput = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(200),
  content: z.string().max(2_000_000),
  updatedAt: z.number(),
});

export const docsRouter = createRouter({
  list: authedQuery.query(async ({ ctx }) => {
    return getDb()
      .select({
        id: docs.id,
        name: docs.name,
        content: docs.content,
        updatedAt: docs.updatedAt,
      })
      .from(docs)
      .where(eq(docs.ownerId, ctx.user.id))
      .orderBy(desc(docs.updatedAt));
  }),

  /** Whole-doc upsert. The editor owns ordering, so one row at a time is enough. */
  save: authedQuery.input(DocInput).mutation(async ({ ctx, input }) => {
    const now = new Date(input.updatedAt || Date.now());
    await getDb()
      .insert(docs)
      .values({
        id: input.id,
        ownerId: ctx.user.id,
        name: input.name,
        content: input.content,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: docs.id,
        set: { name: input.name, content: input.content, updatedAt: now },
      });
    return { ok: true };
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
          })),
        )
        .onConflictDoNothing();
      return { imported: fresh.length };
    }),

  remove: authedQuery
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      await getDb()
        .delete(docs)
        .where(and(eq(docs.id, input.id), eq(docs.ownerId, ctx.user.id)));
      return { ok: true };
    }),
});
