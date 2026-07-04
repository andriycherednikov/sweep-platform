import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { person, coinLedger, bet, parlay } from '../db/schema.js'
import { eventInCompetition, flattenEvent } from '../db/event-shape.js'
import { requireSweep } from '../sweeps/auth.js'
import { walletFor, leaderboard, ensureGrants, serializeBet, statementFor, serializeParlay } from '../wagering/ledger.js'

const member = requireSweep(['member', 'admin'])

const MARKETS = ['1x2', 'toq', 'ou25', 'cards', 'fh1x2', 'cs', 'btts', 'dc', 'oe', 'fhou', 'gs']
const betBody = {
  type: 'object', required: ['fixtureId', 'personId', 'selection', 'stake'], additionalProperties: false,
  properties: {
    fixtureId: { type: 'string' }, personId: { type: 'string' },
    market: { type: 'string', enum: MARKETS }, selection: { type: 'string' }, stake: { type: 'integer', minimum: 1 },
  },
}

const parlayBody = {
  type: 'object', required: ['personId', 'stake', 'legs'], additionalProperties: false,
  properties: {
    personId: { type: 'string' }, stake: { type: 'integer', minimum: 1 },
    legs: { type: 'array', minItems: 1, items: {
      type: 'object', required: ['fixtureId', 'selection'], additionalProperties: false,
      properties: { fixtureId: { type: 'string' }, market: { type: 'string', enum: MARKETS }, selection: { type: 'string' } } } },
  },
}

