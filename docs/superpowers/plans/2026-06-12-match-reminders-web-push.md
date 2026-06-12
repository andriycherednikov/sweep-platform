# Match Reminders via Web Push — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a participant tap a bell on a match, pick a lead time (15/30/60 min or at kickoff), and receive a real push notification before kickoff even when the app is closed.

**Architecture:** Each opt-in is a `reminder` row tied to a per-device push subscription. The existing 60-second worker tick scans for reminders whose due time has just passed and sends them via the `web-push` library, marking `sent_at` for exactly-once delivery. A notifications-only service worker shows the notification and opens the app on tap.

**Tech Stack:** Node 22 + Fastify 5 + Drizzle ORM + Postgres (api); `web-push` + VAPID; Vite + React 18 (web); service worker + Push API; Vitest + Testcontainers.

**Spec:** `docs/superpowers/specs/2026-06-12-match-reminders-web-push-design.md`

---

## File Structure

**Backend (`api/`):**
- `src/db/schema.js` — add `pushSubscription` and `reminder` tables (modify).
- `migrations/00NN_*.sql` — generated migration (create).
- `src/push/vapid.js` — configures `web-push` from env, exposes the public key (create).
- `src/routes/push.js` — `GET /api/push/key`, `POST /api/push/subscribe`, `POST /api/push/unsubscribe` (create).
- `src/routes/reminders.js` — `GET/POST/DELETE /api/reminders` (create).
- `src/worker/reminders.js` — `dueReminders(db, now)` + `sendDueReminders(db, webpush, now)` (create).
- `src/app.js` — register the two new route plugins (modify).
- `src/worker.js` — call `sendDueReminders` in the 60s tick (modify).
- `api/package.json` — add `web-push` dependency (modify).

**Frontend (`web/`):**
- `public/sw.js` — notifications-only service worker (create).
- `src/lib/deviceId.js` — stable per-device id in localStorage (create).
- `src/api/client.js` — push/reminder fetch helpers (modify).
- `src/hooks/usePush.js` — shared push store, mirrors `useInstallPrompt` (create).
- `src/ReminderBell.jsx` — bell control + lead-time menu (create).
- `src/components.jsx` — render `<ReminderBell>` in `MatchCard` (modify).
- `src/screens-detail.jsx` — render `<ReminderBell>` in `MatchSheet` (modify).
- `src/main.jsx` — register the service worker on load (modify).
- `src/styles.css` — bell + menu styles (modify).

**Config/docs:**
- `.env.example`, `docker/.env.docker.example`, `docker/docker-compose.yml`, `CLAUDE.md` (modify).

---

## Task 1: Add `web-push` dependency + VAPID config

**Files:**
- Modify: `api/package.json`
- Create: `api/src/push/vapid.js`
- Test: `api/test/vapid.test.js`

- [ ] **Step 1: Install web-push**

Run from repo root:
```bash
npm install web-push@^3.6.7 -w api
```
Expected: `web-push` appears under `dependencies` in `api/package.json`.

- [ ] **Step 2: Write the failing test**

Create `api/test/vapid.test.js`:
```js
import { expect, test } from 'vitest'
import { configureWebPush, getPublicKey } from '../src/push/vapid.js'

const KEYS = {
  // a real VAPID keypair generated for tests (web-push generate-vapid-keys)
  publicKey: 'BLc4xRzKlKORKWlbdgFaBrrPK3ydWAHo4M0gs0i1oEKgPpWC5cW8OjbI2JmqJ9z5z4QyqGZ8q6r6N7v3xq9c2A',
  privateKey: 'Q1Tx0e1G2hHq8Yc8Q5sQwZ8b3pK9bQ8wXrJ8m6n4d0',
  subject: 'mailto:test@example.com',
}

test('configureWebPush sets details and getPublicKey returns the public key', () => {
  const wp = { setVapidDetails: (...a) => { wp._called = a } }
  configureWebPush(wp, KEYS)
  expect(wp._called).toEqual([KEYS.subject, KEYS.publicKey, KEYS.privateKey])
  expect(getPublicKey(KEYS)).toBe(KEYS.publicKey)
})

test('configureWebPush is a no-op when keys are missing', () => {
  const wp = { setVapidDetails: () => { throw new Error('should not be called') } }
  expect(() => configureWebPush(wp, { publicKey: '', privateKey: '', subject: '' })).not.toThrow()
  expect(getPublicKey({ publicKey: '' })).toBe(null)
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -w api -- test/vapid.test.js`
Expected: FAIL — cannot find module `../src/push/vapid.js`.

- [ ] **Step 4: Write minimal implementation**

