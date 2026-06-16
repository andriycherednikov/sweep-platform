import { and, eq, sql } from 'drizzle-orm'
import { fixture, person, coinLedger, bet } from '../db/schema.js'
import { STARTING_COINS, WEEKLY_COINS, WEEK_MS } from './constants.js'

/** Tournament start = earliest fixture kickoff, or null when there are no fixtures. */
export async function seasonAnchor(db) {
  const [row] = await db.select({ min: sql`min(${fixture.kickoffUtc})` }).from(fixture)
  return row?.min == null ? null : new Date(row.min)
}

/** Whole weeks elapsed since the anchor, clamped to >= 0. */
export function currentWeekIndex(anchor, now) {
  return Math.max(0, Math.floor((now.getTime() - anchor.getTime()) / WEEK_MS))
}

/** Credit any missing weekly grant rows (week 0 = starting bankroll). Idempotent via the unique constraint. */
export async function ensureGrants(db, sweepId, personId, now = new Date()) {
  const anchor = await seasonAnchor(db)
  if (!anchor) return // no fixtures yet → no tournament started → nothing to grant
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

/** Grant-then-read a person's wallet: balance + their open/settled bets. */
export async function walletFor(db, sweepId, personId, now = new Date()) {
  await ensureGrants(db, sweepId, personId, now)
  const balance = await balanceOf(db, sweepId, personId)
  const rows = await db.select().from(bet).where(and(eq(bet.sweepId, sweepId), eq(bet.personId, personId)))
  const open = [], settled = []
  for (const b of rows) (b.status === 'open' ? open : settled).push(serializeBet(b))
  return { balance, weeklyGrant: WEEKLY_COINS, bets: { open, settled } }
}

/** Every person's current balance, ranked high → low (ensures all members are granted first). */
export async function leaderboard(db, sweepId, now = new Date()) {
  const people = await db.select().from(person).where(eq(person.sweepId, sweepId))
  const out = []
  for (const p of people) {
    await ensureGrants(db, sweepId, p.id, now)
    out.push({ personId: p.id, balance: await balanceOf(db, sweepId, p.id) })
  }
  return out.sort((a, b) => b.balance - a.balance)
}

export function serializeBet(b) {
  return { id: b.id, fixtureId: b.fixtureId, market: b.market, selection: b.selection,
    line: b.line == null ? null : Number(b.line), stake: b.stake, odds: Number(b.oddsDecimal),
    book: b.book, potentialPayout: b.potentialPayout, status: b.status, placedAt: b.placedAt, settledAt: b.settledAt }
}
