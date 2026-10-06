import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";

// Upload ledger. Only keys are stored — never URLs, since a key is what the
// worker turns into a stable public address.
export const files = sqliteTable("files", {
  key: text("key").primaryKey(),
  ownerId: integer("ownerId").notNull(),
  name: text("name"),
  size: integer("size").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type FileRow = typeof files.$inferSelect;

// 稿件。以前只存在浏览器 localStorage，换台设备就没了。
//
// `savedAt` 为 null 表示只是编辑中的工作稿，还没被主动保存；草稿箱只列
// savedAt 有值的，这样自动同步的工作稿不会混进归档。
export const docs = sqliteTable("docs", {
  id: text("id").primaryKey(),
  ownerId: integer("ownerId").notNull(),
  name: text("name").notNull(),
  content: text("content").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  savedAt: integer("savedAt", { mode: "timestamp" }),
});

export type DocRow = typeof docs.$inferSelect;

/**
 * Single-owner deployment: the app authenticates with one access key, so there
 * is no user table. This shape is kept so upload code can keep referring to
 * `ctx.user` exactly as it did before.
 */
export type User = {
  id: number;
  unionId: string;
  name: string | null;
  email: string | null;
  avatar: string | null;
  role: "user" | "admin";
  createdAt: Date;
  updatedAt: Date;
  lastSignInAt: Date;
};
