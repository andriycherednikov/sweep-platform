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

test('StandingsScreen renders football columns (P W D L GD PTS) and a "Group X" heading built from the bare wire group', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'A', pool: 'P', color: '#c00', strength: 80 },
        { code: 'br', name: 'Brazil', group: 'A', pool: 'P', color: '#0c0', strength: 90 },
      ],
      people: [], ownership: {}, scoring: null,
    },
    fixtures: [],
    standings: { A: [{ code: 'hr', name: 'Croatia', played: 1, win: 1, draw: 0, loss: 0, gf: 2, ga: 0, pts: 3 }] },
    photos: [], syncStatus: {},
  }))
  render(<StandingsScreen go={() => {}} openTeam={() => {}} openKnockouts={() => {}} />)
  for (const label of ['P', 'W', 'D', 'L', 'GD', 'PTS']) {
    expect(screen.getAllByText(label).length).toBeGreaterThan(0)
  }
  expect(screen.getByText('Group A')).toBeInTheDocument()
  expect(screen.getByText('+2')).toBeInTheDocument()
})
