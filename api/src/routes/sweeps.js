import { eq, or } from 'drizzle-orm'
import { sweep } from '../db/schema.js'
import { newToken } from '../sweeps/tokens.js'
import { SWEEP_COOKIE, SUPER_COOKIE, COOKIE_MAX_AGE, signSweepCookie, requireSuper } from '../sweeps/auth.js'

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
    if (!app.superToken || req.body.token !== app.superToken) return reply.code(401).send({ error: 'unauthorized' })
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
}
