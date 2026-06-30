import { useState, useEffect } from 'react'
import { flag, gd, fmtTime, fmtDate, fmtDayKey, fmtWeekday } from './lib/format.js'

// Safe empty shape so module-scope reads never crash before data loads.
function emptySweep() {
  return {
    teams: {}, teamList: [], groups: [], people: [], peopleById: {},
    fixtures: [], fixturesById: {}, standings: {}, photos: [], derbies: [], money: [],
    nextMatch: null, liveMatch: null, scoring: null, sweep: { id: 'default', name: 'The Sweep' },
    team: (code) => SWEEP.teams[code],
    fixture: (id) => SWEEP.fixturesById[id] || null,
    ownersOf: (code) => (SWEEP._ownersByTeam && SWEEP._ownersByTeam[code]) || [],
    ownersForFixture: (f) => ({ t1: SWEEP.ownersOf(f.t1), t2: SWEEP.ownersOf(f.t2) }),
    isTeamEliminated: (code) => false,
    isPersonEliminated: (id) => false,
    placementOf: (id) => null,
    flag, gd, fmtTime, fmtDate, fmtDayKey, fmtWeekday,
    todayKey: fmtDayKey(new Date()),
  }
}

export const SWEEP = emptySweep()

const DATA_KEYS = [
  'teams', 'teamList', 'groups', 'people', 'peopleById', 'fixtures', 'fixturesById', 'standings',
  'photos', 'derbies', 'money', 'nextMatch', 'liveMatch', 'scoring', 'sweep', 'todayKey',
]

const socialListeners = new Set()
export function onSweepData(fn) { socialListeners.add(fn); return () => socialListeners.delete(fn) }

/** Replace the live data on the SAME SWEEP object (identity preserved for existing imports). */
export function setSweepData(assembled) {
  for (const k of DATA_KEYS) SWEEP[k] = assembled[k]
  // keep helpers bound to the assembled closures where they need its private maps
  SWEEP.team = assembled.team
  SWEEP.fixture = assembled.fixture
  SWEEP.ownersOf = assembled.ownersOf
  SWEEP.ownersForFixture = assembled.ownersForFixture
  SWEEP.isTeamEliminated = assembled.isTeamEliminated
  SWEEP.isPersonEliminated = assembled.isPersonEliminated
  SWEEP.placementOf = assembled.placementOf
  socialListeners.forEach((fn) => fn())
}

/** Reactive current-sweep meta ({ id, name, role }) — re-renders on sweep load/switch. */
export function useSweep() {
  const [, force] = useState(0)
  useEffect(() => onSweepData(() => force((x) => x + 1)), [])
  return SWEEP.sweep
}

/** Whether the admin/moderation entry should be offered for a sweep: only to its
 *  admins — except the default sweep, whose admin unlocks in-app via a PIN. */
export function canModerate(sweep) {
  return sweep?.id === 'default' || sweep?.role === 'admin'
}

export default SWEEP
