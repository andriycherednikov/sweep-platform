# Phase 5 — Photos + Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real moderated photo uploads (fan **and** profile), a cookie-gated admin who approves/rejects/removes from a single queue, approved fan photos + profile avatars going live everywhere via SSE — replacing the frontend's faked upload and the client-side `2026` passcode.

**Architecture:** Uploads come in as multipart to `POST /api/photos`; the server validates (type allowlist + 8 MB cap), **re-encodes via `sharp` (which strips EXIF)**, writes a thumbnail, stores the file in a **pending** directory that is never web-served, and inserts a `photo` row with `status='pending'`. Admin auth is a bcrypt check against a hashed env passcode that sets an httpOnly, signed, short-TTL cookie; all `/api/admin/*` routes verify it (login + upload rate-limited). Approving **moves** the file from the pending dir into the **approved** dir (served at `/photos` by `@fastify/static` in dev, by Caddy in prod) and flips status; approving a `profile` photo also sets the person's `avatar_path` (superseding any prior). Each moderation emits an SSE `photo-approved`/`photo-removed` event so fan photos and avatars update live. The `photo` table and `person.avatar_path` column already exist (Phase 1) — **no migration needed**.

**Tech Stack:** Fastify 5 plugins `@fastify/multipart`, `@fastify/static`, `@fastify/cookie`, `@fastify/rate-limit`; `sharp` (image re-encode/resize/thumbnail); `bcryptjs` (pure-JS, no native build — safe in containers). Tests: Vitest + `@testcontainers/postgresql` + `form-data` (dev) for multipart inject. Web: native `FormData`, existing TanStack Query + `useEventStream`.

---

## Decisions locked for this plan

- **`bcryptjs`, not `bcrypt`** — pure JS, no node-gyp; avoids Docker build pain. `ADMIN_PASSCODE` holds a **bcrypt hash** (spec §6). A helper `npm run admin:hash -w api -- <passcode>` prints a hash to paste into `.env`.
- **Photos root** = `PHOTOS_DIR` (default `./photos-data` in dev). Two subdirs: `pending/` (api-only) and `approved/` (served at `/photos`). Created on boot if missing.
- **Pending images are admin-only**, streamed through `GET /api/admin/photos/:id/file` (cookie-checked) — never via `/photos`. The key kid-safety guarantee.
- **`photo.filePath`/`thumbPath` store only the basename**; the served URL is `/photos/<basename>` (matches the existing `GET /api/photos`). Approving moves `pending/<basename>` → `approved/<basename>`.
- **SSE events:** `{type:'photo-approved'}` and `{type:'photo-removed'}`; the web maps both to invalidating `['sweep']` (the bundle that carries photos + people/avatars).
- **Out of scope (not Phase 5):** admin fixture-overrides, admin sweep-data edits, `POST /api/admin/sync` (spec §6 mentions these as further admin powers; build-order §8 step 5 scopes Phase 5 to photos + admin auth + moderation). Note them for Phase 6/later.

---

## File Structure

**New (api):**
- `api/src/photos/process.js` — `validateUpload(mimetype, size)` + `processImage(buffer, kind)` → `{ buffer, thumb, ext }` (sharp).
- `api/src/photos/storage.js` — dir resolution + `writePending`, `moveToApproved`, `removeApproved`, `pendingPath`, `fileFor`.
- `api/src/auth.js` — `verifyPasscode(passcode, hash)`, `requireAdmin` preHandler, cookie constants.
- `api/src/routes/admin.js` — `POST /api/admin/login`, `POST /api/admin/logout`, `GET /api/admin/me`, `GET /api/admin/photos`, `GET /api/admin/photos/:id/file`, `POST /api/admin/photos/:id`.
- `api/src/seed/admin-hash.js` — CLI: print a bcrypt hash for a passcode arg.

**New (api tests):** `api/test/photos-process.test.js`, `api/test/upload.test.js`, `api/test/admin-auth.test.js`, `api/test/admin-photos.test.js`.

**Modified (api):**
- `api/src/routes/photos.js` — add `POST /api/photos` (multipart upload).
- `api/src/app.js` — register multipart, cookie, rate-limit, static(`/photos`); decorate photo config + admin config; register `adminRoutes`.
- `api/package.json` — deps + `admin:hash` script.
- `.env.example` — `PHOTOS_DIR`, `ADMIN_PASSCODE`, `SESSION_SECRET`, `SITE_ORIGIN`.

**New (web):** none (extends existing files).

**Modified (web):**
- `web/src/api/client.js` — `uploadPhoto`, `adminLogin`, `adminLogout`, `fetchAdminMe`, `fetchAdminPhotos`, `moderatePhoto`.
- `web/src/components.jsx` — `Av` renders `avatarPath` with initials fallback.
- `web/src/hooks/useEventStream.js` — map `photo-approved`/`photo-removed` → invalidate `['sweep']`.
- `web/src/screens-detail.jsx` — real `UploadSheet` (fan **and** profile), real `AdminScreen` (server login) + `AdminQueue` (server queue/actions); profile-upload entry on `PersonDetail` (self only).
- Tests: `web/src/api/client.test.js`, `web/src/components.test.jsx` (new), `web/src/hooks/useEventStream.test.jsx`.

---

## Chunk A — Upload pipeline (Tasks 1–4)

### Task 1: Dependencies, env, photo storage dirs

**Files:**
- Modify: `api/package.json`, `.env.example`
- Create: `api/src/photos/storage.js`, `api/src/seed/admin-hash.js`
- Test: (verified by build/install + Task 3 usage; storage gets a focused test in Step 4 here)

- [ ] **Step 1: Install dependencies**

Run:
```bash
npm install -w api @fastify/multipart @fastify/static @fastify/cookie @fastify/rate-limit sharp bcryptjs
npm install -w api -D form-data
```
Expected: `api/package.json` gains the deps; lockfile updates.

- [ ] **Step 2: Add the `admin:hash` script to `api/package.json`**

In the `"scripts"` block add:
```json
    "admin:hash": "node src/seed/admin-hash.js"
```

- [ ] **Step 3: Write the hash CLI**

```js
// api/src/seed/admin-hash.js
import bcrypt from 'bcryptjs'

const passcode = process.argv[2]
if (!passcode) { console.error('usage: npm run admin:hash -w api -- <passcode>'); process.exit(1) }
console.log(bcrypt.hashSync(passcode, 10))
```

- [ ] **Step 4: Write the failing test for storage**

```js
// api/test/photos-process.test.js  (storage half; processing added in Task 2)
import { expect, test, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStorage } from '../src/photos/storage.js'

let dir, store
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'sweep-photos-')); store = await createStorage(dir) })
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

test('writePending stores a file in pending/ and not in approved/', async () => {
  await store.writePending('a.jpg', Buffer.from('hello'))
  expect(await readFile(store.pendingPath('a.jpg'), 'utf8')).toBe('hello')
  await expect(access(join(dir, 'approved', 'a.jpg'))).rejects.toThrow()
})

test('moveToApproved relocates pending → approved', async () => {
  await store.writePending('b.jpg', Buffer.from('img'))
  await store.moveToApproved('b.jpg')
  expect(await readFile(join(dir, 'approved', 'b.jpg'), 'utf8')).toBe('img')
  await expect(access(store.pendingPath('b.jpg'))).rejects.toThrow()
})

test('removeApproved deletes the served file', async () => {
  await store.writePending('c.jpg', Buffer.from('x')); await store.moveToApproved('c.jpg')
  await store.removeApproved('c.jpg')
  await expect(access(join(dir, 'approved', 'c.jpg'))).rejects.toThrow()
})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm run test -w api -- photos-process`
Expected: FAIL — cannot find `../src/photos/storage.js`.

