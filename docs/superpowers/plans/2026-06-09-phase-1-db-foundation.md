# Phase 1 — DB Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the monorepo and a Fastify + Postgres + Drizzle backend that serves the existing frontend's data from a seeded database through read-only REST endpoints.

**Architecture:** npm-workspaces monorepo (`web/` = existing Vite SPA, `api/` = Fastify backend). The api uses Drizzle ORM over a `pg` pool. A seed script ports the deterministic generation already in `web/src/data.js` into Postgres, so read endpoints (`/api/bootstrap`, `/api/fixtures`, `/api/standings`, `/api/people`, `/api/teams/:code`, `/api/photos`) return believable data before the football worker exists. Integration tests run against a real Postgres via Testcontainers.

**Tech Stack:** Node 22 (ESM), npm workspaces, Fastify 5, Drizzle ORM + drizzle-kit, `pg`, Vitest, `@testcontainers/postgresql`, Postgres 16, Docker Compose.

---

## File Structure

```
package.json                      workspace root (workspaces: web, api)
web/                              existing app, moved verbatim
  package.json  index.html  vite.config.js  src/…
api/
  package.json
  drizzle.config.js
  vitest.config.js
  migrations/                     drizzle-kit generated SQL
  src/
    db/
      schema.js                   all Drizzle tables (one responsibility: schema)
      client.js                   pg Pool + drizzle instance factory
      migrate.js                  apply migrations programmatically
    seed/
      generate.js                 ported from web/src/data.js (pure generation)
      seed.js                     idempotent insert of generated data
    routes/
      bootstrap.js  fixtures.js  standings.js  people.js  teams.js  photos.js
    serialize.js                  row → API shape helpers (shared by routes)
    app.js                        Fastify app factory: buildApp(db) → app
    server.js                     entrypoint: connect + buildApp + listen
  test/
    helpers/global-setup.js       starts PG container, migrates, seeds
    helpers/db.js                 test db handle
    *.test.js
infra/
  docker-compose.dev.yml          postgres + api (dev)
```

---

## Task 1: Monorepo workspace + move the web app

**Files:**
- Create: `package.json` (new workspace root)
- Move: all current root app files → `web/`

- [ ] **Step 1: Move the existing app into `web/`**

```bash
mkdir -p web
git mv src web/src
git mv index.html web/index.html
git mv vite.config.js web/vite.config.js
git mv package.json web/package.json
git mv package-lock.json web/package-lock.json
git mv README.md web/README.md
rm -rf node_modules dist        # will reinstall at root
```

- [ ] **Step 2: Create the workspace-root `package.json`**

```json
{
  "name": "the-sweep",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "workspaces": ["web", "api"],
  "scripts": {
    "dev:web": "npm run dev -w web",
    "dev:api": "npm run dev -w api",
    "build": "npm run build -w web",
    "test": "npm run test -w api"
  }
}
```

- [ ] **Step 3: Point the web dev server at the api via a proxy**

Modify `web/vite.config.js`:

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
})
```

- [ ] **Step 4: Verify the web build still works from the workspace root**

Run: `npm install && npm run build`
Expected: Vite build succeeds, `web/dist/` produced, no errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: convert to npm workspaces, move app into web/"
```

---

## Task 2: API scaffold (Fastify + Postgres + Vitest)

**Files:**
- Create: `api/package.json`, `api/src/app.js`, `api/src/server.js`, `api/src/db/client.js`, `api/vitest.config.js`, `api/test/helpers/global-setup.js`, `api/test/helpers/db.js`, `api/test/health.test.js`

- [ ] **Step 1: Create `api/package.json`**

```json
{
  "name": "@sweep/api",
  "private": true,
  "type": "module",
  "version": "1.0.0",
  "scripts": {
    "dev": "node --watch src/server.js",
    "start": "node src/server.js",
    "test": "vitest run",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "node src/db/migrate.js",
    "db:seed": "node src/seed/seed.js"
  },
  "dependencies": {
    "drizzle-orm": "^0.36.4",
    "fastify": "^5.2.0",
    "pg": "^8.13.1"
  },
  "devDependencies": {
    "@testcontainers/postgresql": "^10.16.0",
    "drizzle-kit": "^0.28.1",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create the db client factory `api/src/db/client.js`**

```js
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './schema.js'

export function createPool(connectionString = process.env.DATABASE_URL) {
  return new pg.Pool({ connectionString })
}

