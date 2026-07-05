import { expect, test, it } from 'vitest'
import { SWEEP, setSweepData } from './data.js'
import { assembleSweep } from './lib/assemble.js'
import { makeApi, makeBootstrap } from '../test/factories.js'

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

test('setSweepData carries the bootstrap sweep descriptor onto SWEEP.sweep', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [{ code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#000', strength: 80 }],
      people: [], ownership: {}, scoring: null,
      sweep: { id: 'sw_abc', name: 'Office Sweep' },
    },
    fixtures: [], standings: { L: [] }, photos: [], syncStatus: { stale: false },
  }))
  expect(SWEEP.sweep).toEqual({ id: 'sw_abc', name: 'Office Sweep' })
})

test('SWEEP.sweep defaults to the default sweep when bootstrap omits it', () => {
  setSweepData(assembleSweep({
    bootstrap: { teams: [], people: [], ownership: {}, scoring: null },
    fixtures: [], standings: {}, photos: [], syncStatus: { stale: false },
  }))
  expect(SWEEP.sweep).toEqual({ id: 'default', name: 'The Sweep' })
})

it('setSweepData carries competition/readOnly/wageringEnabled onto SWEEP', () => {
  setSweepData(assembleSweep(makeApi({ sport: 'basketball', bootstrap: makeBootstrap({ sport: 'basketball', readOnly: true }) })))
  expect(SWEEP.competition.sport).toBe('basketball')
  expect(SWEEP.readOnly).toBe(true)
})
