# Auth Model Rebuild — Owners Sign In, Admin Is Derived

**Status:** Design, approved in conversation 2026-09-08. Reviewed adversarially against
the codebase; findings folded in. Implementation plan to follow.
**Companion spec:** `2026-09-08-member-identity-design.md` — member identity (self-setup,
email-verified seats). That work depends on this one landing first: it builds on the
resolver and cookie shape defined here, and on the mail transport §2 requires.

**Goal.** Replace four unrelated ways of proving who you are with one. Today an account
owner signs in by magic link, a sweep admin *is* a secret URL, the inherited community
sweep has a bcrypt passcode, and the platform owner is a token in an address bar. Nobody
can find their credentials, nothing can be revoked, and two of the four cannot be
recovered at all.

---

## 1. What was decided

| Question | Decision |
|---|---|
| Account owner sign-in | **Email + password.** Magic link survives as the recovery path, not the daily one. |
| Sign-up | **Unchanged** — magic-link first, so the email stays verified by construction. Password is set afterwards, from inside the account. |
| Who administers a sweep | **The account that owns it, and only that account.** `sweep.account_id` is the sole source. No co-admins, no transfer. |
| How admin is proven | **Derived per request**, never stored. See §3. |
| Per-sweep admin link | **Deleted**, along with the `sweep.admin_token` column. |
| Default sweep | **Deleted entirely** — `DEFAULT_SWEEP_ID`, the Host-header resolver branch, and `ADMIN_PASSCODE`. |
| Super-admin token | **Deleted.** The platform owner is an ordinary account carrying a role. |
| Platform-owner powers | **Operate, don't impersonate** (§5). Every action audited. |
| Members | **Untouched by this spec.** Still enter via `/g/<memberToken>`, still need no account. |
| Account session TTL | **Stays 90 days.** Considered and deliberately not shortened. |
| Owner unarchive | **Deferred.** Known asymmetry, §8. |

---

## 2. Prerequisite: a real mail transport

`api/src/app.js:82` decorates `sendMail` with a `console.log` fallback and
`api/src/server.js` never overrides it. In production, `POST /api/account/login` for
*any* address writes a working sign-in URL to container stdout. Anyone with log
access — an aggregator, a shared ops dashboard, a compromised sidecar — signs in as
anyone.

This is a live defect today. It becomes catastrophic the moment an account can carry the
operator role, because the same path then mints platform-operator access. The companion
spec raises the stakes again: member email verification means transactional mail per
participant, not one sign-in mail per owner.

**Transport: Resend** (decided 2026-09-08, settling the SES-vs-Resend question deferred
on 2026-08-18). Use the official `resend` Node SDK rather than raw SMTP. It needs a
verified sending domain with SPF and DKIM before any of this works — that is
configuration, not code, and it gates the companion spec's member verification mail as
much as it gates sign-in.

**Required before the operator role ships:**

1. Wire the transport behind the existing `sendMail` seam, so tests keep injecting a fake
   and nothing else in the codebase learns the provider's name.
2. And regardless, fail closed at boot, in the same shape as the two guards already in
   `api/src/app.js` (`sessionSecret` :58-62, `platformHost` :65-68) — resolve the
   transport from **env, inside `buildApp`**, exactly as `stripeKey` is resolved at
   :84-88:

   ```js
   const mail = opts.sendMail ?? transportFromEnv() ?? (isProd ? null : consoleFallback)
   if (!mail) throw new Error('no mail transport')
   ```

   Guarding on `opts.sendMail` alone would throw on a correctly configured production
   boot — it is the test injection seam, not the configuration.

Seed an operator account only under `NODE_ENV === 'test'`. In dev, grant the role with a
one-off script or by hand in psql — no such CLI exists today, and a self-serve route that
grants the operator role is a privilege-escalation hole by construction.

---

## 3. Mechanism: admin is derived, never stored

`sweepResolver` is already registered as a **global** preHandler (`api/src/app.js:96`),
ahead of every route-level guard. It gains one comparison:

```js
req.role = req.account?.id && req.account.id === row.accountId ? 'admin' : 'member'
```

`req.account` comes from a memoized read of `x-account-token` against
`account_session ⋈ account`. **No header means no query**, so a member request costs
exactly what it costs today.

The sweep cookie goes back to carrying membership only — a list of sweep ids, no roles.
Member *identity* (which person you are) is a separate credential in its own cookie; see
the companion spec §4.0. Nothing person-shaped goes back into this one.

### Why not mint admin into the cookie

