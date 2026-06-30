import { expect, test } from 'vitest'
import { assembleSweep, twoWayProb, threeWayProb, progressProb, winnerCodeOf } from './assemble.js'

const api = {
  bootstrap: {
    teams: [
      { code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#d8334a', strength: 80 },
      { code: 'gh', name: 'Ghana', group: 'L', pool: 'B', color: '#1f8a4c', strength: 65 },
      { code: 'br', name: 'Brazil', group: 'C', pool: 'A', color: '#f3c318', strength: 88 },
    ],
    people: [
      { id: 'p1', name: 'Andriy Cherednikov', short: 'Andriy C.', initials: 'AC', av: '#c9472f', avatarPath: null },
      { id: 'p2', name: 'Priya', short: 'Priya', initials: 'PR', av: '#3b6fd1', avatarPath: null },
    ],
    ownership: { p1: ['hr'], p2: ['hr', 'br'] },
    scoring: { rule: 'top3', coOwners: 'all_win' },
  },
  fixtures: [
    { id: 'm1', group: 'L', matchday: 1, t1: 'hr', t2: 'gh', ko: '2026-06-13T09:00:00.000Z', venue: 'V', city: 'C', status: 'upcoming', score: null, minute: null, prob: { a: 60, d: 22, b: 18 }, stage: 'group', derby: false, doubleOwner: false },
  ],
  standings: {
    L: [
      { code: 'hr', name: 'Croatia', played: 0, win: 0, draw: 0, loss: 0, gf: 0, ga: 0, gd: 0, pts: 0 },
      { code: 'gh', name: 'Ghana', played: 0, win: 0, draw: 0, loss: 0, gf: 0, ga: 0, gd: 0, pts: 0 },
    ],
    C: [{ code: 'br', name: 'Brazil', played: 0, win: 0, draw: 0, loss: 0, gf: 0, ga: 0, gd: 0, pts: 0 }],
  },
  photos: [{ id: 'ph1', kind: 'fan', uploader: 'Priya', fixtureId: 'm1', caption: 'hi', src: '/photos/seed/ph1.jpg', status: 'approved' }],
  syncStatus: { stale: false, lastBaselineAt: null, lastLiveAt: null },
}

test('assembles teams keyed by code with owners and stats', () => {
  const S = assembleSweep(api)
  expect(S.team('hr').name).toBe('Croatia')
  expect(S.team('hr').owners.map((o) => o.id).sort()).toEqual(['p1', 'p2'])
  expect(typeof S.team('hr').titleOdds).toBe('number')
})

test('teams carry squad passthrough (null by default)', () => {
  const S = assembleSweep(api)
  expect(S.team('hr').squad).toBeNull()
  const S2 = assembleSweep({ ...api, bootstrap: { ...api.bootstrap, teams: api.bootstrap.teams.map((t) => t.code === 'hr' ? { ...t, squad: [{ name: 'L. Modric', number: 10, pos: 'Midfielder', photo: 'p.png' }] } : t) } })
  expect(S2.team('hr').squad).toEqual([{ name: 'L. Modric', number: 10, pos: 'Midfielder', photo: 'p.png' }])
})

test('people carry their team codes', () => {
  const S = assembleSweep(api)
  expect(S.people.find((p) => p.id === 'p2').teams).toEqual(['hr', 'br'])
})

test('people carry the server-recorded Wagers self-exclusion flag (default false)', () => {
  const S = assembleSweep(api)
  expect(S.people.find((p) => p.id === 'p1').excluded).toBe(false)
  const S2 = assembleSweep({ ...api, bootstrap: { ...api.bootstrap, people: api.bootstrap.people.map((p) => p.id === 'p1' ? { ...p, excluded: true } : p) } })
  expect(S2.peopleById.p1.excluded).toBe(true)
  expect(S2.peopleById.p2.excluded).toBe(false)
})

test('fixtures get Date kickoff, time labels, and derby/owners from ownership', () => {
  const S = assembleSweep(api)
  const f = S.fixtures[0]
  expect(f.ko instanceof Date).toBe(true)
  expect(typeof f.dayKey).toBe('string')
  expect(f.t1).toBe('hr')
  // hr owned (p1,p2), gh unowned → not a derby
  expect(f.derby).toBe(false)
  const owners = S.ownersForFixture(f)
  expect(owners.t1.map((p) => p.id).sort()).toEqual(['p1', 'p2'])
  expect(owners.t2).toEqual([])
})

test('hasOdds: true for real predictions, false for provider placeholders/absent', () => {
  const odds = (prob) => assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'L', pool: 'P', color: '#0a7', strength: 70 },
        { code: 'gh', name: 'Ghana', group: 'L', pool: 'P', color: '#a30', strength: 60 },
      ],
      people: [], ownership: {}, scoring: null,
    },
    fixtures: [{ id: 'm1', group: 'L', matchday: 1, t1: 'hr', t2: 'gh', ko: '2026-06-13T09:00:00.000Z', venue: 'V', city: 'C', status: 'upcoming', score: null, minute: null, prob, stage: 'group' }],
    standings: {}, photos: [],
  }).fixtures[0].hasOdds
  expect(odds({ a: 60, d: 22, b: 18 })).toBe(true)   // real model output
  expect(odds({ a: 33, d: 33, b: 33 })).toBe(false)  // all-equal placeholder
  expect(odds({ a: 50, d: 50, b: 0 })).toBe(false)   // draw ties home (API-Football future-fixture default)
  expect(odds({ a: 0, d: 50, b: 50 })).toBe(false)   // draw ties away
  expect(odds({ a: null, d: null, b: null })).toBe(false) // no prediction stored
})

