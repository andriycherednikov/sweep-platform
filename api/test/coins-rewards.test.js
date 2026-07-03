import { expect, test, afterAll, beforeEach, afterEach } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { event, person, sweep, coinLedger, support, ownership } from '../src/db/schema.js'
import { grantMatchRewards } from '../src/coins/rewards.js'

const COMPETITION_ID = 'apifootball:1:2026' // matches seed.js's default competition
const cpId = (code) => `cp_${COMPETITION_ID}_${code}`

const { pool, db } = openTestDb()
afterAll(async () => { await pool.end() })
beforeEach(async () => { await db.delete(coinLedger); await db.delete(support); await db.delete(ownership) })
// Robust teardown: runs even if an assertion throws mid-test. Undo any minor flip and
// remove the parallel 'other' sweep so neither can leak into sibling tests.
afterEach(async () => {
  await db.update(person).set({ adult: true })
  await db.delete(coinLedger).where(eq(coinLedger.sweepId, 'other'))
  await db.delete(support).where(eq(support.sweepId, 'other'))
  await db.delete(person).where(eq(person.sweepId, 'other'))
  await db.delete(sweep).where(eq(sweep.id, 'other'))
})

const twoPeople = async () => db.select().from(person).limit(2)
const rows = (personId, type) =>
  db.select().from(coinLedger).where(and(eq(coinLedger.personId, personId), eq(coinLedger.type, type)))

// mark the first seeded event final with the home team as the winner; return the row
async function homeWinFixture() {
  const [f] = await db.select().from(event).limit(1)
  await db.update(event).set({ status: 'final', winnerCode: f.c1Code }).where(eq(event.id, f.id))
  return (await db.select().from(event).where(eq(event.id, f.id)))[0]
}

test('a correct prediction grants +100; a wrong one grants nothing', async () => {
  const [a, b] = await twoPeople()
  const f = await homeWinFixture()
  await db.insert(support).values({ sweepId: 'default', fixtureId: f.id, personId: a.id, teamCode: f.c1Code }) // HOME — correct
  await db.insert(support).values({ sweepId: 'default', fixtureId: f.id, personId: b.id, teamCode: f.c2Code }) // AWAY — wrong
  await grantMatchRewards(db, f.id)
  const aPred = await rows(a.id, 'predict')
  expect(aPred).toHaveLength(1)
  expect(aPred[0].amount).toBe(100)
  expect(aPred[0].refId).toBe(f.id)
  expect(await rows(b.id, 'predict')).toHaveLength(0)
})

test('winning-team owner gets +300; losing-team owner gets nothing', async () => {
  const [a, b] = await twoPeople()
  const f = await homeWinFixture()
  await db.insert(ownership).values({ sweepId: 'default', personId: a.id, competitorId: cpId(f.c1Code) }) // owns winner
  await db.insert(ownership).values({ sweepId: 'default', personId: b.id, competitorId: cpId(f.c2Code) }) // owns loser
  await grantMatchRewards(db, f.id)
  expect((await rows(a.id, 'teamwin'))[0].amount).toBe(300)
  expect(await rows(b.id, 'teamwin')).toHaveLength(0)
})

test('both co-owners of the winning team each get the full +300', async () => {
  const [a, b] = await twoPeople()
  const f = await homeWinFixture()
  await db.insert(ownership).values({ sweepId: 'default', personId: a.id, competitorId: cpId(f.c1Code) })
  await db.insert(ownership).values({ sweepId: 'default', personId: b.id, competitorId: cpId(f.c1Code) })
  await grantMatchRewards(db, f.id)
  expect((await rows(a.id, 'teamwin'))[0].amount).toBe(300)
  expect((await rows(b.id, 'teamwin'))[0].amount).toBe(300)
})

