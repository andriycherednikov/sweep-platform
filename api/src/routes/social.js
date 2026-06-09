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

  // POST /api/watch and /api/support are added in Tasks 5 & 6 (same file).
}
