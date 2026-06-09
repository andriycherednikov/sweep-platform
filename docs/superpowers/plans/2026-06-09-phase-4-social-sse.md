# Phase 4 — Social Layer + SSE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make watching/backing genuinely shared across all ~45 people, and make scores/minutes tick live on every client — via write endpoints, a Postgres-backed SSE fan-out, and optimistic frontend updates reconciled by SSE echo.

**Architecture:** The api and worker are **separate processes** that share one Postgres. SSE fan-out therefore rides on **Postgres `LISTEN/NOTIFY`** (channel `sweep_events`): any process publishes a tiny JSON event via `pg_notify`; the single api process holds a dedicated `LISTEN` client that rebroadcasts to an in-process event bus; `GET /api/stream` SSE connections subscribe to that bus. The api's own write routes publish straight to the local bus (instant, no round-trip — there is only one api process); the worker publishes via `pg_notify` (it has no SSE clients of its own). The web `social.js` becomes a server-backed store (identity stays in `localStorage`) hydrated by a TanStack Query `['social']` query; writes are optimistic with rollback, and a `useEventStream` hook invalidates the relevant query caches on each event so others' actions and live goals appear within ~1s.

**Tech Stack:** Node 22 (ESM) + Fastify 5 + Drizzle ORM + `pg` (Postgres `LISTEN/NOTIFY`, native `EventSource` on the client); Vitest + `@testcontainers/postgresql` (api), Vitest + jsdom + Testing Library (web); TanStack Query (already installed).

---

## File Structure

**New (api):**
- `api/src/events/bus.js` — in-process event bus (Node `EventEmitter` wrapper): `createBus()` → `{ publish, subscribe }`.
- `api/src/events/notify.js` — cross-process publish: `publish(db, event)` → `pg_notify('sweep_events', json)`; exports `CHANNEL`.
- `api/src/events/listen.js` — `startListener(pool, bus)`: dedicated `LISTEN` client → rebroadcasts NOTIFYs to the bus; returns an unsubscribe.
- `api/src/routes/stream.js` — `GET /api/stream` SSE endpoint subscribed to `app.bus`.
- `api/src/routes/social.js` — `GET /api/social` (read) + `POST /api/watch` + `POST /api/support` (writes).

**New (api tests):**
- `api/test/bus.test.js`, `api/test/notify-listen.test.js`, `api/test/stream.test.js`, `api/test/social.test.js`.

**Modified (api):**
- `api/src/app.js` — decorate `app.bus` + `app.publish`; register `streamRoutes` + `socialRoutes`.
- `api/src/server.js` — start the `LISTEN` listener against `app.bus` after boot.
- `api/src/worker/live-poller.js` — `pollLive` takes an optional `publish` and emits a `score` event per updated fixture.
- `api/src/worker.js` — pass `(e) => publish(db, e)` into `pollLive`; emit a `sync` event after a successful baseline.
- `api/test/live-poller.test.js` — assert `score` events are published.

**New (web):**
- `web/src/hooks/useEventStream.js` + `web/src/hooks/useEventStream.test.jsx`.

**Modified (web):**
- `web/src/api/client.js` — add `fetchSocial`, `postWatch`, `postSupport` (+ tests in `client.test.js`).
- `web/src/social.js` — server-backed store: `setSocialData`, optimistic `toggleWatch`/`setSupport` with rollback (+ rewrite `social.test.js`).
- `web/src/SweepProvider.jsx` — add a `['social']` query that hydrates `setSocialData`, and call `useEventStream()` (+ update `SweepProvider.test.jsx`).

**Event contract (the wire shape both ends agree on):**
```
{ type: 'watch',   fixtureId }                                  // someone watched/unwatched
{ type: 'support', fixtureId }                                  // someone changed backing
{ type: 'score',   fixtureId, status, score:[n,n], minute }     // live tick
{ type: 'sync' }                                               // fresh baseline landed
```
Clients treat `watch`/`support` → invalidate `['social']`; `score`/`sync` → invalidate `['sweep']`. The payload's extra fields are advisory; invalidation refetches authoritative state.

---

## Chunk A — API: events, endpoints, worker (Tasks 1–8)

### Task 1: In-process event bus

**Files:**
- Create: `api/src/events/bus.js`
- Test: `api/test/bus.test.js`

- [ ] **Step 1: Write the failing test**

```js
// api/test/bus.test.js
import { expect, test } from 'vitest'
import { createBus } from '../src/events/bus.js'

test('subscribers receive published events; unsubscribe stops delivery', () => {
  const bus = createBus()
  const seen = []
  const unsub = bus.subscribe((e) => seen.push(e))
  bus.publish({ type: 'watch', fixtureId: '1' })
  bus.publish({ type: 'score', fixtureId: '2' })
  unsub()
  bus.publish({ type: 'watch', fixtureId: '3' })
  expect(seen).toEqual([{ type: 'watch', fixtureId: '1' }, { type: 'score', fixtureId: '2' }])
})

test('multiple subscribers all receive the same event', () => {
  const bus = createBus()
  const a = [], b = []
  bus.subscribe((e) => a.push(e))
  bus.subscribe((e) => b.push(e))
  bus.publish({ type: 'sync' })
  expect(a).toEqual([{ type: 'sync' }])
  expect(b).toEqual([{ type: 'sync' }])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w api -- bus`
