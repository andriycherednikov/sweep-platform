# Multi-bet (parlay / accumulator) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add parlay (accumulator) betting to the Wagers feature — combine 2+ selections across different fixtures into one stake, odds multiply, all legs must win — and lift the group-stage-only restriction for the whole feature via correct regulation-time (90') settlement.

**Architecture:** Approach C — a new `parlay` parent table owns the money (stake, combined odds, payout, overall status); each leg is a reused `bet` row (`parlayId` set, `stake = 0`). The money lives only in `coin_ledger` keyed by the parlay id, so legs never touch the balance. Settlement reuses the per-row `resolveBet` grader (rewritten to grade on 90-minute scores), then a small `settleParlay` rollup. The UI moves to a unified accumulating betslip: tapping odds toggles a leg into an in-memory store; a floating pill opens a sheet that places a single bet (1 leg) or a parlay (2+).

**Tech Stack:** Node 22 (ESM) + Fastify 5 + Drizzle ORM / Postgres (api); Vite + React 18 + TanStack Query (web); Vitest + `@testcontainers/postgresql` (tests — Docker must be running). Spec: `docs/superpowers/specs/2026-06-19-multi-bet-parlay-design.md`.

---

## Shared contract (names & shapes used across tasks)

Keep these EXACT across every task — later tasks depend on them.

**DB (`api/src/db/schema.js`):**
- `fixture.regScore1`, `fixture.regScore2` — `integer`, nullable (90-minute score).
- `parlay` table (drizzle export `parlay`): `id` text PK, `sweepId` text, `personId` text, `stake` integer, `combinedOdds` numeric, `potentialPayout` integer, `status` text default `'open'`, `placedAt` timestamptz default now, `settledAt` timestamptz null. Index `parlay_sweep_id_idx` on `sweepId`; composite FK `parlay_person_sweep_fk` on `(personId, sweepId)`.
- `bet.parlayId` — text, nullable, FK → `parlay.id` `ON DELETE CASCADE`. Index `bet_parlay_id_idx`.

**IDs:** parlay id = `` `par_${randomUUID()}` ``; each leg bet id = `randomUUID()`. Ledger rows for a parlay use `refId = parlayId`.

**Settlement (`api/src/coins/settle.js`):**
- `regulationResult(f)` → `'HOME' | 'AWAY' | 'DRAW' | null` from `regScore1`/`regScore2`.
- `resolveBet` grades `1x2` via `regulationResult`, `ou25`/`cs` via `regScore1`/`regScore2`, `cards` counting events with `(e.minute ?? 0) <= 90`. `fixtureResult` (winnerCode-based) is UNCHANGED (used by rewards).
- `settleParlay(db, parlayId, publish)` — rolls up a parlay.

**Wallet/serialize (`api/src/coins/ledger.js`):**
- `serializeParlay(p, legs)` → `{ id, stake, combinedOdds, potentialPayout, status, placedAt, settledAt, legs: [serializeBet(leg), …] }`.
- `walletFor` returns `{ balance, weeklyGrant, bets: { open, settled }, parlays: { open, settled } }` where `bets` is filtered to `parlayId IS NULL`.

**API (`api/src/routes/coins.js`):** `POST /api/parlay`, body `{ personId, stake, legs: [{ fixtureId, market?, selection }] }`. Error codes: `too_few_legs`, `duplicate_fixture`, `fixture_not_found`, `leg_betting_closed`, `leg_no_odds`, `minor_not_allowed`, `insufficient_funds`, `unknown_person`. Publishes `{ type: 'bet', sweepId, personId, parlay: true, legCount }`.

**Web store (`web/src/betslip.js`):** `toggleLeg(leg)`, `removeLeg(fixtureId)`, `clearBetslip()`, `hasLeg(fixtureId, market, selection)`, `betslipLegs()`, `betslipCount()`, `combinedOdds()`, `useBetslip()`. A leg = `{ fixtureId, market, selection, odds, line, book, label }`. One leg per fixture (adding another market on the same fixture replaces it).

**Web store (`web/src/coins.js`):** `placeParlay(legs, stake)`; `wallet.parlays` ingested by `setWalletData`.

**Web client (`web/src/api/client.js`):** `postParlay({ personId, stake, legs })`.

**Commands** (run from repo root unless noted; **Docker must be running for api tests**):
- api tests: `npm run test -- <pattern>`
- web tests: `npm run test -w web -- <pattern>`
- migrations: `npm run db:generate -w api`, then `npm run db:migrate -w api`

---

## Slice 0 — Regulation-time settlement + full-tournament unlock

Lands first: parlays depend on knockout legs settling correctly. Behaviour-preserving for group stage (`regScore* === score*` there).

### Task 0.1: `mapFixture` captures the 90-minute score

