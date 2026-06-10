import { expect, test } from 'vitest'
import { assembleSweep } from './assemble.js'

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
  photos: [{ id: 'ph1', kind: 'fan', uploader: 'Priya', team: 'hr', caption: 'hi', src: '/photos/seed/ph1.jpg', status: 'approved' }],
  syncStatus: { stale: false, lastBaselineAt: null, lastLiveAt: null },
}

test('assembles teams keyed by code with owners and stats', () => {
  const S = assembleSweep(api)
  expect(S.team('hr').name).toBe('Croatia')
  expect(S.team('hr').owners.map((o) => o.id).sort()).toEqual(['p1', 'p2'])
  expect(typeof S.team('hr').titleOdds).toBe('number')
})

test('people carry their team codes', () => {
  const S = assembleSweep(api)
  expect(S.people.find((p) => p.id === 'p2').teams).toEqual(['hr', 'br'])
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

test('standings are grouped and money is ranked by best-team strength', () => {
  const S = assembleSweep(api)
  expect(Object.keys(S.standings)).toEqual(expect.arrayContaining(['L', 'C']))
  expect(S.money[0].strength).toBeGreaterThanOrEqual(S.money[1].strength)
  expect(S.money[0].person).toBeTruthy()
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
  expect(S.flag('hr')).toContain('flagcdn')
  expect(S.liveMatch).toBeNull()
  expect(S.nextMatch).toBeTruthy()
})
