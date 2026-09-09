import { expect, test, afterAll, beforeAll } from 'vitest'
import { eq, ne, and, inArray } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { person, ownership, account, accountSession, sweep, competition, operatorAction, support, event, photo } from '../src/db/schema.js'
import { newToken } from '../src/sweeps/tokens.js'
import { ownerHeaders, adminHeaders, memberCookie, seatFor, releaseSeat } from './helpers/session.js'

const { pool, db } = openTestDb()
import { mkdtemp } from 'node:fs/promises'
import { access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'

const photosDir = mkdtempSync(join(tmpdir(), 'sweep-admphotos-'))
const mails = []
const app = buildApp(db, {
  photosDir,
  sessionSecret: 'test-secret',
  sendMail: async (to, subject, body, html) => mails.push({ to, subject, body, html }),
})
beforeAll(async () => { await app.ready() })
afterAll(async () => {
  // Leave the shared test DB as we found it (seed.test.js counts persons globally).
  await db.delete(ownership).where(ne(ownership.sweepId, 'default'))
  await db.delete(person).where(ne(person.sweepId, 'default'))
  await db.delete(operatorAction).where(eq(operatorAction.actorId, 'ac_op_admin'))
  // Only the ones this file made: other suites hold live sweeps in the same database.
  await db.delete(sweep).where(inArray(sweep.id, made))
  const owners = made.map((id) => `ac_own_${id}`)
  await db.delete(accountSession).where(inArray(accountSession.accountId, owners))
  await db.delete(account).where(inArray(account.id, owners))
  await app.close(); await pool.end()
})

/** A token sweep to operate ON. Inserted directly, the way sweeps-isolation.test.js
 *  already does it: an operator cannot mint one any more, and provisioning through
 *  POST /api/account/sweeps would drag a curated catalog, a feed fill and the trial cap
 *  into a file about operating on sweeps and group-admin scoping. */
const made = []
async function makeSweep(name) {
  const id = `sw_${newToken(12)}`
  made.push(id)
  const memberToken = newToken()
  const [comp] = await db.select({ id: competition.id }).from(competition).where(eq(competition.id, 'apifootball:1:2026'))
  await db.insert(sweep).values({ id, name, kind: 'token', memberToken, competitionId: comp.id })
  return { id, name, memberToken }
}

/** The audit row this operator wrote for `action` on `sweepId`, or undefined. */
async function auditRow(action, sweepId) {
  const [row] = await db.select().from(operatorAction)
    .where(and(eq(operatorAction.action, action), eq(operatorAction.target, sweepId)))
  return row
}

// Memoized: minting an account session per test is wasteful, and the operator row only
// needs inserting once.
let _op
async function operator() {
  if (_op) return _op
  await db.insert(account).values({
    id: 'ac_op_admin', email: 'op-admin@example.test', role: 'operator',
  }).onConflictDoNothing()
  _op = await ownerHeaders(db, 'ac_op_admin')
  return _op
}

// An operator cannot provision, and cannot re-link. Creating minted a sweep with no
// accountId — one nobody could ever administer, since admin is derived from ownership —
// and rotating handed back a raw member token, which is a key to walk into that group's
// sweep. Both belong to the owning account (POST /api/account/sweeps[/:id/rotate]).
test('an operator cannot create a sweep', async () => {
  const auth = await operator()
  const res = await app.inject({ method: 'POST', url: '/api/super/sweeps', headers: auth, payload: { name: 'Acme' } })
  expect(res.statusCode).toBe(404)
})

test('an operator cannot rotate a sweep token', async () => {
  const auth = await operator()
  const s = await makeSweep('NoRotate')
  const res = await app.inject({ method: 'POST', url: `/api/super/sweeps/${s.id}/rotate`, headers: auth, payload: { which: 'member' } })
  expect(res.statusCode).toBe(404)
  const [row] = await db.select().from(sweep).where(eq(sweep.id, s.id))
  expect(row.memberToken).toBe(s.memberToken) // and nothing moved
})

// Operating on a sweep is not entering it: the console lists sweeps to act on, and a
// live member token in that list would be the ability to open any group's sweep as one
// of its members, leaving no trace.
test('the sweep listing carries no member link and no token', async () => {
  const auth = await operator()
  const created = await makeSweep('Listed')
  const row = (await app.inject({ method: 'GET', url: '/api/super/sweeps', headers: auth })).json()
    .find((s) => s.id === created.id)
  expect(row).toEqual({
    id: created.id, name: 'Listed', kind: 'token', archivedAt: null,
    createdAt: expect.any(String), accountId: null, competitionId: expect.any(String),
  })
  expect(JSON.stringify(row)).not.toContain(created.memberToken)
})

test('listing sweeps without operator credentials is 401', async () => {
  expect((await app.inject({ method: 'GET', url: '/api/super/sweeps' })).statusCode).toBe(401)
})

/** A group admin of a fresh sweep. There is no admin token to exchange any more: admin
 *  is derived from owning the sweep, so these headers are a member cookie for it plus
 *  the owning account's token. */
async function adminFor() {
  const created = await makeSweep('Draw')
  return { h: await adminHeaders(app, db, created.id), id: created.id }
}

test('group admin creates a person and assigns a team', async () => {
  const { h } = await adminFor()
  const created = await app.inject({ method: 'POST', url: '/api/admin/people', headers: h, payload: { name: 'Zoe', short: 'Zoe', initials: 'Z', av: '#abc' } })
  expect(created.statusCode).toBe(201)
  const personId = created.json().id
  const assign = await app.inject({ method: 'POST', url: '/api/admin/ownership', headers: h, payload: { personId, teamCode: 'br' } })
  expect(assign.statusCode).toBe(201)
  const people = (await app.inject({ method: 'GET', url: '/api/people', headers: h })).json()
  expect(people.find((p) => p.id === personId).teams).toContain('br')
})

test('a member cookie cannot reach group-admin routes (403)', async () => {
  const created = await makeSweep('Mem')
  const sess = await app.inject({ method: 'POST', url: '/api/session', payload: { token: created.memberToken } })
  const res = await app.inject({ method: 'POST', url: '/api/admin/people', headers: { host: 'platform.test', cookie: sess.headers['set-cookie'] }, payload: { name: 'No', short: 'No', initials: 'N', av: '#000' } })
  expect(res.statusCode).toBe(403)
})

test('co-ownership allowed: two people CAN own the same team; same person twice is 409', async () => {
  const { h } = await adminFor()
  const a = (await app.inject({ method: 'POST', url: '/api/admin/people', headers: h, payload: { name: 'A', short: 'A', initials: 'A', av: '#111' } })).json()
  const b = (await app.inject({ method: 'POST', url: '/api/admin/people', headers: h, payload: { name: 'B', short: 'B', initials: 'B', av: '#222' } })).json()
  expect((await app.inject({ method: 'POST', url: '/api/admin/ownership', headers: h, payload: { personId: a.id, teamCode: 'ar' } })).statusCode).toBe(201)
  // a DIFFERENT person co-owning the same team is allowed:
  expect((await app.inject({ method: 'POST', url: '/api/admin/ownership', headers: h, payload: { personId: b.id, teamCode: 'ar' } })).statusCode).toBe(201)
  // the SAME person assigned the SAME team twice → 409 (PK violation):
  expect((await app.inject({ method: 'POST', url: '/api/admin/ownership', headers: h, payload: { personId: a.id, teamCode: 'ar' } })).statusCode).toBe(409)
})

test('assigning/removing an unknown team code is 400 unknown_team (single + bulk)', async () => {
  const { h } = await adminFor()
  const p = (await app.inject({ method: 'POST', url: '/api/admin/people', headers: h, payload: { name: 'Nope', short: 'Nope', initials: 'NP', av: '#abc' } })).json()
  const assign = await app.inject({ method: 'POST', url: '/api/admin/ownership', headers: h, payload: { personId: p.id, teamCode: 'zz' } })
  expect(assign.statusCode).toBe(400)
  expect(assign.json().error).toBe('unknown_team')
  const remove = await app.inject({ method: 'DELETE', url: '/api/admin/ownership', headers: h, payload: { personId: p.id, teamCode: 'zz' } })
  expect(remove.statusCode).toBe(400)
  expect(remove.json().error).toBe('unknown_team')
  const bulkAssign = await app.inject({ method: 'POST', url: '/api/admin/ownership/bulk', headers: h, payload: { items: [{ personId: p.id, teamCode: 'zz' }] } })
  expect(bulkAssign.statusCode).toBe(400)
  expect(bulkAssign.json().error).toBe('unknown_team')
  const bulkRemove = await app.inject({ method: 'DELETE', url: '/api/admin/ownership/bulk', headers: h, payload: { items: [{ personId: p.id, teamCode: 'zz' }] } })
  expect(bulkRemove.statusCode).toBe(400)
  expect(bulkRemove.json().error).toBe('unknown_team')
})

test('super can rename a sweep and edit scoring (PATCH returns updated row)', async () => {
  const auth = await operator()
  const created = await makeSweep('Old Name')
  const res = await app.inject({
    method: 'PATCH', url: `/api/super/sweeps/${created.id}`, headers: auth,
    payload: { name: 'New Name', scoringRule: 'winner_only', coOwners: 'split' },
  })
  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.id).toBe(created.id)
  expect(body.name).toBe('New Name')
  expect(body.scoringRule).toBe('winner_only')
  expect(body.coOwners).toBe('split')
  // a follow-up GET reflects the new name
  const list = (await app.inject({ method: 'GET', url: '/api/super/sweeps', headers: auth })).json()
  expect(list.find((s) => s.id === created.id).name).toBe('New Name')
  // and the operator answers for it
  expect(await auditRow('patch_sweep', created.id)).toMatchObject({ actorId: 'ac_op_admin', sweepIds: [created.id] })
})

