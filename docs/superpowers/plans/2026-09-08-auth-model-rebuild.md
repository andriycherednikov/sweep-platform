# Auth Model Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace four unrelated ways of proving identity — magic link, admin capability URL, bcrypt passcode, super token — with one: an account that signs in with a password and derives its authority from what it owns.

**Architecture:** Admin stops being a stored role and becomes a per-request comparison in the global `sweepResolver` preHandler: `req.account.id === sweep.accountId`. The sweep cookie degrades to a list of sweep ids. The default sweep, its passcode, and the super-admin token are deleted; the platform owner becomes an ordinary account carrying `account.role`.

**Tech Stack:** Node 22 ESM, Fastify 5, Drizzle ORM over Postgres 16, `bcryptjs` (already a dependency), `resend` (new), Vitest + `@testcontainers/postgresql`.

**Spec:** `docs/superpowers/specs/2026-09-08-auth-model-rebuild-design.md`

## Global Constraints

- **TDD, always.** Failing test → run it → minimal implementation → run it → commit. Every task below is written in that order; do not reorder.
- **The suite must be green at every commit.** Baselines: api **80 files / 462 tests**, web **49 files / 562 tests**.
- **Run api tests from `api/`:** `cd api && npx vitest run`. The repo root has no vitest config and silently reports "no tests" — a green root run is not evidence of anything.
- **Run web tests from the root:** `npm test -w web`.
- **Conventional Commits.** Small and frequent.
- **DRY, YAGNI.** Build what the task needs.
- Migrations: edit `api/src/db/schema.js`, then `cd api && npx drizzle-kit generate`. Never hand-edit an existing migration or snapshot — the migrator hashes them. `drizzle-kit generate` emits no data statements; if a task needs one, add it by hand to the *new* file only.
- **Do not** set `sweep.account_id NOT NULL`, and **do not** drop `sweep.kind`. Both are explicit non-goals with measured costs (spec §7).
- `bcryptjs` is already wrapped in `api/src/auth.js`. Add to that file; do not introduce a second bcrypt idiom.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `api/src/seed/seed.js` | Seed an *owned* sweep so the suite exercises the real ownership path | 1 |
| `api/test/helpers/session.js` | **New.** `memberCookie(app)`, `ownerHeaders(db, accountId)` — the two credentials every later test needs | 2 |
| `api/src/sweeps/resolve.js` | Resolve the sweep *and* derive the role from account ownership | 3, 10 |
| `api/src/mail.js` | **New.** The Resend transport behind the existing `sendMail` seam | 4 |
| `api/src/accounts/auth.js` | `requireAccount` (exists), `requireOperator` (new) | 5 |
| `api/src/accounts/audit.js` | **New.** One writer for operator audit rows | 5 |
| `api/src/auth.js` | bcrypt helpers: `verifyPasscode` (exists), `hashPassword`, `verifyPassword` | 6 |
| `api/src/routes/account.js` | Password login, set/change, session revocation, re-homed owner routes | 7, 9 |
| `api/src/routes/sweeps.js` | Super routes re-guarded onto the operator role; `links()` loses `adminLink` | 10, 11 |
| `api/src/routes/admin.js` | Passcode login deleted; admin routes onto the owner guard | 10 |
| `api/src/sweeps/auth.js` | Cookie helpers; role half removed, legacy form tolerated | 11 |
| `web/src/api/client.js` | `x-account-token` on admin/operator calls only — never the shared helper | 12 |
| `web/src/lib/joinLink.js` | Old admin links degrade to member links | 13 |
| `web/src/SweepProvider.jsx` | Owner entry before stored-token entry | 14 |
| `web/src/AccountRoot.jsx` | Password sign-in, set-password, sign out | 15 |

---

## Task 1: Seed an owned sweep

The whole plan rests on the suite exercising an *owned* sweep. Today the seeded sweep has no `accountId`, which makes it the one shape the new code will never see in production.

**Read the spec's warning first (§7):** `sweepIsLive` returns true unconditionally while a sweep is accountless (`api/src/accounts/billing.js:12`). Give the seeded sweep an owner whose account has no subscription and `readOnlyGate` starts 403ing **every sweep-scoped write in all 80 test files**. The account must be in `GOOD_STANDING`.

**Files:**
- Modify: `api/src/seed/seed.js:24-34`
- Test: `api/test/seed-owner.test.js` (create)

**Interfaces:**
- Produces: a seeded account id `ac_seed` with `subscriptionStatus: 'active'`; the seeded sweep `default` gains `memberToken: 'seedmembertoken000000'` and `accountId: 'ac_seed'`.
- Consumed by: Task 2's `memberCookie` and `ownerHeaders`.

- [ ] **Step 1: Write the failing test**

Create `api/test/seed-owner.test.js`:

```js
import { expect, test, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { account, sweep } from '../src/db/schema.js'
import { GOOD_STANDING } from '../src/accounts/billing.js'

const { pool, db } = openTestDb()
const app = buildApp(db, { sessionSecret: 'test-secret', platformHost: 'platform.test' })
beforeAll(async () => { await app.ready() })
afterAll(async () => { await app.close(); await pool.end() })

// The seeded sweep is the one every other test file shares. It was accountless, which
// is the single shape sweepIsLive short-circuits on (accounts/billing.js:12) — so the
// suite never exercised the ownership path it is about to depend on.
test('the seeded sweep is owned by an account in good standing', async () => {
  const [row] = await db.select().from(sweep).where(eq(sweep.id, 'default'))
  expect(row.accountId).toBe('ac_seed')
  const [acc] = await db.select().from(account).where(eq(account.id, 'ac_seed'))
  expect(GOOD_STANDING).toContain(acc.subscriptionStatus)
})

// Not a gating test: POST /api/session is exempt (sweeps/read-only.js:4) and carries no
// cookie, so readOnlyGate returns before sweepLiveNow either way. What it does prove is
// that the seed minted a working memberToken — which Task 2's memberCookie() rides on.
test('the seeded member token mints a session', async () => {
  const res = await app.inject({
    method: 'POST', url: '/api/session',
    headers: { host: 'platform.test' },
    payload: { token: 'seedmembertoken000000' },
  })
  expect(res.statusCode).toBe(200)
  expect(res.json().sweepId).toBe('default')
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd api && npx vitest run test/seed-owner.test.js
```

Expected: both fail — `accountId` is `null`, and `POST /api/session` 404s because the seeded sweep has no `memberToken`.

- [ ] **Step 3: Implement**

In `api/src/seed/seed.js`, immediately before the `s.sweep` insert at line 29:

```js
  // The seeded sweep is owned, like every real sweep. 'active' is not decoration:
  // an owned sweep whose account is neither subscribed nor in trial is read-only
  // (accounts/billing.js:10-16), which would 403 every mutating test in the suite.
  await db.insert(s.account).values({
    id: 'ac_seed', email: 'seed@example.test', name: 'Seed Owner',
    subscriptionStatus: 'active',
  }).onConflictDoNothing()
```

Then extend the sweep insert:

```js
  await db.insert(s.sweep).values({
    id: 'default', name: 'The Sweep', kind: 'default', scoringRule: 'top3',
    coOwners: 'all_win', competitionId: COMPETITION_ID, wageringEnabled: true,
    memberToken: 'seedmembertoken000000', accountId: 'ac_seed',
  }).onConflictDoNothing()
```

