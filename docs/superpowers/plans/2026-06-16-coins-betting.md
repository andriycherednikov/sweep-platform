# Coins Betting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A play-money betting ring inside The Sweep — weekly coin grants, bets placed on real Pinnacle-first decimal odds, auto-settled when matches finish, ranked on the People screen.

**Architecture:** Backend mirrors the `support` vertical slice (Drizzle table → Fastify route → `app.publish` SSE → optimistic web store → SSE reconcile). An append-only `coin_ledger` is the single source of truth for balances (balance = SUM(amount)); weekly grants are lazily backfilled (no cron). Decimal odds + an authoritative `winnerCode` are captured by the existing worker; settlement runs in the worker's newly-final path. All new tables are tenant-scoped via the `(personId, sweepId) → person(id, sweepId)` composite-FK pattern.

**Tech Stack:** Node 22 ESM, Fastify 5, Drizzle ORM over Postgres, Vitest + `@testcontainers/postgresql`; Vite + React 18 SPA, TanStack Query.

**Spec:** `docs/superpowers/specs/2026-06-16-coins-betting-design.md`

**Conventions:** Tests live in `api/test/*.test.js` and use `openTestDb()` (helpers/db.js) + `buildApp(db, { publish })`. Run a single api test file with `npm run test -w api -- <file>`; the whole suite with `npm run test`. Docker must be running. After any schema change, run `npm run db:generate -w api` then `npm run db:migrate -w api` (green tests ≠ migrated shared dev DB).

---

## File Structure

**Backend (new):**
- `api/src/coins/constants.js` — `STARTING_COINS`, `WEEKLY_COINS`, `WEEK_MS`.
- `api/src/coins/ledger.js` — `seasonAnchor`, `currentWeekIndex`, `ensureGrants`, `balanceOf`, `walletFor`, `leaderboard`.
- `api/src/coins/settle.js` — `fixtureResult`, `settleBets`.
- `api/src/routes/coins.js` — `GET /api/coins`, `POST /api/bet`.

**Backend (modified):**
- `api/src/db/schema.js` — odds + `winnerCode` columns on `fixture`; new `coinLedger`, `bet` tables.
- `api/src/providers/mapping.js` — `mapOdds` Pinnacle-first + decimals; `mapFixture` adds `winnerSide`.
- `api/src/worker/baseline-sync.js` — persist decimal odds + `winnerCode`.
- `api/src/worker.js` — call `settleBets` in the newly-final block; clear `bet` on prune (already clears watch/support).
- `api/src/worker/recompute-standings.js` — reuse the shared `fixtureResult` helper.
- `api/src/serialize.js` — add `odds` to the fixture wire shape.
- `api/src/app.js` — register `coinsRoutes`.

**Frontend (new):**
- `web/src/coins.js` — coins store (wallet/bets + optimistic `placeBet`), mirrors `social.js`.
- `web/src/screens-coins.jsx` — `CoinsScreen` + place-bet sheet.

**Frontend (modified):**
- `web/src/api/client.js` — `fetchWallet`, `postBet`.
- `web/src/hooks/useEventStream.js` — `bet` / `bet-settled` branches.
- `web/src/SweepProvider.jsx` — `['coins']` query in `Gate`.
- `web/src/App.jsx` — `coins` tab routing.
- `web/src/components.jsx` — `Icon.coin`, `BottomNav`/`Sidebar` entries.
- `web/src/styles.css` — bottom-nav grid 5→6.
- `web/src/screens-detail.jsx` — People screen Coins stat toggle.

---

## Phase 1 — Odds & result capture (provider + worker)

### Task 1: `mapOdds` picks Pinnacle-first and returns decimals + book

**Files:**
- Modify: `api/src/providers/mapping.js:91-105`
- Test: `api/test/mapping.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `api/test/mapping.test.js`:

```js
import { mapOdds } from '../src/providers/mapping.js'

const oddsResponse = (bookmakers) => ({ response: [{ bookmakers }] })
const mw = (home, draw, away) => ({ name: 'Match Winner', values: [
  { value: 'Home', odd: String(home) }, { value: 'Draw', odd: String(draw) }, { value: 'Away', odd: String(away) },
] })

test('mapOdds prefers Pinnacle even when another book appears first', () => {
  const r = mapOdds(oddsResponse([
    { id: 8, name: 'Bet365', bets: [mw(2.0, 3.4, 4.0)] },
    { id: 4, name: 'Pinnacle', bets: [mw(2.1, 3.3, 3.8)] },
  ]))
  expect(r.book).toBe('Pinnacle')
  expect(r.odds).toEqual({ home: 2.1, draw: 3.3, away: 3.8 })
  // still returns the implied percents (summing to 100) for the existing ProbBar
  expect(r.a + r.d + r.b).toBe(100)
})

test('mapOdds falls back to Bet365, then to the first complete 1X2 book', () => {
  const noPin = mapOdds(oddsResponse([
    { id: 99, name: 'SomeBook', bets: [mw(1.9, 3.5, 4.2)] },
    { id: 8, name: 'Bet365', bets: [mw(2.0, 3.4, 4.0)] },
  ]))
  expect(noPin.book).toBe('Bet365')
  const neither = mapOdds(oddsResponse([{ id: 99, name: 'SomeBook', bets: [mw(1.9, 3.5, 4.2)] }]))
  expect(neither.book).toBe('SomeBook')
  expect(neither.odds.home).toBe(1.9)
})

