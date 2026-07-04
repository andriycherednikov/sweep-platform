# Phase 3 — Catalog + Self-Serve Creation + Account Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user signs in via magic link, browses the curated persisted catalog, provisions a sweep bound to a competition of either sport (baseline synced automatically, competitions deduped across sweeps), and invites their group via the member link — all API-only, no psql, no super token.

**Architecture:** Three new tables (`login_token`, `account_session`, `catalog_league`) + two new route files over the existing sweep machinery. Opaque `x-account-token` sessions mirror the house token culture. The catalog is refreshed by a daily worker job (2 requests/day total); provisioning validates against the catalog table and reuses `addCompetition` + `syncCompetitors` + `syncBaseline`. Two feed-budget fixes ride along: the football odds loop gets a kickoff window, and feed-born rosters re-sync daily.

**Tech Stack:** Node 22 ESM, Fastify 5, Drizzle 0.36 + drizzle-kit, Postgres (testcontainers), Vitest.

**Design doc:** `docs/superpowers/specs/2026-07-04-phase3-catalog-selfserve-design.md`.

## Global Constraints

- **Never** push to the `upstream` remote. Push to `origin` after each task.
- **Never** touch the shared `sweep` Postgres database. Before any live migration/seed/CLI: `psql "$(grep '^DATABASE_URL=' .env | cut -d= -f2-)" -tc 'SELECT current_database()'` must print `sweep_platform`.
- **Never** run the inherited `Makefile`/`infra/` deploy targets.
- **Web untouched:** the web suite (436 tests) passes **unmodified**. API-only phase — owner decision.
- **Catalog budget rule:** nothing may fetch provider catalogs per user request; the catalog is the `catalog_league` table. The API-Sports basketball key is free tier (100 req/day); football is a Pro key **shared with the live WC app** — stay polite.
- Baseline at start: api **345** / web **436**, all green (after prereqs `933af17`..`231eee1`). If red before you change anything: STOP and report.
- Strict TDD (failing test first, watch it fail, minimal code, watch it pass). Conventional Commits, one commit per task minimum. A pre-commit hook runs the web suite + build; a pre-push hook runs everything — do NOT use `--no-verify`.
- Run api tests **from `api/`**: `npx vitest run test/<file>` (repo root loses the testcontainers env → `password authentication failed`). Full suites: `npm run test` (repo root) and `npm test -w web`.
- Schema changes: edit `api/src/db/schema.js`, then `cd api && npx drizzle-kit generate` (creates `api/migrations/000N_*.sql` + meta) and commit both. The test global-setup applies migrations automatically.
- Rate-limited routes: tests must stay under the per-IP limits (login = 5/15min, session = 20/15min) — budget your `app.inject` calls per file; mint tokens by inserting rows directly where possible.

---

### Task 1: Schema — login_token, account_session, catalog_league

**Files:**
- Modify: `api/src/db/schema.js` (append after the `account` table)
- Create (generated): `api/migrations/0001_*.sql` + meta updates
- Test: `api/test/account-schema.test.js`

**Interfaces:**
- Produces (drizzle tables, exact names later tasks import from `../src/db/schema.js` / `../db/schema.js`):
  - `loginToken` → table `login_token`: `token` text pk, `email` text notNull, `createdAt` timestamptz default now, `expiresAt` timestamptz notNull, `usedAt` timestamptz nullable.
  - `accountSession` → table `account_session`: `token` text pk, `accountId` text notNull FK → `account.id`, `createdAt` timestamptz default now, `expiresAt` timestamptz notNull.
  - `catalogLeague` → table `catalog_league`: `id` text pk (`'<provider>:<providerLeagueId>'`), `provider` text notNull, `providerLeagueId` text notNull, `name` text notNull, `type` text notNull, `logo` text, `country` jsonb (`{name,code,flag}` or null), `seasons` jsonb notNull default `[]` (`[{season,start,end,current,standings,odds}]`), `curated` boolean notNull default false, `updatedAt` timestamptz notNull default now.

- [ ] **Step 1: Write the failing test**

```js
// api/test/account-schema.test.js
import { test, expect, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { account, loginToken, accountSession, catalogLeague } from '../src/db/schema.js'

const { pool, db } = openTestDb()

afterAll(async () => {
  await db.delete(accountSession).where(eq(accountSession.token, 'sess1'))
  await db.delete(loginToken).where(eq(loginToken.token, 'tok1'))
  await db.delete(account).where(eq(account.id, 'ac_schema_test'))
  await db.delete(catalogLeague).where(eq(catalogLeague.id, 'apifootball:39'))
  await pool.end()
})

test('the three new tables round-trip rows with defaults', async () => {
  await db.insert(loginToken).values({ token: 'tok1', email: 'a@b.c', expiresAt: new Date(Date.now() + 60_000) })
  const [lt] = await db.select().from(loginToken).where(eq(loginToken.token, 'tok1'))
  expect(lt.usedAt).toBeNull()
  expect(lt.createdAt).toBeInstanceOf(Date)

  await db.insert(account).values({ id: 'ac_schema_test', email: 'schema-test@x.y' })
  await db.insert(accountSession).values({ token: 'sess1', accountId: 'ac_schema_test', expiresAt: new Date(Date.now() + 60_000) })
  const [s] = await db.select().from(accountSession).where(eq(accountSession.token, 'sess1'))
  expect(s.accountId).toBe('ac_schema_test')

  await db.insert(catalogLeague).values({
    id: 'apifootball:39', provider: 'apifootball', providerLeagueId: '39', name: 'Premier League', type: 'League',
    country: { name: 'England', code: 'GB-ENG', flag: null },
    seasons: [{ season: '2025', start: '2025-08-15', end: '2026-05-24', current: false, standings: true, odds: false }],
  })
  const [cl] = await db.select().from(catalogLeague).where(eq(catalogLeague.id, 'apifootball:39'))
  expect(cl.curated).toBe(false) // default
  expect(cl.seasons[0].standings).toBe(true)
  expect(cl.country.name).toBe('England')
})
```

- [ ] **Step 2: Run it** — `cd api && npx vitest run test/account-schema.test.js` — Expected: FAIL (`loginToken` not exported).

- [ ] **Step 3: Append to `api/src/db/schema.js`** (right after the `account` table):

```js
export const loginToken = pgTable('login_token', {
  token: text('token').primaryKey(),
  email: text('email').notNull(), // keyed by email, NOT account — account is created on first USE (verified email)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
})

export const accountSession = pgTable('account_session', {
  token: text('token').primaryKey(),
  accountId: text('account_id').notNull().references(() => account.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

export const catalogLeague = pgTable('catalog_league', {
  id: text('id').primaryKey(), // '<provider>:<providerLeagueId>'
  provider: text('provider').notNull(),
  providerLeagueId: text('provider_league_id').notNull(),
  name: text('name').notNull(),
  type: text('type').notNull(), // raw feed value — 'League' | 'Cup' | 'cup' (casing varies by API)
  logo: text('logo'),
  country: jsonb('country'), // {name, code, flag} | null
  seasons: jsonb('seasons').notNull().default([]), // [{season, start, end, current, standings, odds}]
  curated: boolean('curated').notNull().default(false), // sync NEVER touches this — curation is operator data
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
```

- [ ] **Step 4: Generate the migration** — `cd api && npx drizzle-kit generate` — Expected: a new `api/migrations/0001_*.sql` containing the three CREATE TABLEs. Read it and sanity-check names/columns.
- [ ] **Step 5: Run** — `npx vitest run test/account-schema.test.js` — Expected: PASS (global-setup applies the new migration). Then the full api suite from repo root: green.
- [ ] **Step 6: Commit** — `git add api/src/db/schema.js api/migrations api/test/account-schema.test.js && git commit -m "feat(db): login_token, account_session, catalog_league tables" && git push origin main`

---

### Task 2: mapLeague carries country + per-season coverage (both sports)

**Files:**
- Modify: `api/src/providers/mapping.js` (football `mapLeague`), `api/src/providers/basketball-mapping.js` (basketball `mapLeague`)
- Test: `api/test/mapping.test.js`, `api/test/basketball-mapping.test.js` (extend)

**Interfaces:**
- Produces: both `mapLeague(raw)` now return
  `{ providerLeagueId, name, type, logo, country: {name,code,flag}|null, seasons: [{ season: string, start, end, current: boolean, standings: boolean, odds: boolean }] }`.
  Basketball has no `current` flag in the feed → always `false` there. All existing consumers (`addCompetition` reads `name/type/logo`; provider tests use `toMatchObject`) are unaffected — fields are additive.
- Consumes: live-real fixtures `api/test/fixtures/apifootball/leagues.json` (WC + EPL, real coverage) and `api/test/fixtures/apibasketball/leagues.json` (NBA, real coverage).

- [ ] **Step 1: Write the failing tests** — append to `api/test/mapping.test.js`:

```js
test('mapLeague carries country and per-season coverage flags', () => {
  const [wc, epl] = load('leagues').response.map(mapLeague)
  expect(wc.country).toEqual({ name: 'World', code: null, flag: null })
  const wc26 = wc.seasons.find((s) => s.season === '2026')
  expect(wc26).toMatchObject({ current: true, standings: true, odds: true })
  expect(epl.country.name).toBe('England')
  // the coverage-maturity trap: EPL's unstarted 2026 season reports standings:false
  expect(epl.seasons.find((s) => s.season === '2026')).toMatchObject({ current: true, standings: false })
  expect(epl.seasons.find((s) => s.season === '2025')).toMatchObject({ current: false, standings: true })
})
```

  and append to `api/test/basketball-mapping.test.js`:

```js
test('basketball mapLeague carries country and coverage; no current flag in this API', () => {
  const l = mapLeague(leagues[0])
  expect(l.country).toMatchObject({ name: 'USA', code: 'US' })
  const s23 = l.seasons.find((s) => s.season === '2023-2024')
  expect(s23).toMatchObject({ current: false, standings: true, odds: false })
  expect(l.seasons.find((s) => s.season === '2022-2023')).toMatchObject({ standings: false })
})
```

- [ ] **Step 2: Run both files** — Expected: FAIL (`country` undefined).

