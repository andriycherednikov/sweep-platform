# Multi-sweep Plan B — frontend, consoles & infra (design)

> Companion to the parent design **`docs/superpowers/specs/2026-06-13-multi-sweep-tenancy-design.md`**.
> Plan A (backend tenancy) is **merged to `main`** (`4a79bdc`) and **deployed**. This doc
> captures the Plan B decisions: the device-side frontend, the two admin consoles, the
> rename/un-archive backend gaps, and the platform Caddy block. Where this doc deviates from
> the parent spec it says so explicitly and gives the rationale.

## Goal

Make the merged tenancy backend usable end-to-end **without curl**: a person opens a
capability link → joins a sweep → sees scoped data; a group admin runs their sweep (people +
the draw + moderation); the platform owner mints/manages sweeps from a console. The existing
community on the **default host** behaves exactly as today.

## Relationship to the existing backend (what already exists)

Plan A shipped the entire HTTP surface Plan B consumes:

- **Session:** `POST /api/session` (token → signed `sweep_session` cookie `{sweepId,role}`, 8h),
  `POST /api/session/logout`, `GET /api/whoami` (`{sweepId, role}`).
- **Super:** `POST /api/super/session` (token → `sweep_super` cookie), `GET /api/super/sweeps`,
  `POST /api/super/sweeps`, `POST /api/super/sweeps/:id/rotate`, `.../archive`.
- **Group-admin:** `POST`/`DELETE /api/admin/people`, `POST`/`DELETE /api/admin/ownership`,
  full photo moderation (`/api/admin/photos*`).
- **Scoped reads/writes:** bootstrap, people, teams, fixtures, social, photos all sweep-scoped;
  `/api/stream` SSE sweep-filtered server-side (no client change needed).

**Gaps Plan B fills (new backend, slice B):** no rename (sweep or person), no un-archive.

## Decisions

### D1 — Host fork (default vs platform)
The client distinguishes the two hosts via `GET /api/whoami`, not via baked-in config.

- **Default host** (`sweep.andriycherednikov.com`, `sweep.yowiebay.au`): **unchanged**. Anon =
  `member`; admin via the existing 4-digit-PIN `POST /api/admin/login`. The current community is
  not touched.
- **Platform host** (`worldcupsweep.yowiebay.au`): role comes from the `sweep_session` cookie
  minted by the capability link. No PIN. `AdminScreen` branches on host.

`whoami` returning `{sweepId:null, role:null}` ⇒ platform host with no session ⇒ the "pick a
sweep" landing (D5).

### D2 — Cookie-scoped-at-root (deviation from parent spec §7 base-path)
**Parent spec** proposed carrying a `/g/<token>` base path through routing. **Plan B instead
strips the token after exchange and serves the platform app at `/`, scoped by the cookie.**

- `main.jsx` intercepts `/g/<token>` and `/g/<token>/admin/<token>` **before** `SweepProvider`,
  `POST`s the token to `/api/session`, then `history.replaceState` to strip the token.
- After exchange the platform host serves the SPA at `/`; deep links are plain (`/teams/ar`),
  scoped by the cookie. No base path threads through `urlFor`/`readView`.
- **Trade-off (accepted):** a bare deep link resolves only if the device already holds the
  cookie; otherwise it falls through to the "pick a sweep" landing. The `/g/<token>` link is the
  join/bootstrap URL; the bare host URL is the everyday URL. Rationale: avoids base-path
  complexity across all of routing for a marginal deep-link-sharing benefit.

### D3 — Per-sweep device identity
`ME_KEY` (`sweep.me.v1`, a single device-global person pointer) becomes **per-sweep**:
`sweep.me.v1.<sweepId>`. A one-time migration copies an existing `sweep.me.v1` value to
`sweep.me.v1.default` on first load so current community users keep their "me" pick. Without
this, identity bleeds across sweeps.

### D4 — "My sweeps" switcher
New per-device store `sweep.sweeps.v1` = `[{sweepId, name, role, token}]`, appended when the
device joins a sweep (role from `whoami`, **name from `bootstrap`** — see D7a, token from the
link). Switching
re-`POST`s the stored token to `/api/session`, then `invalidateQueries(['sweep','social'])`
(the same mechanism `useEventStream` already uses). Surfaced in the Sidebar footer (next to
`IdentityControl`) and a new `sweeps` overlay route in `App.jsx`. Token storage trust = same as
holding the bookmark (parent spec §7); note the store may persist an admin token if an admin
link was opened on the device.

### D5 — Platform "pick a sweep" landing
On the platform host with no/expired session: if `sweep.sweeps.v1` has entries → render the
switcher list (tap to re-join). If empty → a "you need an invite link" empty state. This is the
`Gate` (`SweepProvider.jsx`) 401 branch, distinct from the generic network-error state.

