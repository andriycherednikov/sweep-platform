# Multi-sweep Plan B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Before applying any task's edit, read the current file** — several shared files are touched by multiple slices, so the line numbers below are indicative of the original tree and will drift as you go. See "Cross-slice reconciliation" before starting.

**Goal:** Make the merged multi-sweep tenancy backend usable end-to-end without curl — capability-link join, a device "my sweeps" switcher, host-aware group-admin and super-admin consoles, and the platform Caddy host — while the existing community on the default host behaves exactly as today.

**Architecture:** Frontend-heavy. Plan A already shipped the backend surface (`/api/session`, `/api/whoami`, `/api/super/sweeps*`, group-admin people/ownership, photo moderation, sweep-scoped reads/SSE). Plan B adds three small backend endpoints (rename sweep, un-archive, rename person), wires the device session into the client, and builds the switcher + two consoles. The client distinguishes default vs platform host via `GET /api/whoami`; the `/g/<token>` link is exchanged for a `sweep_session` cookie and stripped (cookie-scoped-at-root, design D2).

**Tech Stack:** Node 22 + Fastify 5 + Drizzle/Postgres (api); Vite + React 18 + TanStack Query (web); Vitest (+ @testcontainers/postgresql for api, jsdom for web). **Branch:** `feat/multi-sweep`. **Spec:** `docs/superpowers/specs/2026-06-15-multi-sweep-plan-b-design.md` (and parent `2026-06-13-multi-sweep-tenancy-design.md`).

---

## Shared conventions

Defined once; tasks reference these by name.

- **Test commands.** api single file: `cd api && npx vitest run test/<file>`; api full suite: `npm run test -w api` (Docker required — Testcontainers). web single file: `cd web && npx vitest run src/<path>`; web full suite: `npm run test -w web` (jsdom).
- **Commits.** Conventional Commits, **one commit per task**. Scopes: `api`, `web`, `infra`.
- **TDD cadence per task.** Step 1 write the failing test (full code) → Step 2 run it, Expected: FAIL with the specific error → Step 3 minimal implementation (full code) → Step 4 run it Expected: PASS, then the full workspace suite green → Step 5 commit (exact `git add … && git commit -m "…"`). Keep the suite green at every commit.
- **Client functions** (`web/src/api/client.js`), each added in exactly one slice, imported elsewhere:
  - Slice 0: `postSession(token)`, `fetchWhoami()`, `postLogout()`; plus `credentials:'include'` on the public `get`/`post`/`uploadPhoto` wrappers.
  - Slice 3: credentialed helpers `patchCreds(path, body)` / `deleteCreds(path, body)` (first consumer) + `createPerson`, `deletePerson`, `patchPerson`, `postOwnership`, `deleteOwnership`.
  - Slice 4: `postSuperSession`, `fetchSuperSweeps`, `createSweep`, `rotateSweepToken`, `archiveSweep`, `unarchiveSweep`, `patchSweep` (reusing Slice 3's `patchCreds`/`deleteCreds`).
- **Stores.** Switcher: localStorage `sweep.sweeps.v1` = `[{sweepId,name,role,token}]` via `web/src/sweeps.js` — `listSweeps()`, `addSweep(entry)` (upsert by sweepId; keep existing token unless a non-null token is given), `removeSweep(sweepId)`, `switchTo(sweep, queryClient)` (`await postSession(sweep.token)` then `queryClient.invalidateQueries({queryKey:['sweep']})` + `['social']`). Identity: `ME_KEY` becomes per-sweep `sweep.me.v1.<sweepId>`, migrating legacy `sweep.me.v1` → `sweep.me.v1.default`.
- **Cookies / hosts.** `sweep_session` (signed `sweepId:role`, 8h), `sweep_super` (signed `ok`). Default host = sweep.andriycherednikov.com / sweep.yowiebay.au; platform host = worldcupsweep.yowiebay.au. The client never hardcodes a host; it detects platform-no-session via `whoami → {sweepId:null}`.
- **Admin gate (Slice 3).** Pure helper `adminGateState(whoami)` → `role==='admin' ? 'unlocked' : sweepId==='default' ? 'pin' : 'need-link'`. The default host's existing PIN/`fetchAdminMe` auto-unlock still applies (its cookie yields `role==='admin'`).

## File structure

**Created:**
- `web/src/sweeps.js` (+ `web/src/sweeps.test.js`) — joined-sweeps store + `switchTo`. **Owned by Slice 1.**
- `web/src/lib/joinLink.js` (+ test) — `parseJoinLink(pathname)` pure helper (Slice 1).
- `web/src/lib/bootstrapJoin.js` (+ test) — `joinFromLocation(...)` exchange orchestration (Slice 1).
- `web/src/screens-super.jsx` (+ test) — `SuperConsole` (Slice 4).

**Modified:**
- `api/src/routes/bootstrap.js` (+ test) — D7a `sweep:{id,name}` (Slice 0).
- `api/src/routes/sweeps.js` (+ tests) — `PATCH /api/super/sweeps/:id`, `POST …/unarchive`, `PATCH /api/admin/people/:id` (Slice B).
- `web/src/api/client.js` (+ test) — credentials + session/admin/super calls (Slices 0, 3, 4).
- `web/src/main.jsx` — capability-link interception before `SweepProvider` (Slice 1).
- `web/src/SweepProvider.jsx` — join bootstrap, 401 "pick a sweep", name backfill (Slice 1; Slice 2 layers on).
- `web/src/App.jsx` (+ test) — `/sweeps` overlay (Slice 2), `/super` overlay (Slice 4).
- `web/src/social.js` (+ test) — per-sweep identity migration (Slice 2).
- `web/src/components.jsx` — switcher entry in Sidebar/`IdentityControl` (Slice 2).
- `web/src/screens-detail.jsx` (+ test) — host-aware `AdminConsole`: people CRUD + ownership "draw" + moderation (Slice 3).
- `web/src/admin.js` — `adminGateState` / host-aware unlock (Slice 3).
- `docker/caddy/sweep.Caddyfile`, `docker/README.md` — platform host block (Slice 5, deploy-time).

## Cross-slice reconciliation (read before executing)

These resolve every known cross-slice conflict. They are authoritative — where a slice's task text disagrees, follow this section.

1. **Read-before-edit.** `web/src/api/client.js`, `web/src/SweepProvider.jsx`, and `web/src/App.jsx` are each edited by multiple slices. Always open the current file and apply the *intent* of the task; never paste an exact-line edit blindly (line numbers and surrounding code will have drifted).
2. **`web/src/sweeps.js` + `sweeps.test.js` are created once, in Slice 1 (Task 1.3) and owned there.** If a later Slice 2 task says "Create `web/src/sweeps.js`", treat it as **modify** the existing file — merge any additional exports, do not recreate the file or its test.
3. **`SweepProvider.jsx` final shape is established by Slice 1** (join bootstrap + 401 "pick a sweep" list of tappable stored sweeps + post-bootstrap name backfill via `addSweep`). Slice 2's SweepProvider changes apply **on top of** Slice 1's version — reconcile against the actual file, not the pre-Slice-1 original.
4. **Skip duplicates.** If a task re-adds a function, component, or test that an earlier task already created (e.g. a second `Task 2.6`, a re-added client function, a second `parseJoinLink`), the earlier definition wins — skip the duplicate and only keep any genuinely new assertions.
5. **`switchTo(sweep, queryClient)`** is the single switch path, used by both the Gate's "pick a sweep" list (Slice 1) and the `SweepsSheet` switcher (Slice 2). Tests pass a stub `queryClient = { invalidateQueries: vi.fn() }`.
6. **Token + name capture (D4 / D7a).** The join flow (Slice 1) persists the real link token immediately (`addSweep({sweepId, name:null, role, token})`); the display name is backfilled after bootstrap returns `sweep:{id,name}` (`addSweep({…, name, token:null})`, which merges and keeps the token). The switcher therefore always has a real token and a real name.
7. **Test-count citations are indicative.** Where a step says "Expected: PASS (N tests)", trust the *pass/fail* outcome over the exact N — counts drift as tasks land.

---


## Slice 0: Session plumbing + bootstrap name

This slice does three small, independently-green things: (a) `GET /api/bootstrap` additionally returns `sweep:{id,name}` (D7a); (b) the public `get`/`post`/`uploadPhoto` wrappers in `client.js` send `credentials:'include'` so the `sweep_session` cookie scopes them on the platform host; (c) three new credentialed session calls — `postSession`, `fetchWhoami`, `postLogout` — land in `client.js`. Slice 0 is the **only** place those three session functions are added; later slices import them and never redefine. The default `sweep` row is seeded by migration `api/migrations/0008_stiff_captain_midlands.sql` as `('default','The Sweep',…)`, so `req.sweep.name === 'The Sweep'` for the default host.

---

### Task 0.1: `GET /api/bootstrap` returns the current sweep's `{id, name}` (D7a)

**Files:**
- Modify: `api/src/routes/bootstrap.js` (the `return {…}` object, lines 16–21)
- Test: `api/test/bootstrap.test.js` (append a new `test(...)`, after line 24)

The resolver (`api/src/sweeps/resolve.js`) sets `req.sweep` to the full `sweep` row. On the default host with no cookie it is the seeded default row (`id:'default'`, `name:'The Sweep'`). We add a sibling `sweep:{id, name}` to the response — purely additive, so the existing two bootstrap tests stay green.

- [ ] **Step 1: Write the failing test** — append to `api/test/bootstrap.test.js`:

```js
test('bootstrap returns the current sweep id and display name (D7a)', async () => {
  const body = (await app.inject({ method: 'GET', url: '/api/bootstrap' })).json()
  expect(body.sweep).toEqual({ id: 'default', name: 'The Sweep' })
})
```

- [ ] **Step 2: Run it → Expected: FAIL**

```bash
cd api && npx vitest run test/bootstrap.test.js
```

Expected: FAIL — the new test errors with `AssertionError: expected undefined to deeply equal { id: 'default', name: 'The Sweep' }` (`body.sweep` is `undefined`; bootstrap does not yet return it). The two existing bootstrap tests still pass.

- [ ] **Step 3: Minimal implementation** — edit the `return` object in `api/src/routes/bootstrap.js` so the whole route reads:

```js
import { eq } from 'drizzle-orm'
import { team, person, ownership } from '../db/schema.js'
import { serializeTeam, serializePerson } from '../serialize.js'
import { requireSweep } from '../sweeps/auth.js'

export async function bootstrapRoutes(app) {
  app.get('/api/bootstrap', { preHandler: requireSweep(['member', 'admin']) }, async (req) => {
    const sweepId = req.sweep.id
    const [teams, people, owns] = await Promise.all([
      app.db.select().from(team),
      app.db.select().from(person).where(eq(person.sweepId, sweepId)),
      app.db.select().from(ownership).where(eq(ownership.sweepId, sweepId)),
    ])
    const ownership_ = {}
    for (const o of owns) (ownership_[o.personId] ??= []).push(o.teamCode)
    return {
      teams: teams.map(serializeTeam),
      people: people.map(serializePerson),
      ownership: ownership_,
      scoring: { rule: req.sweep.scoringRule, coOwners: req.sweep.coOwners },
      sweep: { id: req.sweep.id, name: req.sweep.name },
    }
  })
}
```

- [ ] **Step 4: Run it → Expected: PASS, then full suite green**

```bash
cd api && npx vitest run test/bootstrap.test.js
```

Expected: PASS — 3 tests in `test/bootstrap.test.js`. Then the full api suite:

```bash
npm run test -w api
```

Expected: all api test files pass (Docker must be running for Testcontainers).

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/bootstrap.js api/test/bootstrap.test.js && git commit -m "feat(api): bootstrap returns current sweep id and display name (D7a)"
```

---

### Task 0.2: `credentials:'include'` on the public `get`/`post`/`uploadPhoto` wrappers

**Files:**
- Modify: `web/src/api/client.js` — `get` (lines 1–5), `post` (lines 21–29), `uploadPhoto` (lines 50–58)
- Test: `web/src/api/client.test.js` (append new `test(...)` cases after line 110)

The public fetchers currently send no credentials, so on the platform host the `sweep_session` cookie would not scope `GET /api/bootstrap`, `POST /api/watch`, or the photo upload. Add `credentials:'include'` to all three. This is additive (the existing tests don't assert `credentials` on these, so they stay green) and is the ONLY task that touches `uploadPhoto` for credentials.

- [ ] **Step 1: Write the failing test** — append to `web/src/api/client.test.js`:

```js
test('public get sends credentials:include (cookie scopes platform-host reads)', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    calls.push({ url, opts })
    return { ok: true, status: 200, json: async () => ({ teams: [] }) }
  }))
  const { fetchBootstrap } = await import('./client.js')
  await fetchBootstrap()
  expect(calls[0].url).toMatch(/\/api\/bootstrap$/)
  expect(calls[0].opts?.credentials).toBe('include')
})

test('public post sends credentials:include', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    calls.push({ url, opts })
    return { ok: true, status: 200, json: async () => ({ watching: true }) }
  }))
  const { postWatch } = await import('./client.js')
  await postWatch('m1', 'p1')
  expect(calls[0].opts.credentials).toBe('include')
})

test('uploadPhoto sends credentials:include with raw FormData', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    calls.push({ url, opts })
    return { ok: true, status: 201, json: async () => ({ id: 'x', status: 'pending' }) }
  }))
  const { uploadPhoto } = await import('./client.js')
  const fd = new FormData()
  await uploadPhoto(fd)
  expect(calls[0].opts.credentials).toBe('include')
  expect(calls[0].opts.body).toBe(fd)
})
```

- [ ] **Step 2: Run it → Expected: FAIL**

```bash
cd web && npx vitest run src/api/client.test.js
```

Expected: FAIL — the three new tests fail with `AssertionError: expected undefined to be 'include'` (the wrappers call `fetch` without a `credentials` option). All previously-passing tests still pass.

- [ ] **Step 3: Minimal implementation** — edit `web/src/api/client.js`. Change `get`:

```js
async function get(path) {
  const res = await fetch(path, { credentials: 'include' })
  if (!res.ok) throw new Error(`GET ${path} failed: HTTP ${res.status}`)
  return res.json()
}
```

Change `post`:

```js
async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${path} failed: HTTP ${res.status}`)
  return res.json()
}
```

Change `uploadPhoto`:

```js
export async function uploadPhoto(formData) {
  const res = await fetch('/api/photos', { method: 'POST', credentials: 'include', body: formData })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { msg = (await res.json()).error || msg } catch { /* ignore */ }
    throw new Error(`upload failed: ${msg}`)
  }
  return res.json()
}
```

- [ ] **Step 4: Run it → Expected: PASS, then full suite green**

```bash
cd web && npx vitest run src/api/client.test.js
```

Expected: PASS — all tests in `src/api/client.test.js` (the 11 pre-existing + 3 new = 14). Then the full web suite:

```bash
npm run test -w web
```

Expected: all web test files pass (jsdom).

- [ ] **Step 5: Commit**

```bash
git add web/src/api/client.js web/src/api/client.test.js && git commit -m "feat(web): send credentials on public fetchers so sweep_session scopes platform reads"
```

---

### Task 0.3: `postSession`, `fetchWhoami`, `postLogout` client calls

**Files:**
- Modify: `web/src/api/client.js` (add three exports after the existing `getCreds`/`postCreds` consumers, e.g. after line 64)
- Test: `web/src/api/client.test.js` (append new `test(...)` cases)

These wrap `POST /api/session {token}` → `{sweepId, role}`, `GET /api/whoami` → `{sweepId, role}`, and `POST /api/session/logout`. They reuse the existing credentialed helpers `postCreds`/`getCreds` (lines 35–48) — no new helper here. This is the single home for these three functions; Slice 1 must NOT re-add them.

- [ ] **Step 1: Write the failing test** — append to `web/src/api/client.test.js`:

```js
test('postSession POSTs the token with credentials and returns {sweepId, role}', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    calls.push({ url, opts })
    return { ok: true, status: 200, json: async () => ({ sweepId: 'sw_a', role: 'member' }) }
  }))
  const { postSession } = await import('./client.js')
  const res = await postSession('tok123')
  expect(res).toEqual({ sweepId: 'sw_a', role: 'member' })
  expect(calls[0].url).toMatch(/\/api\/session$/)
  expect(calls[0].opts.method).toBe('POST')
  expect(calls[0].opts.credentials).toBe('include')
  expect(JSON.parse(calls[0].opts.body)).toEqual({ token: 'tok123' })
})

test('fetchWhoami GETs /api/whoami with credentials', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    calls.push({ url, opts })
    return { ok: true, status: 200, json: async () => ({ sweepId: null, role: null }) }
  }))
  const { fetchWhoami } = await import('./client.js')
  const res = await fetchWhoami()
  expect(res).toEqual({ sweepId: null, role: null })
  expect(calls[0].url).toMatch(/\/api\/whoami$/)
  expect(calls[0].opts.credentials).toBe('include')
})

test('postLogout POSTs /api/session/logout with credentials', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    calls.push({ url, opts })
    return { ok: true, status: 200, json: async () => ({ ok: true }) }
  }))
  const { postLogout } = await import('./client.js')
  await postLogout()
  expect(calls[0].url).toMatch(/\/api\/session\/logout$/)
  expect(calls[0].opts.method).toBe('POST')
  expect(calls[0].opts.credentials).toBe('include')
  expect(JSON.parse(calls[0].opts.body)).toEqual({})
})
```

- [ ] **Step 2: Run it → Expected: FAIL**

```bash
cd web && npx vitest run src/api/client.test.js
```

Expected: FAIL — the three new tests fail at import/destructure with `postSession is not a function` (and likewise `fetchWhoami`, `postLogout`), because the exports don't exist yet. Pre-existing tests still pass.

- [ ] **Step 3: Minimal implementation** — in `web/src/api/client.js`, add after the existing admin helpers block (after line 64):

```js
export const postSession = (token) => postCreds('/api/session', { token })
export const fetchWhoami = () => getCreds('/api/whoami')
export const postLogout = () => postCreds('/api/session/logout', {})
```

- [ ] **Step 4: Run it → Expected: PASS, then full suite green**

```bash
cd web && npx vitest run src/api/client.test.js
```

Expected: PASS — all tests in `src/api/client.test.js` (14 from Task 0.2 + 3 new = 17). Then the full web suite:

```bash
npm run test -w web
```

Expected: all web test files pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/api/client.js web/src/api/client.test.js && git commit -m "feat(web): add postSession/fetchWhoami/postLogout session client calls"
```

---

Relevant absolute paths:
- `/Users/andriycherednikov/code/personal/sweep/api/src/routes/bootstrap.js`
- `/Users/andriycherednikov/code/personal/sweep/api/test/bootstrap.test.js`
- `/Users/andriycherednikov/code/personal/sweep/web/src/api/client.js`
- `/Users/andriycherednikov/code/personal/sweep/web/src/api/client.test.js`

Key facts grounding the code: the default `sweep` row is seeded as `('default','The Sweep','default','top3','all_win')` in `api/migrations/0008_stiff_captain_midlands.sql`; `sweepResolver` puts the full row on `req.sweep` (so `req.sweep.id`/`req.sweep.name` exist); api test script is `vitest run` (`npm run test -w api`), web is `vitest run` with jsdom (`npm run test -w web`); existing credentialed helpers `getCreds`/`postCreds` are at `client.js` lines 35–48.


## Slice 1: Capability-link interception + Gate 401 landing

> **Branch:** `feat/multi-sweep` (already checked out; nothing ships to `main`). **Depends on Slice 0** for the client calls `postSession(token)`, `fetchWhoami()`, `postLogout()` and `credentials:'include'` on the public fetchers — Slice 1 IMPORTS them and never redefines them. **Depends on Slice 1's own** `web/src/sweeps.js` (created in Task 1.3, the single home for the joined-sweeps store + `switchTo`); later slices import it. All web tests run under jsdom via `web/vitest.config.js`.

### Task 1.1: Pure `parseJoinLink(pathname)` helper

Extract a side-effect-free parser that recognises the two capability-link shapes — `/g/<token>` and `/g/<token>/admin/<token>` — and returns `{ memberToken, adminToken }` (or `null` when the path is not a join link). `main.jsx` (Task 1.2) calls this before rendering, and the bootstrap orchestration (Task 1.2) decides which token to exchange.

**Files:**
- Create: `web/src/lib/joinLink.js`
- Test (create): `web/src/lib/joinLink.test.js`

- [ ] **Step 1: Write the failing test**

```js
// web/src/lib/joinLink.test.js
import { expect, test } from 'vitest'
import { parseJoinLink } from './joinLink.js'

