# Multi-Sweep Tenancy — Design

**Date:** 2026-06-13
**Status:** Approved design, pending plan
**Supersedes for auth/routing:** the single-admin model in the Phase-1 backend spec

## 1. Goal

Let other communities run their own World Cup sweep on the same deployment, fully
isolated from one another and from our existing community sweep, **without passwords**
and **without anyone being able to stumble onto a sweep and corrupt its choices**.

The sweep's core meaning is **"whose team wins it all"**: each person owns one or more
teams; the winner of a sweep is whoever owns the eventual champion. Standings,
leaderboards, win%, reactions, photos, and draw votes are *fun stats* layered on top —
they do not affect the core outcome and are not correctness-critical.

A tenant is called a **sweep** (the term `group` is already taken by World Cup groups
A–H in `team.group` / `fixture.group`).

## 2. Decisions (locked)

1. **Isolation model:** shared tables + a `sweep_id` foreign key on every per-tenant
   table. Global tables stay shared. (Chosen over schema-per-tenant / deploy-per-tenant
   as far simpler for ~mates-sized groups; the live World Cup data is identical for all.)
2. **Two domains, one app/deployment:**
   - **`sweep.yowiebay.au`** — the existing **community (default) sweep**. Resolved by
     **Host header**; the host *is* its capability. Trust model unchanged for its
     members (the bookmark already exists), but other hosts can never surface its people.
   - **`worldcupsweep.yowiebay.au`** — the **platform** for everyone else's sweeps.
3. **Per-sweep routing under the platform domain = secret path token (capability link),
   not subdomains.** `worldcupsweep.yowiebay.au/g/<memberToken>`. Rationale: a path token
   is *not* published to Certificate Transparency logs, is *not* DNS-enumerable, needs no
   wildcard TLS / DNS-API, and cannot be guessed — strictly more private than subdomains,
   with less infrastructure. Subdomains' one real advantage (per-origin cookie isolation)
   is moot under the no-password model.
4. **No passwords.** The secret link *is* the credential. Two tokens per sweep, both
   rotatable: a **member token** and an **admin token**.
5. **Two roles below super-admin:** a per-sweep **group admin** (manages its own people,
   draw, and photos) and **members** (play). A single **super-admin** (platform owner)
   mints and rotates sweeps.

> **Open confirmation:** platform domain assumed `.au` to match the permanent community
> zone (`sweep.yowiebay.au`). Change to `.com` if desired — no design impact.

## 3. Data model

### New table: `sweep`

| column | type | notes |
|---|---|---|
| `id` | text PK | server-generated (nanoid) |
| `name` | text | display name ("Acme Office Sweep") |
| `kind` | text | `'default'` (Host-bound) or `'token'` (link-bound) |
| `member_token` | text unique, nullable | null for the default sweep |
| `admin_token` | text unique, nullable | null for the default sweep |
| `scoring_rule` | text | folded in from `scoring_config` (cosmetic) |
| `co_owners` | text | folded in from `scoring_config` (cosmetic) |
| `created_at` | timestamptz | |
| `archived_at` | timestamptz, nullable | soft archive |

Tokens are ≈22-char base62, generated server-side. The default sweep has no tokens; it
is reached only via its bound Host.

### Add `sweep_id` to every per-tenant table

`person`, `ownership`, `watch`, `support`, `photo` each gain
`sweep_id text NOT NULL REFERENCES sweep(id)`.

`sweep_id` is added even where a row is technically reachable via `person_id`, so **every
per-tenant query filters on one explicit column** rather than relying on a join that is
easy to forget. Rows never move between sweeps, so this denormalization stays consistent;
it is always set server-side from the resolved sweep, never from the request body.

### Co-ownership is intentional — NO one-owner-per-team constraint

