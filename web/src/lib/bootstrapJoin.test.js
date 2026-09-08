import { expect, test, vi } from 'vitest'
import { joinFromLocation, inviteFromLocation } from './bootstrapJoin.js'
import { listSweeps } from '../sweeps.js'

function fakeHistory() {
  return { replaceState: vi.fn() }
}

test('no join link → does nothing (no session, no URL change)', async () => {
  const postSession = vi.fn(async () => ({ sweepId: 'sw_1', role: 'member' }))
  const history = fakeHistory()
  await joinFromLocation({ pathname: '/teams/ar' }, history, postSession)
  expect(postSession).not.toHaveBeenCalled()
  expect(history.replaceState).not.toHaveBeenCalled()
})

// The invite is a credential and does not belong in the address bar, but stripping it
// to '/' left the sweep with no address at all — '/' is the marketing front door. It
// lands on the sweep's own path instead: bookmarkable, screenshot-safe, grants nothing.
test('bare member link → posts the member token, then lands on the sweep path', async () => {
  const postSession = vi.fn(async () => ({ sweepId: 'sw_9', role: 'member' }))
  const history = fakeHistory()
  await joinFromLocation({ pathname: '/g/MEMBERtoken0000000000' }, history, postSession)
  expect(postSession).toHaveBeenCalledWith('MEMBERtoken0000000000')
  expect(history.replaceState).toHaveBeenCalledWith({}, '', '/s/sw_9')
})

// The admin segment names nothing the API accepts any more — it degrades to the
// still-valid member token rather than dying with a 404.
test('an old admin link degrades to exchanging the member token', async () => {
  const postSession = vi.fn(async () => ({ sweepId: 'sw_9', role: 'member' }))
  const history = fakeHistory()
  await joinFromLocation(
    { pathname: '/g/MEMBERtoken0000000000/admin/ADMINtoken00000000000' },
    history,
    postSession,
  )
  expect(postSession).toHaveBeenCalledWith('MEMBERtoken0000000000')
  expect(history.replaceState).toHaveBeenCalledWith({}, '', '/s/sw_9')
})

// The token still goes, but the failure has to survive the strip: without a marker
// the Gate cannot tell a dead invite from a stranger, and shows the invitee the
// marketing page — the one screen that answers none of their questions.
test('a failed exchange strips the token and flags the failure', async () => {
  const postSession = vi.fn(async () => { throw new Error('POST /api/session failed: HTTP 401') })
  const history = fakeHistory()
  await joinFromLocation({ pathname: '/g/badtoken000000000000' }, history, postSession)
  expect(postSession).toHaveBeenCalledWith('badtoken000000000000')
  expect(history.replaceState).toHaveBeenCalledWith({}, '', '/?join=failed')
})

// Name and role are both unknown at this point: bootstrap has not run, and
// POST /api/session stopped returning a role when roles left the cookie. The Gate
// backfills both — a role read from this response would only ever be undefined.
test('a successful join persists the real link token via addSweep (name and role null pre-bootstrap)', async () => {
  localStorage.clear()
  const postSession = vi.fn(async () => ({ sweepId: 'sw_42', role: 'admin' }))
  const history = fakeHistory()
  await joinFromLocation(
    { pathname: '/g/MEMBERtoken0000000000/admin/ADMINtoken00000000000' },
    history,
    postSession,
  )
  expect(listSweeps()).toEqual([
    { sweepId: 'sw_42', name: null, role: null, token: 'MEMBERtoken0000000000' },
  ])
})

test('an invite link signs the invitee in and lands them on their sweep', async () => {
  localStorage.clear()
  const postInviteSession = vi.fn(async () => ({ accountToken: 'tok', sweepId: 'sw_9', person: { id: 'pn_1' } }))
  const history = fakeHistory()
  await inviteFromLocation({ pathname: '/i/INVITEtoken0000000000' }, history, postInviteSession)
  expect(postInviteSession).toHaveBeenCalledWith('INVITEtoken0000000000')
  expect(history.replaceState).toHaveBeenCalledWith({}, '', '/s/sw_9')
  expect(listSweeps()).toEqual([{ sweepId: 'sw_9', name: null, role: null, token: null }])
})

test('a spent or expired invite says so instead of landing nowhere', async () => {
  const postInviteSession = vi.fn(async () => { throw new Error('HTTP 401') })
  const history = fakeHistory()
  await inviteFromLocation({ pathname: '/i/deadtoken0000000000' }, history, postInviteSession)
  expect(history.replaceState).toHaveBeenCalledWith({}, '', '/?invite=failed')
})

test('a non-invite path is left alone', async () => {
  const postInviteSession = vi.fn()
  const history = fakeHistory()
  await inviteFromLocation({ pathname: '/s/sw_1' }, history, postInviteSession)
  expect(postInviteSession).not.toHaveBeenCalled()
  expect(history.replaceState).not.toHaveBeenCalled()
})
