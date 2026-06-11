// api/test/upload.test.js
import { expect, test, afterAll, beforeEach, beforeAll } from 'vitest'
import { mkdtemp, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import FormData from 'form-data'
import sharp from 'sharp'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { photo, person, fixture } from '../src/db/schema.js'
import { createStorage } from '../src/photos/storage.js'

const { pool, db } = openTestDb()
let dir, store, app
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sweep-up-'))
  store = await createStorage(dir)
  app = buildApp(db, { photosDir: dir })
  await app.ready()
})
afterAll(async () => { await app.close(); await pool.end(); await rm(dir, { recursive: true, force: true }) })
beforeEach(async () => { await db.delete(photo) })

const png = () => sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 5, g: 5, b: 5 } } }).png().toBuffer()

async function upload(fields, file) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  if (file) form.append('file', file, { filename: 'pic.png', contentType: 'image/png' })
  return app.inject({ method: 'POST', url: '/api/photos', headers: form.getHeaders(), payload: form.getBuffer() })
}
async function aFixture() { const [f] = await db.select().from(fixture).limit(1); return f }
async function aPerson() { const [p] = await db.select().from(person).limit(1); return p }

test('uploads a fan photo → pending row + file written to pending dir', async () => {
  const f = await aFixture()
  const res = await upload({ kind: 'fan', uploaderName: 'Priya', fixtureId: f.id, caption: 'colours!' }, await png())
  expect(res.statusCode).toBe(201)
  const body = res.json()
  expect(body).toMatchObject({ kind: 'fan', status: 'pending', fixtureId: f.id })
  const rows = await db.select().from(photo)
  expect(rows).toHaveLength(1)
  expect(rows[0].fixtureId).toBe(f.id)
  await access(store.pendingPath(rows[0].filePath)) // exists in pending, no throw
})

test('rejects a fan photo with an unknown fixture', async () => {
  const res = await upload({ kind: 'fan', uploaderName: 'X', fixtureId: 'nope-999' }, await png())
  expect(res.statusCode).toBe(400)
  expect(res.json().error).toBe('unknown_fixture')
})

test('rejects a non-image file type', async () => {
  const f = await aFixture()
  const form = new FormData()
  form.append('kind', 'fan'); form.append('uploaderName', 'X'); form.append('fixtureId', f.id)
  form.append('file', Buffer.from('not an image'), { filename: 'x.gif', contentType: 'image/gif' })
  const res = await app.inject({ method: 'POST', url: '/api/photos', headers: form.getHeaders(), payload: form.getBuffer() })
  expect(res.statusCode).toBe(400)
})

test('enforces one pending per person per kind (profile)', async () => {
  const p = await aPerson()
  const first = await upload({ kind: 'profile', uploaderName: p.name, personId: p.id }, await png())
  expect(first.statusCode).toBe(201)
  const second = await upload({ kind: 'profile', uploaderName: p.name, personId: p.id }, await png())
  expect(second.statusCode).toBe(409) // already has a pending profile
})

test('missing file → 400', async () => {
  const f = await aFixture()
  expect((await upload({ kind: 'fan', uploaderName: 'X', fixtureId: f.id })).statusCode).toBe(400)
})
