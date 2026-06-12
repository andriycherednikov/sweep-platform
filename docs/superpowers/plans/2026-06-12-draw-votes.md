# Draw Votes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let participants call a **draw** on the crowd vote (group-stage fixtures only) and show the crowd split as a three-way Win % / Draw % / Win % bar, with draw picks scored correctly on the leaderboard.

**Architecture:** The `support.team_code` column stops being a team FK and becomes a free "pick" ∈ `{t1Code, t2Code, "DRAW"}`. The `POST /api/support` route validates the pick (allowing `"DRAW"` only on `stage === "group"` fixtures). The web store already keys support by code, so `"DRAW"` flows through `supportOf`/`mySupport`/`setSupport` untouched; only display (`CrowdPick`, detail sheet) and scoring (`predictionLeaderboard`) need updating.

**Tech Stack:** Node 22 ESM · Fastify 5 · Drizzle ORM / Postgres · Vitest + Testcontainers (api) · React 18 + Vite + Vitest/RTL (web).

**Sentinel contract:** the literal string `"DRAW"` is the draw pick. It is defined as a constant in each workspace (api + web are separate packages, no shared import).

---

## Task 1: Backend — accept a "DRAW" pick on group-stage fixtures

Drops the `support.team_code → team.code` foreign key (so a non-team value can be stored) and widens route validation to allow `"DRAW"` on group-stage fixtures only.

**Files:**
- Modify: `api/src/db/schema.js:93` (remove the `.references()` on `support.teamCode`)
- Create: `api/migrations/XXXX_<generated>.sql` (via `db:generate`)
- Modify: `api/src/routes/social.js:49` (validation) and add a `DRAW` constant
- Test: `api/test/social.test.js`

- [ ] **Step 1: Write the failing tests**

Add these tests to `api/test/social.test.js` (after the existing `POST /api/support` tests). They rely on the existing `aFixture()` / `twoPeople()` helpers:

```js
test('POST /api/support accepts a DRAW pick on a group-stage fixture', async () => {
  const f = await aFixture()
  await db.update(fixture).set({ stage: 'group' }).where(eq(fixture.id, f.id))
  const [p1] = await twoPeople()
  const res = await app.inject({ method: 'POST', url: '/api/support', payload: { fixtureId: f.id, personId: p1.id, teamCode: 'DRAW' } })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({ fixtureId: f.id, personId: p1.id, supporting: 'DRAW' })

  const body = (await app.inject({ method: 'GET', url: '/api/social' })).json()
  expect(body.support[f.id][p1.id]).toBe('DRAW')
})

test('POST /api/support rejects a DRAW pick on a knockout fixture', async () => {
  const f = await aFixture()
  await db.update(fixture).set({ stage: 'r16' }).where(eq(fixture.id, f.id))
  const [p1] = await twoPeople()
  const res = await app.inject({ method: 'POST', url: '/api/support', payload: { fixtureId: f.id, personId: p1.id, teamCode: 'DRAW' } })
  expect(res.statusCode).toBe(400)
  expect(res.json()).toEqual({ error: 'invalid_team' })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w api -- social`
Expected: the two new tests FAIL — the DRAW pick is rejected with `400 invalid_team` (route still only allows `t1Code`/`t2Code`), so the accept-test fails on `statusCode`.

- [ ] **Step 3: Drop the FK in the schema**

In `api/src/db/schema.js`, change the `support` table's `teamCode` column (line 93) from:

```js
  teamCode:  text('team_code').notNull().references(() => team.code),
```

to:

```js
  // a pick: t1Code, t2Code, or the literal 'DRAW' (group-stage draw) — not a team FK
  teamCode:  text('team_code').notNull(),
```

- [ ] **Step 4: Generate the migration**

Run: `npm run db:generate -w api`
Expected: a new file `api/migrations/XXXX_*.sql` containing an `ALTER TABLE "support" DROP CONSTRAINT "support_team_code_team_code_fk";` (constraint name may differ — confirm it targets `support` + `team_code`). Commit this generated file with the task.

- [ ] **Step 5: Widen route validation**

In `api/src/routes/social.js`, add a constant near the top (after the imports):

```js
const DRAW = 'DRAW'
```

