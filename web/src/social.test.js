import { expect, test, beforeEach } from 'vitest'
import { SWEEP, setSweepData } from './data.js'
import { assembleSweep } from './lib/assemble.js'
import { getMe, setMe, watchersOf, toggleWatch, isWatching } from './social.js'

beforeEach(() => {
  localStorage.clear()
  setSweepData(assembleSweep({
    bootstrap: { teams: [], people: [{ id: 'p1', name: 'Andriy', short: 'Andriy', initials: 'A', av: '#000', avatarPath: null }], ownership: {}, scoring: null },
    fixtures: [], standings: {}, photos: [], syncStatus: { stale: false },
  }))
})

test('no identity by default until set; setMe/getMe round-trip', () => {
  setMe('p1')
  expect(getMe().id).toBe('p1')
})

test('watchers start empty and toggle for the current person', () => {
  setMe('p1')
  expect(watchersOf('m1')).toEqual([])
  toggleWatch('m1')
  expect(isWatching('m1')).toBe(true)
  expect(watchersOf('m1').map((p) => p.id)).toEqual(['p1'])
})
