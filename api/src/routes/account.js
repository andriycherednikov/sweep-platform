import { eq, and, ne, isNull, isNotNull, gt, sql } from 'drizzle-orm'
import { account, accountSession, loginToken, catalogLeague, competition, event, sweep } from '../db/schema.js'
import { randomInt } from 'node:crypto'
import { newToken } from '../sweeps/tokens.js'
import { requireSweep } from '../sweeps/auth.js'
import { codeMail } from '../mail.js'
import { requireAccount, LOGIN_TOKEN_TTL_MS, SESSION_TTL_MS } from '../accounts/auth.js'
import { hashPassword, verifyPassword, DUMMY_HASH, MAX_PASSWORD_BYTES } from '../auth.js'
import { TRIAL_MS, GOOD_STANDING, syncQuantity, liveSweepCount, sweepLiveNow } from '../accounts/billing.js'
import { seasonInWindow } from '../providers/registry.js'
import { syncCompetitors } from '../worker/sync-competitors.js'
import { syncBaseline } from '../worker/baseline-sync.js'
import { sportOf } from '../providers/registry.js'
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
    wageringEnabled: { type: 'boolean' },
  },
}
const passwordSessionBody = {
  type: 'object', required: ['email', 'password'], additionalProperties: false,
  properties: {
    email: { type: 'string', minLength: 3, maxLength: 254 },
    password: { type: 'string', minLength: 10, maxLength: MAX_PASSWORD_BYTES },
  },
}
const setPasswordBody = {
  type: 'object', required: ['password'], additionalProperties: false,
  properties: {
    password: { type: 'string', minLength: 10, maxLength: MAX_PASSWORD_BYTES },
    current: { type: 'string', minLength: 1, maxLength: MAX_PASSWORD_BYTES },
  },
}
const codeSessionBody = {
  type: 'object', required: ['email', 'code'], additionalProperties: false,
  properties: { email: loginBody.properties.email, code: { type: 'string', pattern: '^[0-9]{6}$' } },
}
const LINK_GRACE_MS = 15 * 60_000
// Three coded rows per address per window. Anyone holding the group link can make our
// domain mail an address of their choosing, and a cold sending domain does not survive
// being used that way.
const MAX_CODES_PER_WINDOW = 3
const MAX_CODE_ATTEMPTS = 5
const patchSweepBody = {
  type: 'object', additionalProperties: false, minProperties: 1,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 80 },
    scoringRule: { type: 'string', minLength: 1, maxLength: 40 },
    coOwners: { type: 'string', minLength: 1, maxLength: 40 },
  },
}

