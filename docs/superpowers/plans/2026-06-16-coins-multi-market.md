# Coins Multi-Market Betting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand Coins betting from one market (1X2) to five Pinnacle-sourced markets per fixture (1X2, Goals O/U 2.5, Cards O/U, First Half Result, Correct Score), all settled from the feed, and redesign the Coins screen (Place a bet / My bets tabs, day-split list with flags, fixture bet-detail overlay).

**Architecture:** A normalized `markets` jsonb on `fixture` (filled by the worker from a single best-ranked bookmaker, mirrored by the seed) is the source of offered prices. `bet` gains `market` + `line`; settlement dispatches per market via `resolveBet(...)` using final score, half-time score, and card-event count. Frontend reads `fixture.markets`.

**Tech Stack:** Node 22 ESM, Fastify 5, Drizzle ORM over Postgres, Vitest + `@testcontainers/postgresql`; Vite + React 18, TanStack Query.

**Spec:** `docs/superpowers/specs/2026-06-16-coins-multi-market-design.md`

**Conventions:** api tests in `api/test/*.test.js` use `openTestDb()` + `buildApp(db,{publish})`; run one file with `npm run test -w api -- <file>`, all with `npm run test`. Web tests: `npm run test -w web -- <file>`. Docker must be running. After a schema change: `npm run db:generate -w api` then `npm run db:migrate -w api`.

**Migration order (important):** columns are **added** first (Task 3) and the obsolete `odds_*` columns are **dropped last** (Task 9), after all code stops referencing them — so every commit stays green.

---

## File Structure

**Backend (modify):**
- `api/src/providers/mapping.js` — add `mapMarkets`, extend `mapFixture` (HT score); remove `mapOdds` once unused (Task 4).
- `api/src/providers/api-football-provider.js` — `fetchOdds` returns `mapMarkets(j)`.
- `api/src/db/schema.js` — `fixture`: add `markets` jsonb + `htScore1/2`, later drop `odds_*`; `bet`: add `market` + `line`.
- `api/src/worker/baseline-sync.js` — persist `markets` + `htScore`.
- `api/src/worker/live-poller.js` — `pollLive` also captures `htScore1/2`.
- `api/src/serialize.js` — expose `markets`, drop `odds`.
- `api/src/coins/settle.js` — add `resolveBet`, dispatch in `settleBets`.
- `api/src/routes/coins.js` — `POST /api/bet` market+selection; serialize `market`+`line`.
- `api/src/coins/ledger.js` (`serializeBet`) — include `market`, `line`.
- `api/src/seed/generate.js` + `seed.js` — emit `markets` + `htScore`.

**Frontend (modify/create):**
- `web/src/lib/assemble.js` — carry `markets`.
- `web/src/coins.js` — `placeBet(fixtureId, market, selection)`.
- `web/src/api/client.js` — `postBet` body `{ fixtureId, personId, market, selection, stake }`.
- `web/src/screens-coins.jsx` — tabs, day-split, flags, inline 1X2.
- `web/src/screens-bet-detail.jsx` (new) — fixture bet-detail overlay (all markets).
- `web/src/App.jsx` — `betdetail` overlay wiring.

---

## Phase A — Provider & data model

### Task 1: `mapMarkets` — extract 5 markets from one book

**Files:** Modify `api/src/providers/mapping.js`; Test `api/test/mapping.test.js`

This is an **additive** new export. `mapOdds` stays untouched for now (removed in Task 4).

- [ ] **Step 1: Write failing tests** (append to `api/test/mapping.test.js`)

```js
import { mapMarkets } from '../src/providers/mapping.js'

const oddsResp = (bookmakers) => ({ response: [{ bookmakers }] })
const ov = (value, odd) => ({ value, odd: String(odd) })
const pinnacleBook = {
  name: 'Pinnacle', bets: [
    { name: 'Match Winner', values: [ov('Home', 2.0), ov('Draw', 3.5), ov('Away', 4.0)] },
    { name: 'First Half Winner', values: [ov('Home', 2.6), ov('Draw', 2.1), ov('Away', 5.5)] },
    { name: 'Goals Over/Under', values: [ov('Over 1.5', 1.4), ov('Under 1.5', 3.0), ov('Over 2.5', 2.25), ov('Under 2.5', 1.7), ov('Over 3.5', 4.0), ov('Under 3.5', 1.25)] },
    { name: 'Cards Over/Under', values: [ov('Over 2.5', 1.3), ov('Under 2.5', 3.4), ov('Over 3.5', 1.6), ov('Under 3.5', 2.3)] },
    { name: 'Exact Score', values: [ov('1:0', 5.0), ov('2:1', 8.5), ov('1:1', 8.5), ov('bad', 1.0)] },
  ],
}

test('mapMarkets builds all five markets from the best-ranked book', () => {
  const r = mapMarkets(oddsResp([{ name: 'SomeBook', bets: [] }, pinnacleBook]))
  expect(r.book).toBe('Pinnacle')
  expect(Object.keys(r.markets).sort()).toEqual(['1x2', 'cards', 'cs', 'fh1x2', 'ou25'])
  expect(r.markets['1x2'].selections.map(s => s.key)).toEqual(['HOME', 'DRAW', 'AWAY'])
  expect(r.markets['ou25']).toMatchObject({ line: 2.5 })
  expect(r.markets['ou25'].selections.find(s => s.key === 'OVER').odds).toBe(2.25)
  // cards prefers the 3.5 line (3.5 → 4.5 → 2.5)
  expect(r.markets['cards'].line).toBe(3.5)
  // correct score keeps only valid "H:A" scorelines with odds > 1
  expect(r.markets['cs'].selections.map(s => s.key)).toEqual(['1:0', '2:1', '1:1'])
  // implied percents for the ProbBar, summing to 100
  expect(r.prob.a + r.prob.d + r.prob.b).toBe(100)
})

test('mapMarkets returns null when no usable book/markets', () => {
  expect(mapMarkets(oddsResp([]))).toBeNull()
  // an incomplete Match Winner (single value) yields no markets → null (empty markets ⇒ null)
  expect(mapMarkets(oddsResp([{ name: 'X', bets: [{ name: 'Match Winner', values: [ov('Home', 2)] }] }]))).toBeNull()
})
```

- [ ] **Step 2: Run to confirm fail**

Run: `npm run test -w api -- mapping.test.js` → FAIL (`mapMarkets` undefined).

