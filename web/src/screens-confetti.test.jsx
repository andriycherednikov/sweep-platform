// Confetti fires when a winner is on show: the Placement tab (someone crowned
// 1st) and the Knockouts bracket (the Final decided). We mock celebrate() and
// assert the trigger wiring — not the canvas itself (covered in celebrate.test.js).
import { expect, test, beforeEach, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

vi.mock('./lib/celebrate.js', () => ({ celebrate: vi.fn() }))
vi.mock('./api/client.js', () => ({
  postSupport: vi.fn(async () => ({})),
  fetchWhoami: vi.fn(async () => ({ sweepId: 'default', role: 'member' })),
}))

import { celebrate } from './lib/celebrate.js'
import { PeopleScreen } from './screens-detail.jsx'
import { KnockoutsScreen } from './screens-bracket.jsx'
import { SWEEP as S, setSweepData } from './data.js'
import { assembleSweep } from './lib/assemble.js'
import { setMe, setSocialData } from './social.js'
import { setSpoiler } from './spoiler.js'

// alive owns the only never-eliminated team → lone survivor crowned 1st (champion).
// soon's team lost in the knockout → eliminated. Toggle `withChampion` off to
// leave everyone still in the running (no placement, no champion).
function loadStore(withChampion) {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: ['win', 'early'].map((c) => ({ code: c, name: c, group: 'A', pool: 'P', color: '#000', strength: 80 })),
      people: [
        { id: 'alive', name: 'Alive', short: 'A', initials: 'A', av: '#000' },
        { id: 'soon', name: 'Soon', short: 'S', initials: 'S', av: '#000' },
      ],
      ownership: { alive: ['win'], soon: ['early'] },
      scoring: null,
    },
    fixtures: withChampion ? [{
      id: 'e', group: '', matchday: 0, t1: 'win', t2: 'early', ko: '2026-07-04T18:00:00Z',
      venue: 'V', city: 'C', status: 'final', score: [1, 0], minute: 90, prob: null,
      stage: 'knockout', winnerCode: 'win',
    }] : [],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ support: {} })
}

const noop = () => {}
beforeEach(() => { localStorage.clear(); setMe(null); setSpoiler(false); vi.clearAllMocks() })

test('Placement view fires confetti once when a winner is crowned', () => {
  loadStore(true)
  render(<PeopleScreen go={noop} openPerson={noop} initialView="placement" />)
  expect(celebrate).toHaveBeenCalledTimes(1)
})

test('Placement view stays quiet when nobody has clinched 1st', () => {
  loadStore(false)
  expect(S.people.some((p) => S.placementOf(p.id)?.champion)).toBe(false)
  render(<PeopleScreen go={noop} openPerson={noop} initialView="placement" />)
  expect(celebrate).not.toHaveBeenCalled()
})

test('Wins view does not fire; switching to Placement re-arms and fires once', () => {
  loadStore(true)
  const { getByText } = render(<PeopleScreen go={noop} openPerson={noop} initialView="wins" />)
  expect(celebrate).not.toHaveBeenCalled()
  fireEvent.click(getByText('Placement'))
  expect(celebrate).toHaveBeenCalledTimes(1)
  // a re-render on the same tab must not re-fire
  fireEvent.click(getByText('Placement'))
  expect(celebrate).toHaveBeenCalledTimes(1)
})

test('Knockouts bracket stays quiet with no decided final', () => {
  loadStore(true) // knockout fixture exists but the bracket final is unresolved
  render(<KnockoutsScreen go={noop} onBack={noop} openMatch={noop} openTeam={noop} openPerson={noop} />)
  expect(celebrate).not.toHaveBeenCalled()
})
