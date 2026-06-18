import { expect, test, afterAll, beforeEach } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { fixture, person, sweep, coinLedger, support, ownership } from '../src/db/schema.js'
import { grantMatchRewards } from '../src/coins/rewards.js'

const { pool, db } = openTestDb()
afterAll(async () => { await pool.end() })
beforeEach(async () => { await db.delete(coinLedger); await db.delete(support); await db.delete(ownership) })

const twoPeople = async () => db.select().from(person).limit(2)
const rows = (personId, type) =>
  db.select().from(coinLedger).where(and(eq(coinLedger.personId, personId), eq(coinLedger.type, type)))

// mark the first seeded fixture final with the home team as the winner; return the row
async function homeWinFixture() {
  const [f] = await db.select().from(fixture).limit(1)
  await db.update(fixture).set({ status: 'final', winnerCode: f.t1Code }).where(eq(fixture.id, f.id))
  return (await db.select().from(fixture).where(eq(fixture.id, f.id)))[0]
}

test('a correct prediction grants +100; a wrong one grants nothing', async () => {
  const [a, b] = await twoPeople()
  const f = await homeWinFixture()
  await db.insert(support).values({ sweepId: 'default', fixtureId: f.id, personId: a.id, teamCode: f.t1Code }) // HOME — correct
  await db.insert(support).values({ sweepId: 'default', fixtureId: f.id, personId: b.id, teamCode: f.t2Code }) // AWAY — wrong
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
  await db.insert(ownership).values({ sweepId: 'default', personId: a.id, teamCode: f.t1Code }) // owns winner
  await db.insert(ownership).values({ sweepId: 'default', personId: b.id, teamCode: f.t2Code }) // owns loser
  await grantMatchRewards(db, f.id)
  expect((await rows(a.id, 'teamwin'))[0].amount).toBe(300)
  expect(await rows(b.id, 'teamwin')).toHaveLength(0)
})

test('both co-owners of the winning team each get the full +300', async () => {
  const [a, b] = await twoPeople()
  const f = await homeWinFixture()
  await db.insert(ownership).values({ sweepId: 'default', personId: a.id, teamCode: f.t1Code })
  await db.insert(ownership).values({ sweepId: 'default', personId: b.id, teamCode: f.t1Code })
  await grantMatchRewards(db, f.id)
  expect((await rows(a.id, 'teamwin'))[0].amount).toBe(300)
  expect((await rows(b.id, 'teamwin'))[0].amount).toBe(300)
})

test('a drawn match pays correct DRAW predictions but no team-win', async () => {
  const [a] = await twoPeople()
  const [f0] = await db.select().from(fixture).limit(1)
  await db.update(fixture).set({ status: 'final', winnerCode: 'DRAW' }).where(eq(fixture.id, f0.id))
  const f = (await db.select().from(fixture).where(eq(fixture.id, f0.id)))[0]
  await db.insert(support).values({ sweepId: 'default', fixtureId: f.id, personId: a.id, teamCode: 'DRAW' })
  await db.insert(ownership).values({ sweepId: 'default', personId: a.id, teamCode: f.t1Code })
  await grantMatchRewards(db, f.id)
  expect((await rows(a.id, 'predict'))[0].amount).toBe(100)
  expect(await rows(a.id, 'teamwin')).toHaveLength(0)
})

test('a person who predicts right AND owns the winner gets both (+400)', async () => {
  const [a] = await twoPeople()
  const f = await homeWinFixture()
  await db.insert(support).values({ sweepId: 'default', fixtureId: f.id, personId: a.id, teamCode: f.t1Code })
  await db.insert(ownership).values({ sweepId: 'default', personId: a.id, teamCode: f.t1Code })
  const granted = await grantMatchRewards(db, f.id)
  expect(granted).toBe(2)
  const all = await db.select().from(coinLedger).where(eq(coinLedger.personId, a.id))
  expect(all.reduce((s, r) => s + r.amount, 0)).toBe(400)
})

test('grantMatchRewards is idempotent (re-run grants nothing new)', async () => {
  const [a] = await twoPeople()
  const f = await homeWinFixture()
  await db.insert(support).values({ sweepId: 'default', fixtureId: f.id, personId: a.id, teamCode: f.t1Code })
  await db.insert(ownership).values({ sweepId: 'default', personId: a.id, teamCode: f.t1Code })
  await grantMatchRewards(db, f.id)
  const second = await grantMatchRewards(db, f.id)
  expect(second).toBe(0)
  expect(await rows(a.id, 'predict')).toHaveLength(1)
  expect(await rows(a.id, 'teamwin')).toHaveLength(1)
})

test('a non-final fixture grants nothing', async () => {
  const [a] = await twoPeople()
  const [f] = await db.select().from(fixture).limit(1)
  await db.update(fixture).set({ status: 'upcoming', winnerCode: null }).where(eq(fixture.id, f.id))
  await db.insert(support).values({ sweepId: 'default', fixtureId: f.id, personId: a.id, teamCode: f.t1Code })
  expect(await grantMatchRewards(db, f.id)).toBe(0)
})

test('rewards are granted under the row’s own sweep (isolation)', async () => {
  const [a] = await twoPeople()
  const f = await homeWinFixture()
  // a parallel sweep with its own person + a correct pick on the same fixture
  await db.insert(sweep).values({ id: 'other', name: 'Other' }).onConflictDoNothing()
  await db.insert(person).values({ id: 'pn_other', sweepId: 'other', name: 'Oth', short: 'Oth', initials: 'OT', avColor: '#999' }).onConflictDoNothing()
  await db.insert(support).values({ sweepId: 'other', fixtureId: f.id, personId: 'pn_other', teamCode: f.t1Code })
  await grantMatchRewards(db, f.id)
  const otherRow = (await rows('pn_other', 'predict'))[0]
  expect(otherRow.sweepId).toBe('other')
  // cleanup so the parallel sweep can't leak into sibling tests
  await db.delete(coinLedger).where(eq(coinLedger.sweepId, 'other'))
  await db.delete(support).where(eq(support.sweepId, 'other'))
  await db.delete(person).where(eq(person.sweepId, 'other'))
  await db.delete(sweep).where(eq(sweep.id, 'other'))
})