- [ ] **Step 3: Implement `mapMarkets`** (add to `api/src/providers/mapping.js`, reuse the existing `roundTo100`)

```js
const PREF_CARD_LINES = [3.5, 4.5, 2.5]

function pickBook(bookmakers) {
  const ranked = [...bookmakers].sort((x, y) => {
    const rx = BOOK_RANK.indexOf(x.name), ry = BOOK_RANK.indexOf(y.name)
    return (rx === -1 ? Infinity : rx) - (ry === -1 ? Infinity : ry)
  })
  return ranked[0] ?? null
}
const findBet = (bk, name) => (bk.bets ?? []).find((b) => b.name === name)
const oddOf = (bet, value) => {
  const o = Number(bet?.values?.find((v) => v.value === value)?.odd)
  return Number.isFinite(o) && o > 1 ? o : null
}
const threeWay = (bet, label) => {
  const h = oddOf(bet, 'Home'), d = oddOf(bet, 'Draw'), a = oddOf(bet, 'Away')
  if (!(h && d && a)) return null
  return { label, selections: [
    { key: 'HOME', label: 'Home', odds: h }, { key: 'DRAW', label: 'Draw', odds: d }, { key: 'AWAY', label: 'Away', odds: a } ] }
}

/**
 * /odds response → { markets, book, prob:{a,d,b} } or null. All markets come from one
 * bookmaker (BOOK_RANK order, else first present). A market the book doesn't fully carry
 * is omitted. `prob` is the implied 1X2 win % (for the ProbBar). Returns null if no markets.
 */
export function mapMarkets(rawResponse) {
  const bk = pickBook(rawResponse?.response?.[0]?.bookmakers ?? [])
  if (!bk) return null
  const markets = {}
  let prob = null

  const mw = threeWay(findBet(bk, 'Match Winner'), 'Match Winner')
  if (mw) {
    markets['1x2'] = { ...mw, book: bk.name }
    const odds = mw.selections.map((s) => s.odds)
    const implied = odds.map((o) => 1 / o)
    const sum = implied.reduce((s, n) => s + n, 0)
    const [a, d, b] = roundTo100(implied.map((p) => p / sum))
    prob = { a, d, b }
  }
  const fh = threeWay(findBet(bk, 'First Half Winner'), 'First Half Result')
  if (fh) markets['fh1x2'] = { ...fh, book: bk.name }

  const gou = findBet(bk, 'Goals Over/Under')
  const go = oddOf(gou, 'Over 2.5'), gu = oddOf(gou, 'Under 2.5')
  if (go && gu) markets['ou25'] = { label: 'Over/Under 2.5', line: 2.5, book: bk.name,
    selections: [{ key: 'OVER', label: 'Over 2.5', odds: go }, { key: 'UNDER', label: 'Under 2.5', odds: gu }] }

  const cou = findBet(bk, 'Cards Over/Under')
  if (cou) for (const line of PREF_CARD_LINES) {
    const co = oddOf(cou, `Over ${line}`), cu = oddOf(cou, `Under ${line}`)
    if (co && cu) { markets['cards'] = { label: 'Cards Over/Under', line, book: bk.name,
      selections: [{ key: 'OVER', label: `Over ${line}`, odds: co }, { key: 'UNDER', label: `Under ${line}`, odds: cu }] }; break }
  }

  const es = findBet(bk, 'Exact Score')
  if (es) {
    const sels = (es.values ?? [])
      .map((v) => ({ key: v.value, label: String(v.value).replace(':', '-'), odds: Number(v.odd) }))
      .filter((s) => /^\d+:\d+$/.test(s.key) && Number.isFinite(s.odds) && s.odds > 1)
    if (sels.length) markets['cs'] = { label: 'Correct Score', book: bk.name, selections: sels }
  }

  if (Object.keys(markets).length === 0) return null
  return { markets, book: bk.name, prob }
}
```

- [ ] **Step 4: Run to confirm pass** — `npm run test -w api -- mapping.test.js` → PASS.
- [ ] **Step 5: Commit**

```bash
git add api/src/providers/mapping.js api/test/mapping.test.js
git commit -m "feat(api): mapMarkets — extract five markets from one bookmaker"
```

### Task 2: `mapFixture` captures half-time score

**Files:** Modify `api/src/providers/mapping.js` (`mapFixture`); Test `api/test/mapping.test.js`

- [ ] **Step 1: Failing test** (append)

```js
test('mapFixture captures the half-time score', () => {
  const raw = { fixture: { id: 7, date: '2026-06-20T18:00:00Z', status: { short: 'FT', elapsed: 90 }, venue: {} },
    league: { round: 'Group Stage - 1' }, teams: { home: { id: 1, winner: true }, away: { id: 2, winner: false } },
    goals: { home: 2, away: 1 }, score: { halftime: { home: 1, away: 0 } } }
  const f = mapFixture(raw)
  expect(f.htScore1).toBe(1)
  expect(f.htScore2).toBe(0)
})

test('mapFixture half-time score is null when absent', () => {
  const raw = { fixture: { id: 7, date: '2026-06-20T18:00:00Z', status: { short: 'NS', elapsed: null }, venue: {} },
    league: { round: 'Group Stage - 1' }, teams: { home: { id: 1 }, away: { id: 2 } }, goals: {} }
  expect(mapFixture(raw).htScore1).toBeNull()
})
```

- [ ] **Step 2: Run** → FAIL (`htScore1` undefined).
- [ ] **Step 3: Implement** — in `mapFixture`'s returned object add:

```js
    htScore1: raw.score?.halftime?.home ?? null,
    htScore2: raw.score?.halftime?.away ?? null,
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit**

```bash
git add api/src/providers/mapping.js api/test/mapping.test.js
git commit -m "feat(api): mapFixture captures half-time score"
```

### Task 3: Schema — add `markets`/`htScore` + bet `market`/`line` (additive)

**Files:** Modify `api/src/db/schema.js`; new migration.

- [ ] **Step 1: Add columns** — in `fixture` (after `winnerCode`):

```js
  markets: jsonb('markets'),
  htScore1: integer('ht_score1'),
  htScore2: integer('ht_score2'),
```

In `bet` (after `selection`):

```js
  market: text('market').notNull().default('1x2'),
  line: numeric('line'),