**Correction (2026-06-13):** an earlier draft proposed `UNIQUE(sweep_id, team_code)`
("one owner per team per sweep"). That is **wrong and must not be added** — co-ownership
is the core model. With ~45 people sharing 48 teams, every team is owned by 3–5 people,
and `coOwners='all_win'` means co-owners of the winning team all win. The `ownership`
primary key stays `(person_id, team_code)` (prevents the *same* person owning the *same*
team twice); a team may be owned by many people in a sweep. `sweep_id` is added to
`ownership` purely for query scoping, not to enforce uniqueness.

### Person ids

`person.id` stays globally unique and is **generated server-side** (nanoid/prefixed),
never derived from names or chosen by the client — otherwise two sweeps could collide and
overwrite each other.

### Dropped

`scoring_config` (its two fields fold into `sweep`).

### Unchanged / global

`team`, `fixture`, `standing`, `team_crosswalk`, `sync_log`. The provider worker writes
only these; there is no per-sweep worker work and no fan-out.

## 4. Request resolution & auth

### Sweep resolution (one Fastify preHandler)

- **Host = `sweep.yowiebay.au`** → resolve the `kind='default'` sweep. Set `req.sweep`.
- **Host = `worldcupsweep.yowiebay.au`** → resolve the sweep from the **scoped cookie**
  (see below); 404/401 if absent or unknown.
- The default sweep's people/data are served **only** when the Host is the canonical
  community host (hard Host-bind). A Host-binding test enforces this.

### Token → scoped cookie exchange (no passwords)

The secret link is transmitted **once**, then exchanged for a signed, scoped cookie so the
token is not replayed on every request:

```
POST /api/session  { token }
  → look up sweep by member_token (role 'member') or admin_token (role 'admin')
  → set signed cookie  sweep_session = { sweepId, role }   (httpOnly, 8h, like today)
  → 404 if the token matches nothing (rotated/invalid)
```

The existing signed-cookie machinery is reused: the cookie value carries
`{ sweepId, role }` instead of the bare `'ok'`.

### Authorization

A scoped `requireSweep(roles)` preHandler replaces `requireAdmin`:

- **member** cookie → may read and write its own sweep's member-level data
  (watch, support, votes, reactions, identity pick, photo upload).
- **admin** cookie → all member powers **plus** its sweep's admin powers (people CRUD,
  draw, photo moderation).
- A request is authorized only if `cookie.sweepId === req.sweep.id`. A member cookie can
  never hit admin routes; a cookie for sweep A can never act on sweep B.
- The **default sweep** treats a valid canonical Host as member capability (current trust
  model preserved). Its **admin** continues to use the existing env `ADMIN_PASSCODE` login
  on the community host — that login now mints an admin cookie scoped to the default
  sweep's id. No tokens are involved for the default sweep.

### Super-admin (platform owner)

A single env secret (`SUPER_ADMIN_TOKEN`) reached via a secret path
(`worldcupsweep.yowiebay.au/super/<token>`) — password-free, link-based, same spirit.
Super-admin may act on any sweep and is the only role that can mint/rotate sweeps.

### Write-protection (the safeguard)

A random visitor on the platform domain holds no token → gets no cookie → **cannot read
or mutate any sweep**. This is the concrete protection against stumbling-and-corrupting.

## 5. SSE scoping

`/api/stream` events split by audience:

- **Social events** (watch, support, draw votes, reactions) — broadcast only on the
  **sweep-keyed channel**; a sweep never sees another's banter.
- **Global match events** (goals, cards, score/status changes) — broadcast to all sweeps
  (the underlying fixture is global).

## 6. Admin surfaces

### Super-admin console (platform domain, behind `SUPER_ADMIN_TOKEN`)
- List sweeps (name, created, archived).
- **Create sweep** → auto-mints member + admin tokens, shows both copyable links.
- **Rotate** either token (instant revoke of old links).
- **Archive** a sweep.

### Group-admin console (behind the admin link)
- **People CRUD** for this sweep.
- **Run the draw** — assign team → person; one-owner-per-team enforced by the unique
  constraint (clear error on a double-assign).