Expected: FAIL — cannot find module `../src/events/bus.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// api/src/events/bus.js
import { EventEmitter } from 'node:events'

/** A tiny fan-out bus. SSE connections subscribe; routes/listener publish. */
export function createBus() {
  const ee = new EventEmitter()
  ee.setMaxListeners(0) // one listener per open SSE connection; no artificial cap
  return {
    publish: (event) => ee.emit('event', event),
    subscribe: (fn) => { ee.on('event', fn); return () => ee.off('event', fn) },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w api -- bus`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add api/src/events/bus.js api/test/bus.test.js
git commit -m "feat(api): in-process event bus for SSE fan-out"
```

---

### Task 2: Cross-process publish + LISTEN listener (Postgres NOTIFY)

**Files:**
- Create: `api/src/events/notify.js`, `api/src/events/listen.js`
- Test: `api/test/notify-listen.test.js`

- [ ] **Step 1: Write the failing test**

```js
// api/test/notify-listen.test.js
import { expect, test, afterAll } from 'vitest'
import { createPool, createDb } from '../src/db/client.js'
import { createBus } from '../src/events/bus.js'
import { publish } from '../src/events/notify.js'
import { startListener } from '../src/events/listen.js'

const pool = createPool(process.env.DATABASE_URL)
const db = createDb(pool)
let stop
afterAll(async () => { if (stop) await stop(); await pool.end() })

