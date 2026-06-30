import { expect, test, beforeEach, vi } from 'vitest'
import { SWEEP, setSweepData } from './data.js'
import { assembleSweep } from './lib/assemble.js'

vi.mock('./api/client.js', () => ({
  postSupport: vi.fn(async () => ({ supporting: 'hr' })),
}))
vi.mock('./lib/analytics.js', () => ({ trackEvent: vi.fn() }))
import { postSupport } from './api/client.js'
import { trackEvent } from './lib/analytics.js'
import {
  getMe, setMe,
  setSocialData, supportOf, mySupport, setSupport, predictionLeaderboard,
  predictionsOf, predictionAccuracy, setCurrentSweepId,
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
  setSocialData({ support: {} })
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
  setSocialData({ support: {} })
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
  setSocialData({ support: { m1: { p1: 'hr', p2: 'br' } } }) // p1 called the winner, p2 didn't
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
  setSocialData({ support: { m1: { p1: 'DRAW', p2: 'hr' } } })
  const lb = predictionLeaderboard(4)
  const p1 = lb.find(x => x.person.id === 'p1')
  const p2 = lb.find(x => x.person.id === 'p2')
  expect(p1).toMatchObject({ correct: 1, total: 1 })
  expect(p2).toMatchObject({ correct: 0, total: 1 })
})

test('writes require identity — no me means no POST', () => {
  // window.__sweepPickMe would normally open the identity sheet; stub it
  window.__sweepPickMe = vi.fn()
  setSupport('m1', 'hr')
  expect(window.__sweepPickMe).toHaveBeenCalled()
  expect(postSupport).not.toHaveBeenCalled()
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

function seedPreds(fixtures, support) {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#c00', strength: 82 },
        { code: 'en', name: 'England', group: 'L', pool: 'A', color: '#fff', strength: 90 },
      ],
      people: [{ id: 'p1', name: 'Ann', short: 'Ann' }],
      ownership: {}, scoring: null,
    },
    fixtures, standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ support })
}

const predFx = (id, status, score) => ({
  id, group: 'L', matchday: 1, t1: 'hr', t2: 'en', ko: '2026-06-13T22:00:00Z',
  venue: 'V', city: 'C', status, score, minute: null, prob: null, stage: 'group',
})

test('predictionsOf returns one entry per fixture the person picked, with verdicts', () => {
  seedPreds(
    [predFx('m1', 'final', [2, 1]), predFx('m2', 'final', [0, 2]), predFx('m3', 'upcoming', null)],
    { m1: { p1: 'hr' }, m2: { p1: 'hr' }, m3: { p1: 'en' } }
  )
  const out = predictionsOf('p1')
  expect(out.map(p => p.f.id)).toEqual(['m1', 'm2', 'm3'])
  expect(out.find(p => p.f.id === 'm1').verdict).toBe('correct') // hr won 2-1
  expect(out.find(p => p.f.id === 'm2').verdict).toBe('wrong')   // en won, picked hr
  expect(out.find(p => p.f.id === 'm3').verdict).toBe(null)      // not played
})

test('predictionsOf scores a DRAW pick correct on a level final', () => {
  seedPreds([predFx('m1', 'final', [1, 1])], { m1: { p1: 'DRAW' } })
  expect(predictionsOf('p1')[0].verdict).toBe('correct')
})

test('predictionsOf grades a penalty shootout by winnerCode, not the tied score', () => {
  // 1-1 knockout decided on penalties (winnerCode: hr). Picking the shootout winner is
  // correct; picking DRAW is wrong — matching the server, which pays out the hr backer.
  const koFx = { ...predFx('k1', 'final', [1, 1]), winnerCode: 'hr', penScore: [4, 3], stage: 'knockout' }
  seedPreds([koFx], { k1: { p1: 'hr' } })
  expect(predictionsOf('p1')[0].verdict).toBe('correct')
  setSocialData({ support: { k1: { p1: 'DRAW' } } })
  expect(predictionsOf('p1')[0].verdict).toBe('wrong')
})

test('predictionLeaderboard grades a penalty shootout by winnerCode', () => {
  const koFx = { ...predFx('k1', 'final', [1, 1]), winnerCode: 'hr', penScore: [4, 3], stage: 'knockout' }
  seedPreds([koFx], { k1: { p1: 'hr' } })
  const lb = predictionLeaderboard(4)
  expect(lb.find((x) => x.person.id === 'p1')).toMatchObject({ correct: 1, total: 1 })
})

test('predictionsOf is empty for a person who picked nothing', () => {
  seedPreds([predFx('m1', 'final', [2, 1])], { m1: { p1: 'hr' } })
  expect(predictionsOf('pX')).toEqual([])
})

test('predictionAccuracy counts only resolved (final) predictions', () => {
  seedPreds(
    [predFx('m1', 'final', [2, 1]), predFx('m2', 'final', [0, 2]), predFx('m3', 'upcoming', null)],
    { m1: { p1: 'hr' }, m2: { p1: 'hr' }, m3: { p1: 'en' } }
  )
  expect(predictionAccuracy('p1')).toEqual({ correct: 1, total: 2 })
})

test('predictionAccuracy returns 0/0 when there are no resolved picks', () => {
  seedPreds([predFx('m1', 'upcoming', null)], { m1: { p1: 'hr' } })
  expect(predictionAccuracy('p1')).toEqual({ correct: 0, total: 0 })
})

test('getMe/setMe are scoped to the active sweep id', () => {
  setCurrentSweepId('sw_a')
  setMe('p1')
  expect(localStorage.getItem('sweep.me.v1.sw_a')).toBe('p1')

  setCurrentSweepId('sw_b')
  expect(getMe()).toBe(null)            // no pick in sw_b yet
  setMe('p1')
  expect(localStorage.getItem('sweep.me.v1.sw_b')).toBe('p1')

  setCurrentSweepId('sw_a')
  expect(getMe()?.id).toBe('p1')        // sw_a's pick is still there, independent of sw_b
})

test('switching sweeps re-resolves the current identity from that sweep key', () => {
  localStorage.setItem('sweep.me.v1.sw_a', 'p1')
  setCurrentSweepId('sw_a')
  expect(getMe()?.id).toBe('p1')
  setCurrentSweepId('sw_b')
  expect(getMe()).toBe(null)
})

test('legacy sweep.me.v1 is migrated once to sweep.me.v1.default', () => {
  localStorage.setItem('sweep.me.v1', 'p1')   // a current community user's existing pick
  setCurrentSweepId('default')
  expect(localStorage.getItem('sweep.me.v1.default')).toBe('p1')  // copied across
  expect(getMe()?.id).toBe('p1')                                  // resolved on the default sweep
})

test('migration does not clobber an existing default pick', () => {
  localStorage.setItem('sweep.me.v1', 'p1')            // legacy value
  localStorage.setItem('sweep.me.v1.default', 'none')  // already migrated/cleared
  setCurrentSweepId('default')
  expect(localStorage.getItem('sweep.me.v1.default')).toBe('none')  // not overwritten
  expect(getMe()).toBe(null)                                        // "none" = explicitly cleared
})
