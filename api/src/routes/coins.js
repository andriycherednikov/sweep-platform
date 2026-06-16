import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { fixture, person, coinLedger, bet } from '../db/schema.js'
import { requireSweep } from '../sweeps/auth.js'
import { walletFor, leaderboard, ensureGrants, balanceOf, serializeBet } from '../coins/ledger.js'

const member = requireSweep(['member', 'admin'])

const SELECTIONS = ['HOME', 'DRAW', 'AWAY']
const betBody = {
  type: 'object', required: ['fixtureId', 'personId', 'selection', 'stake'], additionalProperties: false,
  properties: {
    fixtureId: { type: 'string' }, personId: { type: 'string' },
    selection: { type: 'string', enum: SELECTIONS }, stake: { type: 'integer', minimum: 1 },
  },
}

export async function coinsRoutes(app) {
  app.get('/api/coins', { preHandler: member }, async (req) => {
    const sweepId = req.sweep.id
    const board = await leaderboard(app.db, sweepId)
    const me = req.query?.personId
    const wallet = me ? await walletFor(app.db, sweepId, me) : { balance: 0, weeklyGrant: 1000, bets: { open: [], settled: [] } }
    return { ...wallet, leaderboard: board }
  })

  app.post('/api/bet', { preHandler: member, schema: { body: betBody } }, async (req, reply) => {
    const sweepId = req.sweep.id
    const { fixtureId, personId, selection, stake } = req.body
    const [p] = await app.db.select().from(person).where(and(eq(person.id, personId), eq(person.sweepId, sweepId)))
    if (!p) return reply.code(400).send({ error: 'unknown_person' })
    const [f] = await app.db.select().from(fixture).where(eq(fixture.id, fixtureId))
    if (!f) return reply.code(400).send({ error: 'unknown_fixture' })
    if (f.status !== 'upcoming') return reply.code(400).send({ error: 'betting_closed' })
    if (selection === 'DRAW' && f.stage !== 'group') return reply.code(400).send({ error: 'invalid_selection' })
    const oddsCol = selection === 'HOME' ? f.oddsHome : selection === 'AWAY' ? f.oddsAway : f.oddsDraw
    if (oddsCol == null) return reply.code(400).send({ error: 'no_odds' })

    await ensureGrants(app.db, sweepId, personId)
    const balance = await balanceOf(app.db, sweepId, personId)
    if (stake > balance) return reply.code(400).send({ error: 'insufficient_funds' })

    const odds = Number(oddsCol)
    const potentialPayout = Math.round(stake * odds)
    const id = randomUUID()
    await app.db.transaction(async (tx) => {
      await tx.insert(coinLedger).values({ sweepId, personId, type: 'stake', amount: -stake, refId: id })
      await tx.insert(bet).values({ id, sweepId, personId, fixtureId, selection, stake,
        oddsDecimal: String(odds), book: f.oddsBook, potentialPayout, status: 'open' })
    })

    const [row] = await app.db.select().from(bet).where(eq(bet.id, id))
    await app.publish({ type: 'bet', sweepId, personId, fixtureId })
    return { bet: serializeBet(row), balance: balance - stake }
  })
}