export function createDb(pool) {
  return drizzle(pool, { schema })
}
```

- [ ] **Step 3: Create the Fastify app factory `api/src/app.js`**

```js
import Fastify from 'fastify'

export function buildApp(db, opts = {}) {
  const app = Fastify({ logger: opts.logger ?? false })
  app.decorate('db', db)
  app.get('/api/health', async () => ({ ok: true }))
  return app
}
```

- [ ] **Step 4: Create the entrypoint `api/src/server.js`**

```js
import { createPool, createDb } from './db/client.js'
import { buildApp } from './app.js'

const pool = createPool()
const db = createDb(pool)
const app = buildApp(db, { logger: true })

const port = Number(process.env.PORT ?? 3000)
app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err)
  process.exit(1)
})
```

- [ ] **Step 5: Create `api/vitest.config.js` (single shared PG container)**

```js
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['./test/helpers/global-setup.js'],
    hookTimeout: 120000,
    testTimeout: 30000,
    pool: 'forks',
    fileParallelism: false,
  },
})
```

- [ ] **Step 6: Create `api/test/helpers/global-setup.js`**

> Migrates and seeds run in later tasks; for now the container just starts and exposes `DATABASE_URL`.

```js
import { PostgreSqlContainer } from '@testcontainers/postgresql'

let container

export async function setup() {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()
}

export async function teardown() {
  await container?.stop()
}
```

- [ ] **Step 7: Create `api/test/helpers/db.js`**

```js
import { createPool, createDb } from '../../src/db/client.js'

export function openTestDb() {
  const pool = createPool(process.env.DATABASE_URL)
  return { pool, db: createDb(pool) }
}
```

- [ ] **Step 8: Write the failing health test `api/test/health.test.js`**

```js
import { expect, test, afterAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'

const { pool, db } = openTestDb()
const app = buildApp(db)
afterAll(async () => { await app.close(); await pool.end() })

test('GET /api/health returns ok', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/health' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ ok: true })
})
```

- [ ] **Step 9: Install and run the test**

Run: `npm install && npm run test -w api`
Expected: PASS (1 test). The PG container boots once via global-setup.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(api): Fastify scaffold with Postgres client and Vitest+Testcontainers harness"
```

---

## Task 3: Drizzle schema — reference tables

**Files:**
- Create: `api/src/db/schema.js`, `api/drizzle.config.js`, `api/src/db/migrate.js`
- Test: `api/test/schema.test.js`

- [ ] **Step 1: Create `api/drizzle.config.js`**

```js
export default {
  schema: './src/db/schema.js',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL },
}
```

- [ ] **Step 2: Create `api/src/db/schema.js` with the reference tables**

```js
import { pgTable, text, integer, primaryKey } from 'drizzle-orm/pg-core'

export const person = pgTable('person', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  short: text('short').notNull(),
  initials: text('initials').notNull(),
  avColor: text('av_color').notNull(),
  avatarPath: text('avatar_path'),
})

export const team = pgTable('team', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  group: text('group').notNull(),
  pool: text('pool').notNull(),
  color: text('color').notNull(),
  strength: integer('strength').notNull(),
  flagCode: text('flag_code').notNull(),
})

export const ownership = pgTable('ownership', {
  personId: text('person_id').notNull().references(() => person.id),
  teamCode: text('team_code').notNull().references(() => team.code),
}, (t) => ({ pk: primaryKey({ columns: [t.personId, t.teamCode] }) }))

export const scoringConfig = pgTable('scoring_config', {
  id: integer('id').primaryKey(),       // always 1
  rule: text('rule').notNull(),          // 'top3'
  coOwners: text('co_owners').notNull(), // 'all_win'
})

export const teamCrosswalk = pgTable('team_crosswalk', {
  teamCode: text('team_code').primaryKey().references(() => team.code),
  providerTeamId: integer('provider_team_id'), // filled in Phase 2
})
```

- [ ] **Step 3: Create the migrate helper `api/src/db/migrate.js`**

```js
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createPool, createDb } from './client.js'

export async function runMigrations(db) {
  await migrate(db, { migrationsFolder: new URL('../../migrations', import.meta.url).pathname })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = createPool()
  const db = createDb(pool)
  await runMigrations(db)
  await pool.end()
  console.log('migrations applied')
}
```

- [ ] **Step 4: Generate the migration SQL**