```

(`jsonb`, `integer`, `numeric`, `text` are already imported.)

- [ ] **Step 2: Generate + apply** — `npm run db:generate -w api` (inspect: only ADDs `markets`, `ht_score1`, `ht_score2` to fixture and `market`, `line` to bet — no drops). Then `npm run db:migrate -w api`.
- [ ] **Step 3: Commit**

```bash
git add api/src/db/schema.js api/migrations
git commit -m "feat(api): add markets/ht-score + bet market/line columns"
```

### Task 4: Worker persists markets + half-time score

**Files:** Modify `api/src/providers/api-football-provider.js`, `api/src/worker/baseline-sync.js`, `api/src/worker/live-poller.js`, `api/src/providers/mapping.js` (remove `mapOdds`); Tests `api/test/api-football-provider.test.js`, `api/test/baseline-sync.test.js`

- [ ] **Step 1: Update failing tests**

In `api/test/api-football-provider.test.js`, the `fetchOdds` test now expects the markets shape. Replace its assertion:

```js
  const r = await p.fetchOdds('9002')
  // ...url assertions unchanged...
  expect(r.book).toBe('B')
  expect(r.markets['1x2'].selections.map(s => s.key)).toEqual(['HOME', 'DRAW', 'AWAY'])
  expect(r.prob.a + r.prob.d + r.prob.b).toBe(100)
```

(The test's `fakeFetch` `/odds` fixture has a single book `B` with a Match Winner market — that yields `markets['1x2']` + `prob`.)

In `api/test/baseline-sync.test.js`, update the odds test: configure the fake provider's `fetchOdds` to return `{ markets: { '1x2': { label:'Match Winner', book:'Pinnacle', selections:[{key:'HOME',label:'Home',odds:2},{key:'DRAW',label:'Draw',odds:3.5},{key:'AWAY',label:'Away',odds:4}] } }, book:'Pinnacle', prob:{a:50,d:25,b:25} }` and the fixture to carry `htScore1:1, htScore2:0`. Assert:

```js
  const [f] = await db.select().from(fixture).where(eq(fixture.id, KNOWN_ID))
  expect(f.markets['1x2'].selections[0].odds).toBe(2)
  expect(f.probA).toBe(50)
  expect(f.htScore1).toBe(1)
  expect(f.winnerCode).toBe(f.t1Code)
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**

In `api-football-provider.js`, change the `fetchOdds` mapper import + call: `import { ..., mapMarkets } from './mapping.js'` and `async fetchOdds(fixtureId){ const j = await get('/odds', { fixture: fixtureId }); return mapMarkets(j) }`. Remove the `mapOdds` import.

In `mapping.js`, delete the now-unused `mapOdds` function (keep `BOOK_RANK`, `roundTo100`).

In `baseline-sync.js`, replace the odds block. The per-fixture loop becomes:

```js
      const winnerCode = f.winnerSide === 'home' ? f.t1Code : f.winnerSide === 'away' ? f.t2Code : f.winnerSide === 'draw' ? 'DRAW' : null
      const m = mById.get(f.id)            // { markets, book, prob } | null
      const marketsSet = m?.markets ? { markets: m.markets } : {}
```

Replace the earlier odds-fetch loop so it stores the markets result keyed by id, and derives `prob` from it:

```js
    const mById = new Map()
    for (const f of fixtures) {
      let m = null
      try { m = await provider.fetchOdds(f.id) } catch { /* best-effort */ }
      let prob = m?.prob ?? null
      if (!prob) { try { prob = await provider.fetchPredictions(f.id) } catch { /* best-effort */ } }
      if (m) mById.set(f.id, m)
      if (prob) probById.set(f.id, prob)
    }
```

In the insert `.values({...})` and `onConflictDoUpdate.set`, replace the old `...oddsSet` with `...marketsSet`, and add `htScore1: f.htScore1 ?? null, htScore2: f.htScore2 ?? null` (in both values and set), keeping `probA/D/B` from `prob` and `winnerCode`. Remove all `oddsHome/oddsDraw/oddsAway/oddsBook` references.

In `live-poller.js` `pollLive`, add htScore capture so it's set by the time a match goes final. In the change-detection `.set({...})`, add `htScore1: f.htScore1, htScore2: f.htScore2` and include them in the change check (or just always write them):

```js
      await db.update(fixture)
        .set({ status: f.status, score1: f.score1, score2: f.score2, minute: f.minute,
               htScore1: f.htScore1, htScore2: f.htScore2, updatedAt: new Date() })
        .where(eq(fixture.id, f.id))
```

- [ ] **Step 4: Run** — `npm run test -w api -- mapping.test.js api-football-provider.test.js baseline-sync.test.js live-poller.test.js` → PASS.
- [ ] **Step 5: Commit**

```bash
git add api/src/providers api/src/worker/baseline-sync.js api/src/worker/live-poller.js api/test
git commit -m "feat(api): worker persists markets + half-time score"
```

### Task 5: Serialize markets; assemble carries them

**Files:** Modify `api/src/serialize.js`, `web/src/lib/assemble.js`; Tests `api/test/serialize.test.js`

- [ ] **Step 1: Update failing tests** — replace the two `odds`-field tests in `api/test/serialize.test.js` with:

```js
test('serializeFixture exposes markets and half-time score', () => {
  const markets = { '1x2': { label: 'Match Winner', book: 'Pinnacle', selections: [{ key: 'HOME', label: 'Home', odds: 2 }] } }
  const out = serializeFixture({ id: '1', group: 'A', matchday: 1, t1Code: 'arg', t2Code: 'bra',
    kickoffUtc: new Date(), venue: '', city: '', status: 'final', score1: 2, score2: 1, minute: null,
    probA: 50, probD: 25, probB: 25, markets, htScore1: 1, htScore2: 0,
    stage: 'group', derby: false, doubleOwner: false })
  expect(out.markets).toEqual(markets)
  expect(out.htScore).toEqual([1, 0])
})

test('serializeFixture markets null + htScore null when absent', () => {
  const out = serializeFixture({ id: '1', group: 'A', matchday: 1, t1Code: 'arg', t2Code: 'bra',
    kickoffUtc: new Date(), venue: '', city: '', status: 'upcoming', score1: null, score2: null, minute: null,
    probA: null, probD: null, probB: null, markets: null, htScore1: null, htScore2: null,
    stage: 'group', derby: false, doubleOwner: false })
  expect(out.markets).toBeNull()
  expect(out.htScore).toBeNull()
})
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — in `serializeFixture` returned object: remove the `odds:` line; add:

```js
    markets: f.markets ?? null,
    htScore: f.htScore1 == null ? null : [f.htScore1, f.htScore2],
