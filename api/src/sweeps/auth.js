import { requireOperator } from '../accounts/auth.js'

export const SWEEP_COOKIE = 'sweep_session'
export const SUPER_COOKIE = 'sweep_super'
export const COOKIE_MAX_AGE = 8 * 3600 // seconds
const ROLES = new Set(['member', 'admin'])

/** How many sweeps one browser carries. ponytail: 8 — past that the tail is evicted,
 *  and the device's stored link token re-exchanges it silently on the next visit. */
const MAX_SWEEPS = 8

/** Cookie payload is "<id>:<role>[,<id>:<role>]*", most-recently-used first; ids never
 *  contain ':' or ','. One entry is the shape every cookie had before multi-sweep, so
 *  sessions minted by the old code keep working — they parse as a one-element list. */
export function signSweepCookie(list) {
  return list.map((e) => `${e.sweepId}:${e.role}`).join(',')
}

export function parseSweepCookie(value) {
  if (typeof value !== 'string') return null
  const out = []
  for (const part of value.split(',')) {
    const i = part.indexOf(':')
    if (i < 1) continue
    const role = part.slice(i + 1)
    // One bad entry must not cost you the sweeps either side of it — drop it and read on.
    if (ROLES.has(role)) out.push({ sweepId: part.slice(0, i), role })
  }
  return out.length ? out : null
}

/** MRU upsert: `sweepId` goes to the front with `role`, any older entry for it is
 *  dropped (re-opening an admin link must upgrade the role you already hold). */
export function withSweep(list, sweepId, role) {
  const rest = (list ?? []).filter((e) => e.sweepId !== sweepId)
  return [{ sweepId, role }, ...rest].slice(0, MAX_SWEEPS)
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

/** preHandler: transitional — the legacy super cookie OR an operator account session.
 *  The cookie half is deleted in Task 10, at which point this becomes requireOperator
 *  outright. Same additive move Task 3 made for sweepResolver. */
export function requireSuper(app) {
  const operator = requireOperator(app)
  return async (req, reply) => {
    const raw = req.cookies?.[SUPER_COOKIE]
    if (raw) {
      const un = app.unsignCookie(raw)
      if (un.valid && un.value === 'ok') return
    }
    return operator(req, reply)
  }
}