Create `api/src/push/vapid.js`:
```js
// Reads VAPID config from env and wires it into the web-push library. Push is
// optional in dev: with no keys set, configureWebPush is a harmless no-op and
// getPublicKey returns null so the API can report "push unavailable".

export function readVapidEnv(env = process.env) {
  return {
    publicKey: env.VAPID_PUBLIC_KEY || '',
    privateKey: env.VAPID_PRIVATE_KEY || '',
    subject: env.VAPID_SUBJECT || 'mailto:admin@example.com',
  }
}

export function configureWebPush(webpush, keys = readVapidEnv()) {
  if (!keys.publicKey || !keys.privateKey) return false
  webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey)
  return true
}

export function getPublicKey(keys = readVapidEnv()) {
  return keys.publicKey || null
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w api -- test/vapid.test.js`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add api/package.json api/package-lock.json package-lock.json api/src/push/vapid.js api/test/vapid.test.js
git commit -m "feat(api): add web-push dependency and VAPID config helper"
```

---

## Task 2: Schema — `push_subscription` + `reminder` tables

**Files:**
- Modify: `api/src/db/schema.js`
- Create: `api/migrations/00NN_*.sql` (via drizzle-kit)
- Test: `api/test/reminders-schema.test.js`

- [ ] **Step 1: Write the failing test**

Create `api/test/reminders-schema.test.js`:
```js
import { expect, test, afterAll, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { pushSubscription, reminder, fixture } from '../src/db/schema.js'

const { pool, db } = openTestDb()
afterAll(async () => { await pool.end() })
beforeEach(async () => { await db.delete(reminder); await db.delete(pushSubscription) })

test('push_subscription enforces a unique endpoint', async () => {
  await db.insert(pushSubscription).values({ deviceId: 'd1', endpoint: 'https://push/e1', p256dh: 'k', auth: 'a' })
  await expect(
    db.insert(pushSubscription).values({ deviceId: 'd2', endpoint: 'https://push/e1', p256dh: 'k', auth: 'a' })
  ).rejects.toThrow()
})

test('reminder is unique per (device_id, fixture_id)', async () => {
  const [f] = await db.select().from(fixture).limit(1)
  await db.insert(reminder).values({ deviceId: 'd1', fixtureId: f.id, leadMinutes: 30 })
  await expect(
    db.insert(reminder).values({ deviceId: 'd1', fixtureId: f.id, leadMinutes: 15 })
  ).rejects.toThrow()
})

test('reminder defaults sent_at to null and stores lead_minutes', async () => {
  const [f] = await db.select().from(fixture).limit(1)
  await db.insert(reminder).values({ deviceId: 'd9', fixtureId: f.id, leadMinutes: 0 })
  const [r] = await db.select().from(reminder).where(eq(reminder.deviceId, 'd9'))
  expect(r.sentAt).toBe(null)
  expect(r.leadMinutes).toBe(0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w api -- test/reminders-schema.test.js`
Expected: FAIL — `pushSubscription`/`reminder` are undefined exports.

- [ ] **Step 3: Add the tables to the schema**

In `api/src/db/schema.js`, update the import line on line 1 to add `unique`:
```js
import { pgTable, text, integer, primaryKey, timestamp, boolean, jsonb, serial, unique } from 'drizzle-orm/pg-core'
```

Append at the end of the file:
```js
export const pushSubscription = pgTable('push_subscription', {
  id: serial('id').primaryKey(),
  deviceId: text('device_id').notNull(),
  personId: text('person_id'),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const reminder = pgTable('reminder', {
  id: serial('id').primaryKey(),
  deviceId: text('device_id').notNull(),
  fixtureId: text('fixture_id').notNull().references(() => fixture.id, { onDelete: 'cascade' }),
  leadMinutes: integer('lead_minutes').notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uqDeviceFixture: unique().on(t.deviceId, t.fixtureId) }))
```

- [ ] **Step 4: Generate the migration**

Run from repo root:
```bash
npm run db:generate -w api
```
Expected: a new file `api/migrations/00NN_<name>.sql` containing `CREATE TABLE "push_subscription"` and `CREATE TABLE "reminder"`. Open it and confirm both tables and the two unique constraints are present.

- [ ] **Step 5: Run test to verify it passes**

The test global-setup runs migrations automatically against a fresh container.
Run: `npm run test -w api -- test/reminders-schema.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add api/src/db/schema.js api/migrations api/test/reminders-schema.test.js
git commit -m "feat(api): push_subscription and reminder tables"
```

---

## Task 3: Push subscription API

**Files:**
- Create: `api/src/routes/push.js`
- Modify: `api/src/app.js`
- Test: `api/test/push-routes.test.js`

- [ ] **Step 1: Write the failing test**

Create `api/test/push-routes.test.js`:
```js
import { expect, test, afterAll, beforeEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { pushSubscription } from '../src/db/schema.js'

const { pool, db } = openTestDb()
const app = buildApp(db, { publish: () => {}, vapidPublicKey: 'TEST_PUBLIC_KEY' })
afterAll(async () => { await app.close(); await pool.end() })
beforeEach(async () => { await db.delete(pushSubscription) })

const sub = { endpoint: 'https://push/abc', keys: { p256dh: 'p', auth: 'a' }, deviceId: 'd1', personId: 'p45' }

test('GET /api/push/key returns the configured public key', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/push/key' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ publicKey: 'TEST_PUBLIC_KEY' })
})

test('POST /api/push/subscribe inserts a subscription', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/push/subscribe', payload: sub })
  expect(res.statusCode).toBe(200)
  const rows = await db.select().from(pushSubscription)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ deviceId: 'd1', endpoint: 'https://push/abc', p256dh: 'p', auth: 'a' })
})

test('POST /api/push/subscribe upserts (same endpoint, no duplicate)', async () => {
  await app.inject({ method: 'POST', url: '/api/push/subscribe', payload: sub })
  await app.inject({ method: 'POST', url: '/api/push/subscribe', payload: { ...sub, deviceId: 'd2' } })
  const rows = await db.select().from(pushSubscription)
  expect(rows).toHaveLength(1)
  expect(rows[0].deviceId).toBe('d2')
})

test('POST /api/push/unsubscribe deletes by endpoint', async () => {
  await app.inject({ method: 'POST', url: '/api/push/subscribe', payload: sub })
  const res = await app.inject({ method: 'POST', url: '/api/push/unsubscribe', payload: { endpoint: sub.endpoint } })
  expect(res.statusCode).toBe(200)
  expect(await db.select().from(pushSubscription)).toHaveLength(0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w api -- test/push-routes.test.js`
Expected: FAIL — `/api/push/key` 404 (route not registered) and missing `vapidPublicKey` decoration.

- [ ] **Step 3: Implement the routes**

Create `api/src/routes/push.js`:
```js
import { eq } from 'drizzle-orm'
import { pushSubscription } from '../db/schema.js'

const subscribeBody = {
  type: 'object',
  required: ['endpoint', 'keys', 'deviceId'],
  additionalProperties: false,
  properties: {
    endpoint: { type: 'string' },
    keys: {
      type: 'object', required: ['p256dh', 'auth'], additionalProperties: false,
      properties: { p256dh: { type: 'string' }, auth: { type: 'string' } },
    },
    deviceId: { type: 'string' },
    personId: { type: 'string', nullable: true },
  },
}
const unsubscribeBody = {
  type: 'object', required: ['endpoint'], additionalProperties: false,
  properties: { endpoint: { type: 'string' } },
}

export async function pushRoutes(app) {
  app.get('/api/push/key', async () => ({ publicKey: app.vapidPublicKey || null }))

  app.post('/api/push/subscribe', { schema: { body: subscribeBody } }, async (req) => {
    const { endpoint, keys, deviceId, personId } = req.body
    await app.db.insert(pushSubscription)
      .values({ endpoint, p256dh: keys.p256dh, auth: keys.auth, deviceId, personId: personId ?? null })
      .onConflictDoUpdate({
        target: pushSubscription.endpoint,
        set: { p256dh: keys.p256dh, auth: keys.auth, deviceId, personId: personId ?? null },
      })
    return { ok: true }
  })

  app.post('/api/push/unsubscribe', { schema: { body: unsubscribeBody } }, async (req) => {
    await app.db.delete(pushSubscription).where(eq(pushSubscription.endpoint, req.body.endpoint))
    return { ok: true }
  })
}
```

- [ ] **Step 4: Register the plugin and decorate the public key**

In `api/src/app.js`, add the import next to the other route imports:
```js
import { pushRoutes } from './routes/push.js'
```

Add this decoration right after the `app.decorate('publish', ...)` line:
```js
  app.decorate('vapidPublicKey', opts.vapidPublicKey ?? process.env.VAPID_PUBLIC_KEY ?? null)
```

Add this registration next to the other `app.register(...Routes)` calls:
```js
  app.register(pushRoutes)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w api -- test/push-routes.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add api/src/routes/push.js api/src/app.js api/test/push-routes.test.js
git commit -m "feat(api): push subscribe/unsubscribe/key endpoints"
```

---

## Task 4: Reminders API

**Files:**
- Create: `api/src/routes/reminders.js`
- Modify: `api/src/app.js`
- Test: `api/test/reminders-routes.test.js`

- [ ] **Step 1: Write the failing test**

Create `api/test/reminders-routes.test.js`:
```js
import { expect, test, afterAll, beforeEach } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { reminder, fixture } from '../src/db/schema.js'

const { pool, db } = openTestDb()
const app = buildApp(db, { publish: () => {} })
afterAll(async () => { await app.close(); await pool.end() })
beforeEach(async () => { await db.delete(reminder) })

async function aFixture() { const [f] = await db.select().from(fixture).limit(1); return f }

test('POST /api/reminders creates a reminder', async () => {
  const f = await aFixture()
  const res = await app.inject({ method: 'POST', url: '/api/reminders', payload: { deviceId: 'd1', fixtureId: f.id, leadMinutes: 30 } })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({ fixtureId: f.id, leadMinutes: 30 })
  const [r] = await db.select().from(reminder)
  expect(r.leadMinutes).toBe(30)
})

test('POST /api/reminders 400s on unknown fixture', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/reminders', payload: { deviceId: 'd1', fixtureId: 'nope', leadMinutes: 30 } })
  expect(res.statusCode).toBe(400)
})

test('POST /api/reminders 400s on an invalid lead time', async () => {
  const f = await aFixture()
  const res = await app.inject({ method: 'POST', url: '/api/reminders', payload: { deviceId: 'd1', fixtureId: f.id, leadMinutes: 45 } })
  expect(res.statusCode).toBe(400)
})

test('POST /api/reminders upserts on (device,fixture) and resets sent_at', async () => {
  const f = await aFixture()
  await db.insert(reminder).values({ deviceId: 'd1', fixtureId: f.id, leadMinutes: 30, sentAt: new Date() })
  await app.inject({ method: 'POST', url: '/api/reminders', payload: { deviceId: 'd1', fixtureId: f.id, leadMinutes: 15 } })
  const rows = await db.select().from(reminder).where(and(eq(reminder.deviceId, 'd1'), eq(reminder.fixtureId, f.id)))
  expect(rows).toHaveLength(1)
  expect(rows[0].leadMinutes).toBe(15)
  expect(rows[0].sentAt).toBe(null)
})

test('GET /api/reminders?deviceId returns that device\'s reminders', async () => {
  const f = await aFixture()
  await db.insert(reminder).values({ deviceId: 'd1', fixtureId: f.id, leadMinutes: 60 })
  const res = await app.inject({ method: 'GET', url: '/api/reminders?deviceId=d1' })
  expect(res.json()).toEqual([{ fixtureId: f.id, leadMinutes: 60, sentAt: null }])
})

test('DELETE /api/reminders removes the row', async () => {
  const f = await aFixture()
  await db.insert(reminder).values({ deviceId: 'd1', fixtureId: f.id, leadMinutes: 30 })
  const res = await app.inject({ method: 'DELETE', url: '/api/reminders', payload: { deviceId: 'd1', fixtureId: f.id } })
  expect(res.statusCode).toBe(200)
  expect(await db.select().from(reminder)).toHaveLength(0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w api -- test/reminders-routes.test.js`
Expected: FAIL — routes not registered (404/405).

- [ ] **Step 3: Implement the routes**

Create `api/src/routes/reminders.js`:
```js
import { and, eq } from 'drizzle-orm'
import { reminder, fixture } from '../db/schema.js'

const LEADS = [0, 15, 30, 60]

const postBody = {
  type: 'object', required: ['deviceId', 'fixtureId', 'leadMinutes'], additionalProperties: false,
  properties: {
    deviceId: { type: 'string' },
    fixtureId: { type: 'string' },
    leadMinutes: { type: 'integer', enum: LEADS },
  },
}
const deleteBody = {
  type: 'object', required: ['deviceId', 'fixtureId'], additionalProperties: false,
  properties: { deviceId: { type: 'string' }, fixtureId: { type: 'string' } },
}
const listQuery = {
  type: 'object', required: ['deviceId'], properties: { deviceId: { type: 'string' } },
}

export async function reminderRoutes(app) {
  app.get('/api/reminders', { schema: { querystring: listQuery } }, async (req) => {
    const rows = await app.db.select({
      fixtureId: reminder.fixtureId, leadMinutes: reminder.leadMinutes, sentAt: reminder.sentAt,
    }).from(reminder).where(eq(reminder.deviceId, req.query.deviceId))
    return rows
  })

  app.post('/api/reminders', { schema: { body: postBody } }, async (req, reply) => {
    const { deviceId, fixtureId, leadMinutes } = req.body
    const [f] = await app.db.select().from(fixture).where(eq(fixture.id, fixtureId))
    if (!f) return reply.code(400).send({ error: 'unknown_fixture' })
    await app.db.insert(reminder)
      .values({ deviceId, fixtureId, leadMinutes, sentAt: null })
      .onConflictDoUpdate({
        target: [reminder.deviceId, reminder.fixtureId],
        set: { leadMinutes, sentAt: null },
      })
    return { deviceId, fixtureId, leadMinutes }
  })

  app.delete('/api/reminders', { schema: { body: deleteBody } }, async (req) => {
    const { deviceId, fixtureId } = req.body
    await app.db.delete(reminder).where(and(eq(reminder.deviceId, deviceId), eq(reminder.fixtureId, fixtureId)))
    return { ok: true }
  })
}
```

- [ ] **Step 4: Register the plugin**

In `api/src/app.js` add the import:
```js
import { reminderRoutes } from './routes/reminders.js'
```
And register it next to `pushRoutes`:
```js
  app.register(reminderRoutes)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w api -- test/reminders-routes.test.js`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add api/src/routes/reminders.js api/src/app.js api/test/reminders-routes.test.js
git commit -m "feat(api): reminders CRUD endpoints"
```

---

## Task 5: Worker due-reminder query + sender

**Files:**
- Create: `api/src/worker/reminders.js`
- Test: `api/test/worker-reminders.test.js`

- [ ] **Step 1: Write the failing test**

Create `api/test/worker-reminders.test.js`:
```js
import { expect, test, afterAll, beforeEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { openTestDb } from './helpers/db.js'
import { dueReminders, sendDueReminders } from '../src/worker/reminders.js'
import { reminder, pushSubscription, fixture } from '../src/db/schema.js'

const { pool, db } = openTestDb()
afterAll(async () => { await pool.end() })

let f
beforeEach(async () => {
  await db.delete(reminder); await db.delete(pushSubscription)
  ;[f] = await db.select().from(fixture).limit(1)
  await db.update(fixture).set({ kickoffUtc: new Date('2026-06-20T12:00:00Z') }).where(eq(fixture.id, f.id))
  await db.insert(pushSubscription).values({ deviceId: 'd1', endpoint: 'https://push/e1', p256dh: 'p', auth: 'a' })
})

// kickoff is 12:00Z; a 30-min reminder is due at 11:30Z.
test('dueReminders includes a reminder whose due time just passed', async () => {
  await db.insert(reminder).values({ deviceId: 'd1', fixtureId: f.id, leadMinutes: 30 })
  const rows = await dueReminders(db, new Date('2026-06-20T11:30:20Z'))
  expect(rows).toHaveLength(1)
  expect(rows[0].endpoint).toBe('https://push/e1')
})

test('dueReminders excludes a reminder not yet due', async () => {
  await db.insert(reminder).values({ deviceId: 'd1', fixtureId: f.id, leadMinutes: 30 })
  const rows = await dueReminders(db, new Date('2026-06-20T11:25:00Z'))
  expect(rows).toHaveLength(0)
})

test('dueReminders excludes a stale (>5m past due) reminder', async () => {
  await db.insert(reminder).values({ deviceId: 'd1', fixtureId: f.id, leadMinutes: 30 })
  const rows = await dueReminders(db, new Date('2026-06-20T11:40:00Z'))
  expect(rows).toHaveLength(0)
})

test('dueReminders excludes already-sent reminders', async () => {
  await db.insert(reminder).values({ deviceId: 'd1', fixtureId: f.id, leadMinutes: 30, sentAt: new Date() })
  const rows = await dueReminders(db, new Date('2026-06-20T11:30:20Z'))
  expect(rows).toHaveLength(0)
})

test('sendDueReminders sends, stamps sent_at, and counts', async () => {
  await db.insert(reminder).values({ deviceId: 'd1', fixtureId: f.id, leadMinutes: 30 })
  const webpush = { sendNotification: vi.fn().mockResolvedValue({}) }
  const n = await sendDueReminders(db, webpush, new Date('2026-06-20T11:30:20Z'))
  expect(n).toBe(1)
  expect(webpush.sendNotification).toHaveBeenCalledOnce()
  const [r] = await db.select().from(reminder)
  expect(r.sentAt).not.toBe(null)
})

test('sendDueReminders does not resend an already-sent reminder', async () => {
  await db.insert(reminder).values({ deviceId: 'd1', fixtureId: f.id, leadMinutes: 30 })
  const webpush = { sendNotification: vi.fn().mockResolvedValue({}) }
  await sendDueReminders(db, webpush, new Date('2026-06-20T11:30:20Z'))
  const n = await sendDueReminders(db, webpush, new Date('2026-06-20T11:30:40Z'))
  expect(n).toBe(0)
  expect(webpush.sendNotification).toHaveBeenCalledOnce()
})

test('sendDueReminders prunes a subscription on 410 Gone', async () => {
  await db.insert(reminder).values({ deviceId: 'd1', fixtureId: f.id, leadMinutes: 30 })
  const webpush = { sendNotification: vi.fn().mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 })) }
  const n = await sendDueReminders(db, webpush, new Date('2026-06-20T11:30:20Z'))
  expect(n).toBe(0)
  expect(await db.select().from(pushSubscription)).toHaveLength(0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w api -- test/worker-reminders.test.js`
Expected: FAIL — cannot find module `../src/worker/reminders.js`.

- [ ] **Step 3: Implement the worker sender**

Create `api/src/worker/reminders.js`:
```js
import { and, eq, isNull } from 'drizzle-orm'
import { reminder, pushSubscription, fixture, team } from '../db/schema.js'

const STALE_MS = 5 * 60 * 1000 // ignore reminders whose due time passed >5m ago

// A reminder is due when (kickoff - leadMinutes) has passed but not by more than
// STALE_MS, it hasn't been sent, and the device still has a subscription.
export async function dueReminders(db, now) {
  const rows = await db.select({
    reminderId: reminder.id,
    leadMinutes: reminder.leadMinutes,
    kickoffUtc: fixture.kickoffUtc,
    t1Code: fixture.t1Code,
    t2Code: fixture.t2Code,
    venue: fixture.venue,
    group: fixture.group,
    subId: pushSubscription.id,
    endpoint: pushSubscription.endpoint,
    p256dh: pushSubscription.p256dh,
    auth: pushSubscription.auth,
  }).from(reminder)
    .innerJoin(fixture, eq(reminder.fixtureId, fixture.id))
    .innerJoin(pushSubscription, eq(reminder.deviceId, pushSubscription.deviceId))
    .where(isNull(reminder.sentAt))

  const nowMs = now.getTime()
  return rows.filter((r) => {
    const dueMs = new Date(r.kickoffUtc).getTime() - r.leadMinutes * 60_000
    return dueMs <= nowMs && dueMs > nowMs - STALE_MS
  })
}

function buildPayload(r, names) {
  const a = names[r.t1Code] || r.t1Code
  const b = names[r.t2Code] || r.t2Code
  const when = r.leadMinutes > 0 ? `kicks off in ${r.leadMinutes} min` : 'is kicking off'
  return JSON.stringify({
    title: `${a} vs ${b} ${when}`,
    body: `${r.venue} · Group ${r.group}`,
    icon: '/web-app-manifest-192x192.png',
    data: { url: '/' },
  })
}

export async function sendDueReminders(db, webpush, now) {
  const due = await dueReminders(db, now)
  if (!due.length) return 0

  const teams = await db.select({ code: team.code, name: team.name }).from(team)
  const names = Object.fromEntries(teams.map((t) => [t.code, t.name]))

  let sent = 0
  for (const r of due) {
    const sub = { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }
    try {
      await webpush.sendNotification(sub, buildPayload(r, names))
      await db.update(reminder).set({ sentAt: now }).where(eq(reminder.id, r.reminderId))
      sent++
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        await db.delete(pushSubscription).where(eq(pushSubscription.id, r.subId))
      } else {
        console.error('[reminders] send failed:', e.message)
      }
    }
  }
  return sent
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w api -- test/worker-reminders.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add api/src/worker/reminders.js api/test/worker-reminders.test.js
git commit -m "feat(api): worker due-reminder query and web-push sender"
```

---

## Task 6: Wire the sender into the worker tick

**Files:**
- Modify: `api/src/worker.js`

There is no unit test for the long-running loop itself; the sender was tested in Task 5. This task wires it in and is verified by the build/import succeeding.

- [ ] **Step 1: Add imports**

In `api/src/worker.js`, add near the other imports:
```js
import webpush from 'web-push'
import { configureWebPush } from './push/vapid.js'
import { sendDueReminders } from './worker/reminders.js'
```

- [ ] **Step 2: Configure web-push at startup**

After the `const provider = ...` line, add:
```js
const pushReady = configureWebPush(webpush)
if (!pushReady) console.warn('[reminders] VAPID keys not set — reminders will not send')
```

- [ ] **Step 3: Call the sender inside the 60s tick**

In the `setInterval(async () => { ... }, 60_000)` body, after the lineups block and before the closing `catch`, add:
```js
    if (pushReady) {
      try {
        const sent = await sendDueReminders(db, webpush, new Date())
        if (sent) console.log(`[reminders] sent ${sent}`)
      } catch (e) { console.error('[reminders] tick failed:', e.message) }
    }
```

- [ ] **Step 4: Verify the worker module imports cleanly**

Run:
```bash
node --check api/src/worker.js && echo OK
```
Expected: `OK` (syntax valid). Full boot needs a DB/env, so a syntax check is the gate here.

- [ ] **Step 5: Commit**

```bash
git add api/src/worker.js
git commit -m "feat(api): fire due reminders each worker tick"
```

---

## Task 7: Service worker (notifications-only)

**Files:**
- Create: `web/public/sw.js`
- Test: `web/test/sw.test.js`

- [ ] **Step 1: Write the failing test**

Create `web/test/sw.test.js`:
```js
import { expect, test, vi, beforeEach } from 'vitest'
import { handlePush, handleNotificationClick } from '../public/sw.js'

beforeEach(() => { vi.restoreAllMocks() })

test('handlePush shows a notification from the payload', async () => {
  const registration = { showNotification: vi.fn().mockResolvedValue() }
  const data = { json: () => ({ title: 'T', body: 'B', icon: '/i.png', data: { url: '/' } }) }
  await handlePush({ data }, registration)
  expect(registration.showNotification).toHaveBeenCalledWith('T', {
    body: 'B', icon: '/i.png', data: { url: '/' },
  })
})

test('handleNotificationClick focuses an existing client', async () => {
  const client = { url: 'https://app/', focus: vi.fn().mockResolvedValue(), navigate: vi.fn() }
  const clients = { matchAll: vi.fn().mockResolvedValue([client]), openWindow: vi.fn() }
  const notification = { close: vi.fn(), data: { url: '/' } }
  await handleNotificationClick({ notification }, clients, 'https://app/')
  expect(client.focus).toHaveBeenCalled()
  expect(clients.openWindow).not.toHaveBeenCalled()
})

test('handleNotificationClick opens a window when none is focused', async () => {
  const clients = { matchAll: vi.fn().mockResolvedValue([]), openWindow: vi.fn().mockResolvedValue() }
  const notification = { close: vi.fn(), data: { url: '/' } }
  await handleNotificationClick({ notification }, clients, 'https://app/')
  expect(clients.openWindow).toHaveBeenCalledWith('/')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w web -- test/sw.test.js`
Expected: FAIL — cannot find module `../public/sw.js`.

- [ ] **Step 3: Implement the service worker**

Create `web/public/sw.js`:
```js
// The Sweep — notifications-only service worker. No offline caching by design;
// it exists solely to receive Web Push and open the app on tap. Handlers are
// exported as pure functions so they can be unit-tested without a SW runtime.

export async function handlePush(event, registration) {
  const payload = event.data ? event.data.json() : {}
  await registration.showNotification(payload.title || 'The Sweep', {
    body: payload.body || '',
    icon: payload.icon || '/web-app-manifest-192x192.png',
    data: payload.data || { url: '/' },
  })
}

export async function handleNotificationClick(event, clients, baseUrl) {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  const all = await clients.matchAll({ type: 'window', includeUncontrolled: true })
  const existing = all.find((c) => c.url.startsWith(baseUrl))
  if (existing) { await existing.focus(); return }
  await clients.openWindow(url)
}

// Wire the exported handlers to real SW events when running in a worker context.
if (typeof self !== 'undefined' && self.addEventListener && typeof window === 'undefined') {
  self.addEventListener('install', () => self.skipWaiting())
  self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
  self.addEventListener('push', (e) => e.waitUntil(handlePush(e, self.registration)))
  self.addEventListener('notificationclick', (e) => e.waitUntil(handleNotificationClick(e, self.clients, self.registration.scope)))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w web -- test/sw.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/public/sw.js web/test/sw.test.js
git commit -m "feat(web): notifications-only service worker"
```

---

## Task 8: Device id + push client helpers

**Files:**
- Create: `web/src/lib/deviceId.js`
- Modify: `web/src/api/client.js`
- Test: `web/src/lib/deviceId.test.js`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/deviceId.test.js`:
```js
import { expect, test, beforeEach } from 'vitest'
import { getDeviceId } from './deviceId.js'

beforeEach(() => localStorage.clear())

test('getDeviceId returns a stable id across calls', () => {
  const a = getDeviceId()
  const b = getDeviceId()
  expect(a).toBe(b)
  expect(a).toMatch(/.{8,}/)
})

test('getDeviceId persists across reloads (localStorage)', () => {
  const a = getDeviceId()
  expect(localStorage.getItem('sweep.device.v1')).toBe(a)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w web -- src/lib/deviceId.test.js`
Expected: FAIL — cannot find module `./deviceId.js`.

- [ ] **Step 3: Implement the device id**

Create `web/src/lib/deviceId.js`:
```js
// A stable per-device id (push subscriptions and reminders are per-device).
// Distinct from identity (`sweep.me.v1`, a person) — one device, one id.
const KEY = 'sweep.device.v1'

export function getDeviceId() {
  let id
  try { id = localStorage.getItem(KEY) } catch { id = null }
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : `d${Date.now()}${Math.random().toString(16).slice(2)}`)
    try { localStorage.setItem(KEY, id) } catch { /* private mode */ }
  }
  return id
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w web -- src/lib/deviceId.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Add client helpers**

In `web/src/api/client.js`, after the existing `postSupport` export (line ~33), add:
```js
export const fetchVapidKey = () => get('/api/push/key')
export const postPushSubscribe = (sub) => post('/api/push/subscribe', sub)
export const postPushUnsubscribe = (endpoint) => post('/api/push/unsubscribe', { endpoint })
export const fetchReminders = (deviceId) => get(`/api/reminders?deviceId=${encodeURIComponent(deviceId)}`)
export const postReminder = (deviceId, fixtureId, leadMinutes) => post('/api/reminders', { deviceId, fixtureId, leadMinutes })
export const deleteReminder = (deviceId, fixtureId) =>
  fetch('/api/reminders', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId, fixtureId }) })
    .then((r) => { if (!r.ok) throw new Error('reminder delete failed'); return r.json() })
```

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/deviceId.js web/src/lib/deviceId.test.js web/src/api/client.js
git commit -m "feat(web): device id and push/reminder client helpers"
```

---

## Task 9: `usePush` shared store

**Files:**
- Create: `web/src/hooks/usePush.js`
- Test: `web/src/hooks/usePush.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/hooks/usePush.test.jsx`:
```js
import { expect, test, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

vi.mock('../api/client.js', () => ({
  fetchVapidKey: vi.fn().mockResolvedValue({ publicKey: 'BPbl_test_key' }),
  postPushSubscribe: vi.fn().mockResolvedValue({ ok: true }),
  fetchReminders: vi.fn().mockResolvedValue([]),
  postReminder: vi.fn().mockResolvedValue({}),
  deleteReminder: vi.fn().mockResolvedValue({}),
}))
import * as client from '../api/client.js'
import { usePush, __resetPushStore } from './usePush.js'

beforeEach(() => {
  localStorage.clear()
  __resetPushStore()
  client.fetchReminders.mockResolvedValue([])
  // jsdom: stub Notification + serviceWorker + PushManager presence
  globalThis.Notification = { permission: 'granted', requestPermission: vi.fn().mockResolvedValue('granted') }
  const subscription = { endpoint: 'https://push/e1', toJSON: () => ({ endpoint: 'https://push/e1', keys: { p256dh: 'p', auth: 'a' } }) }
  navigator.serviceWorker = {
    register: vi.fn().mockResolvedValue({ pushManager: {
      getSubscription: vi.fn().mockResolvedValue(null),
      subscribe: vi.fn().mockResolvedValue(subscription),
    } }),
    ready: Promise.resolve({ pushManager: {
      getSubscription: vi.fn().mockResolvedValue(null),
      subscribe: vi.fn().mockResolvedValue(subscription),
    } }),
  }
  globalThis.PushManager = function () {}
})
afterEach(() => { delete navigator.serviceWorker; delete globalThis.Notification; delete globalThis.PushManager })

test('reports push supported when the APIs exist', () => {
  const { result } = renderHook(() => usePush())
  expect(result.current.supported).toBe(true)
})

test('setReminder subscribes then posts the reminder and updates local state', async () => {
  const { result } = renderHook(() => usePush())
  await act(async () => { await result.current.setReminder('f1', 30) })
  expect(client.postPushSubscribe).toHaveBeenCalled()
  expect(client.postReminder).toHaveBeenCalledWith(expect.any(String), 'f1', 30)
  expect(result.current.reminderFor('f1')).toBe(30)
})

test('clearReminder deletes and removes local state', async () => {
  client.fetchReminders.mockResolvedValue([{ fixtureId: 'f1', leadMinutes: 15, sentAt: null }])
  const { result } = renderHook(() => usePush())
  await waitFor(() => expect(result.current.reminderFor('f1')).toBe(15))
  await act(async () => { await result.current.clearReminder('f1') })
  expect(client.deleteReminder).toHaveBeenCalledWith(expect.any(String), 'f1')
  expect(result.current.reminderFor('f1')).toBe(null)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w web -- src/hooks/usePush.test.jsx`
Expected: FAIL — cannot find module `./usePush.js`.

- [ ] **Step 3: Implement the store**

Create `web/src/hooks/usePush.js`:
```js
import { useSyncExternalStore } from 'react'
import { getDeviceId } from '../lib/deviceId.js'
import { fetchVapidKey, postPushSubscribe, fetchReminders, postReminder, deleteReminder } from '../api/client.js'

const supported = () =>
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator &&
  typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

// shared module store
let reminders = {}     // { fixtureId: leadMinutes }
let loaded = false
let version = 0
const listeners = new Set()
function emit() { version++; listeners.forEach((l) => l()) }
function subscribe(cb) { listeners.add(cb); ensureLoaded(); return () => listeners.delete(cb) }
function getSnapshot() { return version }

async function ensureLoaded() {
  if (loaded || !supported()) return
  loaded = true
  try {
    const rows = await fetchReminders(getDeviceId())
    reminders = Object.fromEntries(rows.map((r) => [r.fixtureId, r.leadMinutes]))
    emit()
  } catch { /* offline; bell renders empty */ }
}

export function __resetPushStore() { reminders = {}; loaded = false; emit() }

async function ensureSubscribed() {
  if (Notification.permission !== 'granted') {
    const p = await Notification.requestPermission()
    if (p !== 'granted') throw new Error('permission_denied')
  }
  await navigator.serviceWorker.register('/sw.js')
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    const { publicKey } = await fetchVapidKey()
    if (!publicKey) throw new Error('push_unconfigured')
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })
  }
  const json = sub.toJSON()
  await postPushSubscribe({ endpoint: json.endpoint, keys: json.keys, deviceId: getDeviceId() })
}

export function usePush() {
  useSyncExternalStore(subscribe, getSnapshot)
  return {
    supported: supported(),
    permission: typeof Notification !== 'undefined' ? Notification.permission : 'default',
    reminderFor: (fixtureId) => (fixtureId in reminders ? reminders[fixtureId] : null),
    async setReminder(fixtureId, leadMinutes) {
      await ensureSubscribed()
      await postReminder(getDeviceId(), fixtureId, leadMinutes)
      reminders = { ...reminders, [fixtureId]: leadMinutes }
      emit()
    },
    async clearReminder(fixtureId) {
      await deleteReminder(getDeviceId(), fixtureId)
      const next = { ...reminders }; delete next[fixtureId]
      reminders = next
      emit()
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w web -- src/hooks/usePush.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/usePush.js web/src/hooks/usePush.test.jsx
git commit -m "feat(web): usePush shared store for subscriptions and reminders"
```

---

## Task 10: `ReminderBell` component

**Files:**
- Create: `web/src/ReminderBell.jsx`
- Test: `web/src/ReminderBell.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/ReminderBell.test.jsx`:
```js
import { expect, test, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { ReminderBell } from './ReminderBell.jsx'

const push = vi.hoisted(() => ({ value: {} }))
vi.mock('./hooks/usePush.js', () => ({ usePush: () => push.value }))

function setPush(over) {
  push.value = {
    supported: true, permission: 'granted',
    reminderFor: () => null, setReminder: vi.fn().mockResolvedValue(), clearReminder: vi.fn().mockResolvedValue(),
    ...over,
  }
}
beforeEach(() => setPush())
afterEach(cleanup)

const upcoming = { id: 'f1', status: 'upcoming' }

test('renders nothing when push is unsupported', () => {
  setPush({ supported: false })
  const { container } = render(<ReminderBell f={upcoming} />)
  expect(container).toBeEmptyDOMElement()
})

test('renders nothing for a non-upcoming fixture', () => {
  const { container } = render(<ReminderBell f={{ id: 'f1', status: 'final' }} />)
  expect(container).toBeEmptyDOMElement()
})

test('tapping the off bell opens the lead-time menu and sets a reminder', async () => {
  const setReminder = vi.fn().mockResolvedValue()
  setPush({ setReminder })
  render(<ReminderBell f={upcoming} />)
  fireEvent.click(screen.getByRole('button', { name: /remind me/i }))
  fireEvent.click(screen.getByRole('button', { name: /30 min/i }))
  await waitFor(() => expect(setReminder).toHaveBeenCalledWith('f1', 30))
})

test('tapping an on bell clears the reminder', async () => {
  const clearReminder = vi.fn().mockResolvedValue()
  setPush({ reminderFor: () => 30, clearReminder })
  render(<ReminderBell f={upcoming} />)
  fireEvent.click(screen.getByRole('button', { name: /reminder set/i }))
  await waitFor(() => expect(clearReminder).toHaveBeenCalledWith('f1'))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w web -- src/ReminderBell.test.jsx`
Expected: FAIL — cannot find module `./ReminderBell.jsx`.

- [ ] **Step 3: Implement the component**

Create `web/src/ReminderBell.jsx`:
```js
import { useState } from 'react'
import { Icon } from './components.jsx'
import { usePush } from './hooks/usePush.js'

const LEADS = [
  { v: 15, label: '15 min before' },
  { v: 30, label: '30 min before' },
  { v: 60, label: '60 min before' },
  { v: 0, label: 'At kickoff' },
]

export function ReminderBell({ f, onToast }) {
  const { supported, reminderFor, setReminder, clearReminder } = usePush()
  const [menu, setMenu] = useState(false)
  if (!supported || f.status !== 'upcoming') return null

  const lead = reminderFor(f.id)
  const on = lead !== null

  async function pick(v) {
    setMenu(false)
    try { await setReminder(f.id, v); onToast && onToast(v > 0 ? `Reminder set — ${v} min before` : 'Reminder set — at kickoff') }
    catch (e) {
      if (e.message === 'permission_denied') onToast && onToast('Notifications are blocked')
      else onToast && onToast("Couldn't set reminder")
    }
  }
  async function toggleOff(e) {
    e.stopPropagation()
    try { await clearReminder(f.id); onToast && onToast('Reminder removed') }
    catch { onToast && onToast("Couldn't remove reminder") }
  }

  return (
    <span className="rbell-wrap" onClick={(e) => e.stopPropagation()}>
      {on ? (
        <button className="rbell on" aria-label="Reminder set — tap to remove" onClick={toggleOff}>
          <Icon.bolt/><span className="rbell-lead">{lead > 0 ? `${lead}m` : 'KO'}</span>
        </button>
      ) : (
        <button className="rbell" aria-label="Remind me before this match" onClick={() => setMenu((m) => !m)}>
          <Icon.bolt/>
        </button>
      )}
      {menu && (
        <div className="rbell-menu" role="menu">
          {LEADS.map((l) => (
            <button key={l.v} role="menuitem" className="rbell-item" onClick={() => pick(l.v)}>{l.label}</button>
          ))}
        </div>
      )}
    </span>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w web -- src/ReminderBell.test.jsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Add styles**

In `web/src/styles.css`, append:
```css
/* ===== reminder bell ===== */
.rbell-wrap{position:relative; display:inline-flex;}
.rbell{display:inline-flex; align-items:center; gap:4px; color:var(--muted2); padding:4px; border-radius:8px;}
.rbell.on{color:var(--accent);}
.rbell svg{width:16px; height:16px;}
.rbell-lead{font-size:11px; font-weight:800; font-family:'Barlow Condensed';}
.rbell-menu{position:absolute; right:0; top:calc(100% + 6px); z-index:40; background:#fff; border:1px solid var(--line); border-radius:12px; box-shadow:0 14px 30px -12px rgba(11,31,58,.5); overflow:hidden; min-width:150px;}
.rbell-item{display:block; width:100%; text-align:left; padding:10px 13px; font-size:13.5px; font-weight:600; color:var(--navy);}
.rbell-item:active{background:var(--card);}
.rbell-item + .rbell-item{border-top:1px solid var(--line);}
```

- [ ] **Step 6: Commit**

```bash
git add web/src/ReminderBell.jsx web/src/ReminderBell.test.jsx web/src/styles.css
git commit -m "feat(web): ReminderBell control with lead-time menu"
```

---

## Task 11: Wire the bell in + register the service worker

**Files:**
- Modify: `web/src/components.jsx` (MatchCard)
- Modify: `web/src/screens-detail.jsx` (MatchSheet)
- Modify: `web/src/main.jsx`

- [ ] **Step 1: Import and render the bell in MatchCard**

In `web/src/components.jsx`, add the import near the top (with the other local imports):
```js
import { ReminderBell } from './ReminderBell.jsx'
```

In `MatchCard`, find the header row that renders `<WatchBtn id={f.id} compact onToast={onToast} />` and place the bell before it:
```jsx
          <ReminderBell f={f} onToast={onToast} />
          <WatchBtn id={f.id} compact onToast={onToast} />
```

- [ ] **Step 2: Render the bell in MatchSheet**

In `web/src/screens-detail.jsx`, add the import:
```js
import { ReminderBell } from './ReminderBell.jsx'
```
In the `MatchSheet` component header (where the close button / title sits — locate the `sheet-head` for the match sheet), add a `<ReminderBell f={f} onToast={onToast} />` next to the existing controls so the full menu is available from the sheet.

- [ ] **Step 3: Register the service worker on load**

In `web/src/main.jsx`, after the `ReactDOM.createRoot(...).render(...)` call, add:
```js
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* push just won't be available */ })
  })
}
```

- [ ] **Step 4: Run the full web suite + build**

Run: `npm run test -w web`
Expected: PASS (all suites green).
Run: `npm run build -w web`
Expected: build succeeds; `dist/sw.js` exists.

- [ ] **Step 5: Commit**

```bash
git add web/src/components.jsx web/src/screens-detail.jsx web/src/main.jsx
git commit -m "feat(web): show ReminderBell on match card + sheet, register SW"
```

---

## Task 12: Config + docs

**Files:**
- Modify: `.env.example`
- Modify: `docker/.env.docker.example`
- Modify: `docker/docker-compose.yml`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add VAPID vars to env examples**

In `.env.example` add:
```
# Web Push (generate once: npx web-push generate-vapid-keys)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:you@example.com
```
Add the same three keys to `docker/.env.docker.example`.

- [ ] **Step 2: Pass VAPID env to the api and worker services**

In `docker/docker-compose.yml`, in the `environment:` block of both the api and worker services, add:
```yaml
      - VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY}
      - VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY}
      - VAPID_SUBJECT=${VAPID_SUBJECT}
```

- [ ] **Step 3: Document the env vars + generation step**

In `CLAUDE.md`, add a row to the env-vars table:
```
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | 2 | Web Push; generate once via `npx web-push generate-vapid-keys` |
```

- [ ] **Step 4: Generate real keys (human step) and add to local `.env`**

Run:
```bash
npx web-push generate-vapid-keys
```
Copy `Public Key` → `VAPID_PUBLIC_KEY`, `Private Key` → `VAPID_PRIVATE_KEY` in the git-ignored root `.env`, and set `VAPID_SUBJECT` to a real `mailto:`. (Do not commit real keys.)

- [ ] **Step 5: Commit**

```bash
git add .env.example docker/.env.docker.example docker/docker-compose.yml CLAUDE.md
git commit -m "chore: VAPID env wiring and docs for web push"
```

---

## Task 13: Full verification

- [ ] **Step 1: Run the whole test suite**

Run from repo root:
```bash
npm run test           # api (Vitest + Testcontainers)
npm run test -w web  # web
```
Expected: all green.

- [ ] **Step 2: Build the web app**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manual on-device check (cannot be unit-tested)**

Deploy, then on an **installed** PWA (Android and an iOS 16.4+ home-screen install):
1. Open an upcoming match, tap the bell, choose "At kickoff" (or set a fixture's kickoff a few minutes out in a test DB).
2. Grant the notification permission when prompted.
3. Fully close the app.
4. Confirm the notification arrives at the due time and tapping it opens the app at home.

---

## Self-Review Notes

- **Spec coverage:** two tables (Task 2) ✓; subscribe/unsubscribe/key (Task 3) ✓; reminders CRUD with dedupe + sent_at reset (Task 4) ✓; worker due-window with 5m recovery + exactly-once + 410 prune (Task 5–6) ✓; notifications-only SW (Task 7) ✓; usePush shared store (Task 9) ✓; ReminderBell state machine + lead menu + unsupported handling (Task 10–11) ✓; web-push + VAPID env (Task 1, 12) ✓; per-device id (Task 8) ✓; tap opens app at `/` (Task 7) ✓.
- **Spec deviation:** the spec said "reuse the existing per-device id"; exploration found none (social keys on `personId`), so Task 8 introduces `deviceId`. Tables already use `device_id`, so no schema change.
- **Type consistency:** `usePush` exposes `reminderFor/setReminder/clearReminder` and is consumed exactly so in `ReminderBell`. Worker `dueReminders/sendDueReminders` signatures match their tests and `worker.js` call site. Client helper names match `usePush` imports.
