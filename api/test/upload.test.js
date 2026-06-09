// api/test/upload.test.js
import { expect, test, afterAll, beforeEach, beforeAll } from 'vitest'
import { mkdtemp, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import FormData from 'form-data'
import sharp from 'sharp'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { photo, person, team, fixture } from '../src/db/schema.js'
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
async function aTeam() { const [t] = await db.select().from(team).limit(1); return t }
async function aPerson() { const [p] = await db.select().from(person).limit(1); return p }

test('uploads a fan photo → pending row + file written to pending dir', async () => {
  const t = await aTeam()
  const res = await upload({ kind: 'fan', uploaderName: 'Priya', teamCode: t.code, caption: 'colours!' }, await png())
  expect(res.statusCode).toBe(201)
  const body = res.json()
  expect(body).toMatchObject({ kind: 'fan', status: 'pending', teamCode: t.code })
  const rows = await db.select().from(photo)
  expect(rows).toHaveLength(1)
  await access(store.pendingPath(rows[0].filePath)) // exists in pending, no throw
})

test('rejects a non-image file type', async () => {
  const t = await aTeam()
  const form = new FormData()
  form.append('kind', 'fan'); form.append('uploaderName', 'X'); form.append('teamCode', t.code)
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
  const t = await aTeam()
  expect((await upload({ kind: 'fan', uploaderName: 'X', teamCode: t.code })).statusCode).toBe(400)
})
