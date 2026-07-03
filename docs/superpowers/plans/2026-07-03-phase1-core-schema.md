# Phase 1 Core Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the soccer-shaped feed tables (`team`/`fixture`/`standing`/`team_crosswalk`) with competition-scoped generic tables (`competition`/`competitor`/`event`/`ranking` + `account`), port the api layer onto them with the wire contract frozen, greenfield migrations regenerated from scratch.

**Architecture:** Additive-then-swap. New tables are added alongside the old ones; the seed dual-writes both **with identical ids/codes** (event.id = fixture.id, competitor.code = team.code), so consumers port one file at a time while the suite stays green; a final swap task deletes the old tables and re-points FKs. Migrations are a throwaway build artifact until launch: every schema-touching task wipes `api/migrations/` and regenerates a single fresh migration.

**Tech Stack:** Node 22 ESM, Fastify 5, Drizzle ORM 0.36 + drizzle-kit 0.28, Postgres (testcontainers in tests), Vitest.

**Design doc:** `docs/superpowers/specs/2026-07-03-phase1-core-schema-design.md`.
**Refinement vs the design doc (record in the doc when this plan is approved):**
`event` and `ranking` reference competitors by **(competitionId, code)** composite FK
(target `competitor unique(competitionId, code)`) instead of surrogate id — this keeps
the winnerCode/code contract identical end-to-end and shrinks the port; `ownership`
uses `competitorId → competitor.id` (surrogate) as designed.

## Global Constraints

- **Never** push to the `upstream` remote. Push to `origin` after each task.
- **Never** connect migrations/seed to the `sweep` database — before any `db:migrate`/`db:seed`, verify `current_database() = 'sweep_platform'`.
- **Never** run the inherited `Makefile`/`infra/` deploy targets.
- **Wire contract frozen:** every `/api/*` response shape, SSE payload key (`fixtureId`, `teamCode`…), and cookie stays byte-compatible. Proof: the web suite (436 tests) passes **unmodified**.
- Web pre-commit hook runs web tests + build on every commit — that is expected noise.
- Baseline at start: api 293 / web 436, all green. If red before you change anything: STOP and report.
- Conventional Commits; one commit per task minimum.
- Docker must be running (api tests use testcontainers).
- Tests: `npm run test` (api, from repo root) · `npm test -w web` · single file: `npx vitest run test/<file> ` from `api/`.
- Migration regen (used by several tasks): `cd api && rm -rf migrations && npx drizzle-kit generate --name init`. Requires nothing running; output is `migrations/0000_init.sql` + `meta/`. (Drizzle numbers from 0000 — "fresh from 0001" in the project brief means "fresh from scratch", not the literal number.)

---

### Task 1: Local database + baseline verification (no commit)

**Files:** none committed. Modifies local `.env` only (gitignored — verify with `git check-ignore .env`).

**Interfaces:**
- Produces: a local `sweep_platform` database; `DATABASE_URL` in `.env` pointing at it. Everything DB-CLI-related later assumes this.

- [ ] **Step 1: Confirm `.env` is not tracked**

Run: `cd /Users/andriycherednikov/code/personal/sweep-platform && git check-ignore .env && git ls-files .env`
Expected: `git check-ignore` prints `.env`; `git ls-files` prints nothing. If `.env` IS tracked: STOP, report.

- [ ] **Step 2: Create the database (idempotent)**

Read the current `DATABASE_URL` from `.env` (it points at the `sweep` DB — do not write to it). Derive an admin connection to the same server's `postgres` database and create the new DB:

```bash
DBURL=$(grep '^DATABASE_URL=' .env | cut -d= -f2-)
ADMIN=$(echo "$DBURL" | sed -E 's#/[^/]*(\?.*)?$#/postgres#')
psql "$ADMIN" -tc "SELECT 1 FROM pg_database WHERE datname='sweep_platform'" | grep -q 1 || psql "$ADMIN" -c 'CREATE DATABASE sweep_platform'
```

- [ ] **Step 3: Re-point `.env`**

Edit `.env`: replace the database name in `DATABASE_URL` (the path segment, e.g. `/sweep`) with `/sweep_platform`. Keep credentials/host/port.

- [ ] **Step 4: Verify the connection target**

Run: `psql "$(grep '^DATABASE_URL=' .env | cut -d= -f2-)" -tc 'SELECT current_database()'`
Expected: `sweep_platform`. Anything else: STOP.

- [ ] **Step 5: Verify baseline is green**

Run: `npm run test` (api) and `npm test -w web` from repo root.
Expected: 293 and 436 passed. If red: STOP and report — do not fix pre-existing failures.

---

### Task 2: Sports config

**Files:**
- Create: `api/src/sports.js`
- Test: `api/test/sports.test.js`

**Interfaces:**
- Produces: `SPORTS` — `{ football: { hasDraws: true }, basketball: { hasDraws: false } }`; `sportConfig(sport)` returns the entry or throws `unknown sport: <sport>`.

- [ ] **Step 1: Write the failing test**

```js
// api/test/sports.test.js
import { test, expect } from 'vitest'
import { SPORTS, sportConfig } from '../src/sports.js'

test('football has draws, basketball does not', () => {
  expect(SPORTS.football.hasDraws).toBe(true)
  expect(SPORTS.basketball.hasDraws).toBe(false)
})

test('sportConfig throws on unknown sport', () => {
  expect(() => sportConfig('curling')).toThrow(/unknown sport/)
  expect(sportConfig('football')).toEqual({ hasDraws: true })
})
```

- [ ] **Step 2: Run it** — `cd api && npx vitest run test/sports.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// api/src/sports.js
/** Per-sport config. hasDraws drives 3-way vs 2-way results ('DRAW' sentinel legal or not). */
export const SPORTS = {
  football: { hasDraws: true },
  basketball: { hasDraws: false },
}

export function sportConfig(sport) {
  const c = SPORTS[sport]
  if (!c) throw new Error(`unknown sport: ${sport}`)
  return c
}
```

- [ ] **Step 4: Run it** — Expected: PASS.
- [ ] **Step 5: Commit** — `git add api/src/sports.js api/test/sports.test.js && git commit -m "feat(api): per-sport config registry"` — then `git push origin main`.

---

### Task 3: Additive schema + fresh migrations + dual-write seed

**Files:**
- Modify: `api/src/db/schema.js` (append new tables; add columns to `sweep`)
- Modify: `api/src/seed/seed.js` (competition + default sweep + dual-write)
- Modify: `api/test/schema.test.js` (assert new tables exist)
- Regenerate: `api/migrations/` (wipe + single fresh migration)

**Interfaces:**
- Produces (drizzle exports from `api/src/db/schema.js`, consumed by every later task):