The alternative was to prove account ownership once and write an `id:admin` cookie entry,
leaving the resolver untouched. It fails on inspection. Its "keep the admin role you
already proved" step reads the prior role out of the cookie and re-mints it with a fresh
`maxAge` — and the credential that route consumes is the **member** token, the one pasted
into the group chat. Any browser profile that ever held admin could renew admin
indefinitely, with no account, surviving account sign-out. The SPA would do it
automatically on every reconnect.

Derived admin has three properties the minted variant cannot get:

- Revoking an account session revokes admin **immediately**, not within 8 hours.
- The admin routes are CSRF-proof by construction: the credential is a header, not a
  cookie, so a cross-site form post carries no authority.
- There is no stored authority that can disagree with the database.

### What `requireSweep(['admin'])` becomes

- `requireSweepMember` — the session holds this sweep.
- `requireSweepAdmin` — `req.account?.id === req.sweep.accountId`.

---

## 4. Password authentication

**Schema.** `account.password_hash` (nullable — existing accounts keep working on magic
links alone) and `account_session.via` (`'link' | 'password'`, default `'link'`).
`account_session.created_at` already exists. `bcryptjs` is already a dependency and
already wrapped in `api/src/auth.js` (`verifyPasscode`); add `hashPassword` /
`verifyPassword` beside it rather than introducing a second bcrypt idiom.

**Routes.**

| Route | Guard | Body → Response |
|---|---|---|
| `POST /api/account/password/session` | none | `{email, password}` → `201 {accountToken, account}` — the same body the magic-link redeem returns, so nothing downstream changes. `401 {error:'bad_credentials'}` otherwise. Rate-limited 10 / 15 min. |
| `POST /api/account/password` | `requireAccount` | `{password, current?}` → `204`. `401 bad_credentials` on a wrong `current`, `403` when `current` is required and absent. |
| `DELETE /api/account/session` | `requireAccount` | → `204`. Signs out this device. |
| `DELETE /api/account/sessions` | `requireAccount` | → `204`. Signs out everywhere. |

`GET /api/account` gains `hasPassword: boolean` so the UI knows whether to offer *set*
or *change*.

**Constraints that are not arbitrary.**

- Unknown email and wrong password must return an identical 401, and the handler must run
  a bcrypt compare against a dummy hash **whenever no usable hash is found** — no
  account, *or* an account whose `password_hash` is NULL. Restricting the dummy compare
  to "no account" leaks, via response time, which addresses have accounts but no password.
- Password length 10–72 **bytes**. bcrypt silently truncates past 72; the cap is real.
- **Setting a password when one already exists requires `current`, unless the session was
  minted by a magic link within the last 15 minutes** (`via = 'link'` and
  `created_at > now - 15m`). That exemption is what makes magic-link recovery actually
  recover: without it, forgetting your password is unrecoverable, since the reset path
  would demand the password you forgot.
- Send a notification mail on any password set or change.

**Why session revocation ships in the same change.** `account_session` rows are written
on redeem and deleted only by the daily expiry sweep (`api/src/accounts/auth.js:11`).
There is no logout route, no session list, no "sign out everywhere". The token lives 90
days in `localStorage`. After this spec it also confers admin over every owned sweep — so
the change that widens the credential is the change that must make it revocable.

---

## 5. The platform-owner role

**Schema.** `account.role`, defaulting to a normal user. `requireOperator` beside
`requireAccount`. No new table for the role itself.

**Can:** list every sweep and account; correct a fixture score; force a competition
resync and read sync failures; **archive and unarchive** a sweep.

**Cannot:** open a sweep as its members; read picks, chat, wagers or the ledger; touch
billing.

**Enforced how.** The operator sweep listing must stop returning `memberToken` or any
link built from it. `GET /api/super/sweeps` currently spreads `links(app, r)`
(`api/src/routes/sweeps.js:109`, built at :48-51), and a live member token in the
operator's console *is* the ability to open any sweep as its members — un-audited,
because joining is an ordinary member action. Return id, name, competition, owner account
id and lifecycle state; nothing that grants entry. `stripeCustomerId` goes too: billing
is on the Cannot list.

**Audit.** A row per operator action recording **actor, action, target and the affected
sweep ids**. Three corrections to what exists today:

- `api/src/corrections.js` writes a `sync_log` row carrying the reason but **not the
  acting account**. Add it.
