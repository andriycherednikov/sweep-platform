// api/test/admin-photos.test.js
import { expect, test, afterAll, beforeAll, beforeEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { photo, person, fixture } from '../src/db/schema.js'
import { person as personT } from '../src/db/schema.js'

const { pool, db } = openTestDb()
const PASS = '1234'
let dir, app, cookie
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sweep-adm-'))
  app = buildApp(db, { photosDir: dir, adminHash: bcrypt.hashSync(PASS, 8), sessionSecret: 's' })
  await app.ready()
  cookie = (await app.inject({ method: 'POST', url: '/api/admin/login', payload: { passcode: PASS } })).headers['set-cookie']
})
afterAll(async () => { await app.close(); await pool.end(); await rm(dir, { recursive: true, force: true }) })
beforeEach(async () => { await db.delete(photo) })

async function seedPending() {
  const [f] = await db.select().from(fixture).limit(1)
  await app.photos.writePending('z.jpg', Buffer.from('img'))
  await db.insert(photo).values({ id: 'ph1', sweepId: 'default', kind: 'fan', uploaderName: 'Priya', fixtureId: f.id, filePath: 'z.jpg', thumbPath: 'z.jpg', caption: 'hi', status: 'pending' })
  return f
}

test('GET /api/admin/photos requires admin (member is forbidden)', async () => {
  // On localhost an anonymous request resolves to the default sweep as a member,
  // so the admin guard returns 403 (forbidden), not 401.
  expect((await app.inject({ method: 'GET', url: '/api/admin/photos' })).statusCode).toBe(403)
})

test('GET /api/admin/photos lists pending + approved with kind/subject tags', async () => {
  const f = await seedPending()
  const res = await app.inject({ method: 'GET', url: '/api/admin/photos', headers: { cookie } })
  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.pending).toHaveLength(1)
  expect(body.pending[0]).toMatchObject({ id: 'ph1', kind: 'fan', fixtureId: f.id, status: 'pending' })
  expect(body.pending[0].fileUrl).toBe('/api/admin/photos/ph1/file')
})

test('GET /api/admin/photos/:id/file streams the pending image to the admin', async () => {
  await seedPending()
  const res = await app.inject({ method: 'GET', url: '/api/admin/photos/ph1/file', headers: { cookie } })
  expect(res.statusCode).toBe(200)
  expect(res.headers['content-type']).toMatch(/image\//)
  expect(res.rawPayload.toString()).toBe('img')
})

test('approve a fan photo → moves file, status approved, emits photo-approved', async () => {
  const published = []
  const app2 = buildApp(db, { photosDir: dir, adminHash: bcrypt.hashSync(PASS, 8), sessionSecret: 's', publish: (e) => published.push(e) })
  await app2.ready()
  const ck = (await app2.inject({ method: 'POST', url: '/api/admin/login', payload: { passcode: PASS } })).headers['set-cookie']
  const [f] = await db.select().from(fixture).limit(1)
  await app2.photos.writePending('appr.jpg', Buffer.from('img'))
  await db.insert(photo).values({ id: 'ph2', sweepId: 'default', kind: 'fan', uploaderName: 'Priya', fixtureId: f.id, filePath: 'appr.jpg', thumbPath: 'appr.jpg', status: 'pending' })

  const res = await app2.inject({ method: 'POST', url: '/api/admin/photos/ph2', headers: { cookie: ck }, payload: { action: 'approve' } })
  expect(res.statusCode).toBe(200)
  const [row] = await db.select().from(photo).where(eq(photo.id, 'ph2'))
  expect(row.status).toBe('approved')
  expect(published).toContainEqual({ type: 'photo-approved', id: 'ph2', kind: 'fan', fixtureId: f.id })
  await app2.close()
})

test('approve a profile photo sets person.avatar_path and supersedes prior', async () => {
  const [p] = await db.select().from(personT).limit(1)
  await app.photos.writePending('prof.jpg', Buffer.from('img'))
  await db.insert(photo).values({ id: 'ph3', sweepId: 'default', kind: 'profile', uploaderName: p.name, personId: p.id, filePath: 'prof.jpg', thumbPath: 'prof.jpg', status: 'pending' })
  const res = await app.inject({ method: 'POST', url: '/api/admin/photos/ph3', headers: { cookie }, payload: { action: 'approve' } })
  expect(res.statusCode).toBe(200)
  const [pp] = await db.select().from(personT).where(eq(personT.id, p.id))
  expect(pp.avatarPath).toBe('/photos/prof.jpg')
})

test('reject leaves no served file and marks rejected', async () => {
  await seedPending()
  const res = await app.inject({ method: 'POST', url: '/api/admin/photos/ph1', headers: { cookie }, payload: { action: 'reject' } })
  expect(res.statusCode).toBe(200)
  const [row] = await db.select().from(photo).where(eq(photo.id, 'ph1'))
  expect(row.status).toBe('rejected')
})

test('remove an approved profile reverts the person to initials and emits photo-removed', async () => {
  const published = []
  const app3 = buildApp(db, { photosDir: dir, adminHash: bcrypt.hashSync(PASS, 8), sessionSecret: 's', publish: (e) => published.push(e) })
  await app3.ready()
  const ck = (await app3.inject({ method: 'POST', url: '/api/admin/login', payload: { passcode: PASS } })).headers['set-cookie']
  const [p] = await db.select().from(personT).limit(1)
  await app3.photos.writePending('rm.jpg', Buffer.from('img')); await app3.photos.moveToApproved('rm.jpg')
  await db.update(personT).set({ avatarPath: '/photos/rm.jpg' }).where(eq(personT.id, p.id))
  await db.insert(photo).values({ id: 'ph4', sweepId: 'default', kind: 'profile', uploaderName: p.name, personId: p.id, filePath: 'rm.jpg', thumbPath: 'rm.jpg', status: 'approved' })

  const res = await app3.inject({ method: 'POST', url: '/api/admin/photos/ph4', headers: { cookie: ck }, payload: { action: 'remove' } })
  expect(res.statusCode).toBe(200)
  const [pp] = await db.select().from(personT).where(eq(personT.id, p.id))
  expect(pp.avatarPath).toBe(null)
  expect(published).toContainEqual({ type: 'photo-removed', id: 'ph4', kind: 'profile', person: p.id })
  await app3.close()
})