```js
export const account = pgTable('account', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const competition = pgTable('competition', {
  id: text('id').primaryKey(), // '<provider>:<leagueId>:<season>'
  provider: text('provider').notNull(),
  sport: text('sport').notNull(),
  leagueId: text('league_id').notNull(),
  season: text('season').notNull(),
  format: text('format').notNull(), // 'league' | 'groups_then_ko' | 'knockout'
  name: text('name').notNull(),
  logo: text('logo'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  providerUq: unique('competition_provider_uq').on(t.provider, t.sport, t.leagueId, t.season),
}))

export const competitor = pgTable('competitor', {
  id: text('id').primaryKey(),
  competitionId: text('competition_id').notNull().references(() => competition.id),
  code: text('code').notNull(),
  name: text('name').notNull(),
  color: text('color').notNull(),
  logo: text('logo'),
  providerId: integer('provider_id'), // replaces team_crosswalk
  meta: jsonb('meta'), // soccer: {group, pool, strength, squad}; NBA: {conference}
}, (t) => ({
  codeUq: unique('competitor_competition_code_uq').on(t.competitionId, t.code),
  compIdx: index('competitor_competition_id_idx').on(t.competitionId),
}))

export const event = pgTable('event', {
  id: text('id').primaryKey(),
  competitionId: text('competition_id').notNull().references(() => competition.id),
  c1Code: text('c1_code').notNull(),
  c2Code: text('c2_code').notNull(),
  startUtc: timestamp('start_utc', { withTimezone: true }).notNull(),
  status: text('status').notNull(), // 'upcoming' | 'live' | 'final'
  score1: integer('score1'),
  score2: integer('score2'),
  winnerCode: text('winner_code'), // winning competitor code or 'DRAW', set when final
  round: text('round'),
  stage: text('stage').notNull().default('group'),
  // sport-specific payload: {group, matchday, venue, city, minute, phase, ht:[..], reg:[..],
  //  pen:[..], prob:{a,d,b}, markets, lineups, events, statistics, derby, doubleOwner}
  detail: jsonb('detail').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  compStartIdx: index('event_competition_start_idx').on(t.competitionId, t.startUtc),
  c1Fk: foreignKey({ columns: [t.c1Code, t.competitionId], foreignColumns: [competitor.code, competitor.competitionId], name: 'event_c1_fk' }),
  c2Fk: foreignKey({ columns: [t.c2Code, t.competitionId], foreignColumns: [competitor.code, competitor.competitionId], name: 'event_c2_fk' }),
}))

export const ranking = pgTable('ranking', {
  competitionId: text('competition_id').notNull(),
  competitorCode: text('competitor_code').notNull(),
  rank: integer('rank'),
  points: integer('points').notNull().default(0),
  stats: jsonb('stats'), // soccer: {played,win,draw,loss,gf,ga}
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.competitionId, t.competitorCode] }),
  competitorFk: foreignKey({ columns: [t.competitorCode, t.competitionId], foreignColumns: [competitor.code, competitor.competitionId], name: 'ranking_competitor_fk' }),
}))
```

  plus on `sweep`: `competitionId: text('competition_id').references(() => competition.id)` and `accountId: text('account_id').references(() => account.id)` (both **nullable for now** — tightened to `competitionId NOT NULL` in Task 17), and on `competitor` the composite-FK target note: the `event`/`ranking` FKs above target `(code, competition_id)`, which drizzle satisfies via `competitor_competition_code_uq`.
- Produces: seed guarantees — competition row `id='apifootball:1:2026'` (provider `apifootball`, sport `football`, leagueId `'1'`, season `'2026'`, format `groups_then_ko`, name `World Cup 2026`); `sweep` row `id='default'` bound to it; for every seeded `team` a `competitor` row with `id = 'cp_' + code`, same `code/name/color`, `providerId: null`, `meta: {group, pool, strength}`; for every `fixture` an `event` with the **same id** and `detail` carrying `{group, matchday, venue, city, prob, markets, ht, derby, doubleOwner}`; for every `standing` a `ranking` row (stats jsonb).

- [ ] **Step 1: Write the failing test** — replace the `reference tables exist` test in `api/test/schema.test.js` and add a round-trip:

```js
test('reference tables exist', async () => {
  const rows = await db.execute(sql`select table_name from information_schema.tables where table_schema='public'`)
  const names = rows.rows.map((r) => r.table_name)
  for (const t of ['person', 'team', 'ownership', 'sweep', 'team_crosswalk',
    'account', 'competition', 'competitor', 'event', 'ranking']) {
    expect(names).toContain(t)
  }
})

test('seed created the default competition, bound the default sweep, and mirrored ids', async () => {
  const [comp] = await db.select().from(competition)
  expect(comp.id).toBe('apifootball:1:2026')
  expect(comp.format).toBe('groups_then_ko')
  const [sw] = await db.select().from(sweep).where(eq(sweep.id, 'default'))
  expect(sw.competitionId).toBe(comp.id)
  const [ev] = await db.select().from(event).where(eq(event.id, 'm0'))
  const [fx] = await db.select().from(fixture).where(eq(fixture.id, 'm0'))
  expect(ev.c1Code).toBe(fx.t1Code)
  expect(ev.detail.group).toBe(fx.group)
  const [cp] = await db.select().from(competitor).where(eq(competitor.code, fx.t1Code))
  expect(cp.id).toBe('cp_' + fx.t1Code)
})
```

(add `competition, competitor, event, ranking, sweep, account` to the schema import in that file.)

- [ ] **Step 2: Run it** — `cd api && npx vitest run test/schema.test.js` — Expected: FAIL (tables missing).

- [ ] **Step 3: Implement schema** — append the tables from **Interfaces** verbatim to `api/src/db/schema.js`; add the two nullable columns to the existing `sweep` table definition.

- [ ] **Step 4: Regenerate migrations** — `cd api && rm -rf migrations && npx drizzle-kit generate --name init`. Inspect: exactly one SQL file creating ALL tables (old + new). Note: the old migration 0008 carried `INSERT INTO "sweep" ('default', …)` — that data now comes from seed (next step).

- [ ] **Step 5: Implement seed dual-write** — in `api/src/seed/seed.js`, at the TOP of `seed(db)` (before people, whose FK needs the sweep):

```js
const COMPETITION_ID = 'apifootball:1:2026'
await db.insert(s.competition).values({
  id: COMPETITION_ID, provider: 'apifootball', sport: 'football', leagueId: '1',
  season: '2026', format: 'groups_then_ko', name: 'World Cup 2026',
}).onConflictDoNothing()
await db.insert(s.sweep).values({
  id: 'default', name: 'The Sweep', kind: 'default', scoringRule: 'top3',
  coOwners: 'all_win', competitionId: COMPETITION_ID,
}).onConflictDoNothing()
```

then inside the existing loops, mirror each insert (keep the old inserts as-is):

```js
// in the teams loop, after the team/teamCrosswalk inserts:
await db.insert(s.competitor).values({
  id: `cp_${t.code}`, competitionId: COMPETITION_ID, code: t.code, name: t.name,
  color: t.color, providerId: null, meta: { group: t.group, pool: t.pool, strength: t.strength },
}).onConflictDoNothing()

// in the fixtures loop, after the fixture upsert:
const detail = {
  group: f.group, matchday: f.matchday, venue: f.venue, city: f.city,
  prob: f.prob, markets: f.markets ?? null,
  ht: f.ht ?? null, derby: !!f.derby, doubleOwner: (f.doubleOwners?.length ?? 0) > 0,
}
await db.insert(s.event).values({
  id: f.id, competitionId: COMPETITION_ID, c1Code: f.t1, c2Code: f.t2,
  startUtc: f.ko, status: f.status,
  score1: f.score?.[0] ?? null, score2: f.score?.[1] ?? null,
  stage: 'group', detail,
}).onConflictDoUpdate({
  target: s.event.id,
  set: { status: f.status, score1: f.score?.[0] ?? null, score2: f.score?.[1] ?? null, detail },
})

// in the standings loop, after the standing upsert:
await db.insert(s.ranking).values({
  competitionId: COMPETITION_ID, competitorCode: t.code, points: t.pts,
  stats: { played: t.played, win: t.win, draw: t.draw, loss: t.loss, gf: t.gf, ga: t.ga },
}).onConflictDoUpdate({
  target: [s.ranking.competitionId, s.ranking.competitorCode],
  set: { points: t.pts, stats: { played: t.played, win: t.win, draw: t.draw, loss: t.loss, gf: t.gf, ga: t.ga } },
})
```