test('twoWayProb renormalizes home vs away to 100, excluding the draw', () => {
  expect(twoWayProb({ a: 53, d: 26, b: 21 })).toEqual({ pa: 72, pb: 28 })
  expect(twoWayProb({ a: 60, d: 22, b: 18 })).toEqual({ pa: 77, pb: 23 })
  expect(twoWayProb({ a: 0, d: 0, b: 0 })).toEqual({ pa: 50, pb: 50 })          // div-by-zero guard
  expect(twoWayProb({ a: null, d: null, b: null })).toEqual({ pa: 50, pb: 50 }) // absent guard
})

test('threeWayProb renders home / draw / away summing to 100, draw absorbs rounding', () => {
  expect(threeWayProb({ a: 60, d: 22, b: 18 })).toEqual({ pa: 60, pd: 22, pb: 18 })
  expect(threeWayProb({ a: 53, d: 26, b: 21 })).toEqual({ pa: 53, pd: 26, pb: 21 })
  // win sides rounded, draw fills the remainder so the three always total 100
  const p = threeWayProb({ a: 1, d: 1, b: 1 })
  expect(p.pa + p.pd + p.pb).toBe(100)
  expect(threeWayProb({ a: 0, d: 0, b: 0 })).toEqual({ pa: 34, pd: 33, pb: 33 }) // div-by-zero guard
})

test('progressProb prefers To Qualify odds (advance prob), else the draw-collapsed 1x2', () => {
  // toq odds HOME 1.57 / AWAY 2.38 → implied .637/.420, normalised ≈ 60/40 (ignores the 1x2 draw)
  const f = { markets: { toq: { selections: [{ key: 'HOME', odds: 1.57 }, { key: 'AWAY', odds: 2.38 }] } }, prob: { a: 27, d: 28, b: 45 } }
  expect(progressProb(f)).toEqual({ pa: 60, pb: 40 })
  // no toq market → falls back to the two-way 1x2 split
  expect(progressProb({ prob: { a: 53, d: 26, b: 21 } })).toEqual({ pa: 72, pb: 28 })
})

test('fixtures carry two-way prob2, three-way prob3, and pass lineups through (null by default)', () => {
  const S = assembleSweep(api)
  expect(S.fixtures[0].prob2).toEqual({ pa: 77, pb: 23 }) // from base api prob {a:60,d:22,b:18}
  expect(S.fixtures[0].prob3).toEqual({ pa: 60, pd: 22, pb: 18 })
  expect(S.fixtures[0].lineups).toBeNull()
  const S2 = assembleSweep({ ...api, fixtures: [{ ...api.fixtures[0], lineups: [{ teamCode: 'hr', formation: '4-3-3', startXI: [] }] }] })
  expect(S2.fixtures[0].lineups).toEqual([{ teamCode: 'hr', formation: '4-3-3', startXI: [] }])
})

