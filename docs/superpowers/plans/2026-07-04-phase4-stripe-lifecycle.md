# Phase 4 — Stripe Subscription + Lifecycle Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An account adds payment via Stripe Checkout (test mode); sweeps start on a 14-day cardless trial; subscription quantity tracks live sweeps on provision/archive; trial end or payment lapse flips sweeps read-only and drops their competitions from polling (unless shared); renewal restores everything.

**Architecture:** Thin billing shim over the P3 account layer. Stripe state is mirrored onto `account` by a signature-verified webhook; sweep liveness is DERIVED at read time by one shared predicate (`accounts/billing.js`) consumed by both the worker (`activeCompetitions`) and the wire (read-only gate). Provision/archive run in a per-account `FOR UPDATE` transaction — the P3 cap TOCTOU dies by design.

**Tech Stack:** Node 22 ESM, Fastify 5, Drizzle 0.36, Postgres (testcontainers), Vitest, official `stripe` SDK v19.

**Design doc:** `docs/superpowers/specs/2026-07-04-phase4-stripe-lifecycle-design.md`.

## Global Constraints

- **Stripe TEST MODE ONLY.** `sk_test` keys only; a `sk_live` key outside production must refuse to boot (Task 3). Secrets live in `.env`, NEVER in a commit. No test may touch the network — fake stripe object injected via `buildApp` opts; webhook signature tests use the real SDK's offline `generateTestHeaderString`.
- **Never** push to the `upstream` remote. Push to `origin` after each task.
- **Never** touch the shared `sweep` Postgres database. Before any live migration/seed/CLI: `psql "$(grep '^DATABASE_URL=' .env | cut -d= -f2-)" -tc 'SELECT current_database()'` must print `sweep_platform`.
- **Never** run the inherited `Makefile`/`infra/` deploy targets.
- **Web untouched:** the web suite (436 tests) passes **unmodified** (owner decision c).
- **Feed budget:** no new live provider calls anywhere in this phase; tests use recorded providers.
- Baseline at start: api **368** / web **436** green (P4 prereqs `473ffb8..162f1c7` in). If red before you change anything: STOP and report.
- Strict TDD. Conventional Commits, one commit per task minimum. Pre-commit hook runs web suite + build; pre-push runs everything — NEVER `--no-verify`.
- Run api tests **from `api/`**: `npx vitest run test/<file>` (repo root loses the testcontainers env). Full suites: `npm run test` (repo root) and `npm test -w web`.
- Schema changes: edit `api/src/db/schema.js`, then `cd api && npx drizzle-kit generate`, commit SQL + meta together.
- Ops sweeps (`sweep.accountId IS NULL` — the WC default + super-created NBA sweep) are NEVER gated or billed (owner decision a).

---

### Task 1: Schema — account billing columns + billing_event + trial backfill

**Files:**
- Modify: `api/src/db/schema.js` (extend `account`; append `billingEvent` after `catalogLeague`)
- Create (generated): `api/migrations/000N_*.sql` + meta — **then hand-append the backfill UPDATE to the same SQL file**
- Test: `api/test/billing-schema.test.js`

**Interfaces:**
- Produces (drizzle exports from `../src/db/schema.js`):
  - `account` gains nullable columns: `stripeCustomerId` (`stripe_customer_id` text), `stripeSubscriptionId` (`stripe_subscription_id` text), `stripeSubscriptionItemId` (`stripe_subscription_item_id` text), `subscriptionStatus` (`subscription_status` text — raw Stripe status mirror; **null = never subscribed**), `trialEndsAt` (`trial_ends_at` timestamptz), `trialReminderSentAt` (`trial_reminder_sent_at` timestamptz).
  - `billingEvent` → table `billing_event`: `id` serial pk, `stripeEventId` text notNull **unique**, `type` text notNull, `accountId` text nullable, `summary` jsonb nullable, `createdAt` timestamptz default now.

- [ ] **Step 1: Write the failing test**

```js
// api/test/billing-schema.test.js
import { test, expect, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { account, billingEvent } from '../src/db/schema.js'

const { pool, db } = openTestDb()

afterAll(async () => {
  await db.delete(billingEvent).where(eq(billingEvent.stripeEventId, 'evt_schema_test'))
  await db.delete(account).where(eq(account.id, 'ac_billing_schema'))
  await pool.end()
})

test('account billing columns and billing_event round-trip', async () => {
  await db.insert(account).values({
    id: 'ac_billing_schema', email: 'billing-schema@x.test',
    stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', stripeSubscriptionItemId: 'si_1',
    subscriptionStatus: 'active', trialEndsAt: new Date('2026-08-01T00:00:00Z'),
  })
  const [a] = await db.select().from(account).where(eq(account.id, 'ac_billing_schema'))
  expect(a.subscriptionStatus).toBe('active')
  expect(a.trialReminderSentAt).toBeNull()
  expect(a.trialEndsAt).toBeInstanceOf(Date)

  await db.insert(billingEvent).values({ stripeEventId: 'evt_schema_test', type: 'noop', summary: { ok: true } })
  const [e] = await db.select().from(billingEvent).where(eq(billingEvent.stripeEventId, 'evt_schema_test'))
  expect(e.type).toBe('noop')
  expect(e.accountId).toBeNull()
  // uniqueness = webhook idempotency backbone
  await expect(db.insert(billingEvent).values({ stripeEventId: 'evt_schema_test', type: 'noop' })).rejects.toThrow()
})
```

- [ ] **Step 2: Run it** — `cd api && npx vitest run test/billing-schema.test.js` — Expected: FAIL (`billingEvent` not exported / columns unknown).

- [ ] **Step 3: Implement** — in `api/src/db/schema.js`, extend `account`:

```js
export const account = pgTable('account', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // P4 billing — Stripe state mirror (webhook-written). null subscriptionStatus = never subscribed.
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  stripeSubscriptionItemId: text('stripe_subscription_item_id'),
  subscriptionStatus: text('subscription_status'),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),      // one cardless trial clock per account, set at first provision
  trialReminderSentAt: timestamp('trial_reminder_sent_at', { withTimezone: true }),
})
```

  and append after `catalogLeague` (add `serial` to the `drizzle-orm/pg-core` import if not already there):

```js
export const billingEvent = pgTable('billing_event', {
  id: serial('id').primaryKey(),
  stripeEventId: text('stripe_event_id').notNull().unique(), // idempotency: duplicate webhook delivery → conflict → no-op
  type: text('type').notNull(),
  accountId: text('account_id'),
  summary: jsonb('summary'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

- [ ] **Step 4: Generate the migration** — `cd api && npx drizzle-kit generate` — read the new `api/migrations/000N_*.sql`, sanity-check columns. Then **append to that same SQL file** (existing owned sweeps must not lapse the moment the predicate lands — their accounts never had a trial clock):

```sql
--> statement-breakpoint
UPDATE "account" SET "trial_ends_at" = now() + interval '14 days'
WHERE "trial_ends_at" IS NULL AND "subscription_status" IS NULL
  AND EXISTS (SELECT 1 FROM "sweep" s WHERE s."account_id" = "account"."id" AND s."archived_at" IS NULL);
