import { and, eq, gt } from 'drizzle-orm'
import { account, accountSession, sweep } from '../db/schema.js'
import { readSweepList } from './auth.js'

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

/** preHandler: sets req.account, req.sweep (row|null) and req.role. There is one
 *  resolution path now — the cookie names which sweeps this browser holds, the header
 *  says which one this request means, and ownership decides the role. Proving nothing
 *  is now membership of nothing: there is no default sweep to fall back into. */
export function sweepResolver(app) {
  return async (req) => {
    req.sweep = null
    req.role = null
    req.account = await accountFor(app, req)

    const list = readSweepList(app, req)
    // Which of the browser's sweeps this request is for. The header is how every fetch
    // says it (client.js); the query param is for EventSource, which cannot set headers.
    // Naming none means the most recently used one.
    const want = req.headers['x-sweep-id'] || req.query?.sweep
    // A named sweep this browser does not hold is unauthorized, never a silent fallback
    // to a different one — that would drop someone into another group's sweep.
    const session = list && (want ? list.find((e) => e.sweepId === want) : list[0])
    if (!session) return

    const [row] = await app.db.select().from(sweep).where(eq(sweep.id, session.sweepId))
    if (!row || row.archivedAt) return
    req.sweep = row
    // Admin is a fact about ownership, recomputed per request — never a stored role.
    // Signing out of the account therefore revokes admin immediately, not in 8 hours.
    // The cookie role still stands in for the admin link, which Task 11 removes.
    req.role = req.account?.id && req.account.id === row.accountId ? 'admin' : session.role
  }
}