Run: `npm run db:generate -w api`
Expected: a new file under `api/migrations/0000_*.sql` containing the five tables.

- [ ] **Step 5: Wire migrations into the test harness**

Modify `api/test/helpers/global-setup.js` `setup()` — append after setting `DATABASE_URL`:

```js
  const { createPool, createDb } = await import('../../src/db/client.js')
  const { runMigrations } = await import('../../src/db/migrate.js')
  const pool = createPool(process.env.DATABASE_URL)
  await runMigrations(createDb(pool))
  await pool.end()
```

- [ ] **Step 6: Write the failing schema test `api/test/schema.test.js`**

```js
import { expect, test, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'

const { pool, db } = openTestDb()
afterAll(async () => { await pool.end() })

test('reference tables exist', async () => {
  const rows = await db.execute(sql`select table_name from information_schema.tables where table_schema='public'`)
  const names = rows.rows.map((r) => r.table_name)
  for (const t of ['person', 'team', 'ownership', 'scoring_config', 'team_crosswalk']) {
    expect(names).toContain(t)
  }
})
```

- [ ] **Step 7: Run the test**

Run: `npm run test -w api`
Expected: PASS — tables created by the migrator in global-setup.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(api): Drizzle reference schema + migrator"
```

---

## Task 4: Drizzle schema — synced, social, and photo tables

**Files:**
- Modify: `api/src/db/schema.js`
- Test: `api/test/schema.test.js` (extend)

- [ ] **Step 1: Append the remaining tables to `api/src/db/schema.js`**

```js
import { timestamp, boolean, jsonb, serial, unique } from 'drizzle-orm/pg-core'

