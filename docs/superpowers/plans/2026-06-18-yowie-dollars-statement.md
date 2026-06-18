# Yowie Dollars Statement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only statement screen where a participant sees their own Yowie Dollars history — every grant, stake, and payout — newest first, with a running balance and a plain-English reason per row.

**Architecture:** The `coin_ledger` table is already an append-only signed-row ledger; only a `SUM()` (balance) is exposed today. We add (1) a `statementFor()` composer in `api/src/coins/ledger.js` that returns the ledger rows with a server-computed running balance and the matching bet attached, (2) a thin `GET /api/coins/ledger` route mirroring `GET /api/coins`'s person-validation, and (3) a web overlay `StatementScreen` reached from a "View statement" link on the Wagers screen. Team names and selection wording are composed client-side by reusing the bet-slip's existing helpers (`betSelectionLabel`, `MARKET_LABELS`) and `S.fixture()`.

**Tech Stack:** Node 22 ESM + Fastify 5 + Drizzle ORM (Postgres), Vitest + Testcontainers (api); Vite + React 18 + TanStack Query, Vitest + React Testing Library (web).

---

## File Structure

- `api/src/coins/ledger.js` — **modify**: add `statementFor(db, sweepId, personId, now)`. Lives beside `walletFor`/`leaderboard`/`serializeBet` (all ledger reads).
- `api/test/coins-ledger.test.js` — **modify**: unit tests for `statementFor` (running balance, grant weekIndex, bet attach, lost-bet, ordering, sweep isolation).
- `api/src/routes/coins.js` — **modify**: add `GET /api/coins/ledger` route.
- `api/test/coins.test.js` — **modify**: HTTP-level tests for the new route.
- `web/src/api/client.js` — **modify**: add `fetchLedger(personId)`.
- `web/src/api/client.test.js` — **modify**: test `fetchLedger` hits the right URL.
- `web/src/screens-coins.jsx` — **modify**: export `betSelectionLabel`, `betSelectionFlag`, `MARKET_LABELS`; add a "View statement" affordance in `CoinsScreen` (calls `openStatement` prop).
- `web/src/screens-statement.jsx` — **create**: `StatementScreen` overlay component.
- `web/src/screens-statement.test.jsx` — **create**: render tests for each row type + empty state.
- `web/src/App.jsx` — **modify**: import `StatementScreen`, add `openStatement()` navigator, register the `statement` overlay, pass `openStatement` to `CoinsScreen`.
- `web/src/hooks/useEventStream.js` — **modify**: also invalidate `['coins','ledger']` on `bet`/`bet-settled`.
- `web/src/styles.css` — **modify**: add `stmt-*` styles.

---

## Task 1: `statementFor` composer (api)

**Files:**
- Modify: `api/src/coins/ledger.js`
- Test: `api/test/coins-ledger.test.js`

- [ ] **Step 1: Write the failing test**

Append to `api/test/coins-ledger.test.js`. Note the existing header already imports `fixture, person, coinLedger` and `ensureGrants, balanceOf`; add `bet` to the schema import and `statementFor` to the ledger import, and import `and, eq`.

Change the existing import lines at the top of the file:

```js
import { and, eq } from 'drizzle-orm'
import { fixture, person, coinLedger, bet } from '../src/db/schema.js'
import { seasonAnchor, currentWeekIndex, ensureGrants, balanceOf, statementFor } from '../src/coins/ledger.js'
```

And update the existing `beforeEach` so bets are cleared too (it currently only clears `coinLedger`):

```js
beforeEach(async () => { await db.delete(bet); await db.delete(coinLedger) })
```

Then append these tests:

```js
// --- statementFor ---------------------------------------------------------

test('statementFor returns grants newest-first with weekIndex and a running balance', async () => {
  const p = await aPerson()
  const anchor = await seasonAnchor(db)
  const twoWeeksIn = new Date(anchor.getTime() + 2 * WEEK_MS + 1000)
  await ensureGrants(db, 'default', p.id, twoWeeksIn) // weeks 0,1,2 → 3000 total

  const { balance, entries } = await statementFor(db, 'default', p.id, twoWeeksIn)
  expect(balance).toBe(3000)
  expect(entries).toHaveLength(3)
  // newest first: week 2 grant on top, running balance is the final cumulative
  expect(entries[0]).toMatchObject({ type: 'grant', amount: 1000, weekIndex: 2, balanceAfter: 3000, bet: null })
  expect(entries[1]).toMatchObject({ type: 'grant', weekIndex: 1, balanceAfter: 2000 })
  expect(entries[2]).toMatchObject({ type: 'grant', weekIndex: 0, balanceAfter: 1000 })
})

test('statementFor attaches the matching bet to stake and payout rows', async () => {
  const p = await aPerson()
  const [f] = await db.select().from(fixture).limit(1)
  await ensureGrants(db, 'default', p.id) // week 0 grant: +1000
  // a won bet: stake -100, payout +230
  await db.insert(bet).values({ id: 'bet1', sweepId: 'default', personId: p.id, fixtureId: f.id,
    market: '1x2', selection: 'HOME', stake: 100, oddsDecimal: '2.3', book: 'Pinnacle',
    potentialPayout: 230, status: 'won' })
  await db.insert(coinLedger).values({ sweepId: 'default', personId: p.id, type: 'stake', amount: -100, refId: 'bet1' })
  await db.insert(coinLedger).values({ sweepId: 'default', personId: p.id, type: 'payout', amount: 230, refId: 'bet1' })

  const { balance, entries } = await statementFor(db, 'default', p.id)
  expect(balance).toBe(1130) // 1000 - 100 + 230
  const payout = entries.find((e) => e.type === 'payout')
  const stake = entries.find((e) => e.type === 'stake')
  expect(payout.bet).toMatchObject({ id: 'bet1', market: '1x2', selection: 'HOME', status: 'won', stake: 100 })
  expect(stake.bet).toMatchObject({ id: 'bet1', selection: 'HOME', status: 'won' })
  expect(stake.amount).toBe(-100)
})

test('statementFor leaves a lost bet as a lone stake row (no payout) carrying status lost', async () => {
  const p = await aPerson()
  const [f] = await db.select().from(fixture).limit(1)
  await ensureGrants(db, 'default', p.id)
  await db.insert(bet).values({ id: 'bet2', sweepId: 'default', personId: p.id, fixtureId: f.id,
    market: '1x2', selection: 'AWAY', stake: 200, oddsDecimal: '3', book: null,
    potentialPayout: 600, status: 'lost' })
  await db.insert(coinLedger).values({ sweepId: 'default', personId: p.id, type: 'stake', amount: -200, refId: 'bet2' })

  const { balance, entries } = await statementFor(db, 'default', p.id)
  expect(balance).toBe(800)
  expect(entries.filter((e) => e.type === 'payout')).toHaveLength(0)
  const stake = entries.find((e) => e.type === 'stake')
  expect(stake.bet).toMatchObject({ status: 'lost', selection: 'AWAY' })
})

test('statementFor sets bet=null when the ledger row references a pruned bet', async () => {
  const p = await aPerson()
  await ensureGrants(db, 'default', p.id)
  await db.insert(coinLedger).values({ sweepId: 'default', personId: p.id, type: 'stake', amount: -50, refId: 'gone' })
  const { entries } = await statementFor(db, 'default', p.id)
  const stake = entries.find((e) => e.type === 'stake')
  expect(stake.bet).toBeNull()
})

test('statementFor is isolated per sweep', async () => {
  const p = await aPerson()
  await db.insert(coinLedger).values({ sweepId: 'default', personId: p.id, type: 'grant', amount: 1000, refId: '0' })
  await db.insert(coinLedger).values({ sweepId: 'other', personId: p.id, type: 'grant', amount: 9999, refId: '0' })
  const { entries } = await statementFor(db, 'default', p.id)
  expect(entries.every((e) => e.amount !== 9999)).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w api -- coins-ledger`