- [ ] **Step 6: Run the schema test** — `npx vitest run test/schema.test.js` — Expected: PASS.
- [ ] **Step 7: Run the whole api suite** — `npm run test` from repo root — Expected: 293+ passed (the old data-migration sweep row is now seed-provided; `sweeps-resolve` / `bootstrap` tests must still pass). Investigate any failure before proceeding.
- [ ] **Step 8: Apply to the local dev DB** — `psql "$(grep '^DATABASE_URL=' .env | cut -d= -f2-)" -tc 'SELECT current_database()'` → must print `sweep_platform`; then `npm run db:migrate -w api && npm run db:seed -w api`.
- [ ] **Step 9: Commit** — `git add api/src/db/schema.js api/src/seed/seed.js api/test/schema.test.js api/migrations && git commit -m "feat(db): competition-scoped core tables + dual-write seed" && git push origin main`.

---

### Task 4: Event-shape helpers

**Files:**
- Create: `api/src/db/event-shape.js`
- Test: `api/test/event-shape.test.js`

**Interfaces:**
- Produces:
  - `flattenEvent(row)` → legacy-fixture-shaped object: `{ id, competitionId, t1Code: row.c1Code, t2Code: row.c2Code, kickoffUtc: row.startUtc, status, score1, score2, winnerCode, stage, round, group, matchday, venue, city, minute, phase, htScore1, htScore2, regScore1, regScore2, penScore1, penScore2, probA, probD, probB, markets, lineups, events, statistics, derby, doubleOwner, updatedAt }` — pair fields split from `detail.ht/reg/pen` arrays, `prob` split to `probA/D/B`, missing detail keys → `null` (`derby`/`doubleOwner` → `false`, `events` stays `null` when never polled).
  - `detailMerge(patch)` → drizzle `sql` fragment `event.detail || <patch jsonb>` for read-free partial detail updates.
- Consumes: `event` table from Task 3.

- [ ] **Step 1: Write the failing test**

```js
// api/test/event-shape.test.js
import { test, expect } from 'vitest'
import { flattenEvent } from '../src/db/event-shape.js'

const row = {
  id: 'm1', competitionId: 'apifootball:1:2026', c1Code: 'hr', c2Code: 'br',
  startUtc: new Date('2026-06-11T18:00:00Z'), status: 'final', score1: 2, score2: 1,
  winnerCode: 'hr', round: null, stage: 'group', updatedAt: new Date(),
  detail: {
    group: 'A', matchday: 1, venue: 'Azteca', city: 'Mexico City', minute: 90, phase: null,
    ht: [1, 0], reg: [2, 1], pen: null, prob: { a: 40, d: 30, b: 30 },
    markets: { '1x2': {} }, lineups: null, events: [{ id: 'e1', type: 'goal' }],
    statistics: { hr: { corners: 5 } }, derby: true, doubleOwner: false,
  },
}

test('flattenEvent produces the legacy fixture shape', () => {
  const f = flattenEvent(row)
  expect(f.t1Code).toBe('hr'); expect(f.t2Code).toBe('br')
  expect(f.kickoffUtc).toEqual(row.startUtc)
  expect(f.group).toBe('A'); expect(f.matchday).toBe(1)
  expect(f.htScore1).toBe(1); expect(f.htScore2).toBe(0)
  expect(f.regScore1).toBe(2); expect(f.regScore2).toBe(1)
  expect(f.penScore1).toBeNull(); expect(f.penScore2).toBeNull()
  expect(f.probA).toBe(40); expect(f.probD).toBe(30); expect(f.probB).toBe(30)
  expect(f.events).toEqual([{ id: 'e1', type: 'goal' }])
  expect(f.derby).toBe(true); expect(f.doubleOwner).toBe(false)
  expect(f.winnerCode).toBe('hr'); expect(f.status).toBe('final')
})

test('flattenEvent handles an empty detail', () => {
  const f = flattenEvent({ ...row, detail: {} })
  expect(f.htScore1).toBeNull(); expect(f.minute).toBeNull()
  expect(f.probA).toBeNull(); expect(f.events).toBeNull()
  expect(f.derby).toBe(false); expect(f.doubleOwner).toBe(false)
  expect(f.venue).toBeNull()
})
```

- [ ] **Step 2: Run it** — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// api/src/db/event-shape.js
import { sql } from 'drizzle-orm'
import { event } from './schema.js'

const pair = (a) => (Array.isArray(a) ? [a[0] ?? null, a[1] ?? null] : [null, null])

/** Flatten an `event` row (+ its detail jsonb) into the legacy fixture field names,
 *  so settlement/serialization logic ports without rewriting its reads. */
export function flattenEvent(row) {
  const d = row.detail ?? {}
  const [htScore1, htScore2] = pair(d.ht)
  const [regScore1, regScore2] = pair(d.reg)
  const [penScore1, penScore2] = pair(d.pen)
  return {
    id: row.id, competitionId: row.competitionId,
    t1Code: row.c1Code, t2Code: row.c2Code,
    kickoffUtc: row.startUtc, status: row.status,
    score1: row.score1, score2: row.score2, winnerCode: row.winnerCode,
    stage: row.stage, round: row.round,
    group: d.group ?? null, matchday: d.matchday ?? null,
    venue: d.venue ?? null, city: d.city ?? null,
    minute: d.minute ?? null, phase: d.phase ?? null,
    htScore1, htScore2, regScore1, regScore2, penScore1, penScore2,
    probA: d.prob?.a ?? null, probD: d.prob?.d ?? null, probB: d.prob?.b ?? null,
    markets: d.markets ?? null, lineups: d.lineups ?? null,
    events: d.events ?? null, statistics: d.statistics ?? null,
    derby: d.derby ?? false, doubleOwner: d.doubleOwner ?? false,
    updatedAt: row.updatedAt,
  }
}

/** jsonb merge fragment: stored detail wins nothing, patch keys overwrite, other keys survive. */
export function detailMerge(patch) {
  return sql`${event.detail} || ${JSON.stringify(patch)}::jsonb`
}
```

- [ ] **Step 4: Run it** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(db): event flatten/merge helpers for the port"` + push.

---

### Task 5: Serializers

**Files:**
- Modify: `api/src/serialize.js`
- Test: `api/test/serialize.test.js` (extend)

**Interfaces:**
- Produces: `serializeCompetitor(c)` → identical wire shape to `serializeTeam` (`{code, name, group, pool, color, strength, squad}` — group/pool/strength/squad read from `c.meta`); `serializeEvent(row)` → identical wire shape to `serializeFixture` (implemented as `serializeFixture(flattenEvent(row))`). Old functions stay until Task 17.
- Consumes: `flattenEvent` (Task 4).

- [ ] **Step 1: Write the failing test** — append to `api/test/serialize.test.js`:

