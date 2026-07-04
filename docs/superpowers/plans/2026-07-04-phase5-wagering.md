# Phase 5 — Wagering Generalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-sweep `wageringEnabled` flag (OFF by default, organizer opts in) + a
sport-agnostic market spine (`ml`/`ou`/`hcap`) with a declarative grading
registry, server-side self-exclusion enforcement, football handicap offering
from the live odds capture, and the basketball seam left ready but deferred.

**Architecture:** Spec is `docs/superpowers/specs/2026-07-04-phase5-wagering-design.md`
— read it first. One market registry (`api/src/wagering/markets.js`) holds every
market's grade function + `needsDraws` flag; per-sport variation enters only via
`api/src/sports.js` config (`hasDraws`, new `gradeOn`). Betting routes gain a
gate stack (read-only → member → flag → minor → exclusion → validation).
Settlement plumbing, rewards, grants, and all P4 billing behavior are untouched.

**Tech Stack:** Node 22 ESM, Fastify 5, Drizzle + Postgres (testcontainers),
Vitest. Recorded feed fixtures only — zero live API calls in tests.

## Global Constraints

- **Wire frozen (decision b):** route paths (`/api/coins`, `/api/bet`, `/api/parlay`), JSON field names, market keys (`1x2`, `ou25`, …), and DB table names (`coin_ledger`) keep their coins names. New fields/endpoints are additive; frozen web ignores them. Web suite stays **436, unmodified**.
- **New things get wagering names:** `wageringEnabled`, `POST /api/admin/wagering`, errors `wagering_disabled`/`self_excluded`/`market_not_offered`, module dir `api/src/wagering/`.
- **TDD:** failing test → run → minimal code → run → commit. Conventional Commits, push to origin after each task. Hooks run full suites + build — never `--no-verify`.
- **Run api tests from `api/`** (testcontainers env; Docker must be running). Single file: `npx vitest run test/<file>` from `api/`. Full: `npm test` from `api/`.
- **Zero live feed calls** anywhere in tests or implementation tasks. The live captures already exist: `api/test/fixtures/apifootball/odds-spine-live.json`, `api/test/fixtures/apibasketball/bets.json`.
- **Never** touch the shared `sweep` Postgres database, push to `upstream`, or run deploy targets. Any manual dev-DB work: verify `current_database() = 'sweep_platform'` first.
- **P4 billing behavior unchanged.** Stripe stays test-mode; no billing code is touched by this plan.
- Existing football market behavior must be byte-identical on the wire (WC default sweep regression is Task 3).

## File Structure

- `api/src/wagering/` — renamed from `api/src/coins/` (T1): `constants.js`, `ledger.js`, `settle.js`, `regrade-gs.js`, `rewards.js` + **new** `markets.js` (T6/T7).
- `api/src/sports.js` — `SPORTS` gains `gradeOn` (T7).
- `api/src/db/schema.js` + `api/migrations/0003_*.sql` — `sweep.wagering_enabled` (T2).
- `api/src/seed/seed.js` — default sweep seeds `wageringEnabled: true` (T2).
- `api/src/routes/coins.js` — gate stack + sport-aware validation (T3/T4/T8). Path name frozen; module docs say Wagering.
- `api/src/routes/account.js` — provision body option (T5).
- `api/src/routes/admin.js` — `POST /api/admin/wagering` (T5).
- `api/src/routes/bootstrap.js` — additive `wageringEnabled` (T5).
- `api/src/providers/mapping.js` — `mapMarkets` gains `hcap` (T9).
- Tests: `api/test/wagering-gate.test.js` (new, T3/T4/T5), `api/test/wagering-markets.test.js` (new, T7/T8), `api/test/mapping.test.js` or `api/test/markets-mapping.test.js` (existing mapMarkets tests — T9 extends wherever `mapMarkets` is currently tested; locate with `grep -rln mapMarkets api/test`), `api/test/nba-e2e.test.js` (T10 extends).

---

### Task 1: Rename `api/src/coins` → `api/src/wagering`

Mechanical, behavior-preserving. No new tests — the whole suite is the test.

**Files:**
- Move: `api/src/coins/{constants,ledger,settle,regrade-gs,rewards}.js` → `api/src/wagering/`
- Modify (imports only): `api/src/routes/admin.js`, `api/src/routes/coins.js`, `api/src/worker.js`, `api/src/worker/recompute-standings.js`, `api/test/baseline-prune.test.js`, `api/test/coins-ledger.test.js`, `api/test/coins-regrade-gs.test.js`, `api/test/coins-rewards.test.js`, `api/test/coins-settle.test.js`, `api/test/nba-e2e.test.js`, `api/test/parlay-settle.test.js`, `api/test/serialize-parlay.test.js`

**Interfaces:**
- Produces: every existing export now lives under `api/src/wagering/...`; later tasks import from there.

- [ ] **Step 1: Move the directory**

```bash
cd /Users/andriycherednikov/code/personal/sweep-platform
git mv api/src/coins api/src/wagering
```

- [ ] **Step 2: Update every importer**

In the 12 files listed above, replace the path segment `coins/` with `wagering/` in import specifiers only (e.g. `'../src/coins/settle.js'` → `'../src/wagering/settle.js'`, `'../coins/ledger.js'` → `'../wagering/ledger.js'`). Do NOT rename `routes/coins.js` itself, any route path, any JSON field, or the `coinLedger` schema export — wire and schema names are frozen (Global Constraints). Verify no stragglers:

```bash
grep -rn "src/coins\|\.\./coins/\|\./coins/" api/src api/test --include="*.js"
```

Expected: no matches.

- [ ] **Step 3: Run the full api suite**