export const fixture = pgTable('fixture', {
  id: text('id').primaryKey(),
  group: text('group').notNull(),
  matchday: integer('matchday').notNull(),
  t1Code: text('t1_code').notNull().references(() => team.code),
  t2Code: text('t2_code').notNull().references(() => team.code),
  kickoffUtc: timestamp('kickoff_utc', { withTimezone: true }).notNull(),
  venue: text('venue').notNull(),
  city: text('city').notNull(),
  status: text('status').notNull(),          // upcoming | live | final
  score1: integer('score1'),
  score2: integer('score2'),
  minute: integer('minute'),
  probA: integer('prob_a'),
  probD: integer('prob_d'),
  probB: integer('prob_b'),
  stage: text('stage').notNull().default('group'),
  derby: boolean('derby').notNull().default(false),
  doubleOwner: boolean('double_owner').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const standing = pgTable('standing', {
  teamCode: text('team_code').primaryKey().references(() => team.code),
  played: integer('played').notNull().default(0),
  win: integer('win').notNull().default(0),
  draw: integer('draw').notNull().default(0),
  loss: integer('loss').notNull().default(0),
  gf: integer('gf').notNull().default(0),
  ga: integer('ga').notNull().default(0),
  pts: integer('pts').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const syncLog = pgTable('sync_log', {
  id: serial('id').primaryKey(),
  ranAt: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
  source: text('source').notNull(),
  kind: text('kind').notNull(),              // baseline | live
  status: text('status').notNull(),          // ok | error
  counts: jsonb('counts'),
  error: text('error'),
})

export const watch = pgTable('watch', {
  fixtureId: text('fixture_id').notNull().references(() => fixture.id),
  personId: text('person_id').notNull().references(() => person.id),
}, (t) => ({ pk: primaryKey({ columns: [t.fixtureId, t.personId] }) }))

export const support = pgTable('support', {
  fixtureId: text('fixture_id').notNull().references(() => fixture.id),
  personId: text('person_id').notNull().references(() => person.id),
  teamCode: text('team_code').notNull().references(() => team.code),
}, (t) => ({ pk: primaryKey({ columns: [t.fixtureId, t.personId] }) }))

export const photo = pgTable('photo', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),              // fan | profile
  uploaderName: text('uploader_name').notNull(),
  personId: text('person_id').references(() => person.id),
  teamCode: text('team_code').references(() => team.code),
  filePath: text('file_path').notNull(),
  thumbPath: text('thumb_path'),
  caption: text('caption'),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  moderatedAt: timestamp('moderated_at', { withTimezone: true }),
})
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate -w api`
Expected: a new `api/migrations/0001_*.sql` with the seven new tables.

- [ ] **Step 3: Extend the schema test `api/test/schema.test.js`** — add to the `for` list:

```js
  for (const t of ['fixture', 'standing', 'sync_log', 'watch', 'support', 'photo']) {
    expect(names).toContain(t)
  }
```

- [ ] **Step 4: Run the test**

Run: `npm run test -w api`
Expected: PASS — all 11 tables present.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): synced, social, and photo schema"
```

---

## Task 5: Seed the database from the existing generator

**Files:**
- Create: `api/src/seed/generate.js` (ported from `web/src/data.js`), `api/src/seed/seed.js`
- Test: `api/test/seed.test.js`

- [ ] **Step 1: Port the generator**

```bash
cp web/src/data.js api/src/seed/generate.js
```

Then edit the **last** statement of `api/src/seed/generate.js`: replace `export const SWEEP = {…}` / `export default SWEEP` with a function wrapper so it produces data without browser assumptions. Change the closing section to:

```js
export function generate() {
  return {
    teams,
    teamList: Object.keys(teams).map((c) => teams[c]),
    groups: Object.keys(GROUPS),
    people,
    fixtures,
    standings,
    photos,
    scoring: { id: 1, rule: 'top3', coOwners: 'all_win' },
  }
}
```

(Everything above that line — the generation logic — is unchanged. `Intl`/`Date` work in Node.)

- [ ] **Step 2: Write the failing seed test `api/test/seed.test.js`**

```js
import { expect, test, afterAll, beforeAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { seed } from '../src/seed/seed.js'
import { team, person, fixture, ownership } from '../src/db/schema.js'

const { pool, db } = openTestDb()
beforeAll(async () => { await seed(db); await seed(db) }) // run twice → idempotent
afterAll(async () => { await pool.end() })

test('seeds 48 teams, 16 people, full fixture set', async () => {
  expect((await db.select().from(team)).length).toBe(48)
  expect((await db.select().from(person)).length).toBe(16)
  expect((await db.select().from(fixture)).length).toBe(72) // 12 groups × 6
})

test('ownership links Andriy to Croatia', async () => {
  const rows = await db.select().from(ownership).where(eq(ownership.personId, 'p4'))
  expect(rows.map((r) => r.teamCode)).toContain('hr')
})
```

- [ ] **Step 3: Run it to confirm failure**

Run: `npm run test -w api -- seed`
Expected: FAIL — `seed` not defined.

- [ ] **Step 4: Implement `api/src/seed/seed.js` (idempotent upserts)**

```js
import { generate } from './generate.js'
import * as s from '../db/schema.js'
import { createPool, createDb } from '../db/client.js'

export async function seed(db) {
  const g = generate()

  await db.insert(s.scoringConfig).values(g.scoring).onConflictDoNothing()

  for (const code of Object.keys(g.teams)) {
    const t = g.teams[code]
    await db.insert(s.team).values({
      code: t.code, name: t.name, group: t.group, pool: t.pool,
      color: t.color, strength: t.strength, flagCode: t.code,
    }).onConflictDoNothing()
    await db.insert(s.teamCrosswalk).values({ teamCode: t.code, providerTeamId: null }).onConflictDoNothing()
  }

  for (const p of g.people) {
    await db.insert(s.person).values({
      id: p.id, name: p.name, short: p.short, initials: p.initials, avColor: p.av,
    }).onConflictDoNothing()
    for (const tc of p.teams) {
      await db.insert(s.ownership).values({ personId: p.id, teamCode: tc }).onConflictDoNothing()
    }
  }

  for (const f of g.fixtures) {
    await db.insert(s.fixture).values({
      id: f.id, group: f.group, matchday: f.matchday, t1Code: f.t1, t2Code: f.t2,
      kickoffUtc: f.ko, venue: f.venue, city: f.city, status: f.status,
      score1: f.score?.[0] ?? null, score2: f.score?.[1] ?? null, minute: f.minute ?? null,
      probA: f.prob.a, probD: f.prob.d, probB: f.prob.b,
      stage: 'group', derby: !!f.derby, doubleOwner: (f.doubleOwners?.length ?? 0) > 0,
    }).onConflictDoUpdate({
      target: s.fixture.id,
      set: { status: f.status, score1: f.score?.[0] ?? null, score2: f.score?.[1] ?? null, minute: f.minute ?? null },
    })
  }

  for (const g2 of g.groups) {
    for (const t of g.standings[g2]) {
      await db.insert(s.standing).values({
        teamCode: t.code, played: t.played, win: t.win, draw: t.draw, loss: t.loss,
        gf: t.gf, ga: t.ga, pts: t.pts,
      }).onConflictDoUpdate({
        target: s.standing.teamCode,
        set: { played: t.played, win: t.win, draw: t.draw, loss: t.loss, gf: t.gf, ga: t.ga, pts: t.pts },
      })
    }
  }

  for (const ph of g.photos) {
    await db.insert(s.photo).values({
      id: ph.id, kind: 'fan', uploaderName: ph.uploader, teamCode: ph.team,
      filePath: `seed/${ph.id}.jpg`, caption: ph.caption, status: ph.status,
    }).onConflictDoNothing()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = createPool()
  await seed(createDb(pool))
  await pool.end()
  console.log('seed complete')
}
```

- [ ] **Step 5: Wire the seed into the test harness so endpoint tests have data**

Modify `api/test/helpers/global-setup.js` — after `runMigrations`, before `pool.end()`:

```js
  const { seed } = await import('../../src/seed/seed.js')
  await seed(createDb(pool))
```

- [ ] **Step 6: Run the seed tests**

Run: `npm run test -w api -- seed`
Expected: PASS — 48 teams, 16 people, 72 fixtures, idempotent on second run.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(api): port generator and add idempotent DB seed"
```

---

## Task 6: `/api/bootstrap` endpoint

**Files:**
- Create: `api/src/serialize.js`, `api/src/routes/bootstrap.js`
- Modify: `api/src/app.js`
- Test: `api/test/bootstrap.test.js`

- [ ] **Step 1: Create `api/src/serialize.js`**

```js
export function serializeTeam(t) {
  return { code: t.code, name: t.name, group: t.group, pool: t.pool, color: t.color, strength: t.strength }
}
export function serializePerson(p) {
  return { id: p.id, name: p.name, short: p.short, initials: p.initials, av: p.avColor, avatarPath: p.avatarPath }
}
```

- [ ] **Step 2: Write the failing test `api/test/bootstrap.test.js`**

```js
import { expect, test, afterAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'

const { pool, db } = openTestDb()
const app = buildApp(db)
afterAll(async () => { await app.close(); await pool.end() })

test('GET /api/bootstrap returns teams, people, ownership, scoring', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/bootstrap' })
  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.teams).toHaveLength(48)
  expect(body.people).toHaveLength(16)
  expect(body.scoring.rule).toBe('top3')
  const andriy = body.people.find((p) => p.id === 'p4')
  expect(body.ownership[andriy.id]).toContain('hr')
})
```

- [ ] **Step 3: Run it to confirm failure**

Run: `npm run test -w api -- bootstrap`
Expected: FAIL — 404, route not registered.

- [ ] **Step 4: Implement `api/src/routes/bootstrap.js`**

```js
import { team, person, ownership, scoringConfig } from '../db/schema.js'
import { serializeTeam, serializePerson } from '../serialize.js'

export async function bootstrapRoutes(app) {
  app.get('/api/bootstrap', async () => {
    const [teams, people, owns, scoring] = await Promise.all([
      app.db.select().from(team),
      app.db.select().from(person),
      app.db.select().from(ownership),
      app.db.select().from(scoringConfig),
    ])
    const ownership_ = {}
    for (const o of owns) (ownership_[o.personId] ??= []).push(o.teamCode)
    return {
      teams: teams.map(serializeTeam),
      people: people.map(serializePerson),
      ownership: ownership_,
      scoring: scoring[0] ?? null,
    }
  })
}
```

- [ ] **Step 5: Register the route in `api/src/app.js`** — add the import and registration inside `buildApp`, before `return app`:

```js
import { bootstrapRoutes } from './routes/bootstrap.js'
// …inside buildApp, after app.get('/api/health', …):
  app.register(bootstrapRoutes)
```

- [ ] **Step 6: Run the test**

Run: `npm run test -w api -- bootstrap`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(api): GET /api/bootstrap"
```

---

## Task 7: `/api/fixtures` (with filters) and `/api/fixtures/:id`

**Files:**
- Create: `api/src/routes/fixtures.js`
- Modify: `api/src/serialize.js`, `api/src/app.js`
- Test: `api/test/fixtures.test.js`

- [ ] **Step 1: Add a fixture serializer to `api/src/serialize.js`**

```js
export function serializeFixture(f) {
  return {
    id: f.id, group: f.group, matchday: f.matchday, t1: f.t1Code, t2: f.t2Code,
    ko: f.kickoffUtc, venue: f.venue, city: f.city, status: f.status,
    score: f.score1 == null ? null : [f.score1, f.score2], minute: f.minute,
    prob: { a: f.probA, d: f.probD, b: f.probB },
    stage: f.stage, derby: f.derby, doubleOwner: f.doubleOwner,
  }
}
```

- [ ] **Step 2: Write the failing test `api/test/fixtures.test.js`**

```js
import { expect, test, afterAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'

const { pool, db } = openTestDb()
const app = buildApp(db)
afterAll(async () => { await app.close(); await pool.end() })

test('GET /api/fixtures returns all fixtures ordered by kickoff', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/fixtures' })
  expect(res.statusCode).toBe(200)
  const list = res.json()
  expect(list).toHaveLength(72)
  const kos = list.map((f) => new Date(f.ko).getTime())
  expect(kos).toEqual([...kos].sort((a, b) => a - b))
})

test('GET /api/fixtures?team=hr returns only Croatia matches', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/fixtures?team=hr' })
  const list = res.json()
  expect(list.length).toBeGreaterThan(0)
  expect(list.every((f) => f.t1 === 'hr' || f.t2 === 'hr')).toBe(true)
})

test('GET /api/fixtures?person=p4 returns Andriy\'s teams\' matches', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/fixtures?person=p4' })
  const list = res.json()
  expect(list.every((f) => ['fr', 'hr'].includes(f.t1) || ['fr', 'hr'].includes(f.t2))).toBe(true)
})

test('GET /api/fixtures/:id returns one fixture or 404', async () => {
  const all = (await app.inject({ method: 'GET', url: '/api/fixtures' })).json()
  const one = await app.inject({ method: 'GET', url: `/api/fixtures/${all[0].id}` })
  expect(one.statusCode).toBe(200)
  expect(one.json().id).toBe(all[0].id)
  const missing = await app.inject({ method: 'GET', url: '/api/fixtures/nope' })
  expect(missing.statusCode).toBe(404)
})
```

- [ ] **Step 3: Run it to confirm failure**

Run: `npm run test -w api -- fixtures`
Expected: FAIL — routes not registered.

- [ ] **Step 4: Implement `api/src/routes/fixtures.js`**

```js
import { asc, eq, or } from 'drizzle-orm'
import { fixture, ownership } from '../db/schema.js'
import { serializeFixture } from '../serialize.js'

export async function fixtureRoutes(app) {
  app.get('/api/fixtures', async (req) => {
    const { team: teamCode, person: personId } = req.query
    let rows = await app.db.select().from(fixture).orderBy(asc(fixture.kickoffUtc))
    if (teamCode) rows = rows.filter((f) => f.t1Code === teamCode || f.t2Code === teamCode)
    if (personId) {
      const owns = await app.db.select().from(ownership).where(eq(ownership.personId, personId))
      const codes = new Set(owns.map((o) => o.teamCode))
      rows = rows.filter((f) => codes.has(f.t1Code) || codes.has(f.t2Code))
    }
    return rows.map(serializeFixture)
  })

  app.get('/api/fixtures/:id', async (req, reply) => {
    const rows = await app.db.select().from(fixture).where(eq(fixture.id, req.params.id))
    if (!rows.length) return reply.code(404).send({ error: 'not_found' })
    return serializeFixture(rows[0])
  })
}
```

- [ ] **Step 5: Register in `api/src/app.js`** (import + `app.register(fixtureRoutes)`)

- [ ] **Step 6: Run the test**

Run: `npm run test -w api -- fixtures`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(api): GET /api/fixtures with person/team filters and /:id"
```

---

## Task 8: `/api/standings`

**Files:**
- Create: `api/src/routes/standings.js`
- Modify: `api/src/app.js`
- Test: `api/test/standings.test.js`

- [ ] **Step 1: Write the failing test `api/test/standings.test.js`**

```js
import { expect, test, afterAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'

const { pool, db } = openTestDb()
const app = buildApp(db)
afterAll(async () => { await app.close(); await pool.end() })

test('GET /api/standings groups teams A–L, sorted by points', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/standings' })
  expect(res.statusCode).toBe(200)
  const tables = res.json()
  expect(Object.keys(tables).sort()).toEqual('ABCDEFGHIJKL'.split(''))
  for (const g of Object.keys(tables)) {
    expect(tables[g]).toHaveLength(4)
    const pts = tables[g].map((t) => t.pts)
    expect(pts).toEqual([...pts].sort((a, b) => b - a))
  }
})
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npm run test -w api -- standings`
Expected: FAIL — route not registered.

- [ ] **Step 3: Implement `api/src/routes/standings.js`**

```js
import { team, standing } from '../db/schema.js'

export async function standingsRoutes(app) {
  app.get('/api/standings', async () => {
    const [teams, rows] = await Promise.all([
      app.db.select().from(team),
      app.db.select().from(standing),
    ])
    const byCode = Object.fromEntries(rows.map((r) => [r.teamCode, r]))
    const tables = {}
    for (const t of teams) {
      const s = byCode[t.code] ?? { played: 0, win: 0, draw: 0, loss: 0, gf: 0, ga: 0, pts: 0 }
      ;(tables[t.group] ??= []).push({
        code: t.code, name: t.name, played: s.played, win: s.win, draw: s.draw, loss: s.loss,
        gf: s.gf, ga: s.ga, gd: s.gf - s.ga, pts: s.pts,
      })
    }
    for (const g of Object.keys(tables)) {
      tables[g].sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.name.localeCompare(y.name))
    }
    return tables
  })
}
```

- [ ] **Step 4: Register in `api/src/app.js`** (import + `app.register(standingsRoutes)`)

- [ ] **Step 5: Run the test**

Run: `npm run test -w api -- standings`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(api): GET /api/standings grouped and sorted"
```