test('standings are grouped and money is ranked by best-team strength (no wins yet → strength tiebreak)', () => {
  const S = assembleSweep(api)
  expect(Object.keys(S.standings)).toEqual(expect.arrayContaining(['L', 'C']))
  expect(S.money[0].strength).toBeGreaterThanOrEqual(S.money[1].strength)
  expect(S.money[0].person).toBeTruthy()
})

test('money sorts people by wins across final fixtures (overrides strength) and reports the total', () => {
  const fx = (id, t1, t2, score) => ({ id, group: 'X', matchday: 1, t1, t2, ko: `2026-06-1${id.slice(1)}T12:00:00Z`, venue: 'V', city: 'C', status: 'final', score, minute: 90, prob: null, stage: 'group' })
  const S = assembleSweep({
    bootstrap: {
      teams: [
        { code: 'a', name: 'A', group: 'X', pool: 'P', color: '#000', strength: 60 },
        { code: 'b', name: 'B', group: 'X', pool: 'P', color: '#000', strength: 90 },
      ],
      people: [
        { id: 'p1', name: 'Strong', short: 'S', initials: 'S', av: '#000', avatarPath: null },
        { id: 'p2', name: 'Winning', short: 'W', initials: 'W', av: '#000', avatarPath: null },
      ],
      ownership: { p1: ['b'], p2: ['a'] }, // p1 has the stronger team, p2 has more wins
      scoring: null,
    },
    // a wins three, b wins one → p2 (owns a) outranks p1 (owns b) despite the weaker team
    fixtures: [fx('m1', 'a', 'b', [1, 0]), fx('m2', 'a', 'b', [2, 0]), fx('m3', 'a', 'b', [3, 1]), fx('m4', 'b', 'a', [2, 1])],
    standings: {},
    photos: [],
  })
  expect(S.money[0].person.id).toBe('p2') // 3 wins ranks above 1 win, despite weaker team
  expect(S.money[0].wins).toBe(3)
  expect(S.money[1].wins).toBe(1)
})

test('money counts a knockout penalty-shootout win (winnerCode on a tied score)', () => {
  const S = assembleSweep({
    bootstrap: {
      teams: [
        { code: 'py', name: 'Paraguay', group: 'D', pool: 'A', color: '#c00', strength: 68 },
        { code: 'de', name: 'Germany', group: 'D', pool: 'A', color: '#000', strength: 90 },
      ],
      people: [{ id: 'p1', name: 'Havill', short: 'Havill', initials: 'H', av: '#0a0', avatarPath: null }],
      ownership: { p1: ['py'] }, scoring: null,
    },
    fixtures: [
      { id: 'g1', group: 'D', matchday: 1, t1: 'py', t2: 'de', ko: '2026-06-20T12:00:00Z', venue: 'V', city: 'C', status: 'final', score: [1, 0], minute: 90, prob: null, stage: 'group' },
      { id: 'k1', group: '', matchday: 0, t1: 'py', t2: 'de', ko: '2026-06-30T12:00:00Z', venue: 'V', city: 'C', status: 'final', score: [1, 1], penScore: [4, 3], winnerCode: 'py', minute: 120, prob: null, stage: 'knockout' },
    ],
    standings: {}, photos: [],
  })
  // regulation group win + penalty-shootout knockout win; the shootout win was previously dropped
  expect(S.money.find((x) => x.person.id === 'p1').wins).toBe(2)
})

test('money does not count a draw, even when the worker stamps winnerCode="DRAW"', () => {
  const S = assembleSweep({
    bootstrap: {
      teams: [
        { code: 'nl', name: 'Netherlands', group: 'F', pool: 'A', color: '#f60', strength: 84 },
        { code: 'jp', name: 'Japan', group: 'F', pool: 'A', color: '#fff', strength: 75 },
      ],
      people: [{ id: 'p1', name: 'Havill', short: 'Havill', initials: 'H', av: '#0a0', avatarPath: null }],
      ownership: { p1: ['nl'] }, scoring: null,
    },
    fixtures: [
      { id: 'g1', group: 'F', matchday: 1, t1: 'nl', t2: 'jp', ko: '2026-06-15T12:00:00Z', venue: 'V', city: 'C', status: 'final', score: [2, 2], winnerCode: 'DRAW', minute: 90, prob: null, stage: 'group' },
    ],
    standings: {}, photos: [],
  })
  expect(S.money.find((x) => x.person.id === 'p1').wins).toBe(0)
})

