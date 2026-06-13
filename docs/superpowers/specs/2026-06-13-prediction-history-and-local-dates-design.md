# The Sweep — Prediction history + local date/time design

**Date:** 2026-06-13
**Status:** Approved for planning
**Scope:** Frontend only (`web/`). No backend/API changes.

## Goal

Two related changes:

1. **Prediction history** — on a person's profile, show every match they predicted:
   when it is/was, which teams, what they picked, and whether the call was correct
   (for finished matches) or still pending (for unresolved ones).
2. **Local, unified date/time** — stop hardcoding Sydney time. Render every date in the
   viewer's own timezone using one consistent format, `Sun, 14 June · 8:00 AM`, with no
   timezone-name suffix.

Both are purely presentational; all data already exists client-side.

## Decisions (locked)

| Question | Decision |
|---|---|
| Where the prediction history goes | New "Prediction history" section, **between** *Teams drawn* and *All their matches*; both existing sections stay |
| Accuracy stat | Add a **4th header tile** "Calls right" (e.g. `7/12`); keep Teams drawn / Games played / Wins |
| Timezone | Viewer's **local** zone (drop the hardcoded `Australia/Sydney`) |
| Timezone label | **Dropped entirely** — no "AEST" / "Sydney · AEST" / "Sydney time" anywhere |
| Canonical format | `Sun, 14 June · 8:00 AM` (weekday short · day · full month · time) |
| List rows | **One-line full format** on every match-list row (replaces the compact stacked time-over-weekday cell) |

## Why no backend change

Predictions already live in the social store: `support = { fixtureId: { personId: teamCode } }`,
hydrated for **all** people via the `['social']` query and kept live by SSE. The correctness
rule already exists in `predictionLeaderboard` (the winning team, or the `DRAW` sentinel on a
level final). Times are stored as UTC ISO and converted only at display. So everything is
derivable in the existing client; the contract (our Postgres cache) is unchanged.

## Architecture

### Component 1 — `web/src/lib/format.js` (edits)

The single seam for date/time formatting. Today it pins every formatter to
`const SYD = 'Australia/Sydney'`.

- **Remove `SYD`.** Every `Intl.DateTimeFormat` omits the `timeZone` option, so it uses the
  runtime's local zone.
- **`fmtTime(d)`** — unchanged shape (`8:00 AM`), now local.
- **`fmtDate(d)`** — `Sun, 14 June`: weekday `short`, day `numeric`, month **`long`**
  (full month name; this is the only behavioural change to the date part — month goes from
  short `Jun` to long `June`). Replaces the old `fmtDay`. Locale `en-GB` to get the
  `weekday, day month` order.
- **`fmtDateTime(d)`** (new) — `` `${fmtDate(d)} · ${fmtTime(d)}` `` → `Sun, 14 June · 8:00 AM`.
  The one canonical date+time string.
