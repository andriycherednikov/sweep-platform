import { eq, and, isNull, gt } from 'drizzle-orm'
import { account, accountSession, loginToken, catalogLeague, competition, event, sweep } from '../db/schema.js'
import { newToken } from '../sweeps/tokens.js'
import { requireAccount, LOGIN_TOKEN_TTL_MS, SESSION_TTL_MS } from '../accounts/auth.js'
import { seasonInWindow } from '../providers/registry.js'
import { addCompetition } from '../worker/add-competition.js'
import { syncCompetitors } from '../worker/sync-competitors.js'
import { syncBaseline } from '../worker/baseline-sync.js'
import { links } from './sweeps.js'

const loginBody = {
  type: 'object', required: ['email'], additionalProperties: false,
  properties: { email: { type: 'string', minLength: 3, maxLength: 254, pattern: '^\\s*\\S+@\\S+\\.\\S+\\s*$' } },
}
const sessionBody = {
  type: 'object', required: ['token'], additionalProperties: false,
  properties: { token: { type: 'string', minLength: 8, maxLength: 64 } },
}
const provisionBody = {
  type: 'object', required: ['name', 'provider', 'leagueId', 'season'], additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 80 },
    provider: { type: 'string', minLength: 1, maxLength: 40 },
    leagueId: { type: 'string', minLength: 1, maxLength: 20 },
    season: { type: 'string', minLength: 4, maxLength: 12 },
  },
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
    // atomic claim: only an unused token row can be marked used — the concurrent loser gets 0 rows
    const [lt] = await app.db.update(loginToken)
      .set({ usedAt: now })
      .where(and(eq(loginToken.token, req.body.token), isNull(loginToken.usedAt), gt(loginToken.expiresAt, now)))
      .returning()
    if (!lt) return reply.code(401).send({ error: 'unauthorized' })
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

  const accountGuard = requireAccount(app)

  app.post('/api/account/sweeps', { preHandler: accountGuard, schema: { body: provisionBody } }, async (req, reply) => {
    const { name, provider: providerKey, leagueId, season } = req.body
    const [cl] = await app.db.select().from(catalogLeague).where(eq(catalogLeague.id, `${providerKey}:${leagueId}`))
    const seasonOk = cl?.curated && (cl.seasons ?? [])
      .some((s) => s.season === String(season) && s.standings && seasonInWindow(providerKey, s.season))
    if (!seasonOk) return reply.code(400).send({ error: 'unknown_competition' })

    // Cap checked after catalog validation: a request for an unknown/invalid competition
    // always 400s, even for an account already at its cap (never leaks cap state ahead of validity).
    const cap = Number(process.env.ACCOUNT_SWEEP_CAP ?? 3) // P4 swaps this constant for subscription quantity
    const mine = await app.db.select({ id: sweep.id }).from(sweep)
      .where(and(eq(sweep.accountId, req.account.id), isNull(sweep.archivedAt)))
    if (mine.length >= cap) return reply.code(403).send({ error: 'sweep_cap', cap })

    const compId = `${providerKey}:${leagueId}:${season}`
    const provider = app.providerFor({ provider: providerKey })
    let [comp] = await app.db.select().from(competition).where(eq(competition.id, compId))
    if (!comp) {
      await addCompetition(app.db, provider, {
        provider: providerKey, leagueId, season,
        league: { name: cl.name, type: cl.type, logo: cl.logo }, // from the persisted catalog — never a live catalog call
      })
      ;[comp] = await app.db.select().from(competition).where(eq(competition.id, compId))
    } else {
      const [ev] = await app.db.select({ id: event.id }).from(event).where(eq(event.competitionId, compId)).limit(1)
      if (!ev) { // an earlier provision died mid-baseline — finish the job before binding a sweep
        await syncCompetitors(app.db, provider, comp)
        await syncBaseline(app.db, provider, comp)
      }
    }

    const id = `sw_${newToken(12)}`
    const memberToken = newToken(), adminToken = newToken()
    await app.db.insert(sweep).values({ id, name, kind: 'token', memberToken, adminToken, competitionId: compId, accountId: req.account.id })
    const [row] = await app.db.select().from(sweep).where(eq(sweep.id, id))
    return reply.code(201).send({ id, name: row.name, competitionId: compId, memberToken, adminToken, ...links(app, row) })
  })

  app.get('/api/account/sweeps', { preHandler: accountGuard }, async (req) => {
    const rows = await app.db.select().from(sweep).where(eq(sweep.accountId, req.account.id))
    return rows.map((r) => ({ id: r.id, name: r.name, competitionId: r.competitionId, archivedAt: r.archivedAt, createdAt: r.createdAt, ...links(app, r) }))
  })

  app.post('/api/account/sweeps/:id/archive', { preHandler: accountGuard }, async (req, reply) => {
    const [row] = await app.db.select().from(sweep)
      .where(and(eq(sweep.id, req.params.id), eq(sweep.accountId, req.account.id)))
    if (!row) return reply.code(404).send({ error: 'not_found' })
    await app.db.update(sweep).set({ archivedAt: new Date() }).where(eq(sweep.id, row.id))
    return { id: row.id, archived: true }
  })
}
