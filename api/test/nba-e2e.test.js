import { test, expect, afterAll, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { and, eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { buildApp } from '../src/app.js'
import { competition, competitor, event, ranking, sweep, person, ownership, bet, coinLedger, support, parlay } from '../src/db/schema.js'
import { addCompetition } from '../src/worker/add-competition.js'
import { syncBaseline } from '../src/worker/baseline-sync.js'
import { detailMerge } from '../src/db/event-shape.js'
import { createRecordedBasketballProvider } from '../src/providers/recorded-basketball-provider.js'
import { settleBets } from '../src/wagering/settle.js'
import { recomputeStandings } from '../src/worker/recompute-standings.js'
import { newToken } from '../src/sweeps/tokens.js'

const { pool, db } = openTestDb()
const app = buildApp(db, { sessionSecret: 'test-secret', platformHost: 'platform.test' })
const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apibasketball/${n}.json`, import.meta.url)))
const ID = 'apibasketball:12:2023-2024'
const memberToken = newToken()

// two snapshots of the same feed: everything upcoming, then the real (final) capture
const upcomingGames = () => {
  const j = structuredClone(load('games'))
  for (const g of j.response) {
    g.status = { long: 'Not Started', short: 'NS', timer: null }
    for (const side of ['home', 'away']) g.scores[side] = { quarter_1: null, quarter_2: null, quarter_3: null, quarter_4: null, over_time: null, total: null }
  }
  return j
}
const recorded = (games) => createRecordedBasketballProvider({ leagues: load('leagues'), teams: load('teams'), games, standings: load('standings') })

async function sessionCookie(token) {
  const res = await app.inject({ method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token } })
  return res.headers['set-cookie']
}

beforeAll(async () => { await app.ready() })
afterAll(async () => {
  await db.delete(support).where(eq(support.sweepId, 'sw_nbae2e'))
  await db.delete(bet).where(eq(bet.sweepId, 'sw_nbae2e'))
  await db.delete(parlay).where(eq(parlay.sweepId, 'sw_nbae2e')) // parlay legs cascade via bet, but the parlay row itself is separate and FKs person
  await db.delete(coinLedger).where(eq(coinLedger.sweepId, 'sw_nbae2e'))
  await db.delete(ownership).where(eq(ownership.sweepId, 'sw_nbae2e'))
  await db.delete(person).where(eq(person.sweepId, 'sw_nbae2e'))
  await db.delete(sweep).where(eq(sweep.id, 'sw_nbae2e'))
  await db.delete(event).where(eq(event.competitionId, ID))
  await db.delete(ranking).where(eq(ranking.competitionId, ID))
  await db.delete(competitor).where(eq(competitor.competitionId, ID))
  await db.delete(competition).where(eq(competition.id, ID))
  await app.close(); await pool.end()
})

test('NBA end to end: provision → sweep → ownership/support → finals → 2-way settlement + rankings', async () => {
  // 1. provision from the (upcoming) feed
  const r = await addCompetition(db, recorded(upcomingGames()), { provider: 'apibasketball', leagueId: '12', season: '2023-2024' })
  expect(r.fixtures).toBe(5)
  let evs = await db.select().from(event).where(eq(event.competitionId, ID))
  expect(evs.every((e) => e.status === 'upcoming' && e.winnerCode == null)).toBe(true)

  // 2. a sweep bound to it, with a member and an owned team
  await db.insert(sweep).values({ id: 'sw_nbae2e', name: 'NBA E2E', kind: 'token', memberToken, adminToken: newToken(), competitionId: ID })
  await db.insert(person).values({ id: 'pn_e2e', sweepId: 'sw_nbae2e', name: 'Evie', short: 'Evie', initials: 'EV', avColor: '#333' })
  const [wolves] = await db.select().from(competitor).where(and(eq(competitor.competitionId, ID), eq(competitor.code, 'minnesota-timberwolves')))
  await db.insert(ownership).values({ sweepId: 'sw_nbae2e', personId: 'pn_e2e', competitorId: wolves.id })

  // member auth: session cookie minted from the sweep's member token (frozen wire contract)
  const cookie = await sessionCookie(memberToken)
  const M = { headers: { host: 'platform.test', cookie } }

  // 3. wire reads through the frozen contract
  const fixtures = await app.inject({ method: 'GET', url: '/api/fixtures', ...M })
  expect(fixtures.statusCode).toBe(200)
  expect(fixtures.json()).toHaveLength(5)
  expect(fixtures.json()[0]).toHaveProperty('t1') // soccer field names, NBA data — by design

  // 4. support a team; DRAW is refused (no-draw sport)
  const pick = await app.inject({ method: 'POST', url: '/api/support', ...M, payload: { fixtureId: '372186', personId: 'pn_e2e', teamCode: 'minnesota-timberwolves' } })
  expect(pick.statusCode).toBe(200)
  const draw = await app.inject({ method: 'POST', url: '/api/support', ...M, payload: { fixtureId: '372186', personId: 'pn_e2e', teamCode: 'DRAW' } })
  expect(draw.statusCode).toBe(400)

  // 5. an open bet on the game (inserted directly — NBA feed carries no odds; markets are P5)
  await db.insert(coinLedger).values({ sweepId: 'sw_nbae2e', personId: 'pn_e2e', type: 'grant', amount: 1000, refId: '0' })
  await db.insert(coinLedger).values({ sweepId: 'sw_nbae2e', personId: 'pn_e2e', type: 'stake', amount: -100, refId: 'bet_e2e' })
  await db.insert(bet).values({ id: 'bet_e2e', sweepId: 'sw_nbae2e', personId: 'pn_e2e', fixtureId: '372186', market: 'toq', selection: 'HOME', stake: 100, oddsDecimal: '1.9', potentialPayout: 190, status: 'open' })

  // 6. results land via baseline; newly-final reported; settlement grades 2-way
  const sync = await syncBaseline(db, recorded(load('games')), (await db.select().from(competition).where(eq(competition.id, ID)))[0])
  expect(sync.newlyFinal).toHaveLength(5)
  evs = await db.select().from(event).where(eq(event.competitionId, ID))
  for (const e of evs.filter((x) => x.status === 'final')) expect(e.winnerCode).not.toBe('DRAW')
  await settleBets(db, '372186', async () => {})
  const [graded] = await db.select().from(bet).where(eq(bet.id, 'bet_e2e'))
  expect(graded.status).toBe('won') // Wolves won 111–99; 'toq' grades on fixtureResult/winnerCode
  // recompute must NOT touch provider-authoritative NBA rankings
  expect(await recomputeStandings(db, ID)).toBe(0)
  const rows = await db.select().from(ranking).where(eq(ranking.competitionId, ID))
  expect(rows).toHaveLength(30)
  expect(rows.every((x) => x.rank != null && x.stats.pct != null)).toBe(true)
})

test('NBA wagering spine: inject markets, bet ml/ou/hcap + parlay, settle on the recorded finals', async () => {
  // fresh upcoming snapshot so bets are placeable
  await syncBaseline(db, recorded(upcomingGames()), (await db.select().from(competition).where(eq(competition.id, ID)))[0])
  const evs = await db.select().from(event).where(eq(event.competitionId, ID))
  const [g1, g2] = evs.slice(0, 2)
  const markets = {
    ml:   { label: 'Moneyline', book: 'TestBook', selections: [ { key: 'HOME', label: 'Home', odds: 1.8 }, { key: 'AWAY', label: 'Away', odds: 2.0 } ] },
    ou:   { label: 'Total', line: 213.5, book: 'TestBook', selections: [ { key: 'OVER', label: 'Over 213.5', odds: 1.9 }, { key: 'UNDER', label: 'Under 213.5', odds: 1.9 } ] },
    hcap: { label: 'Handicap', line: -2.5, book: 'TestBook', selections: [ { key: 'HOME', label: 'Home -2.5', odds: 1.95 }, { key: 'AWAY', label: 'Away +2.5', odds: 1.85 } ] },
  }
  for (const g of [g1, g2]) await db.update(event).set({ detail: detailMerge({ markets }) }).where(eq(event.id, g.id))
  await db.update(sweep).set({ wageringEnabled: true }).where(eq(sweep.id, 'sw_nbae2e'))
  const cookie = await sessionCookie(memberToken)
  const H = { host: 'platform.test', cookie }

  const b1 = await app.inject({ method: 'POST', url: '/api/bet', headers: H, payload: { fixtureId: g1.id, personId: 'pn_e2e', market: 'ml', selection: 'HOME', stake: 100 } })
  expect(b1.statusCode).toBe(200)
  const b2 = await app.inject({ method: 'POST', url: '/api/bet', headers: H, payload: { fixtureId: g1.id, personId: 'pn_e2e', market: 'ou', selection: 'OVER', stake: 50 } })
  expect(b2.statusCode).toBe(200)
  const b3 = await app.inject({ method: 'POST', url: '/api/bet', headers: H, payload: { fixtureId: g1.id, personId: 'pn_e2e', market: 'hcap', selection: 'HOME', stake: 50 } })
  expect(b3.statusCode).toBe(200)
  const par = await app.inject({ method: 'POST', url: '/api/parlay', headers: H, payload: { personId: 'pn_e2e', stake: 40, legs: [ { fixtureId: g1.id, market: 'ml', selection: 'HOME' }, { fixtureId: g2.id, market: 'ou', selection: 'UNDER' } ] } })
  expect(par.statusCode).toBe(200)

  // flip the feed to the real (final) capture and settle both games
  await syncBaseline(db, recorded(load('games')), (await db.select().from(competition).where(eq(competition.id, ID)))[0])
  await settleBets(db, g1.id); await settleBets(db, g2.id)

  const settled = await db.select().from(bet).where(and(eq(bet.sweepId, 'sw_nbae2e'), eq(bet.fixtureId, g1.id)))
  expect(settled.every((b) => b.status === 'won' || b.status === 'lost')).toBe(true)
  // grading agrees with the recorded final score (read it and assert each bet the cheap way)
  const [fin] = await db.select().from(event).where(eq(event.id, g1.id))
  const homeWon = fin.winnerCode === fin.c1Code
  const mlBet = settled.find((b) => b.market === 'ml' && !b.parlayId)
  expect(mlBet.status).toBe(homeWon ? 'won' : 'lost')
  const total = fin.score1 + fin.score2
  expect(settled.find((b) => b.market === 'ou' && !b.parlayId).status).toBe(total > 213.5 ? 'won' : 'lost')
  expect(settled.find((b) => b.market === 'hcap' && !b.parlayId).status).toBe(fin.score1 - 2.5 > fin.score2 ? 'won' : 'lost')
  // ledger: a won single paid out; the parlay resolved once both legs graded
  const [pl] = await db.select().from(parlay).where(eq(parlay.sweepId, 'sw_nbae2e'))
  expect(['won', 'lost']).toContain(pl.status)
})
