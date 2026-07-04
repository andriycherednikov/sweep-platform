import { eq } from 'drizzle-orm'
import { competitor, person, ownership } from '../db/schema.js'
import { serializeCompetitor, serializePerson } from '../serialize.js'
import { requireSweep } from '../sweeps/auth.js'
import { competitorCodeMap } from './competitors.js'
import { sweepLiveNow } from '../accounts/billing.js'

export async function bootstrapRoutes(app) {
  app.get('/api/bootstrap', { preHandler: requireSweep(['member', 'admin']) }, async (req) => {
    const sweepId = req.sweep.id
    const [teams, people, owns, codeById] = await Promise.all([
      app.db.select().from(competitor).where(eq(competitor.competitionId, req.sweep.competitionId)),
      app.db.select().from(person).where(eq(person.sweepId, sweepId)),
      app.db.select().from(ownership).where(eq(ownership.sweepId, sweepId)),
      competitorCodeMap(app.db, req.sweep.competitionId),
    ])
    const ownership_ = {}
    for (const o of owns) {
      const code = codeById.get(o.competitorId)
      if (code) (ownership_[o.personId] ??= []).push(code)
    }
    return {
      teams: teams.map(serializeCompetitor),
      people: people.map(serializePerson),
      ownership: ownership_,
      scoring: { rule: req.sweep.scoringRule, coOwners: req.sweep.coOwners },
      sweep: { id: req.sweep.id, name: req.sweep.name, role: req.role },
      readOnly: req.sweep ? !(await sweepLiveNow(app, req.sweep)) : false,
    }
  })
}
