import { expect, test, afterAll, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { watch, support, person, team, fixture } from '../src/db/schema.js'

const { pool, db } = openTestDb()
const published = []
const app = buildApp(db, { publish: (e) => published.push(e) })
afterAll(async () => { await app.close(); await pool.end() })

// A known fixture + two people the seed already provides; assert they exist, else skip-safe pick.
beforeEach(async () => {
  await db.delete(watch); await db.delete(support); published.length = 0
})

async function aFixture() {
  const [f] = await db.select().from(fixture).limit(1)
  return f
}
async function twoPeople() {
  const ps = await db.select().from(person).limit(2)
  return ps
}

test('GET /api/social returns empty maps when nobody has acted', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/social' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ watch: {}, support: {} })
})

test('GET /api/social groups watchers by fixture and support by fixture→person→team', async () => {
  const f = await aFixture()
  const [p1, p2] = await twoPeople()
  await db.insert(watch).values([{ fixtureId: f.id, personId: p1.id }, { fixtureId: f.id, personId: p2.id }])
  await db.insert(support).values({ fixtureId: f.id, personId: p1.id, teamCode: f.t1Code })
  const body = (await app.inject({ method: 'GET', url: '/api/social' })).json()
  expect(new Set(body.watch[f.id])).toEqual(new Set([p1.id, p2.id]))
  expect(body.support[f.id][p1.id]).toBe(f.t1Code)
})

test('POST /api/watch toggles the row and publishes a watch event', async () => {
  const f = await aFixture()
  const [p1] = await twoPeople()

  const on = await app.inject({ method: 'POST', url: '/api/watch', payload: { fixtureId: f.id, personId: p1.id } })
  expect(on.json()).toMatchObject({ fixtureId: f.id, personId: p1.id, watching: true })

  const off = await app.inject({ method: 'POST', url: '/api/watch', payload: { fixtureId: f.id, personId: p1.id } })
  expect(off.json().watching).toBe(false)

  expect(published).toEqual([{ type: 'watch', fixtureId: f.id }, { type: 'watch', fixtureId: f.id }])
})

test('POST /api/watch 400s on unknown fixture or person', async () => {
  const f = await aFixture()
  const [p1] = await twoPeople()
  expect((await app.inject({ method: 'POST', url: '/api/watch', payload: { fixtureId: 'nope', personId: p1.id } })).statusCode).toBe(400)
  expect((await app.inject({ method: 'POST', url: '/api/watch', payload: { fixtureId: f.id, personId: 'nope' } })).statusCode).toBe(400)
})

test('POST /api/watch 400s on a malformed body (schema)', async () => {
  expect((await app.inject({ method: 'POST', url: '/api/watch', payload: { fixtureId: 'x' } })).statusCode).toBe(400)
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

  expect(published.filter((e) => e.type === 'support')).toHaveLength(3)
})

test('POST /api/support 400s when teamCode is not one of the fixture teams', async () => {
  const f = await aFixture()
  const [p1] = await twoPeople()
  const bad = await app.inject({ method: 'POST', url: '/api/support', payload: { fixtureId: f.id, personId: p1.id, teamCode: 'zz' } })
  expect(bad.statusCode).toBe(400)
})