test('PATCH a sweep without operator credentials is 401', async () => {
  const created = await makeSweep('Guarded')
  const res = await app.inject({ method: 'PATCH', url: `/api/super/sweeps/${created.id}`, payload: { name: 'Nope' } })
  expect(res.statusCode).toBe(401)
})

test('PATCH an unknown sweep id is 404', async () => {
  const auth = await operator()
  const res = await app.inject({ method: 'PATCH', url: '/api/super/sweeps/sw_does_not_exist', headers: auth, payload: { name: 'X' } })
  expect(res.statusCode).toBe(404)
})

test('super can un-archive a sweep; an archived sweep becomes usable again', async () => {
  const auth = await operator()
  const created = await makeSweep('Revivable')
  const tok = created.memberToken
  // archive it → /api/session refuses (404)
  expect((await app.inject({ method: 'POST', url: `/api/super/sweeps/${created.id}/archive`, headers: auth })).statusCode).toBe(200)
  expect((await app.inject({ method: 'POST', url: '/api/session', headers: { host: 'platform.test' }, payload: { token: tok } })).statusCode).toBe(404)
  // un-archive → row active again, session works
  const un = await app.inject({ method: 'POST', url: `/api/super/sweeps/${created.id}/unarchive`, headers: auth })
  expect(un.statusCode).toBe(200)
  expect(un.json()).toEqual({ id: created.id, archived: false })
  const sess = await app.inject({ method: 'POST', url: '/api/session', payload: { token: tok } })
  expect(sess.statusCode).toBe(200)
  expect(sess.json().sweepId).toBe(created.id)
  // both halves are on the record — taking a group's sweep away and giving it back are
  // the two operator actions a customer is most likely to ask about afterwards
  expect(await auditRow('archive_sweep', created.id)).toMatchObject({ actorId: 'ac_op_admin', sweepIds: [created.id] })
  expect(await auditRow('unarchive_sweep', created.id)).toMatchObject({ actorId: 'ac_op_admin', sweepIds: [created.id] })
})

