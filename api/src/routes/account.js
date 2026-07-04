import { eq } from 'drizzle-orm'
import { account, accountSession, loginToken } from '../db/schema.js'
import { newToken } from '../sweeps/tokens.js'
import { requireAccount, LOGIN_TOKEN_TTL_MS, SESSION_TTL_MS } from '../accounts/auth.js'

const loginBody = {
  type: 'object', required: ['email'], additionalProperties: false,
  properties: { email: { type: 'string', minLength: 3, maxLength: 254, pattern: '^\\s*\\S+@\\S+\\.\\S+\\s*$' } },
}
const sessionBody = {
  type: 'object', required: ['token'], additionalProperties: false,
  properties: { token: { type: 'string', minLength: 8, maxLength: 64 } },
}

export async function accountRoutes(app) {
  app.post('/api/account/login', {
    schema: { body: loginBody },
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (req) => {
    const email = req.body.email.trim().toLowerCase()
    const token = newToken()
    await app.db.insert(loginToken).values({ token, email, expiresAt: new Date(Date.now() + LOGIN_TOKEN_TTL_MS) })
    await app.sendMail(email, 'Your sign-in link', `https://${app.platformHost}/account/login/${token}`)
    return { ok: true } // always — never leak whether the email has an account
  })

  app.post('/api/account/session', {
    schema: { body: sessionBody },
    config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
  }, async (req, reply) => {
    const now = new Date()
    const [lt] = await app.db.select().from(loginToken).where(eq(loginToken.token, req.body.token))
    if (!lt || lt.usedAt || lt.expiresAt < now) return reply.code(401).send({ error: 'unauthorized' })
    await app.db.update(loginToken).set({ usedAt: now }).where(eq(loginToken.token, lt.token))
    // account is born HERE (verified email). onConflictDoNothing + re-select survives a concurrent first-login race.
    await app.db.insert(account).values({ id: `ac_${newToken(12)}`, email: lt.email }).onConflictDoNothing()
    const [acc] = await app.db.select().from(account).where(eq(account.email, lt.email))
    const token = newToken()
    await app.db.insert(accountSession).values({ token, accountId: acc.id, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) })
    return reply.code(201).send({ accountToken: token, account: { id: acc.id, email: acc.email, name: acc.name } })
  })

  app.get('/api/account', { preHandler: requireAccount(app) }, async (req) => (
    { id: req.account.id, email: req.account.email, name: req.account.name }
  ))
}