```

In `web/src/lib/assemble.js`, replace the `odds: f.odds ?? null,` line with:

```js
      markets: f.markets ?? null, htScore: f.htScore ?? null,
```

- [ ] **Step 4: Run** — `npm run test -w api -- serialize.test.js && npm run test -w web -- assemble.test.js` → PASS.
- [ ] **Step 5: Commit**

```bash
git add api/src/serialize.js web/src/lib/assemble.js api/test/serialize.test.js
git commit -m "feat: serialize fixture markets + half-time score to the web"
```

---

## Phase B — Settlement & betting

### Task 6: `resolveBet` + per-market settlement

**Files:** Modify `api/src/coins/settle.js`; Test `api/test/coins-settle.test.js`

- [ ] **Step 1: Failing tests** (append to `api/test/coins-settle.test.js`)

```js
import { resolveBet } from '../src/coins/settle.js'

const fx = (over = {}) => ({ t1Code: 'arg', t2Code: 'bra', winnerCode: null, score1: null, score2: null,
  htScore1: null, htScore2: null, events: [], ...over })

test('resolveBet 1x2 from final result', () => {
  expect(resolveBet('1x2', 'HOME', null, fx({ score1: 2, score2: 0 }))).toBe('won')
  expect(resolveBet('1x2', 'DRAW', null, fx({ score1: 1, score2: 1 }))).toBe('won')
  expect(resolveBet('1x2', 'AWAY', null, fx({ score1: 1, score2: 1 }))).toBe('lost')
})

test('resolveBet ou25 from total goals', () => {
  expect(resolveBet('ou25', 'OVER', 2.5, fx({ score1: 2, score2: 1 }))).toBe('won')
  expect(resolveBet('ou25', 'UNDER', 2.5, fx({ score1: 1, score2: 1 }))).toBe('won')
})

test('resolveBet cards from card-event count vs line', () => {
  const events = [{ type: 'card' }, { type: 'card' }, { type: 'card' }, { type: 'card' }, { type: 'goal' }]
  expect(resolveBet('cards', 'OVER', 3.5, fx({ events }))).toBe('won')   // 4 > 3.5
  expect(resolveBet('cards', 'UNDER', 3.5, fx({ events }))).toBe('lost')
})

test('resolveBet fh1x2 from half-time score (or goal events fallback)', () => {
  expect(resolveBet('fh1x2', 'HOME', null, fx({ htScore1: 1, htScore2: 0 }))).toBe('won')
  // fallback: htScore null but events present (a first-half goal for t1)
  expect(resolveBet('fh1x2', 'HOME', null, fx({ events: [{ type: 'goal', teamCode: 'arg', minute: 20 }] }))).toBe('won')
  // unresolvable: htScore null AND events null → null (leave open)
  expect(resolveBet('fh1x2', 'HOME', null, { ...fx(), events: null })).toBeNull()
})

test('resolveBet cs exact final score', () => {
  expect(resolveBet('cs', '2:1', null, fx({ score1: 2, score2: 1 }))).toBe('won')
  expect(resolveBet('cs', '2:1', null, fx({ score1: 1, score2: 1 }))).toBe('lost')
})
```

- [ ] **Step 2: Run** → FAIL (`resolveBet` undefined).
- [ ] **Step 3: Implement** — add to `api/src/coins/settle.js` (keep existing `fixtureResult`):

```js
function htResult(f) {
  let h = f.htScore1, a = f.htScore2
  if (h == null || a == null) {
    if (!Array.isArray(f.events)) return null // never polled — can't know the HT score
    const fh = f.events.filter((e) => e.type === 'goal' && (e.minute ?? 99) <= 45)
    h = fh.filter((e) => e.teamCode === f.t1Code).length
    a = fh.filter((e) => e.teamCode === f.t2Code).length
  }
  return h > a ? 'HOME' : h < a ? 'AWAY' : 'DRAW'
}

/** Resolve one bet → 'won' | 'lost' | null (null = data not available yet, leave open). */
export function resolveBet(market, selection, line, f) {
  if (market === '1x2') { const r = fixtureResult(f); return r == null ? null : r === selection ? 'won' : 'lost' }
  if (market === 'fh1x2') { const r = htResult(f); return r == null ? null : r === selection ? 'won' : 'lost' }
  if (market === 'ou25' || market === 'cards') {
    if (line == null) return null
    let measure
    if (market === 'ou25') { if (f.score1 == null || f.score2 == null) return null; measure = f.score1 + f.score2 }
    else { if (!Array.isArray(f.events)) return null; measure = f.events.filter((e) => e.type === 'card').length }
    const over = measure > line
    return (selection === 'OVER' ? over : !over) ? 'won' : 'lost'
  }
  if (market === 'cs') { if (f.score1 == null || f.score2 == null) return null; return `${f.score1}:${f.score2}` === selection ? 'won' : 'lost' }
  return null
}
```

Then change `settleBets`'s per-bet loop to dispatch via `resolveBet` and skip unresolved bets. Replace `const won = b.selection === result` and remove the fixture-level `result`/early-return:

```js
  const open = await db.select().from(bet).where(and(eq(bet.fixtureId, fixtureId), eq(bet.status, 'open')))
  const sweeps = new Set()
  for (const b of open) {
    const outcome = resolveBet(b.market, b.selection, b.line == null ? null : Number(b.line), f)
    if (outcome == null) continue // data not available yet → leave open
    const won = outcome === 'won'
    const settled = await db.transaction(async (tx) => {
      const claimed = await tx.update(bet).set({ status: won ? 'won' : 'lost', settledAt: new Date() })
        .where(and(eq(bet.id, b.id), eq(bet.status, 'open'))).returning({ id: bet.id })
      if (claimed.length === 0) return false
      if (won) await tx.insert(coinLedger).values({ sweepId: b.sweepId, personId: b.personId, type: 'payout', amount: b.potentialPayout, refId: b.id })
      return true
    })
    if (settled) sweeps.add(b.sweepId)
  }
