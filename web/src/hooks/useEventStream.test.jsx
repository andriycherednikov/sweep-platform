// web/src/hooks/useEventStream.test.jsx
import { expect, test, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
vi.mock('../notifications.js', () => ({ pushNotification: vi.fn() }))
import { pushNotification } from '../notifications.js'
const admin = vi.hoisted(() => ({ state: { isAdmin: false }, refresh: vi.fn() }))
vi.mock('../admin.js', () => ({ getAdminBadge: () => admin.state, refreshAdminBadge: admin.refresh }))
import { useEventStream } from './useEventStream.js'
import { setSweepData } from '../data.js'
import { assembleSweep } from '../lib/assemble.js'

function seedFixture(status, score) {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'ar', name: 'Argentina', group: 'A', pool: 'P', color: '#6cf', strength: 90 },
        { code: 'mx', name: 'Mexico', group: 'A', pool: 'P', color: '#0a7', strength: 76 },
      ],
      people: [], ownership: {}, scoring: null,
    },
    fixtures: [{ id: 'm1', group: 'A', matchday: 1, t1: 'ar', t2: 'mx', ko: '2026-06-13T06:30:00Z', venue: 'V', city: 'C', status, score, minute: status === 'live' ? 63 : null, prob: { a: 50, d: 25, b: 25 }, stage: 'group' }],
    standings: {}, photos: [],
  }))
}

let instances
class FakeES {
  constructor(url){ this.url = url; this.onmessage = null; this.onopen = null; this.closed = false; instances.push(this) }
  emit(obj){ this.onmessage && this.onmessage({ data: JSON.stringify(obj) }) }
  open(){ this.onopen && this.onopen() }
  close(){ this.closed = true }
}

beforeEach(() => { instances = []; vi.stubGlobal('EventSource', FakeES); pushNotification.mockClear(); admin.refresh.mockClear(); admin.state = { isAdmin: false } })

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

test('a support pick/switch pushes a floating reaction; a remove does not', () => {
  const { es } = setup()
  es.emit({ type: 'support', fixtureId: 'm1', personId: 'p1', supporting: 'br', action: 'pick' })
  expect(pushNotification).toHaveBeenCalledWith({ personId: 'p1', teamCode: 'br', fixtureId: 'm1', action: 'pick' })
  es.emit({ type: 'support', fixtureId: 'm1', personId: 'p1', supporting: null, action: 'remove' })
  expect(pushNotification).toHaveBeenCalledTimes(1) // remove did not push
})

test('photo-pending refreshes the admin badge only when admin', () => {
  const { es } = setup()
  es.emit({ type: 'photo-pending' })
  expect(admin.refresh).not.toHaveBeenCalled() // not admin → ignored
  admin.state = { isAdmin: true }
  es.emit({ type: 'photo-pending' })
  expect(admin.refresh).toHaveBeenCalledTimes(1)
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

test('photo-approved/photo-removed events invalidate the sweep query', () => {
  const { spy, es } = setup()
  es.emit({ type: 'photo-approved', id: 'p1', kind: 'fan' })
  es.emit({ type: 'photo-removed', id: 'p2', kind: 'profile' })
  expect(spy.mock.calls.filter((c) => c[0]?.queryKey?.[0] === 'sweep')).toHaveLength(2)
})

test('a kickoff (upcoming→live) pushes a match-start reaction', () => {
  seedFixture('upcoming', null)
  const { es } = setup()
  es.emit({ type: 'score', fixtureId: 'm1', status: 'live', score: [0, 0], minute: 1 })
  expect(pushNotification).toHaveBeenCalledWith(expect.objectContaining({ kind: 'match', event: 'start', fixtureId: 'm1' }))
})

test('a score rise no longer pushes a goal reaction (the events feed owns goals now)', () => {
  seedFixture('live', [0, 0])
  const { es } = setup()
  es.emit({ type: 'score', fixtureId: 'm1', status: 'live', score: [1, 0], minute: 20 })
  expect(pushNotification).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'goal' }))
})

test('a goal event pushes an enriched goal reaction with scorer, minute and score', () => {
  seedFixture('live', [0, 0])
  const { es } = setup()
  es.emit({ type: 'goal', fixtureId: 'm1', teamCode: 'ar', player: 'Messi', assist: 'Di Maria', minute: 23, detail: 'Penalty', score: [1, 0] })
  expect(pushNotification).toHaveBeenCalledWith({ kind: 'match', event: 'goal', fixtureId: 'm1', teamCode: 'ar', player: 'Messi', assist: 'Di Maria', minute: 23, detail: 'Penalty', score: [1, 0] })
})

test('a card event pushes a card reaction', () => {
  seedFixture('live', [0, 0])
  const { es } = setup()
  es.emit({ type: 'card', fixtureId: 'm1', teamCode: 'mx', player: 'Herrera', minute: 55, card: 'red', detail: 'Red Card' })
  expect(pushNotification).toHaveBeenCalledWith({ kind: 'match', event: 'card', fixtureId: 'm1', teamCode: 'mx', player: 'Herrera', minute: 55, card: 'red', detail: 'Red Card' })
})

test('full time (live→final) pushes a match-final reaction', () => {
  seedFixture('live', [2, 0])
  const { es } = setup()
  es.emit({ type: 'score', fixtureId: 'm1', status: 'final', score: [2, 0], minute: 90 })
  expect(pushNotification).toHaveBeenCalledWith(expect.objectContaining({ kind: 'match', event: 'final', fixtureId: 'm1', score: [2, 0] }))
})

test('a minute tick (no score/status change) pushes no match reaction', () => {
  seedFixture('live', [1, 0])
  const { es } = setup()
  es.emit({ type: 'score', fixtureId: 'm1', status: 'live', score: [1, 0], minute: 64 })
  expect(pushNotification).not.toHaveBeenCalled()
})

test('closes the stream on unmount', () => {
  const qc = new QueryClient()
  const wrapper = ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  const { unmount } = renderHook(() => useEventStream(), { wrapper })
  unmount()
  expect(instances[0].closed).toBe(true)
})

test('bet and bet-settled events invalidate the coins query', () => {
  const { spy, es } = setup()
  es.emit({ type: 'bet', sweepId: 'default' })
  es.emit({ type: 'bet-settled', sweepId: 'default' })
  expect(spy).toHaveBeenCalledWith({ queryKey: ['coins'] })
})

test('on (re)open it also invalidates the coins query', () => {
  const { spy, es } = setup()
  es.open()
  expect(spy).toHaveBeenCalledWith({ queryKey: ['coins'] })
})

test('bet-settled invalidates the coins query (prefix covers the statement ledger key)', () => {
  const { spy, es } = setup()
  es.emit({ type: 'bet-settled' })
  // ['coins'] is a prefix of the statement key ['coins','ledger',id], so this one call
  // refreshes both the wallet and the open statement — no separate invalidation needed.
  expect(spy).toHaveBeenCalledWith({ queryKey: ['coins'] })
})
