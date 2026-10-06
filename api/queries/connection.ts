import { DatabaseSync } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import fs from 'node:fs'
import path from 'node:path'
import { env } from '../lib/env'
import * as schema from '@db/schema'

/**
 * SQLite via Node's built-in driver — no external process, no extra memory.
 * Drizzle has no `node:sqlite` driver yet, so `sqlite-proxy` is driven by a
 * callback that runs each statement synchronously and hands back rows.
 *
 * IMPORTANT: use core queries (`select/insert/update/delete`), not the
 * relational API (`db.query.<table>.findFirst`). Drizzle's relational layer
 * maps rows by column *name*, while sqlite-proxy supplies positional values, so
 * findFirst returns rows of nulls regardless of what the driver does. Core
 * queries use the positional path this driver is built for.
 */
function resolveDbPath(): string {
  const raw = env.databaseUrl || 'file:./mopai.db'
  const withoutScheme = raw.startsWith('file:') ? raw.slice('file:'.length) : raw
  return path.resolve(withoutScheme)
}

function openDatabase(): DatabaseSync {
  const file = resolveDbPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  // Tables, created on first use — no migration tooling needed at this size.
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      key TEXT PRIMARY KEY,
      ownerId INTEGER NOT NULL,
      name TEXT,
      size INTEGER NOT NULL,
      createdAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS docs (
      id TEXT PRIMARY KEY,
      ownerId INTEGER NOT NULL,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      savedAt INTEGER
    );

    CREATE INDEX IF NOT EXISTS docs_owner_updated
      ON docs (ownerId, updatedAt DESC);
  `)

  // Added after the first release: an existing database has docs without the
  // column, so bring it up to date rather than requiring a manual step.
  const columns = db.prepare('PRAGMA table_info(docs)').all() as { name: string }[]
  if (!columns.some((c) => c.name === 'savedAt')) {
    db.exec('ALTER TABLE docs ADD COLUMN savedAt INTEGER')
  }

  return db
}

let instance: ReturnType<typeof drizzle<typeof schema>>

export function getDb() {
  if (!instance) {
    const db = openDatabase()
    instance = drizzle(
      async (sqlText, params, method) => {
        const stmt = db.prepare(sqlText)
        if (method === 'run') {
          const r = stmt.run(...(params as never[]))
          return { rows: [{ changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid }] }
        }
        if (method === 'get') {
          const row = stmt.get(...(params as never[]))
          // drizzle does `clientResult.rows` and hands that straight to the
          // field mapper, so a hit is the row's values in column order and a
          // miss is undefined. An array here would be read as "row whose first
          // column is an array", i.e. every field null.
          if (row === undefined) return { rows: undefined as unknown as unknown[] }
          return { rows: Object.values(row) as unknown as unknown[] }
        }
        return {
          rows: stmt.all(...(params as never[])).map((row) => Object.values(row)),
        }
      },
      { schema },
    )
  }
  return instance
}
