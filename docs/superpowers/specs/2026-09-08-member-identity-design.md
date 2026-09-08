# Member Identity — Self-Setup, Verified Seats, a Locked Roster

> **SUPERSEDED (2026-09-08) by the account-identity build on `auth-model-rebuild`.**
> The decision changed: a member gets a real `account`, the same row an owner gets, and
> role stays per-sweep and derived — one human can own sweep A and merely play in sweep B.
> So §4.0–§4.3 (the `sweep_claim` cookie, `person.claim_token`, one-seat-per-device,
> self-release/revoke) and §6 (`roster_locked_at`) were **not built**; a six-digit code
> proves the address, `person.account_id` binds the seat, and `person.ejected_at` is the
> single removal verb.
> What survives and was built: §2's refusal to distribute per-person credentials (invites
> carry the group link), §4.4's rule that only the owner's verb clears `excludedUntil`
> — pending, see below — §5's list of live defects (all closed), and §9's test plan.
> Still open from §4.4: owner release does not yet clear `excludedUntil`.

**Status:** Superseded. Design was approved in conversation 2026-09-08 and reviewed
adversarially against the codebase; findings folded in.
**Depends on:** `2026-09-08-auth-model-rebuild-design.md`. That spec settles the resolver
and the cookie shape this one extends, and wires the mail transport this one requires.

**Goal.** Make a person in a sweep a thing the server knows, instead of a string in the
browser's `localStorage`. Today identity is self-declared and the server takes the
client's word for it, so any member can act as any other member — and one of those
actions cannot be undone by anyone.

---

## 1. What was decided

| Question | Decision |
|---|---|
| How a person joins | **Self-setup.** The owner posts one link. Each person opens it and enters their own name and email. |
| What locks a **self-setup** seat | **Email verification.** The seat binds to the device only once that address is verified. |
| What locks an **owner-typed** seat | **The first claiming device.** No email is involved — the owner vouching for the name *is* the verification. |
| Before verification | The row exists but the seat is **provisional**. The owner can release these. |
| Seats per device per sweep | **One.** |
| Fixing a wrong claim | **Self-release** by the holding device, plus owner release. |
| Leavers | A **second verb** — revoke — that kills the seat rather than freeing it. |
| Roster lock | The owner can **lock the sweep** so no more members are added. Team allocation implies locked. |
| Removing people from a locked sweep + reallocating their teams | **Not initially.** §8. |
| Owner-typed people | **Still supported** — the kid, the person who will not click a link. |

---

## 2. Why this shape, and not emailed invite links

Three variants were designed and attacked. Both adversarial passes independently reached
the same verdict: bind at first contact, never distribute a per-person credential.

**Per-person links, delivered however the owner likes,** offer exactly one zero-effort
distribution path — copy all twenty, paste into the group chat. That hands every member
all twenty seats, permanently, in searchable chat history. It is not a weakening of the
binding; it is a total reversal, and it is worse than today, because a signed bearer
credential replaces a `localStorage` pointer the server will soon ignore. Remove that
path and what remains is twenty direct messages — which is the loop this product depends
on, deleted.

**Emailing a link per person** puts an address-collection step in front of the link. The
organiser does not have twenty addresses in their head; they would have to ask twenty
people, in a pub, and type them correctly. Worse, the failure mode is invisible: twenty
near-identical messages with unique long URLs, fired simultaneously from a domain with no
sending reputation, some fraction of which bulk-folder. The organiser's roster shows
"sent, not claimed" for the spam victims *and* for the six people who are simply busy,
and cannot tell them apart.

Both link variants also share a mechanical defect. The device's stored token is one slot,
last-write-wins (`web/src/sweeps.js:40-48`). Opening the pinned group link overwrites a
personal claim token, so the next cookie expiry silently un-claims the device.

**Self-setup keeps the loop exactly as it is today** — one link in a group chat — while
moving identity to the server. Nothing is distributed per person, so there is nothing to
forward, screenshot, paste into the wrong thread, or leave in a shared iPad's inbox.
Email is present, but as *verification and recovery*, volunteered by each person, not as
a delivery channel the organiser has to feed.

---

## 3. The flow

```
owner posts ONE link              /g/<memberToken>          (unchanged)
  → person opens it
  → enters name + email           person row created, seat PROVISIONAL
  → verification mail sent
  → person clicks the link        seat LOCKED to this device
owner runs the draw                                          (unchanged, owner-only)
```

**Provisional vs locked.** A provisional row participates in nothing that can affect
anyone else: it cannot bet, pick, opt out, or upload. It exists so the roster fills up
during the draw night and so the owner can see who is mid-signup. Locked seats are the
real membership.

**The owner still types names.** Self-setup is additive. An owner-typed row is a full
member from creation — it is *not* provisional — and locks to the first device that
claims it. Because that lock needs no email, the burst attack §4.1 defends against is
possible only against owner-typed rows; §4.1 is what makes it survivable.