test('a refused operator mutation leaves no audit row', async () => {
  const auth = await operator()
  const s = await makeSweep('NotMine')
  expect((await app.inject({ method: 'POST', url: `/api/super/sweeps/${s.id}/archive` })).statusCode).toBe(401)
  expect(await auditRow('archive_sweep', s.id)).toBeUndefined()
})

test('un-archive without operator credentials is 401', async () => {
  const created = await makeSweep('GuardedUn')
  const res = await app.inject({ method: 'POST', url: `/api/super/sweeps/${created.id}/unarchive` })
  expect(res.statusCode).toBe(401)
})

test('un-archive an unknown sweep id is 404', async () => {
  const auth = await operator()
  const res = await app.inject({ method: 'POST', url: '/api/super/sweeps/sw_nope/unarchive', headers: auth })
  expect(res.statusCode).toBe(404)
})

test('un-archive refuses the default sweep (kind default → 404)', async () => {
  const auth = await operator()
  const res = await app.inject({ method: 'POST', url: '/api/super/sweeps/default/unarchive', headers: auth })
  expect(res.statusCode).toBe(404)
})

test('bulk ownership assigns many teams in one call; /api/people reflects all', async () => {
  const { h } = await adminFor()
  const p = (await app.inject({ method: 'POST', url: '/api/admin/people', headers: h, payload: { name: 'Bulk', short: 'Bulk', initials: 'BK', av: '#abc' } })).json()
  const items = [{ personId: p.id, teamCode: 'br' }, { personId: p.id, teamCode: 'ar' }, { personId: p.id, teamCode: 'fr' }]
  const res = await app.inject({ method: 'POST', url: '/api/admin/ownership/bulk', headers: h, payload: { items } })
  expect(res.statusCode).toBe(201)
  expect(res.json().inserted).toBe(3)
  const people = (await app.inject({ method: 'GET', url: '/api/people', headers: h })).json()
  expect(people.find((x) => x.id === p.id).teams.sort()).toEqual(['ar', 'br', 'fr'])
})