Run from `api/`: `npm test`
Expected: all pass (393).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(api): rename coins module dir to wagering (wire frozen)"
git push origin main
```

---

### Task 2: `sweep.wageringEnabled` — schema, migration, seed

**Files:**
- Modify: `api/src/db/schema.js` (sweep table)
- Create: `api/migrations/0003_*.sql` (via `npm run db:generate`, then hand-append backfill)
- Modify: `api/src/seed/seed.js` (default sweep insert, ~line 31)
- Test: `api/test/wagering-gate.test.js` (new)

**Interfaces:**
- Produces: `sweep.wageringEnabled: boolean not null default false` on every sweep row; `req.sweep.wageringEnabled` (sweepResolver selects the full row); seeded default sweep has it `true`.

- [ ] **Step 1: Write the failing test**

Create `api/test/wagering-gate.test.js`:

```js
import { expect, test, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { sweep } from '../src/db/schema.js'

const { pool, db } = openTestDb()
const app = buildApp(db, { sessionSecret: 'test-secret', platformHost: 'platform.test' })
afterAll(async () => { await app.close(); await pool.end() })

test('sweep.wageringEnabled defaults false; seeded default sweep is true', async () => {
  const [dflt] = await db.select().from(sweep).where(eq(sweep.id, 'default'))
  expect(dflt.wageringEnabled).toBe(true) // WC default behavior unchanged
  await db.insert(sweep).values({ id: 'sw_wgtest', name: 'W', kind: 'token', memberToken: 'mt_wgtest', adminToken: 'at_wgtest', competitionId: dflt.competitionId })
  const [row] = await db.select().from(sweep).where(eq(sweep.id, 'sw_wgtest'))
  expect(row.wageringEnabled).toBe(false) // new sweeps OFF unless opted in
  await db.delete(sweep).where(eq(sweep.id, 'sw_wgtest'))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run from `api/`: `npx vitest run test/wagering-gate.test.js`
Expected: FAIL (`wageringEnabled` undefined / column does not exist).

- [ ] **Step 3: Schema + migration + seed**

In `api/src/db/schema.js`, add to the `sweep` table (after `coOwners`):

```js
  wageringEnabled: boolean('wagering_enabled').notNull().default(false),
```

(`boolean` is already imported by the schema for other tables; add it to the `pg-core` import if not.)

Generate the migration from `api/`: `npm run db:generate`. Then append the backfill to the generated `api/migrations/0003_*.sql` so pre-existing sweeps (dev DB: WC default, NBA sweeps) keep their live coins behavior:

```sql
--> statement-breakpoint
UPDATE "sweep" SET "wagering_enabled" = true;
```

(The backfill runs before any new sweep can exist, so blanket-true is exact. Fresh DBs get no rows from it — which is why the seed change below is required.)

In `api/src/seed/seed.js`, the default-sweep insert (~line 31) gains the flag:

```js
  await db.insert(s.sweep).values({
    id: 'default', name: 'The Sweep', kind: 'default', scoringRule: 'top3',
    coOwners: 'all_win', competitionId: COMPETITION_ID, wageringEnabled: true,
  }).onConflictDoNothing()
```

- [ ] **Step 4: Run test to verify it passes**

Run from `api/`: `npx vitest run test/wagering-gate.test.js`
Expected: PASS. (Testcontainers DBs run migrations + seed fresh; if the harness caches a template DB, check `api/test/helpers/global-setup.js` for how migrations are applied and follow it.)

- [ ] **Step 5: Apply to the dev DB (manual, guarded)**

```bash
cd api
node --env-file=../.env -e "
const {createPool}=await import('./src/db/client.js');const p=createPool();
const r=await p.query('select current_database()');
if(r.rows[0].current_database!=='sweep_platform'){console.error('WRONG DB — ABORT');process.exit(1)}
await p.end();console.log('db ok: sweep_platform')"
npm run db:migrate
```

Expected: `db ok: sweep_platform` then `migrations applied`. If the guard prints WRONG DB, stop — `.env` `DATABASE_URL` must be repointed at `sweep_platform` for this command only; never run against the `sweep` database.

- [ ] **Step 6: Run the full api suite, commit**

Run from `api/`: `npm test` — expected all green.

```bash
git add api/src/db/schema.js api/migrations api/src/seed/seed.js api/test/wagering-gate.test.js
git commit -m "feat(api): sweep.wageringEnabled column, backfill existing sweeps ON"
git push origin main
```

---

### Task 3: Wagering flag gate on bet/parlay writes

**Files:**
- Modify: `api/src/routes/coins.js` (both POST handlers)
- Test: `api/test/wagering-gate.test.js`

**Interfaces:**
- Consumes: `req.sweep.wageringEnabled` (T2).
- Produces: `403 {error:'wagering_disabled'}` on `POST /api/bet` and `POST /api/parlay` when the flag is false; reads unaffected.

- [ ] **Step 1: Write the failing tests**

Append to `api/test/wagering-gate.test.js`. The default sweep is reachable with no host header (default-sweep mode, role member) — the same access pattern `coins.test.js` uses. To test an OFF sweep, flip the default sweep's flag and restore it:

```js
import { and } from 'drizzle-orm'            // merge into the existing drizzle-orm import
import { person, event } from '../src/db/schema.js'  // merge into the existing schema import
import { detailMerge } from '../src/db/event-shape.js'

async function bettable() {
  const [f] = await db.select().from(event).limit(1)
  const markets = { '1x2': { label: 'Match Winner', book: 'TestBook', selections: [
    { key: 'HOME', label: 'Home', odds: 2.1 }, { key: 'DRAW', label: 'Draw', odds: 3.2 }, { key: 'AWAY', label: 'Away', odds: 3.4 } ] } }
  await db.update(event).set({ status: 'upcoming', detail: detailMerge({ markets }) }).where(eq(event.id, f.id))
  return f
}
const aPerson = async () => (await db.select().from(person).limit(1))[0]
const setWagering = (on) => db.update(sweep).set({ wageringEnabled: on }).where(eq(sweep.id, 'default'))

test('wagering OFF: bet and parlay are refused with a stable error; reads stay open', async () => {
  const f = await bettable(); const p = await aPerson()
  await setWagering(false)
  try {
    const bet = await app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: f.id, personId: p.id, selection: 'HOME', stake: 10 } })
    expect(bet.statusCode).toBe(403)
    expect(bet.json()).toEqual({ error: 'wagering_disabled' })
    const par = await app.inject({ method: 'POST', url: '/api/parlay', payload: { personId: p.id, stake: 10, legs: [ { fixtureId: f.id, selection: 'HOME' }, { fixtureId: f.id, market: 'ou25', selection: 'OVER' } ] } })
    expect(par.statusCode).toBe(403)
    expect(par.json()).toEqual({ error: 'wagering_disabled' })
    // wallet history stays readable
    expect((await app.inject({ method: 'GET', url: '/api/coins' })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `/api/coins/ledger?personId=${p.id}` })).statusCode).toBe(200)
  } finally { await setWagering(true) }
})

test('wagering ON (default sweep as backfilled/seeded): bet placement works unchanged', async () => {
  const f = await bettable(); const p = await aPerson()
  const res = await app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: f.id, personId: p.id, selection: 'HOME', stake: 10 } })
  expect(res.statusCode).toBe(200)
  expect(res.json().bet.market).toBe('1x2') // frozen wire: market keys unchanged
})
```

- [ ] **Step 2: Run to verify failure**

Run from `api/`: `npx vitest run test/wagering-gate.test.js`
Expected: OFF test FAILS (bet returns 200/400, not 403).

- [ ] **Step 3: Implement the gate**

In `api/src/routes/coins.js`, first line of BOTH `POST /api/bet` and `POST /api/parlay` handler bodies:

```js
    if (!req.sweep.wageringEnabled) return reply.code(403).send({ error: 'wagering_disabled' })
```

- [ ] **Step 4: Run to verify pass, then the whole suite**

`npx vitest run test/wagering-gate.test.js` → PASS. Then `npm test` from `api/` — the pre-existing coins/parlay tests prove the ON path is unchanged.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/coins.js api/test/wagering-gate.test.js
git commit -m "feat(api): wageringEnabled gate refuses bet/parlay writes when off"
git push origin main
```

---

### Task 4: Server-side self-exclusion enforcement

Today `person.excludedUntil` is recorded (`POST /api/optout`) and serialized, but the bet routes never check it — a curl bypasses the UI. Enforce it where the money moves.

**Files:**
- Modify: `api/src/routes/coins.js` (both POST handlers, after the person lookup)
- Test: `api/test/wagering-gate.test.js`

**Interfaces:**
- Consumes: `isExcluded(p)` from `api/src/optout.js` (exists).
- Produces: `403 {error:'self_excluded'}` on both routes for an excluded person.

- [ ] **Step 1: Write the failing test**

Append to `api/test/wagering-gate.test.js`:

```js
test('self-excluded person cannot bet or parlay server-side; expiry restores', async () => {
  const f = await bettable(); const p = await aPerson()
  await db.update(person).set({ excludedUntil: new Date(Date.now() + 86_400_000) }).where(eq(person.id, p.id))
  try {
    const bet = await app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: f.id, personId: p.id, selection: 'HOME', stake: 10 } })
    expect(bet.statusCode).toBe(403)
    expect(bet.json()).toEqual({ error: 'self_excluded' })
    const par = await app.inject({ method: 'POST', url: '/api/parlay', payload: { personId: p.id, stake: 10, legs: [ { fixtureId: f.id, selection: 'HOME' }, { fixtureId: f.id, market: 'ou25', selection: 'OVER' } ] } })
    expect(par.statusCode).toBe(403)
    expect(par.json()).toEqual({ error: 'self_excluded' })
    // expired exclusion no longer blocks
    await db.update(person).set({ excludedUntil: new Date(Date.now() - 1000) }).where(eq(person.id, p.id))
    const again = await app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: f.id, personId: p.id, selection: 'HOME', stake: 10 } })
    expect(again.statusCode).toBe(200)
  } finally { await db.update(person).set({ excludedUntil: null }).where(eq(person.id, p.id)) }
})
```

- [ ] **Step 2: Run to verify failure**

`npx vitest run test/wagering-gate.test.js` — exclusion test FAILS (200, bet accepted).

- [ ] **Step 3: Implement**

In `api/src/routes/coins.js`, import `isExcluded`:

```js
import { isExcluded } from '../optout.js'
```

In BOTH handlers, directly after the existing minor check (`if (p.adult === false) …`):

```js
    if (isExcluded(p)) return reply.code(403).send({ error: 'self_excluded' })
