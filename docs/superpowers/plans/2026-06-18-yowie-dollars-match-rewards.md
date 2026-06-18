# Yowie Dollars Match Rewards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grant +100 Yowie Dollars for each correct match prediction and +300 for each match a team you own wins, automatically when a match goes final, surfaced in the statement.

**Architecture:** A new `grantMatchRewards(db, fixtureId, publish)` reads the `support` (predictions) and `ownership` tables for a final fixture and inserts idempotent `coin_ledger` reward rows (`type:'predict'` / `'teamwin'`, keyed by `refId = fixtureId`). It's called from the worker's existing newly-final loop next to `settleBets`. The statement composer surfaces `fixtureId` for these rows so the screen can name the match; the statement screen adds two new row kinds (gold tick / gold team icon).

**Tech Stack:** Node 22 ESM + Fastify 5 + Drizzle ORM (Postgres), Vitest + @testcontainers/postgresql (api); Vite + React 18, Vitest + React Testing Library, Font Awesome (web).

---

## File Structure

- `api/src/coins/constants.js` — **modify**: add `PREDICT_REWARD`, `TEAM_WIN_REWARD`.
- `api/src/db/schema.js` — **modify**: extend the `coin_ledger.type` comment (no migration — `type` is free text).
- `api/src/coins/rewards.js` — **create**: `grantMatchRewards(db, fixtureId, publish)`.
- `api/test/coins-rewards.test.js` — **create**: unit tests for `grantMatchRewards`.
- `api/src/worker.js` — **modify**: call `grantMatchRewards` in the newly-final loop.
- `api/src/coins/ledger.js` — **modify**: `statementFor` surfaces `fixtureId` for `predict`/`teamwin` rows.
- `api/test/coins-ledger.test.js` — **modify**: assert the new `fixtureId` surfacing.
- `web/src/screens-statement.jsx` — **modify**: `entryView` + `KIND_ICON` + `KindGlyph` for the two reward kinds.
- `web/src/screens-statement.test.jsx` — **modify**: render tests for the two reward rows.

---

## Task 1: `grantMatchRewards` + constants (api)

**Files:**
- Modify: `api/src/coins/constants.js`
- Modify: `api/src/db/schema.js` (comment only)
- Create: `api/src/coins/rewards.js`
- Test: `api/test/coins-rewards.test.js`

- [ ] **Step 1: Add the constants**

In `api/src/coins/constants.js`, append:

```js
export const PREDICT_REWARD = 100   // correct match prediction (support pick matches result)
export const TEAM_WIN_REWARD = 300  // a team you own wins a match
```

- [ ] **Step 2: Extend the ledger type comment**

In `api/src/db/schema.js`, in the `coinLedger` table, change the `type` column comment to list the new types (the column is plain text — no migration needed):

```js
  type: text('type').notNull(),         // 'grant' | 'stake' | 'payout' | 'refund' | 'predict' | 'teamwin'
```

- [ ] **Step 3: Write the failing test**

Create `api/test/coins-rewards.test.js`:

