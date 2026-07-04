import { and, eq, sql, isNull, inArray } from 'drizzle-orm'
import { event, person, coinLedger, bet, parlay, sweep, competition } from '../db/schema.js'
import { flattenEvent } from '../db/event-shape.js'
import { STARTING_COINS, WEEKLY_COINS, WEEK_MS } from './constants.js'
import { resolveBet } from './settle.js'
import { sportConfig } from '../sports.js'
import { serializePerson } from '../serialize.js'

/** Season start for ONE competition = its earliest event start, or null when it has none.
 *  Scoped so a second competition with an earlier season can't shift another's week index. */
export async function seasonAnchor(db, competitionId) {
  if (!competitionId) throw new Error('seasonAnchor: competitionId is required')
  const [row] = await db.select({ min: sql`min(${event.startUtc})` }).from(event)
    .where(eq(event.competitionId, competitionId))
  return row?.min == null ? null : new Date(row.min)
}

/** Whole weeks elapsed since the anchor, clamped to >= 0. */
export function currentWeekIndex(anchor, now) {
  return Math.max(0, Math.floor((now.getTime() - anchor.getTime()) / WEEK_MS))
}

/** Credit any missing weekly grant rows (week 0 = starting bankroll). Idempotent via the unique constraint. */
export async function ensureGrants(db, sweepId, personId, now = new Date()) {
  const [sw] = await db.select({ competitionId: sweep.competitionId }).from(sweep).where(eq(sweep.id, sweepId))
  if (!sw?.competitionId) return // unknown sweep → nothing to grant
  const anchor = await seasonAnchor(db, sw.competitionId)
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
  const rows = await db.select().from(bet).where(and(eq(bet.sweepId, sweepId), eq(bet.personId, personId), isNull(bet.parlayId)))
  const open = [], settled = []
  for (const b of rows) (b.status === 'open' ? open : settled).push(serializeBet(b))
  const parlays = await parlaysFor(db, sweepId, personId)
  return { balance, weeklyGrant: WEEKLY_COINS, bets: { open, settled }, parlays }
}

async function parlaysFor(db, sweepId, personId) {
  const rows = await db.select().from(parlay).where(and(eq(parlay.sweepId, sweepId), eq(parlay.personId, personId)))
  const open = [], settled = []
  for (const pl of rows) {
    const legs = await db.select().from(bet).where(eq(bet.parlayId, pl.id))
    ;(pl.status === 'open' ? open : settled).push(serializeParlay(pl, legs))
  }
  return { open, settled }
}

/** Grade an open bet exactly as the settler would right now: a definite 'won'/'lost' only
 *  when its fixture is final AND resolveBet has the data, else null (still unresolvable).
 *  `sport` must be threaded through (see settle.js) — without it resolveBet defaults to
 *  football's regulation-time grading, which mis-grades other sports' bets. */
function gradeNow(b, f, sport) {
  if (!f || f.status !== 'final') return null
  return resolveBet(b.market, b.selection, b.line == null ? null : Number(b.line), f, sport)
}

/**
 * Admin audit view: every OPEN bet (singles + parlays) in a sweep, grouped by person and
 * annotated with the underlying fixture status. A bet is "stale" when the settler could
 * resolve it *right now* but it's still open — i.e. it would settle on the next "Settle
 * stale bets" run. For a single that means its final fixture is gradable; for a parlay,
 * that any leg already grades lost or every leg grades won (mirrors settleParlay). A
 * final-but-ungradable bet (missing score/event data) is NOT stale — the button can't
 * touch it. People with stale bets sort first, then by open count, then name.
 */