- A score correction reverses settlement and re-runs `settleBets`, `grantMatchRewards`
  and `recomputeStandings` for the **whole competition** — every sweep following it. An
  operator forbidden from *seeing* wagers can therefore move every member's coin ledger
  in every customer's sweep. That is a decided power, but the audit row must record which
  sweeps were affected — one `selectDistinct` away. The route keeps its fixture-scoped
  path and body (`POST /api/super/fixtures/:id/correct`, `api/src/routes/sweeps.js:168`);
  only its guard and its audit row change.
- **Forced resync is the larger power, not the smaller one.** `syncBaseline` upserts
  score/status straight from the provider (`api/src/worker/baseline-sync.js:146-158`), so
  it silently reverts a manual correction; and its prune arm deletes support rows, bets,
  parlays (with refund ledger rows) and coin-ledger rows for any fixture the provider
  stops returning — across every sweep on that competition. It gets its own audit row and
  its own confirmation, and it is not the correction route.

---

## 6. Five things that must ship with the deletions

Each was found by adversarial review, not invented afterwards.

1. **Old admin links must degrade, not die.** `adminLink` is literally
   `memberLink + /admin/<adminToken>` (`api/src/routes/sweeps.js:49-50`), so
   `/g/<mem>/admin/<adm>` still contains a valid member token at segment 1. Without a
   change, `parseJoinLink` returns null, `joinFromLocation` returns before its `finally`,
   and the holder lands on the marketing page — with a dead but secret-shaped token left
   in the address bar, browser history and any outbound `Referer`. Fix: drop the
   4-segment branch and return `seg[1]`, so an old admin link silently becomes that
   sweep's member link and the URL is stripped as always.

2. **The cookie parser must tolerate the legacy `id:role` form.** A live cookie value
   `sw_a:member,sw_b:member` parsed as bare ids yields the ids `"sw_a:member"` and
   `"sw_b:member"`, which match nothing — every live session 401s on deploy. Fix:
   `v.split(',').map(p => p.split(':')[0]).filter(Boolean)`. Ids are base62 `sw_…` and
   never contain `:`, so this is total.

3. **Liveness must be checked *inside* the re-homed owner handlers.** Narrowing
   `EXEMPT_PREFIX` gates nothing on `PATCH /api/account/sweeps/:id`, because
   `readOnlyGate` returns at `!req.sweep?.accountId` (`api/src/sweeps/read-only.js:11`)
   before it ever reaches the exemption list — and an account-console request carries no
   sweep cookie, while one that does carry a cookie resolves the *most-recently-used*
   sweep (`api/src/sweeps/resolve.js:17-18`), not the one named by `:id`. So:
   **call `sweepLiveNow(app, row)` in each new owner handler**, against the row named by
   `:id`, after the ownership select.
   Narrowing the prefix is defence in depth only — and when narrowing it, the allow-list
   must cover everything that authenticates or provisions: `/api/account/login`,
   `/api/account/session`, `/api/account/sessions`, `/api/account/password`,
   `/api/account/billing`, `/api/account/sweeps`. Omit any of those and a stale member
   cookie for a lapsed sweep blocks the owner from signing in at all. The gate only sees
   mutating methods (`read-only.js:3`), so no GET needs exempting.

4. **Owners must not need a member cookie.** A new phone opening a bookmarked `/s/<id>`
   gets *"this sweep needs its invite link"* — told to the person who owns it. The sweep
   cookie is 8 hours against a 90-day account session, so this is the common case. Fix in
   the Gate's 401 branch: if an account token exists and the wanted sweep is in
   `getAccountSweeps()`, navigate to that row's member link and let the existing join
   flow do the rest.

5. **Do not fold `x-account-token` into the shared request helper.** Attaching it to every
   call the member SPA makes turns a 90-day credential into an ambient one: on a shared
   browser, whoever opens the sweep next silently holds admin over every sweep the owner
   owns. Attach it to the admin and operator calls only, and add `/api/admin` and
   `/api/super` to the service worker's `excludePaths` so the moderation queue is not
   cached past sign-out.

---

## 7. Implementation order

Both candidate designs assumed the four deletions had to land as one commit. They do not.
The load-bearing fact: on today's resolver, a request arriving with a signed
`default:member` cookie and one arriving with nothing produce **byte-identical**
responses — verified directly, which makes the test-plumbing step provably inert.

Steps 1 and 3 were applied and run during design (**462/462, zero edits to existing
tests**) — step 1 *including* the billing state called out below, without which it is not
green.