- [ ] **Step 6: Implement storage**

```js
// api/src/photos/storage.js
import { mkdir, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

/** Resolve the photos root into pending/ + approved/ subdirs (created if missing). */
export async function createStorage(rootDir) {
  const pendingDir = join(rootDir, 'pending')
  const approvedDir = join(rootDir, 'approved')
  await mkdir(pendingDir, { recursive: true })
  await mkdir(approvedDir, { recursive: true })
  return {
    approvedDir,
    pendingPath: (name) => join(pendingDir, name),
    approvedPath: (name) => join(approvedDir, name),
    writePending: (name, buf) => writeFile(join(pendingDir, name), buf),
    moveToApproved: (name) => rename(join(pendingDir, name), join(approvedDir, name)),
    removePending: (name) => rm(join(pendingDir, name), { force: true }),
    removeApproved: (name) => rm(join(approvedDir, name), { force: true }),
  }
}
```

- [ ] **Step 7: Add env vars to `.env.example`**

Append:
```
# Phase 5 — photos + admin
# PHOTOS_DIR holds pending/ (api-only) + approved/ (served at /photos)
PHOTOS_DIR=./photos-data
# bcrypt hash of the admin passcode — generate with: npm run admin:hash -w api -- <passcode>
ADMIN_PASSCODE=
# secret that signs the admin session cookie (any long random string)
SESSION_SECRET=
# allowed browser origin in prod (Phase 6); unused in dev
SITE_ORIGIN=http://localhost:5173
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm run test -w api -- photos-process`
Expected: PASS (3 tests).

- [ ] **Step 9: Add `photos-data/` to `.gitignore`**

Ensure the repo root `.gitignore` contains a line `photos-data/` (and `api/photos-data/`) so uploaded files are never committed. Append if missing.

- [ ] **Step 10: Commit**

```bash
git add api/package.json package-lock.json api/src/photos/storage.js api/src/seed/admin-hash.js api/test/photos-process.test.js .env.example .gitignore
git commit -m "chore(api): photo deps, storage dirs, admin-hash CLI, env scaffolding"
```

---

### Task 2: Image processing (validate + re-encode + thumbnail) with `sharp`

**Files:**
- Create: `api/src/photos/process.js`
- Test: `api/test/photos-process.test.js` (append)

- [ ] **Step 1: Write the failing test (append)**

```js
import sharp from 'sharp'
import { validateUpload, processImage, ALLOWED_MIME, MAX_BYTES } from '../src/photos/process.js'

const png = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer()

test('validateUpload accepts jpeg/png/webp under the cap and rejects others', () => {
  expect(validateUpload('image/png', 1000)).toBeNull()
  expect(validateUpload('image/gif', 1000)).toMatch(/type/i)
  expect(validateUpload('image/png', MAX_BYTES + 1)).toMatch(/large/i)
  expect(ALLOWED_MIME).toContain('image/webp')
})

test('processImage(fan) re-encodes to jpeg and produces a thumb', async () => {
  const out = await processImage(await png(2000, 1000), 'fan')
  expect(out.ext).toBe('jpg')
  const meta = await sharp(out.buffer).metadata()
  expect(meta.format).toBe('jpeg')
  expect(meta.width).toBeLessThanOrEqual(1280) // fan: max width 1280, aspect kept
  const tmeta = await sharp(out.thumb).metadata()
  expect(tmeta.width).toBe(320)
})

test('processImage(profile) crops to a 256×256 square', async () => {
  const out = await processImage(await png(800, 400), 'profile')
  const meta = await sharp(out.buffer).metadata()
  expect(meta.width).toBe(256)
  expect(meta.height).toBe(256)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w api -- photos-process`
Expected: FAIL — cannot find `../src/photos/process.js`.

- [ ] **Step 3: Implement processing**

```js
// api/src/photos/process.js
import sharp from 'sharp'

export const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp']
export const MAX_BYTES = 8 * 1024 * 1024 // 8 MB

/** Returns an error string if invalid, else null. */
export function validateUpload(mimetype, size) {
  if (!ALLOWED_MIME.includes(mimetype)) return 'unsupported file type (jpg, png, webp only)'
  if (size > MAX_BYTES) return 'file too large (8 MB max)'
  return null
}

/**
 * Re-encode (this strips EXIF/metadata), resize, and thumbnail.
 * fan  → max width 1280, aspect kept. profile → 256×256 cover-cropped square.
 * @returns {Promise<{buffer: Buffer, thumb: Buffer, ext: 'jpg'}>}
 */
export async function processImage(input, kind) {
  const base = sharp(input).rotate() // honor orientation, then drop metadata on output
  const main = kind === 'profile'
    ? base.resize(256, 256, { fit: 'cover', position: 'attention' })
    : base.resize({ width: 1280, withoutEnlargement: true })
  const buffer = await main.jpeg({ quality: 82 }).toBuffer()
  const thumb = await sharp(buffer).resize({ width: 320, withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer()
  return { buffer, thumb, ext: 'jpg' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w api -- photos-process`
Expected: PASS (6 tests total in the file).

- [ ] **Step 5: Commit**

```bash
git add api/src/photos/process.js api/test/photos-process.test.js
git commit -m "feat(api): sharp image pipeline — validate, EXIF-strip re-encode, thumbnail"
```

---

### Task 3: `POST /api/photos` multipart upload route

**Files:**
- Modify: `api/src/routes/photos.js`, `api/src/app.js`
- Test: `api/test/upload.test.js`

`POST /api/photos` accepts `kind`, `uploaderName`, optional `personId` (profile) / `teamCode` (fan), and `file`.
Enforces **one pending per person per kind**. Writes the processed file to `pending/` and inserts a `pending` row.

- [ ] **Step 1: Write the failing test**

```js
// api/test/upload.test.js
import { expect, test, afterAll, beforeEach, beforeAll } from 'vitest'
import { mkdtemp, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import FormData from 'form-data'
import sharp from 'sharp'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { photo, person, team, fixture } from '../src/db/schema.js'
import { createStorage } from '../src/photos/storage.js'

const { pool, db } = openTestDb()
let dir, store, app
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sweep-up-'))
  store = await createStorage(dir)
  app = buildApp(db, { photosDir: dir })
  await app.ready()
})
afterAll(async () => { await app.close(); await pool.end(); await rm(dir, { recursive: true, force: true }) })
beforeEach(async () => { await db.delete(photo) })

const png = () => sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 5, g: 5, b: 5 } } }).png().toBuffer()

async function upload(fields, file) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  if (file) form.append('file', file, { filename: 'pic.png', contentType: 'image/png' })
  return app.inject({ method: 'POST', url: '/api/photos', headers: form.getHeaders(), payload: form.getBuffer() })
}
async function aTeam() { const [t] = await db.select().from(team).limit(1); return t }
async function aPerson() { const [p] = await db.select().from(person).limit(1); return p }

test('uploads a fan photo → pending row + file written to pending dir', async () => {
  const t = await aTeam()
  const res = await upload({ kind: 'fan', uploaderName: 'Priya', teamCode: t.code, caption: 'colours!' }, await png())
  expect(res.statusCode).toBe(201)
  const body = res.json()
  expect(body).toMatchObject({ kind: 'fan', status: 'pending', teamCode: t.code })
  const rows = await db.select().from(photo)
  expect(rows).toHaveLength(1)
  await access(store.pendingPath(rows[0].filePath)) // exists in pending, no throw
})

test('rejects a non-image file type', async () => {
  const t = await aTeam()
  const form = new FormData()
  form.append('kind', 'fan'); form.append('uploaderName', 'X'); form.append('teamCode', t.code)
  form.append('file', Buffer.from('not an image'), { filename: 'x.gif', contentType: 'image/gif' })
  const res = await app.inject({ method: 'POST', url: '/api/photos', headers: form.getHeaders(), payload: form.getBuffer() })
  expect(res.statusCode).toBe(400)
})

test('enforces one pending per person per kind (profile)', async () => {
  const p = await aPerson()
  const first = await upload({ kind: 'profile', uploaderName: p.name, personId: p.id }, await png())
  expect(first.statusCode).toBe(201)
  const second = await upload({ kind: 'profile', uploaderName: p.name, personId: p.id }, await png())
  expect(second.statusCode).toBe(409) // already has a pending profile
})

test('missing file → 400', async () => {
  const t = await aTeam()
  expect((await upload({ kind: 'fan', uploaderName: 'X', teamCode: t.code })).statusCode).toBe(400)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w api -- test/upload`
