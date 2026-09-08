export const SWEEP_COOKIE = 'sweep_session'
export const COOKIE_MAX_AGE = 8 * 3600 // seconds

/** How many sweeps one browser carries. ponytail: 8 — past that the tail is evicted,
 *  and the device's stored link token re-exchanges it silently on the next visit. */
const MAX_SWEEPS = 8

/** Cookie payload is "<id>[,<id>]*", most-recently-used first. It carries no role:
 *  admin is a fact about account ownership, recomputed per request (resolve.js). */
export function signSweepCookie(ids) {
  return ids.join(',')
}

/** Tolerates the legacy `id:role` form: a cookie minted before roles left the cookie
 *  still parses to its ids, so a deploy does not sign everybody out. Ids are base62
 *  and never contain ':', so the split is total. */
export function parseSweepCookie(value) {
  if (typeof value !== 'string') return null
  const out = value.split(',').map((p) => p.split(':')[0]).filter(Boolean)
  return out.length ? out : null
}

/** MRU upsert: `sweepId` goes to the front, any older entry for it is dropped. */
export function withSweep(list, sweepId) {
  return [sweepId, ...(list ?? []).filter((id) => id !== sweepId)].slice(0, MAX_SWEEPS)
}

/** The list this request arrived with, or null. Signature-checked: an unsigned or
 *  tampered cookie is no session at all, same as none. */
export function readSweepList(app, req) {
  const raw = req.cookies?.[SWEEP_COOKIE]
  if (!raw) return null
  const un = app.unsignCookie(raw)
  return un.valid ? parseSweepCookie(un.value) : null
}

/** preHandler: require req.sweep present and req.role in `roles`. Assumes sweepResolver ran first. */
export function requireSweep(roles) {
  const allowed = new Set(roles)
  return async (req, reply) => {
    if (!req.sweep) return reply.code(401).send({ error: 'unauthorized' })
    if (!allowed.has(req.role)) return reply.code(403).send({ error: 'forbidden' })
  }
}
