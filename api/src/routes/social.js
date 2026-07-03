import { and, eq } from 'drizzle-orm'
import { person, support, competition } from '../db/schema.js'
import { eventInCompetition, flattenEvent } from '../db/event-shape.js'
import { requireSweep } from '../sweeps/auth.js'
import { sportConfig } from '../sports.js'

const DRAW = 'DRAW'
const member = requireSweep(['member', 'admin'])

const supportBody = {
  type: 'object', required: ['fixtureId', 'personId', 'teamCode'], additionalProperties: false,
  properties: { fixtureId: { type: 'string' }, personId: { type: 'string' }, teamCode: { type: 'string' } },
}

export async function socialRoutes(app) {
  app.get('/api/social', { preHandler: member }, async (req) => {
    const sweepId = req.sweep.id
    const ss = await app.db.select().from(support).where(eq(support.sweepId, sweepId))
    const support_ = {}
    for (const s of ss) (support_[s.fixtureId] ??= {})[s.personId] = s.teamCode
    return { support: support_ }
  })

  app.post('/api/support', { preHandler: member, schema: { body: supportBody } }, async (req, reply) => {
    const sweepId = req.sweep.id
    const { fixtureId, personId, teamCode } = req.body
    const row = await eventInCompetition(app.db, req.sweep.competitionId, fixtureId)
    if (!row) return reply.code(400).send({ error: 'unknown_fixture' })
    const f = flattenEvent(row)
    const [p] = await app.db.select().from(person).where(and(eq(person.id, personId), eq(person.sweepId, sweepId)))
    if (!p) return reply.code(400).send({ error: 'unknown_person' })
    let validPick = teamCode === f.t1Code || teamCode === f.t2Code
    if (!validPick && teamCode === DRAW && f.stage === 'group') {
      // draw picks only exist in sports that can draw (football); NBA etc. are 2-way
      const [comp] = await app.db.select({ sport: competition.sport }).from(competition)
        .where(eq(competition.id, req.sweep.competitionId))
      validPick = comp ? sportConfig(comp.sport).hasDraws : false
    }
    if (!validPick) return reply.code(400).send({ error: 'invalid_team' })

    const where = and(eq(support.fixtureId, fixtureId), eq(support.personId, personId))
    const [existing] = await app.db.select().from(support).where(where)
    let supporting, action
    if (existing && existing.teamCode === teamCode) {
      await app.db.delete(support).where(where); supporting = null; action = 'remove'
    } else if (existing) {
      await app.db.update(support).set({ teamCode }).where(where); supporting = teamCode; action = 'switch'
    } else {
      await app.db.insert(support).values({ sweepId, fixtureId, personId, teamCode }); supporting = teamCode; action = 'pick'
    }

    await app.publish({ type: 'support', sweepId, fixtureId, personId, supporting, action })
    return { fixtureId, personId, supporting }
  })
}