---

## Task 9: `/api/people`, `/api/teams/:code`, `/api/photos`

**Files:**
- Create: `api/src/routes/people.js`, `api/src/routes/teams.js`, `api/src/routes/photos.js`
- Modify: `api/src/app.js`
- Test: `api/test/detail.test.js`

- [ ] **Step 1: Write the failing test `api/test/detail.test.js`**

```js
import { expect, test, afterAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'

const { pool, db } = openTestDb()
const app = buildApp(db)
afterAll(async () => { await app.close(); await pool.end() })

test('GET /api/people returns 16 with their teams', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/people' })
  expect(res.statusCode).toBe(200)
  const people = res.json()
  expect(people).toHaveLength(16)
  expect(people.find((p) => p.id === 'p4').teams).toEqual(expect.arrayContaining(['fr', 'hr']))
})

test('GET /api/teams/hr returns Croatia with owners', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/teams/hr' })
  expect(res.statusCode).toBe(200)
  const t = res.json()
  expect(t.name).toBe('Croatia')
  expect(t.owners.map((o) => o.id)).toContain('p4')
  const missing = await app.inject({ method: 'GET', url: '/api/teams/zz' })
  expect(missing.statusCode).toBe(404)
})

test('GET /api/photos returns only approved; ?team filters', async () => {
  const all = (await app.inject({ method: 'GET', url: '/api/photos' })).json()
  expect(all.every((p) => p.status === 'approved')).toBe(true)
  const hr = (await app.inject({ method: 'GET', url: '/api/photos?team=hr' })).json()
  expect(hr.every((p) => p.team === 'hr')).toBe(true)
})
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npm run test -w api -- detail`
Expected: FAIL — routes not registered.