test('bulk ownership is idempotent and allows co-ownership across people', async () => {
  const { h } = await adminFor()
  const a = (await app.inject({ method: 'POST', url: '/api/admin/people', headers: h, payload: { name: 'A', short: 'A', initials: 'A', av: '#111' } })).json()
  const b = (await app.inject({ method: 'POST', url: '/api/admin/people', headers: h, payload: { name: 'B', short: 'B', initials: 'B', av: '#222' } })).json()
  // first bulk for A: 2 inserted
  expect((await app.inject({ method: 'POST', url: '/api/admin/ownership/bulk', headers: h, payload: { items: [{ personId: a.id, teamCode: 'ar' }, { personId: a.id, teamCode: 'br' }] } })).json().inserted).toBe(2)
  // re-post an owned pair + a new one + B co-owning ar: only the new ones insert (idempotent)
  const res = await app.inject({ method: 'POST', url: '/api/admin/ownership/bulk', headers: h, payload: { items: [{ personId: a.id, teamCode: 'ar' }, { personId: a.id, teamCode: 'fr' }, { personId: b.id, teamCode: 'ar' }] } })
  expect(res.statusCode).toBe(201)
  expect(res.json().inserted).toBe(2) // a/fr and b/ar; a/ar skipped
})

test('bulk ownership rejects a personId from another sweep (400)', async () => {
  const { h: hA } = await adminFor()
  const { h: hB } = await adminFor()
  const pB = (await app.inject({ method: 'POST', url: '/api/admin/people', headers: hB, payload: { name: 'Other', short: 'Other', initials: 'OT', av: '#333' } })).json()
  // admin A tries to allocate to a person belonging to sweep B
  const res = await app.inject({ method: 'POST', url: '/api/admin/ownership/bulk', headers: hA, payload: { items: [{ personId: pB.id, teamCode: 'ar' }] } })
  expect(res.statusCode).toBe(400)
  expect(res.json().error).toBe('unknown_person')
})

test('bulk ownership validates payload + guards', async () => {
  const { h } = await adminFor()
  // empty items → 400 (schema minItems)
  expect((await app.inject({ method: 'POST', url: '/api/admin/ownership/bulk', headers: h, payload: { items: [] } })).statusCode).toBe(400)
  // no cookie on platform host → 401
  expect((await app.inject({ method: 'POST', url: '/api/admin/ownership/bulk', headers: { host: 'platform.test' }, payload: { items: [{ personId: 'x', teamCode: 'ar' }] } })).statusCode).toBe(401)
})

test('bulk delete removes only the listed pairs, scoped to the sweep', async () => {
  const { h } = await adminFor()
  const p = (await app.inject({ method: 'POST', url: '/api/admin/people', headers: h, payload: { name: 'Del', short: 'Del', initials: 'DL', av: '#abc' } })).json()
  await app.inject({ method: 'POST', url: '/api/admin/ownership/bulk', headers: h, payload: { items: [{ personId: p.id, teamCode: 'br' }, { personId: p.id, teamCode: 'ar' }, { personId: p.id, teamCode: 'fr' }] } })
  const res = await app.inject({ method: 'DELETE', url: '/api/admin/ownership/bulk', headers: h, payload: { items: [{ personId: p.id, teamCode: 'br' }, { personId: p.id, teamCode: 'fr' }] } })
  expect(res.statusCode).toBe(200)
  expect(res.json().removed).toBe(2)
  const people = (await app.inject({ method: 'GET', url: '/api/people', headers: h })).json()
  expect(people.find((x) => x.id === p.id).teams).toEqual(['ar'])
})

