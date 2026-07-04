import { and, eq, gt, lt } from 'drizzle-orm'
import { account, accountSession, loginToken } from '../db/schema.js'

export const LOGIN_TOKEN_TTL_MS = 15 * 60_000
export const SESSION_TTL_MS = 90 * 24 * 3600_000

/** Daily hygiene (worker): expired magic-link tokens and sessions have no further use. */
export async function cleanupExpiredAuth(db) {
  const now = new Date()
  await db.delete(loginToken).where(lt(loginToken.expiresAt, now))
  await db.delete(accountSession).where(lt(accountSession.expiresAt, now))
}

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
