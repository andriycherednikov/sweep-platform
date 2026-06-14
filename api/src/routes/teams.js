import { and, eq } from 'drizzle-orm'
import { team, ownership, person } from '../db/schema.js'
import { serializeTeam, serializePerson } from '../serialize.js'
import { requireSweep } from '../sweeps/auth.js'

export async function teamRoutes(app) {
  app.get('/api/teams/:code', { preHandler: requireSweep(['member', 'admin']) }, async (req, reply) => {
    const rows = await app.db.select().from(team).where(eq(team.code, req.params.code))
    if (!rows.length) return reply.code(404).send({ error: 'not_found' })
    const owners = await app.db.select({ p: person }).from(ownership)
      .innerJoin(person, eq(person.id, ownership.personId))
      .where(and(eq(ownership.teamCode, req.params.code), eq(ownership.sweepId, req.sweep.id)))
    return { ...serializeTeam(rows[0]), owners: owners.map((r) => serializePerson(r.p)) }
  })
}
