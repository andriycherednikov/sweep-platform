import { expect, test, afterAll } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { sweep, person, event } from '../src/db/schema.js'
import { detailMerge } from '../src/db/event-shape.js'

const { pool, db } = openTestDb()
const published = []
const app = buildApp(db, { sessionSecret: 'test-secret', platformHost: 'platform.test', publish: (e) => published.push(e) })
afterAll(async () => { await app.close(); await pool.end() })

test('sweep.wageringEnabled defaults false; seeded default sweep is true', async () => {
  const [dflt] = await db.select().from(sweep).where(eq(sweep.id, 'default'))
  expect(dflt.wageringEnabled).toBe(true) // WC default behavior unchanged
  await db.insert(sweep).values({ id: 'sw_wgtest', name: 'W', kind: 'token', memberToken: 'mt_wgtest', adminToken: 'at_wgtest', competitionId: dflt.competitionId })
  const [row] = await db.select().from(sweep).where(eq(sweep.id, 'sw_wgtest'))
  expect(row.wageringEnabled).toBe(false) // new sweeps OFF unless opted in
  await db.delete(sweep).where(eq(sweep.id, 'sw_wgtest'))
})

async function bettable() {
  const [f] = await db.select().from(event).limit(1)
  const markets = { '1x2': { label: 'Match Winner', book: 'TestBook', selections: [
    { key: 'HOME', label: 'Home', odds: 2.1 }, { key: 'DRAW', label: 'Draw', odds: 3.2 }, { key: 'AWAY', label: 'Away', odds: 3.4 } ] } }
  await db.update(event).set({ status: 'upcoming', detail: detailMerge({ markets }) }).where(eq(event.id, f.id))
  return f
}
const aPerson = async () => (await db.select().from(person).limit(1))[0]
const setWagering = (on) => db.update(sweep).set({ wageringEnabled: on }).where(eq(sweep.id, 'default'))

test('wagering OFF: bet and parlay are refused with a stable error; reads stay open', async () => {
  const f = await bettable(); const p = await aPerson()
  await setWagering(false)
  try {
    const bet = await app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: f.id, personId: p.id, selection: 'HOME', stake: 10 } })
    expect(bet.statusCode).toBe(403)
    expect(bet.json()).toEqual({ error: 'wagering_disabled' })
    const par = await app.inject({ method: 'POST', url: '/api/parlay', payload: { personId: p.id, stake: 10, legs: [ { fixtureId: f.id, selection: 'HOME' }, { fixtureId: f.id, market: 'ou25', selection: 'OVER' } ] } })
    expect(par.statusCode).toBe(403)
    expect(par.json()).toEqual({ error: 'wagering_disabled' })
    // wallet history stays readable
    expect((await app.inject({ method: 'GET', url: '/api/coins' })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `/api/coins/ledger?personId=${p.id}` })).statusCode).toBe(200)
  } finally { await setWagering(true) }
})

test('wagering ON (default sweep as backfilled/seeded): bet placement works unchanged', async () => {
  const f = await bettable(); const p = await aPerson()
  const res = await app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: f.id, personId: p.id, selection: 'HOME', stake: 10 } })
  expect(res.statusCode).toBe(200)
  expect(res.json().bet.market).toBe('1x2') // frozen wire: market keys unchanged
})

test('self-excluded person cannot bet or parlay server-side; expiry restores', async () => {
  const f = await bettable(); const p = await aPerson()
  await db.update(person).set({ excludedUntil: new Date(Date.now() + 86_400_000) }).where(eq(person.id, p.id))
  try {
    const bet = await app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: f.id, personId: p.id, selection: 'HOME', stake: 10 } })
    expect(bet.statusCode).toBe(403)
    expect(bet.json()).toEqual({ error: 'self_excluded' })
    const par = await app.inject({ method: 'POST', url: '/api/parlay', payload: { personId: p.id, stake: 10, legs: [ { fixtureId: f.id, selection: 'HOME' }, { fixtureId: f.id, market: 'ou25', selection: 'OVER' } ] } })
    expect(par.statusCode).toBe(403)
    expect(par.json()).toEqual({ error: 'self_excluded' })
    // expired exclusion no longer blocks
    await db.update(person).set({ excludedUntil: new Date(Date.now() - 1000) }).where(eq(person.id, p.id))
    const again = await app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: f.id, personId: p.id, selection: 'HOME', stake: 10 } })
    expect(again.statusCode).toBe(200)
  } finally { await db.update(person).set({ excludedUntil: null }).where(eq(person.id, p.id)) }
})