- [ ] **Step 4: Run the new test, then the whole suite**

```bash
cd api && npx vitest run test/seed-owner.test.js
cd api && npx vitest run
```

Expected: new file passes; **80 files / 462 tests + 2 new = all green, with zero edits to existing tests**. If anything returns `sweep_readonly`, the account's `subscriptionStatus` is wrong — fix that, not the failing test.

- [ ] **Step 5: Commit**

```bash
git add api/src/seed/seed.js api/test/seed-owner.test.js
git commit -m "test(api): the seeded sweep is owned, like every real one"
```

---

## Task 2: Test credential helpers

No source changes. This task exists so every later test can say "as a member" or "as the owner" in one line, and so Task 8's migration of 9 test files is mechanical.

**Files:**
- Create: `api/test/helpers/session.js`
- Test: `api/test/helpers/session.test.js`

**Interfaces:**
- Produces:
  - `memberCookie(app): Promise<string>` — a signed `sweep_session` cookie for the seeded sweep, memoized per app.
  - `ownerHeaders(db, accountId = 'ac_seed'): Promise<{'x-account-token': string}>` — inserts an `account_session` row directly and returns the header object.
- Consumed by: Tasks 3, 8, 9, 10.

- [ ] **Step 1: Write the failing test**

Create `api/test/helpers/session.test.js`:

```js
import { expect, test, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../../src/app.js'
import { openTestDb } from './db.js'
import { memberCookie, ownerHeaders } from './session.js'

const { pool, db } = openTestDb()
const app = buildApp(db, { sessionSecret: 'test-secret', platformHost: 'platform.test' })
beforeAll(async () => { await app.ready() })
afterAll(async () => { await app.close(); await pool.end() })

test('memberCookie resolves the seeded sweep as a member', async () => {
  const res = await app.inject({
    method: 'GET', url: '/api/whoami',
    headers: { host: 'platform.test', cookie: await memberCookie(app) },
  })
  expect(res.json()).toEqual({ sweepId: 'default', role: 'member' })
})

test('ownerHeaders mints a usable account session', async () => {
  const res = await app.inject({
    method: 'GET', url: '/api/account',
    headers: await ownerHeaders(db),
  })
  expect(res.statusCode).toBe(200)
  expect(res.json().id).toBe('ac_seed')
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd api && npx vitest run test/helpers/session.test.js
```

Expected: FAIL — `Cannot find module './session.js'`.

- [ ] **Step 3: Implement**

Create `api/test/helpers/session.js`:

```js
import { accountSession } from '../../src/db/schema.js'
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

/** An account session, inserted directly — no magic link, no mail, no rate limit. */
export async function ownerHeaders(db, accountId = 'ac_seed') {
  const token = newToken()
  await db.insert(accountSession).values({
    token, accountId, expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  })
  return { 'x-account-token': token }
}
```

- [ ] **Step 4: Run the new test, then the whole suite**

```bash
cd api && npx vitest run test/helpers/session.test.js
cd api && npx vitest run
```

Expected: all green. This task adds code and changes no behaviour.

- [ ] **Step 5: Commit**

```bash
git add api/test/helpers/session.js api/test/helpers/session.test.js
git commit -m "test(api): one line to be a member, one to be the owner"
```

---

## Task 3: Account-derived admin, additive

The core mechanism. **Additive** — the capability link and the passcode still mint `admin` into the cookie, so nothing breaks. The deletions come in Task 10.

**Files:**
- Modify: `api/src/sweeps/resolve.js`
- Test: `api/test/owner-admin.test.js` (create)

**Interfaces:**
- Consumes: `ownerHeaders`, `memberCookie` from Task 2.
- Produces: `req.account` (row or null) and a `req.role` that is `'admin'` whenever `req.account.id === req.sweep.accountId`.

- [ ] **Step 1: Write the failing test**

Create `api/test/owner-admin.test.js`:

```js
import { expect, test, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { memberCookie, ownerHeaders } from './helpers/session.js'
import { account } from '../src/db/schema.js'

const { pool, db } = openTestDb()
const app = buildApp(db, { sessionSecret: 'test-secret', platformHost: 'platform.test' })
beforeAll(async () => {
  await app.ready()
  await db.insert(account).values({
    id: 'ac_other', email: 'other@example.test', subscriptionStatus: 'active',
  }).onConflictDoNothing()
})
afterAll(async () => { await app.close(); await pool.end() })

const whoami = (headers) => app.inject({
  method: 'GET', url: '/api/whoami', headers: { host: 'platform.test', ...headers },
})

test('the owning account is admin of its own sweep', async () => {
  const res = await whoami({ cookie: await memberCookie(app), ...(await ownerHeaders(db)) })
  expect(res.json()).toEqual({ sweepId: 'default', role: 'admin' })
})

// The check is per-sweep, not a per-account flag. This is the test that proves it:
// a perfectly valid account session on a sweep it does not own is just a member.
test('a different account is only a member', async () => {
  const res = await whoami({ cookie: await memberCookie(app), ...(await ownerHeaders(db, 'ac_other')) })
  expect(res.json()).toEqual({ sweepId: 'default', role: 'member' })
})

test('no account header falls back to the cookie role', async () => {
  const res = await whoami({ cookie: await memberCookie(app) })
  expect(res.json()).toEqual({ sweepId: 'default', role: 'member' })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd api && npx vitest run test/owner-admin.test.js
```

Expected: the first test fails — `role` is `'member'`, because nothing reads `x-account-token` in the resolver yet.

- [ ] **Step 3: Implement**

In `api/src/sweeps/resolve.js`, add the account lookup above `sweepResolver` and use it:

```js
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
```

Inside the returned handler, after `req.role = null`:

```js
    req.account = await accountFor(app, req)
```

and replace both `req.role = …` assignments with a shared derivation:

```js
      req.sweep = row
      // Admin is a fact about ownership, recomputed per request — never a stored role.
      // Signing out of the account therefore revokes admin immediately, not in 8 hours.
      req.role = req.account?.id && req.account.id === row.accountId ? 'admin' : session.role
```

and on the default-sweep fallback branch:

```js
    req.role = req.account?.id && req.account.id === row.accountId
      ? 'admin'
      : list?.find((e) => e.sweepId === DEFAULT_SWEEP_ID)?.role ?? 'member'
```

- [ ] **Step 4: Run the new test, then the whole suite**

```bash
cd api && npx vitest run test/owner-admin.test.js
cd api && npx vitest run
```

Expected: all green, **zero edits to existing tests** — the change only ever *adds* admin, never removes it.

- [ ] **Step 5: Commit**

```bash
git add api/src/sweeps/resolve.js api/test/owner-admin.test.js
git commit -m "feat(api): the account that owns a sweep administers it"
```

---

## Task 4: The Resend transport, and a boot that fails closed

`api/src/app.js:82` decorates `sendMail` with a `console.log` fallback that `api/src/server.js` never overrides. In production, requesting a sign-in link for *any* address writes a working URL to container stdout.

**Read the spec's warning (§2):** guard on `opts.sendMail` and you throw on a correctly configured production boot — that option is the *test injection seam*, not the configuration. Resolve the transport from env inside `buildApp`, exactly as `stripeKey` is at `app.js:84-88`.