test('a drawn match pays correct DRAW predictions but no team-win', async () => {
  const [a] = await twoPeople()
  const [f0] = await db.select().from(event).limit(1)
  await db.update(event).set({ status: 'final', winnerCode: 'DRAW' }).where(eq(event.id, f0.id))
  const f = (await db.select().from(event).where(eq(event.id, f0.id)))[0]
  await db.insert(support).values({ sweepId: 'default', fixtureId: f.id, personId: a.id, teamCode: 'DRAW' })
  await db.insert(ownership).values({ sweepId: 'default', personId: a.id, competitorId: cpId(f.c1Code) })
  await grantMatchRewards(db, f.id)
  expect((await rows(a.id, 'predict'))[0].amount).toBe(100)
  expect(await rows(a.id, 'teamwin')).toHaveLength(0)
})

test('a person who predicts right AND owns the winner gets both (+400)', async () => {
  const [a] = await twoPeople()
  const f = await homeWinFixture()
  await db.insert(support).values({ sweepId: 'default', fixtureId: f.id, personId: a.id, teamCode: f.c1Code })
  await db.insert(ownership).values({ sweepId: 'default', personId: a.id, competitorId: cpId(f.c1Code) })
  const granted = await grantMatchRewards(db, f.id)
  expect(granted).toBe(2)
  const all = await db.select().from(coinLedger).where(eq(coinLedger.personId, a.id))
  expect(all.reduce((s, r) => s + r.amount, 0)).toBe(400)
})

test('grantMatchRewards is idempotent (re-run grants nothing new)', async () => {
  const [a] = await twoPeople()
  const f = await homeWinFixture()
  await db.insert(support).values({ sweepId: 'default', fixtureId: f.id, personId: a.id, teamCode: f.c1Code })
  await db.insert(ownership).values({ sweepId: 'default', personId: a.id, competitorId: cpId(f.c1Code) })
  await grantMatchRewards(db, f.id)
  const second = await grantMatchRewards(db, f.id)
  expect(second).toBe(0)
  expect(await rows(a.id, 'predict')).toHaveLength(1)
  expect(await rows(a.id, 'teamwin')).toHaveLength(1)
})

test('a non-final fixture grants nothing', async () => {
  const [a] = await twoPeople()
  const [f] = await db.select().from(event).limit(1)
  await db.update(event).set({ status: 'upcoming', winnerCode: null }).where(eq(event.id, f.id))
  await db.insert(support).values({ sweepId: 'default', fixtureId: f.id, personId: a.id, teamCode: f.c1Code })
  expect(await grantMatchRewards(db, f.id)).toBe(0)
})

test('rewards are granted under the row’s own sweep (isolation)', async () => {
  const [a] = await twoPeople()
  const f = await homeWinFixture()
  // a parallel sweep with its own person + a correct pick on the same fixture
  await db.insert(sweep).values({ id: 'other', name: 'Other', competitionId: COMPETITION_ID }).onConflictDoNothing()
  await db.insert(person).values({ id: 'pn_other', sweepId: 'other', name: 'Oth', short: 'Oth', initials: 'OT', avColor: '#999' }).onConflictDoNothing()
  await db.insert(support).values({ sweepId: 'other', fixtureId: f.id, personId: 'pn_other', teamCode: f.c1Code })
  await grantMatchRewards(db, f.id)
  const otherRow = (await rows('pn_other', 'predict'))[0]
  expect(otherRow.sweepId).toBe('other')
  // (the 'other' sweep is torn down in afterEach, so cleanup is robust to assertion failure)
})

test('a minor’s correct prediction grants nothing (coins is 18+)', async () => {
  const [a] = await twoPeople()
  const f = await homeWinFixture()
  await db.update(person).set({ adult: false }).where(eq(person.id, a.id))
  await db.insert(support).values({ sweepId: 'default', fixtureId: f.id, personId: a.id, teamCode: f.c1Code })
  await grantMatchRewards(db, f.id)
  expect(await rows(a.id, 'predict')).toHaveLength(0)
})

test('a minor who owns the winning team gets no team-win reward', async () => {
  const [a] = await twoPeople()
  const f = await homeWinFixture()
  await db.update(person).set({ adult: false }).where(eq(person.id, a.id))
  await db.insert(ownership).values({ sweepId: 'default', personId: a.id, competitorId: cpId(f.c1Code) })
  await grantMatchRewards(db, f.id)
  expect(await rows(a.id, 'teamwin')).toHaveLength(0)
})