test('a published event arrives on the bus via Postgres NOTIFY', async () => {
  const bus = createBus()
  const got = new Promise((resolve) => bus.subscribe(resolve))
  stop = await startListener(pool, bus)
  await publish(db, { type: 'score', fixtureId: '9002', status: 'live', score: [1, 0], minute: 63 })
  expect(await got).toEqual({ type: 'score', fixtureId: '9002', status: 'live', score: [1, 0], minute: 63 })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w api -- notify-listen`
Expected: FAIL — cannot find module `../src/events/notify.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// api/src/events/notify.js
import { sql } from 'drizzle-orm'

export const CHANNEL = 'sweep_events'

/** Publish an event to every process LISTENing (payload must be < 8000 bytes; ours are tiny). */
export async function publish(db, event) {
  await db.execute(sql`select pg_notify(${CHANNEL}, ${JSON.stringify(event)})`)
}
```

```js
// api/src/events/listen.js
import { CHANNEL } from './notify.js'

/**
 * Hold a dedicated pg client LISTENing on the events channel and rebroadcast
 * each NOTIFY payload onto the in-process bus. Returns an async unsubscribe.
 */
export async function startListener(pool, bus) {
  const client = await pool.connect()
  client.on('notification', (msg) => {
    if (msg.channel !== CHANNEL) return
    try { bus.publish(JSON.parse(msg.payload)) } catch { /* ignore malformed */ }
  })
  await client.query(`LISTEN ${CHANNEL}`)
  return async () => { client.removeAllListeners('notification'); client.release() }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w api -- notify-listen`
Expected: PASS. (Requires Docker — Testcontainers Postgres.)

- [ ] **Step 5: Commit**

```bash
git add api/src/events/notify.js api/src/events/listen.js api/test/notify-listen.test.js
git commit -m "feat(api): pg_notify publish + LISTEN listener bridging to the bus"
```

---

### Task 3: `GET /api/stream` SSE route

**Files:**
- Create: `api/src/routes/stream.js`
- Modify: `api/src/app.js` (decorate `app.bus`; register `streamRoutes`)
- Test: `api/test/stream.test.js`

- [ ] **Step 1: Write the failing test**

```js
// api/test/stream.test.js
import { expect, test, afterAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'

const { pool, db } = openTestDb()
const app = buildApp(db)
let base
afterAll(async () => { await app.close(); await pool.end() })

test('GET /api/stream emits SSE frames for events published to the bus', async () => {
  await app.listen({ port: 0, host: '127.0.0.1' })
  const { port } = app.server.address()
  base = `http://127.0.0.1:${port}`

  const res = await fetch(`${base}/api/stream`)
  expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)
  const reader = res.body.getReader()

  // first read drains the initial retry hint; publish then read the event frame
  await reader.read()
  app.bus.publish({ type: 'watch', fixtureId: 'm1' })

  let buf = ''
  while (!buf.includes('"fixtureId":"m1"')) {
    const { value } = await reader.read()
    buf += new TextDecoder().decode(value)
  }
  expect(buf).toContain('data: {"type":"watch","fixtureId":"m1"}')
  await reader.cancel()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w api -- stream`
Expected: FAIL — `app.bus` is undefined / route 404.

- [ ] **Step 3: Write minimal implementation**

```js
// api/src/routes/stream.js
export async function streamRoutes(app) {
  app.get('/api/stream', (req, reply) => {
    reply.hijack() // Fastify hands us the raw socket; we own the response
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable proxy buffering (Caddy/nginx) so frames flush
    })
    reply.raw.write('retry: 3000\n\n') // client reconnect backoff hint

    const send = (event) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    const unsub = app.bus.subscribe(send)
    const hb = setInterval(() => reply.raw.write(': hb\n\n'), 25_000) // keep-alive comment

    req.raw.on('close', () => { clearInterval(hb); unsub() })
  })
}
```

Then wire it into `api/src/app.js`. Modify the imports and `buildApp`:

```js
// api/src/app.js — add imports near the others
import { streamRoutes } from './routes/stream.js'
import { createBus } from './events/bus.js'
```

```js
// inside buildApp, after `app.decorate('db', db)`:
  app.decorate('bus', opts.bus ?? createBus())
```

```js
// inside buildApp, alongside the other app.register(...) calls:
  app.register(streamRoutes)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w api -- stream`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/stream.js api/src/app.js api/test/stream.test.js
git commit -m "feat(api): GET /api/stream SSE endpoint over the event bus"
```

---

### Task 4: `GET /api/social` read endpoint

**Files:**
- Create: `api/src/routes/social.js`
- Modify: `api/src/app.js` (register `socialRoutes`)
- Test: `api/test/social.test.js`

The `GET /api/social` shape **deliberately matches** the existing `social.js` localStorage shapes
(`watch = { fixtureId: [personId, …] }`, `support = { fixtureId: { personId: teamCode } }`) so the web store barely changes.

- [ ] **Step 1: Write the failing test**

```js
// api/test/social.test.js
import { expect, test, afterAll, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { watch, support, person, team, fixture } from '../src/db/schema.js'

const { pool, db } = openTestDb()
const published = []
const app = buildApp(db, { publish: (e) => published.push(e) })
afterAll(async () => { await app.close(); await pool.end() })

// A known fixture + two people the seed already provides; assert they exist, else skip-safe pick.
beforeEach(async () => {
  await db.delete(watch); await db.delete(support); published.length = 0
})

async function aFixture() {
  const [f] = await db.select().from(fixture).limit(1)
  return f
}
async function twoPeople() {
  const ps = await db.select().from(person).limit(2)
  return ps
}

test('GET /api/social returns empty maps when nobody has acted', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/social' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ watch: {}, support: {} })
})

test('GET /api/social groups watchers by fixture and support by fixture→person→team', async () => {
  const f = await aFixture()
  const [p1, p2] = await twoPeople()
  await db.insert(watch).values([{ fixtureId: f.id, personId: p1.id }, { fixtureId: f.id, personId: p2.id }])
  await db.insert(support).values({ fixtureId: f.id, personId: p1.id, teamCode: f.t1Code })
  const body = (await app.inject({ method: 'GET', url: '/api/social' })).json()
  expect(new Set(body.watch[f.id])).toEqual(new Set([p1.id, p2.id]))
  expect(body.support[f.id][p1.id]).toBe(f.t1Code)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w api -- test/social`
Expected: FAIL — route 404 / `socialRoutes` missing.

- [ ] **Step 3: Write minimal implementation**

```js
// api/src/routes/social.js
import { and, eq } from 'drizzle-orm'
import { fixture, person, watch, support } from '../db/schema.js'

const watchBody = {
  type: 'object', required: ['fixtureId', 'personId'], additionalProperties: false,
  properties: { fixtureId: { type: 'string' }, personId: { type: 'string' } },
}
const supportBody = {
  type: 'object', required: ['fixtureId', 'personId', 'teamCode'], additionalProperties: false,
  properties: { fixtureId: { type: 'string' }, personId: { type: 'string' }, teamCode: { type: 'string' } },
}

export async function socialRoutes(app) {
  app.get('/api/social', async () => {
    const [ws, ss] = await Promise.all([
      app.db.select().from(watch),
      app.db.select().from(support),
    ])
    const watch_ = {}
    for (const w of ws) (watch_[w.fixtureId] ??= []).push(w.personId)
    const support_ = {}
    for (const s of ss) (support_[s.fixtureId] ??= {})[s.personId] = s.teamCode
    return { watch: watch_, support: support_ }
  })

  // POST /api/watch and /api/support are added in Tasks 5 & 6 (same file).
}
```

Wire into `api/src/app.js`:

```js
// add import near the others
import { socialRoutes } from './routes/social.js'
```

```js
// inside buildApp, alongside the other app.register(...) calls:
  app.register(socialRoutes)
```

Also add the `publish` decoration now (used by Tasks 5–6 and asserted by this file's harness). Inside `buildApp`, after the `app.bus` decoration:

```js
  app.decorate('publish', opts.publish ?? ((event) => app.bus.publish(event)))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w api -- test/social`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/social.js api/src/app.js api/test/social.test.js
git commit -m "feat(api): GET /api/social — watchers/backers grouped for the client"
```

---

### Task 5: `POST /api/watch` (toggle + publish)

**Files:**
- Modify: `api/src/routes/social.js`
- Test: `api/test/social.test.js` (append)

- [ ] **Step 1: Write the failing test (append to `api/test/social.test.js`)**

```js
test('POST /api/watch toggles the row and publishes a watch event', async () => {
  const f = await aFixture()
  const [p1] = await twoPeople()

  const on = await app.inject({ method: 'POST', url: '/api/watch', payload: { fixtureId: f.id, personId: p1.id } })
  expect(on.json()).toMatchObject({ fixtureId: f.id, personId: p1.id, watching: true })

  const off = await app.inject({ method: 'POST', url: '/api/watch', payload: { fixtureId: f.id, personId: p1.id } })
  expect(off.json().watching).toBe(false)

  expect(published).toEqual([{ type: 'watch', fixtureId: f.id }, { type: 'watch', fixtureId: f.id }])
})

test('POST /api/watch 400s on unknown fixture or person', async () => {
  const f = await aFixture()
  const [p1] = await twoPeople()
  expect((await app.inject({ method: 'POST', url: '/api/watch', payload: { fixtureId: 'nope', personId: p1.id } })).statusCode).toBe(400)
  expect((await app.inject({ method: 'POST', url: '/api/watch', payload: { fixtureId: f.id, personId: 'nope' } })).statusCode).toBe(400)
})

test('POST /api/watch 400s on a malformed body (schema)', async () => {
  expect((await app.inject({ method: 'POST', url: '/api/watch', payload: { fixtureId: 'x' } })).statusCode).toBe(400)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w api -- test/social`
Expected: FAIL — `/api/watch` 404.

- [ ] **Step 3: Write minimal implementation (add inside `socialRoutes`, after the GET)**

```js
  app.post('/api/watch', { schema: { body: watchBody } }, async (req, reply) => {
    const { fixtureId, personId } = req.body
    const [f] = await app.db.select().from(fixture).where(eq(fixture.id, fixtureId))
    if (!f) return reply.code(400).send({ error: 'unknown_fixture' })
    const [p] = await app.db.select().from(person).where(eq(person.id, personId))
    if (!p) return reply.code(400).send({ error: 'unknown_person' })

    const where = and(eq(watch.fixtureId, fixtureId), eq(watch.personId, personId))
    const existing = await app.db.select().from(watch).where(where)
    let watching
    if (existing.length) { await app.db.delete(watch).where(where); watching = false }
    else { await app.db.insert(watch).values({ fixtureId, personId }); watching = true }

    await app.publish({ type: 'watch', fixtureId })
    return { fixtureId, personId, watching }
  })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w api -- test/social`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/social.js api/test/social.test.js
git commit -m "feat(api): POST /api/watch — toggle watching + publish event"
```

---

### Task 6: `POST /api/support` (set/toggle + validate team + publish)

**Files:**
- Modify: `api/src/routes/social.js`
- Test: `api/test/social.test.js` (append)

- [ ] **Step 1: Write the failing test (append)**

```js
test('POST /api/support sets, switches, and toggles-off backing; publishes each time', async () => {
  const f = await aFixture()
  const [p1] = await twoPeople()

  const set = await app.inject({ method: 'POST', url: '/api/support', payload: { fixtureId: f.id, personId: p1.id, teamCode: f.t1Code } })
  expect(set.json()).toMatchObject({ fixtureId: f.id, personId: p1.id, supporting: f.t1Code })

  const switched = await app.inject({ method: 'POST', url: '/api/support', payload: { fixtureId: f.id, personId: p1.id, teamCode: f.t2Code } })
  expect(switched.json().supporting).toBe(f.t2Code)

  const off = await app.inject({ method: 'POST', url: '/api/support', payload: { fixtureId: f.id, personId: p1.id, teamCode: f.t2Code } })
  expect(off.json().supporting).toBe(null)

  expect(published.filter((e) => e.type === 'support')).toHaveLength(3)
})

test('POST /api/support 400s when teamCode is not one of the fixture teams', async () => {
  const f = await aFixture()
  const [p1] = await twoPeople()
  const bad = await app.inject({ method: 'POST', url: '/api/support', payload: { fixtureId: f.id, personId: p1.id, teamCode: 'zz' } })
  expect(bad.statusCode).toBe(400)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w api -- test/social`
Expected: FAIL — `/api/support` 404.

- [ ] **Step 3: Write minimal implementation (add inside `socialRoutes`, after the watch POST)**

```js
  app.post('/api/support', { schema: { body: supportBody } }, async (req, reply) => {
    const { fixtureId, personId, teamCode } = req.body
    const [f] = await app.db.select().from(fixture).where(eq(fixture.id, fixtureId))
    if (!f) return reply.code(400).send({ error: 'unknown_fixture' })
    const [p] = await app.db.select().from(person).where(eq(person.id, personId))
    if (!p) return reply.code(400).send({ error: 'unknown_person' })
    if (teamCode !== f.t1Code && teamCode !== f.t2Code) return reply.code(400).send({ error: 'invalid_team' })

    const where = and(eq(support.fixtureId, fixtureId), eq(support.personId, personId))
    const [existing] = await app.db.select().from(support).where(where)
    let supporting
    if (existing && existing.teamCode === teamCode) {
      await app.db.delete(support).where(where); supporting = null
    } else if (existing) {
      await app.db.update(support).set({ teamCode }).where(where); supporting = teamCode
    } else {
      await app.db.insert(support).values({ fixtureId, personId, teamCode }); supporting = teamCode
    }

    await app.publish({ type: 'support', fixtureId })
    return { fixtureId, personId, supporting }
  })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w api -- test/social`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/social.js api/test/social.test.js
git commit -m "feat(api): POST /api/support — set/switch/toggle backing + publish"
```

---

### Task 7: Start the LISTEN listener in the api server

**Files:**
- Modify: `api/src/server.js`

This is process wiring (matches the existing un-unit-tested `server.js`/`worker.js` startup pattern); verified by `npm run dev:api` + a live curl in the Chunk-A verification step.

- [ ] **Step 1: Read the current server entrypoint**

Run: `cat api/src/server.js`
Expected: it calls `createPool`/`createDb`, `buildApp(db)`, and `app.listen(...)`.

- [ ] **Step 2: Wire the listener after the app is built**

Add the import:
```js
import { startListener } from './events/listen.js'
```

After `buildApp(db)` returns `app` and before/after `app.listen(...)`, start the listener against the **same pool** the app uses, passing `app.bus`:
```js
await startListener(pool, app.bus)
```
(Place it after the pool is created and `app` exists. The listener holds one dedicated pooled client for the process lifetime — fine for a single long-lived api.)

- [ ] **Step 3: Smoke-run the api**

Run: `npm run dev:api` (separate terminal), then:
```bash
curl -N http://localhost:3000/api/stream &
curl -s -X POST http://localhost:3000/api/watch -H 'content-type: application/json' \
  -d "{\"fixtureId\":\"<a real fixture id>\",\"personId\":\"<a real person id>\"}"
```
Expected: the `-N` stream prints `data: {"type":"watch","fixtureId":"…"}` within ~1s. (Real ids: `curl -s localhost:3000/api/fixtures | head` and `curl -s localhost:3000/api/bootstrap`.)

- [ ] **Step 4: Stop the dev server.**

- [ ] **Step 5: Commit**

```bash
git add api/src/server.js
git commit -m "feat(api): start Postgres LISTEN listener so worker events reach SSE"
```

---

### Task 8: Worker live-poller publishes `score` events (+ `sync` on baseline)

**Files:**
- Modify: `api/src/worker/live-poller.js`, `api/src/worker.js`
- Test: `api/test/live-poller.test.js`

- [ ] **Step 1: Write the failing test (append to `api/test/live-poller.test.js`)**

```js
test('pollLive publishes a score event for each updated fixture', async () => {
  const liveProvider = createRecordedProvider({ live: load('fixtures-live') }) // fixture 9002 → 2H 63' 1-0
  const events = []
  await pollLive(db, liveProvider, (e) => events.push(e))
  expect(events).toContainEqual({ type: 'score', fixtureId: '9002', status: 'live', score: [1, 0], minute: 63 })
})
```

Note: this test re-applies the same live update as the existing `pollLive` test; both run against the
seeded recorded fixtures in this file's `beforeAll`. Updating an already-live fixture still returns the row,
so a `score` event is still published — the assertion holds regardless of test order.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w api -- live-poller`
Expected: FAIL — `pollLive` ignores the third arg; `events` stays empty.

- [ ] **Step 3: Modify `pollLive` to accept and call `publish`**

In `api/src/worker/live-poller.js`, change the signature and emit an event after each successful update:

```js
export async function pollLive(db, provider, publish = () => {}) {
  try {
    const live = await provider.fetchLive()
    let updated = 0
    for (const f of live) {
      const res = await db.update(fixture)
        .set({ status: f.status, score1: f.score1, score2: f.score2, minute: f.minute, updatedAt: new Date() })
        .where(eq(fixture.id, f.id))
        .returning({ id: fixture.id })
      if (res.length) {
        updated += res.length
        publish({ type: 'score', fixtureId: f.id, status: f.status, score: [f.score1, f.score2], minute: f.minute })
      }
    }
    await db.insert(syncLog).values({ source: 'api-football', kind: 'live', status: 'ok', counts: { live: live.length, updated } })
    return updated
  } catch (err) {
    await db.insert(syncLog).values({ source: 'api-football', kind: 'live', status: 'error', error: String(err?.message ?? err) })
    throw err
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w api -- live-poller`
Expected: PASS (all 3 tests in the file).

- [ ] **Step 5: Wire the worker to publish (process glue)**

In `api/src/worker.js`, import the cross-process publisher and pass it through; emit `sync` after a good baseline:

```js
// add import near the others
import { publish } from './events/notify.js'
```

In `baseline(reason)`, after a successful `syncBaseline`, emit a sync event:
```js
async function baseline(reason) {
  try {
    const r = await syncBaseline(db, provider, { season })
    await publish(db, { type: 'sync' })
    console.log(`[baseline:${reason}] ${r.fixtures} fixtures`)
  } catch (e) { console.error(`[baseline:${reason}] failed (last-good intact):`, e.message) }
}
```

In the live `setInterval`, pass the publisher into `pollLive`:
```js
    const n = await pollLive(db, provider, (e) => publish(db, e))
```

- [ ] **Step 6: Run the full api suite**

Run: `npm run test -w api`
Expected: PASS (all files; new `bus`, `notify-listen`, `stream`, `social` files included).

- [ ] **Step 7: Commit**

```bash
git add api/src/worker/live-poller.js api/src/worker.js api/test/live-poller.test.js
git commit -m "feat(worker): publish score events on live tick + sync on baseline"
```

---

### Chunk A verification (lead re-verify before accepting)

- [ ] Run `npm run test -w api` → all green; capture the summary line.
- [ ] `npm run dev:api`, then in another shell: open `curl -N localhost:3000/api/stream`, POST a real `/api/watch`, confirm the frame appears; `GET /api/social` reflects the toggle. Stop the server.

---

## Chunk B — Web: client, store, hook, provider (Tasks 9–12)

> Depends only on the **event contract** and endpoint shapes from Chunk A (now fixed). Once Task 9 lands the contract in `client.js`, Tasks 10–11 can proceed in parallel; Task 12 wires them together.

### Task 9: API client — social read + write helpers

**Files:**
- Modify: `web/src/api/client.js`
- Test: `web/src/api/client.test.js` (append)

- [ ] **Step 1: Write the failing test (append to `web/src/api/client.test.js`)**

```js
test('fetchSocial hits /api/social', async () => {
  mockJson({ '/api/social': { watch: { m1: ['p1'] }, support: {} } })
  const { fetchSocial } = await import('./client.js')
  expect(await fetchSocial()).toEqual({ watch: { m1: ['p1'] }, support: {} })
})

test('postWatch POSTs fixtureId+personId and returns the new state', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    calls.push({ url, opts })
    return { ok: true, status: 200, json: async () => ({ fixtureId: 'm1', personId: 'p1', watching: true }) }
  }))
  const { postWatch } = await import('./client.js')
  const res = await postWatch('m1', 'p1')
  expect(res.watching).toBe(true)
  expect(calls[0].url).toMatch(/\/api\/watch$/)
  expect(calls[0].opts.method).toBe('POST')
  expect(JSON.parse(calls[0].opts.body)).toEqual({ fixtureId: 'm1', personId: 'p1' })
})

test('postSupport POSTs fixtureId+personId+teamCode', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    calls.push({ url, opts })
    return { ok: true, status: 200, json: async () => ({ supporting: 'hr' }) }
  }))
  const { postSupport } = await import('./client.js')
  await postSupport('m1', 'p1', 'hr')
  expect(JSON.parse(calls[0].opts.body)).toEqual({ fixtureId: 'm1', personId: 'p1', teamCode: 'hr' })
})

test('a non-ok POST throws', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({}) })))
  const { postWatch } = await import('./client.js')
  await expect(postWatch('m1', 'p1')).rejects.toThrow(/watch/i)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w web -- client`
Expected: FAIL — `fetchSocial`/`postWatch`/`postSupport` are not exported.

- [ ] **Step 3: Write minimal implementation (append to `web/src/api/client.js`)**

```js
async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${path} failed: HTTP ${res.status}`)
  return res.json()
}

export const fetchSocial = () => get('/api/social')
export const postWatch = (fixtureId, personId) => post('/api/watch', { fixtureId, personId })
export const postSupport = (fixtureId, personId, teamCode) => post('/api/support', { fixtureId, personId, teamCode })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w web -- client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/api/client.js web/src/api/client.test.js
git commit -m "feat(web): API client helpers for /api/social + watch/support writes"
```

---

### Task 10: `social.js` — server-backed store with optimistic writes + rollback

**Files:**
- Modify: `web/src/social.js`
- Test: `web/src/social.test.js` (rewrite)

Identity (`me`) stays in `localStorage`. `watchers`/`support` are no longer persisted to `localStorage`;
they are hydrated from the server via `setSocialData(...)` (called by the provider's `['social']` query, Task 12)
and kept live by SSE. Writes mutate the local store optimistically, POST to the server, and roll back on error.

- [ ] **Step 1: Write the failing tests (replace the body of `web/src/social.test.js`)**

```js
import { expect, test, beforeEach, vi } from 'vitest'
import { SWEEP, setSweepData } from './data.js'
import { assembleSweep } from './lib/assemble.js'

vi.mock('./api/client.js', () => ({
  postWatch: vi.fn(async () => ({ watching: true })),
  postSupport: vi.fn(async () => ({ supporting: 'hr' })),
}))
import { postWatch, postSupport } from './api/client.js'
import {
  getMe, setMe, watchersOf, toggleWatch, isWatching,
  setSocialData, supportOf, mySupport, setSupport,
} from './social.js'

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [{ code: 'hr', name: 'Croatia', group: 'A', pool: 'P', color: '#c00', strength: 80 }],
      people: [{ id: 'p1', name: 'Andriy', short: 'Andriy', initials: 'A', av: '#000', avatarPath: null }],
      ownership: {}, scoring: null,
    },
    fixtures: [], standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ watch: {}, support: {} })
})