```js
import { serializeCompetitor, serializeEvent, serializeTeam, serializeFixture } from '../src/serialize.js'

test('serializeCompetitor matches the serializeTeam wire shape', () => {
  const meta = { group: 'A', pool: '1', strength: 80, squad: [{ name: 'X' }] }
  const c = { id: 'cp_hr', code: 'hr', name: 'Croatia', color: '#f00', meta }
  expect(serializeCompetitor(c)).toEqual(serializeTeam({
    code: 'hr', name: 'Croatia', group: 'A', pool: '1', color: '#f00', strength: 80, squad: meta.squad,
  }))
})

test('serializeEvent matches the serializeFixture wire shape for the same data', () => {
  const ev = {
    id: 'm1', c1Code: 'hr', c2Code: 'br', startUtc: new Date('2026-06-11T18:00:00Z'),
    status: 'upcoming', score1: null, score2: null, winnerCode: null, stage: 'group', round: null,
    detail: { group: 'A', matchday: 1, venue: 'V', city: 'C', prob: { a: 1, d: 2, b: 3 } },
  }
  const legacy = {
    id: 'm1', group: 'A', matchday: 1, t1Code: 'hr', t2Code: 'br',
    kickoffUtc: ev.startUtc, venue: 'V', city: 'C', status: 'upcoming',
    score1: null, score2: null, minute: null, phase: null, probA: 1, probD: 2, probB: 3,
    markets: null, htScore1: null, htScore2: null, penScore1: null, penScore2: null,
    lineups: null, events: null, statistics: null, stage: 'group', derby: false, doubleOwner: false, winnerCode: null,
  }
  expect(serializeEvent(ev)).toEqual(serializeFixture(legacy))
})
```

- [ ] **Step 2: Run it** — `npx vitest run test/serialize.test.js` — Expected: FAIL.

- [ ] **Step 3: Implement** — append to `api/src/serialize.js`:

```js
import { flattenEvent } from './db/event-shape.js'

export function serializeCompetitor(c) {
  const m = c.meta ?? {}
  return { code: c.code, name: c.name, group: m.group ?? null, pool: m.pool ?? null, color: c.color, strength: m.strength ?? null, squad: m.squad ?? null }
}
export function serializeEvent(row) {
  return serializeFixture(flattenEvent(row))
}
```

- [ ] **Step 4: Run it** — Expected: PASS. Also run the full serialize file: `npx vitest run test/serialize.test.js test/serialize-parlay.test.js`.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): competitor/event serializers emit the frozen wire shape"` + push.

---

### Task 6: Route port A — bootstrap, teams, standings

**Files:**
- Modify: `api/src/routes/bootstrap.js`, `api/src/routes/teams.js`, `api/src/routes/standings.js`
- Test: `api/test/bootstrap.test.js`, `api/test/standings.test.js` (assert same wire output — mostly unchanged; they must keep passing)

**Interfaces:**
- Consumes: `competitor`, `ranking` (Task 3), `serializeCompetitor` (Task 5).
- Produces: identical wire responses, now competition-scoped: reads filter `eq(competitor.competitionId, req.sweep.competitionId)`.
- Ownership stays code-based on the wire (`ownership_[personId] = [code…]`) — during transition `ownership.teamCode` still holds codes, so no translation yet (Task 16 re-keys ownership).

- [ ] **Step 1: Port `bootstrap.js`** — replace the `team` read:

```js
import { competitor } from '../db/schema.js'
import { serializeCompetitor } from '../serialize.js'
// in the handler:
const [teams, people, owns] = await Promise.all([
  app.db.select().from(competitor).where(eq(competitor.competitionId, req.sweep.competitionId)),
  app.db.select().from(person).where(eq(person.sweepId, sweepId)),
  app.db.select().from(ownership).where(eq(ownership.sweepId, sweepId)),
])
// and: teams: teams.map(serializeCompetitor),
```

- [ ] **Step 2: Port `teams.js`** — same substitution (`competitor` + `serializeCompetitor` + competitionId filter; lookup by `and(eq(competitor.code, req.params.code), eq(competitor.competitionId, req.sweep.competitionId))`). Ownership join unchanged (codes).

