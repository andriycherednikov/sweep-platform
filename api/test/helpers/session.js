import { eq } from 'drizzle-orm'
import { account, accountSession, person, sweep } from '../../src/db/schema.js'
import { newToken } from '../../src/sweeps/tokens.js'
import { SESSION_TTL_MS } from '../../src/accounts/auth.js'

/** A member cookie for the seeded sweep. Memoized per app: POST /api/session is
 *  rate-limited, and minting one per test would exhaust the budget. */
const cookies = new WeakMap()
export async function memberCookie(app) {
  if (cookies.has(app)) return cookies.get(app)
  const res = await app.inject({
    method: 'POST', url: '/api/session',
    headers: { host: 'platform.test' },
    payload: { token: 'seedmembertoken000000' },
  })
  const c = res.headers['set-cookie']
  cookies.set(app, c)
  return c
}

/** An app-shaped client whose every inject carries a member cookie for the seeded sweep.
 *  For the suites that predate accounts and simply need to BE somebody in that sweep —
 *  there is no anonymous membership to fall back into any more. Per-call headers win,
 *  so a test can still send its own cookie, or an account token alongside this one. */
export async function memberClient(app) {
  const cookie = await memberCookie(app)
  return { inject: (opts) => app.inject({ ...opts, headers: { cookie, ...opts.headers } }) }
}

/** An account session, inserted directly — no magic link, no mail, no rate limit. */
export async function ownerHeaders(db, accountId = 'ac_seed') {
  const token = newToken()
  await db.insert(accountSession).values({
    token, accountId, expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  })
  return { 'x-account-token': token }
}

/** Group-admin headers for `sweepId`. Admin is derived, not held: the cookie names the
 *  sweep, the account token proves ownership of it. Mints an active-subscription owner
 *  so the read-only gate stays out of the way; pass `accountId` to own it with an
 *  existing (e.g. lapsed) account instead. */
export async function adminHeaders(app, db, sweepId, accountId) {
  if (!accountId) {
    accountId = `ac_own_${sweepId}`
    await db.insert(account).values({
      id: accountId, email: `${accountId}@example.test`, subscriptionStatus: 'active',
    }).onConflictDoNothing()
  }
  await db.update(sweep).set({ accountId }).where(eq(sweep.id, sweepId))
  const [row] = await db.select().from(sweep).where(eq(sweep.id, sweepId))
  const res = await app.inject({
    method: 'POST', url: '/api/session', headers: { host: 'platform.test' },
    payload: { token: row.memberToken },
  })
  return { host: 'platform.test', cookie: res.headers['set-cookie'], ...(await ownerHeaders(db, accountId)) }
}

/** Bind an existing person row to a fresh account and return that account's headers.
 *  personId is derived from the session now, so a test that wants to BE somebody needs
 *  a seat, not a body field. One account per seat: person_sweep_account_uq is real. */
export async function seatFor(db, personId, { accountId = `ac_seat_${personId}`, email } = {}) {
  await db.insert(account).values({
    id: accountId, email: email ?? `${accountId}@example.test`,
  }).onConflictDoNothing()
  await db.update(person).set({ accountId, claimedAt: new Date() }).where(eq(person.id, personId))
  return ownerHeaders(db, accountId)
}
