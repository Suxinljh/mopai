import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The database path is read when the connection module loads, so it has to be
// set before docs-router (and therefore connection) is imported.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mopai-trash-'))
process.env.DATABASE_URL = `file:${path.join(dir, 'trash.db')}`

const { docsRouter } = await import('./docs-router')

const user = {
  id: 1,
  unionId: 'u1',
  name: null,
  email: null,
  avatar: null,
  role: 'user' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignInAt: new Date(),
}
const caller = docsRouter.createCaller({
  req: new Request('http://test/'),
  resHeaders: new Headers(),
  user,
})

const save = (id: string, content: string) =>
  caller.saveToDrafts({ id, name: id, content, updatedAt: Date.now() })

describe('the recycle bin', () => {
  it('moves a doc out of every live list without destroying it', async () => {
    await save('a', '正文甲')
    expect((await caller.list()).map((d) => d.id)).toContain('a')

    await caller.remove({ id: 'a' })
    expect((await caller.list()).map((d) => d.id)).not.toContain('a')
    expect((await caller.drafts()).map((d) => d.id)).not.toContain('a')
    const trash = await caller.trash()
    expect(trash.map((d) => d.id)).toEqual(['a'])
    expect(trash[0].deletedAt).not.toBeNull()
  })

  it('restores the content, not just the row', async () => {
    const res = await caller.restore({ id: 'a' })
    expect(res.doc?.content).toBe('正文甲')
    expect((await caller.list()).find((d) => d.id === 'a')?.content).toBe('正文甲')
    expect(await caller.trash()).toEqual([])
  })

  it('keeps a trashed doc trashed when an auto-save lands on it', async () => {
    await caller.remove({ id: 'a' })
    // The editor's debounced save can be in flight when the delete happens.
    await caller.save({ id: 'a', name: 'a', content: '改过的正文', updatedAt: Date.now() })
    expect((await caller.list()).map((d) => d.id)).not.toContain('a')
    expect((await caller.trash()).map((d) => d.id)).toEqual(['a'])
    await caller.restore({ id: 'a' })
  })

  it('lets saving to the drafts box bring a trashed doc back', async () => {
    await caller.remove({ id: 'a' })
    await caller.saveToDrafts({ id: 'a', name: 'a', content: '正文甲', updatedAt: Date.now() })
    expect((await caller.list()).map((d) => d.id)).toContain('a')
    expect(await caller.trash()).toEqual([])
  })

  it('purges for good, and a later restore finds nothing', async () => {
    await save('b', '正文乙')
    await caller.remove({ id: 'b' })
    await caller.purge({ id: 'b' })
    expect(await caller.trash()).toEqual([])
    const res = await caller.restore({ id: 'b' })
    expect(res.doc).toBeUndefined()
    expect((await caller.list()).map((d) => d.id)).not.toContain('b')
  })

  it('never touches another owner’s rows', async () => {
    await save('c', '正文丙')
    const stranger = docsRouter.createCaller({
      req: new Request('http://test/'),
      resHeaders: new Headers(),
      user: { ...user, id: 2 },
    })
    await stranger.remove({ id: 'c' })
    expect((await caller.list()).map((d) => d.id)).toContain('c')
    expect(await stranger.trash()).toEqual([])
  })
})
