import { eq, or } from 'drizzle-orm'
import { sweep } from '../db/schema.js'
import { SWEEP_COOKIE, COOKIE_MAX_AGE, signSweepCookie } from '../sweeps/auth.js'

const sessionBody = {
  type: 'object', required: ['token'], additionalProperties: false,
  properties: { token: { type: 'string', minLength: 8, maxLength: 64 } },
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
}