test('bulk ownership writes publish a sync event for the sweep (so other devices refresh)', async () => {
  const { h, id: sweepId } = await adminFor()
  const p = (await app.inject({ method: 'POST', url: '/api/admin/people', headers: h, payload: { name: 'Sync', short: 'Sync', initials: 'SY', av: '#abc' } })).json()
  // A second app over the SAME db + secret so the cookie/sweep resolve, but with a publish spy.
  const events = []
  const spy = buildApp(db, { sessionSecret: 'test-secret', publish: (e) => events.push(e) })
  await spy.ready()
  try {
    // successful insert → publishes { type:'sync', sweepId }
    const ins = await spy.inject({ method: 'POST', url: '/api/admin/ownership/bulk', headers: h, payload: { items: [{ personId: p.id, teamCode: 'br' }, { personId: p.id, teamCode: 'ar' }] } })
    expect(ins.statusCode).toBe(201)
    expect(events).toContainEqual({ type: 'sync', sweepId })

    // a rejected (unknown_person) call publishes nothing
    events.length = 0
    expect((await spy.inject({ method: 'POST', url: '/api/admin/ownership/bulk', headers: h, payload: { items: [{ personId: 'pn_nope', teamCode: 'fr' }] } })).statusCode).toBe(400)
    expect(events).toEqual([])

    // bulk delete also publishes a sync
    const del = await spy.inject({ method: 'DELETE', url: '/api/admin/ownership/bulk', headers: h, payload: { items: [{ personId: p.id, teamCode: 'br' }] } })
    expect(del.statusCode).toBe(200)
    expect(events).toContainEqual({ type: 'sync', sweepId })
  } finally {
    await spy.close()
  }
})

// Outbound links are built from publicOrigin — the origin the BROWSER uses, which in
// dev is Vite and in production is the Caddy site. Nothing else derives it.
test('links are built from publicOrigin when it is set', async () => {
  const alt = buildApp(db, { sessionSecret: 'test-secret', publicOrigin: 'http://127.0.0.1:5173' })
  await alt.ready()
  const own = await makeSweep('Origin')
  await db.update(sweep).set({ accountId: 'ac_seed' }).where(eq(sweep.id, own.id))
  try {
    // account sessions live in the shared db, so they resolve against `alt` as against `app`
    const list = (await alt.inject({ method: 'GET', url: '/api/account/sweeps', headers: await ownerHeaders(db) })).json()
    expect(list.find((r) => r.id === own.id).memberLink).toBe(`http://127.0.0.1:5173/g/${own.memberToken}`)
  } finally {
    await alt.close()
  }
})

/* --- owner member management ------------------------------------------------ */

test('adding a person with an email stores it lowercased and mails them their own seat', async () => {
  const auth = await adminHeaders(app, db, 'default', 'ac_seed')
  mails.length = 0
  const res = await app.inject({
    method: 'POST', url: '/api/admin/people', headers: auth,
    payload: { name: 'Invited Ivy', short: 'Ivy', initials: 'IV', av: '#123456', email: '  Ivy@X.TEST ' },
  })
  expect(res.statusCode).toBe(201)
  const [row] = await db.select().from(person).where(eq(person.id, res.json().id))
  expect(row.email).toBe('ivy@x.test')
  expect(mails).toHaveLength(1)
  expect(mails[0].to).toBe('ivy@x.test')
  // addressed to this seat: opening it signs them in and claims the row, so they never
  // retype the address the organiser just typed for them
  expect(mails[0].body).toMatch(/\/i\/[0-9A-Za-z]+/)
  await db.delete(person).where(eq(person.id, res.json().id))
})

test('setting the email again is the resend button', async () => {
  const auth = await adminHeaders(app, db, 'default', 'ac_seed')
  const created = (await app.inject({
    method: 'POST', url: '/api/admin/people', headers: auth,
    payload: { name: 'Resend Rae', short: 'Rae', initials: 'RA', av: '#123456' },
  })).json()
  mails.length = 0
  const res = await app.inject({
    method: 'PATCH', url: `/api/admin/people/${created.id}`, headers: auth,
    payload: { email: 'rae@x.test' },
  })
  expect(res.statusCode).toBe(200)
  expect(mails).toHaveLength(1)
  await db.delete(person).where(eq(person.id, created.id))
})

