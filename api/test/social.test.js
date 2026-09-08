import { expect, test, afterAll, beforeEach, beforeAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { memberClient, seatFor } from './helpers/session.js'
import { account, support, person, event } from '../src/db/schema.js'

const { pool, db } = openTestDb()
const published = []
const app = buildApp(db, { publish: (e) => published.push(e) })
let client, seat, pair
beforeAll(async () => {
  client = await memberClient(app)
  // Cache the pair once: select-limit-2 has no ORDER BY, and the caller's seat has to
  // stay the same row across every test in the file.
  pair = await db.select().from(person).limit(2)
  seat = await seatFor(db, pair[0].id)
})
afterAll(async () => {
  await db.update(person).set({ accountId: null, claimedAt: null }).where(eq(person.id, pair[0].id))
  await db.delete(account).where(eq(account.id, `ac_seat_${pair[0].id}`))
  await app.close(); await pool.end()
})

// A known fixture + two people the seed already provides; assert they exist, else skip-safe pick.
beforeEach(async () => {
  await db.delete(support); published.length = 0
})

async function aFixture() {
  const [f] = await db.select().from(event).limit(1)
  return f
}
async function twoPeople() {
  return pair
}

test('GET /api/social returns an empty support map when nobody has acted', async () => {
  const res = await client.inject({ method: 'GET', url: '/api/social' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ support: {} })
})

test('GET /api/social groups support by fixture→person→team', async () => {
  const f = await aFixture()
  const [p1] = await twoPeople()
  await db.insert(support).values({ sweepId: 'default', fixtureId: f.id, personId: p1.id, teamCode: f.c1Code })
  const body = (await client.inject({ method: 'GET', url: '/api/social' })).json()
  expect(body.support[f.id][p1.id]).toBe(f.c1Code)
})

test('POST /api/support sets, switches, and toggles-off backing; publishes each time', async () => {
  const f = await aFixture()
  const [p1] = await twoPeople()

  const set = await client.inject({ method: 'POST', url: '/api/support', headers: seat, payload: { fixtureId: f.id, teamCode: f.c1Code } })
  expect(set.json()).toMatchObject({ fixtureId: f.id, personId: p1.id, supporting: f.c1Code })

  const switched = await client.inject({ method: 'POST', url: '/api/support', headers: seat, payload: { fixtureId: f.id, teamCode: f.c2Code } })
  expect(switched.json().supporting).toBe(f.c2Code)

  const off = await client.inject({ method: 'POST', url: '/api/support', headers: seat, payload: { fixtureId: f.id, teamCode: f.c2Code } })
  expect(off.json().supporting).toBe(null)

  const supportEvents = published.filter((e) => e.type === 'support')
  expect(supportEvents).toHaveLength(3)
  // events carry who + which team + whether it was a fresh pick or a switch
  expect(supportEvents[0]).toMatchObject({ fixtureId: f.id, personId: p1.id, supporting: f.c1Code, action: 'pick' })
  expect(supportEvents[1]).toMatchObject({ personId: p1.id, supporting: f.c2Code, action: 'switch' })
  expect(supportEvents[2]).toMatchObject({ personId: p1.id, supporting: null, action: 'remove' })
})

test('POST /api/support 400s when teamCode is not one of the fixture teams', async () => {
  const f = await aFixture()
  const [p1] = await twoPeople()
  const bad = await client.inject({ method: 'POST', url: '/api/support', headers: seat, payload: { fixtureId: f.id, teamCode: 'zz' } })
  expect(bad.statusCode).toBe(400)
})

test('POST /api/support accepts a DRAW pick on a group-stage fixture', async () => {
  const f = await aFixture()
  await db.update(event).set({ stage: 'group' }).where(eq(event.id, f.id))
  const [p1] = await twoPeople()
  const res = await client.inject({ method: 'POST', url: '/api/support', headers: seat, payload: { fixtureId: f.id, teamCode: 'DRAW' } })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({ fixtureId: f.id, personId: p1.id, supporting: 'DRAW' })

  const body = (await client.inject({ method: 'GET', url: '/api/social' })).json()
  expect(body.support[f.id][p1.id]).toBe('DRAW')
})

test('POST /api/support rejects a DRAW pick on a knockout fixture', async () => {
  const f = await aFixture()
  await db.update(event).set({ stage: 'r16' }).where(eq(event.id, f.id))
  const [p1] = await twoPeople()
  const res = await client.inject({ method: 'POST', url: '/api/support', headers: seat, payload: { fixtureId: f.id, teamCode: 'DRAW' } })
  expect(res.statusCode).toBe(400)
  expect(res.json()).toEqual({ error: 'invalid_team' })
})

test('a personId in the body cannot set someone else\'s pick', async () => {
  const f = await aFixture()
  const [p1, p2] = await twoPeople()
  const res = await client.inject({
    method: 'POST', url: '/api/support', headers: seat,
    payload: { fixtureId: f.id, personId: p2.id, teamCode: f.c1Code },
  })
  expect(res.statusCode).toBe(200)
  expect(res.json().personId).toBe(p1.id)
  const rows = await db.select().from(support).where(eq(support.personId, p2.id))
  expect(rows).toHaveLength(0)
})

test('a link-holder with no seat cannot pick', async () => {
  const f = await aFixture()
  const res = await client.inject({
    method: 'POST', url: '/api/support', payload: { fixtureId: f.id, teamCode: f.c1Code },
  })
  expect(res.statusCode).toBe(403)
  expect(res.json()).toEqual({ error: 'no_seat' })
})
