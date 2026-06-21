import { and, eq } from 'drizzle-orm'
import { person } from '../db/schema.js'
import { requireSweep } from '../sweeps/auth.js'
import { OPT_OUT_DURATIONS, untilFor, extendUntil } from '../optout.js'

const member = requireSweep(['member', 'admin'])

const optoutBody = {
  type: 'object', required: ['personId', 'duration'], additionalProperties: false,
  properties: {
    personId: { type: 'string' },
    duration: { type: 'string', enum: OPT_OUT_DURATIONS },
  },
}

export async function optoutRoutes(app) {
  // Self-service Wagers exclusion. Light identity → the client sends its own personId.
  // Binding: only ever extends the window (never an early reversal), so there is no
  // matching "un-exclude" endpoint; timed windows lapse on their own.
  app.post('/api/optout', { preHandler: member, schema: { body: optoutBody } }, async (req, reply) => {
    const sweepId = req.sweep.id
    const { personId, duration } = req.body
    const [p] = await app.db.select().from(person).where(and(eq(person.id, personId), eq(person.sweepId, sweepId)))
    if (!p) return reply.code(400).send({ error: 'unknown_person' })

    const until = extendUntil(p.excludedUntil, untilFor(duration))
    await app.db.update(person).set({ excludedUntil: until }).where(and(eq(person.id, personId), eq(person.sweepId, sweepId)))

    await app.publish({ type: 'sync', sweepId })
    return { personId, excluded: true, until: until.toISOString() }
  })
}
