// api/test/admin-people.test.js — admin sets a person's wagers age gate (adult flag)
import { expect, test, afterAll, beforeAll, beforeEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { person } from '../src/db/schema.js'
import { memberCookie, ownerHeaders } from './helpers/session.js'

const { pool, db } = openTestDb()
let dir, app, auth
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sweep-people-'))
  app = buildApp(db, { photosDir: dir, sessionSecret: 's' })
  await app.ready()
  auth = { cookie: await memberCookie(app), ...(await ownerHeaders(db)) }
})
afterAll(async () => { await app.close(); await pool.end(); await rm(dir, { recursive: true, force: true }) })
beforeEach(async () => { await db.delete(person).where(eq(person.id, 'kidp')) })

async function seedPerson() {
  await db.insert(person).values({ id: 'kidp', sweepId: 'default', name: 'Kid Kelly', short: 'Kid', initials: 'KK', avColor: '#abc' })
}

test('a new person defaults to adult', async () => {
  await seedPerson()
  const [row] = await db.select().from(person).where(eq(person.id, 'kidp'))
  expect(row.adult).toBe(true)
})

test('admin can mark a person as a minor (adult=false) and it is returned serialized', async () => {
  await seedPerson()
  const res = await app.inject({ method: 'PATCH', url: '/api/admin/people/kidp', headers: auth, payload: { adult: false } })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({ id: 'kidp', adult: false })
  const [row] = await db.select().from(person).where(eq(person.id, 'kidp'))
  expect(row.adult).toBe(false)
})

test('the adult flag flows through /api/bootstrap', async () => {
  await seedPerson()
  await app.inject({ method: 'PATCH', url: '/api/admin/people/kidp', headers: auth, payload: { adult: false } })
  const b = (await app.inject({ method: 'GET', url: '/api/bootstrap', headers: auth })).json()
  expect(b.people.find((p) => p.id === 'kidp')).toMatchObject({ adult: false })
})

test('a non-admin (member) cannot change the age gate', async () => {
  await seedPerson()
  // anonymous localhost request resolves to the default sweep as a member → 403
  const res = await app.inject({ method: 'PATCH', url: '/api/admin/people/kidp', payload: { adult: false } })
  expect(res.statusCode).toBe(403)
})

test('patching an unknown person is 404', async () => {
  const res = await app.inject({ method: 'PATCH', url: '/api/admin/people/nope', headers: auth, payload: { adult: false } })
  expect(res.statusCode).toBe(404)
})
