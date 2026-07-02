import { and, eq } from 'drizzle-orm'
import { competitor, ownership, person } from '../db/schema.js'
import { serializeCompetitor, serializePerson } from '../serialize.js'
import { requireSweep } from '../sweeps/auth.js'

export async function teamRoutes(app) {
  app.get('/api/teams/:code', { preHandler: requireSweep(['member', 'admin']) }, async (req, reply) => {
    const rows = await app.db.select().from(competitor)
      .where(and(eq(competitor.code, req.params.code), eq(competitor.competitionId, req.sweep.competitionId)))
    if (!rows.length) return reply.code(404).send({ error: 'not_found' })
    const owners = await app.db.select({ p: person }).from(ownership)
      .innerJoin(person, eq(person.id, ownership.personId))
      .where(and(eq(ownership.teamCode, req.params.code), eq(ownership.sweepId, req.sweep.id)))
    return { ...serializeCompetitor(rows[0]), owners: owners.map((r) => serializePerson(r.p)) }
  })
}
