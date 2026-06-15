import { expect, test, vi } from 'vitest'
import { joinFromLocation } from './bootstrapJoin.js'
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

test('bare member link → posts the member token, then strips the URL to /', async () => {
  const postSession = vi.fn(async () => ({ sweepId: 'sw_9', role: 'member' }))
  const history = fakeHistory()
  await joinFromLocation({ pathname: '/g/MEMBERtoken0000000000' }, history, postSession)
  expect(postSession).toHaveBeenCalledWith('MEMBERtoken0000000000')
  expect(history.replaceState).toHaveBeenCalledWith({}, '', '/')
})

test('admin link → exchanges the ADMIN token (admin wins over member)', async () => {
  const postSession = vi.fn(async () => ({ sweepId: 'sw_9', role: 'admin' }))
  const history = fakeHistory()
  await joinFromLocation(
    { pathname: '/g/MEMBERtoken0000000000/admin/ADMINtoken00000000000' },
    history,
    postSession,
  )
  expect(postSession).toHaveBeenCalledWith('ADMINtoken00000000000')
  expect(history.replaceState).toHaveBeenCalledWith({}, '', '/')
})

test('a failed exchange still strips the URL (no token left in the address bar)', async () => {
  const postSession = vi.fn(async () => { throw new Error('POST /api/session failed: HTTP 401') })
  const history = fakeHistory()
  await joinFromLocation({ pathname: '/g/badtoken000000000000' }, history, postSession)
  expect(postSession).toHaveBeenCalledWith('badtoken000000000000')
  expect(history.replaceState).toHaveBeenCalledWith({}, '', '/')
})

test('a successful join persists the real link token via addSweep (name null pre-bootstrap)', async () => {
  localStorage.clear()
  const postSession = vi.fn(async () => ({ sweepId: 'sw_42', role: 'admin' }))
  const history = fakeHistory()
  await joinFromLocation(
    { pathname: '/g/MEMBERtoken0000000000/admin/ADMINtoken00000000000' },
    history,
    postSession,
  )
  expect(listSweeps()).toEqual([
    { sweepId: 'sw_42', name: null, role: 'admin', token: 'ADMINtoken00000000000' },
  ])
})
