# Phase 4 — Stripe Subscription + Lifecycle Gating: Design

**Status:** Drafted 2026-07-04; presented in-session (owner AFK for per-section
approval — review gate pending). Owner decisions locked same day: billing scope
= **account-owned sweeps only** (unowned `accountId null` = exempt ops sweeps);
trial = **14 days, cardless** (our clock, `sendMail` reminder); surface =
**API-only** (Stripe-hosted Checkout/Portal URLs; web suite stays frozen at
436). Pre-locked by the feasibility spec §7/§9: ~$5/mo per running sweep, ONE
Stripe subscription per owner with `quantity` = active sweeps, no free tier
(full-featured trial instead), lapse/trial-end → sync pauses + sweep read-only
with data retained, Stripe SDK + Checkout + webhooks — never hand-rolled.

**Inputs:** P3 merged (`e5b4665..a078a54`) + P4 prereqs (`473ffb8..162f1c7`).
Unit economics: full model, `2026-07-04-p4-unit-economics.md` — its §6
consequences (lapse gating = cost control; curation = throttle) shape this
design. Stripe SDK facts verified against stripe-node v19 docs.

**One AFK default to veto:** trial→paid mechanics (§4). Recommended reading of
the locked scope was taken: trial is the PRE-CARD state only.

## 1. Approach

A thin billing shim over the P3 account layer. Stripe owns money state; we
mirror the minimum of it onto `account` via webhooks. Sweep liveness is
**derived at read time** — one shared predicate over
`account billing fields + sweep.archivedAt` — never materialized on the sweep
row. Both consumers (worker polling, wire read-only) use that predicate, so
there is no state to sync and no webhook-ordering bug surface.

Rejected:
- **Materialized `sweep.state`** ('trial'|'active'|'lapsed') — drift risk,
  needs backfill jobs on every webhook, two sources of truth. YAGNI.
- **Stripe-owned trial** (`trial_period_days` on the subscription) —
  contradicts the cardless decision; Stripe never sees a trial-only account.
- **Per-sweep subscriptions** — locked out by §9 (one subscription per owner,
  quantity = active sweeps).

## 2. Schema (one additive migration)

`account` gains (all nullable):
- `stripeCustomerId` text — set on first Checkout session creation.
- `stripeSubscriptionId` text, `stripeSubscriptionItemId` text — set by the
  `checkout.session.completed` webhook (item id needed for quantity updates).
- `subscriptionStatus` text — raw Stripe subscription status mirror
  (`active`, `past_due`, `unpaid`, `canceled`, …). **Null = never subscribed**
  (trial-or-lapsed domain).
- `trialEndsAt` timestamptz — set once, at the account's FIRST provision
  (`now() + 14d`).
- `trialReminderSentAt` timestamptz — dedupe for the reminder mail.

New table `billing_event` (syncLog-culture audit + webhook idempotency):
- `id` serial pk, `stripeEventId` text **unique not null**, `type` text
  notNull, `accountId` text nullable, `summary` jsonb, `createdAt` timestamptz
  default now.

`sweep` unchanged.

## 3. Liveness predicate — `api/src/accounts/billing.js`

```
GOOD_STANDING = ('active', 'past_due')   -- past_due = Stripe dunning grace
sweepIsLive(sweep, account):
  !sweep.archivedAt AND (
    sweep.accountId IS NULL                      -- ops sweep, exempt
    OR account.subscriptionStatus IN GOOD_STANDING
    OR (account.subscriptionStatus IS NULL       -- never subscribed
        AND account.trialEndsAt > now())         -- still in trial
  )
```

Exported both as a drizzle SQL condition (for set queries) and used by the
resolver. Consumers:
- **Worker `activeCompetitions()`**: left-join `account`, filter by the
  predicate instead of bare `isNull(archivedAt)`. A competition leaves polling
  only when NO live sweep references it (`selectDistinct` already dedupes).
  Lapsed → competition dropped → feed cost 0 (econ note §6.1). Renewal →
  webhook flips status → next tick/baseline picks it up automatically.
- **Wire** (§6).

## 4. Trial lifecycle (cardless, one clock per account)

- First provision on an account with `trialEndsAt IS NULL` sets
  `trialEndsAt = now() + 14d` (constant `TRIAL_MS` in billing.js).
