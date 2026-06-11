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

  app.post('/api/support', { schema: { body: supportBody } }, async (req, reply) => {
    const { fixtureId, personId, teamCode } = req.body
    const [f] = await app.db.select().from(fixture).where(eq(fixture.id, fixtureId))
    if (!f) return reply.code(400).send({ error: 'unknown_fixture' })
    const [p] = await app.db.select().from(person).where(eq(person.id, personId))
    if (!p) return reply.code(400).send({ error: 'unknown_person' })
    if (teamCode !== f.t1Code && teamCode !== f.t2Code) return reply.code(400).send({ error: 'invalid_team' })

    const where = and(eq(support.fixtureId, fixtureId), eq(support.personId, personId))
    const [existing] = await app.db.select().from(support).where(where)
    let supporting, action
    if (existing && existing.teamCode === teamCode) {
      await app.db.delete(support).where(where); supporting = null; action = 'remove'
    } else if (existing) {
      await app.db.update(support).set({ teamCode }).where(where); supporting = teamCode; action = 'switch'
    } else {
      await app.db.insert(support).values({ fixtureId, personId, teamCode }); supporting = teamCode; action = 'pick'
    }

    await app.publish({ type: 'support', fixtureId, personId, supporting, action })
    return { fixtureId, personId, supporting }
  })
}