```

- [ ] **Step 5: Run** — the test file, then full api suite from `api/`: `npx vitest run` (or repo root `npm run test`). Expected: PASS.
- [ ] **Step 6: Commit** — `git add api/src/db/schema.js api/migrations api/test/billing-schema.test.js && git commit -m "feat(db): account billing columns + billing_event audit table" && git push origin main`

---

### Task 2: accounts/billing.js — liveness predicate + helpers

**Files:**
- Create: `api/src/accounts/billing.js`
- Test: `api/test/billing-liveness.test.js`

**Interfaces:**
- Produces (exact exports later tasks import from `../accounts/billing.js` / `../src/accounts/billing.js`):
  - `TRIAL_MS` = 14 days in ms. `GOOD_STANDING` = `['active', 'past_due']` (past_due = Stripe dunning grace; unpaid/canceled = lapsed).
  - `sweepIsLive(sweepRow, accountRow, now = new Date())` → boolean (pure).
  - `sweepLiveNow(app, sweepRow)` → Promise<boolean> — fetches the owning account when needed; unowned → true.
  - `liveSweepCount(dbOrTx, accountId)` → Promise<number> — count of UNARCHIVED sweeps (the billable count; account-level lapse doesn't change what renewing would bill).
  - `syncQuantity(stripe, accountRow, quantity)` → Promise — no-op unless `stripeSubscriptionId` AND `stripeSubscriptionItemId` present; calls `stripe.subscriptions.update(subId, { items: [{ id: itemId, quantity }], proration_behavior: 'none' })`.
  - `sendTrialReminders(db, sendMail?, now?)` → Task 10 adds this; not here (YAGNI until its task).
- Consumes: `account`, `sweep` from schema (Task 1).

- [ ] **Step 1: Write the failing test**

```js
// api/test/billing-liveness.test.js
import { test, expect, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { account, sweep, competition } from '../src/db/schema.js'
import { sweepIsLive, liveSweepCount, syncQuantity, TRIAL_MS, GOOD_STANDING } from '../src/accounts/billing.js'

const { pool, db } = openTestDb()
const NOW = new Date('2026-07-04T12:00:00Z')
const past = new Date(NOW.getTime() - 1000)
const future = new Date(NOW.getTime() + 1000)

afterAll(async () => {
  await db.delete(sweep).where(eq(sweep.accountId, 'ac_live'))
  await db.delete(competition).where(eq(competition.id, 'apibasketball:12:liveness'))
  await db.delete(account).where(eq(account.id, 'ac_live'))
  await pool.end()
})

test('sweepIsLive: ops sweeps always; trial/paid/lapse matrix', () => {
  const s = { archivedAt: null, accountId: 'ac_x' }
  expect(sweepIsLive({ ...s, accountId: null }, null, NOW)).toBe(true)              // ops sweep
  expect(sweepIsLive({ ...s, archivedAt: past, accountId: null }, null, NOW)).toBe(false) // archived beats everything
  expect(sweepIsLive(s, { subscriptionStatus: 'active' }, NOW)).toBe(true)
  expect(sweepIsLive(s, { subscriptionStatus: 'past_due' }, NOW)).toBe(true)        // dunning grace
  expect(sweepIsLive(s, { subscriptionStatus: 'unpaid' }, NOW)).toBe(false)
  expect(sweepIsLive(s, { subscriptionStatus: 'canceled', trialEndsAt: future }, NOW)).toBe(false) // trial is pre-card only
  expect(sweepIsLive(s, { subscriptionStatus: null, trialEndsAt: future }, NOW)).toBe(true)  // in trial
  expect(sweepIsLive(s, { subscriptionStatus: null, trialEndsAt: past }, NOW)).toBe(false)   // trial expired
  expect(sweepIsLive(s, { subscriptionStatus: null, trialEndsAt: null }, NOW)).toBe(false)   // no clock, never subscribed
  expect(sweepIsLive(s, null, NOW)).toBe(false)                                     // orphaned accountId
  expect(TRIAL_MS).toBe(14 * 24 * 3600_000)
  expect(GOOD_STANDING).toEqual(['active', 'past_due'])
})

test('liveSweepCount counts unarchived sweeps; syncQuantity no-ops without subscription ids', async () => {
  await db.insert(account).values({ id: 'ac_live', email: 'live@x.test' })
  await db.insert(competition).values({ id: 'apibasketball:12:liveness', provider: 'apibasketball', sport: 'basketball', leagueId: '12', season: 'liveness', format: 'league', name: 'L' }).onConflictDoNothing()
  await db.insert(sweep).values([
    { id: 'sw_live_1', name: 'A', kind: 'token', memberToken: 'lm1', adminToken: 'la1', competitionId: 'apibasketball:12:liveness', accountId: 'ac_live' },
    { id: 'sw_live_2', name: 'B', kind: 'token', memberToken: 'lm2', adminToken: 'la2', competitionId: 'apibasketball:12:liveness', accountId: 'ac_live', archivedAt: past },
  ])
  expect(await liveSweepCount(db, 'ac_live')).toBe(1)

  const calls = []
  const stripe = { subscriptions: { update: async (id, p) => calls.push({ id, ...p }) } }
  await syncQuantity(stripe, { stripeSubscriptionId: null, stripeSubscriptionItemId: null }, 3)
  expect(calls).toHaveLength(0) // never subscribed → nothing to sync
  await syncQuantity(stripe, { stripeSubscriptionId: 'sub_9', stripeSubscriptionItemId: 'si_9' }, 3)
  expect(calls).toEqual([{ id: 'sub_9', items: [{ id: 'si_9', quantity: 3 }], proration_behavior: 'none' }])
})
```

- [ ] **Step 2: Run it** — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// api/src/accounts/billing.js
import { and, eq, isNull } from 'drizzle-orm'
import { account, sweep } from '../db/schema.js'

export const TRIAL_MS = 14 * 24 * 3600_000 // one cardless trial per account, started at first provision
export const GOOD_STANDING = ['active', 'past_due'] // past_due = Stripe dunning grace; unpaid/canceled = lapsed

/** THE liveness rule (design §3). Derived, never materialized:
 *  live = not archived AND (ops-owned OR paid-in-good-standing OR never-subscribed-and-in-trial). */
export function sweepIsLive(sweepRow, accountRow, now = new Date()) {
  if (sweepRow.archivedAt) return false
  if (!sweepRow.accountId) return true // ops sweep (WC default, super-created) — exempt by owner decision
  if (!accountRow) return false
  if (GOOD_STANDING.includes(accountRow.subscriptionStatus)) return true
  return !accountRow.subscriptionStatus && !!accountRow.trialEndsAt && accountRow.trialEndsAt > now
}

/** Request-time convenience: resolve the owning account (if any) and apply the rule. */
export async function sweepLiveNow(app, sweepRow) {
  if (!sweepRow?.accountId) return true
  const [acct] = await app.db.select().from(account).where(eq(account.id, sweepRow.accountId))
  return sweepIsLive(sweepRow, acct)
}

/** Billable sweeps = unarchived. (Lapse doesn't shrink what renewing would bill.) */
export async function liveSweepCount(db, accountId) {
  const rows = await db.select({ id: sweep.id }).from(sweep)
    .where(and(eq(sweep.accountId, accountId), isNull(sweep.archivedAt)))
  return rows.length
}

/** Re-assert subscription quantity as a COUNT (not an increment) — a missed sync self-heals
 *  at the next change. proration 'none': no penny prorations at $5. No-op pre-subscription. */
export async function syncQuantity(stripe, accountRow, quantity) {
  if (!accountRow.stripeSubscriptionId || !accountRow.stripeSubscriptionItemId) return
  await stripe.subscriptions.update(accountRow.stripeSubscriptionId, {
    items: [{ id: accountRow.stripeSubscriptionItemId, quantity }],
    proration_behavior: 'none',
  })
}
```

- [ ] **Step 4: Run** — the file, then full api suite. Expected: PASS.
- [ ] **Step 5: Commit** — `git add api/src/accounts/billing.js api/test/billing-liveness.test.js && git commit -m "feat(api): sweep liveness predicate + quantity sync helpers" && git push origin main`

---

### Task 3: stripe dependency, app.stripe seam, sk_live boot guard, fake-stripe test helper

**Files:**
- Modify: `api/package.json` (+ lockfile) via `npm install stripe -w api` (run from repo root)
- Modify: `api/src/app.js` (decorations)
- Create: `api/test/helpers/fake-stripe.js`
- Test: `api/test/stripe-seam.test.js`

**Interfaces:**
- Produces:
  - `app.stripe` — `opts.stripe ?? (key ? new Stripe(key) : null)` where `key = opts.stripeKey ?? process.env.STRIPE_SECRET_KEY ?? ''`. **Null when unconfigured** — billing surfaces answer 503 `{error:'billing_unconfigured'}` (Tasks 7/8).
  - `app.stripeWebhookSecret` — `opts.stripeWebhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET ?? ''`.
  - `app.stripePriceId` — `opts.stripePriceId ?? process.env.STRIPE_PRICE_ID ?? ''`.
  - **Boot guard:** `buildApp` throws `live Stripe key outside production — refusing to boot` when the key starts with `sk_live` and `NODE_ENV !== 'production'`.
  - `fakeStripe(over = {})` (test helper) → call-recording object: `calls` {customersCreate, checkoutCreate, portalCreate, subUpdate, subRetrieve}; `customers.create` → `{id:'cus_fake1'}`; `checkout.sessions.create` → `{url:'https://checkout.stripe.test/s1'}`; `billingPortal.sessions.create` → `{url:'https://portal.stripe.test/p1'}`; `subscriptions.update` → `{id}`; `subscriptions.retrieve` → `over.subscription ?? {id, status:'active', items:{data:[{id:'si_fake1'}]}}`.
- Consumes: nothing new.

- [ ] **Step 1: Install** — from repo root: `npm install stripe -w api`. Verify `api/package.json` gains `"stripe": "^19..."`.

- [ ] **Step 2: Write the failing test**

```js
// api/test/stripe-seam.test.js
import { test, expect } from 'vitest'
import { buildApp } from '../src/app.js'
import { fakeStripe } from './helpers/fake-stripe.js'

test('sk_live outside production refuses to boot; sk_test and injected fakes are fine', () => {
  expect(() => buildApp(null, { sessionSecret: 's', stripeKey: 'sk_live_abc' }))
    .toThrow(/live Stripe key/)
  const app = buildApp(null, { sessionSecret: 's', stripeKey: 'sk_test_abc' })
  expect(app.stripe).toBeTruthy()
  const app2 = buildApp(null, { sessionSecret: 's', stripe: fakeStripe() })
  expect(app2.stripe.calls).toBeDefined()
  const app3 = buildApp(null, { sessionSecret: 's' })
  expect(app3.stripe).toBeNull() // unconfigured dev — billing routes 503, everything else works
})
```

  (Passing `null` for db is fine — `buildApp` only stores it; no route is exercised.)

- [ ] **Step 3: Run it** — Expected: FAIL (`stripeKey` unknown, no throw, `app.stripe` undefined).

- [ ] **Step 4: Implement** — `api/test/helpers/fake-stripe.js`:

```js
/** Call-recording stand-in for the stripe SDK — tests never touch the network. */
export function fakeStripe(over = {}) {
  const calls = { customersCreate: [], checkoutCreate: [], portalCreate: [], subUpdate: [], subRetrieve: [] }
  return {
    calls,
    customers: { create: async (p) => { calls.customersCreate.push(p); return { id: 'cus_fake1' } } },
    checkout: { sessions: { create: async (p) => { calls.checkoutCreate.push(p); return { url: 'https://checkout.stripe.test/s1' } } } },
    billingPortal: { sessions: { create: async (p) => { calls.portalCreate.push(p); return { url: 'https://portal.stripe.test/p1' } } } },
    subscriptions: {
      update: async (id, p) => { calls.subUpdate.push({ id, ...p }); return { id } },
      retrieve: async (id) => { calls.subRetrieve.push(id); return over.subscription ?? { id, status: 'active', items: { data: [{ id: 'si_fake1' }] } } },
    },
    ...over,
  }
}
```

  In `api/src/app.js`: `import Stripe from 'stripe'` at the top, and next to the `sendMail` decoration:

```js
  // Stripe seam (P4): tests inject a fake; dev without a key runs fine (billing routes 503).
  const stripeKey = opts.stripeKey ?? process.env.STRIPE_SECRET_KEY ?? ''
  if (stripeKey.startsWith('sk_live') && process.env.NODE_ENV !== 'production') {
    throw new Error('live Stripe key outside production — refusing to boot')
  }
  app.decorate('stripe', opts.stripe ?? (stripeKey ? new Stripe(stripeKey) : null))
  app.decorate('stripeWebhookSecret', opts.stripeWebhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET ?? '')
  app.decorate('stripePriceId', opts.stripePriceId ?? process.env.STRIPE_PRICE_ID ?? '')
```

- [ ] **Step 5: Run** — the file, then full api suite (other test files must still boot: they pass no stripe opts → `app.stripe` null → harmless). Expected: PASS.
- [ ] **Step 6: Commit** — `git add api/package.json package-lock.json api/src/app.js api/test/helpers/fake-stripe.js api/test/stripe-seam.test.js && git commit -m "feat(api): stripe SDK seam + sk_live boot guard" && git push origin main`

---

### Task 4: Worker gating — activeCompetitions honors liveness

**Files:**
- Create: `api/src/worker/active-competitions.js` (moved out of `worker.js` so it's testable)
- Modify: `api/src/worker.js` (delete the inline `activeCompetitions`, import instead)
- Test: `api/test/active-competitions.test.js`

**Interfaces:**
- Produces: `activeCompetitions(db, now = new Date())` → competition rows bound to ≥1 LIVE sweep (predicate of Task 2 in SQL form). Signature change from the old inline version: `now` param added (worker callers pass nothing — default).
- Consumes: `GOOD_STANDING` (Task 2); `sweep`, `account`, `competition` (schema).

- [ ] **Step 1: Write the failing test**

```js
// api/test/active-competitions.test.js
import { test, expect, beforeAll, afterAll } from 'vitest'
import { inArray, eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { account, competition, sweep } from '../src/db/schema.js'
import { activeCompetitions } from '../src/worker/active-competitions.js'

const { pool, db } = openTestDb()
const NOW = new Date('2026-07-04T12:00:00Z')
const COMPS = ['apibasketball:12:ac-ops', 'apibasketball:12:ac-trial', 'apibasketball:12:ac-lapsed', 'apibasketball:12:ac-shared']
const comp = (season) => ({ id: `apibasketball:12:${season}`, provider: 'apibasketball', sport: 'basketball', leagueId: '12', season, format: 'league', name: season })

beforeAll(async () => {
  await db.insert(competition).values(COMPS.map((id) => comp(id.split(':')[2]))).onConflictDoNothing()
  await db.insert(account).values([
    { id: 'ac_ac_trial', email: 'ac-trial@x.test', trialEndsAt: new Date(NOW.getTime() + 86400_000) },
    { id: 'ac_ac_lapsed', email: 'ac-lapsed@x.test', subscriptionStatus: 'canceled' },
    { id: 'ac_ac_paid', email: 'ac-paid@x.test', subscriptionStatus: 'active' },
  ])
  await db.insert(sweep).values([
    { id: 'sw_ac_ops', name: 'ops', kind: 'token', memberToken: 'acm1', adminToken: 'aca1', competitionId: COMPS[0], accountId: null },
    { id: 'sw_ac_trial', name: 'trial', kind: 'token', memberToken: 'acm2', adminToken: 'aca2', competitionId: COMPS[1], accountId: 'ac_ac_trial' },
    { id: 'sw_ac_lapsed', name: 'lapsed', kind: 'token', memberToken: 'acm3', adminToken: 'aca3', competitionId: COMPS[2], accountId: 'ac_ac_lapsed' },
    // shared competition: one lapsed + one paid sweep → competition must STAY
    { id: 'sw_ac_shared_l', name: 'shared-l', kind: 'token', memberToken: 'acm4', adminToken: 'aca4', competitionId: COMPS[3], accountId: 'ac_ac_lapsed' },
    { id: 'sw_ac_shared_p', name: 'shared-p', kind: 'token', memberToken: 'acm5', adminToken: 'aca5', competitionId: COMPS[3], accountId: 'ac_ac_paid' },
  ])
})
afterAll(async () => {
  await db.delete(sweep).where(inArray(sweep.competitionId, COMPS))
  await db.delete(competition).where(inArray(competition.id, COMPS))
  await db.delete(account).where(inArray(account.id, ['ac_ac_trial', 'ac_ac_lapsed', 'ac_ac_paid']))
  await pool.end()
})

test('lapsed sweeps drop their competition unless a live sweep shares it; ops + trial stay', async () => {
  const ids = (await activeCompetitions(db, NOW)).map((c) => c.id).filter((id) => COMPS.includes(id)).sort()
  expect(ids).toEqual(['apibasketball:12:ac-ops', 'apibasketball:12:ac-shared', 'apibasketball:12:ac-trial'].sort())
})

test('trial expiry flips the competition out with no state write', async () => {
  const later = new Date(NOW.getTime() + 3 * 86400_000)
  await db.update(account).set({ trialEndsAt: new Date(NOW.getTime() + 86400_000) }).where(eq(account.id, 'ac_ac_trial'))
  const ids = (await activeCompetitions(db, later)).map((c) => c.id)
  expect(ids).not.toContain('apibasketball:12:ac-trial')
})
```

- [ ] **Step 2: Run it** — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// api/src/worker/active-competitions.js
import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm'
import { account, competition, sweep } from '../db/schema.js'
import { GOOD_STANDING } from '../accounts/billing.js'

/** Competitions worth syncing: bound to ≥1 LIVE sweep — unarchived AND
 *  (ops-owned OR paid-in-good-standing OR never-subscribed-and-in-trial).
 *  The §7 dedupe holds: a competition leaves polling only when NO live sweep
 *  remains on it. Lapsed sweeps cost zero feed (econ note §6.1).
 *  Empty DB → empty list → worker loops no-op instead of crashing on boot. */
export async function activeCompetitions(db, now = new Date()) {
  const rows = await db.selectDistinct({ id: sweep.competitionId }).from(sweep)
    .leftJoin(account, eq(sweep.accountId, account.id))
    .where(and(
      isNull(sweep.archivedAt),
      or(
        isNull(sweep.accountId),
        inArray(account.subscriptionStatus, GOOD_STANDING),
        and(isNull(account.subscriptionStatus), gt(account.trialEndsAt, now)),
      ),
    ))
  const ids = rows.map((r) => r.id).filter(Boolean)
  if (!ids.length) return []
  return db.select().from(competition).where(inArray(competition.id, ids))
}
```

  In `api/src/worker.js`: delete the inline `activeCompetitions` function (lines 19–28) and its now-unused imports if any (`isNull` stays only if still used); add `import { activeCompetitions } from './worker/active-competitions.js'`. Both call sites (`baseline`, the tick) already call `activeCompetitions(db)` — unchanged.

- [ ] **Step 4: Static check + run** — `node --check src/worker.js`, then the test file, then full api suite. Expected: PASS.
- [ ] **Step 5: Commit** — `git add api/src/worker/active-competitions.js api/src/worker.js api/test/active-competitions.test.js && git commit -m "feat(worker): lapsed sweeps drop out of competition polling" && git push origin main`

---

### Task 5: Provision — FOR UPDATE txn, trial stamp, billing gates, quantity sync

The provision route body is REPLACED (validation prefix unchanged). **Approved behavior change:** the whole provision now runs in one transaction — a feed failure ROLLS BACK the competition/competitors instead of leaving them for retry (cleaner; the eventless-retry branch stays for CLI/worker deaths). Two existing tests in `api/test/account-sweeps.test.js` are re-keyed accordingly (Step 1).

**Files:**
- Modify: `api/src/routes/account.js` (provision route only)
- Test: `api/test/account-sweeps.test.js` (re-key 2, add 4)

**Interfaces:**
- Consumes: `TRIAL_MS`, `GOOD_STANDING`, `syncQuantity` (Task 2); `app.stripe` (Task 3); existing `addCompetition`/`syncCompetitors`/`syncBaseline`/`links`/`newToken`.
- Produces (wire, consumed by Task 11 e2e):
  - Never-subscribed + first provision → stamps `account.trialEndsAt = now + TRIAL_MS`.
  - Never-subscribed + trial expired, or status not in `GOOD_STANDING` after having subscribed → **402 `{error:'subscription_required'}`**.
  - Trial cap = `ACCOUNT_SWEEP_CAP` (env, default 3); subscribed ceiling = `ACCOUNT_SWEEP_MAX` (env, default 25) → 403 `{error:'sweep_cap', cap}`.
  - Subscribed → `syncQuantity(app.stripe, acct, newCount)` inside the txn.
  - Concurrent provisions serialize on the account row (`FOR UPDATE`) — cap can never land cap+1.

- [ ] **Step 1: Re-key the two feed-failure tests** in `api/test/account-sweeps.test.js`:

  Replace the last assertion block of `'feed failure mid-provision → stable provision_failed, no internals leaked, no sweep'` — the failed provision no longer leaves a competition row (txn rollback). Replace:

```js
    expect(await db.select().from(sweep).where(eq(sweep.accountId, 'ac_fail'))).toHaveLength(0)
```

  with:

```js
    expect(await db.select().from(sweep).where(eq(sweep.accountId, 'ac_fail'))).toHaveLength(0)
    // txn rollback: the failed provision leaves NOTHING behind (P4 behavior change, approved)
    expect(await db.select().from(competition).where(eq(competition.id, FAIL_ID))).toHaveLength(0)
```

  Replace the opening of `'eventless competition (earlier provision died mid-baseline) is re-synced before binding'` — it must now SEED its eventless competition (the branch survives for CLI/worker deaths, not route leftovers). Replace:

```js
  // the failed provision above left FAIL_ID as a competition row with no events — the real feed-hiccup recovery path
  const [comp] = await db.select().from(competition).where(eq(competition.id, FAIL_ID))
  expect(comp).toBeDefined()
  expect(await db.select().from(event).where(eq(event.competitionId, FAIL_ID))).toHaveLength(0)
```

  with:

```js
  // seed an eventless competition (as left by a dead CLI/worker baseline) — the feed-hiccup recovery path
  await db.insert(competition).values({ id: FAIL_ID, provider: 'apibasketball', sport: 'basketball', leagueId: '12', season: '2022-2023', format: 'league', name: 'NBA' }).onConflictDoNothing()
  expect(await db.select().from(event).where(eq(event.competitionId, FAIL_ID))).toHaveLength(0)
```

- [ ] **Step 2: Append the four new failing tests** to `api/test/account-sweeps.test.js`:

```js
test('first provision stamps the account trial clock (14d), second does not move it', async () => {
  const [before] = await db.select().from(account).where(eq(account.id, 'ac_sw'))
  expect(before.trialEndsAt).toBeInstanceOf(Date) // stamped by this file's very first provision
  const first = before.trialEndsAt.getTime()
  expect(first).toBeGreaterThan(Date.now())
  expect(first).toBeLessThanOrEqual(Date.now() + 14 * 24 * 3600_000 + 60_000)
  await provision('ClockCheck') // may 403 at cap — irrelevant, clock must not move either way
  const [after] = await db.select().from(account).where(eq(account.id, 'ac_sw'))
  expect(after.trialEndsAt.getTime()).toBe(first)
})

test('expired trial and canceled subscription → 402; good standing bypasses the trial cap', async () => {
  await db.insert(account).values({ id: 'ac_lapse', email: 'lapse@x.test', trialEndsAt: new Date(Date.now() - 1000) }).onConflictDoNothing()
  await db.insert(accountSession).values({ token: 'lapsesession', accountId: 'ac_lapse', expiresAt: new Date(Date.now() + 3600_000) })
  const L = { headers: { 'x-account-token': 'lapsesession' } }
  const expired = await app.inject({ method: 'POST', url: '/api/account/sweeps', ...L,
    payload: { name: 'Nope', provider: 'apibasketball', leagueId: '12', season: '2023-2024' } })
  expect(expired.statusCode).toBe(402)
  expect(expired.json()).toEqual({ error: 'subscription_required' })

  await db.update(account).set({ subscriptionStatus: 'canceled' }).where(eq(account.id, 'ac_lapse'))
  expect((await app.inject({ method: 'POST', url: '/api/account/sweeps', ...L,
    payload: { name: 'Nope', provider: 'apibasketball', leagueId: '12', season: '2023-2024' } })).statusCode).toBe(402)

  // active subscription: provisions fine even though its trial date is long past
  await db.update(account).set({ subscriptionStatus: 'active', stripeSubscriptionId: 'sub_lapse', stripeSubscriptionItemId: 'si_lapse' }).where(eq(account.id, 'ac_lapse'))
  const ok = await app.inject({ method: 'POST', url: '/api/account/sweeps', ...L,
    payload: { name: 'PaidNow', provider: 'apibasketball', leagueId: '12', season: '2023-2024' } })
  expect(ok.statusCode).toBe(201)
})

test('subscribed provision re-asserts stripe quantity as the live count', async () => {
  stripeFake.calls.subUpdate.length = 0
  const r = await app.inject({ method: 'POST', url: '/api/account/sweeps', headers: { 'x-account-token': 'lapsesession' },
    payload: { name: 'PaidTwo', provider: 'apibasketball', leagueId: '12', season: '2023-2024' } })
  expect(r.statusCode).toBe(201)
  expect(stripeFake.calls.subUpdate).toEqual([
    { id: 'sub_lapse', items: [{ id: 'si_lapse', quantity: 2 }], proration_behavior: 'none' },
  ])
})

test('concurrent provisions at cap-1 land exactly one 201 (FOR UPDATE serializes)', async () => {
  await db.insert(account).values({ id: 'ac_race', email: 'race@x.test' }).onConflictDoNothing()
  await db.insert(accountSession).values({ token: 'racesession', accountId: 'ac_race', expiresAt: new Date(Date.now() + 3600_000) })
  // 2 pre-existing live sweeps → cap 3 → exactly one of two concurrent provisions may win
  await db.insert(sweep).values([
    { id: 'sw_race_1', name: 'R1', kind: 'token', memberToken: 'rm1', adminToken: 'ra1', competitionId: NBA_ID, accountId: 'ac_race' },
    { id: 'sw_race_2', name: 'R2', kind: 'token', memberToken: 'rm2', adminToken: 'ra2', competitionId: NBA_ID, accountId: 'ac_race' },
  ])
  const R = { headers: { 'x-account-token': 'racesession' } }
  const body = { name: 'Racer', provider: 'apibasketball', leagueId: '12', season: '2023-2024' }
  const [a, b] = await Promise.all([
    app.inject({ method: 'POST', url: '/api/account/sweeps', ...R, payload: body }),
    app.inject({ method: 'POST', url: '/api/account/sweeps', ...R, payload: { ...body, name: 'Racer2' } }),
  ])
  expect([a.statusCode, b.statusCode].sort()).toEqual([201, 403])
})
```

  Wire the fake into this file's app (top of file): add imports `import { fakeStripe } from './helpers/fake-stripe.js'` and `account` is already imported; add `const stripeFake = fakeStripe()` above `buildApp` and pass `stripe: stripeFake` in the opts. Add cleanup to afterAll: sweeps/sessions/accounts for `ac_lapse`, `ac_race` (delete `sweep` by those accountIds BEFORE their account rows, sessions `lapsesession`/`racesession`).

- [ ] **Step 3: Run the file** — Expected: FAIL (402s come back 403/201, no trial stamp, no subUpdate calls, competition row survives rollback test).

- [ ] **Step 4: Implement** — in `api/src/routes/account.js`, add imports:

```js
import { TRIAL_MS, GOOD_STANDING, syncQuantity } from '../accounts/billing.js'
```

  and replace the provision route handler body after the `unknown_competition` check (keep the catalog validation exactly as-is) with:

```js
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
```

- [ ] **Step 5: Run** — the file, then full api suite. Expected: PASS (including the re-keyed feed-failure/eventless tests and the untouched cap/archive test — trial stamping is invisible to it).
- [ ] **Step 6: Commit** — `git add api/src/routes/account.js api/test/account-sweeps.test.js && git commit -m "feat(api): provision gates on trial/subscription, FOR UPDATE kills cap TOCTOU" && git push origin main`

---

### Task 6: Archive re-asserts quantity

**Files:**
- Modify: `api/src/routes/account.js` (archive route)
- Test: `api/test/account-sweeps.test.js` (extend)

**Interfaces:**
- Consumes: `syncQuantity`, `liveSweepCount` (Task 2), `app.stripe`.
- Produces: archive of a subscribed account's sweep → `syncQuantity(stripe, acct, remainingLiveCount)`. Unsubscribed archive → no stripe call (as today). Response unchanged `{id, archived: true}`.

- [ ] **Step 1: Write the failing test** — append to `api/test/account-sweeps.test.js`:

```js
test('archive re-asserts stripe quantity for subscribed accounts', async () => {
  stripeFake.calls.subUpdate.length = 0
  const mine = (await app.inject({ method: 'GET', url: '/api/account/sweeps', headers: { 'x-account-token': 'lapsesession' } })).json()
  const target = mine.find((s) => s.name === 'PaidTwo')
  const r = await app.inject({ method: 'POST', url: `/api/account/sweeps/${target.id}/archive`, headers: { 'x-account-token': 'lapsesession' } })
  expect(r.json()).toEqual({ id: target.id, archived: true })
  expect(stripeFake.calls.subUpdate).toEqual([
    { id: 'sub_lapse', items: [{ id: 'si_lapse', quantity: 1 }], proration_behavior: 'none' },
  ])
})
```

- [ ] **Step 2: Run it** — Expected: FAIL (no subUpdate call recorded).

- [ ] **Step 3: Implement** — replace the archive handler in `api/src/routes/account.js` (add `liveSweepCount` to the billing import):

```js
  app.post('/api/account/sweeps/:id/archive', { preHandler: accountGuard }, async (req, reply) => {
    const result = await app.db.transaction(async (tx) => {
      const [acct] = await tx.select().from(account).where(eq(account.id, req.account.id)).for('update')
      const [row] = await tx.select().from(sweep)
        .where(and(eq(sweep.id, req.params.id), eq(sweep.accountId, acct.id)))
      if (!row) return { code: 404, body: { error: 'not_found' } }
      await tx.update(sweep).set({ archivedAt: new Date() }).where(eq(sweep.id, row.id))
      if (GOOD_STANDING.includes(acct.subscriptionStatus)) {
        await syncQuantity(app.stripe, acct, await liveSweepCount(tx, acct.id)) // recount, not decrement — self-heals
      }
      return { code: 200, body: { id: row.id, archived: true } }
    })
    return reply.code(result.code).send(result.body)
  })
```

- [ ] **Step 4: Run** — the file, then full api suite. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(api): archive re-asserts subscription quantity" && git push origin main`

---

### Task 7: Billing routes — checkout, portal, status

**Files:**
- Create: `api/src/routes/billing.js`
- Modify: `api/src/app.js` (import + `app.register(billingRoutes)` next to `accountRoutes`)
- Test: `api/test/billing-routes.test.js`

**Interfaces:**
- Consumes: `requireAccount`, `GOOD_STANDING`, `liveSweepCount`, `app.stripe`, `app.stripePriceId`, `app.platformHost`.
- Produces (wire, consumed by Task 11/12):
  - `POST /api/account/billing/checkout` → 200 `{url}`; 503 `billing_unconfigured` (no stripe); 409 `already_subscribed` (status in GOOD_STANDING); 409 `no_live_sweeps` (nothing to bill). Creates the Stripe customer once, stores `stripeCustomerId` immediately.
  - `POST /api/account/billing/portal` → 200 `{url}`; 409 `not_subscribed` when no customer id yet; 503 unconfigured.
  - `GET /api/account/billing` → `{subscribed, subscriptionStatus, trialEndsAt, liveSweeps, quantity}` (quantity = liveSweeps when subscribed, else 0).

- [ ] **Step 1: Write the failing test**

```js
// api/test/billing-routes.test.js
import { test, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { buildApp } from '../src/app.js'
import { account, accountSession, competition, sweep } from '../src/db/schema.js'
import { fakeStripe } from './helpers/fake-stripe.js'

const { pool, db } = openTestDb()
const stripeFake = fakeStripe()
const app = buildApp(db, { sessionSecret: 'test-secret', platformHost: 'platform.test', stripe: stripeFake, stripePriceId: 'price_test5' })
const M = { headers: { 'x-account-token': 'billsession' } }
const COMP = 'apibasketball:12:billing-routes'

beforeAll(async () => {
  await app.ready()
  await db.insert(account).values({ id: 'ac_bill', email: 'bill@x.test', trialEndsAt: new Date(Date.now() + 86400_000) })
  await db.insert(accountSession).values({ token: 'billsession', accountId: 'ac_bill', expiresAt: new Date(Date.now() + 3600_000) })
  await db.insert(competition).values({ id: COMP, provider: 'apibasketball', sport: 'basketball', leagueId: '12', season: 'billing-routes', format: 'league', name: 'B' }).onConflictDoNothing()
})
afterAll(async () => {
  await db.delete(sweep).where(eq(sweep.accountId, 'ac_bill'))
  await db.delete(competition).where(eq(competition.id, COMP))
  await db.delete(accountSession).where(eq(accountSession.token, 'billsession'))
  await db.delete(account).where(eq(account.id, 'ac_bill'))
  await app.close(); await pool.end()
})

test('checkout: no live sweeps → 409; with a sweep → customer created once + session url', async () => {
  expect((await app.inject({ method: 'POST', url: '/api/account/billing/checkout', ...M })).statusCode).toBe(409)

  await db.insert(sweep).values({ id: 'sw_bill_1', name: 'B1', kind: 'token', memberToken: 'bm1', adminToken: 'ba1', competitionId: COMP, accountId: 'ac_bill' })
  const r = await app.inject({ method: 'POST', url: '/api/account/billing/checkout', ...M })
  expect(r.statusCode).toBe(200)
  expect(r.json()).toEqual({ url: 'https://checkout.stripe.test/s1' })
  expect(stripeFake.calls.customersCreate).toHaveLength(1)
  expect(stripeFake.calls.checkoutCreate[0]).toMatchObject({
    mode: 'subscription', customer: 'cus_fake1', client_reference_id: 'ac_bill',
    line_items: [{ price: 'price_test5', quantity: 1 }],
  })
  const [acct] = await db.select().from(account).where(eq(account.id, 'ac_bill'))
  expect(acct.stripeCustomerId).toBe('cus_fake1') // stored immediately, reused next time

  await app.inject({ method: 'POST', url: '/api/account/billing/checkout', ...M })
  expect(stripeFake.calls.customersCreate).toHaveLength(1) // not recreated
})

test('status + portal + already-subscribed guard', async () => {
  const s1 = (await app.inject({ method: 'GET', url: '/api/account/billing', ...M })).json()
  expect(s1).toMatchObject({ subscribed: false, subscriptionStatus: null, liveSweeps: 1, quantity: 0 })

  expect((await app.inject({ method: 'POST', url: '/api/account/billing/portal', ...M })).statusCode).toBe(200) // customer exists from checkout
  expect(stripeFake.calls.portalCreate[0]).toMatchObject({ customer: 'cus_fake1' })

  await db.update(account).set({ subscriptionStatus: 'active' }).where(eq(account.id, 'ac_bill'))
  expect((await app.inject({ method: 'POST', url: '/api/account/billing/checkout', ...M })).statusCode).toBe(409)
  const s2 = (await app.inject({ method: 'GET', url: '/api/account/billing', ...M })).json()
  expect(s2).toMatchObject({ subscribed: true, subscriptionStatus: 'active', quantity: 1 })
  expect((await app.inject({ method: 'GET', url: '/api/account/billing' })).statusCode).toBe(401) // auth required
})
```

- [ ] **Step 2: Run it** — Expected: FAIL (404s — routes don't exist).

- [ ] **Step 3: Implement**

```js
// api/src/routes/billing.js
import { eq } from 'drizzle-orm'
import { account } from '../db/schema.js'
import { requireAccount } from '../accounts/auth.js'
import { GOOD_STANDING, liveSweepCount } from '../accounts/billing.js'

/** Owner-facing billing surface (decision c: API-only — Stripe hosts every page we'd otherwise build). */
export async function billingRoutes(app) {
  const accountGuard = requireAccount(app)
  const limited = { rateLimit: { max: 10, timeWindow: '15 minutes' } }

  app.post('/api/account/billing/checkout', { preHandler: accountGuard, config: limited }, async (req, reply) => {
    if (!app.stripe) return reply.code(503).send({ error: 'billing_unconfigured' })
    const [acct] = await app.db.select().from(account).where(eq(account.id, req.account.id))
    if (GOOD_STANDING.includes(acct.subscriptionStatus)) return reply.code(409).send({ error: 'already_subscribed' })
    const n = await liveSweepCount(app.db, acct.id)
    if (!n) return reply.code(409).send({ error: 'no_live_sweeps' }) // Stripe requires quantity ≥ 1
    let customerId = acct.stripeCustomerId
    if (!customerId) {
      const c = await app.stripe.customers.create({ email: acct.email, metadata: { accountId: acct.id } })
      customerId = c.id
      await app.db.update(account).set({ stripeCustomerId: customerId }).where(eq(account.id, acct.id))
    }
    const sess = await app.stripe.checkout.sessions.create({
      mode: 'subscription', customer: customerId, client_reference_id: acct.id,
      line_items: [{ price: app.stripePriceId, quantity: n }],
      success_url: `https://${app.platformHost}/account/billing/success`,
      cancel_url: `https://${app.platformHost}/account/billing/cancelled`,
    })
    return { url: sess.url }
  })

  app.post('/api/account/billing/portal', { preHandler: accountGuard, config: limited }, async (req, reply) => {
    if (!app.stripe) return reply.code(503).send({ error: 'billing_unconfigured' })
    const [acct] = await app.db.select().from(account).where(eq(account.id, req.account.id))
    if (!acct.stripeCustomerId) return reply.code(409).send({ error: 'not_subscribed' })
    const sess = await app.stripe.billingPortal.sessions.create({
      customer: acct.stripeCustomerId, return_url: `https://${app.platformHost}/account`,
    })
    return { url: sess.url }
  })

  app.get('/api/account/billing', { preHandler: accountGuard }, async (req) => {
    const [acct] = await app.db.select().from(account).where(eq(account.id, req.account.id))
    const liveSweeps = await liveSweepCount(app.db, acct.id)
    const subscribed = GOOD_STANDING.includes(acct.subscriptionStatus)
    return { subscribed, subscriptionStatus: acct.subscriptionStatus, trialEndsAt: acct.trialEndsAt, liveSweeps, quantity: subscribed ? liveSweeps : 0 }
  })
}
```

  In `api/src/app.js`: `import { billingRoutes } from './routes/billing.js'` + `app.register(billingRoutes)` after `accountRoutes`.

- [ ] **Step 4: Run** — the file, then full api suite. Expected: PASS.
- [ ] **Step 5: Commit** — `git add api/src/routes/billing.js api/src/app.js api/test/billing-routes.test.js && git commit -m "feat(api): Stripe checkout/portal/status routes" && git push origin main`

---

### Task 8: Stripe webhook — raw body, signature, handlers, idempotency

**Files:**
- Create: `api/src/routes/stripe-webhook.js`
- Modify: `api/src/app.js` (import + register)
- Test: `api/test/stripe-webhook.test.js`

**Interfaces:**
- Consumes: `app.stripe` (`.webhooks.constructEvent` + `.subscriptions.retrieve`), `app.stripeWebhookSecret`, `billingEvent`/`account` (schema), `liveSweepCount` + `syncQuantity` (Task 2).
- Produces: `POST /api/stripe/webhook` — 503 unconfigured; 400 `bad_signature`; 200 `{received:true}` (+ `duplicate:true` on replay). Handled types: `checkout.session.completed` (store sub/item ids + status by `client_reference_id`, re-sync quantity), `customer.subscription.updated` (mirror status by sub id), `customer.subscription.deleted` (status `canceled`), everything else audit-only. Every event lands in `billing_event` exactly once.

- [ ] **Step 1: Write the failing test**

```js
// api/test/stripe-webhook.test.js
import { test, expect, beforeAll, afterAll } from 'vitest'
import Stripe from 'stripe'
import { eq, inArray } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { buildApp } from '../src/app.js'
import { account, accountSession, billingEvent, competition, sweep } from '../src/db/schema.js'
import { fakeStripe } from './helpers/fake-stripe.js'

