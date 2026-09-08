import { expect, test, afterAll, beforeAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { newToken } from '../src/sweeps/tokens.js'
import { sweep, person, ownership, support, event, account, accountSession } from '../src/db/schema.js'
import { memberClient, adminHeaders, seatFor } from './helpers/session.js'

const { pool, db } = openTestDb()
const memberB = newToken()
const app = buildApp(db, { sessionSecret: 'test-secret' })
let client, seatB
beforeAll(async () => { client = await memberClient(app) })

/** The owner account adminHeaders minted for `sweepId`, once its sweep is gone. */
async function dropOwner(sweepId) {
  const id = `ac_own_${sweepId}`
  await db.delete(accountSession).where(eq(accountSession.accountId, id))
  await db.delete(account).where(eq(account.id, id))
}

async function sessionCookie(token) {
  const res = await app.inject({ method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token } })
  return res.headers['set-cookie']
}

beforeAll(async () => {
  await app.ready()
  // competitionId: routes scope competitor/ranking reads by req.sweep.competitionId (Task 6);
  // this fixture is inserted directly (bypassing POST /api/super/sweeps' default-competition
  // binding from Task 16), so it still sets one explicitly.
  await db.insert(sweep).values({ id: 'sw_b', name: 'B', kind: 'token', memberToken: memberB, competitionId: 'apifootball:1:2026' })
  await db.insert(person).values({ id: 'pb1', sweepId: 'sw_b', name: 'Bee', short: 'Bee', initials: 'B', avColor: '#111' })
  await db.insert(ownership).values({ sweepId: 'sw_b', personId: 'pb1', competitorId: 'cp_apifootball:1:2026_hr' })
  seatB = await seatFor(db, 'pb1')
})
afterAll(async () => {
  // Leave the shared test DB as we found it (seed.test.js counts persons globally).
  await db.delete(support).where(eq(support.sweepId, 'sw_b'))
  await db.delete(ownership).where(eq(ownership.sweepId, 'sw_b'))
  await db.delete(person).where(eq(person.sweepId, 'sw_b'))
  await db.delete(sweep).where(eq(sweep.id, 'sw_b'))
  await db.delete(accountSession).where(eq(accountSession.accountId, 'ac_seat_pb1'))
  await db.delete(account).where(eq(account.id, 'ac_seat_pb1'))
  await dropOwner('sw_b')
  await app.close(); await pool.end()
})

test('default-host bootstrap returns only the default sweep people', async () => {
  const body = (await client.inject({ method: 'GET', url: '/api/bootstrap' })).json()
  expect(body.people.every((p) => p.id !== 'pb1')).toBe(true)
  expect(body.people).toHaveLength(16)
})

test('sweep B (platform host + cookie) sees only its own person', async () => {
  const cookie = await sessionCookie(memberB)
  const body = (await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { host: 'platform.test', cookie } })).json()
  expect(body.people).toHaveLength(1)
  expect(body.people[0].id).toBe('pb1')
  expect(body.ownership.pb1).toEqual(['hr'])
})

test('platform host with no cookie is 401 on scoped data', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { host: 'platform.test' } })
  expect(res.statusCode).toBe(401)
})

test('a support pick in sweep B is invisible to the default sweep', async () => {
  const cookie = await sessionCookie(memberB)
  const [m0] = await db.select().from(event).where(eq(event.id, 'm0'))
  await app.inject({ method: 'POST', url: '/api/support', headers: { host: 'platform.test', cookie, ...seatB },
    payload: { fixtureId: 'm0', teamCode: m0.c1Code } })
  // default host social must not contain pb1's pick
  const def = (await client.inject({ method: 'GET', url: '/api/social' })).json()
  const all = Object.values(def.support).flatMap((m) => Object.keys(m))
  expect(all).not.toContain('pb1')
  // sweep B social shows it
  const b = (await app.inject({ method: 'GET', url: '/api/social', headers: { host: 'platform.test', cookie } })).json()
  expect(b.support.m0.pb1).toBe(m0.c1Code)
})