test('parses a bare member join link', () => {
  expect(parseJoinLink('/g/Abc123Def456Ghi789Jkl0')).toEqual({
    memberToken: 'Abc123Def456Ghi789Jkl0',
    adminToken: null,
  })
})

test('parses a member+admin join link', () => {
  expect(parseJoinLink('/g/MEMBERtoken0000000000/admin/ADMINtoken00000000000')).toEqual({
    memberToken: 'MEMBERtoken0000000000',
    adminToken: 'ADMINtoken00000000000',
  })
})

test('tolerates a trailing slash on a bare link', () => {
  expect(parseJoinLink('/g/Abc123Def456Ghi789Jkl0/')).toEqual({
    memberToken: 'Abc123Def456Ghi789Jkl0',
    adminToken: null,
  })
})

test('returns null for a non-join path', () => {
  expect(parseJoinLink('/')).toBeNull()
  expect(parseJoinLink('/teams/ar')).toBeNull()
  expect(parseJoinLink('/g')).toBeNull()
  expect(parseJoinLink('/g/')).toBeNull()
})

test('returns null when /admin/ is present but its token is missing', () => {
  expect(parseJoinLink('/g/MEMBERtoken0000000000/admin')).toBeNull()
  expect(parseJoinLink('/g/MEMBERtoken0000000000/admin/')).toBeNull()
})
```

- [ ] **Step 2: Run it → Expected: FAIL**

Run: `cd web && npx vitest run src/lib/joinLink.test.js`
Expected: FAIL — `Failed to resolve import "./joinLink.js"` (module does not exist), so all 5 tests error.

- [ ] **Step 3: Minimal implementation**

```js
// web/src/lib/joinLink.js

/**
 * Recognise a capability-link path and extract its token(s).
 * Shapes (D2): `/g/<memberToken>` and `/g/<memberToken>/admin/<adminToken>`.
 * Pure: no history/fetch side effects. Returns null when `pathname` is not a join link.
 * @param {string} pathname e.g. window.location.pathname
 * @returns {{ memberToken: string, adminToken: string|null } | null}
 */
export function parseJoinLink(pathname) {
  const seg = pathname.split('/').filter(Boolean)
  if (seg[0] !== 'g' || !seg[1]) return null
  if (seg.length === 2) return { memberToken: seg[1], adminToken: null }
  if (seg.length === 4 && seg[2] === 'admin' && seg[3]) {
    return { memberToken: seg[1], adminToken: seg[3] }
  }
  return null
}
```

- [ ] **Step 4: Run it → Expected: PASS, then full web suite green**

Run: `cd web && npx vitest run src/lib/joinLink.test.js`
Expected: PASS (5 tests).
Then run the full workspace suite: `npm run test -w web`
Expected: green (all files pass).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/joinLink.js web/src/lib/joinLink.test.js
git commit -m "feat(web): add pure parseJoinLink capability-link parser"
```

---

### Task 1.2: `joinFromLocation` orchestration + `main.jsx` interception

A small, testable async function exchanges the link token for a session cookie before the SPA renders, then strips the token from the URL (D2). `main.jsx` calls it before `ReactDOM.createRoot(...).render(...)`. Token storage (D4): after a successful `postSession` we persist the real link token via `addSweep` so the switcher can re-join later — `addSweep` is created in Task 1.3, so this task lands first as a no-op on the store front and Task 1.3 adds the persistence call. **To keep every commit green, the `addSweep` import is introduced here only after Task 1.3 exists; this task wires the session exchange + URL strip and asserts those, and Task 1.3 extends `joinFromLocation` with the `addSweep` call (with its own test).**

**Files:**
- Create: `web/src/lib/bootstrapJoin.js`
- Test (create): `web/src/lib/bootstrapJoin.test.js`
- Modify: `web/src/main.jsx` (lines 1–13: imports + render)

- [ ] **Step 1: Write the failing test**

```js
// web/src/lib/bootstrapJoin.test.js
import { expect, test, vi } from 'vitest'
import { joinFromLocation } from './bootstrapJoin.js'

function fakeHistory() {
  return { replaceState: vi.fn() }
}

test('no join link → does nothing (no session, no URL change)', async () => {
  const postSession = vi.fn(async () => ({ sweepId: 'sw_1', role: 'member' }))
  const history = fakeHistory()
  await joinFromLocation({ pathname: '/teams/ar' }, history, postSession)
  expect(postSession).not.toHaveBeenCalled()
  expect(history.replaceState).not.toHaveBeenCalled()
})

test('bare member link → posts the member token, then strips the URL to /', async () => {
  const postSession = vi.fn(async () => ({ sweepId: 'sw_9', role: 'member' }))
  const history = fakeHistory()
  await joinFromLocation({ pathname: '/g/MEMBERtoken0000000000' }, history, postSession)
  expect(postSession).toHaveBeenCalledWith('MEMBERtoken0000000000')
  expect(history.replaceState).toHaveBeenCalledWith({}, '', '/')
})

test('admin link → exchanges the ADMIN token (admin wins over member)', async () => {
  const postSession = vi.fn(async () => ({ sweepId: 'sw_9', role: 'admin' }))
  const history = fakeHistory()
  await joinFromLocation(
    { pathname: '/g/MEMBERtoken0000000000/admin/ADMINtoken00000000000' },
    history,
    postSession,
  )
  expect(postSession).toHaveBeenCalledWith('ADMINtoken00000000000')
  expect(history.replaceState).toHaveBeenCalledWith({}, '', '/')
})

test('a failed exchange still strips the URL (no token left in the address bar)', async () => {
  const postSession = vi.fn(async () => { throw new Error('POST /api/session failed: HTTP 401') })
  const history = fakeHistory()
  await joinFromLocation({ pathname: '/g/badtoken000000000000' }, history, postSession)
  expect(postSession).toHaveBeenCalledWith('badtoken000000000000')
  expect(history.replaceState).toHaveBeenCalledWith({}, '', '/')
})
```

- [ ] **Step 2: Run it → Expected: FAIL**

Run: `cd web && npx vitest run src/lib/bootstrapJoin.test.js`
Expected: FAIL — `Failed to resolve import "./bootstrapJoin.js"`; all 4 tests error.

- [ ] **Step 3: Minimal implementation**

```js
// web/src/lib/bootstrapJoin.js
import { parseJoinLink } from './joinLink.js'

/**
 * If `loc.pathname` is a capability link (D2), exchange the token for a session
 * cookie via `postSession`, then strip the token from the URL (replaceState → '/').
 * The admin token wins when present. Even a failed exchange strips the URL so no
 * secret lingers in the address bar; the Gate (Task 1.4) then shows "pick a sweep".
 *
 * @param {{ pathname: string }} loc   typically window.location
 * @param {History} history            typically window.history
 * @param {(token: string) => Promise<{sweepId:string, role:string}>} postSession
 * @returns {Promise<void>}
 */
export async function joinFromLocation(loc, history, postSession) {
  const link = parseJoinLink(loc.pathname)
  if (!link) return
  const token = link.adminToken || link.memberToken
  try {
    await postSession(token)
  } catch {
    /* swallow — strip the URL regardless so the token isn't left visible */
  } finally {
    history.replaceState({}, '', '/')
  }
}
```

```jsx
// web/src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { SweepProvider } from "./SweepProvider.jsx";
import { registerServiceWorker } from "./lib/registerSW.js";
import { joinFromLocation } from "./lib/bootstrapJoin.js";
import { postSession } from "./api/client.js";
import "./styles.css";
import "./desktop.css";

// Intercept a /g/<token>[/admin/<token>] capability link BEFORE rendering:
// exchange it for a session cookie, then strip the token from the URL (D2).
joinFromLocation(window.location, window.history, postSession).finally(() => {
  ReactDOM.createRoot(document.getElementById("appmount")).render(
    <SweepProvider><App /></SweepProvider>
  );
  registerServiceWorker();
});
```

> `postSession` is added in **Slice 0, Task 0.3** (`web/src/api/client.js`); Slice 1 only imports it.

- [ ] **Step 4: Run it → Expected: PASS, then full web suite green**

Run: `cd web && npx vitest run src/lib/bootstrapJoin.test.js`
Expected: PASS (4 tests).
Then run the full workspace suite: `npm run test -w web`
Expected: green. (`main.jsx` has no dedicated test; `web/src/lib/smoke.test.js` imports module graph — confirm it still passes.)

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/bootstrapJoin.js web/src/lib/bootstrapJoin.test.js web/src/main.jsx
git commit -m "feat(web): intercept capability links and strip the token before render"
```

---

### Task 1.3: `web/src/sweeps.js` — joined-sweeps store, `switchTo`, and join-time token persistence

The single home (created ONCE here, in Slice 1) for the per-device joined-sweeps store `localStorage["sweep.sweeps.v1"]` and for switching the active sweep. `addSweep` UPSERTs by `sweepId`, merging name/role and **never overwriting a real token with `null`** (D4). `switchTo(sweep, queryClient)` re-`POST`s the stored token then invalidates the `['sweep']` + `['social']` queries. This task also wires `joinFromLocation` to persist the real link token at join time (D4). Slice 2 imports this module and does NOT recreate it.

**Files:**
- Create: `web/src/sweeps.js`
- Test (create): `web/src/sweeps.test.js`
- Modify: `web/src/lib/bootstrapJoin.js` (add the `addSweep` persistence call)
- Modify: `web/src/lib/bootstrapJoin.test.js` (add a token-persistence assertion)

- [ ] **Step 1: Write the failing test**

```js
// web/src/sweeps.test.js
import { expect, test, vi, beforeEach } from 'vitest'

const KEY = 'sweep.sweeps.v1'

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
})

test('listSweeps is [] when nothing is stored', async () => {
  const { listSweeps } = await import('./sweeps.js')
  expect(listSweeps()).toEqual([])
})

test('addSweep appends a new entry', async () => {
  const { addSweep, listSweeps } = await import('./sweeps.js')
  addSweep({ sweepId: 'sw_1', name: 'Pub Sweep', role: 'member', token: 'tok1' })
  expect(listSweeps()).toEqual([{ sweepId: 'sw_1', name: 'Pub Sweep', role: 'member', token: 'tok1' }])
})

test('addSweep upserts by sweepId: updates name/role, keeps token when new token is null', async () => {
  const { addSweep, listSweeps } = await import('./sweeps.js')
  addSweep({ sweepId: 'sw_1', name: null, role: 'member', token: 'realtok' })
  addSweep({ sweepId: 'sw_1', name: 'Office Sweep', role: 'admin', token: null })
  expect(listSweeps()).toEqual([
    { sweepId: 'sw_1', name: 'Office Sweep', role: 'admin', token: 'realtok' },
  ])
})

test('addSweep overwrites the token only when a non-null token is provided', async () => {
  const { addSweep, listSweeps } = await import('./sweeps.js')
  addSweep({ sweepId: 'sw_1', name: 'A', role: 'member', token: 'old' })
  addSweep({ sweepId: 'sw_1', name: 'A', role: 'admin', token: 'new' })
  expect(listSweeps()[0].token).toBe('new')
})

test('removeSweep drops the matching entry', async () => {
  const { addSweep, removeSweep, listSweeps } = await import('./sweeps.js')
  addSweep({ sweepId: 'sw_1', name: 'A', role: 'member', token: 't1' })
  addSweep({ sweepId: 'sw_2', name: 'B', role: 'member', token: 't2' })
  removeSweep('sw_1')
  expect(listSweeps()).toEqual([{ sweepId: 'sw_2', name: 'B', role: 'member', token: 't2' }])
})

test('listSweeps tolerates corrupt JSON → []', async () => {
  localStorage.setItem(KEY, '{not json')
  const { listSweeps } = await import('./sweeps.js')
  expect(listSweeps()).toEqual([])
})

test('switchTo posts the stored token then invalidates sweep + social queries', async () => {
  const postSession = vi.fn(async () => ({ sweepId: 'sw_2', role: 'member' }))
  vi.doMock('./api/client.js', () => ({ postSession }))
  const { switchTo } = await import('./sweeps.js')
  const queryClient = { invalidateQueries: vi.fn() }
  await switchTo({ sweepId: 'sw_2', name: 'B', role: 'member', token: 'tok2' }, queryClient)
  expect(postSession).toHaveBeenCalledWith('tok2')
  expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sweep'] })
  expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['social'] })
})
```

Append the token-persistence assertion to `web/src/lib/bootstrapJoin.test.js`:

```js
// web/src/lib/bootstrapJoin.test.js  (append)
import { listSweeps } from '../sweeps.js'

test('a successful join persists the real link token via addSweep (name null pre-bootstrap)', async () => {
  localStorage.clear()
  const postSession = vi.fn(async () => ({ sweepId: 'sw_42', role: 'admin' }))
  const history = fakeHistory()
  await joinFromLocation(
    { pathname: '/g/MEMBERtoken0000000000/admin/ADMINtoken00000000000' },
    history,
    postSession,
  )
  expect(listSweeps()).toEqual([
    { sweepId: 'sw_42', name: null, role: 'admin', token: 'ADMINtoken00000000000' },
  ])
})
```

- [ ] **Step 2: Run it → Expected: FAIL**

Run: `cd web && npx vitest run src/sweeps.test.js src/lib/bootstrapJoin.test.js`
Expected: FAIL — `src/sweeps.test.js` errors with `Failed to resolve import "./sweeps.js"`; the new `bootstrapJoin` test fails because `joinFromLocation` does not yet call `addSweep` (and `../sweeps.js` does not resolve).

- [ ] **Step 3: Minimal implementation**

```js
// web/src/sweeps.js
import { postSession } from './api/client.js'

const KEY = 'sweep.sweeps.v1'

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
function write(list) {
  localStorage.setItem(KEY, JSON.stringify(list))
}

/** @returns {{sweepId:string, name:string|null, role:string, token:string|null}[]} */
export function listSweeps() {
  return read()
}

/**
 * Upsert a joined sweep by `sweepId`. Updates name/role; keeps the existing token
 * unless a non-null token is provided (merge — never overwrite a real token with null).
 * @param {{sweepId:string, name:string|null, role:string, token:string|null}} entry
 */
export function addSweep({ sweepId, name, role, token }) {
  const list = read()
  const i = list.findIndex((s) => s.sweepId === sweepId)
  if (i === -1) {
    list.push({ sweepId, name, role, token })
  } else {
    list[i] = {
      sweepId,
      name,
      role,
      token: token != null ? token : list[i].token,
    }
  }
  write(list)
}

/** Remove a joined sweep by id. */
export function removeSweep(sweepId) {
  write(read().filter((s) => s.sweepId !== sweepId))
}

/**
 * Switch the active sweep: re-exchange its stored token for a fresh session
 * cookie, then invalidate the data queries so the SPA reloads scoped data.
 * @param {{token:string}} sweep
 * @param {{invalidateQueries: Function}} queryClient
 */
export async function switchTo(sweep, queryClient) {
  await postSession(sweep.token)
  queryClient.invalidateQueries({ queryKey: ['sweep'] })
  queryClient.invalidateQueries({ queryKey: ['social'] })
}
```

```js
// web/src/lib/bootstrapJoin.js
import { parseJoinLink } from './joinLink.js'
import { addSweep } from '../sweeps.js'

/**
 * If `loc.pathname` is a capability link (D2), exchange the token for a session
 * cookie via `postSession`, persist the link token to the switcher store (D4),
 * then strip the token from the URL (replaceState → '/'). The admin token wins
 * when present. A failed exchange still strips the URL so no secret lingers.
 *
 * @param {{ pathname: string }} loc   typically window.location
 * @param {History} history            typically window.history
 * @param {(token: string) => Promise<{sweepId:string, role:string}>} postSession
 * @returns {Promise<void>}
 */
export async function joinFromLocation(loc, history, postSession) {
  const link = parseJoinLink(loc.pathname)
  if (!link) return
  const token = link.adminToken || link.memberToken
  try {
    const { sweepId, role } = await postSession(token)
    // name is null here — bootstrap hasn't run yet; backfilled by the Gate (Task 1.4).
    addSweep({ sweepId, name: null, role, token })
  } catch {
    /* swallow — strip the URL regardless so the token isn't left visible */
  } finally {
    history.replaceState({}, '', '/')
  }
}
```

- [ ] **Step 4: Run it → Expected: PASS, then full web suite green**

Run: `cd web && npx vitest run src/sweeps.test.js src/lib/bootstrapJoin.test.js`
Expected: PASS (`sweeps.test.js` 7 tests; `bootstrapJoin.test.js` 5 tests).
Then run the full workspace suite: `npm run test -w web`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add web/src/sweeps.js web/src/sweeps.test.js web/src/lib/bootstrapJoin.js web/src/lib/bootstrapJoin.test.js
git commit -m "feat(web): add joined-sweeps store + persist link token at join"
```

---

### Task 1.4: `Gate` 401 → tappable "pick a sweep" landing + name backfill

When the `['sweep']` query fails with an HTTP **401** (platform host, no/expired session — D5), render a distinct `sweep-pick` state instead of the generic `sweep-error`. If the device has stored sweeps (`listSweeps()`), render each as a **button** that calls `switchTo(sweep, queryClient)` (D5 — tappable, not an inert `<li>`); otherwise show an "invite link needed" empty state. On a *successful* `['sweep']` load, backfill the active sweep's display name into the store from the extended `bootstrap` (`{sweep:{id,name}}`, D7a→D4) so the switcher labels by name.

The existing wrappers throw `Error('GET /api/bootstrap failed: HTTP 401')`; we detect 401 from that message (no client change in this slice). Name backfill needs `role` — taken from the matching stored entry (`addSweep` merge keeps the token) — and falls back to `'member'` if absent.

**Files:**
- Modify: `web/src/SweepProvider.jsx` (lines 1–47: imports, `Gate` query/error branches)
- Test (modify): `web/src/SweepProvider.test.jsx` (add a 401 group; mock `./sweeps.js`)

- [ ] **Step 1: Write the failing test**

```jsx
// web/src/SweepProvider.test.jsx  (append below the existing tests)
import { fireEvent } from '@testing-library/react'

function mock401() {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    if (path === '/api/bootstrap') return { ok: false, status: 401, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => bundle[path] }
  }))
}

test('a 401 on bootstrap with no stored sweeps → "invite link needed" empty state', async () => {
  vi.resetModules()
  localStorage.clear()
  mock401()
  const { SweepProvider } = await import('./SweepProvider.jsx')
  render(<SweepProvider><div>app-ready</div></SweepProvider>)
  await waitFor(() => expect(screen.getByTestId('sweep-pick')).toBeInTheDocument())
  expect(screen.queryByText('app-ready')).toBeNull()
  expect(screen.queryByTestId('sweep-error')).toBeNull()
  expect(screen.getByText(/invite link/i)).toBeInTheDocument()
})

test('a 401 with stored sweeps → tappable list; tap calls switchTo(sweep, queryClient)', async () => {
  vi.resetModules()
  localStorage.clear()
  const switchTo = vi.fn(async () => {})
  vi.doMock('./sweeps.js', () => ({
    listSweeps: () => [{ sweepId: 'sw_1', name: 'Pub Sweep', role: 'member', token: 'tok1' }],
    addSweep: vi.fn(),
    switchTo,
  }))
  mock401()
  const { SweepProvider } = await import('./SweepProvider.jsx')
  render(<SweepProvider><div>app-ready</div></SweepProvider>)
  const btn = await screen.findByRole('button', { name: /Pub Sweep/i })
  fireEvent.click(btn)
  expect(switchTo).toHaveBeenCalledTimes(1)
  expect(switchTo.mock.calls[0][0]).toEqual({ sweepId: 'sw_1', name: 'Pub Sweep', role: 'member', token: 'tok1' })
  expect(switchTo.mock.calls[0][1]).toHaveProperty('invalidateQueries')
})

test('a successful load backfills the sweep name into the store via addSweep', async () => {
  vi.resetModules()
  localStorage.clear()
  const addSweep = vi.fn()
  vi.doMock('./sweeps.js', () => ({ listSweeps: () => [], addSweep, switchTo: vi.fn() }))
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    if (path === '/api/bootstrap') {
      return { ok: true, status: 200, json: async () => ({ ...bundle['/api/bootstrap'], sweep: { id: 'sw_9', name: 'Office Sweep' } }) }
    }
    return { ok: true, status: 200, json: async () => bundle[path] }
  }))
  const { SweepProvider } = await import('./SweepProvider.jsx')
  render(<SweepProvider><div>app-ready</div></SweepProvider>)
  await waitFor(() => expect(screen.getByText('app-ready')).toBeInTheDocument())
  expect(addSweep).toHaveBeenCalledWith({ sweepId: 'sw_9', name: 'Office Sweep', role: 'member', token: null })
})
```