| # | Step | Green by |
|---|---|---|
| 1 | Seed an owned sweep: an `account` row **with `subscriptionStatus: 'active'`**, and `memberToken` + `accountId` on the seeded sweep. Keep `id: 'default'` and keep `kind`. | Suite unchanged |
| 2 | Test helper (`memberCookie`, `ownerHeaders`) + mechanical cookie plumbing. No src changes. | Provably inert |
| 3 | Account-derived admin, **additive** — the capability link and passcode still work. | Suite unchanged |
| 4 | Mail transport (§2), `account.role`, `requireOperator`, the audit row. | New tests only |
| 5 | Move the admin and super tests onto account sessions and the operator guard. No src changes. | Both credentials still live |
| 6 | Re-home the owner capabilities the deletions would destroy: `PATCH /api/account/sweeps/:id`, member-link rotation — each calling `sweepLiveNow` per §6.3. | New routes |
| 7 | **The deletion** — resolver fork, `constants.js`, passcode, `POST /api/super/session`, the super cookie and `requireSuper`. The remaining `/api/super/*` routes keep their paths and move onto `requireOperator`; the unarchive at `api/src/routes/sweeps.js:160` must survive the move or archive becomes irreversible for everyone. | Steps 1–6 make this green |
| 8 | Drop `admin_token`; stop reading the cookie role. | Migration run against a real DB, not only the test container |
| 9 | Web, in six commits after step 3 lands. | `npm test -w web` after each |

**Why step 1 needs the subscription state.** `sweepIsLive` short-circuits to true only
while a sweep is accountless (`api/src/accounts/billing.js:12` — "ops sweep … exempt").
Give the seeded sweep an `accountId` whose account has neither `subscriptionStatus` nor
`trialEndsAt` and it returns false, `readOnlyGate` stops short-circuiting, and every
sweep-scoped write in the suite 403s. `global-setup.js` seeds that one sweep for all 80
test files, so the blast radius is the whole suite.

**`sweep.kind` stays.** Dropping it breaks `POST /api/account/sweeps` (the only remaining
way to create a sweep), takes the seed down with it, and costs 17 test files of fixture
churn for a column nothing will read. Delete the three guards that use it; leave the
column.

**Do not set `sweep.account_id NOT NULL` in this migration.** `drizzle-kit` emits no data
statements, so it aborts on any dev database that has been seeded. The orphan source dies
in step 7; the constraint buys nothing after that.

---

## 8. Non-goals

- **Owner unarchive.** Today only the *operator* can undo an archive
  (`POST /api/super/sweeps/:id/unarchive`, `api/src/routes/sweeps.js:160`); the owner has
  archive (`api/src/routes/account.js:153`) and no way back. The operator path also never
  calls `syncQuantity`, unlike the owner's (`account.js:160-162`) — though the over-count
  self-heals at the next daily `reassertQuantities` (`api/src/worker.js:65`), so the
  billing exposure is at most a day. Deferred by decision; the fix is ~6 lines against an
  ownership filter that is already written.
- **Co-admins, admin transfer, per-sweep membership tables.**
- **Shortening the account session TTL.** Considered; kept at 90 days.
- **2FA, password strength meters, lockout beyond the existing rate limit.**
- **Member identity.** Companion spec.

---

## 9. Testing

- **Password:** set requires `current` once one exists, *except* on a magic-link session
  younger than 15 minutes; wrong password and unknown email are indistinguishable in body,
  status and timing — including for an account whose `password_hash` is NULL; a password
  login mints a usable session; a magic link still works on an account that has one.
- **Revocation:** `DELETE /api/account/session` invalidates that token and no other;
  `DELETE /api/account/sessions` invalidates all of them.
- **Derived admin:** the owning account's token yields `admin` on its own sweep; a
  *different* account's token yields `member` and 403 — the test that proves the check is
  per-sweep and not a per-account flag; no header falls back to member.
- **Operator:** a non-operator account gets 403 on every `/api/super/*` route — an
  assertion the stateless super cookie could never express; the sweep listing contains no
  member token, link or `stripeCustomerId`.
- **Deletions:** an anonymous cookieless request to a sweep-scoped route is 401, not
  200-as-member; `POST /api/admin/login` is 404.
- **Cookie compatibility:** `parseSweepCookie('sw_a:member,sw_b') === ['sw_a','sw_b']`.
- **Read-only:** a lapsed owner's `PATCH /api/account/sweeps/:id` returns
  `sweep_readonly` — pinning the in-handler `sweepLiveNow`, not the prefix list.
- **Web:** an old `/g/<m>/admin/<a>` link resolves to the member token; the Gate uses the
  owner path before the stored-token path.

Baselines at time of writing: api 80 files / 462 tests, web 49 files / 562 tests.
