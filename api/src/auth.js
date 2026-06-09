import bcrypt from 'bcryptjs'

export const ADMIN_COOKIE = 'sweep_admin'
export const COOKIE_MAX_AGE = 8 * 3600 // 8h, seconds

export function verifyPasscode(passcode, hash) {
  if (!hash || !passcode) return false
  try { return bcrypt.compareSync(passcode, hash) } catch { return false }
}

/** Fastify preHandler: 401 unless a valid signed admin cookie is present. */
export function requireAdmin(app) {
  return async (req, reply) => {
    const raw = req.cookies?.[ADMIN_COOKIE]
    if (!raw) return reply.code(401).send({ error: 'unauthorized' })
    const un = app.unsignCookie(raw)
    if (!un.valid || un.value !== 'ok') return reply.code(401).send({ error: 'unauthorized' })
  }
}
