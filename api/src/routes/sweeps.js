import { eq, or, and, inArray } from 'drizzle-orm'
import { sweep, person, ownership, competitor, photo, loginToken } from '../db/schema.js'
import { newToken } from '../sweeps/tokens.js'
import { SWEEP_COOKIE, COOKIE_MAX_AGE, signSweepCookie, readSweepList, withSweep, requireSweep } from '../sweeps/auth.js'
import { requireOperator } from '../accounts/auth.js'
import { recordOperatorAction } from '../accounts/audit.js'
import { codeToCompetitorId } from './competitors.js'
import { correctFixture } from '../corrections.js'
import { inviteMail } from '../mail.js'
import { INVITE_TTL_MS } from '../accounts/auth.js'
import { and as _and, isNull as _isNull } from 'drizzle-orm'

const sessionBody = {
  type: 'object', required: ['token'], additionalProperties: false,
  properties: { token: { type: 'string', minLength: 8, maxLength: 64 } },
}

// A score correction is competition-level — every sweep following that competition sees
// it — so it belongs to the operator, not to a group admin whose authority stops at their
// own sweep. `reason` is required: a silent correction is indistinguishable from a bug.
const correctBody = {
  type: 'object', required: ['score1', 'score2', 'reason'], additionalProperties: false,
  properties: {
    score1: { type: 'integer', minimum: 0, maximum: 200 },
    score2: { type: 'integer', minimum: 0, maximum: 200 },
    status: { type: 'string', enum: ['final', 'scheduled', 'live'] },
    reg: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 200 }, minItems: 2, maxItems: 2 },
    pen: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 200 }, minItems: 2, maxItems: 2 },
    reason: { type: 'string', minLength: 3, maxLength: 200 },
  },
}
const patchBody = {
  type: 'object', additionalProperties: false, minProperties: 1,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 80 },
    scoringRule: { type: 'string', minLength: 1, maxLength: 40 },
    coOwners: { type: 'string', minLength: 1, maxLength: 40 },
  },
}

export function links(app, row) {
  return { memberLink: `${app.publicOrigin}/g/${row.memberToken}` }
}

