import { and, eq, gt } from 'drizzle-orm'
import { account, accountSession } from '../db/schema.js'

export const LOGIN_TOKEN_TTL_MS = 15 * 60_000
export const SESSION_TTL_MS = 90 * 24 * 3600_000

/** preHandler: resolve the x-account-token header → req.account, else 401.
 *  P4 slot-in: subscription gating adds one check here. */
export function requireAccount(app) {
  return async (req, reply) => {
    const token = req.headers['x-account-token']
    if (!token) return reply.code(401).send({ error: 'unauthorized' })
    const [row] = await app.db.select({ account }).from(accountSession)
      .innerJoin(account, eq(accountSession.accountId, account.id))
      .where(and(eq(accountSession.token, token), gt(accountSession.expiresAt, new Date())))
    if (!row) return reply.code(401).send({ error: 'unauthorized' })
    req.account = row.account
  }
}
