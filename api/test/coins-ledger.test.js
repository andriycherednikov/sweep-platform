import { expect, test, afterAll, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { fixture, person, coinLedger } from '../src/db/schema.js'
import { seasonAnchor, currentWeekIndex, ensureGrants, balanceOf } from '../src/coins/ledger.js'
import { WEEK_MS } from '../src/coins/constants.js'

const { pool, db } = openTestDb()
afterAll(async () => { await pool.end() })
beforeEach(async () => { await db.delete(coinLedger) })

const aPerson = async () => (await db.select().from(person).limit(1))[0]

test('seasonAnchor is the earliest fixture kickoff', async () => {
  const anchor = await seasonAnchor(db)
  const [{ ko }] = await db.select({ ko: fixture.kickoffUtc }).from(fixture).orderBy(fixture.kickoffUtc).limit(1)
  expect(anchor.getTime()).toBe(new Date(ko).getTime())
})

test('ensureGrants credits the starting bankroll once, idempotently', async () => {
  const p = await aPerson()
  const anchor = await seasonAnchor(db)
  const justAfterStart = new Date(anchor.getTime() + 1000)
  await ensureGrants(db, 'default', p.id, justAfterStart)
  await ensureGrants(db, 'default', p.id, justAfterStart) // re-run is a no-op
  const rows = await db.select().from(coinLedger).where(eq(coinLedger.personId, p.id))
  expect(rows.filter((r) => r.type === 'grant')).toHaveLength(1)
  expect(await balanceOf(db, 'default', p.id)).toBe(1000)
})

test('ensureGrants backfills one grant per elapsed week', async () => {
  const p = await aPerson()
  const anchor = await seasonAnchor(db)
  const threeWeeksIn = new Date(anchor.getTime() + 3 * WEEK_MS + 1000)
  await ensureGrants(db, 'default', p.id, threeWeeksIn)
  expect(await balanceOf(db, 'default', p.id)).toBe(4000) // weeks 0,1,2,3
  expect(currentWeekIndex(anchor, threeWeeksIn)).toBe(3)
})

test('balanceOf is zero for a person with no ledger rows', async () => {
  const p = await aPerson()
  expect(await balanceOf(db, 'default', p.id)).toBe(0)
})

// Guard: with no fixtures, min(kickoff) is null → seasonAnchor must NOT become the Unix epoch
// (which would make currentWeekIndex ~2900 and ensureGrants loop thousands of times).
test('seasonAnchor is null and ensureGrants is a no-op when there are no fixtures', async () => {
  const emptyDb = {
    select: () => ({ from: async () => [{ min: null }] }),
    insert: () => { throw new Error('ensureGrants must not insert without a season anchor') },
  }
  expect(await seasonAnchor(emptyDb)).toBeNull()
  await expect(ensureGrants(emptyDb, 'default', 'pn_x', new Date())).resolves.toBeUndefined()
})