- [ ] **Step 2: Run it → Expected: FAIL**

Run: `cd web && npx vitest run src/SweepProvider.test.jsx`
Expected: FAIL — the three new tests fail: no `sweep-pick` element (current `Gate` renders the generic `sweep-error` on any error), the button query times out, and `addSweep` is never called. The two original tests still pass.

- [ ] **Step 3: Minimal implementation**

```jsx
// web/src/SweepProvider.jsx
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchAll, fetchSocial } from './api/client.js'
import { setSweepData } from './data.js'
import { setSocialData } from './social.js'
import { assembleSweep } from './lib/assemble.js'
import { useEventStream } from './hooks/useEventStream.js'
import { listSweeps, addSweep, switchTo } from './sweeps.js'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 60_000, refetchOnWindowFocus: false } } })

const is401 = (err) => /HTTP 401/.test(err?.message || '')

function Gate({ children }) {
  const qc = useQueryClient()
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['sweep'],
    queryFn: async () => {
      const api = await fetchAll()
      setSweepData(assembleSweep(api))
      // D7a→D4: backfill the active sweep's display name into the switcher store.
      const sweep = api.bootstrap?.sweep
      if (sweep?.id) {
        const stored = listSweeps().find((s) => s.sweepId === sweep.id)
        addSweep({ sweepId: sweep.id, name: sweep.name, role: stored?.role || 'member', token: null })
      }
      return api.syncStatus
    },
  })

  useQuery({
    queryKey: ['social'],
    queryFn: async () => {
      const social = await fetchSocial()
      setSocialData(social)
      return social
    },
  })

  useEventStream()

  if (isLoading) {
    return (
      <div data-testid="sweep-loading" className="sweep-loading">
        <div className="spinner" /> Loading the sweep…
      </div>
    )
  }
  if (isError && is401(error)) {
    const sweeps = listSweeps()
    return (
      <div data-testid="sweep-pick" className="sweep-pick">
        <h2>Pick a sweep</h2>
        {sweeps.length > 0 ? (
          <ul className="sweep-pick-list">
            {sweeps.map((s) => (
              <li key={s.sweepId}>
                <button onClick={() => switchTo(s, qc)}>{s.name || s.sweepId}</button>
              </li>
            ))}
          </ul>
        ) : (
          <p>You need an invite link to join a sweep.</p>
        )}
      </div>
    )
  }
  if (isError) {
    return (
      <div data-testid="sweep-error" className="sweep-error">
        <p>Couldn’t load the sweep.</p>
        <button onClick={() => refetch()}>Retry</button>
      </div>
    )
  }
  return <>{children}</>
}

export function SweepProvider({ children }) {
  return (
    <QueryClientProvider client={queryClient}>
      <Gate>{children}</Gate>
    </QueryClientProvider>
  )
}
```

> The 401 branch reads `error.message` (`'… failed: HTTP 401'`) thrown by the existing `get`/`getCreds` wrappers — no client change needed in this slice.

- [ ] **Step 4: Run it → Expected: PASS, then full web suite green**

Run: `cd web && npx vitest run src/SweepProvider.test.jsx`
Expected: PASS (5 tests: the 2 original + 3 new).
Then run the full workspace suite: `npm run test -w web`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add web/src/SweepProvider.jsx web/src/SweepProvider.test.jsx
git commit -m "feat(web): Gate 401 → tappable pick-a-sweep landing + name backfill"
```


## Slice B: Backend: rename + un-archive endpoints

### Task B.1: PATCH /api/super/sweeps/:id — rename / edit sweep settings

Add a super-only edit endpoint that updates `name`, `scoringRule`, and/or `coOwners` on an existing sweep and returns the updated row. Unknown id → 404. Mirrors the validation/`requireSuper`/db style of the existing `POST /api/super/sweeps/:id/rotate` and `.../archive` routes in `api/src/routes/sweeps.js`.

**Files:**
- Modify: `api/src/routes/sweeps.js` — add a `patchBody` schema next to `rotateBody` (after line 19) and a `PATCH /api/super/sweeps/:id` route after the `archive` route (after line 95, before `const groupAdmin = requireSweep(['admin'])` on line 97).
- Test: `api/test/sweeps-admin.test.js` — append new tests after the existing final test (after line 92).

- [ ] **Step 1: Write the failing test.** Append to `api/test/sweeps-admin.test.js` (after the last test, currently ending line 92):

```js
test('super can rename a sweep and edit scoring (PATCH returns updated row)', async () => {
  const cookie = await superCookie()
  const created = (await app.inject({ method: 'POST', url: '/api/super/sweeps', headers: { cookie }, payload: { name: 'Old Name' } })).json()
  const res = await app.inject({
    method: 'PATCH', url: `/api/super/sweeps/${created.id}`, headers: { cookie },
    payload: { name: 'New Name', scoringRule: 'winner_only', coOwners: 'split' },
  })
  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.id).toBe(created.id)
  expect(body.name).toBe('New Name')
  expect(body.scoringRule).toBe('winner_only')
  expect(body.coOwners).toBe('split')
  // a follow-up GET reflects the new name
  const list = (await app.inject({ method: 'GET', url: '/api/super/sweeps', headers: { cookie } })).json()
  expect(list.find((s) => s.id === created.id).name).toBe('New Name')
})

test('PATCH a sweep without a super cookie is 401', async () => {
  const cookie = await superCookie()
  const created = (await app.inject({ method: 'POST', url: '/api/super/sweeps', headers: { cookie }, payload: { name: 'Guarded' } })).json()
  const res = await app.inject({ method: 'PATCH', url: `/api/super/sweeps/${created.id}`, payload: { name: 'Nope' } })
  expect(res.statusCode).toBe(401)
})

test('PATCH an unknown sweep id is 404', async () => {
  const cookie = await superCookie()
  const res = await app.inject({ method: 'PATCH', url: '/api/super/sweeps/sw_does_not_exist', headers: { cookie }, payload: { name: 'X' } })
  expect(res.statusCode).toBe(404)
})
```

- [ ] **Step 2: Run it → Expected: FAIL.**

```bash
cd api && npx vitest run test/sweeps-admin.test.js
```

Expected: FAIL. The three new tests fail — `PATCH /api/super/sweeps/:id` has no route, so Fastify returns 404 for all of them (the rename test fails its `expect(res.statusCode).toBe(200)`; the 401 test fails its `expect(...).toBe(401)` because it gets 404; the 404 test happens to pass but the suite is red overall).

- [ ] **Step 3: Minimal implementation.** In `api/src/routes/sweeps.js`, add the `patchBody` schema right after the `rotateBody` definition (after line 19):

```js
const patchBody = {
  type: 'object', additionalProperties: false, minProperties: 1,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 80 },
    scoringRule: { type: 'string', minLength: 1, maxLength: 40 },
    coOwners: { type: 'string', minLength: 1, maxLength: 40 },
  },
}
```

Then add the route immediately after the `archive` route (after line 95, before `const groupAdmin = requireSweep(['admin'])`):

```js
  app.patch('/api/super/sweeps/:id', { preHandler: superGuard, schema: { body: patchBody } }, async (req, reply) => {
    const { id } = req.params
    const [row] = await app.db.select().from(sweep).where(eq(sweep.id, id))
    if (!row) return reply.code(404).send({ error: 'not_found' })
    const set = {}
    if (req.body.name !== undefined) set.name = req.body.name
    if (req.body.scoringRule !== undefined) set.scoringRule = req.body.scoringRule
    if (req.body.coOwners !== undefined) set.coOwners = req.body.coOwners
    await app.db.update(sweep).set(set).where(eq(sweep.id, id))
    const [updated] = await app.db.select().from(sweep).where(eq(sweep.id, id))
    return { id: updated.id, name: updated.name, scoringRule: updated.scoringRule, coOwners: updated.coOwners, kind: updated.kind, archivedAt: updated.archivedAt }
  })
```

- [ ] **Step 4: Run it → Expected: PASS, then full suite.**

```bash
cd api && npx vitest run test/sweeps-admin.test.js
```

Expected: PASS — all tests in the file green (the 6 pre-existing + 3 new = 9 passed). Then run the full workspace suite:

```bash
npm run test -w api
```

Expected: all api test files pass (green). Docker must be running for Testcontainers/Postgres.

- [ ] **Step 5: Commit.**

```bash
git add api/src/routes/sweeps.js api/test/sweeps-admin.test.js && git commit -m "feat(api): PATCH /api/super/sweeps/:id to rename + edit scoring"
```

---

### Task B.2: POST /api/super/sweeps/:id/unarchive — re-activate a sweep

Add a super-only un-archive endpoint that clears `archivedAt`, mirroring the existing `POST /api/super/sweeps/:id/archive` route in `api/src/routes/sweeps.js` (lines 89–95): it refuses `kind === 'default'` and unknown ids with 404. After un-archiving, `POST /api/session` works again (the session route at lines 32–34 rejects archived sweeps with 404, so re-activation restores it).

**Files:**
- Modify: `api/src/routes/sweeps.js` — add a `POST /api/super/sweeps/:id/unarchive` route immediately after the `archive` route (after line 95), beside the new PATCH route from Task B.1.
- Test: `api/test/sweeps-admin.test.js` — append after the Task B.1 tests.

- [ ] **Step 1: Write the failing test.** Append to `api/test/sweeps-admin.test.js`:

```js
test('super can un-archive a sweep; an archived sweep becomes usable again', async () => {
  const cookie = await superCookie()
  const created = (await app.inject({ method: 'POST', url: '/api/super/sweeps', headers: { cookie }, payload: { name: 'Revivable' } })).json()
  const tok = created.memberToken
  // archive it → /api/session refuses (404)
  expect((await app.inject({ method: 'POST', url: `/api/super/sweeps/${created.id}/archive`, headers: { cookie } })).statusCode).toBe(200)
  expect((await app.inject({ method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token: tok } })).statusCode).toBe(404)
  // un-archive → row active again, session works
  const un = await app.inject({ method: 'POST', url: `/api/super/sweeps/${created.id}/unarchive`, headers: { cookie } })
  expect(un.statusCode).toBe(200)
  expect(un.json()).toEqual({ id: created.id, archived: false })
  const sess = await app.inject({ method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token: tok } })
  expect(sess.statusCode).toBe(200)
  expect(sess.json().sweepId).toBe(created.id)
})

test('un-archive without a super cookie is 401', async () => {
  const cookie = await superCookie()
  const created = (await app.inject({ method: 'POST', url: '/api/super/sweeps', headers: { cookie }, payload: { name: 'GuardedUn' } })).json()
  const res = await app.inject({ method: 'POST', url: `/api/super/sweeps/${created.id}/unarchive` })
  expect(res.statusCode).toBe(401)
})

test('un-archive an unknown sweep id is 404', async () => {
  const cookie = await superCookie()
  const res = await app.inject({ method: 'POST', url: '/api/super/sweeps/sw_nope/unarchive', headers: { cookie } })
  expect(res.statusCode).toBe(404)
})

test('un-archive refuses the default sweep (kind default → 404)', async () => {
  const cookie = await superCookie()
  const res = await app.inject({ method: 'POST', url: '/api/super/sweeps/default/unarchive', headers: { cookie } })
  expect(res.statusCode).toBe(404)
})
```

- [ ] **Step 2: Run it → Expected: FAIL.**

```bash
cd api && npx vitest run test/sweeps-admin.test.js
```

Expected: FAIL. `POST /api/super/sweeps/:id/unarchive` has no route → Fastify 404. The un-archive happy-path test fails at `expect(un.statusCode).toBe(200)` (gets 404), and the 401 test fails at `expect(res.statusCode).toBe(401)` (gets 404).

- [ ] **Step 3: Minimal implementation.** In `api/src/routes/sweeps.js`, add immediately after the `PATCH /api/super/sweeps/:id` route from Task B.1 (still before `const groupAdmin = requireSweep(['admin'])`):

```js
  app.post('/api/super/sweeps/:id/unarchive', { preHandler: superGuard }, async (req, reply) => {
    const { id } = req.params
    const [row] = await app.db.select().from(sweep).where(eq(sweep.id, id))
    if (!row || row.kind === 'default') return reply.code(404).send({ error: 'not_found' })
    await app.db.update(sweep).set({ archivedAt: null }).where(eq(sweep.id, id))
    return { id, archived: false }
  })
```

- [ ] **Step 4: Run it → Expected: PASS, then full suite.**

```bash
cd api && npx vitest run test/sweeps-admin.test.js
```

Expected: PASS — file green (9 from before + 4 new = 13 passed). Then:

```bash
npm run test -w api
```

Expected: full api suite green. (Docker running for Testcontainers.)

- [ ] **Step 5: Commit.**

```bash
git add api/src/routes/sweeps.js api/test/sweeps-admin.test.js && git commit -m "feat(api): POST /api/super/sweeps/:id/unarchive to re-activate a sweep"
```

---

### Task B.3: PATCH /api/admin/people/:id — rename a person (sweep-scoped)

Add a group-admin endpoint to rename a person (`name`/`short`/`initials`), scoped to `req.sweep.id` like the existing `DELETE /api/admin/people/:id` route in `api/src/routes/sweeps.js` (lines 120–127). A person belonging to another sweep is invisible → 404. Returns the updated person in the same shape the create route returns.

**Files:**
- Modify: `api/src/routes/sweeps.js` — add a `personPatchBody` schema next to `personBody` (after line 107) and a `PATCH /api/admin/people/:id` route immediately after the `DELETE /api/admin/people/:id` route (after line 127, before the `POST /api/admin/ownership` route on line 129).
- Test: `api/test/sweeps-isolation.test.js` — append cross-sweep tests after the existing final test (after line 96). This file already creates `sweep` `sw_b` with person `pb1` in `beforeAll` (lines 19–21) and cleans up by `sweepId` in `afterAll` (lines 23–31), so cross-sweep assertions are deterministic.

- [ ] **Step 1: Write the failing test.** Append to `api/test/sweeps-isolation.test.js` (after the last test, currently ending line 96). Note this file imports `sessionCookie(token)` (lines 12–15) and the `memberB` token; we also need an admin cookie for `sw_b`, minted from its admin token:

```js
test('group admin can rename a person in their own sweep (PATCH)', async () => {
  // mint an admin cookie for sweep B from its admin token
  const [b] = await db.select().from(sweep).where(eq(sweep.id, 'sw_b'))
  const adminSess = await app.inject({ method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token: b.adminToken } })
  const cookie = adminSess.headers['set-cookie']
  const res = await app.inject({
    method: 'PATCH', url: '/api/admin/people/pb1', headers: { host: 'platform.test', cookie },
    payload: { name: 'Beatrice', short: 'Bea', initials: 'BE' },
  })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ id: 'pb1', name: 'Beatrice', short: 'Bea', initials: 'BE' })
  // a scoped read reflects the rename
  const body = (await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { host: 'platform.test', cookie } })).json()
  expect(body.people.find((p) => p.id === 'pb1').name).toBe('Beatrice')
})

test('renaming a person from another sweep is 404 (cross-sweep scoping)', async () => {
  // a DEFAULT-host admin cannot rename sweep B's pb1: pb1 is not in the default sweep.
  const login = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { passcode: 'wrong-never-matches' } })
  void login // default-host admin auth is PIN-based; we instead assert via the platform admin below
  // mint a SECOND sweep + admin, then try to touch pb1 (which belongs to sw_b) → 404
  const su = await app.inject({ method: 'POST', url: '/api/super/session', headers: { host: 'platform.test' }, payload: { token: 'super-xyz' } })
  void su
  const res = await app.inject({
    method: 'PATCH', url: '/api/admin/people/pb1', headers: { host: 'platform.test' },
    payload: { name: 'Hijack' },
  })
  // no cookie at all on the platform host → unauthorized (401), pb1 untouched
  expect(res.statusCode).toBe(401)
  const [stillBea] = await db.select().from(person).where(eq(person.id, 'pb1'))
  expect(stillBea.name).toBe('Beatrice')
})

test('an admin of one sweep cannot rename a person in another sweep (404 not 200)', async () => {
  const su = await superCookie()
  // create a fresh sweep C with its own admin
  const created = (await app.inject({ method: 'POST', url: '/api/super/sweeps', headers: { cookie: su }, payload: { name: 'C' } })).json()
  const sessC = await app.inject({ method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token: created.adminToken } })
  const cookieC = sessC.headers['set-cookie']
  // sweep C admin tries to rename pb1 (lives in sw_b) → invisible → 404
  const res = await app.inject({
    method: 'PATCH', url: '/api/admin/people/pb1', headers: { host: 'platform.test', cookie: cookieC },
    payload: { name: 'Hijack' },
  })
  expect(res.statusCode).toBe(404)
  const [stillBea] = await db.select().from(person).where(eq(person.id, 'pb1'))
  expect(stillBea.name).toBe('Beatrice')
  // cleanup sweep C
  await db.delete(sweep).where(eq(sweep.id, created.id))
})
```

This file's imports (line 6) already include `sweep` and `person`; `eq` is imported (line 2); `newToken` (line 5). Add a `superCookie` helper and the `super-xyz` token to the app build. Update the top of the file: change the `buildApp` call on line 10 to pass `superToken`, and add a `superCookie` helper after `sessionCookie` (lines 12–15):

```js
const app = buildApp(db, { sessionSecret: 'test-secret', platformHost: 'platform.test', superToken: 'super-xyz' })

async function sessionCookie(token) {
  const res = await app.inject({ method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token } })
  return res.headers['set-cookie']
}

async function superCookie() {
  const res = await app.inject({ method: 'POST', url: '/api/super/session', headers: { host: 'platform.test' }, payload: { token: 'super-xyz' } })
  return res.headers['set-cookie']
}
```

(Replace the existing `const app = buildApp(...)` on line 10 and add the `superCookie` helper directly below the existing `sessionCookie` function; do not duplicate `sessionCookie`.)

- [ ] **Step 2: Run it → Expected: FAIL.**

```bash
cd api && npx vitest run test/sweeps-isolation.test.js
```

Expected: FAIL. `PATCH /api/admin/people/:id` has no route → Fastify 404. The happy-path test fails at `expect(res.statusCode).toBe(200)` (gets 404); the cross-sweep "404 not 200" test currently also gets a Fastify-level 404 (route missing) rather than a scoped 404 — after implementation it becomes a genuine scoped 404, so the test stays deterministic.

- [ ] **Step 3: Minimal implementation.** In `api/src/routes/sweeps.js`, add the `personPatchBody` schema right after the `personBody` definition (after line 107, before `ownBody`):

```js
  const personPatchBody = {
    type: 'object', additionalProperties: false, minProperties: 1,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 80 },
      short: { type: 'string', minLength: 1, maxLength: 40 },
      initials: { type: 'string', minLength: 1, maxLength: 4 },
    },
  }
```

Then add the route immediately after the `DELETE /api/admin/people/:id` route (after line 127, before `app.post('/api/admin/ownership', ...)`):

```js
  app.patch('/api/admin/people/:id', { preHandler: groupAdmin, schema: { body: personPatchBody } }, async (req, reply) => {
    const where = and(eq(person.id, req.params.id), eq(person.sweepId, req.sweep.id))
    const [p] = await app.db.select().from(person).where(where)
    if (!p) return reply.code(404).send({ error: 'not_found' })
    const set = {}
    if (req.body.name !== undefined) set.name = req.body.name
    if (req.body.short !== undefined) set.short = req.body.short
    if (req.body.initials !== undefined) set.initials = req.body.initials
    await app.db.update(person).set(set).where(where)
    const [updated] = await app.db.select().from(person).where(where)
    return { id: updated.id, name: updated.name, short: updated.short, initials: updated.initials }
  })
