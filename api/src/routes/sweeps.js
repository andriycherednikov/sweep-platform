import { createHash, timingSafeEqual } from 'node:crypto'
import { eq, or, and } from 'drizzle-orm'
import { sweep, person, ownership } from '../db/schema.js'
import { newToken } from '../sweeps/tokens.js'
import { SWEEP_COOKIE, SUPER_COOKIE, COOKIE_MAX_AGE, signSweepCookie, requireSuper, requireSweep } from '../sweeps/auth.js'

const sessionBody = {
  type: 'object', required: ['token'], additionalProperties: false,
  properties: { token: { type: 'string', minLength: 8, maxLength: 64 } },
}

const createBody = {
  type: 'object', required: ['name'], additionalProperties: false,
  properties: { name: { type: 'string', minLength: 1, maxLength: 80 } },
}
const rotateBody = {
  type: 'object', required: ['which'], additionalProperties: false,
  properties: { which: { type: 'string', enum: ['member', 'admin'] } },
}
const patchBody = {
  type: 'object', additionalProperties: false, minProperties: 1,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 80 },
    scoringRule: { type: 'string', minLength: 1, maxLength: 40 },
    coOwners: { type: 'string', minLength: 1, maxLength: 40 },
  },
}

function links(app, row) {
  const base = `https://${app.platformHost}/g/${row.memberToken}`
  return { memberLink: base, adminLink: `${base}/admin/${row.adminToken}` }
}