- [ ] **Step 3: Implement `api/src/routes/people.js`**

```js
import { person, ownership } from '../db/schema.js'
import { serializePerson } from '../serialize.js'

export async function peopleRoutes(app) {
  app.get('/api/people', async () => {
    const [people, owns] = await Promise.all([
      app.db.select().from(person),
      app.db.select().from(ownership),
    ])
    const byPerson = {}
    for (const o of owns) (byPerson[o.personId] ??= []).push(o.teamCode)
    return people.map((p) => ({ ...serializePerson(p), teams: byPerson[p.id] ?? [] }))
  })
}
```

- [ ] **Step 4: Implement `api/src/routes/teams.js`**

```js
import { eq } from 'drizzle-orm'
import { team, ownership, person } from '../db/schema.js'
import { serializeTeam, serializePerson } from '../serialize.js'

export async function teamRoutes(app) {
  app.get('/api/teams/:code', async (req, reply) => {
    const rows = await app.db.select().from(team).where(eq(team.code, req.params.code))
    if (!rows.length) return reply.code(404).send({ error: 'not_found' })
    const owners = await app.db.select({ p: person }).from(ownership)
      .innerJoin(person, eq(person.id, ownership.personId))
      .where(eq(ownership.teamCode, req.params.code))
    return { ...serializeTeam(rows[0]), owners: owners.map((r) => serializePerson(r.p)) }
  })
}
```