const { pool, db } = openTestDb()
const WHSEC = 'whsec_testsecret'
const sdk = new Stripe('sk_test_dummy') // offline: only .webhooks is used
// hybrid: fake API surface + REAL signature verification
const stripeFake = { ...fakeStripe(), webhooks: sdk.webhooks }
const app = buildApp(db, { sessionSecret: 'test-secret', platformHost: 'platform.test', stripe: stripeFake, stripeWebhookSecret: WHSEC })
const COMP = 'apibasketball:12:webhook'

const send = (event) => {
  const payload = JSON.stringify(event)
  const sig = sdk.webhooks.generateTestHeaderString({ payload, secret: WHSEC })
  return app.inject({ method: 'POST', url: '/api/stripe/webhook', payload,
    headers: { 'content-type': 'application/json', 'stripe-signature': sig } })
}

beforeAll(async () => {
  await app.ready()
  await db.insert(account).values({ id: 'ac_wh', email: 'wh@x.test', stripeCustomerId: 'cus_wh' })
  await db.insert(competition).values({ id: COMP, provider: 'apibasketball', sport: 'basketball', leagueId: '12', season: 'webhook', format: 'league', name: 'W' }).onConflictDoNothing()
  await db.insert(sweep).values({ id: 'sw_wh_1', name: 'W1', kind: 'token', memberToken: 'wm1', adminToken: 'wa1', competitionId: COMP, accountId: 'ac_wh' })
})
afterAll(async () => {
  await db.delete(billingEvent).where(inArray(billingEvent.stripeEventId, ['evt_co_1', 'evt_up_1', 'evt_del_1', 'evt_odd_1']))
  await db.delete(sweep).where(eq(sweep.accountId, 'ac_wh'))
  await db.delete(competition).where(eq(competition.id, COMP))
  await db.delete(account).where(eq(account.id, 'ac_wh'))
  await app.close(); await pool.end()
})