Expected: FAIL — `/api/photos` POST 404 / multipart not registered.

- [ ] **Step 3: Wire plugins + photo config in `api/src/app.js`**

Add imports:
```js
import multipart from '@fastify/multipart'
import fstatic from '@fastify/static'
import { createStorage } from './photos/storage.js'
import { MAX_BYTES } from './photos/process.js'
```

Convert `buildApp` to set up storage. The function stays **synchronous-returning** (tests call `await app.ready()`); register plugins and decorate from a resolved storage created inside an `app.register(async (app) => …)` is awkward — instead create storage eagerly via a top-level await is not possible in a sync function. Use this pattern: register `@fastify/multipart` immediately, and resolve storage in an `onReady` hook, decorating `app.photos`.

Replace the body of `buildApp` so it reads:
```js
export function buildApp(db, opts = {}) {
  const app = Fastify({ logger: opts.logger ?? false })
  app.decorate('db', db)
  app.decorate('bus', opts.bus ?? createBus())
  app.decorate('publish', opts.publish ?? ((event) => app.bus.publish(event)))

  const photosDir = opts.photosDir ?? process.env.PHOTOS_DIR ?? './photos-data'
  app.decorate('photos', null)
  app.register(multipart, { limits: { fileSize: MAX_BYTES, files: 1 } })
  app.addHook('onReady', async () => {
    const store = await createStorage(photosDir)
    app.photos = store
    // serve approved/ at /photos (in prod Caddy does this; harmless to also expose here)
    await app.register(fstatic, { root: store.approvedDir, prefix: '/photos/', decorateReply: false })
  })

  app.decorate('adminHash', opts.adminHash ?? process.env.ADMIN_PASSCODE ?? '')
  app.decorate('sessionSecret', opts.sessionSecret ?? process.env.SESSION_SECRET ?? 'dev-insecure-secret')

  app.get('/api/health', async () => ({ ok: true }))
  app.register(bootstrapRoutes)
  app.register(fixtureRoutes)
  app.register(standingsRoutes)
  app.register(peopleRoutes)
  app.register(teamRoutes)
  app.register(photoRoutes)
  app.register(syncStatusRoutes)
  app.register(streamRoutes)
  app.register(socialRoutes)
  return app
}
```
> Note: `@fastify/static` registered inside `onReady` requires `await app.register(...)` — Fastify allows registering plugins during `onReady`. If the runtime rejects late registration, fall back to resolving `photosDir` synchronously: create the dirs with a synchronous `mkdirSync` helper at the top of `buildApp` and register `fstatic` + decorate `app.photos` immediately (no `onReady`). Prefer whichever the installed Fastify 5 accepts; the synchronous fallback is simplest — add `import { mkdirSync } from 'node:fs'` and a `createStorageSync(dir)` variant in `storage.js` mirroring `createStorage`. **Use the synchronous variant if `onReady` registration throws.**

> Implementer guidance: the synchronous fallback is the recommended default. Add `createStorageSync(rootDir)` to `storage.js` (identical to `createStorage` but using `mkdirSync`), then in `buildApp`:
> ```js
> const store = createStorageSync(photosDir)
> app.decorate('photos', store)
> app.register(multipart, { limits: { fileSize: MAX_BYTES, files: 1 } })
> app.register(fstatic, { root: store.approvedDir, prefix: '/photos/', decorateReply: false })
> ```
> and drop the `onReady` block. This keeps `buildApp` synchronous and avoids late-registration risk.

- [ ] **Step 4: Add `createStorageSync` to `api/src/photos/storage.js`**

```js
import { mkdirSync } from 'node:fs'

export function createStorageSync(rootDir) {
  const pendingDir = join(rootDir, 'pending')
  const approvedDir = join(rootDir, 'approved')
  mkdirSync(pendingDir, { recursive: true })
  mkdirSync(approvedDir, { recursive: true })
  return {
    approvedDir,
    pendingPath: (name) => join(pendingDir, name),
    approvedPath: (name) => join(approvedDir, name),
    writePending: (name, buf) => writeFile(join(pendingDir, name), buf),
    moveToApproved: (name) => rename(join(pendingDir, name), join(approvedDir, name)),
    removePending: (name) => rm(join(pendingDir, name), { force: true }),
    removeApproved: (name) => rm(join(approvedDir, name), { force: true }),
  }
}
```

- [ ] **Step 5: Implement `POST /api/photos` in `api/src/routes/photos.js`**

Replace the file with:
```js
import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { photo, person, team } from '../db/schema.js'
import { validateUpload, processImage } from '../photos/process.js'

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

  app.post('/api/photos', async (req, reply) => {
    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'missing_file' })
    const fields = data.fields
    const val = (k) => (fields[k] && typeof fields[k].value === 'string' ? fields[k].value : undefined)
    const kind = val('kind'), uploaderName = val('uploaderName')
    const personId = val('personId'), teamCode = val('teamCode'), caption = val('caption') ?? null

    if (kind !== 'fan' && kind !== 'profile') return reply.code(400).send({ error: 'bad_kind' })
    if (!uploaderName) return reply.code(400).send({ error: 'missing_uploader' })

    const buf = await data.toBuffer()
    if (data.file.truncated) return reply.code(400).send({ error: 'file too large (8 MB max)' })
    const verr = validateUpload(data.mimetype, buf.length)
    if (verr) return reply.code(400).send({ error: verr })

    if (kind === 'fan') {
      if (!teamCode) return reply.code(400).send({ error: 'missing_team' })
      const [t] = await app.db.select().from(team).where(eq(team.code, teamCode))
      if (!t) return reply.code(400).send({ error: 'unknown_team' })
    } else {
      if (!personId) return reply.code(400).send({ error: 'missing_person' })
      const [p] = await app.db.select().from(person).where(eq(person.id, personId))
      if (!p) return reply.code(400).send({ error: 'unknown_person' })
    }

    // one pending per person per kind
    const dupConds = [eq(photo.status, 'pending'), eq(photo.kind, kind)]
    dupConds.push(kind === 'profile' ? eq(photo.personId, personId) : eq(photo.uploaderName, uploaderName))
    const dup = await app.db.select().from(photo).where(and(...dupConds))
    if (dup.length) return reply.code(409).send({ error: 'pending_exists' })

    const { buffer, thumb, ext } = await processImage(buf, kind)
    const id = randomUUID()
    const fileName = `${id}.${ext}`
    const thumbName = `${id}_t.${ext}`
    await app.photos.writePending(fileName, buffer)
    await app.photos.writePending(thumbName, thumb)

    await app.db.insert(photo).values({
      id, kind, uploaderName,
      personId: kind === 'profile' ? personId : null,
      teamCode: kind === 'fan' ? teamCode : null,
      filePath: fileName, thumbPath: thumbName, caption, status: 'pending',
    })
    return reply.code(201).send({ id, kind, status: 'pending', teamCode: teamCode ?? null, personId: personId ?? null })
  })
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test -w api -- test/upload`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add api/src/routes/photos.js api/src/app.js api/src/photos/storage.js api/test/upload.test.js
git commit -m "feat(api): POST /api/photos multipart upload — validate, process, queue pending"
```

---

### Task 4: Chunk-A verification

- [ ] Run `npm run test -w api` → all green (new `photos-process`, `upload` included).
- [ ] Commit nothing; this is a checkpoint.

---

## Chunk B — Admin auth + moderation (Tasks 5–7)

### Task 5: Admin auth — login/logout/me + `requireAdmin`

**Files:**
- Create: `api/src/auth.js`, `api/src/routes/admin.js`
- Modify: `api/src/app.js` (register cookie, rate-limit, `adminRoutes`)
- Test: `api/test/admin-auth.test.js`

- [ ] **Step 1: Write the failing test**

```js
// api/test/admin-auth.test.js
import { expect, test, afterAll, beforeAll } from 'vitest'
import bcrypt from 'bcryptjs'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'

