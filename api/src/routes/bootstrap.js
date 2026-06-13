import { eq } from 'drizzle-orm'
import { team, person, ownership, sweep } from '../db/schema.js'
import { serializeTeam, serializePerson } from '../serialize.js'

export async function bootstrapRoutes(app) {
  app.get('/api/bootstrap', async () => {
    const [teams, people, owns, sweeps] = await Promise.all([
      app.db.select().from(team),
      app.db.select().from(person),
      app.db.select().from(ownership),
      app.db.select().from(sweep).where(eq(sweep.id, 'default')),
    ])
    const ownership_ = {}
    for (const o of owns) (ownership_[o.personId] ??= []).push(o.teamCode)
    const s = sweeps[0]
    return {
      teams: teams.map(serializeTeam),
      people: people.map(serializePerson),
      ownership: ownership_,
      scoring: s ? { rule: s.scoringRule, coOwners: s.coOwners } : null,
    }
  })
}
