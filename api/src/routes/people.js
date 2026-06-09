import { person, ownership } from '../db/schema.js'
import { serializePerson } from '../serialize.js'

export async function peopleRoutes(app) {
  app.get('/api/people', async () => {
    const [people, owns] = await Promise.all([
      app.db.select().from(person),
      app.db.select().from(ownership),
    ])
    const byPerson = {}
    for (const o of owns) (byPerson[o.personId] ??= []).push(o.teamCode)
    return people.map((p) => ({ ...serializePerson(p), teams: byPerson[p.id] ?? [] }))
  })
}