**Minors.** `person.adult` already exists because children play. A child with no address
stays an owner-typed row, and their adult operates it by *claiming* it — which, under one
seat per device, means swapping off their own seat and back (§4.2). No session ever acts
as two people; the wagering gate still reads the flag on whichever person the session
holds. If the swap proves annoying in practice, multi-seat is the fix, and it is a
non-goal until someone complains (§8).

**Limits.** Anyone holding the group link can make our domain send mail to an address of
their choosing. §2 identifies bulk mail from a cold domain as the thing that kills this
product, so self-setup is rate-limited per IP (`config: { rateLimit: { max: 10,
timeWindow: '15 minutes' } }`, the shape already used at `api/src/routes/account.js:34`)
and capped at a small number of unverified provisional rows per sweep.

---

## 4. Server-side identity

The mechanism is the point of the whole spec: **`personId` stops being a request
parameter.** Every route that acts as a person derives it from the session and rejects a
request that names anyone else — in the body (`POST /api/support`, `/api/bet`,
`/api/parlay`, `/api/optout`), in the query string (`GET /api/coins`,
`/api/coins/ledger` — `api/src/routes/coins.js:42,55`) or as a multipart field
(`POST /api/photos` — `api/src/routes/photos.js:26-28`).

The four write routes each already run a `select … from person where id = $1 and
sweep_id = $2` for foreign-key safety, so for them the check is an authorisation check on
a query that already exists. The two coins reads take the person id straight from the
query string and do *not* pre-select, so they gain one lookup each — the only measurable
cost in the change.

### 4.0 What identifies a device

A claim mints `person.claim_token` server-side and returns it in a **second signed,
httpOnly cookie, `sweep_claim`**, keyed per sweep (`sw_x=pc_…`).

It is deliberately neither of the two things it could be mistaken for:

- Not the link token — that is `memberToken`, shared by the whole group
  (`api/src/routes/sweeps.js:49`), so it identifies a sweep and never a device.
- Not a field in the sweep cookie — the companion spec's parser keeps the id and drops
  everything after it (auth §6.2), so the sweep cookie has no slot to spare.

`req.person` is resolved from `sweep_claim` against `person.claim_token` scoped to the
resolved sweep. No cookie means no person, which is exactly a provisional or unclaimed
visitor.

### 4.1 One seat per device per sweep

Person ids are handed to every member in `/api/bootstrap`, and marking free seats in the
payload makes "free and adult" a filter rather than a search. Without enforcement, one
bored member taps through the whole roster in a burst and locks every identity, and only
the owner can undo it, one row at a time.

Enforcement: before the conditional insert, clear any **provisional** seat held by this
caller in this sweep. **A locked seat is never cleared implicitly** — claiming a second
name while holding a locked one is refused (409), and the holder must self-release first.
A verified identity leaves a device only deliberately.

### 4.2 Self-release

A mistap on a pub night is certain, several per sweep. The mistapping device *holds* the
claim, so it can prove it owns the seat and hand it back. Without this, a stranded
participant waits on an organiser who is not looking at their phone. This is the
difference between "tap again" and "text the organiser".

### 4.3 Two verbs, one line apart

`release` sets the claim to null — the seat is reclaimable, which is right for a mistap.
`revoke` sets it to a fresh value that is never returned to anyone — the seat is
permanently dead, which is right for someone who left the group. One verb for both cases
hands a departed member's seat to whoever taps their name next.

**Verification is per claim, not per person.** Releasing a seat clears `verified_at`
along with the claim, and any re-claim of a row that carries an email re-sends the
verification mail. The address stays on the row, so re-verification is one tap in that
person's own inbox — and a stranger who taps the name cannot lock it.

### 4.4 Release and `excludedUntil`

**Owner release and revoke clear `excludedUntil`; self-release does not.**

The inherited case — the one worth cleaning up — is a seat claimed by the wrong device
that leaves a permanent exclusion behind, and the owner is the one who unpicks it. Giving
the clearing to the owner verb only is what keeps a genuine exclusion un-launderable: its
holder can self-release and re-claim as much as they like, and the exclusion is still
there.

---

## 4.5 Schema and surface

**Columns** (none of these exist today — `api/src/db/schema.js:18-37` and `:3-16`):

| Column | Type | Meaning |
|---|---|---|
| `person.email` | text, nullable | Owner-typed rows have none. |
| `person.verified_at` | timestamptz, nullable | NULL = provisional. Cleared on release. |
| `person.claim_token` | text, nullable, unique | The device binding. NULL = free; an unmatched sentinel = revoked (§4.3). |
| `sweep.roster_locked_at` | timestamptz, nullable | §6. |

`person.adult` (`schema.js:27`) is reused unchanged.

