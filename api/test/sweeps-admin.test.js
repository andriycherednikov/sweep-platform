import { expect, test, afterAll, beforeAll } from 'vitest'
import { eq, ne, and, inArray } from 'drizzle-orm'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { person, ownership, account, sweep, competition, operatorAction } from '../src/db/schema.js'
import { newToken } from '../src/sweeps/tokens.js'
import { ownerHeaders } from './helpers/session.js'

const { pool, db } = openTestDb()
const app = buildApp(db, { sessionSecret: 'test-secret' })
beforeAll(async () => { await app.ready() })
afterAll(async () => {
  // Leave the shared test DB as we found it (seed.test.js counts persons globally).
  await db.delete(ownership).where(ne(ownership.sweepId, 'default'))
  await db.delete(person).where(ne(person.sweepId, 'default'))
  await db.delete(operatorAction).where(eq(operatorAction.actorId, 'ac_op_admin'))
  // Only the ones this file made: other suites hold live sweeps in the same database.
  await db.delete(sweep).where(inArray(sweep.id, made))
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
  const memberToken = newToken(), adminToken = newToken()
  const [comp] = await db.select({ id: competition.id }).from(competition).where(eq(competition.id, 'apifootball:1:2026'))
  await db.insert(sweep).values({ id, name, kind: 'token', memberToken, adminToken, competitionId: comp.id })
  return { id, name, memberToken, adminToken }
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

async function adminCookieFor() {
  const created = await makeSweep('Draw')
  const sess = await app.inject({ method: 'POST', url: '/api/session', payload: { token: created.adminToken } })
  return { cookie: sess.headers['set-cookie'], id: created.id }
}

test('group admin creates a person and assigns a team', async () => {
  const { cookie } = await adminCookieFor()
  const h = { host: 'platform.test', cookie }
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
  const { cookie } = await adminCookieFor()
  const h = { host: 'platform.test', cookie }
  const a = (await app.inject({ method: 'POST', url: '/api/admin/people', headers: h, payload: { name: 'A', short: 'A', initials: 'A', av: '#111' } })).json()
  const b = (await app.inject({ method: 'POST', url: '/api/admin/people', headers: h, payload: { name: 'B', short: 'B', initials: 'B', av: '#222' } })).json()
  expect((await app.inject({ method: 'POST', url: '/api/admin/ownership', headers: h, payload: { personId: a.id, teamCode: 'ar' } })).statusCode).toBe(201)
  // a DIFFERENT person co-owning the same team is allowed:
  expect((await app.inject({ method: 'POST', url: '/api/admin/ownership', headers: h, payload: { personId: b.id, teamCode: 'ar' } })).statusCode).toBe(201)
  // the SAME person assigned the SAME team twice → 409 (PK violation):
  expect((await app.inject({ method: 'POST', url: '/api/admin/ownership', headers: h, payload: { personId: a.id, teamCode: 'ar' } })).statusCode).toBe(409)
})

test('assigning/removing an unknown team code is 400 unknown_team (single + bulk)', async () => {
  const { cookie } = await adminCookieFor()
  const h = { host: 'platform.test', cookie }
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
  const { cookie } = await adminCookieFor()
  const h = { host: 'platform.test', cookie }
  const p = (await app.inject({ method: 'POST', url: '/api/admin/people', headers: h, payload: { name: 'Bulk', short: 'Bulk', initials: 'BK', av: '#abc' } })).json()
  const items = [{ personId: p.id, teamCode: 'br' }, { personId: p.id, teamCode: 'ar' }, { personId: p.id, teamCode: 'fr' }]
  const res = await app.inject({ method: 'POST', url: '/api/admin/ownership/bulk', headers: h, payload: { items } })
  expect(res.statusCode).toBe(201)
  expect(res.json().inserted).toBe(3)
  const people = (await app.inject({ method: 'GET', url: '/api/people', headers: h })).json()
  expect(people.find((x) => x.id === p.id).teams.sort()).toEqual(['ar', 'br', 'fr'])
})

test('bulk ownership is idempotent and allows co-ownership across people', async () => {
  const { cookie } = await adminCookieFor()
  const h = { host: 'platform.test', cookie }
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
  const { cookie: cookieA } = await adminCookieFor()
  const { cookie: cookieB } = await adminCookieFor()
  const hA = { host: 'platform.test', cookie: cookieA }
  const hB = { host: 'platform.test', cookie: cookieB }
  const pB = (await app.inject({ method: 'POST', url: '/api/admin/people', headers: hB, payload: { name: 'Other', short: 'Other', initials: 'OT', av: '#333' } })).json()
  // admin A tries to allocate to a person belonging to sweep B
  const res = await app.inject({ method: 'POST', url: '/api/admin/ownership/bulk', headers: hA, payload: { items: [{ personId: pB.id, teamCode: 'ar' }] } })
  expect(res.statusCode).toBe(400)
  expect(res.json().error).toBe('unknown_person')
})

test('bulk ownership validates payload + guards', async () => {
  const { cookie } = await adminCookieFor()
  const h = { host: 'platform.test', cookie }
  // empty items → 400 (schema minItems)
  expect((await app.inject({ method: 'POST', url: '/api/admin/ownership/bulk', headers: h, payload: { items: [] } })).statusCode).toBe(400)
  // no cookie on platform host → 401
  expect((await app.inject({ method: 'POST', url: '/api/admin/ownership/bulk', headers: { host: 'platform.test' }, payload: { items: [{ personId: 'x', teamCode: 'ar' }] } })).statusCode).toBe(401)
})

test('bulk delete removes only the listed pairs, scoped to the sweep', async () => {
  const { cookie } = await adminCookieFor()
  const h = { host: 'platform.test', cookie }
  const p = (await app.inject({ method: 'POST', url: '/api/admin/people', headers: h, payload: { name: 'Del', short: 'Del', initials: 'DL', av: '#abc' } })).json()
  await app.inject({ method: 'POST', url: '/api/admin/ownership/bulk', headers: h, payload: { items: [{ personId: p.id, teamCode: 'br' }, { personId: p.id, teamCode: 'ar' }, { personId: p.id, teamCode: 'fr' }] } })
  const res = await app.inject({ method: 'DELETE', url: '/api/admin/ownership/bulk', headers: h, payload: { items: [{ personId: p.id, teamCode: 'br' }, { personId: p.id, teamCode: 'fr' }] } })
  expect(res.statusCode).toBe(200)
  expect(res.json().removed).toBe(2)
  const people = (await app.inject({ method: 'GET', url: '/api/people', headers: h })).json()
  expect(people.find((x) => x.id === p.id).teams).toEqual(['ar'])
})

test('bulk ownership writes publish a sync event for the sweep (so other devices refresh)', async () => {
  const { cookie, id: sweepId } = await adminCookieFor()
  const h = { host: 'platform.test', cookie }
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