const { pool, db } = openTestDb()
const PASS = '1234'
const app = buildApp(db, { adminHash: bcrypt.hashSync(PASS, 8), sessionSecret: 'test-secret-please-change' })
beforeAll(async () => { await app.ready() })
afterAll(async () => { await app.close(); await pool.end() })

test('GET /api/admin/me is 401 without a cookie', async () => {
  expect((await app.inject({ method: 'GET', url: '/api/admin/me' })).statusCode).toBe(401)
})

test('login with the wrong passcode is 401, no cookie', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { passcode: 'oops' } })
  expect(res.statusCode).toBe(401)
  expect(res.headers['set-cookie']).toBeUndefined()
})

test('login → cookie → /api/admin/me is 200', async () => {
  const login = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { passcode: PASS } })
  expect(login.statusCode).toBe(200)
  const cookie = login.headers['set-cookie']
  expect(cookie).toMatch(/sweep_admin=/)
  expect(cookie).toMatch(/HttpOnly/i)
  const me = await app.inject({ method: 'GET', url: '/api/admin/me', headers: { cookie } })
  expect(me.statusCode).toBe(200)
  expect(me.json()).toMatchObject({ admin: true })
})

test('logout clears the cookie', async () => {
  const login = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { passcode: PASS } })
  const cookie = login.headers['set-cookie']
  const out = await app.inject({ method: 'POST', url: '/api/admin/logout', headers: { cookie } })
  expect(out.statusCode).toBe(200)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w api -- admin-auth`
Expected: FAIL — admin routes 404.

- [ ] **Step 3: Implement auth helpers**

```js
// api/src/auth.js
import bcrypt from 'bcryptjs'

export const ADMIN_COOKIE = 'sweep_admin'
export const COOKIE_MAX_AGE = 8 * 3600 // 8h, seconds

export function verifyPasscode(passcode, hash) {
  if (!hash || !passcode) return false
  try { return bcrypt.compareSync(passcode, hash) } catch { return false }
}

/** Fastify preHandler: 401 unless a valid signed admin cookie is present. */
export function requireAdmin(app) {
  return async (req, reply) => {
    const raw = req.cookies?.[ADMIN_COOKIE]
    if (!raw) return reply.code(401).send({ error: 'unauthorized' })
    const un = app.unsignCookie(raw)
    if (!un.valid || un.value !== 'ok') return reply.code(401).send({ error: 'unauthorized' })
  }
}
```

- [ ] **Step 4: Implement admin routes (login/logout/me)**

```js
// api/src/routes/admin.js
import { ADMIN_COOKIE, COOKIE_MAX_AGE, verifyPasscode, requireAdmin } from '../auth.js'

const loginBody = {
  type: 'object', required: ['passcode'], additionalProperties: false,
  properties: { passcode: { type: 'string', minLength: 1, maxLength: 200 } },
}

export async function adminRoutes(app) {
  const admin = requireAdmin(app)

  app.post('/api/admin/login', {
    schema: { body: loginBody },
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (req, reply) => {
    if (!verifyPasscode(req.body.passcode, app.adminHash)) return reply.code(401).send({ error: 'bad_passcode' })
    reply.setCookie(ADMIN_COOKIE, reply.signCookie('ok'), {
      httpOnly: true, sameSite: 'lax', path: '/', maxAge: COOKIE_MAX_AGE,
      secure: process.env.NODE_ENV === 'production',
    })
    return { admin: true }
  })

  app.post('/api/admin/logout', async (_req, reply) => {
    reply.clearCookie(ADMIN_COOKIE, { path: '/' })
    return { admin: false }
  })

  app.get('/api/admin/me', { preHandler: admin }, async () => ({ admin: true }))

  // photo queue + moderation added in Tasks 6 & 7 (same file, reuse `admin`).
}
```

- [ ] **Step 5: Register cookie + rate-limit + adminRoutes in `api/src/app.js`**

Add imports:
```js
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import { adminRoutes } from './routes/admin.js'
```
In `buildApp`, **before** registering routes, register the plugins (cookie needs the secret for signing):
```js
  app.register(cookie, { secret: opts.sessionSecret ?? process.env.SESSION_SECRET ?? 'dev-insecure-secret' })
  app.register(rateLimit, { global: false })
```
And alongside the other `app.register(...)` route calls:
```js
  app.register(adminRoutes)
```
> `signCookie`/`unsignCookie` are provided by `@fastify/cookie` once registered with a `secret`.

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test -w api -- admin-auth`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add api/src/auth.js api/src/routes/admin.js api/src/app.js api/test/admin-auth.test.js
git commit -m "feat(api): admin auth — bcrypt login, signed httpOnly cookie, requireAdmin"
```

---

### Task 6: Admin photo queue — list + pending file stream

**Files:**
- Modify: `api/src/routes/admin.js`
- Test: `api/test/admin-photos.test.js`

- [ ] **Step 1: Write the failing test**

```js
// api/test/admin-photos.test.js
import { expect, test, afterAll, beforeAll, beforeEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { photo, person, team } from '../src/db/schema.js'

const { pool, db } = openTestDb()
const PASS = '1234'
let dir, app, cookie
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sweep-adm-'))
  app = buildApp(db, { photosDir: dir, adminHash: bcrypt.hashSync(PASS, 8), sessionSecret: 's' })
  await app.ready()
  cookie = (await app.inject({ method: 'POST', url: '/api/admin/login', payload: { passcode: PASS } })).headers['set-cookie']
})
afterAll(async () => { await app.close(); await pool.end(); await rm(dir, { recursive: true, force: true }) })
beforeEach(async () => { await db.delete(photo) })

async function seedPending() {
  const [t] = await db.select().from(team).limit(1)
  await app.photos.writePending('z.jpg', Buffer.from('img'))
  await db.insert(photo).values({ id: 'ph1', kind: 'fan', uploaderName: 'Priya', teamCode: t.code, filePath: 'z.jpg', thumbPath: 'z.jpg', caption: 'hi', status: 'pending' })
  return t
}

test('GET /api/admin/photos requires auth', async () => {
  expect((await app.inject({ method: 'GET', url: '/api/admin/photos' })).statusCode).toBe(401)
})

test('GET /api/admin/photos lists pending + approved with kind/subject tags', async () => {
  const t = await seedPending()
  const res = await app.inject({ method: 'GET', url: '/api/admin/photos', headers: { cookie } })
  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.pending).toHaveLength(1)
  expect(body.pending[0]).toMatchObject({ id: 'ph1', kind: 'fan', team: t.code, status: 'pending' })
  expect(body.pending[0].fileUrl).toBe('/api/admin/photos/ph1/file')
})