**Files:**
- Modify: `api/src/providers/mapping.js:47-52` (inside `mapFixture`'s returned object)
- Test: `api/test/mapping.test.js`

- [ ] **Step 1: Write the failing tests** — append to `api/test/mapping.test.js`:

```js
test('mapFixture captures the 90-minute (regulation) score from score.fulltime', () => {
  const raw = { fixture: { id: 8, date: '2026-06-20T18:00:00Z', status: { short: 'AET', elapsed: 120 }, venue: {} },
    league: { round: 'Round of 16' }, teams: { home: { id: 1, winner: true }, away: { id: 2, winner: false } },
    goals: { home: 2, away: 1 }, score: { halftime: { home: 0, away: 1 }, fulltime: { home: 1, away: 1 } } }
  const f = mapFixture(raw)
  expect(f.regScore1).toBe(1)
  expect(f.regScore2).toBe(1)
})

test('mapFixture regulation score is null when absent', () => {
  const raw = { fixture: { id: 9, date: '2026-06-20T18:00:00Z', status: { short: 'NS', elapsed: null }, venue: {} },
    league: { round: 'Group Stage - 1' }, teams: { home: { id: 1 }, away: { id: 2 } }, goals: {} }
  expect(mapFixture(raw).regScore1).toBeNull()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- mapping`
Expected: FAIL — `expected undefined to be 1` (regScore1 not produced).

- [ ] **Step 3: Implement** — in `api/src/providers/mapping.js`, inside the object returned by `mapFixture`, add two lines right after `htScore2: raw.score?.halftime?.away ?? null,`:

```js
    regScore1: raw.score?.fulltime?.home ?? null,
    regScore2: raw.score?.fulltime?.away ?? null,
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- mapping`
Expected: PASS (all mapping tests).

- [ ] **Step 5: Commit**

```bash
git add api/src/providers/mapping.js api/test/mapping.test.js
git commit -m "feat(coins): capture 90-minute regulation score in mapFixture"
```

### Task 0.2: Add `fixture.regScore1/regScore2` columns + migration (with backfill)

**Files:**
- Modify: `api/src/db/schema.js:69-71` (fixture columns)
- Create: `api/migrations/0014_*.sql` (generated; then hand-edit to add backfill)

- [ ] **Step 1: Add the columns** — in `api/src/db/schema.js`, inside the `fixture` table, add after `score2: integer('score2'),`:

```js
  regScore1: integer('reg_score1'),
  regScore2: integer('reg_score2'),
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate -w api`
Expected: a new `api/migrations/0014_*.sql` adding `reg_score1` / `reg_score2` to `fixture`.

- [ ] **Step 3: Append a backfill** — open the generated `0014_*.sql` and add at the end (group-stage finals: regulation == final score):

```sql
--> statement-breakpoint
UPDATE "fixture" SET "reg_score1" = "score1", "reg_score2" = "score2" WHERE "reg_score1" IS NULL;
```

- [ ] **Step 4: Apply to the shared dev DB**

Run: `npm run db:migrate -w api`
Expected: migration applies cleanly (green tests do NOT migrate the shared dev DB — this step is required).

- [ ] **Step 5: Verify the suite still builds against the new schema**

Run: `npm run test -- mapping`
Expected: PASS (Testcontainers re-runs all migrations including 0014).

- [ ] **Step 6: Commit**

```bash
git add api/src/db/schema.js api/migrations/
git commit -m "feat(coins): add fixture.regScore columns + backfill migration"
```

### Task 0.3: Grade bets on regulation time (`regulationResult` + `resolveBet` rewrite)

**Files:**
- Modify: `api/src/coins/settle.js:15-40`
- Test: `api/test/coins-settle.test.js`

- [ ] **Step 1: Write the failing tests** — in `api/test/coins-settle.test.js`, (a) update the `fx` factory (line ~53) to include regulation fields, (b) repoint the existing `1x2`/`ou25`/`cs` cases to `regScore*`, and (c) add knockout + a `regulationResult` case. Replace the `fx` definition and the three resolveBet tests with:

```js
import { resolveBet, regulationResult } from '../src/coins/settle.js'

const fx = (over = {}) => ({ t1Code: 'arg', t2Code: 'bra', winnerCode: null, score1: null, score2: null,
  regScore1: null, regScore2: null, htScore1: null, htScore2: null, events: [], ...over })

test('regulationResult reads the 90-minute score, ignoring winnerCode', () => {
  // 1-1 at 90', won on penalties (winnerCode=arg) → the Match Winner market is a DRAW
  expect(regulationResult({ regScore1: 1, regScore2: 1, winnerCode: 'arg', t1Code: 'arg', t2Code: 'bra' })).toBe('DRAW')
  expect(regulationResult({ regScore1: 2, regScore2: 0 })).toBe('HOME')
  expect(regulationResult({ regScore1: 0, regScore2: 1 })).toBe('AWAY')
  expect(regulationResult({ regScore1: null, regScore2: null })).toBeNull()
})

test('resolveBet 1x2 from the regulation result', () => {
  expect(resolveBet('1x2', 'HOME', null, fx({ regScore1: 2, regScore2: 0 }))).toBe('won')
  expect(resolveBet('1x2', 'DRAW', null, fx({ regScore1: 1, regScore2: 1 }))).toBe('won')
  // knockout: 1-1 at 90', won on pens → DRAW wins, HOME loses (ET-inclusive score1/score2 ignored)
  expect(resolveBet('1x2', 'DRAW', null, fx({ regScore1: 1, regScore2: 1, score1: 2, score2: 1, winnerCode: 'arg' }))).toBe('won')
  expect(resolveBet('1x2', 'HOME', null, fx({ regScore1: 1, regScore2: 1, score1: 2, score2: 1, winnerCode: 'arg' }))).toBe('lost')
})

test('resolveBet ou25 from regulation goals (not extra time)', () => {
  expect(resolveBet('ou25', 'OVER', 2.5, fx({ regScore1: 2, regScore2: 1 }))).toBe('won')
  // 1-1 at 90' (UNDER) that becomes 3-2 in ET still settles on the 90' total
  expect(resolveBet('ou25', 'UNDER', 2.5, fx({ regScore1: 1, regScore2: 1, score1: 3, score2: 2 }))).toBe('won')
})

test('resolveBet cs from the regulation score', () => {
  expect(resolveBet('cs', '2:1', null, fx({ regScore1: 2, regScore2: 1 }))).toBe('won')
  expect(resolveBet('cs', '2:1', null, fx({ regScore1: 1, regScore2: 1 }))).toBe('lost')
})

test('resolveBet cards counts only regulation (minute <= 90) cards', () => {
  const events = [{ type: 'card', minute: 30 }, { type: 'card', minute: 80 }, { type: 'card', minute: 90 },
    { type: 'card', minute: 105 }, { type: 'card', minute: 118 }] // 3 in regulation, 2 in ET
  expect(resolveBet('cards', 'OVER', 3.5, fx({ events }))).toBe('lost') // 3 cards, not > 3.5
  expect(resolveBet('cards', 'UNDER', 3.5, fx({ events }))).toBe('won')
})
```

Also DELETE the now-superseded `resolveBet 1x2 from final result`, `resolveBet ou25 from total goals`, `resolveBet cs exact final score`, and the original `import { resolveBet }` line (line ~51) and `fx` (line ~53) so there's exactly one of each. Leave `resolveBet cards from card-event count vs line` and `resolveBet fh1x2 …` intact (their card events have no minute → `minute ?? 0 = 0 <= 90`, so they still pass).

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- coins-settle`
Expected: FAIL — `regulationResult` is not exported / 1x2 still reads winnerCode.

- [ ] **Step 3: Implement** — in `api/src/coins/settle.js`, add `regulationResult` after `fixtureResult` and rewrite `resolveBet`:

```js
/** Regulation-time (90') winning side from the stored 90-minute score. Used for bet
 *  settlement so a knockout decided in ET/penalties still grades on its 90' result. */
export function regulationResult(f) {
  if (f.regScore1 == null || f.regScore2 == null) return null
  return f.regScore1 > f.regScore2 ? 'HOME' : f.regScore1 < f.regScore2 ? 'AWAY' : 'DRAW'
}

/** Resolve one bet → 'won' | 'lost' | null (null = data not available yet, leave open). */
export function resolveBet(market, selection, line, f) {
  if (market === '1x2') { const r = regulationResult(f); return r == null ? null : r === selection ? 'won' : 'lost' }
  if (market === 'fh1x2') { const r = htResult(f); return r == null ? null : r === selection ? 'won' : 'lost' }
  if (market === 'ou25' || market === 'cards') {
    if (line == null) return null
    let measure
    if (market === 'ou25') { if (f.regScore1 == null || f.regScore2 == null) return null; measure = f.regScore1 + f.regScore2 }
    else { if (!Array.isArray(f.events)) return null; measure = f.events.filter((e) => e.type === 'card' && (e.minute ?? 0) <= 90).length }
    const over = measure > line
    return (selection === 'OVER' ? over : !over) ? 'won' : 'lost'
  }
  if (market === 'cs') { if (f.regScore1 == null || f.regScore2 == null) return null; return `${f.regScore1}:${f.regScore2}` === selection ? 'won' : 'lost' }
  return null
}
```

(Leave `fixtureResult` and `htResult` exactly as they are.)

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- coins-settle`
Expected: PASS.

- [ ] **Step 5: Update the `settleBets`/`settleStaleBets` DB tests to set regScore** — in the same file, the `settleBets pays winners…` and `settleStaleBets grades…` tests set `winnerCode` but not `regScore`. After my change, a 1x2 bet grades on regScore. Update both `db.update(fixture).set(...)` calls that mark the fixture final to also set the regulation score, e.g.:

```js
  await db.update(fixture).set({ status: 'final', winnerCode: f.t1Code, regScore1: 2, regScore2: 0 }).where(eq(fixture.id, f.id))
```

(Apply to both the `settleBets pays winners` test and the `settleStaleBets grades` test — both place a HOME bet expecting a win, so `regScore1: 2, regScore2: 0` makes HOME win.)

- [ ] **Step 6: Run to verify the DB settle tests pass**

Run: `npm run test -- coins-settle`
Expected: PASS (all).

- [ ] **Step 7: Commit**

```bash
git add api/src/coins/settle.js api/test/coins-settle.test.js
git commit -m "feat(coins): settle bets on regulation-time (90') score"
```

### Task 0.4: Persist `regScore` when polling live + baseline

**Files:**
- Modify: `api/src/worker/live-poller.js:88-92` (pollLive change-guard + `.set`)
- Modify: `api/src/worker/baseline-sync.js:57-76` (insert + update)
- Test: `api/test/live-poller.test.js` (add a focused case; create the file if it doesn't exist)

- [ ] **Step 1: Write the failing test** — add to `api/test/live-poller.test.js` (mirror the existing helper style: an `openTestDb()` handle and a stub provider). If the file already has a suite, append the test; otherwise create it:

```js
import { expect, test, afterAll, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { fixture } from '../src/db/schema.js'
import { pollLive } from '../src/worker/live-poller.js'

const { pool, db } = openTestDb()
afterAll(async () => { await pool.end() })

test('pollLive persists the 90-minute regulation score on a knockout final', async () => {
  const [f] = await db.select().from(fixture).limit(1)
  await db.update(fixture).set({ status: 'live', score1: 1, score2: 1, regScore1: null, regScore2: null }).where(eq(fixture.id, f.id))
  // stub provider: a knockout match decided in ET — final score 2:1, but 90' was 1:1
  const provider = { fetchFixturesByIds: async () => [{ id: f.id, status: 'final', score1: 2, score2: 1, minute: 120, htScore1: 0, htScore2: 1, regScore1: 1, regScore2: 1 }] }
  await pollLive(db, provider, [f.id])
  const [after] = await db.select().from(fixture).where(eq(fixture.id, f.id))
  expect([after.regScore1, after.regScore2]).toEqual([1, 1])
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- live-poller`
Expected: FAIL — stored `regScore1/regScore2` still null (pollLive doesn't write them).

- [ ] **Step 3: Implement** — in `api/src/worker/live-poller.js` `pollLive`, add `regScore` to BOTH the change-guard and the `.set()`:

Change the guard (line ~88) to also compare regScore:
```js
      if (cur.status === f.status && cur.score1 === f.score1 && cur.score2 === f.score2 && cur.minute === f.minute
        && (cur.htScore1 ?? null) === (f.htScore1 ?? null) && (cur.htScore2 ?? null) === (f.htScore2 ?? null)
        && (cur.regScore1 ?? null) === (f.regScore1 ?? null) && (cur.regScore2 ?? null) === (f.regScore2 ?? null)) continue
```
Change the `.set()` (line ~91) to write regScore:
```js
        .set({ status: f.status, score1: f.score1, score2: f.score2, minute: f.minute, htScore1: f.htScore1, htScore2: f.htScore2,
          regScore1: f.regScore1 ?? null, regScore2: f.regScore2 ?? null, updatedAt: new Date() })
```

- [ ] **Step 4: Persist in baseline too** — in `api/src/worker/baseline-sync.js`, add `regScore1: f.regScore1 ?? null, regScore2: f.regScore2 ?? null,` next to `score1: f.score1, score2: f.score2,` in BOTH the `.values({…})` (line ~60) and the `onConflictDoUpdate` `set: {…}` (line ~69).

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test -- live-poller`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/worker/live-poller.js api/src/worker/baseline-sync.js api/test/live-poller.test.js
git commit -m "feat(coins): persist regulation score on live + baseline sync"
```

### Task 0.5: Lift the group-stage-only gate on single bets

**Files:**
- Modify: `api/src/routes/coins.js:55-57` (remove the stage check)
- Test: `api/test/coins.test.js:112-122` (rewrite the knockout test)

- [ ] **Step 1: Rewrite the failing test** — in `api/test/coins.test.js`, replace the test titled `POST /api/bet rejects all selections on knockout fixtures (group-stage only) and an unpriced fixture` with:

```js
test('POST /api/bet now accepts knockout fixtures (full tournament) and still rejects an unpriced fixture', async () => {
  const p = await aPerson(); const f = await bettableFixture()
  await balanceOfPerson(p.id) // seed grant
  await db.update(fixture).set({ stage: 'r16' }).where(eq(fixture.id, f.id))
  const ok = await app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: f.id, personId: p.id, selection: 'HOME', stake: 10 } })
  expect(ok.statusCode).toBe(200)
  expect(ok.json().bet).toMatchObject({ market: '1x2', selection: 'HOME' })
  await db.update(fixture).set({ stage: 'group', markets: null }).where(eq(fixture.id, f.id))
  expect((await app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: f.id, personId: p.id, selection: 'HOME', stake: 10 } })).json()).toEqual({ error: 'no_odds' })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- coins.test`
Expected: FAIL — the knockout POST returns `400 { error: 'not_group_stage' }`.

- [ ] **Step 3: Implement** — in `api/src/routes/coins.js`, delete the stage guard (the comment + the `if (f.stage !== 'group')` line, ~55-57):

```js
    if (f.status !== 'upcoming') return reply.code(400).send({ error: 'betting_closed' })
    const mk = f.markets?.[market]
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- coins.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/coins.js api/test/coins.test.js
git commit -m "feat(coins): allow single bets on knockout fixtures (full tournament)"
```

---

## Slice 1 — Parlay storage + serialize + wallet read

### Task 1.1: Add the `parlay` table + `bet.parlayId` + migration

**Files:**
- Modify: `api/src/db/schema.js` (new `parlay` table after `coinLedger` ~line 144; `parlayId` on `bet`)
- Create: `api/migrations/0015_*.sql` (generated)

- [ ] **Step 1: Add the `parlay` table** — in `api/src/db/schema.js`, after the `coinLedger` table definition and before `bet`, add:

```js
export const parlay = pgTable('parlay', {
  id: text('id').primaryKey(),
  sweepId: text('sweep_id').notNull(),
  personId: text('person_id').notNull(),
  stake: integer('stake').notNull(),
  combinedOdds: numeric('combined_odds').notNull(),
  potentialPayout: integer('potential_payout').notNull(),
  status: text('status').notNull().default('open'), // 'open' | 'won' | 'lost' | 'refunded'
  placedAt: timestamp('placed_at', { withTimezone: true }).notNull().defaultNow(),
  settledAt: timestamp('settled_at', { withTimezone: true }),
}, (t) => ({
  sweepIdx: index('parlay_sweep_id_idx').on(t.sweepId),
  personSweepFk: foreignKey({ columns: [t.personId, t.sweepId], foreignColumns: [person.id, person.sweepId], name: 'parlay_person_sweep_fk' }),
}))
```

- [ ] **Step 2: Add `parlayId` to `bet`** — in the `bet` table, add the column after `settledAt`:

```js
  parlayId: text('parlay_id').references(() => parlay.id, { onDelete: 'cascade' }),
```

and add to the `bet` index block `(t) => ({ … })`:

```js
  parlayIdx: index('bet_parlay_id_idx').on(t.parlayId),
```

- [ ] **Step 3: Generate + backfill-free migration**

Run: `npm run db:generate -w api`
Expected: `api/migrations/0015_*.sql` creating `parlay`, adding `bet.parlay_id` + FK + indexes. (No data backfill needed — existing bets get NULL `parlay_id`.)

- [ ] **Step 4: Apply to the shared dev DB**

Run: `npm run db:migrate -w api`
Expected: applies cleanly.

- [ ] **Step 5: Verify the suite still builds**

Run: `npm run test -- coins.test`
Expected: PASS (Testcontainers re-runs migrations through 0015).

- [ ] **Step 6: Commit**

```bash
git add api/src/db/schema.js api/migrations/
git commit -m "feat(coins): add parlay table + bet.parlayId"
```

### Task 1.2: `serializeParlay`

**Files:**
- Modify: `api/src/coins/ledger.js` (add `serializeParlay` after `serializeBet`)
- Test: `api/test/serialize-parlay.test.js` (new)

- [ ] **Step 1: Write the failing test** — create `api/test/serialize-parlay.test.js`:

```js
import { expect, test } from 'vitest'
import { serializeParlay } from '../src/coins/ledger.js'

test('serializeParlay nests serialized legs and exposes parent money fields', () => {
  const p = { id: 'par_1', stake: 100, combinedOdds: '7.6', potentialPayout: 760, status: 'open', placedAt: 'T', settledAt: null }
  const legs = [
    { id: 'b1', fixtureId: 'f1', market: '1x2', selection: 'HOME', line: null, stake: 0, oddsDecimal: '2', book: 'Pinnacle', potentialPayout: 0, status: 'open', placedAt: 'T', settledAt: null },
    { id: 'b2', fixtureId: 'f2', market: 'ou25', selection: 'OVER', line: '2.5', stake: 0, oddsDecimal: '1.9', book: 'Pinnacle', potentialPayout: 0, status: 'won', placedAt: 'T', settledAt: 'T' },
  ]
  const out = serializeParlay(p, legs)
  expect(out).toMatchObject({ id: 'par_1', stake: 100, combinedOdds: 7.6, potentialPayout: 760, status: 'open' })
  expect(out.legs).toHaveLength(2)
  expect(out.legs[0]).toMatchObject({ fixtureId: 'f1', market: '1x2', selection: 'HOME', odds: 2 })
  expect(out.legs[1]).toMatchObject({ fixtureId: 'f2', market: 'ou25', selection: 'OVER', odds: 1.9, line: 2.5, status: 'won' })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- serialize-parlay`
Expected: FAIL — `serializeParlay is not a function`.

- [ ] **Step 3: Implement** — in `api/src/coins/ledger.js`, add after `serializeBet`:

```js
export function serializeParlay(p, legs) {
  return { id: p.id, stake: p.stake, combinedOdds: Number(p.combinedOdds), potentialPayout: p.potentialPayout,
    status: p.status, placedAt: p.placedAt, settledAt: p.settledAt, legs: legs.map(serializeBet) }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- serialize-parlay`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/coins/ledger.js api/test/serialize-parlay.test.js
git commit -m "feat(coins): serializeParlay (parent + nested legs)"
```

### Task 1.3: `walletFor` returns `parlays` and excludes legs from `bets`

**Files:**
- Modify: `api/src/coins/ledger.js` (`walletFor` + new `parlaysFor`; imports)
- Modify: `api/src/routes/coins.js:23` (default wallet object gains `parlays`)
- Test: `api/test/coins.test.js`

- [ ] **Step 1: Write the failing test** — in `api/test/coins.test.js`: (a) add `parlay` to the schema import on line 4; (b) change `beforeEach` to also clear `parlay` (delete bet first, then parlay, then coinLedger); (c) append:

```js
test('GET /api/coins returns parlays and excludes parlay legs from single bets', async () => {
  const p = await aPerson(); const f = await bettableFixture()
  await balanceOfPerson(p.id)
  await app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: f.id, personId: p.id, selection: 'HOME', stake: 10 } })
  await db.insert(parlay).values({ id: 'par_test', sweepId: 'default', personId: p.id, stake: 20, combinedOdds: '3.8', potentialPayout: 76, status: 'open' })
  await db.insert(bet).values({ id: 'leg_test', sweepId: 'default', personId: p.id, fixtureId: f.id, parlayId: 'par_test',
    selection: 'AWAY', market: '1x2', stake: 0, oddsDecimal: '4', potentialPayout: 0, status: 'open' })
  const body = (await app.inject({ method: 'GET', url: `/api/coins?personId=${p.id}` })).json()
  expect(body.bets.open).toHaveLength(1)            // single bet only — the leg is excluded
  expect(body.bets.open[0].selection).toBe('HOME')
  expect(body.parlays.open).toHaveLength(1)
  expect(body.parlays.open[0]).toMatchObject({ id: 'par_test', stake: 20, status: 'open' })
  expect(body.parlays.open[0].legs[0]).toMatchObject({ selection: 'AWAY', odds: 4 })
})
```

The `beforeEach` becomes:
```js
beforeEach(async () => { await db.delete(bet); await db.delete(parlay); await db.delete(coinLedger); published.length = 0 })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- coins.test`
Expected: FAIL — `body.parlays` is undefined / the leg appears as a single bet.

- [ ] **Step 3: Implement walletFor** — in `api/src/coins/ledger.js`: add `isNull` to the `drizzle-orm` import and `parlay` to the schema import; import `serializeParlay` is local (same file). Replace `walletFor` and add `parlaysFor`:

```js
export async function walletFor(db, sweepId, personId, now = new Date()) {
  await ensureGrants(db, sweepId, personId, now)
  const balance = await balanceOf(db, sweepId, personId)
  const rows = await db.select().from(bet).where(and(eq(bet.sweepId, sweepId), eq(bet.personId, personId), isNull(bet.parlayId)))
  const open = [], settled = []
  for (const b of rows) (b.status === 'open' ? open : settled).push(serializeBet(b))
  const parlays = await parlaysFor(db, sweepId, personId)
  return { balance, weeklyGrant: WEEKLY_COINS, bets: { open, settled }, parlays }
}