- **Trial is the pre-card state only** (AFK default, flagged): subscribing
  converts ALL live sweeps into the billed quantity at once; sweeps
  provisioned by an already-subscribed account bill from day one. No
  per-sweep 14d — that would be a perpetual rotating-discount vector against
  the locked "no free tier".
- Worker `daily()` reminder: accounts with `subscriptionStatus IS NULL`,
  `trialEndsAt` within the next 3 days, `trialReminderSentAt IS NULL` → one
  `sendMail(email, 'Your trial is ending', <checkout pointer>)` + stamp.
  Same failure isolation as catalog sync.
- Trial expiry is NOT an event — the predicate flips by itself. No job, no
  state write, nothing to miss.

## 5. Stripe integration (TEST MODE ONLY this phase)

- Official `stripe` npm SDK (v19.x). Client decorated:
  `app.decorate('stripe', opts.stripe ?? new Stripe(process.env.STRIPE_SECRET_KEY))`
  — the same injection seam as `sendMail`/`providerFor`. Tests inject a fake;
  no test touches the network.
- **Boot guard:** if the configured key starts with `sk_live` and
  `NODE_ENV !== 'production'`, `buildApp` throws. The "never a live key"
  hard rule, made code.
- Env (in `.env`, never committed): `STRIPE_SECRET_KEY` (sk_test),
  `STRIPE_WEBHOOK_SECRET` (whsec from `stripe listen`), `STRIPE_PRICE_ID`
  (the ~$5/mo recurring price, created once in the test dashboard).
- Routes (`api/src/routes/billing.js`, all `requireAccount` except webhook):
  - `POST /api/account/billing/checkout` → create customer if
    `stripeCustomerId` null (store immediately); create Checkout session
    `{mode:'subscription', line_items:[{price, quantity: myLiveSweepCount}],
    success_url/cancel_url on platformHost, client_reference_id: accountId}`
    → 200 `{url}`. Already-subscribed → 409 `{error:'already_subscribed'}`
    (Portal is the management surface).
  - `POST /api/account/billing/portal` → requires `stripeCustomerId` → 200
    `{url}` (`billingPortal.sessions.create`). Card updates and cancellation
    happen there — never hand-rolled.
  - `GET /api/account/billing` → `{subscribed, subscriptionStatus,
    trialEndsAt, liveSweeps, quantity}` — the owner-facing state summary.
