import { expect, test, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { ownerHeaders } from './helpers/session.js'
import { account, sweep } from '../src/db/schema.js'

const { pool, db } = openTestDb()
const app = buildApp(db, { sessionSecret: 'test-secret' })
beforeAll(async () => {
  await app.ready()
  await db.insert(account).values({
    id: 'ac_lapsed', email: 'lapsed@example.test', subscriptionStatus: 'canceled',
  }).onConflictDoNothing()
  await db.insert(sweep).values({
    id: 'sw_lapsed', name: 'Lapsed', kind: 'token', competitionId: 'apifootball:1:2026',
    accountId: 'ac_lapsed', memberToken: 'lapsedmembertoken0000',
  }).onConflictDoNothing()
})
afterAll(async () => {
  // Restores both fields this file mutates on the shared seed sweep: the rename test
  // renames it, the rotate test replaces its member token — either left standing breaks
  // sibling test files (bootstrap's name assertion, memberCookie()'s memoized token).
  await db.update(sweep).set({ name: 'The Sweep', memberToken: 'seedmembertoken000000' }).where(eq(sweep.id, 'default'))
  await app.close(); await pool.end()
})

test('the owner can rename their own sweep', async () => {
  const res = await app.inject({
    method: 'PATCH', url: '/api/account/sweeps/default',
    headers: await ownerHeaders(db), payload: { name: 'Renamed' },
  })
  expect(res.statusCode).toBe(200)
  const [row] = await db.select().from(sweep).where(eq(sweep.id, 'default'))
  expect(row.name).toBe('Renamed')
})

test('a stranger gets 404, not 403 — the id is not an existence oracle', async () => {
  const res = await app.inject({
    method: 'PATCH', url: '/api/account/sweeps/sw_lapsed',
    headers: await ownerHeaders(db), payload: { name: 'Nope' },
  })
  expect(res.statusCode).toBe(404)
})

// Pins the IN-HANDLER liveness check. The global gate cannot do this: it returns at
// !req.sweep?.accountId (sweeps/read-only.js:11) and this request carries no sweep cookie.
test('a lapsed owner cannot mutate their sweep', async () => {
  const res = await app.inject({
    method: 'PATCH', url: '/api/account/sweeps/sw_lapsed',
    headers: await ownerHeaders(db, 'ac_lapsed'), payload: { name: 'Nope' },
  })
  expect(res.statusCode).toBe(403)
  expect(res.json().error).toBe('sweep_readonly')
})

test('rotating the member link kills the old token and mints a working one', async () => {
  const res = await app.inject({
    method: 'POST', url: '/api/account/sweeps/default/rotate', headers: await ownerHeaders(db),
  })
  expect(res.statusCode).toBe(200)
  const old = await app.inject({
    method: 'POST', url: '/api/session', headers: { host: 'platform.test' },
    payload: { token: 'seedmembertoken000000' },
  })
  expect(old.statusCode).toBe(404)
  // The old token dying is only half the promise — prove the new one actually works,
  // or a rotate that returns a dead link locks the owner out with no fallback.
  const fresh = res.json().memberLink.split('/g/')[1]
  const ok = await app.inject({
    method: 'POST', url: '/api/session', headers: { host: 'platform.test' },
    payload: { token: fresh },
  })
  expect(ok.statusCode).toBe(200)
  expect(ok.json().sweepId).toBe('default')
})

// Rotation is damage control, not a feature of a paid plan: an owner whose subscription
// lapsed must still be able to kill a leaked member link — the read-only gate exists to
// freeze sweep CONTENT, and archiving (destructive) was never gated at all.
test('a lapsed owner can rotate the member link, but still cannot edit the sweep', async () => {
  const rot = await app.inject({
    method: 'POST', url: '/api/account/sweeps/sw_lapsed/rotate',
    headers: await ownerHeaders(db, 'ac_lapsed'),
  })
  expect(rot.statusCode).toBe(200)
  const [row] = await db.select().from(sweep).where(eq(sweep.id, 'sw_lapsed'))
  expect(row.memberToken).not.toBe('lapsedmembertoken0000')

  const patch = await app.inject({
    method: 'PATCH', url: '/api/account/sweeps/sw_lapsed',
    headers: await ownerHeaders(db, 'ac_lapsed'), payload: { name: 'Nope' },
  })
  expect(patch.statusCode).toBe(403)
  expect(patch.json().error).toBe('sweep_readonly')
})