test('mapOdds skips books with an incomplete Match Winner market and returns null when none usable', () => {
  expect(mapOdds(oddsResponse([{ id: 4, name: 'Pinnacle', bets: [{ name: 'Match Winner', values: [{ value: 'Home', odd: '2.0' }] }] }]))).toBeNull()
  expect(mapOdds(oddsResponse([]))).toBeNull()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w api -- mapping.test.js`
Expected: FAIL (`mapOdds` returns `{a,d,b}` with no `book`/`odds`).

- [ ] **Step 3: Rewrite `mapOdds`**

Replace `mapOdds` in `api/src/providers/mapping.js` (lines 85-105) with:

```js
// Preferred bookmakers, most-credible first; any book with a complete 1X2 market is the last resort.
const BOOK_RANK = ['Pinnacle', 'Bet365']

/**
 * /odds response → { a, d, b (implied win %s), odds:{home,draw,away} (decimal), book } or null.
 * Picks the most credible bookmaker carrying a complete "Match Winner" (1X2) market
 * (BOOK_RANK order, else feed order), converts decimals to margin-stripped implied
 * probabilities, and rounds to ints summing to exactly 100.
 */
export function mapOdds(rawResponse) {
  const bookmakers = rawResponse?.response?.[0]?.bookmakers ?? []
  const complete = (bk) => {
    const bet = (bk.bets ?? []).find((b) => b.name === 'Match Winner')
    if (!bet) return null
    const pick = (label) => bet.values?.find((v) => v.value === label)?.odd
    const odds = [pick('Home'), pick('Draw'), pick('Away')].map(Number)
    if (odds.some((o) => !Number.isFinite(o) || o <= 1)) return null
    return odds
  }
  const ranked = [...bookmakers].sort((x, y) => {
    const rx = BOOK_RANK.indexOf(x.name), ry = BOOK_RANK.indexOf(y.name)
    return (rx === -1 ? Infinity : rx) - (ry === -1 ? Infinity : ry)
  })
  for (const bk of ranked) {
    const odds = complete(bk)
    if (!odds) continue
    const [home, draw, away] = odds
    const implied = odds.map((o) => 1 / o)
    const sum = implied.reduce((s, n) => s + n, 0)
    const [a, d, b] = roundTo100(implied.map((p) => p / sum))
    return { a, d, b, odds: { home, draw, away }, book: bk.name }
  }
  return null
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w api -- mapping.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/providers/mapping.js api/test/mapping.test.js
git commit -m "feat(api): mapOdds picks Pinnacle-first and returns decimal odds + book"
```

### Task 2: `mapFixture` derives `winnerSide` from the feed's winner booleans

**Files:**
- Modify: `api/src/providers/mapping.js:32-48`
- Test: `api/test/mapping.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `api/test/mapping.test.js`:

```js
import { mapFixture } from '../src/providers/mapping.js'

const rawFix = (over = {}) => ({
  fixture: { id: 42, date: '2026-06-20T18:00:00Z', status: { short: over.short ?? 'NS', elapsed: null }, venue: {} },
  league: { round: 'Group Stage - 1' },
  teams: { home: { id: 1, winner: over.homeWin ?? null }, away: { id: 2, winner: over.awayWin ?? null } },
  goals: { home: over.gh ?? null, away: over.ga ?? null },
})

test('mapFixture maps the home/away winner booleans to a winnerSide', () => {
  expect(mapFixture(rawFix({ short: 'FT', homeWin: true, awayWin: false, gh: 2, ga: 1 })).winnerSide).toBe('home')
  expect(mapFixture(rawFix({ short: 'PEN', homeWin: false, awayWin: true, gh: 1, ga: 1 })).winnerSide).toBe('away')
})

test('mapFixture reports a draw when neither side won a final, null otherwise', () => {
  expect(mapFixture(rawFix({ short: 'FT', homeWin: false, awayWin: false, gh: 1, ga: 1 })).winnerSide).toBe('draw')
  expect(mapFixture(rawFix({ short: 'NS' })).winnerSide).toBeNull()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w api -- mapping.test.js`
Expected: FAIL (`winnerSide` undefined).

- [ ] **Step 3: Add `winnerSide` to `mapFixture`**

In `api/src/providers/mapping.js`, inside `mapFixture` (after `const status = mapStatus(...)` on line 34), add:

```js
  const hw = raw.teams?.home?.winner, aw = raw.teams?.away?.winner
  const winnerSide = status !== 'final' ? null : hw === true ? 'home' : aw === true ? 'away' : 'draw'
```

and add `winnerSide,` to the returned object (e.g. after the `status,` line).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w api -- mapping.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/providers/mapping.js api/test/mapping.test.js
git commit -m "feat(api): mapFixture derives winnerSide from the feed winner booleans"
```

### Task 3: Add odds + `winnerCode` columns to `fixture`

**Files:**
- Modify: `api/src/db/schema.js:57-79`
- Create: a generated migration under `api/migrations/`
- Test: `api/test/schema.test.js` (extend if it asserts columns; otherwise this is verified by Task 4–5)

- [ ] **Step 1: Add the columns to the schema**

In `api/src/db/schema.js`, add to the `fixture` table definition (after `probB: integer('prob_b'),` on line 72):

```js
  oddsHome: numeric('odds_home'),
  oddsDraw: numeric('odds_draw'),
  oddsAway: numeric('odds_away'),
  oddsBook: text('odds_book'),
  winnerCode: text('winner_code'), // winning team code or 'DRAW', set when final
```

Add `numeric` to the import on line 1: `import { pgTable, text, integer, numeric, primaryKey, ... }`.

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate -w api`
Expected: a new `api/migrations/00NN_*.sql` adding the five columns, plus an updated `meta/_journal.json`.

- [ ] **Step 3: Apply to the shared dev DB**

Run: `npm run db:migrate -w api`
Expected: "migrations applied" with no error.

- [ ] **Step 4: Commit**

```bash
git add api/src/db/schema.js api/migrations
git commit -m "feat(api): add decimal odds + winnerCode columns to fixture"
```

### Task 4: Persist odds + `winnerCode` in the baseline sync

**Files:**
- Modify: `api/src/worker/baseline-sync.js:48-67`
- Test: `api/test/baseline-sync.test.js`

- [ ] **Step 1: Write the failing test**

Read `api/test/baseline-sync.test.js` to match its fake-provider + assertion style, then add a test that the provider's `fetchOdds` decimal/book and the fixture `winnerSide` land on the row. Concretely, configure the fake provider so `fetchOdds` returns `{ a:50, d:25, b:25, odds:{home:2,draw:3.5,away:4}, book:'Pinnacle' }` and one fixture has `winnerSide:'home'` with `t1Code` known, then:

```js
test('baseline stores decimal odds, book, and the resolved winnerCode', async () => {
  // ...arrange provider + run syncBaseline(db, provider, { season })...
  const [f] = await db.select().from(fixture).where(eq(fixture.id, KNOWN_ID))
  expect(Number(f.oddsHome)).toBe(2)
  expect(Number(f.oddsAway)).toBe(4)
  expect(f.oddsBook).toBe('Pinnacle')
  expect(f.winnerCode).toBe(f.t1Code) // winnerSide 'home' → t1Code
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w api -- baseline-sync.test.js`
Expected: FAIL (`oddsHome`/`winnerCode` null).

- [ ] **Step 3: Persist the new fields**

In `api/src/worker/baseline-sync.js`, inside the per-fixture loop (lines 48-67), compute `winnerCode` from `f.winnerSide` and write the odds. Add before the insert:

```js
      const winnerCode = f.winnerSide === 'home' ? f.t1Code : f.winnerSide === 'away' ? f.t2Code : f.winnerSide === 'draw' ? 'DRAW' : null
      const oddsSet = prob?.odds
        ? { oddsHome: String(prob.odds.home), oddsDraw: String(prob.odds.draw), oddsAway: String(prob.odds.away), oddsBook: prob.book }
        : {}
```

Add `...oddsSet, winnerCode,` to the `.values({ ... })` object, and `...(prob?.odds ? oddsSet : {}), winnerCode,` to the `onConflictDoUpdate` `set` object (so odds only overwrite when freshly fetched, but `winnerCode` always reflects the latest status).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -w api -- baseline-sync.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/worker/baseline-sync.js api/test/baseline-sync.test.js
git commit -m "feat(api): persist decimal odds + winnerCode in baseline sync"
```

### Task 5: Serialize `odds` onto the fixture wire shape

**Files:**
- Modify: `api/src/serialize.js:7-17`
- Test: `api/test/serialize.test.js`

- [ ] **Step 1: Write the failing test**

Add to `api/test/serialize.test.js`:

```js
test('serializeFixture exposes decimal odds + book', () => {
  const out = serializeFixture({ id: '1', group: 'A', matchday: 1, t1Code: 'arg', t2Code: 'bra',
    kickoffUtc: new Date(), venue: '', city: '', status: 'upcoming', score1: null, score2: null, minute: null,
    probA: 50, probD: 25, probB: 25, oddsHome: '2.10', oddsDraw: '3.30', oddsAway: '3.80', oddsBook: 'Pinnacle',
    stage: 'group', derby: false, doubleOwner: false })
  expect(out.odds).toEqual({ home: 2.1, draw: 3.3, away: 3.8, book: 'Pinnacle' })
})

test('serializeFixture odds is null when no odds were captured', () => {
  const out = serializeFixture({ id: '1', group: 'A', matchday: 1, t1Code: 'arg', t2Code: 'bra',
    kickoffUtc: new Date(), venue: '', city: '', status: 'upcoming', score1: null, score2: null, minute: null,
    probA: null, probD: null, probB: null, oddsHome: null, oddsDraw: null, oddsAway: null, oddsBook: null,
    stage: 'group', derby: false, doubleOwner: false })
  expect(out.odds).toBeNull()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w api -- serialize.test.js`
Expected: FAIL (`out.odds` undefined).

- [ ] **Step 3: Add `odds` to `serializeFixture`**

In `api/src/serialize.js`, add to the returned object in `serializeFixture` (after the `prob:` line):

```js
    odds: f.oddsHome == null ? null : { home: Number(f.oddsHome), draw: Number(f.oddsDraw), away: Number(f.oddsAway), book: f.oddsBook },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -w api -- serialize.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/serialize.js api/test/serialize.test.js
git commit -m "feat(api): serialize decimal odds onto the fixture wire shape"
```

---

## Phase 2 — Wallet & ledger

### Task 6: Ledger + bet tables and coin constants

**Files:**
- Create: `api/src/coins/constants.js`
- Modify: `api/src/db/schema.js`
- Create: a generated migration under `api/migrations/`

- [ ] **Step 1: Write the constants**

Create `api/src/coins/constants.js`:

```js
export const STARTING_COINS = 1000  // week-0 grant (initial bankroll)
export const WEEKLY_COINS = 1000    // each subsequent week
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000
```

- [ ] **Step 2: Add the tables to the schema**

In `api/src/db/schema.js`, after the `support` table, add:

```js
export const coinLedger = pgTable('coin_ledger', {
  id: serial('id').primaryKey(),
  sweepId: text('sweep_id').notNull(),
  personId: text('person_id').notNull(),
  type: text('type').notNull(),         // 'grant' | 'stake' | 'payout' | 'refund'
  amount: integer('amount').notNull(),  // signed
  refId: text('ref_id').notNull(),      // week index for grants, bet id otherwise
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sweepIdx: index('coin_ledger_sweep_id_idx').on(t.sweepId),
  personSweepFk: foreignKey({ columns: [t.personId, t.sweepId], foreignColumns: [person.id, person.sweepId], name: 'coin_ledger_person_sweep_fk' }),
  // idempotent grants/payouts: at most one row per (person, type, ref)
  entryUq: unique('coin_ledger_entry_uq').on(t.sweepId, t.personId, t.type, t.refId),
}))

export const bet = pgTable('bet', {
  id: text('id').primaryKey(),
  sweepId: text('sweep_id').notNull(),
  personId: text('person_id').notNull(),
  fixtureId: text('fixture_id').notNull().references(() => fixture.id),
  selection: text('selection').notNull(), // 'HOME' | 'DRAW' | 'AWAY'
  stake: integer('stake').notNull(),
  oddsDecimal: numeric('odds_decimal').notNull(),
  book: text('book'),
  potentialPayout: integer('potential_payout').notNull(),
  status: text('status').notNull().default('open'), // 'open' | 'won' | 'lost' | 'refunded'
  placedAt: timestamp('placed_at', { withTimezone: true }).notNull().defaultNow(),
  settledAt: timestamp('settled_at', { withTimezone: true }),
}, (t) => ({
  sweepIdx: index('bet_sweep_id_idx').on(t.sweepId),
  fixtureIdx: index('bet_fixture_id_idx').on(t.fixtureId),
  personSweepFk: foreignKey({ columns: [t.personId, t.sweepId], foreignColumns: [person.id, person.sweepId], name: 'bet_person_sweep_fk' }),
}))
```

- [ ] **Step 3: Generate + apply the migration**

Run: `npm run db:generate -w api` then `npm run db:migrate -w api`
Expected: a new migration creating `coin_ledger` + `bet`; applied with no error.

- [ ] **Step 4: Commit**

```bash
git add api/src/coins/constants.js api/src/db/schema.js api/migrations
git commit -m "feat(api): coin_ledger + bet tables and coin constants"
```

### Task 7: Ledger service — anchor, grants, balance

**Files:**
- Create: `api/src/coins/ledger.js`
- Test: `api/test/coins-ledger.test.js`

- [ ] **Step 1: Write the failing tests**

Create `api/test/coins-ledger.test.js`:

```js
import { expect, test, afterAll, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { fixture, person, coinLedger } from '../src/db/schema.js'
import { seasonAnchor, currentWeekIndex, ensureGrants, balanceOf } from '../src/coins/ledger.js'
import { WEEK_MS } from '../src/coins/constants.js'

const { pool, db } = openTestDb()
afterAll(async () => { await pool.end() })
beforeEach(async () => { await db.delete(coinLedger) })

const aPerson = async () => (await db.select().from(person).limit(1))[0]

test('seasonAnchor is the earliest fixture kickoff', async () => {
  const [{ min }] = await db.execute('select min(kickoff_utc) as min from fixture')
  const anchor = await seasonAnchor(db)
  expect(anchor.getTime()).toBe(new Date(min).getTime())
})

test('ensureGrants credits the starting bankroll once, idempotently', async () => {
  const p = await aPerson()
  const anchor = await seasonAnchor(db)
  const justAfterStart = new Date(anchor.getTime() + 1000)
  await ensureGrants(db, 'default', p.id, justAfterStart)
  await ensureGrants(db, 'default', p.id, justAfterStart) // re-run is a no-op
  const rows = await db.select().from(coinLedger).where(eq(coinLedger.personId, p.id))
  expect(rows.filter((r) => r.type === 'grant')).toHaveLength(1)
  expect(await balanceOf(db, 'default', p.id)).toBe(1000)
})

test('ensureGrants backfills one grant per elapsed week', async () => {
  const p = await aPerson()
  const anchor = await seasonAnchor(db)
  const threeWeeksIn = new Date(anchor.getTime() + 3 * WEEK_MS + 1000)
  await ensureGrants(db, 'default', p.id, threeWeeksIn)
  // weeks 0,1,2,3 → 4 grants → 4000
  expect(await balanceOf(db, 'default', p.id)).toBe(4000)
  expect(currentWeekIndex(anchor, threeWeeksIn)).toBe(3)
})

test('balanceOf is zero for a person with no ledger rows', async () => {
  const p = await aPerson()
  expect(await balanceOf(db, 'default', p.id)).toBe(0)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w api -- coins-ledger.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the ledger service**

Create `api/src/coins/ledger.js`:

```js
import { and, eq, sql } from 'drizzle-orm'
import { fixture, person, coinLedger } from '../db/schema.js'
import { STARTING_COINS, WEEKLY_COINS, WEEK_MS } from './constants.js'

/** Tournament start = earliest fixture kickoff. */
export async function seasonAnchor(db) {
  const [row] = await db.select({ min: sql`min(${fixture.kickoffUtc})` }).from(fixture)
  return new Date(row.min)
}

/** Whole weeks elapsed since the anchor, clamped to >= 0. */
export function currentWeekIndex(anchor, now) {
  return Math.max(0, Math.floor((now.getTime() - anchor.getTime()) / WEEK_MS))
}

/** Credit any missing weekly grant rows (week 0 = starting bankroll). Idempotent via the unique constraint. */
export async function ensureGrants(db, sweepId, personId, now = new Date()) {
  const anchor = await seasonAnchor(db)
  const week = currentWeekIndex(anchor, now)
  for (let w = 0; w <= week; w++) {
    await db.insert(coinLedger)
      .values({ sweepId, personId, type: 'grant', refId: String(w), amount: w === 0 ? STARTING_COINS : WEEKLY_COINS })
      .onConflictDoNothing()
  }
}

/** Current balance = SUM(amount) over the person's ledger rows. */
export async function balanceOf(db, sweepId, personId) {
  const [row] = await db.select({ total: sql`coalesce(sum(${coinLedger.amount}), 0)` })
    .from(coinLedger).where(and(eq(coinLedger.sweepId, sweepId), eq(coinLedger.personId, personId)))
  return Number(row.total)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w api -- coins-ledger.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/coins/ledger.js api/test/coins-ledger.test.js
git commit -m "feat(api): coin ledger service — anchor, lazy weekly grants, balance"
```

### Task 8: `GET /api/coins` — wallet + bets + leaderboard

**Files:**
- Create: `api/src/routes/coins.js`
- Modify: `api/src/coins/ledger.js` (add `walletFor`, `leaderboard`)
- Modify: `api/src/app.js:59-61`
- Test: `api/test/coins.test.js`

- [ ] **Step 1: Write the failing tests**

Create `api/test/coins.test.js`:

```js
import { expect, test, afterAll, beforeEach } from 'vitest'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { person, coinLedger, bet } from '../src/db/schema.js'

const { pool, db } = openTestDb()
const published = []
const app = buildApp(db, { publish: (e) => published.push(e) })
afterAll(async () => { await app.close(); await pool.end() })
beforeEach(async () => { await db.delete(bet); await db.delete(coinLedger); published.length = 0 })

const aPerson = async () => (await db.select().from(person).limit(1))[0]

test('GET /api/coins grants the starting bankroll on first read and returns a wallet', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/coins' })
  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.weeklyGrant).toBe(1000)
  expect(Array.isArray(body.leaderboard)).toBe(true)
  // every person in the sweep got their starting grant and shows on the leaderboard
  expect(body.leaderboard.every((e) => e.balance >= 1000)).toBe(true)
  expect(body.bets).toEqual({ open: [], settled: [] })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w api -- coins.test.js`
Expected: FAIL (route 404).

- [ ] **Step 3: Add `walletFor` + `leaderboard` to the ledger service**

Append to `api/src/coins/ledger.js`:

```js
import { bet as betTable } from '../db/schema.js'
import { WEEKLY_COINS } from './constants.js'

/** Grant-then-read a person's wallet: balance + their open/settled bets. */
export async function walletFor(db, sweepId, personId, now = new Date()) {
  await ensureGrants(db, sweepId, personId, now)
  const balance = await balanceOf(db, sweepId, personId)
  const rows = await db.select().from(betTable)
    .where(and(eq(betTable.sweepId, sweepId), eq(betTable.personId, personId)))
  const open = [], settled = []
  for (const b of rows) (b.status === 'open' ? open : settled).push(serializeBet(b))
  return { balance, weeklyGrant: WEEKLY_COINS, bets: { open, settled } }
}

/** Every person's current balance, ranked high → low (ensures all members are granted first). */
export async function leaderboard(db, sweepId, now = new Date()) {
  const people = await db.select().from(person).where(eq(person.sweepId, sweepId))
  const out = []
  for (const p of people) {
    await ensureGrants(db, sweepId, p.id, now)
    out.push({ personId: p.id, balance: await balanceOf(db, sweepId, p.id) })
  }
  return out.sort((a, b) => b.balance - a.balance)
}

export function serializeBet(b) {
  return { id: b.id, fixtureId: b.fixtureId, selection: b.selection, stake: b.stake,
    odds: Number(b.oddsDecimal), book: b.book, potentialPayout: b.potentialPayout,
    status: b.status, placedAt: b.placedAt, settledAt: b.settledAt }
}
```

- [ ] **Step 4: Create the route**

Create `api/src/routes/coins.js`:

```js
import { requireSweep } from '../sweeps/auth.js'
import { walletFor, leaderboard } from '../coins/ledger.js'

const member = requireSweep(['member', 'admin'])

export async function coinsRoutes(app) {
  app.get('/api/coins', { preHandler: member }, async (req) => {
    const sweepId = req.sweep.id
    const board = await leaderboard(app.db, sweepId)
    const me = req.query?.personId
    const wallet = me ? await walletFor(app.db, sweepId, me) : { balance: 0, weeklyGrant: 1000, bets: { open: [], settled: [] } }
    return { ...wallet, leaderboard: board }
  })
}
```

Register it in `api/src/app.js` after `app.register(socialRoutes)`:

```js
  app.register(coinsRoutes)
```

and import at the top: `import { coinsRoutes } from './routes/coins.js'`.

> Note: identity is client-supplied (unauthenticated), exactly like `support`. The wallet
> uses `?personId=`; the leaderboard always reflects every member. The test above omits
> `personId`, so it asserts the leaderboard + grants only.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -w api -- coins.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/routes/coins.js api/src/coins/ledger.js api/src/app.js api/test/coins.test.js
git commit -m "feat(api): GET /api/coins wallet + leaderboard"
```

---

## Phase 3 — Place a bet

### Task 9: `POST /api/bet` — atomic stake, locked odds, kickoff lock

**Files:**
- Modify: `api/src/routes/coins.js`
- Test: `api/test/coins.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `api/test/coins.test.js` (import `fixture`, `and`, `eq`; add a helper that finds an upcoming fixture with odds and stamps odds onto it):

```js
import { fixture } from '../src/db/schema.js'
import { and, eq } from 'drizzle-orm'

async function bettableFixture() {
  const [f] = await db.select().from(fixture).limit(1)
  await db.update(fixture).set({ status: 'upcoming', stage: 'group',
    oddsHome: '2.00', oddsDraw: '3.50', oddsAway: '4.00', oddsBook: 'Pinnacle' }).where(eq(fixture.id, f.id))
  return (await db.select().from(fixture).where(eq(fixture.id, f.id)))[0]
}

test('POST /api/bet deducts the stake, locks the odds, and returns the new balance', async () => {
  const p = await aPerson(); const f = await bettableFixture()
  await app.inject({ method: 'GET', url: `/api/coins?personId=${p.id}` }) // seed the grant
  const res = await app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: f.id, personId: p.id, selection: 'HOME', stake: 100 } })
  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.balance).toBe(900)
  expect(body.bet).toMatchObject({ selection: 'HOME', stake: 100, odds: 2, potentialPayout: 200, status: 'open' })
  expect(published.some((e) => e.type === 'bet')).toBe(true)
})

test('POST /api/bet rejects a stake above the balance', async () => {
  const p = await aPerson(); const f = await bettableFixture()
  const res = await app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: f.id, personId: p.id, selection: 'HOME', stake: 999999 } })
  expect(res.statusCode).toBe(400)
  expect(res.json()).toEqual({ error: 'insufficient_funds' })
})

test('POST /api/bet rejects once the match is no longer upcoming', async () => {
  const p = await aPerson(); const f = await bettableFixture()
  await db.update(fixture).set({ status: 'live' }).where(eq(fixture.id, f.id))
  const res = await app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: f.id, personId: p.id, selection: 'HOME', stake: 10 } })
  expect(res.statusCode).toBe(400)
  expect(res.json()).toEqual({ error: 'betting_closed' })
})

test('POST /api/bet rejects DRAW on a knockout fixture and an unpriced fixture', async () => {
  const p = await aPerson(); const f = await bettableFixture()
  await db.update(fixture).set({ stage: 'r16' }).where(eq(fixture.id, f.id))
  expect((await app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: f.id, personId: p.id, selection: 'DRAW', stake: 10 } })).statusCode).toBe(400)
  await db.update(fixture).set({ stage: 'group', oddsHome: null, oddsDraw: null, oddsAway: null }).where(eq(fixture.id, f.id))
  expect((await app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: f.id, personId: p.id, selection: 'HOME', stake: 10 } })).json()).toEqual({ error: 'no_odds' })
})

test('POST /api/bet allows multiple independent bets on the same match', async () => {
  const p = await aPerson(); const f = await bettableFixture()
  await app.inject({ method: 'GET', url: `/api/coins?personId=${p.id}` })
  await app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: f.id, personId: p.id, selection: 'HOME', stake: 50 } })
  const second = await app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: f.id, personId: p.id, selection: 'AWAY', stake: 50 } })
  expect(second.statusCode).toBe(200)
  const wallet = (await app.inject({ method: 'GET', url: `/api/coins?personId=${p.id}` })).json()
  expect(wallet.bets.open).toHaveLength(2)
  expect(wallet.balance).toBe(900)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w api -- coins.test.js`
Expected: FAIL (route 404 for `/api/bet`).

- [ ] **Step 3: Implement `POST /api/bet`**

In `api/src/routes/coins.js`, add the imports and route:

```js
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { fixture, person, coinLedger, bet } from '../db/schema.js'
import { ensureGrants, balanceOf, serializeBet } from '../coins/ledger.js'

const SELECTIONS = ['HOME', 'DRAW', 'AWAY']
const betBody = {
  type: 'object', required: ['fixtureId', 'personId', 'selection', 'stake'], additionalProperties: false,
  properties: {
    fixtureId: { type: 'string' }, personId: { type: 'string' },
    selection: { type: 'string', enum: SELECTIONS }, stake: { type: 'integer', minimum: 1 },
  },
}
```

```js
  app.post('/api/bet', { preHandler: member, schema: { body: betBody } }, async (req, reply) => {
    const sweepId = req.sweep.id
    const { fixtureId, personId, selection, stake } = req.body
    const [p] = await app.db.select().from(person).where(and(eq(person.id, personId), eq(person.sweepId, sweepId)))
    if (!p) return reply.code(400).send({ error: 'unknown_person' })
    const [f] = await app.db.select().from(fixture).where(eq(fixture.id, fixtureId))
    if (!f) return reply.code(400).send({ error: 'unknown_fixture' })
    if (f.status !== 'upcoming') return reply.code(400).send({ error: 'betting_closed' })
    // group stage only for now: knockout odds are the 90-min 1X2 market, which would
    // mis-settle against our final (incl. ET/penalties) winnerCode.
    if (f.stage !== 'group') return reply.code(400).send({ error: 'not_group_stage' })
    const oddsCol = selection === 'HOME' ? f.oddsHome : selection === 'AWAY' ? f.oddsAway : f.oddsDraw
    if (oddsCol == null) return reply.code(400).send({ error: 'no_odds' })
    const odds = Number(oddsCol)
    if (!Number.isFinite(odds) || odds <= 1) return reply.code(400).send({ error: 'invalid_odds' })

    await ensureGrants(app.db, sweepId, personId) // idempotent; outside the lock so the in-tx balance includes grants

    const potentialPayout = Math.round(stake * odds)
    const id = randomUUID()
    // Balance check + stake deduction are atomic under a per-(sweep,person) advisory lock,
    // so two concurrent bets can't both pass the check and overdraw.
    const result = await app.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sweepId}), hashtext(${personId}))`)
      const [b] = await tx.select({ total: sql`coalesce(sum(${coinLedger.amount}), 0)` })
        .from(coinLedger).where(and(eq(coinLedger.sweepId, sweepId), eq(coinLedger.personId, personId)))
      const balance = Number(b.total)
      if (stake > balance) return { error: 'insufficient_funds' }
      await tx.insert(coinLedger).values({ sweepId, personId, type: 'stake', amount: -stake, refId: id })
      await tx.insert(bet).values({ id, sweepId, personId, fixtureId, selection, stake,
        oddsDecimal: String(odds), book: f.oddsBook, potentialPayout, status: 'open' })
      return { balance: balance - stake }
    })
    if (result.error) return reply.code(400).send({ error: result.error })

    const [row] = await app.db.select().from(bet).where(eq(bet.id, id))
    await app.publish({ type: 'bet', sweepId, personId, fixtureId })
    return { bet: serializeBet(row), balance: result.balance }
  })
```

> Note: this snippet reflects the hardened final implementation (advisory-locked balance
> check, group-stage-only, `invalid_odds` guard). `sql` is imported from `drizzle-orm`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w api -- coins.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/coins.js api/test/coins.test.js
git commit -m "feat(api): POST /api/bet — atomic stake, locked odds, kickoff lock"
```

---

## Phase 4 — Settlement

### Task 10: `fixtureResult` + `settleBets`

**Files:**
- Create: `api/src/coins/settle.js`
- Test: `api/test/coins-settle.test.js`

- [ ] **Step 1: Write the failing tests**

Create `api/test/coins-settle.test.js`:

```js
import { expect, test, afterAll, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { fixture, person, coinLedger, bet } from '../src/db/schema.js'
import { fixtureResult, settleBets } from '../src/coins/settle.js'
import { ensureGrants, balanceOf } from '../src/coins/ledger.js'

const { pool, db } = openTestDb()
afterAll(async () => { await pool.end() })
beforeEach(async () => { await db.delete(bet); await db.delete(coinLedger) })

const aPerson = async () => (await db.select().from(person).limit(1))[0]
async function placeRaw(f, p, selection, stake, odds) {
  const id = `bet_${selection}_${stake}`
  await db.insert(coinLedger).values({ sweepId: 'default', personId: p.id, type: 'stake', amount: -stake, refId: id })
  await db.insert(bet).values({ id, sweepId: 'default', personId: p.id, fixtureId: f.id, selection, stake,
    oddsDecimal: String(odds), book: 'Pinnacle', potentialPayout: Math.round(stake * odds), status: 'open' })
  return id
}

test('fixtureResult prefers winnerCode, falls back to the group score', () => {
  expect(fixtureResult({ t1Code: 'arg', t2Code: 'bra', winnerCode: 'arg' })).toBe('HOME')
  expect(fixtureResult({ t1Code: 'arg', t2Code: 'bra', winnerCode: 'bra' })).toBe('AWAY')
  expect(fixtureResult({ t1Code: 'arg', t2Code: 'bra', winnerCode: 'DRAW' })).toBe('DRAW')
  expect(fixtureResult({ t1Code: 'arg', t2Code: 'bra', winnerCode: null, score1: 2, score2: 0 })).toBe('HOME')
  expect(fixtureResult({ t1Code: 'arg', t2Code: 'bra', winnerCode: null, score1: 1, score2: 1 })).toBe('DRAW')
  expect(fixtureResult({ winnerCode: null, score1: null, score2: null })).toBeNull()
})

test('settleBets pays winners, busts losers, and is idempotent', async () => {
  const p = await aPerson()
  await ensureGrants(db, 'default', p.id)
  const [f] = await db.select().from(fixture).limit(1)
  await db.update(fixture).set({ status: 'final', winnerCode: f.t1Code }).where(eq(fixture.id, f.id))
  const startBal = await balanceOf(db, 'default', p.id)
  await placeRaw(f, p, 'HOME', 100, 2)  // wins → +200
  await placeRaw(f, p, 'AWAY', 100, 4)  // loses
  const published = []
  await settleBets(db, f.id, (e) => published.push(e))
  // staked 200, won 200 back → net -0... wait: started startBal, -200 stakes, +200 payout
  expect(await balanceOf(db, 'default', p.id)).toBe(startBal - 200 + 200)
  const rows = await db.select().from(bet).where(eq(bet.fixtureId, f.id))
  expect(rows.find((b) => b.selection === 'HOME').status).toBe('won')
  expect(rows.find((b) => b.selection === 'AWAY').status).toBe('lost')
  expect(published).toEqual([{ type: 'bet-settled', sweepId: 'default' }])
  // re-running settles nothing (only 'open' bets are touched) and does not double-pay
  const again = []
  await settleBets(db, f.id, (e) => again.push(e))
  expect(again).toEqual([])
  expect(await balanceOf(db, 'default', p.id)).toBe(startBal - 200 + 200)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w api -- coins-settle.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement settlement**

Create `api/src/coins/settle.js`:

```js
import { and, eq } from 'drizzle-orm'
import { fixture, coinLedger, bet } from '../db/schema.js'

/** Winning selection for a final fixture: 'HOME' | 'AWAY' | 'DRAW' | null. */
export function fixtureResult(f) {
  if (f.winnerCode) {
    if (f.winnerCode === f.t1Code) return 'HOME'
    if (f.winnerCode === f.t2Code) return 'AWAY'
    return 'DRAW'
  }
  if (f.score1 == null || f.score2 == null) return null
  return f.score1 > f.score2 ? 'HOME' : f.score1 < f.score2 ? 'AWAY' : 'DRAW'
}

/**
 * Settle every OPEN bet on a finished fixture across all sweeps. Winners get a 'payout'
 * ledger row (= potentialPayout, which returns the stake too); losers keep the deducted
 * stake. Idempotent — only 'open' bets are touched. Publishes one bet-settled per sweep.
 */
export async function settleBets(db, fixtureId, publish = () => {}) {
  const [f] = await db.select().from(fixture).where(eq(fixture.id, fixtureId))
  if (!f || f.status !== 'final') return 0
  const result = fixtureResult(f)
  if (!result) return 0
  const open = await db.select().from(bet).where(and(eq(bet.fixtureId, fixtureId), eq(bet.status, 'open')))
  const sweeps = new Set()
  for (const b of open) {
    const won = b.selection === result
    await db.transaction(async (tx) => {
      if (won) await tx.insert(coinLedger).values({ sweepId: b.sweepId, personId: b.personId, type: 'payout', amount: b.potentialPayout, refId: b.id })
      await tx.update(bet).set({ status: won ? 'won' : 'lost', settledAt: new Date() }).where(eq(bet.id, b.id))
    })
    sweeps.add(b.sweepId)
  }
  for (const sweepId of sweeps) await publish({ type: 'bet-settled', sweepId })
  return open.length
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w api -- coins-settle.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/coins/settle.js api/test/coins-settle.test.js
git commit -m "feat(api): bet settlement — fixtureResult + settleBets (idempotent)"
```

### Task 11: Hook settlement into the worker + prune `bet` on baseline

**Files:**
- Modify: `api/src/worker.js:54-62`
- Modify: `api/src/worker/baseline-sync.js:73-78`

> These are worker wiring changes exercised by the existing manual smoke and the unit tests
> for `settleBets`/`baseline-sync`; no new automated test is added for the `setInterval` body
> (it is not unit-tested today, matching `recomputeStandings`'s wiring).

- [ ] **Step 1: Call `settleBets` on newly-final fixtures**

In `api/src/worker.js`, import at the top:

```js
import { settleBets } from './coins/settle.js'
```

Inside the `if (newlyFinal.length) { ... }` block (after `await recomputeStandings(db)`), add:

```js
        for (const r of newlyFinal) await settleBets(db, r.id, (e) => publish(db, e))
```

- [ ] **Step 2: Clear `bet` rows when pruning fixtures**

In `api/src/worker/baseline-sync.js`, add `bet` to the import on line 2:

```js
import { fixture, standing, ownership, syncLog, watch, support, bet } from '../db/schema.js'
```

and inside the prune block (after the `support` delete on line 76), add:

```js
      await db.delete(bet).where(notInArray(bet.fixtureId, keep))
```

- [ ] **Step 3: Run the full api suite**

Run: `npm run test`
Expected: PASS (all existing + new tests).

- [ ] **Step 4: Commit**

```bash
git add api/src/worker.js api/src/worker/baseline-sync.js
git commit -m "feat(api): settle bets on newly-final fixtures; prune bets with fixtures"
```

### Task 12: Reuse `fixtureResult` in `recomputeStandings`

**Files:**
- Modify: `api/src/worker/recompute-standings.js:19-30`

> Optional DRY cleanup so result logic lives in one place. The existing
> `recompute-standings.test.js` must stay green.

- [ ] **Step 1: Refactor to use the shared helper**

In `api/src/worker/recompute-standings.js`, import `fixtureResult` from `../coins/settle.js` and replace the win/draw/loss branch (lines 27-29) with:

```js
    const res = fixtureResult(f)
    a.played++; b.played++
    a.gf += f.score1; a.ga += f.score2
    b.gf += f.score2; b.ga += f.score1
    if (res === 'HOME') { a.win++; a.pts += 3; b.loss++ }
    else if (res === 'AWAY') { b.win++; b.pts += 3; a.loss++ }
    else { a.draw++; b.draw++; a.pts++; b.pts++ }
```

(Keep the existing `if (f.stage !== 'group') continue` and score-null guards above it — group standings still settle off scores even before `winnerCode` is backfilled, because `fixtureResult` falls back to the score.)

- [ ] **Step 2: Run the standings tests**

Run: `npm run test -w api -- recompute-standings.test.js`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add api/src/worker/recompute-standings.js
git commit -m "refactor(api): recomputeStandings reuses the shared fixtureResult helper"
```

---

## Phase 5 — Web data layer

### Task 13: API client — `fetchWallet` + `postBet`

**Files:**
- Modify: `web/src/api/client.js:32-34`
- Test: `web/src/api/client.test.js`

- [ ] **Step 1: Write the failing tests**

Match the existing fetch-mock style in `web/src/api/client.test.js`, then add:

```js
test('fetchWallet GETs /api/coins with the personId query', async () => {
  const spy = mockFetchOnce({ balance: 1000, leaderboard: [] })
  await fetchWallet('pn_x')
  expect(spy).toHaveBeenCalledWith('/api/coins?personId=pn_x', expect.objectContaining({ credentials: 'include' }))
})

test('postBet POSTs the bet body to /api/bet', async () => {
  const spy = mockFetchOnce({ bet: { id: 'b1' }, balance: 900 })
  await postBet({ fixtureId: 'f1', personId: 'pn_x', selection: 'HOME', stake: 100 })
  const [url, opts] = spy.mock.calls[0]
  expect(url).toBe('/api/bet')
  expect(JSON.parse(opts.body)).toEqual({ fixtureId: 'f1', personId: 'pn_x', selection: 'HOME', stake: 100 })
})
```

(Use whatever the file's existing helper is for mocking — mirror a current test in that file; `mockFetchOnce` is a placeholder for that helper.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w web -- client.test.js`
Expected: FAIL (`fetchWallet`/`postBet` undefined).

- [ ] **Step 3: Add the client functions**

In `web/src/api/client.js`, after the `postSupport` export (line 34):

```js
export const fetchWallet = (personId) => get(`/api/coins?personId=${encodeURIComponent(personId)}`)
export const postBet = ({ fixtureId, personId, selection, stake }) => post('/api/bet', { fixtureId, personId, selection, stake })
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w web -- client.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/api/client.js web/src/api/client.test.js
git commit -m "feat(web): API client fetchWallet + postBet"
```

### Task 14: Coins store — wallet/bets + optimistic `placeBet`

**Files:**
- Create: `web/src/coins.js`
- Test: `web/src/coins.test.js`

- [ ] **Step 1: Write the failing tests**

Create `web/src/coins.test.js` (mirror `web/src/social.test.js`'s setup — it imports the store, seeds `SWEEP`, stubs the client):

```js
import { expect, test, vi, beforeEach } from 'vitest'
import * as client from './api/client.js'
import { setWalletData, myBalance, leaderboardByBalance, placeBet, coinsLeaderboard } from './coins.js'
import { setMe } from './social.js'
import { SWEEP as S } from './data.js'

beforeEach(() => {
  S.people = [{ id: 'pn_a', name: 'Ann' }, { id: 'pn_b', name: 'Bob' }]
  S.fixtures = [{ id: 'f1', t1: 'arg', t2: 'bra', status: 'upcoming', odds: { home: 2, draw: 3.5, away: 4, book: 'Pinnacle' } }]
  S.fixture = (id) => S.fixtures.find((f) => f.id === id)
  setMe('pn_a')
  setWalletData({ balance: 1000, weeklyGrant: 1000, bets: { open: [], settled: [] }, leaderboard: [{ personId: 'pn_a', balance: 1000 }, { personId: 'pn_b', balance: 1200 }] })
})

test('myBalance reflects the hydrated wallet', () => {
  expect(myBalance()).toBe(1000)
})

test('coinsLeaderboard ranks people by balance, highest first', () => {
  const board = coinsLeaderboard()
  expect(board.map((e) => e.person.id)).toEqual(['pn_b', 'pn_a'])
  expect(board[0].balance).toBe(1200)
})

test('placeBet optimistically debits the balance and rolls back on failure', async () => {
  vi.spyOn(client, 'postBet').mockRejectedValueOnce(new Error('nope'))
  await placeBet('f1', 'HOME', 100)
  expect(myBalance()).toBe(1000) // rolled back
})

test('placeBet keeps the debit on success', async () => {
  vi.spyOn(client, 'postBet').mockResolvedValueOnce({ bet: { id: 'b1', fixtureId: 'f1', selection: 'HOME', stake: 100, odds: 2, potentialPayout: 200, status: 'open' }, balance: 900 })
  await placeBet('f1', 'HOME', 100)
  expect(myBalance()).toBe(900)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w web -- coins.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the store**

Create `web/src/coins.js` (modeled on `social.js`):

```js
import { useState, useEffect } from 'react'
import { SWEEP as S } from './data.js'
import { getMe, toast } from './social.js'
import { postBet } from './api/client.js'
import { trackEvent } from './lib/analytics.js'

const listeners = new Set()
function notify() { listeners.forEach((fn) => fn()) }

let wallet = { balance: 0, weeklyGrant: 1000, bets: { open: [], settled: [] } }
let board = []  // [{ personId, balance }]

export function setWalletData(server) {
  if (!server) return
  wallet = { balance: server.balance ?? 0, weeklyGrant: server.weeklyGrant ?? 1000, bets: server.bets ?? { open: [], settled: [] } }
  board = server.leaderboard ?? []
  notify()
}

export function myBalance() { return wallet.balance }
export function myWallet() { return wallet }
export function balanceByPerson() { const m = {}; for (const e of board) m[e.personId] = e.balance; return m }

/** Leaderboard rows resolved to people, highest balance first. */
export function coinsLeaderboard(limit = Infinity) {
  return board
    .map((e) => ({ person: S.people.find((p) => p.id === e.personId), balance: e.balance }))
    .filter((x) => x.person)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, limit)
}

export function leaderboardByBalance() { return board }

/** Optimistically debit the balance + add an open bet; reconcile/rollback against the server. */
export async function placeBet(fixtureId, selection, stake) {
  const me = getMe()
  if (!me) { if (window.__sweepPickMe) window.__sweepPickMe(); return }
  if (!(stake >= 1) || stake > wallet.balance) { toast('Not enough coins'); return }
  const prev = wallet
  const f = S.fixture(fixtureId)
  const odds = f?.odds ? (selection === 'HOME' ? f.odds.home : selection === 'AWAY' ? f.odds.away : f.odds.draw) : null
  const pending = { id: `pending_${Date.now()}`, fixtureId, selection, stake, odds, potentialPayout: odds ? Math.round(stake * odds) : 0, status: 'open' }
  wallet = { ...wallet, balance: wallet.balance - stake, bets: { ...wallet.bets, open: [pending, ...wallet.bets.open] } }
  notify()
  trackEvent('bet_placed', { match_id: fixtureId, selection, stake })
  try {
    const res = await postBet({ fixtureId, personId: me.id, selection, stake })
    wallet = { ...wallet, balance: res.balance, bets: { ...wallet.bets, open: wallet.bets.open.map((b) => b.id === pending.id ? res.bet : b) } }
    notify()
  } catch {
    wallet = prev; notify(); toast("Couldn't place bet — try again")
  }
}

export function useCoins() {
  const [, force] = useState(0)
  useEffect(() => { const fn = () => force((x) => x + 1); listeners.add(fn); return () => listeners.delete(fn) }, [])
  return { wallet, board }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w web -- coins.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/coins.js web/src/coins.test.js
git commit -m "feat(web): coins store with optimistic placeBet + leaderboard"
```

### Task 15: Wire the `['coins']` query + SSE reconcile

**Files:**
- Modify: `web/src/SweepProvider.jsx:52-59`
- Modify: `web/src/hooks/useEventStream.js`
- Test: `web/src/hooks/useEventStream.test.jsx`

- [ ] **Step 1: Write the failing test**

In `web/src/hooks/useEventStream.test.jsx`, add a case asserting that a `bet` and a `bet-settled` event invalidate the `['coins']` query (mirror the existing `support` → `['social']` invalidation assertion):

```js
test('bet and bet-settled events invalidate the coins query', () => {
  const { qc, emit } = renderStream() // use the file's existing harness
  emit({ type: 'bet', sweepId: 'default' })
  emit({ type: 'bet-settled', sweepId: 'default' })
  expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['coins'] })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w web -- useEventStream.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Add the SSE branches + the query**

In `web/src/hooks/useEventStream.js`, add to `es.onopen` after the `['social']` invalidation:

```js
      qc.invalidateQueries({ queryKey: ['coins'] })
```

and add a branch in `es.onmessage` (e.g. after the `watch`/`support` block):

```js
      } else if (ev.type === 'bet' || ev.type === 'bet-settled') {
        qc.invalidateQueries({ queryKey: ['coins'] })
```

In `web/src/SweepProvider.jsx`, after the `['social']` `useQuery` (line 52-59), add:

```js
  useQuery({
    queryKey: ['coins'],
    queryFn: async () => {
      const me = getMe()
      const wallet = await fetchWallet(me ? me.id : '')
      setWalletData(wallet)
      return wallet
    },
  })
```

Add imports to `SweepProvider.jsx`: `import { fetchWallet } from './api/client.js'`, `import { setWalletData } from './coins.js'`, `import { getMe } from './social.js'`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w web -- useEventStream.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/useEventStream.js web/src/SweepProvider.jsx web/src/hooks/useEventStream.test.jsx
git commit -m "feat(web): coins query + bet/bet-settled SSE reconcile"
```

---

## Phase 6 — Web UI

### Task 16: Coins tab in navigation

**Files:**
- Modify: `web/src/App.jsx:25,28,41,130-135`
- Modify: `web/src/components.jsx:19,379,383,430`
- Modify: `web/src/styles.css:527`
- Test: `web/src/App.test.jsx`

- [ ] **Step 1: Write the failing test**

In `web/src/App.test.jsx`, add a case mirroring the existing tab-routing tests:

```js
test('readView maps /coins to the coins tab and urlFor round-trips', () => {
  expect(readView('/coins')).toMatchObject({ tab: 'coins' })
  expect(urlFor({ tab: 'coins' })).toBe('/coins')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w web -- App.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Add the tab**

- `web/src/App.jsx` line 25: add `"coins"` to `TABS`: `const TABS = ["schedule", "people", "teams", "standings", "coins"]`.
- `urlFor` (line ~28): add `if (view.tab === "coins") return "/coins"`.
- `readView` (line ~41): add `if (path === "/coins") return { tab: "coins" }`.
- Base-screen chain (lines 130-135): add `else if (tab === "coins") base = <CoinsScreen go={navigate} openMatch={(id) => navigate({ modal: "match", id })} />`, and import `CoinsScreen` from `./screens-coins.jsx`.
- `web/src/components.jsx`: add a coin glyph to the `Icon` object (line 19), e.g.:
  ```jsx
  coin: (p) => (<svg viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2"/><path d="M12 7v10M9.5 9.5h4a1.5 1.5 0 010 3h-3a1.5 1.5 0 000 3h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>),
  ```
- `BottomNav` `TABS` (line 379): add `["coins", "Coins", Icon.coin]`.
- `Sidebar` `SB_NAV` (line 430): add `["coins", "Coins", Icon.coin]`.
- `web/src/styles.css` line 527: change the bottom-nav grid from `repeat(5,1fr)` to `repeat(6,1fr)`.

- [ ] **Step 4: Create a minimal `CoinsScreen` placeholder so the build resolves**

Create `web/src/screens-coins.jsx`:

```jsx
export function CoinsScreen() {
  return <div className="screen screen-anim" data-testid="coins-screen" />
}
```

- [ ] **Step 5: Run the test + build to verify**

Run: `npm run test -w web -- App.test.jsx && npm run build`
Expected: PASS + clean build.

- [ ] **Step 6: Commit**

```bash
git add web/src/App.jsx web/src/components.jsx web/src/styles.css web/src/screens-coins.jsx web/src/App.test.jsx
git commit -m "feat(web): Coins tab in bottom nav + sidebar"
```

### Task 17: CoinsScreen — wallet, bettable matches, place-bet, history

**Files:**
- Modify: `web/src/screens-coins.jsx`
- Modify: `web/src/styles.css` (coin styles, reuse `--gold`)
- Test: `web/src/screens-coins.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/screens-coins.test.jsx` (mirror `screens-detail.test.jsx` render setup):

```jsx
import { expect, test, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CoinsScreen } from './screens-coins.jsx'
import { setWalletData } from './coins.js'
import { setMe } from './social.js'
import { SWEEP as S } from './data.js'

beforeEach(() => {
  S.people = [{ id: 'pn_a', name: 'Ann', initials: 'AN', av: '#ccc' }]
  S.fixtures = [{ id: 'f1', t1: 'arg', t2: 'bra', status: 'upcoming', ko: new Date(Date.now() + 3600e3), odds: { home: 2, draw: 3.5, away: 4, book: 'Pinnacle' } }]
  S.fixture = (id) => S.fixtures.find((f) => f.id === id)
  S.team = (c) => ({ code: c, name: c.toUpperCase(), color: '#123' })
  setMe('pn_a')
  setWalletData({ balance: 1000, weeklyGrant: 1000, bets: { open: [], settled: [] }, leaderboard: [{ personId: 'pn_a', balance: 1000 }] })
})

test('shows the wallet balance and a bettable upcoming match with its odds', () => {
  render(<CoinsScreen go={() => {}} openMatch={() => {}} />)
  expect(screen.getByText(/1000/)).toBeInTheDocument()
  expect(screen.getByText('Pinnacle')).toBeInTheDocument()
  // the three priced selections render
  expect(screen.getByText('2')).toBeInTheDocument()
})

test('opening the bet sheet and placing a bet shows a confirmation control', () => {
  render(<CoinsScreen go={() => {}} openMatch={() => {}} />)
  fireEvent.click(screen.getAllByRole('button')[0])
  // a stake input appears
  expect(screen.getByRole('spinbutton')).toBeInTheDocument()
})
```

(Adjust selectors to the actual markup as you build it; the intent is: balance visible, odds visible, a place-bet control opens a stake entry.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w web -- screens-coins.test.jsx`
Expected: FAIL (placeholder has no content).

- [ ] **Step 3: Build `CoinsScreen`**

Replace `web/src/screens-coins.jsx` with a screen that uses `useCoins`, `myWallet`, `placeBet`, `coinsLeaderboard` from `./coins.js` and renders:
- A wallet header (`.block` + `--gold` accent): balance, `weeklyGrant` note ("+1000 each week").
- A "Place a bet" list of `S.fixtures.filter(f => f.status === 'upcoming' && f.odds)` sorted by `ko`, each row showing both teams, the book name (`f.odds.book`), and three tappable odds buttons (Home `f.odds.home` / Draw `f.odds.draw` / Away `f.odds.away`; hide Draw when `f.stage !== 'group'`).
- A bet sheet (reuse the `.sheet`/`.overlay` pattern from `MatchSheet`): selected match + selection, a stake `<input type="number" min="1">`, a live potential-payout preview (`stake * odds`), and a `.cta` "Place bet" button calling `placeBet(fixtureId, selection, stake)`.
- "Open bets" and "Settled" sections from `myWallet().bets` (show selection, stake, odds, potential payout, and status pill — gold for `won`, muted for `lost`).
- Gate placement on `f.status === 'upcoming'` (mirror `CrowdPick`'s kickoff lock).

Keep it one focused component file. Add matching `.coin-*` styles to `styles.css` reusing existing tokens (`--gold`, `.block`, `.blocktitle`, `.cta`, `.sheet`, `.pill`).

- [ ] **Step 4: Run the test + build to verify**

Run: `npm run test -w web -- screens-coins.test.jsx && npm run build`
Expected: PASS + clean build.

- [ ] **Step 5: Commit**

```bash
git add web/src/screens-coins.jsx web/src/styles.css web/src/screens-coins.test.jsx
git commit -m "feat(web): CoinsScreen — wallet, bettable matches, place-bet sheet, history"
```

### Task 18: People screen — Coins stat toggle

**Files:**
- Modify: `web/src/screens-detail.jsx` (the `PeopleScreen` Wins/Predictions toggle)
- Test: `web/src/screens-detail.test.jsx`

- [ ] **Step 1: Locate the existing toggle**

Read the `PeopleScreen` in `web/src/screens-detail.jsx` and find the Wins/Predictions stat toggle (the recent "people-prediction-toggle" work). Note the state variable and the option list it renders.

- [ ] **Step 2: Write the failing test**

In `web/src/screens-detail.test.jsx`, add a case (mirroring the existing Wins/Predictions toggle test) that selecting **Coins** ranks people by balance from the coins store:

```js
test('People screen Coins toggle ranks people by coin balance', () => {
  setWalletData({ balance: 0, weeklyGrant: 1000, bets: { open: [], settled: [] }, leaderboard: [{ personId: 'pn_b', balance: 1500 }, { personId: 'pn_a', balance: 900 }] })
  // render PeopleScreen, click the "Coins" toggle option, assert pn_b is listed above pn_a
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test -w web -- screens-detail.test.jsx`
Expected: FAIL.

- [ ] **Step 4: Add the Coins option**

Extend the stat toggle's option list with a `coins` mode. When active, sort the people list by `balanceByPerson()` (from `./coins.js`) descending and render each person's balance (with the `--gold` accent) in place of the win/prediction count. Import `balanceByPerson` (and `coinsLeaderboard` if convenient) from `./coins.js`.

- [ ] **Step 5: Run the test + build to verify**

Run: `npm run test -w web -- screens-detail.test.jsx && npm run build`
Expected: PASS + clean build.

- [ ] **Step 6: Commit**

```bash
git add web/src/screens-detail.jsx web/src/screens-detail.test.jsx
git commit -m "feat(web): People screen Coins stat toggle (rank by balance)"
```

---

## Final verification

- [ ] **Full api suite:** `npm run test` → all green (Docker running).
- [ ] **Web suite + build:** `npm run test -w web && npm run build` → green + clean.
- [ ] **Dev DB migrated:** confirm `npm run db:migrate -w api` was run after each schema change (Tasks 3 & 6).
- [ ] **Manual smoke (dev stack):** `npm run dev:api` + `npm run dev:web`. Pick an identity, open the Coins tab, place a bet on an upcoming group match → balance drops, bet shows under Open. Force a final (set a fixture `status='final'` + `winner_code` via psql, or wait for a real final) and run the worker / call `settleBets` → a winning bet pays out, the balance updates live via SSE, and People → Coins reflects the new ranking.
- [ ] **Finish the branch:** use the `superpowers:finishing-a-development-branch` skill.

---

## Self-review notes

- **Spec coverage:** economy/grants (Tasks 6-8), Pinnacle-first real odds (Tasks 1,3-5), 1X2 group bets + multiple bets + kickoff lock (Task 9), authoritative `winnerCode` + settlement (Tasks 2,4,10-12), Coins tab + place-bet + history (Tasks 16-17), People ranking (Task 18), server-side balance enforcement (Tasks 7,9 — balance from ledger, atomic stake), tenant isolation (composite FKs, Task 6). All covered.
- **Type consistency:** `selection` is `'HOME'|'DRAW'|'AWAY'` everywhere (route, settle, store); `winnerSide` is `'home'|'away'|'draw'|null` (provider) and resolves to `winnerCode` (team code | `'DRAW'`) in baseline-sync; `fixtureResult` returns the selection space. `serializeBet` shape matches what the store/UI consume. Ledger `type` ∈ `grant|stake|payout|refund`; `refId` is the week index (grants) or bet id (stake/payout).
- **Knockouts:** intentionally out of scope; schema (`winnerCode`, `selection` room for `ADVANCE`) and `fixtureResult` already handle them, so enabling later is UI + a knockout odds market only.