- [ ] **Step 3: Port `standings.js`** — read `competitor` (scoped by the default sweep's competition — this route has no sweep preHandler today; scope by the sweep resolved on the request: add `requireSweep(['member','admin'])` ONLY if the existing tests pass with it, otherwise resolve the competition of `req.sweep ?? default`; keep the output shape):

```js
import { and, eq } from 'drizzle-orm'
import { competitor, ranking } from '../db/schema.js'

export async function standingsRoutes(app) {
  app.get('/api/standings', async (req) => {
    const competitionId = req.sweep?.competitionId
    const [comps, rows] = await Promise.all([
      app.db.select().from(competitor).where(eq(competitor.competitionId, competitionId)),
      app.db.select().from(ranking).where(eq(ranking.competitionId, competitionId)),
    ])
    const byCode = Object.fromEntries(rows.map((r) => [r.competitorCode, { ...(r.stats ?? {}), pts: r.points }]))
    const tables = {}
    for (const t of comps) {
      const s = byCode[t.code] ?? { played: 0, win: 0, draw: 0, loss: 0, gf: 0, ga: 0, pts: 0 }
      ;(tables[t.meta?.group] ??= []).push({
        code: t.code, name: t.name, played: s.played ?? 0, win: s.win ?? 0, draw: s.draw ?? 0,
        loss: s.loss ?? 0, gf: s.gf ?? 0, ga: s.ga ?? 0, gd: (s.gf ?? 0) - (s.ga ?? 0), pts: s.pts ?? 0,
      })
    }
    for (const g of Object.keys(tables)) {
      tables[g].sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.name.localeCompare(y.name))
    }
    return tables
  })
}
```

- [ ] **Step 4: Run the affected tests** — `npx vitest run test/bootstrap.test.js test/standings.test.js test/sweeps-isolation.test.js` — Expected: PASS unchanged (the seed mirrors data, so outputs are identical). Then the full api suite.
- [ ] **Step 5: Commit** — `git commit -m "refactor(api): bootstrap/teams/standings read competitor+ranking"` + push.

---

### Task 7: Route port B — fixtures, social, detail

**Files:**
- Modify: `api/src/routes/fixtures.js`, `api/src/routes/social.js`
- Test: `api/test/fixtures.test.js`, `api/test/social.test.js`, `api/test/detail.test.js` (must keep passing unchanged)

**Interfaces:**
- Consumes: `event`, `serializeEvent`, `flattenEvent`.
- Produces: `/api/fixtures`, `/api/fixtures/:id` identical wire output from `event` rows; support-pick validation reads `event` (`support.fixtureId` column name is unchanged — its VALUES are event ids already).

- [ ] **Step 1: Port `fixtures.js`**

```js
import { and, asc, eq } from 'drizzle-orm'
import { event, ownership } from '../db/schema.js'
import { serializeEvent } from '../serialize.js'
import { requireSweep } from '../sweeps/auth.js'

export async function fixtureRoutes(app) {
  const member = requireSweep(['member', 'admin'])

  app.get('/api/fixtures', { preHandler: member }, async (req) => {
    const { team: teamCode, person: personId } = req.query
    let rows = await app.db.select().from(event)
      .where(eq(event.competitionId, req.sweep.competitionId)).orderBy(asc(event.startUtc))
    if (teamCode) rows = rows.filter((f) => f.c1Code === teamCode || f.c2Code === teamCode)
    if (personId) {
      const owns = await app.db.select().from(ownership)
        .where(and(eq(ownership.personId, personId), eq(ownership.sweepId, req.sweep.id)))
      const codes = new Set(owns.map((o) => o.teamCode))
      rows = rows.filter((f) => codes.has(f.c1Code) || codes.has(f.c2Code))
    }
    return rows.map(serializeEvent)
  })

  app.get('/api/fixtures/:id', { preHandler: member }, async (req, reply) => {
    const rows = await app.db.select().from(event).where(eq(event.id, req.params.id))
    if (!rows.length) return reply.code(404).send({ error: 'not_found' })
    return serializeEvent(rows[0])
  })
}
```

- [ ] **Step 2: Port `social.js`** — read the file; wherever it selects from `fixture` (pick validation / status gating), select from `event` and pass the row through `flattenEvent` before any `f.t1Code`/`f.kickoffUtc` access. `support` reads/writes unchanged.
- [ ] **Step 3: Run** — `npx vitest run test/fixtures.test.js test/social.test.js test/detail.test.js` — Expected: PASS unchanged. Then full api suite.
- [ ] **Step 4: Commit** — `git commit -m "refactor(api): fixtures/social routes read event rows"` + push.

---

### Task 8: Coins routes + admin

**Files:**
- Modify: `api/src/routes/coins.js`, `api/src/routes/admin.js`
- Test: `api/test/coins.test.js`, `api/test/admin-open-bets.test.js`, `api/test/admin-settle-stale.test.js`, `api/test/parlay-settle.test.js` (keep passing)

**Interfaces:**
- Consumes: `event`, `flattenEvent`.
- Produces: bet placement validates against `event` (status/kickoff via flattened fields); `bet.fixtureId` column and wire field names unchanged (values are event ids). Admin listings join `event` instead of `fixture` and flatten for display fields.

- [ ] **Step 1: Port `coins.js`** — read the file; substitute `fixture` selects with `event` selects + `flattenEvent`. Bet inserts keep writing `bet.fixtureId = <event id>`. Odds/markets reads come from `flattenEvent(row).markets`.
- [ ] **Step 2: Port `admin.js`** — same mechanical substitution for its open-bets/settle-stale listings.
- [ ] **Step 3: Run** — the four test files above, then the full api suite. Expected: PASS unchanged.
- [ ] **Step 4: Commit** — `git commit -m "refactor(api): coins/admin routes read event rows"` + push.

---

### Task 9: Settlement + rewards + regrade

**Files:**
- Modify: `api/src/coins/settle.js`, `api/src/coins/rewards.js`, `api/src/coins/regrade-gs.js`
- Test: `api/test/coins-settle.test.js`, `api/test/coins-rewards.test.js`, `api/test/coins-regrade-gs.test.js`, `api/test/parlay-settle.test.js`

**Interfaces:**
- Consumes: `event`, `flattenEvent`.
- Produces: `fixtureResult(f)`, `regulationResult(f)`, `resolveBet(market, selection, line, f)` — signatures unchanged, still take a **flattened** object; `settleBets(db, eventId, publish)`, `settleParlay(db, parlayId)`, `settleStaleBets(db, publish)`, `grantMatchRewards(db, eventId, publish)` — signatures unchanged.

- [ ] **Step 1: Port `settle.js`** — pure functions (`fixtureResult`/`htScores`/`regulationResult`/`resolveBet`) unchanged. In `settleBets`: `const [row] = await db.select().from(event).where(eq(event.id, fixtureId)); const f = row && flattenEvent(row)`. In `settleStaleBets`: join `event` instead of `fixture` (`eq(bet.fixtureId, event.id)`, `eq(event.status, 'final')`).
- [ ] **Step 2: Port `rewards.js`** — same head substitution; comparisons `s.teamCode === f.t1Code` etc. work as-is on the flattened shape (codes preserved). The `ownership.teamCode` join stays code-based until Task 16.
- [ ] **Step 3: Port `regrade-gs.js`** — read it; substitute its `fixture` reads the same way.
- [ ] **Step 4: Run** — the four test files, then the full api suite. Expected: PASS unchanged.
- [ ] **Step 5: Commit** — `git commit -m "refactor(coins): settlement reads event rows via flattenEvent"` + push.

---

### Task 10: Standings recompute → ranking

**Files:**
- Modify: `api/src/worker/recompute-standings.js`
- Test: `api/test/recompute-standings.test.js`

**Interfaces:**
- Consumes: `competitor`, `event`, `ranking`, `flattenEvent`.
- Produces: `recomputeStandings(db, competitionId)` — **signature gains competitionId**; writes `ranking` rows (stats jsonb + points). Callers: `worker.js` (Task 15) and `admin.js` if it calls it (check; pass the sweep's competitionId).

- [ ] **Step 1: Update the test first** — re-key `recompute-standings.test.js`: call `recomputeStandings(db, 'apifootball:1:2026')`, assert against `ranking` rows (`points`, `stats.win` …) instead of `standing` columns. Run it — Expected: FAIL.
- [ ] **Step 2: Implement**

```js
import { and, eq } from 'drizzle-orm'
import { competitor, event, ranking } from '../db/schema.js'
import { flattenEvent } from '../db/event-shape.js'
import { fixtureResult } from '../coins/settle.js'

export async function recomputeStandings(db, competitionId) {
  const comps = await db.select({ code: competitor.code }).from(competitor)
    .where(eq(competitor.competitionId, competitionId))
  const finals = (await db.select().from(event)
    .where(and(eq(event.competitionId, competitionId), eq(event.status, 'final')))).map(flattenEvent)

  const agg = {}
  for (const t of comps) agg[t.code] = { played: 0, win: 0, draw: 0, loss: 0, gf: 0, ga: 0, pts: 0 }
  for (const f of finals) {
    if (f.stage !== 'group') continue
    if (f.score1 == null || f.score2 == null) continue
    const a = agg[f.t1Code], b = agg[f.t2Code]
    if (!a || !b) continue
    const res = fixtureResult(f)
    if (!res) continue
    a.played++; b.played++
    a.gf += f.score1; a.ga += f.score2
    b.gf += f.score2; b.ga += f.score1
    if (res === 'HOME') { a.win++; a.pts += 3; b.loss++ }
    else if (res === 'AWAY') { b.win++; b.pts += 3; a.loss++ }
    else { a.draw++; b.draw++; a.pts++; b.pts++ }
  }

  let written = 0
  for (const code of Object.keys(agg)) {
    const { pts, ...stats } = agg[code]
    const now = new Date()
    await db.insert(ranking).values({ competitionId, competitorCode: code, points: pts, stats, updatedAt: now })
      .onConflictDoUpdate({ target: [ranking.competitionId, ranking.competitorCode], set: { points: pts, stats, updatedAt: now } })
    written++
  }
  return written
}
```

- [ ] **Step 3: Run** — the test file, then full suite (a failure in `worker`-adjacent tests means a missed caller — fix it now).
- [ ] **Step 4: Commit** — `git commit -m "refactor(worker): recompute standings into ranking, competition-scoped"` + push.

---

### Task 11: Provider-id resolution (crosswalk retired)

**Files:**
- Modify: `api/src/worker/crosswalk.js`, `api/src/worker/crosswalk-sync.js`
- Test: `api/test/crosswalk.test.js`

**Interfaces:**
- Produces: `resolveCrosswalk(db, competitionId)` → `Map<providerId, code>` built from `competitor` rows with non-null `providerId`; `assertResolved(map, ids)` unchanged (error message now says `competitor.provider_id missing …`). `crosswalk-sync.js` writes `competitor.providerId` instead of `team_crosswalk` rows.
- Consumes: `competitor`.

- [ ] **Step 1: Update the test first** — re-key `crosswalk.test.js`: insert/update `competitor.providerId` instead of `teamCrosswalk` rows; call `resolveCrosswalk(db, 'apifootball:1:2026')`. Run — FAIL.
- [ ] **Step 2: Implement**

```js
// api/src/worker/crosswalk.js
import { and, eq, isNotNull } from 'drizzle-orm'
import { competitor } from '../db/schema.js'

/** @returns {Promise<Map<number,string>>} providerId → competitor.code for one competition. */
export async function resolveCrosswalk(db, competitionId) {
  const rows = await db.select({ code: competitor.code, providerId: competitor.providerId })
    .from(competitor)
    .where(and(eq(competitor.competitionId, competitionId), isNotNull(competitor.providerId)))
  return new Map(rows.map((r) => [r.providerId, r.code]))
}

export function assertResolved(map, providerIds) {
  const missing = [...new Set(providerIds)].filter((id) => !map.has(id))
  if (missing.length) {
    throw new Error(`competitor.provider_id missing for provider team ids: ${missing.join(', ')}. Run \`npm run crosswalk:sync -w api\` and fill any unmatched.`)
  }
}
```

- [ ] **Step 3: Port `crosswalk-sync.js`** — read it; where it upserts `teamCrosswalk`, instead `db.update(competitor).set({ providerId }).where(and(eq(competitor.competitionId, competitionId), eq(competitor.code, code)))`. It gains a competitionId (from the default competition: `select … from competition order by createdAt limit 1` — `// ponytail: single-competition CLI; parameterize when self-serve lands (P3)`).
- [ ] **Step 4: Run** — crosswalk tests + full suite (callers `worker.js`/`baseline-sync.js` still pass the OLD signature — they are ported in Tasks 12/15; if the suite breaks here, thread `competitionId` through those call sites now with the default-competition lookup).
- [ ] **Step 5: Commit** — `git commit -m "refactor(worker): provider-id resolution reads competitor.providerId"` + push.

