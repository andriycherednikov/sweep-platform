import { timingSafeEqual } from 'node:crypto'
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
    const a = Buffer.from(String(req.body.token)), b = Buffer.from(String(app.superToken))
    if (!app.superToken || a.length !== b.length || !timingSafeEqual(a, b)) {
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
  const ownBody = {
    type: 'object', required: ['personId', 'teamCode'], additionalProperties: false,
    properties: { personId: { type: 'string' }, teamCode: { type: 'string' } },
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
}