```

- [ ] **Step 4: Run to verify pass + full suite**

`npx vitest run test/wagering-gate.test.js` → PASS; `npm test` → green.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/coins.js api/test/wagering-gate.test.js
git commit -m "feat(api): enforce self-exclusion at bet/parlay placement"
git push origin main
```

---

### Task 5: Flag surfaces — provision option, admin toggle, bootstrap field

**Files:**
- Modify: `api/src/routes/account.js` (provisionBody + sweep insert)
- Modify: `api/src/routes/admin.js` (new route)
- Modify: `api/src/routes/bootstrap.js` (additive field, next to `readOnly` ~line 28)
- Test: `api/test/wagering-gate.test.js`

**Interfaces:**
- Consumes: `req.sweep.wageringEnabled` (T2); the `admin` preHandler already defined in `routes/admin.js` (sweep-admin token, e.g. `/api/admin/settle-stale` uses it).
- Produces: `POST /api/account/sweeps` accepts optional `wageringEnabled: boolean` (default false); `POST /api/admin/wagering {enabled}` → `200 {wageringEnabled}`; `GET /api/bootstrap` carries `wageringEnabled: boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `api/test/wagering-gate.test.js`. For the admin toggle, mirror how existing admin-route tests authenticate as the sweep admin (see `api/test` usages of `/api/admin/settle-stale` or the admin cookie/session helper in `coins`/`admin` tests — reuse that exact helper). For the provision option, mirror the provisioning test setup in `api/test/account-sweeps.test.js` (fake catalog + recorded provider seams) and add `wageringEnabled: true` to the body, asserting the created row:

```js
test('admin toggle flips wageringEnabled for the resolved sweep', async () => {
  // authenticate as the DEFAULT sweep's admin the same way existing admin tests do
  const adminCookie = await adminSession() // reuse/adapt the existing helper from admin tests
  const off = await app.inject({ method: 'POST', url: '/api/admin/wagering', headers: { cookie: adminCookie }, payload: { enabled: false } })
  expect(off.statusCode).toBe(200)
  expect(off.json()).toEqual({ wageringEnabled: false })
  const [row] = await db.select().from(sweep).where(eq(sweep.id, 'default'))
  expect(row.wageringEnabled).toBe(false)
  const on = await app.inject({ method: 'POST', url: '/api/admin/wagering', headers: { cookie: adminCookie }, payload: { enabled: true } })
  expect(on.json()).toEqual({ wageringEnabled: true })
})

test('bootstrap exposes wageringEnabled additively', async () => {
  const body = (await app.inject({ method: 'GET', url: '/api/bootstrap' })).json()
  expect(body.wageringEnabled).toBe(true)
})
```

And in `api/test/account-sweeps.test.js` (or the new file if simpler with the seams available there): provision one sweep with `wageringEnabled: true` in the body and assert the DB row is `true`; provision without the field and assert `false`.

- [ ] **Step 2: Run to verify failure**

`npx vitest run test/wagering-gate.test.js` → toggle 404s, bootstrap field undefined.

- [ ] **Step 3: Implement all three surfaces**

`api/src/routes/account.js` — `provisionBody.properties` gains:

```js
    wageringEnabled: { type: 'boolean' },
```

and the sweep insert inside the provision transaction gains:

```js
        wageringEnabled: req.body.wageringEnabled ?? false,