test('bad signature → 400; nothing recorded', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/stripe/webhook', payload: '{}',
    headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=garbage' } })
  expect(res.statusCode).toBe(400)
  expect(await db.select().from(billingEvent)).toHaveLength(0)
})

test('checkout.session.completed stores ids + status and re-syncs quantity; replay is a no-op', async () => {
  const ev = { id: 'evt_co_1', type: 'checkout.session.completed',
    data: { object: { id: 'cs_1', customer: 'cus_wh', subscription: 'sub_wh_1', client_reference_id: 'ac_wh' } } }
  expect((await send(ev)).statusCode).toBe(200)
  const [acct] = await db.select().from(account).where(eq(account.id, 'ac_wh'))
  expect(acct).toMatchObject({ stripeSubscriptionId: 'sub_wh_1', stripeSubscriptionItemId: 'si_fake1', subscriptionStatus: 'active' })
  expect(stripeFake.calls.subUpdate.at(-1)).toMatchObject({ id: 'sub_wh_1', items: [{ id: 'si_fake1', quantity: 1 }] })

  const replay = await send(ev)
  expect(replay.json()).toMatchObject({ received: true, duplicate: true })
  expect(await db.select().from(billingEvent).where(eq(billingEvent.stripeEventId, 'evt_co_1'))).toHaveLength(1)
})