export async function accountRoutes(app) {
  /** Mail is a notification here, never the transaction. Both callers have already
   *  committed their work by the time it goes out, so a dead transport must not turn a
   *  finished request into a 500: on the password route that reports failure for a
   *  change that is already live, and on the login route it is exactly the answer the
   *  unconditional {ok:true} exists to withhold. */
  const notify = (req, ...mail) =>
    app.sendMail(...mail).catch((err) => req.log.error({ err }, 'notification mail failed'))

  /** The account is born HERE, from a verified address, whichever way it was proved.
   *  onConflictDoNothing + re-select survives a concurrent first-login race.
   *  `via` records what proved it: only 'link' earns the set-a-password grace below. */
  async function mintSession(email, via) {
    await app.db.insert(account).values({ id: `ac_${newToken(12)}`, email }).onConflictDoNothing()
    const [acc] = await app.db.select().from(account).where(eq(account.email, email))
    const token = newToken()
    await app.db.insert(accountSession).values({
      token, accountId: acc.id, via, expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    })
    return { accountToken: token, account: { id: acc.id, email: acc.email, name: acc.name } }
  }

  app.post('/api/account/login', {
    schema: { body: loginBody },
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (req) => {
    const email = req.body.email.trim().toLowerCase()
    const token = newToken()
    await app.db.insert(loginToken).values({ token, email, expiresAt: new Date(Date.now() + LOGIN_TOKEN_TTL_MS) })
    await notify(req, email, 'Your sign-in link', `${app.publicOrigin}/account/login/${token}`)
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
    return reply.code(201).send(await mintSession(lt.email, 'link'))
  })

  /* --- joining a sweep by email -------------------------------------------------
     A member proves an address without leaving the page. Both routes sit behind the
     sweep session, so holding the group link is the only way to make us send anything;
     both paths are already under EXEMPT_PREFIX in sweeps/read-only.js, so a lapsed
     sweep can still be signed into (it just cannot be joined - see POST /api/me). */
  const inSweep = requireSweep(['member', 'admin'])

  app.post('/api/account/login/code', {
    preHandler: inSweep,
    schema: { body: loginBody },
    // 30, not the magic link's 5: a pub is one NAT, which is why POST /api/session is
    // deliberately 100/15min. The per-address cap below is what stops the mail abuse.
    config: { rateLimit: { max: 30, timeWindow: '15 minutes' } },
  }, async (req, reply) => {
    const email = req.body.email.trim().toLowerCase()
    const now = new Date()
    const since = new Date(now.getTime() - LOGIN_TOKEN_TTL_MS)
    const [{ n }] = await app.db.select({ n: sql`count(*)::int` }).from(loginToken)
      .where(and(eq(loginToken.email, email), isNotNull(loginToken.code), gt(loginToken.createdAt, since)))
    // ponytail: check-then-insert, so a race over-sends by one. This is an anti-spam
    // cap, not a security boundary - the attempt counter is the boundary.
    if (n >= MAX_CODES_PER_WINDOW) return reply.code(201).send({ ok: true })

    // Exactly one live code per address: it keeps a guess at 1e-6 and gives the attempt
    // counter a single row to land on. isNotNull(code) is what spares magic-link rows.
    await app.db.update(loginToken).set({ usedAt: now })
      .where(and(eq(loginToken.email, email), isNotNull(loginToken.code), isNull(loginToken.usedAt)))
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    await app.db.insert(loginToken).values({
      token: newToken(), email, code, expiresAt: new Date(now.getTime() + LOGIN_TOKEN_TTL_MS),
    })
    const m = codeMail(code, req.sweep.name)
    await notify(req, email, m.subject, m.text, m.html)
    // always — the journey branches on "already registered" AFTER the code, so nothing
    // here may reveal which addresses exist, in the body or in the timing.
    return reply.code(201).send({ ok: true })
  })

  app.post('/api/account/session/code', {
    preHandler: inSweep,
    schema: { body: codeSessionBody },
    config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
  }, async (req, reply) => {
    const email = req.body.email.trim().toLowerCase()
    const now = new Date()
    // atomic claim, same shape as the magic-link redeem above
    const [lt] = await app.db.update(loginToken).set({ usedAt: now }).where(and(
      eq(loginToken.email, email), eq(loginToken.code, req.body.code), isNotNull(loginToken.code),
      isNull(loginToken.usedAt), gt(loginToken.expiresAt, now),
      sql`${loginToken.attempts} < ${MAX_CODE_ATTEMPTS}`,
    )).returning()

    if (!lt) {
      // Count the miss and burn the row on the last one. Safe as a blind UPDATE because
      // there is at most one live coded row per address.
      await app.db.update(loginToken).set({
        attempts: sql`${loginToken.attempts} + 1`,
        usedAt: sql`case when ${loginToken.attempts} + 1 >= ${MAX_CODE_ATTEMPTS} then now() else ${loginToken.usedAt} end`,
      }).where(and(eq(loginToken.email, email), isNotNull(loginToken.code), isNull(loginToken.usedAt)))
      // one code for wrong, expired, spent and burnt: the next move is the same in all
      // four, and separate codes would leak where in the flow you are.
      return reply.code(401).send({ error: 'bad_code' })
    }
    return reply.code(201).send(await mintSession(lt.email, 'code'))
  })

  app.get('/api/account', { preHandler: requireAccount(app) }, async (req) => ({
    id: req.account.id, email: req.account.email, name: req.account.name,
    hasPassword: !!req.account.passwordHash,
  }))

  app.post('/api/account/password/session', {
    schema: { body: passwordSessionBody },
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (req, reply) => {
    const email = req.body.email.trim().toLowerCase()
    const [acc] = await app.db.select().from(account).where(eq(account.email, email))
    // Compare against a dummy whenever there is no usable hash — no account, OR an
    // account that has never set a password. Skipping the compare in either case
    // leaks, through response time, which addresses exist.
    const ok = await verifyPassword(req.body.password, acc?.passwordHash ?? DUMMY_HASH)
    if (!acc || !acc.passwordHash || !ok) return reply.code(401).send({ error: 'bad_credentials' })
    const token = newToken()
    await app.db.insert(accountSession).values({
      token, accountId: acc.id, via: 'password',
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    })
    return reply.code(201).send({
      accountToken: token, account: { id: acc.id, email: acc.email, name: acc.name },
    })
  })

  app.post('/api/account/password', {
    preHandler: requireAccount(app), schema: { body: setPasswordBody },
  }, async (req, reply) => {
    // maxLength on the schema counts UTF-16 units; hashPassword's cap is bytes — a
    // multi-byte password can clear the schema and still overflow the hash, which
    // would 500 instead of a clean rejection without this check.
    if (Buffer.byteLength(req.body.password, 'utf8') > MAX_PASSWORD_BYTES) {
      return reply.code(400).send({ error: 'password_too_long' })
    }
    const acc = req.account
    // Setting a password is exactly as sensitive whether it's the first one or a
    // replacement, so both need the same proof: a magic link minutes old, or the
    // current password. Without that, a stolen 90-day session token could plant a
    // password on an account that never had one and keep access past a sign-out-everywhere.
    const [sess] = await app.db.select().from(accountSession)
      .where(eq(accountSession.token, req.headers['x-account-token']))
    const fresh = sess?.via === 'link' && Date.now() - sess.createdAt.getTime() < LINK_GRACE_MS
    if (!fresh) {
      // No hash to prove knowledge of → there is no `current` this client could ever
      // supply. The honest answer is "go get a fresh link", not "current_required".
      if (!acc.passwordHash) return reply.code(403).send({ error: 'reauth_required' })
      if (!req.body.current) return reply.code(403).send({ error: 'current_required' })
      if (!(await verifyPassword(req.body.current, acc.passwordHash))) {
        return reply.code(401).send({ error: 'bad_credentials' })
      }
    }
    await app.db.update(account)
      .set({ passwordHash: await hashPassword(req.body.password) })
      .where(eq(account.id, acc.id))
    // Every other service already does this, and it is the only recourse when the one
    // explicit revoke (DELETE /api/account/sessions) has just failed — a stolen 90-day
    // token dies here too, not just via that route. After the update, never before: a
    // failed password change must not sign out every other device for nothing. The
    // caller keeps their own session — changing your password mid-session must not
    // immediately sign you out of the device you're using.
    await app.db.delete(accountSession).where(and(
      eq(accountSession.accountId, acc.id),
      ne(accountSession.token, req.headers['x-account-token']),
    ))
    await notify(req, acc.email, 'Your password was changed',
      'The password on your Sweep account was just changed. If that was not you, reply to this email.')
    return reply.code(204).send()
  })

  app.delete('/api/account/session', { preHandler: requireAccount(app) }, async (req, reply) => {
    await app.db.delete(accountSession).where(eq(accountSession.token, req.headers['x-account-token']))
    return reply.code(204).send()
  })

  app.delete('/api/account/sessions', { preHandler: requireAccount(app) }, async (req, reply) => {
    await app.db.delete(accountSession).where(eq(accountSession.accountId, req.account.id))
    return reply.code(204).send()
  })

  const accountGuard = requireAccount(app)

  /** Teams and fixtures are a slow round-trip to the provider, and nobody should sit
   *  and watch it: the sweep is real and shareable the moment its row lands, and the
   *  feed fills in behind it. ponytail: in-process fire-and-forget, no job queue —
   *  the periodic worker sync is the backstop if this process dies mid-fill. */
  function fillCompetition(providerKey, comp) {
    const provider = app.providerFor({ provider: providerKey })
    const p = (async () => {
      await syncCompetitors(app.db, provider, comp)
      const b = await syncBaseline(app.db, provider, comp)
      app.log.info({ competitionId: comp.id, fixtures: b?.fixtures }, 'competition filled')
    })()
      .catch((err) => app.log.error({ err, competitionId: comp.id }, 'competition fill failed'))
      .finally(() => app.fills.delete(p))
    app.fills.add(p)
  }

  app.post('/api/account/sweeps', { preHandler: accountGuard, schema: { body: provisionBody } }, async (req, reply) => {
    const { name, provider: providerKey, leagueId, season } = req.body
    const [cl] = await app.db.select().from(catalogLeague).where(eq(catalogLeague.id, `${providerKey}:${leagueId}`))
    const seasonOk = cl?.curated && (cl.seasons ?? [])
      .some((s) => s.season === String(season) && s.standings && seasonInWindow(providerKey, s.season))
    if (!seasonOk) return reply.code(400).send({ error: 'unknown_competition' })

    const compId = `${providerKey}:${leagueId}:${season}`
    let fill = null
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

        let [comp] = await tx.select().from(competition).where(eq(competition.id, compId))
        if (!comp) {
          // the row itself is cheap and comes from the persisted catalog — never a live call
          comp = {
            id: compId, provider: providerKey, sport: sportOf(providerKey),
            leagueId: String(leagueId), season: String(season),
            format: cl.type === 'League' ? 'league' : 'groups_then_ko', name: cl.name, logo: cl.logo,
          }
          await tx.insert(competition).values(comp)
          fill = comp
        } else {
          const [ev] = await tx.select({ id: event.id }).from(event).where(eq(event.competitionId, compId)).limit(1)
          if (!ev) fill = comp // eventless leftover (dead CLI/worker baseline) — finish the job behind the response
        }
        const id = `sw_${newToken(12)}`
        const memberToken = newToken()
        await tx.insert(sweep).values({
          id, name, kind: 'token', memberToken, competitionId: compId, accountId: acct.id,
          wageringEnabled: req.body.wageringEnabled ?? false,
        })
        if (subscribed) await syncQuantity(app.stripe, acct, mine.length + 1) // stripe failure → rollback: no sweep exists unbilled
        const [row] = await tx.select().from(sweep).where(eq(sweep.id, id))
        return { code: 201, body: { id, name: row.name, competitionId: compId, memberToken, ...links(app, row) } }
      })
      if (result.code === 201 && fill) fillCompetition(providerKey, fill)
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

  /** The owner's own sweep. 404 for a sweep they do not own — never 403, so the id
   *  cannot be probed to learn which sweeps exist. `requireLive` is the read-only gate,
   *  which only sweep CONTENT needs: the global one cannot cover these routes, because
   *  it keys on the cookie-resolved sweep (sweeps/read-only.js:11) and the account
   *  console sends no sweep cookie. */
  async function ownedSweep(req, reply, { requireLive = true } = {}) {
    const [row] = await app.db.select().from(sweep)
      .where(and(eq(sweep.id, req.params.id), eq(sweep.accountId, req.account.id)))
    if (!row) { reply.code(404).send({ error: 'not_found' }); return null }
    if (requireLive && !(await sweepLiveNow(app, row))) {
      reply.code(403).send({ error: 'sweep_readonly' }); return null
    }
    return row
  }

  app.patch('/api/account/sweeps/:id', {
    preHandler: accountGuard, schema: { body: patchSweepBody },
  }, async (req, reply) => {
    const row = await ownedSweep(req, reply)
    if (!row) return
    await app.db.update(sweep).set(req.body).where(eq(sweep.id, row.id))
    return { ok: true }
  })

  // Rotation is damage control, not a feature of a paid plan. A lapsed owner whose
  // member link has leaked must be able to revoke it — the alternative is a frozen sweep
  // that strangers keep reading, while archiving it (the destructive option) was already
  // theirs to take.
  app.post('/api/account/sweeps/:id/rotate', { preHandler: accountGuard }, async (req, reply) => {
    const row = await ownedSweep(req, reply, { requireLive: false })
    if (!row) return
    const memberToken = newToken()
    await app.db.update(sweep).set({ memberToken }).where(eq(sweep.id, row.id))
    const [next] = await app.db.select().from(sweep).where(eq(sweep.id, row.id))
    return links(app, next)
  })
}