async function parlaysFor(db, sweepId, personId) {
  const rows = await db.select().from(parlay).where(and(eq(parlay.sweepId, sweepId), eq(parlay.personId, personId)))
  const open = [], settled = []
  for (const pl of rows) {
    const legs = await db.select().from(bet).where(eq(bet.parlayId, pl.id))
    ;(pl.status === 'open' ? open : settled).push(serializeParlay(pl, legs))
  }
  return { open, settled }
}
```

The schema import line becomes:
```js
import { fixture, person, coinLedger, bet, parlay } from '../db/schema.js'
```
and the drizzle import:
```js
import { and, eq, sql, isNull } from 'drizzle-orm'
```

- [ ] **Step 4: Default wallet gains parlays** — in `api/src/routes/coins.js`, change the default wallet (line ~23) to:

```js
    let wallet = { balance: 0, weeklyGrant: 1000, bets: { open: [], settled: [] }, parlays: { open: [], settled: [] } }
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test -- coins.test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/coins/ledger.js api/src/routes/coins.js api/test/coins.test.js
git commit -m "feat(coins): walletFor returns parlays; legs excluded from single bets"
```

---

## Slice 2 — `POST /api/parlay`

### Task 2.1: Place a 2-leg parlay (happy path)

**Files:**
- Modify: `api/src/routes/coins.js` (new route + body schema + imports)
- Test: `api/test/coins.test.js`

- [ ] **Step 1: Write the failing test** — in `api/test/coins.test.js`, add a helper that makes the first two fixtures bettable, then the happy-path test:

```js
async function twoBettableFixtures() {
  const fs = await db.select().from(fixture).limit(2)
  const markets = {
    '1x2': { label: 'Match Winner', book: 'Pinnacle', selections: [
      { key: 'HOME', label: 'Home', odds: 2 }, { key: 'DRAW', label: 'Draw', odds: 3.5 }, { key: 'AWAY', label: 'Away', odds: 4 }] },
    ou25: { label: 'Over/Under 2.5', line: 2.5, book: 'Pinnacle', selections: [
      { key: 'OVER', label: 'Over 2.5', odds: 1.9 }, { key: 'UNDER', label: 'Under 2.5', odds: 1.9 }] },
  }
  const out = []
  for (const f of fs) {
    await db.update(fixture).set({ status: 'upcoming', stage: 'group', markets }).where(eq(fixture.id, f.id))
    out.push((await db.select().from(fixture).where(eq(fixture.id, f.id)))[0])
  }
  return out
}

test('POST /api/parlay places a 2-leg parlay: combined odds × stake, two legs, one debit', async () => {
  const p = await aPerson(); const [f1, f2] = await twoBettableFixtures()
  const before = await balanceOfPerson(p.id)
  const res = await app.inject({ method: 'POST', url: '/api/parlay', payload: { personId: p.id, stake: 100, legs: [
    { fixtureId: f1.id, market: '1x2', selection: 'HOME' },   // 2.0
    { fixtureId: f2.id, market: 'ou25', selection: 'OVER' },  // 1.9
  ] } })
  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.balance).toBe(before - 100)
  expect(body.parlay.combinedOdds).toBeCloseTo(3.8, 5)
  expect(body.parlay.potentialPayout).toBe(380)
  expect(body.parlay.status).toBe('open')
  expect(body.parlay.legs).toHaveLength(2)
  expect(published.some((e) => e.type === 'bet' && e.parlay === true && e.legCount === 2)).toBe(true)
  const wallet = (await app.inject({ method: 'GET', url: `/api/coins?personId=${p.id}` })).json()
  expect(wallet.parlays.open).toHaveLength(1)
  expect(wallet.bets.open).toHaveLength(0)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- coins.test`
Expected: FAIL — 404/no route for `POST /api/parlay`.

- [ ] **Step 3: Implement** — in `api/src/routes/coins.js`: extend the imports, add a body schema, and register the route. Imports:

```js
import { fixture, person, coinLedger, bet, parlay } from '../db/schema.js'
import { walletFor, leaderboard, ensureGrants, serializeBet, statementFor, serializeParlay } from '../coins/ledger.js'
```

Add the body schema next to `betBody`:
```js
const parlayBody = {
  type: 'object', required: ['personId', 'stake', 'legs'], additionalProperties: false,
  properties: {
    personId: { type: 'string' }, stake: { type: 'integer', minimum: 1 },
    legs: { type: 'array', minItems: 1, items: {
      type: 'object', required: ['fixtureId', 'selection'], additionalProperties: false,
      properties: { fixtureId: { type: 'string' }, market: { type: 'string', enum: MARKETS }, selection: { type: 'string' } } } },
  },
}
```

Register the route inside `coinsRoutes(app)` (after `POST /api/bet`):
```js
  app.post('/api/parlay', { preHandler: member, schema: { body: parlayBody } }, async (req, reply) => {
    const sweepId = req.sweep.id
    const { personId, stake, legs } = req.body
    const [p] = await app.db.select().from(person).where(and(eq(person.id, personId), eq(person.sweepId, sweepId)))
    if (!p) return reply.code(400).send({ error: 'unknown_person' })
    if (p.adult === false) return reply.code(403).send({ error: 'minor_not_allowed' })
    if (legs.length < 2) return reply.code(400).send({ error: 'too_few_legs' })
    const seen = new Set()
    for (const l of legs) {
      if (seen.has(l.fixtureId)) return reply.code(400).send({ error: 'duplicate_fixture', fixtureId: l.fixtureId })
      seen.add(l.fixtureId)
    }
    const resolved = []
    for (const l of legs) {
      const market = l.market ?? '1x2'
      const [f] = await app.db.select().from(fixture).where(eq(fixture.id, l.fixtureId))
      if (!f) return reply.code(400).send({ error: 'fixture_not_found', fixtureId: l.fixtureId })
      if (f.status !== 'upcoming') return reply.code(400).send({ error: 'leg_betting_closed', fixtureId: l.fixtureId })
      const mk = f.markets?.[market]
      const sel = mk?.selections?.find((s) => s.key === l.selection)
      const odds = sel ? Number(sel.odds) : NaN
      if (!sel || !Number.isFinite(odds) || odds <= 1) return reply.code(400).send({ error: 'leg_no_odds', fixtureId: l.fixtureId, market, selection: l.selection })
      resolved.push({ fixtureId: l.fixtureId, market, selection: l.selection, odds, line: mk.line ?? null, book: mk.book ?? null })
    }

    await ensureGrants(app.db, sweepId, personId)
    const combinedOdds = resolved.reduce((acc, r) => acc * r.odds, 1)
    const potentialPayout = Math.round(stake * combinedOdds)
    const parlayId = `par_${randomUUID()}`
    const result = await app.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sweepId}), hashtext(${personId}))`)
      const [b] = await tx.select({ total: sql`coalesce(sum(${coinLedger.amount}), 0)` })
        .from(coinLedger).where(and(eq(coinLedger.sweepId, sweepId), eq(coinLedger.personId, personId)))
      const balance = Number(b.total)
      if (stake > balance) return { error: 'insufficient_funds' }
      await tx.insert(coinLedger).values({ sweepId, personId, type: 'stake', amount: -stake, refId: parlayId })
      await tx.insert(parlay).values({ id: parlayId, sweepId, personId, stake, combinedOdds: String(combinedOdds), potentialPayout, status: 'open' })
      for (const r of resolved) {
        await tx.insert(bet).values({ id: randomUUID(), sweepId, personId, fixtureId: r.fixtureId, parlayId,
          market: r.market, selection: r.selection, line: r.line == null ? null : String(r.line),
          stake: 0, oddsDecimal: String(r.odds), book: r.book, potentialPayout: 0, status: 'open' })
      }
      return { balance: balance - stake }
    })
    if (result.error) return reply.code(400).send({ error: result.error })

    const [prow] = await app.db.select().from(parlay).where(eq(parlay.id, parlayId))
    const legRows = await app.db.select().from(bet).where(eq(bet.parlayId, parlayId))
    await app.publish({ type: 'bet', sweepId, personId, parlay: true, legCount: legRows.length })
    return { parlay: serializeParlay(prow, legRows), balance: result.balance }
  })
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- coins.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/coins.js api/test/coins.test.js
git commit -m "feat(coins): POST /api/parlay places an accumulator"
```

### Task 2.2: Parlay placement validation

**Files:**
- Test: `api/test/coins.test.js` (the route already enforces these — this task adds coverage)

- [ ] **Step 1: Write the test** — append:

