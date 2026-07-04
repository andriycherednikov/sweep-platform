import { expect, test, afterAll } from 'vitest'
import { and, eq } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { sweep, person, event, competition, competitor, bet, coinLedger } from '../src/db/schema.js'
import { detailMerge } from '../src/db/event-shape.js'

const { pool, db } = openTestDb()
const published = []
const PASS = '1234'
const app = buildApp(db, { sessionSecret: 'test-secret', platformHost: 'platform.test', publish: (e) => published.push(e), adminHash: bcrypt.hashSync(PASS, 8) })
afterAll(async () => {
  await db.delete(bet).where(eq(bet.sweepId, 'sw_wgnba'))
  await db.delete(coinLedger).where(eq(coinLedger.sweepId, 'sw_wgnba'))
  await db.delete(person).where(eq(person.sweepId, 'sw_wgnba'))
  await db.delete(sweep).where(eq(sweep.id, 'sw_wgnba'))
  await db.delete(event).where(eq(event.competitionId, 'ck_wgnba'))
  await db.delete(competitor).where(eq(competitor.competitionId, 'ck_wgnba'))
  await db.delete(competition).where(eq(competition.id, 'ck_wgnba'))
  await app.close(); await pool.end()
})

// mirrors admin-auth.test.js / admin-settle-stale.test.js: passcode login mints the
// DEFAULT sweep's admin cookie (the default sweep has no adminToken to key off of).
async function adminSession() {
  const res = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { passcode: PASS } })
  return res.headers['set-cookie']
}

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

test('admin toggle flips wageringEnabled for the resolved sweep', async () => {
  const adminCookie = await adminSession()
  const off = await app.inject({ method: 'POST', url: '/api/admin/wagering', headers: { cookie: adminCookie }, payload: { enabled: false } })
  expect(off.statusCode).toBe(200)
  expect(off.json()).toEqual({ wageringEnabled: false })
  const [row] = await db.select().from(sweep).where(eq(sweep.id, 'default'))
  expect(row.wageringEnabled).toBe(false)
  const on = await app.inject({ method: 'POST', url: '/api/admin/wagering', headers: { cookie: adminCookie }, payload: { enabled: true } })
  expect(on.json()).toEqual({ wageringEnabled: true })
})

test('bootstrap exposes wageringEnabled additively', async () => {
  const body = (await app.inject({ method: 'GET', url: '/api/bootstrap' })).json()
  expect(body.wageringEnabled).toBe(true)
})

test('no-draw sport: 1x2 and DRAW are refused at validation', async () => {
  // minimal basketball world: competition + two competitors + one upcoming event with an ml market stored
  await db.insert(competition).values({ id: 'ck_wgnba', provider: 'apibasketball', sport: 'basketball', leagueId: '12', season: '2023-2024', format: 'league', name: 'NBA vt' })
  await db.insert(competitor).values([
    { id: 'cp_ck_wgnba_BOS', competitionId: 'ck_wgnba', code: 'BOS', name: 'Boston', color: '#0f0' },
    { id: 'cp_ck_wgnba_DAL', competitionId: 'ck_wgnba', code: 'DAL', name: 'Dallas', color: '#00f' },
  ])
  await db.insert(event).values({ id: 'evt_wgnba1', competitionId: 'ck_wgnba', c1Code: 'BOS', c2Code: 'DAL', startUtc: new Date(Date.now() + 3600_000), status: 'upcoming', stage: 'group',
    detail: { markets: {
      ml: { label: 'Moneyline', book: 'TestBook', selections: [ { key: 'HOME', label: 'Boston', odds: 1.6 }, { key: 'AWAY', label: 'Dallas', odds: 2.3 } ] },
      '1x2': { label: 'poisoned', book: 'TestBook', selections: [ { key: 'HOME', label: 'H', odds: 1.6 }, { key: 'DRAW', label: 'D', odds: 9.9 }, { key: 'AWAY', label: 'A', odds: 2.3 } ] },
    } } })
  const mt = 'mt_wgnba'
  await db.insert(sweep).values({ id: 'sw_wgnba', name: 'NBA WG', kind: 'token', memberToken: mt, adminToken: 'at_wgnba', competitionId: 'ck_wgnba', wageringEnabled: true })
  await db.insert(person).values({ id: 'pn_wgnba', sweepId: 'sw_wgnba', name: 'Nia', short: 'Nia', initials: 'NI', avColor: '#111' })
  const cookie = (await app.inject({ method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token: mt } })).headers['set-cookie']
  const H = { host: 'platform.test', cookie }

  // even with a (poisoned) stored 1x2 market, validation refuses it for basketball
  const r1 = await app.inject({ method: 'POST', url: '/api/bet', headers: H, payload: { fixtureId: 'evt_wgnba1', personId: 'pn_wgnba', market: '1x2', selection: 'DRAW', stake: 10 } })
  expect(r1.statusCode).toBe(400)
  expect(r1.json()).toEqual({ error: 'market_not_offered' })
  // the ml spine market places fine
  const r2 = await app.inject({ method: 'POST', url: '/api/bet', headers: H, payload: { fixtureId: 'evt_wgnba1', personId: 'pn_wgnba', market: 'ml', selection: 'HOME', stake: 10 } })
  expect(r2.statusCode).toBe(200)
  // parlay leg with a draw market on basketball is refused too
  const r3 = await app.inject({ method: 'POST', url: '/api/parlay', headers: H, payload: { personId: 'pn_wgnba', stake: 10, legs: [ { fixtureId: 'evt_wgnba1', market: 'ml', selection: 'HOME' }, { fixtureId: 'evt_wgnba1', market: '1x2', selection: 'HOME' } ] } })
  expect(r3.statusCode).toBe(400)
  expect(r3.json()).toMatchObject({ error: 'market_not_offered' })
})
