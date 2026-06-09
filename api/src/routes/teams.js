import { eq } from 'drizzle-orm'
import { team, ownership, person } from '../db/schema.js'
import { serializeTeam, serializePerson } from '../serialize.js'

export async function teamRoutes(app) {
  app.get('/api/teams/:code', async (req, reply) => {
    const rows = await app.db.select().from(team).where(eq(team.code, req.params.code))
    if (!rows.length) return reply.code(404).send({ error: 'not_found' })
    const owners = await app.db.select({ p: person }).from(ownership)
      .innerJoin(person, eq(person.id, ownership.personId))
      .where(eq(ownership.teamCode, req.params.code))
    return { ...serializeTeam(rows[0]), owners: owners.map((r) => serializePerson(r.p)) }
  })
}
