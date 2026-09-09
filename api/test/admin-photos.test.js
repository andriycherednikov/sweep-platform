// api/test/admin-photos.test.js — the owner's photo list, and taking one down.
// There is no approval: an upload is live when it is written, so the only verb here
// is remove.
import { expect, test, afterAll, beforeAll, beforeEach } from 'vitest'
import { mkdtemp, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { photo, person, event } from '../src/db/schema.js'
import { memberCookie, ownerHeaders } from './helpers/session.js'

const { pool, db } = openTestDb()
const published = []
let dir, app, auth
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sweep-adm-'))
  app = buildApp(db, { photosDir: dir, sessionSecret: 's', publish: (e) => published.push(e) })
  await app.ready()
  auth = { cookie: await memberCookie(app), ...(await ownerHeaders(db)) }
})
afterAll(async () => { await app.close(); await pool.end(); await rm(dir, { recursive: true, force: true }) })
beforeEach(async () => { await db.delete(photo); published.length = 0 })

async function live({ id = 'ph1', kind = 'fan', personId = null } = {}) {
  const [f] = await db.select().from(event).limit(1)
  await app.photos.writeApproved(`${id}.jpg`, Buffer.from('img'))
  await app.photos.writeApproved(`${id}_t.jpg`, Buffer.from('thumb'))
  await db.insert(photo).values({
    id, sweepId: 'default', kind, uploaderName: 'Priya',
    fixtureId: kind === 'fan' ? f.id : null, personId,
    filePath: `${id}.jpg`, thumbPath: `${id}_t.jpg`, caption: 'hi', status: 'approved',
  })
  return f
}

test('the photo list requires admin (a member is forbidden)', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/admin/photos', headers: { cookie: auth.cookie } })
  expect(res.statusCode).toBe(403)
})

// The bytes are already public at /photos/<file> — the same ones the team pages render —
// so the list points at them rather than at a credentialed streaming route.
test('it lists what is in the sweep, pointing at the public file', async () => {
  await live()
  const rows = (await app.inject({ method: 'GET', url: '/api/admin/photos', headers: auth })).json()
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ id: 'ph1', kind: 'fan', uploader: 'Priya', src: '/photos/ph1.jpg' })
})

test('removing takes the files off disk, marks the row, and tells the sweep', async () => {
  await live()
  const res = await app.inject({ method: 'DELETE', url: '/api/admin/photos/ph1', headers: auth })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ id: 'ph1', removed: true })

  const [row] = await db.select().from(photo).where(eq(photo.id, 'ph1'))
  expect(row.status).toBe('removed')
  await expect(access(join(dir, 'approved', 'ph1.jpg'))).rejects.toThrow()
  await expect(access(join(dir, 'approved', 'ph1_t.jpg'))).rejects.toThrow()
  expect(published.some((e) => e.type === 'photo-removed')).toBe(true)
  // and it drops out of the list
  expect((await app.inject({ method: 'GET', url: '/api/admin/photos', headers: auth })).json()).toEqual([])
})

test('removing a profile photo puts the person back to their initials', async () => {
  const [p] = await db.select().from(person).where(eq(person.sweepId, 'default')).limit(1)
  await live({ id: 'ph2', kind: 'profile', personId: p.id })
  await db.update(person).set({ avatarPath: '/photos/ph2.jpg' }).where(eq(person.id, p.id))

  await app.inject({ method: 'DELETE', url: '/api/admin/photos/ph2', headers: auth })
  const [after] = await db.select().from(person).where(eq(person.id, p.id))
  expect(after.avatarPath).toBeNull()
})

test('a member cannot take a photo down', async () => {
  await live()
  const res = await app.inject({ method: 'DELETE', url: '/api/admin/photos/ph1', headers: { cookie: auth.cookie } })
  expect(res.statusCode).toBe(403)
})

test('an unknown photo is 404, not a silent success', async () => {
  const res = await app.inject({ method: 'DELETE', url: '/api/admin/photos/nope', headers: auth })
  expect(res.statusCode).toBe(404)
})
