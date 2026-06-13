import { expect, test, beforeEach, vi } from 'vitest'
import { SWEEP, setSweepData } from './data.js'
import { assembleSweep } from './lib/assemble.js'

vi.mock('./api/client.js', () => ({
  postWatch: vi.fn(async () => ({ watching: true })),
  postSupport: vi.fn(async () => ({ supporting: 'hr' })),
}))
vi.mock('./lib/analytics.js', () => ({ trackEvent: vi.fn() }))
import { postWatch, postSupport } from './api/client.js'
import { trackEvent } from './lib/analytics.js'
import {
  getMe, setMe, watchersOf, toggleWatch, isWatching,
  setSocialData, supportOf, mySupport, setSupport, predictionLeaderboard,
} from './social.js'

function seedFixture() {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'A', pool: 'P', color: '#c00', strength: 80 },
        { code: 'br', name: 'Brazil', group: 'A', pool: 'P', color: '#0c0', strength: 90 },
      ],
      people: [{ id: 'p1', name: 'Andriy', short: 'Andriy', initials: 'A', av: '#000', avatarPath: null }],
      ownership: {}, scoring: null,
    },
    fixtures: [{ id: 'm1', ko: '2026-06-20T18:00:00Z', t1: 'hr', t2: 'br', status: 'upcoming', group: 'A', stage: 'group', prob: null, score: null }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ watch: {}, support: {} })
}

beforeEach(() => {
  localStorage.clear()
  setMe(null) // reset in-memory identity (module state persists across tests in a file)
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

test('predictionLeaderboard ranks people by correct crowd calls on finished matches', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'A', pool: 'P', color: '#c00', strength: 80 },
        { code: 'br', name: 'Brazil', group: 'A', pool: 'P', color: '#093', strength: 90 },
      ],
      people: [
        { id: 'p1', name: 'A', short: 'A', initials: 'A', av: '#000', avatarPath: null },
        { id: 'p2', name: 'B', short: 'B', initials: 'B', av: '#111', avatarPath: null },
      ],
      ownership: {}, scoring: null,
    },
    fixtures: [{ id: 'm1', group: 'A', matchday: 1, t1: 'hr', t2: 'br', ko: '2026-06-10T12:00:00Z', venue: 'V', city: 'C', status: 'final', score: [2, 1], minute: 90, prob: { a: 50, d: 25, b: 25 }, stage: 'group' }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ watch: {}, support: { m1: { p1: 'hr', p2: 'br' } } }) // p1 called the winner, p2 didn't
  const lb = predictionLeaderboard(4)
  expect(lb[0].person.id).toBe('p1')
  expect(lb[0].correct).toBe(1)
  expect(lb.find((x) => x.person.id === 'p2').correct).toBe(0)
})

test('predictionLeaderboard credits a DRAW pick on a level final and misses team picks', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'A', pool: 'P', color: '#a00', strength: 70 },
        { code: 'br', name: 'Brazil', group: 'A', pool: 'P', color: '#0a0', strength: 80 },
      ],
      people: [
        { id: 'p1', name: 'A', short: 'A', initials: 'A', av: '#000', avatarPath: null },
        { id: 'p2', name: 'B', short: 'B', initials: 'B', av: '#111', avatarPath: null },
      ],
      ownership: {}, scoring: null,
    },
    fixtures: [{ id: 'm1', group: 'A', matchday: 1, t1: 'hr', t2: 'br', ko: '2026-06-10T12:00:00Z', venue: 'V', city: 'C', status: 'final', score: [1, 1], minute: 90, prob: { a: 33, d: 34, b: 33 }, stage: 'group' }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ watch: {}, support: { m1: { p1: 'DRAW', p2: 'hr' } } })
  const lb = predictionLeaderboard(4)
  const p1 = lb.find(x => x.person.id === 'p1')
  const p2 = lb.find(x => x.person.id === 'p2')
  expect(p1).toMatchObject({ correct: 1, total: 1 })
  expect(p2).toMatchObject({ correct: 0, total: 1 })
})

test('writes require identity — no me means no POST', () => {
  // window.__sweepPickMe would normally open the identity sheet; stub it
  window.__sweepPickMe = vi.fn()
  expect(toggleWatch('m1')).toBe(false)
  expect(postWatch).not.toHaveBeenCalled()
})

test('setSupport emits vote_cast with home/away/draw pick + match_id when a pick is set', () => {
  seedFixture()
  setMe('p1')
  setSupport('m1', 'hr') // hr === t1 → home
  expect(trackEvent).toHaveBeenCalledWith('vote_cast', { pick: 'home', match_id: 'm1' })

  setSupport('m1', 'br') // switch to t2 → away (replaces the pick)
  expect(trackEvent).toHaveBeenCalledWith('vote_cast', { pick: 'away', match_id: 'm1' })

  setSupport('m1', 'DRAW') // DRAW sentinel → draw
  expect(trackEvent).toHaveBeenCalledWith('vote_cast', { pick: 'draw', match_id: 'm1' })
})

test('setSupport does NOT emit vote_cast when a pick is removed (re-tap)', () => {
  seedFixture()
  setMe('p1')
  setSupport('m1', 'hr')      // set
  trackEvent.mockClear()
  setSupport('m1', 'hr')      // same code again → un-vote
  expect(trackEvent).not.toHaveBeenCalled()
})

test('setSupport does NOT emit vote_cast when the fixture is unknown', () => {
  seedFixture()
  setMe('p1')
  trackEvent.mockClear()
  setSupport('NOPE', 'hr') // 'NOPE' is not a seeded fixture id → S.fixture() is null
  expect(trackEvent).not.toHaveBeenCalled()
})