export async function openBetsBySweep(db, sweepId) {
  // the sweep's own competition decides grading rules (regulation-time vs final score,
  // draws legal or not) — mirror settle.js so a stale-bet audit agrees with the real settler
  const [sw] = await db.select({ competitionId: sweep.competitionId }).from(sweep).where(eq(sweep.id, sweepId))
  const [comp] = sw?.competitionId ? await db.select().from(competition).where(eq(competition.id, sw.competitionId)) : []
  const sport = comp ? sportConfig(comp.sport) : undefined

  const singles = await db.select().from(bet)
    .where(and(eq(bet.sweepId, sweepId), eq(bet.status, 'open'), isNull(bet.parlayId)))
  const openParlays = await db.select().from(parlay)
    .where(and(eq(parlay.sweepId, sweepId), eq(parlay.status, 'open')))

  // one batched leg lookup for all open parlays (index-backed on parlay_id)
  const legsByParlay = new Map(openParlays.map((pl) => [pl.id, []]))
  if (openParlays.length) {
    const legRows = await db.select().from(bet).where(inArray(bet.parlayId, openParlays.map((pl) => pl.id)))
    for (const l of legRows) legsByParlay.get(l.parlayId)?.push(l)
  }

  // one full-fixture lookup over everything referenced (need scores/events to grade, not just status)
  const fxIds = new Set()
  for (const b of singles) fxIds.add(b.fixtureId)
  for (const legs of legsByParlay.values()) for (const l of legs) fxIds.add(l.fixtureId)
  const fxById = new Map()
  if (fxIds.size) {
    const fxs = await db.select().from(event).where(inArray(event.id, [...fxIds]))
    for (const row of fxs) fxById.set(row.id, flattenEvent(row))
  }
  const statusOf = (id) => fxById.get(id)?.status ?? null

  const people = await db.select().from(person).where(eq(person.sweepId, sweepId))
  const peopleById = new Map(people.map((p) => [p.id, p]))

  const groups = new Map()
  const groupFor = (pid) => {
    if (!groups.has(pid)) {
      const p = peopleById.get(pid)
      groups.set(pid, {
        person: p ? serializePerson(p) : { id: pid, name: pid, short: pid, initials: '??', av: '#888' },
        singles: [], parlays: [],
      })
    }
    return groups.get(pid)
  }

  for (const b of singles) {
    groupFor(b.personId).singles.push({
      ...serializeBet(b),
      fixtureStatus: statusOf(b.fixtureId),
      stale: gradeNow(b, fxById.get(b.fixtureId), sport) != null,
    })
  }
  for (const pl of openParlays) {
    const legs = legsByParlay.get(pl.id) ?? []
    const grades = legs.map((l) => gradeNow(l, fxById.get(l.fixtureId), sport))
    // settleParlay settles the moment any leg loses, or once every leg has won
    const stale = grades.some((g) => g === 'lost') || (legs.length > 0 && grades.every((g) => g === 'won'))
    const ser = serializeParlay(pl, legs)
    ser.legs = ser.legs.map((leg, i) => ({ ...leg, fixtureStatus: statusOf(leg.fixtureId) }))
    groupFor(pl.personId).parlays.push({ ...ser, stale })
  }

  const peopleOut = [...groups.values()].map((g) => ({
    ...g,
    openCount: g.singles.length + g.parlays.length,
    staleCount: g.singles.filter((s) => s.stale).length + g.parlays.filter((p) => p.stale).length,
  }))
  peopleOut.sort((a, b) =>
    b.staleCount - a.staleCount ||
    b.openCount - a.openCount ||
    a.person.name.localeCompare(b.person.name))

  return {
    people: peopleOut,
    totalOpen: peopleOut.reduce((n, g) => n + g.openCount, 0),
    totalStale: peopleOut.reduce((n, g) => n + g.staleCount, 0),
  }
}

/** A person's full ledger: every signed entry, newest-first, with a running balance and
 *  (for stake/payout/refund rows) the matching bet OR parlay attached. Grants carry their weekIndex. */
export async function statementFor(db, sweepId, personId, now = new Date()) {
  await ensureGrants(db, sweepId, personId, now)
  const rows = await db.select().from(coinLedger)
    .where(and(eq(coinLedger.sweepId, sweepId), eq(coinLedger.personId, personId)))
    .orderBy(coinLedger.createdAt, coinLedger.id)
  const bets = await db.select().from(bet).where(and(eq(bet.sweepId, sweepId), eq(bet.personId, personId)))
  const betById = new Map(bets.map((b) => [b.id, serializeBet(b)]))
  const parls = await db.select().from(parlay).where(and(eq(parlay.sweepId, sweepId), eq(parlay.personId, personId)))
  const parlayById = new Map()
  for (const pl of parls) {
    const legs = await db.select().from(bet).where(eq(bet.parlayId, pl.id))
    parlayById.set(pl.id, serializeParlay(pl, legs))
  }
  let running = 0
  const entries = rows.map((r) => {
    running += r.amount
    return {
      id: r.id,
      type: r.type,
      amount: r.amount,
      createdAt: r.createdAt,
      balanceAfter: running,
      weekIndex: r.type === 'grant' ? Number(r.refId) : null,
      fixtureId: (r.type === 'predict' || r.type === 'teamwin') ? r.refId : null,
      bet: r.type === 'grant' ? null : (betById.get(r.refId) ?? null),
      parlay: r.type === 'grant' ? null : (parlayById.get(r.refId) ?? null),
    }
  })
  entries.reverse() // newest first
  return { balance: running, entries }
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

export function serializeParlay(p, legs) {
  return { id: p.id, stake: p.stake, combinedOdds: Number(p.combinedOdds), potentialPayout: p.potentialPayout,
    status: p.status, placedAt: p.placedAt, settledAt: p.settledAt, legs: legs.map(serializeBet) }
}
