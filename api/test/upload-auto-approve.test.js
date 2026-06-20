// api/test/upload-auto-approve.test.js — uploads with PHOTOS_AUTO_APPROVE on skip moderation.
import { expect, test, afterAll, beforeEach, beforeAll } from 'vitest'
import { mkdtemp, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import FormData from 'form-data'
import sharp from 'sharp'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { photo, person, fixture } from '../src/db/schema.js'
import { createStorage } from '../src/photos/storage.js'

const { pool, db } = openTestDb()
let dir, store, app
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sweep-auto-'))
  store = await createStorage(dir)
  app = buildApp(db, { photosDir: dir, autoApprovePhotos: true })
  await app.ready()
})
afterAll(async () => { await app.close(); await pool.end(); await rm(dir, { recursive: true, force: true }) })
beforeEach(async () => { await db.delete(photo) })

const png = () => sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 7, g: 7, b: 7 } } }).png().toBuffer()
async function upload(fields, file) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  if (file) form.append('file', file, { filename: 'pic.png', contentType: 'image/png' })
  return app.inject({ method: 'POST', url: '/api/photos', headers: form.getHeaders(), payload: form.getBuffer() })
}
async function aFixture() { const [f] = await db.select().from(fixture).limit(1); return f }
async function aPerson() { const [p] = await db.select().from(person).limit(1); return p }

test('auto-approve: a fan photo goes straight to approved, file in approved dir, shows in /api/photos', async () => {
  const f = await aFixture()
  const res = await upload({ kind: 'fan', uploaderName: 'Priya', fixtureId: f.id, caption: 'go!' }, await png())
  expect(res.statusCode).toBe(201)
  expect(res.json()).toMatchObject({ kind: 'fan', status: 'approved', fixtureId: f.id })
  const [row] = await db.select().from(photo)
  expect(row.status).toBe('approved')
  await access(store.approvedPath(row.filePath)) // moved to approved/ (no throw)
  const list = (await app.inject({ method: 'GET', url: `/api/photos?fixture=${f.id}` })).json()
  expect(list).toHaveLength(1)
})

test('auto-approve: a profile photo approves immediately and sets the person avatar', async () => {
  const p = await aPerson()
  const res = await upload({ kind: 'profile', uploaderName: p.name, personId: p.id }, await png())
  expect(res.statusCode).toBe(201)
  expect(res.json().status).toBe('approved')
  const [row] = await db.select().from(photo).where(eq(photo.personId, p.id))
  expect(row.status).toBe('approved')
  const [pp] = await db.select().from(person).where(eq(person.id, p.id))
  expect(pp.avatarPath).toBe(`/photos/${row.filePath}`)
})

test('auto-approve: re-uploading a profile supersedes the prior approved one (no 409)', async () => {
  const p = await aPerson()
  expect((await upload({ kind: 'profile', uploaderName: p.name, personId: p.id }, await png())).statusCode).toBe(201)
  expect((await upload({ kind: 'profile', uploaderName: p.name, personId: p.id }, await png())).statusCode).toBe(201)
  const approved = (await db.select().from(photo).where(eq(photo.personId, p.id))).filter((r) => r.status === 'approved')
  expect(approved).toHaveLength(1) // prior approved profile superseded
})
