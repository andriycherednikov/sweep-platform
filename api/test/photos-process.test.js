// api/test/photos-process.test.js  (storage half; processing added in Task 2)
import { expect, test, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStorage } from '../src/photos/storage.js'

let dir, store
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'sweep-photos-')); store = await createStorage(dir) })
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

test('writePending stores a file in pending/ and not in approved/', async () => {
  await store.writePending('a.jpg', Buffer.from('hello'))
  expect(await readFile(store.pendingPath('a.jpg'), 'utf8')).toBe('hello')
  await expect(access(join(dir, 'approved', 'a.jpg'))).rejects.toThrow()
})

test('moveToApproved relocates pending → approved', async () => {
  await store.writePending('b.jpg', Buffer.from('img'))
  await store.moveToApproved('b.jpg')
  expect(await readFile(join(dir, 'approved', 'b.jpg'), 'utf8')).toBe('img')
  await expect(access(store.pendingPath('b.jpg'))).rejects.toThrow()
})

test('removeApproved deletes the served file', async () => {
  await store.writePending('c.jpg', Buffer.from('x')); await store.moveToApproved('c.jpg')
  await store.removeApproved('c.jpg')
  await expect(access(join(dir, 'approved', 'c.jpg'))).rejects.toThrow()
})
