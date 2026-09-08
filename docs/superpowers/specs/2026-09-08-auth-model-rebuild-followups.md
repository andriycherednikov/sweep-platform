# Auth Model Rebuild — deferred follow-ups

**Status:** the auth rebuild shipped; these are what its final whole-branch review
triaged as safe to leave. None blocks anything. Kept in the repo because a scratch
directory is not a record — the one blocker the review found was fixed before merge.

Branch `auth-model-rebuild` (28 commits, `08be77d..1d42e54`). One list, covering both
the controller's deferred-minor ledger and the items raised in the whole-branch review.

**16 items · 1 fix before merge · 12 fine to defer · 3 already fixed (no action).**

The one blocker is not in this table — it is Important 1 from the review, restated at the
bottom so this file stands alone.

| # | Item | Triage | Reason |
|---|---|---|---|
| 1 | `requireOperator` shadowing the imported `account` table | **Already fixed — no action** | `api/src/accounts/auth.js:29` binds `const signedIn = requireAccount(app)`; the table import is not shadowed. Task 10 did land it. On the record as verified. |
| 2 | Unused `ownerHeaders` import in `operator-role.test.js` | **Already fixed — no action** | Not unused: `api/test/operator-role.test.js:39` and `:44` both call it. The ledger entry was wrong. |
| 3 | Redundant account re-select in the set-password handler | **Already fixed — no action** | `api/src/routes/account.js:121` uses `req.account`. The remaining select at `:126` fetches the *session* row for `via`/`createdAt` and is load-bearing. |
| 4 | `/api/account/sessions` redundant in `EXEMPT_PREFIX` | **Fine to defer** | Verified redundant, not unsafe: all 51 registered paths checked against the eight prefixes in `api/src/sweeps/read-only.js:9-10`, every `startsWith` hit is an intended exemption, and the gate returns early anyway unless `req.sweep?.accountId` is set (`read-only.js:14`). |
| 5 | `adminHeaders()` in `web/src/api/client.js:122` serving owner + operator calls | **Fine to defer** | Naming only — the header it attaches (`x-account-token`) and the call sites are both correct; rename to `accountHeaders()` in a later pass. |
| 6 | Operator console renders "Sign in required" for any non-403 | **Fine to defer** | `web/src/screens-super.jsx:120` — misleads only when the server is down, for an audience of one operator with a network tab. |
| 7 | `PATCH /api/super/sweeps/:id` outside the spec's operator Can-list | **Fine to defer — decide with #12** | Audited, not an entry path, and `patchBody` is `additionalProperties: false` so it cannot touch `accountId` or `memberToken`. Resolve by amending spec §5's Can-list to what shipped: list / correct / archive / unarchive / rename. |
| 8 | Password-change session delete throwing after the password already changed | **Fine to defer** | `api/src/routes/account.js:145-153` — needs the DB to die between an `UPDATE` and a scoped `DELETE` on the row just written. Cheap hardening when convenient: wrap the delete + mail in try/catch and still return 204, since the password did change and a 500 is the more misleading answer. |
| 9 | `row.kind === 'default'` guards on super archive/unarchive, plus the web mirror | **Fine to defer** | `api/src/routes/sweeps.js:106,129` and `web/src/screens-super.jsx:64` — spec §7 said to delete these, but every sweep created since is `kind: 'token'`, so they are dead in production and only shield the seeded dev row. |
| 10 | `canModerate` returning true for `sweep?.id === 'default'` | **Fine to defer** | `web/src/data.js:65`, with a stale comment about a PIN that no longer exists — UI-only, since the server still 403s; it merely offers a Moderation entry to members of the seeded sweep. |
| 11 | `SuperRoot.jsx` passing a dead `autoToken` prop; stale "SUPER cookie" comments | **Fine to defer** | `web/src/SuperRoot.jsx:12,22` — `SuperConsole` no longer accepts the prop, so it is inert; `web/src/lib/superRoute.js` and both header comments still describe a credential that was deleted. |
| 12 | No documented way to grant `account.role='operator'` | **Fine to defer** | Matches spec §2 ("by hand in psql — no such CLI exists today"), so nothing is missing, but it is undiscoverable on a fresh deploy; one comment line in `docker/.env.docker.example` fixes it. |
| 13 | `bootstrapJoin.js` destructuring a `role` the API stopped returning | **Fine to defer** | `web/src/lib/bootstrapJoin.js:21` reads `role` from `POST /api/session`, which now returns `{ sweepId }` only (`api/src/routes/sweeps.js:59`); harmless because `addSweep` preserves prior values, but the JSDoc at `:12` documents a dead response shape. |
| 14 | Untested NULL-`password_hash` timing case | **Fine to defer** | Spec §9 asks that such an account be indistinguishable from an unknown email; the code handles it (`api/src/routes/account.js:100`, `acc?.passwordHash ?? DUMMY_HASH`), but `api/test/account-password.test.js:42` only covers unknown-vs-wrong. |
| 15 | `sweeps-isolation.test.js:44` naming a resolver that no longer exists | **Fine to defer** | Test name "default-host bootstrap returns only the default sweep people" — the assertion is still correct, only the title references the deleted Host-header fork. |
| 16 | 15 test files still sending `host: 'platform.test'` | **Fine to defer** | Ignored by the server since the resolver fork was deleted; batching the cleanup is the right call. Correction to the ledger: **0** files still pass a `platformHost` option to `buildApp`, not 25 — that half is already done. |

---

## Not in this table: the one fix-before-merge

**`hasPassword` is read on a response that never carries it.**
`api/src/routes/account.js:83` returns `account: { id, email, name }`;
`web/src/AccountRoot.jsx:273` branches on `account?.hasPassword`. Always `undefined`, so
the set-password card shows after *every* magic-link sign-in. Web tests are green only
because `web/src/AccountRoot.test.jsx:8` mocks `redeemLogin` to return `hasPassword: true`
— a shape no server sends (`web/src/lib/accountClient.test.js:52` asserts the honest one).

Do **not** fix this server-side alone: that always-on card is the only change-password UI
in the app (`setPassword` has no other call site), so patching the response would leave no
way to change a password at all. Fix: delete the dead branch at `AccountRoot.jsx:273`, show
the card unconditionally, and reword it to read for set-or-change — the ≤15-minute link
grace at `account.js:127` makes the two identical server-side.