```

`api/src/routes/admin.js` — after the existing settle-stale route (needs `sweep` in the schema import and `eq` from drizzle if not present):

```js
  const wageringBody = { type: 'object', required: ['enabled'], additionalProperties: false, properties: { enabled: { type: 'boolean' } } }
  app.post('/api/admin/wagering', { preHandler: admin, schema: { body: wageringBody } }, async (req) => {
    await app.db.update(sweep).set({ wageringEnabled: req.body.enabled }).where(eq(sweep.id, req.sweep.id))
    return { wageringEnabled: req.body.enabled }
  })
```

`api/src/routes/bootstrap.js` — next to the `readOnly` field:

```js
      wageringEnabled: req.sweep?.wageringEnabled ?? false,
```

- [ ] **Step 4: Run to verify pass + full suite**

`npx vitest run test/wagering-gate.test.js` (and the provisioning test file) → PASS; `npm test` → green. Note the read-only gate covers the new admin POST automatically (lapsed sweeps can't toggle) — no extra code.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/account.js api/src/routes/admin.js api/src/routes/bootstrap.js api/test
git commit -m "feat(api): wagering flag surfaces — provision option, admin toggle, bootstrap field"
git push origin main
```

---

### Task 6: Extract the market registry (behavior-preserving)

**Files:**
- Create: `api/src/wagering/markets.js`
- Modify: `api/src/wagering/settle.js` (delegate + re-export)
- Test: existing suite (`coins-settle.test.js` etc.) — no new tests; extraction must not change behavior.

**Interfaces:**
- Produces: `MARKET_REGISTRY` — `{ [marketKey]: { needsDraws?: true, grade(f, selection, line, sport) => 'won'|'lost'|null } }`; `resolveBet(market, selection, line, f, sport = SPORTS.football)`; `fixtureResult(f)` and `regulationResult(f)` move to `markets.js`, re-exported from `settle.js` so existing importers keep working.

- [ ] **Step 1: Create `api/src/wagering/markets.js`**

Move `fixtureResult`, `htScores`, `htResult`, `regulationResult` from `settle.js` verbatim, then convert `resolveBet`'s switch into registry entries. Every existing branch moves **verbatim** — same field access, same null semantics (copy the bodies from `settle.js:42-100`; they are pure functions of `(selection, line, f)`):

```js
import { SPORTS } from '../sports.js'

/* fixtureResult, htScores, htResult, regulationResult — moved verbatim from settle.js */

export const MARKET_REGISTRY = {
  '1x2': { needsDraws: true, grade(f, selection) { const r = regulationResult(f); return r == null ? null : r === selection ? 'won' : 'lost' } },
  toq:   { grade(f, selection) { const r = fixtureResult(f); return r == null ? null : r === selection ? 'won' : 'lost' } },
  fh1x2: { needsDraws: true, grade(f, selection) { const r = htResult(f); return r == null ? null : r === selection ? 'won' : 'lost' } },
  ou25:  { grade(f, selection, line) { /* the ou25 half of the current ou25/cards branch, verbatim */ } },
  cards: { grade(f, selection, line) { /* the cards half of the current ou25/cards branch, verbatim */ } },
  cs:    { grade(f, selection) { /* verbatim */ } },
  btts:  { grade(f, selection) { /* verbatim */ } },
  dc:    { needsDraws: true, grade(f, selection) { /* verbatim */ } },
  oe:    { grade(f, selection) { /* verbatim */ } },
  fhou:  { grade(f, selection, line) { /* verbatim */ } },
  gs:    { grade(f, selection) { /* verbatim, incl. the name-parse helpers */ } },
}

/** Resolve one bet → 'won' | 'lost' | null (null = leave open). Sport defaults to
 *  football so existing callers/tests are unchanged; settleBets passes the real sport. */
export function resolveBet(market, selection, line, f, sport = SPORTS.football) {
  const entry = MARKET_REGISTRY[market]
  if (!entry) return null
  if (entry.needsDraws && !sport.hasDraws) return null // belt: never grade a draw market for a no-draw sport
  return entry.grade(f, selection, line, sport)
}
```

(The `/* verbatim */` bodies are NOT placeholders for new code — they are the exact existing blocks in `api/src/wagering/settle.js:42-100`, cut-and-pasted. The implementer copies them; writing them out here would duplicate 60 lines that must match the source file byte-for-byte anyway.)

- [ ] **Step 2: Slim `settle.js`**

Remove the moved functions from `settle.js`; add:

```js
import { resolveBet, fixtureResult, regulationResult } from './markets.js'
export { resolveBet, fixtureResult, regulationResult, MARKET_REGISTRY } from './markets.js'
```

(`settleBets` keeps calling `resolveBet(b.market, b.selection, …, f)` — the football default keeps behavior identical until T7 threads the sport.)

- [ ] **Step 3: Run the full api suite**

From `api/`: `npm test`
Expected: all green — the extraction changed nothing observable. If anything fails, the move was not verbatim; fix the move, not the test.

- [ ] **Step 4: Commit**

```bash
git add api/src/wagering
git commit -m "refactor(api): extract market grading into a declarative registry"
git push origin main
```

---

### Task 7: Spine markets — `ml`, `ou`, `hcap` + sport-aware settlement