test('money counts a co-owned derby win exactly once', () => {
  const S = assembleSweep({
    bootstrap: {
      teams: [
        { code: 'a', name: 'A', group: 'X', pool: 'P', color: '#000', strength: 70 },
        { code: 'b', name: 'B', group: 'X', pool: 'P', color: '#000', strength: 60 },
      ],
      people: [{ id: 'p1', name: 'Both', short: 'Both', initials: 'B', av: '#000', avatarPath: null }],
      ownership: { p1: ['a', 'b'] }, scoring: null,
    },
    fixtures: [
      { id: 'd1', group: 'X', matchday: 1, t1: 'a', t2: 'b', ko: '2026-06-10T12:00:00Z', venue: 'V', city: 'C', status: 'final', score: [1, 0], minute: 90, prob: null, stage: 'group' },
    ],
    standings: {}, photos: [],
  })
  expect(S.money.find((x) => x.person.id === 'p1').wins).toBe(1)
})

test('winnerCodeOf honors winnerCode (shootout) and the DRAW sentinel, falling back to score', () => {
  expect(winnerCodeOf({ status: 'final', t1: 'py', t2: 'de', score: [1, 1], winnerCode: 'py' })).toBe('py')
  expect(winnerCodeOf({ status: 'final', t1: 'nl', t2: 'jp', score: [2, 2], winnerCode: 'DRAW' })).toBe(null)
  expect(winnerCodeOf({ status: 'final', t1: 'a', t2: 'b', score: [2, 0] })).toBe('a')
  expect(winnerCodeOf({ status: 'final', t1: 'a', t2: 'b', score: [0, 1] })).toBe('b')
  expect(winnerCodeOf({ status: 'final', t1: 'a', t2: 'b', score: [0, 0] })).toBe(null)
  expect(winnerCodeOf({ status: 'live', t1: 'a', t2: 'b', score: [1, 0] })).toBe(null)
})

test('derby true when both sides owned by different people', () => {
  const api2 = JSON.parse(JSON.stringify(api))
  api2.bootstrap.ownership = { p1: ['hr'], p2: ['gh'] } // hr vs gh both owned
  const S = assembleSweep(api2)
  expect(S.fixtures[0].derby).toBe(true)
  expect(S.fixtures[0].doubleOwners).toEqual([]) // nobody owns both
})

test('groups/teamList/photos/helpers exposed; liveMatch null when none live', () => {
  const S = assembleSweep(api)
  expect(S.groups).toContain('L')
  expect(S.teamList.length).toBe(3)
  expect(S.photos[0].src).toBe('/photos/seed/ph1.jpg')
  expect(S.photos[0].fixtureId).toBe('m1')
  expect(S.fixture('m1').t1).toBe('hr')
  expect(S.flag('hr')).toContain('flagcdn')
  expect(S.liveMatch).toBeNull()
  expect(S.nextMatch).toBeTruthy()
})

test('each fixture gets a one-line dateTimeLabel', () => {
  const s = assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#c00', strength: 82 },
        { code: 'en', name: 'England', group: 'L', pool: 'A', color: '#fff', strength: 90 },
      ],
      people: [], ownership: {}, scoring: null,
    },
    fixtures: [{
      id: 'm1', group: 'L', matchday: 1, t1: 'hr', t2: 'en', ko: '2026-06-13T22:00:00Z',
      venue: 'V', city: 'C', status: 'upcoming', score: null, minute: null,
      prob: null, stage: 'group',
    }],
    standings: {}, photos: [], syncStatus: { stale: false },
  })
  // 2026-06-13T22:00Z = 2026-06-14 08:00 Sydney (TZ pinned in setup)
  expect(s.fixture('m1').dateTimeLabel).toBe('Sun, 14 June · 8:00 AM')
})

