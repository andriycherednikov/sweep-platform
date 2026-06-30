# People Placement — finishing-order tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Placement" tab to the People page that shows each participant's finishing position (a number, a range, or nothing if still in), ranked by when their last team is eliminated.

**Architecture:** Pure frontend. One new calc in `web/src/lib/assemble.js` (`placementOf`) derived from the fixtures + `winnerCodeOf` + the elimination set already computed there. The People list (`PeopleScreen` in `web/src/screens-detail.jsx`) gains a 4th `statseg` view that consumes it. No backend, schema, migration, or worker change.

**Tech Stack:** Vite + React 18, Vitest + Testing Library. JS (ESM).

## Global Constraints

- **Frontend only.** No `api/` change, no schema, no migration, no re-sync.
- **TDD.** Failing test → run (confirm fail) → minimal impl → run (confirm pass) → commit.
- **Conventional Commits** (`feat:`, `test:`, `style:`).
- **`winnerCodeOf` is the single source of truth** for who won/lost a fixture (covers shootouts + the `'DRAW'` sentinel). Never raw-score compare.
- **Placements count people in the sweep**, not teams — max position ≈ headcount.
- **Ranges use an en-dash** `–` (U+2013), e.g. `"3–4"`. Single positions show just the number, e.g. `"5"`.
- **Still-in people render nothing** (no stat block) and sort to the top.
- **`KO_ROUNDS = 5`** — the number of WC-2026 knockout rounds (R32, R16, QF, SF, Final); a team that wins all 5 is the champion. The codebase is already WC-2026-specific.
- Web tests run with `npm run test -w web -- <file>`; production build with `npm run build`.

---

### Task 1: `placementOf` calc in `assemble.js`

The ranking engine. People rank by **when their last team is eliminated** (later out = better place). Ties (co-owners of one eliminated team, or teams out in simultaneous games) share a range. Times order people internally; they are never displayed. Champion = owns a team that won every KO round → placement 1, badged later in the UI.

**Files:**
- Modify: `web/src/lib/assemble.js` — add the calc just after the elimination block (after the knockout loop that ends at `web/src/lib/assemble.js:233`, before `const isTeamEliminated` at line 235) and expose `placementOf` in the returned object (the `return { ... }` near line 242).
- Test: `web/src/lib/assemble.test.js` — append new tests at the end of the file.

**Interfaces:**
- Consumes: existing locals in `assembleSweep` — `fixtures` (each fixture has `.ko` as a `Date`, `.stage`, `.status`, `.t1`, `.t2`), `people` (each `{ id, teams: string[] }`), `eliminatedTeamCodes` (a `Set` of eliminated team codes), and the module function `winnerCodeOf(f)`.
- Produces: `S.placementOf(personId) => { start: number, end: number, champion: boolean } | null`. `null` means not settled (still in / no teams). `start === end` for a unique position; `end > start` for a tie range. `champion` is true only for owners of the cup winner.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/lib/assemble.test.js`:

```js
// ---------------- placement (finishing order) ----------------

