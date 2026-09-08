import { expect, test, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { ownerHeaders } from './helpers/session.js'
import { account } from '../src/db/schema.js'
import { hashPassword } from '../src/auth.js'

// Mail is a best-effort NOTIFICATION on both of these routes. The work is already
// committed by the time it goes out, so a dead transport must never turn a completed
// request into a 500 — the client would show "something went wrong" about something
// that went right.
const { pool, db } = openTestDb()
const app = buildApp(db, {
  sessionSecret: 'test-secret',
  sendMail: async () => { throw new Error('smtp is down') },
})
beforeAll(async () => {
  await app.ready()
  await db.insert(account).values({
    id: 'ac_mailfail', email: 'mailfail@example.test',
    passwordHash: await hashPassword('original-passphrase'),
  }).onConflictDoNothing()
})
afterAll(async () => { await app.close(); await pool.end() })

// The hash is written and every other session revoked BEFORE the mail. A 500 here told
// the owner it failed while the new password was already live — and on a change with
// `current`, their retry then 401s against the old one, locking them out of the UI.
test('a failed notification does not fail a password change that already happened', async () => {
  const res = await app.inject({
    method: 'POST', url: '/api/account/password',
    headers: await ownerHeaders(db, 'ac_mailfail'),
    payload: { password: 'a-newer-passphrase', current: 'original-passphrase' },
  })
  expect(res.statusCode).toBe(204)
  const signin = await app.inject({
    method: 'POST', url: '/api/account/password/session',
    payload: { email: 'mailfail@example.test', password: 'a-newer-passphrase' },
  })
  expect(signin.statusCode).toBe(201)
})

// The always-{ok:true} on this route exists so the response cannot be used to test
// whether an address has an account. A 500 that only happens for... anything at all
// is still a different answer, and the mail failing must not produce one.
test('a dead transport does not make the sign-in route answer differently', async () => {
  const known = await app.inject({
    method: 'POST', url: '/api/account/login', payload: { email: 'mailfail@example.test' },
  })
  const unknown = await app.inject({
    method: 'POST', url: '/api/account/login', payload: { email: 'nobody@example.test' },
  })
  expect(known.statusCode).toBe(200)
  expect(known.json()).toEqual({ ok: true })
  expect(unknown.statusCode).toBe(known.statusCode)
  expect(unknown.json()).toEqual(known.json())
})