test('assembleSweep carries fixture events through (defaulting to [])', () => {
  const s = assembleSweep({
    bootstrap: { teams: [
      { code: 'ar', name: 'Argentina', group: 'A', pool: 'P', color: '#6cf', strength: 90 },
      { code: 'mx', name: 'Mexico', group: 'A', pool: 'P', color: '#0a7', strength: 76 },
    ], people: [], ownership: {}, scoring: null },
    fixtures: [
      { id: 'm1', group: 'A', matchday: 1, t1: 'ar', t2: 'mx', ko: '2026-06-13T06:30:00Z', venue: 'V', city: 'C', status: 'live', score: [1, 0], minute: 63, prob: { a: 50, d: 25, b: 25 }, stage: 'group', events: [{ id: 'g1', type: 'goal', teamCode: 'ar', player: 'Messi', minute: 23, detail: 'Normal Goal', assist: null }] },
      { id: 'm2', group: 'A', matchday: 1, t1: 'ar', t2: 'mx', ko: '2026-06-14T06:30:00Z', venue: 'V', city: 'C', status: 'upcoming', score: null, minute: null, prob: { a: 50, d: 25, b: 25 }, stage: 'group' },
    ],
    standings: {}, photos: [],
  })
  expect(s.fixture('m1').events).toHaveLength(1)
  expect(s.fixture('m1').events[0].player).toBe('Messi')
  expect(s.fixture('m2').events).toEqual([]) // missing → []
})

test('assembleSweep calculates team and person knockout elimination', () => {
  const s = assembleSweep({
    bootstrap: {
      teams: [
        { code: 'ar', name: 'Argentina', group: '', pool: 'P', color: '#6cf', strength: 90 },
        { code: 'mx', name: 'Mexico', group: '', pool: 'P', color: '#0a7', strength: 76 },
        { code: 'br', name: 'Brazil', group: '', pool: 'P', color: '#f3c318', strength: 88 },
      ],
      people: [
        { id: 'p1', name: 'Member 1', short: 'M1', initials: 'M1', av: '#111' },
        { id: 'p2', name: 'Member 2', short: 'M2', initials: 'M2', av: '#222' },
      ],
      ownership: { p1: ['mx'], p2: ['ar', 'mx'] },
      scoring: null,
    },
    fixtures: [
      { id: 'k1', group: '', matchday: 0, t1: 'ar', t2: 'mx', ko: '2026-06-28T18:00:00Z', venue: 'V', city: 'C', status: 'final', score: [2, 1], minute: 90, prob: null, stage: 'knockout' },
    ],
    standings: {}, photos: [],
  })
  // mx lost k1 (2-1) → eliminated. ar won → alive.
  expect(s.isTeamEliminated('mx')).toBe(true)
  expect(s.isTeamEliminated('ar')).toBe(false)
  // p1 only owns mx → eliminated. p2 owns ar & mx → still has ar → alive.
  expect(s.isPersonEliminated('p1')).toBe(true)
  expect(s.isPersonEliminated('p2')).toBe(false)
})

test('assembleSweep calculates knockout elimination from winnerCode on draw scores (penalties)', () => {
  const s = assembleSweep({
    bootstrap: {
      teams: [
        { code: 'ar', name: 'Argentina', group: '', pool: 'P', color: '#6cf', strength: 90 },
        { code: 'mx', name: 'Mexico', group: '', pool: 'P', color: '#0a7', strength: 76 },
      ],
      people: [
        { id: 'p1', name: 'Member 1', short: 'M1', initials: 'M1', av: '#111' },
      ],
      ownership: { p1: ['mx'] },
      scoring: null,
    },
    fixtures: [
      { id: 'k1', group: '', matchday: 0, t1: 'ar', t2: 'mx', ko: '2026-06-28T18:00:00Z', venue: 'V', city: 'C', status: 'final', score: [1, 1], winnerCode: 'ar', minute: 120, prob: null, stage: 'knockout' },
    ],
    standings: {}, photos: [],
  })
  expect(s.isTeamEliminated('mx')).toBe(true)
  expect(s.isTeamEliminated('ar')).toBe(false)
  expect(s.isPersonEliminated('p1')).toBe(true)
})


