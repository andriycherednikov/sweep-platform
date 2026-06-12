# Draw votes — design

**Date:** 2026-06-12
**Status:** Approved, ready for plan

## Goal

Let participants call a **draw** on the crowd vote ("Who'll win?"), not just one team or
the other, and display the crowd split as a three-way **Win % / Draw % / Win %** bar.

Draws are only a real outcome in the World Cup 2026 **group stage** — knockout fixtures
always produce a winner (extra time / penalties) — so the Draw option is offered on
group-stage fixtures only. Knockout fixtures keep today's exact two-way UI.

## Decisions (settled in brainstorming)

| Question | Decision |
|---|---|
| Which matches offer Draw? | **Group stage only** (`fixture.stage === "group"`). |
| Crowd bar display | **3-segment bar + counts** (Team A / Draw / Team B). |
| Prediction accuracy on a drawn result | **Draw pick wins** on a level final; team picks still miss. |
| How a draw pick is stored | **Drop the FK; the column becomes a "pick"** ∈ `{t1Code, t2Code, "DRAW"}`. |
| Model-odds bar (official prediction) | **Out of scope** — stays two-way. |

## Current state (verified)

- Vote storage: `support` table — `(fixture_id, person_id)` composite PK, `team_code`
  text **FK → `team.code`**. One pick per person per fixture; a switch is an UPDATE.
  (`api/src/db/schema.js:90-94`, migration `api/migrations/0001_wise_ozymandias.sql:49-53`.)
- Endpoint: `POST /api/support { fixtureId, personId, teamCode }` validates
  `teamCode ∈ {f.t1Code, f.t2Code}` else `400 invalid_team`; toggle/switch/remove logic is
  already team-code-agnostic. (`api/src/routes/social.js:43-64`, body schema `:8-11`.)
- Group-stage flag already exists: `fixture.stage` (`text`, default `'group'`), serialized
  to the client. (`api/src/db/schema.js:56`, `api/src/serialize.js:18`.)
- Crowd UI: `CrowdPick` — two thumb buttons flanking a two-segment `.cbar`; reads
  `supportOf(f.id)` / `mySupport(f.id)`, writes via `setSupport(f.id, code)`.
  (`web/src/components.jsx:151-194`.) Rendered on MatchCard (`:240`) and the hero Next
  Match card (`web/src/screens-main.jsx:181`).
- Detail sheet has a fuller "Who'll win? · back a team" block with backer avatars.
  (`web/src/screens-detail.jsx:638-666`.)
- Social store keys support by code already, so a `"DRAW"` value flows through
  `supportOf` / `mySupport` / `setSupport` unchanged. (`web/src/social.js`.)
- Prediction accuracy currently treats any drawn final as nobody-correct:
  `winner = a>b?t1 : b>a?t2 : null` (`web/src/social.js:64-85`).

## Design

### 1. Data model

- Migration **drops the `support.team_code → team.code` foreign key**. The column keeps the
  name `team_code` but its meaning becomes a **pick** ∈ `{t1Code, t2Code, "DRAW"}`.
  (Renaming to `pick` would touch many call sites for no functional gain — keep the name.)
- Referential integrity for team picks moves fully to the route's app-level validation
  (it already whitelists `t1Code`/`t2Code`).
- `"DRAW"` is a reserved sentinel string constant, defined once and shared by api + web
  (e.g. `DRAW_PICK = "DRAW"`).

### 2. Backend — `POST /api/support`

- Validation becomes:
  `teamCode === f.t1Code || teamCode === f.t2Code ||
   (teamCode === "DRAW" && f.stage === "group")`.
  A `"DRAW"` pick on a non-group (knockout) fixture → `400 invalid_team`.
- Toggle / switch / remove logic and the SSE `support` event are otherwise unchanged;
  `supporting` simply carries `"DRAW"` when that's the pick.

### 3. Frontend — `CrowdPick` three-way bar

- Counts: `c1 = sup[t1].length`, `c2 = sup[t2].length`, `cd = sup["DRAW"].length`;
  `total = c1 + c2 + cd`.
- Layout: `[Team A thumb] [3-segment bar] [Team B thumb]` with a **center Draw pill**
  (a small "Draw" control carrying its count + tap target), rendered **only when
  `f.stage === "group"`**. Knockout fixtures render exactly today's two-way UI.
- Bar: three `<i>` segments — `c1/total` (team A color), `cd/total` (neutral/muted),
  `c2/total` (team B color).
- "Your call" note guards the team lookup: a `"DRAW"` pick displays "Draw" instead of
  `S.team(mine).name`.
- Tap on the Draw pill → `setSupport(f.id, "DRAW")` (same optimistic path; toggles off if
  already chosen).

### 4. Frontend — detail sheet "back a team"

- Add a third backer button "Draw" with its own `AvStack` + "N backing", group-stage only,
  using the same `setSupport(f.id, "DRAW")` path.

### 5. Scoring — `predictionLeaderboard`

- A pick is **correct** iff:
  `(a > b && pick === t1) || (b > a && pick === t2) || (a === b && pick === "DRAW")`.
- Draw-pickers score on a level final; team-pickers still miss on a draw. (Today every
  drawn final counts as a miss for everyone.)

## Out of scope

- The **model-odds bar** (`ProbBar` / "Official prediction") stays two-way. Three-way model
  odds (`probA/probD/probB`) already exist in the data if we later want to surface them; the
  request here is about the *crowd vote*.
- No change to the one-pick-per-person-per-fixture rule.

## Testing (TDD — each task: failing test → minimal impl → pass)

**api**
- `POST /api/support` accepts `teamCode: "DRAW"` on a group-stage fixture (records the pick).
- `POST /api/support` rejects `"DRAW"` on a knockout fixture → `400 invalid_team`.
- Toggle a draw pick off; switch from a team to draw and back.
- Migration applies cleanly under Testcontainers (FK dropped, existing picks intact).

**web**
- `CrowdPick` renders three bar segments + the Draw pill on a group-stage fixture.
- `CrowdPick` hides the Draw pill (two-way UI) on a knockout fixture.
- A `"DRAW"` pick shows "Draw" in the "Your call" note (no crash on team lookup).
- `predictionLeaderboard` credits a draw pick on a level final and still misses team picks.
