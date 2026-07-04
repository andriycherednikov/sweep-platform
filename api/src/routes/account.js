import { eq, and, isNull, gt } from 'drizzle-orm'
import { account, accountSession, loginToken, catalogLeague, competition, event, sweep } from '../db/schema.js'
import { newToken } from '../sweeps/tokens.js'
import { requireAccount, LOGIN_TOKEN_TTL_MS, SESSION_TTL_MS } from '../accounts/auth.js'
import { TRIAL_MS, GOOD_STANDING, syncQuantity, liveSweepCount } from '../accounts/billing.js'
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

    const compId = `${providerKey}:${leagueId}:${season}`
    try {
      const result = await app.db.transaction(async (tx) => {
        // Serialize per-account provisions: cap/quantity check-then-insert sits behind a row lock,
        // so the P3 TOCTOU (concurrent provisions landing cap+1) is structurally gone.
        // ponytail: feed sync runs inside the txn → seconds-long per-account lock; per-account queueing is fine at this scale.
        const [acct] = await tx.select().from(account).where(eq(account.id, req.account.id)).for('update')
        const now = new Date()
        let trialEndsAt = acct.trialEndsAt
        if (!acct.subscriptionStatus && !trialEndsAt) {
          trialEndsAt = new Date(now.getTime() + TRIAL_MS) // the account's one cardless trial starts at first provision
          await tx.update(account).set({ trialEndsAt }).where(eq(account.id, acct.id))
        }
        const subscribed = GOOD_STANDING.includes(acct.subscriptionStatus)
        if (!subscribed && (acct.subscriptionStatus || trialEndsAt <= now)) {
          return { code: 402, body: { error: 'subscription_required' } }
        }
        const mine = await tx.select({ id: sweep.id }).from(sweep)
          .where(and(eq(sweep.accountId, acct.id), isNull(sweep.archivedAt)))
        const cap = subscribed
          ? Number(process.env.ACCOUNT_SWEEP_MAX ?? 25)  // feed-abuse ceiling; billing is the real limiter
          : Number(process.env.ACCOUNT_SWEEP_CAP ?? 3)   // the P3 constant survives as the TRIAL cap
        if (mine.length >= cap) return { code: 403, body: { error: 'sweep_cap', cap } }

        const provider = app.providerFor({ provider: providerKey })
        let [comp] = await tx.select().from(competition).where(eq(competition.id, compId))
        if (!comp) {
          await addCompetition(tx, provider, {
            provider: providerKey, leagueId, season,
            league: { name: cl.name, type: cl.type, logo: cl.logo }, // from the persisted catalog — never a live catalog call
          })
        } else {
          const [ev] = await tx.select({ id: event.id }).from(event).where(eq(event.competitionId, compId)).limit(1)
          if (!ev) { // eventless leftover (dead CLI/worker baseline) — finish the job before binding
            await syncCompetitors(tx, provider, comp)
            await syncBaseline(tx, provider, comp)
          }
        }
        const id = `sw_${newToken(12)}`
        const memberToken = newToken(), adminToken = newToken()
        await tx.insert(sweep).values({ id, name, kind: 'token', memberToken, adminToken, competitionId: compId, accountId: acct.id })
        if (subscribed) await syncQuantity(app.stripe, acct, mine.length + 1) // stripe failure → rollback: no sweep exists unbilled
        const [row] = await tx.select().from(sweep).where(eq(sweep.id, id))
        return { code: 201, body: { id, name: row.name, competitionId: compId, memberToken, adminToken, ...links(app, row) } }
      })
      return reply.code(result.code).send(result.body)
    } catch (e) {
      req.log.error({ err: e, competitionId: compId }, 'provision failed')
      return reply.code(500).send({ error: 'provision_failed' }) // txn rolled back — nothing half-provisioned survives
    }
  })

  app.get('/api/account/sweeps', { preHandler: accountGuard }, async (req) => {
    const rows = await app.db.select().from(sweep).where(eq(sweep.accountId, req.account.id))
    return rows.map((r) => ({ id: r.id, name: r.name, competitionId: r.competitionId, archivedAt: r.archivedAt, createdAt: r.createdAt, ...links(app, r) }))
  })

  app.post('/api/account/sweeps/:id/archive', { preHandler: accountGuard }, async (req, reply) => {
    const result = await app.db.transaction(async (tx) => {
      const [acct] = await tx.select().from(account).where(eq(account.id, req.account.id)).for('update')
      const [row] = await tx.select().from(sweep)
        .where(and(eq(sweep.id, req.params.id), eq(sweep.accountId, acct.id)))
      if (!row) return { code: 404, body: { error: 'not_found' } }
      await tx.update(sweep).set({ archivedAt: new Date() }).where(eq(sweep.id, row.id))
      if (GOOD_STANDING.includes(acct.subscriptionStatus)) {
        await syncQuantity(app.stripe, acct, await liveSweepCount(tx, acct.id))
      }
      return { code: 200, body: { id: row.id, archived: true } }
    })
    return reply.code(result.code).send(result.body)
  })
}