```

Remove the now-unused fixture-level `const result = fixtureResult(f); if (!result) return 0` guard (each bet resolves itself), but keep the `if (!f || f.status !== 'final') return 0` guard at the top.

- [ ] **Step 4: Run** — `npm run test -w api -- coins-settle.test.js` → PASS (incl. the existing multi-bet/idempotent test).
- [ ] **Step 5: Commit**

```bash
git add api/src/coins/settle.js api/test/coins-settle.test.js
git commit -m "feat(api): per-market bet settlement (resolveBet dispatch)"
```

### Task 7: `POST /api/bet` market + selection; serialize market/line

**Files:** Modify `api/src/routes/coins.js`, `api/src/coins/ledger.js` (`serializeBet`); Test `api/test/coins.test.js`

- [ ] **Step 1: Update failing tests** in `api/test/coins.test.js`

`bettableFixture` now stamps a `markets` jsonb instead of `odds_*`:

```js
async function bettableFixture() {
  const [f] = await db.select().from(fixture).limit(1)
  const markets = {
    '1x2': { label: 'Match Winner', book: 'Pinnacle', selections: [
      { key: 'HOME', label: 'Home', odds: 2 }, { key: 'DRAW', label: 'Draw', odds: 3.5 }, { key: 'AWAY', label: 'Away', odds: 4 }] },
    ou25: { label: 'Over/Under 2.5', line: 2.5, book: 'Pinnacle', selections: [
      { key: 'OVER', label: 'Over 2.5', odds: 1.9 }, { key: 'UNDER', label: 'Under 2.5', odds: 1.9 }] },
  }
  await db.update(fixture).set({ status: 'upcoming', stage: 'group', markets }).where(eq(fixture.id, f.id))
  return (await db.select().from(fixture).where(eq(fixture.id, f.id)))[0]
}
```

Update the happy-path test to send `market`, and add a market+selection-validation test:

```js
test('POST /api/bet places a 1x2 bet (default market) and locks odds', async () => {
  const p = await aPerson(); const f = await bettableFixture()
  const before = await balanceOfPerson(p.id)
  const res = await app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: f.id, personId: p.id, selection: 'HOME', stake: 100 } })
  expect(res.statusCode).toBe(200)
  expect(res.json().bet).toMatchObject({ market: '1x2', selection: 'HOME', stake: 100, odds: 2, potentialPayout: 200 })
  expect(res.json().balance).toBe(before - 100)
})

test('POST /api/bet places an over/under bet with its line', async () => {
  const p = await aPerson(); const f = await bettableFixture()
  await balanceOfPerson(p.id)
  const res = await app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: f.id, personId: p.id, market: 'ou25', selection: 'OVER', stake: 50 } })
  expect(res.statusCode).toBe(200)
  expect(res.json().bet).toMatchObject({ market: 'ou25', selection: 'OVER', odds: 1.9, line: 2.5 })
})

test('POST /api/bet rejects an unknown market or selection', async () => {
  const p = await aPerson(); const f = await bettableFixture()
  expect((await app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: f.id, personId: p.id, market: 'btts', selection: 'YES', stake: 10 } })).json()).toEqual({ error: 'no_odds' })
  expect((await app.inject({ method: 'POST', url: '/api/bet', payload: { fixtureId: f.id, personId: p.id, market: '1x2', selection: 'ZZZ', stake: 10 } })).json()).toEqual({ error: 'no_odds' })
})
```

The existing `betting_closed`, `not_group_stage`, `insufficient_funds`, concurrency, and multiple-bets tests stay; update any that set `oddsHome` to use `markets` via `bettableFixture` (they already call it).

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — in `api/src/routes/coins.js`, generalize the body + odds lookup:

```js
const MARKETS = ['1x2', 'ou25', 'cards', 'fh1x2', 'cs']
const betBody = {
  type: 'object', required: ['fixtureId', 'personId', 'selection', 'stake'], additionalProperties: false,
  properties: {
    fixtureId: { type: 'string' }, personId: { type: 'string' },
    market: { type: 'string', enum: MARKETS }, selection: { type: 'string' }, stake: { type: 'integer', minimum: 1 },
  },
}
```

Replace the 1X2-specific odds block (the `oddsCol`/`odds` lines) with a market lookup against the stored `markets`:

```js
    const market = req.body.market ?? '1x2'
    const mk = f.markets?.[market]
    const sel = mk?.selections?.find((s) => s.key === selection)
    if (!sel) return reply.code(400).send({ error: 'no_odds' })
    const odds = Number(sel.odds)
    if (!Number.isFinite(odds) || odds <= 1) return reply.code(400).send({ error: 'invalid_odds' })
    const line = mk.line ?? null
