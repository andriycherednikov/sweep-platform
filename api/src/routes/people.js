import { eq, and, sql, isNull } from 'drizzle-orm'
import { account, person, ownership } from '../db/schema.js'
import { serializePerson } from '../serialize.js'
import { requireSweep } from '../sweeps/auth.js'
import { newToken } from '../sweeps/tokens.js'
import { identityFor } from '../people/identity.js'
import { competitorCodeMap } from './competitors.js'

const meBody = {
  type: 'object', required: ['name'], additionalProperties: false,
  properties: { name: { type: 'string', minLength: 1, maxLength: 80 } },
}

export async function peopleRoutes(app) {
  app.get('/api/people', { preHandler: requireSweep(['member', 'admin']) }, async (req) => {
    const sweepId = req.sweep.id
    const [people, owns, codeById] = await Promise.all([
      app.db.select().from(person).where(eq(person.sweepId, sweepId)),
      app.db.select().from(ownership).where(eq(ownership.sweepId, sweepId)),
      competitorCodeMap(app.db, req.sweep.competitionId),
    ])
    const byPerson = {}
    for (const o of owns) {
      const code = codeById.get(o.competitorId)
      if (code) (byPerson[o.personId] ??= []).push(code)
    }
    return people.map((p) => ({ ...serializePerson(p), teams: byPerson[p.id] ?? [] }))
  })

  /** Take a seat in this sweep, as the account this request carries. Create, claim or
   *  rename - one route, because from the member's side they are one action ("this is
   *  me"), and which one it is depends on state they cannot see.
   *
   *  Deliberately NOT exempt from readOnlyGate: a lapsed sweep may still be signed into
   *  and read, but its roster must not grow. */
  app.post('/api/me', {
    preHandler: requireSweep(['member', 'admin']),
    schema: { body: meBody },
    config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
  }, async (req, reply) => {
    if (!req.account) return reply.code(401).send({ error: 'unauthorized' })
    const sweepId = req.sweep.id
    const name = req.body.name.trim()
    const derived = identityFor(name)

    // account.name was declared and never written, so the account console had only an
    // email to greet you by. This is the one moment somebody tells us their name.
    if (req.account.name !== name) {
      await app.db.update(account).set({ name }).where(eq(account.id, req.account.id))
    }

    const [held] = await app.db.select().from(person)
      .where(and(eq(person.sweepId, sweepId), eq(person.accountId, req.account.id)))
    if (held?.ejectedAt) return reply.code(403).send({ error: 'removed_from_sweep' })
    if (held) {
      await app.db.update(person).set({ name, ...derived }).where(eq(person.id, held.id))
      return send(reply, 200, sweepId, { ...held, name, ...derived })
    }

    // An owner-typed seat the organiser addressed to this person. The account_id IS NULL
    // predicate is the whole race story: two devices arrive, one UPDATE matches, the
    // loser falls through and gets a seat of its own rather than a 409 nobody can act on.
    const [claimed] = await app.db.update(person)
      .set({ accountId: req.account.id, claimedAt: new Date(), name, ...derived })
      .where(and(
        eq(person.sweepId, sweepId),
        sql`lower(${person.email}) = ${req.account.email.toLowerCase()}`,
        isNull(person.accountId), isNull(person.ejectedAt),
      ))
      .returning()
    if (claimed) return send(reply, 200, sweepId, claimed)

    const row = {
      id: `pn_${newToken(12)}`, sweepId, name, ...derived,
      email: req.account.email, accountId: req.account.id, claimedAt: new Date(),
    }
    try {
      await app.db.insert(person).values(row)
    } catch (e) {
      // person_sweep_account_uq: a concurrent call got there first. drizzle 0.45 wraps
      // driver errors, so read the pg code at both depths (routes/sweeps.js:222).
      if ((e?.code ?? e?.cause?.code) !== '23505') throw e
      const [existing] = await app.db.select().from(person)
        .where(and(eq(person.sweepId, sweepId), eq(person.accountId, req.account.id)))
      return send(reply, 200, sweepId, existing)
    }
    return send(reply, 201, sweepId, row)
  })

  async function send(reply, code, sweepId, row) {
    await app.publish({ type: 'sync', sweepId })
    return reply.code(code).send({ ...serializePerson(row), teams: [] })
  }
}