test('subscription.updated mirrors status; deleted lapses; unknown type is audit-only', async () => {
  await send({ id: 'evt_up_1', type: 'customer.subscription.updated', data: { object: { id: 'sub_wh_1', status: 'past_due' } } })
  expect((await db.select().from(account).where(eq(account.id, 'ac_wh')))[0].subscriptionStatus).toBe('past_due')

  await send({ id: 'evt_del_1', type: 'customer.subscription.deleted', data: { object: { id: 'sub_wh_1', status: 'canceled' } } })
  expect((await db.select().from(account).where(eq(account.id, 'ac_wh')))[0].subscriptionStatus).toBe('canceled')

  expect((await send({ id: 'evt_odd_1', type: 'invoice.payment_failed', data: { object: { id: 'in_1' } } })).statusCode).toBe(200)
  const rows = await db.select().from(billingEvent)
  expect(rows.map((r) => r.stripeEventId).sort()).toEqual(['evt_co_1', 'evt_del_1', 'evt_odd_1', 'evt_up_1'])
})
```

- [ ] **Step 2: Run it** — Expected: FAIL (404 — route doesn't exist).

- [ ] **Step 3: Implement**

```js
// api/src/routes/stripe-webhook.js
import { eq } from 'drizzle-orm'
import { account, billingEvent } from '../db/schema.js'
import { liveSweepCount, syncQuantity } from '../accounts/billing.js'