```

- [ ] **Step 4: Run it → Expected: PASS, then full suite.**

```bash
cd api && npx vitest run test/sweeps-isolation.test.js
```

Expected: PASS — file green (8 pre-existing + 3 new = 11 passed). Then:

```bash
npm run test -w api
```

Expected: full api suite green (including `sweeps-admin.test.js` from Tasks B.1/B.2). Docker must be running.

- [ ] **Step 5: Commit.**

```bash
git add api/src/routes/sweeps.js api/test/sweeps-isolation.test.js && git commit -m "feat(api): PATCH /api/admin/people/:id sweep-scoped person rename"
```


## Slice 2: Per-sweep identity migration + My-sweeps switcher

This slice makes device identity (`ME_KEY`) per-sweep (D3), introduces the `sweep.sweeps.v1` switcher store (D4) in `web/src/sweeps.js`, and surfaces a "My sweeps" overlay (D4/D5) wired into `App.jsx` routing and the desktop `Sidebar` footer. It depends on Slice 0 (`postSession`, `postLogout`, `fetchWhoami` already in `web/src/api/client.js`) and the D7a `bootstrap.sweep` field. The current sweep id is threaded from `bootstrap` → `data.js` → `social.js` so identity keys correctly.

### Task 2.1: Thread the current sweep id from bootstrap into `data.js`

The per-sweep identity key (Task 2.3) and the name-backfill (Slice 1) both need the active sweep id on the device. `assembleSweep` already ignores unknown bootstrap fields, so we only need to carry `bootstrap.sweep` (D7a; `{id,name}`, defaulting to `{id:'default', name:'The Sweep'}`) through `assembleSweep` onto the live `SWEEP` object as `SWEEP.sweep`.

**Files:**
- Modify: `web/src/lib/assemble.js` (return shape, ~line 135-139)
- Modify: `web/src/data.js` (`emptySweep` ~line 4-16; `DATA_KEYS` ~line 20-23)
- Test: `web/src/data.test.js` (append)

- [ ] **Step 1: Write the failing test** — append to `web/src/data.test.js`:

```js
test('setSweepData carries the bootstrap sweep descriptor onto SWEEP.sweep', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [{ code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#000', strength: 80 }],
      people: [], ownership: {}, scoring: null,
      sweep: { id: 'sw_abc', name: 'Office Sweep' },
    },
    fixtures: [], standings: { L: [] }, photos: [], syncStatus: { stale: false },
  }))
  expect(SWEEP.sweep).toEqual({ id: 'sw_abc', name: 'Office Sweep' })
})

test('SWEEP.sweep defaults to the default sweep when bootstrap omits it', () => {
  setSweepData(assembleSweep({
    bootstrap: { teams: [], people: [], ownership: {}, scoring: null },
    fixtures: [], standings: {}, photos: [], syncStatus: { stale: false },
  }))
  expect(SWEEP.sweep).toEqual({ id: 'default', name: 'The Sweep' })
})
```

- [ ] **Step 2: Run it → Expected: FAIL.** Both new tests fail: `SWEEP.sweep` is `undefined` (the key is neither in `emptySweep()` nor copied by `setSweepData`), so `toEqual` reports `undefined` instead of the expected object.

```bash
cd web && npx vitest run src/data.test.js
```

- [ ] **Step 3: Minimal implementation.**

In `web/src/lib/assemble.js`, add the `sweep` descriptor to the returned object. Change the return block to include `sweep`:

```js
  return {
    teams, teamList, groups, people, peopleById, fixtures, fixturesById, standings, photos, derbies, money,
    nextMatch, liveMatch, scoring: bootstrap.scoring,
    sweep: bootstrap.sweep || { id: 'default', name: 'The Sweep' },
    team, fixture, flag, gd, ownersOf, ownersForFixture, fmtTime, fmtDate, fmtDayKey, fmtWeekday, todayKey,
  }
```

In `web/src/data.js`, seed a default in `emptySweep()` and copy the key in `setSweepData`. Add to the object literal returned by `emptySweep()` (e.g. just after `scoring: null,`):

```js
    scoring: null, sweep: { id: 'default', name: 'The Sweep' },
```

Add `'sweep'` to `DATA_KEYS`:

```js
const DATA_KEYS = [
  'teams', 'teamList', 'groups', 'people', 'peopleById', 'fixtures', 'fixturesById', 'standings',
  'photos', 'derbies', 'money', 'nextMatch', 'liveMatch', 'scoring', 'sweep', 'todayKey',
]
```

- [ ] **Step 4: Run it → Expected: PASS (4 tests in this file).** Then the full web suite is green.

```bash
cd web && npx vitest run src/data.test.js
npm run test -w web
```

- [ ] **Step 5: Commit.**

```bash
git add web/src/lib/assemble.js web/src/data.js web/src/data.test.js
git commit -m "feat(web): carry bootstrap sweep descriptor onto SWEEP.sweep"
```

### Task 2.2: `web/src/sweeps.js` switcher store + `switchTo`

The single home for the joined-sweeps store and switching (cross-slice contract). Backed by `localStorage` key `sweep.sweeps.v1` holding `[{sweepId,name,role,token}]`. `addSweep` UPSERTs by `sweepId` (merges name/role, keeps the stored token unless a non-null token is supplied). `switchTo(sweep, queryClient)` re-`POST`s the stored token via `postSession` (Slice 0) then invalidates the `['sweep']` and `['social']` queries.

**Files:**
- Create: `web/src/sweeps.js`
- Test: `web/src/sweeps.test.js` (create)
- Uses (do NOT redefine): `postSession`, `postLogout` from `web/src/api/client.js` (Slice 0)

- [ ] **Step 1: Write the failing test** — create `web/src/sweeps.test.js`:

```js
import { expect, test, beforeEach, vi } from 'vitest'

vi.mock('./api/client.js', () => ({
  postSession: vi.fn(async () => ({ sweepId: 'sw_a', role: 'member' })),
  postLogout: vi.fn(async () => ({})),
}))
import { postSession } from './api/client.js'
import { listSweeps, addSweep, removeSweep, switchTo } from './sweeps.js'

beforeEach(() => { localStorage.clear(); vi.clearAllMocks() })

test('listSweeps is empty when nothing is stored', () => {
  expect(listSweeps()).toEqual([])
})

test('addSweep appends a new sweep and listSweeps reads it back', () => {
  addSweep({ sweepId: 'sw_a', name: 'Office', role: 'member', token: 'tok_a' })
  expect(listSweeps()).toEqual([{ sweepId: 'sw_a', name: 'Office', role: 'member', token: 'tok_a' }])
})

test('addSweep upserts by sweepId: updates name/role, keeps the stored token when token is null', () => {
  addSweep({ sweepId: 'sw_a', name: null, role: 'member', token: 'tok_real' })
  addSweep({ sweepId: 'sw_a', name: 'Office Sweep', role: 'admin', token: null })
  expect(listSweeps()).toEqual([{ sweepId: 'sw_a', name: 'Office Sweep', role: 'admin', token: 'tok_real' }])
})

test('addSweep does not overwrite a real token with a later null token', () => {
  addSweep({ sweepId: 'sw_a', name: 'Office', role: 'member', token: 'tok_real' })
  addSweep({ sweepId: 'sw_a', name: 'Office', role: 'member', token: null })
  expect(listSweeps()[0].token).toBe('tok_real')
})

test('addSweep keeps distinct sweeps and appends the second', () => {
  addSweep({ sweepId: 'sw_a', name: 'A', role: 'member', token: 't1' })
  addSweep({ sweepId: 'sw_b', name: 'B', role: 'admin', token: 't2' })
  expect(listSweeps().map((s) => s.sweepId)).toEqual(['sw_a', 'sw_b'])
})

test('removeSweep drops the matching entry only', () => {
  addSweep({ sweepId: 'sw_a', name: 'A', role: 'member', token: 't1' })
  addSweep({ sweepId: 'sw_b', name: 'B', role: 'admin', token: 't2' })
  removeSweep('sw_a')
  expect(listSweeps().map((s) => s.sweepId)).toEqual(['sw_b'])
})

test('switchTo posts the stored token then invalidates the sweep + social queries', async () => {
  const qc = { invalidateQueries: vi.fn() }
  await switchTo({ sweepId: 'sw_a', name: 'A', role: 'member', token: 'tok_a' }, qc)
  expect(postSession).toHaveBeenCalledWith('tok_a')
  expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sweep'] })
  expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['social'] })
})

test('listSweeps tolerates corrupt JSON and returns []', () => {
  localStorage.setItem('sweep.sweeps.v1', '{not json')
  expect(listSweeps()).toEqual([])
})
```

- [ ] **Step 2: Run it → Expected: FAIL.** The module does not exist yet, so Vitest reports `Failed to resolve import "./sweeps.js"` and every test in the file errors.

```bash
cd web && npx vitest run src/sweeps.test.js
```

- [ ] **Step 3: Minimal implementation** — create `web/src/sweeps.js`:

```js
/* ============================================================
   THE SWEEP — "my sweeps" switcher store (per-device).
   localStorage "sweep.sweeps.v1" = [{sweepId,name,role,token}].
   addSweep UPSERTs by sweepId (merge name/role; never clobber a
   real token with null). switchTo re-posts the stored token then
   invalidates the sweep + social queries (same mechanism SSE uses).
   ============================================================ */
import { postSession } from "./api/client.js";

const SWEEPS_KEY = "sweep.sweeps.v1";