### D6 — Super-admin console
New `/super` overlay on the platform host: token prompt → `POST /api/super/session` → super
cookie → list / create / rotate / archive / **un-archive** sweeps. Create surfaces copyable
`memberLink` + `adminLink`. Also accept a `/super/<token>` auto-submit secret-link form.
Rotation UX must note the ≤8h tail (parent spec §13): the old link keeps working until existing
cookies expire.

### D7 — Backend additions (slice B, TDD, scoped guards)
- `PATCH /api/super/sweeps/:id` — body `{name?, scoringRule?, coOwners?}`; `requireSuper`;
  refuses unknown id (404). Returns the updated row.
- `POST /api/super/sweeps/:id/unarchive` — clears `archivedAt`; `requireSuper`; 404 if not
  found. (Mirror of the existing archive route; refuses `kind==='default'` like archive does.)
- `PATCH /api/admin/people/:id` — body `{name?, short?, initials?}`; `requireSweep(['admin'])`;
  scoped to `req.sweep.id`, 404 if the person is not in this sweep. Returns the updated person.

### D7a — `bootstrap` returns the sweep's display name (field, not a new endpoint)
`GET /api/bootstrap` is extended to include the current sweep's `name` (e.g. `scoring` becomes
`{rule, coOwners}` and a sibling `sweep:{id, name}` is added, or a flat `sweepName`). This is the
single source the device captures into `sweep.sweeps.v1` (D4) at join time so the switcher can
label sweeps by name rather than raw `sw_…` id. Backward-compatible additive change; the default
sweep returns `{id:'default', name:'The Sweep'}`.

## Slices (independently shippable; suite green per commit)

| Slice | Scope | Layer |
|---|---|---|
| **0** | `credentials:'include'` on public fetchers; `postSession`/`fetchWhoami`/`postLogout` client calls; `bootstrap` returns sweep `name` (D7a) | web/api |
| **1** | Capability-link interception (`/g/<token>[/admin/<token>]`) + `Gate` 401 "pick a sweep" state | web |
| **B** | The three rename/un-archive endpoints (D7) | api |
| **2** | Per-sweep identity migration (D3) + "my sweeps" switcher (D4) | web |
| **3** | Group-admin console: people CRUD + ownership "draw" + moderation; host-aware auth (D1) | web |
| **4** | Super-admin console (D6) | web |
| **5** | Caddy `worldcupsweep.yowiebay.au` site block; deploy after DNS | infra |

"The draw" = manual one-by-one team→person assignment via `POST /api/admin/ownership`. There is
**no** automated draft endpoint and Plan B does not add one (YAGNI; co-ownership model, parent
spec). The `DRAW` constant in `social.js` is an unrelated group-stage tie result.

## Data flow (platform host, happy path)

1. Member opens `https://worldcupsweep.yowiebay.au/g/<memberToken>`.
2. `main.jsx` `POST /api/session {token}` → `Set-Cookie: sweep_session` → `replaceState('/')`.
3. `SweepProvider` `Gate` runs `['sweep']`/`['social']` queries with `credentials:'include'` →
   scoped `bootstrap`/`fixtures`/`social`/`photos` for that sweep.
4. Device appends `{sweepId,name,role,token}` to `sweep.sweeps.v1` (name from the extended
   `bootstrap`, D7a); identity reads `sweep.me.v1.<sweepId>`.
5. SSE `/api/stream` is already sweep-filtered; no client change.

## Testing strategy

- **api:** new tests for the three slice-B endpoints (rename sweep, un-archive, rename person) —
  auth (super/admin), scoping (404 cross-sweep), happy path, default-sweep refusal where it
  mirrors archive; plus an extended `bootstrap` test asserting the sweep `name` is present (D7a).
  Keep the full suite green.
- **web:** client (creds present, `postSession`/`fetchWhoami`/super calls), link interception +
  token strip, `Gate` 401 → "pick a sweep", switcher store + per-sweep identity migration,
  group-admin people/ownership UI, super console list/create/rotate/archive/un-archive, host-fork
  branching in `AdminScreen`.

## Risks / open items

- **Host detection** relies on `whoami`; there is no client `PLATFORM_HOST` config — confirm the
  client never needs to know the host name itself (it shouldn't; it only needs role/sweepId).
- **Identity migration** is a silent localStorage reshape — ship it before the switcher so the
  default value is preserved.
- **Token in localStorage** persists admin tokens for admin links; acceptable per parent spec but
  worth a note in the switcher UI ("this device can admin this sweep").
- **Rotation tail** (≤8h) must be surfaced in the super console so the operator isn't surprised.
- **Caddy/`PLATFORM_HOST` ordering:** `PLATFORM_HOST` already set on the server; the Caddy host
  block can only be added once DNS for `worldcupsweep.yowiebay.au` resolves (ACME).

## Deferred (not Plan B)

- Automated draft/draw mechanic. Member accounts (members remain a cookie role, no accounts).
  Per-route rate limiting beyond the existing session/login routes. Hard-delete of a sweep.