Then change the validation line (currently line 49):

```js
    if (teamCode !== f.t1Code && teamCode !== f.t2Code) return reply.code(400).send({ error: 'invalid_team' })
```

to:

```js
    const validPick = teamCode === f.t1Code || teamCode === f.t2Code || (teamCode === DRAW && f.stage === 'group')
    if (!validPick) return reply.code(400).send({ error: 'invalid_team' })
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test -w api -- social`
Expected: all `social` tests PASS, including the two new ones. (The test DB applies the new migration via `openTestDb`, so the FK is gone and the `DRAW` row inserts cleanly.)

- [ ] **Step 7: Commit**

```bash
git add api/src/db/schema.js api/migrations api/src/routes/social.js api/test/social.test.js
git commit -m "feat(api): accept DRAW pick on group-stage fixtures (drop support team FK)"
```

---

## Task 2: Web store — DRAW constant + draw-aware leaderboard scoring

A draw pick should count as correct on a level final; team picks still miss on a draw.

**Files:**
- Modify: `web/src/social.js` (add `DRAW` export; rewrite `predictionLeaderboard` scoring)
- Test: `web/src/social.test.js`

- [ ] **Step 1: Write the failing test**

Add to `web/src/social.test.js`:

```js
test('predictionLeaderboard credits a DRAW pick on a level final and misses team picks', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'A', pool: 'P', color: '#a00', strength: 70 },
        { code: 'br', name: 'Brazil', group: 'A', pool: 'P', color: '#0a0', strength: 80 },
      ],
      people: [
        { id: 'p1', name: 'A', short: 'A', initials: 'A', av: '#000', avatarPath: null },
        { id: 'p2', name: 'B', short: 'B', initials: 'B', av: '#111', avatarPath: null },
      ],
      ownership: {}, scoring: null,
    },
    fixtures: [{ id: 'm1', group: 'A', matchday: 1, t1: 'hr', t2: 'br', ko: '2026-06-10T12:00:00Z', venue: 'V', city: 'C', status: 'final', score: [1, 1], minute: 90, prob: { a: 33, d: 34, b: 33 }, stage: 'group' }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ watch: {}, support: { m1: { p1: 'DRAW', p2: 'hr' } } })
  const lb = predictionLeaderboard(4)
  const p1 = lb.find(x => x.person.id === 'p1')
  const p2 = lb.find(x => x.person.id === 'p2')
  expect(p1).toMatchObject({ correct: 1, total: 1 })
  expect(p2).toMatchObject({ correct: 0, total: 1 })
})
```

This test reuses the imports already at the top of `social.test.js` (`assembleSweep`, `setSweepData`, `setSocialData`, `predictionLeaderboard`). If `assembleSweep`/`setSweepData` are not already imported in this file, add them — check the existing `predictionLeaderboard` test (around line 60) for the exact import names it uses and mirror them.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w web -- social`
Expected: FAIL — current scoring sets `winner = null` on a level score, so p1's DRAW pick is not counted correct (`correct: 0`).

- [ ] **Step 3: Add the DRAW constant and rewrite scoring**

In `web/src/social.js`, add an exported constant near the top of the file (after the imports):

```js
export const DRAW = 'DRAW';
```

Then replace the body of `predictionLeaderboard` (currently at `web/src/social.js:64-85`). Change the per-fixture winner/scoring block from:

```js
    const [a, b] = f.score;
    const winner = a > b ? f.t1 : b > a ? f.t2 : null;
    const picks = support[f.id];
    if (!picks) continue;
    for (const pid of Object.keys(picks)){
      const s = stats[pid] || (stats[pid] = { correct: 0, total: 0 });
      s.total++;
      if (winner && picks[pid] === winner) s.correct++;
    }
```

to:

```js
    const [a, b] = f.score;
    const result = a > b ? f.t1 : b > a ? f.t2 : DRAW; // DRAW on a level final
    const picks = support[f.id];
    if (!picks) continue;
    for (const pid of Object.keys(picks)){
      const s = stats[pid] || (stats[pid] = { correct: 0, total: 0 });
      s.total++;
      if (picks[pid] === result) s.correct++;
    }
