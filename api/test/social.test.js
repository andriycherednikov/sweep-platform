import { expect, test, afterAll, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { support, person, team, fixture } from '../src/db/schema.js'

const { pool, db } = openTestDb()
const published = []
const app = buildApp(db, { publish: (e) => published.push(e) })
afterAll(async () => { await app.close(); await pool.end() })

// A known fixture + two people the seed already provides; assert they exist, else skip-safe pick.
beforeEach(async () => {
  await db.delete(support); published.length = 0
})

async function aFixture() {
  const [f] = await db.select().from(fixture).limit(1)
  return f
}
async function twoPeople() {
  const ps = await db.select().from(person).limit(2)
  return ps
}

test('GET /api/social returns an empty support map when nobody has acted', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/social' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ support: {} })
})

test('GET /api/social groups support by fixture→person→team', async () => {
  const f = await aFixture()
  const [p1] = await twoPeople()
  await db.insert(support).values({ sweepId: 'default', fixtureId: f.id, personId: p1.id, teamCode: f.t1Code })
  const body = (await app.inject({ method: 'GET', url: '/api/social' })).json()
  expect(body.support[f.id][p1.id]).toBe(f.t1Code)
})

test('POST /api/support sets, switches, and toggles-off backing; publishes each time', async () => {
  const f = await aFixture()
  const [p1] = await twoPeople()

  const set = await app.inject({ method: 'POST', url: '/api/support', payload: { fixtureId: f.id, personId: p1.id, teamCode: f.t1Code } })
  expect(set.json()).toMatchObject({ fixtureId: f.id, personId: p1.id, supporting: f.t1Code })

  const switched = await app.inject({ method: 'POST', url: '/api/support', payload: { fixtureId: f.id, personId: p1.id, teamCode: f.t2Code } })
  expect(switched.json().supporting).toBe(f.t2Code)

  const off = await app.inject({ method: 'POST', url: '/api/support', payload: { fixtureId: f.id, personId: p1.id, teamCode: f.t2Code } })
  expect(off.json().supporting).toBe(null)

  const supportEvents = published.filter((e) => e.type === 'support')
  expect(supportEvents).toHaveLength(3)
  // events carry who + which team + whether it was a fresh pick or a switch
  expect(supportEvents[0]).toMatchObject({ fixtureId: f.id, personId: p1.id, supporting: f.t1Code, action: 'pick' })
  expect(supportEvents[1]).toMatchObject({ personId: p1.id, supporting: f.t2Code, action: 'switch' })
  expect(supportEvents[2]).toMatchObject({ personId: p1.id, supporting: null, action: 'remove' })
})

test('POST /api/support 400s when teamCode is not one of the fixture teams', async () => {
  const f = await aFixture()
  const [p1] = await twoPeople()
  const bad = await app.inject({ method: 'POST', url: '/api/support', payload: { fixtureId: f.id, personId: p1.id, teamCode: 'zz' } })
  expect(bad.statusCode).toBe(400)
})

test('POST /api/support accepts a DRAW pick on a group-stage fixture', async () => {
  const f = await aFixture()
  await db.update(fixture).set({ stage: 'group' }).where(eq(fixture.id, f.id))
  const [p1] = await twoPeople()
  const res = await app.inject({ method: 'POST', url: '/api/support', payload: { fixtureId: f.id, personId: p1.id, teamCode: 'DRAW' } })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({ fixtureId: f.id, personId: p1.id, supporting: 'DRAW' })

  const body = (await app.inject({ method: 'GET', url: '/api/social' })).json()
  expect(body.support[f.id][p1.id]).toBe('DRAW')
})

test('POST /api/support rejects a DRAW pick on a knockout fixture', async () => {
  const f = await aFixture()
  await db.update(fixture).set({ stage: 'r16' }).where(eq(fixture.id, f.id))
  const [p1] = await twoPeople()
  const res = await app.inject({ method: 'POST', url: '/api/support', payload: { fixtureId: f.id, personId: p1.id, teamCode: 'DRAW' } })
  expect(res.statusCode).toBe(400)
  expect(res.json()).toEqual({ error: 'invalid_team' })
})
