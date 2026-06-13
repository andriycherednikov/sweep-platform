export const SWEEP_COOKIE = 'sweep_session'
export const SUPER_COOKIE = 'sweep_super'
export const COOKIE_MAX_AGE = 8 * 3600 // seconds
const ROLES = new Set(['member', 'admin'])

/** Cookie payload is "<sweepId>:<role>"; sweepId never contains ':'. */
export function signSweepCookie(sweepId, role) {
  return `${sweepId}:${role}`
}

export function parseSweepCookie(value) {
  if (typeof value !== 'string') return null
  const i = value.indexOf(':')
  if (i < 1) return null
  const sweepId = value.slice(0, i)
  const role = value.slice(i + 1)
  if (!ROLES.has(role)) return null
  return { sweepId, role }
}

/** preHandler: require req.sweep present and req.role in `roles`. Assumes sweepResolver ran first. */
export function requireSweep(roles) {
  const allowed = new Set(roles)
  return async (req, reply) => {
    if (!req.sweep) return reply.code(401).send({ error: 'unauthorized' })
    if (!allowed.has(req.role)) return reply.code(403).send({ error: 'forbidden' })
  }
}

/** preHandler: require a valid super cookie. */
export function requireSuper(app) {
  return async (req, reply) => {
    const raw = req.cookies?.[SUPER_COOKIE]
    if (!raw) return reply.code(401).send({ error: 'unauthorized' })
    const un = app.unsignCookie(raw)
    if (!un.valid || un.value !== 'ok') return reply.code(401).send({ error: 'unauthorized' })
  }
}
