import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { fixture, person, coinLedger, bet } from '../db/schema.js'
import { requireSweep } from '../sweeps/auth.js'
import { walletFor, leaderboard, ensureGrants, serializeBet, statementFor } from '../coins/ledger.js'

const member = requireSweep(['member', 'admin'])

const MARKETS = ['1x2', 'ou25', 'cards', 'fh1x2', 'cs']
const betBody = {
  type: 'object', required: ['fixtureId', 'personId', 'selection', 'stake'], additionalProperties: false,
  properties: {
    fixtureId: { type: 'string' }, personId: { type: 'string' },
    market: { type: 'string', enum: MARKETS }, selection: { type: 'string' }, stake: { type: 'integer', minimum: 1 },
  },
}

export async function coinsRoutes(app) {
  app.get('/api/coins', { preHandler: member }, async (req) => {
    const sweepId = req.sweep.id
    const board = await leaderboard(app.db, sweepId)
    const me = req.query?.personId
    let wallet = { balance: 0, weeklyGrant: 1000, bets: { open: [], settled: [] } }
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
    const [f] = await app.db.select().from(fixture).where(eq(fixture.id, fixtureId))
    if (!f) return reply.code(400).send({ error: 'unknown_fixture' })
    if (f.status !== 'upcoming') return reply.code(400).send({ error: 'betting_closed' })
    // group stage only for now: knockout odds are the 90-min 1X2 market, which would
    // mis-settle against our final (incl. ET/penalties) winnerCode.
    if (f.stage !== 'group') return reply.code(400).send({ error: 'not_group_stage' })
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
}