- [ ] **Step 3: Implement** — in `api/src/providers/mapping.js` replace `mapLeague`:

```js
/** Raw /leagues row → catalog entry. Football nests under `league` (unlike basketball's flat row). */
export function mapLeague(raw) {
  return {
    providerLeagueId: raw.league.id, name: raw.league.name, type: raw.league.type, logo: raw.league.logo ?? null,
    country: raw.country ? { name: raw.country.name ?? null, code: raw.country.code ?? null, flag: raw.country.flag ?? null } : null,
    seasons: (raw.seasons ?? []).map((s) => ({
      season: String(s.year), start: s.start, end: s.end, current: !!s.current,
      standings: !!s.coverage?.standings, odds: !!s.coverage?.odds,
    })),
  }
}
```

  and in `api/src/providers/basketball-mapping.js` replace `mapLeague`:

```js
/** Raw /leagues row → catalog entry. No `current` flag in this API — always false. */
export function mapLeague(raw) {
  return {
    providerLeagueId: raw.id, name: raw.name, type: raw.type, logo: raw.logo ?? null,
    country: raw.country ? { name: raw.country.name ?? null, code: raw.country.code ?? null, flag: raw.country.flag ?? null } : null,
    seasons: (raw.seasons ?? []).map((s) => ({
      season: String(s.season), start: s.start, end: s.end, current: false,
      standings: !!s.coverage?.standings, odds: !!s.coverage?.odds,
    })),
  }
}
```

- [ ] **Step 4: Run** — both test files, then the full api suite. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(providers): mapLeague carries country + per-season coverage" && git push origin main`

---

### Task 3: Registry — PROVIDER_KEYS + per-provider season windows

**Files:**
- Modify: `api/src/providers/registry.js`
- Test: `api/test/registry.test.js` (extend)

**Interfaces:**
- Produces:
  - `PROVIDER_KEYS` — `['apifootball', 'apibasketball']` (derived from FACTORIES; the worker's catalog cron iterates it).
  - `seasonInWindow(providerKey, season)` → boolean. Window lives on the FACTORIES entry: `apifootball: window: null` (Pro key — unrestricted), `apibasketball: window: { min: 2022, max: 2024 }` (free tier). The season's year = `Number(String(season).slice(0, 4))` (handles both `'2026'` and `'2023-2024'`). Unknown provider → throw `unknown provider: <x>` (same as `sportOf`).
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test** — append to `api/test/registry.test.js`:

```js
import { providerFor, sportOf, PROVIDER_KEYS, seasonInWindow } from '../src/providers/registry.js' // replace the existing import line

test('PROVIDER_KEYS lists every registered provider', () => {
  expect(PROVIDER_KEYS).toEqual(['apifootball', 'apibasketball'])
})

test('seasonInWindow enforces the per-provider plan window, not coverage flags', () => {
  expect(seasonInWindow('apifootball', '2026')).toBe(true)      // Pro key — open
  expect(seasonInWindow('apibasketball', '2023-2024')).toBe(true)
  expect(seasonInWindow('apibasketball', '2021-2022')).toBe(false)
  expect(seasonInWindow('apibasketball', '2025-2026')).toBe(false) // feed advertises it; the plan refuses it
  expect(() => seasonInWindow('espn', '2026')).toThrow(/unknown provider/)
})
```

- [ ] **Step 2: Run it** — Expected: FAIL (not exported).
- [ ] **Step 3: Implement** — in `api/src/providers/registry.js`, add `window` to the factory entries and the two exports:

```js
const FACTORIES = {
  apifootball: { sport: 'football', create: createApiFootballProvider, window: null }, // Pro key — no season gate
  apibasketball: { sport: 'basketball', create: createApiBasketballProvider, window: { min: 2022, max: 2024 } }, // free tier
}

export const PROVIDER_KEYS = Object.keys(FACTORIES)

/** Plan gating is invisible in the feed (coverage flags lie) — the window is OUR config. */
export function seasonInWindow(providerKey, season) {
  const entry = FACTORIES[providerKey]
  if (!entry) throw new Error(`unknown provider: ${providerKey}`)
  if (!entry.window) return true
  const y = Number(String(season).slice(0, 4))
  return y >= entry.window.min && y <= entry.window.max
}
```

- [ ] **Step 4: Run** — the file, then full api suite. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(providers): PROVIDER_KEYS + per-provider season windows" && git push origin main`

---

### Task 4: syncCatalog + catalog:sync / catalog:curate CLIs

**Files:**
- Create: `api/src/worker/catalog-sync.js`, `api/src/worker/catalog-curate.js`
- Modify: `api/package.json` (two scripts)
- Test: `api/test/catalog-sync.test.js`

**Interfaces:**
- Produces:
  - `syncCatalog(db, providerKey, provider)` → `{ leagues: n }`. Upserts every `fetchCompetitions()` row into `catalog_league` (id `'<providerKey>:<providerLeagueId>'`); the conflict-update set **excludes `curated`**; leagues gone from the feed are KEPT. Writes a syncLog row `{source: providerKey, kind: 'catalog', status: 'ok'|'error'}`; on error rethrows (last-good catalog untouched).
  - `setCurated(db, providerKey, leagueId, on)` → updated row count (0 = unknown league). In `catalog-curate.js`.
  - CLIs (bottom of each file, `import.meta.url === \`file://${process.argv[1]}\`` guard):
    `npm run catalog:sync -w api` (loops `PROVIDER_KEYS`, ~1 request each), `npm run catalog:curate -w api -- <provider> <leagueId> [--off]`.
- Consumes: `catalogLeague`, `syncLog` (schema), `PROVIDER_KEYS`/`providerFor` (Task 3), adapters' `fetchCompetitions` (Task 2 shape).

- [ ] **Step 1: Write the failing test**

```js
// api/test/catalog-sync.test.js
import { test, expect, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { catalogLeague, syncLog } from '../src/db/schema.js'
import { syncCatalog } from '../src/worker/catalog-sync.js'
import { setCurated } from '../src/worker/catalog-curate.js'
import { createRecordedProvider } from '../src/providers/recorded-provider.js'

const { pool, db } = openTestDb()
const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apifootball/${n}.json`, import.meta.url)))

afterAll(async () => {
  await db.delete(catalogLeague).where(eq(catalogLeague.provider, 'apifootball'))
  await pool.end()
})

test('syncCatalog upserts leagues, preserves curated across re-syncs, keeps gone leagues', async () => {
  const provider = createRecordedProvider({ leagues: load('leagues') }) // WC (1) + EPL (39)
  const r1 = await syncCatalog(db, 'apifootball', provider)
  expect(r1.leagues).toBe(2)
  const [epl] = await db.select().from(catalogLeague).where(eq(catalogLeague.id, 'apifootball:39'))
  expect(epl).toMatchObject({ provider: 'apifootball', providerLeagueId: '39', name: 'Premier League', type: 'League', curated: false })
  expect(epl.country.name).toBe('England')
  expect(epl.seasons.find((s) => s.season === '2025').standings).toBe(true)

  // curate, then re-sync with a feed that renamed the league AND dropped the WC
  expect(await setCurated(db, 'apifootball', '39', true)).toBe(1)
  const renamed = structuredClone(load('leagues'))
  renamed.response = renamed.response.filter((r) => r.league.id === 39)
  renamed.response[0].league.name = 'The Prem'
  await syncCatalog(db, 'apifootball', createRecordedProvider({ leagues: renamed }))
  const [epl2] = await db.select().from(catalogLeague).where(eq(catalogLeague.id, 'apifootball:39'))
  expect(epl2.name).toBe('The Prem')   // updated
  expect(epl2.curated).toBe(true)      // survived the re-sync
  const [wc] = await db.select().from(catalogLeague).where(eq(catalogLeague.id, 'apifootball:1'))
  expect(wc).toBeDefined()             // gone from the feed → kept
  expect(await setCurated(db, 'apifootball', '9999', true)).toBe(0) // unknown league → 0
  const logs = await db.select().from(syncLog).where(eq(syncLog.kind, 'catalog'))
  expect(logs.at(-1).status).toBe('ok')
})
```

- [ ] **Step 2: Run it** — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// api/src/worker/catalog-sync.js
import { createPool, createDb } from '../db/client.js'
import { providerFor, PROVIDER_KEYS } from '../providers/registry.js'
import { catalogLeague, syncLog } from '../db/schema.js'

/** Upsert the provider's full /leagues catalog. NEVER touches `curated` (operator data). */
export async function syncCatalog(db, providerKey, provider) {
  try {
    const leagues = await provider.fetchCompetitions()
    for (const l of leagues) {
      const row = {
        id: `${providerKey}:${l.providerLeagueId}`, provider: providerKey, providerLeagueId: String(l.providerLeagueId),
        name: l.name, type: l.type, logo: l.logo, country: l.country, seasons: l.seasons, updatedAt: new Date(),
      }
      await db.insert(catalogLeague).values(row).onConflictDoUpdate({
        target: catalogLeague.id,
        set: { name: row.name, type: row.type, logo: row.logo, country: row.country, seasons: row.seasons, updatedAt: row.updatedAt },
      })
    }
    await db.insert(syncLog).values({ source: providerKey, kind: 'catalog', status: 'ok', counts: { leagues: leagues.length } })
    return { leagues: leagues.length }
  } catch (err) {
    await db.insert(syncLog).values({ source: providerKey, kind: 'catalog', status: 'error', error: String(err?.message ?? err) })
    throw err
  }
}

// CLI: npm run catalog:sync -w api   (~1 request per provider)
if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = createPool()
  const db = createDb(pool)
  try {
    for (const key of PROVIDER_KEYS) {
      const r = await syncCatalog(db, key, providerFor({ provider: key }))
      console.log(`catalog ${key}: ${r.leagues} leagues`)
    }
  } catch (e) {
    console.error('catalog:sync FAILED:', e.message)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}
```