Expected: FAIL — `statementFor is not a function` (import error / TypeError).

- [ ] **Step 3: Write minimal implementation**

In `api/src/coins/ledger.js`, add this function (place it after `walletFor`, before `leaderboard`). It reuses the existing `serializeBet` defined at the bottom of the file:

```js
/** A person's full ledger: every signed entry, newest-first, with a running balance and
 *  (for stake/payout/refund rows) the matching bet attached. Grants carry their weekIndex. */
export async function statementFor(db, sweepId, personId, now = new Date()) {
  await ensureGrants(db, sweepId, personId, now)
  const rows = await db.select().from(coinLedger)
    .where(and(eq(coinLedger.sweepId, sweepId), eq(coinLedger.personId, personId)))
    .orderBy(coinLedger.createdAt, coinLedger.id)
  const bets = await db.select().from(bet).where(and(eq(bet.sweepId, sweepId), eq(bet.personId, personId)))
  const betById = new Map(bets.map((b) => [b.id, serializeBet(b)]))
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
      bet: r.type === 'grant' ? null : (betById.get(r.refId) ?? null),
    }
  })
  entries.reverse() // newest first
  return { balance: running, entries }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w api -- coins-ledger`
Expected: PASS (all statementFor tests green, existing tests still pass).

- [ ] **Step 5: Commit**

```bash
git add api/src/coins/ledger.js api/test/coins-ledger.test.js
git commit -m "feat(api): statementFor — ledger entries with running balance + bet attach"
```

---

## Task 2: `GET /api/coins/ledger` route (api)

**Files:**
- Modify: `api/src/routes/coins.js`
- Test: `api/test/coins.test.js`

- [ ] **Step 1: Write the failing test**

Append to `api/test/coins.test.js` (its header already imports `person, coinLedger, bet, fixture`, `and, eq`, and has `aPerson`/`bettableFixture`/`balanceOfPerson` helpers):

```js
// --- GET /api/coins/ledger ------------------------------------------------

test('GET /api/coins/ledger returns the grant entry with a running balance', async () => {
  const p = await aPerson()
  const res = await app.inject({ method: 'GET', url: `/api/coins/ledger?personId=${p.id}` })
  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.balance).toBeGreaterThanOrEqual(1000)
  expect(Array.isArray(body.entries)).toBe(true)
  const grant = body.entries.find((e) => e.type === 'grant' && e.weekIndex === 0)
  expect(grant).toMatchObject({ amount: 1000, balanceAfter: 1000, bet: null })
})

test('GET /api/coins/ledger reflects a placed bet as a stake entry with its bet attached', async () => {
  const p = await aPerson(); const f = await bettableFixture()
  await balanceOfPerson(p.id) // seed grant
  await app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: f.id, personId: p.id, selection: 'HOME', stake: 100 } })
  const body = (await app.inject({ method: 'GET', url: `/api/coins/ledger?personId=${p.id}` })).json()
  // newest first → the stake entry is on top
  expect(body.entries[0]).toMatchObject({ type: 'stake', amount: -100 })
  expect(body.entries[0].bet).toMatchObject({ market: '1x2', selection: 'HOME', stake: 100, status: 'open' })
  expect(body.balance).toBe(body.entries[0].balanceAfter)
})

test('GET /api/coins/ledger with an unknown personId returns an empty statement, not an error', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/coins/ledger?personId=does_not_exist' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ balance: 0, entries: [] })
})

test('GET /api/coins/ledger with no personId returns an empty statement', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/coins/ledger' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ balance: 0, entries: [] })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w api -- test/coins.test.js`
Expected: FAIL — route returns 404 (`statusCode` 404, not 200).

- [ ] **Step 3: Write minimal implementation**

In `api/src/routes/coins.js`, update the import on line 5 to add `statementFor`:

```js
import { walletFor, leaderboard, ensureGrants, serializeBet, statementFor } from '../coins/ledger.js'
```

Then add this route inside `coinsRoutes`, right after the existing `GET /api/coins` handler (before `POST /api/bet`):