// Two semi-finals: semi-A (earlier) and semi-B (later). The two finalists are
// still alive (no final played yet), so they're "still in" and occupy the top
// slots. The LATER semi's losers place better than the EARLIER semi's losers,
// even though both lost in the semis. Each losing team is co-owned by 2 people.
test('placementOf ranks by elimination time — later game beats earlier; ties share a range', () => {
  const ko = (id, t1, t2, when, winnerCode) => ({
    id, group: '', matchday: 0, t1, t2, ko: when, venue: 'V', city: 'C',
    status: 'final', score: [1, 0], minute: 90, prob: null, stage: 'knockout', winnerCode,
  })
  const S = assembleSweep({
    bootstrap: {
      teams: [
        { code: 'f1', name: 'Fin1', group: '', pool: 'P', color: '#111', strength: 90 },
        { code: 'f2', name: 'Fin2', group: '', pool: 'P', color: '#222', strength: 88 },
        { code: 'sa', name: 'SemiA', group: '', pool: 'P', color: '#333', strength: 80 },
        { code: 'sb', name: 'SemiB', group: '', pool: 'P', color: '#444', strength: 80 },
      ],
      people: [
        { id: 'champ', name: 'Champ', short: 'C', initials: 'C', av: '#000' },
        { id: 'runner', name: 'Runner', short: 'R', initials: 'R', av: '#000' },
        { id: 'sa1', name: 'Sam', short: 'Sam', initials: 'S', av: '#000' },
        { id: 'sa2', name: 'Sid', short: 'Sid', initials: 'S', av: '#000' },
        { id: 'sb1', name: 'Bea', short: 'Bea', initials: 'B', av: '#000' },
        { id: 'sb2', name: 'Ben', short: 'Ben', initials: 'B', av: '#000' },
      ],
      ownership: { champ: ['f1'], runner: ['f2'], sa1: ['sa'], sa2: ['sa'], sb1: ['sb'], sb2: ['sb'] },
      scoring: null,
    },
    fixtures: [
      ko('semiA', 'f1', 'sa', '2026-07-14T18:00:00Z', 'f1'), // earlier
      ko('semiB', 'f2', 'sb', '2026-07-15T18:00:00Z', 'f2'), // later
    ],
    standings: {}, photos: [],
  })
  // finalists still alive → no placement
  expect(S.placementOf('champ')).toBeNull()
  expect(S.placementOf('runner')).toBeNull()
  // later semi (sb) losers beat earlier semi (sa) losers; co-owners share a range
  expect(S.placementOf('sb1')).toEqual({ start: 3, end: 4, champion: false })
  expect(S.placementOf('sb2')).toEqual({ start: 3, end: 4, champion: false })
  expect(S.placementOf('sa1')).toEqual({ start: 5, end: 6, champion: false })
  expect(S.placementOf('sa2')).toEqual({ start: 5, end: 6, champion: false })
})

// A team that wins all 5 KO rounds is the champion (placement 1, champion:true).
// With the final played, nobody is "still in", so positions are contiguous 1..N.
test('placementOf marks the champion (5 KO wins) as 1 and yields contiguous positions', () => {
  const ko = (id, opp, when) => ({
    id, group: '', matchday: 0, t1: 'w', t2: opp, ko: when, venue: 'V', city: 'C',
    status: 'final', score: [1, 0], minute: 90, prob: null, stage: 'knockout', winnerCode: 'w',
  })
  const S = assembleSweep({
    bootstrap: {
      teams: ['w', 'o1', 'o2', 'o3', 'o4', 'o5'].map((c, i) => ({ code: c, name: c, group: '', pool: 'P', color: '#000', strength: 90 - i })),
      people: [
        { id: 'pc', name: 'PC', short: 'PC', initials: 'P', av: '#000' },
        { id: 'p1', name: 'P1', short: 'P1', initials: 'P', av: '#000' },
        { id: 'p2', name: 'P2', short: 'P2', initials: 'P', av: '#000' },
        { id: 'p3', name: 'P3', short: 'P3', initials: 'P', av: '#000' },
        { id: 'p4', name: 'P4', short: 'P4', initials: 'P', av: '#000' },
        { id: 'p5', name: 'P5', short: 'P5', initials: 'P', av: '#000' },
      ],
      ownership: { pc: ['w'], p1: ['o1'], p2: ['o2'], p3: ['o3'], p4: ['o4'], p5: ['o5'] },
      scoring: null,
    },
    fixtures: [
      ko('k1', 'o1', '2026-06-28T18:00:00Z'),
      ko('k2', 'o2', '2026-07-04T18:00:00Z'),
      ko('k3', 'o3', '2026-07-10T18:00:00Z'),
      ko('k4', 'o4', '2026-07-15T18:00:00Z'),
      ko('k5', 'o5', '2026-07-19T18:00:00Z'), // final
    ],
    standings: {}, photos: [],
  })
  expect(S.placementOf('pc')).toEqual({ start: 1, end: 1, champion: true }) // won all 5
  expect(S.placementOf('p5')).toEqual({ start: 2, end: 2, champion: false }) // out last (final)
  expect(S.placementOf('p1')).toEqual({ start: 6, end: 6, champion: false }) // out first
})