export function listSweeps() {
  try {
    const raw = localStorage.getItem(SWEEPS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function writeSweeps(arr) {
  try { localStorage.setItem(SWEEPS_KEY, JSON.stringify(arr)); } catch (e) { /* quota — ignore */ }
}

export function addSweep({ sweepId, name, role, token }) {
  const arr = listSweeps();
  const i = arr.findIndex((s) => s.sweepId === sweepId);
  if (i >= 0) {
    const prev = arr[i];
    arr[i] = {
      sweepId,
      name: name != null ? name : prev.name,
      role: role != null ? role : prev.role,
      token: token != null ? token : prev.token,
    };
  } else {
    arr.push({ sweepId, name: name ?? null, role: role ?? null, token: token ?? null });
  }
  writeSweeps(arr);
}

export function removeSweep(sweepId) {
  writeSweeps(listSweeps().filter((s) => s.sweepId !== sweepId));
}

export async function switchTo(sweep, queryClient) {
  await postSession(sweep.token);
  queryClient.invalidateQueries({ queryKey: ["sweep"] });
  queryClient.invalidateQueries({ queryKey: ["social"] });
}
```

- [ ] **Step 4: Run it → Expected: PASS (8 tests).** Then the full web suite is green.

```bash
cd web && npx vitest run src/sweeps.test.js
npm run test -w web
```

- [ ] **Step 5: Commit.**

```bash
git add web/src/sweeps.js web/src/sweeps.test.js
git commit -m "feat(web): add sweep switcher store (sweep.sweeps.v1) + switchTo"
```

### Task 2.3: Per-sweep identity (`ME_KEY` → `sweep.me.v1.<sweepId>`) with legacy migration

`social.js` currently reads/writes one device-global `ME_KEY` (`sweep.me.v1`). Make it per-sweep, keyed by the active sweep id, with a one-time migration copying a legacy `sweep.me.v1` value to `sweep.me.v1.default`. The active sweep id is set by `setCurrentSweepId` (called from the Gate in Task 2.4); before it is set, identity keys to `default`.

**Files:**
- Modify: `web/src/social.js` (`ME_KEY`/`meId` ~lines 13, 21-24; export a new `setCurrentSweepId`)
- Test: `web/src/social.test.js` (append; the file's `beforeEach` already calls `localStorage.clear()` and `setMe(null)`)

- [ ] **Step 1: Write the failing test** — append to `web/src/social.test.js`. Add `setCurrentSweepId` to the existing `social.js` import, then add the tests:

```js
import { setCurrentSweepId } from './social.js'

test('getMe/setMe are scoped to the active sweep id', () => {
  setCurrentSweepId('sw_a')
  setMe('p1')
  expect(localStorage.getItem('sweep.me.v1.sw_a')).toBe('p1')

  setCurrentSweepId('sw_b')
  expect(getMe()).toBe(null)            // no pick in sw_b yet
  setMe('p1')
  expect(localStorage.getItem('sweep.me.v1.sw_b')).toBe('p1')

  setCurrentSweepId('sw_a')
  expect(getMe()?.id).toBe('p1')        // sw_a's pick is still there, independent of sw_b
})

test('switching sweeps re-resolves the current identity from that sweep key', () => {
  localStorage.setItem('sweep.me.v1.sw_a', 'p1')
  setCurrentSweepId('sw_a')
  expect(getMe()?.id).toBe('p1')
  setCurrentSweepId('sw_b')
  expect(getMe()).toBe(null)
})

test('legacy sweep.me.v1 is migrated once to sweep.me.v1.default', () => {
  localStorage.setItem('sweep.me.v1', 'p1')   // a current community user's existing pick
  setCurrentSweepId('default')
  expect(localStorage.getItem('sweep.me.v1.default')).toBe('p1')  // copied across
  expect(getMe()?.id).toBe('p1')                                  // resolved on the default sweep
})

test('migration does not clobber an existing default pick', () => {
  localStorage.setItem('sweep.me.v1', 'p1')            // legacy value
  localStorage.setItem('sweep.me.v1.default', 'none')  // already migrated/cleared
  setCurrentSweepId('default')
  expect(localStorage.getItem('sweep.me.v1.default')).toBe('none')  // not overwritten
  expect(getMe()).toBe(null)                                        // "none" = explicitly cleared
})
```

Note: the seeded person id in this file is `p1` (see the file's `beforeEach`), so `getMe()?.id` resolves against `S.people`.

- [ ] **Step 2: Run it → Expected: FAIL.** First failure is the import: `setCurrentSweepId` is not exported by `social.js`, so the file fails to load with `does not provide an export named 'setCurrentSweepId'`.

```bash
cd web && npx vitest run src/social.test.js
```

- [ ] **Step 3: Minimal implementation** — in `web/src/social.js`, replace the constant + the identity block.

Remove line 13:

```js
const ME_KEY = "sweep.me.v1";
```

Replace the identity block (currently lines 20-24):

```js
/* identity — nobody is auto-selected; "none" = explicitly cleared */
let _meRaw = localStorage.getItem(ME_KEY);
let meId = (_meRaw === null) ? null : (_meRaw === "none" ? null : _meRaw);
export function getMe(){ return meId ? S.people.find(p=>p.id===meId) : null; }
export function setMe(id){ meId = id; try { localStorage.setItem(ME_KEY, id || "none"); } catch(e){} notifySocial(); }
```

with:

```js
const LEGACY_ME_KEY = "sweep.me.v1";              // pre-multi-sweep device-global pointer
let currentSweepId = "default";
const meKey = () => `sweep.me.v1.${currentSweepId}`;
const readMe = () => {
  const raw = localStorage.getItem(meKey());
  return (raw === null || raw === "none") ? null : raw;
};

/* one-time migration: copy a legacy sweep.me.v1 pick to sweep.me.v1.default
   (without clobbering an already-migrated default), then re-key identity. */
export function setCurrentSweepId(id){
  currentSweepId = id || "default";
  if (currentSweepId === "default") {
    const legacy = localStorage.getItem(LEGACY_ME_KEY);
    if (legacy !== null && localStorage.getItem("sweep.me.v1.default") === null) {
      try { localStorage.setItem("sweep.me.v1.default", legacy); } catch(e){}
    }
  }
  meId = readMe();
  notifySocial();
}

/* identity — nobody is auto-selected; "none" = explicitly cleared */
let meId = readMe();
export function getMe(){ return meId ? S.people.find(p=>p.id===meId) : null; }
export function setMe(id){ meId = id; try { localStorage.setItem(meKey(), id || "none"); } catch(e){} notifySocial(); }
```

(Nothing else references `ME_KEY`.)

- [ ] **Step 4: Run it → Expected: PASS.** The new identity tests pass and every existing `social.test.js` test still passes (its `beforeEach` clears storage and `setMe(null)` writes `none` to `sweep.me.v1.default`, the default key). Then the full web suite is green.

```bash
cd web && npx vitest run src/social.test.js
npm run test -w web
```

- [ ] **Step 5: Commit.**

```bash
git add web/src/social.js web/src/social.test.js
git commit -m "feat(web): per-sweep device identity with one-time legacy migration"
```

### Task 2.4: Set the active sweep id from the Gate's bootstrap result

Wire `setCurrentSweepId` (Task 2.3) into `SweepProvider`'s `['sweep']` query so identity keys to the sweep the device is actually viewing. The bootstrap descriptor (`api.bootstrap.sweep`, D7a) names the sweep; fall back to `default` for the unextended/default response.

**Files:**
- Modify: `web/src/SweepProvider.jsx` (import + Gate `['sweep']` queryFn, ~lines 4, 11-18)
- Test: `web/src/SweepProvider.test.jsx` (append; existing `bundle`/`fetch` stub in `beforeEach`)

- [ ] **Step 1: Write the failing test** — append to `web/src/SweepProvider.test.jsx`. Import `getMe`, `setMe` and `setCurrentSweepId` from `social.js`, extend the `/api/bootstrap` stub with a `sweep` descriptor, and assert identity keys to that sweep:

```js
import { getMe, setMe, setCurrentSweepId } from './social.js'

test('sets the active sweep id from bootstrap so identity keys per-sweep', async () => {
  localStorage.clear()
  bundle['/api/bootstrap'] = {
    teams: [{ code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#000', strength: 80 }],
    people: [{ id: 'p1', name: 'A', short: 'A', initials: 'A', av: '#000', avatarPath: null }],
    ownership: {}, scoring: { rule: 'top3' },
    sweep: { id: 'sw_x', name: 'X Sweep' },
  }
  // a pick stored under sw_x must resolve once the gate sets the active sweep id
  localStorage.setItem('sweep.me.v1.sw_x', 'p1')

  render(<SweepProvider><div>app-ready</div></SweepProvider>)
  await waitFor(() => expect(screen.getByText('app-ready')).toBeInTheDocument())
  expect(getMe()?.id).toBe('p1')

  // reset shared module/store state for any later test in this file
  setCurrentSweepId('default'); setMe(null)
  bundle['/api/bootstrap'] = {
    teams: [{ code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#000', strength: 80 }], people: [], ownership: {}, scoring: { rule: 'top3' },
  }
})
```

- [ ] **Step 2: Run it → Expected: FAIL.** The Gate never calls `setCurrentSweepId`, so the active sweep id stays `default`; `getMe()` reads `sweep.me.v1.default` (empty) and returns `null`, so `expect(getMe()?.id).toBe('p1')` fails (`undefined` ≠ `'p1'`).

```bash
cd web && npx vitest run src/SweepProvider.test.jsx
```

- [ ] **Step 3: Minimal implementation** — in `web/src/SweepProvider.jsx`, import `setCurrentSweepId` and call it in the `['sweep']` queryFn before `assembleSweep`.

Change the import on line 4 from:

```js
import { setSocialData } from './social.js'
```

to:

```js
import { setSocialData, setCurrentSweepId } from './social.js'
```

Change the `['sweep']` queryFn body from:

```js
    queryFn: async () => {
      const api = await fetchAll()
      setSweepData(assembleSweep(api))
      return api.syncStatus
    },
```

to:

```js
    queryFn: async () => {
      const api = await fetchAll()
      setCurrentSweepId(api.bootstrap?.sweep?.id || 'default')
      setSweepData(assembleSweep(api))
      return api.syncStatus
    },
```

- [ ] **Step 4: Run it → Expected: PASS (3 tests in this file).** The existing two SweepProvider tests still pass (their bootstrap stub has no `sweep`, so the id falls back to `default`). Then the full web suite is green.

```bash
cd web && npx vitest run src/SweepProvider.test.jsx
npm run test -w web
```

- [ ] **Step 5: Commit.**

```bash
git add web/src/SweepProvider.jsx web/src/SweepProvider.test.jsx
git commit -m "feat(web): set active sweep id from bootstrap in the gate"
```

### Task 2.5: `SweepsSheet` switcher component (lists stored sweeps; switch + leave)

A bottom-sheet overlay (mirroring `IdentitySheet`'s markup) listing `sweep.sweeps.v1` entries. Tapping a non-active sweep calls `switchTo(sweep, qc)` (Task 2.2); a "Leave" action calls `removeSweep(sweepId)` and, when leaving the *active* sweep, `postLogout()` (Slice 0). Empty state mirrors D5 ("you need an invite link"). This component is added BEFORE the App route (Task 2.6) so each commit is green.

**Files:**
- Modify: `web/src/components.jsx` (add `SweepsSheet`; imports at top ~lines 4-11)
- Test: `web/src/components.test.jsx` (append; `vi.mock('./api/client.js', …)` already at top — extend it)

- [ ] **Step 1: Write the failing test.** Extend the existing `vi.mock('./api/client.js', …)` at the top of `web/src/components.test.jsx` to also expose `postSession`/`postLogout`, and add `act` to the `@testing-library/react` import. The mock factory becomes:

```js
vi.mock('./api/client.js', () => ({
  postWatch: vi.fn(async () => ({})),
  postSupport: vi.fn(async () => ({})),
  postSession: vi.fn(async () => ({ sweepId: 'sw_b', role: 'member' })),
  postLogout: vi.fn(async () => ({})),
}))
```

Change the testing-library import to:

```js
import { render, fireEvent, renderHook, act } from '@testing-library/react'
```

Add to the imports:

```js
import { SweepsSheet } from './components.jsx'
import { listSweeps, addSweep } from './sweeps.js'
import { postSession, postLogout } from './api/client.js'
```

Append the tests:

```js
test('SweepsSheet lists stored sweeps and marks the active one', () => {
  addSweep({ sweepId: 'sw_a', name: 'Office', role: 'admin', token: 'ta' })
  addSweep({ sweepId: 'sw_b', name: 'Pub', role: 'member', token: 'tb' })
  const { getByText } = render(<SweepsSheet activeSweepId="sw_a" onClose={() => {}} queryClient={{ invalidateQueries: vi.fn() }} />)
  expect(getByText('Office')).toBeInTheDocument()
  expect(getByText('Pub')).toBeInTheDocument()
  expect(getByText(/current/i)).toBeInTheDocument()  // the active sweep is badged
})

test('SweepsSheet switching a stored sweep posts its token and invalidates queries', async () => {
  addSweep({ sweepId: 'sw_a', name: 'Office', role: 'admin', token: 'ta' })
  addSweep({ sweepId: 'sw_b', name: 'Pub', role: 'member', token: 'tb' })
  const qc = { invalidateQueries: vi.fn() }
  const { getByText } = render(<SweepsSheet activeSweepId="sw_a" onClose={() => {}} queryClient={qc} />)
  await act(async () => { fireEvent.click(getByText('Pub')) })
  expect(postSession).toHaveBeenCalledWith('tb')
  expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sweep'] })
})

test('SweepsSheet leaving the active sweep removes it from the store and logs out', async () => {
  addSweep({ sweepId: 'sw_a', name: 'Office', role: 'admin', token: 'ta' })
  addSweep({ sweepId: 'sw_b', name: 'Pub', role: 'member', token: 'tb' })
  const { getAllByLabelText } = render(<SweepsSheet activeSweepId="sw_a" onClose={() => {}} queryClient={{ invalidateQueries: vi.fn() }} />)
  await act(async () => { fireEvent.click(getAllByLabelText(/leave/i)[0]) })  // first row = sw_a (active)
  expect(listSweeps().map((s) => s.sweepId)).toEqual(['sw_b'])
  expect(postLogout).toHaveBeenCalled()
})

test('SweepsSheet shows an empty state when no sweeps are stored', () => {
  const { getByText } = render(<SweepsSheet activeSweepId={null} onClose={() => {}} queryClient={{ invalidateQueries: vi.fn() }} />)
  expect(getByText(/invite link/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run it → Expected: FAIL.** `SweepsSheet` is not exported by `components.jsx`, so the import errors and all four new tests fail to run (`does not provide an export named 'SweepsSheet'`).

```bash
cd web && npx vitest run src/components.test.jsx
```

- [ ] **Step 3: Minimal implementation** — in `web/src/components.jsx`, add `SweepsSheet`. First add the `sweeps.js`/client imports after the existing `social.js` import block (~line 9):

```js
import { listSweeps, removeSweep, switchTo } from "./sweeps.js";
import { postLogout } from "./api/client.js";
```

Then add the component (place it next to `IdentityControl`/`IdentitySheet`):

```jsx
/* "My sweeps" switcher — lists sweep.sweeps.v1; tap to switch, Leave to drop.
   Leaving the active sweep also clears the server session (postLogout). */
export function SweepsSheet({ activeSweepId, onClose, queryClient }){
  const [sweeps, setSweeps] = useState(() => listSweeps());
  const refresh = () => setSweeps(listSweeps());

  const onSwitch = async (s) => {
    if (s.sweepId === activeSweepId) { onClose(); return; }
    await switchTo(s, queryClient);
    onClose();
  };
  const onLeave = async (s) => {
    removeSweep(s.sweepId);
    if (s.sweepId === activeSweepId) { try { await postLogout(); } catch (e) { /* ignore */ } }
    refresh();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={e=>e.stopPropagation()} style={{maxHeight:"84%"}}>
        <div className="grab"></div>
        <div className="sheet-head"><h3>My sweeps</h3><button className="x" onClick={onClose}><Icon.x/></button></div>
        <div className="sheet-body">
          {sweeps.length === 0 ? (
            <p style={{fontSize:13,color:"var(--muted2)",textAlign:"center",padding:"24px 0"}}>
              No sweeps on this device yet. Open an invite link to join one.
            </p>
          ) : (
            <div className="plist">
              {sweeps.map(s=>(
                <div className={"prow"+(s.sweepId===activeSweepId?" mepick":"")} key={s.sweepId} style={{padding:"9px 12px"}}>
                  <button className="pi" onClick={()=>onSwitch(s)} style={{flex:1,textAlign:"left",border:0,background:"transparent",cursor:"pointer"}}>
                    <b style={{fontSize:16}}>{s.name || s.sweepId}</b>
                    <div className="tms">
                      <span className="t">{s.role === "admin" ? "You can admin this sweep" : "Member"}</span>
                      {s.sweepId===activeSweepId && <span className="t">· current</span>}
                    </div>
                  </button>
                  <button className="x" aria-label={`Leave ${s.name || s.sweepId}`} title="Leave" onClick={()=>onLeave(s)}><Icon.x/></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run it → Expected: PASS (4 new tests).** The existing `components.test.jsx` tests still pass (the widened client mock only adds exports). Then the full web suite is green.

```bash
cd web && npx vitest run src/components.test.jsx
npm run test -w web
```

- [ ] **Step 5: Commit.**

```bash
git add web/src/components.jsx web/src/components.test.jsx
git commit -m "feat(web): add SweepsSheet switcher (switch + leave-sweep)"
```

### Task 2.6: `sweeps` overlay route in `App.jsx` + Sidebar footer entry

Add a `sweeps` overlay to `App.jsx` routing (mirroring the `admin`/`knockouts` pattern in `urlFor`/`readView`) rendering `SweepsSheet`, and a "My sweeps" button in the desktop `Sidebar` footer (`sb-foot`, next to `IdentityControl`). `SweepsSheet` exists (Task 2.5), so importing/rendering it keeps every commit green.

**Files:**
- Modify: `web/src/App.jsx` (`urlFor`/`readView` ~lines 25-40; openers ~lines 89-99; `modals` group ~lines 121-130; `Sidebar` props ~line 135)
- Modify: `web/src/components.jsx` (`Sidebar` `sb-foot` ~lines 375-378; add an `onSweeps` prop)
- Test: `web/src/App.test.jsx` (append)

- [ ] **Step 1: Write the failing test** — append to `web/src/App.test.jsx`. Add `addSweep` to the imports (the file already imports `screen`-free helpers; add `screen` to the `@testing-library/react` import line — change it to `import { render, act, screen } from '@testing-library/react'`). Then:

```js
import { addSweep } from './sweeps.js'

test('navigating to /sweeps opens the My-sweeps switcher overlay', () => {
  addSweep({ sweepId: 'sw_a', name: 'Office', role: 'admin', token: 'ta' })
  render(<App />)
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate', {
      state: { tab: 'home', overlay: { type: 'sweeps' }, modal: null, identity: false },
    }))
  })
  expect(screen.getByText('My sweeps')).toBeInTheDocument()
  expect(screen.getByText('Office')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run it → Expected: FAIL.** `App.jsx` does not handle `overlay.type === 'sweeps'`, so no `SweepsSheet` renders; `screen.getByText('My sweeps')` throws "Unable to find an element with the text: My sweeps".

```bash
cd web && npx vitest run src/App.test.jsx
```

- [ ] **Step 3: Minimal implementation** — in `web/src/App.jsx`:

Add `SweepsSheet` to the `components.jsx` import block (~lines 6-8):

```js
import {
  Icon, BottomNav, Sidebar, IdentitySheet, SweepsSheet, useIsDesktop,
} from "./components.jsx";
```

Add a react-query import so the sheet can invalidate (top of `App.jsx`):

```js
import { useQueryClient } from "@tanstack/react-query";
```

In `urlFor`, add a `sweeps` case:

```js
  if (v.overlay?.type === "admin") return "/admin";
  if (v.overlay?.type === "sweeps") return "/sweeps";
```

In `readView`, add the matching segment:

```js
  if (seg[0] === "admin") return { ...base, overlay: { type: "admin" } };
  if (seg[0] === "sweeps") return { ...base, overlay: { type: "sweeps" } };
```

Inside `App()`, get the query client (guarded — `App.test.jsx` renders `<App/>` with no `QueryClientProvider`, so the hook must not throw) and add an opener, next to `openAdmin`/`openKnock` (~line 98):

```js
  let qc = null;
  try { qc = useQueryClient(); } catch (e) { qc = null; }
  const openSweeps = () => navigate({ overlay: { type: "sweeps" } });
```

Render the sheet in the `modals` fragment (after `{identity && <IdentitySheet onClose={goBack}/>}`):

```jsx
      {overlay?.type==="sweeps" && <SweepsSheet activeSweepId={S.sweep?.id ?? null} onClose={goBack} queryClient={qc}/>}
```

Pass the opener to the desktop `Sidebar` (~line 135):

```jsx
        <Sidebar current={current} go={go} onKnock={openKnock} onAdmin={openAdmin} onSweeps={openSweeps}/>
```

In `web/src/components.jsx`, accept `onSweeps` and render a footer button in `sb-foot`. Change the signature:

```jsx
export function Sidebar({ current, go, onKnock, onAdmin, onSweeps }) {
```

and the footer:

```jsx
      <div className="sb-foot">
        <IdentityControl dark/>
        {onSweeps && <button className="sb-item" onClick={onSweeps} style={{marginTop:8}}><Icon.swap/><span>My sweeps</span></button>}
        <div className="dt" style={{marginTop:12}}><b>{fmtDate(new Date())}</b></div>
      </div>
```

- [ ] **Step 4: Run it → Expected: PASS.** The new App test passes (the `sweeps` overlay renders `SweepsSheet` with "My sweeps"/"Office"); the existing App tests still pass — the `sweeps` overlay does not change `urlFor` for the `/` and `/schedule` routes they exercise, and the guarded `useQueryClient` returns `null` under bare `<App/>` render without throwing. Then the full web suite is green.

```bash
cd web && npx vitest run src/App.test.jsx
npm run test -w web
```

- [ ] **Step 5: Commit.**

```bash
git add web/src/App.jsx web/src/components.jsx web/src/App.test.jsx
git commit -m "feat(web): add /sweeps switcher overlay route + sidebar entry"
```


## Slice 3: Group-admin console (host-aware): people + draw + moderation

This slice extends `AdminScreen`/`AdminQueue` (`web/src/screens-detail.jsx` L742–837) into a tabbed group-admin console. It (a) host-forks the unlock gate via a pure `adminGateState(whoami)` helper driven by `fetchWhoami()` (added in Slice 0); (b) adds a **People** tab (list/create/rename/delete) and a **Draw** tab (assign/remove team ownership); and (c) keeps the existing Moderation queue as-is. The credentialed client helpers `patchCreds`/`deleteCreds` are introduced here (first consumer), plus `createPerson`/`deletePerson`/`patchPerson`/`postOwnership`/`deleteOwnership`.

> Depends on: Slice 0 (`fetchWhoami` in `web/src/api/client.js`, `credentials:'include'` on the public fetchers) and Slice B (`PATCH /api/admin/people/:id`). `patchPerson` here calls that endpoint.

### Task 3.1: Credentialed `patchCreds`/`deleteCreds` + people/ownership client helpers

**Files:**
- Modify: `web/src/api/client.js` (after the existing `getCreds`/`postCreds` block, L35–48; append new exports after L64)
- Test: `web/src/api/client.test.js` (append; existing file ends at L111)

- [ ] **Step 1: Write the failing test.** Append to `web/src/api/client.test.js`:

```js
test('patchCreds and patchPerson PATCH JSON with credentials', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    calls.push({ url, opts })
    return { ok: true, status: 200, json: async () => ({ id: 'p1', name: 'Bo' }) }
  }))
  const { patchPerson } = await import('./client.js')
  const res = await patchPerson('p1', { name: 'Bo' })
  expect(res).toEqual({ id: 'p1', name: 'Bo' })
  expect(calls[0].url).toMatch(/\/api\/admin\/people\/p1$/)
  expect(calls[0].opts.method).toBe('PATCH')
  expect(calls[0].opts.credentials).toBe('include')
  expect(calls[0].opts.headers['Content-Type']).toBe('application/json')
  expect(JSON.parse(calls[0].opts.body)).toEqual({ name: 'Bo' })
})

test('createPerson POSTs the new person fields with credentials', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 201, json: async () => ({ id: 'p9' }) } }))
  const { createPerson } = await import('./client.js')
  await createPerson({ name: 'New', short: 'New', initials: 'NW', av: null })
  expect(calls[0].url).toMatch(/\/api\/admin\/people$/)
  expect(calls[0].opts.method).toBe('POST')
  expect(calls[0].opts.credentials).toBe('include')
  expect(JSON.parse(calls[0].opts.body)).toEqual({ name: 'New', short: 'New', initials: 'NW', av: null })
})

test('deletePerson DELETEs /api/admin/people/:id with credentials', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ ok: true }) } }))
  const { deletePerson } = await import('./client.js')
  await deletePerson('p1')
  expect(calls[0].url).toMatch(/\/api\/admin\/people\/p1$/)
  expect(calls[0].opts.method).toBe('DELETE')
  expect(calls[0].opts.credentials).toBe('include')
})

test('postOwnership and deleteOwnership send personId+teamCode with credentials', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ ok: true }) } }))
  const { postOwnership, deleteOwnership } = await import('./client.js')
  await postOwnership('p1', 'hr')
  expect(calls[0].url).toMatch(/\/api\/admin\/ownership$/)
  expect(calls[0].opts.method).toBe('POST')
  expect(calls[0].opts.credentials).toBe('include')
  expect(JSON.parse(calls[0].opts.body)).toEqual({ personId: 'p1', teamCode: 'hr' })
  await deleteOwnership('p1', 'hr')
  expect(calls[1].opts.method).toBe('DELETE')
  expect(calls[1].opts.credentials).toBe('include')
  expect(JSON.parse(calls[1].opts.body)).toEqual({ personId: 'p1', teamCode: 'hr' })
})
```

- [ ] **Step 2: Run it → Expected: FAIL.**

```bash
cd web && npx vitest run src/api/client.test.js
```

Expected: FAIL — `TypeError: patchPerson is not a function` (also `createPerson`/`deletePerson`/`postOwnership`/`deleteOwnership` undefined). The 8 pre-existing tests still pass.

- [ ] **Step 3: Minimal implementation.** In `web/src/api/client.js`, add the two credentialed helpers right after `postCreds` (after L48):

```js
async function patchCreds(path, body) {
  const res = await fetch(path, {
    method: 'PATCH', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`PATCH ${path} failed: HTTP ${res.status}`)
  return res.json()
}
async function deleteCreds(path, body) {
  const res = await fetch(path, {
    method: 'DELETE', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`DELETE ${path} failed: HTTP ${res.status}`)
  return res.json()
}
```

Then append the group-admin exports at the end of the file (after L64):

```js
export const createPerson = (fields) => postCreds('/api/admin/people', fields)
export const deletePerson = (id) => deleteCreds(`/api/admin/people/${id}`, {})
export const patchPerson = (id, fields) => patchCreds(`/api/admin/people/${id}`, fields)
export const postOwnership = (personId, teamCode) => postCreds('/api/admin/ownership', { personId, teamCode })
export const deleteOwnership = (personId, teamCode) => deleteCreds('/api/admin/ownership', { personId, teamCode })
```

- [ ] **Step 4: Run it → Expected: PASS.**

```bash
cd web && npx vitest run src/api/client.test.js
```

Expected: PASS (12 tests). Then the full web suite:

```bash
npm run test -w web
```

Expected: green.

- [ ] **Step 5: Commit.**

```bash
git add web/src/api/client.js web/src/api/client.test.js && git commit -m "feat(web): add credentialed patch/delete helpers + people & ownership client calls"
```

### Task 3.2: `adminGateState(whoami)` host-fork helper + wire the AdminScreen unlock

**Files:**
- Modify: `web/src/screens-detail.jsx` (export new `adminGateState`; rewrite `AdminScreen` L742–780; add `fetchWhoami` to the client import at L16)
- Test: `web/src/screens-detail.test.jsx` (append; existing file ends at L353)

The pure helper has exactly one signature — `adminGateState(whoami)` — and no host heuristic beyond the cookie role / default-sweep id:

- `whoami.role === 'admin'` → `'unlocked'` (platform admin link already minted the cookie; no PIN)
- else `whoami.sweepId === 'default'` → `'pin'` (default host keeps the 4-digit PIN)
- else → `'need-link'` (platform host, member/no session → "open your admin link")

- [ ] **Step 1: Write the failing test.** Append to `web/src/screens-detail.test.jsx`:

```js
import { adminGateState, AdminScreen } from './screens-detail.jsx'
import { waitFor } from '@testing-library/react'

test('adminGateState forks on whoami role / default sweep', () => {
  expect(adminGateState({ sweepId: 'sw_abc', role: 'admin' })).toBe('unlocked')
  expect(adminGateState({ sweepId: 'default', role: 'admin' })).toBe('unlocked')
  expect(adminGateState({ sweepId: 'default', role: 'member' })).toBe('pin')
  expect(adminGateState({ sweepId: 'default', role: null })).toBe('pin')
  expect(adminGateState({ sweepId: 'sw_abc', role: 'member' })).toBe('need-link')
  expect(adminGateState({ sweepId: null, role: null })).toBe('need-link')
})
```

Then add a render test for the unlock fork. The module is already mocked at the top of this file (L5–8) — extend that mock object with the calls `AdminScreen`/`AdminQueue` use so the component mounts without real network. Replace the existing `vi.mock('./api/client.js', …)` block (L5–8) with:

```js
vi.mock('./api/client.js', () => ({
  postWatch: vi.fn(async () => ({})),
  postSupport: vi.fn(async () => ({})),
  uploadPhoto: vi.fn(async () => ({})),
  adminLogin: vi.fn(async () => ({ admin: true })),
  fetchAdminMe: vi.fn(async () => { throw new Error('401') }),
  fetchAdminPhotos: vi.fn(async () => ({ pending: [], approved: [] })),
  moderatePhoto: vi.fn(async () => ({})),
  fetchWhoami: vi.fn(async () => ({ sweepId: 'default', role: 'member' })),
  createPerson: vi.fn(async () => ({})),
  deletePerson: vi.fn(async () => ({})),
  patchPerson: vi.fn(async () => ({})),
  postOwnership: vi.fn(async () => ({})),
  deleteOwnership: vi.fn(async () => ({})),
}))
import { fetchWhoami } from './api/client.js'
```

Then append the render test:

```js
test('AdminScreen on the platform host with an admin cookie unlocks without a PIN', async () => {
  fetchWhoami.mockResolvedValueOnce({ sweepId: 'sw_abc', role: 'admin' })
  setSweepData(assembleSweep({
    bootstrap: { teams: [], people: [], ownership: {}, scoring: null },
    fixtures: [], standings: {}, photos: [], syncStatus: { stale: false },
  }))
  const { findByText, queryByText } = render(<AdminScreen onBack={noop} onToast={noop} />)
  expect(await findByText('People')).toBeTruthy()        // landed on the People tab, no keypad
  expect(queryByText('Enter passcode')).toBeNull()
})

test('AdminScreen on a platform member (no admin link) prompts to open the admin link', async () => {
  fetchWhoami.mockResolvedValueOnce({ sweepId: 'sw_abc', role: 'member' })
  const { findByText, queryByText } = render(<AdminScreen onBack={noop} onToast={noop} />)
  expect(await findByText(/admin link/i)).toBeTruthy()
  expect(queryByText('Enter passcode')).toBeNull()
})

test('AdminScreen on the default host with no admin cookie still shows the PIN keypad', async () => {
  fetchWhoami.mockResolvedValueOnce({ sweepId: 'default', role: 'member' })
  const { findByText } = render(<AdminScreen onBack={noop} onToast={noop} />)
  expect(await findByText('Enter passcode')).toBeTruthy()
})
```

- [ ] **Step 2: Run it → Expected: FAIL.**

```bash
cd web && npx vitest run src/screens-detail.test.jsx
```

Expected: FAIL — `adminGateState is not a function` for the helper test; the render tests fail because `AdminScreen` does not yet consult `fetchWhoami` (it renders the keypad regardless, so "People" / "admin link" are never found).

- [ ] **Step 3: Minimal implementation.** In `web/src/screens-detail.jsx`, extend the client import at L16 to include the new functions:

```js
import { uploadPhoto, adminLogin, fetchAdminMe, fetchAdminPhotos, moderatePhoto, fetchWhoami, createPerson, deletePerson, patchPerson, postOwnership, deleteOwnership } from "./api/client.js";
```

Add the pure helper above `AdminScreen` (before L742):

```js
/* Host-aware admin gate. On the platform host the sweep_session cookie already
   carries role 'admin' (minted by the admin capability link) → unlock with no PIN.
   On the default host (sweepId 'default') keep the 4-digit PIN. A platform member
   with no admin link gets a "open your admin link" prompt. */
export function adminGateState(whoami) {
  if (whoami && whoami.role === 'admin') return 'unlocked';
  if (whoami && whoami.sweepId === 'default') return 'pin';
  return 'need-link';
}
```

Replace the whole `AdminScreen` body (L742–780) with a version that resolves the gate from `whoami` first:

```js
export function AdminScreen({ onBack, onToast }) {
  const [code, setCode] = useState("");
  const [gate, setGate] = useState(null); // null = checking; 'unlocked'|'pin'|'need-link'
  const [shake, setShake] = useState(false);

  useEffect(()=>{ fetchWhoami().then(w=>setGate(adminGateState(w))).catch(()=>setGate('pin')); },[]);

  function fail(){ setShake(true); setTimeout(()=>{ setShake(false); setCode(""); }, 400); }
  function press(d){
    if(code.length>=4) return;
    const nc = code + d; setCode(nc);
    if(nc.length===4){ setTimeout(async ()=>{ try { await adminLogin(nc); setGate('unlocked'); refreshAdminBadge(); } catch { fail(); } }, 120); }
  }
  function del(){ setCode(c=>c.slice(0,-1)); }

  if(gate===null) return <div style={{display:"flex",flexDirection:"column",height:"100%"}}><PageHeader title="Admin" sub="Restricted area" onBack={onBack} /></div>;

  if(gate==='need-link'){
    return (
      <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
        <PageHeader title="Admin" sub="Restricted area" onBack={onBack} />
        <div className="scroll pad screen-anim" style={{display:"flex",flexDirection:"column",alignItems:"center",paddingTop:40}}>
          <div className="lockic"><Icon.lock/></div>
          <h3 style={{fontFamily:"'Barlow Condensed'",fontWeight:800,fontSize:20,textTransform:"uppercase",color:"var(--navy)"}}>Open your admin link</h3>
          <p style={{fontSize:12.5,color:"var(--muted)",marginTop:6,textAlign:"center",maxWidth:280}}>This sweep is admined from its admin link. Open the admin invite link on this device to manage it.</p>
        </div>
      </div>
    );
  }

  if(gate==='pin'){
    return (
      <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
        <PageHeader title="Admin" sub="Restricted area" onBack={onBack} />
        <div className="scroll passpad screen-anim" style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
          <div className="lockic"><Icon.lock/></div>
          <h3 style={{fontFamily:"'Barlow Condensed'",fontWeight:800,fontSize:20,textTransform:"uppercase",color:"var(--navy)"}}>Enter passcode</h3>
          <p style={{fontSize:12.5,color:"var(--muted)",marginTop:6,textAlign:"center"}}>Admin only.</p>
          <div className={"passdots"} style={{transform:shake?"translateX(0)":"none",animation:shake?"shake .4s":"none"}}>
            {[0,1,2,3].map(i=><i key={i} className={i<code.length?"f":""}></i>)}
          </div>
          <div className="keypad">
            {[1,2,3,4,5,6,7,8,9].map(n=><button key={n} className="key" onClick={()=>press(""+n)}>{n}</button>)}
            <button className="key blank"></button>
            <button className="key" onClick={()=>press("0")}>0</button>
            <button className="key blank" onClick={del} style={{fontSize:14,color:"var(--muted)"}}>⌫</button>
          </div>
        </div>
        <style>{`@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}`}</style>
      </div>
    );
  }

  return <AdminConsole onBack={onBack} onToast={onToast} />;
}
```

Add a minimal `AdminConsole` that defaults to the People tab and reuses the existing `AdminQueue` for moderation. Insert it directly below `AdminScreen` (the People/Draw tab bodies are fleshed out in Tasks 3.3–3.4; here they only need a heading so the gate tests are deterministic):

```js
export function AdminConsole({ onBack, onToast }) {
  const [tab, setTab] = useState("people"); // 'people' | 'draw' | 'mod'
  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <PageHeader title="Admin" sub="Manage your sweep" onBack={onBack} right={<div className="iconbtn"><Icon.shield/></div>} />
      <div className="admintabs">
        <button className={"admintab"+(tab==="people"?" on":"")} onClick={()=>setTab("people")}>People</button>
        <button className={"admintab"+(tab==="draw"?" on":"")} onClick={()=>setTab("draw")}>Draw</button>
        <button className={"admintab"+(tab==="mod"?" on":"")} onClick={()=>setTab("mod")}>Moderation</button>
      </div>
      {tab==="people" && <PeopleAdmin onToast={onToast} />}
      {tab==="draw" && <DrawAdmin onToast={onToast} />}
      {tab==="mod" && <AdminQueue embedded onToast={onToast} />}
    </div>
  );
}

function PeopleAdmin({ onToast }) {
  return <div className="scroll pad screen-anim" style={{paddingTop:10}}><div className="wrap"><h3 className="adminsec-h">People</h3></div></div>;
}
function DrawAdmin({ onToast }) {
  return <div className="scroll pad screen-anim" style={{paddingTop:10}}><div className="wrap"><h3 className="adminsec-h">The draw</h3></div></div>;
}
```

`AdminQueue` currently renders its own `PageHeader`; when embedded in the console it must not draw a second one. Add an `embedded` prop guard to its header. Change L805 from:

```js
      <PageHeader title="Moderation" sub="Photo queue" onBack={onBack} right={<div className="iconbtn"><Icon.shield/></div>} />
```

to:

```js
      {!embedded && <PageHeader title="Moderation" sub="Photo queue" onBack={onBack} right={<div className="iconbtn"><Icon.shield/></div>} />}
```

and update its signature (L782) from `export function AdminQueue({ onBack, onToast }) {` to:

```js
export function AdminQueue({ onBack, onToast, embedded }) {
```

- [ ] **Step 4: Run it → Expected: PASS.**

```bash
cd web && npx vitest run src/screens-detail.test.jsx
```

Expected: PASS (the 24 pre-existing MatchSheet/TeamDetail/PersonDetail tests, the helper test, and the 3 gate-render tests). Then the full web suite:

```bash
npm run test -w web
```

Expected: green.

- [ ] **Step 5: Commit.**

```bash
git add web/src/screens-detail.jsx web/src/screens-detail.test.jsx && git commit -m "feat(web): host-aware admin gate (adminGateState) + tabbed admin console shell"
```

### Task 3.3: People tab — list, create, rename, delete

**Files:**
- Modify: `web/src/screens-detail.jsx` (flesh out `PeopleAdmin`, added in Task 3.2)
- Test: `web/src/screens-detail.test.jsx` (append)

`PeopleAdmin` reads the current sweep's people from the assembled store (`S.people` — `{id, name, short, initials, av, teams}`), creates via `createPerson`, renames via `patchPerson` (Slice B endpoint), and deletes via `deletePerson`. After any write it calls `onReload()` so the parent can re-pull `bootstrap`; in this slice the local list is refreshed from `S.people` after the awaited write resolves (the `['sweep']` query is the real source — invalidation is wired by the switcher in Slice 2; here we re-read `S.people` directly to reflect optimistic UI and toast).

- [ ] **Step 1: Write the failing test.** Append to `web/src/screens-detail.test.jsx`:

```js
import { PeopleAdmin } from './screens-detail.jsx'
import { createPerson, patchPerson, deletePerson } from './api/client.js'

function seedPeople() {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [{ code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#c00', strength: 80 }],
      people: [{ id: 'p1', name: 'Ann', short: 'Ann', initials: 'AN' }],
      ownership: { p1: ['hr'] }, scoring: null,
    },
    fixtures: [], standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ watch: {}, support: {} })
}

test('PeopleAdmin lists existing sweep people', () => {
  seedPeople()
  const { getByText } = render(<PeopleAdmin onToast={noop} />)
  expect(getByText('Ann')).toBeTruthy()
})

test('PeopleAdmin creates a person via createPerson', async () => {
  seedPeople()
  createPerson.mockResolvedValueOnce({ id: 'p2', name: 'Bo' })
  const { getByPlaceholderText, getByText } = render(<PeopleAdmin onToast={noop} />)
  fireEvent.change(getByPlaceholderText('Add a person…'), { target: { value: 'Bo' } })
  fireEvent.click(getByText('Add'))
  await waitFor(() => expect(createPerson).toHaveBeenCalledTimes(1))
  expect(createPerson.mock.calls[0][0]).toMatchObject({ name: 'Bo', short: 'Bo', initials: 'BO' })
})

test('PeopleAdmin renames a person via patchPerson', async () => {
  seedPeople()
  patchPerson.mockResolvedValueOnce({ id: 'p1', name: 'Annie' })
  const { getByLabelText, getByDisplayValue, getByText } = render(<PeopleAdmin onToast={noop} />)
  fireEvent.click(getByLabelText('Rename Ann'))
  fireEvent.change(getByDisplayValue('Ann'), { target: { value: 'Annie' } })
  fireEvent.click(getByText('Save'))
  await waitFor(() => expect(patchPerson).toHaveBeenCalledWith('p1', { name: 'Annie' }))
})

test('PeopleAdmin deletes a person via deletePerson', async () => {
  seedPeople()
  deletePerson.mockResolvedValueOnce({ ok: true })
  const { getByLabelText } = render(<PeopleAdmin onToast={noop} />)
  fireEvent.click(getByLabelText('Remove Ann'))
  await waitFor(() => expect(deletePerson).toHaveBeenCalledWith('p1'))
})
```

- [ ] **Step 2: Run it → Expected: FAIL.**

```bash
cd web && npx vitest run src/screens-detail.test.jsx
```

Expected: FAIL — the placeholder `PeopleAdmin` renders only the "People" heading, so `getByText('Ann')`, `getByPlaceholderText('Add a person…')`, `getByLabelText('Rename Ann')` and `getByLabelText('Remove Ann')` all throw "Unable to find…".

- [ ] **Step 3: Minimal implementation.** Replace the placeholder `PeopleAdmin` (added in Task 3.2) with a working version. Initials default to the first two letters of the name, uppercased; `short` defaults to the full name (admin can rename later):

```js
function PeopleAdmin({ onToast }) {
  const [people, setPeople] = useState(S.people);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(null); // person id
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);

  const sync = () => setPeople(S.people.slice());

  async function add(){
    const nm = name.trim();
    if(!nm || busy) return;
    setBusy(true);
    try {
      const initials = nm.replace(/[^A-Za-z]/g,"").slice(0,2).toUpperCase() || "??";
      await createPerson({ name: nm, short: nm, initials, av: null });
      setName(""); onToast("Person added");
    } catch { onToast("Couldn't add — try again"); }
    finally { setBusy(false); }
  }
  async function save(id){
    const nm = editName.trim();
    if(!nm || busy) return;
    setBusy(true);
    try { await patchPerson(id, { name: nm }); setEditing(null); onToast("Saved"); }
    catch { onToast("Couldn't save — try again"); }
    finally { setBusy(false); }
  }
  async function remove(p){
    if(busy) return;
    setBusy(true);
    try { await deletePerson(p.id); onToast("Person removed"); sync(); }
    catch { onToast("Couldn't remove — try again"); }
    finally { setBusy(false); }
  }

  return (
    <div className="scroll pad screen-anim" style={{paddingTop:10}}>
      <div className="wrap">
        <h3 className="adminsec-h">People</h3>
        <div className="adminadd">
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Add a person…" onKeyDown={e=>{ if(e.key==="Enter") add(); }} />
          <button className="qbtn app" disabled={busy} onClick={add}><Icon.check/> Add</button>
        </div>
        <div className="plist" style={{marginTop:12}}>
          {people.map(p=>(
            <div className="prow" key={p.id}>
              <PersonAvatar p={p} cls="pav"/>
              <div className="pi" style={{flex:1}}>
                {editing===p.id ? (
                  <input className="adminrename" defaultValue={p.name} onChange={e=>setEditName(e.target.value)} aria-label={"Edit name "+p.name} />
                ) : <b>{p.name}</b>}
              </div>
              {editing===p.id ? (
                <button className="qbtn app" disabled={busy} onClick={()=>save(p.id)}>Save</button>
              ) : (
                <button className="iconbtn" aria-label={"Rename "+p.name} onClick={()=>{ setEditing(p.id); setEditName(p.name); }}><Icon.swap/></button>
              )}
              <button className="iconbtn" aria-label={"Remove "+p.name} disabled={busy} onClick={()=>remove(p)}><Icon.trash/></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run it → Expected: PASS.**

```bash
cd web && npx vitest run src/screens-detail.test.jsx
```

Expected: PASS (all prior tests plus the 4 new People-CRUD tests). Then the full web suite:

```bash
npm run test -w web
```

Expected: green.

- [ ] **Step 5: Commit.**

```bash
git add web/src/screens-detail.jsx web/src/screens-detail.test.jsx && git commit -m "feat(web): admin People tab — list/create/rename/delete sweep people"
```

### Task 3.4: Draw tab — assign and remove team ownership

**Files:**
- Modify: `web/src/screens-detail.jsx` (flesh out `DrawAdmin`, added in Task 3.2)
- Test: `web/src/screens-detail.test.jsx` (append)

"The draw" is manual: pick a person, pick a team, assign it via `postOwnership`; remove an existing assignment via `deleteOwnership`. There is no draft endpoint. A person's current teams come from `S.people` (`p.teams`); the team list is `S.teamList`.

- [ ] **Step 1: Write the failing test.** Append to `web/src/screens-detail.test.jsx`:

```js
import { DrawAdmin } from './screens-detail.jsx'
import { postOwnership, deleteOwnership } from './api/client.js'

function seedDraw() {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#c00', strength: 80 },
        { code: 'en', name: 'England', group: 'L', pool: 'A', color: '#fff', strength: 90 },
      ],
      people: [{ id: 'p1', name: 'Ann', short: 'Ann', initials: 'AN' }],
      ownership: { p1: ['hr'] }, scoring: null,
    },
    fixtures: [], standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ watch: {}, support: {} })
}

test('DrawAdmin assigns a team to a person via postOwnership', async () => {
  seedDraw()
  postOwnership.mockResolvedValueOnce({ ok: true })
  const { getByLabelText, getByText } = render(<DrawAdmin onToast={noop} />)
  fireEvent.change(getByLabelText('Person'), { target: { value: 'p1' } })
  fireEvent.change(getByLabelText('Team'), { target: { value: 'en' } })
  fireEvent.click(getByText('Assign'))
  await waitFor(() => expect(postOwnership).toHaveBeenCalledWith('p1', 'en'))
})

test('DrawAdmin removes an existing assignment via deleteOwnership', async () => {
  seedDraw()
  deleteOwnership.mockResolvedValueOnce({ ok: true })
  const { getByLabelText } = render(<DrawAdmin onToast={noop} />)
  fireEvent.change(getByLabelText('Person'), { target: { value: 'p1' } })
  fireEvent.click(getByLabelText('Unassign Croatia'))
  await waitFor(() => expect(deleteOwnership).toHaveBeenCalledWith('p1', 'hr'))
})
```

- [ ] **Step 2: Run it → Expected: FAIL.**

```bash
cd web && npx vitest run src/screens-detail.test.jsx
```

Expected: FAIL — the placeholder `DrawAdmin` renders only "The draw"; `getByLabelText('Person')`, `getByLabelText('Team')`, the `Assign` button and `Unassign Croatia` are not found.

- [ ] **Step 3: Minimal implementation.** Replace the placeholder `DrawAdmin` (added in Task 3.2):

```js
function DrawAdmin({ onToast }) {
  const [people, setPeople] = useState(S.people);
  const [pid, setPid] = useState(S.people[0]?.id || "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const sync = () => setPeople(S.people.slice());
  const person = people.find(p=>p.id===pid);
  const owned = person ? person.teams : [];
  const free = S.teamList.filter(t=>!owned.includes(t.code));

  async function assign(){
    if(!pid || !code || busy) return;
    setBusy(true);
    try { await postOwnership(pid, code); setCode(""); onToast("Team assigned"); sync(); }
    catch { onToast("Couldn't assign — try again"); }
    finally { setBusy(false); }
  }
  async function unassign(tc){
    if(!pid || busy) return;
    setBusy(true);
    try { await deleteOwnership(pid, tc); onToast("Team unassigned"); sync(); }
    catch { onToast("Couldn't unassign — try again"); }
    finally { setBusy(false); }
  }

  return (
    <div className="scroll pad screen-anim" style={{paddingTop:10}}>
      <div className="wrap">
        <h3 className="adminsec-h">The draw</h3>
        <div className="adminadd" style={{flexWrap:"wrap"}}>
          <select aria-label="Person" value={pid} onChange={e=>setPid(e.target.value)}>
            {people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select aria-label="Team" value={code} onChange={e=>setCode(e.target.value)}>
            <option value="">Pick a team…</option>
            {free.map(t=><option key={t.code} value={t.code}>{t.name}</option>)}
          </select>
          <button className="qbtn app" disabled={busy || !code} onClick={assign}>Assign</button>
        </div>
        <div className="plist" style={{marginTop:12}}>
          {owned.length===0 && <p style={{fontSize:13,color:"var(--muted2)",padding:"8px 2px"}}>No teams assigned yet.</p>}
          {owned.map(tc=>{
            const t = S.team(tc);
            return (
              <div className="prow" key={tc}>
                <img className="flag" src={S.flag(tc,40)} alt="" />
                <div className="pi" style={{flex:1}}><b>{t?.name || tc}</b></div>
                <button className="iconbtn" aria-label={"Unassign "+(t?.name || tc)} disabled={busy} onClick={()=>unassign(tc)}><Icon.x/></button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run it → Expected: PASS.**

```bash
cd web && npx vitest run src/screens-detail.test.jsx
```

Expected: PASS (all prior tests plus the 2 new Draw tests). Then the full web suite:

```bash
npm run test -w web
```

Expected: green.

- [ ] **Step 5: Commit.**

```bash
git add web/src/screens-detail.jsx web/src/screens-detail.test.jsx && git commit -m "feat(web): admin Draw tab — manual team↔person ownership assign/remove"
```

---

Notes for the plan author (not part of the slice output): the `adminGateState(whoami)` single-arg signature matches the CROSS-SLICE INTEGRATION CONTRACT (the contract is authoritative over the slice brief's `adminGateState(whoami, isPlatformHost)` mention — "No other host heuristic"). `fetchWhoami` is imported from Slice 0; `patchPerson` calls Slice B's `PATCH /api/admin/people/:id`. Relevant files: `/Users/andriycherednikov/code/personal/sweep/web/src/screens-detail.jsx`, `/Users/andriycherednikov/code/personal/sweep/web/src/api/client.js`, `/Users/andriycherednikov/code/personal/sweep/web/src/screens-detail.test.jsx`, `/Users/andriycherednikov/code/personal/sweep/web/src/api/client.test.js`.


## Slice 4: Super-admin console

This slice adds the platform owner's console: a `/super` overlay (mirroring the existing `admin` overlay in `App.jsx`) that lists, creates, rotates, archives/un-archives and renames sweeps. It also accepts a `/super/<token>` deep link that auto-submits the super token. All super HTTP calls are credentialed and live in `web/src/api/client.js`.

> **Cross-slice notes (OBEY):** `patchCreds(path, body)` is added in **Slice 3** (first consumer) and is **imported, never redefined** here. `postSession`/`fetchWhoami`/`postLogout` are owned by **Slice 0**. This slice is the **only** place `postSuperSession`, `fetchSuperSweeps`, `createSweep`, `rotateSweepToken`, `archiveSweep`, `unarchiveSweep`, `patchSweep` are added.

---

### Task 4.1: Super client functions (credentialed)

**Files:**
- Modify: `web/src/api/client.js` — append after the existing admin helpers (current last line 64, `export const moderatePhoto = …`). Uses `postCreds` (existing, lines 40–48) and `patchCreds` (added in Slice 3).
- Test: `web/src/api/client.test.js` — append after the last test (current line 110).

- [ ] **Step 1: Write the failing test**

```js
// web/src/api/client.test.js — append at end of file

test('postSuperSession POSTs the token to /api/super/session with credentials', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ super: true }) } }))
  const { postSuperSession } = await import('./client.js')
  const res = await postSuperSession('sup3rt0ken')
  expect(res).toEqual({ super: true })
  expect(calls[0].url).toMatch(/\/api\/super\/session$/)
  expect(calls[0].opts.method).toBe('POST')
  expect(calls[0].opts.credentials).toBe('include')
  expect(JSON.parse(calls[0].opts.body)).toEqual({ token: 'sup3rt0ken' })
})

test('fetchSuperSweeps GETs /api/super/sweeps with credentials', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ([{ id: 'sw_a', name: 'A' }]) } }))
  const { fetchSuperSweeps } = await import('./client.js')
  const list = await fetchSuperSweeps()
  expect(list).toHaveLength(1)
  expect(calls[0].url).toMatch(/\/api\/super\/sweeps$/)
  expect(calls[0].opts.credentials).toBe('include')
})

test('createSweep POSTs the name and returns the link bundle', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 201, json: async () => ({ id: 'sw_b', name: 'Office', memberLink: '/g/m', adminLink: '/g/m/admin/a' }) } }))
  const { createSweep } = await import('./client.js')
  const res = await createSweep('Office')
  expect(res.memberLink).toBe('/g/m')
  expect(calls[0].url).toMatch(/\/api\/super\/sweeps$/)
  expect(calls[0].opts.method).toBe('POST')
  expect(calls[0].opts.credentials).toBe('include')
  expect(JSON.parse(calls[0].opts.body)).toEqual({ name: 'Office' })
})

test('rotateSweepToken POSTs which to the rotate route', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ memberLink: '/g/new' }) } }))
  const { rotateSweepToken } = await import('./client.js')
  await rotateSweepToken('sw_a', 'member')
  expect(calls[0].url).toMatch(/\/api\/super\/sweeps\/sw_a\/rotate$/)
  expect(calls[0].opts.method).toBe('POST')
  expect(calls[0].opts.credentials).toBe('include')
  expect(JSON.parse(calls[0].opts.body)).toEqual({ which: 'member' })
})

test('archiveSweep and unarchiveSweep hit their routes with credentials', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({}) } }))
  const { archiveSweep, unarchiveSweep } = await import('./client.js')
  await archiveSweep('sw_a')
  await unarchiveSweep('sw_a')
  expect(calls[0].url).toMatch(/\/api\/super\/sweeps\/sw_a\/archive$/)
  expect(calls[0].opts.credentials).toBe('include')
  expect(calls[1].url).toMatch(/\/api\/super\/sweeps\/sw_a\/unarchive$/)
  expect(calls[1].opts.credentials).toBe('include')
})

test('patchSweep PATCHes the fields with credentials', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ id: 'sw_a', name: 'Renamed' }) } }))
  const { patchSweep } = await import('./client.js')
  const res = await patchSweep('sw_a', { name: 'Renamed' })
  expect(res.name).toBe('Renamed')
  expect(calls[0].url).toMatch(/\/api\/super\/sweeps\/sw_a$/)
  expect(calls[0].opts.method).toBe('PATCH')
  expect(calls[0].opts.credentials).toBe('include')
  expect(JSON.parse(calls[0].opts.body)).toEqual({ name: 'Renamed' })
})
```

- [ ] **Step 2: Run it — Expected: FAIL**

Run: `cd web && npx vitest run src/api/client.test.js`
Expected: FAIL — each new test throws `TypeError: postSuperSession is not a function` (and likewise for the other five named imports), because none are exported yet.

- [ ] **Step 3: Minimal implementation**

```js
// web/src/api/client.js — append after `export const moderatePhoto = …` (current last line)

// --- super-admin (platform owner) ---
// patchCreds(path, body) is added in Slice 3; imported/used here, never redefined.
export const postSuperSession = (token) => postCreds('/api/super/session', { token })
export const fetchSuperSweeps = () => getCreds('/api/super/sweeps')
export const createSweep = (name) => postCreds('/api/super/sweeps', { name })
export const rotateSweepToken = (id, which) => postCreds(`/api/super/sweeps/${id}/rotate`, { which })
export const archiveSweep = (id) => postCreds(`/api/super/sweeps/${id}/archive`, {})
export const unarchiveSweep = (id) => postCreds(`/api/super/sweeps/${id}/unarchive`, {})
export const patchSweep = (id, fields) => patchCreds(`/api/super/sweeps/${id}`, fields)
```

> `patchCreds` is defined and exported in Slice 3 alongside `deleteCreds`. If Slice 3 has not landed, its task already adds:
> ```js
> async function patchCreds(path, body) {
>   const res = await fetch(path, {
>     method: 'PATCH', credentials: 'include',
>     headers: { 'Content-Type': 'application/json' },
>     body: JSON.stringify(body),
>   })
>   if (!res.ok) throw new Error(`PATCH ${path} failed: HTTP ${res.status}`)
>   return res.json()
> }
> ```
> Do **not** re-add it here.

- [ ] **Step 4: Run it — Expected: PASS, then full web suite green**

Run: `cd web && npx vitest run src/api/client.test.js`
Expected: PASS — all six new tests pass (client.test.js total now 17 tests passing).
Then: `npm run test -w web`
Expected: full web suite green.

- [ ] **Step 5: Commit**

```bash
git add web/src/api/client.js web/src/api/client.test.js && git commit -m "feat(web): super-admin client calls (session/list/create/rotate/archive/rename)"
```

---

### Task 4.2: Parse `/super/<token>` deep links (pure helper)

A pure helper that the `super` overlay route uses to decide whether to auto-submit a super token. Mirrors `readView` in `App.jsx`: split the path on `/`, drop empties.

**Files:**
- Create: `web/src/lib/superRoute.js`
- Test: `web/src/lib/superRoute.test.js`

- [ ] **Step 1: Write the failing test**

```js
// web/src/lib/superRoute.test.js
import { expect, test } from 'vitest'
import { parseSuperRoute } from './superRoute.js'

test('bare /super has no auto-submit token', () => {
  expect(parseSuperRoute('/super')).toEqual({ token: null })
})

test('/super/<token> yields the token to auto-submit', () => {
  expect(parseSuperRoute('/super/abc123XYZ')).toEqual({ token: 'abc123XYZ' })
})

test('trailing slash on /super/ is treated as no token', () => {
  expect(parseSuperRoute('/super/')).toEqual({ token: null })
})

test('a non-super path yields no token', () => {
  expect(parseSuperRoute('/teams/ar')).toEqual({ token: null })
})

test('extra trailing segments are ignored — only the first token segment is used', () => {
  expect(parseSuperRoute('/super/tok/extra')).toEqual({ token: 'tok' })
})
```

- [ ] **Step 2: Run it — Expected: FAIL**

Run: `cd web && npx vitest run src/lib/superRoute.test.js`
Expected: FAIL — `Cannot find module './superRoute.js'`.

- [ ] **Step 3: Minimal implementation**

```js
// web/src/lib/superRoute.js
// Parse a /super route into an optional auto-submit super token.
// Mirrors App.readView: split on "/", drop empty segments.
//   /super            -> { token: null }
//   /super/<token>    -> { token: '<token>' }
// Any non-/super path -> { token: null }
export function parseSuperRoute(path) {
  const seg = path.split('/').filter(Boolean)
  if (seg[0] !== 'super') return { token: null }
  return { token: seg[1] || null }
}
```

- [ ] **Step 4: Run it — Expected: PASS, then full web suite green**

Run: `cd web && npx vitest run src/lib/superRoute.test.js`
Expected: PASS — 5 tests pass.
Then: `npm run test -w web`
Expected: full web suite green.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/superRoute.js web/src/lib/superRoute.test.js && git commit -m "feat(web): parseSuperRoute helper for /super/<token> auto-submit"
```

---

### Task 4.3: SuperConsole screen (gate + list + create + manage)

The console screen itself. It follows the `AdminScreen` shape in `screens-detail.jsx`: a gate sub-component prompts for the super token (`postSuperSession`); on success it renders the list. Uses `PageHeader` (`{ title, sub, onBack, right }`) from `components.jsx`. Self-contained data (its own `useState`/`useEffect` load via `fetchSuperSweeps`) — it does **not** read `SWEEP as S`.

**Files:**
- Create: `web/src/screens-super.jsx`
- Test: `web/src/screens-super.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// web/src/screens-super.test.jsx
import { expect, test, beforeEach, vi } from 'vitest'
import { render, fireEvent, waitFor, act } from '@testing-library/react'

// Mock the whole client module; assert observable calls (no spyOn of ESM named imports).
vi.mock('./api/client.js', () => ({
  postSuperSession: vi.fn(async () => ({ super: true })),
  fetchSuperSweeps: vi.fn(async () => ([
    { id: 'sw_a', name: 'Office Sweep', kind: 'group', archivedAt: null, createdAt: '2026-06-01T00:00:00Z', memberLink: '/g/m', adminLink: '/g/m/admin/a' },
    { id: 'sw_b', name: 'Pub Sweep', kind: 'group', archivedAt: '2026-06-02T00:00:00Z', createdAt: '2026-06-01T00:00:00Z', memberLink: '/g/m2', adminLink: '/g/m2/admin/a2' },
  ])),
  createSweep: vi.fn(async () => ({ id: 'sw_c', name: 'New One', memberLink: '/g/new-member', adminLink: '/g/new-member/admin/new-admin' })),
  rotateSweepToken: vi.fn(async () => ({})),
  archiveSweep: vi.fn(async () => ({})),
  unarchiveSweep: vi.fn(async () => ({})),
  patchSweep: vi.fn(async () => ({})),
}))

import { SuperConsole } from './screens-super.jsx'
import * as client from './api/client.js'

const noop = () => {}
beforeEach(() => { vi.clearAllMocks() })

test('SuperConsole prompts for the super token when not yet authed', () => {
  const { getByPlaceholderText, getByRole, queryByText } = render(<SuperConsole onBack={noop} onToast={noop} />)
  expect(getByPlaceholderText(/super token/i)).toBeTruthy()
  expect(getByRole('button', { name: /unlock/i })).toBeTruthy()
  // the list is not rendered until authed
  expect(queryByText('Office Sweep')).toBeNull()
})

test('submitting the token unlocks and lists the sweeps with kind + archived state', async () => {
  const { getByPlaceholderText, getByRole, findByText, getByText } = render(<SuperConsole onBack={noop} onToast={noop} />)
  fireEvent.change(getByPlaceholderText(/super token/i), { target: { value: 'tok' } })
  fireEvent.click(getByRole('button', { name: /unlock/i }))
  expect(client.postSuperSession).toHaveBeenCalledWith('tok')
  expect(await findByText('Office Sweep')).toBeTruthy()
  expect(getByText('Pub Sweep')).toBeTruthy()
  expect(client.fetchSuperSweeps).toHaveBeenCalledTimes(1)
  // archived sweep is flagged
  expect(getByText(/Archived/)).toBeTruthy()
})

test('an autoToken prop auto-submits the super token and skips the prompt', async () => {
  const { findByText, queryByPlaceholderText } = render(<SuperConsole onBack={noop} onToast={noop} autoToken="secret" />)
  await waitFor(() => expect(client.postSuperSession).toHaveBeenCalledWith('secret'))
  expect(await findByText('Office Sweep')).toBeTruthy()
  expect(queryByPlaceholderText(/super token/i)).toBeNull()
})

test('creating a sweep surfaces copyable member + admin links', async () => {
  const { getByPlaceholderText, getByRole, findByText, getByDisplayValue } = render(<SuperConsole onBack={noop} onToast={noop} autoToken="secret" />)
  await findByText('Office Sweep') // wait for unlock + initial load
  fireEvent.change(getByPlaceholderText(/new sweep name/i), { target: { value: 'New One' } })
  fireEvent.click(getByRole('button', { name: /create sweep/i }))
  await waitFor(() => expect(client.createSweep).toHaveBeenCalledWith('New One'))
  // both links are shown in readonly inputs (copyable)
  expect(await getByDisplayValue('/g/new-member')).toBeTruthy()
  expect(getByDisplayValue('/g/new-member/admin/new-admin')).toBeTruthy()
})

test('rotate shows the <=8h tail note and calls rotateSweepToken', async () => {
  const { getByText, getAllByRole, findByText } = render(<SuperConsole onBack={noop} onToast={noop} autoToken="secret" />)
  await findByText('Office Sweep')
  // tail note is visible in the console
  expect(getByText(/up to 8h/i)).toBeTruthy()
  const rotateButtons = getAllByRole('button', { name: /rotate member/i })
  fireEvent.click(rotateButtons[0])
  await waitFor(() => expect(client.rotateSweepToken).toHaveBeenCalledWith('sw_a', 'member'))
})

test('archive/unarchive call the right action per row state', async () => {
  const { getByRole, findByText } = render(<SuperConsole onBack={noop} onToast={noop} autoToken="secret" />)
  await findByText('Office Sweep')
  // active sweep (sw_a) shows Archive; archived sweep (sw_b) shows Restore
  fireEvent.click(getByRole('button', { name: /^Archive sw_a$/ }))
  await waitFor(() => expect(client.archiveSweep).toHaveBeenCalledWith('sw_a'))
  fireEvent.click(getByRole('button', { name: /^Restore sw_b$/ }))
  await waitFor(() => expect(client.unarchiveSweep).toHaveBeenCalledWith('sw_b'))
})

test('rename submits the new name via patchSweep', async () => {
  const { getByDisplayValue, getByRole, findByText } = render(<SuperConsole onBack={noop} onToast={noop} autoToken="secret" />)
  await findByText('Office Sweep')
  const nameInput = getByDisplayValue('Office Sweep')
  fireEvent.change(nameInput, { target: { value: 'Renamed Sweep' } })
  fireEvent.click(getByRole('button', { name: /^Save name sw_a$/ }))
  await waitFor(() => expect(client.patchSweep).toHaveBeenCalledWith('sw_a', { name: 'Renamed Sweep' }))
})
```

- [ ] **Step 2: Run it — Expected: FAIL**

Run: `cd web && npx vitest run src/screens-super.test.jsx`
Expected: FAIL — `Failed to resolve import "./screens-super.jsx"` / `SuperConsole is not exported`.

- [ ] **Step 3: Minimal implementation**

```jsx
// web/src/screens-super.jsx
/* ============================================================
   THE SWEEP — super-admin (platform owner) console
   Token-gated: list / create / rotate / archive / rename sweeps.
   ============================================================ */
import { useState, useEffect, useCallback } from "react";
import { Icon, PageHeader } from "./components.jsx";
import {
  postSuperSession, fetchSuperSweeps, createSweep, rotateSweepToken,
  archiveSweep, unarchiveSweep, patchSweep,
} from "./api/client.js";

/* readonly, tap-to-select link field — "copyable" without a clipboard dependency */
function LinkField({ label, value }) {
  return (
    <label className="field" style={{ marginTop: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted2)" }}>{label}</span>
      <input
        readOnly
        value={value}
        onFocus={(e) => e.target.select()}
        onClick={(e) => e.target.select()}
        style={{ fontFamily: "monospace", fontSize: 12 }}
      />
    </label>
  );
}

/* one sweep row: rename, rotate member/admin (with tail note), archive/restore */
function SweepRow({ s, onToast, reload }) {
  const [name, setName] = useState(s.name || "");
  const [busy, setBusy] = useState(false);
  const archived = !!s.archivedAt;

  async function run(fn, ok) {
    setBusy(true);
    try { await fn(); onToast(ok); await reload(); }
    catch { onToast("Action failed — try again"); }
    finally { setBusy(false); }
  }

  return (
    <div className="block" style={{ padding: "12px 14px", marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <b style={{ fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 16 }}>{s.name}</b>
        <span style={{ fontSize: 11, color: "var(--muted2)", fontWeight: 700 }}>{s.kind}</span>
        {archived && <span style={{ fontSize: 11, color: "var(--accent)", fontWeight: 800 }}>· Archived</span>}
      </div>

      <div className="field" style={{ marginTop: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted2)" }}>Name</span>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
          <button className="cta ghost" disabled={busy} aria-label={`Save name ${s.id}`}
            onClick={() => run(() => patchSweep(s.id, { name: name.trim() }), "Renamed")}>Save</button>
        </div>
      </div>

      {s.memberLink && <LinkField label="Member link" value={s.memberLink} />}
      {s.adminLink && <LinkField label="Admin link" value={s.adminLink} />}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        <button className="cta ghost" disabled={busy} aria-label={`Rotate member ${s.id}`}
          onClick={() => run(() => rotateSweepToken(s.id, "member"), "Member link rotated")}>Rotate member link</button>
        <button className="cta ghost" disabled={busy} aria-label={`Rotate admin ${s.id}`}
          onClick={() => run(() => rotateSweepToken(s.id, "admin"), "Admin link rotated")}>Rotate admin link</button>
        {archived
          ? <button className="cta ghost" disabled={busy} aria-label={`Restore ${s.id}`}
              onClick={() => run(() => unarchiveSweep(s.id), "Restored")}>Restore</button>
          : <button className="cta ghost" disabled={busy} aria-label={`Archive ${s.id}`}
              onClick={() => run(() => archiveSweep(s.id), "Archived")}>Archive</button>}
      </div>
    </div>
  );
}

function SuperList({ onToast }) {
  const [sweeps, setSweeps] = useState([]);
  const [newName, setNewName] = useState("");
  const [created, setCreated] = useState(null); // {memberLink, adminLink, name}
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try { setSweeps(await fetchSuperSweeps()); }
    catch { onToast("Couldn't load sweeps"); }
  }, [onToast]);

  useEffect(() => { reload(); }, [reload]);

  async function create() {
    const nm = newName.trim();
    if (!nm || busy) return;
    setBusy(true);
    try {
      const res = await createSweep(nm);
      setCreated(res);
      setNewName("");
      await reload();
      onToast("Sweep created");
    } catch { onToast("Create failed — try again"); }
    finally { setBusy(false); }
  }

  return (
    <div className="scroll pad screen-anim" style={{ paddingTop: 12 }}>
      <div className="wrap">
        {/* create */}
        <div className="block" style={{ padding: "12px 14px", marginBottom: 14 }}>
          <div className="field">
            <label>New sweep</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New sweep name" style={{ flex: 1 }} />
              <button className="cta" disabled={busy || !newName.trim()} onClick={create}>Create sweep</button>
            </div>
          </div>
          {created && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--live)" }}>“{created.name}” created — share these links:</div>
              <LinkField label="Member link" value={created.memberLink} />
              <LinkField label="Admin link" value={created.adminLink} />
            </div>
          )}
        </div>

        <div className="note-line" style={{ marginBottom: 12 }}>
          <Icon.shield style={{ stroke: "var(--live)" }} />
          <span>Rotating a link takes effect immediately for new joins; the old link keeps working for up to 8h while existing sessions expire.</span>
        </div>

        {sweeps.map((s) => <SweepRow key={s.id} s={s} onToast={onToast} reload={reload} />)}
        {sweeps.length === 0 && <div className="empty"><div className="ic">🗂️</div><h3>No sweeps yet</h3><p>Create the first one above.</p></div>}
      </div>
    </div>
  );
}

export function SuperConsole({ onBack, onToast, autoToken }) {
  const [unlocked, setUnlocked] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const submit = useCallback(async (t) => {
    const tk = (t ?? "").trim();
    if (!tk) return;
    setBusy(true); setError(false);
    try { await postSuperSession(tk); setUnlocked(true); }
    catch { setError(true); }
    finally { setBusy(false); }
  }, []);

  // /super/<token> deep link: auto-submit once on mount
  useEffect(() => { if (autoToken) submit(autoToken); }, [autoToken, submit]);

  if (!unlocked) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <PageHeader title="Super admin" sub="Platform owner only" onBack={onBack} />
        <div className="scroll pad screen-anim" style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 28 }}>
          <div className="lockic"><Icon.lock /></div>
          <h3 style={{ fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 20, textTransform: "uppercase", color: "var(--navy)" }}>Enter super token</h3>
          <div className="field" style={{ width: "100%", maxWidth: 360, marginTop: 14 }}>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(token); }}
              placeholder="Super token"
            />
          </div>
          {error && <p style={{ fontSize: 12.5, color: "var(--accent)", marginTop: 8 }}>That token didn’t work.</p>}
          <button className="cta" disabled={busy || !token.trim()} onClick={() => submit(token)} style={{ marginTop: 14, maxWidth: 360, width: "100%" }}>
            {busy ? "Checking…" : "Unlock"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <PageHeader title="Super admin" sub="Sweeps" onBack={onBack} right={<div className="iconbtn"><Icon.shield /></div>} />
      <SuperList onToast={onToast} />
    </div>
  );
}
```

> **Note on `Icon`:** `Icon.lock`, `Icon.shield` and `Icon.chev` already exist (used by `AdminScreen`/`AdminQueue` in `screens-detail.jsx`). The `field`, `block`, `note-line`, `empty`, `lockic`, `cta`, `cta ghost`, `iconbtn`, `scroll pad screen-anim`, `wrap` classes are all existing app styles reused from the upload/admin screens.

- [ ] **Step 4: Run it — Expected: PASS, then full web suite green**

Run: `cd web && npx vitest run src/screens-super.test.jsx`
Expected: PASS — all 7 tests pass.
Then: `npm run test -w web`
Expected: full web suite green.

- [ ] **Step 5: Commit**

```bash
git add web/src/screens-super.jsx web/src/screens-super.test.jsx && git commit -m "feat(web): SuperConsole — token gate, sweep list/create/rotate/archive/rename"
```

---

### Task 4.4: Wire the `super` overlay route into App.jsx

Add a `super` overlay mirroring the existing `admin` overlay: `urlFor`/`readView` map `/super` and `/super/<token>`, the overlay renders `SuperConsole` at the same elevated z-index used by admin (`ovZ = 60`), and the auto-submit token is parsed with `parseSuperRoute` (Task 4.2) and passed in. **This task comes after Task 4.3** so the component it imports already exists (suite never red).

**Files:**
- Modify: `web/src/App.jsx` — imports (lines 16–19, 20), `urlFor` (lines 25–31), `readView` (lines 32–40), overlay resolution (lines 113–117), `current`/`Sidebar` (line 120, 135).
- Test: `web/src/App.test.jsx` — append after the last test (current line 75).

- [ ] **Step 1: Write the failing test**

```jsx
// web/src/App.test.jsx — append at end of file

test('opening /super renders the SuperConsole token prompt', () => {
  window.history.replaceState(null, '', '/super')
  const { getByPlaceholderText, getByRole } = render(<App />)
  expect(getByPlaceholderText(/super token/i)).toBeTruthy()
  expect(getByRole('button', { name: /unlock/i })).toBeTruthy()
})

test('readView maps /super/<token> so the console can auto-submit it', () => {
  // /super/<token> must resolve to the super overlay; the token rides along for auto-submit.
  window.history.replaceState(null, '', '/super/sekret')
  const { getByPlaceholderText } = render(<App />)
  // still the super overlay (prompt visible before the async auto-submit resolves)
  expect(getByPlaceholderText(/super token/i)).toBeTruthy()
})
```

> The App-level mock of `./api/client.js` (top of App.test.jsx, line 15) only stubs `postWatch`/`postSupport`. `SuperConsole` imports `postSuperSession`/`fetchSuperSweeps`/… from the same module; under that partial mock those are `undefined`. To keep these two new tests deterministic (prompt-only, no auto-submit resolution asserted), **extend** the existing mock at line 15 so the named imports exist:
> ```jsx
> vi.mock('./api/client.js', () => ({
>   postWatch: vi.fn(async () => ({})),
>   postSupport: vi.fn(async () => ({})),
>   postSuperSession: vi.fn(async () => ({ super: true })),
>   fetchSuperSweeps: vi.fn(async () => ([])),
>   createSweep: vi.fn(async () => ({})),
>   rotateSweepToken: vi.fn(async () => ({})),
>   archiveSweep: vi.fn(async () => ({})),
>   unarchiveSweep: vi.fn(async () => ({})),
>   patchSweep: vi.fn(async () => ({})),
> }))
> ```
> Apply that edit to line 15 as part of Step 1.

- [ ] **Step 2: Run it — Expected: FAIL**

Run: `cd web && npx vitest run src/App.test.jsx`
Expected: FAIL — `/super` resolves to the `home` tab (no `super` case in `readView`), so `getByPlaceholderText(/super token/i)` throws "Unable to find an element".

- [ ] **Step 3: Minimal implementation**

Add the import (after the `screens-detail.jsx` import block, lines 16–19, and the analytics import on line 20):

```jsx
import { SuperConsole } from "./screens-super.jsx";
import { parseSuperRoute } from "./lib/superRoute.js";
```

In `urlFor`, add the `super` case (after the `admin` case, current line 29):

```jsx
  if (v.overlay?.type === "super") return v.overlay.token ? `/super/${v.overlay.token}` : "/super";
```

In `readView`, add the `super` case (after the `admin` case, current line 38):

```jsx
  if (seg[0] === "super") return { ...base, overlay: { type: "super", token: parseSuperRoute(path).token } };
```

Add the overlay resolution (after the `admin` overlay branch, current line 117):

```jsx
  else if (overlay?.type==="super")   { ov = <SuperConsole onBack={goBack} onToast={showToast} autoToken={overlay.token}/>; ovZ = 60; }
```

Add an `openSuper` navigator beside the existing `openAdmin`/`openKnock` (after line 99):

```jsx
  const openSuper  = () => navigate({ overlay: { type: "super" } });
```

Include `super` in the `current` highlight set so the desktop shell treats it as an overlay (current line 120):

```jsx
  const current = (overlay && (overlay.type==="knockouts" || overlay.type==="admin" || overlay.type==="super")) ? overlay.type : tab;
```

- [ ] **Step 4: Run it — Expected: PASS, then full web suite green**

Run: `cd web && npx vitest run src/App.test.jsx`
Expected: PASS — both new tests pass; the existing App tests (analytics pageview, popstate, match_open) stay green.
Then: `npm run test -w web`
Expected: full web suite green.
Then build to validate (global rule): `npm run build -w web`
Expected: Vite build succeeds.

- [ ] **Step 5: Commit**

```bash
git add web/src/App.jsx web/src/App.test.jsx && git commit -m "feat(web): /super overlay route wiring SuperConsole (auto-submits /super/<token>)"
```

---

> **End of Slice 4.** The platform owner can now open `/super` (or a `/super/<token>` secret link), authenticate, and create/rotate/archive/un-archive/rename sweeps with copyable member + admin links and the ≤8h rotation-tail note. `openSuper` is exported as a navigator for a later sidebar/landing entry point (Slice 2 switcher / D5 landing) if needed; it does not need its own UI trigger in this slice.

**Relevant file paths:**
- `/Users/andriycherednikov/code/personal/sweep/web/src/api/client.js` (+ `.test.js`)
- `/Users/andriycherednikov/code/personal/sweep/web/src/lib/superRoute.js` (+ `.test.js`)
- `/Users/andriycherednikov/code/personal/sweep/web/src/screens-super.jsx` (+ `.test.jsx`)
- `/Users/andriycherednikov/code/personal/sweep/web/src/App.jsx` (+ `App.test.jsx`)


## Slice 5: Infra: platform Caddy site block

This slice is deploy-time configuration that wires the **platform host** `worldcupsweep.yowiebay.au` into the shared `vcv-caddy` reverse proxy on the server (`134.199.153.212`). It mirrors the existing `sweep.andriycherednikov.com` block in `docker/caddy/sweep.Caddyfile` exactly: `/api/*` and `/photos/*` → `sweep-api:3000` (SSE-safe `flush_interval -1`), `/*` → `sweep-web:80`, automatic per-name Let's Encrypt TLS. `PLATFORM_HOST=worldcupsweep.yowiebay.au` is already set in the server's `.env.docker`, so the same `sweep-api` container resolves the platform host and returns `{sweepId:null, role:null}` from `/api/whoami` for an unauthenticated visitor.

Because this is server config (not application code), it is **not unit-testable** via Vitest. Task 5.1 below replaces the 5 TDD steps with a **Verify** subsection. **Do not perform any of the server-side steps in Task 5.1 until the DNS prerequisite is satisfied** — Caddy auto-issues a cert per site name and a name that does not yet resolve to this host will fail its ACME challenge on a loop and can trip Let's Encrypt rate limits (forcing the staging CA).

### Task 5.1: Append the `worldcupsweep.yowiebay.au` platform site block to the Caddyfile (deploy-time, after DNS)

**Files:**
- Modify: `docker/caddy/sweep.Caddyfile` — append a second site block after the existing `sweep.andriycherednikov.com { … }` block (currently lines 25–69); also extend the header comment (lines 14–22) to document the platform host.
- Modify: `docker/README.md` — update the "Domains" note (lines 10–12) and the "Verify" section (lines 96–104) to cover the platform host.
- No test file: this slice is server config and is not exercised by Vitest. Verification is the manual checklist in the **Verify** subsection below.

This task has no commit on a red suite because there is no suite to run; instead it ends with a normal infra commit, then a deploy-time apply + manual verification. Edit the two files, commit, **then** (only after DNS resolves) apply on the server and run the checklist.

- [ ] **Step 1 (config): Append the platform site block to `docker/caddy/sweep.Caddyfile`.**

Append the following block to the **end** of `docker/caddy/sweep.Caddyfile` (after the closing `}` of the existing `sweep.andriycherednikov.com` block on line 69). It is a byte-for-byte mirror of the existing block — same `encode gzip`, same `/api/*` proxy with `flush_interval -1` and the full `header_up` set, same `/photos/*` proxy, same `/*` SPA proxy with the security headers, same `log` block — only the site address differs.

```caddyfile

# =============================================================================
# The Sweep — PLATFORM host (multi-sweep). Mints/serves token-scoped sweeps.
# Identical routing to the default block above; the SAME sweep-api container
# resolves this host as the platform host because PLATFORM_HOST is set on the
# server to worldcupsweep.yowiebay.au. /api/whoami returns {sweepId:null,
# role:null} for an unauthenticated visitor here (the "pick a sweep" landing).
#
# ⚠️ Add this block ONLY after worldcupsweep.yowiebay.au's A/AAAA record
# resolves to this host (DNS-only, no proxy) — otherwise Caddy's ACME challenge
# fails on a loop and can trip Let's Encrypt rate limits.
# =============================================================================
worldcupsweep.yowiebay.au {

	encode gzip

	# API — Fastify. flush_interval -1 disables response buffering so the
	# Server-Sent Events stream (/api/stream) flushes immediately.
	handle /api/* {
		reverse_proxy sweep-api:3000 {
			flush_interval -1
			header_up Host {host}
			header_up X-Real-IP {remote}
			header_up X-Forwarded-For {remote}
			header_up X-Forwarded-Proto {scheme}
			header_up X-Forwarded-Host {host}
		}
	}

	# Approved fan/profile photos — served by the api off the photos volume.
	handle /photos/* {
		reverse_proxy sweep-api:3000 {
			header_up Host {host}
			header_up X-Forwarded-Proto {scheme}
		}
	}

	# Everything else — the static SPA (internal Caddy w/ history fallback).
	# Join links (/g/<token>, /g/<token>/admin/<token>) and the /super console
	# are SPA routes intercepted client-side, so they fall through to here.
	handle /* {
		header {
			Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
			X-Content-Type-Options nosniff
			X-Frame-Options SAMEORIGIN
			Referrer-Policy strict-origin-when-cross-origin
		}
		reverse_proxy sweep-web:80 {
			header_up Host {host}
			header_up X-Forwarded-Proto {scheme}
		}
	}

	log {
		output stdout
		format console
		level INFO
	}
}
```

Also extend the existing header comment so the file documents both hosts. Replace the closing lines of the header banner (`docker/caddy/sweep.Caddyfile` lines 14–23, from `# Current home:` through the trailing `# ===` rule before the `sweep.andriycherednikov.com {` block) with:

```caddyfile
# Default host: sweep.andriycherednikov.com (temporary).
# Permanent default home: sweep.yowiebay.au — add it once that zone's DNS is
# live and its A/AAAA points at this host, by making the site address a comma
# list:
#
#     sweep.andriycherednikov.com, sweep.yowiebay.au {
#
# Platform host (multi-sweep): worldcupsweep.yowiebay.au — its own block below.
#
# Caddy auto-issues a separate Let's Encrypt cert per name. Do NOT add a name
# that doesn't yet resolve to this host — its ACME challenge fails on a loop and
# can trip Let's Encrypt rate limits (forcing the staging CA).
# =============================================================================
```

- [ ] **Step 2 (config): Update `docker/README.md` to document the platform host and its verification.**

Replace the "Domains" blockquote (`docker/README.md` lines 10–12) with:

```markdown
> **Domains:** the default community is live on `sweep.andriycherednikov.com`
> (permanent home `sweep.yowiebay.au`, added once that zone's DNS points here).
> The **multi-sweep platform** is served at `worldcupsweep.yowiebay.au` — the
> same `sweep-api` container handles it as the platform host (`PLATFORM_HOST`
> in `.env.docker`). Add each host to the Caddy site block only after its DNS
> resolves to this host (see `caddy/sweep.Caddyfile`).
```

Then append the following to the end of the "## Verify" section (after `docker/README.md` line 103, the existing photos line):

```markdown

### Platform host (multi-sweep)

`PLATFORM_HOST` must already equal `worldcupsweep.yowiebay.au` in
`/root/sweep/.env.docker` (it is set on the server). After appending the
`worldcupsweep.yowiebay.au` block to `/root/caddy/Caddyfile` and reloading:

```bash
# Unauthenticated platform visitor → "pick a sweep" landing signal:
curl https://worldcupsweep.yowiebay.au/api/whoami   # {"sweepId":null,"role":null}
# Default host is unaffected (anon = member of the default sweep):
curl https://sweep.andriycherednikov.com/api/whoami # {"sweepId":"default","role":"member"}
```

Then open a member capability link in a browser
(`https://worldcupsweep.yowiebay.au/g/<memberToken>`): the SPA exchanges the
token via `POST /api/session`, strips it from the URL, and renders that sweep's
scoped data. Re-running `curl … /api/whoami` from that browser session (with the
`sweep_session` cookie) returns that sweep's `{sweepId, role}`.
```

- [ ] **Step 3 (commit): Commit the config and docs change (infra scope, one commit).**

```bash
git add docker/caddy/sweep.Caddyfile docker/README.md
git commit -m "infra(infra): add worldcupsweep.yowiebay.au platform Caddy site block"
```

#### Verify (deploy-time — run ONLY after DNS for `worldcupsweep.yowiebay.au` resolves to the host)

This replaces the TDD run/expect steps; there is no Vitest suite for server config. Apply and verify on the server exactly as the README's "One-time server setup" §3 describes, then walk the checklist.

1. **DNS prerequisite (gate — do this first).** Confirm `worldcupsweep.yowiebay.au` has an A/AAAA record pointing at the host (`134.199.153.212`), DNS-only (no Cloudflare proxy), so Caddy can complete the ACME HTTP-01 challenge. Do not proceed until this resolves:
   ```bash
   dig +short worldcupsweep.yowiebay.au   # → 134.199.153.212
   ```
   Expected: prints `134.199.153.212`. If it prints nothing or a proxy IP, STOP — adding the block now would loop ACME failures and risk a Let's Encrypt rate-limit.

2. **Confirm `PLATFORM_HOST` is already set** (it is set on the server per this slice's premise; verify, do not change):
   ```bash
   ssh root@134.199.153.212 "grep PLATFORM_HOST /root/sweep/.env.docker"
   ```
   Expected: `PLATFORM_HOST=worldcupsweep.yowiebay.au`.

3. **Re-copy the Caddy snippet and apply it to the shared Caddy** (mirrors README §3):
   ```bash
   scp docker/caddy/sweep.Caddyfile root@134.199.153.212:/root/sweep/sweep.Caddyfile
   ssh root@134.199.153.212
   cp /root/caddy/Caddyfile /root/caddy/Caddyfile.bak
   # Append ONLY the new worldcupsweep.yowiebay.au block to /root/caddy/Caddyfile
   # (the sweep.andriycherednikov.com block is already present from the prior deploy).
   docker exec vcv-caddy caddy validate --config /etc/caddy/Caddyfile
   docker exec vcv-caddy caddy reload --config /etc/caddy/Caddyfile
   ```
   Expected: `caddy validate` reports `Valid configuration`; `caddy reload` exits 0 with no error in `docker logs vcv-caddy`.

4. **Watch TLS issuance succeed** (first request triggers on-demand/automatic issuance):
   ```bash
   ssh root@134.199.153.212 "docker logs --tail 50 vcv-caddy | grep -i worldcupsweep"
   ```
   Expected: a `certificate obtained successfully` line for `worldcupsweep.yowiebay.au`; no repeated `obtaining certificate` / `acme: error` loop.

5. **Unauthenticated platform whoami → "pick a sweep" signal:**
   ```bash
   curl https://worldcupsweep.yowiebay.au/api/whoami
   ```
   Expected: `{"sweepId":null,"role":null}` (this is the D5 platform-no-session signal the client uses to render the "pick a sweep" landing).

6. **Default host unchanged:**
   ```bash
   curl https://sweep.andriycherednikov.com/api/whoami
   ```
   Expected: `{"sweepId":"default","role":"member"}` (anon = member of the default sweep; the platform block did not affect it).

7. **Health + SSE on the platform host:**
   ```bash
   curl https://worldcupsweep.yowiebay.au/api/health    # {"ok":true}
   curl -N https://worldcupsweep.yowiebay.au/api/stream  # SSE connection stays open / streams events
   ```
   Expected: `{"ok":true}`; the `/api/stream` connection stays open and is not buffered (confirms `flush_interval -1` applies on this host).

8. **Member capability link end-to-end (browser):** open `https://worldcupsweep.yowiebay.au/g/<memberToken>` for a real sweep. Expected: the SPA `POST`s the token to `/api/session`, `history.replaceState` strips the token from the URL (address bar becomes `https://worldcupsweep.yowiebay.au/`), and the page renders that sweep's scoped data (its name, teams, people). In that same browser session, `GET /api/whoami` (DevTools/Network) returns that sweep's `{sweepId, role}` rather than `null,null`.

9. **SPA history fallback for plain deep links:** with the cookie present from step 8, navigate to `https://worldcupsweep.yowiebay.au/teams/ar` and hard-refresh. Expected: the SPA loads (no Caddy 404) and shows the scoped team view — confirming `/*` falls through to `sweep-web:80`'s internal history fallback.

10. **Rollback (if any check fails):** restore the backup and reload, then re-investigate before retrying:
    ```bash
    ssh root@134.199.153.212 "cp /root/caddy/Caddyfile.bak /root/caddy/Caddyfile && docker exec vcv-caddy caddy reload --config /etc/caddy/Caddyfile"
    ```
    Expected: `caddy reload` exits 0; `curl https://sweep.andriycherednikov.com/api/health` still returns `{"ok":true}` (default host unaffected by the rollback).


---

## Self-review notes (coverage vs spec)

| Spec item | Covered by |
|---|---|
| D1 — host fork (default PIN vs platform cookie-role) | Slice 3 (`adminGateState`); default-host path preserved (reconciliation §6 of conventions) |
| D2 — cookie-scoped-at-root link handling | Slice 1 (`parseJoinLink`, `joinFromLocation`, token strip in `main.jsx`) |
| D3 — per-sweep identity migration | Slice 2 (`social.js` `ME_KEY` → `sweep.me.v1.<sweepId>` + legacy migration) |
| D4 — "my sweeps" switcher + token storage | Slice 1 (`sweeps.js`, token persisted at join) + Slice 2 (`SweepsSheet`, `switchTo`) |
| D5 — platform 401 "pick a sweep" landing | Slice 1 (SweepProvider Gate, tappable stored sweeps) |
| D6 — super-admin console | Slice 4 (`screens-super.jsx`, `/super` + `/super/<token>`) |
| D7 — rename/un-archive backend | Slice B (`PATCH /api/super/sweeps/:id`, `POST …/unarchive`, `PATCH /api/admin/people/:id`) |
| D7a — bootstrap returns sweep name | Slice 0 (Task 0.1) |
| Slice 0/3/4 client plumbing | Slice 0 (credentials + session calls), Slice 3 (`patchCreds`/`deleteCreds` + people/ownership), Slice 4 (super calls) |
| Group-admin people + draw + moderation | Slice 3 (`AdminConsole`) |
| Platform Caddy host | Slice 5 (deploy-time, after DNS) |

## Deferred (not Plan B)

- Automated draft/draw mechanic (ownership stays manual one-by-one).
- Member accounts (members remain a cookie role; no accounts).
- Hard-delete of a sweep (archive/un-archive only).
- Rate-limiting beyond the existing `/api/session`, `/api/super/session`, `/api/admin/login` routes.