- **`fmtDayKey(d)`** — local `YYYY-MM-DD`; drives "today" grouping (now the viewer's today).
- **`fmtWeekday(d)`** — localized; retained for compatibility (passed through `data`/`assemble`
  exports though not rendered).

**What it does:** owns all date/time formatting. **How you use it:** call `fmtDateTime` for any
date display. **Depends on:** `Intl` only.

### Component 2 — `web/src/lib/assemble.js` (edit)

Each fixture is assembled with precomputed labels. Add **`dateTimeLabel: fmtDateTime(ko)`**
alongside the existing `timeLabel` / `dayLabel` (renamed source `fmtDay` → `fmtDate`) /
`dayKey`. `dateTimeLabel` is static (kickoff-based), so precomputing is safe; the live/final
suffix is appended at render time because the minute changes.

### Component 3 — `<FixtureWhen f>` (new, in `web/src/components.jsx`)

One shared component so the format is identical everywhere. Renders a single line:

- **upcoming:** `f.dateTimeLabel` → `Sun, 14 June · 8:00 AM`
- **live:** `` `${f.dateTimeLabel} · ${f.minute}'` ``
- **final:** `` `${f.dateTimeLabel} · FT` ``

It does **not** render score — every row keeps score in its own slot. This is the only place
the status suffix logic lives.

### Component 4 — Display-site swaps (drop all TZ labels)

| Site | File:line | Change |
|---|---|---|
| MatchCard time | `components.jsx:225` | `<FixtureWhen f>`; drop `+ " AEST"` and the today/day branching |
| Person match rows | `screens-detail.jsx:125-126` | stacked `when` cell → one-line `<FixtureWhen>` |
| Team match rows | `screens-detail.jsx:266-267` | stacked `when` cell → one-line `<FixtureWhen>` |
| Group-pick meta | `screens-detail.jsx:402` | `gpk-meta` uses `dateTimeLabel` + score/LIVE as today |
| Match-sheet caption | `screens-detail.jsx:553-554` | drop `"AEST · "`; show `fmtDate`/date caption |
| Schedule subtitle | `screens-main.jsx:280` | remove `· Sydney time` |
| Schedule day headers | `screens-main.jsx:302` | keep `Today`/`dayLabel`, now localized full month |
| "Today" stamps | `components.jsx:270, 374` | `fmtDate(new Date())` date-only; drop the `Sydney · AEST` second line |

Row layout for the one-line lists: team line on top, `<FixtureWhen>` meta below, verdict/score
on the right (mirrors the approved preview).

### Component 5 — Prediction history data (`web/src/social.js`, new helpers)

```
predictionsOf(personId) -> [{ f, pick, verdict }]
```

- Iterate `S.fixtures`; include a fixture only if `support[f.id]?.[personId]` exists.
- `pick` = that team code, or the `DRAW` sentinel.
- `verdict`:
  - final with score → `'correct'` if `pick` equals the result (`a>b ? t1 : b>a ? t2 : DRAW`),
    else `'wrong'`.
  - upcoming or live → `null` (pending / "unresolved").
- Sorted by kickoff ascending (timeline order; resolved calls sit at the top as the tournament
  progresses).

```
predictionAccuracy(personId) -> { correct, total }
```

- Counts **only resolved (final)** predictions: `total` = finals the person picked, `correct` =
  those whose `verdict === 'correct'`. Returns `{ correct: 0, total: 0 }` cleanly when none.

Both are pure reads over the existing module-level `support` map — no new state, no network.

### Component 6 — Prediction history UI (`web/src/screens-detail.jsx`, `PersonDetail`)

- **Header:** add a 4th `dh-stat` tile, `<b>{correct}/{total}</b><small>Calls right</small>`,
  from `predictionAccuracy(person.id)`. Four tiles across; verify mobile wrap.
- **Section "Prediction history"** between *Teams drawn* and *All their matches*. For each
  `predictionsOf(person.id)` row:
  - `<FixtureWhen f>` meta line.
  - Both teams, with the **picked** side highlighted (bold + accent dot). A `DRAW` pick shows a
    small "DRAW" chip instead of highlighting a team.
  - Score (final/live) in the row's score slot.
  - **Verdict pill:** green ✓ (correct) / red ✗ (wrong) / muted "pending" (null).
  - Tap → `openMatch(f)` (same handler as the other rows).
  - Empty state: "No predictions yet."

## Data flow

1. `['social']` query hydrates `support` for all people (already wired).
2. `PersonDetail` calls `predictionsOf(person.id)` / `predictionAccuracy(person.id)` on render
   (re-runs via `useSocial()` on SSE updates).
3. Rows render through `<FixtureWhen>`; verdicts come straight from the helper.
4. All times format in the viewer's local zone via `fmtDateTime`.

## Privacy posture

No change. Picks are already public — the match sheet renders every backer by avatar
(`supportOf`) — so surfacing a person's calls on their own profile reveals nothing new. No
viewer identity is added; this is the same data, re-grouped by person.

## Error handling

- Formatters are pure and total; a fixture with no score while `final` falls back to no
  verdict (treated as pending) rather than throwing.
- `predictionsOf` skips fixtures the person never picked; missing `support` keys yield an empty
  list, rendering the empty state.

## Testing (TDD, per task)

- **`web/src/lib/format.test.js`** — pin a fixed `TZ` (e.g. `process.env.TZ` / `vi` setup) so
  output is deterministic in CI; assert `fmtDateTime` → `Sun, 14 June · 8:00 AM` for a known
  instant, and that no `Australia/Sydney` is referenced.
- **`web/src/social.test.js`** — `predictionsOf`: correct/wrong/pending, `DRAW` on a level
  final, sort order, and the empty case; `predictionAccuracy`: ratio counts only finals and
  returns `0/0` when empty.
- **`web/src/screens-detail.test.jsx`** — `PersonDetail` renders the Prediction history rows
  with the picked-team highlight + verdict pill, and the header shows the `correct/total` tile.
- **Regression sweep** — update any incidental label assertions in `App.test.jsx` /
  `components.test.jsx` that expected `AEST` or the short-month `dayLabel`.

## Out of scope (YAGNI)

- Backend/API/worker changes (times stay UTC; localization is display-only).
- Per-person privacy controls (picks are already public).
- Provisional "leaning correct" verdicts for live matches (live = pending).
- A user-selectable timezone override (we use the device zone).
- Reformatting non-fixture timestamps (e.g. photo upload times) unless they already use the
  shared formatters.