---

### Task 12: Baseline sync port

**Files:**
- Modify: `api/src/worker/baseline-sync.js`
- Test: `api/test/baseline-sync.test.js`, `api/test/baseline-prune.test.js`

**Interfaces:**
- Produces: `syncBaseline(db, provider, { season, competitionId })` — writes `event` (upsert with `detailMerge`) + `ranking`; prune + dependent-row cleanup unchanged but against `event`; `refundPrunedParlays(db, keep)` unchanged.
- Consumes: `resolveCrosswalk(db, competitionId)` (Task 11), `detailMerge` (Task 4), `computeFlags` (unchanged), `backfillFinalEvents` (Task 13 — until then it still exists with its current name in live-poller; keep the import working).

- [ ] **Step 1: Update the tests first** — re-key `baseline-sync.test.js` / `baseline-prune.test.js`: assertions read `event`/`ranking` (through `flattenEvent` where they check ht/venue/prob fields), calls pass `{ season, competitionId: 'apifootball:1:2026' }`. Run — FAIL.
- [ ] **Step 2: Port the writes** — in `syncBaseline`:
  - fixture upsert →

```js
const detail = {
  group: f.group, matchday: f.matchday, venue: f.venue, city: f.city,
  minute: f.minute ?? null, phase: f.phase ?? null,
  ht: f.htScore1 == null ? null : [f.htScore1, f.htScore2],
  reg: f.regScore1 == null ? null : [f.regScore1, f.regScore2],
  pen: f.penScore1 == null ? null : [f.penScore1, f.penScore2],
  derby: fl.derby, doubleOwner: fl.doubleOwner,
  ...(prob ? { prob } : {}), ...(m?.markets ? { markets: m.markets } : {}),
}
await db.insert(event).values({
  id: f.id, competitionId, c1Code: f.t1Code, c2Code: f.t2Code,
  startUtc: f.kickoffUtc, status: f.status, score1: f.score1, score2: f.score2,
  winnerCode, stage: f.stage || 'group', detail, updatedAt: new Date(),
}).onConflictDoUpdate({
  target: event.id,
  set: {
    c1Code: f.t1Code, c2Code: f.t2Code, startUtc: f.kickoffUtc, status: f.status,
    score1: f.score1, score2: f.score2, winnerCode, stage: f.stage || 'group',
    detail: detailMerge(detail), // preserves stored lineups/events/statistics keys
    updatedAt: new Date(),
  },
})
```

  - standings upsert → `ranking` (same shape as Task 10's upsert, from the provider numbers)
  - prune block: `support`/`bet`/`coinLedger`/`parlay` deletes unchanged (fixtureId values ARE event ids); final delete `db.delete(event).where(and(eq(event.competitionId, competitionId), notInArray(event.id, keep)))` — **scope the prune by competitionId** so one competition's baseline can never wipe another's events.
  - `resolveCrosswalk(db)` → `resolveCrosswalk(db, competitionId)`.
  - syncLog rows unchanged.
- [ ] **Step 3: Run** — the two test files, then the full suite.
- [ ] **Step 4: Commit** — `git commit -m "refactor(worker): baseline sync writes competition-scoped event/ranking"` + push.

---

### Task 13: Live poller port

**Files:**
- Modify: `api/src/worker/live-poller.js`
- Test: `api/test/live-poller.test.js`

**Interfaces:**
- Produces: same exports, same signatures except each polling function reads/writes `event`: `isLiveWindow`, `fixturesToPoll`, `isLineupWindow` (pure — unchanged), `pollLive(db, provider, ids, publish)`, `pollEvents(db, provider, ids, crosswalk, publish)`, `pollStatistics(…)`, `pollLineups(…)`, `backfillFinalEvents(…)`, `backfillFinalStatistics(…)`. SSE payload keys unchanged (`fixtureId`, `teamCode`).
- Consumes: `event`, `flattenEvent`, `detailMerge`.

- [ ] **Step 1: Update the test first** — re-key `live-poller.test.js` to seed/read `event` rows (flatten for ht/reg/pen assertions). Run — FAIL.
- [ ] **Step 2: Port** — mechanical substitutions:
  - `pollLive`: select from `event` where `inArray(event.id, ids)`; flatten each current row for the change-comparison (identical field-by-field guard); write:

```js
await db.update(event).set({
  status: f.status, score1: f.score1, score2: f.score2, winnerCode,
  detail: detailMerge({
    minute: f.minute ?? null, phase: f.phase ?? null,
    ht: f.htScore1 == null ? null : [f.htScore1, f.htScore2],
    reg: f.regScore1 == null ? null : [f.regScore1, f.regScore2],
    pen: f.penScore1 == null ? null : [f.penScore1, f.penScore2],
  }),
  updatedAt: new Date(),
}).where(eq(event.id, f.id))
```

  - `pollEvents` / `pollStatistics` / `pollLineups`: reads select `event.detail` (use `flattenEvent` to get `.events`/`.statistics`/`.lineups`); writes use `detailMerge({ events: fetched })`, `detailMerge({ statistics: merged })`, `detailMerge({ lineups })`.
  - `backfillFinal*`: `isNull(fixture.events)` has no column anymore → filter with drizzle `sql` on jsonb: `sql`${event.detail} -> 'events' IS NULL`` (and same for `statistics`).
- [ ] **Step 3: Run** — the test file, then the full suite.
- [ ] **Step 4: Commit** — `git commit -m "refactor(worker): live poller reads/writes event rows"` + push.

---

### Task 14: Team-ops port — sync-teams, reconcile-teams, sync-squads, cutover

**Files:**
- Modify: `api/src/worker/sync-teams.js`, `api/src/worker/reconcile-teams.js`, `api/src/worker/sync-squads.js`, `api/src/worker/cutover.js`, `api/src/worker/run-squads.js`, `api/src/worker/run-baseline.js`
- Test: `api/test/reconcile-teams.test.js`, `api/test/sync-squads.test.js`

**Interfaces:**
- Produces: `syncTeams(db, provider, { season, competitionId })` — reconciles `competitor` rows (insert/update/delete + `providerId`) for one competition; squads write `competitor.meta.squad` (jsonb merge on meta); CLI runners resolve the default competition (`order by createdAt limit 1`).
- Consumes: `competitor`, `ranking`.

- [ ] **Step 1: Update tests first** (re-key to competitor rows; `meta.group` instead of `group` column). Run — FAIL.
- [ ] **Step 2: Port `sync-teams.js`** — deletes: `ownership` (by code — still code-keyed until Task 16), `ranking` row, `competitor` row; **drop the dead `photo.teamCode` line** (`db.update(photo).set({ teamCode: null })…` — that column was removed in inherited migration 0002; the bug dies here). Updates/inserts write `competitor` with `meta: { group, pool, strength }` and `providerId` directly (no crosswalk table).
- [ ] **Step 3: Port `sync-squads.js`** — squad list lands via `db.update(competitor).set({ meta: sql\`${competitor.meta} || ${JSON.stringify({ squad })}::jsonb\` })`.
- [ ] **Step 4: Port `cutover.js` + runners** — read them; substitute table names and thread `competitionId` from the default-competition lookup.
- [ ] **Step 5: Run** — the two test files, then full suite.
- [ ] **Step 6: Commit** — `git commit -m "refactor(worker): team ops maintain competitor rows (crosswalk table retired)"` + push.

---

### Task 15: Worker orchestrator — per-competition loop

**Files:**
- Modify: `api/src/worker.js`
- Test: none new (the worker entry is glue — its pieces are tested; verify by boot in Task 18)

**Interfaces:**
- Consumes: everything above.
- Produces: worker iterates competitions that have ≥1 active sweep (`sweep.archivedAt IS NULL`), running baseline + live tick per competition — the §7 dedupe-by-competition (N sweeps, one competition, one poll).

- [ ] **Step 1: Rewrite the orchestration head**

```js
import { isNull, and, eq, inArray } from 'drizzle-orm'
import { event, sweep, competition } from './db/schema.js'

/** Competitions worth syncing: bound to at least one live (unarchived) sweep. */
async function activeCompetitions(db) {
  const rows = await db.selectDistinct({ id: sweep.competitionId }).from(sweep)
    .where(isNull(sweep.archivedAt))
  return rows.map((r) => r.id).filter(Boolean)
}

async function baseline(reason) {
  for (const competitionId of await activeCompetitions(db)) {
    try {
      const r = await syncBaseline(db, provider, { season, competitionId })
      await publish(db, { type: 'sync' })
      console.log(`[baseline:${reason}] ${competitionId}: ${r.fixtures} fixtures`)
    } catch (e) { console.error(`[baseline:${reason}] ${competitionId} failed (last-good intact):`, e.message) }
  }
}
```

  The live tick loops the same list: select events per competition, `fixturesToPoll` on `{ id, ko: startUtc, status }` rows (flatten only where lineups are checked), pass `competitionId` to `resolveCrosswalk`, `recomputeStandings(db, competitionId)` on newly-final. `// ponytail: sequential per-competition loop; parallelize if >10 active competitions ever matters (P4 concern).`
- [ ] **Step 2: Static syntax check** — `cd api && node --check src/worker.js`. Full suite still green (`npm run test`).
- [ ] **Step 3: Commit** — `git commit -m "refactor(worker): sync loop iterates competitions with active sweeps"` + push.

---

### Task 16: Sweep creation + ownership re-key

**Files:**
- Modify: `api/src/routes/sweeps.js` (create route binds a competition; ownership endpoints resolve codes → competitor ids), `api/src/db/schema.js` (ownership: `teamCode` → `competitorId` FK → `competitor.id`), `api/src/seed/seed.js` (ownership seeds competitorId), plus every `ownership.teamCode` read: `api/src/routes/bootstrap.js`, `api/src/routes/teams.js`, `api/src/routes/fixtures.js`, `api/src/coins/rewards.js`, `api/src/worker/flags.js` (check), `api/src/worker/sync-teams.js`
- Test: `api/test/sweeps-admin.test.js`, `api/test/roster.test.js`, `api/test/coins-rewards.test.js`, `api/test/fixtures.test.js`, `api/test/bootstrap.test.js`
- Regenerate: `api/migrations/`

**Interfaces:**
- Produces: `ownership` = `{ sweepId, personId, competitorId → competitor.id }`, PK `(personId, competitorId)`; wire contract still code-based everywhere (routes translate). `POST /api/super/sweeps` body stays `{name}` (optional `competitionId`), defaulting to the earliest competition; new sweeps get `competitionId` set.
- Translation helper (new, in `api/src/routes/competitors.js`): `codeToCompetitorId(db, competitionId, code)` and `competitorCodeMap(db, competitionId)` → `Map<id, code>`.

- [ ] **Step 1: Update tests first** — ownership admin tests still POST `{personId, teamCode}` and expect the same 201/409 wire responses (unchanged!); only DB-level assertions in tests (if any select `ownership.teamCode`) re-key to `competitorId`. Run — some FAIL after schema change (next step).
- [ ] **Step 2: Schema change** — in `ownership`: replace `teamCode` column with `competitorId: text('competitor_id').notNull().references(() => competitor.id)`, PK `(personId, competitorId)`. Regen migrations (wipe + generate). Update seed: `competitorId: \`cp_${tc}\``.
- [ ] **Step 3: Port the readers/writers** — bootstrap/teams/fixtures/rewards/sync-teams/flags: wherever ownership codes were compared to event codes, translate once per request via `competitorCodeMap` (id → code) and keep emitting codes on the wire. Admin ownership POST/DELETE/bulk: resolve incoming `teamCode` → competitor id scoped to `req.sweep.competitionId`; unknown code → 400 `{ error: 'unknown_team' }` (matches existing unknown-person pattern).
- [ ] **Step 4: Sweep create route** —

```js
const createBody = {
  type: 'object', required: ['name'], additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 80 },
    competitionId: { type: 'string', minLength: 1, maxLength: 120 },
  },
}
// in the handler:
const competitionId = req.body.competitionId
  ?? (await app.db.select().from(competition).orderBy(asc(competition.createdAt)).limit(1))[0]?.id
if (!competitionId) return reply.code(400).send({ error: 'no_competition' })
await app.db.insert(sweep).values({ id, name: req.body.name, kind: 'token', memberToken, adminToken, competitionId })
```

  `// ponytail: default = the one seeded competition; the catalog picker is P3.`
- [ ] **Step 5: Run** — the five test files, then the FULL api suite + `npm test -w web` (ownership wire shape is load-bearing for the web).
- [ ] **Step 6: Commit** — `git commit -m "feat(api): sweeps bind competitions; ownership re-keyed to competitor ids"` + push.

---

### Task 17: The swap — old tables die

**Files:**
- Modify: `api/src/db/schema.js` (delete `team`, `fixture`, `standing`, `teamCrosswalk`; re-point `support.fixtureId`/`bet.fixtureId`/`photo.fixtureId` FKs to `event.id`; `sweep.competitionId` → `.notNull()`), `api/src/seed/seed.js` (delete the old-table writes; keep new only), `api/test/schema.test.js` (old tables now must NOT exist; jsonb round-trips port to `event.detail`/`competitor.meta`)
- Regenerate: `api/migrations/`
- Delete: any straggler imports of the four dead exports (`grep -rn "from '../db/schema.js'" api/src | …` — verify none reference `team\b|fixture\b|standing\b|teamCrosswalk`)

**Interfaces:**
- Produces: the final greenfield schema — 13 tables: `account, competition, competitor, event, ranking, sweep, person, ownership, support, coin_ledger, parlay, bet, photo, sync_log` (+ drizzle journal). One migration file.

- [ ] **Step 1: Update `schema.test.js` first** — flip the assertion: old names (`team`, `fixture`, `standing`, `team_crosswalk`) must be ABSENT; port the three jsonb round-trip tests to `event.detail`/`competitor.meta`. Run — FAIL.
- [ ] **Step 2: Delete + re-point** — remove the four table definitions; in `support`/`bet`/`photo` change `.references(() => fixture.id …)` → `.references(() => event.id …)` (keep `onDelete` behaviors: photo `set null`, others as today); `sweep.competitionId` gains `.notNull()`.
- [ ] **Step 3: Fix stragglers** — `grep -rn "teamCrosswalk\|from(team)\|from(fixture)\|from(standing)\|\bteam\b" api/src --include='*.js' | grep -v competitor` — every hit is a bug; port or delete it (candidates: `seed/import-roster.js`, `seed/roster.js`, `routes/people.js`, `optout.js`, `photos` routes — check each).
- [ ] **Step 4: Regen migrations** — wipe + generate; inspect: no old tables in the SQL.
- [ ] **Step 5: Run everything** — full api suite AND web suite. Expected: api all green (count may differ from 293 where tests were re-keyed — every file passes), web exactly 436 passed, unmodified.
- [ ] **Step 6: Reset the dev DB** — verify `current_database()` = `sweep_platform`, then `psql "$DBURL" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'` and `npm run db:migrate -w api && npm run db:seed -w api`. (Throwaway dev data by design — greenfield.)
- [ ] **Step 7: Commit** — `git commit -m "feat(db)!: drop soccer-shaped tables — event/competitor/ranking are the schema"` + push.

---

### Task 18: End-to-end verification

**Files:** none (verification only; fix-forward commits if anything surfaces).

- [ ] **Step 1: Suites** — `npm run test` (api) and `npm test -w web`: all green. `npm run build`: succeeds.
- [ ] **Step 2: Boot the real app against `sweep_platform`** — `npm run dev:api` in background; then:

```bash
curl -s localhost:3000/api/health          # {"ok":true}-shaped
curl -s localhost:3000/api/standings | head -c 400   # group tables from ranking rows
curl -s -X POST localhost:3000/api/session -H 'content-type: application/json' -d '{"token":"<member token or default-sweep flow per sweeps-resolve tests>"}'
```

  (exact port/paths per `api/src/server.js` — read it first; the default sweep resolves on non-platform host, so plain GETs against localhost hit the default sweep.)
- [ ] **Step 3: Boot the web dev server** — `npm run dev:web`, load the app in a browser (or Playwright): teams render, fixtures list renders, standings render — data now served from competitor/event/ranking.
- [ ] **Step 4: Stop the servers.** Report: suite counts, boot evidence, any deviations.
- [ ] **Step 5: Final push** — `git push origin main`; confirm `git status` clean.

---

## Self-Review (done at write time)

- **Spec coverage:** competition/competitor/event/ranking/account tables (T3), composite-FK integrity (T3 schema), sports config (T2), fresh migrations (T3/T16/T17 regen), seed with competition + default sweep (T3, T17), worker dedupe-by-competition (T15), wire contract frozen (T5–T9, proven T17/T18), crosswalk retired into `competitor.providerId` (T11), dead `photo.teamCode` bug dies (T14), ownership → competitorId (T16), account stub + nullable `sweep.accountId` (T3). Out-of-scope items (§7 of the design doc) have no tasks — correct.
- **Type consistency:** `flattenEvent` output feeds `serializeFixture` (T5), `fixtureResult`/`resolveBet` (T9), recompute (T10) — all consume the legacy field names it produces. `resolveCrosswalk(db, competitionId)` signature change is threaded through T12 (baseline), T13 (live), T15 (worker), T14 (CLI). `recomputeStandings(db, competitionId)` callers updated in T15.
- **Known judgment calls (flagged, not hidden):** events/rankings reference competitors by `(code, competitionId)` (header note — design-doc amendment required); drizzle numbers the fresh migration 0000; `standings` route stays sweep-resolved rather than gaining auth (T6 keeps existing behavior).

---

## Post-implementation follow-ups (final whole-branch review, 2026-07-03)

Branch merged as commits `3c3999f..12ccefa` (18 tasks + 2 review fixes). All
tasks individually reviewed; final review verdict: mergeable after the
competition-scoped prune fix (landed as `12ccefa`).

**PHASE-2 BLOCKING GATE — no second competition row may ship before these:**

1. **`seasonAnchor` must be per-competition** (`api/src/coins/ledger.js`) —
   weekly coin-grant anchor is a global `min(event.startUtc)`; a second
   competition with an earlier season inflates every sweep's week index and
   mints retroactive grants.
2. **Scope all bare event-id lookups by the sweep's competition** — one shared
   helper for the five call sites: `GET /api/fixtures/:id`, `POST /api/bet`,
   parlay legs, `POST /api/support`, fan-photo upload. Today members of sweep A
   can reference competition B's events by id.
3. **Make `refundPrunedParlays`'s scope param required** (currently optional →
   global when omitted; one production caller passes it; the unit test builds
   its own subquery).

**Follow-up tickets (non-blocking):**
- CLI hardening: loud "no competition found" guard in the default-competition
  lookups (sync-squads, run-stats-backfill, crosswalk-sync); fix or delete
  `seed/import-roster.js` (pre-existing missing-sweepId bug, untested CLI).
- `POST /api/super/sweeps` with an unknown `competitionId` FK-fails → 500;
  should 400.
- `pollLineups`'s internal `if (f.lineups)` skip-guard depends on the caller's
  row shape (worker pre-filters via `detail.lineups`) — flatten or comment.
- `reconcile-teams` emits an unconsumed `flagCode`; wire to `competitor.logo`
  or drop.

Accepted as designed: seed detail-block duplication, shallow `detailMerge`,
standings fail-closed `{}` for unauthenticated platform hosts (P3 picker),
full-detail tick select, global `WC_SEASON` (P2 provider registry owns it).
