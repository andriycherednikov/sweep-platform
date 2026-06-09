import { and, eq } from 'drizzle-orm'
import { fixture, person, watch, support } from '../db/schema.js'

const watchBody = {
  type: 'object', required: ['fixtureId', 'personId'], additionalProperties: false,
  properties: { fixtureId: { type: 'string' }, personId: { type: 'string' } },
}
const supportBody = {
  type: 'object', required: ['fixtureId', 'personId', 'teamCode'], additionalProperties: false,
  properties: { fixtureId: { type: 'string' }, personId: { type: 'string' }, teamCode: { type: 'string' } },
}

export async function socialRoutes(app) {
  app.get('/api/social', async () => {
    const [ws, ss] = await Promise.all([
      app.db.select().from(watch),
      app.db.select().from(support),
    ])
    const watch_ = {}
    for (const w of ws) (watch_[w.fixtureId] ??= []).push(w.personId)
    const support_ = {}
    for (const s of ss) (support_[s.fixtureId] ??= {})[s.personId] = s.teamCode
    return { watch: watch_, support: support_ }
  })

  app.post('/api/watch', { schema: { body: watchBody } }, async (req, reply) => {
    const { fixtureId, personId } = req.body
    const [f] = await app.db.select().from(fixture).where(eq(fixture.id, fixtureId))
    if (!f) return reply.code(400).send({ error: 'unknown_fixture' })
    const [p] = await app.db.select().from(person).where(eq(person.id, personId))
    if (!p) return reply.code(400).send({ error: 'unknown_person' })

    const where = and(eq(watch.fixtureId, fixtureId), eq(watch.personId, personId))
    const existing = await app.db.select().from(watch).where(where)
    let watching
    if (existing.length) { await app.db.delete(watch).where(where); watching = false }
    else { await app.db.insert(watch).values({ fixtureId, personId }); watching = true }

    await app.publish({ type: 'watch', fixtureId })
    return { fixtureId, personId, watching }
  })

  // POST /api/support is added in Task 6 (same file).
}
