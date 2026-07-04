import { sweepLiveNow } from '../accounts/billing.js'

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const EXEMPT_EXACT = new Set(['/api/session', '/api/session/logout', '/api/admin/login', '/api/admin/logout'])
const EXEMPT_PREFIX = ['/api/account', '/api/super', '/api/stripe']

/** Lapsed sweeps are read-only (data retained): refuse sweep-scoped writes; reads,
 *  the SSE stream, and sign-in stay — members can look, nobody can change. */
export function readOnlyGate(app) {
  return async (req, reply) => {
    if (!MUTATING.has(req.method) || !req.sweep?.accountId) return
    const path = req.url.split('?')[0]
    if (EXEMPT_EXACT.has(path) || EXEMPT_PREFIX.some((p) => path.startsWith(p))) return
    if (!(await sweepLiveNow(app, req.sweep))) {
      return reply.code(403).send({ error: 'sweep_readonly' })
    }
  }
}
