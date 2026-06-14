import { expect, test, afterAll, beforeAll } from 'vitest'
import { ne } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { person, ownership } from '../src/db/schema.js'

const { pool, db } = openTestDb()
const app = buildApp(db, { sessionSecret: 'test-secret', platformHost: 'platform.test', superToken: 'super-xyz' })
beforeAll(async () => { await app.ready() })
afterAll(async () => {
  // Leave the shared test DB as we found it (seed.test.js counts persons globally).
  await db.delete(ownership).where(ne(ownership.sweepId, 'default'))
  await db.delete(person).where(ne(person.sweepId, 'default'))
  await app.close(); await pool.end()
})

async function superCookie() {
  const res = await app.inject({ method: 'POST', url: '/api/super/session', payload: { token: 'super-xyz' } })
  return res.headers['set-cookie']
}

test('super session requires the right token', async () => {
  expect((await app.inject({ method: 'POST', url: '/api/super/session', payload: { token: 'nope' } })).statusCode).toBe(401)
  expect((await app.inject({ method: 'POST', url: '/api/super/session', payload: { token: 'super-xyz' } })).statusCode).toBe(200)
})

test('super can create a sweep and gets two tokens + links', async () => {
  const cookie = await superCookie()
  const res = await app.inject({ method: 'POST', url: '/api/super/sweeps', headers: { cookie }, payload: { name: 'Acme' } })
  expect(res.statusCode).toBe(201)
  const body = res.json()
  expect(body.name).toBe('Acme')
  expect(body.memberToken).toMatch(/^[0-9A-Za-z]{22}$/)
  expect(body.adminToken).toMatch(/^[0-9A-Za-z]{22}$/)
  expect(body.memberLink).toContain(`/g/${body.memberToken}`)
})

test('creating a sweep without a super cookie is 401', async () => {
  expect((await app.inject({ method: 'POST', url: '/api/super/sweeps', payload: { name: 'X' } })).statusCode).toBe(401)
})

test('super can rotate a sweep member token (old token stops working)', async () => {
  const cookie = await superCookie()
  const created = (await app.inject({ method: 'POST', url: '/api/super/sweeps', headers: { cookie }, payload: { name: 'Rot' } })).json()
  const oldTok = created.memberToken
  const rot = await app.inject({ method: 'POST', url: `/api/super/sweeps/${created.id}/rotate`, headers: { cookie }, payload: { which: 'member' } })
  expect(rot.statusCode).toBe(200)
  const newTok = rot.json().memberToken
  expect(newTok).not.toBe(oldTok)
  const old = await app.inject({ method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token: oldTok } })
  expect(old.statusCode).toBe(404)
})

async function adminCookieFor(superCk) {
  const created = (await app.inject({ method: 'POST', url: '/api/super/sweeps', headers: { cookie: superCk }, payload: { name: 'Draw' } })).json()
  const sess = await app.inject({ method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token: created.adminToken } })
  return { cookie: sess.headers['set-cookie'], id: created.id }
}

test('group admin creates a person and assigns a team', async () => {
  const su = await superCookie()
  const { cookie } = await adminCookieFor(su)
  const h = { host: 'platform.test', cookie }
  const created = await app.inject({ method: 'POST', url: '/api/admin/people', headers: h, payload: { name: 'Zoe', short: 'Zoe', initials: 'Z', av: '#abc' } })
  expect(created.statusCode).toBe(201)
  const personId = created.json().id
  const assign = await app.inject({ method: 'POST', url: '/api/admin/ownership', headers: h, payload: { personId, teamCode: 'br' } })
  expect(assign.statusCode).toBe(201)
  const people = (await app.inject({ method: 'GET', url: '/api/people', headers: h })).json()
  expect(people.find((p) => p.id === personId).teams).toContain('br')
})

test('a member cookie cannot reach group-admin routes (403)', async () => {
  const su = await superCookie()
  const created = (await app.inject({ method: 'POST', url: '/api/super/sweeps', headers: { cookie: su }, payload: { name: 'Mem' } })).json()
  const sess = await app.inject({ method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token: created.memberToken } })
  const res = await app.inject({ method: 'POST', url: '/api/admin/people', headers: { host: 'platform.test', cookie: sess.headers['set-cookie'] }, payload: { name: 'No', short: 'No', initials: 'N', av: '#000' } })
  expect(res.statusCode).toBe(403)
})

test('co-ownership allowed: two people CAN own the same team; same person twice is 409', async () => {
  const su = await superCookie()
  const { cookie } = await adminCookieFor(su)
  const h = { host: 'platform.test', cookie }
  const a = (await app.inject({ method: 'POST', url: '/api/admin/people', headers: h, payload: { name: 'A', short: 'A', initials: 'A', av: '#111' } })).json()
  const b = (await app.inject({ method: 'POST', url: '/api/admin/people', headers: h, payload: { name: 'B', short: 'B', initials: 'B', av: '#222' } })).json()
  expect((await app.inject({ method: 'POST', url: '/api/admin/ownership', headers: h, payload: { personId: a.id, teamCode: 'ar' } })).statusCode).toBe(201)
  // a DIFFERENT person co-owning the same team is allowed:
  expect((await app.inject({ method: 'POST', url: '/api/admin/ownership', headers: h, payload: { personId: b.id, teamCode: 'ar' } })).statusCode).toBe(201)
  // the SAME person assigned the SAME team twice → 409 (PK violation):
  expect((await app.inject({ method: 'POST', url: '/api/admin/ownership', headers: h, payload: { personId: a.id, teamCode: 'ar' } })).statusCode).toBe(409)
})