/** Own plugin scope: the raw-body parser below applies ONLY to routes registered here —
 *  constructEvent must see the exact request bytes, not parsed JSON. */
export async function stripeWebhookRoutes(app) {
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => done(null, body))

  app.post('/api/stripe/webhook', async (req, reply) => {
    if (!app.stripe || !app.stripeWebhookSecret) return reply.code(503).send({ error: 'billing_unconfigured' })
    let ev
    try {
      ev = app.stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], app.stripeWebhookSecret)
    } catch (e) {
      req.log.warn({ err: e }, 'stripe webhook signature rejected')
      return reply.code(400).send({ error: 'bad_signature' })
    }

    // idempotency: the unique stripeEventId makes redelivery a visible no-op
    const inserted = await app.db.insert(billingEvent)
      .values({ stripeEventId: ev.id, type: ev.type })
      .onConflictDoNothing().returning({ id: billingEvent.id })
    if (!inserted.length) return { received: true, duplicate: true }

    const obj = ev.data.object
    if (ev.type === 'checkout.session.completed') {
      const accountId = obj.client_reference_id
      const sub = await app.stripe.subscriptions.retrieve(obj.subscription)
      await app.db.update(account).set({
        stripeCustomerId: obj.customer, stripeSubscriptionId: sub.id,
        stripeSubscriptionItemId: sub.items.data[0].id, subscriptionStatus: sub.status,
      }).where(eq(account.id, accountId))
      const [acct] = await app.db.select().from(account).where(eq(account.id, accountId))
      if (acct) await syncQuantity(app.stripe, acct, await liveSweepCount(app.db, acct.id)) // count may have moved since session creation
      await app.db.update(billingEvent).set({ accountId }).where(eq(billingEvent.stripeEventId, ev.id))
    } else if (ev.type === 'customer.subscription.updated' || ev.type === 'customer.subscription.deleted') {
      const status = ev.type.endsWith('deleted') ? 'canceled' : obj.status
      const rows = await app.db.update(account).set({ subscriptionStatus: status })
        .where(eq(account.stripeSubscriptionId, obj.id)).returning({ id: account.id })
      if (rows.length) await app.db.update(billingEvent).set({ accountId: rows[0].id }).where(eq(billingEvent.stripeEventId, ev.id))
    } // everything else: audit row only

    return { received: true }
  })
}
```

  In `api/src/app.js`: `import { stripeWebhookRoutes } from './routes/stripe-webhook.js'` + `app.register(stripeWebhookRoutes)` after `billingRoutes`.

- [ ] **Step 4: Run** — the file, then full api suite. Expected: PASS.
- [ ] **Step 5: Commit** — `git add api/src/routes/stripe-webhook.js api/src/app.js api/test/stripe-webhook.test.js && git commit -m "feat(api): signature-verified Stripe webhook with idempotent event handling" && git push origin main`

---

### Task 9: Wire read-only gate + bootstrap readOnly flag

**Files:**
- Create: `api/src/sweeps/read-only.js`
- Modify: `api/src/app.js` (hook after `sweepResolver`), `api/src/routes/bootstrap.js` (additive `readOnly` field)
- Test: `api/test/sweep-readonly.test.js`

**Interfaces:**
- Consumes: `sweepLiveNow` (Task 2), `req.sweep` (set by `sweepResolver`).
- Produces: mutating requests (`POST/PUT/PATCH/DELETE`) on a resolved, OWNED, non-live sweep → 403 `{error:'sweep_readonly'}` — except exact paths `/api/session`, `/api/session/logout`, `/api/admin/login`, `/api/admin/logout` and prefixes `/api/account`, `/api/super`, `/api/stripe`. GETs/SSE untouched. `GET /api/bootstrap` response gains `readOnly: boolean` (web is frozen and ignores unknown fields).

- [ ] **Step 1: Write the failing test**

```js
// api/test/sweep-readonly.test.js
import { test, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { buildApp } from '../src/app.js'
import { account, competition, sweep } from '../src/db/schema.js'

const { pool, db } = openTestDb()
const app = buildApp(db, { sessionSecret: 'test-secret', platformHost: 'platform.test' })
const COMP = 'apibasketball:12:readonly'
const H = { host: 'platform.test' }

beforeAll(async () => {
  await app.ready()
  await db.insert(account).values({ id: 'ac_ro', email: 'ro@x.test', subscriptionStatus: 'canceled' })
  await db.insert(competition).values({ id: COMP, provider: 'apibasketball', sport: 'basketball', leagueId: '12', season: 'readonly', format: 'league', name: 'RO' }).onConflictDoNothing()
  await db.insert(sweep).values({ id: 'sw_ro', name: 'Lapsed', kind: 'token', memberToken: 'romember', adminToken: 'roadmin', competitionId: COMP, accountId: 'ac_ro' })
})
afterAll(async () => {
  await db.delete(sweep).where(eq(sweep.id, 'sw_ro'))
  await db.delete(competition).where(eq(competition.id, COMP))
  await db.delete(account).where(eq(account.id, 'ac_ro'))
  await app.close(); await pool.end()
})

async function memberCookie() {
  const res = await app.inject({ method: 'POST', url: '/api/session', headers: H, payload: { token: 'romember' } })
  expect(res.statusCode).toBe(200) // sign-in on a lapsed sweep MUST still work (view access)
  return res.headers['set-cookie']
}

test('lapsed sweep: reads 200 + readOnly flag, writes 403, sign-in exempt', async () => {
  const cookie = await memberCookie()
  const boot = await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { ...H, cookie } })
  expect(boot.statusCode).toBe(200)
  expect(boot.json().readOnly).toBe(true)
  expect((await app.inject({ method: 'GET', url: '/api/fixtures', headers: { ...H, cookie } })).statusCode).toBe(200)

  const write = await app.inject({ method: 'POST', url: '/api/support', headers: { ...H, cookie }, payload: { teamCode: 'any' } })
  expect(write.statusCode).toBe(403)
  expect(write.json()).toEqual({ error: 'sweep_readonly' })

  // renewal flips it back with zero state writes on the sweep
  await db.update(account).set({ subscriptionStatus: 'active' }).where(eq(account.id, 'ac_ro'))
  expect((await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { ...H, cookie } })).json().readOnly).toBe(false)
  await db.update(account).set({ subscriptionStatus: 'canceled' }).where(eq(account.id, 'ac_ro'))
})