```

Keep the `f.stage !== 'group'` and `f.status !== 'upcoming'` guards (drop the old `selection === 'DRAW'` check — selection validity now comes from the market). In the `bet` insert add `market, line: line == null ? null : String(line)`. (`req.body` destructure: change to `const { fixtureId, personId, selection, stake } = req.body` and read `market` separately as above.)

In `api/src/coins/ledger.js`, extend `serializeBet`:

```js
export function serializeBet(b) {
  return { id: b.id, fixtureId: b.fixtureId, market: b.market, selection: b.selection,
    line: b.line == null ? null : Number(b.line), stake: b.stake, odds: Number(b.oddsDecimal),
    book: b.book, potentialPayout: b.potentialPayout, status: b.status, placedAt: b.placedAt, settledAt: b.settledAt }
}
```

- [ ] **Step 4: Run** — `npm run test -w api -- coins.test.js` → PASS.
- [ ] **Step 5: Commit**

```bash
git add api/src/routes/coins.js api/src/coins/ledger.js api/test/coins.test.js
git commit -m "feat(api): POST /api/bet accepts market + selection; serialize market/line"
```

### Task 8: Seed multi-market + half-time score

**Files:** Modify `api/src/seed/generate.js`, `api/src/seed/seed.js`; then reseed dev DB.

- [ ] **Step 1: Replace `oddsFor` with `marketsFor`** in `api/src/seed/generate.js`:

```js
// Dev-only markets derived from the implied percents so the Coins screen is fully usable
// locally without the worker. Prod gets real Pinnacle markets from the worker.
function decFor(pct) { return Math.round((100 / (Math.max(pct, 1) * 1.05)) * 100) / 100; }
function marketsFor(prob) {
  var book = "Pinnacle";
  var ou = 1.85, cards = 1.9;
  return {
    "1x2":   { label: "Match Winner", book: book, selections: [
      { key: "HOME", label: "Home", odds: decFor(prob.a) }, { key: "DRAW", label: "Draw", odds: decFor(prob.d) }, { key: "AWAY", label: "Away", odds: decFor(prob.b) } ] },
    "fh1x2": { label: "First Half Result", book: book, selections: [
      { key: "HOME", label: "Home", odds: decFor(prob.a) + 0.4 }, { key: "DRAW", label: "Draw", odds: 2.1 }, { key: "AWAY", label: "Away", odds: decFor(prob.b) + 0.4 } ] },
    "ou25":  { label: "Over/Under 2.5", line: 2.5, book: book, selections: [
      { key: "OVER", label: "Over 2.5", odds: 2.0 }, { key: "UNDER", label: "Under 2.5", odds: ou } ] },
    "cards": { label: "Cards Over/Under", line: 3.5, book: book, selections: [
      { key: "OVER", label: "Over 3.5", odds: cards }, { key: "UNDER", label: "Under 3.5", odds: cards } ] },
    "cs":    { label: "Correct Score", book: book, selections: [
      { key: "1:0", label: "1-0", odds: 7 }, { key: "2:0", label: "2-0", odds: 9 }, { key: "2:1", label: "2-1", odds: 8 },
      { key: "1:1", label: "1-1", odds: 7.5 }, { key: "0:0", label: "0-0", odds: 11 }, { key: "0:1", label: "0-1", odds: 12 },
      { key: "1:2", label: "1-2", odds: 14 }, { key: "0:2", label: "0-2", odds: 21 } ] },
  };
}
```

Change the fixture object to use `markets: marketsFor(probFor(a, b))` instead of `odds: oddsFor(...)`. In the status assignment (the function that sets `final`/`live`), when a fixture is `final` or `live`, set a half-time score, e.g. `f.ht = [Math.min(f.score?.[0] ?? 0, 1), Math.min(f.score?.[1] ?? 0, 1)]` (a plausible HT split); leave `ht` undefined for upcoming.

- [ ] **Step 2: Wire into `seed.js`** — replace the `oddsHome/...` insert fields with `markets: f.markets` (in both `values` and the `onConflictDoUpdate.set`), and add `htScore1: f.ht?.[0] ?? null, htScore2: f.ht?.[1] ?? null` (both places):

```js
      probA: f.prob.a, probD: f.prob.d, probB: f.prob.b,
      markets: f.markets, htScore1: f.ht?.[0] ?? null, htScore2: f.ht?.[1] ?? null,
      stage: 'group', derby: !!f.derby, doubleOwner: (f.doubleOwners?.length ?? 0) > 0,
    }).onConflictDoUpdate({
      target: s.fixture.id,
      set: { status: f.status, score1: f.score?.[0] ?? null, score2: f.score?.[1] ?? null, minute: f.minute ?? null,
        markets: f.markets, htScore1: f.ht?.[0] ?? null, htScore2: f.ht?.[1] ?? null },
    })
```

- [ ] **Step 3: Reseed + verify**

Run: `npm run db:seed -w api` then check (password in `.env`):
`PGPASSWORD=<pw> psql -h localhost -p 5432 -U localuser -d sweep -tA -c "select count(*) from fixture where markets is not null;"` → expect all fixtures.

Run: `npm run test -w api -- seed.test.js` → PASS (adjust the seed test if it asserts the old `odds` shape).

- [ ] **Step 4: Commit**

```bash
git add api/src/seed/generate.js api/src/seed/seed.js api/test/seed.test.js
git commit -m "feat(api): seed multi-market odds + half-time score (dev)"
```

### Task 9: Drop the obsolete `odds_*` columns

**Files:** Modify `api/src/db/schema.js`; new migration.

- [ ] **Step 1: Confirm no references** — grep the whole repo (not just `api/src` — also catch tests/seed/snapshots): `grep -rn "oddsHome\|oddsDraw\|oddsAway\|oddsBook\|odds_home\|odds_draw\|odds_away\|odds_book" api/src api/test` → expect **no runtime matches** (all replaced by `markets`; clean any stale test references). If any remain in source, fix them first.
- [ ] **Step 2: Remove the four columns** from the `fixture` table in `api/src/db/schema.js` (`oddsHome`, `oddsDraw`, `oddsAway`, `oddsBook`).
- [ ] **Step 3: Generate + apply** — `npm run db:generate -w api` (inspect: only DROPs the four columns). Then `npm run db:migrate -w api`.
- [ ] **Step 4: Full suite** — `npm run test` → all green.
- [ ] **Step 5: Commit**

```bash
git add api/src/db/schema.js api/migrations
git commit -m "chore(api): drop obsolete single-market odds columns"
```

---

## Phase C — Frontend

### Task 10: Coins store + client support markets

**Files:** Modify `web/src/coins.js`, `web/src/api/client.js`; Tests `web/src/coins.test.js`, `web/src/api/client.test.js`

- [ ] **Step 1: Failing tests**

`web/src/api/client.test.js` — update the `postBet` test to include `market`:

```js
test('postBet posts market + selection to /api/bet', async () => {
  const spy = mockFetchOnce({ bet: { id: 'b1' }, balance: 900 })
  await postBet({ fixtureId: 'f1', personId: 'pn_x', market: 'ou25', selection: 'OVER', stake: 50 })
  expect(JSON.parse(spy.mock.calls[0][1].body)).toEqual({ fixtureId: 'f1', personId: 'pn_x', market: 'ou25', selection: 'OVER', stake: 50 })
})
```

`web/src/coins.test.js` — seed `markets` and assert `placeBet(fixtureId, market, selection)` reads the right odds and debits optimistically:

```js
beforeEach(() => {
  // ...existing setup...
  S.fixtures = [{ id: 'f1', t1: 'arg', t2: 'bra', status: 'upcoming', markets: {
    '1x2': { selections: [{ key: 'HOME', odds: 2 }, { key: 'DRAW', odds: 3.5 }, { key: 'AWAY', odds: 4 }] },
    ou25: { line: 2.5, selections: [{ key: 'OVER', odds: 1.9 }, { key: 'UNDER', odds: 1.9 }] } } }]
  S.fixture = (id) => S.fixtures.find((f) => f.id === id)
})

test('placeBet reads odds from the chosen market and debits optimistically', async () => {
  vi.spyOn(client, 'postBet').mockResolvedValueOnce({ bet: { id: 'b1', market: 'ou25', selection: 'OVER', stake: 100, odds: 1.9, potentialPayout: 190, status: 'open' }, balance: 900 })
  await placeBet('f1', 'ou25', 'OVER', 100)
  expect(myBalance()).toBe(900)
  expect(client.postBet).toHaveBeenCalledWith({ fixtureId: 'f1', personId: 'pn_a', market: 'ou25', selection: 'OVER', stake: 100 })
})
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**

