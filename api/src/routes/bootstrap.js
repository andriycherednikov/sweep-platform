import { team, person, ownership, scoringConfig } from '../db/schema.js'
import { serializeTeam, serializePerson } from '../serialize.js'

export async function bootstrapRoutes(app) {
  app.get('/api/bootstrap', async () => {
    const [teams, people, owns, scoring] = await Promise.all([
      app.db.select().from(team),
      app.db.select().from(person),
      app.db.select().from(ownership),
      app.db.select().from(scoringConfig),
    ])
    const ownership_ = {}
    for (const o of owns) (ownership_[o.personId] ??= []).push(o.teamCode)
    return {
      teams: teams.map(serializeTeam),
      people: people.map(serializePerson),
      ownership: ownership_,
      scoring: scoring[0] ?? null,
    }
  })
}
