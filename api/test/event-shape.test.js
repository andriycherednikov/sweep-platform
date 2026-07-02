import { test, expect } from 'vitest'
import { flattenEvent } from '../src/db/event-shape.js'

const row = {
  id: 'm1', competitionId: 'apifootball:1:2026', c1Code: 'hr', c2Code: 'br',
  startUtc: new Date('2026-06-11T18:00:00Z'), status: 'final', score1: 2, score2: 1,
  winnerCode: 'hr', round: null, stage: 'group', updatedAt: new Date(),
  detail: {
    group: 'A', matchday: 1, venue: 'Azteca', city: 'Mexico City', minute: 90, phase: null,
    ht: [1, 0], reg: [2, 1], pen: null, prob: { a: 40, d: 30, b: 30 },
    markets: { '1x2': {} }, lineups: null, events: [{ id: 'e1', type: 'goal' }],
    statistics: { hr: { corners: 5 } }, derby: true, doubleOwner: false,
  },
}

test('flattenEvent produces the legacy fixture shape', () => {
  const f = flattenEvent(row)
  expect(f.t1Code).toBe('hr'); expect(f.t2Code).toBe('br')
  expect(f.kickoffUtc).toEqual(row.startUtc)
  expect(f.group).toBe('A'); expect(f.matchday).toBe(1)
  expect(f.htScore1).toBe(1); expect(f.htScore2).toBe(0)
  expect(f.regScore1).toBe(2); expect(f.regScore2).toBe(1)
  expect(f.penScore1).toBeNull(); expect(f.penScore2).toBeNull()
  expect(f.probA).toBe(40); expect(f.probD).toBe(30); expect(f.probB).toBe(30)
  expect(f.events).toEqual([{ id: 'e1', type: 'goal' }])
  expect(f.derby).toBe(true); expect(f.doubleOwner).toBe(false)
  expect(f.winnerCode).toBe('hr'); expect(f.status).toBe('final')
})

test('flattenEvent handles an empty detail', () => {
  const f = flattenEvent({ ...row, detail: {} })
  expect(f.htScore1).toBeNull(); expect(f.minute).toBeNull()
  expect(f.probA).toBeNull(); expect(f.events).toBeNull()
  expect(f.derby).toBe(false); expect(f.doubleOwner).toBe(false)
  expect(f.venue).toBeNull()
})