```

Also update the function's doc comment (line 63-64) — drop "Draws count as a miss." and replace with "A DRAW pick wins on a level final."

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -w web -- social`
Expected: PASS — p1 (DRAW) `correct: 1`, p2 (`hr`) `correct: 0`. Existing leaderboard test (decisive final) still passes.

- [ ] **Step 5: Commit**

```bash
git add web/src/social.js web/src/social.test.js
git commit -m "feat(web): score DRAW picks correctly on level finals"
```

---

## Task 3: Web — three-way crowd bar + Draw pill in CrowdPick

Adds a third bar segment and a center Draw control to `CrowdPick`, shown on group-stage fixtures only. Knockout fixtures keep today's two-way UI.

**Files:**
- Modify: `web/src/components.jsx:151-194` (CrowdPick)
- Modify: `web/src/styles.css` (after line 186 — Draw pill styles)
- Test: `web/src/components.test.jsx`

- [ ] **Step 1: Write the failing tests**

In `web/src/components.test.jsx`, the shared fixture `F` (line 29) has no `stage`. Add a group-stage variant and tests. Add near the other CrowdPick tests:

```js
const FG = { id: 'm1', t1: 'mx', t2: 'za', status: 'upcoming', stage: 'group' };

test('CrowdPick shows a Draw control and three bar segments on a group-stage fixture', () => {
  setSocialData({ watch: {}, support: { m1: { p1: 'mx', p2: 'DRAW' } } });
  const { getByLabelText, container } = render(<CrowdPick f={FG} />);
  expect(getByLabelText(/Draw/i).textContent).toContain('1');
  expect(container.querySelectorAll('.cbar i').length).toBe(3);
});

test('CrowdPick hides the Draw control on a knockout fixture', () => {
  setSocialData({ watch: {}, support: { m1: { p1: 'mx', p2: 'za' } } });
  const { queryByLabelText } = render(<CrowdPick f={{ ...FG, stage: 'r16' }} />);
  expect(queryByLabelText(/^Call a draw/i)).toBeNull();
});

test('CrowdPick records a DRAW pick and POSTs it', () => {
  setMe('p1');
  setSocialData({ watch: {}, support: {} });
  const { getByLabelText } = render(<CrowdPick f={FG} />);
  fireEvent.click(getByLabelText(/Call a draw/i));
  expect(postSupport).toHaveBeenCalledWith('m1', 'p1', 'DRAW');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w web -- components`
Expected: FAIL — no Draw control exists; bar has only 2 segments.

- [ ] **Step 3: Update CrowdPick**

In `web/src/components.jsx`, add the DRAW import (top of file, alongside the other `./social.js` imports):

```js
import { /* existing imports… */ supportOf, mySupport, setSupport, useSocial, DRAW } from "./social.js";
```

(Merge `DRAW` into the existing `./social.js` import — do not add a duplicate import line. Keep the other named imports as they are.)

Then replace the `CrowdPick` body (lines 151-194) with this version. It computes a draw count, renders a third bar segment, a group-stage-only Draw pill, and guards the "Your call" name lookup:

