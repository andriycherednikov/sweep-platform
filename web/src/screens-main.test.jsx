import { expect, test, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { setSweepData } from './data.js'
import { assembleSweep } from './lib/assemble.js'
import { StandingsScreen } from './screens-main.jsx'
import { makeApi } from '../test/factories.js'

beforeEach(() => {
  localStorage.clear()
})

test('StandingsScreen renders basketball columns (W L PCT PF PA) and a conference heading', () => {
  setSweepData(assembleSweep(makeApi({ sport: 'basketball' })))
  render(<StandingsScreen go={() => {}} openTeam={() => {}} openKnockouts={() => {}} />)
  for (const label of ['W', 'L', 'PCT', 'PF', 'PA']) {
    expect(screen.getAllByText(label).length).toBeGreaterThan(0)
  }
  expect(screen.getByText('Eastern Conference')).toBeInTheDocument()
})

test('StandingsScreen renders football columns (GF GA PTS) and the raw group heading', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'Group A', pool: 'P', color: '#c00', strength: 80 },
        { code: 'br', name: 'Brazil', group: 'Group A', pool: 'P', color: '#0c0', strength: 90 },
      ],
      people: [], ownership: {}, scoring: null,
    },
    fixtures: [],
    standings: { 'Group A': [{ code: 'hr', name: 'Croatia', played: 1, win: 1, draw: 0, loss: 0, gf: 2, ga: 0, pts: 3 }] },
    photos: [], syncStatus: {},
  }))
  render(<StandingsScreen go={() => {}} openTeam={() => {}} openKnockouts={() => {}} />)
  for (const label of ['GF', 'GA', 'PTS']) {
    expect(screen.getByText(label)).toBeInTheDocument()
  }
  expect(screen.getByText('Group A')).toBeInTheDocument()
})