**Files:**
- Create: `api/src/mail.js`
- Modify: `api/src/app.js:82`, `.env.example`, `docker/.env.docker.example`, `api/package.json`
- Test: `api/test/mail.test.js` (create)

**Interfaces:**
- Produces: `transportFromEnv(): ((to, subject, body) => Promise<void>) | null` — null when `RESEND_API_KEY` is unset.

- [ ] **Step 1: Add the dependency**

```bash
npm install resend -w api
```

- [ ] **Step 2: Write the failing test**

Create `api/test/mail.test.js`:

```js
import { expect, test, vi } from 'vitest'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { transportFromEnv } from '../src/mail.js'

const { db } = openTestDb()

test('no key configured means no transport', () => {
  expect(transportFromEnv({})).toBeNull()
})

test('a configured key yields a transport that sends', async () => {
  const send = vi.fn(async () => ({ data: { id: 'e_1' }, error: null }))
  const t = transportFromEnv({ RESEND_API_KEY: 're_x', MAIL_FROM: 'a@b.test' }, { emails: { send } })
  await t('to@example.test', 'Subject', 'Body')
  expect(send).toHaveBeenCalledWith(expect.objectContaining({
    from: 'a@b.test', to: 'to@example.test', subject: 'Subject',
  }))
})

// Sign-in links are bearer credentials. Printing them to stdout in production hands
// an account to anyone with log access, so a prod boot without mail must not happen.
test('production refuses to boot with no transport', () => {
  expect(() => buildApp(db, {
    sessionSecret: 's', platformHost: 'h', nodeEnv: 'production', env: {},
  })).toThrow(/mail transport/)
})

test('dev still boots and logs to the console', () => {
  expect(() => buildApp(db, { sessionSecret: 's', platformHost: 'h' })).not.toThrow()
})
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd api && npx vitest run test/mail.test.js
```

Expected: FAIL — `Cannot find module '../src/mail.js'`.

- [ ] **Step 4: Implement the transport**

Create `api/src/mail.js`:

```js
import { Resend } from 'resend'

/** The mail transport, or null when unconfigured. Kept behind app.sendMail's existing
 *  seam so tests inject a fake and no other file learns the provider's name.
 *  `client` is injectable for tests; production builds one from the key. */
export function transportFromEnv(env = process.env, client = null) {
  const key = env.RESEND_API_KEY
  const from = env.MAIL_FROM
  if (!key || !from) return null
  const resend = client ?? new Resend(key)
  return async (to, subject, body) => {
    const { error } = await resend.emails.send({ from, to, subject, text: body })
    if (error) throw new Error(`mail send failed: ${error.message ?? error}`)
  }
}
```

- [ ] **Step 5: Implement the boot guard**

In `api/src/app.js`, replace the `sendMail` decoration at line 82:

```js
  // Sign-in links and member verification both ride this. A production boot with no
  // transport would print bearer credentials to stdout, so it is refused — the same
  // shape as the sessionSecret guard above. opts.sendMail is the test seam, so the
  // guard must read the ENV, not the option, or a configured prod boot would throw.
  const nodeEnv = opts.nodeEnv ?? process.env.NODE_ENV
  const sendMail = opts.sendMail
    ?? transportFromEnv(opts.env ?? process.env)
    ?? (nodeEnv === 'production' ? null : (async (to, subject, body) => console.log(`[mail] to=${to} subject=${subject}\n${body}`)))
  if (!sendMail) throw new Error('a mail transport must be configured in production')
  app.decorate('sendMail', sendMail)
```

Add the import at the top of `api/src/app.js`:

```js
import { transportFromEnv } from './mail.js'
```

- [ ] **Step 6: Document the env**

Append to `.env.example` and `docker/.env.docker.example`:

```
# Transactional mail (Resend). Required in production — the API refuses to boot without
# it, because the fallback prints sign-in links to stdout. MAIL_FROM must be on a domain
# verified in Resend with SPF and DKIM, or delivery silently goes to spam.
RESEND_API_KEY=
MAIL_FROM=The Sweep <hello@example.com>
```

- [ ] **Step 7: Run the new test, then the whole suite**

```bash
cd api && npx vitest run test/mail.test.js
cd api && npx vitest run
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add api/src/mail.js api/src/app.js api/test/mail.test.js api/package.json package-lock.json .env.example docker/.env.docker.example
git commit -m "feat(api): mail has a transport, and prod refuses to boot without one"
```

---

## Task 5: The operator role and its audit trail

**Files:**
- Modify: `api/src/db/schema.js` (account.role; new `operator_action` table), `api/src/accounts/auth.js`
- Create: `api/src/accounts/audit.js`, migration via drizzle-kit
- Test: `api/test/operator-role.test.js` (create)

**Interfaces:**
- Produces:
  - `account.role: 'user' | 'operator'`, default `'user'`.
  - `requireOperator(app)` — preHandler, 401 without an account, 403 when the role is not `operator`.
  - `recordOperatorAction(db, { actorId, action, target, sweepIds })` — one audit row.
- Consumed by: Task 10 (`/api/super/*` re-guarded).

- [ ] **Step 1: Write the failing test**

Create `api/test/operator-role.test.js`:

```js
import { expect, test, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { ownerHeaders } from './helpers/session.js'
import { account, operatorAction } from '../src/db/schema.js'
import { recordOperatorAction } from '../src/accounts/audit.js'

const { pool, db } = openTestDb()
const app = buildApp(db, { sessionSecret: 'test-secret', platformHost: 'platform.test' })
beforeAll(async () => {
  await app.ready()
  await db.insert(account).values({
    id: 'ac_op', email: 'op@example.test', role: 'operator', subscriptionStatus: 'active',
  }).onConflictDoNothing()
})
afterAll(async () => { await app.close(); await pool.end() })

test('accounts are ordinary users unless made operators', async () => {
  const [seed] = await db.select().from(account).where(eq(account.id, 'ac_seed'))
  expect(seed.role).toBe('user')
})

test('an audit row records the actor and the sweeps an action touched', async () => {
  await recordOperatorAction(db, {
    actorId: 'ac_op', action: 'correct_fixture', target: 'fx_1', sweepIds: ['default'],
  })
  const [row] = await db.select().from(operatorAction).where(eq(operatorAction.target, 'fx_1'))
  expect(row.actorId).toBe('ac_op')
  expect(row.sweepIds).toEqual(['default'])
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd api && npx vitest run test/operator-role.test.js
```

Expected: FAIL — no `role` column, no `operatorAction` export, no `audit.js`.

- [ ] **Step 3: Add the schema**

In `api/src/db/schema.js`, add to the `account` table definition:

```js
  // 'operator' is the platform owner: operate, never impersonate (spec §5). Granted by
  // hand — a self-serve route that grants this is a privilege-escalation hole.
  role: text('role').notNull().default('user'),
```

and after `accountSession`:

```js
/** Operator actions are competition-wide and irreversible in places, so every one is
 *  attributable. sweepIds records the real blast radius, not the route's shape. */
export const operatorAction = pgTable('operator_action', {
  id: text('id').primaryKey(),
  actorId: text('actor_id').notNull().references(() => account.id),
  action: text('action').notNull(),
  target: text('target'),
  sweepIds: jsonb('sweep_ids').$type().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

- [ ] **Step 4: Generate the migration**

```bash
cd api && npx drizzle-kit generate
```

Verify the generated SQL adds `role` with its default and creates `operator_action`. It must contain no `NOT NULL` on an existing column without a default.

- [ ] **Step 5: Implement the guard and the writer**

Create `api/src/accounts/audit.js`:

```js
import { operatorAction } from '../db/schema.js'
import { newToken } from '../sweeps/tokens.js'