```js
  app.get('/api/coins/ledger', { preHandler: member }, async (req) => {
    const sweepId = req.sweep.id
    const me = req.query?.personId
    if (!me) return { balance: 0, entries: [] }
    // mirror GET /api/coins: validate the person belongs to this sweep before statementFor
    // (which grants/inserts), so a bogus ?personId returns empty rather than an FK error
    const [p] = await app.db.select().from(person).where(and(eq(person.id, me), eq(person.sweepId, sweepId)))
    if (!p) return { balance: 0, entries: [] }
    return statementFor(app.db, sweepId, me)
  })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w api -- test/coins.test.js`
Expected: PASS (new ledger route tests green, existing coins tests still pass).

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/coins.js api/test/coins.test.js
git commit -m "feat(api): GET /api/coins/ledger — personal statement endpoint"
```

---

## Task 3: `fetchLedger` API client (web)

**Files:**
- Modify: `web/src/api/client.js`
- Test: `web/src/api/client.test.js`

- [ ] **Step 1: Write the failing test**

In `web/src/api/client.test.js`, add `fetchLedger` to the existing import on line 2:

```js
import { fetchBootstrap, fetchFixtures, fetchStandings, fetchPhotos, fetchSyncStatus, fetchAll, fetchWallet, postBet, fetchLedger } from './client.js'
```

Then append this test. It matches the file's style (`vi.stubGlobal('fetch', …)`; `vi` is already imported; `beforeEach` already calls `vi.restoreAllMocks()`):

```js
test('fetchLedger requests the ledger endpoint with an encoded personId', async () => {
  const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ balance: 1000, entries: [] }) }))
  vi.stubGlobal('fetch', fetchSpy)
  const out = await fetchLedger('pn a/b')
  expect(fetchSpy).toHaveBeenCalledWith('/api/coins/ledger?personId=pn%20a%2Fb', { credentials: 'include' })
  expect(out).toEqual({ balance: 1000, entries: [] })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w web -- client`
Expected: FAIL — `fetchLedger is not a function` / `is not exported`.

- [ ] **Step 3: Write minimal implementation**

In `web/src/api/client.js`, add directly under the existing `fetchWallet` line (line 36):

```js
export const fetchLedger = (personId) => get(`/api/coins/ledger?personId=${encodeURIComponent(personId)}`)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w web -- client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/api/client.js web/src/api/client.test.js
git commit -m "feat(web): fetchLedger API client for the statement endpoint"
```

---

## Task 4: Export bet-label helpers from screens-coins (web)

**Files:**
- Modify: `web/src/screens-coins.jsx`

This is a pure refactor (no behaviour change) so `StatementScreen` can reuse the existing label logic instead of duplicating it. There is no separate test step — Task 6's tests exercise these exports, and the existing `screens-coins.test.jsx` must stay green.

- [ ] **Step 1: Add `export` to the three helpers**

In `web/src/screens-coins.jsx`, add the `export` keyword to the existing declarations (currently un-exported):

- Line 19 `const MARKET_LABELS = {` → `export const MARKET_LABELS = {`
- Line 27 `function betSelectionLabel(b) {` → `export function betSelectionLabel(b) {`
- Line 41 `function betSelectionFlag(b) {` → `export function betSelectionFlag(b) {`

Leave `selectionLabel` (line 11) as-is; it's used only by `BetSheet`.

- [ ] **Step 2: Verify nothing broke**

Run: `npm run test -w web -- screens-coins`
Expected: PASS (3 tests, unchanged — exporting does not change behaviour).

- [ ] **Step 3: Commit**

```bash
git add web/src/screens-coins.jsx
git commit -m "refactor(web): export bet-label helpers for reuse in the statement screen"
```

---

## Task 5: `StatementScreen` component (web)

**Files:**
- Create: `web/src/screens-statement.jsx`
- Test: `web/src/screens-statement.test.jsx`

`StatementScreen` is an overlay. It reads the signed-in person via `getMe()`, fetches the ledger with TanStack Query (`['coins','ledger', me.id]`), and renders a flat newest-first list. Each row: a reason label, a date, the signed amount (green credit / red debit), and the running balance. It reuses `betSelectionLabel` + `MARKET_LABELS` from `screens-coins.jsx` and `S.fixture()` for team names — exactly as `MyBets` does.

- [ ] **Step 1: Write the failing test**

Create `web/src/screens-statement.test.jsx`:

```jsx
import { expect, test, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StatementScreen } from './screens-statement.jsx'
import { setMe } from './social.js'
import { SWEEP as S } from './data.js'

function renderWith(entries, balance = 0) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // pre-seed the query cache so the component renders synchronously without a real fetch
  qc.setQueryData(['coins', 'ledger', 'pn_a'], { balance, entries })
  return render(
    <QueryClientProvider client={qc}>
      <StatementScreen onBack={() => {}} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  S.team = (c) => ({ code: c, name: c.toUpperCase(), flagCode: c })
  S.flag = (c) => `/flags/${c}.png`
  S.fixtures = [{ id: 'f1', t1: 'arg', t2: 'bra' }]
  S.fixture = (id) => S.fixtures.find((f) => f.id === id)
  setMe('pn_a')
})

test('renders a grant as a positive entry labelled Starting bankroll', () => {
  renderWith([
    { id: 1, type: 'grant', amount: 1000, weekIndex: 0, balanceAfter: 1000, createdAt: '2026-06-09T00:00:00.000Z', bet: null },
  ], 1000)
  expect(screen.getByText('Starting bankroll')).toBeInTheDocument()
  expect(screen.getByText('+1,000')).toBeInTheDocument()
})

test('weekly grant (weekIndex > 0) is labelled Weekly Yowie Dollars', () => {
  renderWith([
    { id: 2, type: 'grant', amount: 1000, weekIndex: 1, balanceAfter: 2000, createdAt: '2026-06-16T00:00:00.000Z', bet: null },
  ], 2000)
  expect(screen.getByText('Weekly Yowie Dollars')).toBeInTheDocument()
})

test('a lost stake shows the match, selection and (Lost), with a negative amount', () => {
  renderWith([
    { id: 3, type: 'stake', amount: -200, weekIndex: null, balanceAfter: 800, createdAt: '2026-06-17T00:00:00.000Z',
      bet: { id: 'b1', fixtureId: 'f1', market: '1x2', selection: 'AWAY', line: null, stake: 200, odds: 3, status: 'lost' } },
  ], 800)
  // AWAY → team t2 name (BRA); label includes match + (Lost)
  expect(screen.getByText(/BRA/)).toBeInTheDocument()
  expect(screen.getByText(/\(Lost\)/)).toBeInTheDocument()
  expect(screen.getByText('-200')).toBeInTheDocument()
})

test('a payout shows Won bet on the match and a positive amount', () => {
  renderWith([
    { id: 4, type: 'payout', amount: 230, weekIndex: null, balanceAfter: 1230, createdAt: '2026-06-18T00:00:00.000Z',
      bet: { id: 'b2', fixtureId: 'f1', market: '1x2', selection: 'HOME', line: null, stake: 100, odds: 2.3, status: 'won' } },
  ], 1230)
  expect(screen.getByText(/Won bet/)).toBeInTheDocument()
  expect(screen.getByText('+230')).toBeInTheDocument()
})

test('shows an empty state when there are no entries', () => {
  renderWith([], 0)
  expect(screen.getByText(/No activity yet/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w web -- screens-statement`
Expected: FAIL — cannot resolve `./screens-statement.jsx`.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/screens-statement.jsx`:

```jsx
/* ============================================================
   THE SWEEP — Statement screen: a person's Yowie Dollars ledger
   ============================================================ */
import { useQuery } from '@tanstack/react-query'
import { SWEEP as S } from './data.js'
import { getMe } from './social.js'
import { fetchLedger } from './api/client.js'
import { Icon } from './components.jsx'
import { betSelectionLabel, MARKET_LABELS } from './screens-coins.jsx'

/** Human reason for one ledger entry. Reuses the bet-slip helpers for selection wording. */
function entryLabel(e) {
  if (e.type === 'grant') return e.weekIndex === 0 ? 'Starting bankroll' : 'Weekly Yowie Dollars'
  if (e.type === 'refund') return 'Refund'
  const b = e.bet
  if (!b) return e.type === 'payout' ? 'Bet payout' : 'Bet placed'
  const f = S.fixture(b.fixtureId)
  const match = f ? `${S.team(f.t1)?.name || f.t1} v ${S.team(f.t2)?.name || f.t2}` : b.fixtureId
  const sel = betSelectionLabel(b)
  const mkt = MARKET_LABELS[b.market] || b.market
  if (e.type === 'payout') return `Won bet · ${match} — ${sel}`
  const status = b.status && b.status !== 'open' ? ` (${b.status.charAt(0).toUpperCase() + b.status.slice(1)})` : ''
  return `${match} — ${sel} · ${mkt}${status}`
}

function fmtDate(iso) {
  const d = iso ? new Date(iso) : null
  return d ? d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : ''
}

const fmtAmount = (n) => `${n > 0 ? '+' : n < 0 ? '-' : ''}${Math.abs(n).toLocaleString()}`

export function StatementScreen({ onBack }) {
  const me = getMe()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['coins', 'ledger', me?.id],
    queryFn: () => fetchLedger(me.id),
    enabled: !!me,
  })
  const entries = data?.entries ?? []

  return (
    <div className="screen screen-anim" data-testid="statement-screen" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="stmt-head">
        <button className="coin-back" onClick={onBack} aria-label="Back"><Icon.back /></button>
        <h2 className="stmt-title">Statement</h2>
        <div className="stmt-bal"><Icon.coin /><span>{(data?.balance ?? 0).toLocaleString()}</span></div>
      </div>

      <div className="scroll pad screen-anim">
        <div className="wrap" style={{ marginTop: 14 }}>
          {isError ? (
            <div className="block" style={{ padding: '16px 14px', color: 'var(--muted)', fontSize: 13 }}>
              Couldn’t load your statement — pull down or try again.
            </div>
          ) : isLoading ? (
            <div className="block" style={{ padding: '16px 14px', color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
          ) : entries.length === 0 ? (
            <div className="block" style={{ padding: '16px 14px', color: 'var(--muted)', fontSize: 13 }}>No activity yet.</div>
          ) : (
            <div className="block stmt-list">
              {entries.map((e) => {
                const credit = e.amount > 0
                return (
                  <div key={e.id} className="stmt-row">
                    <div className="stmt-main">
                      <span className="stmt-label">{entryLabel(e)}</span>
                      <span className="stmt-date">{fmtDate(e.createdAt)}</span>
                    </div>
                    <div className="stmt-side">
                      <span className={'stmt-amt ' + (credit ? 'up' : 'down')}>{fmtAmount(e.amount)}</span>
                      <span className="stmt-running">{e.balanceAfter.toLocaleString()}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w web -- screens-statement`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/screens-statement.jsx web/src/screens-statement.test.jsx
git commit -m "feat(web): StatementScreen — Yowie Dollars ledger overlay"
```

---

## Task 6: Wire the overlay + entry point into App and CoinsScreen (web)

**Files:**
- Modify: `web/src/App.jsx`
- Modify: `web/src/screens-coins.jsx`
- Test: `web/src/screens-coins.test.jsx`

- [ ] **Step 1: Write the failing test**

Append to `web/src/screens-coins.test.jsx` (its `beforeEach` already sets up `S`, `setMe('pn_a')`, and a wallet):

```js
test('the View statement link calls openStatement', () => {
  const openStatement = vi.fn()
  render(<CoinsScreen go={() => {}} openBet={() => {}} openStatement={openStatement} />)
  fireEvent.click(screen.getByRole('button', { name: /view statement/i }))
  expect(openStatement).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w web -- screens-coins`
Expected: FAIL — no element with accessible name "view statement".

- [ ] **Step 3a: Add the entry point to `CoinsScreen`**

In `web/src/screens-coins.jsx`, change the `CoinsScreen` signature to accept `openStatement`:

```jsx
export function CoinsScreen({ go, openBet, openMatch, openStatement }) {
```

Then, inside the `return`, add a "View statement" button in the same `wrap` that holds the tab toggle — directly after the `</div>` that closes the `statseg` block and before that `wrap` closes. The existing block is:

```jsx
      {/* Tab toggle */}
      <div className="wrap" style={{ paddingTop: 12, paddingBottom: 0 }}>
        <div className="statseg" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <button
            className={'statseg-opt' + (tab === 'place' ? ' on' : '')}
            onClick={() => setTab('place')}
          >Place a bet</button>
          <button
            className={'statseg-opt' + (tab === 'bets' ? ' on' : '')}
            onClick={() => setTab('bets')}
          >My bets</button>
        </div>
      </div>
```

Replace it with (adds the statement link below the toggle, only when signed in):

```jsx
      {/* Tab toggle */}
      <div className="wrap" style={{ paddingTop: 12, paddingBottom: 0 }}>
        <div className="statseg" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <button
            className={'statseg-opt' + (tab === 'place' ? ' on' : '')}
            onClick={() => setTab('place')}
          >Place a bet</button>
          <button
            className={'statseg-opt' + (tab === 'bets' ? ' on' : '')}
            onClick={() => setTab('bets')}
          >My bets</button>
        </div>
        {me && openStatement && (
          <button type="button" className="stmt-link" onClick={openStatement}>
            View statement <Icon.chev />
          </button>
        )}
      </div>
```

- [ ] **Step 3b: Run the CoinsScreen test to confirm it passes**

Run: `npm run test -w web -- screens-coins`
Expected: PASS (4 tests).

- [ ] **Step 3c: Wire the overlay into `App.jsx`**

In `web/src/App.jsx`:

1. Add the import after the `BetDetail` import (line 24):

```jsx
import { StatementScreen } from "./screens-statement.jsx";
```

2. Add the navigator next to `openBet` (after line 121):

```jsx
  const openStatement = () => navigate({ overlay: { type: "statement" } });
```

3. Pass it to `CoinsScreen` — change the `tab==="coins"` branch (lines 141-143) so the prop is forwarded:

```jsx
  else if (tab==="coins")    base = canWager()
    ? <CoinsScreen go={go} openBet={openBet} openMatch={openMatch} openStatement={openStatement}/>
    : <HomeScreen go={go} openMatch={openMatch} openTeam={openTeam} openPerson={openPerson} openPhoto={openPhoto} onAdmin={openAdmin} onSweeps={openSweeps}/>;
```

4. Register the overlay — add after the `betdetail` overlay line (line 151):

```jsx
  else if (overlay?.type==="statement") ov = <StatementScreen onBack={goBack}/>;
```

- [ ] **Step 4: Run the full web suite + the app build**

Run: `npm run test -w web`
Expected: PASS (all suites green).

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add web/src/App.jsx web/src/screens-coins.jsx web/src/screens-coins.test.jsx
git commit -m "feat(web): open the statement overlay from the Wagers screen"
```

---

## Task 7: Keep the statement live via SSE (web)

**Files:**
- Modify: `web/src/hooks/useEventStream.js`
- Test: `web/src/hooks/useEventStream.test.jsx`

The existing handler invalidates `['coins']` on `bet`/`bet-settled`. The statement query key is `['coins','ledger', personId]`. TanStack Query's `invalidateQueries({ queryKey: ['coins'] })` matches by prefix, so `['coins','ledger', id]` is **already** invalidated by the existing call. We add a focused test to lock that behaviour in and guard against a future change to the key.

- [ ] **Step 1: Write the failing-or-guard test**

In `web/src/hooks/useEventStream.test.jsx`, append this test. It uses the file's existing `setup()` helper (returns `{ spy, es }` where `spy` is `vi.spyOn(qc, 'invalidateQueries')` and `es` is the fake EventSource):

```js
test('bet-settled invalidates the coins query (prefix covers the statement ledger key)', () => {
  const { spy, es } = setup()
  es.emit({ type: 'bet-settled' })
  // ['coins'] is a prefix of the statement key ['coins','ledger',id], so this one call
  // refreshes both the wallet and the open statement — no separate invalidation needed.
  expect(spy).toHaveBeenCalledWith({ queryKey: ['coins'] })
})
```

- [ ] **Step 2: Run test to verify current behaviour**

Run: `npm run test -w web -- useEventStream`
Expected: PASS — the existing handler (`useEventStream.js:62`) already invalidates `['coins']`. This task locks that in. If it ever fails because the key was narrowed, do Step 3.

- [ ] **Step 3: Implementation (only if Step 2 failed)**

If — and only if — the test failed, ensure the `bet`/`bet-settled` branch in `web/src/hooks/useEventStream.js` invalidates the prefix:

```js
      } else if (ev.type === 'bet' || ev.type === 'bet-settled') {
        qc.invalidateQueries({ queryKey: ['coins'] }) // prefix → covers ['coins','ledger',id]
```

(No change is expected; the current code on line 62 already does this.)

- [ ] **Step 4: Re-run**

Run: `npm run test -w web -- useEventStream`
Expected: PASS.

- [ ] **Step 5: Commit (only if files changed)**

```bash
git add web/src/hooks/useEventStream.test.jsx web/src/hooks/useEventStream.js
git commit -m "test(web): lock statement-query invalidation on bet SSE events"
```

---

## Task 8: Statement styles (web)

**Files:**
- Modify: `web/src/styles.css`

Visual only — no test. Verify by build + a manual glance.

- [ ] **Step 1: Add the styles**

Append to `web/src/styles.css` (near the other `coin-*` rules). These reuse the existing theme tokens (`--bg`, `--muted`, `--line`, `--ok`/green, `--bad`/red — match the tokens already used elsewhere in this file; if `--ok`/`--bad` don't exist, use the same colours the `coin-won`/`coin-lost` pills use):

```css
/* ---- Statement (Yowie Dollars ledger) ---- */
.stmt-head { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--line); }
.stmt-title { flex: 1; font-size: 18px; font-weight: 700; margin: 0; }
.stmt-bal { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; }
.stmt-link { display: inline-flex; align-items: center; gap: 4px; margin: 10px 2px 0; padding: 0; background: none; border: 0; color: var(--muted); font-size: 13px; cursor: pointer; }
.stmt-link svg { width: 14px; height: 14px; }
.stmt-list { padding: 4px 0; }
.stmt-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
.stmt-row:last-child { border-bottom: 0; }
.stmt-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.stmt-label { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
.stmt-date { font-size: 12px; color: var(--muted); }
.stmt-side { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; white-space: nowrap; }
.stmt-amt { font-weight: 700; font-variant-numeric: tabular-nums; }
.stmt-amt.up { color: var(--ok, #1a7f37); }
.stmt-amt.down { color: var(--bad, #cf222e); }
.stmt-running { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: build succeeds (CSS valid).

- [ ] **Step 3: Commit**

```bash
git add web/src/styles.css
git commit -m "style(web): statement screen rows + view-statement link"
```

---

## Final verification

- [ ] **Step 1: Full api + web suites and build**

Run: `npm run test -w api`
Expected: PASS.

Run: `npm run test -w web && npm run build`
Expected: PASS + build succeeds.

- [ ] **Step 2: Migrate the shared dev DB if needed**

No schema change in this feature (the `coin_ledger`/`bet` tables already exist), so **no migration is required**. Skip `db:generate`/`db:migrate`.

- [ ] **Step 3: Manual smoke (optional, dev stack)**

With the dev API + web running and signed in as an adult: open Wagers → tap "View statement" → confirm the week-0 "Starting bankroll" row appears with a running balance; place a bet and confirm a new "stake" row appears (negative) after the SSE refresh.
