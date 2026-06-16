import { and, eq, sql } from 'drizzle-orm'
import { fixture, coinLedger } from '../db/schema.js'
import { STARTING_COINS, WEEKLY_COINS, WEEK_MS } from './constants.js'

/** Tournament start = earliest fixture kickoff. */
export async function seasonAnchor(db) {
  const [row] = await db.select({ min: sql`min(${fixture.kickoffUtc})` }).from(fixture)
  return new Date(row.min)
}

/** Whole weeks elapsed since the anchor, clamped to >= 0. */
export function currentWeekIndex(anchor, now) {
  return Math.max(0, Math.floor((now.getTime() - anchor.getTime()) / WEEK_MS))
}

/** Credit any missing weekly grant rows (week 0 = starting bankroll). Idempotent via the unique constraint. */
export async function ensureGrants(db, sweepId, personId, now = new Date()) {
  const anchor = await seasonAnchor(db)
  const week = currentWeekIndex(anchor, now)
  for (let w = 0; w <= week; w++) {
    await db.insert(coinLedger)
      .values({ sweepId, personId, type: 'grant', refId: String(w), amount: w === 0 ? STARTING_COINS : WEEKLY_COINS })
      .onConflictDoNothing()
  }
}

/** Current balance = SUM(amount) over the person's ledger rows. */
export async function balanceOf(db, sweepId, personId) {
  const [row] = await db.select({ total: sql`coalesce(sum(${coinLedger.amount}), 0)` })
    .from(coinLedger).where(and(eq(coinLedger.sweepId, sweepId), eq(coinLedger.personId, personId)))
  return Number(row.total)
}
