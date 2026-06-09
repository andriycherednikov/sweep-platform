// api/test/photos-process.test.js  (storage half; processing added in Task 2)
import { expect, test, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStorage } from '../src/photos/storage.js'
import sharp from 'sharp'
import { validateUpload, processImage, ALLOWED_MIME, MAX_BYTES } from '../src/photos/process.js'

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

const png = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer()

test('validateUpload accepts jpeg/png/webp under the cap and rejects others', () => {
  expect(validateUpload('image/png', 1000)).toBeNull()
  expect(validateUpload('image/gif', 1000)).toMatch(/type/i)
  expect(validateUpload('image/png', MAX_BYTES + 1)).toMatch(/large/i)
  expect(ALLOWED_MIME).toContain('image/webp')
})

test('processImage(fan) re-encodes to jpeg and produces a thumb', async () => {
  const out = await processImage(await png(2000, 1000), 'fan')
  expect(out.ext).toBe('jpg')
  const meta = await sharp(out.buffer).metadata()
  expect(meta.format).toBe('jpeg')
  expect(meta.width).toBeLessThanOrEqual(1280) // fan: max width 1280, aspect kept
  const tmeta = await sharp(out.thumb).metadata()
  expect(tmeta.width).toBe(320)
})

test('processImage(profile) crops to a 256×256 square', async () => {
  const out = await processImage(await png(800, 400), 'profile')
  const meta = await sharp(out.buffer).metadata()
  expect(meta.width).toBe(256)
  expect(meta.height).toBe(256)
})
