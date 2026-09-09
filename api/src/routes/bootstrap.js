import { eq } from 'drizzle-orm'
import { competitor, person, ownership, competition } from '../db/schema.js'
import { serializeCompetitor, serializePerson } from '../serialize.js'
import { requireSweep } from '../sweeps/auth.js'
import { competitorCodeMap } from './competitors.js'
import { sweepLiveNow } from '../accounts/billing.js'
import { sportConfig } from '../sports.js'

export async function bootstrapRoutes(app) {
  app.get('/api/bootstrap', { preHandler: requireSweep(['member', 'admin']) }, async (req) => {
    const sweepId = req.sweep.id
    const [teams, people, owns, codeById, comp] = await Promise.all([
      app.db.select().from(competitor).where(eq(competitor.competitionId, req.sweep.competitionId)),
      app.db.select().from(person).where(eq(person.sweepId, sweepId)),
      app.db.select().from(ownership).where(eq(ownership.sweepId, sweepId)),
      competitorCodeMap(app.db, req.sweep.competitionId),
      app.db.select().from(competition).where(eq(competition.id, req.sweep.competitionId)).then((r) => r[0]),
    ])
    const ownership_ = {}
    for (const o of owns) {
      const code = codeById.get(o.competitorId)
      if (code) (ownership_[o.personId] ??= []).push(code)
    }
    return {
      teams: teams.map(serializeCompetitor),
      // claimed/ejected are roster state everyone can see; the address is not - it is
      // the owner's to manage, and a group does not need each other's inboxes.
      people: people.map((p) => ({
        ...serializePerson(p),
        claimed: !!p.accountId,
        ejected: !!p.ejectedAt,
        ...(req.role === 'admin' ? { email: p.email, claimedAt: p.claimedAt } : {}),
      })),
      // Who the caller is, resolved server-side. The client used to decide this from a
      // string in localStorage. Free: `people` is already in memory.
      meId: people.find((p) => p.accountId && p.accountId === req.account?.id && !p.ejectedAt)?.id ?? null,
      // ...and who they are when they have NO seat. An owner who spun this sweep up from
      // the console has an account but no person row, and the identity chip could only
      // say "Nobody yet" at them. Their own address is not a disclosure.
      account: req.account ? { email: req.account.email, name: req.account.name ?? null } : null,
      ownership: ownership_,
      scoring: { rule: req.sweep.scoringRule, coOwners: req.sweep.coOwners },
      sweep: { id: req.sweep.id, name: req.sweep.name, role: req.role },
      readOnly: req.sweep ? !(await sweepLiveNow(app, req.sweep)) : false,
      wageringEnabled: req.sweep?.wageringEnabled ?? false,
      competition: comp ? {
        sport: comp.sport, hasDraws: sportConfig(comp.sport).hasDraws,
        name: comp.name, season: comp.season, format: comp.format, logo: comp.logo ?? null,
      } : null,
    }
  })
}