export async function recordOperatorAction(db, { actorId, action, target = null, sweepIds = [] }) {
  await db.insert(operatorAction).values({ id: `oa_${newToken(12)}`, actorId, action, target, sweepIds })
}
```

Append to `api/src/accounts/auth.js`:

```js
/** preHandler: an account session whose account carries the operator role. */
export function requireOperator(app) {
  const account = requireAccount(app)
  return async (req, reply) => {
    await account(req, reply)
    if (reply.sent) return
    if (req.account?.role !== 'operator') return reply.code(403).send({ error: 'forbidden' })
  }
}
```

- [ ] **Step 6: Run the new test, then the whole suite**

```bash
cd api && npx vitest run test/operator-role.test.js
cd api && npx vitest run
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add api/src/db/schema.js api/migrations api/src/accounts/audit.js api/src/accounts/auth.js api/test/operator-role.test.js
git commit -m "feat(api): a platform owner is an account with a role, and it is audited"
```

---

## Task 6: bcrypt helpers and the password column

**Files:**
- Modify: `api/src/db/schema.js` (`account.password_hash`, `account_session.via`), `api/src/auth.js`
- Test: `api/test/password-hash.test.js` (create)

**Interfaces:**
- Produces: `hashPassword(plain): Promise<string>`, `verifyPassword(plain, hash): Promise<boolean>`, `DUMMY_HASH: string`.
- Consumed by: Task 7.

- [ ] **Step 1: Write the failing test**

Create `api/test/password-hash.test.js`:

```js
import { expect, test } from 'vitest'
import { hashPassword, verifyPassword, DUMMY_HASH } from '../src/auth.js'

test('a hash verifies its own password and nothing else', async () => {
  const h = await hashPassword('correct horse battery')
  expect(await verifyPassword('correct horse battery', h)).toBe(true)
  expect(await verifyPassword('wrong horse battery', h)).toBe(false)
})

// bcrypt silently truncates past 72 bytes, so two different long passwords would
// otherwise be the same credential. Reject rather than truncate.
test('a password over 72 bytes is refused, not silently truncated', async () => {
  await expect(hashPassword('a'.repeat(73))).rejects.toThrow(/72/)
})