test('approved photos are scoped per sweep', async () => {
  // default sweep has seeded approved fan photos; sweep B has none
  const cookie = await sessionCookie(memberB)
  const bPhotos = (await app.inject({ method: 'GET', url: '/api/photos', headers: { host: 'platform.test', cookie } })).json()
  expect(bPhotos).toEqual([])
  const defPhotos = (await client.inject({ method: 'GET', url: '/api/photos' })).json()
  expect(defPhotos.length).toBeGreaterThan(0)
})

test('GET /api/teams/:code only returns owners from the requesting sweep', async () => {
  // default host: owners of 'hr' must NOT include sweep B's pb1
  const def = (await client.inject({ method: 'GET', url: '/api/teams/hr' })).json()
  expect(def.owners.some((o) => o.id === 'pb1')).toBe(false)
  expect(def.owners.length).toBeGreaterThan(0) // default sweep does have hr owners
  // sweep B: owners of 'hr' == exactly [pb1]
  const cookie = await sessionCookie(memberB)
  const b = (await app.inject({ method: 'GET', url: '/api/teams/hr', headers: { host: 'platform.test', cookie } })).json()
  expect(b.owners.map((o) => o.id)).toEqual(['pb1'])
})

test('GET /api/teams/:code requires a sweep (401 on platform host w/o cookie)', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/teams/hr', headers: { host: 'platform.test' } })
  expect(res.statusCode).toBe(401)
})

test('GET /api/fixtures?person= does not read ownership cross-sweep', async () => {
  // pb1 (sweep B) owns 'hr'. On the DEFAULT host, pb1 is unknown, so the person filter
  // must yield no hr-derived fixtures (cannot infer sweep B ownership from the default sweep).
  const def = (await client.inject({ method: 'GET', url: '/api/fixtures?person=pb1' })).json()
  // pb1 has no ownership in the default sweep → filter yields empty
  expect(def).toEqual([])
})

test('group admin can rename a person in their own sweep (PATCH)', async () => {
  // admin of sweep B = the account that owns it, proven per request
  const h = await adminHeaders(app, db, 'sw_b')
  const res = await app.inject({
    method: 'PATCH', url: '/api/admin/people/pb1', headers: h,
    payload: { name: 'Beatrice', short: 'Bea', initials: 'BE' },
  })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ id: 'pb1', name: 'Beatrice', short: 'Bea', initials: 'BE', adult: true })
  // a scoped read reflects the rename
  const body = (await app.inject({ method: 'GET', url: '/api/bootstrap', headers: h })).json()
  expect(body.people.find((p) => p.id === 'pb1').name).toBe('Beatrice')
})

test('renaming a person from another sweep is 404 (cross-sweep scoping)', async () => {
  // no cookie at all on the platform host → unauthorized (401), pb1 untouched
  const res = await app.inject({
    method: 'PATCH', url: '/api/admin/people/pb1', headers: { host: 'platform.test' },
    payload: { name: 'Hijack' },
  })
  expect(res.statusCode).toBe(401)
  const [stillBea] = await db.select().from(person).where(eq(person.id, 'pb1'))
  expect(stillBea.name).toBe('Beatrice')
})

test('an admin of one sweep cannot rename a person in another sweep (404 not 200)', async () => {
  // a fresh sweep C with its own owner. Inserted directly: an operator cannot mint one.
  await db.insert(sweep).values({
    id: 'sw_c', name: 'C', kind: 'token', memberToken: newToken(),
    competitionId: 'apifootball:1:2026',
  })
  const hC = await adminHeaders(app, db, 'sw_c')
  // sweep C admin tries to rename pb1 (lives in sw_b) → invisible → 404
  const res = await app.inject({
    method: 'PATCH', url: '/api/admin/people/pb1', headers: hC,
    payload: { name: 'Hijack' },
  })
  expect(res.statusCode).toBe(404)
  const [stillBea] = await db.select().from(person).where(eq(person.id, 'pb1'))
  expect(stillBea.name).toBe('Beatrice')
  // cleanup sweep C
  await db.delete(sweep).where(eq(sweep.id, 'sw_c'))
  await dropOwner('sw_c')
})
