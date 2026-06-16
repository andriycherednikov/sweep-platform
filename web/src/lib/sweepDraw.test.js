import { expect, test } from 'vitest'
import { planSweep } from './sweepDraw.js'

const teams = (n) => Array.from({ length: n }, (_, i) => ({ code: 't' + i }))

test('tops each person up to N (and adds nothing to those already at/above N)', () => {
  const people = [
    { id: 'a', teams: [] },          // 0 → needs 2
    { id: 'b', teams: ['t0'] },      // 1 → needs 1
    { id: 'c', teams: ['t1', 't2'] }, // 2 → needs 0
    { id: 'd', teams: ['t3', 't4', 't5'] }, // 3 (> N) → needs 0
  ]
  const { byPerson } = planSweep(people, teams(8), { teamsPerPerson: 2, seed: 1 })
  expect(byPerson.a).toHaveLength(2)
  expect(byPerson.b).toHaveLength(1)
  expect(byPerson.c).toHaveLength(0)
  expect(byPerson.d).toHaveLength(0)
})

test('never adds a team a person already owns, and adds no duplicates', () => {
  const people = [{ id: 'a', teams: ['t0', 't1'] }]
  const { byPerson, added } = planSweep(people, teams(8), { teamsPerPerson: 6, seed: 2 })
  expect(byPerson.a).not.toContain('t0')
  expect(byPerson.a).not.toContain('t1')
  expect(new Set(byPerson.a).size).toBe(byPerson.a.length)
  // every added row matches byPerson
  expect(added.every((r) => byPerson[r.personId].includes(r.teamCode))).toBe(true)
})

test('spreads evenly on an empty start (max team owner-count − min ≤ 1)', () => {
  const people = Array.from({ length: 45 }, (_, i) => ({ id: 'p' + i, teams: [] }))
  const tl = teams(48)
  const { added } = planSweep(people, tl, { teamsPerPerson: 2, seed: 7 })
  expect(added).toHaveLength(90) // 45 × 2
  const counts = {}
  for (const t of tl) counts[t.code] = 0
  for (const r of added) counts[r.teamCode]++
  const vals = Object.values(counts)
  expect(Math.max(...vals) - Math.min(...vals)).toBeLessThanOrEqual(1)
})

test('is deterministic for a given seed', () => {
  const people = Array.from({ length: 10 }, (_, i) => ({ id: 'p' + i, teams: [] }))
  const a = planSweep(people, teams(12), { teamsPerPerson: 3, seed: 99 })
  const b = planSweep(people, teams(12), { teamsPerPerson: 3, seed: 99 })
  expect(a.added).toEqual(b.added)
})

test('reveal lists only people who receive teams, in draw order, matching byPerson', () => {
  const people = [
    { id: 'a', teams: [] },
    { id: 'b', teams: ['t0', 't1'] }, // already at N → excluded from reveal
    { id: 'c', teams: [] },
  ]
  const { reveal, byPerson } = planSweep(people, teams(8), { teamsPerPerson: 2, seed: 3 })
  expect(reveal.map((r) => r.personId).sort()).toEqual(['a', 'c'])
  for (const r of reveal) expect(r.codes).toEqual(byPerson[r.personId])
  // reveal order is exactly the order `added` rows appear
  const { added } = planSweep(people, teams(8), { teamsPerPerson: 2, seed: 3 })
  const firstSeen = []
  for (const row of added) if (!firstSeen.includes(row.personId)) firstSeen.push(row.personId)
  expect(reveal.map((r) => r.personId)).toEqual(firstSeen)
})

test('handles empty / missing inputs without throwing', () => {
  expect(planSweep([], teams(4), { teamsPerPerson: 2, seed: 1 }).added).toEqual([])
  expect(planSweep([{ id: 'a', teams: [] }], [], { teamsPerPerson: 2, seed: 1 }).byPerson.a).toEqual([])
})