// The login handler compares against this when no usable hash exists, so an address
// with no account costs the same time as one with a password.
test('DUMMY_HASH is a real bcrypt hash that matches nothing', async () => {
  expect(DUMMY_HASH).toMatch(/^\$2[aby]\$/)
  expect(await verifyPassword('anything', DUMMY_HASH)).toBe(false)
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd api && npx vitest run test/password-hash.test.js
```

Expected: FAIL — the three functions are not exported.

- [ ] **Step 3: Implement**

Append to `api/src/auth.js`:

```js
const ROUNDS = 10
/** bcrypt truncates silently past 72 bytes — two different long passwords would hash
 *  identically, so the cap is a correctness rule, not a policy preference. */
export const MAX_PASSWORD_BYTES = 72

export async function hashPassword(plain) {
  if (Buffer.byteLength(plain, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new Error(`password must be at most ${MAX_PASSWORD_BYTES} bytes`)
  }
  return bcrypt.hash(plain, ROUNDS)
}

export async function verifyPassword(plain, hash) {
  if (!hash || !plain) return false
  try { return await bcrypt.compare(plain, hash) } catch { return false }
}

/** Compared against when no usable hash exists, so response timing cannot be used to
 *  discover which addresses have accounts. */
export const DUMMY_HASH = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8.PHkQm9k9tE2/YHRlqPNL0AQmM1Xu'
```

- [ ] **Step 4: Add the columns**

In `api/src/db/schema.js`, add to `account`:

```js
  passwordHash: text('password_hash'),   // nullable — magic-link-only accounts predate passwords
```

and to `accountSession`:

```js
  // How this session was proven. A 'link' session younger than 15 minutes may SET a
  // password without knowing the old one — that exemption is what makes forgotten-
  // password recovery possible at all.
  via: text('via').notNull().default('link'),
```

- [ ] **Step 5: Generate the migration and run the tests**

```bash
cd api && npx drizzle-kit generate
cd api && npx vitest run test/password-hash.test.js
cd api && npx vitest run
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add api/src/auth.js api/src/db/schema.js api/migrations api/test/password-hash.test.js
git commit -m "feat(api): password hashing, with the 72-byte truncation made explicit"
```

---

## Task 7: Password routes and session revocation

**Files:**
- Modify: `api/src/routes/account.js`
- Test: `api/test/account-password.test.js` (create)

**Interfaces:**
- Consumes: `hashPassword`, `verifyPassword`, `DUMMY_HASH` (Task 6); `ownerHeaders` (Task 2).
- Produces: `POST /api/account/password/session`, `POST /api/account/password`, `DELETE /api/account/session`, `DELETE /api/account/sessions`; `GET /api/account` gains `hasPassword`.

- [ ] **Step 1: Write the failing test**

Create `api/test/account-password.test.js`:

```js
import { expect, test, beforeAll, afterAll } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { ownerHeaders } from './helpers/session.js'
import { account, accountSession } from '../src/db/schema.js'
import { newToken } from '../src/sweeps/tokens.js'
import { SESSION_TTL_MS } from '../src/accounts/auth.js'
import { hashPassword } from '../src/auth.js'

const { pool, db } = openTestDb()
const app = buildApp(db, { sessionSecret: 'test-secret', platformHost: 'platform.test' })
beforeAll(async () => {
  await app.ready()
  await db.insert(account).values({
    id: 'ac_pw', email: 'pw@example.test', subscriptionStatus: 'active',
  }).onConflictDoNothing()
})
afterAll(async () => { await app.close(); await pool.end() })

const setPw = (headers, payload) =>
  app.inject({ method: 'POST', url: '/api/account/password', headers, payload })
const login = (payload) =>
  app.inject({ method: 'POST', url: '/api/account/password/session', payload })

test('a fresh link session may set a password without knowing the old one', async () => {
  const res = await setPw(await ownerHeaders(db, 'ac_pw'), { password: 'a-good-passphrase' })
  expect(res.statusCode).toBe(204)
})

test('the password then signs in, and the session works', async () => {
  const res = await login({ email: 'pw@example.test', password: 'a-good-passphrase' })
  expect(res.statusCode).toBe(201)
  const me = await app.inject({
    method: 'GET', url: '/api/account',
    headers: { 'x-account-token': res.json().accountToken },
  })
  expect(me.json()).toMatchObject({ id: 'ac_pw', hasPassword: true })
})

// An attacker must not be able to tell which addresses have accounts.
test('a wrong password and an unknown email are indistinguishable', async () => {
  const wrong = await login({ email: 'pw@example.test', password: 'not-the-passphrase' })
  const nobody = await login({ email: 'nobody@example.test', password: 'not-the-passphrase' })
  expect(wrong.statusCode).toBe(401)
  expect(nobody.statusCode).toBe(401)
  expect(wrong.json()).toEqual(nobody.json())
})

// Without this, a stolen 90-day token becomes a PERMANENT password.
test('changing a password on a stale session requires the current one', async () => {
  const token = newToken()
  await db.insert(accountSession).values({
    token, accountId: 'ac_pw', via: 'password',
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  })
  const headers = { 'x-account-token': token }
  expect((await setPw(headers, { password: 'another-passphrase' })).statusCode).toBe(403)
  expect((await setPw(headers, { password: 'another-passphrase', current: 'nope' })).statusCode).toBe(401)
  expect((await setPw(headers, { password: 'another-passphrase', current: 'a-good-passphrase' })).statusCode).toBe(204)
})

// The freshness exemption must not be a free pass just because there's no old
// password to check against — a stolen 90-day token could otherwise plant a
// password on an account that never had one, and keep working past a sign-out-everywhere.
test('a stale link session cannot bootstrap a password either', async () => {
  await db.insert(account).values({
    id: 'ac_pw_bootstrap', email: 'pw-bootstrap@example.test',
  }).onConflictDoNothing()
  const token = newToken()
  await db.insert(accountSession).values({
    token, accountId: 'ac_pw_bootstrap', via: 'link',
    createdAt: new Date(Date.now() - 20 * 60_000),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  })
  const res = await setPw({ 'x-account-token': token }, { password: 'a-good-passphrase' })
  expect(res.statusCode).toBe(403)
  expect(res.json()).toEqual({ error: 'reauth_required' })
})

// The grace window has a time limit, not just a via check.
test('a stale link session cannot change an existing password without current either', async () => {
  await db.insert(account).values({
    id: 'ac_pw_stale', email: 'pw-stale@example.test', passwordHash: await hashPassword('original-passphrase'),
  }).onConflictDoNothing()
  const token = newToken()
  await db.insert(accountSession).values({
    token, accountId: 'ac_pw_stale', via: 'link',
    createdAt: new Date(Date.now() - 20 * 60_000),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  })
  const res = await setPw({ 'x-account-token': token }, { password: 'a-newer-passphrase' })
  expect(res.statusCode).toBe(403)
  expect(res.json()).toEqual({ error: 'current_required' })
})

// hashPassword's cap is 72 BYTES; the schema's maxLength is 72 UTF-16 units — a
// multi-byte password can clear the schema and still overflow the hash.
test('a 72-character multi-byte password is rejected cleanly, not with a 500', async () => {
  const res = await setPw(await ownerHeaders(db, 'ac_pw'), { password: 'д'.repeat(72) })
  expect(res.statusCode).toBe(400)
  expect(res.json()).toEqual({ error: 'password_too_long' })
})

test('sign out drops this session only; sign out everywhere drops the rest', async () => {
  const a = await ownerHeaders(db, 'ac_pw')
  const b = await ownerHeaders(db, 'ac_pw')
  expect((await app.inject({ method: 'DELETE', url: '/api/account/session', headers: a })).statusCode).toBe(204)
  expect((await app.inject({ method: 'GET', url: '/api/account', headers: a })).statusCode).toBe(401)
  expect((await app.inject({ method: 'GET', url: '/api/account', headers: b })).statusCode).toBe(200)
  expect((await app.inject({ method: 'DELETE', url: '/api/account/sessions', headers: b })).statusCode).toBe(204)
  expect((await app.inject({ method: 'GET', url: '/api/account', headers: b })).statusCode).toBe(401)
  const left = await db.select().from(accountSession).where(eq(accountSession.accountId, 'ac_pw'))
  expect(left).toHaveLength(0)
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd api && npx vitest run test/account-password.test.js
```

Expected: every test 404s — none of the routes exist.

- [ ] **Step 3: Implement**

In `api/src/routes/account.js`, add the imports:

```js
import { hashPassword, verifyPassword, DUMMY_HASH, MAX_PASSWORD_BYTES } from '../auth.js'
```

Add the body schemas beside the existing ones:

```js
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
const LINK_GRACE_MS = 15 * 60_000
```

Add the routes inside `accountRoutes`:

```js
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
    await app.sendMail(acc.email, 'Your password was changed',
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
```

Extend `GET /api/account` to report `hasPassword`:

```js
  app.get('/api/account', { preHandler: requireAccount(app) }, async (req) => ({
    id: req.account.id, email: req.account.email, name: req.account.name,
    hasPassword: !!req.account.passwordHash,
  }))
```

- [ ] **Step 4: Run the new test, then the whole suite**

```bash
cd api && npx vitest run test/account-password.test.js
cd api && npx vitest run
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/account.js api/test/account-password.test.js
git commit -m "feat(api): sign in with a password, and be able to sign out again"
```

---

## Task 8: Move the admin and super tests onto account sessions

Mostly no source changes — the exception is a small bridge in `requireSuper`, forced by
a gap this plan didn't originally see (below). Both the old and new credentials work at
this point, which is what makes the rest of this safe and what makes Task 10 cheap.

**`admin-auth.test.js` is not migrated.** All four of its tests exercise the passcode
mechanism itself — `POST /api/admin/login` and `/logout` directly, plus a 403-without-
a-cookie case that depends on the `DEFAULT_SWEEP_ID` fallback — not a helper used to
reach something else. There is no operator-session analog for "wrong passcode" or
"logout"; those are already covered for the new mechanism elsewhere
(`account-password.test.js`). Migrating it would mean asserting on the passcode route
regardless or deleting assertions — this file's fate is Task 10 deleting it wholesale,
not a Task 8 migration.

**Files (test only, except the bridge in Step 4):**
- Modify: `api/test/admin-open-bets.test.js`, `admin-people.test.js`, `admin-photos.test.js`, `admin-settle-stale.test.js`, `wagering-gate.test.js` — swap the `POST /api/admin/login` helper for `ownerHeaders(db)`. (Five files, not six — `admin-auth.test.js` is excluded, see above.)
- Modify: `api/src/sweeps/auth.js` — make `requireSuper` accept an operator account session as well as the legacy cookie (Step 4).
- Modify: `api/test/sweeps-admin.test.js`, `sweeps-isolation.test.js`, `correct-fixture.test.js` — swap `superCookie()` for an operator account session.

- [ ] **Step 1: Migrate one file and prove the pattern**

In `api/test/admin-open-bets.test.js`, replace the passcode-login helper with:

```js
import { memberCookie, ownerHeaders } from './helpers/session.js'
// …and at each call site, replace the passcode-minted cookie with
// `{ cookie: await memberCookie(app), ...(await ownerHeaders(db)) }`.
```

Run it:

```bash
cd api && npx vitest run test/admin-open-bets.test.js
```

Expected: PASS.

- [ ] **Step 2: Migrate the remaining four passcode files, running each**

```bash
cd api && npx vitest run test/admin-people.test.js test/admin-photos.test.js test/admin-settle-stale.test.js test/wagering-gate.test.js
```

`admin-photos.test.js` has three separate login blocks — all three must move.
Leave `wagering-gate.test.js`'s lapsed-sweep assertions untouched; they pin behaviour Task 10 must not change.

- [ ] **Step 3: Commit the passcode half**

```bash
git add api/test
git commit -m "test(api): admin tests authenticate as the owner, not a passcode"
```

- [ ] **Step 4: Make `requireSuper` transitional, and test the bridge**

There is no free path for the three super files the way there was for the admin ones.
`sweepResolver` already merges account ownership into `req.role` (Task 3), which is
*why* the admin routes tolerate either credential today — but `requireSuper` is a
wholly separate guard that only ever checks `req.cookies[SUPER_COOKIE]`. It has no path
to `req.account` at all, so an operator's `x-account-token` sent alone to any
`/api/super/*` route 401s right now. Build the same additive bridge Task 3 built for
the admin path, in `api/src/sweeps/auth.js`:

```js
import { requireOperator } from '../accounts/auth.js'

/** Transitional: the legacy super cookie OR an operator account session. The cookie
 *  half is deleted in Task 10, at which point this becomes requireOperator outright. */
export function requireSuper(app) {
  const operator = requireOperator(app)
  return async (req, reply) => {
    const raw = req.cookies?.[SUPER_COOKIE]
    if (raw) {
      const un = app.unsignCookie(raw)
      if (un.valid && un.value === 'ok') return
    }
    return operator(req, reply)
  }
}
```

No import cycle: `api/src/sweeps/auth.js` has no imports today, and `api/src/accounts/auth.js` never references `sweeps/`.

Add HTTP-level coverage for the bridge itself (this also closes a Task 5 review finding
that deferred operator-role coverage to "later") — e.g. in `api/test/operator-role.test.js`,
which already imports `ownerHeaders` unused: an operator account reaching a super route
with no cookie (200), a non-operator account on the same route (403), no credentials at
all (401), and the legacy cookie still working (200) — that last one is what keeps every
unmigrated super-route call site green until Task 10.

```bash
cd api && npx vitest run test/operator-role.test.js
cd api && npx vitest run   # whole suite — confirm nothing else regresses
git add api/src/sweeps/auth.js api/test/operator-role.test.js
git commit -m "feat(api): a super route now also accepts an operator, not just the cookie"
```

- [ ] **Step 5: Migrate the three super files**

Replace `superCookie()` with an operator session. In `api/test/sweeps-admin.test.js`, the memoized helper 11 tests run through becomes:

```js
import { ownerHeaders } from './helpers/session.js'
import { account } from '../src/db/schema.js'

let _op
async function operator() {
  if (_op) return _op
  await db.insert(account).values({
    id: 'ac_op_admin', email: 'op-admin@example.test', role: 'operator',
  }).onConflictDoNothing()
  _op = await ownerHeaders(db, 'ac_op_admin')
  return _op
}
```

`api/test/sweeps-admin.test.js` has one test — `'super session requires the right
token'` — that, like `admin-auth.test.js`, exercises `POST /api/super/session` itself
rather than using it as a helper. Leave it on the cookie; it is Task 10 fallout too.

`sweeps-isolation.test.js` (not `sweeps-super.test.js`, which does not exist — the only
other file using `superCookie()`) needs the same swap for its one call site, which
creates a throwaway sweep for the cross-sweep isolation check.

Now that the bridge from Step 4 is live, `correct-fixture.test.js` can carry the
assertion the super cookie could never express **as a real test, not a stub**:

```js
test('a signed-in non-operator account cannot correct a score', async () => {
  const res = await app.inject({
    method: 'POST', url: '/api/super/fixtures/fx_1/correct',
    headers: await ownerHeaders(db),
    payload: { score1: 1, score2: 0, reason: 'test' },
  })
  expect(res.statusCode).toBe(403)
})
```

- [ ] **Step 6: Run the whole suite and commit**

```bash
cd api && npx vitest run
git add api/test
git commit -m "test(api): operator tests authenticate as an operator account"
```

---

## Task 9: Re-home the owner capabilities the deletions would destroy

`PATCH /api/super/sweeps/:id` is today the **only** route that can set `scoringRule` or `coOwners` — a group admin cannot rename their own sweep. Deleting the super routes without this is the one silent feature loss in the whole change.

**Read the spec's warning (§6.3):** narrowing `EXEMPT_PREFIX` gates nothing here. `readOnlyGate` returns at `!req.sweep?.accountId` before it reads the exemption list, and an account-console request carries no sweep cookie — or carries one for a *different* sweep. Call `sweepLiveNow` inside the handler.

**Files:**
- Modify: `api/src/routes/account.js`, `api/src/sweeps/read-only.js:5`
- Test: `api/test/account-sweeps-owner.test.js` (create)

**Interfaces:**
- Produces: `PATCH /api/account/sweeps/:id`, `POST /api/account/sweeps/:id/rotate`.

- [ ] **Step 1: Write the failing test**

Create `api/test/account-sweeps-owner.test.js`:

```js
import { expect, test, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { ownerHeaders } from './helpers/session.js'
import { account, sweep } from '../src/db/schema.js'

const { pool, db } = openTestDb()
const app = buildApp(db, { sessionSecret: 'test-secret', platformHost: 'platform.test' })
beforeAll(async () => {
  await app.ready()
  await db.insert(account).values({
    id: 'ac_lapsed', email: 'lapsed@example.test', subscriptionStatus: 'canceled',
  }).onConflictDoNothing()
  await db.insert(sweep).values({
    id: 'sw_lapsed', name: 'Lapsed', kind: 'token', competitionId: 'apifootball:1:2026',
    accountId: 'ac_lapsed', memberToken: 'lapsedmembertoken0000',
  }).onConflictDoNothing()
})
afterAll(async () => { await app.close(); await pool.end() })

test('the owner can rename their own sweep', async () => {
  const res = await app.inject({
    method: 'PATCH', url: '/api/account/sweeps/default',
    headers: await ownerHeaders(db), payload: { name: 'Renamed' },
  })
  expect(res.statusCode).toBe(200)
  const [row] = await db.select().from(sweep).where(eq(sweep.id, 'default'))
  expect(row.name).toBe('Renamed')
})

test('a stranger gets 404, not 403 — the id is not an existence oracle', async () => {
  const res = await app.inject({
    method: 'PATCH', url: '/api/account/sweeps/sw_lapsed',
    headers: await ownerHeaders(db), payload: { name: 'Nope' },
  })
  expect(res.statusCode).toBe(404)
})

// Pins the IN-HANDLER liveness check. The global gate cannot do this: it returns at
// !req.sweep?.accountId (sweeps/read-only.js:11) and this request carries no sweep cookie.
test('a lapsed owner cannot mutate their sweep', async () => {
  const res = await app.inject({
    method: 'PATCH', url: '/api/account/sweeps/sw_lapsed',
    headers: await ownerHeaders(db, 'ac_lapsed'), payload: { name: 'Nope' },
  })
  expect(res.statusCode).toBe(403)
  expect(res.json().error).toBe('sweep_readonly')
})

test('rotating the member link kills the old token and mints a working one', async () => {
  const res = await app.inject({
    method: 'POST', url: '/api/account/sweeps/default/rotate', headers: await ownerHeaders(db),
  })
  expect(res.statusCode).toBe(200)
  const old = await app.inject({
    method: 'POST', url: '/api/session', headers: { host: 'platform.test' },
    payload: { token: 'seedmembertoken000000' },
  })
  expect(old.statusCode).toBe(404)
  // The old token dying is only half the promise — prove the new one actually works,
  // or a rotate that returns a dead link locks the owner out with no fallback.
  const fresh = res.json().memberLink.split('/g/')[1]
  const ok = await app.inject({
    method: 'POST', url: '/api/session', headers: { host: 'platform.test' },
    payload: { token: fresh },
  })
  expect(ok.statusCode).toBe(200)
  expect(ok.json().sweepId).toBe('default')
})
```

> **Note for the executor:** the rotate test invalidates the token `memberCookie()` memoizes. Run this file's rotate test last, or re-seed. If other files break, that is the seed token changing — restore it in an `afterAll`.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd api && npx vitest run test/account-sweeps-owner.test.js
```

Expected: 404 on every route — neither exists.

- [ ] **Step 3: Implement**

In `api/src/routes/account.js`, import the liveness rule and the patch schema:

```js
import { sweepLiveNow } from '../accounts/billing.js'
```

```js
const patchSweepBody = {
  type: 'object', additionalProperties: false, minProperties: 1,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 80 },
    scoringRule: { type: 'string', minLength: 1, maxLength: 40 },
    coOwners: { type: 'string', minLength: 1, maxLength: 40 },
  },
}
```

```js
  /** The owner's own sweep. 404 for a sweep they do not own — never 403, so the id
   *  cannot be probed to learn which sweeps exist. */
  async function ownedSweep(req, reply) {
    const [row] = await app.db.select().from(sweep)
      .where(and(eq(sweep.id, req.params.id), eq(sweep.accountId, req.account.id)))
    if (!row) { reply.code(404).send({ error: 'not_found' }); return null }
    // The global read-only gate cannot cover this route: it keys on the cookie-resolved
    // sweep (sweeps/read-only.js:11) and the account console sends no sweep cookie.
    if (!(await sweepLiveNow(app, row))) { reply.code(403).send({ error: 'sweep_readonly' }); return null }
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

  app.post('/api/account/sweeps/:id/rotate', { preHandler: accountGuard }, async (req, reply) => {
    const row = await ownedSweep(req, reply)
    if (!row) return
    const memberToken = newToken()
    await app.db.update(sweep).set({ memberToken }).where(eq(sweep.id, row.id))
    const [next] = await app.db.select().from(sweep).where(eq(sweep.id, row.id))
    return links(app, next)
  })
```

- [ ] **Step 4: Narrow the read-only exemption**

In `api/src/sweeps/read-only.js:5`, replace the blanket prefix:

```js
// Only what must work while lapsed: signing in, paying, and reading. The prefix used to
// be a blanket '/api/account', which would have exempted the owner sweep-editing routes
// from the very gate that exists to stop them. This list is defence in depth — the real
// check lives inside those handlers (sweepLiveNow), because the gate returns at
// !req.sweep?.accountId below and an account-console call resolves no sweep.
const EXEMPT_PREFIX = ['/api/account/login', '/api/account/session', '/api/account/password',
  '/api/account/billing', '/api/account/sweeps', '/api/super', '/api/stripe']
```

- [ ] **Step 5: Run the new test, then the whole suite**

```bash
cd api && npx vitest run test/account-sweeps-owner.test.js
cd api && npx vitest run
```

- [ ] **Step 6: Commit**

```bash
git add api/src/routes/account.js api/src/sweeps/read-only.js api/test/account-sweeps-owner.test.js
git commit -m "feat(api): an owner can finally rename and re-link their own sweep"
```

---

## Task 10: The deletion

Everything now authenticates the new way, so this removes code without removing capability.

**Delete:** the `onPlatform` fork and the `DEFAULT_SWEEP_ID` fallback in `api/src/sweeps/resolve.js`; `api/src/sweeps/constants.js`; `/api/admin/login` and `/api/admin/logout`; `app.adminHash`; the two admin entries in `read-only.js` `EXEMPT_EXACT`; `api/src/seed/admin-hash.js` and its Makefile target; `POST /api/super/session`; `SUPER_COOKIE`; `app.superToken`; `PLATFORM_HOST` and `app.platformHost`.

**Note on `requireSuper`:** Task 8 already made it transitional — legacy cookie OR `requireOperator`, cookie checked first (`api/src/sweeps/auth.js`). This task deletes the cookie-checking branch from inside `requireSuper`, it does not replace the guard reference at each route. Once the branch is gone, `requireSuper(app)` reduces to exactly `requireOperator(app)`; either collapse the function to that one line or delete it and point `superGuard` straight at `requireOperator(app)` — same outcome, whichever reads cleaner in the diff.

**Do not delete:** the remaining `/api/super/*` routes. They keep their paths and move onto `requireOperator` — including `POST /api/super/sweeps/:id/unarchive`, which is the **only** unarchive anywhere. Losing it makes archive irreversible for everyone.

**Files:** `api/src/sweeps/resolve.js`, `api/src/sweeps/constants.js` (delete), `api/src/routes/admin.js`, `api/src/routes/sweeps.js`, `api/src/sweeps/auth.js`, `api/src/app.js`, `api/src/sweeps/read-only.js`, `api/test/admin-auth.test.js` (delete), `Makefile`, `.env.example`, `docker/.env.docker.example`

- [ ] **Step 1: Write the tests that pin the new absence**

Add to `api/test/owner-admin.test.js`:

```js
test('an anonymous cookieless request is 401, not a member of anything', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/bootstrap' })
  expect(res.statusCode).toBe(401)
})

test('the passcode login is gone', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { passcode: '2026' } })
  expect(res.statusCode).toBe(404)
})
```

(The non-operator-403 assertion in `correct-fixture.test.js` is already live as of Task 8's `requireSuper` bridge — nothing to convert here.)

- [ ] **Step 2: Run and watch them fail**

```bash
cd api && npx vitest run test/owner-admin.test.js
```

Expected: the anonymous request currently 200s as a member of the default sweep; the passcode login 200s.

- [ ] **Step 3: Simplify the resolver**

`api/src/sweeps/resolve.js` becomes, in full:

```js
import { and, eq, gt } from 'drizzle-orm'
import { account, accountSession, sweep } from '../db/schema.js'
import { readSweepList } from './auth.js'

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
 *  says which one this request means, and ownership decides the role. */
export function sweepResolver(app) {
  return async (req) => {
    req.sweep = null
    req.role = null
    req.account = await accountFor(app, req)

    const list = readSweepList(app, req)
    const want = req.headers['x-sweep-id'] || req.query?.sweep
    const session = list && (want ? list.find((e) => e.sweepId === want) : list[0])
    if (!session) return

    const [row] = await app.db.select().from(sweep).where(eq(sweep.id, session.sweepId))
    if (!row || row.archivedAt) return
    req.sweep = row
    req.role = req.account?.id && req.account.id === row.accountId ? 'admin' : 'member'
  }
}
```

- [ ] **Step 4: Delete the passcode and the super session**

Remove `/api/admin/login` and `/api/admin/logout` from `api/src/routes/admin.js` along with their `verifyPasscode` and `DEFAULT_SWEEP_ID` imports, and change its guard to the owner check. Also delete `admin-auth.test.js` wholesale — Task 8 deliberately left it untouched because all four of its tests exercise exactly this passcode mechanism, and it has no operator-session analog. Remove `POST /api/super/session` and `SUPER_COOKIE` from `api/src/routes/sweeps.js`. In `api/src/sweeps/auth.js`, `requireSuper` is already transitional (Task 8) — strip its cookie-checking branch (not the whole function) so it collapses to `requireOperator(app)`; `superGuard` can keep calling `requireSuper(app)` unchanged, or be pointed straight at `requireOperator(app)` if `requireSuper` is deleted instead. Remove `app.adminHash`, `app.superToken`, `app.platformHost` and the `PLATFORM_HOST` guard from `api/src/app.js`. Delete `api/src/sweeps/constants.js` and `api/src/seed/admin-hash.js`. Drop the `admin:hash` script and Makefile target, and the `ADMIN_PASSCODE` / `SUPER_ADMIN_TOKEN` / `PLATFORM_HOST` lines from both env examples.

- [ ] **Step 5: Add the audit calls**

In `api/src/corrections.js`, record the acting account and the affected sweeps beside the existing `sync_log` write:

```js
  const affected = await db.selectDistinct({ id: sweep.id }).from(sweep)
    .where(eq(sweep.competitionId, competitionId))
  await recordOperatorAction(db, {
    actorId, action: 'correct_fixture', target: fixtureId, sweepIds: affected.map((s) => s.id),
  })
```

- [ ] **Step 6: Strip member tokens from the operator listing**

In `api/src/routes/sweeps.js`, `GET /api/super/sweeps` must stop spreading `links(app, r)`. A live member token in the operator console *is* the ability to open any sweep as a member, un-audited. Return `{ id, name, kind, archivedAt, createdAt, accountId, competitionId }` and no `stripeCustomerId`.

- [ ] **Step 7: Run the whole suite**

```bash
cd api && npx vitest run
```

Fix fallout in tests that asserted the deleted behaviour. Every remaining failure should be a test that named a deleted route or expected anonymous access.

- [ ] **Step 8: Commit**

```bash
git add -A api Makefile .env.example docker/.env.docker.example
git commit -m "refactor(api): one way in — the passcode, the super token and the default sweep are gone"
```

---

## Task 11: Drop `admin_token`, stop reading the cookie role

These three edits cannot be split from the column drop: dropping the column while `POST /api/session` still queries `eq(sweep.adminToken, token)` breaks every join.

**Files:** `api/src/db/schema.js:8`, `api/src/routes/sweeps.js:48-51,62-65`, `api/src/routes/account.js:131,133,138`, `api/src/sweeps/auth.js`

- [ ] **Step 1: Write the failing tests**

Add to `api/test/sweeps-session.test.js`:

```js
test('a former admin token no longer opens anything', async () => {
  const res = await app2.inject({
    method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token: adminTok },
  })
  expect(res.statusCode).toBe(404)
})

// Cookies minted before this change are `id:role` pairs. Dropping the role must not
// sign every live session out on deploy.
test('a legacy id:role cookie value still parses to ids', () => {
  expect(parseSweepCookie('sw_a:member,sw_b')).toEqual(['sw_a', 'sw_b'])
})
```

- [ ] **Step 2: Run and watch them fail**

```bash
cd api && npx vitest run test/sweeps-session.test.js
```

- [ ] **Step 3: Implement**

`links()` returns `{ memberLink }` only. `POST /api/session` looks up by `memberToken` alone and returns `{ sweepId }`. `api/src/routes/account.js` stops minting and returning `adminToken`. In `api/src/sweeps/auth.js`, the cookie becomes a bare id list:

```js
export function signSweepCookie(ids) { return ids.join(',') }

/** Tolerates the legacy `id:role` form: a cookie minted before roles left the cookie
 *  still parses to its ids, so a deploy does not sign everybody out. */
export function parseSweepCookie(value) {
  if (typeof value !== 'string') return null
  const out = value.split(',').map((p) => p.split(':')[0]).filter(Boolean)
  return out.length ? out : null
}

export function withSweep(list, sweepId) {
  return [sweepId, ...(list ?? []).filter((id) => id !== sweepId)].slice(0, MAX_SWEEPS)
}
```

Update `resolve.js` accordingly — entries are now ids, not objects.

- [ ] **Step 4: Delete the column**

Remove `adminToken` from `api/src/db/schema.js:8`, then:

```bash
cd api && npx drizzle-kit generate
```

- [ ] **Step 5: Run the suite AND the migration against a real database**

```bash
cd api && npx vitest run
npm run db:migrate -w api
```

`global-setup.js` migrates an *empty* database, so a green suite is not evidence the migration runs on the dev DB. Run it.

- [ ] **Step 6: Commit**

```bash
git add -A api
git commit -m "refactor(api): the admin token is gone, and so is the role in the cookie"
```

---

## Task 12–17: Web

Six commits, each independently green via `npm test -w web`. They may begin once Task 3 has landed.

- [ ] **W1 — `web/src/api/client.js`:** attach `x-account-token` to the ~12 `/api/admin/*` helpers **only**. Do *not* fold it into `sweepHeaders()`: that makes a 90-day credential ambient across the member SPA, so on a shared browser whoever opens the sweep next silently holds admin over every sweep the owner owns. Same commit: add `/api/admin` and `/api/super` to `sw-routes.js` `excludePaths`.
- [ ] **W2 — `web/src/lib/joinLink.js`:** an old admin link degrades to its member token. Test first: `parseJoinLink('/g/mem/admin/adm')` yields `mem`. Without this the holder lands on the marketing page with a secret-shaped token still in the address bar and `Referer`.
- [ ] **W3 — `web/src/SweepProvider.jsx`:** in the 401 branch, if an account token exists and the wanted sweep is in `getAccountSweeps()`, navigate to that row's member link — *before* the stored-token path. This is what stops a new phone telling the sweep's owner to go find their invite link.
- [ ] **W4 — `web/src/AccountRoot.jsx`:** email + password on the `Entry` screen; "Email me a link instead" keeps today's flow as the recovery path; after a magic-link redeem on an account with no password, a dismissible "Set a password" card.
- [ ] **W5 — `web/src/AccountRoot.jsx`:** sign out (this device) and sign out everywhere, wired to the two DELETE routes.
- [ ] **W6 — `web/src/screens-super.jsx`:** the super console signs in as an operator account instead of a token in the URL, and stops rendering member links. No test can catch the last part — walk it in a browser.

---

## Self-Review

**Spec coverage.** §2 → Task 4. §3 → Tasks 3, 10. §4 → Tasks 6, 7. §5 → Tasks 5, 10. §6.1 → W2. §6.2 → Task 11. §6.3 → Task 9. §6.4 → W3. §6.5 → W1. §7 → task order. §8 non-goals → not built. §9 testing → each task's tests.

**Gap found and closed:** the spec's §7 order table omitted password authentication entirely, though §4 specifies it. Tasks 6 and 7 place it after the mail transport, since the change-notification mail depends on it.

**Type consistency:** `ownerHeaders(db, accountId?)` and `memberCookie(app)` are used with those signatures in Tasks 3, 8, 9. `recordOperatorAction(db, {actorId, action, target, sweepIds})` is defined in Task 5 and called in Task 10. `sweepLiveNow(app, row)` is the existing export. `parseSweepCookie` returns objects until Task 11 and ids after it — Task 11 changes `resolve.js` in the same commit.

**Known risk:** Task 9's rotate test invalidates the memoized seed member token. Flagged inline.
