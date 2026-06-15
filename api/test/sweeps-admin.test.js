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

// Memoized: the super cookie is stateless ('ok'), and /api/super/session is
// rate-limited (max 10 / 15 min) — minting a fresh cookie per test would exhaust it.
let _superCookie
async function superCookie() {
  if (_superCookie) return _superCookie
  const res = await app.inject({ method: 'POST', url: '/api/super/session', payload: { token: 'super-xyz' } })
  _superCookie = res.headers['set-cookie']
  return _superCookie
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

test('super can rename a sweep and edit scoring (PATCH returns updated row)', async () => {
  const cookie = await superCookie()
  const created = (await app.inject({ method: 'POST', url: '/api/super/sweeps', headers: { cookie }, payload: { name: 'Old Name' } })).json()
  const res = await app.inject({
    method: 'PATCH', url: `/api/super/sweeps/${created.id}`, headers: { cookie },
    payload: { name: 'New Name', scoringRule: 'winner_only', coOwners: 'split' },
  })
  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.id).toBe(created.id)
  expect(body.name).toBe('New Name')
  expect(body.scoringRule).toBe('winner_only')
  expect(body.coOwners).toBe('split')
  // a follow-up GET reflects the new name
  const list = (await app.inject({ method: 'GET', url: '/api/super/sweeps', headers: { cookie } })).json()
  expect(list.find((s) => s.id === created.id).name).toBe('New Name')
})

test('PATCH a sweep without a super cookie is 401', async () => {
  const cookie = await superCookie()
  const created = (await app.inject({ method: 'POST', url: '/api/super/sweeps', headers: { cookie }, payload: { name: 'Guarded' } })).json()
  const res = await app.inject({ method: 'PATCH', url: `/api/super/sweeps/${created.id}`, payload: { name: 'Nope' } })
  expect(res.statusCode).toBe(401)
})

test('PATCH an unknown sweep id is 404', async () => {
  const cookie = await superCookie()
  const res = await app.inject({ method: 'PATCH', url: '/api/super/sweeps/sw_does_not_exist', headers: { cookie }, payload: { name: 'X' } })
  expect(res.statusCode).toBe(404)
})

test('super can un-archive a sweep; an archived sweep becomes usable again', async () => {
  const cookie = await superCookie()
  const created = (await app.inject({ method: 'POST', url: '/api/super/sweeps', headers: { cookie }, payload: { name: 'Revivable' } })).json()
  const tok = created.memberToken
  // archive it → /api/session refuses (404)
  expect((await app.inject({ method: 'POST', url: `/api/super/sweeps/${created.id}/archive`, headers: { cookie } })).statusCode).toBe(200)
  expect((await app.inject({ method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token: tok } })).statusCode).toBe(404)
  // un-archive → row active again, session works
  const un = await app.inject({ method: 'POST', url: `/api/super/sweeps/${created.id}/unarchive`, headers: { cookie } })
  expect(un.statusCode).toBe(200)
  expect(un.json()).toEqual({ id: created.id, archived: false })
  const sess = await app.inject({ method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token: tok } })
  expect(sess.statusCode).toBe(200)
  expect(sess.json().sweepId).toBe(created.id)
})

test('un-archive without a super cookie is 401', async () => {
  const cookie = await superCookie()
  const created = (await app.inject({ method: 'POST', url: '/api/super/sweeps', headers: { cookie }, payload: { name: 'GuardedUn' } })).json()
  const res = await app.inject({ method: 'POST', url: `/api/super/sweeps/${created.id}/unarchive` })
  expect(res.statusCode).toBe(401)
})

test('un-archive an unknown sweep id is 404', async () => {
  const cookie = await superCookie()
  const res = await app.inject({ method: 'POST', url: '/api/super/sweeps/sw_nope/unarchive', headers: { cookie } })
  expect(res.statusCode).toBe(404)
})

test('un-archive refuses the default sweep (kind default → 404)', async () => {
  const cookie = await superCookie()
  const res = await app.inject({ method: 'POST', url: '/api/super/sweeps/default/unarchive', headers: { cookie } })
  expect(res.statusCode).toBe(404)
})