- **Photo moderation** — the existing approve/reject flow, scoped to this sweep.

## 7. Frontend

- **Context resolution:** on `sweep.yowiebay.au` → default sweep (by Host). On
  `worldcupsweep.yowiebay.au/g/<token>` → strip the `/g/<token>` base, parse existing
  path segments off it, re-prepend it in `urlFor`. Device remembers the last sweep.
- **Session bootstrap:** on a token URL the SPA does the one-time `POST /api/session`;
  thereafter the scoped cookie authorizes all calls (the token is not kept in every
  request path).
- **Identity:** the "pick me" list is drawn from the scoped people list, so members only
  ever see their own sweep's people.
- **"My sweeps" switcher (one browser, many sweeps):** opening any sweep link records that
  sweep locally (`name` + `token` in `localStorage`). A switcher UI lists every sweep this
  browser has joined; selecting one re-runs `POST /api/session` with that sweep's stored
  token, swapping the active scoped cookie. The active cookie always scopes to exactly one
  sweep, so isolation holds. Stored tokens live in `localStorage` (same trust level as
  holding the bookmark) — acceptable for members; the default community sweep has no token
  and is reached by its Host.
- **Referrer hygiene:** keep `Referrer-Policy: strict-origin-when-cross-origin` (already
  set) so the token path is never sent to third-party origins.

## 8. Infrastructure (Caddy)

- Add a `worldcupsweep.yowiebay.au` site block alongside the existing community block;
  both reverse-proxy the **same** `sweep-api` / `sweep-web` containers. The app
  distinguishes them by Host. Add the new name only once its DNS resolves to this host
  (per the existing Caddyfile rate-limit warning).
- No wildcard cert and no DNS-API: each named host gets its own ordinary Let's Encrypt
  cert; per-sweep tokens live in the path under the single platform cert.

## 9. Migration — ordered & loss-free

1. Create `sweep`; insert the default row (`kind='default'`, scoring folded from
   `scoring_config`).
2. Add **nullable** `sweep_id` to `person`, `ownership`, `watch`, `support`, `photo`.
3. Backfill every existing row → the default sweep id.
4. Set `sweep_id` `NOT NULL` + FK; drop `scoring_config`. (No unique index on
   `ownership` — co-ownership is intentional; see §3.)

(Per project note: after `db:generate`, run `db:migrate -w api` against the shared dev DB.)

## 10. Testing (guardrails as hard requirements)

- **Isolation per endpoint:** seed sweeps A & B; assert every read/write for A never
  returns or mutates B's rows.
- **Auth:** no/invalid/rotated token → rejected; a member cookie cannot reach admin
  routes; a cookie for A cannot act on B.
- **Host-binding:** default-sweep people are served only on `sweep.yowiebay.au`.
- **Co-ownership:** two people in one sweep CAN both own `BRA` (and the seed produces
  3–5 owners per team) — assert this is preserved, not rejected.
- **Migration:** existing rows all land in the default sweep with counts intact.
- **SSE scoping:** a social event in A is not delivered to a B subscriber; a goal is
  delivered to both.

## 11. Out of scope (YAGNI)

- Self-serve sweep creation (super-admin mints all sweeps).
- Vanity subdomains.
- Per-member passwords / real per-person identity (within-sweep trust model is retained).
- Cross-sweep features (shared leaderboards, comparisons).

## 12. Scope & phasing

One spec; the implementation **plan** splits in two:

- **Plan A — backend multi-tenancy:** migration, sweep resolution + Host-bind,
  token/session exchange, scoped query helpers, scoping of all data + admin routes, SSE
  scoping, the isolation/auth/constraint/migration tests.
- **Plan B — consoles + frontend:** super-admin console, group-admin people/draw UI,
  frontend context routing + session bootstrap + scoped identity, Caddy platform block.