```js
import { expect, test, afterAll, beforeEach } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { fixture, person, sweep, coinLedger, support, ownership } from '../src/db/schema.js'
import { grantMatchRewards } from '../src/coins/rewards.js'

const { pool, db } = openTestDb()
afterAll(async () => { await pool.end() })
beforeEach(async () => { await db.delete(coinLedger); await db.delete(support); await db.delete(ownership) })

const twoPeople = async () => db.select().from(person).limit(2)
const rows = (personId, type) =>
  db.select().from(coinLedger).where(and(eq(coinLedger.personId, personId), eq(coinLedger.type, type)))

// mark the first seeded fixture final with the home team as the winner; return the row
async function homeWinFixture() {
  const [f] = await db.select().from(fixture).limit(1)
  await db.update(fixture).set({ status: 'final', winnerCode: f.t1Code }).where(eq(fixture.id, f.id))
  return (await db.select().from(fixture).where(eq(fixture.id, f.id)))[0]
}

test('a correct prediction grants +100; a wrong one grants nothing', async () => {
  const [a, b] = await twoPeople()
  const f = await homeWinFixture()
  await db.insert(support).values({ sweepId: 'default', fixtureId: f.id, personId: a.id, teamCode: f.t1Code }) // HOME — correct
  await db.insert(support).values({ sweepId: 'default', fixtureId: f.id, personId: b.id, teamCode: f.t2Code }) // AWAY — wrong
  await grantMatchRewards(db, f.id)
  const aPred = await rows(a.id, 'predict')
  expect(aPred).toHaveLength(1)
  expect(aPred[0].amount).toBe(100)
  expect(aPred[0].refId).toBe(f.id)
  expect(await rows(b.id, 'predict')).toHaveLength(0)
})

test('winning-team owner gets +300; losing-team owner gets nothing', async () => {
  const [a, b] = await twoPeople()
  const f = await homeWinFixture()
  await db.insert(ownership).values({ sweepId: 'default', personId: a.id, teamCode: f.t1Code }) // owns winner
  await db.insert(ownership).values({ sweepId: 'default', personId: b.id, teamCode: f.t2Code }) // owns loser
  await grantMatchRewards(db, f.id)
  expect((await rows(a.id, 'teamwin'))[0].amount).toBe(300)
  expect(await rows(b.id, 'teamwin')).toHaveLength(0)
})

test('both co-owners of the winning team each get the full +300', async () => {
  const [a, b] = await twoPeople()
  const f = await homeWinFixture()
  await db.insert(ownership).values({ sweepId: 'default', personId: a.id, teamCode: f.t1Code })
  await db.insert(ownership).values({ sweepId: 'default', personId: b.id, teamCode: f.t1Code })
  await grantMatchRewards(db, f.id)
  expect((await rows(a.id, 'teamwin'))[0].amount).toBe(300)
  expect((await rows(b.id, 'teamwin'))[0].amount).toBe(300)
})

test('a drawn match pays correct DRAW predictions but no team-win', async () => {
  const [a] = await twoPeople()
  const [f0] = await db.select().from(fixture).limit(1)
  await db.update(fixture).set({ status: 'final', winnerCode: 'DRAW' }).where(eq(fixture.id, f0.id))
  const f = (await db.select().from(fixture).where(eq(fixture.id, f0.id)))[0]
  await db.insert(support).values({ sweepId: 'default', fixtureId: f.id, personId: a.id, teamCode: 'DRAW' })
  await db.insert(ownership).values({ sweepId: 'default', personId: a.id, teamCode: f.t1Code })
  await grantMatchRewards(db, f.id)
  expect((await rows(a.id, 'predict'))[0].amount).toBe(100)
  expect(await rows(a.id, 'teamwin')).toHaveLength(0)
})

test('a person who predicts right AND owns the winner gets both (+400)', async () => {
  const [a] = await twoPeople()
  const f = await homeWinFixture()
  await db.insert(support).values({ sweepId: 'default', fixtureId: f.id, personId: a.id, teamCode: f.t1Code })
  await db.insert(ownership).values({ sweepId: 'default', personId: a.id, teamCode: f.t1Code })
  const granted = await grantMatchRewards(db, f.id)
  expect(granted).toBe(2)
  const all = await db.select().from(coinLedger).where(eq(coinLedger.personId, a.id))
  expect(all.reduce((s, r) => s + r.amount, 0)).toBe(400)
})

test('grantMatchRewards is idempotent (re-run grants nothing new)', async () => {
  const [a] = await twoPeople()
  const f = await homeWinFixture()
  await db.insert(support).values({ sweepId: 'default', fixtureId: f.id, personId: a.id, teamCode: f.t1Code })
  await db.insert(ownership).values({ sweepId: 'default', personId: a.id, teamCode: f.t1Code })
  await grantMatchRewards(db, f.id)
  const second = await grantMatchRewards(db, f.id)
  expect(second).toBe(0)
  expect(await rows(a.id, 'predict')).toHaveLength(1)
  expect(await rows(a.id, 'teamwin')).toHaveLength(1)
})

test('a non-final fixture grants nothing', async () => {
  const [a] = await twoPeople()
  const [f] = await db.select().from(fixture).limit(1)
  await db.update(fixture).set({ status: 'upcoming', winnerCode: null }).where(eq(fixture.id, f.id))
  await db.insert(support).values({ sweepId: 'default', fixtureId: f.id, personId: a.id, teamCode: f.t1Code })
  expect(await grantMatchRewards(db, f.id)).toBe(0)
})

test('rewards are granted under the row’s own sweep (isolation)', async () => {
  const [a] = await twoPeople()
  const f = await homeWinFixture()
  // a parallel sweep with its own person + a correct pick on the same fixture
  await db.insert(sweep).values({ id: 'other', name: 'Other' }).onConflictDoNothing()
  await db.insert(person).values({ id: 'pn_other', sweepId: 'other', name: 'Oth', short: 'Oth', initials: 'OT', avColor: '#999' }).onConflictDoNothing()
  await db.insert(support).values({ sweepId: 'other', fixtureId: f.id, personId: 'pn_other', teamCode: f.t1Code })
  await grantMatchRewards(db, f.id)
  const otherRow = (await rows('pn_other', 'predict'))[0]
  expect(otherRow.sweepId).toBe('other')
  // cleanup so the parallel sweep can't leak into sibling tests
  await db.delete(coinLedger).where(eq(coinLedger.sweepId, 'other'))
  await db.delete(support).where(eq(support.sweepId, 'other'))
  await db.delete(person).where(eq(person.sweepId, 'other'))
  await db.delete(sweep).where(eq(sweep.id, 'other'))
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test -w api -- coins-rewards`
Expected: FAIL — `grantMatchRewards is not a function` / cannot find `../src/coins/rewards.js`.