```js
// api/src/worker/catalog-curate.js
import { and, eq } from 'drizzle-orm'
import { createPool, createDb } from '../db/client.js'
import { catalogLeague } from '../db/schema.js'

/** Flip a league's curated flag. Returns updated row count (0 = league not in catalog). */
export async function setCurated(db, providerKey, leagueId, on) {
  const rows = await db.update(catalogLeague).set({ curated: on })
    .where(and(eq(catalogLeague.provider, providerKey), eq(catalogLeague.providerLeagueId, String(leagueId))))
    .returning({ id: catalogLeague.id })
  return rows.length
}

// CLI: npm run catalog:curate -w api -- <provider> <leagueId> [--off]
if (import.meta.url === `file://${process.argv[1]}`) {
  const [providerKey, leagueId, flag] = process.argv.slice(2)
  if (!providerKey || !leagueId) {
    console.error('usage: npm run catalog:curate -w api -- <apifootball|apibasketball> <leagueId> [--off]')
    process.exit(1)
  }
  const pool = createPool()
  const db = createDb(pool)
  try {
    const on = flag !== '--off'
    const n = await setCurated(db, providerKey, leagueId, on)
    if (!n) { console.error(`league ${providerKey}:${leagueId} not in catalog — run catalog:sync first`); process.exitCode = 1 }
    else console.log(`${providerKey}:${leagueId} curated=${on}`)
  } finally {
    await pool.end()
  }
}
```

- [ ] **Step 4: Add npm scripts** to `api/package.json` next to `"competition:add"`:

```json
    "catalog:sync": "node --env-file=../.env src/worker/catalog-sync.js",
    "catalog:curate": "node --env-file=../.env src/worker/catalog-curate.js",
```

- [ ] **Step 5: Run** — the test file, then full api suite. Expected: PASS.
- [ ] **Step 6: Commit** — `git add api/src/worker/catalog-sync.js api/src/worker/catalog-curate.js api/test/catalog-sync.test.js api/package.json && git commit -m "feat(worker): persisted catalog sync + curation CLIs" && git push origin main`

---

### Task 5: Account auth — sendMail seam, requireAccount, login/session/whoami routes

**Files:**
- Create: `api/src/accounts/auth.js`, `api/src/routes/account.js`
- Modify: `api/src/app.js` (decorate `sendMail`, register `accountRoutes`)
- Test: `api/test/account-auth.test.js`

**Interfaces:**
- Produces:
  - `api/src/accounts/auth.js`: `LOGIN_TOKEN_TTL_MS` (15 min), `SESSION_TTL_MS` (90 days), `requireAccount(app)` → preHandler resolving header `x-account-token` against unexpired `account_session` rows → sets `req.account` (full account row) or replies 401 `{error:'unauthorized'}`.
  - Routes (in `accountRoutes`):
    - `POST /api/account/login {email}` — rate-limit 5/15min; normalizes email (`trim().toLowerCase()`); inserts a `login_token`; calls `app.sendMail(email, 'Your sign-in link', 'https://<platformHost>/account/login/<token>')`; ALWAYS returns `{ok:true}`.
    - `POST /api/account/session {token}` — rate-limit 20/15min; 401 when unknown/expired/used; marks `usedAt`; upserts `account` by email (`onConflictDoNothing` on the unique email + re-select — survives the race); inserts `account_session`; 201 `{accountToken, account:{id,email,name}}`.
    - `GET /api/account` — `requireAccount`; returns `{id, email, name}`.
  - `app.sendMail(to, subject, body)` decoration in `buildApp`: `opts.sendMail ?? (async (to, subject, body) => console.log(\`[mail] to=${to} subject=${subject}\n${body}\`))` — the console mailer IS dev mode; tests inject a capture fn.
- Consumes: `loginToken`, `accountSession`, `account` (Task 1), `newToken` from `../sweeps/tokens.js`.
- **P4 slot-in note:** subscription gating will be one added check inside `requireAccount`/the provision path.

- [ ] **Step 1: Write the failing test** (budget: exactly 3 login POSTs, ≤ 20 session POSTs)

```js
// api/test/account-auth.test.js
import { test, expect, beforeAll, afterAll } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { buildApp } from '../src/app.js'
import { account, accountSession, loginToken } from '../src/db/schema.js'

const { pool, db } = openTestDb()
const mails = []
const app = buildApp(db, {
  sessionSecret: 'test-secret', platformHost: 'platform.test',
  sendMail: async (to, subject, body) => mails.push({ to, subject, body }),
})
beforeAll(async () => { await app.ready() })
afterAll(async () => {
  await db.delete(accountSession)
  await db.delete(loginToken)
  await db.delete(account).where(inArray(account.email, ['ada@x.test', 'noone@x.test']))
  await app.close(); await pool.end()
})

const linkToken = (body) => body.match(/\/account\/login\/([0-9A-Za-z]+)/)[1]

test('login → emailed link token → session → whoami', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/account/login', payload: { email: '  Ada@X.test ' } })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ ok: true })
  expect(mails).toHaveLength(1)
  expect(mails[0].to).toBe('ada@x.test') // normalized
  const token = linkToken(mails[0].body)

  const sess = await app.inject({ method: 'POST', url: '/api/account/session', payload: { token } })
  expect(sess.statusCode).toBe(201)
  const { accountToken, account: acc } = sess.json()
  expect(acc.email).toBe('ada@x.test')
  expect(accountToken).toMatch(/^[0-9A-Za-z]{22}$/)

  const who = await app.inject({ method: 'GET', url: '/api/account', headers: { 'x-account-token': accountToken } })
  expect(who.statusCode).toBe(200)
  expect(who.json()).toMatchObject({ id: acc.id, email: 'ada@x.test' })

  // the link is single-use
  expect((await app.inject({ method: 'POST', url: '/api/account/session', payload: { token } })).statusCode).toBe(401)
})

test('second login for the same email reuses the account (upsert by email)', async () => {
  await app.inject({ method: 'POST', url: '/api/account/login', payload: { email: 'ada@x.test' } })
  const token = linkToken(mails.at(-1).body)
  const sess = await app.inject({ method: 'POST', url: '/api/account/session', payload: { token } })
  const accounts = await db.select().from(account).where(eq(account.email, 'ada@x.test'))
  expect(accounts).toHaveLength(1)
  expect(sess.json().account.id).toBe(accounts[0].id)
})

test('expired link and expired session are refused; login never leaks existence', async () => {
  const third = await app.inject({ method: 'POST', url: '/api/account/login', payload: { email: 'noone@x.test' } })
  expect(third.json()).toEqual({ ok: true }) // same answer whether or not an account exists
  const token = linkToken(mails.at(-1).body)
  await db.update(loginToken).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(loginToken.token, token))
  expect((await app.inject({ method: 'POST', url: '/api/account/session', payload: { token } })).statusCode).toBe(401)

  const [acc] = await db.select().from(account).where(eq(account.email, 'ada@x.test'))
  await db.insert(accountSession).values({ token: 'expiredsess', accountId: acc.id, expiresAt: new Date(Date.now() - 1000) })
  expect((await app.inject({ method: 'GET', url: '/api/account', headers: { 'x-account-token': 'expiredsess' } })).statusCode).toBe(401)
  expect((await app.inject({ method: 'GET', url: '/api/account' })).statusCode).toBe(401) // no header
})
```

- [ ] **Step 2: Run it** — Expected: FAIL (404 — routes don't exist).

- [ ] **Step 3: Implement**

```js
// api/src/accounts/auth.js
import { and, eq, gt } from 'drizzle-orm'
import { account, accountSession } from '../db/schema.js'

export const LOGIN_TOKEN_TTL_MS = 15 * 60_000
export const SESSION_TTL_MS = 90 * 24 * 3600_000

/** preHandler: resolve the x-account-token header → req.account, else 401.
 *  P4 slot-in: subscription gating adds one check here. */
export function requireAccount(app) {
  return async (req, reply) => {
    const token = req.headers['x-account-token']
    if (!token) return reply.code(401).send({ error: 'unauthorized' })
    const [row] = await app.db.select({ account }).from(accountSession)
      .innerJoin(account, eq(accountSession.accountId, account.id))
      .where(and(eq(accountSession.token, token), gt(accountSession.expiresAt, new Date())))
    if (!row) return reply.code(401).send({ error: 'unauthorized' })
    req.account = row.account
  }
}
```

```js
// api/src/routes/account.js
import { eq } from 'drizzle-orm'
import { account, accountSession, loginToken } from '../db/schema.js'
import { newToken } from '../sweeps/tokens.js'
import { requireAccount, LOGIN_TOKEN_TTL_MS, SESSION_TTL_MS } from '../accounts/auth.js'

const loginBody = {
  type: 'object', required: ['email'], additionalProperties: false,
  properties: { email: { type: 'string', minLength: 3, maxLength: 254, pattern: '^\\S+@\\S+\\.\\S+$' } },
}
const sessionBody = {
  type: 'object', required: ['token'], additionalProperties: false,
  properties: { token: { type: 'string', minLength: 8, maxLength: 64 } },
}

export async function accountRoutes(app) {
  app.post('/api/account/login', {
    schema: { body: loginBody },
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (req) => {
    const email = req.body.email.trim().toLowerCase()
    const token = newToken()
    await app.db.insert(loginToken).values({ token, email, expiresAt: new Date(Date.now() + LOGIN_TOKEN_TTL_MS) })
    await app.sendMail(email, 'Your sign-in link', `https://${app.platformHost}/account/login/${token}`)
    return { ok: true } // always — never leak whether the email has an account
  })

  app.post('/api/account/session', {
    schema: { body: sessionBody },
    config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
  }, async (req, reply) => {
    const now = new Date()
    const [lt] = await app.db.select().from(loginToken).where(eq(loginToken.token, req.body.token))
    if (!lt || lt.usedAt || lt.expiresAt < now) return reply.code(401).send({ error: 'unauthorized' })
    await app.db.update(loginToken).set({ usedAt: now }).where(eq(loginToken.token, lt.token))
    // account is born HERE (verified email). onConflictDoNothing + re-select survives a concurrent first-login race.
    await app.db.insert(account).values({ id: `ac_${newToken(12)}`, email: lt.email }).onConflictDoNothing()
    const [acc] = await app.db.select().from(account).where(eq(account.email, lt.email))
    const token = newToken()
    await app.db.insert(accountSession).values({ token, accountId: acc.id, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) })
    return reply.code(201).send({ accountToken: token, account: { id: acc.id, email: acc.email, name: acc.name } })
  })

  app.get('/api/account', { preHandler: requireAccount(app) }, async (req) => (
    { id: req.account.id, email: req.account.email, name: req.account.name }
  ))
}
```

  In `api/src/app.js`: add `import { accountRoutes } from './routes/account.js'`, and inside `buildApp` (next to the other decorations):

```js
  // magic-link delivery seam — console logger IS dev mode; a real provider is an ops decision (P4+)
  app.decorate('sendMail', opts.sendMail ?? (async (to, subject, body) => console.log(`[mail] to=${to} subject=${subject}\n${body}`)))