`web/src/api/client.js`: `export const postBet = ({ fixtureId, personId, market, selection, stake }) => post('/api/bet', { fixtureId, personId, market, selection, stake })`.

`web/src/coins.js`: change `placeBet(fixtureId, selection, stake)` → `placeBet(fixtureId, market, selection, stake)`. Read odds/line from the market:

```js
export async function placeBet(fixtureId, market, selection, stake) {
  const me = getMe()
  if (!me) { if (window.__sweepPickMe) window.__sweepPickMe(); return }
  if (!(stake >= 1) || stake > wallet.balance) { toast('Not enough coins'); return }
  const f = S.fixture(fixtureId)
  const mk = f?.markets?.[market]
  const sel = mk?.selections?.find((s) => s.key === selection)
  const odds = sel ? sel.odds : null
  const pending = { id: `pending_${Date.now()}_${pendingSeq++}`, fixtureId, market, selection, stake, odds,
    line: mk?.line ?? null, potentialPayout: odds ? Math.round(stake * odds) : 0, status: 'open' }
  wallet = { ...wallet, balance: wallet.balance - stake, bets: { ...wallet.bets, open: [pending, ...wallet.bets.open] } }
  notify()
  trackEvent('bet_placed', { match_id: fixtureId, market, selection, stake })
  try {
    const res = await postBet({ fixtureId, personId: me.id, market, selection, stake })
    wallet = { ...wallet, balance: res.balance, bets: { ...wallet.bets, open: wallet.bets.open.map((b) => b.id === pending.id ? res.bet : b) } }
    notify()
  } catch {
    wallet = { ...wallet, balance: wallet.balance + stake, bets: { ...wallet.bets, open: wallet.bets.open.filter((b) => b.id !== pending.id) } }
    notify(); toast("Couldn't place bet — try again")
  }
}
```

- [ ] **Step 4: Run** — `npm run test -w web -- coins.test.js client.test.js` → PASS.
- [ ] **Step 5: Commit**

```bash
git add web/src/coins.js web/src/api/client.js web/src/coins.test.js web/src/api/client.test.js
git commit -m "feat(web): coins store + client support market selection"
```

### Task 11: Place-a-bet tab — day-split, flags, inline 1X2

**Files:** Modify `web/src/screens-coins.jsx`; Test `web/src/screens-coins.test.jsx`

Read `web/src/screens-main.jsx` (~lines 262–312) for the `byDay`/`days` grouping + day-header markup, and `web/src/components.jsx` `Flag` (line 119) before implementing.

- [ ] **Step 1: Failing test** — update `web/src/screens-coins.test.jsx`: seed two fixtures on different `dayKey`s with `markets`, render, assert a day header shows, flags render (`img.flag`), the inline 1X2 odds (2, 3.5, 4) show, and tapping the **row** (not an odds button) calls the `openBet`/navigation prop.

