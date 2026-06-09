// api/test/admin-photos.test.js
import { expect, test, afterAll, beforeAll, beforeEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { photo, person, team } from '../src/db/schema.js'

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
  const [t] = await db.select().from(team).limit(1)
  await app.photos.writePending('z.jpg', Buffer.from('img'))
  await db.insert(photo).values({ id: 'ph1', kind: 'fan', uploaderName: 'Priya', teamCode: t.code, filePath: 'z.jpg', thumbPath: 'z.jpg', caption: 'hi', status: 'pending' })
  return t
}

test('GET /api/admin/photos requires auth', async () => {
  expect((await app.inject({ method: 'GET', url: '/api/admin/photos' })).statusCode).toBe(401)
})

test('GET /api/admin/photos lists pending + approved with kind/subject tags', async () => {
  const t = await seedPending()
  const res = await app.inject({ method: 'GET', url: '/api/admin/photos', headers: { cookie } })
  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.pending).toHaveLength(1)
  expect(body.pending[0]).toMatchObject({ id: 'ph1', kind: 'fan', team: t.code, status: 'pending' })
  expect(body.pending[0].fileUrl).toBe('/api/admin/photos/ph1/file')
})

test('GET /api/admin/photos/:id/file streams the pending image to the admin', async () => {
  await seedPending()
  const res = await app.inject({ method: 'GET', url: '/api/admin/photos/ph1/file', headers: { cookie } })
  expect(res.statusCode).toBe(200)
  expect(res.headers['content-type']).toMatch(/image\//)
  expect(res.rawPayload.toString()).toBe('img')
})