```

  and `app.register(accountRoutes)` next to the other registrations.

- [ ] **Step 4: Run** — the test file, then full api suite. Expected: PASS.
- [ ] **Step 5: Commit** — `git add api/src/accounts api/src/routes/account.js api/src/app.js api/test/account-auth.test.js && git commit -m "feat(api): magic-link account auth (login/session/whoami)" && git push origin main`

---

### Task 6: GET /api/catalog — curated browse/search

**Files:**
- Create: `api/src/routes/catalog.js`
- Modify: `api/src/app.js` (register)
- Test: `api/test/catalog-route.test.js`

**Interfaces:**
- Produces: `GET /api/catalog?sport=&q=` (preHandler `requireAccount`):
  - reads all `curated` rows; maps each to `{ provider, sport: sportOf(provider), leagueId: providerLeagueId, name, type, logo, country, seasons }` where `seasons` = only **provisionable** ones (`s.standings && seasonInWindow(provider, s.season)`), sorted descending by `season`;
  - drops rows with zero provisionable seasons;
  - `sport` filters by mapped sport; `q` (min 2 chars) case-insensitive substring on `name` or `country.name`;
  - capped at 50 rows.
- Consumes: `requireAccount` (Task 5), `sportOf`/`seasonInWindow` (Task 3), `catalogLeague` (Task 1).

- [ ] **Step 1: Write the failing test**

```js
// api/test/catalog-route.test.js
import { test, expect, beforeAll, afterAll } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { buildApp } from '../src/app.js'
import { account, accountSession, catalogLeague } from '../src/db/schema.js'

const { pool, db } = openTestDb()
const app = buildApp(db, { sessionSecret: 'test-secret', platformHost: 'platform.test' })

beforeAll(async () => {
  await app.ready()
  await db.insert(account).values({ id: 'ac_cat', email: 'cat@x.test' }).onConflictDoNothing()
  await db.insert(accountSession).values({ token: 'catsession', accountId: 'ac_cat', expiresAt: new Date(Date.now() + 3600_000) })
  await db.insert(catalogLeague).values([
    { id: 'apifootball:39', provider: 'apifootball', providerLeagueId: '39', name: 'Premier League', type: 'League',
      country: { name: 'England', code: 'GB-ENG', flag: null }, curated: true,
      seasons: [
        { season: '2026', start: '2026-08-21', end: '2027-05-30', current: true, standings: false, odds: false }, // unstarted → not provisionable
        { season: '2025', start: '2025-08-15', end: '2026-05-24', current: false, standings: true, odds: false },
      ] },
    { id: 'apibasketball:12', provider: 'apibasketball', providerLeagueId: '12', name: 'NBA', type: 'League',
      country: { name: 'USA', code: 'US', flag: null }, curated: true,
      seasons: [
        { season: '2025-2026', start: '2025-09-30', end: '2026-06-18', current: false, standings: true, odds: false }, // outside free window
        { season: '2023-2024', start: '2023-10-05', end: '2024-06-18', current: false, standings: true, odds: false },
      ] },
    { id: 'apifootball:999', provider: 'apifootball', providerLeagueId: '999', name: 'Obscure NotCurated League', type: 'League',
      country: { name: 'England', code: null, flag: null }, curated: false,
      seasons: [{ season: '2025', start: '2025-01-01', end: '2025-12-31', current: false, standings: true, odds: false }] },
  ])
})
afterAll(async () => {
  await db.delete(catalogLeague).where(inArray(catalogLeague.id, ['apifootball:39', 'apibasketball:12', 'apifootball:999']))
  await db.delete(accountSession).where(eq(accountSession.token, 'catsession'))
  await db.delete(account).where(eq(account.id, 'ac_cat'))
  await app.close(); await pool.end()
})

const M = { headers: { 'x-account-token': 'catsession' } }

test('catalog returns curated rows with only provisionable seasons', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/catalog', ...M })
  expect(res.statusCode).toBe(200)
  const rows = res.json()
  expect(rows.map((r) => r.name).sort()).toEqual(['NBA', 'Premier League']) // non-curated invisible
  const epl = rows.find((r) => r.name === 'Premier League')
  expect(epl).toMatchObject({ provider: 'apifootball', sport: 'football', leagueId: '39' })
  expect(epl.seasons.map((s) => s.season)).toEqual(['2025']) // 2026 dropped: standings:false
  const nba = rows.find((r) => r.name === 'NBA')
  expect(nba.seasons.map((s) => s.season)).toEqual(['2023-2024']) // 2025-2026 dropped: window
})

test('sport + q filters, auth required', async () => {
  const bySport = await app.inject({ method: 'GET', url: '/api/catalog?sport=basketball', ...M })
  expect(bySport.json().map((r) => r.name)).toEqual(['NBA'])
  const byQ = await app.inject({ method: 'GET', url: '/api/catalog?q=engl', ...M })
  expect(byQ.json().map((r) => r.name)).toEqual(['Premier League']) // matches country name
  expect((await app.inject({ method: 'GET', url: '/api/catalog' })).statusCode).toBe(401)
})
```

- [ ] **Step 2: Run it** — Expected: FAIL (404).

- [ ] **Step 3: Implement**

```js
// api/src/routes/catalog.js
import { eq } from 'drizzle-orm'
import { catalogLeague } from '../db/schema.js'
import { requireAccount } from '../accounts/auth.js'
import { sportOf, seasonInWindow } from '../providers/registry.js'

const catalogQuery = {
  type: 'object', additionalProperties: false,
  properties: {
    sport: { type: 'string', minLength: 1, maxLength: 30 },
    q: { type: 'string', minLength: 2, maxLength: 80 },
  },
}

/** A season a user may actually provision: covered by standings AND inside our plan window. */
const provisionable = (row) => (row.seasons ?? [])
  .filter((s) => s.standings && seasonInWindow(row.provider, s.season))
  .sort((a, b) => (a.season < b.season ? 1 : -1))

export async function catalogRoutes(app) {
  app.get('/api/catalog', { preHandler: requireAccount(app), schema: { querystring: catalogQuery } }, async (req) => {
    const { sport, q } = req.query
    const rows = await app.db.select().from(catalogLeague).where(eq(catalogLeague.curated, true))
    const needle = q?.toLowerCase()
    return rows
      .map((r) => ({
        provider: r.provider, sport: sportOf(r.provider), leagueId: r.providerLeagueId,
        name: r.name, type: r.type, logo: r.logo, country: r.country, seasons: provisionable(r),
      }))
      .filter((r) => r.seasons.length)
      .filter((r) => !sport || r.sport === sport)
      .filter((r) => !needle || r.name.toLowerCase().includes(needle) || (r.country?.name ?? '').toLowerCase().includes(needle))
      .slice(0, 50)
  })
}
```

  In `api/src/app.js`: `import { catalogRoutes } from './routes/catalog.js'` + `app.register(catalogRoutes)`.

- [ ] **Step 4: Run** — the file, then full api suite. Expected: PASS.
- [ ] **Step 5: Commit** — `git add api/src/routes/catalog.js api/src/app.js api/test/catalog-route.test.js && git commit -m "feat(api): curated catalog browse/search" && git push origin main`

---

### Task 7: addCompetition accepts catalog league meta (budget rule made code)

**Files:**
- Modify: `api/src/worker/add-competition.js`
- Test: `api/test/add-competition.test.js` (extend)

**Interfaces:**
- Produces: `addCompetition(db, provider, { provider: providerKey, leagueId, season, league })` — `league` is OPTIONAL `{name, type, logo}`:
  - when given (the provision route passes catalog values): NO `fetchCompetitions()` call at all;
  - when omitted (the `competition:add` CLI keeps today's behavior): live catalog lookup as before.
  Everything else (id shape, `format` inference `type === 'League' ? 'league' : 'groups_then_ko'`, duplicate throw, `syncCompetitors` + `syncBaseline`) unchanged.
- Consumes: existing `addCompetition` internals.

- [ ] **Step 1: Write the failing test** — append to `api/test/add-competition.test.js` (its `provider()` helper + `ID`/cleanup exist; add a SECOND competition id to the afterAll cleanup lists: `'apibasketball:12:catalog-meta'` — copy each existing delete line with the new id):

```js
test('addCompetition with league meta provided skips the live catalog lookup', async () => {
  const p = provider()
  let catalogCalls = 0
  const counting = { ...p, fetchCompetitions: async () => { catalogCalls++; return p.fetchCompetitions() } }
  const r = await addCompetition(db, counting, {
    provider: 'apibasketball', leagueId: '12', season: 'catalog-meta',
    league: { name: 'NBA', type: 'League', logo: 'https://x/logo.png' },
  })
  expect(catalogCalls).toBe(0) // the budget rule: no per-request catalog fetch
  expect(r.competitionId).toBe('apibasketball:12:catalog-meta')
  const [comp] = await db.select().from(competition).where(eq(competition.id, 'apibasketball:12:catalog-meta'))
  expect(comp).toMatchObject({ name: 'NBA', format: 'league', logo: 'https://x/logo.png' })
})
```

- [ ] **Step 2: Run it** — Expected: FAIL (`catalogCalls` is 1 — the live lookup still runs).

- [ ] **Step 3: Implement** — in `api/src/worker/add-competition.js`, replace the top of `addCompetition`:

```js
/** Provision a competition: row + competitors + first baseline. `league` {name,type,logo} may be
 *  passed from the persisted catalog (provision route — no live catalog call); the CLI omits it
 *  and resolves live. */
