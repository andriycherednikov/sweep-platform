import { eq, and, ne, isNull, isNotNull, gt, inArray, sql } from 'drizzle-orm'
import {
  account, accountSession, loginToken, catalogLeague, competition, competitor,
  event, ownership, person, support, sweep,
} from '../db/schema.js'
import { SWEEP_COOKIE, COOKIE_MAX_AGE, signSweepCookie, readSweepList, withSweep } from '../sweeps/auth.js'
import { randomInt } from 'node:crypto'
import { newToken } from '../sweeps/tokens.js'
import { requireSweep } from '../sweeps/auth.js'
import { codeMail, loginMail, emailChangeMail } from '../mail.js'
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
    // The same one-column update POST /api/admin/wagering makes (routes/admin.js:23) —
    // it just needs a sweep cookie to get there, which the account console never has.
    // Wagering stopped being a provision-time decision the moment the console owned the
    // sweep's settings, so it changes through the same PATCH as the name.
    wageringEnabled: { type: 'boolean' },
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
    const m = loginMail(`${app.publicOrigin}/account/login/${token}`)
    await notify(req, email, m.subject, m.text, m.html)
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
      // isNull(accountId): an address-CHANGE token proves an address its account does not
      // hold yet. Spending it here would mint a session for that address instead.
      .where(and(eq(loginToken.token, req.body.token), isNull(loginToken.usedAt),
                 isNull(loginToken.accountId), gt(loginToken.expiresAt, now)))
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
    const session = await mintSession(lt.email, 'code')
    // Signing back in is not joining. If this account already holds a seat here, say so,
    // or the client cannot tell a returning member from a newcomer and asks both to type
    // a name the roster already knows. An ejected seat is not one to come back to.
    const [seat] = await app.db.select().from(person).where(and(
      eq(person.sweepId, req.sweep.id), eq(person.accountId, session.account.id), isNull(person.ejectedAt),
    ))
    return reply.code(201).send({
      ...session,
      person: seat ? { id: seat.id, name: seat.name, short: seat.short } : null,
    })
  })

  /** Redeem a per-seat invite: sign the address in AND take the seat it names, in one
   *  step. The organiser already typed this address, so asking the invitee to type it
   *  back was a step that proved nothing. No sweep session is required to get here —
   *  the token IS the introduction, and this route hands one back. */
  app.post('/api/account/session/invite', {
    schema: { body: sessionBody },
    config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
  }, async (req, reply) => {
    const now = new Date()
    // atomic claim, same shape as every other redeem in this file
    const [lt] = await app.db.update(loginToken).set({ usedAt: now }).where(and(
      eq(loginToken.token, req.body.token), isNotNull(loginToken.personId),
      isNull(loginToken.usedAt), gt(loginToken.expiresAt, now),
    )).returning()
    if (!lt) return reply.code(401).send({ error: 'unauthorized' })

    const [seat] = await app.db.select().from(person).where(eq(person.id, lt.personId))
    if (!seat) return reply.code(401).send({ error: 'unauthorized' })

    const session = await mintSession(lt.email, 'invite')
    // One account holds one seat per sweep. If they are already in — invited twice, or
    // they self-joined in the meantime — sign them into the seat they have rather than
    // failing on the unique index over a link that was only ever a convenience.
    const [held] = await app.db.select().from(person).where(and(
      eq(person.sweepId, seat.sweepId), eq(person.accountId, session.account.id),
    ))
    let mine = held
    if (!held) {
      if (seat.accountId || seat.ejectedAt) return reply.code(401).send({ error: 'unauthorized' })
      const [claimed] = await app.db.update(person)
        .set({ accountId: session.account.id, claimedAt: now })
        .where(and(eq(person.id, seat.id), isNull(person.accountId), isNull(person.ejectedAt)))
        .returning()
      if (!claimed) return reply.code(401).send({ error: 'unauthorized' })
      mine = claimed
    }
    if (mine.ejectedAt) return reply.code(403).send({ error: 'removed_from_sweep' })

    // Hand back the sweep session too: the invite is the whole journey, so it must not
    // land them on a sweep their browser has no cookie for.
    reply.setCookie(SWEEP_COOKIE, reply.signCookie(signSweepCookie(withSweep(readSweepList(app, req), seat.sweepId))), {
      httpOnly: true, sameSite: 'lax', path: '/', maxAge: COOKIE_MAX_AGE,
      secure: process.env.NODE_ENV === 'production',
    })
    await app.publish({ type: 'sync', sweepId: seat.sweepId })
    return reply.code(201).send({ ...session, sweepId: seat.sweepId, person: { id: mine.id, name: mine.name, short: mine.short } })
  })

  app.get('/api/account', { preHandler: requireAccount(app) }, async (req) => ({
    id: req.account.id, email: req.account.email, name: req.account.name,
    hasPassword: !!req.account.passwordHash,
  }))

  const nameBody = {
    type: 'object', required: ['name'], additionalProperties: false,
    properties: { name: { type: 'string', minLength: 1, maxLength: 80 } },
  }

  /** The name the product greets you by. Not a credential, so it just changes. */
  app.patch('/api/account', {
    preHandler: requireAccount(app), schema: { body: nameBody },
  }, async (req) => {
    const name = req.body.name.trim()
    await app.db.update(account).set({ name }).where(eq(account.id, req.account.id))
    return { id: req.account.id, email: req.account.email, name, hasPassword: !!req.account.passwordHash }
  })

  /** Changing the address you sign in with.
   *
   *  The address IS the credential, so it is not overwritten on request — the NEW one is
   *  proven first, exactly the way signing in proves one. The link goes to the new
   *  address, so somebody who cannot read that inbox cannot move the account into it.
   *  202, not 200: nothing has changed yet.
   */
  app.post('/api/account/email', {
    preHandler: requireAccount(app), schema: { body: loginBody },
    // Keyed on the session, not the IP: this route is authenticated, so an IP budget
    // would have one person in an office spend everybody else's — the same complaint
    // POST /api/session already carries. The header is readable at onRequest, where the
    // limiter runs; req.account is not resolved until the preHandler below.
    config: {
      rateLimit: {
        max: 5, timeWindow: '15 minutes',
        keyGenerator: (req) => req.headers['x-account-token'] || req.ip,
      },
    },
  }, async (req, reply) => {
    const email = req.body.email.trim().toLowerCase()
    if (email === req.account.email) return reply.code(200).send({ ok: true, unchanged: true })
    // Two accounts on one address makes signing in ambiguous — and claiming somebody
    // else's address is how you take their sweeps. Checked again at confirm time,
    // because it can be taken in between.
    const [taken] = await app.db.select().from(account).where(eq(account.email, email))
    if (taken) return reply.code(409).send({ error: 'email_taken' })

    const token = newToken()
    await app.db.insert(loginToken).values({
      token, email, accountId: req.account.id, expiresAt: new Date(Date.now() + LOGIN_TOKEN_TTL_MS),
    })
    const m = emailChangeMail(`${app.publicOrigin}/account/email/${token}`, req.account.email)
    await notify(req, email, m.subject, m.text, m.html)
    return reply.code(202).send({ ok: true })
  })

  app.post('/api/account/email/confirm', {
    preHandler: requireAccount(app), schema: { body: sessionBody },
  }, async (req, reply) => {
    const now = new Date()
    // Atomic claim, scoped to THIS account: a change token is only ever spendable by the
    // account it was minted for, and only once.
    const [lt] = await app.db.update(loginToken)
      .set({ usedAt: now })
      .where(and(eq(loginToken.token, req.body.token), isNull(loginToken.usedAt),
                 eq(loginToken.accountId, req.account.id), gt(loginToken.expiresAt, now)))
      .returning()
    if (!lt) return reply.code(401).send({ error: 'unauthorized' })

    const [taken] = await app.db.select().from(account).where(eq(account.email, lt.email))
    if (taken && taken.id !== req.account.id) return reply.code(409).send({ error: 'email_taken' })

    await app.db.update(account).set({ email: lt.email }).where(eq(account.id, req.account.id))
    return { id: req.account.id, email: lt.email, name: req.account.name }
  })

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

  /** "NBA" is every NBA season there has been; the sweep is bound to one. Some feed
   *  names already carry it ("World Cup 2026") — don't say it twice. Mirrors
   *  withCompetitionLabel() on the web side. */
  const compLabel = (c) =>
    !c.season || String(c.name).includes(String(c.season)) ? c.name : `${c.name} ${c.season}`

  app.get('/api/account/sweeps', { preHandler: accountGuard }, async (req) => {
    // Two ways to be in a sweep, and most people only ever have the second: you run it,
    // or you have a seat in it. The console could see only the first, so a member's list
    // was empty however many groups they played in.
    // The competition rides along on both halves: a sweep's name is whatever the owner
    // typed, so what it follows is the only thing that makes a list of them readable.
    const owned = await app.db.select({ sweep, competition }).from(sweep)
      .leftJoin(competition, eq(competition.id, sweep.competitionId))
      .where(eq(sweep.accountId, req.account.id))
    const ownedIds = new Set(owned.map((r) => r.sweep.id))
    const joined = await app.db.select({ sweep, competition }).from(person)
      .innerJoin(sweep, eq(sweep.id, person.sweepId))
      .leftJoin(competition, eq(competition.id, sweep.competitionId))
      .where(and(
        eq(person.accountId, req.account.id),
        isNull(person.ejectedAt),
        isNull(sweep.archivedAt),
      ))

    // "how many have actually joined" is the question the console could not answer.
    // count(col) skips NULLs, so `registered` is free once we are grouping anyway.
    // Ejected seats are excluded, exactly as the `joined` half above excludes them: the
    // row stays in the table so their picks and ledger keep their references, but they
    // are not in the sweep, and counting them printed a headcount the People screen
    // flatly contradicted.
    const counts = new Map()
    if (owned.length) {
      const tallies = await app.db.select({
        sweepId: person.sweepId,
        total: sql`count(*)::int`,
        registered: sql`count(${person.accountId})::int`,
      }).from(person)
        .where(and(
          inArray(person.sweepId, owned.map((r) => r.sweep.id)),
          isNull(person.ejectedAt),
        ))
        .groupBy(person.sweepId)
      for (const t of tallies) counts.set(t.sweepId, { total: t.total, registered: t.registered })
    }

    const base = ({ sweep: r, competition: c }) => ({
      id: r.id, name: r.name, competitionId: r.competitionId,
      // Season included, and folded into the name the way the sweep header does it: a
      // sweep is bound to ONE season, and "NBA" is every NBA season there has been.
      competition: c ? { name: compLabel(c), sport: c.sport, season: c.season, logo: c.logo } : null,
      // The one setting the console shows: it renders the wagering toggle off this list,
      // and a second request per card just to read one boolean would be absurd. The rest
      // of the sweep's settings stay out until something actually renders them.
      wageringEnabled: r.wageringEnabled,
      archivedAt: r.archivedAt, createdAt: r.createdAt,
    })
    return [
      ...owned.map((r) => ({
        ...base(r), role: 'owner',
        members: counts.get(r.sweep.id) ?? { total: 0, registered: 0 },
        ...links(app, r.sweep),
      })),
      // Owning wins: the owner of a sweep who also plays in it gets one row, the one
      // with the controls on it. And a member gets no member link — it is the owner's
      // to hand out, and they already came in through one.
      ...joined.filter((j) => !ownedIds.has(j.sweep.id)).map((j) => ({ ...base(j), role: 'member' })),
    ]
  })

  /** Everything the console dashboard draws, for the caller's OWN live sweeps.
   *
   *  This is entertainment, not analytics. It belongs to the person running a sweep and
   *  the group inside it — who joined when, whose teams keep winning, who calls a result
   *  right, who places a bet ninety seconds before tip-off. Platform-wide numbers are
   *  /super's job and stay there.
   *
   *  No billing gate, for the reason the rotate route below spells out: the read-only
   *  gate exists to freeze sweep CONTENT, and reading your own numbers while lapsed
   *  changes nothing about the sweep.
   *
   *  Every bucket goes out raw, one row per day. The cumulative pass these charts want is
   *  three lines of client JS, while summing server-side would both grow the payload and
   *  leave the client unable to re-window it.
   */
  app.get('/api/account/stats', { preHandler: accountGuard }, async (req, reply) => {
    // A dashboard is a tab somebody leaves open, and this is a dozen grouped queries.
    // `private`: one account's own sweeps must never sit in a shared cache.
    reply.header('Cache-Control', 'private, max-age=60')

    const mine = await app.db.select({
      id: sweep.id, competitionId: sweep.competitionId, wageringEnabled: sweep.wageringEnabled,
    }).from(sweep).where(and(eq(sweep.accountId, req.account.id), isNull(sweep.archivedAt)))
    if (!mine.length) return [] // owns nothing — not one of the queries below is worth running

    const ids = mine.map((s) => s.id)
    // The roster is fetched FIRST and every person-keyed query below is scoped to the ids
    // it hands back, which keeps "an ejected seat is not in the sweep any more" as one
    // rule in one place instead of the same join written out six times. These rows are
    // payload too: the charts label their lines and dots with the initials and avatar
    // colour the person already wears inside the sweep, so shipping them here spares the
    // client a second lookup. Ordered by name, which is the order every list of them
    // wants and the only thing that makes the blocks below deterministic.
    const roster = await app.db.select({
      sweepId: person.sweepId, id: person.id, name: person.name, initials: person.initials,
      avColor: person.avColor, claimedAt: person.claimedAt,
    }).from(person)
      .where(and(inArray(person.sweepId, ids), isNull(person.ejectedAt)))
      .orderBy(person.name)
    const pids = roster.map((p) => p.id)
    const compIds = [...new Set(mine.map((s) => s.competitionId))]
    const wids = mine.filter((s) => s.wageringEnabled).map((s) => s.id)

    /** Bucketed in UTC and handed over as a plain 'YYYY-MM-DD'. date_trunc on its own
     *  buckets in whatever timezone the session happens to carry, and a chart axis only
     *  ever wants the day. */
    const day = (col) => sql`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD')`

    /** Who won a final event — the SAME rule the group already reads on the Wins tab.
     *  winner_code is genuinely null whenever the provider named no winning side
     *  (worker/baseline-sync.js:137, worker/live-poller.js:91), and the sweep app falls
     *  back to comparing the scores when it is (web/src/components.jsx:343,
     *  web/src/screens-detail.jsx:184). Written once, here, so no chart in the console can
     *  ever disagree with the leaderboard the group is already looking at. 'DRAW' matches
     *  no competitor code, so draws fall out of every join that uses this — and a pick of
     *  'DRAW' still matches it, which is exactly right. */
    const winner = sql`coalesce(${event.winnerCode}, case when ${event.score1} > ${event.score2} then ${event.c1Code} when ${event.score2} > ${event.score1} then ${event.c2Code} else 'DRAW' end)`

    /** Every wager in one shape: a single is a bet row, and a parlay is the parlay row.
     *
     *  A parlay's legs are bet rows carrying stake 0 and potential_payout 0 — the money is
     *  on the parent (routes/coins.js:152) — so reading the bet table alone counts a
     *  four-leg accumulator as four bets that staked nothing and never sees what it paid.
     *  UNION rather than a filter plus a second query per figure: the median lead time is
     *  what forces it (two medians do not average into one), and once it exists the daily
     *  buckets, the fattest win and the per-person tally all read the same rows, so they
     *  cannot disagree with each other. Raw SQL because drizzle has no union subquery.
     *  A parlay's kickoff is its EARLIEST leg: the first one to start is what closes it. */
    const wagers = (sweepIds) => sql`(
      select b.sweep_id, b.person_id, b.placed_at, b.stake, b.potential_payout, b.status,
             e.start_utc as kickoff
        from bet b join event e on e.id = b.fixture_id
       where b.parlay_id is null
         and b.sweep_id in ${sweepIds} and b.person_id in ${pids}
      union all
      select p.sweep_id, p.person_id, p.placed_at, p.stake, p.potential_payout, p.status,
             (select min(e.start_utc) from bet l join event e on e.id = l.fixture_id
               where l.parlay_id = p.id) as kickoff
        from parlay p
       where p.sweep_id in ${sweepIds} and p.person_id in ${pids}
    ) w`
    const rowsOf = (q) => app.db.execute(q).then((r) => r.rows)

    // Nobody in any sweep, or wagering off everywhere, and the matching queries never run.
    const nothing = Promise.resolve([])
    const anyone = (q) => (pids.length ? q() : nothing)
    const punters = (q) => (pids.length && wids.length ? q() : nothing)

    const [made, claimed, race, seasons, calls, pickCounts, betCounts, wagerDaily, wagerBest, wagerLead] =
      await Promise.all([
        app.db.select({ sweepId: person.sweepId, date: day(person.createdAt), n: sql`count(*)::int` })
          .from(person)
          .where(and(inArray(person.sweepId, ids), isNull(person.ejectedAt)))
          .groupBy(person.sweepId, day(person.createdAt)),

        app.db.select({ sweepId: person.sweepId, date: day(person.claimedAt), n: sql`count(*)::int` })
          .from(person)
          .where(and(inArray(person.sweepId, ids), isNull(person.ejectedAt), isNotNull(person.claimedAt)))
          .groupBy(person.sweepId, day(person.claimedAt)),

        // The headline chart: how many of each member's teams have won, day by day.
        anyone(() => app.db.select({
          sweepId: ownership.sweepId, personId: ownership.personId,
          date: day(event.startUtc), wins: sql`count(*)::int`,
        }).from(ownership)
          .innerJoin(competitor, eq(competitor.id, ownership.competitorId))
          .innerJoin(event, and(eq(event.competitionId, competitor.competitionId), sql`${winner} = ${competitor.code}`))
          .where(and(inArray(ownership.sweepId, ids), inArray(ownership.personId, pids), eq(event.status, 'final')))
          .groupBy(ownership.sweepId, ownership.personId, day(event.startUtc))
          .orderBy(day(event.startUtc), ownership.personId)),

        // Grouped by competition, not by sweep: two sweeps can follow the same season, and
        // then this is one group serving both. `> now()` is load-bearing — filtering on
        // status alone offers a fixture postponed months ago as the next kickoff.
        app.db.select({
          competitionId: event.competitionId,
          final: sql`(count(*) filter (where ${event.status} = 'final'))::int`,
          total: sql`count(*)::int`,
          // mapWith, or this comes back as the driver's raw timestamptz text: drizzle only
          // parses timestamps it knows the column type of, and a bare sql`` fragment is not that.
          next: sql`min(${event.startUtc}) filter (where ${event.status} <> 'final' and ${event.startUtc} > now())`.mapWith(event.startUtc),
        }).from(event).where(inArray(event.competitionId, compIds)).groupBy(event.competitionId),

        // Luck vs skill: fixtures they called a side on, and how many they got right.
        anyone(() => app.db.select({
          sweepId: support.sweepId, personId: support.personId,
          picks: sql`count(*)::int`,
          right: sql`(count(*) filter (where ${support.teamCode} = ${winner}))::int`,
        }).from(support)
          .innerJoin(event, eq(event.id, support.fixtureId))
          .where(and(inArray(support.sweepId, ids), inArray(support.personId, pids), eq(event.status, 'final')))
          .groupBy(support.sweepId, support.personId)),

        // Participation, and NOT a duplicate of the query above: `calls` asks how often
        // somebody was RIGHT, which only a finished fixture can answer, while this asks
        // how much they take part at all. Filtering this one to finals too would read
        // somebody who called every fixture of the coming week as silent.
        anyone(() => app.db.select({
          sweepId: support.sweepId, personId: support.personId, n: sql`count(*)::int`,
        }).from(support)
          .where(and(inArray(support.sweepId, ids), inArray(support.personId, pids)))
          .groupBy(support.sweepId, support.personId)),

        // `ids`, not `wids`: a sweep that has had wagering turned off since keeps the bets
        // that were placed while it was on, and the people who placed them were not quiet.
        anyone(() => rowsOf(sql`
          select sweep_id as "sweepId", person_id as "personId", count(*)::int as n
            from ${wagers(ids)} group by 1, 2`)),

        punters(() => rowsOf(sql`
          select sweep_id as "sweepId", ${day(sql`placed_at`)} as date,
                 count(*)::int as bets, sum(stake)::int as staked
            from ${wagers(wids)} group by 1, 2 order by 2`)),

        // DISTINCT ON is the whole "one biggest win per sweep" query: sort by profit
        // inside each sweep and keep the first row.
        punters(() => rowsOf(sql`
          select distinct on (sweep_id) sweep_id as "sweepId", person_id as "personId",
                 (potential_payout - stake)::int as profit
            from ${wagers(wids)} where status = 'won'
           order by sweep_id, profit desc`)),

        // "bets a median 41 minutes before kickoff" — the kind of line this dashboard is for.
        punters(() => rowsOf(sql`
          select sweep_id as "sweepId", person_id as "personId",
                 (percentile_cont(0.5) within group (order by extract(epoch from kickoff - placed_at)))::int as "medianSec"
            from ${wagers(wids)} group by 1, 2`)),
      ])

    const bySweep = (rows) => {
      const m = new Map()
      for (const r of rows) { const a = m.get(r.sweepId); a ? a.push(r) : m.set(r.sweepId, [r]) }
      return m
    }
    const [gRoster, gMade, gClaimed, gRace, gCalls, gPicks, gBets, gDaily, gBest, gLead] =
      [roster, made, claimed, race, calls, pickCounts, betCounts, wagerDaily, wagerBest, wagerLead].map(bySweep)
    const bySeason = new Map(seasons.map((s) => [s.competitionId, s]))

    return mine.map((s) => {
      const people = gRoster.get(s.id) ?? []
      const num = (rows) => new Map((rows ?? []).map((r) => [r.personId, r]))
      const calledBy = num(gCalls.get(s.id))
      const pickedBy = num(gPicks.get(s.id))
      const betBy = num(gBets.get(s.id))
      const leadBy = num(gLead.get(s.id))

      // One row per day carrying both series. The gap between them IS the "not joined yet"
      // number the sweep card prints today, drawn instead of stated.
      const joins = new Map()
      const on = (date) => joins.get(date) ?? joins.set(date, { date, created: 0, claimed: 0 }).get(date)
      for (const r of gMade.get(s.id) ?? []) on(r.date).created = r.n
      for (const r of gClaimed.get(s.id) ?? []) on(r.date).claimed = r.n

      const season = bySeason.get(s.competitionId)
      const best = (gBest.get(s.id) ?? [])[0]
      return {
        sweepId: s.id,
        // Two sweeps can follow the same competition, and then the season block below is
        // the SAME fixtures handed to both — so a client adding "games played" up across
        // its rows counts them twice unless it can tell which rows share a competition.
        competitionId: s.competitionId,
        people: people.map(({ sweepId, ...p }) => p),
        joins: [...joins.values()].sort((a, b) => a.date.localeCompare(b.date)),
        race: (gRace.get(s.id) ?? []).map(({ sweepId, ...r }) => r),
        season: season
          ? { final: season.final, total: season.total, next: season.next }
          : { final: 0, total: 0, next: null }, // provisioned seconds ago — the feed has not landed yet
        calls: people.filter((p) => calledBy.has(p.id))
          .map((p) => ({ personId: p.id, picks: calledBy.get(p.id).picks, right: calledBy.get(p.id).right })),
        // Built from the roster, not from the counts: the quiet ones are half the joke,
        // and they only show up as zeros if somebody puts them there.
        activity: people.map((p) => ({
          personId: p.id,
          picks: pickedBy.get(p.id)?.n ?? 0, // every pick, not just the settled ones
          bets: betBy.get(p.id)?.n ?? 0,
          // No photo count here. A fan photo — the upload people actually make — is
          // written with a NULL person_id (routes/photos.js:70), so all a per-person
          // tally could ever count is avatars, of which everybody has at most one. On a
          // fun dashboard a number that means something other than its label is worse
          // than a missing one.
        })),
        ...(s.wageringEnabled ? {
          wagering: {
            daily: (gDaily.get(s.id) ?? []).map(({ sweepId, ...d }) => d),
            biggest: best ? { personId: best.personId, profit: best.profit } : null,
            lead: people.filter((p) => leadBy.has(p.id))
              .map((p) => ({ personId: p.id, medianSec: leadBy.get(p.id).medianSec })),
          },
        } : {}),
      }
    })
  })

  /** Open a sweep the account belongs to, with no invite link in hand.
   *
   *  The sweep cookie could only ever be minted from the group's member token, so the
   *  console's own promise — "sign in on any device you own it from" — was false for
   *  anyone on a fresh browser: a member (or an owner whose 8h cookie had lapsed) was
   *  sent to find an invite link for a sweep they are already in. The account session
   *  is 90 days and is the stronger credential of the two; this spends it.
   *
   *  404, never 403, for a sweep the account has nothing to do with — the id must not
   *  become an oracle for which sweeps exist. Archived sweeps and ejected seats are
   *  both nothing-to-do-with. */
  app.post('/api/account/sweeps/:id/session', { preHandler: accountGuard }, async (req, reply) => {
    const [row] = await app.db.select().from(sweep)
      .where(and(eq(sweep.id, req.params.id), isNull(sweep.archivedAt)))
    if (!row) return reply.code(404).send({ error: 'not_found' })

    const owns = row.accountId === req.account.id
    if (!owns) {
      const [seat] = await app.db.select({ id: person.id }).from(person)
        .where(and(
          eq(person.sweepId, row.id),
          eq(person.accountId, req.account.id),
          isNull(person.ejectedAt),
        ))
      if (!seat) return reply.code(404).send({ error: 'not_found' })
    }

    // Merge, never replace — same as POST /api/session: opening one sweep from the
    // console must not sign this browser out of another.
    reply.setCookie(SWEEP_COOKIE, reply.signCookie(signSweepCookie(withSweep(readSweepList(app, req), row.id))), {
      httpOnly: true, sameSite: 'lax', path: '/', maxAge: COOKIE_MAX_AGE,
      secure: process.env.NODE_ENV === 'production',
    })
    return { sweepId: row.id }
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