```js
test('POST /api/parlay validation: too few legs, duplicate fixture, leg errors, minor, funds', async () => {
  const p = await aPerson(); const [f1, f2] = await twoBettableFixtures()
  await balanceOfPerson(p.id)
  const post = (payload) => app.inject({ method: 'POST', url: '/api/parlay', payload })
  expect((await post({ personId: p.id, stake: 10, legs: [{ fixtureId: f1.id, selection: 'HOME' }] })).json()).toEqual({ error: 'too_few_legs' })
  expect((await post({ personId: p.id, stake: 10, legs: [{ fixtureId: f1.id, selection: 'HOME' }, { fixtureId: f1.id, market: 'ou25', selection: 'OVER' }] })).json()).toMatchObject({ error: 'duplicate_fixture' })
  expect((await post({ personId: p.id, stake: 10, legs: [{ fixtureId: f1.id, selection: 'HOME' }, { fixtureId: 'nope', selection: 'HOME' }] })).json()).toMatchObject({ error: 'fixture_not_found' })
  await db.update(fixture).set({ status: 'live' }).where(eq(fixture.id, f2.id))
  expect((await post({ personId: p.id, stake: 10, legs: [{ fixtureId: f1.id, selection: 'HOME' }, { fixtureId: f2.id, selection: 'HOME' }] })).json()).toMatchObject({ error: 'leg_betting_closed' })
  await db.update(fixture).set({ status: 'upcoming' }).where(eq(fixture.id, f2.id))
  expect((await post({ personId: p.id, stake: 10, legs: [{ fixtureId: f1.id, selection: 'HOME' }, { fixtureId: f2.id, market: 'cards', selection: 'OVER' }] })).json()).toMatchObject({ error: 'leg_no_odds' })
  expect((await post({ personId: p.id, stake: 99999999, legs: [{ fixtureId: f1.id, selection: 'HOME' }, { fixtureId: f2.id, selection: 'AWAY' }] })).json()).toEqual({ error: 'insufficient_funds' })
  await db.update(person).set({ adult: false }).where(eq(person.id, p.id))
  expect((await post({ personId: p.id, stake: 10, legs: [{ fixtureId: f1.id, selection: 'HOME' }, { fixtureId: f2.id, selection: 'AWAY' }] })).statusCode).toBe(403)
  await db.update(person).set({ adult: true }).where(eq(person.id, p.id))
})
```

- [ ] **Step 2: Run to verify it passes** (the route already implements these)

Run: `npm run test -- coins.test`
Expected: PASS. If any case fails, fix the route's validation order to match the contract before moving on.

- [ ] **Step 3: Commit**

```bash
git add api/test/coins.test.js
git commit -m "test(coins): parlay placement validation coverage"
```

---

## Slice 3 — Settlement rollup

### Task 3.1: `settleParlay` + `settleBets` leg branch

**Files:**
- Modify: `api/src/coins/settle.js` (imports; `settleBets` leg branch; new `settleParlay`)
- Test: `api/test/parlay-settle.test.js` (new)

- [ ] **Step 1: Write the failing tests** — create `api/test/parlay-settle.test.js`:

```js
import { expect, test, afterAll, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { fixture, person, coinLedger, bet, parlay } from '../src/db/schema.js'
import { settleBets, settleParlay } from '../src/coins/settle.js'
import { ensureGrants, balanceOf } from '../src/coins/ledger.js'

const { pool, db } = openTestDb()
afterAll(async () => { await pool.end() })
beforeEach(async () => { await db.delete(bet); await db.delete(parlay); await db.delete(coinLedger) })

const aPerson = async () => (await db.select().from(person).limit(1))[0]

async function makeParlay(p, id, stake, combinedOdds, legs) {
  await db.insert(coinLedger).values({ sweepId: 'default', personId: p.id, type: 'stake', amount: -stake, refId: id })
  await db.insert(parlay).values({ id, sweepId: 'default', personId: p.id, stake, combinedOdds: String(combinedOdds), potentialPayout: Math.round(stake * combinedOdds), status: 'open' })
  for (const [i, l] of legs.entries()) {
    await db.insert(bet).values({ id: `${id}_leg${i}`, sweepId: 'default', personId: p.id, fixtureId: l.fixtureId, parlayId: id,
      market: l.market ?? '1x2', selection: l.selection, line: l.line == null ? null : String(l.line), stake: 0, oddsDecimal: String(l.odds), potentialPayout: 0, status: 'open' })
  }
}

test('a parlay loses the moment any leg loses', async () => {
  const p = await aPerson(); await ensureGrants(db, 'default', p.id)
  const [f1, f2] = await db.select().from(fixture).limit(2)
  const start = await balanceOf(db, 'default', p.id)
  await makeParlay(p, 'par_lose', 100, 4, [{ fixtureId: f1.id, selection: 'HOME', odds: 2 }, { fixtureId: f2.id, selection: 'HOME', odds: 2 }])
  await db.update(fixture).set({ status: 'final', regScore1: 0, regScore2: 1 }).where(eq(fixture.id, f1.id)) // HOME leg loses
  await settleBets(db, f1.id)
  expect((await db.select().from(parlay).where(eq(parlay.id, 'par_lose')))[0].status).toBe('lost')
  expect(await balanceOf(db, 'default', p.id)).toBe(start - 100) // stake gone, no payout
})

test('a parlay stays open until the last leg, then pays when all legs win', async () => {
  const p = await aPerson(); await ensureGrants(db, 'default', p.id)
  const [f1, f2] = await db.select().from(fixture).limit(2)
  const start = await balanceOf(db, 'default', p.id)
  await makeParlay(p, 'par_win', 100, 4, [{ fixtureId: f1.id, selection: 'HOME', odds: 2 }, { fixtureId: f2.id, selection: 'HOME', odds: 2 }])
  await db.update(fixture).set({ status: 'final', regScore1: 1, regScore2: 0 }).where(eq(fixture.id, f1.id))
  await settleBets(db, f1.id)
  expect((await db.select().from(parlay).where(eq(parlay.id, 'par_win')))[0].status).toBe('open') // f2 not done
  await db.update(fixture).set({ status: 'final', regScore1: 2, regScore2: 1 }).where(eq(fixture.id, f2.id))
  const published = []
  await settleBets(db, f2.id, (e) => published.push(e))
  expect((await db.select().from(parlay).where(eq(parlay.id, 'par_win')))[0].status).toBe('won')
  expect(await balanceOf(db, 'default', p.id)).toBe(start - 100 + 400) // payout = stake × combinedOdds
  expect(published).toContainEqual({ type: 'bet-settled', sweepId: 'default' })
})

test('settleParlay is idempotent (no double payout)', async () => {
  const p = await aPerson(); await ensureGrants(db, 'default', p.id)
  const [f1, f2] = await db.select().from(fixture).limit(2)
  const start = await balanceOf(db, 'default', p.id)
  await makeParlay(p, 'par_idem', 50, 4, [{ fixtureId: f1.id, selection: 'HOME', odds: 2 }, { fixtureId: f2.id, selection: 'HOME', odds: 2 }])
  await db.update(fixture).set({ status: 'final', regScore1: 1, regScore2: 0 }).where(eq(fixture.id, f1.id))
  await db.update(fixture).set({ status: 'final', regScore1: 1, regScore2: 0 }).where(eq(fixture.id, f2.id))
  await settleBets(db, f1.id); await settleBets(db, f2.id)
  const bal = await balanceOf(db, 'default', p.id)
  await settleParlay(db, 'par_idem'); await settleBets(db, f2.id) // re-run
  expect(await balanceOf(db, 'default', p.id)).toBe(bal)
  expect(bal).toBe(start - 50 + 200)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- parlay-settle`
Expected: FAIL — `settleParlay is not a function` / parlay status stays `open`.

- [ ] **Step 3: Implement** — in `api/src/coins/settle.js`: add `parlay` to the schema import, add a leg branch to `settleBets`, and add `settleParlay`. Replace `settleBets` with:

```js
export async function settleBets(db, fixtureId, publish = () => {}) {
  const [f] = await db.select().from(fixture).where(eq(fixture.id, fixtureId))
  if (!f || f.status !== 'final') return 0
  const open = await db.select().from(bet).where(and(eq(bet.fixtureId, fixtureId), eq(bet.status, 'open')))
  const sweeps = new Set()
  const parlayIds = new Set()
  for (const b of open) {
    const outcome = resolveBet(b.market, b.selection, b.line == null ? null : Number(b.line), f)
    if (outcome == null) continue // data not available yet → leave open
    const won = outcome === 'won'
    if (b.parlayId) {
      // parlay leg: grade it, but the parent owns the money — never pay here
      const claimed = await db.update(bet).set({ status: won ? 'won' : 'lost', settledAt: new Date() })
        .where(and(eq(bet.id, b.id), eq(bet.status, 'open'))).returning({ id: bet.id })
      if (claimed.length) parlayIds.add(b.parlayId)
      continue
    }
    const settled = await db.transaction(async (tx) => {
      const claimed = await tx.update(bet).set({ status: won ? 'won' : 'lost', settledAt: new Date() })
        .where(and(eq(bet.id, b.id), eq(bet.status, 'open'))).returning({ id: bet.id })
      if (claimed.length === 0) return false
      if (won) await tx.insert(coinLedger).values({ sweepId: b.sweepId, personId: b.personId, type: 'payout', amount: b.potentialPayout, refId: b.id })
      return true
    })
    if (settled) sweeps.add(b.sweepId)
  }
  for (const pid of parlayIds) { const sw = await settleParlay(db, pid); if (sw) sweeps.add(sw) }
  for (const sweepId of sweeps) await publish({ type: 'bet-settled', sweepId })
  return open.length
}

/**
 * Roll up one parlay: lost if ANY leg lost; won (and pay stake×combinedOdds) once ALL legs
 * won; otherwise leave open (a later fixture retriggers). The guarded UPDATE transitions
 * exactly once, and the payout ledger row is idempotent. Returns the sweepId on a real
 * transition (so the caller publishes once per sweep), else null.
 */
export async function settleParlay(db, parlayId) {
  const [pl] = await db.select().from(parlay).where(eq(parlay.id, parlayId))
  if (!pl || pl.status !== 'open') return null
  const legs = await db.select().from(bet).where(eq(bet.parlayId, parlayId))
  const anyLost = legs.some((l) => l.status === 'lost')
  const allWon = legs.length > 0 && legs.every((l) => l.status === 'won')
  if (!anyLost && !allWon) return null
  const status = anyLost ? 'lost' : 'won'
  const claimed = await db.update(parlay).set({ status, settledAt: new Date() })
    .where(and(eq(parlay.id, parlayId), eq(parlay.status, 'open'))).returning({ id: parlay.id })
  if (claimed.length === 0) return null
  if (status === 'won') {
    await db.insert(coinLedger)
      .values({ sweepId: pl.sweepId, personId: pl.personId, type: 'payout', amount: pl.potentialPayout, refId: pl.id })
      .onConflictDoNothing()
  }
  return pl.sweepId
}
```

The schema import becomes:
```js
import { fixture, coinLedger, bet, parlay } from '../db/schema.js'
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- parlay-settle`
Expected: PASS.

- [ ] **Step 5: Run the existing settle suite (no regressions)**

Run: `npm run test -- coins-settle`
Expected: PASS (single-bet settlement + idempotency unchanged).

- [ ] **Step 6: Commit**

```bash
git add api/src/coins/settle.js api/test/parlay-settle.test.js
git commit -m "feat(coins): settleParlay rollup + parlay-leg grading in settleBets"
```

### Task 3.2: `settleStaleBets` sweeps stranded parlays

**Files:**
- Modify: `api/src/coins/settle.js` (`settleStaleBets`)
- Test: `api/test/parlay-settle.test.js`

- [ ] **Step 1: Write the failing test** — append to `api/test/parlay-settle.test.js`:

```js
import { settleStaleBets } from '../src/coins/settle.js'

test('settleStaleBets rolls up a parlay whose legs were graded but the parent stayed open', async () => {
  const p = await aPerson(); await ensureGrants(db, 'default', p.id)
  const [f1, f2] = await db.select().from(fixture).limit(2)
  const start = await balanceOf(db, 'default', p.id)
  await makeParlay(p, 'par_stale', 100, 4, [{ fixtureId: f1.id, selection: 'HOME', odds: 2 }, { fixtureId: f2.id, selection: 'HOME', odds: 2 }])
  await db.update(bet).set({ status: 'won' }).where(eq(bet.parlayId, 'par_stale')) // legs graded, parent missed
  await db.update(fixture).set({ status: 'final', regScore1: 1, regScore2: 0 }).where(eq(fixture.id, f1.id))
  await db.update(fixture).set({ status: 'final', regScore1: 1, regScore2: 0 }).where(eq(fixture.id, f2.id))
  const published = []
  await settleStaleBets(db, (e) => published.push(e))
  expect((await db.select().from(parlay).where(eq(parlay.id, 'par_stale')))[0].status).toBe('won')
  expect(await balanceOf(db, 'default', p.id)).toBe(start - 100 + 400)
  expect(published).toContainEqual({ type: 'bet-settled', sweepId: 'default' })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- parlay-settle`
