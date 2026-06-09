import { asc, eq } from 'drizzle-orm'
import { fixture, ownership } from '../db/schema.js'
import { serializeFixture } from '../serialize.js'

export async function fixtureRoutes(app) {
  app.get('/api/fixtures', async (req) => {
    const { team: teamCode, person: personId } = req.query
    let rows = await app.db.select().from(fixture).orderBy(asc(fixture.kickoffUtc))
    if (teamCode) rows = rows.filter((f) => f.t1Code === teamCode || f.t2Code === teamCode)
    if (personId) {
      const owns = await app.db.select().from(ownership).where(eq(ownership.personId, personId))
      const codes = new Set(owns.map((o) => o.teamCode))
      rows = rows.filter((f) => codes.has(f.t1Code) || codes.has(f.t2Code))
    }
    return rows.map(serializeFixture)
  })

  app.get('/api/fixtures/:id', async (req, reply) => {
    const rows = await app.db.select().from(fixture).where(eq(fixture.id, req.params.id))
    if (!rows.length) return reply.code(404).send({ error: 'not_found' })
    return serializeFixture(rows[0])
  })
}