**Verification tokens get their own table.** `login_token` must not be reused: its redeem
path creates an *account* on first use, which is precisely what a member must not get.

**Routes.**

| Route | Guard | Purpose |
|---|---|---|
| `POST /api/claim` | member session | `{personId}` or `{name, email}` → 201 + `sweep_claim` cookie. Rate-limited (§3). |
| `GET /api/claim/verify/:token` | none | Locks the seat, sets `verified_at`. |
| `DELETE /api/claim` | claim cookie | Self-release (§4.2). |
| `POST /api/admin/people/:id/release` | sweep admin | Owner release; clears `excludedUntil`. |
| `POST /api/admin/people/:id/revoke` | sweep admin | Kills the seat (§4.3). |
| `POST /api/admin/roster/lock` | sweep admin | §6. Unlock is the same route while unallocated. |

---

## 5. Live defects this closes

These exist in the shipped code today. Zero customers, so nothing has been exploited, but
the first is irreversible and worth fixing whatever else happens.

| Route | What a member can do to another member | Reversible? |
|---|---|---|
| `POST /api/optout` | Bar them from Wagering **permanently**. `duration: 'forever'` resolves to a year-9999 sentinel, `extendUntil` only ever lengthens, and there is **no un-exclude endpoint at any role** — member, admin or operator. Database surgery only. | **No** |
| `POST /api/bet`, `POST /api/parlay` | Bet as them, up to their whole balance, broadcast to the sweep in their name. No void or refund path exists outside the operator's score-correction unwind. | **No** |
| `GET /api/coins`, `/api/coins/ledger` | Read their complete wagering history — what they bet, how much, won or lost. | Privacy |
| `POST /api/photos` (`kind=profile`) | With `PHOTOS_AUTO_APPROVE` on: replace their profile photo and **delete the original file from disk**. Moderated (the default): park a pending upload on them, which 409s their own uploads until an admin clears it. | Destructive / DoS |
| `POST /api/support` | Set, flip or delete their pick on any fixture. | Yes, noisy |

**One unrelated fix, same pass.** `POST /api/support` never reads the fixture's status,
so a pick can be set after the result is known. The gate is
`if (row.status !== 'upcoming') return reply.code(400).send({ error: 'fixture_closed' })`
in `api/src/routes/social.js:27-31` — which refuses *live* fixtures as well as finished
ones, because partial information is the same integrity hole. It is one line plus its
cost: four existing `POST /api/support` tests pick fixtures that are not upcoming and
need their fixtures re-selected.

---

## 6. Roster lock

The owner can lock a sweep: no new people, self-setup closed. Running the team allocation
locks it implicitly — a draw over a roster that can still grow is not a draw.

- `sweep.roster_locked_at`, owner-settable both ways *before* allocation.
- After allocation, unlocking is out of scope (§8).
- A provisional row at lock time is dropped, not stranded — it holds nothing.

---

## 7. Ordering

This spec's work is independent of the companion spec's deletions but not of its
foundations. It needs the mail transport (auth §2) and it must land after the sweep
cookie has settled into ids-only (auth §6.2), so that `sweep_claim` is added to a stable
base rather than to a cookie mid-rewrite.

Within this spec: schema and `req.person` resolution first (nothing depends on it yet),
then the route-by-route switch from parameter to session — each route is independently
testable and independently green — then self-setup and verification, then the roster lock.

---

## 8. Non-goals

- **Removing a person from a locked sweep and reallocating their teams.** Explicitly
  deferred. It is a real want and needs its own thinking: their picks, ledger and bet
  history must not leave a hole in the leaderboard.
- **More than one seat per device per sweep.** Real families share one device — the
  seeded roster is full of parent/child clusters — and today one adult operates for the
  whole family with two taps. Every design here is a regression for them. The accepted
  answer is the two-tap swap via self-release; multi-seat waits for a real complaint.
- **Per-person invite links, in any delivery form.** Rejected with reasons in §2.
- **Un-exclude as a standalone route.** Clearing `excludedUntil` happens only on owner
  release or revoke (§4.4), so a genuine self-exclusion can never be laundered through it.

---

## 9. Testing

- **Claim:** a provisional row can do nothing that touches another member; verification
  locks the seat; a second device cannot claim a locked seat; a device claiming a second
  name while holding a *provisional* seat loses the first, and while holding a *locked*
  seat is refused 409.
- **Identity:** every affected route rejects a request naming a different person, in each
  of its three carriers — body, query string and multipart; the ledger and wallet reads
  return only the caller's own.
- **Release vs revoke:** a released seat is re-claimable and re-triggers verification; a
  revoked seat is not claimable by anyone; owner release clears `excludedUntil` and
  self-release does not.
- **Roster lock:** self-setup 404s on a locked sweep; allocation locks implicitly;
  provisional rows are dropped at lock.
- **Regression:** `POST /api/support` refuses a fixture that is not upcoming.
