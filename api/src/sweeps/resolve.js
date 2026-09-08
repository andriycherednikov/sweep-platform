import { and, eq, gt } from 'drizzle-orm'
import { account, accountSession, sweep } from '../db/schema.js'
import { readSweepList } from './auth.js'
import { DEFAULT_SWEEP_ID } from './constants.js'

/** The account behind x-account-token, or null. No header means NO QUERY — a member
 *  request must cost exactly what it cost before this existed. */
async function accountFor(app, req) {
  const token = req.headers['x-account-token']
  if (!token) return null
  const [row] = await app.db.select({ account }).from(accountSession)
    .innerJoin(account, eq(accountSession.accountId, account.id))
    .where(and(eq(accountSession.token, token), gt(accountSession.expiresAt, new Date())))
  return row?.account ?? null
}

/** preHandler factory: sets req.sweep (row|null) and req.role ('member'|'admin'|null). */
export function sweepResolver(app) {
  return async (req) => {
    req.sweep = null
    req.role = null
    req.account = await accountFor(app, req)
    const onPlatform = req.headers.host === app.platformHost

    const list = readSweepList(app, req)
    // Which of the browser's sweeps this request is for. The header is how every fetch
    // says it (client.js); the query param is for EventSource, which cannot set headers.
    // Naming none is the old behaviour — the most recently used one.
    const want = req.headers['x-sweep-id'] || req.query?.sweep
    const session = list && (want ? list.find((e) => e.sweepId === want) : list[0])

    if (onPlatform) {
      // A named sweep this browser does not hold is unauthorized, never a silent
      // fallback to a different one — that would drop someone into another group's sweep.
      if (!session) return
      const [row] = await app.db.select().from(sweep).where(eq(sweep.id, session.sweepId))
      if (!row || row.archivedAt) return
      req.sweep = row
      // Admin is a fact about ownership, recomputed per request — never a stored role.
      // Signing out of the account therefore revokes admin immediately, not in 8 hours.
      req.role = req.account?.id && req.account.id === row.accountId ? 'admin' : session.role
      return
    }

    const [row] = await app.db.select().from(sweep).where(eq(sweep.id, DEFAULT_SWEEP_ID))
    if (!row) return
    req.sweep = row
    req.role = req.account?.id && req.account.id === row.accountId
      ? 'admin'
      : list?.find((e) => e.sweepId === DEFAULT_SWEEP_ID)?.role ?? 'member'
  }
}
