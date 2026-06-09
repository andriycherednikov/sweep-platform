import { expect, test } from 'vitest'
import { SWEEP, setSweepData } from './data.js'
import { assembleSweep } from './lib/assemble.js'

test('SWEEP is safe before data loads (empty collections, working helpers)', () => {
  expect(Array.isArray(SWEEP.people)).toBe(true)
  expect(SWEEP.people).toHaveLength(0)
  expect(SWEEP.flag('hr')).toContain('flagcdn')
  expect(SWEEP.team('hr')).toBeUndefined()
  expect(SWEEP.nextMatch).toBeNull()
})

test('setSweepData fills the SAME SWEEP reference (identity preserved)', () => {
  const ref = SWEEP
  setSweepData(assembleSweep({
    bootstrap: { teams: [{ code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#000', strength: 80 }], people: [], ownership: {}, scoring: null },
    fixtures: [], standings: { L: [] }, photos: [], syncStatus: { stale: false },
  }))
  expect(SWEEP).toBe(ref)            // same object reference
  expect(SWEEP.team('hr').name).toBe('Croatia')
  expect(SWEEP.teamList).toHaveLength(1)
})