// A person owning a deep + a shallow team is placed by the deep one (last to fall).
test('placementOf places a multi-team person by their deepest (last-out) team', () => {
  const ko = (id, t1, t2, when, winnerCode) => ({
    id, group: '', matchday: 0, t1, t2, ko: when, venue: 'V', city: 'C',
    status: 'final', score: [1, 0], minute: 90, prob: null, stage: 'knockout', winnerCode,
  })
  const S = assembleSweep({
    bootstrap: {
      teams: ['win', 'early', 'late'].map((c) => ({ code: c, name: c, group: '', pool: 'P', color: '#000', strength: 80 })),
      people: [
        { id: 'alive', name: 'Alive', short: 'A', initials: 'A', av: '#000' },
        { id: 'mix', name: 'Mix', short: 'M', initials: 'M', av: '#000' },
        { id: 'soon', name: 'Soon', short: 'S', initials: 'S', av: '#000' },
      ],
      ownership: { alive: ['win'], mix: ['early', 'late'], soon: ['early'] },
      scoring: null,
    },
    fixtures: [
      ko('e', 'win', 'early', '2026-07-04T18:00:00Z', 'win'), // early out
      ko('l', 'win', 'late', '2026-07-12T18:00:00Z', 'win'),  // late out
    ],
    standings: {}, photos: [],
  })
  // alive (owns 'win', not eliminated) → still in
  expect(S.placementOf('alive')).toBeNull()
  // mix owns early+late; last team out is 'late' (Jul 12) → ranked above 'soon'
  expect(S.placementOf('mix')).toEqual({ start: 2, end: 2, champion: false })
  expect(S.placementOf('soon')).toEqual({ start: 3, end: 3, champion: false })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w web -- src/lib/assemble.test.js -t placementOf`
Expected: FAIL — `S.placementOf is not a function`.

- [ ] **Step 3: Write the minimal implementation**

In `web/src/lib/assemble.js`, insert this block immediately after the knockout-elimination `for` loop that ends at line 233 (right before `const isTeamEliminated = (code) => ...`):

```js
  // ---- finishing-order placement -------------------------------------------
  // People rank by WHEN their last team is eliminated: the longer your last team
  // survives, the better you place. Ties (co-owners of one team, or teams out in
  // simultaneous games) share a range. Times order people; they're never shown.
  const KO_ROUNDS = 5 // WC-2026 KO rounds to lift the cup: R32, R16, QF, SF, Final
  const koWins = {}
  for (const f of fixtures) {
    if (f.stage === 'knockout') {
      const w = winnerCodeOf(f)
      if (w) koWins[w] = (koWins[w] || 0) + 1
    }
  }
  const championCodes = new Set(Object.keys(koWins).filter((c) => koWins[c] >= KO_ROUNDS))

  // The instant (ms) a team was knocked out, or null if it's alive / the champion.
  const teamElimTime = (code) => {
    if (!eliminatedTeamCodes.has(code)) return null
    for (const f of fixtures) { // the one KO match it played and lost
      if (f.stage === 'knockout' && f.status === 'final' && (f.t1 === code || f.t2 === code)) {
        const w = winnerCodeOf(f)
        if (w && w !== code) return f.ko.getTime()
      }
    }
    // group exit → its last group fixture (those games kick off together → ties)
    let last = null
    for (const f of fixtures) {
      if (f.stage !== 'knockout' && (f.t1 === code || f.t2 === code)) {
        const t = f.ko.getTime()
        if (last == null || t > last) last = t
      }
    }
    return last
  }

  // Per person: settled? champion? and the ordering time (Infinity = above all who are out).
  const personElim = (p) => {
    if (!p.teams || p.teams.length === 0) return { settled: false, champion: false, time: Infinity }
    if (p.teams.some((c) => championCodes.has(c))) return { settled: true, champion: true, time: Infinity }
    if (p.teams.some((c) => !eliminatedTeamCodes.has(c))) return { settled: false, champion: false, time: Infinity }
    const ts = p.teams.map(teamElimTime).filter((t) => t != null)
    return { settled: true, champion: false, time: ts.length ? Math.max(...ts) : 0 }
  }
  const elimByPerson = Object.fromEntries(people.map((p) => [p.id, personElim(p)]))
  // only people who actually hold teams take a finishing slot
  const ranked = people.filter((p) => p.teams && p.teams.length > 0)

  // Standard competition ranking, range display. start = 1 + (# who outlasted me);
  // a tie group of size k shows start..start+k-1. null = not settled (still in).
  const placements = {}
  for (const p of people) {
    const me = elimByPerson[p.id]
    if (!me.settled) { placements[p.id] = null; continue }
    let above = 0, tie = 0
    for (const q of ranked) {
      const t = elimByPerson[q.id].time
      if (t > me.time) above++
      else if (t === me.time) tie++
    }
    placements[p.id] = { start: above + 1, end: above + tie, champion: me.champion }
  }
  const placementOf = (id) => placements[id] || null
```

Then add `placementOf` to the returned object. Change the return (currently around line 246):

```js
    team, fixture, flag, gd, ownersOf, ownersForFixture, isTeamEliminated, isPersonEliminated, fmtTime, fmtDate, fmtDayKey, fmtWeekday, todayKey,
```

to:

```js
    team, fixture, flag, gd, ownersOf, ownersForFixture, isTeamEliminated, isPersonEliminated, placementOf, fmtTime, fmtDate, fmtDayKey, fmtWeekday, todayKey,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w web -- src/lib/assemble.test.js`
Expected: PASS — all existing assemble tests plus the 3 new `placementOf` tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/assemble.js web/src/lib/assemble.test.js
git commit -m "feat(placement): rank people by elimination time in assemble"
```

---

### Task 2: "Placement" tab in `PeopleScreen`

Add the 4th `statseg` view. It shows the placement number/range (🏆 prefix for champions), nothing for still-in people, and sorts #1 to the top.

**Files:**
- Modify: `web/src/screens-detail.jsx` — `PeopleScreen` (starts at `web/src/screens-detail.jsx:36`).
- Test: `web/src/screens-detail.test.jsx` — append after the existing PeopleScreen tests (after line 883).

**Interfaces:**
- Consumes: `S.placementOf(personId)` from Task 1.
- Produces: a `view === "placement"` mode on the People page (no new exported symbols).

- [ ] **Step 1: Write the failing tests**

Append to `web/src/screens-detail.test.jsx`:

```js
// ---------------- PeopleScreen — Placement tab ----------------
// Two semis already played, finalists still alive. Later semi (sb) losers place
// 3–4, earlier semi (sa) losers place 5–6, finalists (still in) show nothing.
function placementSweep() {
  const ko = (id, t1, t2, when, winnerCode) => ({
    id, group: '', matchday: 0, t1, t2, ko: when, venue: 'V', city: 'C',
    status: 'final', score: [1, 0], minute: 90, prob: { a: 50, d: 25, b: 25 }, stage: 'knockout', winnerCode,
  })
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'f1', name: 'Fin1', group: '', pool: 'P', color: '#111', strength: 90 },
        { code: 'f2', name: 'Fin2', group: '', pool: 'P', color: '#222', strength: 88 },
        { code: 'sa', name: 'SemiA', group: '', pool: 'P', color: '#333', strength: 80 },
        { code: 'sb', name: 'SemiB', group: '', pool: 'P', color: '#444', strength: 80 },
      ],
      people: [
        { id: 'champ', name: 'Champ Player', short: 'Champ' },
        { id: 'runner', name: 'Runner Player', short: 'Runner' },
        { id: 'sa1', name: 'Sam Stone', short: 'Sam' },
        { id: 'sb1', name: 'Bea Bell', short: 'Bea' },
      ],
      ownership: { champ: ['f1'], runner: ['f2'], sa1: ['sa'], sb1: ['sb'] },
      scoring: null,
    },
    fixtures: [
      ko('semiA', 'f1', 'sa', '2026-07-14T18:00:00Z', 'f1'),
      ko('semiB', 'f2', 'sb', '2026-07-15T18:00:00Z', 'f2'),
    ],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ support: {} })
}

test('PeopleScreen Placement tab shows finishing positions and nothing for still-in', () => {
  placementSweep()
  const { container, getByText } = render(<PeopleScreen openPerson={noop} />)
  act(() => { fireEvent.click(getByText('Placement')) })
  expect(statFor(container, 'Bea Bell')).toBe('3')   // sb out later → 3 (single owner)
  expect(statFor(container, 'Sam Stone')).toBe('5')  // sa out earlier → 5
  expect(statFor(container, 'Champ Player')).toBeNull() // still in → blank
  expect(statFor(container, 'Runner Player')).toBeNull()
  expect(getByText(/placed · by finishing position/i)).toBeInTheDocument()
})

test('PeopleScreen Placement tab orders still-in at top, then best placement down', () => {
  placementSweep()
  const { container, getByText } = render(<PeopleScreen openPerson={noop} />)
  act(() => { fireEvent.click(getByText('Placement')) })
  const names = rowNames(container)
  // still-in (no number) above placed; among placed, 3 (Bea) above 5 (Sam)
  expect(names.indexOf('Bea Bell')).toBeLessThan(names.indexOf('Sam Stone'))
  expect(names.indexOf('Champ Player')).toBeLessThan(names.indexOf('Bea Bell'))
  expect(names.indexOf('Runner Player')).toBeLessThan(names.indexOf('Bea Bell'))
})
```

(In this 4-person fixture each placed person is a single owner, so the positions are unique numbers — `3` and `5`, not ranges. Ranges are covered by Task 1's unit tests.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w web -- src/screens-detail.test.jsx -t "Placement tab"`
Expected: FAIL — `getByText('Placement')` finds no such button.

- [ ] **Step 3: Write the minimal implementation**

All edits are inside `PeopleScreen` in `web/src/screens-detail.jsx`.

(a) After the `coinsVal` definition (line 51), add a sort key helper:

```js
  // placement sort key: still-in (no placement) → 0 (top); placed → its position
  const placeKey = (m) => { const pl = S.placementOf(m.person.id); return pl ? pl.start : 0 };
```

(b) In `statOf` (lines 53-57), add a `placement` branch as the first check:

```js
  const statOf = (m) => {
    if (av === "placement") {
      const pl = S.placementOf(m.person.id);
      if (!pl) return { value: null, label: null, show: false };
      const range = pl.end > pl.start ? `${pl.start}–${pl.end}` : `${pl.start}`;
      return { value: pl.champion ? `🏆 ${range}` : range, label: "place", show: true };
    }
    if (av === "predictions") { const v = predictionAccuracy(m.person.id).correct; return { value: v, label: "correct", show: v > 0 }; }
    if (av === "coins") return { value: coinsVal(m), label: "Yowie Dollars", show: m.person.adult !== false };
    return { value: m.wins, label: m.wins === 1 ? "win" : "wins", show: m.wins > 0 };
  };
```

(c) In the sort chain (lines 65-68), add a `placement` branch:

```js
  if (av === "predictions") // S.money is pre-sorted by wins; re-sort by correct calls
    list = list.slice().sort((a,b) => predictionAccuracy(b.person.id).correct - predictionAccuracy(a.person.id).correct);
  else if (av === "coins") // re-sort by Yowie Dollars balance descending
    list = list.slice().sort((a,b) => coinsVal(b) - coinsVal(a));
  else if (av === "placement") // still-in (0) at top, then by finishing position ascending
    list = list.slice().sort((a,b) => (placeKey(a) - placeKey(b)) || (b.wins - a.wins));
```

(d) Compute the placed count and add the `placement` sub-label. Replace the `subLabel` assignment (lines 73-77) with:

```js
  const placedCount = S.people.filter(p => S.placementOf(p.id)).length;
  const subLabel = av === "predictions"
    ? `${headCount} in the sweep · sorted by correct predictions`
    : av === "coins"
    ? `${headCount} adult${headCount === 1 ? "" : "s"} · sorted by Yowie Dollars balance`
    : av === "placement"
    ? `${placedCount} of ${totalCount} placed · by finishing position`
    : `${activeCount} out of ${totalCount} are still in the running · sorted by team wins`;
```

(e) Add the tab button and widen the grid. Replace the `statseg` block (lines 86-90) with:

```js
              <div className="statseg" style={{flex:1, gridTemplateColumns:`repeat(${wager?4:3}, 1fr)`}}>
                <button className={"statseg-opt"+(av==="wins"?" on":"")} onClick={()=>setView("wins")}>Wins</button>
                <button className={"statseg-opt"+(av==="predictions"?" on":"")} onClick={()=>setView("predictions")}>Predictions</button>
                {wager && <button className={"statseg-opt"+(av==="coins"?" on":"")} onClick={()=>setView("coins")}>Yowie Dollars</button>}
                <button className={"statseg-opt"+(av==="placement"?" on":"")} onClick={()=>setView("placement")}>Placement</button>
              </div>
```

(f) The stat block renders `stat.value.toLocaleString()` (line 112), which assumes a number; placement values are strings. Make it handle both. Replace line 112:

```js
                      <div className="pp">{typeof stat.value === "number" ? stat.value.toLocaleString() : stat.value}</div>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -w web -- src/screens-detail.test.jsx -t "Placement tab"`
Expected: PASS — both new Placement-tab tests.

- [ ] **Step 5: Run the full web suite + build**

Run: `npm run test -w web && npm run build`
Expected: all web tests PASS; the production build completes with no errors. (The pre-commit hook runs this too; running it here catches breakage before committing.)

- [ ] **Step 6: Commit**

```bash
git add web/src/screens-detail.jsx web/src/screens-detail.test.jsx
git commit -m "feat(placement): add Placement tab to the People page"
```

- [ ] **Step 7: Visual check (use the `run` skill or `npm run dev:web`)**

Open the People page, click **Placement**, and confirm: (1) the 4-tab row fits without `Yowie Dollars` clipping/wrapping badly on a phone-width viewport; (2) placed people show a number/range, still-in show nothing; (3) order is still-in at top then 1→N down. If the tab row clips on narrow screens, the minimal fix is to shorten the label (e.g. `Placing`) or drop `.statseg-opt` `font-size` slightly in `web/src/styles.css:841` — make that change, re-run Step 5, and amend the commit.

---

## Self-Review

**1. Spec coverage** (`docs/superpowers/specs/2026-06-30-people-placement-finishing-order-design.md`):
- Rank by elimination time, later = better → Task 1 test #1. ✓
- Ties → range (co-owners / simultaneous) → Task 1 test #1 (co-owned sa/sb share 3–4, 5–6). ✓
- Multiple winners / champion = 1 → Task 1 test #2 (`champion:true`, start 1). ✓
- Deepest team decides a multi-team person → Task 1 test #3. ✓
- Still-in → null / blank → Task 1 tests + Task 2 test #1. ✓
- Contiguous 1..N → Task 1 test #2 (pc=1 … p1=6). ✓
- New Placement tab, number/range/nothing, sort #1 top → Task 2. ✓
- People-count not team-count → ranking loops over `people`/`ranked`. ✓
- Frontend only, no backend → only `assemble.js` + `screens-detail.jsx` touched. ✓
- Group-stage coarse exits → handled by `teamElimTime`'s group branch (last group fixture, simultaneous → equal times → shared range); behavior documented, exercised indirectly. *(No dedicated unit test — group elimination requires full standings setup; the KO path is the user's stated focus and is fully tested.)*

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**3. Type consistency:** `placementOf(id) => { start, end, champion } | null` defined in Task 1, consumed identically in Task 2 (`pl.start`, `pl.end`, `pl.champion`). Sort key `placeKey` and `statOf` both guard `null`. ✓