- [ ] **Step 5: Implement `api/src/routes/photos.js`**

```js
import { and, eq } from 'drizzle-orm'
import { photo } from '../db/schema.js'

export async function photoRoutes(app) {
  app.get('/api/photos', async (req) => {
    const conds = [eq(photo.status, 'approved')]
    if (req.query.team) conds.push(eq(photo.teamCode, req.query.team))
    const rows = await app.db.select().from(photo).where(and(...conds))
    return rows.map((p) => ({
      id: p.id, kind: p.kind, uploader: p.uploaderName, team: p.teamCode,
      caption: p.caption, src: `/photos/${p.filePath}`, status: p.status,
    }))
  })
}
```

- [ ] **Step 6: Register all three in `api/src/app.js`** (imports + `app.register(peopleRoutes)`, `app.register(teamRoutes)`, `app.register(photoRoutes)`)

- [ ] **Step 7: Run the test**

Run: `npm run test -w api -- detail`
Expected: PASS (3 tests).

- [ ] **Step 8: Run the full suite**

Run: `npm run test -w api`
Expected: PASS — all suites green.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(api): GET /api/people, /api/teams/:code, /api/photos"
```

---

## Task 10: Dev Docker Compose + manual smoke

**Files:**
- Create: `infra/docker-compose.dev.yml`, `api/Dockerfile`, `api/.dockerignore`, `.env.example`

- [ ] **Step 1: Create `.env.example`**

```
POSTGRES_USER=sweep
POSTGRES_PASSWORD=sweep
POSTGRES_DB=sweep
# Inside compose the api reaches the `postgres` service on the internal network:
DATABASE_URL=postgres://sweep:sweep@postgres:5432/sweep
# Running the api on the host instead (npm run dev:api) use the published port 5433:
#   DATABASE_URL=postgres://sweep:sweep@localhost:5433/sweep
PORT=3000
```

> This machine already runs another project's Postgres on host port 5432, so the dev compose
> publishes **5433**. Stop the standalone `sweep-postgres` container before `docker compose up`
> (both want 5433). See `CLAUDE.md` → "Local database (dev)".

- [ ] **Step 2: Create `api/Dockerfile`**

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json ./api/package.json
COPY web/package.json ./web/package.json
RUN npm install --omit=dev --workspace @sweep/api
COPY api ./api
WORKDIR /app/api
EXPOSE 3000
CMD ["node", "src/server.js"]
```