```jsx
export function CrowdPick({ f, onToast, light, locked }) {
  useSocial();
  const t1 = S.team(f.t1), t2 = S.team(f.t2);
  const sup = supportOf(f.id);
  const mine = mySupport(f.id);
  const showDraw = f.stage === "group";
  const c1 = (sup[f.t1]||[]).length, c2 = (sup[f.t2]||[]).length, cd = (sup[DRAW]||[]).length;
  const total = c1 + c2 + (showDraw ? cd : 0);
  // once a match starts, calls lock — nothing to show if nobody called it
  if (locked && total === 0) return null;
  const call = (code, name) => (e) => {
    e.stopPropagation();
    if (locked) return;
    const on = mine===code;
    setSupport(f.id, code);
    if (onToast) onToast(on ? "Call removed" : "You're calling "+name+" 👍");
  };
  const pickName = (code) => code === DRAW ? "Draw" : S.team(code).name;

  // teams sit side by side (hero + horizontal cards); thumbs flank a split bar
  const w1 = total ? (c1/total*100) : (showDraw ? 33.34 : 50);
  const wd = total ? (cd/total*100) : 33.33;
  const w2 = total ? (c2/total*100) : (showDraw ? 33.34 : 50);
  return (
    <div className={"crowd"+(light?" light":"")+(locked?" locked":"")} onClick={e=>e.stopPropagation()}>
      <span className="crowd-lbl">Who'll win?{locked ? " · locked" : (!mine ? " · tap to vote" : "")}</span>
      <div className="crowd-row">
        <button type="button" disabled={locked} className={"cpick"+(mine===f.t1?" on":"")} aria-pressed={mine===f.t1}
          aria-label={"Call "+t1.name} title={locked ? t1.name : "Call "+t1.name} onClick={call(f.t1,t1.name)}>
          <Icon.thumb/><b>{c1}</b>
        </button>
        <div className={"cbar"+(total===0?" novote":"")} aria-hidden="true">
          {total > 0 && <>
            <i style={{width:w1+"%", background:t1.color}}></i>
            {showDraw && <i style={{width:wd+"%", background:"#94a3b8"}}></i>}
            <i style={{width:w2+"%", background:t2.color}}></i>
          </>}
        </div>
        <button type="button" disabled={locked} className={"cpick"+(mine===f.t2?" on":"")} aria-pressed={mine===f.t2}
          aria-label={"Call "+t2.name} title={locked ? t2.name : "Call "+t2.name} onClick={call(f.t2,t2.name)}>
          <Icon.thumb/><b>{c2}</b>
        </button>
      </div>
      {showDraw &&
        <div className="crowd-draw">
          <button type="button" disabled={locked} className={"cdraw"+(mine===DRAW?" on":"")} aria-pressed={mine===DRAW}
            aria-label={locked ? "Draw" : "Call a draw"} title={locked ? "Draw" : "Call a draw"} onClick={call(DRAW,"a draw")}>
            Draw · <b>{cd}</b>
          </button>
        </div>}
      {mine
        ? <div className="crowd-note picked"><Icon.check/> {locked ? "You called " : "Your call: "}{pickName(mine)}</div>
        : !locked && <div className="crowd-note">Tap a team or draw to call it</div>}
    </div>
  );
}
```

- [ ] **Step 4: Add the Draw pill styles**

In `web/src/styles.css`, after line 186 (the last `.crowd.light` rule), add:

```css
.crowd-draw{display:flex; justify-content:center; margin-top:7px;}
.cdraw{display:inline-flex; align-items:center; gap:4px; padding:4px 12px; border:1.5px solid var(--line); background:var(--card); border-radius:999px; font-family:'Barlow Semi Condensed'; font-weight:800; font-size:12px; letter-spacing:.3px; color:var(--muted); cursor:pointer; line-height:1; transition:background .12s, color .12s, border-color .12s;}
.cdraw:hover{border-color:var(--muted2);}
.cdraw.on{background:var(--navy); border-color:var(--navy); color:#fff;}
.crowd.locked .cdraw{cursor:default; opacity:.92;}
.crowd.locked .cdraw:hover{border-color:var(--line);}
.crowd.light .cdraw{background:rgba(255,255,255,.07); border-color:rgba(255,255,255,.18); color:#dbe6f4;}
.crowd.light .cdraw:hover{border-color:rgba(255,255,255,.35);}
.crowd.light .cdraw.on{background:#fff; border-color:#fff; color:var(--navy);}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -w web -- components`
Expected: PASS — Draw control shows with count `1` and the bar has 3 segments on group stage; the knockout test finds no draw control; clicking Draw POSTs `'DRAW'`. The existing CrowdPick tests (which use the stage-less `F`) still pass because `showDraw` is false when `f.stage` is undefined.

- [ ] **Step 6: Commit**

```bash
git add web/src/components.jsx web/src/styles.css web/src/components.test.jsx
git commit -m "feat(web): three-way crowd bar with Draw pill (group stage)"
```

---

## Task 4: Web — Draw button on the match detail sheet

Adds a "Draw" backer button to the detail sheet's "back a team" block, group-stage only.

**Files:**
- Modify: `web/src/screens-detail.jsx:638-666` (the back-a-team block)
- Test: `web/src/screens-detail.test.jsx`

- [ ] **Step 1: Write the failing test**

