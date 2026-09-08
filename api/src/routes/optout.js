import { and, eq } from 'drizzle-orm'
import { person } from '../db/schema.js'
import { requireSweep, requirePerson } from '../sweeps/auth.js'
import { OPT_OUT_DURATIONS, untilFor, extendUntil } from '../optout.js'

const member = requireSweep(['member', 'admin'])

const optoutBody = {
  type: 'object', required: ['duration'], additionalProperties: false,
  properties: { duration: { type: 'string', enum: OPT_OUT_DURATIONS } },
}

export async function optoutRoutes(app) {
  // Self-service Wagers exclusion, on the caller's OWN seat — never on a person named
  // in the body. This one is why identity had to stop being a request parameter: the
  // window only ever extends, 'forever' is a year-9999 sentinel, and there is no
  // un-exclude endpoint at any role, so barring someone else was irreversible.
  app.post('/api/optout', {
    preHandler: [member, requirePerson(app)], schema: { body: optoutBody },
  }, async (req) => {
    const sweepId = req.sweep.id
    const { duration } = req.body
    const p = req.person
    const personId = p.id

    const until = extendUntil(p.excludedUntil, untilFor(duration))
    await app.db.update(person).set({ excludedUntil: until }).where(and(eq(person.id, personId), eq(person.sweepId, sweepId)))

    await app.publish({ type: 'sync', sweepId })
    return { personId, excluded: true, until: until.toISOString() }
  })
}