test('ops (unowned) sweeps are never read-only', async () => {
  // non-platform host resolves the seeded default sweep (accountId null)
  const boot = await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { host: 'localhost:3000' } })
  expect(boot.statusCode).toBe(200)
  expect(boot.json().readOnly).toBe(false)
})
```

  NOTE for the implementer: if `/api/support`'s schema 400s before the gate runs (schema validation precedes preHandler in Fastify), pick any sweep-scoped mutating route whose body passes schema — e.g. POST `/api/support` with a valid-shaped body from `api/test/social.test.js`. Copy a known-good payload from that file; the assertion is on 403-not-2xx/400.

- [ ] **Step 2: Run it** — Expected: FAIL (write returns non-403; `readOnly` undefined).

- [ ] **Step 3: Implement**

```js
// api/src/sweeps/read-only.js
import { sweepLiveNow } from '../accounts/billing.js'

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const EXEMPT_EXACT = new Set(['/api/session', '/api/session/logout', '/api/admin/login', '/api/admin/logout'])
const EXEMPT_PREFIX = ['/api/account', '/api/super', '/api/stripe']

/** Lapsed sweeps are read-only (data retained): refuse sweep-scoped writes; reads,
 *  the SSE stream, and sign-in stay — members can look, nobody can change. */
export function readOnlyGate(app) {
  return async (req, reply) => {
    if (!MUTATING.has(req.method) || !req.sweep?.accountId) return
    const path = req.url.split('?')[0]
    if (EXEMPT_EXACT.has(path) || EXEMPT_PREFIX.some((p) => path.startsWith(p))) return
    if (!(await sweepLiveNow(app, req.sweep))) {
      return reply.code(403).send({ error: 'sweep_readonly' })
    }
  }
}
```

  In `api/src/app.js`: `import { readOnlyGate } from './sweeps/read-only.js'` and directly under the `sweepResolver` hook line:

```js
  app.addHook('preHandler', readOnlyGate(app))
```

  In `api/src/routes/bootstrap.js`: import `sweepLiveNow` from `../accounts/billing.js`; in the bootstrap handler, add to the returned object (exact splice point depends on the current response literal — add alongside its top-level fields):

```js
    readOnly: req.sweep ? !(await sweepLiveNow(app, req.sweep)) : false,
```

- [ ] **Step 4: Run** — the file, then the FULL api suite (the gate touches every route — watch for collateral 403s; the exemption list is the fix point if any legitimate write breaks) and the web suite (`npm test -w web` — must stay 436 untouched). Expected: PASS.
- [ ] **Step 5: Commit** — `git add api/src/sweeps/read-only.js api/src/app.js api/src/routes/bootstrap.js api/test/sweep-readonly.test.js && git commit -m "feat(api): lapsed sweeps are read-only on the wire" && git push origin main`

---

### Task 10: Trial-ending reminder in worker daily()

**Files:**
- Modify: `api/src/accounts/billing.js` (add `sendTrialReminders`), `api/src/worker.js` (call in `daily()`)
- Test: `api/test/billing-liveness.test.js` (extend)

**Interfaces:**
- Produces: `sendTrialReminders(db, sendMail = consoleMail, now = new Date())` → count sent. Targets: `subscriptionStatus IS NULL`, `trialReminderSentAt IS NULL`, `trialEndsAt` in `(now, now+3d)`. Marks `trialReminderSentAt` after sending (once, ever). `consoleMail` mirrors the app's console mailer (worker has no Fastify app).
- Consumes: `account` (schema), worker `daily()` (calls it with no mailer arg → console).

- [ ] **Step 1: Write the failing test** — append to `api/test/billing-liveness.test.js`:

```js
test('sendTrialReminders mails once, only near-expiry unsubscribed accounts', async () => {
  const NOW2 = new Date('2026-07-10T12:00:00Z')
  const in2d = new Date(NOW2.getTime() + 2 * 86400_000)
  const in10d = new Date(NOW2.getTime() + 10 * 86400_000)
  await db.insert(account).values([
    { id: 'ac_rem_due', email: 'rem-due@x.test', trialEndsAt: in2d },
    { id: 'ac_rem_far', email: 'rem-far@x.test', trialEndsAt: in10d },
    { id: 'ac_rem_paid', email: 'rem-paid@x.test', trialEndsAt: in2d, subscriptionStatus: 'active' },
    { id: 'ac_rem_over', email: 'rem-over@x.test', trialEndsAt: new Date(NOW2.getTime() - 1000) },
  ])
  const mails = []
  const { sendTrialReminders } = await import('../src/accounts/billing.js')
  expect(await sendTrialReminders(db, async (to, subject) => mails.push({ to, subject }), NOW2)).toBe(1)
  expect(mails).toEqual([{ to: 'rem-due@x.test', subject: expect.stringMatching(/trial/i) }])
  expect(await sendTrialReminders(db, async (to) => mails.push(to), NOW2)).toBe(0) // once, ever
  await db.delete(account).where(inArray(account.id, ['ac_rem_due', 'ac_rem_far', 'ac_rem_paid', 'ac_rem_over']))
})
```

  (add `inArray` to the drizzle-orm import of this file).

- [ ] **Step 2: Run it** — Expected: FAIL (not exported).

- [ ] **Step 3: Implement** — append to `api/src/accounts/billing.js` (extend the drizzle import with `gt, isNotNull, lt`):

```js
const REMIND_WINDOW_MS = 3 * 24 * 3600_000
const consoleMail = async (to, subject, body) => console.log(`[mail] to=${to} subject=${subject}\n${body}`)

/** Daily (worker): one heads-up mail per account, ~3 days before the cardless trial ends. */
export async function sendTrialReminders(db, sendMail = consoleMail, now = new Date()) {
  const soon = new Date(now.getTime() + REMIND_WINDOW_MS)
  const due = await db.select().from(account).where(and(
    isNull(account.subscriptionStatus), isNull(account.trialReminderSentAt),
    isNotNull(account.trialEndsAt), gt(account.trialEndsAt, now), lt(account.trialEndsAt, soon),
  ))
  for (const acct of due) {
    await sendMail(acct.email, 'Your sweep trial is ending soon',
      `Your trial ends ${acct.trialEndsAt.toISOString().slice(0, 10)}. Add a card to keep your sweeps running (POST /api/account/billing/checkout).`)
    await db.update(account).set({ trialReminderSentAt: now }).where(eq(account.id, acct.id))
  }
  return due.length
}
```

  In `api/src/worker.js` `daily()`, after the `cleanupExpiredAuth` block:

```js
  try { const n = await sendTrialReminders(db); if (n) console.log(`[daily] trial reminders sent: ${n}`) }
  catch (e) { console.error('[daily] trial reminders failed:', e.message) }
```

  (import `sendTrialReminders` from `./accounts/billing.js`).

- [ ] **Step 4: Run** — `node --check src/worker.js`, the test file, full api suite. Expected: PASS.
- [ ] **Step 5: Commit** — `git add api/src/accounts/billing.js api/src/worker.js api/test/billing-liveness.test.js && git commit -m "feat(worker): trial-ending reminder mail in daily()" && git push origin main`

---

### Task 11: Lifecycle e2e — trial → checkout → lapse → renew → archive

**Files:**
- Test: `api/test/billing-e2e.test.js` (pure test; failures are bugs in the owning module — fix there with its own failing test first)

**Interfaces:**
- Consumes: everything above + recorded NBA provider + real-SDK webhook signatures (Task 8 pattern).

- [ ] **Step 1: Write the test**

```js
// api/test/billing-e2e.test.js
import { test, expect, beforeAll, afterAll } from 'vitest'
import Stripe from 'stripe'
import { readFileSync } from 'node:fs'
import { eq, inArray } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { buildApp } from '../src/app.js'
import { account, accountSession, billingEvent, catalogLeague, competition, competitor, event, ranking, sweep } from '../src/db/schema.js'
import { createRecordedBasketballProvider } from '../src/providers/recorded-basketball-provider.js'
import { activeCompetitions } from '../src/worker/active-competitions.js'
import { fakeStripe } from './helpers/fake-stripe.js'