Expected: FAIL — parlay stays `open` (stale sweep only handled single bets).

- [ ] **Step 3: Implement** — in `api/src/coins/settle.js`, replace `settleStaleBets` with:

```js
export async function settleStaleBets(db, publish = () => {}) {
  const rows = await db.select({ fixtureId: bet.fixtureId })
    .from(bet).innerJoin(fixture, eq(bet.fixtureId, fixture.id))
    .where(and(eq(bet.status, 'open'), eq(fixture.status, 'final')))
  const ids = [...new Set(rows.map((r) => r.fixtureId))]
  for (const id of ids) await settleBets(db, id, publish)
  // roll up any open parlay whose legs are already graded but the parent never settled —
  // settleParlay is a no-op while still pending, so this is safe to run every sweep.
  const openParlays = await db.select({ id: parlay.id }).from(parlay).where(eq(parlay.status, 'open'))
  const sweeps = new Set()
  for (const { id } of openParlays) { const sw = await settleParlay(db, id); if (sw) sweeps.add(sw) }
  for (const sweepId of sweeps) await publish({ type: 'bet-settled', sweepId })
  return ids.length
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- parlay-settle`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/coins/settle.js api/test/parlay-settle.test.js
git commit -m "feat(coins): settleStaleBets sweeps stranded parlays"
```

### Task 3.3: Prune → refund the whole parlay

**Files:**
- Modify: `api/src/worker/baseline-sync.js` (imports; new `refundPrunedParlays`; prune block)
- Test: `api/test/baseline-prune.test.js` (new)

- [ ] **Step 1: Write the failing test** — create `api/test/baseline-prune.test.js`:

```js
import { expect, test, afterAll, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { fixture, person, coinLedger, bet, parlay } from '../src/db/schema.js'
import { refundPrunedParlays } from '../src/worker/baseline-sync.js'
import { ensureGrants, balanceOf } from '../src/coins/ledger.js'

const { pool, db } = openTestDb()
afterAll(async () => { await pool.end() })
beforeEach(async () => { await db.delete(bet); await db.delete(parlay); await db.delete(coinLedger) })

test('refundPrunedParlays refunds + deletes a parlay with a leg on a dropped fixture', async () => {
  const p = (await db.select().from(person).limit(1))[0]
  await ensureGrants(db, 'default', p.id)
  const [f1, f2] = await db.select().from(fixture).limit(2)
  const start = await balanceOf(db, 'default', p.id)
  await db.insert(coinLedger).values({ sweepId: 'default', personId: p.id, type: 'stake', amount: -100, refId: 'par_p' })
  await db.insert(parlay).values({ id: 'par_p', sweepId: 'default', personId: p.id, stake: 100, combinedOdds: '4', potentialPayout: 400, status: 'open' })
  await db.insert(bet).values({ id: 'lg1', sweepId: 'default', personId: p.id, fixtureId: f1.id, parlayId: 'par_p', selection: 'HOME', market: '1x2', stake: 0, oddsDecimal: '2', potentialPayout: 0, status: 'open' })
  await db.insert(bet).values({ id: 'lg2', sweepId: 'default', personId: p.id, fixtureId: f2.id, parlayId: 'par_p', selection: 'HOME', market: '1x2', stake: 0, oddsDecimal: '2', potentialPayout: 0, status: 'open' })
  await refundPrunedParlays(db, [f2.id]) // keep only f2 → f1's leg is dropped → refund whole parlay
  expect(await db.select().from(parlay).where(eq(parlay.id, 'par_p'))).toHaveLength(0) // deleted (cascade legs)
  expect(await db.select().from(bet).where(eq(bet.parlayId, 'par_p'))).toHaveLength(0)
  expect(await balanceOf(db, 'default', p.id)).toBe(start) // stake refunded
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- baseline-prune`
Expected: FAIL — `refundPrunedParlays is not a function`.

- [ ] **Step 3: Implement** — in `api/src/worker/baseline-sync.js`: extend imports and add the helper + wire it into the prune block. Change the top imports (adds `and, isNull, eq` and the `parlay` table):

```js
import { notInArray, inArray, and, isNull, eq } from 'drizzle-orm'
import { fixture, standing, ownership, syncLog, watch, support, bet, coinLedger, parlay } from '../db/schema.js'
```

Add the exported helper (e.g. just above `syncBaseline`):
```js
/**
 * Refund + remove any parlay that has a leg on a fixture NOT in `keep` (the latest provider
 * set). Credits the stake back (idempotent), marks the parlay refunded, then deletes it —
 * ON DELETE CASCADE drops its legs. Matches the spec's "no continue-on-remaining-legs".
 */
export async function refundPrunedParlays(db, keep) {
  const legRows = await db.select({ parlayId: bet.parlayId }).from(bet).where(notInArray(bet.fixtureId, keep))
  const parlayIds = [...new Set(legRows.map((r) => r.parlayId).filter(Boolean))]
  if (!parlayIds.length) return
  const parls = await db.select().from(parlay).where(inArray(parlay.id, parlayIds))
  for (const pl of parls) {
    if (pl.status === 'open') {
      await db.insert(coinLedger)
        .values({ sweepId: pl.sweepId, personId: pl.personId, type: 'refund', amount: pl.stake, refId: pl.id })
        .onConflictDoNothing()
      await db.update(parlay).set({ status: 'refunded', settledAt: new Date() }).where(eq(parlay.id, pl.id))
    }
  }
  await db.delete(parlay).where(inArray(parlay.id, parlayIds)) // cascade-deletes the legs
}
```

Wire it into the prune block — replace the existing bet-prune lines (currently `const prunedBets = …; await db.delete(bet).where(notInArray(bet.fixtureId, keep)); await db.delete(fixture)…`) with:
```js
      await refundPrunedParlays(db, keep)
      // a single bet's stake/payout ledger rows use refId = bet.id; drop them with the bet.
      // Only single bets here (parlayId NULL) — parlay legs were removed via refundPrunedParlays.
      const prunedBets = await db.select({ id: bet.id }).from(bet).where(and(notInArray(bet.fixtureId, keep), isNull(bet.parlayId)))
      if (prunedBets.length) await db.delete(coinLedger).where(inArray(coinLedger.refId, prunedBets.map((b) => b.id)))
      await db.delete(bet).where(and(notInArray(bet.fixtureId, keep), isNull(bet.parlayId)))
      await db.delete(fixture).where(notInArray(fixture.id, keep))
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- baseline-prune`
Expected: PASS.

- [ ] **Step 5: Run the API suite for regressions**

Run: `npm run test`
Expected: PASS (whole api suite — Docker required).

- [ ] **Step 6: Commit**

```bash
git add api/src/worker/baseline-sync.js api/test/baseline-prune.test.js
git commit -m "feat(coins): prune refunds the whole parlay when a leg's fixture drops"
```

---

## Slice 4 — Betslip store + UI

### Task 4.1: The `betslip.js` store

**Files:**
- Create: `web/src/betslip.js`
- Test: `web/src/betslip.test.js` (new)

- [ ] **Step 1: Write the failing tests** — create `web/src/betslip.test.js`:

```js
import { expect, test, beforeEach } from 'vitest'
import { toggleLeg, removeLeg, clearBetslip, hasLeg, betslipLegs, betslipCount, combinedOdds } from './betslip.js'

const leg = (over = {}) => ({ fixtureId: 'f1', market: '1x2', selection: 'HOME', odds: 2, line: null, book: 'Pinnacle', label: 'Home', ...over })

beforeEach(() => clearBetslip())

test('toggleLeg adds, and toggling the same selection removes it', () => {
  toggleLeg(leg())
  expect(betslipCount()).toBe(1)
  expect(hasLeg('f1', '1x2', 'HOME')).toBe(true)
  toggleLeg(leg())
  expect(betslipCount()).toBe(0)
})

test('one leg per fixture — a different market on the same fixture replaces it', () => {
  toggleLeg(leg())
  toggleLeg(leg({ market: 'ou25', selection: 'OVER', odds: 1.9, label: 'Over 2.5' }))
  expect(betslipCount()).toBe(1)
  expect(hasLeg('f1', '1x2', 'HOME')).toBe(false)
  expect(hasLeg('f1', 'ou25', 'OVER')).toBe(true)
})

test('combinedOdds multiplies the legs; removeLeg drops a fixture', () => {
  toggleLeg(leg())                               // 2
  toggleLeg(leg({ fixtureId: 'f2', odds: 1.9 })) // ×1.9
  expect(combinedOdds()).toBeCloseTo(3.8, 5)
  removeLeg('f1')
  expect(betslipCount()).toBe(1)
  expect(betslipLegs()[0].fixtureId).toBe('f2')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w web -- betslip.test`
Expected: FAIL — cannot resolve `./betslip.js`.

- [ ] **Step 3: Implement** — create `web/src/betslip.js`:

```js
import { useState, useEffect } from 'react'

const listeners = new Set()
function notify() { listeners.forEach((fn) => fn()) }

let legs = [] // [{ fixtureId, market, selection, odds, line, book, label }]

export function betslipLegs() { return legs }
export function betslipCount() { return legs.length }
export function combinedOdds() { return legs.reduce((acc, l) => acc * l.odds, 1) }
export function hasLeg(fixtureId, market, selection) {
  return legs.some((l) => l.fixtureId === fixtureId && l.market === market && l.selection === selection)
}
export function removeLeg(fixtureId) { legs = legs.filter((l) => l.fixtureId !== fixtureId); notify() }
export function clearBetslip() { legs = []; notify() }

/** Toggle a selection in the slip. Re-tapping the same selection removes it; picking another
 *  market/selection on a fixture already in the slip REPLACES that fixture's leg (one per fixture). */
export function toggleLeg(leg) {
  if (hasLeg(leg.fixtureId, leg.market, leg.selection)) {
    legs = legs.filter((l) => !(l.fixtureId === leg.fixtureId && l.market === leg.market && l.selection === leg.selection))
  } else {
    legs = [...legs.filter((l) => l.fixtureId !== leg.fixtureId), leg]
  }
  notify()
}

export function useBetslip() {
  const [, force] = useState(0)
  useEffect(() => { const fn = () => force((x) => x + 1); listeners.add(fn); return () => listeners.delete(fn) }, [])
  return { legs }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w web -- betslip.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/betslip.js web/src/betslip.test.js
git commit -m "feat(web): betslip store (accumulating legs, one per fixture)"
```

### Task 4.2: `postParlay` client + `placeParlay` optimistic store

**Files:**
- Modify: `web/src/api/client.js:38` (add `postParlay`)
- Modify: `web/src/coins.js` (imports; default wallet + `setWalletData` gain `parlays`; new `placeParlay`)
- Test: `web/src/coins.test.js`

- [ ] **Step 1: Write the failing tests** — in `web/src/coins.test.js`, add `placeParlay` to the import from `./coins.js`, and append:

```js
test('placeParlay optimistically debits and keeps the debit on success', async () => {
  vi.spyOn(client, 'postParlay').mockResolvedValueOnce({ parlay: { id: 'par1', stake: 100, combinedOdds: 3.8, potentialPayout: 380, status: 'open', legs: [] }, balance: 900 })
  const legs = [{ fixtureId: 'f1', market: '1x2', selection: 'HOME', odds: 2 }, { fixtureId: 'f2', market: 'ou25', selection: 'OVER', odds: 1.9 }]
  await placeParlay(legs, 100)
  expect(myBalance()).toBe(900)
  expect(client.postParlay).toHaveBeenCalledWith({ personId: 'pn_a', stake: 100, legs: [
    { fixtureId: 'f1', market: '1x2', selection: 'HOME' }, { fixtureId: 'f2', market: 'ou25', selection: 'OVER' }] })
})

test('placeParlay rolls back the debit on failure', async () => {
  vi.spyOn(client, 'postParlay').mockRejectedValueOnce(new Error('nope'))
  await placeParlay([{ fixtureId: 'f1', market: '1x2', selection: 'HOME', odds: 2 }, { fixtureId: 'f2', market: '1x2', selection: 'AWAY', odds: 4 }], 100)
  expect(myBalance()).toBe(1000) // rolled back
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w web -- coins.test`
Expected: FAIL — `placeParlay` / `client.postParlay` undefined.

- [ ] **Step 3: Add the client call** — in `web/src/api/client.js`, after the `postBet` line, add:

```js
export const postParlay = ({ personId, stake, legs }) => post('/api/parlay', { personId, stake, legs })
```

- [ ] **Step 4: Implement the store** — in `web/src/coins.js`: import `postParlay`; give the default wallet + `setWalletData` a `parlays` field; add `placeParlay`. Change the import line:

```js
import { postBet, postParlay } from './api/client.js'
```

Change the default wallet (line ~12):
```js
let wallet = { balance: 0, weeklyGrant: 1000, bets: { open: [], settled: [] }, parlays: { open: [], settled: [] } }
```

Change `setWalletData`:
```js
export function setWalletData(server) {
  if (!server) return
  wallet = { balance: server.balance ?? 0, weeklyGrant: server.weeklyGrant ?? 1000,
    bets: server.bets ?? { open: [], settled: [] }, parlays: server.parlays ?? { open: [], settled: [] } }
  board = server.leaderboard ?? []
  notify()
}
```

Add `placeParlay` (after `placeBet`):
```js
let pendingParlaySeq = 0
/** Optimistically debit + add a pending parlay; reconcile/rollback against the server.
 *  Returns { ok } so the betslip sheet only clears on success. */
export async function placeParlay(legs, stake) {
  const me = getMe()
  if (!me) { if (window.__sweepPickMe) window.__sweepPickMe(); return { ok: false } }
  if (!(stake >= 1) || stake > wallet.balance) { toast('Not enough coins'); return { ok: false } }
  const combinedOdds = legs.reduce((acc, l) => acc * l.odds, 1)
  const pendingLegs = legs.map((l, i) => ({ id: `pending_leg_${i}`, fixtureId: l.fixtureId, market: l.market,
    selection: l.selection, line: l.line ?? null, odds: l.odds, stake: 0, potentialPayout: 0, status: 'open' }))
  const pending = { id: `pending_par_${Date.now()}_${pendingParlaySeq++}`, stake, combinedOdds,
    potentialPayout: Math.round(stake * combinedOdds), status: 'open', placedAt: new Date().toISOString(), legs: pendingLegs }
  wallet = { ...wallet, balance: wallet.balance - stake, parlays: { ...wallet.parlays, open: [pending, ...wallet.parlays.open] } }
  notify()
  trackEvent('parlay_placed', { legs: legs.length, stake })
  try {
    const res = await postParlay({ personId: me.id, stake, legs: legs.map((l) => ({ fixtureId: l.fixtureId, market: l.market, selection: l.selection })) })
    wallet = { ...wallet, balance: res.balance, parlays: { ...wallet.parlays, open: wallet.parlays.open.map((p) => p.id === pending.id ? res.parlay : p) } }
    notify()
    return { ok: true }
  } catch (e) {
    wallet = { ...wallet, balance: wallet.balance + stake, parlays: { ...wallet.parlays, open: wallet.parlays.open.filter((p) => p.id !== pending.id) } }
    notify(); toast("Couldn't place multi — try again")
    return { ok: false, error: e }
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test -w web -- coins.test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/api/client.js web/src/coins.js web/src/coins.test.js
git commit -m "feat(web): postParlay client + placeParlay optimistic store"
```

### Task 4.3: `BetslipSheet` + `BetslipPill` components

**Files:**
- Modify: `web/src/screens-coins.jsx` (imports; new `BetslipPill` + `BetslipSheet` exports)
- Test: `web/src/screens-betslip.test.jsx` (new)

- [ ] **Step 1: Write the failing tests** — create `web/src/screens-betslip.test.jsx`:

```jsx
import { expect, test, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BetslipSheet } from './screens-coins.jsx'
import { toggleLeg, clearBetslip } from './betslip.js'
import { setWalletData } from './coins.js'
import { setMe } from './social.js'
import { SWEEP as S } from './data.js'
import * as client from './api/client.js'

beforeEach(() => {
  clearBetslip()
  S.people = [{ id: 'pn_a', name: 'Ann' }]
  S.flag = (c) => `/flags/${c}.png`
  S.team = (c) => ({ code: c, name: c.toUpperCase() })
  S.fixtures = [
    { id: 'f1', t1: 'arg', t2: 'bra', status: 'upcoming', markets: { '1x2': { selections: [{ key: 'HOME', odds: 2 }, { key: 'AWAY', odds: 4 }] } } },
    { id: 'f2', t1: 'fra', t2: 'ger', status: 'upcoming', markets: { '1x2': { selections: [{ key: 'HOME', odds: 1.9 }] } } },
  ]
  S.fixture = (id) => S.fixtures.find((f) => f.id === id)
  setMe('pn_a')
  setWalletData({ balance: 1000, weeklyGrant: 1000, bets: { open: [], settled: [] }, parlays: { open: [], settled: [] }, leaderboard: [] })
})

const homeLeg = (fixtureId, odds) => ({ fixtureId, market: '1x2', selection: 'HOME', odds, line: null, book: null, label: 'Home' })

test('BetslipSheet places a 2-leg parlay via placeParlay', async () => {
  vi.spyOn(client, 'postParlay').mockResolvedValueOnce({ parlay: { id: 'par1', stake: 100, combinedOdds: 3.8, potentialPayout: 380, status: 'open', legs: [] }, balance: 900 })
  toggleLeg(homeLeg('f1', 2)); toggleLeg(homeLeg('f2', 1.9))
  render(<BetslipSheet onClose={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: '1' }))
  fireEvent.click(screen.getByRole('button', { name: '0' }))
  fireEvent.click(screen.getByRole('button', { name: '0' }))
  fireEvent.click(screen.getByRole('button', { name: /place/i }))
  await waitFor(() => expect(client.postParlay).toHaveBeenCalled())
})

test('BetslipSheet shows a closed-event notice and blocks Place when a leg is closed', () => {
  toggleLeg(homeLeg('f1', 2)); toggleLeg(homeLeg('f2', 1.9))
  S.fixtures[1].status = 'live' // f2 kicked off → its leg is no longer bettable
  render(<BetslipSheet onClose={() => {}} />)
  expect(screen.getByText(/no longer available/i)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /place/i })).toBeDisabled()
})

test('removing a leg from the sheet drops it', () => {
  toggleLeg(homeLeg('f1', 2)); toggleLeg(homeLeg('f2', 1.9))
  render(<BetslipSheet onClose={() => {}} />)
  let removes = screen.getAllByRole('button', { name: /remove/i })
  expect(removes).toHaveLength(2)
  fireEvent.click(removes[0])
  expect(screen.getAllByRole('button', { name: /remove/i })).toHaveLength(1)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w web -- screens-betslip`
Expected: FAIL — `BetslipSheet` is not exported.

- [ ] **Step 3: Implement** — in `web/src/screens-coins.jsx`: add the betslip imports and `placeParlay`, then add the two components. Update the import lines at the top:

```js
import { useCoins, myWallet, placeBet, placeParlay } from './coins.js'
import { useBetslip, toggleLeg, hasLeg, removeLeg, clearBetslip, combinedOdds } from './betslip.js'
```

Add these two exported components (e.g. after `BetSheet`):

```jsx
/* Floating pill — leg count + combined odds; opens the betslip sheet. Hidden when empty. */
export function BetslipPill({ onOpen }) {
  const { legs } = useBetslip()
  if (legs.length === 0) return null
  return (
    <button className="betslip-pill" onClick={onOpen}
      aria-label={`Open bet slip, ${legs.length} selection${legs.length > 1 ? 's' : ''}`}>
      <span className="betslip-pill-count">{legs.length}</span>
      <span className="betslip-pill-label">{legs.length === 1 ? 'Bet slip' : 'Multi'} · {combinedOdds().toFixed(2)}</span>
      <Icon.coin />
    </button>
  )
}

/* Unified accumulating betslip. 1 leg → a single bet; 2+ → a parlay. Reuses StakePad +
   quick-add chips + payout preview. Surfaces a closed-event notice (on open and on a blocked
   submit), an "odds updated" note on drift, and a remove control per leg. */
export function BetslipSheet({ onClose }) {
  const { legs } = useBetslip()
  const [stake, setStake] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const { wallet } = useCoins()
  const desktop = useIsDesktop()
  const balance = wallet.balance
  const stakeNum = parseInt(stake, 10)
  // per-leg live state: bettable iff the fixture is still upcoming and the pick still has odds
  const legState = legs.map((l) => {
    const f = S.fixture(l.fixtureId)
    const live = f?.markets?.[l.market]?.selections?.find((s) => s.key === l.selection)
    return { leg: l, f, bettable: !!f && f.status === 'upcoming' && !!live, liveOdds: live ? live.odds : null }
  })
  const closed = legState.filter((s) => !s.bettable)
  const drifted = legState.some((s) => s.bettable && s.liveOdds != null && s.liveOdds !== s.leg.odds)
  const combined = legState.reduce((acc, s) => acc * (s.liveOdds ?? s.leg.odds), 1)
  const payout = stakeNum >= 1 ? Math.round(stakeNum * combined) : 0
  const valid = stakeNum >= 1 && stakeNum <= balance && legs.length >= 1 && closed.length === 0
  const addAmt = (amt) => setStake(String(Math.min(balance, (parseInt(stake, 10) || 0) + amt)))
  const QUICK = [100, 200, 500, 1000]

  async function submit() {
    if (submitting || closed.length > 0 || !valid) return
    setSubmitting(true)
    try {
      const placing = legState.map((s) => ({ ...s.leg, odds: s.liveOdds ?? s.leg.odds }))
      if (placing.length === 1) {
        await placeBet(placing[0].fixtureId, placing[0].market, placing[0].selection, stakeNum)
        clearBetslip(); onClose()
      } else {
        const res = await placeParlay(placing, stakeNum)
        if (res?.ok) { clearBetslip(); onClose() }
      }
    } finally { setSubmitting(false) }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '92%' }}>
        <div className="grab" />
        <div className="sheet-head">
          <h3>{legs.length > 1 ? `Multi · ${legs.length} legs` : 'Bet slip'}</h3>
          <button className="x" onClick={onClose}><Icon.x /></button>
        </div>
        <div className="sheet-body">
          {closed.length > 0 && (
            <div className="betslip-notice" role="alert">
              {closed.length === 1 ? '1 selection is no longer available' : `${closed.length} selections are no longer available`} — remove it to place.
            </div>
          )}
          {drifted && <div className="betslip-note">Odds updated — your payout has been refreshed.</div>}

          <div className="betslip-legs">
            {legState.map(({ leg, f, bettable }) => (
              <div key={leg.fixtureId + leg.market + leg.selection} className={'betslip-leg' + (bettable ? '' : ' closed')}>
                <div className="betslip-leg-main">
                  <span className="betslip-leg-match">{f ? `${S.team(f.t1)?.name || f.t1} v ${S.team(f.t2)?.name || f.t2}` : leg.fixtureId}</span>
                  <span className="betslip-leg-pick">{leg.label} · {MARKET_LABELS[leg.market] || leg.market}</span>
                  {!bettable && <span className="betslip-leg-closed">Closed</span>}
                </div>
                <span className="betslip-leg-odds">{leg.odds}</span>
                <button className="betslip-leg-x" aria-label={`Remove ${leg.label}`} onClick={() => removeLeg(leg.fixtureId)}><Icon.x /></button>
              </div>
            ))}
          </div>

          <div className="stake-chips">
            {QUICK.map((a) => (
              <button key={a} type="button" className="stake-chip" onClick={() => addAmt(a)} disabled={(parseInt(stake, 10) || 0) >= balance}>+{a}</button>
            ))}
          </div>

          <div className="field" style={{ marginTop: 12 }}>
            <label>Stake (Yowie Dollars)</label>
            {desktop ? (
              <input type="number" min="1" step="1" max={balance} value={stake} onChange={(e) => setStake(e.target.value)} placeholder={`1 – ${balance}`} />
            ) : (
              <div className={'stake-display' + (stake ? '' : ' empty')} aria-label="Stake">{stake || `1 – ${balance}`}</div>
            )}
          </div>

          {stakeNum >= 1 && (
            <div className="coin-payout-preview">To win: <b>{payout}</b> Yowie Dollars <span className="betslip-combined">@ {combined.toFixed(2)}</span></div>
          )}

          {!desktop && <StakePad value={stake} onChange={setStake} max={balance} />}

          <div className="sheet-foot">
            <button className="cta" style={{ opacity: valid && !submitting ? 1 : 0.5 }} onClick={submit} disabled={!valid || submitting}>
              <Icon.coin /> {submitting ? 'Placing…' : legs.length > 1 ? 'Place multi' : 'Place bet'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w web -- screens-betslip`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/screens-coins.jsx web/src/screens-betslip.test.jsx
git commit -m "feat(web): BetslipSheet + BetslipPill (unified accumulating slip)"
```

### Task 4.4: Wire odds buttons → betslip; drop the stage filter; remove BetSheet usage

**Files:**
- Modify: `web/src/screens-coins.jsx` (`CoinsScreen`: filter, toggle, selected state, pill+sheet)
- Modify: `web/src/screens-bet-detail.jsx` (`BetDetail`: toggle, selected state, pill+sheet; imports)
- Test: `web/src/screens-coins.test.jsx`, `web/src/screens-bet-detail.test.jsx`

- [ ] **Step 1: Update the screen tests (red)** — these encode the new behaviour.

In `web/src/screens-coins.test.jsx`: add `import { clearBetslip } from './betslip.js'` and call `clearBetslip()` at the top of `beforeEach`. Append:

```js
test('tapping an odds button adds the selection to the betslip (pill appears)', () => {
  clearBetslip()
  render(<CoinsScreen go={() => {}} openBet={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /home odds 2/i }))
  expect(screen.getByRole('button', { name: /open bet slip/i })).toBeInTheDocument()
})
```

In `web/src/screens-bet-detail.test.jsx`: add `import { clearBetslip } from './betslip.js'`, call `clearBetslip()` at the top of `beforeEach`, and REPLACE the test `tapping a selection opens the bet sheet with a stake entry` with:

```js
test('tapping a selection adds it to the betslip; opening the slip shows the keypad', () => {
  render(<BetDetail fixtureId="f1" onBack={() => {}} />)
  fireEvent.click(screen.getAllByTestId('mkt-sel')[0])
  fireEvent.click(screen.getByRole('button', { name: /open bet slip/i }))
  expect(screen.getByRole('button', { name: 'Max stake' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '5' })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test -w web -- screens-coins.test screens-bet-detail`
Expected: FAIL — no betslip pill yet; the old BetSheet still opens.

- [ ] **Step 3: Wire `CoinsScreen`** — in `web/src/screens-coins.jsx` `CoinsScreen`:

Add `useBetslip()` near the other hooks (re-render on slip changes):
```js
  useCoins() // re-render on store changes
  useBetslip() // re-render when the slip changes (selected-state highlights)
```
Replace the bet-sheet state with slip state:
```js
  const [slipOpen, setSlipOpen] = useState(false)
```
(remove `const [betSheet, setBetSheet] = useState(null)`).

Drop the stage filter (line ~449-450):
```js
  const bettable = S.fixtures
    .filter(f => f.status === 'upcoming' && f.markets?.['1x2'])
```

Replace `openInlineBet` so it toggles a leg:
```js
  function openInlineBet(e, f, market, selKey, odds) {
    e.stopPropagation()
    if (!me) { if (window.__sweepPickMe) window.__sweepPickMe(); return }
    const mk = f.markets?.[market]
    toggleLeg({ fixtureId: f.id, market, selection: selKey, odds, line: mk?.line ?? null, book: mk?.book ?? null, label: selectionLabel(selKey, f) })
  }
```

Mark the selected odds button — change the button's `className` (line ~547):
```js
                                    className={'coin-odds-btn' + (hasLeg(f.id, '1x2', sel.key) ? ' on' : '')}
```

Replace the bet-sheet render block at the bottom (the `{betSheet && (<BetSheet …/>)}`) with the pill + slip:
```js
      <BetslipPill onOpen={() => setSlipOpen(true)} />
      {slipOpen && <BetslipSheet onClose={() => setSlipOpen(false)} />}
```

- [ ] **Step 4: Wire `BetDetail`** — in `web/src/screens-bet-detail.jsx`:

Change imports — drop `BetSheet`, add the betslip pieces:
```js
import { WalletHeader, MyBets, WagersInfoSheet, BetslipSheet, BetslipPill } from './screens-coins.jsx'
import { useBetslip, toggleLeg, hasLeg } from './betslip.js'
```
Add `useBetslip()` next to `useCoins()`:
```js
  useCoins() // re-render My bets on store changes
  useBetslip() // re-render selected-state when the slip changes
```
Replace the sheet state with slip state:
```js
  const [slipOpen, setSlipOpen] = useState(false)
```
(remove `const [sheet, setSheet] = useState(null)`).

Change the market-selection button (line ~105-110) to toggle + show selected state:
```js
                      <button
                        key={s.key}
                        className={'coin-mkt-sel' + (hasLeg(f.id, k, s.key) ? ' on' : '')}
                        data-testid="mkt-sel"
                        onClick={() => toggleLeg({ fixtureId: f.id, market: k, selection: s.key, odds: s.odds, line: mk.line ?? null, book: mk.book ?? null, label: selLabel(k, s, f) })}
                      >
```

Replace the `{sheet && (<BetSheet …/>)}` block (line ~131-139) with:
```js
      <BetslipPill onOpen={() => setSlipOpen(true)} />
      {slipOpen && <BetslipSheet onClose={() => setSlipOpen(false)} />}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npm run test -w web -- screens-coins.test screens-bet-detail screens-betslip`
Expected: PASS.

- [ ] **Step 6: Add styles** — append to `web/src/styles.css` (presentational only; tests don't depend on these, but the UI needs them). Match the existing token vocabulary (`var(--card)`, `var(--muted)`, `.pill`, `.cta`):

```css
/* --- Multi-bet betslip --- */
.betslip-pill { position: fixed; left: 50%; bottom: 84px; transform: translateX(-50%); z-index: 40;
  display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; border: none; border-radius: 999px;
  background: var(--gold, #d9a441); color: #1a1205; font-weight: 700; box-shadow: 0 6px 20px rgba(0,0,0,.35); cursor: pointer; }
.betslip-pill-count { display: inline-grid; place-items: center; min-width: 22px; height: 22px; padding: 0 6px;
  border-radius: 999px; background: rgba(0,0,0,.25); color: #fff; font-size: 12px; }
.betslip-notice { background: rgba(220,60,60,.14); color: #ffb4b4; border-radius: 10px; padding: 10px 12px; font-size: 13px; margin-bottom: 10px; }
.betslip-note { color: var(--muted2, #9aa); font-size: 12px; margin-bottom: 10px; }
.betslip-legs { display: flex; flex-direction: column; gap: 8px; margin-bottom: 4px; }
.betslip-leg { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 10px; background: var(--card2, #1d1d22); }
.betslip-leg.closed { opacity: .55; }
.betslip-leg-main { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.betslip-leg-match { font-size: 12px; color: var(--muted2, #9aa); }
.betslip-leg-pick { font-size: 14px; font-weight: 600; }
.betslip-leg-closed { font-size: 11px; color: #ffb4b4; }
.betslip-leg-odds { font-weight: 700; }
.betslip-leg-x { background: none; border: none; color: var(--muted2, #9aa); cursor: pointer; padding: 4px; }
.coin-odds-btn.on, .coin-mkt-sel.on { outline: 2px solid var(--gold, #d9a441); outline-offset: -2px; }
.betslip-combined { color: var(--muted2, #9aa); font-weight: 600; margin-left: 6px; }
```

- [ ] **Step 7: Run the full web suite**

Run: `npm run test -w web`
Expected: PASS (all web tests).

- [ ] **Step 8: Commit**

```bash
git add web/src/screens-coins.jsx web/src/screens-bet-detail.jsx web/src/screens-coins.test.jsx web/src/screens-bet-detail.test.jsx web/src/styles.css
git commit -m "feat(web): odds buttons feed the betslip; full-tournament list; remove single BetSheet flow"
```

> Note: `BetSheet` in `screens-coins.jsx` is now unused (no importers). Leave it — removing it is optional cleanup outside this plan's scope.

---

## Slice 5 — My Bets parlay cards + Statement labels

### Task 5.1: My Bets renders parlay cards

**Files:**
- Modify: `web/src/screens-coins.jsx` (`MyBets` → merge bets + parlays; extract `SingleBetRow`; add `ParlayCard`; pass `parlays` from `CoinsScreen`)
- Modify: `web/src/screens-bet-detail.jsx` (pass `parlays` to `MyBets`)
- Test: `web/src/screens-coins.test.jsx`

- [ ] **Step 1: Write the failing test** — in `web/src/screens-coins.test.jsx`, append:

```js
test('My bets renders a parlay card with leg count and payout', () => {
  setWalletData({ balance: 800, weeklyGrant: 1000, leaderboard: [], bets: { open: [], settled: [] }, parlays: {
    open: [{ id: 'par1', stake: 100, combinedOdds: 3.8, potentialPayout: 380, status: 'open', placedAt: '2026-07-01T18:00:00Z', legs: [
      { id: 'l1', fixtureId: 'f1', market: '1x2', selection: 'HOME', odds: 2, line: null, status: 'open' },
      { id: 'l2', fixtureId: 'f1', market: 'ou25', selection: 'OVER', odds: 1.9, line: 2.5, status: 'open' }] }],
    settled: [] } })
  render(<CoinsScreen go={() => {}} openBet={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /my bets/i }))
  expect(screen.getByText(/2 legs/i)).toBeInTheDocument()
  expect(screen.getByText('380')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w web -- screens-coins.test`
Expected: FAIL — no parlay card (and `MyBets` ignores `parlays`).

- [ ] **Step 3: Implement** — in `web/src/screens-coins.jsx`, replace the `MyBets` function with an extracted `SingleBetRow`, a new `ParlayCard`, and a merging `MyBets`:

```jsx
function SingleBetRow({ b, onMatch }) {
  const f = S.fixture(b.fixtureId)
  const selLabel = betSelectionLabel(b)
  const selFlag = betSelectionFlag(b)
  const mktLabel = MARKET_LABELS[b.market] || b.market
  const isWon = b.status === 'won'
  const isLost = b.status === 'lost'
  const pillClass = isWon ? 'coin-won' : isLost ? 'coin-lost' : ''
  const placed = b.placedAt ? new Date(b.placedAt) : null
  const placedDate = placed ? placed.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) : ''
  const placedTime = placed ? placed.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''
  return (
    <div className="coin-betslip" onClick={() => f && onMatch && onMatch(b.fixtureId)}>
      <div className="coin-bs-placed">
        <span className="coin-bs-pd-date">{placedDate}</span>
        <span className="coin-bs-pd-time">{placedTime}</span>
      </div>
      <div className="coin-bs-content">
        {f && (
          <div className="coin-bs-event">
            <img className="flag" src={S.flag(f.t1, 40)} alt="" />
            {S.team(f.t1)?.name || f.t1} v {S.team(f.t2)?.name || f.t2}
            <img className="flag" src={S.flag(f.t2, 40)} alt="" />
          </div>
        )}
        <div className="coin-bs-body">
          <div className="coin-bs-main">
            <span className="coin-bs-mkt">{mktLabel}</span>
            <div className="coin-bs-sel">
              {selFlag && <img className="flag" src={S.flag(selFlag, 40)} alt="" />}
              <span className="coin-bs-pick">{selLabel}</span>
            </div>
            {f && f.status === 'live' && (<div className="coin-bs-when live"><span className="coin-live-dot" />Live · {f.minute ?? 0}'</div>)}
            {f && f.status === 'upcoming' && (<div className="coin-bs-when">{f.dateTimeLabel}</div>)}
          </div>
          <div className="coin-bs-side">
            {(isWon || isLost) && <span className={`pill coin-status-pill ${pillClass}`}>{b.status}</span>}
            {isWon ? (
              <span className="coin-bs-resultline">
                <span className="coin-bs-stake"><Icon.coin />{b.stake} @ {b.odds}</span>
                <span className="coin-bs-payout won">Won <b>{b.potentialPayout}</b></span>
              </span>
            ) : (
              <span className="coin-bs-stake"><Icon.coin />{b.stake} @ {b.odds}</span>
            )}
            {b.status === 'open' && (<span className="coin-bs-payout">To win <b>{b.potentialPayout}</b></span>)}
          </div>
        </div>
      </div>
    </div>
  )
}

function ParlayCard({ p }) {
  const isWon = p.status === 'won'
  const isLost = p.status === 'lost'
  const isRefunded = p.status === 'refunded'
  const pillClass = isWon ? 'coin-won' : isLost ? 'coin-lost' : ''
  const odds = Number(p.combinedOdds).toFixed(2)
  return (
    <div className="coin-betslip coin-parlay">
      <div className="coin-bs-content">
        <div className="coin-bs-event">
          <span className="coin-parlay-tag">Multi · {p.legs.length} legs</span>
          <span className="coin-parlay-odds">@ {odds}</span>
        </div>
        <div className="coin-parlay-legs">
          {p.legs.map((l) => {
            const lw = l.status === 'won', ll = l.status === 'lost'
            return (
              <div key={l.id} className="coin-parlay-leg">
                <span className="coin-parlay-leg-pick">{betSelectionLabel(l)} · {MARKET_LABELS[l.market] || l.market}</span>
                <span className="coin-parlay-leg-odds">{l.odds}</span>
                {(lw || ll) && <span className={`pill coin-status-pill ${lw ? 'coin-won' : 'coin-lost'}`}>{l.status}</span>}
              </div>
            )
          })}
        </div>
        <div className="coin-bs-side">
          {(isWon || isLost || isRefunded) && <span className={`pill coin-status-pill ${pillClass}`}>{p.status}</span>}
          <span className="coin-bs-stake"><Icon.coin />{p.stake} @ {odds}</span>
          {p.status === 'open' && <span className="coin-bs-payout">To win <b>{p.potentialPayout}</b></span>}
          {isWon && <span className="coin-bs-payout won">Won <b>{p.potentialPayout}</b></span>}
        </div>
      </div>
    </div>
  )
}

export function MyBets({ bets, parlays = { open: [], settled: [] }, onMatch }) {
  const [filter, setFilter] = useState('open')
  const tag = (arr, kind) => arr.map((d) => ({ kind, data: d }))
  const open = [...tag(bets.open, 'bet'), ...tag(parlays.open, 'parlay')]
  const settled = [...tag(bets.settled, 'bet'), ...tag(parlays.settled, 'parlay')]
  const picked = filter === 'open' ? open : filter === 'settled' ? settled : [...open, ...settled]
  const list = [...picked].sort((a, b) => new Date(b.data.placedAt || 0) - new Date(a.data.placedAt || 0))
  const emptyMsg = filter === 'open' ? 'No open bets.' : filter === 'settled' ? 'No settled bets.' : 'No bets yet.'
  return (
    <div>
      <div className="statseg" style={{ gridTemplateColumns: '1fr 1fr 1fr', marginBottom: 14 }}>
        {['all', 'open', 'settled'].map(f => (
          <button key={f} className={'statseg-opt' + (filter === f ? ' on' : '')} onClick={() => setFilter(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <div style={{ color: 'var(--muted2)', fontSize: 13, padding: '10px 2px' }}>{emptyMsg}</div>
      ) : (
        list.map((item) => item.kind === 'parlay'
          ? <ParlayCard key={item.data.id} p={item.data} />
          : <SingleBetRow key={item.data.id} b={item.data} onMatch={onMatch} />)
      )}
    </div>
  )
}
```

- [ ] **Step 4: Pass `parlays` from both Wagers screens** — in `web/src/screens-coins.jsx` `CoinsScreen`, the My-bets tab renders:

```js
              <MyBets bets={wallet.bets} parlays={wallet.parlays} onMatch={(fid) => { const fx = S.fixture(fid); if (fx && openMatch) openMatch(fx) }} />
```
and in `web/src/screens-bet-detail.jsx`:
```js
              <MyBets bets={myWallet().bets} parlays={myWallet().parlays} onMatch={(fid) => { const fx = S.fixture(fid); if (fx && openMatch) openMatch(fx) }} />
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test -w web -- screens-coins.test screens-bet-detail`
Expected: PASS (the existing single-bet filter test still passes — `SingleBetRow` renders identically).

- [ ] **Step 6: Commit**

```bash
git add web/src/screens-coins.jsx web/src/screens-bet-detail.jsx web/src/screens-coins.test.jsx
git commit -m "feat(web): My bets renders parlay cards alongside singles"
```

### Task 5.2: `statementFor` attaches the parlay to its ledger rows

**Files:**
- Modify: `api/src/coins/ledger.js` (`statementFor`)
- Test: `api/test/coins.test.js`

- [ ] **Step 1: Write the failing test** — in `api/test/coins.test.js`, append:

```js
test('GET /api/coins/ledger attaches the parlay to its stake entry', async () => {
  const p = await aPerson(); const [f1, f2] = await twoBettableFixtures()
  await balanceOfPerson(p.id)
  await app.inject({ method: 'POST', url: '/api/parlay', payload: { personId: p.id, stake: 50, legs: [
    { fixtureId: f1.id, selection: 'HOME' }, { fixtureId: f2.id, selection: 'AWAY' }] } })
  const body = (await app.inject({ method: 'GET', url: `/api/coins/ledger?personId=${p.id}` })).json()
  const stakeEntry = body.entries.find((e) => e.type === 'stake')
  expect(stakeEntry.parlay).toMatchObject({ stake: 50, status: 'open' })
  expect(stakeEntry.parlay.legs).toHaveLength(2)
  expect(stakeEntry.bet).toBeNull()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- coins.test`
Expected: FAIL — `stakeEntry.parlay` is undefined.

- [ ] **Step 3: Implement** — in `api/src/coins/ledger.js`, replace `statementFor` so it also resolves parlays and attaches `parlay` to each non-grant entry:

```js
export async function statementFor(db, sweepId, personId, now = new Date()) {
  await ensureGrants(db, sweepId, personId, now)
  const rows = await db.select().from(coinLedger)
    .where(and(eq(coinLedger.sweepId, sweepId), eq(coinLedger.personId, personId)))
    .orderBy(coinLedger.createdAt, coinLedger.id)
  const bets = await db.select().from(bet).where(and(eq(bet.sweepId, sweepId), eq(bet.personId, personId)))
  const betById = new Map(bets.map((b) => [b.id, serializeBet(b)]))
  const parls = await db.select().from(parlay).where(and(eq(parlay.sweepId, sweepId), eq(parlay.personId, personId)))
  const parlayById = new Map()
  for (const pl of parls) {
    const legs = await db.select().from(bet).where(eq(bet.parlayId, pl.id))
    parlayById.set(pl.id, serializeParlay(pl, legs))
  }
  let running = 0
  const entries = rows.map((r) => {
    running += r.amount
    return {
      id: r.id,
      type: r.type,
      amount: r.amount,
      createdAt: r.createdAt,
      balanceAfter: running,
      weekIndex: r.type === 'grant' ? Number(r.refId) : null,
      fixtureId: (r.type === 'predict' || r.type === 'teamwin') ? r.refId : null,
      bet: r.type === 'grant' ? null : (betById.get(r.refId) ?? null),
      parlay: r.type === 'grant' ? null : (parlayById.get(r.refId) ?? null),
    }
  })
  entries.reverse() // newest first
  return { balance: running, entries }
}
```

(`parlay` and `serializeParlay` are already in scope in this file from Slice 1.)

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- coins.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/coins/ledger.js api/test/coins.test.js
git commit -m "feat(coins): statement attaches the parlay to its ledger rows"
```

### Task 5.3: Statement labels a parlay as "Multi · N legs"

**Files:**
- Modify: `web/src/screens-statement.jsx` (`entryView`)
- Test: `web/src/screens-coins.test.jsx`

- [ ] **Step 1: Write the failing test** — in `web/src/screens-coins.test.jsx`, append:

```js
test('the Statement tab labels a parlay stake as a Multi', () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['coins', 'ledger', 'pn_a'], {
    balance: 900,
    entries: [{ id: 2, type: 'stake', amount: -100, balanceAfter: 900, createdAt: '2026-07-01T18:00:00.000Z', bet: null,
      parlay: { id: 'par1', stake: 100, combinedOdds: 3.8, potentialPayout: 380, status: 'open', legs: [{ id: 'l1' }, { id: 'l2' }] } }],
  })
  render(<QueryClientProvider client={qc}><CoinsScreen go={() => {}} openBet={() => {}} /></QueryClientProvider>)
  fireEvent.click(screen.getByRole('button', { name: /^statement$/i }))
  expect(screen.getByText(/Multi · 2 legs/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w web -- screens-coins.test`
Expected: FAIL — the entry renders as "Bet placed", not a Multi.

- [ ] **Step 3: Implement** — in `web/src/screens-statement.jsx` `entryView`, handle parlays before the single-bet branches. Replace the `refund` line and the stake/payout block:

```js
  if (e.type === 'refund') {
    if (e.parlay) return { kind: 'dep', title: `Multi · ${e.parlay.legs.length} legs`, sub: 'Refund' }
    return { kind: 'dep', title: 'Refund', sub: '' }
  }
  if (e.type === 'predict' || e.type === 'teamwin') {
    const f = S.fixture(e.fixtureId)
    const match = f ? `${S.team(f.t1)?.name || f.t1} v ${S.team(f.t2)?.name || f.t2}` : null
    const sub = e.type === 'predict' ? 'Correct prediction' : 'Your team won'
    return { kind: e.type, title: match || sub, sub: match ? sub : '' }
  }
  const won = e.type === 'payout'
  const kind = won ? 'win' : 'bet'
  if (e.parlay) return { kind, title: `Multi · ${e.parlay.legs.length} legs`, sub: won ? 'Multi won' : 'Multi placed' }
  const b = e.bet
  if (!b) return { kind, title: won ? 'Bet won' : 'Bet placed', sub: '' }
  const f = S.fixture(b.fixtureId)
  const match = f ? `${S.team(f.t1)?.name || f.t1} v ${S.team(f.t2)?.name || f.t2}` : b.fixtureId
  const mkt = MARKET_LABELS[b.market] || b.market
  return { kind, title: match, sub: `${betSelectionLabel(b)} · ${mkt}` }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w web -- screens-coins.test`
Expected: PASS.

- [ ] **Step 5: Full suite + build (handoff gate)**

Run: `npm run test -w web` then `npm run test` then `npm run build`
Expected: all PASS (web suite, api suite, production build). Docker must be running for the api suite.

- [ ] **Step 6: Commit**

```bash
git add web/src/screens-statement.jsx web/src/screens-coins.test.jsx
git commit -m "feat(web): statement labels parlay rows as a Multi"
```

---

## Spec coverage (self-review map)

| Spec section | Implemented by |
|---|---|
| §3 fixture.regScore + migration | Task 0.1, 0.2 |
| §3 parlay table + bet.parlayId + legs reuse bet rows | Task 1.1 |
| §4 money/wallet (stake/payout/refund keyed by parlayId; legs no ledger) | Task 2.1, 3.1, 3.3 |
| §5 POST /api/parlay + per-leg errors | Task 2.1, 2.2 |
| §5 GET /api/coins parlays + serializeParlay + parlayId-null filter | Task 1.2, 1.3 |
| §6 settleBets leg branch + settleParlay + settleStaleBets sweep | Task 3.1, 3.2 |
| §6 prune → refund | Task 3.3 |
| §6.5 regulation-time settlement (regulationResult, resolveBet, cards ≤90) | Task 0.3; persistence 0.4 |
| §6.5 lift the group gate (api + web) | Task 0.5 (api), Task 4.4 (web filter) |
| §7 leg validity guards (add-time, in-slip reactive, place-time) + closed notice | Task 4.1, 4.3, 4.4; server per-leg revalidation 2.1/2.2 |
| §8 odds drift (place at server odds + "odds updated" note) | Task 4.3 (preview note); server authoritative 2.1 |
| §8 betslip store + pill + sheet + removable legs | Task 4.1, 4.3, 4.4 |
| §8 placeParlay optimistic + rollback | Task 4.2 |
| §8 My Bets parlay cards | Task 5.1 |
| §8 statement "Multi · N legs" | Task 5.2, 5.3 |
| §9 tests (api + web) | every task is test-first |