**Files:**
- Modify: `api/src/sports.js` (`gradeOn`)
- Modify: `api/src/wagering/markets.js` (three new entries + `scoresFor`)
- Modify: `api/src/wagering/settle.js` (`settleBets` passes the event's real sport)
- Test: `api/test/wagering-markets.test.js` (new)

**Interfaces:**
- Consumes: `MARKET_REGISTRY`, `resolveBet` (T6); `sportConfig` from `api/src/sports.js`.
- Produces: registry entries `ml`/`ou`/`hcap`; `SPORTS.football = { hasDraws: true, gradeOn: 'regulation' }`, `SPORTS.basketball = { hasDraws: false, gradeOn: 'final' }`; `settleBets` grades with the fixture's competition sport.

- [ ] **Step 1: Write the failing tests**

Create `api/test/wagering-markets.test.js` (pure unit tests — no DB needed for grading):

```js
import { test, expect } from 'vitest'
import { resolveBet } from '../src/wagering/markets.js'
import { SPORTS } from '../src/sports.js'

const nba = SPORTS.basketball, foot = SPORTS.football
// flattened-event shape: final NBA game 110-104 (final score incl. OT)
const g = { status: 'final', t1Code: 'BOS', t2Code: 'DAL', score1: 110, score2: 104, winnerCode: 'BOS', regScore1: null, regScore2: null }

test('ml grades on the final result, OT included', () => {
  expect(resolveBet('ml', 'HOME', null, g, nba)).toBe('won')
  expect(resolveBet('ml', 'AWAY', null, g, nba)).toBe('lost')
  expect(resolveBet('ml', 'HOME', null, { ...g, score1: null, score2: null, winnerCode: null }, nba)).toBe(null) // not final yet
})

test('ou grades total vs the stored half-point line per gradeOn', () => {
  expect(resolveBet('ou', 'OVER', 213.5, g, nba)).toBe('won')   // 214 > 213.5
  expect(resolveBet('ou', 'UNDER', 213.5, g, nba)).toBe('lost')
  expect(resolveBet('ou', 'OVER', 214.5, g, nba)).toBe('lost')
  expect(resolveBet('ou', 'OVER', null, g, nba)).toBe(null)
  // integer line landing exactly on the total → push, left open (half lines only at offer)
  expect(resolveBet('ou', 'OVER', 214, g, nba)).toBe(null)
  // football grades regulation, not final: reg 1-1, final 2-1 after ET
  const f = { ...g, score1: 2, score2: 1, regScore1: 1, regScore2: 1 }
  expect(resolveBet('ou', 'OVER', 2.5, f, foot)).toBe('lost')   // reg total 2
})

test('hcap grades home-relative line', () => {
  expect(resolveBet('hcap', 'HOME', -5.5, g, nba)).toBe('won')  // 110-5.5 > 104
  expect(resolveBet('hcap', 'HOME', -6.5, g, nba)).toBe('lost')
  expect(resolveBet('hcap', 'AWAY', -6.5, g, nba)).toBe('won')
  expect(resolveBet('hcap', 'AWAY', -6, g, nba)).toBe(null)     // exact push → left open
})

test('draw markets never grade for a no-draw sport (belt)', () => {
  expect(resolveBet('1x2', 'HOME', null, { ...g, regScore1: 110, regScore2: 104 }, nba)).toBe(null)
  expect(resolveBet('dc', '1X', null, { ...g, regScore1: 110, regScore2: 104 }, nba)).toBe(null)
})
```

- [ ] **Step 2: Run to verify failure**

From `api/`: `npx vitest run test/wagering-markets.test.js`
Expected: FAIL (`ml`/`ou`/`hcap` unknown → null; `gradeOn` missing).

- [ ] **Step 3: Implement**

`api/src/sports.js`:

```js
export const SPORTS = {
  football: { hasDraws: true, gradeOn: 'regulation' },   // bets grade on the 90' score (unchanged behavior)
  basketball: { hasDraws: false, gradeOn: 'final' },     // final score incl. OT
}
```

`api/src/wagering/markets.js` — helper + three entries:

```js
/** Score pair a sport's bets grade on; null when not yet available. */
function scoresFor(f, sport) {
  if (sport.gradeOn === 'regulation') return f.regScore1 == null || f.regScore2 == null ? null : [f.regScore1, f.regScore2]
  return f.score1 == null || f.score2 == null ? null : [f.score1, f.score2]
}
```

```js
  ml: { grade(f, selection) { const r = fixtureResult(f); return r == null ? null : r === selection ? 'won' : 'lost' } },
  ou: { grade(f, selection, line, sport) {
    if (line == null) return null
    const s = scoresFor(f, sport); if (!s) return null
    const total = s[0] + s[1]
    if (total === line) return null // ponytail: half-point lines only at offer — an integer push would need refund plumbing
    return ((total > line) === (selection === 'OVER')) ? 'won' : 'lost'
  } },
  hcap: { grade(f, selection, line, sport) {
    if (line == null) return null
    const s = scoresFor(f, sport); if (!s) return null
    const margin = s[0] + line - s[1]
    if (margin === 0) return null // ponytail: half-point lines only at offer — an integer push would need refund plumbing
    return ((margin > 0) === (selection === 'HOME')) ? 'won' : 'lost'
  } },
```

`api/src/wagering/settle.js` — `settleBets` resolves the sport once per fixture (imports: `competition` from schema, `sportConfig` from `../sports.js`):

```js
  const [comp] = await db.select().from(competition).where(eq(competition.id, row.competitionId))
  const sport = sportConfig(comp.sport)
```

and the resolve call becomes:

```js
    const outcome = resolveBet(b.market, b.selection, b.line == null ? null : Number(b.line), f, sport)
```

- [ ] **Step 4: Run to verify pass + full suite**

`npx vitest run test/wagering-markets.test.js` → PASS. `npm test` → green (football settlement unchanged: same sport config → same grading; `coins-settle`/`parlay-settle` are the regression net).

- [ ] **Step 5: Commit**

```bash
git add api/src/sports.js api/src/wagering api/test/wagering-markets.test.js
git commit -m "feat(api): spine markets ml/ou/hcap with sport-aware grading"
git push origin main
```

---

### Task 8: Sport-aware validation — hasDraws veto + extended enums

**Files:**
- Modify: `api/src/routes/coins.js` (MARKETS enum, sport lookup, veto in both handlers)
- Test: `api/test/wagering-gate.test.js`

**Interfaces:**
- Consumes: `MARKET_REGISTRY` (needsDraws flags, T6), `sportConfig` (T7), `competition` schema table.
- Produces: bet/parlay accept `ml`/`ou`/`hcap` market keys; `400 {error:'market_not_offered'}` for draw-bearing markets or `DRAW` selections on no-draw sports.

- [ ] **Step 1: Write the failing test**

Append to `api/test/wagering-gate.test.js`. Uses a throwaway basketball competition + sweep on the platform host (mirror the sweep/session pattern from `nba-e2e.test.js`: insert competition/competitor/event/sweep/person rows directly, then `POST /api/session` with the member token on `host: 'platform.test'`):

```js
test('no-draw sport: 1x2 and DRAW are refused at validation', async () => {
  // minimal basketball world: competition + two competitors + one upcoming event with an ml market stored
  await db.insert(competition).values({ id: 'ck_wgnba', provider: 'apibasketball', sport: 'basketball', leagueId: '12', season: '2023-2024', format: 'league', name: 'NBA vt' })
  await db.insert(competitor).values([
    { id: 'cp_ck_wgnba_BOS', competitionId: 'ck_wgnba', code: 'BOS', name: 'Boston', color: '#0f0' },
    { id: 'cp_ck_wgnba_DAL', competitionId: 'ck_wgnba', code: 'DAL', name: 'Dallas', color: '#00f' },
  ])
  await db.insert(event).values({ id: 'evt_wgnba1', competitionId: 'ck_wgnba', c1Code: 'BOS', c2Code: 'DAL', startUtc: new Date(Date.now() + 3600_000), status: 'upcoming', stage: 'group',
    detail: { markets: {
      ml: { label: 'Moneyline', book: 'TestBook', selections: [ { key: 'HOME', label: 'Boston', odds: 1.6 }, { key: 'AWAY', label: 'Dallas', odds: 2.3 } ] },
      '1x2': { label: 'poisoned', book: 'TestBook', selections: [ { key: 'HOME', label: 'H', odds: 1.6 }, { key: 'DRAW', label: 'D', odds: 9.9 }, { key: 'AWAY', label: 'A', odds: 2.3 } ] },
    } } })
  const mt = 'mt_wgnba'
  await db.insert(sweep).values({ id: 'sw_wgnba', name: 'NBA WG', kind: 'token', memberToken: mt, adminToken: 'at_wgnba', competitionId: 'ck_wgnba', wageringEnabled: true })
  await db.insert(person).values({ id: 'pn_wgnba', sweepId: 'sw_wgnba', name: 'Nia', short: 'Nia', initials: 'NI', avColor: '#111' })
  const cookie = (await app.inject({ method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token: mt } })).headers['set-cookie']
  const H = { host: 'platform.test', cookie }

  // even with a (poisoned) stored 1x2 market, validation refuses it for basketball
  const r1 = await app.inject({ method: 'POST', url: '/api/bet', headers: H, payload: { fixtureId: 'evt_wgnba1', personId: 'pn_wgnba', market: '1x2', selection: 'DRAW', stake: 10 } })
  expect(r1.statusCode).toBe(400)
  expect(r1.json()).toEqual({ error: 'market_not_offered' })
  // the ml spine market places fine
  const r2 = await app.inject({ method: 'POST', url: '/api/bet', headers: H, payload: { fixtureId: 'evt_wgnba1', personId: 'pn_wgnba', market: 'ml', selection: 'HOME', stake: 10 } })
  expect(r2.statusCode).toBe(200)
  // parlay leg with a draw market on basketball is refused too
  const r3 = await app.inject({ method: 'POST', url: '/api/parlay', headers: H, payload: { personId: 'pn_wgnba', stake: 10, legs: [ { fixtureId: 'evt_wgnba1', market: 'ml', selection: 'HOME' }, { fixtureId: 'evt_wgnba1', market: '1x2', selection: 'HOME' } ] } })
  expect(r3.statusCode).toBe(400)
  expect(r3.json()).toMatchObject({ error: 'market_not_offered' })
})
```

Add matching cleanup for `sw_wgnba` / `ck_wgnba` rows (bets, ledger, person, sweep, event, competitor, competition) in this file's `afterAll`.

- [ ] **Step 2: Run to verify failure**

`npx vitest run test/wagering-gate.test.js` — FAILS: `ml` is rejected by the enum (400 schema error) and `1x2 DRAW` is accepted (200).

- [ ] **Step 3: Implement**

`api/src/routes/coins.js`:

```js
const MARKETS = ['1x2', 'toq', 'ou25', 'cards', 'fh1x2', 'cs', 'btts', 'dc', 'oe', 'fhou', 'gs', 'ml', 'ou', 'hcap']
```

Imports gain:

```js
import { competition } from '../db/schema.js'   // merge into the schema import
import { sportConfig } from '../sports.js'
import { MARKET_REGISTRY } from '../wagering/markets.js'
```

Shared helper in the same file:

```js
async function sweepSportConfig(app, req) {
  const [comp] = await app.db.select().from(competition).where(eq(competition.id, req.sweep.competitionId))
  return sportConfig(comp.sport)
}
const drawVetoed = (cfg, market, selection) => !cfg.hasDraws && (MARKET_REGISTRY[market]?.needsDraws || selection === 'DRAW')
```

In `POST /api/bet`, after the fixture is resolved (before the `no_odds` check):

```js
    const cfg = await sweepSportConfig(app, req)
    if (drawVetoed(cfg, market, selection)) return reply.code(400).send({ error: 'market_not_offered' })
```

In `POST /api/parlay`, one `const cfg = await sweepSportConfig(app, req)` before the legs loop; inside the loop (after `const market = l.market ?? '1x2'`):

```js
      if (drawVetoed(cfg, market, l.selection)) return reply.code(400).send({ error: 'market_not_offered', fixtureId: l.fixtureId, market })
```

(Note the single-bet route returns the bare error object; keep the exact shapes the tests assert.)

- [ ] **Step 4: Run to verify pass + full suite**

`npx vitest run test/wagering-gate.test.js` → PASS; `npm test` → green (football sweeps: `cfg.hasDraws` true → veto never fires; one extra indexed select per write).

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/coins.js api/test/wagering-gate.test.js
git commit -m "feat(api): hasDraws-aware bet validation + spine market keys on the wire"
git push origin main
```

---

### Task 9: Football handicap offer — `mapMarkets` gains `hcap`

**Files:**
- Modify: `api/src/providers/mapping.js` (`mapMarkets`)
- Test: wherever `mapMarkets` is currently tested — locate with `grep -rln "mapMarkets" api/test` and extend that file; the new case loads the LIVE capture.

**Interfaces:**
- Consumes: `api/test/fixtures/apifootball/odds-spine-live.json` (13-book real WC-SF capture; the old `odds.json` has no handicap).
- Produces: `mapMarkets(raw).markets.hcap = { label: 'Handicap', line: <signed home-relative number>, book, selections: [{key:'HOME',label,odds},{key:'AWAY',label,odds}] }` when a half-point Asian Handicap pair exists; absent otherwise. Convention (verified against the capture in the odds-shape note): values pair by displayed number — `"Home +0.5"` and `"Away +0.5"` are the two sides of the SAME market whose home-relative line is `+0.5` (anchor: `±0` odds match the Home/Away DNB market).

- [ ] **Step 1: Write the failing tests**

In the located mapMarkets test file:

```js
import { readFileSync } from 'node:fs'
const liveOdds = JSON.parse(readFileSync(new URL('./fixtures/apifootball/odds-spine-live.json', import.meta.url)))

test('mapMarkets extracts a half-point handicap main line from the live capture', () => {
  const m = mapMarkets(liveOdds)
  expect(m.markets.hcap).toBeDefined()
  const h = m.markets.hcap
  expect(Math.abs(h.line % 1)).toBeCloseTo(0.5)             // half-point lines only
  expect(h.selections.map((s) => s.key).sort()).toEqual(['AWAY', 'HOME'])
  for (const s of h.selections) expect(Number(s.odds)).toBeGreaterThan(1)
})

test('hcap picks the most balanced half-point line and pairs sides by displayed number', () => {
  const raw = { response: [ { bookmakers: [ { name: 'Bet365', bets: [ { id: 4, name: 'Asian Handicap', values: [
    { value: 'Home +0', odd: '3.25' }, { value: 'Away +0', odd: '1.30' },
    { value: 'Home +0.5', odd: '2.00' }, { value: 'Away +0.5', odd: '1.77' },
    { value: 'Home +1', odd: '1.50' }, { value: 'Away +1', odd: '2.45' },
    { value: 'Home +1.5', odd: '1.25' }, { value: 'Away +1.5', odd: '3.90' },
  ] }, { id: 1, name: 'Match Winner', values: [ { value: 'Home', odd: '4.50' }, { value: 'Draw', odd: '3.40' }, { value: 'Away', odd: '1.80' } ] } ] } ] } ] }
  const m = mapMarkets(raw)
  expect(m.markets.hcap.line).toBe(0.5)                     // |2.00−1.77| is the tightest half-point pair
  expect(m.markets.hcap.selections).toEqual([
    { key: 'HOME', label: 'Home +0.5', odds: 2.0 },
    { key: 'AWAY', label: 'Away +0.5', odds: 1.77 },
  ])
})

test('no half-point handicap pair → hcap omitted', () => {
  const raw = { response: [ { bookmakers: [ { name: 'Bet365', bets: [ { id: 4, name: 'Asian Handicap', values: [
    { value: 'Home +1', odd: '1.50' }, { value: 'Away +1', odd: '2.45' } ] },
    { id: 1, name: 'Match Winner', values: [ { value: 'Home', odd: '4.50' }, { value: 'Draw', odd: '3.40' }, { value: 'Away', odd: '1.80' } ] } ] } ] } ] }
  expect(mapMarkets(raw).markets.hcap).toBeUndefined()
})
```

- [ ] **Step 2: Run to verify failure**

From `api/`: `npx vitest run test/<located-file>` — new cases FAIL (`hcap` undefined).

- [ ] **Step 3: Implement in `mapMarkets`**

After the existing `Goals Over/Under` block in `api/src/providers/mapping.js` (reuses the existing `acrossBooks` helper):

```js
  const ahR = acrossBooks('Asian Handicap')
  if (ahR) {
    // values pair by displayed number: "Home +0.5" / "Away +0.5" are the two sides of the
    // market whose home-relative line is +0.5 (±0 anchors to the Home/Away DNB odds).
    const sides = new Map() // line -> { home: {label, odds}, away: {label, odds} }
    for (const v of ahR.bet.values ?? []) {
      const mch = /^(Home|Away)\s+([+-]?\d+(?:\.\d+)?)$/.exec(String(v.value))
      if (!mch) continue
      const line = Number(mch[2]), odds = Number(v.odd)
      if (Math.abs(line % 1) !== 0.5 || !Number.isFinite(odds) || odds <= 1) continue // half-point lines only
      const e = sides.get(line) ?? {}
      e[mch[1] === 'Home' ? 'home' : 'away'] = { label: String(v.value), odds }
      sides.set(line, e)
    }
    let best = null
    for (const [line, e] of sides) {
      if (!e.home || !e.away) continue
      const gap = Math.abs(e.home.odds - e.away.odds)
      if (!best || gap < best.gap) best = { line, gap, ...e }
    }
    if (best) markets['hcap'] = { label: 'Handicap', line: best.line, book: ahR.book.name,
      selections: [ { key: 'HOME', label: best.home.label, odds: best.home.odds }, { key: 'AWAY', label: best.away.label, odds: best.away.odds } ] }
  }
```

- [ ] **Step 4: Run to verify pass + full suite**

Located test file → PASS; `npm test` from `api/` → green (existing mapMarkets assertions untouched — `hcap` is additive; the baseline odds loop stores it automatically via `detail.markets`, no worker change).

- [ ] **Step 5: Commit**

```bash
git add api/src/providers/mapping.js api/test
git commit -m "feat(api): mapMarkets offers a half-point handicap main line (spine)"
git push origin main
```

---

### Task 10: NBA spine e2e — place + settle `ml`/`ou`/`hcap` singles and a parlay

Proves the `hasDraws=false` spine end to end on recorded feeds with injected
normalized markets (post-mapping shape is our own — no basketball feed odds
exist to record; see the odds-shape note). Basketball provider keeps NO
`fetchOdds` — verify the seam stays shut.

**Files:**
- Modify: `api/test/nba-e2e.test.js` (new test in the existing harness — it already provisions `apibasketball:12:2023-2024` from recorded fixtures with an upcoming→final feed flip)

**Interfaces:**
- Consumes: everything from T2–T8; `createRecordedBasketballProvider`, `upcomingGames()`, `recorded()`, `sessionCookie()` already in the file; `settleBets` (sport-aware since T7).

- [ ] **Step 1: Write the failing test**

Append to `api/test/nba-e2e.test.js` (after the existing e2e test — it leaves the competition final; re-provision an upcoming feed inside this test, or order it before the finals flip if simpler — mirror the file's existing sequencing). Core content:

```js
test('NBA wagering spine: inject markets, bet ml/ou/hcap + parlay, settle on the recorded finals', async () => {
  // fresh upcoming snapshot so bets are placeable
  await syncBaseline(db, recorded(upcomingGames()), (await db.select().from(competition).where(eq(competition.id, ID)))[0])
  const evs = await db.select().from(event).where(eq(event.competitionId, ID))
  const [g1, g2] = evs.slice(0, 2)
  const markets = {
    ml:   { label: 'Moneyline', book: 'TestBook', selections: [ { key: 'HOME', label: 'Home', odds: 1.8 }, { key: 'AWAY', label: 'Away', odds: 2.0 } ] },
    ou:   { label: 'Total', line: 213.5, book: 'TestBook', selections: [ { key: 'OVER', label: 'Over 213.5', odds: 1.9 }, { key: 'UNDER', label: 'Under 213.5', odds: 1.9 } ] },
    hcap: { label: 'Handicap', line: -2.5, book: 'TestBook', selections: [ { key: 'HOME', label: 'Home -2.5', odds: 1.95 }, { key: 'AWAY', label: 'Away +2.5', odds: 1.85 } ] },
  }
  for (const g of [g1, g2]) await db.update(event).set({ detail: detailMerge({ markets }) }).where(eq(event.id, g.id))
  await db.update(sweep).set({ wageringEnabled: true }).where(eq(sweep.id, 'sw_nbae2e'))
  const cookie = await sessionCookie(memberToken)
  const H = { host: 'platform.test', cookie }

  const b1 = await app.inject({ method: 'POST', url: '/api/bet', headers: H, payload: { fixtureId: g1.id, personId: 'pn_e2e', market: 'ml', selection: 'HOME', stake: 100 } })
  expect(b1.statusCode).toBe(200)
  const b2 = await app.inject({ method: 'POST', url: '/api/bet', headers: H, payload: { fixtureId: g1.id, personId: 'pn_e2e', market: 'ou', selection: 'OVER', stake: 50 } })
  expect(b2.statusCode).toBe(200)
  const b3 = await app.inject({ method: 'POST', url: '/api/bet', headers: H, payload: { fixtureId: g1.id, personId: 'pn_e2e', market: 'hcap', selection: 'HOME', stake: 50 } })
  expect(b3.statusCode).toBe(200)
  const par = await app.inject({ method: 'POST', url: '/api/parlay', headers: H, payload: { personId: 'pn_e2e', stake: 40, legs: [ { fixtureId: g1.id, market: 'ml', selection: 'HOME' }, { fixtureId: g2.id, market: 'ou', selection: 'UNDER' } ] } })
  expect(par.statusCode).toBe(200)

  // flip the feed to the real (final) capture and settle both games
  await syncBaseline(db, recorded(load('games')), (await db.select().from(competition).where(eq(competition.id, ID)))[0])
  await settleBets(db, g1.id); await settleBets(db, g2.id)

  const settled = await db.select().from(bet).where(and(eq(bet.sweepId, 'sw_nbae2e'), eq(bet.fixtureId, g1.id)))
  expect(settled.every((b) => b.status === 'won' || b.status === 'lost')).toBe(true)
  // grading agrees with the recorded final score (read it and assert each bet the cheap way)
  const [fin] = await db.select().from(event).where(eq(event.id, g1.id))
  const homeWon = fin.winnerCode === fin.c1Code
  const mlBet = settled.find((b) => b.market === 'ml' && !b.parlayId)
  expect(mlBet.status).toBe(homeWon ? 'won' : 'lost')
  const total = fin.score1 + fin.score2
  expect(settled.find((b) => b.market === 'ou' && !b.parlayId).status).toBe(total > 213.5 ? 'won' : 'lost')
  expect(settled.find((b) => b.market === 'hcap' && !b.parlayId).status).toBe(fin.score1 - 2.5 > fin.score2 ? 'won' : 'lost')
  // ledger: a won single paid out; the parlay resolved once both legs graded
  const [pl] = await db.select().from(parlay).where(eq(parlay.sweepId, 'sw_nbae2e'))
  expect(['won', 'lost']).toContain(pl.status)
})
```

(Imports to merge at top: `parlay` into the schema import, `detailMerge` from `../src/db/event-shape.js`. NOTE: `syncBaseline`'s detail merge preserves stored `markets` on update — the finals flip must not wipe the injected markets; if it does, that's a real bug to surface, not to paper over: check `detailMerge` semantics before "fixing" the test.)

- [ ] **Step 2: Run to verify failure**

From `api/`: `npx vitest run test/nba-e2e.test.js`
Expected: before T2–T8 land this whole test can't pass; on a branch where they have, first run should still FAIL only if something real is broken. Written after T8, the failure mode to expect on first run is a genuine defect — investigate, don't weaken assertions.

- [ ] **Step 3: Make it pass**

No new production code is expected — this task is the integration proof. Any failure is a defect in T2–T9; fix it there (with its own test if it's a new behavior), then re-run.

- [ ] **Step 4: Full suite**

From `api/`: `npm test` → green. From repo root: `npm run build` → web build passes (hooks run it anyway).

- [ ] **Step 5: Commit**

```bash
git add api/test/nba-e2e.test.js
git commit -m "test(api): NBA wagering spine e2e — inject markets, settle singles + parlay"
git push origin main
```

---

### Task 11: Ledger + docs close-out

**Files:**
- Modify: `.superpowers/sdd/progress.md` (append a P5 section following the P1–P4 precedent)
- Modify: `docs/superpowers/specs/2026-07-04-phase5-wagering-design.md` (record any approved deviations discovered during execution; confirm AFK defaults status)

- [ ] **Step 1: Append the P5 section to the SDD ledger**

Follow the existing per-phase format in `.superpowers/sdd/progress.md`: commit range, task list with review outcomes, final suite counts (api N / web 436), the decision-(a) deferral (basketball odds seam shut, revisit ~Oct 2026 or on paid key), and the AFK defaults awaiting veto (decision c surface, backfill-ON, exclusion enforcement).

- [ ] **Step 2: Verify the whole world one last time**

```bash
cd api && npm test          # expected: all green (393 + new)
cd .. && npm test -w web    # expected: 436 — UNMODIFIED
npm run build               # expected: clean build
```

- [ ] **Step 3: Commit**

```bash
git add .superpowers/sdd/progress.md docs/superpowers/specs/2026-07-04-phase5-wagering-design.md
git commit -m "docs(p5): SDD ledger P5 section + design close-out"
git push origin main
```

---

## Self-Review (done at write time)

- **Spec coverage:** §2 schema→T2; §3 gate stack→T3 (flag), T4 (exclusion), existing P4 gate (step 1) untouched; §4 surfaces→T5; §5 spine→T6/T7 (registry+grading), T8 (validation), T9 (offer); §6 basketball seam→T10 (+ no fetchOdds — verified by absence, exercised in T10); §7 rename→T1; §8 untouched-list→no task touches settlement plumbing/rewards/billing; §9 testing→each task + T10 e2e + T11 final verify.
- **Type consistency:** `resolveBet(market, selection, line, f, sport = SPORTS.football)` used identically in T6/T7/T10; `MARKET_REGISTRY` consumed by T8; `sportConfig` returns `{hasDraws, gradeOn}` (T7) consumed in T8's `drawVetoed`; `hcap.line` is the signed home-relative number in both T9 (offer) and T7 (grading).
- **Known judgment calls baked in:** T6's registry bodies reference the exact existing code blocks (`settle.js:42-100`) rather than duplicating 60 lines — the blocks must match the source byte-for-byte, so the source IS the spec there. T10 expects `detailMerge` to preserve injected markets across the finals flip — if it doesn't, that's a live-path bug (baseline would wipe stored odds on every sync) and must be fixed in `event-shape.js`, not the test.