- [ ] **Step 3: Create `api/.dockerignore`**

```
node_modules
test
```

- [ ] **Step 4: Create `infra/docker-compose.dev.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    ports: ["5433:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 3s
      timeout: 3s
      retries: 10
  api:
    build:
      context: ..
      dockerfile: api/Dockerfile
    environment:
      DATABASE_URL: ${DATABASE_URL}
      PORT: 3000
    depends_on:
      postgres: { condition: service_healthy }
    command: sh -c "node src/db/migrate.js && node src/seed/seed.js && node src/server.js"
    ports: ["3000:3000"]
volumes:
  pgdata:
```

- [ ] **Step 5: Smoke test the stack**

Run:
```bash
cp .env.example .env
docker compose -f infra/docker-compose.dev.yml --env-file .env up --build -d
sleep 8
curl -s localhost:3000/api/health
curl -s localhost:3000/api/standings | head -c 200
curl -s "localhost:3000/api/fixtures?team=hr" | head -c 200
```
Expected: `{"ok":true}`; standings JSON with groups A–L; Croatia fixtures.

- [ ] **Step 6: Tear down**

Run: `docker compose -f infra/docker-compose.dev.yml down`

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore(infra): dev docker-compose with postgres + api (migrate+seed+serve)"
```

---

## Done criteria for Phase 1

- `npm run test -w api` is fully green (health, schema, seed, bootstrap, fixtures, standings, detail).
- `docker compose -f infra/docker-compose.dev.yml up` serves all read endpoints from a seeded Postgres.
- The web app still builds; with `npm run dev -w web` + the api running, `/api/*` proxies through.
- **Next phase:** the football worker (provider adapter, baseline sync + live poller) replaces seeded fixture/standing data with API-Football data.