- [ ] **Step 5: Write the implementation**

Create `api/src/coins/rewards.js`:

```js
import { eq } from 'drizzle-orm'
import { fixture, support, ownership, coinLedger } from '../db/schema.js'
import { fixtureResult } from './settle.js'
import { PREDICT_REWARD, TEAM_WIN_REWARD } from './constants.js'

/**
 * For a final fixture, grant:
 *  - +PREDICT_REWARD to each person whose support pick matches the result;
 *  - +TEAM_WIN_REWARD to each owner of the winning team (no payout on a draw).
 * Both keyed by refId = fixtureId, inserted with onConflictDoNothing() so the
 * coin_ledger (sweepId, personId, type, refId) unique constraint makes re-runs no-ops.
 * Returns the number of NEW reward rows granted. Publishes one 'bet-settled' per touched
 * sweep (the web client invalidates the coins cache on it).
 */
export async function grantMatchRewards(db, fixtureId, publish = () => {}) {
  const [f] = await db.select().from(fixture).where(eq(fixture.id, fixtureId))
  if (!f || f.status !== 'final') return 0
  const result = fixtureResult(f) // 'HOME' | 'AWAY' | 'DRAW' | null
  if (!result) return 0

  const sweeps = new Set()
  let granted = 0

  // (a) correct predictions → +100
  const picks = await db.select().from(support).where(eq(support.fixtureId, fixtureId))
  for (const s of picks) {
    const pick = s.teamCode === 'DRAW' ? 'DRAW'
      : s.teamCode === f.t1Code ? 'HOME'
      : s.teamCode === f.t2Code ? 'AWAY'
      : null
    if (pick !== result) continue
    const ins = await db.insert(coinLedger)
      .values({ sweepId: s.sweepId, personId: s.personId, type: 'predict', amount: PREDICT_REWARD, refId: fixtureId })
      .onConflictDoNothing()
      .returning({ id: coinLedger.id })
    if (ins.length) { granted++; sweeps.add(s.sweepId) }
  }

  // (b) owned winning team → +300 per owner (no winner on a draw)
  if (result !== 'DRAW') {
    const winningTeam = result === 'HOME' ? f.t1Code : f.t2Code
    const owners = await db.select().from(ownership).where(eq(ownership.teamCode, winningTeam))
    for (const o of owners) {
      const ins = await db.insert(coinLedger)
        .values({ sweepId: o.sweepId, personId: o.personId, type: 'teamwin', amount: TEAM_WIN_REWARD, refId: fixtureId })
        .onConflictDoNothing()
        .returning({ id: coinLedger.id })
      if (ins.length) { granted++; sweeps.add(o.sweepId) }
    }
  }

  for (const sweepId of sweeps) await publish({ type: 'bet-settled', sweepId })
  return granted
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test -w api -- coins-rewards`
Expected: PASS (all 8 tests).

- [ ] **Step 7: Commit**

```bash
git add api/src/coins/constants.js api/src/db/schema.js api/src/coins/rewards.js api/test/coins-rewards.test.js
git commit -m "feat(api): grantMatchRewards — +100 correct prediction, +300 owned-team win"
```

---

## Task 2: Wire rewards into the worker (api)

**Files:**
- Modify: `api/src/worker.js`

The worker has no unit-test harness; `grantMatchRewards` is covered by Task 1. This task is a small wiring change verified by a build/parse check.

- [ ] **Step 1: Import the function**

In `api/src/worker.js`, add to the imports near `import { settleBets } from './coins/settle.js'`:

```js
import { grantMatchRewards } from './coins/rewards.js'
```

- [ ] **Step 2: Call it in the newly-final loop**

In `api/src/worker.js`, the existing loop is:

```js
        for (const r of newlyFinal) {
          try { await settleBets(db, r.id, (e) => publish(db, e)) }
          catch (e) { console.error(`[settleBets] fixture ${r.id} failed:`, e.message) }
        }
```

Change it to also grant match rewards (independent try/catch so one failure can't block the others):

```js
        for (const r of newlyFinal) {
          try { await settleBets(db, r.id, (e) => publish(db, e)) }
          catch (e) { console.error(`[settleBets] fixture ${r.id} failed:`, e.message) }
          try { await grantMatchRewards(db, r.id, (e) => publish(db, e)) }
          catch (e) { console.error(`[grantMatchRewards] fixture ${r.id} failed:`, e.message) }
        }
```

- [ ] **Step 3: Verify it parses/builds**

Run: `node --check api/src/worker.js`
Expected: no output (exit 0 — syntax valid).

Run: `npm run test -w api -- coins-rewards coins-settle`
Expected: PASS (sanity — the modules the worker imports still load and behave).

- [ ] **Step 4: Commit**

```bash
git add api/src/worker.js
git commit -m "feat(api): grant match rewards alongside bet settlement on final"
```

---

## Task 3: Surface `fixtureId` for reward rows in the statement (api)

**Files:**
- Modify: `api/src/coins/ledger.js`
- Test: `api/test/coins-ledger.test.js`

`statementFor` currently derives only `weekIndex` and `bet` from `type`. Reward rows
(`predict`/`teamwin`) key off `refId = fixtureId` (not a bet), so we surface `fixtureId`
on them for the frontend to resolve the match name.

- [ ] **Step 1: Write the failing test**

Append to `api/test/coins-ledger.test.js` (its header already imports `coinLedger`,
`statementFor`, `eq`, `and`, `sweep` and clears tables in `beforeEach`; `aPerson` exists):

```js
test('statementFor surfaces fixtureId (and bet:null) for predict/teamwin reward rows', async () => {
  const p = await aPerson()
  await db.insert(coinLedger).values({ sweepId: 'default', personId: p.id, type: 'predict', amount: 100, refId: 'fix_42' })
  await db.insert(coinLedger).values({ sweepId: 'default', personId: p.id, type: 'teamwin', amount: 300, refId: 'fix_42' })
  const { entries } = await statementFor(db, 'default', p.id)
  const predict = entries.find((e) => e.type === 'predict')
  const teamwin = entries.find((e) => e.type === 'teamwin')
  expect(predict).toMatchObject({ amount: 100, fixtureId: 'fix_42', bet: null, weekIndex: null })
  expect(teamwin).toMatchObject({ amount: 300, fixtureId: 'fix_42', bet: null, weekIndex: null })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w api -- coins-ledger`
Expected: FAIL — `predict.fixtureId` is `undefined` (the entry object has no `fixtureId` key).

- [ ] **Step 3: Implement**

In `api/src/coins/ledger.js`, in `statementFor`, the entry object currently is:

```js
    return {
      id: r.id,
      type: r.type,
      amount: r.amount,
      createdAt: r.createdAt,
      balanceAfter: running,
      weekIndex: r.type === 'grant' ? Number(r.refId) : null,
      bet: r.type === 'grant' ? null : (betById.get(r.refId) ?? null),
    }
```

Add a `fixtureId` field for the reward types:

```js
    return {
      id: r.id,
      type: r.type,
      amount: r.amount,
      createdAt: r.createdAt,
      balanceAfter: running,
      weekIndex: r.type === 'grant' ? Number(r.refId) : null,
      fixtureId: (r.type === 'predict' || r.type === 'teamwin') ? r.refId : null,
      bet: r.type === 'grant' ? null : (betById.get(r.refId) ?? null),
    }
```

(For `predict`/`teamwin`, `betById.get(r.refId)` is `undefined` → `bet` stays `null`, since `refId` is a fixture id, not a bet id.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w api -- coins-ledger`
Expected: PASS (new test green, existing statementFor tests still pass).

- [ ] **Step 5: Commit**

```bash
git add api/src/coins/ledger.js api/test/coins-ledger.test.js
git commit -m "feat(api): statementFor surfaces fixtureId for predict/teamwin rows"
```

---

## Task 4: Render reward rows in the statement (web)

**Files:**
- Modify: `web/src/screens-statement.jsx`
- Test: `web/src/screens-statement.test.jsx`

Add the two reward kinds: `predict` → gold stylish tick + "Correct prediction"; `teamwin`
→ gold team icon + "Your team won". Both resolve the match title from `S.fixture(e.fixtureId)`.

- [ ] **Step 1: Write the failing test**

Append to `web/src/screens-statement.test.jsx` (its `beforeEach` already sets `S.fixtures =
[{ id:'f1', t1:'arg', t2:'bra' }]`, `S.team = c => ({name: c.toUpperCase(), ...})`, and
`setMe('pn_a')`; `renderWith(entries, balance)` seeds the `['coins','ledger','pn_a']` cache):

```js
test('a correct-prediction reward row shows the match, +100 and a gold tick', () => {
  const { container } = renderWith([
    { id: 7, type: 'predict', amount: 100, weekIndex: null, balanceAfter: 1100, createdAt: '2026-06-18T00:00:00.000Z', bet: null, fixtureId: 'f1' },
  ], 1100)
  expect(screen.getByText('ARG v BRA')).toBeInTheDocument()
  expect(screen.getByText('Correct prediction')).toBeInTheDocument()
  expect(screen.getByText('+100')).toBeInTheDocument()
  expect(container.querySelector('.stmt-ic.predict')).toBeTruthy()
})

test('a team-win reward row shows the match, +300 and the team icon', () => {
  const { container } = renderWith([
    { id: 8, type: 'teamwin', amount: 300, weekIndex: null, balanceAfter: 1400, createdAt: '2026-06-18T00:00:00.000Z', bet: null, fixtureId: 'f1' },
  ], 1400)
  expect(screen.getByText('ARG v BRA')).toBeInTheDocument()
  expect(screen.getByText('Your team won')).toBeInTheDocument()
  expect(screen.getByText('+300')).toBeInTheDocument()
  expect(container.querySelector('.stmt-ic.teamwin')).toBeTruthy()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w web -- screens-statement`
Expected: FAIL — the reward rows render a fallback/blank (no `Correct prediction` text; no `.stmt-ic.predict`).

- [ ] **Step 3: Implement**

In `web/src/screens-statement.jsx`:

(a) Add `faUsers` to the Font Awesome import:

```js
import { faCoins, faTicket, faUsers } from '@fortawesome/free-solid-svg-icons'
```

(b) Add `teamwin` to `KIND_ICON`:

```js
const KIND_ICON = { dep: faCoins, bet: faTicket, teamwin: faUsers }
```

(c) `KindGlyph` renders the `Tick` for both `win` and `predict`:

```js
function KindGlyph({ kind }) {
  if (kind === 'win' || kind === 'predict') return <Tick />
  return <FontAwesomeIcon icon={KIND_ICON[kind]} />
}
```

(d) In `entryView(e)`, add a branch for the reward types BEFORE the bet logic (right after
the `grant`/`refund` handling). It resolves the match title the same way bet rows do:

```js
  if (e.type === 'predict' || e.type === 'teamwin') {
    const f = S.fixture(e.fixtureId)
    const match = f ? `${S.team(f.t1)?.name || f.t1} v ${S.team(f.t2)?.name || f.t2}` : null
    const sub = e.type === 'predict' ? 'Correct prediction' : 'Your team won'
    return { kind: e.type, title: match || sub, sub: match ? sub : '' }
  }
```

(The full current `entryView` head is:
```js
function entryView(e) {
  if (e.type === 'grant') return { kind: 'dep', title: e.weekIndex === 0 ? 'Starting bankroll' : 'Weekly Yowie Dollars', sub: 'Deposit' }
  if (e.type === 'refund') return { kind: 'dep', title: 'Refund', sub: '' }
  ...
```
Insert the new branch immediately after the `refund` line.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w web -- screens-statement`
Expected: PASS (both new tests + the existing 6).

- [ ] **Step 5: Commit**

```bash
git add web/src/screens-statement.jsx web/src/screens-statement.test.jsx
git commit -m "feat(web): statement rows for prediction (+100) and team-win (+300) rewards"
```

---

## Final verification

- [ ] **Step 1: Full suites + build**

Run: `npm run test -w api`
Expected: PASS.

Run: `npm run test -w web && npm run build`
Expected: PASS + build succeeds.

- [ ] **Step 2: No migration needed**

The `coin_ledger.type` column is free text; the new `predict`/`teamwin` values need no
schema migration. Skip `db:generate`/`db:migrate`.

- [ ] **Step 3: Manual smoke (optional, dev stack)**

Hard to exercise without a live final, but you can simulate: insert a `support` pick and an
`ownership` row for a fixture, mark it `status:'final'` + `winnerCode`, run
`grantMatchRewards` (e.g. via a one-off node REPL against the dev DB), then open Wagers →
Statement and confirm the "Correct prediction" (+100) and "Your team won" (+300) rows appear.
