// api/test/upload.test.js
import { expect, test, afterAll, beforeEach, beforeAll } from 'vitest'
import { mkdtemp, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import FormData from 'form-data'
import sharp from 'sharp'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { memberClient, seatFor, releaseSeat } from './helpers/session.js'
import { eq } from 'drizzle-orm'
import { photo, person, event } from '../src/db/schema.js'
import { createStorage } from '../src/photos/storage.js'

const { pool, db } = openTestDb()
let dir, store, app, client
let me, seat
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sweep-up-'))
  store = await createStorage(dir)
  app = buildApp(db, { photosDir: dir })
  await app.ready()
  client = await memberClient(app)
  me = (await db.select().from(person).limit(1))[0]
  seat = await seatFor(db, me.id)
})
afterAll(async () => {
  await releaseSeat(db, me.id)
  await app.close(); await pool.end(); await rm(dir, { recursive: true, force: true })
})
beforeEach(async () => { await db.delete(photo) })

const png = () => sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 5, g: 5, b: 5 } } }).png().toBuffer()

async function upload(fields, file, headers = {}) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  if (file) form.append('file', file, { filename: 'pic.png', contentType: 'image/png' })
  return client.inject({
    method: 'POST', url: '/api/photos',
    headers: { ...form.getHeaders(), ...headers }, payload: form.getBuffer(),
  })
}
async function aFixture() { const [f] = await db.select().from(event).limit(1); return f }
async function aPerson() { return me }

test('a fan photo is live the moment it is uploaded', async () => {
  const f = await aFixture()
  const res = await upload({ kind: 'fan', uploaderName: 'Priya', fixtureId: f.id, caption: 'colours!' }, await png())
  expect(res.statusCode).toBe(201)
  const body = res.json()
  expect(body).toMatchObject({ kind: 'fan', status: 'approved', fixtureId: f.id })
  const rows = await db.select().from(photo)
  expect(rows).toHaveLength(1)
  expect(rows[0].fixtureId).toBe(f.id)
  await access(store.approvedPath(rows[0].filePath)) // served straight away, no throw

  // and the sweep can see it without anybody letting it through
  const listed = (await client.inject({ method: 'GET', url: '/api/photos' })).json()
  expect(listed.map((x) => x.id)).toContain(body.id)
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
  const res = await client.inject({ method: 'POST', url: '/api/photos', headers: form.getHeaders(), payload: form.getBuffer() })
  expect(res.statusCode).toBe(400)
})

// A person has one face. Uploading a new one replaces the old, rather than being
// refused because the first is still sitting in a queue that no longer exists.
test('a second profile photo supersedes the first, it is not refused', async () => {
  const p = await aPerson()
  const first = await upload({ kind: 'profile', uploaderName: p.name }, await png(), seat)
  expect(first.statusCode).toBe(201)
  const second = await upload({ kind: 'profile', uploaderName: p.name }, await png(), seat)
  expect(second.statusCode).toBe(201)

  const [row] = await db.select().from(person).where(eq(person.id, me.id))
  expect(row.avatarPath).toBe(`/photos/${second.json().id}.jpg`)
  const [old] = await db.select().from(photo).where(eq(photo.id, first.json().id))
  expect(old.status).toBe('removed')
  await expect(access(join(dir, 'approved', `${first.json().id}.jpg`))).rejects.toThrow()
})

test('missing file → 400', async () => {
  const f = await aFixture()
  expect((await upload({ kind: 'fan', uploaderName: 'X', fixtureId: f.id })).statusCode).toBe(400)
})

test('a profile photo without a seat is refused', async () => {
  const p = await aPerson()
  const res = await upload({ kind: 'profile', uploaderName: p.name }, await png())
  expect(res.statusCode).toBe(403)
  expect(res.json()).toEqual({ error: 'no_seat' })
})

// With auto-approve on this replaced their picture and deleted the original from disk;
// with moderation on it parked a pending upload that 409'd their own next one.
test('a multipart personId cannot attach a photo to someone else', async () => {
  const [p, other] = await db.select().from(person).limit(2)
  const res = await upload({ kind: 'profile', uploaderName: p.name, personId: other.id }, await png(), seat)
  expect(res.statusCode).toBe(201)
  expect(res.json().personId).toBe(me.id)
  const rows = await db.select().from(photo).where(eq(photo.personId, other.id))
  expect(rows).toHaveLength(0)
})
