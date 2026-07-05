import { expect, test } from 'vitest'
import { serializeCompetitor, serializeEvent, serializeTeam, serializeFixture } from '../src/serialize.js'

const base = {
  id: 'm1', group: 'A', matchday: 1, t1Code: 'ar', t2Code: 'mx',
  kickoffUtc: new Date('2026-06-13T06:30:00Z'), venue: 'V', city: 'C', status: 'live',
  score1: 1, score2: 0, minute: 63, probA: 50, probD: 25, probB: 25,
  lineups: null, stage: 'group', derby: false, doubleOwner: false,
}

test('serializeFixture passes events through', () => {
  const events = [{ id: 'x', type: 'goal', teamCode: 'ar', player: 'Messi', minute: 23, detail: 'Normal Goal', assist: null }]
  expect(serializeFixture({ ...base, events }).events).toEqual(events)
})

test('serializeFixture coerces null events to an empty array', () => {
  expect(serializeFixture({ ...base, events: null }).events).toEqual([])
})

test('serializeFixture passes statistics through, null when absent', () => {
  const statistics = { ar: { shotsOnGoal: 5, totalShots: 12, corners: 7, possession: '58%', fouls: 9 } }
  expect(serializeFixture({ ...base, statistics }).statistics).toEqual(statistics)
  expect(serializeFixture({ ...base }).statistics).toBeNull()
})

test('serializeFixture exposes markets and half-time score', () => {
  const markets = { '1x2': { label: 'Match Winner', book: 'Pinnacle', selections: [{ key: 'HOME', label: 'Home', odds: 2 }] } }
  const out = serializeFixture({ id: '1', group: 'A', matchday: 1, t1Code: 'arg', t2Code: 'bra',
    kickoffUtc: new Date(), venue: '', city: '', status: 'final', score1: 2, score2: 1, minute: null,
    probA: 50, probD: 25, probB: 25, markets, htScore1: 1, htScore2: 0,
    stage: 'group', derby: false, doubleOwner: false })
  expect(out.markets).toEqual(markets)
  expect(out.htScore).toEqual([1, 0])
})

test('serializeFixture markets null + htScore null when absent', () => {
  const out = serializeFixture({ id: '1', group: 'A', matchday: 1, t1Code: 'arg', t2Code: 'bra',
    kickoffUtc: new Date(), venue: '', city: '', status: 'upcoming', score1: null, score2: null, minute: null,
    probA: null, probD: null, probB: null, markets: null, htScore1: null, htScore2: null,
    stage: 'group', derby: false, doubleOwner: false })
  expect(out.markets).toBeNull()
  expect(out.htScore).toBeNull()
})

test('serializeFixture exposes winnerCode, null when absent', () => {
  const out1 = serializeFixture({ ...base, winnerCode: 'ar' })
  expect(out1.winnerCode).toBe('ar')
  const out2 = serializeFixture({ ...base })
  expect(out2.winnerCode).toBeNull()
})

test('serializeCompetitor carries logo', () => {
  expect(serializeCompetitor({ code: 'lal', name: 'Lakers', color: '#552583', logo: 'https://x/l.png', meta: { conference: 'Western Conference' } }).logo)
    .toBe('https://x/l.png')
})

test('serializeCompetitor matches the serializeTeam wire shape', () => {
  const meta = { group: 'A', pool: '1', strength: 80, squad: [{ name: 'X' }] }
  const c = { id: 'cp_hr', code: 'hr', name: 'Croatia', color: '#f00', meta }
  expect(serializeCompetitor(c)).toEqual(serializeTeam({
    code: 'hr', name: 'Croatia', group: 'A', pool: '1', color: '#f00', strength: 80, squad: meta.squad,
  }))
})

test('serializeEvent matches the serializeFixture wire shape for the same data', () => {
  const ev = {
    id: 'm1', c1Code: 'hr', c2Code: 'br', startUtc: new Date('2026-06-11T18:00:00Z'),
    status: 'upcoming', score1: null, score2: null, winnerCode: null, stage: 'group', round: null,
    detail: { group: 'A', matchday: 1, venue: 'V', city: 'C', prob: { a: 1, d: 2, b: 3 } },
  }
  const legacy = {
    id: 'm1', group: 'A', matchday: 1, t1Code: 'hr', t2Code: 'br',
    kickoffUtc: ev.startUtc, venue: 'V', city: 'C', status: 'upcoming',
    score1: null, score2: null, minute: null, phase: null, probA: 1, probD: 2, probB: 3,
    markets: null, htScore1: null, htScore2: null, penScore1: null, penScore2: null,
    lineups: null, events: null, statistics: null, stage: 'group', derby: false, doubleOwner: false, winnerCode: null,
  }
  expect(serializeEvent(ev)).toEqual(serializeFixture(legacy))
})