export async function sweepsRoutes(app) {
  app.post('/api/session', {
    schema: { body: sessionBody },
    config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
  }, async (req, reply) => {
    const { token } = req.body
    const [row] = await app.db.select().from(sweep)
      .where(or(eq(sweep.memberToken, token), eq(sweep.adminToken, token)))
    if (!row || row.archivedAt) return reply.code(404).send({ error: 'not_found' })
    const role = row.adminToken === token ? 'admin' : 'member'
    reply.setCookie(SWEEP_COOKIE, reply.signCookie(signSweepCookie(row.id, role)), {
      httpOnly: true, sameSite: 'lax', path: '/', maxAge: COOKIE_MAX_AGE,
      secure: process.env.NODE_ENV === 'production',
    })
    return { sweepId: row.id, role }
  })

  app.post('/api/session/logout', async (_req, reply) => {
    reply.clearCookie(SWEEP_COOKIE, { path: '/' })
    return { ok: true }
  })

  const superGuard = requireSuper(app)

  app.post('/api/super/session', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    schema: { body: { type: 'object', required: ['token'], additionalProperties: false, properties: { token: { type: 'string', minLength: 1, maxLength: 200 } } } },
  }, async (req, reply) => {
    // Constant-time compare on fixed-size SHA-256 digests (no length leak).
    const digest = (s) => createHash('sha256').update(String(s)).digest()
    if (!app.superToken || !timingSafeEqual(digest(req.body.token), digest(app.superToken))) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    reply.setCookie(SUPER_COOKIE, reply.signCookie('ok'), {
      httpOnly: true, sameSite: 'lax', path: '/', maxAge: COOKIE_MAX_AGE,
      secure: process.env.NODE_ENV === 'production',
    })
    return { super: true }
  })

  app.get('/api/super/sweeps', { preHandler: superGuard }, async () => {
    const rows = await app.db.select().from(sweep)
    return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, archivedAt: r.archivedAt, createdAt: r.createdAt, ...links(app, r) }))
  })

  app.post('/api/super/sweeps', { preHandler: superGuard, schema: { body: createBody } }, async (req, reply) => {
    const id = `sw_${newToken(12)}`
    const memberToken = newToken(), adminToken = newToken()
    await app.db.insert(sweep).values({ id, name: req.body.name, kind: 'token', memberToken, adminToken })
    const [row] = await app.db.select().from(sweep).where(eq(sweep.id, id))
    return reply.code(201).send({ id, name: row.name, memberToken, adminToken, ...links(app, row) })
  })

  app.post('/api/super/sweeps/:id/rotate', { preHandler: superGuard, schema: { body: rotateBody } }, async (req, reply) => {
    const { id } = req.params
    const [row] = await app.db.select().from(sweep).where(eq(sweep.id, id))
    if (!row || row.kind === 'default') return reply.code(404).send({ error: 'not_found' })
    const next = newToken()
    const set = req.body.which === 'member' ? { memberToken: next } : { adminToken: next }
    await app.db.update(sweep).set(set).where(eq(sweep.id, id))
    return { id, ...(req.body.which === 'member' ? { memberToken: next } : { adminToken: next }) }
  })

  app.post('/api/super/sweeps/:id/archive', { preHandler: superGuard }, async (req, reply) => {
    const { id } = req.params
    const [row] = await app.db.select().from(sweep).where(eq(sweep.id, id))
    if (!row || row.kind === 'default') return reply.code(404).send({ error: 'not_found' })
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
    await app.db.update(sweep).set(set).where(eq(sweep.id, id))
    const [updated] = await app.db.select().from(sweep).where(eq(sweep.id, id))
    return { id: updated.id, name: updated.name, scoringRule: updated.scoringRule, coOwners: updated.coOwners, kind: updated.kind, archivedAt: updated.archivedAt }
  })

  app.post('/api/super/sweeps/:id/unarchive', { preHandler: superGuard }, async (req, reply) => {
    const { id } = req.params
    const [row] = await app.db.select().from(sweep).where(eq(sweep.id, id))
    if (!row || row.kind === 'default') return reply.code(404).send({ error: 'not_found' })
    await app.db.update(sweep).set({ archivedAt: null }).where(eq(sweep.id, id))
    return { id, archived: false }
  })

  const groupAdmin = requireSweep(['admin'])

  const personBody = {
    type: 'object', required: ['name', 'short', 'initials', 'av'], additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 80 },
      short: { type: 'string', minLength: 1, maxLength: 40 },
      initials: { type: 'string', minLength: 1, maxLength: 4 },
      av: { type: 'string', minLength: 1, maxLength: 20 },
    },
  }
  const personPatchBody = {
    type: 'object', additionalProperties: false, minProperties: 1,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 80 },
      short: { type: 'string', minLength: 1, maxLength: 40 },
      initials: { type: 'string', minLength: 1, maxLength: 4 },
    },
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

  app.post('/api/admin/people', { preHandler: groupAdmin, schema: { body: personBody } }, async (req, reply) => {
    const id = `pn_${newToken(12)}`
    const { name, short, initials, av } = req.body
    await app.db.insert(person).values({ id, sweepId: req.sweep.id, name, short, initials, avColor: av })
    return reply.code(201).send({ id, name, short, initials, av })
  })

  app.delete('/api/admin/people/:id', { preHandler: groupAdmin }, async (req, reply) => {
    const where = and(eq(person.id, req.params.id), eq(person.sweepId, req.sweep.id))
    const [p] = await app.db.select().from(person).where(where)
    if (!p) return reply.code(404).send({ error: 'not_found' })
    await app.db.delete(ownership).where(and(eq(ownership.personId, p.id), eq(ownership.sweepId, req.sweep.id)))
    await app.db.delete(person).where(where)
    return { id: p.id, deleted: true }
  })

  app.patch('/api/admin/people/:id', { preHandler: groupAdmin, schema: { body: personPatchBody } }, async (req, reply) => {
    const where = and(eq(person.id, req.params.id), eq(person.sweepId, req.sweep.id))
    const [p] = await app.db.select().from(person).where(where)
    if (!p) return reply.code(404).send({ error: 'not_found' })
    const set = {}
    if (req.body.name !== undefined) set.name = req.body.name
    if (req.body.short !== undefined) set.short = req.body.short
    if (req.body.initials !== undefined) set.initials = req.body.initials
    await app.db.update(person).set(set).where(where)
    const [updated] = await app.db.select().from(person).where(where)
    return { id: updated.id, name: updated.name, short: updated.short, initials: updated.initials }
  })

  app.post('/api/admin/ownership', { preHandler: groupAdmin, schema: { body: ownBody } }, async (req, reply) => {
    const sweepId = req.sweep.id
    const { personId, teamCode } = req.body
    const [p] = await app.db.select().from(person).where(and(eq(person.id, personId), eq(person.sweepId, sweepId)))
    if (!p) return reply.code(400).send({ error: 'unknown_person' })
    try {
      await app.db.insert(ownership).values({ sweepId, personId, teamCode })
    } catch (e) {
      // pk(person_id, team_code) violation → this person already owns this team.
      // Co-ownership is allowed: a different person owning the same team is NOT a conflict.
      if (e?.code === '23505') return reply.code(409).send({ error: 'already_owned' })
      throw e
    }
    return reply.code(201).send({ personId, teamCode })
  })

  app.delete('/api/admin/ownership', { preHandler: groupAdmin, schema: { body: ownBody } }, async (req) => {
    const sweepId = req.sweep.id
    const { personId, teamCode } = req.body
    await app.db.delete(ownership).where(and(eq(ownership.sweepId, sweepId), eq(ownership.personId, personId), eq(ownership.teamCode, teamCode)))
    return { personId, teamCode, removed: true }
  })

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
    // de-dupe identical pairs within the request
    const seen = new Set()
    const rows = []
    for (const it of items) {
      const key = `${it.personId} ${it.teamCode}`
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({ sweepId, personId: it.personId, teamCode: it.teamCode })
    }
    const inserted = await app.db.insert(ownership).values(rows).onConflictDoNothing().returning({ personId: ownership.personId, teamCode: ownership.teamCode })
    return reply.code(201).send({ inserted: inserted.length, items: rows.map(({ personId, teamCode }) => ({ personId, teamCode })) })
  })

  // Bulk unallocate: remove many (person, team) pairs, scoped to this sweep.
  app.delete('/api/admin/ownership/bulk', { preHandler: groupAdmin, schema: { body: ownItemsBody } }, async (req) => {
    const sweepId = req.sweep.id
    const { items } = req.body
    const pairs = items.map((it) => and(eq(ownership.personId, it.personId), eq(ownership.teamCode, it.teamCode)))
    await app.db.delete(ownership).where(and(eq(ownership.sweepId, sweepId), or(...pairs)))
    return { removed: items.length, items: items.map(({ personId, teamCode }) => ({ personId, teamCode })) }
  })
}