test('GET /api/admin/photos/:id/file streams the pending image to the admin', async () => {
  await seedPending()
  const res = await app.inject({ method: 'GET', url: '/api/admin/photos/ph1/file', headers: { cookie } })
  expect(res.statusCode).toBe(200)
  expect(res.headers['content-type']).toMatch(/image\//)
  expect(res.rawPayload.toString()).toBe('img')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w api -- admin-photos`
Expected: FAIL — `/api/admin/photos` 404.

- [ ] **Step 3: Implement the queue + file stream (add inside `adminRoutes`, after `/api/admin/me`)**

Add imports at the top of `api/src/routes/admin.js`:
```js
import { createReadStream } from 'node:fs'
import { and, eq, desc } from 'drizzle-orm'
import { photo } from '../db/schema.js'
```
Then inside `adminRoutes`:
```js
  app.get('/api/admin/photos', { preHandler: admin }, async () => {
    const rows = await app.db.select().from(photo).orderBy(desc(photo.createdAt))
    const shape = (p) => ({
      id: p.id, kind: p.kind, uploader: p.uploaderName, person: p.personId, team: p.teamCode,
      caption: p.caption, status: p.status, createdAt: p.createdAt,
      fileUrl: `/api/admin/photos/${p.id}/file`,
    })
    return {
      pending: rows.filter((p) => p.status === 'pending').map(shape),
      approved: rows.filter((p) => p.status === 'approved').map(shape),
    }
  })

  app.get('/api/admin/photos/:id/file', { preHandler: admin }, async (req, reply) => {
    const [p] = await app.db.select().from(photo).where(eq(photo.id, req.params.id))
    if (!p) return reply.code(404).send({ error: 'not_found' })
    const path = p.status === 'approved' ? app.photos.approvedPath(p.filePath) : app.photos.pendingPath(p.filePath)
    reply.type('image/jpeg')
    return reply.send(createReadStream(path))
  })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w api -- admin-photos`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/admin.js api/test/admin-photos.test.js
git commit -m "feat(api): admin photo queue + cookie-gated pending file stream"
```

---

### Task 7: Moderate — approve / reject / remove (+ profile avatar + SSE)

**Files:**
- Modify: `api/src/routes/admin.js`
- Test: `api/test/admin-photos.test.js` (append)

- [ ] **Step 1: Write the failing test (append)**

```js
import { person as personT } from '../src/db/schema.js'

test('approve a fan photo → moves file, status approved, emits photo-approved', async () => {
  const published = []
  const app2 = buildApp(db, { photosDir: dir, adminHash: bcrypt.hashSync(PASS, 8), sessionSecret: 's', publish: (e) => published.push(e) })
  await app2.ready()
  const ck = (await app2.inject({ method: 'POST', url: '/api/admin/login', payload: { passcode: PASS } })).headers['set-cookie']
  const [t] = await db.select().from(team).limit(1)
  await app2.photos.writePending('appr.jpg', Buffer.from('img'))
  await db.insert(photo).values({ id: 'ph2', kind: 'fan', uploaderName: 'Priya', teamCode: t.code, filePath: 'appr.jpg', thumbPath: 'appr.jpg', status: 'pending' })

  const res = await app2.inject({ method: 'POST', url: '/api/admin/photos/ph2', headers: { cookie: ck }, payload: { action: 'approve' } })
  expect(res.statusCode).toBe(200)
  const [row] = await db.select().from(photo).where(eq(photo.id, 'ph2'))
  expect(row.status).toBe('approved')
  expect(published).toContainEqual({ type: 'photo-approved', id: 'ph2', kind: 'fan', team: t.code })
  await app2.close()
})

test('approve a profile photo sets person.avatar_path and supersedes prior', async () => {
  const [p] = await db.select().from(personT).limit(1)
  await app.photos.writePending('prof.jpg', Buffer.from('img'))
  await db.insert(photo).values({ id: 'ph3', kind: 'profile', uploaderName: p.name, personId: p.id, filePath: 'prof.jpg', thumbPath: 'prof.jpg', status: 'pending' })
  const res = await app.inject({ method: 'POST', url: '/api/admin/photos/ph3', headers: { cookie }, payload: { action: 'approve' } })
  expect(res.statusCode).toBe(200)
  const [pp] = await db.select().from(personT).where(eq(personT.id, p.id))
  expect(pp.avatarPath).toBe('/photos/prof.jpg')
})

test('reject leaves no served file and marks rejected', async () => {
  await seedPending()
  const res = await app.inject({ method: 'POST', url: '/api/admin/photos/ph1', headers: { cookie }, payload: { action: 'reject' } })
  expect(res.statusCode).toBe(200)
  const [row] = await db.select().from(photo).where(eq(photo.id, 'ph1'))
  expect(row.status).toBe('rejected')
})

test('remove an approved profile reverts the person to initials and emits photo-removed', async () => {
  const published = []
  const app3 = buildApp(db, { photosDir: dir, adminHash: bcrypt.hashSync(PASS, 8), sessionSecret: 's', publish: (e) => published.push(e) })
  await app3.ready()
  const ck = (await app3.inject({ method: 'POST', url: '/api/admin/login', payload: { passcode: PASS } })).headers['set-cookie']
  const [p] = await db.select().from(personT).limit(1)
  await app3.photos.writePending('rm.jpg', Buffer.from('img')); await app3.photos.moveToApproved('rm.jpg')
  await db.update(personT).set({ avatarPath: '/photos/rm.jpg' }).where(eq(personT.id, p.id))
  await db.insert(photo).values({ id: 'ph4', kind: 'profile', uploaderName: p.name, personId: p.id, filePath: 'rm.jpg', thumbPath: 'rm.jpg', status: 'approved' })

  const res = await app3.inject({ method: 'POST', url: '/api/admin/photos/ph4', headers: { cookie: ck }, payload: { action: 'remove' } })
  expect(res.statusCode).toBe(200)
  const [pp] = await db.select().from(personT).where(eq(personT.id, p.id))
  expect(pp.avatarPath).toBe(null)
  expect(published).toContainEqual({ type: 'photo-removed', id: 'ph4', kind: 'profile', person: p.id })
  await app3.close()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w api -- admin-photos`
Expected: FAIL — moderation route 404.

- [ ] **Step 3: Implement moderation (add inside `adminRoutes`; add `person` import)**

Extend the schema import: `import { photo, person } from '../db/schema.js'`. Then add:
```js
  const moderateBody = {
    type: 'object', required: ['action'], additionalProperties: false,
    properties: { action: { type: 'string', enum: ['approve', 'reject', 'remove'] } },
  }

  app.post('/api/admin/photos/:id', { preHandler: admin, schema: { body: moderateBody } }, async (req, reply) => {
    const { id } = req.params
    const { action } = req.body
    const [p] = await app.db.select().from(photo).where(eq(photo.id, id))
    if (!p) return reply.code(404).send({ error: 'not_found' })

    if (action === 'approve') {
      // supersede a prior approved profile photo for this person
      if (p.kind === 'profile') {
        const prior = await app.db.select().from(photo)
          .where(and(eq(photo.kind, 'profile'), eq(photo.personId, p.personId), eq(photo.status, 'approved')))
        for (const old of prior) {
          await app.photos.removeApproved(old.filePath)
          await app.db.update(photo).set({ status: 'removed', moderatedAt: new Date() }).where(eq(photo.id, old.id))
        }
      }
      await app.photos.moveToApproved(p.filePath)
      if (p.thumbPath) await app.photos.moveToApproved(p.thumbPath).catch(() => {})
      await app.db.update(photo).set({ status: 'approved', moderatedAt: new Date() }).where(eq(photo.id, id))
      if (p.kind === 'profile') {
        await app.db.update(person).set({ avatarPath: `/photos/${p.filePath}` }).where(eq(person.id, p.personId))
      }
      await app.publish({ type: 'photo-approved', id, kind: p.kind, ...(p.kind === 'fan' ? { team: p.teamCode } : { person: p.personId }) })
      return { id, status: 'approved' }
    }

    if (action === 'reject') {
      await app.photos.removePending(p.filePath)
      if (p.thumbPath) await app.photos.removePending(p.thumbPath).catch(() => {})
      await app.db.update(photo).set({ status: 'rejected', moderatedAt: new Date() }).where(eq(photo.id, id))
      return { id, status: 'rejected' }
    }

    // remove (an approved photo)
    await app.photos.removeApproved(p.filePath)
    if (p.thumbPath) await app.photos.removeApproved(p.thumbPath).catch(() => {})
    await app.db.update(photo).set({ status: 'removed', moderatedAt: new Date() }).where(eq(photo.id, id))
    if (p.kind === 'profile' && p.personId) {
      await app.db.update(person).set({ avatarPath: null }).where(eq(person.id, p.personId))
    }
    await app.publish({ type: 'photo-removed', id, kind: p.kind, ...(p.kind === 'fan' ? { team: p.teamCode } : { person: p.personId }) })
    return { id, status: 'removed' }
  })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w api -- admin-photos`
Expected: PASS (all 7 tests in file).

- [ ] **Step 5: Run the full api suite**

Run: `npm run test -w api`
Expected: all files PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/routes/admin.js api/test/admin-photos.test.js
git commit -m "feat(api): moderate photos — approve/reject/remove, profile avatar, SSE"
```

---

## Chunk C — Web wiring (Tasks 8–11)

### Task 8: API client — upload + admin helpers

**Files:**
- Modify: `web/src/api/client.js`
- Test: `web/src/api/client.test.js` (append)

- [ ] **Step 1: Write the failing test (append)**

```js
test('uploadPhoto POSTs FormData to /api/photos', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 201, json: async () => ({ id: 'x', status: 'pending' }) } }))
  const { uploadPhoto } = await import('./client.js')
  const fd = new FormData()
  const res = await uploadPhoto(fd)
  expect(res.status).toBe(201)
  expect(calls[0].url).toMatch(/\/api\/photos$/)
  expect(calls[0].opts.method).toBe('POST')
  expect(calls[0].opts.body).toBe(fd) // raw FormData, no JSON content-type
})

