import { test, expect, beforeEach, afterAll } from 'vitest'
import { eq, and } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import {
  account, person, ownership, support, coinLedger, bet, photo, competitor, event, sweep,
} from '../src/db/schema.js'

const { pool, db } = openTestDb()

const A1 = 'ac_claim_1'
const A2 = 'ac_claim_2'
const P1 = 'pn_claim_1'
const P2 = 'pn_claim_2'

async function scrub() {
  for (const id of [P1, P2]) {
    await db.delete(photo).where(eq(photo.personId, id))
    await db.delete(bet).where(eq(bet.personId, id))
    await db.delete(coinLedger).where(eq(coinLedger.personId, id))
    await db.delete(support).where(eq(support.personId, id))
    await db.delete(ownership).where(eq(ownership.personId, id))
    await db.delete(person).where(eq(person.id, id))
  }
  await db.delete(account).where(eq(account.id, A1))
  await db.delete(account).where(eq(account.id, A2))
}

beforeEach(scrub)
afterAll(async () => { await scrub(); await pool.end() })

const seat = (id, extra = {}) => ({
  id, sweepId: 'default', name: 'Claimer', short: 'Claimer', initials: 'CL', avColor: '#c9472f', ...extra,
})

test('one account holds at most one seat in a sweep', async () => {
  await db.insert(account).values({ id: A1, email: 'claim1@x.test' })
  await db.insert(person).values(seat(P1, { accountId: A1 }))
  // drizzle 0.45 wraps driver errors, so the pg code sits one level down - the same
  // read-both idiom the ownership route uses at routes/sweeps.js:222.
  const err = await db.insert(person).values(seat(P2, { accountId: A1 })).catch((e) => e)
  expect(err?.code ?? err?.cause?.code).toBe('23505')
})

// Owner-typed rows are display-only and unlimited: NULLs must stay distinct.
test('any number of seats sit unclaimed side by side', async () => {
  await db.insert(person).values(seat(P1))
  await db.insert(person).values(seat(P2))
  const rows = await db.select().from(person).where(eq(person.sweepId, 'default'))
  expect(rows.filter((r) => r.id === P1 || r.id === P2)).toHaveLength(2)
})

test('a claimed seat records who claimed it and when', async () => {
  await db.insert(account).values({ id: A1, email: 'claim1@x.test' })
  const now = new Date()
  await db.insert(person).values(seat(P1, { accountId: A1, email: 'claim1@x.test', claimedAt: now }))
  const [p] = await db.select().from(person).where(eq(person.id, P1))
  expect(p.accountId).toBe(A1)
  expect(p.email).toBe('claim1@x.test')
  expect(p.claimedAt).toBeInstanceOf(Date)
  expect(p.ejectedAt).toBeNull()
})

// This is a live 500 on main: DELETE /api/admin/people/:id clears ownership by hand and
// nothing else, so any person carrying a photo raises 23503 on the person delete.
test('deleting a person takes every row that pointed at them', async () => {
  const [cp] = await db.select().from(competitor).limit(1)
  const [ev] = await db.select().from(event).limit(1)
  await db.insert(person).values(seat(P1))
  await db.insert(ownership).values({ sweepId: 'default', personId: P1, competitorId: cp.id })
  await db.insert(support).values({ sweepId: 'default', fixtureId: ev.id, personId: P1, teamCode: 'X' })
  await db.insert(coinLedger).values({ sweepId: 'default', personId: P1, type: 'grant', amount: 1000, refId: 'r_claim' })
  await db.insert(bet).values({
    id: 'bt_claim', sweepId: 'default', personId: P1, fixtureId: ev.id, selection: 'home',
    stake: 10, oddsDecimal: '2.0', potentialPayout: 20,
  })
  await db.insert(photo).values({
    id: 'ph_claim', sweepId: 'default', kind: 'profile', uploaderName: 'Claimer',
    personId: P1, filePath: 'x/y.jpg',
  })

  await db.delete(person).where(eq(person.id, P1))

  for (const [t, col] of [[ownership, ownership.personId], [support, support.personId],
    [coinLedger, coinLedger.personId], [bet, bet.personId], [photo, photo.personId]]) {
    expect(await db.select().from(t).where(eq(col, P1))).toHaveLength(0)
  }
})