export async function sweepsRoutes(app) {
  app.post('/api/session', {
    schema: { body: sessionBody },
    // Every /g/ open and every switch posts here, so a household or an office behind
    // one NAT burns through a tight budget on legitimate traffic. Still bounded: the
    // token itself is 22 chars of base62, so this is not what stops a guesser.
    config: { rateLimit: { max: 100, timeWindow: '15 minutes' } },
  }, async (req, reply) => {
    const { token } = req.body
    const [row] = await app.db.select().from(sweep).where(eq(sweep.memberToken, token))
    if (!row || row.archivedAt) return reply.code(404).send({ error: 'not_found' })
    // Merge, never replace: opening one group's invite must not sign you out of another's.
    reply.setCookie(SWEEP_COOKIE, reply.signCookie(signSweepCookie(withSweep(readSweepList(app, req), row.id))), {
      httpOnly: true, sameSite: 'lax', path: '/', maxAge: COOKIE_MAX_AGE,
      secure: process.env.NODE_ENV === 'production',
    })
    return { sweepId: row.id }
  })

  /** ?sweep=<id> leaves one sweep and keeps the rest; no param still clears the lot. */
  app.post('/api/session/logout', async (req, reply) => {
    const drop = req.query?.sweep
    const rest = drop ? (readSweepList(app, req) ?? []).filter((id) => id !== drop) : []
    if (rest.length) {
      reply.setCookie(SWEEP_COOKIE, reply.signCookie(signSweepCookie(rest)), {
        httpOnly: true, sameSite: 'lax', path: '/', maxAge: COOKIE_MAX_AGE,
        secure: process.env.NODE_ENV === 'production',
      })
    } else {
      reply.clearCookie(SWEEP_COOKIE, { path: '/' })
    }
    return { ok: true }
  })

  // The platform owner is an ordinary account carrying the operator role — there is no
  // shared token to hold, and every operator is therefore a named actor in the audit log.
  const superGuard = requireOperator(app)

  /** Every operator mutation leaves a row naming the actor and the sweep it touched.
   *  Written BEFORE the change, so a failed audit aborts the request rather than
   *  leaving an unrecorded one behind. */
  const audit = (req, action, sweepId) =>
    recordOperatorAction(app.db, { actorId: req.account.id, action, target: sweepId, sweepIds: [sweepId] })

  // No links: a live member token here IS the ability to open any group's sweep as one
  // of its members, un-audited. Operating on a sweep never means entering it.
  app.get('/api/super/sweeps', { preHandler: superGuard }, async () => {
    const rows = await app.db.select().from(sweep)
    return rows.map((r) => ({
      id: r.id, name: r.name, kind: r.kind, archivedAt: r.archivedAt, createdAt: r.createdAt,
      accountId: r.accountId, competitionId: r.competitionId,
    }))
  })

  // No create and no rotate here. Sweeps are provisioned by the account that will own
  // them (POST /api/account/sweeps) and re-linked by that owner
  // (POST /api/account/sweeps/:id/rotate). An operator minting a member token is the
  // ability to walk into any group's sweep as one of its members, which is the one
  // thing operating on a sweep must never mean — and super-create minted sweeps with
  // no accountId, which under account-derived admin is a sweep nobody can ever administer.

  app.post('/api/super/sweeps/:id/archive', { preHandler: superGuard }, async (req, reply) => {
    const { id } = req.params
    const [row] = await app.db.select().from(sweep).where(eq(sweep.id, id))
    if (!row || row.kind === 'default') return reply.code(404).send({ error: 'not_found' })
    await audit(req, 'archive_sweep', id)
    await app.db.update(sweep).set({ archivedAt: new Date() }).where(eq(sweep.id, id))
    return { id, archived: true }
  })

  app.patch('/api/super/sweeps/:id', { preHandler: superGuard, schema: { body: patchBody } }, async (req, reply) => {
    const { id } = req.params
    const [row] = await app.db.select().from(sweep).where(eq(sweep.id, id))
    if (!row) return reply.code(404).send({ error: 'not_found' })
    const set = {}
    if (req.body.name !== undefined) set.name = req.body.name
    if (req.body.scoringRule !== undefined) set.scoringRule = req.body.scoringRule
    if (req.body.coOwners !== undefined) set.coOwners = req.body.coOwners
    await audit(req, 'patch_sweep', id)
    await app.db.update(sweep).set(set).where(eq(sweep.id, id))
    const [updated] = await app.db.select().from(sweep).where(eq(sweep.id, id))
    return { id: updated.id, name: updated.name, scoringRule: updated.scoringRule, coOwners: updated.coOwners, kind: updated.kind, archivedAt: updated.archivedAt }
  })

  app.post('/api/super/sweeps/:id/unarchive', { preHandler: superGuard }, async (req, reply) => {
    const { id } = req.params
    const [row] = await app.db.select().from(sweep).where(eq(sweep.id, id))
    if (!row || row.kind === 'default') return reply.code(404).send({ error: 'not_found' })
    await audit(req, 'unarchive_sweep', id)
    await app.db.update(sweep).set({ archivedAt: null }).where(eq(sweep.id, id))
    return { id, archived: false }
  })

  app.post('/api/super/fixtures/:id/correct', { preHandler: superGuard, schema: { body: correctBody } }, async (req, reply) => {
    const out = await correctFixture(app.db, req.params.id, req.body, req.account.id, app.publish)
    if (!out) return reply.code(404).send({ error: 'unknown_fixture' })
    return out
  })

  const groupAdmin = requireSweep(['admin'])

  const emailProp = { type: 'string', minLength: 3, maxLength: 254, pattern: '^\\s*\\S+@\\S+\\.\\S+\\s*$' }
  const personBody = {
    type: 'object', required: ['name', 'short', 'initials', 'av'], additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 80 },
      short: { type: 'string', minLength: 1, maxLength: 40 },
      initials: { type: 'string', minLength: 1, maxLength: 4 },
      av: { type: 'string', minLength: 1, maxLength: 20 },
      email: emailProp, // optional: an invite. Without one the seat is display-only.
    },
  }
  const personPatchBody = {
    type: 'object', additionalProperties: false, minProperties: 1,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 80 },
      short: { type: 'string', minLength: 1, maxLength: 40 },
      initials: { type: 'string', minLength: 1, maxLength: 4 },
      adult: { type: 'boolean' }, // wagers age gate (18+); minors can't see coins
      email: { ...emailProp, nullable: true }, // setting one (re)sends the invite
      ejected: { type: 'boolean' },            // revoke acting rights, keep the history
    },
  }

  /** Tell someone the organiser has a seat waiting for them, and let the link do the
   *  work: it signs their address in and claims that seat, so they arrive already
   *  themselves instead of re-typing the address the organiser just typed for them.
   *
   *  It is a bearer credential for one seat, so it is single-use and expires. Minting a
   *  new one burns the old, which makes "resend" also mean "the last link is dead".
   *  Mail is a notification: a dead transport must not fail a row already written. */
  async function invite(req, personId, email) {
    const now = new Date()
    await app.db.update(loginToken).set({ usedAt: now })
      .where(_and(eq(loginToken.personId, personId), _isNull(loginToken.usedAt)))
    const token = newToken()
    await app.db.insert(loginToken).values({
      token, email, personId, expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
    })
    const m = inviteMail(req.sweep.name, `${app.publicOrigin}/i/${token}`)
    return app.sendMail(email, m.subject, m.text, m.html)
      .catch((err) => req.log.error({ err }, 'invite mail failed'))
  }
  const ownBody = {
    type: 'object', required: ['personId', 'teamCode'], additionalProperties: false,
    properties: { personId: { type: 'string' }, teamCode: { type: 'string' } },
  }
  const ownItemsBody = {
    type: 'object', required: ['items'], additionalProperties: false,
    properties: {
      items: {
        type: 'array', minItems: 1, maxItems: 500,
        items: {
          type: 'object', required: ['personId', 'teamCode'], additionalProperties: false,
          properties: { personId: { type: 'string' }, teamCode: { type: 'string' } },
        },
      },
    },
  }

  app.post('/api/admin/people', {
    preHandler: groupAdmin, schema: { body: personBody },
    config: { rateLimit: { max: 20, timeWindow: '15 minutes' } }, // it sends mail now
  }, async (req, reply) => {
    const id = `pn_${newToken(12)}`
    const { name, short, initials, av } = req.body
    // Matched with lower() when the seat is claimed, so it is stored normalized.
    const email = req.body.email ? req.body.email.trim().toLowerCase() : null
    await app.db.insert(person).values({ id, sweepId: req.sweep.id, name, short, initials, avColor: av, email })
    if (email) await invite(req, id, email)
    return reply.code(201).send({ id, name, short, initials, av, email })
  })

  app.delete('/api/admin/people/:id', { preHandler: groupAdmin }, async (req, reply) => {
    const where = and(eq(person.id, req.params.id), eq(person.sweepId, req.sweep.id))
    const [p] = await app.db.select().from(person).where(where)
    if (!p) return reply.code(404).send({ error: 'not_found' })
    // The rows all cascade now; the FILES do not, so unlink them first. Best-effort: a
    // missing file must not block the delete, and an orphaned jpeg is not a bug worth
    // a 500. Ownership is gone with the cascade — it used to be deleted by hand here,
    // and photo rows were not, which is what made this route 500.
    const shots = await app.db.select().from(photo).where(eq(photo.personId, p.id))
    for (const ph of shots) {
      const drop = ph.status === 'approved' ? app.photos.removeApproved : app.photos.removePending
      await drop(ph.filePath.split('/').pop()).catch(() => {})
      if (ph.thumbPath) await drop(ph.thumbPath.split('/').pop()).catch(() => {})
    }
    await app.db.delete(person).where(where)
    return { id: p.id, deleted: true }
  })

  app.patch('/api/admin/people/:id', {
    preHandler: groupAdmin, schema: { body: personPatchBody },
    config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
  }, async (req, reply) => {
    const where = and(eq(person.id, req.params.id), eq(person.sweepId, req.sweep.id))
    const [p] = await app.db.select().from(person).where(where)
    if (!p) return reply.code(404).send({ error: 'not_found' })
    const set = {}
    if (req.body.name !== undefined) set.name = req.body.name
    if (req.body.short !== undefined) set.short = req.body.short
    if (req.body.initials !== undefined) set.initials = req.body.initials
    if (req.body.adult !== undefined) set.adult = req.body.adult
    if (req.body.email !== undefined) set.email = req.body.email ? req.body.email.trim().toLowerCase() : null
    // Ejecting revokes the seat's acting rights and blocks a re-claim, but keeps the row:
    // their picks, ledger and bets stay referenced and the leaderboard keeps its shape.
    if (req.body.ejected !== undefined) set.ejectedAt = req.body.ejected ? new Date() : null
    await app.db.update(person).set(set).where(where)
    const [updated] = await app.db.select().from(person).where(where)
    // Re-sending is the same verb as inviting: one route, and the owner's mental model
    // ("give this seat an address") is the same either way.
    if (set.email) await invite(req, updated.id, set.email)
    return {
      id: updated.id, name: updated.name, short: updated.short, initials: updated.initials,
      adult: updated.adult, email: updated.email, ejected: !!updated.ejectedAt,
    }
  })

  app.post('/api/admin/ownership', { preHandler: groupAdmin, schema: { body: ownBody } }, async (req, reply) => {
    const sweepId = req.sweep.id
    const { personId, teamCode } = req.body
    const [p] = await app.db.select().from(person).where(and(eq(person.id, personId), eq(person.sweepId, sweepId)))
    if (!p) return reply.code(400).send({ error: 'unknown_person' })
    const competitorId = await codeToCompetitorId(app.db, req.sweep.competitionId, teamCode)
    if (!competitorId) return reply.code(400).send({ error: 'unknown_team' })
    try {
      await app.db.insert(ownership).values({ sweepId, personId, competitorId })
    } catch (e) {
      // pk(person_id, competitor_id) violation → this person already owns this team.
      // Co-ownership is allowed: a different person owning the same team is NOT a conflict.
      // drizzle 0.45 wraps driver errors in DrizzleQueryError, so the pg code sits one
      // level down; read both so this survives whichever shape reaches us.
      if ((e?.code ?? e?.cause?.code) === '23505') return reply.code(409).send({ error: 'already_owned' })
      throw e
    }
    return reply.code(201).send({ personId, teamCode })
  })

  app.delete('/api/admin/ownership', { preHandler: groupAdmin, schema: { body: ownBody } }, async (req, reply) => {
    const sweepId = req.sweep.id
    const { personId, teamCode } = req.body
    const competitorId = await codeToCompetitorId(app.db, req.sweep.competitionId, teamCode)
    if (!competitorId) return reply.code(400).send({ error: 'unknown_team' })
    await app.db.delete(ownership).where(and(eq(ownership.sweepId, sweepId), eq(ownership.personId, personId), eq(ownership.competitorId, competitorId)))
    return { personId, teamCode, removed: true }
  })

  // Resolve every distinct teamCode in `items` to a competitor id, scoped to the sweep's
  // competition. Null when any code is unknown so callers can 400 unknown_team.
  async function codeMapFor(competitionId, items) {
    const codes = [...new Set(items.map((it) => it.teamCode))]
    const rows = await app.db.select({ id: competitor.id, code: competitor.code }).from(competitor)
      .where(and(eq(competitor.competitionId, competitionId), inArray(competitor.code, codes)))
    const idByCode = new Map(rows.map((r) => [r.code, r.id]))
    return items.every((it) => idByCode.has(it.teamCode)) ? idByCode : null
  }

  // Bulk allocate: assign many (person, team) pairs in one call. Idempotent
  // (onConflictDoNothing) so re-assigning an owned team is a no-op; co-ownership
  // across different people is fine (different PK). Every personId must belong to
  // this sweep, else the whole call is rejected.
  app.post('/api/admin/ownership/bulk', { preHandler: groupAdmin, schema: { body: ownItemsBody } }, async (req, reply) => {
    const sweepId = req.sweep.id
    const { items } = req.body
    const own = await app.db.select({ id: person.id }).from(person).where(eq(person.sweepId, sweepId))
    const valid = new Set(own.map((p) => p.id))
    if (items.some((it) => !valid.has(it.personId))) return reply.code(400).send({ error: 'unknown_person' })
    const idByCode = await codeMapFor(req.sweep.competitionId, items)
    if (!idByCode) return reply.code(400).send({ error: 'unknown_team' })
    // de-dupe identical pairs within the request
    const seen = new Set()
    const dedupedItems = []
    const rows = []
    for (const it of items) {
      const key = `${it.personId} ${it.teamCode}`
      if (seen.has(key)) continue
      seen.add(key)
      dedupedItems.push({ personId: it.personId, teamCode: it.teamCode })
      rows.push({ sweepId, personId: it.personId, competitorId: idByCode.get(it.teamCode) })
    }
    const inserted = await app.db.insert(ownership).values(rows).onConflictDoNothing().returning({ personId: ownership.personId, competitorId: ownership.competitorId })
    if (inserted.length) await app.publish({ type: 'sync', sweepId })
    return reply.code(201).send({ inserted: inserted.length, items: dedupedItems })
  })

  // Bulk unallocate: remove many (person, team) pairs, scoped to this sweep.
  app.delete('/api/admin/ownership/bulk', { preHandler: groupAdmin, schema: { body: ownItemsBody } }, async (req, reply) => {
    const sweepId = req.sweep.id
    const { items } = req.body
    const idByCode = await codeMapFor(req.sweep.competitionId, items)
    if (!idByCode) return reply.code(400).send({ error: 'unknown_team' })
    const pairs = items.map((it) => and(eq(ownership.personId, it.personId), eq(ownership.competitorId, idByCode.get(it.teamCode))))
    await app.db.delete(ownership).where(and(eq(ownership.sweepId, sweepId), or(...pairs)))
    await app.publish({ type: 'sync', sweepId })
    return { removed: items.length, items: items.map(({ personId, teamCode }) => ({ personId, teamCode })) }
  })
}
