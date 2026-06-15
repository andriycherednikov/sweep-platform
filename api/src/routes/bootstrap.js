import { eq } from 'drizzle-orm'
import { team, person, ownership } from '../db/schema.js'
import { serializeTeam, serializePerson } from '../serialize.js'
import { requireSweep } from '../sweeps/auth.js'

export async function bootstrapRoutes(app) {
  app.get('/api/bootstrap', { preHandler: requireSweep(['member', 'admin']) }, async (req) => {
    const sweepId = req.sweep.id
    const [teams, people, owns] = await Promise.all([
      app.db.select().from(team),
      app.db.select().from(person).where(eq(person.sweepId, sweepId)),
      app.db.select().from(ownership).where(eq(ownership.sweepId, sweepId)),
    ])
    const ownership_ = {}
    for (const o of owns) (ownership_[o.personId] ??= []).push(o.teamCode)
    return {
      teams: teams.map(serializeTeam),
      people: people.map(serializePerson),
      ownership: ownership_,
      scoring: { rule: req.sweep.scoringRule, coOwners: req.sweep.coOwners },
      sweep: { id: req.sweep.id, name: req.sweep.name },
    }
  })
}