test('ejecting stops them acting, and keeps everything they did', async () => {
  const auth = await adminHeaders(app, db, 'default', 'ac_seed')
  const created = (await app.inject({
    method: 'POST', url: '/api/admin/people', headers: auth,
    payload: { name: 'Gone Greg', short: 'Greg', initials: 'GG', av: '#123456' },
  })).json()
  const seat = await seatFor(db, created.id)
  const [f] = await db.select().from(event).limit(1)
  await db.insert(support).values({ sweepId: 'default', fixtureId: f.id, personId: created.id, teamCode: 'zz' })

  const off = await app.inject({
    method: 'PATCH', url: `/api/admin/people/${created.id}`, headers: auth, payload: { ejected: true },
  })
  expect(off.statusCode).toBe(200)
  expect(off.json().ejected).toBe(true)

  const act = await app.inject({
    method: 'POST', url: '/api/support', headers: { ...auth, ...seat },
    payload: { fixtureId: f.id, teamCode: 'zz' },
  })
  expect(act.statusCode).toBe(403)
  expect(act.json()).toEqual({ error: 'no_seat' })
  // their history is still there — the leaderboard keeps its shape
  expect(await db.select().from(support).where(eq(support.personId, created.id))).toHaveLength(1)

  const on = await app.inject({
    method: 'PATCH', url: `/api/admin/people/${created.id}`, headers: auth, payload: { ejected: false },
  })
  expect(on.json().ejected).toBe(false)

  await db.delete(support).where(eq(support.personId, created.id))
  await releaseSeat(db, created.id)
  await db.delete(person).where(eq(person.id, created.id))
})

test('a member cannot invite or eject anyone', async () => {
  const cookie = await memberCookie(app)
  const [p] = await db.select().from(person).where(eq(person.sweepId, 'default')).limit(1)
  const res = await app.inject({
    method: 'PATCH', url: `/api/admin/people/${p.id}`, headers: { cookie }, payload: { ejected: true },
  })
  expect(res.statusCode).toBe(403)
})

test('the account console can say how many of a sweep have actually joined', async () => {
  const auth = await adminHeaders(app, db, 'default', 'ac_seed')
  const seat = await seatFor(db, 'p4')
  try {
    const rows = (await app.inject({ method: 'GET', url: '/api/account/sweeps', headers: auth })).json()
    const row = rows.find((r) => r.id === 'default')
    expect(row.members.total).toBeGreaterThan(0)
    expect(row.members.registered).toBeGreaterThanOrEqual(1)
    expect(row.members.registered).toBeLessThanOrEqual(row.members.total)
  } finally { await releaseSeat(db, 'p4') }
})

// This route reached for a storage function that no longer exists after the approval
// queue was removed, and nothing caught it: deleting a person who had uploaded anything
// would have thrown. It is the same shape as the 23503 this route used to raise.
test('deleting a person takes their photo files with them', async () => {
  const auth = await adminHeaders(app, db, 'default', 'ac_seed')
  const created = (await app.inject({
    method: 'POST', url: '/api/admin/people', headers: auth,
    payload: { name: 'Snapper', short: 'Snap', initials: 'SN', av: '#123456' },
  })).json()
  await app.photos.writeApproved('del1.jpg', Buffer.from('img'))
  await app.photos.writeApproved('del1_t.jpg', Buffer.from('thumb'))
  await db.insert(photo).values({
    id: 'ph_del1', sweepId: 'default', kind: 'profile', uploaderName: 'Snapper',
    personId: created.id, filePath: 'del1.jpg', thumbPath: 'del1_t.jpg', status: 'approved',
  })

  const res = await app.inject({ method: 'DELETE', url: `/api/admin/people/${created.id}`, headers: auth })
  expect(res.statusCode).toBe(200)
  expect(await db.select().from(photo).where(eq(photo.id, 'ph_del1'))).toHaveLength(0)
  await expect(access(join(photosDir, 'approved', 'del1.jpg'))).rejects.toThrow()
})