export async function coinsRoutes(app) {
  app.get('/api/coins', { preHandler: member }, async (req) => {
    const sweepId = req.sweep.id
    const board = await leaderboard(app.db, sweepId)
    const me = req.query?.personId
    let wallet = { balance: 0, weeklyGrant: 1000, bets: { open: [], settled: [] }, parlays: { open: [], settled: [] } }
    if (me) {
      // validate the person belongs to this sweep before walletFor (which grants/inserts),
      // so a bogus ?personId returns an empty wallet rather than an FK error
      const [p] = await app.db.select().from(person).where(and(eq(person.id, me), eq(person.sweepId, sweepId)))
      if (p) wallet = await walletFor(app.db, sweepId, me)
    }
    return { ...wallet, leaderboard: board }
  })

  app.get('/api/coins/ledger', { preHandler: member }, async (req) => {
    const sweepId = req.sweep.id
    const me = req.query?.personId
    if (!me) return { balance: 0, entries: [] }
    // mirror GET /api/coins: validate the person belongs to this sweep before statementFor
    // (which grants/inserts), so a bogus ?personId returns empty rather than an FK error
    const [p] = await app.db.select().from(person).where(and(eq(person.id, me), eq(person.sweepId, sweepId)))
    if (!p) return { balance: 0, entries: [] }
    return statementFor(app.db, sweepId, me)
  })

  app.post('/api/bet', { preHandler: member, schema: { body: betBody } }, async (req, reply) => {
    const sweepId = req.sweep.id
    const { fixtureId, personId, selection, stake } = req.body
    const market = req.body.market ?? '1x2'
    const [p] = await app.db.select().from(person).where(and(eq(person.id, personId), eq(person.sweepId, sweepId)))
    if (!p) return reply.code(400).send({ error: 'unknown_person' })
    // wagers are 18+ — enforce server-side so minors can't bet by bypassing the UI
    if (p.adult === false) return reply.code(403).send({ error: 'minor_not_allowed' })
    const evRow = await eventInCompetition(app.db, req.sweep.competitionId, fixtureId)
    if (!evRow) return reply.code(400).send({ error: 'unknown_fixture' })
    const f = flattenEvent(evRow)
    if (f.status !== 'upcoming') return reply.code(400).send({ error: 'betting_closed' })
    const mk = f.markets?.[market]
    const sel = mk?.selections?.find((s) => s.key === selection)
    if (!sel) return reply.code(400).send({ error: 'no_odds' })
    const odds = Number(sel.odds)
    if (!Number.isFinite(odds) || odds <= 1) return reply.code(400).send({ error: 'invalid_odds' })
    const line = mk.line ?? null

    // grants are idempotent and best run outside the lock so the in-tx balance includes them
    await ensureGrants(app.db, sweepId, personId)

    const potentialPayout = Math.round(stake * odds)
    const id = randomUUID()
    // Serialize this person's bets so the balance check + stake deduction are atomic — a
    // transaction-scoped advisory lock means two concurrent bets can't both overdraw.
    const result = await app.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sweepId}), hashtext(${personId}))`)
      const [b] = await tx.select({ total: sql`coalesce(sum(${coinLedger.amount}), 0)` })
        .from(coinLedger).where(and(eq(coinLedger.sweepId, sweepId), eq(coinLedger.personId, personId)))
      const balance = Number(b.total)
      if (stake > balance) return { error: 'insufficient_funds' }
      await tx.insert(coinLedger).values({ sweepId, personId, type: 'stake', amount: -stake, refId: id })
      await tx.insert(bet).values({ id, sweepId, personId, fixtureId, market, selection, stake,
        oddsDecimal: String(odds), book: mk.book ?? null, line: line == null ? null : String(line),
        potentialPayout, status: 'open' })
      return { balance: balance - stake }
    })
    if (result.error) return reply.code(400).send({ error: result.error })

    const [row] = await app.db.select().from(bet).where(eq(bet.id, id))
    // notify the sweep: who + what selection + which game (never the stake)
    await app.publish({ type: 'bet', sweepId, personId, fixtureId, market, selection })
    return { bet: serializeBet(row), balance: result.balance }
  })

  app.post('/api/parlay', { preHandler: member, schema: { body: parlayBody } }, async (req, reply) => {
    const sweepId = req.sweep.id
    const { personId, stake, legs } = req.body
    const [p] = await app.db.select().from(person).where(and(eq(person.id, personId), eq(person.sweepId, sweepId)))
    if (!p) return reply.code(400).send({ error: 'unknown_person' })
    if (p.adult === false) return reply.code(403).send({ error: 'minor_not_allowed' })
    if (legs.length < 2) return reply.code(400).send({ error: 'too_few_legs' })
    // Same-game multis are allowed (e.g. 1x2 + ou25 on one fixture), but two selections of
    // the SAME market on the SAME fixture can never both win — dedupe on fixtureId|market.
    const seen = new Set()
    for (const l of legs) {
      const key = `${l.fixtureId}|${l.market ?? '1x2'}`
      if (seen.has(key)) return reply.code(400).send({ error: 'duplicate_market', fixtureId: l.fixtureId, market: l.market ?? '1x2' })
      seen.add(key)
    }
    const resolved = []
    for (const l of legs) {
      const market = l.market ?? '1x2'
      const row = await eventInCompetition(app.db, req.sweep.competitionId, l.fixtureId)
      if (!row) return reply.code(400).send({ error: 'fixture_not_found', fixtureId: l.fixtureId })
      const f = flattenEvent(row)
      if (f.status !== 'upcoming') return reply.code(400).send({ error: 'leg_betting_closed', fixtureId: l.fixtureId })
      const mk = f.markets?.[market]
      const sel = mk?.selections?.find((s) => s.key === l.selection)
      const odds = sel ? Number(sel.odds) : NaN
      if (!sel || !Number.isFinite(odds) || odds <= 1) return reply.code(400).send({ error: 'leg_no_odds', fixtureId: l.fixtureId, market, selection: l.selection })
      resolved.push({ fixtureId: l.fixtureId, market, selection: l.selection, odds, line: mk.line ?? null, book: mk.book ?? null })
    }

    await ensureGrants(app.db, sweepId, personId)
    const combinedOdds = resolved.reduce((acc, r) => acc * r.odds, 1)
    const potentialPayout = Math.round(stake * combinedOdds)
    const parlayId = `par_${randomUUID()}`
    const result = await app.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sweepId}), hashtext(${personId}))`)
      const [b] = await tx.select({ total: sql`coalesce(sum(${coinLedger.amount}), 0)` })
        .from(coinLedger).where(and(eq(coinLedger.sweepId, sweepId), eq(coinLedger.personId, personId)))
      const balance = Number(b.total)
      if (stake > balance) return { error: 'insufficient_funds' }
      await tx.insert(coinLedger).values({ sweepId, personId, type: 'stake', amount: -stake, refId: parlayId })
      await tx.insert(parlay).values({ id: parlayId, sweepId, personId, stake, combinedOdds: String(combinedOdds), potentialPayout, status: 'open' })
      for (const r of resolved) {
        await tx.insert(bet).values({ id: randomUUID(), sweepId, personId, fixtureId: r.fixtureId, parlayId,
          market: r.market, selection: r.selection, line: r.line == null ? null : String(r.line),
          stake: 0, oddsDecimal: String(r.odds), book: r.book, potentialPayout: 0, status: 'open' })
      }
      return { balance: balance - stake }
    })
    if (result.error) return reply.code(400).send({ error: result.error })

    const [prow] = await app.db.select().from(parlay).where(eq(parlay.id, parlayId))
    const legRows = await app.db.select().from(bet).where(eq(bet.parlayId, parlayId))
    await app.publish({ type: 'bet', sweepId, personId, parlay: true, legCount: legRows.length })
    return { parlay: serializeParlay(prow, legRows), balance: result.balance }
  })
}