export async function addCompetition(db, provider, { provider: providerKey, leagueId, season, league }) {
  if (!league) {
    const leagues = await provider.fetchCompetitions()
    league = leagues.find((l) => String(l.providerLeagueId) === String(leagueId))
    if (!league) throw new Error(`league ${leagueId} not found in ${providerKey} catalog`)
  }
  // ... rest of the function body unchanged (id, duplicate check, comp insert, syncCompetitors, syncBaseline)
```

- [ ] **Step 4: Run** — the file, then full api suite. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(worker): addCompetition takes catalog league meta — no live catalog per provision" && git push origin main`

---

### Task 8: Football league-format support (parseRound, standings rank, group-filter gate)

Provisioned football LEAGUES (EPL et al) break three WC-shaped assumptions today:
`"Regular Season - 15"` parses to `{stage:'knockout', matchday:0}` (so DRAW picks get refused — leagues have draws!), league standings rows have no `"Group X"` label so `groupsFromStandings` filters ALL of them out, and `mapStanding` discards the provider's `rank`.

**Files:**
- Modify: `api/src/providers/mapping.js` (`parseRound`, `mapStanding`), `api/src/worker/baseline-sync.js` (group-filter gate)
- Test: `api/test/mapping.test.js` (extend), `api/test/baseline-sync.test.js` (extend)

**Interfaces:**
- Produces:
  - `parseRound('Regular Season - 15')` → `{ group: '', matchday: 15, stage: 'group' }` (league rounds are the sport-generic "regular season = group stage" convention, same as NBA).
  - `mapStanding(raw)` gains `rank: raw.rank ?? null` (API-Football standings rows always carry `rank`; WC group tables now store it too — the `/api/standings` route never reads the `rank` column, wire unchanged).
  - `syncBaseline`: the `groupsFromStandings` filter block runs only `if (provider.groupsFromStandings && competition.format !== 'league')` — league-format football keeps ALL standings rows (their group label is the league name, `parseGroupLabel` → null, and that's fine: `ranking` has no group column).
- Consumes: `competition.format` (already on the row).

- [ ] **Step 1: Write the failing tests** — append to `api/test/mapping.test.js`:

```js
test('parseRound: league regular-season rounds are group-stage with a matchday', () => {
  expect(parseRound('Regular Season - 15')).toEqual({ group: '', matchday: 15, stage: 'group' })
  expect(parseRound('Regular Season - 1')).toEqual({ group: '', matchday: 1, stage: 'group' })
  // WC shapes unchanged
  expect(parseRound('Group Stage - 2')).toEqual({ group: '', matchday: 2, stage: 'group' })
  expect(parseRound('Quarter-finals')).toEqual({ group: '', matchday: 0, stage: 'knockout' })
})

test('mapStanding carries the provider rank', () => {
  const s = mapStanding({ team: { id: 3001 }, group: 'Group L', rank: 4, points: 3,
    all: { played: 1, win: 1, draw: 0, lose: 0, goals: { for: 2, against: 1 } } })
  expect(s.rank).toBe(4)
})
```

  and append to `api/test/baseline-sync.test.js` (uses its existing `db`; football recorded provider with league-shaped standings — group labels that are NOT "Group X"):

```js
test('league-format football keeps all standings rows (no group filter)', async () => {
  const LG = { id: 'apifootball:39:test-league', provider: 'apifootball', sport: 'football', leagueId: '39', season: 'test-league' }
  await db.insert(competition).values({ ...LG, format: 'league', name: 'EPL Test' }).onConflictDoNothing()
  await db.insert(competitor).values([
    { id: `cp_${LG.id}_ars`, competitionId: LG.id, code: 'ars', name: 'Arsenal', color: '#f00', providerId: 42 },
    { id: `cp_${LG.id}_liv`, competitionId: LG.id, code: 'liv', name: 'Liverpool', color: '#c00', providerId: 40 },
  ]).onConflictDoNothing()
  const leagueProvider = createRecordedProvider({
    fixtures: { response: [{
      fixture: { id: 7710001, date: '2026-01-10T15:00:00+00:00', status: { short: 'FT', elapsed: 90 }, venue: { name: 'V', city: 'C' } },
      league: { round: 'Regular Season - 21' }, teams: { home: { id: 42, winner: true }, away: { id: 40, winner: false } },
      goals: { home: 2, away: 1 }, score: { halftime: { home: 1, away: 0 }, fulltime: { home: 2, away: 1 }, penalty: { home: null, away: null } },
    }] },
    standings: { response: [{ league: { standings: [[
      { team: { id: 40, name: 'Liverpool' }, group: 'Premier League', rank: 1, points: 50, all: { played: 21, win: 16, draw: 2, lose: 3, goals: { for: 55, against: 20 } } },
      { team: { id: 42, name: 'Arsenal' }, group: 'Premier League', rank: 2, points: 47, all: { played: 21, win: 14, draw: 5, lose: 2, goals: { for: 44, against: 18 } } },
    ]] } }] },
    predictions: { response: [] },
  })
  try {
    const r = await syncBaseline(db, leagueProvider, { ...LG, format: 'league' })
    expect(r.standings).toBe(2) // both rows kept despite no "Group X" label
    const rows = await db.select().from(ranking).where(eq(ranking.competitionId, LG.id))
    expect(rows).toHaveLength(2)
    expect(rows.find((x) => x.competitorCode === 'liv')).toMatchObject({ rank: 1, points: 50 })
    const [ev] = await db.select().from(event).where(eq(event.competitionId, LG.id))
    expect(ev.stage).toBe('group') // league fixtures are group-stage (draw picks stay legal)
    expect(ev.detail.matchday).toBe(21)
  } finally {
    await db.delete(event).where(eq(event.competitionId, LG.id))
    await db.delete(ranking).where(eq(ranking.competitionId, LG.id))
    await db.delete(competitor).where(eq(competitor.competitionId, LG.id))
    await db.delete(competition).where(eq(competition.id, LG.id))
  }
})
```

- [ ] **Step 2: Run both files** — Expected: FAIL (parseRound → knockout/0; standings filtered to 0 → `r.standings` is 0).

- [ ] **Step 3: Implement**
  - `parseRound` — add the regular-season branch before the final return:

```js
  m = /Regular\s+Season\s*-\s*(\d+)/i.exec(s)
  if (m) return { group: '', matchday: Number(m[1]), stage: 'group' }
```

  - `mapStanding` — change `rank: null,` to `rank: raw.rank ?? null,` (update the doc comment: football leagues carry the provider rank; WC group tables store it too, the wire doesn't read it).
  - `baseline-sync.js` — change the gate line `if (provider.groupsFromStandings) {` to:

```js
    if (provider.groupsFromStandings && competition.format !== 'league') {
```

    (comment: league standings have no "Group X" labels — filtering would empty them; groups only exist in cup formats).

- [ ] **Step 4: Run** — both files, then full api suite. Expected: PASS (WC tests unchanged: its format is `groups_then_ko`... **note** the seeded WC competition's `format` — check `api/src/seed/seed.js`; if the seed uses another value, keep the gate as written and re-verify the WC baseline tests still pass, they run with the recorded provider against the seeded competition row).
- [ ] **Step 5: Commit** — `git commit -am "feat(providers): football league-format support — regular-season rounds, provider rank, group-filter gate" && git push origin main`

---

### Task 9: Odds-loop kickoff window in syncBaseline

**Files:**
- Modify: `api/src/worker/baseline-sync.js`
- Test: `api/test/baseline-sync.test.js` (one existing assertion re-keyed + one new test)

**Interfaces:**
- Produces: the odds/predictions loop skips fixtures that are `final` OR kick off more than **7 days** in the future (`ODDS_WINDOW_MS = 7 * 24 * 3600_000`, module const). `detailMerge` already preserves previously stored `prob`/`markets` on update. **Deliberate behavior change** (design §6, approved): a fixture only carries odds once it nears kickoff.
- Consumes: nothing new.

- [ ] **Step 1: Re-key the existing assertion + add the failing test.** In `api/test/baseline-sync.test.js`, the test `'baseline sync upserts provider fixtures, prunes seed fixtures, logs ok'` asserts `expect(f1.probA).toBe(55)` on fixture `9001` — but 9001 is FINAL in the recorded feed, so under the window it no longer gets a prob. Change that line to assert on the upcoming fixture instead:

```js
  expect(f1.probA).toBeUndefined()                 // final fixtures no longer fetch odds (budget window)
  const f2 = fx.find((f) => f.id === '9002')
  expect(f2.probA).toBe(55)                        // predictions applied to the in-window upcoming fixture
```

  (Note: `9002`'s recorded kickoff `2026-06-16` is in the past with status NS → inside the window by the rule "skip only final or >7 days out". If any assertion about probs elsewhere in the file contradicts the new behavior, re-key it the same way — final → no fresh odds.)

  Then append the new test:

```js
test('odds loop skips final and far-future fixtures (feed-budget window)', async () => {
  const in3days = new Date(Date.now() + 3 * 24 * 3600_000).toISOString()
  const in30days = new Date(Date.now() + 30 * 24 * 3600_000).toISOString()
  const fixtureRaw = (id, date, status) => ({
    fixture: { id, date, status: { short: status, elapsed: status === 'FT' ? 90 : null }, venue: { name: 'V', city: 'C' } },
    league: { round: 'Group A - 1' }, teams: { home: { id: 3001, winner: status === 'FT' ? true : null }, away: { id: 3002, winner: status === 'FT' ? false : null } },
    goals: status === 'FT' ? { home: 1, away: 0 } : { home: null, away: null },
    score: { halftime: { home: null, away: null }, fulltime: { home: null, away: null }, penalty: { home: null, away: null } },
  })
  const oddsCalls = []
  const base = createRecordedProvider({
    fixtures: { response: [
      fixtureRaw(9101, '2026-06-13T03:30:00+00:00', 'FT'), // final → skip
      fixtureRaw(9102, in3days, 'NS'),                     // near upcoming → fetch
      fixtureRaw(9103, in30days, 'NS'),                    // far future → skip
    ] },
    standings: load('standings'), predictions: load('predictions'),
  })
  const provider = { ...base, fetchOdds: async (id) => { oddsCalls.push(String(id)); return null } }
  const r = await syncBaseline(db, provider, FOOTBALL_COMP)
  expect(r.fixtures).toBe(3)
  expect(oddsCalls).toEqual(['9102']) // only the near-upcoming fixture
})
```

  (This test runs after the earlier baseline tests in the same file and replaces the event set for the competition; it needs no extra cleanup beyond the file's existing afterAll reseed.)

- [ ] **Step 2: Run the file** — Expected: FAIL (`oddsCalls` = all three; `f1.probA` = 55).

- [ ] **Step 3: Implement** — in `api/src/worker/baseline-sync.js`, add near the imports:

```js
// Odds are only actionable pre-kickoff: skip finals and far-future fixtures so a provisioned
// 380-game league costs ~dozens of odds calls per baseline, not ~1,500-3,000/day (design §6).
const ODDS_WINDOW_MS = 7 * 24 * 3600_000
```

  and change the odds loop's inner guard:

```js
    if (provider.fetchOdds) {
      const now = Date.now()
      for (const f of fixtures) {
        if (f.status === 'final' || f.kickoffUtc.getTime() - now > ODDS_WINDOW_MS) continue
        // ... existing body unchanged
      }
    }
```

- [ ] **Step 4: Run** — the file, then full api suite (watch for other prob assertions). Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(worker): odds fetch windowed to near-kickoff fixtures (feed budget)" && git push origin main`

---

### Task 10: Account-owned sweeps — provision, list, archive

**Files:**
- Modify: `api/src/routes/sweeps.js` (export `links`), `api/src/routes/account.js` (add the three routes), `api/src/app.js` (decorate `providerFor`)
- Test: `api/test/account-sweeps.test.js`

**Interfaces:**
- Produces:
  - `api/src/routes/sweeps.js`: `function links(app, row)` gains `export` (unchanged body).
  - `app.providerFor` decoration in `buildApp`: `opts.providerFor ?? providerFor` (import from `./providers/registry.js`) — tests inject recorded providers; the provision route resolves adapters ONLY through `app.providerFor`.
  - Routes (appended inside `accountRoutes`):
    - `POST /api/account/sweeps {name, provider, leagueId, season}` (requireAccount) →
      403 `{error:'sweep_cap', cap}` when my unarchived sweeps ≥ `Number(process.env.ACCOUNT_SWEEP_CAP ?? 3)`;
      400 `{error:'unknown_competition'}` unless the catalog row `'<provider>:<leagueId>'` exists, is `curated`, and has that season provisionable (`standings && seasonInWindow`);
      ensures the competition: exists with events → reuse; exists eventless (an earlier provision died mid-baseline) → `syncCompetitors` + `syncBaseline`; absent → `addCompetition(db, app.providerFor({provider}), { provider, leagueId, season, league: {name: cl.name, type: cl.type, logo: cl.logo} })`;
      inserts the sweep (`kind:'token'`, `accountId: req.account.id`) and returns 201 `{id, name, competitionId, memberToken, adminToken, memberLink, adminLink}`.
    - `GET /api/account/sweeps` (requireAccount) → my sweeps (any archive state): `[{id, name, competitionId, archivedAt, createdAt, memberLink, adminLink}]`.
    - `POST /api/account/sweeps/:id/archive` (requireAccount) → 404 unless the sweep is MINE; sets `archivedAt`; `{id, archived: true}`. Frees a cap slot.
- Consumes: `requireAccount` (T5), `catalogLeague` (T1), `seasonInWindow` (T3), `addCompetition` (T7), `syncCompetitors`/`syncBaseline`, `links` (this task), `newToken`.

- [ ] **Step 1: Write the failing test**

```js
// api/test/account-sweeps.test.js
import { test, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { eq, inArray } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { buildApp } from '../src/app.js'
import { account, accountSession, catalogLeague, competition, competitor, event, ranking, sweep } from '../src/db/schema.js'
import { createRecordedBasketballProvider } from '../src/providers/recorded-basketball-provider.js'

const { pool, db } = openTestDb()
const loadB = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apibasketball/${n}.json`, import.meta.url)))
const NBA_ID = 'apibasketball:12:2023-2024'
const recordedB = () => createRecordedBasketballProvider({
  leagues: loadB('leagues'), teams: loadB('teams'), games: loadB('games'), standings: loadB('standings'),
})
const app = buildApp(db, {
  sessionSecret: 'test-secret', platformHost: 'platform.test',
  providerFor: (comp) => { if (comp.provider !== 'apibasketball') throw new Error(`unexpected provider ${comp.provider}`); return recordedB() },
})
const M = { headers: { 'x-account-token': 'swsession' } }

beforeAll(async () => {
  await app.ready()
  await db.insert(account).values({ id: 'ac_sw', email: 'sw@x.test' }).onConflictDoNothing()
  await db.insert(accountSession).values({ token: 'swsession', accountId: 'ac_sw', expiresAt: new Date(Date.now() + 3600_000) })
  await db.insert(catalogLeague).values({
    id: 'apibasketball:12', provider: 'apibasketball', providerLeagueId: '12', name: 'NBA', type: 'League',
    country: { name: 'USA', code: 'US', flag: null }, curated: true,
    seasons: [{ season: '2023-2024', start: '2023-10-05', end: '2024-06-18', current: false, standings: true, odds: false }],
  }).onConflictDoNothing()
})
afterAll(async () => {
  await db.delete(sweep).where(eq(sweep.accountId, 'ac_sw'))
  await db.delete(event).where(eq(event.competitionId, NBA_ID))
  await db.delete(ranking).where(eq(ranking.competitionId, NBA_ID))
  await db.delete(competitor).where(eq(competitor.competitionId, NBA_ID))
  await db.delete(competition).where(eq(competition.id, NBA_ID))
  await db.delete(catalogLeague).where(eq(catalogLeague.id, 'apibasketball:12'))
  await db.delete(accountSession).where(eq(accountSession.token, 'swsession'))
  await db.delete(account).where(eq(account.id, 'ac_sw'))
  await app.close(); await pool.end()
})

const provision = (name, over = {}) => app.inject({
  method: 'POST', url: '/api/account/sweeps', ...M,
  payload: { name, provider: 'apibasketball', leagueId: '12', season: '2023-2024', ...over },
})

test('provision creates competition once, reuses it after, owns the sweeps', async () => {
  const r1 = await provision('First')
  expect(r1.statusCode).toBe(201)
  const b1 = r1.json()
  expect(b1.competitionId).toBe(NBA_ID)
  expect(b1.memberLink).toContain(`/g/${b1.memberToken}`)
  expect((await db.select().from(event).where(eq(event.competitionId, NBA_ID))).length).toBeGreaterThan(0)

  const evCount = (await db.select().from(event).where(eq(event.competitionId, NBA_ID))).length
  const r2 = await provision('Second')
  expect(r2.statusCode).toBe(201)
  expect(r2.json().competitionId).toBe(NBA_ID) // same competition, deduped
  expect((await db.select().from(event).where(eq(event.competitionId, NBA_ID))).length).toBe(evCount)

  const list = await app.inject({ method: 'GET', url: '/api/account/sweeps', ...M })
  expect(list.json().map((s) => s.name).sort()).toEqual(['First', 'Second'])
})

test('cap blocks the 4th sweep; archive frees the slot; ownership scoped', async () => {
  expect((await provision('Third')).statusCode).toBe(201)
  const fourth = await provision('Fourth')
  expect(fourth.statusCode).toBe(403)
  expect(fourth.json()).toMatchObject({ error: 'sweep_cap', cap: 3 })

  const mine = (await app.inject({ method: 'GET', url: '/api/account/sweeps', ...M })).json()
  const target = mine.find((s) => s.name === 'Third')
  const arch = await app.inject({ method: 'POST', url: `/api/account/sweeps/${target.id}/archive`, ...M })
  expect(arch.json()).toEqual({ id: target.id, archived: true })
  expect((await provision('Fourth')).statusCode).toBe(201)

  // someone else's sweep id → 404 (the seeded default sweep is unowned)
  expect((await app.inject({ method: 'POST', url: '/api/account/sweeps/default/archive', ...M })).statusCode).toBe(404)
})

test('validation: non-curated league, bad season, unauthenticated', async () => {
  await db.update(catalogLeague).set({ curated: false }).where(eq(catalogLeague.id, 'apibasketball:12'))
  expect((await provision('Nope')).statusCode).toBe(400)
  await db.update(catalogLeague).set({ curated: true }).where(eq(catalogLeague.id, 'apibasketball:12'))
  expect((await provision('Nope', { season: '2025-2026' })).statusCode).toBe(400) // outside free window
  expect((await provision('Nope', { leagueId: '422' })).statusCode).toBe(400)     // not in catalog
  const anon = await app.inject({ method: 'POST', url: '/api/account/sweeps', payload: { name: 'X', provider: 'apibasketball', leagueId: '12', season: '2023-2024' } })
  expect(anon.statusCode).toBe(401)
})
```

- [ ] **Step 2: Run it** — Expected: FAIL (404 — route missing).

- [ ] **Step 3: Implement**
  - `api/src/routes/sweeps.js`: change `function links(app, row)` to `export function links(app, row)`.
  - `api/src/app.js`: `import { providerFor } from './providers/registry.js'` and add `app.decorate('providerFor', opts.providerFor ?? providerFor)`.
  - Append to `api/src/routes/account.js` (new imports: `and`, `isNull` from drizzle; `catalogLeague, competition, event, sweep` from schema; `seasonInWindow` from `../providers/registry.js`; `addCompetition` from `../worker/add-competition.js`; `syncCompetitors` from `../worker/sync-competitors.js`; `syncBaseline` from `../worker/baseline-sync.js`; `links` from `./sweeps.js`):

```js
const provisionBody = {
  type: 'object', required: ['name', 'provider', 'leagueId', 'season'], additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 80 },
    provider: { type: 'string', minLength: 1, maxLength: 40 },
    leagueId: { type: 'string', minLength: 1, maxLength: 20 },
    season: { type: 'string', minLength: 4, maxLength: 12 },
  },
}

// inside accountRoutes(app), after the whoami route:
  const accountGuard = requireAccount(app)

  app.post('/api/account/sweeps', { preHandler: accountGuard, schema: { body: provisionBody } }, async (req, reply) => {
    const { name, provider: providerKey, leagueId, season } = req.body
    const cap = Number(process.env.ACCOUNT_SWEEP_CAP ?? 3) // P4 swaps this constant for subscription quantity
    const mine = await app.db.select({ id: sweep.id }).from(sweep)
      .where(and(eq(sweep.accountId, req.account.id), isNull(sweep.archivedAt)))
    if (mine.length >= cap) return reply.code(403).send({ error: 'sweep_cap', cap })

    const [cl] = await app.db.select().from(catalogLeague).where(eq(catalogLeague.id, `${providerKey}:${leagueId}`))
    const seasonOk = cl?.curated && (cl.seasons ?? [])
      .some((s) => s.season === String(season) && s.standings && seasonInWindow(providerKey, s.season))
    if (!seasonOk) return reply.code(400).send({ error: 'unknown_competition' })

    const compId = `${providerKey}:${leagueId}:${season}`
    const provider = app.providerFor({ provider: providerKey })
    let [comp] = await app.db.select().from(competition).where(eq(competition.id, compId))
    if (!comp) {
      await addCompetition(app.db, provider, {
        provider: providerKey, leagueId, season,
        league: { name: cl.name, type: cl.type, logo: cl.logo }, // from the persisted catalog — never a live catalog call
      })
      ;[comp] = await app.db.select().from(competition).where(eq(competition.id, compId))
    } else {
      const [ev] = await app.db.select({ id: event.id }).from(event).where(eq(event.competitionId, compId)).limit(1)
      if (!ev) { // an earlier provision died mid-baseline — finish the job before binding a sweep
        await syncCompetitors(app.db, provider, comp)
        await syncBaseline(app.db, provider, comp)
      }
    }

    const id = `sw_${newToken(12)}`
    const memberToken = newToken(), adminToken = newToken()
    await app.db.insert(sweep).values({ id, name, kind: 'token', memberToken, adminToken, competitionId: compId, accountId: req.account.id })
    const [row] = await app.db.select().from(sweep).where(eq(sweep.id, id))
    return reply.code(201).send({ id, name: row.name, competitionId: compId, memberToken, adminToken, ...links(app, row) })
  })

  app.get('/api/account/sweeps', { preHandler: accountGuard }, async (req) => {
    const rows = await app.db.select().from(sweep).where(eq(sweep.accountId, req.account.id))
    return rows.map((r) => ({ id: r.id, name: r.name, competitionId: r.competitionId, archivedAt: r.archivedAt, createdAt: r.createdAt, ...links(app, r) }))
  })

  app.post('/api/account/sweeps/:id/archive', { preHandler: accountGuard }, async (req, reply) => {
    const [row] = await app.db.select().from(sweep)
      .where(and(eq(sweep.id, req.params.id), eq(sweep.accountId, req.account.id)))
    if (!row) return reply.code(404).send({ error: 'not_found' })
    await app.db.update(sweep).set({ archivedAt: new Date() }).where(eq(sweep.id, row.id))
    return { id: row.id, archived: true }
  })
```

- [ ] **Step 4: Run** — the file, then full api suite. Expected: PASS.
- [ ] **Step 5: Commit** — `git add api/src/routes/account.js api/src/routes/sweeps.js api/src/app.js api/test/account-sweeps.test.js && git commit -m "feat(api): account-owned sweep provisioning with cap + archive" && git push origin main`

---

### Task 11: Worker — daily catalog refresh + feed-born roster re-sync

**Files:**
- Modify: `api/src/worker.js`
- Test: none new (glue — pieces tested in T4/T8; verified by `node --check` + boot in Task 13)

**Interfaces:**
- Consumes: `syncCatalog` (T4), `PROVIDER_KEYS`/`providerFor` (T3), `syncCompetitors`.
- Produces: worker behavior —
  - split the baseline cron: `cron.schedule('10 0 * * *', () => daily())` and `cron.schedule('10 6,12,18 * * *', () => baseline('cron'))` (boot stays `baseline('boot')`).
  - `daily()`: for each of `PROVIDER_KEYS`, `syncCatalog(db, key, providerFor({ provider: key }))` in its own try/catch (one provider's failure never blocks the other), then `baseline('cron-daily', { syncRosters: true })`.
  - `baseline(reason, { syncRosters = false } = {})`: inside the per-competition loop, before `syncBaseline`: `if (syncRosters && provider.dropUnknownTeams) { try { await syncCompetitors(db, provider, comp) } catch (e) { console.error(...) } }` — feed-born rosters follow churn; curated football stays CLI-driven.
- Budget: catalog = 2 requests/day; rosters = +2 basketball requests/day per active feed-born competition.

- [ ] **Step 1: Implement** per the Interfaces block (imports: `syncCatalog` from `./worker/catalog-sync.js`, `syncCompetitors` from `./worker/sync-competitors.js`, `PROVIDER_KEYS` added to the registry import).
- [ ] **Step 2: Static check** — `cd api && node --check src/worker.js` — exit 0.
- [ ] **Step 3: Full suite** — repo root `npm run test` — green.
- [ ] **Step 4: Commit** — `git commit -am "feat(worker): daily catalog refresh + feed-born roster re-sync" && git push origin main`

---

### Task 12: E2E proof — the §5 flow end to end

**Files:**
- Test: `api/test/selfserve-e2e.test.js` (pure test; failures are bugs in the owning module — fix there with its own failing test first)

**Interfaces:**
- Consumes: everything above. Proof: login → session → browse catalog → provision NBA **and** a football league from recorded feeds → member link serves fixtures through the frozen wire → cap blocks → archive frees.

- [ ] **Step 1: Write the test**

```js
// api/test/selfserve-e2e.test.js
import { test, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { eq, inArray } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { buildApp } from '../src/app.js'
import { account, accountSession, loginToken, catalogLeague, competition, competitor, event, ranking, sweep } from '../src/db/schema.js'
import { createRecordedBasketballProvider } from '../src/providers/recorded-basketball-provider.js'
import { createRecordedProvider } from '../src/providers/recorded-provider.js'

const { pool, db } = openTestDb()
const loadB = (n) => JSON.parse(readFileSync(new URL(`./fixtures/apibasketball/${n}.json`, import.meta.url)))
const NBA_ID = 'apibasketball:12:2023-2024'
const EPL_ID = 'apifootball:39:2025'

// tiny league-shaped football feed: 2 teams, 1 final + 1 upcoming, ranked standings
const eplFixture = (id, date, status, homeWin) => ({
  fixture: { id, date, status: { short: status, elapsed: status === 'FT' ? 90 : null }, venue: { name: 'V', city: 'C' } },
  league: { round: 'Regular Season - 21' },
  teams: { home: { id: 42, winner: status === 'FT' ? homeWin : null }, away: { id: 40, winner: status === 'FT' ? !homeWin : null } },
  goals: status === 'FT' ? { home: 2, away: 1 } : { home: null, away: null },
  score: { halftime: { home: null, away: null }, fulltime: { home: null, away: null }, penalty: { home: null, away: null } },
})
const eplProvider = () => createRecordedProvider({
  teams: { response: [
    { team: { id: 42, name: 'Arsenal', code: 'ARS', country: 'England' } },
    { team: { id: 40, name: 'Liverpool', code: 'LIV', country: 'England' } },
  ] },
  fixtures: { response: [eplFixture(7720001, '2026-01-10T15:00:00+00:00', 'FT', true), eplFixture(7720002, '2026-07-20T15:00:00+00:00', 'NS', null)] },
  standings: { response: [{ league: { standings: [[
    { team: { id: 40, name: 'Liverpool' }, group: 'Premier League', rank: 1, points: 50, all: { played: 21, win: 16, draw: 2, lose: 3, goals: { for: 55, against: 20 } } },
    { team: { id: 42, name: 'Arsenal' }, group: 'Premier League', rank: 2, points: 47, all: { played: 21, win: 14, draw: 5, lose: 2, goals: { for: 44, against: 18 } } },
  ]] } }] },
  predictions: { response: [] },
})
const app = buildApp(db, {
  sessionSecret: 'test-secret', platformHost: 'platform.test',
  sendMail: async (to, subject, body) => mails.push(body),
  providerFor: (c) => (c.provider === 'apibasketball'
    ? createRecordedBasketballProvider({ leagues: loadB('leagues'), teams: loadB('teams'), games: loadB('games'), standings: loadB('standings') })
    : eplProvider()),
})
const mails = []

beforeAll(async () => {
  await app.ready()
  await db.insert(catalogLeague).values([
    { id: 'apibasketball:12', provider: 'apibasketball', providerLeagueId: '12', name: 'NBA', type: 'League',
      country: { name: 'USA', code: 'US', flag: null }, curated: true,
      seasons: [{ season: '2023-2024', start: '2023-10-05', end: '2024-06-18', current: false, standings: true, odds: false }] },
    { id: 'apifootball:39', provider: 'apifootball', providerLeagueId: '39', name: 'Premier League', type: 'League',
      country: { name: 'England', code: 'GB-ENG', flag: null }, curated: true,
      seasons: [{ season: '2025', start: '2025-08-15', end: '2026-05-24', current: false, standings: true, odds: false }] },
  ]).onConflictDoNothing()
})
afterAll(async () => {
  await db.delete(sweep).where(inArray(sweep.competitionId, [NBA_ID, EPL_ID]))
  for (const id of [NBA_ID, EPL_ID]) {
    await db.delete(event).where(eq(event.competitionId, id))
    await db.delete(ranking).where(eq(ranking.competitionId, id))
    await db.delete(competitor).where(eq(competitor.competitionId, id))
    await db.delete(competition).where(eq(competition.id, id))
  }
  await db.delete(catalogLeague).where(inArray(catalogLeague.id, ['apibasketball:12', 'apifootball:39']))
  await db.delete(accountSession)
  await db.delete(loginToken)
  await db.delete(account).where(eq(account.email, 'e2e@x.test'))
  await app.close(); await pool.end()
})

test('§5 flow: sign in → browse → provision both sports → member link works → cap → archive', async () => {
  // 1. magic-link sign-in
  await app.inject({ method: 'POST', url: '/api/account/login', payload: { email: 'e2e@x.test' } })
  const token = mails[0].match(/\/account\/login\/([0-9A-Za-z]+)/)[1]
  const { accountToken } = (await app.inject({ method: 'POST', url: '/api/account/session', payload: { token } })).json()
  const M = { headers: { 'x-account-token': accountToken } }

  // 2. browse the cached catalog — both sports visible, no provider call involved
  const cat = (await app.inject({ method: 'GET', url: '/api/catalog', ...M })).json()
  expect(cat.map((r) => r.name).sort()).toEqual(['NBA', 'Premier League'])

  // 3. provision one sweep per sport
  const nba = (await app.inject({ method: 'POST', url: '/api/account/sweeps', ...M,
    payload: { name: 'Hoops', provider: 'apibasketball', leagueId: '12', season: '2023-2024' } })).json()
  const epl = (await app.inject({ method: 'POST', url: '/api/account/sweeps', ...M,
    payload: { name: 'Footy', provider: 'apifootball', leagueId: '39', season: '2025' } })).json()
  expect(nba.competitionId).toBe(NBA_ID)
  expect(epl.competitionId).toBe(EPL_ID)

  // 4. the member link works: fixtures served through the frozen wire, scoped per sweep
  const fixtures = await app.inject({ method: 'GET', url: '/api/fixtures',
    headers: { host: 'platform.test', cookie: await memberCookie(nba.memberToken) } })
  expect(fixtures.statusCode).toBe(200)
  expect(fixtures.json().length).toBeGreaterThan(0)
  expect(fixtures.json()[0]).toHaveProperty('t1Code')

  const eplFixtures = await app.inject({ method: 'GET', url: '/api/fixtures',
    headers: { host: 'platform.test', cookie: await memberCookie(epl.memberToken) } })
  expect(eplFixtures.json()).toHaveLength(2)
  expect(eplFixtures.json().every((f) => f.stage === 'group')).toBe(true) // league rounds mapped

  // 5. cap blocks the 4th; archive frees it
  const third = await app.inject({ method: 'POST', url: '/api/account/sweeps', ...M,
    payload: { name: 'Third', provider: 'apibasketball', leagueId: '12', season: '2023-2024' } })
  expect(third.statusCode).toBe(201)
  const fourth = await app.inject({ method: 'POST', url: '/api/account/sweeps', ...M,
    payload: { name: 'Fourth', provider: 'apibasketball', leagueId: '12', season: '2023-2024' } })
  expect(fourth.statusCode).toBe(403)
  await app.inject({ method: 'POST', url: `/api/account/sweeps/${third.json().id}/archive`, ...M })
  expect((await app.inject({ method: 'POST', url: '/api/account/sweeps', ...M,
    payload: { name: 'Fourth', provider: 'apibasketball', leagueId: '12', season: '2023-2024' } })).statusCode).toBe(201)
})

async function memberCookie(memberToken) {
  const res = await app.inject({ method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token: memberToken } })
  return res.headers['set-cookie']
}
```

- [ ] **Step 2: Run it** — `npx vitest run test/selfserve-e2e.test.js` — Expected: PASS. A failure = real bug: fix in the owning module (own failing test first), then re-run.
- [ ] **Step 3: Full suites** — `npm run test` AND `npm test -w web` — api green, web **exactly 436 unmodified**.
- [ ] **Step 4: Commit** — `git add api/test/selfserve-e2e.test.js && git commit -m "test(api): self-serve e2e — sign-in to member link without psql or super token" && git push origin main`

---

### Task 13: Live dev verification + env fix

**Files:** `.env` (local only, uncommitted) — remove the `PLATFORM_HOST=localhost:3000` line. Fix-forward commits only if bugs surface.

- [ ] **Step 1: DB guard** — `psql "$(grep '^DATABASE_URL=' .env | cut -d= -f2-)" -tc 'SELECT current_database()'` → MUST print `sweep_platform`; anything else: STOP.
- [ ] **Step 2: Migrate** — `npm run db:migrate -w api` — the three new tables land in the dev DB.
- [ ] **Step 3: Catalog live** — `npm run catalog:sync -w api` (2 live requests). Expected: `catalog apifootball: ~1235 leagues` + `catalog apibasketball: ~427 leagues`.
- [ ] **Step 4: Curate** — `npm run catalog:curate -w api -- apifootball 1`, then leagues `39 140 135 78 61`, then `apibasketball 12` (7 commands).
- [ ] **Step 5: Remove `PLATFORM_HOST=localhost:3000` from `.env`**, then start the api (`npm run dev:api` in background).
- [ ] **Step 6: Drive the §5 flow via curl** (no psql, no super token):
  - `curl -s -X POST localhost:3000/api/account/login -H 'content-type: application/json' -d '{"email":"you@example.com"}'` → `{ok:true}`; copy the token from the `[mail]` log line.
  - POST `/api/account/session` with it → save `accountToken`.
  - `GET /api/catalog?q=nba` with `x-account-token` → NBA row with season `2023-2024`.
  - POST `/api/account/sweeps` `{name:"NBA live proof", provider:"apibasketball", leagueId:"12", season:"2023-2024"}` → **reuses the existing dev NBA competition** (already provisioned in P2 — zero live competition calls) and returns links.
  - `GET /api/account/sweeps` → the sweep with links. Verify the member link serves `/api/fixtures` (Host header per the member-link host).
  - Verify the WC default sweep + P2 NBA sweep still serve their data untouched.
- [ ] **Step 7: Suites + build** — `npm run test`, `npm test -w web`, `npm run build`. Expected: green / 436 / build ok.
- [ ] **Step 8: Stop the server; report** — suite counts, curl transcript highlights, catalog row counts, request spend (should be ≤ 4 live calls total incl. the 2 catalog syncs), `git status` clean, push.

---

## Self-Review (done at write time)

- **Spec coverage:** schema §2 (T1), auth §3 (T5), catalog §4 (T2 mapLeague, T3 windows, T4 sync+curate CLIs, T6 route, T11 daily cron), provisioning §5 (T7 catalog-meta addCompetition, T10 routes incl. cap/archive/eventless-retry, football-league correctness T8), budget fixes §6 (T9 odds window, T11 roster cadence, T13 .env), error handling §7 (per-task guards, syncLog in T4), testing §8 (per-task + T12 e2e + T13 live). Out-of-scope §9 has no tasks — correct.
- **Placeholder scan:** clean — every code step is complete; T7's "rest unchanged" and T10's route bodies name exact existing code.
- **Type consistency:** `seasonInWindow(providerKey, season)` (T3) used in T6/T10; `syncCatalog(db, providerKey, provider)` (T4) used in T11; `setCurated(db, providerKey, leagueId, on)` (T4) used in T13 CLI; `requireAccount(app)` (T5) used in T6/T10; `addCompetition(..., {league})` (T7) used in T10; `links(app, row)` export (T10); mapLeague season shape `{season,start,end,current,standings,odds}` (T2) consumed by T4 upsert, T6 filter, T10 validation; `app.providerFor` (T10) used in T10/T12 tests.
- **Judgment calls (flagged):** T8 changes `mapStanding.rank` for ALL football (WC now stores real ranks — wire unread, safe); T9 re-keys one existing baseline assertion (approved behavior change); T12's football feed is inline-literal EPL-shaped JSON rather than fixture files (2 teams — small enough to read); seeded WC `format` value must be checked in T8 Step 4 (gate keys off `'league'` only).

---

## Post-implementation follow-ups (final whole-branch review, 2026-07-04)

Branch landed as `e5b4665..96a067f` (6 prereq/cleanup commits, 3 docs, 12
implementation tasks + live verification, 1 final-review fix). Final review
verdict: READY TO MERGE. Both Important findings resolved same-session:
magic-link consumption is now one atomic conditional UPDATE (`96a067f`), and
NBA `2024-2025` was verified live on the free tier (window is by START year —
correct as-is, documented in registry.js).

**First-deploy gate (before ANY production deploy):**
- Rate limits key on `req.ip` with no `trustProxy`; behind Caddy every client
  shares the proxy IP → the login limit becomes one global bucket. Set
  `trustProxy`/an `x-forwarded-for` keyGenerator at deploy time.
- Expired `login_token`/`account_session` rows are never cleaned — two
  `DELETE ... WHERE expires_at < now()` lines in the worker's `daily()`.
- (Inherited) `Makefile`/`infra/` deploy targets still point at WC prod.

**P4 hooks (fold into the subscription work on the same paths):**
- Provision failures surface as raw 500s with internal messages — map to a
  stable `{error: 'provision_failed'}`.
- Account deletion is blocked by the session FK (deletion stays YAGNI until
  billing).
- Cap check is TOCTOU: concurrent provisions can land cap+1 (self-abuse only;
  competition dedupe keeps feed impact ~nil).

**Ticket-grade (non-blocking):**
- Eventless-retry provision branch (competition exists, baseline died earlier)
  has no test — it is the real feed-hiccup recovery path.
- Concurrent FIRST provision of the same competition: loser gets an ungraceful
  500 ("competition already exists"); retry succeeds.
- catalog-sync: error branch untested; no txn around the upsert loop (partial
  catalog self-heals at the next daily run); the CLI aborts remaining
  providers on the first failure (the worker cron isolates per provider);
  `catalog:curate` treats an `--off` typo as "on".
- Catalog route: season sort-desc + null-country branches untested
  (hand-traced correct); `sportOf` would 500 the catalog if a provider key
  ever leaves FACTORIES while its rows remain — filter instead.
- Indexes on `account_session.account_id` / catalog lookups when volume warrants.
- Test hygiene: unscoped `accountSession`/`loginToken` wipes (safe under
  `fileParallelism: false`); odds-window exact-7-day boundary untested;
  FACTORIES lookup-throw triplicated in registry.js.

Accepted as designed: Task-10 validation-before-cap ordering (resolves the
plan's self-contradiction; no new disclosure — the catalog route already shows
the same data); provider `rank` now stored for all football (wire unread);
odds windowing changed WC baseline behavior (approved, tests re-keyed).