test('setSocialData hydrates watchers from the server shape', () => {
  setSocialData({ watch: { m1: ['p1'] }, support: {} })
  expect(watchersOf('m1').map((p) => p.id)).toEqual(['p1'])
})

test('toggleWatch optimistically flips state and POSTs to the server', () => {
  setMe('p1')
  expect(isWatching('m1')).toBe(false)
  const ok = toggleWatch('m1')
  expect(ok).toBe(true)
  expect(isWatching('m1')).toBe(true) // optimistic, synchronous
  expect(postWatch).toHaveBeenCalledWith('m1', 'p1')
})

test('toggleWatch rolls back when the server write fails', async () => {
  postWatch.mockRejectedValueOnce(new Error('HTTP 400'))
  setMe('p1')
  toggleWatch('m1')
  expect(isWatching('m1')).toBe(true)        // optimistic on
  await Promise.resolve(); await Promise.resolve() // let the rejected promise settle
  expect(isWatching('m1')).toBe(false)       // rolled back
})

test('setSupport optimistically sets backing and POSTs', () => {
  setMe('p1')
  setSupport('m1', 'hr')
  expect(mySupport('m1')).toBe('hr')
  expect(postSupport).toHaveBeenCalledWith('m1', 'p1', 'hr')
})

test('writes require identity — no me means no POST', () => {
  // window.__sweepPickMe would normally open the identity sheet; stub it
  window.__sweepPickMe = vi.fn()
  expect(toggleWatch('m1')).toBe(false)
  expect(postWatch).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w web -- social`
Expected: FAIL — `setSocialData` not exported; writes don't call the client.

- [ ] **Step 3: Rewrite `web/src/social.js`**

Replace the file with the server-backed version (identity unchanged; `watchers`/`support` hydrated, not persisted):

```js
/* ============================================================
   THE SWEEP — social store: identity (localStorage) +
   watching/support (server-backed, hydrated via setSocialData,
   optimistic writes reconciled by SSE).
   ============================================================ */
import { useState, useEffect } from "react";
import { SWEEP as S } from "./data.js";
import { postWatch, postSupport } from "./api/client.js";

const ME_KEY = "sweep.me.v1";
const socialListeners = new Set();
let globalToast = null;
export function setGlobalToast(fn){ globalToast = fn; }
export function toast(msg){ if (globalToast) globalToast(msg); }
function notifySocial(){ socialListeners.forEach(fn=>fn()); }

/* identity — nobody is auto-selected; "none" = explicitly cleared */
let _meRaw = localStorage.getItem(ME_KEY);
let meId = (_meRaw === null) ? null : (_meRaw === "none" ? null : _meRaw);
export function getMe(){ return meId ? S.people.find(p=>p.id===meId) : null; }
export function setMe(id){ meId = id; try { localStorage.setItem(ME_KEY, id || "none"); } catch(e){} notifySocial(); }

/* server-backed state, hydrated by the ['social'] query + kept live by SSE */
let watchers = {};          // { fixtureId: [personId] }
let support = {};           // { fixtureId: { personId: teamCode } }
export function setSocialData(server){
  watchers = (server && server.watch) ? server.watch : {};
  support  = (server && server.support) ? server.support : {};
  notifySocial();
}

export function watchersOf(mid){ return (watchers[mid]||[]).map(id=>S.people.find(p=>p.id===id)).filter(Boolean); }
export function isWatching(mid){ return !!(meId && (watchers[mid]||[]).indexOf(meId) >= 0); }
export function myWatching(){ if (!meId) return []; return Object.keys(watchers).filter(mid=>watchers[mid].indexOf(meId)>=0); }

export function toggleWatch(mid){
  if (!meId){ if (window.__sweepPickMe) window.__sweepPickMe(); return false; }
  const prev = watchers;
  const arr = watchers[mid] ? watchers[mid].slice() : [];
  const i = arr.indexOf(meId);
  if (i>=0) arr.splice(i,1); else arr.push(meId);
  watchers = Object.assign({}, watchers, { [mid]: arr });
  notifySocial();
  postWatch(mid, meId).catch(()=>{ watchers = prev; notifySocial(); toast("Couldn't update — try again"); });
  return true;
}

export function supportOf(mid){
  const m = support[mid] || {}, out = {};
  Object.keys(m).forEach(pid=>{ const p=S.people.find(x=>x.id===pid); if(p){ (out[m[pid]]=out[m[pid]]||[]).push(p); } });
  return out;
}
export function mySupport(mid){ return meId ? ((support[mid]||{})[meId] || null) : null; }
export function setSupport(mid, code){
  if (!meId){ if (window.__sweepPickMe) window.__sweepPickMe(); return; }
  const prev = support;
  const m = Object.assign({}, support[mid] || {});
  if (m[meId] === code) delete m[meId]; else m[meId] = code;
  support = Object.assign({}, support, { [mid]: m });
  notifySocial();
  postSupport(mid, meId, code).catch(()=>{ support = prev; notifySocial(); toast("Couldn't update — try again"); });
}

export function useSocial(){
  const [,force] = useState(0);
  useEffect(()=>{ const fn=()=>force(x=>x+1); socialListeners.add(fn); return ()=>socialListeners.delete(fn); },[]);
  return { me: getMe() };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w web -- social`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/social.js web/src/social.test.js
git commit -m "feat(web): social.js server-backed store with optimistic writes + rollback"
```

---

### Task 11: `useEventStream` hook — invalidate caches on SSE events

**Files:**
- Create: `web/src/hooks/useEventStream.js`
- Test: `web/src/hooks/useEventStream.test.jsx`

jsdom has no `EventSource`; the test installs a controllable fake on `global`.

- [ ] **Step 1: Write the failing test**

```jsx
// web/src/hooks/useEventStream.test.jsx
import { expect, test, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEventStream } from './useEventStream.js'

let instances
class FakeES {
  constructor(url){ this.url = url; this.onmessage = null; this.onopen = null; this.closed = false; instances.push(this) }
  emit(obj){ this.onmessage && this.onmessage({ data: JSON.stringify(obj) }) }
  open(){ this.onopen && this.onopen() }
  close(){ this.closed = true }
}

beforeEach(() => { instances = []; vi.stubGlobal('EventSource', FakeES) })

function setup() {
  const qc = new QueryClient()
  const spy = vi.spyOn(qc, 'invalidateQueries')
  const wrapper = ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  renderHook(() => useEventStream(), { wrapper })
  return { qc, spy, es: instances[0] }
}

test('subscribes to /api/stream on mount', () => {
  const { es } = setup()
  expect(es.url).toBe('/api/stream')
})

test('watch/support events invalidate the social query', () => {
  const { spy, es } = setup()
  es.emit({ type: 'watch', fixtureId: 'm1' })
  es.emit({ type: 'support', fixtureId: 'm1' })
  expect(spy).toHaveBeenCalledWith({ queryKey: ['social'] })
  expect(spy.mock.calls.filter((c) => c[0]?.queryKey?.[0] === 'social')).toHaveLength(2)
})

test('score/sync events invalidate the sweep query', () => {
  const { spy, es } = setup()
  es.emit({ type: 'score', fixtureId: 'm1', status: 'live', score: [1, 0], minute: 63 })
  es.emit({ type: 'sync' })
  expect(spy.mock.calls.filter((c) => c[0]?.queryKey?.[0] === 'sweep')).toHaveLength(2)
})

test('on (re)open it catches up by invalidating both queries', () => {
  const { spy, es } = setup()
  es.open()
  expect(spy).toHaveBeenCalledWith({ queryKey: ['sweep'] })
  expect(spy).toHaveBeenCalledWith({ queryKey: ['social'] })
})

test('closes the stream on unmount', () => {
  const qc = new QueryClient()
  const wrapper = ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  const { unmount } = renderHook(() => useEventStream(), { wrapper })
  unmount()
  expect(instances[0].closed).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w web -- useEventStream`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// web/src/hooks/useEventStream.js
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

/**
 * Subscribe once to GET /api/stream. Each event invalidates the relevant
 * TanStack Query cache so others' actions and live goals appear within ~1s.
 * Native EventSource auto-reconnects (server sends `retry:`); on (re)open we
 * invalidate both queries to catch up on anything missed while disconnected.
 */
export function useEventStream() {
  const qc = useQueryClient()
  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    const es = new EventSource('/api/stream')
    es.onopen = () => {
      qc.invalidateQueries({ queryKey: ['sweep'] })
      qc.invalidateQueries({ queryKey: ['social'] })
    }
    es.onmessage = (e) => {
      let ev
      try { ev = JSON.parse(e.data) } catch { return }
      if (ev.type === 'watch' || ev.type === 'support') qc.invalidateQueries({ queryKey: ['social'] })
      else if (ev.type === 'score' || ev.type === 'sync') qc.invalidateQueries({ queryKey: ['sweep'] })
    }
    return () => es.close()
  }, [qc])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w web -- useEventStream`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/useEventStream.js web/src/hooks/useEventStream.test.jsx
git commit -m "feat(web): useEventStream — invalidate query caches on SSE events"
```

---

### Task 12: Wire the provider — hydrate `['social']` + subscribe to the stream

**Files:**
- Modify: `web/src/SweepProvider.jsx`
- Test: `web/src/SweepProvider.test.jsx` (update)

- [ ] **Step 1: Update the failing test (`web/src/SweepProvider.test.jsx`)**

First read it (`cat web/src/SweepProvider.test.jsx`) to keep its existing happy-path assertions. Then ensure it
stubs `EventSource` (jsdom lacks it) and mocks the new social fetch so the provider mounts. Add at the top of the
file (after imports), and keep the existing render assertions:

```jsx
import { vi } from 'vitest'

class FakeES { constructor(){ this.onmessage = null; this.onopen = null } close(){} }
vi.stubGlobal('EventSource', FakeES)
```

If the existing test stubs `fetch`/`fetchAll`, extend that stub so `/api/social` resolves to
`{ watch: {}, support: {} }` (mirror however the file currently mocks the data layer). The provider must render
its children without throwing once both queries resolve.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w web -- SweepProvider`
Expected: FAIL — provider doesn't hydrate social / `useEventStream` not called (or `EventSource` undefined).

- [ ] **Step 3: Wire `web/src/SweepProvider.jsx`**

Add imports:
```jsx
import { fetchAll, fetchSocial } from './api/client.js'
import { setSweepData } from './data.js'
import { setSocialData } from './social.js'
import { assembleSweep } from './lib/assemble.js'
import { useEventStream } from './hooks/useEventStream.js'
```

Inside `Gate`, **before** the existing early returns (hooks must run unconditionally), add the social query and
the stream subscription. The `['social']` query hydrates the store; its loading state is intentionally not gated
on (watchers/backers simply render empty until it resolves):

```jsx
function Gate({ children }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['sweep'],
    queryFn: async () => {
      const api = await fetchAll()
      setSweepData(assembleSweep(api))
      return api.syncStatus
    },
  })

  useQuery({
    queryKey: ['social'],
    queryFn: async () => {
      const social = await fetchSocial()
      setSocialData(social)
      return social
    },
  })

  useEventStream()

  // …existing isLoading / isError / stale-banner returns unchanged…
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w web -- SweepProvider`
Expected: PASS.

- [ ] **Step 5: Run the full web suite + build**

Run: `npm run test -w web && npm run build`
Expected: all web tests PASS; production build succeeds (pre-commit hook runs the same).

- [ ] **Step 6: Commit**

```bash
git add web/src/SweepProvider.jsx web/src/SweepProvider.test.jsx
git commit -m "feat(web): provider hydrates social state + subscribes to SSE stream"
```

---

## Final verification (lead, before declaring Phase 4 done)

- [ ] `npm run test -w api` → all green (incl. `bus`, `notify-listen`, `stream`, `social`, updated `live-poller`).
- [ ] `npm run test -w web` → all green (incl. updated `client`, `social`, `SweepProvider`, new `useEventStream`).
- [ ] `npm run build` → green.
- [ ] **Live two-client smoke** (the real test of "genuinely shared"):
  1. `npm run dev:api` + `npm run dev:web`.
  2. Open `http://localhost:5173` in two browser windows; pick a different identity in each.
  3. In window A, tap "watching" on a fixture → within ~1s window B shows A in the watchers (no refresh). Repeat for backing a team.
  4. Confirm rollback: stop the api, tap watch in A → it flips then reverts with the toast; restart api.
- [ ] Push: `git push origin main` (pre-push runs web+api tests + build; Docker must be up).
- [ ] Update `.remember/remember.md` with the Phase 4 handoff.

---

## Self-review notes (author)

- **Spec §5 coverage:** watch/support write endpoints (T5/T6), `/api/stream` SSE (T3), `useEventStream` invalidating caches (T11), optimistic updates + rollback (T10), identity in `localStorage` sent on writes (T10), `watchersOf`/`supportOf` from server state (T10/T12). ✓
- **Spec §6 (SSE event set):** `score`, `watch`, `support`, `sync` delivered (T5/T6/T8). `photo-approved` is Phase 5 — intentionally out of scope. ✓
- **Spec §4 (worker live poller → SSE score):** T8. ✓
- **Cross-process reality:** api and worker are separate processes → Postgres `LISTEN/NOTIFY` bridge (T2/T7); api-local writes go straight to the bus (T4 `app.publish` default). This is the one design choice not spelled out in the spec; it is the minimal correct mechanism given the container topology in §2. ✓
- **Type consistency:** `setSocialData({watch, support})` shape == `GET /api/social` shape == event-driven refetch; `publish(db, event)` (worker) vs `app.publish(event)` (api routes, local bus) are deliberately distinct and documented. ✓
- **No new dependencies:** native `EventSource`, native `pg` NOTIFY, Fastify JSON-schema validation, existing TanStack Query. ✓
