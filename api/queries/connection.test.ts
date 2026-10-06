import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { backfillSavedAt, runMigrations, SAVEDAT_BACKFILL } from './connection'

// Timestamp columns declared with `mode: 'timestamp'` are stored in *seconds*.
// Getting that wrong makes the cut-off comparison always true and archives
// everything, which is the failure this test exists to catch.
function makeDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE docs (
      id TEXT PRIMARY KEY,
      ownerId INTEGER NOT NULL,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      savedAt INTEGER
    );
    CREATE TABLE _migrations (
      name TEXT PRIMARY KEY,
      runAt INTEGER NOT NULL
    );
  `)
  return db
}

function insert(db: DatabaseSync, id: string, updatedAt: number, savedAt: number | null = null) {
  db.prepare(
    'INSERT INTO docs (id, ownerId, name, content, createdAt, updatedAt, savedAt) VALUES (?, 1, ?, ?, ?, ?, ?)',
  ).run(id, id, 'body', updatedAt, updatedAt, savedAt)
}

const savedAtOf = (db: DatabaseSync, id: string) =>
  (db.prepare('SELECT savedAt FROM docs WHERE id = ?').get(id) as { savedAt: number | null }).savedAt

const NOW = 1_800_000_000 // seconds
const LONG_AGO = NOW - 86_400 * 30

describe('backfillSavedAt', () => {
  it('archives an article written before 草稿箱 existed', () => {
    const db = makeDb()
    insert(db, 'old', LONG_AGO)
    expect(backfillSavedAt(db, NOW)).toBe(1)
    expect(savedAtOf(db, 'old')).toBe(LONG_AGO)
  })

  it('leaves an article saved after the cut-off alone', () => {
    const db = makeDb()
    insert(db, 'fresh', NOW + 60)
    expect(backfillSavedAt(db, NOW)).toBe(0)
    expect(savedAtOf(db, 'fresh')).toBe(null)
  })

  it('does not disturb an article that was already archived', () => {
    const db = makeDb()
    const earlier = LONG_AGO + 500
    insert(db, 'archived', LONG_AGO, earlier)
    backfillSavedAt(db, NOW)
    expect(savedAtOf(db, 'archived')).toBe(earlier)
  })
})

describe('runMigrations', () => {
  it('archives legacy articles once and records the run', () => {
    const db = makeDb()
    insert(db, 'old', LONG_AGO)
    expect(runMigrations(db, NOW)).toBe(1)
    const mark = db.prepare('SELECT name FROM _migrations').all()
    expect(mark.map((r) => (r as { name: string }).name)).toEqual([SAVEDAT_BACKFILL])
  })

  it('does not run a second time, so later working copies stay unarchived', () => {
    const db = makeDb()
    insert(db, 'old', LONG_AGO)
    runMigrations(db, NOW)
    // A working copy the editor writes after the migration.
    insert(db, 'new-working-copy', NOW + 90)
    expect(runMigrations(db, NOW + 120)).toBe(0)
    expect(savedAtOf(db, 'new-working-copy')).toBe(null)
  })
})