- **Webhook** `POST /api/stripe/webhook` — registered in its OWN plugin scope
  with a raw-body content-type parser (Fastify per-scope parser; no new
  dependency), because `stripe.webhooks.constructEvent(rawBody, sig, secret)`
  requires the exact bytes. Bad signature → 400. Then:
  1. Insert `billing_event` (`stripeEventId` unique) — conflict → 200 no-op
     (idempotent redelivery). **AMENDED in review (adff4e6):** the marker
     insert AND the handler side effects run in ONE transaction — a
     marker-first autocommit would permanently drop a paid event whose
     handler failed transiently (retry would see "duplicate"). A mid-handler
     throw now rolls the marker back so Stripe's redelivery reprocesses;
     true duplicates still short-circuit.
  2. Switch on type:
     - `checkout.session.completed` → resolve account by
       `client_reference_id`; store `stripeSubscriptionId` +
       `stripeSubscriptionItemId` (retrieve the subscription's single item),
       set `subscriptionStatus` from the subscription; **re-sync quantity to
       the current live sweep count** (it may have changed since the session
       was created).
     - `customer.subscription.updated` → mirror `status` onto the account
       (matched by `stripeSubscriptionId`, fallback customer id).
     - `customer.subscription.deleted` → `subscriptionStatus = 'canceled'`
       (predicate lapses the sweeps; worker drops competitions next pass).
     - `invoice.payment_failed` → audit row only (Stripe flips the
       subscription to `past_due`/`unpaid` itself via subscription.updated).
     - Anything else → audit row, 200.
  3. Always 200 fast; handler work is a few DB writes.
- Local dev: `stripe listen --forward-to localhost:3000/api/stripe/webhook`;
  lifecycle simulated with `stripe trigger` / test-clock advances.

## 6. Lapse gating on the wire (read-only semantics)

One global preHandler registered AFTER `sweepResolver`:

```
if req.sweep AND NOT sweepIsLive(req.sweep, its account)
   AND req.method mutating (POST/PUT/PATCH/DELETE)
   AND req.url not exempt
→ 403 { error: 'sweep_readonly' }
```

Exempt (sweep-agnostic or must-work-while-lapsed): `/api/account*`,
`/api/super*`, `/api/stripe*`, `/api/session`, `/api/session/logout`,
`/api/admin/login`, `/api/admin/logout`. Members and the sweep admin can
still SIGN IN and read everything (picks, standings, photos, ledger — data
retained); every sweep-scoped write (`/api/bet`, `/api/parlay`,
`/api/support`, `/api/photos`, `/api/optout`, `/api/admin/*` ops) is refused.
GETs and the SSE stream untouched. `GET /api/bootstrap` gains an additive
`readOnly: boolean` field (web is frozen and ignores unknown fields; the P6
reskin consumes it).

The resolver fetches the owning account row when `sweep.accountId` is set
(one extra indexed select per request on owned sweeps only; the default
sweep short-circuits as exempt).

## 7. Provision + archive: quantity replaces the cap (and the TOCTOU dies)

`POST /api/account/sweeps` changes (same route, same validation order):
1. Catalog validation unchanged (400 first — no cap/billing state leak).
2. **Transaction opens; `SELECT … FOR UPDATE` on my account row** —
   serializes concurrent provisions per account. The P3 cap TOCTOU is solved
   here, by design, not by a patch: count-then-insert now sits behind a row
   lock. (ponytail: per-account lock, ~ms hold; fine at this scale.)
3. Billing gate inside the txn:
   - Never-subscribed + trial expired → 402 `{error:'subscription_required'}`.
   - Never-subscribed + in trial (or first provision, which STARTS the
     trial) → cap `ACCOUNT_SWEEP_CAP` (env, default 3) on live sweeps —
     the P3 constant survives as the TRIAL cap.
   - Subscribed in good standing → ceiling `ACCOUNT_SWEEP_MAX` (env, default
     25; feed-abuse guard per econ note §6.3).
   - Subscribed but `unpaid`/`canceled` → 402 `{error:'subscription_required'}`.
4. Provision as today (competition reuse/eventless-retry/addCompetition —
   the feed-touching block keeps its `provision_failed` mapping).
5. Insert sweep; if subscribed: `stripe.subscriptions.update(subId,
   {items:[{id: itemId, quantity: liveCount}], proration_behavior: 'none'})`
   — no penny prorations at $5; quantity truth is re-asserted (count, not
   increment), so a missed sync self-heals on the next change.
6. Commit. Stripe failure inside step 5 → rollback + `provision_failed`
   (sweep never exists unbilled).

`POST /api/account/sweeps/:id/archive` → same txn + lock; archive; if
subscribed, re-assert quantity (decrement by recount). Archiving the last
live sweep leaves quantity 0 — subscription stays, next provision bumps it
back (owner cancels via Portal if they mean to leave).

## 8. Testing

- Strict TDD, testcontainers, suites green; web **436 unmodified**.
- Fake stripe object (plain functions, call-recording) injected via
  `buildApp` opts for checkout/portal/quantity surfaces.
- Webhook tests use the REAL SDK's `stripe.webhooks.generateTestHeaderString`
  → offline, valid-signature requests against the raw-body route; bad-sig,
  duplicate-event, unknown-type paths covered.
- Lifecycle e2e (recorded feeds, fake stripe): provision → trial live →
  checkout.session.completed → quantity set + status active → archive →
  quantity re-asserted → subscription.deleted → sweep read-only (403 on
  writes, 200 on reads) + `activeCompetitions()` drops the competition
  unless a second live sweep shares it → subscription.updated(active) →
  everything restores.
- Worker gating: unit tests on the predicate + `activeCompetitions()` with
  mixed ownership (ops sweep keeps its competition alive regardless).
- Trial: first-provision stamps `trialEndsAt`; reminder mail once; expired
  trial gates provision (402) and flips read-only; TOCTOU test = two
  concurrent provisions at cap-1 → exactly one 201.

## 9. Out of scope

Wagering generalization (P5), web billing UI (P6 reskin; decision c), real
email provider (console `sendMail` remains), account deletion (still blocked
by FK; YAGNI until asked), live Stripe keys/deploy (first-deploy gate
unchanged — webhooks in production need the public endpoint + trustProxy
work recorded there), third provider/event-id keyspace, per-seat/tiered
pricing, dunning emails of our own (Stripe's dunning + Portal cover it).
