import { ADMIN_COOKIE, COOKIE_MAX_AGE, verifyPasscode, requireAdmin } from '../auth.js'

const loginBody = {
  type: 'object', required: ['passcode'], additionalProperties: false,
  properties: { passcode: { type: 'string', minLength: 1, maxLength: 200 } },
}

export async function adminRoutes(app) {
  const admin = requireAdmin(app)

  app.post('/api/admin/login', {
    schema: { body: loginBody },
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (req, reply) => {
    if (!verifyPasscode(req.body.passcode, app.adminHash)) return reply.code(401).send({ error: 'bad_passcode' })
    reply.setCookie(ADMIN_COOKIE, reply.signCookie('ok'), {
      httpOnly: true, sameSite: 'lax', path: '/', maxAge: COOKIE_MAX_AGE,
      secure: process.env.NODE_ENV === 'production',
    })
    return { admin: true }
  })

  app.post('/api/admin/logout', async (_req, reply) => {
    reply.clearCookie(ADMIN_COOKIE, { path: '/' })
    return { admin: false }
  })

  app.get('/api/admin/me', { preHandler: admin }, async () => ({ admin: true }))

  // photo queue + moderation added in Tasks 6 & 7 (same file, reuse `admin`).
}