Open `web/src/screens-detail.test.jsx` and find an existing test that renders the detail sheet for an upcoming fixture (mirror its setup — the component name, props, and `setSweepData`/`setSocialData` calls it uses). Add a test in that style:

```js
test('detail sheet shows a Draw backer button on a group-stage fixture', () => {
  // …mirror the existing sheet-render setup, ensuring the fixture has stage: 'group'…
  // then:
  expect(getByText(/Draw/i)).toBeTruthy();
});
```

Match the exact render harness (selectors, query helpers, fixture shape) used by the neighbouring detail-sheet tests — do not invent a new setup. The key assertion is that a "Draw" backer control renders when `f.stage === 'group'`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w web -- screens-detail`
Expected: FAIL — no Draw button is rendered.

- [ ] **Step 3: Add the Draw backer button**

In `web/src/screens-detail.jsx`, the back-a-team block maps `[f.t1,f.t2]` (line 644). Add the DRAW import (merge into the existing `./social.js` import in this file):

```js
import { /* existing… */ DRAW } from "./social.js";
```

Change the mapped array so a draw option is appended on group-stage fixtures, and guard the team-name/flag lookups for the `DRAW` value. Replace line 644:

```jsx
            {[f.t1,f.t2].map(code=>{
```

with:

```jsx
            {[f.t1, f.t2, ...(f.stage==="group" ? [DRAW] : [])].map(code=>{
              const isDraw = code === DRAW;
              const label = isDraw ? "Draw" : S.team(code).name;
```

Then inside that button, replace the two name/flag usages so they tolerate `DRAW`:

- The flag `<img>` (line 652) becomes draw-aware:

```jsx
                    {isDraw
                      ? <span style={{width:20,height:15,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:13}}>🤝</span>
                      : <img className="flag" src={S.flag(code,40)} style={{width:20,height:15}} alt=""/>}
```

- The team name `<b>` (line 653) uses `label`:

```jsx
                    <b style={{fontFamily:"'Barlow Condensed'",fontWeight:700,fontSize:15,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{label}</b>
```

- The onClick toast (line 649) uses `label`:

```jsx
                  onClick={locked ? undefined : ()=>{ setSupport(f.id, code); onToast(on?"Support removed":"Backing "+label+" 📣"); }}
```

Also fix the heading at line 642 — `S.team(mySup).name` crashes when `mySup === DRAW`. Change it to:

```jsx
          <div className="blocktitle" style={{border:0,padding:"2px 2px 10px"}}>{locked ? "Who'll win? · locked" : mySup ? "You're backing " + (mySup===DRAW ? "a draw" : S.team(mySup).name) : "Who'll win? · back a team"}</div>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -w web -- screens-detail`
Expected: PASS — the Draw button renders on a group-stage fixture.

- [ ] **Step 5: Commit**

```bash
git add web/src/screens-detail.jsx web/src/screens-detail.test.jsx
git commit -m "feat(web): Draw backer button on match detail sheet (group stage)"
```

---

## Task 5: Full verification

- [ ] **Step 1: Run the whole api suite**

Run: `npm run test -w api`
Expected: all api tests PASS (Docker must be running for Testcontainers).

- [ ] **Step 2: Run the whole web suite + build**

Run: `npm run test -w web && npm run build`
Expected: all web tests PASS and the production build succeeds.

- [ ] **Step 3: Confirm clean state**

Run: `git status`
Expected: clean working tree, all task commits present.

---

## Self-review notes

- **Spec coverage:** group-stage-only Draw (Tasks 1/3/4 gate on `stage === "group"`); 3-segment bar + counts (Task 3); draw-pick-wins scoring (Task 2); drop-FK pick model (Task 1); model-odds bar untouched (out of scope, no task — correct).
- **Sentinel consistency:** `"DRAW"` defined as `DRAW` in `api/src/routes/social.js` and exported `DRAW` from `web/src/social.js`, imported by `components.jsx` and `screens-detail.jsx`. Same literal on both sides — the wire contract.
- **Backward-compat:** stage-less fixtures (`f.stage` undefined) render the original two-way UI, so existing CrowdPick tests using `F` (no `stage`) keep passing.
