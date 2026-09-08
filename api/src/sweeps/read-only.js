import { sweepLiveNow } from '../accounts/billing.js'

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const EXEMPT_EXACT = new Set(['/api/session', '/api/session/logout'])
// Only what must work while lapsed: signing in, paying, and reading. The prefix used to
// be a blanket '/api/account', which would have exempted the owner sweep-editing routes
// from the very gate that exists to stop them. This list is defence in depth — the real
// check lives inside those handlers (sweepLiveNow), because the gate returns at
// !req.sweep?.accountId below and an account-console call resolves no sweep.
const EXEMPT_PREFIX = ['/api/account/login', '/api/account/session', '/api/account/sessions',
  '/api/account/password', '/api/account/billing', '/api/account/sweeps', '/api/super', '/api/stripe']

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
