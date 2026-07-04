import { test, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { fakeStripe } from './helpers/fake-stripe.js'
import { buildApp } from '../src/app.js'
import { account, accountSession, catalogLeague, competition, competitor, event, ranking, sweep } from '../src/db/schema.js'
import { createRecordedBasketballProvider } from '../src/providers/recorded-basketball-provider.js'

const { pool, db } = openTestDb()
const loadB = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apibasketball/${n}.json`, import.meta.url)))
const NBA_ID = 'apibasketball:12:2023-2024'
let feedDown = false // when true, the provider's roster fetch throws — simulates a feed hiccup mid-provision
let gameIdOffset = false // second-season feed: real seasons carry fresh provider game ids (same ids would trip the c6a712d collision guard)
const recordedB = () => {
  const games = loadB('games')
  if (gameIdOffset) for (const g of games.response) g.id += 9_000_000
  return createRecordedBasketballProvider({ leagues: loadB('leagues'), teams: loadB('teams'), games, standings: loadB('standings') })
}
const stripeFake = fakeStripe()
const app = buildApp(db, {
  sessionSecret: 'test-secret', platformHost: 'platform.test', stripe: stripeFake,
  providerFor: (comp) => {
    if (comp.provider !== 'apibasketball') throw new Error(`unexpected provider ${comp.provider}`)
    const p = recordedB()
    return feedDown ? { ...p, fetchCompetitors: async () => { throw new Error('ECONNRESET internal feed detail') } } : p
  },
})
const M = { headers: { 'x-account-token': 'swsession' } }
const FAIL_ID = 'apibasketball:12:2022-2023'

beforeAll(async () => {
  await app.ready()
  await db.insert(account).values({ id: 'ac_sw', email: 'sw@x.test' }).onConflictDoNothing()
  await db.insert(account).values({ id: 'ac_fail', email: 'fail@x.test' }).onConflictDoNothing()
  await db.insert(accountSession).values({ token: 'swsession', accountId: 'ac_sw', expiresAt: new Date(Date.now() + 3600_000) })
  await db.insert(accountSession).values({ token: 'failsession', accountId: 'ac_fail', expiresAt: new Date(Date.now() + 3600_000) })
  await db.insert(catalogLeague).values({
    id: 'apibasketball:12', provider: 'apibasketball', providerLeagueId: '12', name: 'NBA', type: 'League',
    country: { name: 'USA', code: 'US', flag: null }, curated: true,
    seasons: [
      { season: '2023-2024', start: '2023-10-05', end: '2024-06-18', current: false, standings: true, odds: false },
      { season: '2022-2023', start: '2022-10-18', end: '2023-06-12', current: false, standings: true, odds: false },
    ],
  }).onConflictDoNothing()
})
afterAll(async () => {
  await db.delete(sweep).where(eq(sweep.accountId, 'ac_sw'))
  await db.delete(sweep).where(eq(sweep.accountId, 'ac_fail'))
  await db.delete(sweep).where(eq(sweep.accountId, 'ac_lapse'))
  await db.delete(sweep).where(eq(sweep.accountId, 'ac_race'))
  await db.delete(sweep).where(eq(sweep.accountId, 'ac_wager'))
  for (const id of [NBA_ID, FAIL_ID]) {
    await db.delete(event).where(eq(event.competitionId, id))
    await db.delete(ranking).where(eq(ranking.competitionId, id))
    await db.delete(competitor).where(eq(competitor.competitionId, id))
    await db.delete(competition).where(eq(competition.id, id))
  }
  await db.delete(catalogLeague).where(eq(catalogLeague.id, 'apibasketball:12'))
  await db.delete(accountSession).where(eq(accountSession.token, 'swsession'))
  await db.delete(accountSession).where(eq(accountSession.token, 'failsession'))
  await db.delete(accountSession).where(eq(accountSession.token, 'lapsesession'))
  await db.delete(accountSession).where(eq(accountSession.token, 'racesession'))
  await db.delete(accountSession).where(eq(accountSession.token, 'wagersession'))
  await db.delete(account).where(eq(account.id, 'ac_sw'))
  await db.delete(account).where(eq(account.id, 'ac_fail'))
  await db.delete(account).where(eq(account.id, 'ac_lapse'))
  await db.delete(account).where(eq(account.id, 'ac_race'))
  await db.delete(account).where(eq(account.id, 'ac_wager'))
  await app.close(); await pool.end()
})

const provision = (name, over = {}) => app.inject({
  method: 'POST', url: '/api/account/sweeps', ...M,
  payload: { name, provider: 'apibasketball', leagueId: '12', season: '2023-2024', ...over },
})

test('provision creates competition once, reuses it after, owns the sweeps', async () => {
  const r1 = await provision('First')
  expect(r1.statusCode).toBe(201)
  const b1 = r1.json()
  expect(b1.competitionId).toBe(NBA_ID)
  expect(b1.memberLink).toContain(`/g/${b1.memberToken}`)
  expect((await db.select().from(event).where(eq(event.competitionId, NBA_ID))).length).toBeGreaterThan(0)

  const evCount = (await db.select().from(event).where(eq(event.competitionId, NBA_ID))).length
  const r2 = await provision('Second')
  expect(r2.statusCode).toBe(201)
  expect(r2.json().competitionId).toBe(NBA_ID) // same competition, deduped
  expect((await db.select().from(event).where(eq(event.competitionId, NBA_ID))).length).toBe(evCount)

  const list = await app.inject({ method: 'GET', url: '/api/account/sweeps', ...M })
  expect(list.json().map((s) => s.name).sort()).toEqual(['First', 'Second'])
})

test('cap blocks the 4th sweep; archive frees the slot; ownership scoped', async () => {
  expect((await provision('Third')).statusCode).toBe(201)
  const fourth = await provision('Fourth')
  expect(fourth.statusCode).toBe(403)
  expect(fourth.json()).toMatchObject({ error: 'sweep_cap', cap: 3 })

  const mine = (await app.inject({ method: 'GET', url: '/api/account/sweeps', ...M })).json()
  const target = mine.find((s) => s.name === 'Third')
  const arch = await app.inject({ method: 'POST', url: `/api/account/sweeps/${target.id}/archive`, ...M })
  expect(arch.json()).toEqual({ id: target.id, archived: true })
  expect((await provision('Fourth')).statusCode).toBe(201)

  // someone else's sweep id → 404 (the seeded default sweep is unowned)
  expect((await app.inject({ method: 'POST', url: '/api/account/sweeps/default/archive', ...M })).statusCode).toBe(404)
})

test('feed failure mid-provision → stable provision_failed, no internals leaked, no sweep', async () => {
  feedDown = true
  try {
    const res = await app.inject({ method: 'POST', url: '/api/account/sweeps', headers: { 'x-account-token': 'failsession' },
      payload: { name: 'Doomed', provider: 'apibasketball', leagueId: '12', season: '2022-2023' } })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: 'provision_failed' })
    expect(res.body).not.toContain('ECONNRESET') // internal feed error must not reach the client
    expect(await db.select().from(sweep).where(eq(sweep.accountId, 'ac_fail'))).toHaveLength(0)
    // txn rollback: the failed provision leaves NOTHING behind (P4 behavior change, approved)
    expect(await db.select().from(competition).where(eq(competition.id, FAIL_ID))).toHaveLength(0)
  } finally { feedDown = false }
})

test('eventless competition (earlier provision died mid-baseline) is re-synced before binding', async () => {
  // seed an eventless competition (as left by a dead CLI/worker baseline) — the feed-hiccup recovery path
  await db.insert(competition).values({ id: FAIL_ID, provider: 'apibasketball', sport: 'basketball', leagueId: '12', season: '2022-2023', format: 'league', name: 'NBA' }).onConflictDoNothing()
  expect(await db.select().from(event).where(eq(event.competitionId, FAIL_ID))).toHaveLength(0)

  gameIdOffset = true // a real 2022-2023 feed has its own game ids, distinct from the 2023-2024 set already synced
  let res
  try {
    res = await app.inject({ method: 'POST', url: '/api/account/sweeps', headers: { 'x-account-token': 'failsession' },
      payload: { name: 'Recovered', provider: 'apibasketball', leagueId: '12', season: '2022-2023' } })
  } finally { gameIdOffset = false }
  expect(res.statusCode).toBe(201)
  expect(res.json().competitionId).toBe(FAIL_ID)
  expect((await db.select().from(event).where(eq(event.competitionId, FAIL_ID))).length).toBeGreaterThan(0)
  expect((await db.select().from(competitor).where(eq(competitor.competitionId, FAIL_ID))).length).toBeGreaterThan(0)
})

test('validation: non-curated league, bad season, unauthenticated', async () => {
  await db.update(catalogLeague).set({ curated: false }).where(eq(catalogLeague.id, 'apibasketball:12'))
  expect((await provision('Nope')).statusCode).toBe(400)
  await db.update(catalogLeague).set({ curated: true }).where(eq(catalogLeague.id, 'apibasketball:12'))
  expect((await provision('Nope', { season: '2025-2026' })).statusCode).toBe(400) // outside free window
  expect((await provision('Nope', { leagueId: '422' })).statusCode).toBe(400)     // not in catalog
  const anon = await app.inject({ method: 'POST', url: '/api/account/sweeps', payload: { name: 'X', provider: 'apibasketball', leagueId: '12', season: '2023-2024' } })
  expect(anon.statusCode).toBe(401)
})

test('first provision stamps the account trial clock (14d), second does not move it', async () => {
  const [before] = await db.select().from(account).where(eq(account.id, 'ac_sw'))
  expect(before.trialEndsAt).toBeInstanceOf(Date) // stamped by this file's very first provision
  const first = before.trialEndsAt.getTime()
  expect(first).toBeGreaterThan(Date.now())
  expect(first).toBeLessThanOrEqual(Date.now() + 14 * 24 * 3600_000 + 60_000)
  await provision('ClockCheck') // may 403 at cap — irrelevant, clock must not move either way
  const [after] = await db.select().from(account).where(eq(account.id, 'ac_sw'))
  expect(after.trialEndsAt.getTime()).toBe(first)
})

test('expired trial and canceled subscription → 402; good standing bypasses the trial cap', async () => {
  await db.insert(account).values({ id: 'ac_lapse', email: 'lapse@x.test', trialEndsAt: new Date(Date.now() - 1000) }).onConflictDoNothing()
  await db.insert(accountSession).values({ token: 'lapsesession', accountId: 'ac_lapse', expiresAt: new Date(Date.now() + 3600_000) })
  const L = { headers: { 'x-account-token': 'lapsesession' } }
  const expired = await app.inject({ method: 'POST', url: '/api/account/sweeps', ...L,
    payload: { name: 'Nope', provider: 'apibasketball', leagueId: '12', season: '2023-2024' } })
  expect(expired.statusCode).toBe(402)
  expect(expired.json()).toEqual({ error: 'subscription_required' })

  await db.update(account).set({ subscriptionStatus: 'canceled' }).where(eq(account.id, 'ac_lapse'))
  expect((await app.inject({ method: 'POST', url: '/api/account/sweeps', ...L,
    payload: { name: 'Nope', provider: 'apibasketball', leagueId: '12', season: '2023-2024' } })).statusCode).toBe(402)

  // active subscription: provisions fine even though its trial date is long past
  await db.update(account).set({ subscriptionStatus: 'active', stripeSubscriptionId: 'sub_lapse', stripeSubscriptionItemId: 'si_lapse' }).where(eq(account.id, 'ac_lapse'))
  const ok = await app.inject({ method: 'POST', url: '/api/account/sweeps', ...L,
    payload: { name: 'PaidNow', provider: 'apibasketball', leagueId: '12', season: '2023-2024' } })
  expect(ok.statusCode).toBe(201)
})

test('subscribed provision re-asserts stripe quantity as the live count', async () => {
  stripeFake.calls.subUpdate.length = 0
  const r = await app.inject({ method: 'POST', url: '/api/account/sweeps', headers: { 'x-account-token': 'lapsesession' },
    payload: { name: 'PaidTwo', provider: 'apibasketball', leagueId: '12', season: '2023-2024' } })
  expect(r.statusCode).toBe(201)
  expect(stripeFake.calls.subUpdate).toEqual([
    { id: 'sub_lapse', items: [{ id: 'si_lapse', quantity: 2 }], proration_behavior: 'none' },
  ])
})

test('concurrent provisions at cap-1 land exactly one 201 (FOR UPDATE serializes)', async () => {
  await db.insert(account).values({ id: 'ac_race', email: 'race@x.test' }).onConflictDoNothing()
  await db.insert(accountSession).values({ token: 'racesession', accountId: 'ac_race', expiresAt: new Date(Date.now() + 3600_000) })
  // 2 pre-existing live sweeps → cap 3 → exactly one of two concurrent provisions may win
  await db.insert(sweep).values([
    { id: 'sw_race_1', name: 'R1', kind: 'token', memberToken: 'rm1', adminToken: 'ra1', competitionId: NBA_ID, accountId: 'ac_race' },
    { id: 'sw_race_2', name: 'R2', kind: 'token', memberToken: 'rm2', adminToken: 'ra2', competitionId: NBA_ID, accountId: 'ac_race' },
  ])
  const R = { headers: { 'x-account-token': 'racesession' } }
  const body = { name: 'Racer', provider: 'apibasketball', leagueId: '12', season: '2023-2024' }
  const [a, b] = await Promise.all([
    app.inject({ method: 'POST', url: '/api/account/sweeps', ...R, payload: body }),
    app.inject({ method: 'POST', url: '/api/account/sweeps', ...R, payload: { ...body, name: 'Racer2' } }),
  ])
  expect([a.statusCode, b.statusCode].sort()).toEqual([201, 403])
})

test('provision honors wageringEnabled: true in the body', async () => {
  await db.insert(account).values({ id: 'ac_wager', email: 'wager@x.test' }).onConflictDoNothing()
  await db.insert(accountSession).values({ token: 'wagersession', accountId: 'ac_wager', expiresAt: new Date(Date.now() + 3600_000) })
  const W = { headers: { 'x-account-token': 'wagersession' } }
  const res = await app.inject({ method: 'POST', url: '/api/account/sweeps', ...W,
    payload: { name: 'WagerOn', provider: 'apibasketball', leagueId: '12', season: '2023-2024', wageringEnabled: true } })
  expect(res.statusCode).toBe(201)
  const [row] = await db.select().from(sweep).where(eq(sweep.id, res.json().id))
  expect(row.wageringEnabled).toBe(true)
})

test('provision omitting wageringEnabled defaults the row to false', async () => {
  const W = { headers: { 'x-account-token': 'wagersession' } }
  const res = await app.inject({ method: 'POST', url: '/api/account/sweeps', ...W,
    payload: { name: 'WagerOff', provider: 'apibasketball', leagueId: '12', season: '2023-2024' } })
  expect(res.statusCode).toBe(201)
  const [row] = await db.select().from(sweep).where(eq(sweep.id, res.json().id))
  expect(row.wageringEnabled).toBe(false)
})

test('archive re-asserts stripe quantity for subscribed accounts', async () => {
  stripeFake.calls.subUpdate.length = 0
  const mine = (await app.inject({ method: 'GET', url: '/api/account/sweeps', headers: { 'x-account-token': 'lapsesession' } })).json()
  const target = mine.find((s) => s.name === 'PaidTwo')
  const r = await app.inject({ method: 'POST', url: `/api/account/sweeps/${target.id}/archive`, headers: { 'x-account-token': 'lapsesession' } })
  expect(r.json()).toEqual({ id: target.id, archived: true })
  expect(stripeFake.calls.subUpdate).toEqual([
    { id: 'sub_lapse', items: [{ id: 'si_lapse', quantity: 1 }], proration_behavior: 'none' },
  ])
})
