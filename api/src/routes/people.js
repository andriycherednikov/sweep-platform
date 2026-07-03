import { eq } from 'drizzle-orm'
import { person, ownership } from '../db/schema.js'
import { serializePerson } from '../serialize.js'
import { requireSweep } from '../sweeps/auth.js'
import { competitorCodeMap } from './competitors.js'

export async function peopleRoutes(app) {
  app.get('/api/people', { preHandler: requireSweep(['member', 'admin']) }, async (req) => {
    const sweepId = req.sweep.id
    const [people, owns, codeById] = await Promise.all([
      app.db.select().from(person).where(eq(person.sweepId, sweepId)),
      app.db.select().from(ownership).where(eq(ownership.sweepId, sweepId)),
      competitorCodeMap(app.db, req.sweep.competitionId),
    ])
    const byPerson = {}
    for (const o of owns) {
      const code = codeById.get(o.competitorId)
      if (code) (byPerson[o.personId] ??= []).push(code)
    }
    return people.map((p) => ({ ...serializePerson(p), teams: byPerson[p.id] ?? [] }))
  })
}
