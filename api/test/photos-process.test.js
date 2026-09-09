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

test('writeApproved puts the file where it is served from', async () => {
  await store.writeApproved('a.jpg', Buffer.from('hello'))
  expect(await readFile(store.approvedPath('a.jpg'), 'utf8')).toBe('hello')
})

// There is no pending shelf: an upload is live when it is written.
test('the store has no pending half at all', () => {
  expect(store.writePending).toBeUndefined()
  expect(store.moveToApproved).toBeUndefined()
  expect(store.pendingPath).toBeUndefined()
})

test('removeApproved deletes the served file', async () => {
  await store.writeApproved('c.jpg', Buffer.from('x'))
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

// The upload sheet previews this crop and tells the member "this is how it will be cut".
// It can only keep that promise while the rule stays one a browser can reproduce, so
// smart-cropping must not come back without the preview changing with it.
test('a profile photo is cut to a centred square, not a clever one', async () => {
  // three equal vertical bands: a centre crop keeps only the middle one
  const wide = await sharp({ create: { width: 1200, height: 400, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([{
      input: Buffer.from(
        '<svg width="1200" height="400">'
        + '<rect x="0" width="400" height="400" fill="#ff0000"/>'
        + '<rect x="400" width="400" height="400" fill="#00ff00"/>'
        + '<rect x="800" width="400" height="400" fill="#0000ff"/></svg>'),
      top: 0, left: 0,
    }]).png().toBuffer()

  const { buffer } = await processImage(wide, 'profile')
  const meta = await sharp(buffer).metadata()
  expect([meta.width, meta.height]).toEqual([256, 256])

  const at = async (x, y) => [...(await sharp(buffer).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer())]
  for (const [x, y] of [[128, 128], [4, 4], [251, 4], [4, 251], [251, 251]]) {
    const [r, g, b] = await at(x, y)
    expect(g).toBeGreaterThan(200)   // the middle band, everywhere
    expect(r).toBeLessThan(80)
    expect(b).toBeLessThan(80)
  }
})