const { pool, db } = openTestDb()
const loadB = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apibasketball/${n}.json`, import.meta.url)))
const NBA_ID = 'apibasketball:12:2023-2024'
const WHSEC = 'whsec_e2e'
const sdk = new Stripe('sk_test_dummy')
const stripeFake = { ...fakeStripe({ subscription: { id: 'sub_e2e', status: 'active', items: { data: [{ id: 'si_e2e' }] } } }), webhooks: sdk.webhooks }
const app = buildApp(db, {
  sessionSecret: 'test-secret', platformHost: 'platform.test',
  stripe: stripeFake, stripeWebhookSecret: WHSEC, stripePriceId: 'price_e2e',
  sendMail: async (to, subject, body) => mails.push(body),
  providerFor: () => createRecordedBasketballProvider({ leagues: loadB('leagues'), teams: loadB('teams'), games: loadB('games'), standings: loadB('standings') }),
})
const mails = []
const webhook = (evt) => {
  const payload = JSON.stringify(evt)
  const sig = sdk.webhooks.generateTestHeaderString({ payload, secret: WHSEC })
  return app.inject({ method: 'POST', url: '/api/stripe/webhook', payload, headers: { 'content-type': 'application/json', 'stripe-signature': sig } })
}

beforeAll(async () => {
  await app.ready()
  await db.insert(catalogLeague).values({
    id: 'apibasketball:12', provider: 'apibasketball', providerLeagueId: '12', name: 'NBA', type: 'League',
    country: { name: 'USA', code: 'US', flag: null }, curated: true,
    seasons: [{ season: '2023-2024', start: '2023-10-05', end: '2024-06-18', current: false, standings: true, odds: false }],
  }).onConflictDoNothing()
})
afterAll(async () => {
  await db.delete(billingEvent).where(inArray(billingEvent.stripeEventId, ['evt_e2e_co', 'evt_e2e_del', 'evt_e2e_renew']))
  await db.delete(sweep).where(inArray(sweep.competitionId, [NBA_ID]))
  for (const id of [NBA_ID]) {
    await db.delete(event).where(eq(event.competitionId, id))
    await db.delete(ranking).where(eq(ranking.competitionId, id))
    await db.delete(competitor).where(eq(competitor.competitionId, id))
    await db.delete(competition).where(eq(competition.id, id))
  }
  await db.delete(catalogLeague).where(eq(catalogLeague.id, 'apibasketball:12'))
  await db.delete(accountSession).where(eq(accountSession.token, 'e2esession'))
  await db.delete(account).where(eq(account.id, 'ac_e2e'))
  await app.close(); await pool.end()
})

test('trial → checkout → quantity → lapse (read-only + polling drop) → renew → archive', async () => {
  await db.insert(account).values({ id: 'ac_e2e', email: 'e2e-billing@x.test' })
  await db.insert(accountSession).values({ token: 'e2esession', accountId: 'ac_e2e', expiresAt: new Date(Date.now() + 3600_000) })
  const M = { headers: { 'x-account-token': 'e2esession' } }

  // 1. provision on trial
  const p = await app.inject({ method: 'POST', url: '/api/account/sweeps', ...M,
    payload: { name: 'E2E', provider: 'apibasketball', leagueId: '12', season: '2023-2024' } })
  expect(p.statusCode).toBe(201)
  const sweepId = p.json().id
  const [acct1] = await db.select().from(account).where(eq(account.id, 'ac_e2e'))
  expect(acct1.trialEndsAt.getTime()).toBeGreaterThan(Date.now())
  expect((await activeCompetitions(db)).map((c) => c.id)).toContain(NBA_ID)

  // 2. checkout url + completed webhook → subscribed, quantity 1
  const co = await app.inject({ method: 'POST', url: '/api/account/billing/checkout', ...M })
  expect(co.json().url).toContain('checkout.stripe.test')
  await webhook({ id: 'evt_e2e_co', type: 'checkout.session.completed',
    data: { object: { id: 'cs_e2e', customer: 'cus_fake1', subscription: 'sub_e2e', client_reference_id: 'ac_e2e' } } })
  const [acct2] = await db.select().from(account).where(eq(account.id, 'ac_e2e'))
  expect(acct2).toMatchObject({ subscriptionStatus: 'active', stripeSubscriptionId: 'sub_e2e', stripeSubscriptionItemId: 'si_e2e' })
  expect(stripeFake.calls.subUpdate.at(-1)).toMatchObject({ id: 'sub_e2e', items: [{ id: 'si_e2e', quantity: 1 }] })

  // 3. lapse via subscription.deleted → read-only + out of polling
  await webhook({ id: 'evt_e2e_del', type: 'customer.subscription.deleted', data: { object: { id: 'sub_e2e', status: 'canceled' } } })
  expect((await activeCompetitions(db)).map((c) => c.id)).not.toContain(NBA_ID)
  const sess = await app.inject({ method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token: p.json().memberToken } })
  const cookie = sess.headers['set-cookie']
  expect((await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { host: 'platform.test', cookie } })).json().readOnly).toBe(true)
  expect((await app.inject({ method: 'POST', url: '/api/account/sweeps', ...M,
    payload: { name: 'Blocked', provider: 'apibasketball', leagueId: '12', season: '2023-2024' } })).statusCode).toBe(402)

  // 4. renewal restores
  await webhook({ id: 'evt_e2e_renew', type: 'customer.subscription.updated', data: { object: { id: 'sub_e2e', status: 'active' } } })
  expect((await activeCompetitions(db)).map((c) => c.id)).toContain(NBA_ID)
  expect((await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { host: 'platform.test', cookie } })).json().readOnly).toBe(false)

  // 5. archive decrements quantity
  stripeFake.calls.subUpdate.length = 0
  await app.inject({ method: 'POST', url: `/api/account/sweeps/${sweepId}/archive`, ...M })
  expect(stripeFake.calls.subUpdate).toEqual([{ id: 'sub_e2e', items: [{ id: 'si_e2e', quantity: 0 }], proration_behavior: 'none' }])
})
```

- [ ] **Step 2: Run it** — `npx vitest run test/billing-e2e.test.js` — Expected: PASS. A failure is a real bug: fix in the owning module (own failing test first), then re-run.
- [ ] **Step 3: Full suites** — `npm run test` AND `npm test -w web` — api green, web **exactly 436 unmodified**.
- [ ] **Step 4: Commit** — `git add api/test/billing-e2e.test.js && git commit -m "test(api): billing lifecycle e2e — trial to lapse to renewal" && git push origin main`

---

### Task 12: Live dev verification (controller-run; stripe-cli, test mode)

**Files:** `.env` (local only, uncommitted): add `STRIPE_SECRET_KEY=sk_test_...`, `STRIPE_WEBHOOK_SECRET=whsec_...` (from `stripe listen`), `STRIPE_PRICE_ID=price_...`. Fix-forward commits only if bugs surface.

- [ ] **Step 1: DB guard** — `psql "$(grep '^DATABASE_URL=' .env | cut -d= -f2-)" -tc 'SELECT current_database()'` → MUST print `sweep_platform`; anything else: STOP.
- [ ] **Step 2: Migrate** — `npm run db:migrate -w api`. Verify backfill: the existing account (beerworker@gmail.com, owns sw_Am2FGjJJ8Wcz) must now have `trial_ends_at ≈ now()+14d`.
- [ ] **Step 3: Stripe test-mode setup** — `stripe login` (test mode). Create the price once: `stripe prices create --unit-amount 500 --currency usd -d "recurring[interval]=month" -d "product_data[name]=Sweep subscription"` → put ids in `.env`. Start `stripe listen --forward-to localhost:3000/api/stripe/webhook` → copy `whsec_...` into `.env`.
- [ ] **Step 4: Boot** — `npm run dev:api` (background). Confirm boot (the sk_test key must NOT trip the guard).
- [ ] **Step 5: Drive the flow via curl** — login → session (console-mail link) → `GET /api/account/billing` (trial state from backfill) → `POST /api/account/billing/checkout` → open the URL in a browser, pay with `4242 4242 4242 4242` → watch `stripe listen` deliver `checkout.session.completed` → `GET /api/account/billing` shows `subscribed: true, quantity: 1`. Verify in the Stripe test dashboard: one subscription, quantity 1.
- [ ] **Step 6: Lapse + renew** — cancel the subscription from the Stripe test dashboard (immediate) → webhook flips `subscriptionStatus='canceled'` → member link write → 403 `sweep_readonly`; `SELECT` via the worker query path or boot the worker briefly: NBA competition absent from `activeCompetitions` (WC default unaffected — unowned). Re-subscribe via checkout → restored.
- [ ] **Step 7: Suites + build** — `npm run test`, `npm test -w web`, `npm run build`. Expected: green / 436 / build ok.
- [ ] **Step 8: Report** — suite counts, curl/dashboard highlights, `git status` clean, push. Update `.superpowers/sdd/progress.md`.

---

## Self-Review (done at write time)

- **Spec coverage:** schema §2 (T1 incl. backfill), predicate §3 (T2), worker gating §3 (T4), trial §4 (T5 stamp, T10 reminder), Stripe client/boot-guard/routes §5 (T3, T7), webhook §5 (T8), wire read-only §6 (T9), provision/archive quantity + TOCTOU §7 (T5, T6), testing §8 (per-task + T11 e2e + T12 live). Out-of-scope §9 has no tasks — correct.
- **Placeholder scan:** clean. T9's bootstrap splice and T5's "validation prefix unchanged" name exact existing code; T9 Step 1 includes its fallback instruction (schema-vs-hook ordering) explicitly.
- **Type consistency:** `sweepIsLive(sweepRow, accountRow, now)` (T2) used in T9 via `sweepLiveNow`; `liveSweepCount(db, accountId)` (T2) used in T6/T7/T8; `syncQuantity(stripe, acct, n)` (T2) used in T5/T6/T8; `GOOD_STANDING` (T2) used in T4/T5/T6/T7; `activeCompetitions(db, now)` (T4) used in T11; `fakeStripe(over)` (T3) used in T5/T7/T8/T11; env names `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`STRIPE_PRICE_ID` consistent across T3/T12; `ACCOUNT_SWEEP_CAP`/`ACCOUNT_SWEEP_MAX` (T5) match the design.
- **Judgment calls (flagged):** provision txn rollback replaces the P3 leave-behind-for-retry semantics (approved in-plan; eventless branch retained and re-tested via seeding); `liveSweepCount` counts unarchived (billable) not predicate-live (intentional — renewal shouldn't resurrect a different quantity than the owner sees); webhook `subscription.updated` for an unknown sub id is a silent audit-only no-op (Stripe test-clock noise tolerated).