test('bulk ownership assigns many teams in one call; /api/people reflects all', async () => {
  const su = await superCookie()
  const { cookie } = await adminCookieFor(su)
  const h = { host: 'platform.test', cookie }
  const p = (await app.inject({ method: 'POST', url: '/api/admin/people', headers: h, payload: { name: 'Bulk', short: 'Bulk', initials: 'BK', av: '#abc' } })).json()
  const items = [{ personId: p.id, teamCode: 'br' }, { personId: p.id, teamCode: 'ar' }, { personId: p.id, teamCode: 'fr' }]
  const res = await app.inject({ method: 'POST', url: '/api/admin/ownership/bulk', headers: h, payload: { items } })
  expect(res.statusCode).toBe(201)
  expect(res.json().inserted).toBe(3)
  const people = (await app.inject({ method: 'GET', url: '/api/people', headers: h })).json()
  expect(people.find((x) => x.id === p.id).teams.sort()).toEqual(['ar', 'br', 'fr'])
})

test('bulk ownership is idempotent and allows co-ownership across people', async () => {
  const su = await superCookie()
  const { cookie } = await adminCookieFor(su)
  const h = { host: 'platform.test', cookie }
  const a = (await app.inject({ method: 'POST', url: '/api/admin/people', headers: h, payload: { name: 'A', short: 'A', initials: 'A', av: '#111' } })).json()
  const b = (await app.inject({ method: 'POST', url: '/api/admin/people', headers: h, payload: { name: 'B', short: 'B', initials: 'B', av: '#222' } })).json()
  // first bulk for A: 2 inserted
  expect((await app.inject({ method: 'POST', url: '/api/admin/ownership/bulk', headers: h, payload: { items: [{ personId: a.id, teamCode: 'ar' }, { personId: a.id, teamCode: 'br' }] } })).json().inserted).toBe(2)
  // re-post an owned pair + a new one + B co-owning ar: only the new ones insert (idempotent)
  const res = await app.inject({ method: 'POST', url: '/api/admin/ownership/bulk', headers: h, payload: { items: [{ personId: a.id, teamCode: 'ar' }, { personId: a.id, teamCode: 'fr' }, { personId: b.id, teamCode: 'ar' }] } })
  expect(res.statusCode).toBe(201)
  expect(res.json().inserted).toBe(2) // a/fr and b/ar; a/ar skipped
})

test('bulk ownership rejects a personId from another sweep (400)', async () => {
  const su = await superCookie()
  const { cookie: cookieA } = await adminCookieFor(su)
  const { cookie: cookieB } = await adminCookieFor(su)
  const hA = { host: 'platform.test', cookie: cookieA }
  const hB = { host: 'platform.test', cookie: cookieB }
  const pB = (await app.inject({ method: 'POST', url: '/api/admin/people', headers: hB, payload: { name: 'Other', short: 'Other', initials: 'OT', av: '#333' } })).json()
  // admin A tries to allocate to a person belonging to sweep B
  const res = await app.inject({ method: 'POST', url: '/api/admin/ownership/bulk', headers: hA, payload: { items: [{ personId: pB.id, teamCode: 'ar' }] } })
  expect(res.statusCode).toBe(400)
  expect(res.json().error).toBe('unknown_person')
})

test('bulk ownership validates payload + guards', async () => {
  const su = await superCookie()
  const { cookie } = await adminCookieFor(su)
  const h = { host: 'platform.test', cookie }
  // empty items → 400 (schema minItems)
  expect((await app.inject({ method: 'POST', url: '/api/admin/ownership/bulk', headers: h, payload: { items: [] } })).statusCode).toBe(400)
  // no cookie on platform host → 401
  expect((await app.inject({ method: 'POST', url: '/api/admin/ownership/bulk', headers: { host: 'platform.test' }, payload: { items: [{ personId: 'x', teamCode: 'ar' }] } })).statusCode).toBe(401)
})

test('bulk delete removes only the listed pairs, scoped to the sweep', async () => {
  const su = await superCookie()
  const { cookie } = await adminCookieFor(su)
  const h = { host: 'platform.test', cookie }
  const p = (await app.inject({ method: 'POST', url: '/api/admin/people', headers: h, payload: { name: 'Del', short: 'Del', initials: 'DL', av: '#abc' } })).json()
  await app.inject({ method: 'POST', url: '/api/admin/ownership/bulk', headers: h, payload: { items: [{ personId: p.id, teamCode: 'br' }, { personId: p.id, teamCode: 'ar' }, { personId: p.id, teamCode: 'fr' }] } })
  const res = await app.inject({ method: 'DELETE', url: '/api/admin/ownership/bulk', headers: h, payload: { items: [{ personId: p.id, teamCode: 'br' }, { personId: p.id, teamCode: 'fr' }] } })
  expect(res.statusCode).toBe(200)
  expect(res.json().removed).toBe(2)
  const people = (await app.inject({ method: 'GET', url: '/api/people', headers: h })).json()
  expect(people.find((x) => x.id === p.id).teams).toEqual(['ar'])
})