```js
beforeEach(() => {
  S.people = [{ id: 'pn_a', name: 'Ann', initials: 'AN', av: '#ccc' }]
  S.flag = (c) => `/flags/${c}.png`
  S.team = (c) => ({ code: c, name: c.toUpperCase(), color: '#123', flagCode: c })
  const mk = { '1x2': { selections: [{ key: 'HOME', label: 'Home', odds: 2 }, { key: 'DRAW', label: 'Draw', odds: 3.5 }, { key: 'AWAY', label: 'Away', odds: 4 }] } }
  S.fixtures = [{ id: 'f1', t1: 'arg', t2: 'bra', stage: 'group', status: 'upcoming', ko: new Date('2026-07-01T18:00:00Z'), dayKey: '2026-07-01', dayLabel: 'Tue 1 Jul', markets: mk }]
  S.fixture = (id) => S.fixtures.find((f) => f.id === id)
  setMe('pn_a')
  setWalletData({ balance: 1000, weeklyGrant: 1000, bets: { open: [], settled: [] }, leaderboard: [{ personId: 'pn_a', balance: 1000 }] })
})

test('place-a-bet shows a day header, flags, and inline 1X2 odds', () => {
  render(<CoinsScreen go={() => {}} openBet={() => {}} />)
  expect(screen.getByText('Tue 1 Jul')).toBeInTheDocument()
  expect(screen.getAllByRole('img').some(i => i.className.includes('flag'))).toBe(true)
  expect(screen.getByText('2')).toBeInTheDocument()
})

test('tapping the row opens the bet detail', () => {
  const openBet = vi.fn()
  render(<CoinsScreen go={() => {}} openBet={openBet} />)
  fireEvent.click(screen.getByTestId('bet-row-f1'))
  expect(openBet).toHaveBeenCalledWith('f1')
})
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — rework `CoinsScreen({ go, openBet })`:
  - Tab state `const [tab, setTab] = useState('place')` with a `.statseg`-style toggle (Place a bet / My bets) under the wallet header.
  - **Place tab:** `bettable = S.fixtures.filter(f => f.status === 'upcoming' && f.markets?.['1x2'] && f.stage === 'group')`, group by `dayKey` into `{days, byDay}` exactly like `screens-main.jsx`. For each day render a header (`d.dayLabel`) then rows. Each row (`data-testid={`bet-row-${f.id}`}`, `onClick={() => openBet(f.id)}`): `<Flag code={f.t1}/>` + name, "v", name + `<Flag code={f.t2}/>`, book label, and three inline odds buttons from `f.markets['1x2'].selections` whose `onClick` calls `e.stopPropagation()` then opens the bet sheet for that selection (reuse the existing in-screen `BetSheet`, now `placeBet(f.id, '1x2', key, stake)`).
  - **My bets tab:** render `<MyBets/>` (Task 13). For this task a placeholder section is fine; full filter in Task 13.
  - Keep the wallet header + no-identity prompt.
- [ ] **Step 4: Run + build** — `npm run test -w web -- screens-coins.test.jsx && npm run build` → PASS + clean.
- [ ] **Step 5: Commit**

```bash
git add web/src/screens-coins.jsx web/src/screens-coins.test.jsx
git commit -m "feat(web): Place-a-bet tab with day split, flags, inline 1X2"
```

### Task 12: Fixture bet-detail overlay (all markets)

**Files:** Create `web/src/screens-bet-detail.jsx`; Modify `web/src/App.jsx`; Test `web/src/screens-bet-detail.test.jsx`

Read `web/src/App.jsx` overlay wiring (the `overlay?.type === ...` chain ~lines 139–142) and how `MatchSheet` builds its `.overlay`/`.sheet` before implementing.

- [ ] **Step 1: Failing test** — `web/src/screens-bet-detail.test.jsx`: seed a fixture with multiple markets, render `<BetDetail fixtureId="f1" onBack={...}/>`, assert each market label appears (Match Winner, Over/Under 2.5, Cards Over/Under, First Half Result, Correct Score), and clicking a selection opens a stake input (`spinbutton`).

```js
test('bet detail lists every market for the fixture', () => {
  // seed S.fixtures[0].markets with all five keys
  render(<BetDetail fixtureId="f1" onBack={() => {}} />)
  expect(screen.getByText('Match Winner')).toBeInTheDocument()
  expect(screen.getByText('Correct Score')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**
  - `screens-bet-detail.jsx` exports `BetDetail({ fixtureId, onBack })`: `const f = S.fixture(fixtureId)`; header with `<Flag/>` + team names + KO (`f.dateTimeLabel`). For each key in a fixed order `['1x2','fh1x2','ou25','cards','cs']` that exists in `f.markets`, render a section: `mk.label`, then selection buttons (label/odds). For `1x2`/`fh1x2`, replace `Home`/`Away` labels with `S.team(f.t1).name`/`S.team(f.t2).name`. For `cs`, sort selections by odds ascending and show the first 12 with a "Show more" toggle. Clicking a selection opens the shared `BetSheet` (lift `BetSheet` into a shared spot or import from `screens-coins.jsx`) bound to `placeBet(fixtureId, key, selKey, stake)`.
  - `App.jsx`: add `const openBet = (id) => navigate({ overlay: { type: 'betdetail', id } })`; pass `openBet` to `CoinsScreen`; in the overlay chain add `else if (overlay?.type === 'betdetail') ov = <BetDetail fixtureId={overlay.id} onBack={goBack}/>`; import `BetDetail`. Ensure `urlFor`/`readView` tolerate the overlay (mirror how `knockouts`/`admin` overlays are URL-handled, or leave it modal-like without a URL if those are too).
- [ ] **Step 4: Run + build** — `npm run test -w web -- screens-bet-detail.test.jsx && npm run build` → PASS + clean.
- [ ] **Step 5: Commit**

```bash
git add web/src/screens-bet-detail.jsx web/src/App.jsx web/src/screens-bet-detail.test.jsx
git commit -m "feat(web): fixture bet-detail overlay with all markets"
```

### Task 13: My bets tab — All / Open / Settled

**Files:** Modify `web/src/screens-coins.jsx`; Test `web/src/screens-coins.test.jsx`

- [ ] **Step 1: Failing test** — seed `wallet.bets` with one open + one settled (won) bet across markets; switch to the My bets tab; assert the filter toggle (All/Open/Settled) works and a bet row shows market label + selection + stake + status pill + payout on win.

```js
test('My bets lists open and settled bets and filters', () => {
  setWalletData({ balance: 800, weeklyGrant: 1000, leaderboard: [], bets: {
    open: [{ id: 'b1', fixtureId: 'f1', market: 'ou25', selection: 'OVER', stake: 100, odds: 1.9, potentialPayout: 190, status: 'open' }],
    settled: [{ id: 'b2', fixtureId: 'f1', market: '1x2', selection: 'HOME', stake: 50, odds: 2, potentialPayout: 100, status: 'won' }] } })
  render(<CoinsScreen go={() => {}} openBet={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /my bets/i }))
  expect(screen.getByText(/Over\/Under|OVER/i)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /^settled$/i }))
  expect(screen.getByText(/won/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — `MyBets` sub-component: a filter toggle (`all`/`open`/`settled`), then a list over `myWallet().bets` (combine open+settled for "all"). Each row: a short market label (`MARKET_LABELS[b.market]`), the selection (team name for HOME/AWAY else the key/label), stake, odds, a status pill (`open`/`won` gold/`lost` muted), and payout on win. Empty states per filter. Define `MARKET_LABELS = { '1x2':'Match Winner', fh1x2:'First Half', ou25:'Over/Under 2.5', cards:'Cards O/U', cs:'Correct Score' }`.
- [ ] **Step 4: Run + build** — `npm run test -w web -- screens-coins.test.jsx && npm run build` → PASS + clean.
- [ ] **Step 5: Commit**

```bash
git add web/src/screens-coins.jsx web/src/screens-coins.test.jsx
git commit -m "feat(web): My bets tab with All/Open/Settled filter"
```

---

## Final verification

- [ ] `npm run test` (api) green; `npm run test -w web` green; `npm run build` clean.
- [ ] `npm run db:migrate -w api` applied (migrations 0013 add, 0014 drop) and `npm run db:seed -w api` re-run.
- [ ] Manual smoke (dev): Coins → Place a bet shows day-split fixtures with flags + inline 1X2; tap a row → bet-detail lists all five markets; place an O/U and a Correct Score bet → balance drops, both appear under My bets (Open); force a fixture final via psql (set `status='final'`, `score1/score2`, `ht_score1/2`, and a few `events` cards) and run the worker / call `settleBets` → each market settles correctly and My bets → Settled reflects wins/losses.

---

## Self-review notes

- **Spec coverage:** markets capture (T1,4), HT score (T2,4), schema (T3,9), settlement per market (T6), bet API (T7), serialize/assemble (T5), seed (T8), store/client (T10), day-split+flags+inline 1X2 (T11), bet-detail all markets (T12), My bets tabs/filter (T13). Single-book rule = `pickBook` (T1). Group-stage-only retained (T7). All covered.
- **Type consistency:** market keys `1x2/ou25/cards/fh1x2/cs` and selection keys (`HOME/DRAW/AWAY`, `OVER/UNDER`, `"H:A"`) are identical across `mapMarkets`, `resolveBet`, the route, the seed, and the store. `markets[key].selections[].{key,label,odds}` and `.line` are consistent. `serializeBet` adds `market`+`line`; the store/UI read them.
- **Migration safety:** columns added in T3, referenced-and-filled in T4–T8, dropped only in T9 after a grep confirms zero references — every commit stays green.