test('adminLogin posts the passcode and includes credentials', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ admin: true }) } }))
  const { adminLogin } = await import('./client.js')
  await adminLogin('1234')
  expect(calls[0].url).toMatch(/\/api\/admin\/login$/)
  expect(calls[0].opts.credentials).toBe('include')
  expect(JSON.parse(calls[0].opts.body)).toEqual({ passcode: '1234' })
})

test('fetchAdminPhotos GETs the queue with credentials', async () => {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ pending: [], approved: [] }) } }))
  const { fetchAdminPhotos } = await import('./client.js')
  await fetchAdminPhotos()
  expect(calls[0].opts.credentials).toBe('include')
})

test('adminLogin throws on 401', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })))
  const { adminLogin } = await import('./client.js')
  await expect(adminLogin('nope')).rejects.toThrow(/login/i)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w web -- client`
Expected: FAIL — new exports missing.

- [ ] **Step 3: Implement (append to `web/src/api/client.js`)**

```js
async function getCreds(path) {
  const res = await fetch(path, { credentials: 'include' })
  if (!res.ok) throw new Error(`GET ${path} failed: HTTP ${res.status}`)
  return res.json()
}
async function postCreds(path, body) {
  const res = await fetch(path, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${path} failed: HTTP ${res.status}`)
  return res.json()
}

export async function uploadPhoto(formData) {
  const res = await fetch('/api/photos', { method: 'POST', body: formData })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { msg = (await res.json()).error || msg } catch { /* ignore */ }
    throw new Error(`upload failed: ${msg}`)
  }
  return res.json()
}

export const adminLogin = (passcode) => postCreds('/api/admin/login', { passcode })
export const adminLogout = () => postCreds('/api/admin/logout', {})
export const fetchAdminMe = () => getCreds('/api/admin/me')
export const fetchAdminPhotos = () => getCreds('/api/admin/photos')
export const moderatePhoto = (id, action) => postCreds(`/api/admin/photos/${id}`, { action })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w web -- client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/api/client.js web/src/api/client.test.js
git commit -m "feat(web): client helpers for photo upload + admin login/queue/moderate"
```

---

### Task 9: `Av` renders approved avatar; SSE photo events

**Files:**
- Modify: `web/src/components.jsx`, `web/src/hooks/useEventStream.js`
- Test: `web/src/components.test.jsx` (new), `web/src/hooks/useEventStream.test.jsx` (append)

- [ ] **Step 1: Write the failing component test**

```jsx
// web/src/components.test.jsx
import { expect, test } from 'vitest'
import { render } from '@testing-library/react'
import { Av } from './components.jsx'

test('Av renders the initials chip when no avatarPath', () => {
  const { container } = render(<Av p={{ initials: 'AB', av: '#123456' }} size={24} />)
  expect(container.querySelector('img')).toBeNull()
  expect(container.textContent).toContain('AB')
})

test('Av renders an <img> when avatarPath is present', () => {
  const { container } = render(<Av p={{ initials: 'AB', av: '#123456', avatarPath: '/photos/x.jpg' }} size={24} />)
  const img = container.querySelector('img')
  expect(img).not.toBeNull()
  expect(img.getAttribute('src')).toBe('/photos/x.jpg')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w web -- components`
Expected: FAIL — `Av` never renders an img.

- [ ] **Step 3: Update `Av` in `web/src/components.jsx`**

Replace the `Av` function with:
```jsx
export function Av({ p, size, light }) {
  const s = size || 24;
  if (p && p.avatarPath) {
    return <img className="av" src={p.avatarPath} alt={p.initials || ""} style={{ width:s, height:s, objectFit:"cover", borderColor: light?"#fff":undefined }} />;
  }
  return <span className="av" style={{ background:p.av, width:s, height:s, fontSize:s*0.42, borderColor: light?"#fff":undefined }}>{p.initials}</span>;
}
```

- [ ] **Step 4: Append the SSE test (`web/src/hooks/useEventStream.test.jsx`)**

```jsx
test('photo-approved/photo-removed events invalidate the sweep query', () => {
  const { spy, es } = setup()
  es.emit({ type: 'photo-approved', id: 'p1', kind: 'fan' })
  es.emit({ type: 'photo-removed', id: 'p2', kind: 'profile' })
  expect(spy.mock.calls.filter((c) => c[0]?.queryKey?.[0] === 'sweep')).toHaveLength(2)
})
```

- [ ] **Step 5: Run that test to verify it fails**

Run: `npm run test -w web -- useEventStream`
Expected: FAIL — photo events aren't handled.

- [ ] **Step 6: Map photo events in `web/src/hooks/useEventStream.js`**

Change the `onmessage` branch to also catch photo events:
```js
      if (ev.type === 'watch' || ev.type === 'support') qc.invalidateQueries({ queryKey: ['social'] })
      else if (ev.type === 'score' || ev.type === 'sync' || ev.type === 'photo-approved' || ev.type === 'photo-removed') qc.invalidateQueries({ queryKey: ['sweep'] })
```

- [ ] **Step 7: Run both tests to verify they pass**

Run: `npm run test -w web -- "components|useEventStream"`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/src/components.jsx web/src/hooks/useEventStream.js web/src/components.test.jsx web/src/hooks/useEventStream.test.jsx
git commit -m "feat(web): Av renders approved avatars; SSE invalidates on photo events"
```

---

### Task 10: Real upload flow (fan + profile)

**Files:**
- Modify: `web/src/screens-detail.jsx` (`UploadSheet`), `web/src/App.jsx` (pass a `kind`/`presetPerson` through), `web/src/components.jsx` (Person detail self-upload entry)
- Test: manual (file-picker + multipart are integration-level; covered by the api `upload.test.js` + a live smoke). The component change is verified by `npm run build` + the Final live smoke.

> The current `UploadSheet` fakes submit (`setDone(true)`). Make it perform a real `uploadPhoto`, support `kind='profile'` (no team picker; tagged to the current person), and surface server errors.

- [ ] **Step 1: Replace `UploadSheet` in `web/src/screens-detail.jsx`**

Add `useRef` to the React import if not present, and import the client + identity:
```js
import { uploadPhoto } from "./api/client.js";
// getMe is already imported in this file
```
Replace the whole `UploadSheet` function with a real implementation:
```jsx
export function UploadSheet({ presetTeam, kind = "fan", onClose, onToast }) {
  const me = getMe();
  const [name, setName] = useState(()=> me ? me.name : "");
  const [team, setTeam] = useState(presetTeam || null);
  const [file, setFile] = useState(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const inputRef = useRef(null);
  const isProfile = kind === "profile";
  const ok = name.trim() && file && (isProfile ? !!me : !!team) && !busy;

  async function submit(){
    if (!ok) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("kind", kind);
      fd.append("uploaderName", name.trim());
      if (isProfile) fd.append("personId", me.id); else fd.append("teamCode", team);
      if (caption.trim()) fd.append("caption", caption.trim());
      fd.append("file", file);
      await uploadPhoto(fd);
      setDone(true);
    } catch (e) {
      onToast(/pending_exists|409/.test(String(e.message)) ? "You already have a photo awaiting approval" : "Upload failed — try again");
    } finally { setBusy(false); }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={e=>e.stopPropagation()} style={{maxHeight:"90%"}}>
        <div className="grab"></div>
        {!done ? (
          <>
            <div className="sheet-head"><h3>{isProfile ? "Upload profile photo" : "Add a fan photo"}</h3><button className="x" onClick={onClose}><Icon.x/></button></div>
            <div className="sheet-body">
              <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{display:"none"}} onChange={e=>setFile(e.target.files?.[0]||null)} />
              <div className="dropzone" onClick={()=>inputRef.current&&inputRef.current.click()} style={{cursor:"pointer",borderColor:file?"var(--live)":"var(--line)",background:file?"#f1faf4":"var(--card)"}}>
                <div className="ic" style={{background:file?"#e7f6ee":"#eef1f5"}}>{file?<Icon.check style={{stroke:"var(--live)"}}/>:<Icon.camera/>}</div>
                <b>{file?file.name:"Tap to add a photo"}</b>
                <small>{file?"Looks good — ready to send":"JPG, PNG or WebP · up to 8 MB"}</small>
              </div>

              <div className="field" style={{marginTop:16}}>
                <label>Your name</label>
                <input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Priya" />
              </div>

              {!isProfile && (
                <div className="field">
                  <label>Tag a team</label>
                  <div className="teampick">
                    {S.teamList.filter(t=>t.owners.length>0).slice(0,18).map(t=>(
                      <button key={t.code} className={"tpk"+(team===t.code?" on":"")} onClick={()=>setTeam(t.code)}>
                        <img src={S.flag(t.code,80)} alt=""/><span>{t.name.length>9?t.name.slice(0,8)+"…":t.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="note-line"><Icon.shield style={{stroke:"var(--live)"}}/><span>Every upload is checked by the admin before it appears anywhere. One pending photo per person at a time.</span></div>

              <button className={"cta"} onClick={submit} style={{marginTop:18,opacity:ok?1:.5}}>
                <Icon.camera/> {busy ? "Sending…" : "Send for approval"}
              </button>
            </div>
          </>
        ) : (
          <div className="success">
            <div className="ring"><Icon.check/></div>
            <h3>Sent for approval</h3>
            <p>Thanks{name?`, ${name.split(" ")[0]}`:""}! Your {isProfile ? "profile photo" : (team?S.team(team).name:"")+" photo"} is in the queue. The admin will approve it before it shows{isProfile ? " as your avatar." : " on the team page and home banner."}</p>
            <button className="cta ghost" onClick={onClose} style={{marginTop:20}}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Thread `kind` through `App.jsx`**

In `web/src/App.jsx`, the upload modal currently is `{type:"upload", team}`. Add an optional `kind`/profile path. Update `openUpload` and the modal render so a profile upload can be opened. Change:
```js
  const openUpload = (c) => setModal({ type:"upload", team:c||null });
  const openProfileUpload = () => setModal({ type:"upload", kind:"profile" });
```
And the modal render line to pass `kind`:
```jsx
      {modal && modal.type==="upload" && <UploadSheet presetTeam={modal.team} kind={modal.kind||"fan"} onClose={()=>setModal(null)} onToast={showToast}/>}
```
Pass `openProfileUpload` to the identity sheet and person detail (next step) — thread it through the same way `openUpload` is passed to `TeamDetail`.

- [ ] **Step 3: Add a self-upload entry on `PersonDetail`**

In `web/src/screens-detail.jsx`, `PersonDetail({ person, onBack, openMatch, openTeam })`. Add an `openProfileUpload` prop and, when the viewed person is the current user (`getMe()?.id === person.id`), render an "Upload profile photo" button near the header. Minimal addition inside the component body:
```jsx
  const isMe = getMe()?.id === person.id;
```
and in the JSX header area add (where appropriate, e.g. under the name):
```jsx
  {isMe && <button className="idchip dark" style={{marginTop:10}} onClick={()=>openProfileUpload && openProfileUpload()}><Icon.camera/> Upload profile photo</button>}
```
Wire `openProfileUpload` from `App.jsx` down through the overlay that renders `PersonDetail` (mirror how `openUpload` reaches `TeamDetail`).

- [ ] **Step 4: Build to verify it compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Run the web suite (no regressions)**

Run: `npm run test -w web`
Expected: all PASS (existing + Task 8/9 tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/screens-detail.jsx web/src/App.jsx web/src/components.jsx
git commit -m "feat(web): real photo upload (fan + profile) wired to the API"
```

---

### Task 11: Real admin login + moderation queue

**Files:**
- Modify: `web/src/screens-detail.jsx` (`AdminScreen`, `AdminQueue`)
- Test: build + final live smoke (the queue is data-driven from the server; logic verified by api tests).

> Replace the client-side `2026` passcode with a real `adminLogin`, and drive `AdminQueue` from `fetchAdminPhotos` / `moderatePhoto`.

- [ ] **Step 1: Replace `AdminScreen` in `web/src/screens-detail.jsx`**

Import the admin client funcs at the top of the file:
```js
import { adminLogin, fetchAdminMe, fetchAdminPhotos, moderatePhoto } from "./api/client.js";
```
Replace `AdminScreen` with a server-login version (keeps the keypad UI):
```jsx
export function AdminScreen({ onBack, onToast }) {
  const [code, setCode] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [shake, setShake] = useState(false);

  useEffect(()=>{ fetchAdminMe().then(()=>setUnlocked(true)).catch(()=>{}); },[]);

  function fail(){ setShake(true); setTimeout(()=>{ setShake(false); setCode(""); }, 400); }
  function press(d){
    if(code.length>=4) return;
    const nc = code + d; setCode(nc);
    if(nc.length===4){ setTimeout(async ()=>{ try { await adminLogin(nc); setUnlocked(true); } catch { fail(); } }, 120); }
  }
  function del(){ setCode(c=>c.slice(0,-1)); }

  if(!unlocked){
    return (
      <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
        <PageHeader title="Admin" sub="Restricted area" onBack={onBack} />
        <div className="scroll passpad screen-anim" style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
          <div className="lockic"><Icon.lock/></div>
          <h3 style={{fontFamily:"'Barlow Condensed'",fontWeight:800,fontSize:20,textTransform:"uppercase",color:"var(--navy)"}}>Enter passcode</h3>
          <p style={{fontSize:12.5,color:"var(--muted)",marginTop:6,textAlign:"center"}}>Admin only.</p>
          <div className={"passdots"} style={{transform:shake?"translateX(0)":"none",animation:shake?"shake .4s":"none"}}>
            {[0,1,2,3].map(i=><i key={i} className={i<code.length?"f":""}></i>)}
          </div>
          <div className="keypad">
            {[1,2,3,4,5,6,7,8,9].map(n=><button key={n} className="key" onClick={()=>press(""+n)}>{n}</button>)}
            <button className="key blank"></button>
            <button className="key" onClick={()=>press("0")}>0</button>
            <button className="key blank" onClick={del} style={{fontSize:14,color:"var(--muted)"}}>⌫</button>
          </div>
        </div>
        <style>{`@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}`}</style>
      </div>
    );
  }
  return <AdminQueue onBack={onBack} onToast={onToast} />;
}
```
> The 4-digit keypad still works for numeric passcodes; the real bcrypt-hashed `ADMIN_PASSCODE` should be a 4-digit code in `.env` for this UI (or generalize the keypad later — out of scope).

- [ ] **Step 2: Replace `AdminQueue` to use the server**

```jsx
export function AdminQueue({ onBack, onToast }) {
  const [data, setData] = useState({ pending: [], approved: [] });
  const [tab, setTab] = useState("pending");
  const [busy, setBusy] = useState(null);

  async function load(){ try { setData(await fetchAdminPhotos()); } catch { onToast("Couldn't load the queue"); } }
  useEffect(()=>{ load(); },[]);

  const list = tab==="pending" ? data.pending : data.approved;

  async function act(id, action){
    setBusy(id);
    try {
      await moderatePhoto(id, action);
      onToast(action==="approve"?"Photo approved":action==="reject"?"Photo rejected":"Photo removed");
      await load();
    } catch { onToast("Action failed — try again"); }
    finally { setBusy(null); }
  }

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <PageHeader title="Moderation" sub="Photo queue" onBack={onBack} right={<div className="iconbtn"><Icon.shield/></div>} />
      <div className="admintabs">
        <button className={"admintab"+(tab==="pending"?" on":"")} onClick={()=>setTab("pending")}>Pending {data.pending.length>0 && <span className="ct">{data.pending.length}</span>}</button>
        <button className={"admintab"+(tab==="approved"?" on":"")} onClick={()=>setTab("approved")}>Approved · {data.approved.length}</button>
      </div>
      <div className="scroll pad screen-anim" style={{paddingTop:10}}>
        <div className="wrap">
          {list.length===0 && <div className="empty"><div className="ic">✅</div><h3>Queue clear</h3><p>No {tab} photos right now.</p></div>}
          {list.map(p=>(
            <div className="queueitem" key={p.id}>
              <div className="qimg" style={{backgroundImage:`url(${p.fileUrl})`,backgroundSize:"cover",backgroundPosition:"center"}}>
                <div className="lbl">{p.kind==="profile"?"PROFILE":"FAN PHOTO"}</div>
                {p.kind==="fan" && p.team && <div className="tag"><img src={S.flag(p.team,40)} alt=""/><span>{S.team(p.team)?.name||p.team}</span></div>}
                {p.kind==="profile" && <div className="tag"><span>{S.peopleById[p.person]?.short || p.uploader}</span></div>}
              </div>
              <div className="qmeta"><b>{p.caption||"(no caption)"}</b><small>{p.uploader}</small></div>
              {tab==="pending" ? (
                <div className="qacts">
                  <button className="qbtn rej" disabled={busy===p.id} onClick={()=>act(p.id,"reject")}><Icon.x/> Reject</button>
                  <button className="qbtn app" disabled={busy===p.id} onClick={()=>act(p.id,"approve")}><Icon.check/> Approve</button>
                </div>
              ) : (
                <div className="qacts">
                  <button className="qbtn rej" disabled={busy===p.id} onClick={()=>act(p.id,"remove")} style={{flex:1}}><Icon.trash/> Remove from site</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```
> The admin queue loads pending images via `p.fileUrl` (`/api/admin/photos/:id/file`), which the browser fetches with the admin cookie (same-origin). Ensure `useEffect` is imported in this file (it is — `useSocial` uses it).

- [ ] **Step 3: Build + web suite**

Run: `npm run build && npm run test -w web`
Expected: build succeeds; all web tests PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/screens-detail.jsx
git commit -m "feat(web): real admin login + server-driven moderation queue"
```

---

## Final verification (lead, before declaring Phase 5 done)

- [ ] `npm run test -w api` → all green (incl. `photos-process`, `upload`, `admin-auth`, `admin-photos`).
- [ ] `npm run test -w web` → all green (incl. `components`, updated `client`, `useEventStream`).
- [ ] `npm run build` → green.
- [ ] **Live end-to-end smoke:**
  1. Set a real `ADMIN_PASSCODE` in `.env`: `npm run admin:hash -w api -- 2468` → paste the hash; set `SESSION_SECRET` to any long string; set `PHOTOS_DIR=./photos-data`.
  2. `npm run dev:api` + `npm run dev:web`.
  3. As a viewer, upload a fan photo for a team → it does NOT appear yet (pending).
  4. Open Admin → enter the passcode (`2468`) → the pending photo shows with its image → Approve.
  5. The team page / home banner shows the approved photo live (SSE, no refresh).
  6. Upload a profile photo from your Person detail → approve → your avatar replaces initials everywhere live.
  7. Remove the approved profile → avatar reverts to initials live.
- [ ] Push: `git push origin main` (pre-push runs web+api tests + build; Docker must be up).
- [ ] Update `.remember/remember.md` with the Phase 5 handoff.

---

## Self-review notes (author)

- **Spec §6 coverage:** multipart upload with type allowlist + 8 MB cap + EXIF-strip re-encode + thumbnail (T2/T3); profile square crop (T2); pending path never web-served + admin-only stream (T1/T6); one-pending-per-person-per-kind (T3); admin bcrypt login → httpOnly signed short-TTL cookie + rate-limited (T5); cookie-gated admin routes (T5/T6/T7); single queue moderates both kinds tagged (T6); approve moves file + flips status + sets `avatar_path` superseding prior (T7); remove reverts profile to initials (T7); SSE `photo-approved` (+ `photo-removed`) → live (T7/T9); `Av` renders `avatar_path` with initials fallback (T9); upload sheet reused for `kind='profile'` with awaiting-approval state (T10). ✓
- **No migration:** `photo` table + `person.avatar_path` exist from Phase 1 schema. ✓
- **SDK check (global rule):** uses official Fastify plugins + `sharp` + `bcryptjs` rather than hand-rolled multipart/auth/image code. ✓
- **Type consistency:** `app.photos` store API (`writePending`/`moveToApproved`/`removeApproved`/`pendingPath`/`approvedPath`) used identically across routes; `filePath`/`thumbPath` = basenames; served URL `/photos/<basename>`; SSE shapes `{type:'photo-approved'|'photo-removed', id, kind, team|person}` consistent api↔web. ✓
- **Out of scope (noted):** admin fixture-overrides, sweep-data edits, `POST /api/admin/sync` — deferred. ✓
- **Risk flagged:** `@fastify/static` late-registration — plan defaults to the **synchronous storage** path in `buildApp` to avoid it (T3 Step 3 note).
