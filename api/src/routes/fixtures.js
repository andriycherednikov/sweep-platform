import { and, asc, eq } from 'drizzle-orm'
import { event, ownership } from '../db/schema.js'
import { eventInCompetition } from '../db/event-shape.js'
import { serializeEvent } from '../serialize.js'
import { requireSweep } from '../sweeps/auth.js'
import { competitorCodeMap } from './competitors.js'

export async function fixtureRoutes(app) {
  const member = requireSweep(['member', 'admin'])

  app.get('/api/fixtures', { preHandler: member }, async (req) => {
    const { team: teamCode, person: personId } = req.query
    let rows = await app.db.select().from(event)
      .where(eq(event.competitionId, req.sweep.competitionId)).orderBy(asc(event.startUtc))
    if (teamCode) rows = rows.filter((f) => f.c1Code === teamCode || f.c2Code === teamCode)
    if (personId) {
      const [owns, codeById] = await Promise.all([
        app.db.select().from(ownership).where(and(eq(ownership.personId, personId), eq(ownership.sweepId, req.sweep.id))),
        competitorCodeMap(app.db, req.sweep.competitionId),
      ])
      const codes = new Set(owns.map((o) => codeById.get(o.competitorId)).filter(Boolean))
      rows = rows.filter((f) => codes.has(f.c1Code) || codes.has(f.c2Code))
    }
    return rows.map(serializeEvent)
  })

  app.get('/api/fixtures/:id', { preHandler: member }, async (req, reply) => {
    const row = await eventInCompetition(app.db, req.sweep.competitionId, req.params.id)
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return serializeEvent(row)
  })
}
