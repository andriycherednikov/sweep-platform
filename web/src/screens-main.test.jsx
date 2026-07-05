import { expect, test, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { setSweepData } from './data.js'
import { assembleSweep } from './lib/assemble.js'
import { StandingsScreen, HomeScreen, PickSheet } from './screens-main.jsx'
import { makeApi, makeBootstrap } from '../test/factories.js'

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

// regression: group order used to be Object.keys(S.standings) verbatim, which mirrors the
// API route's key order — mirroring a stale/heap-order API response instead of sorting
// alphabetically as the web-side belt.
test('StandingsScreen sorts conference tables alphabetically (Eastern before Western) even if the data arrives in the opposite order', () => {
  const standings = {
    'Western Conference': [{ code: 'lal', name: 'Lakers', played: 2, win: 1, draw: 0, loss: 1, gf: 0, ga: 0, gd: 0, pts: 0, pct: 0.5, pf: 220, pa: 221 }],
    'Eastern Conference': [{ code: 'bos', name: 'Celtics', played: 2, win: 2, draw: 0, loss: 0, gf: 0, ga: 0, gd: 0, pts: 0, pct: 1, pf: 240, pa: 200 }],
  }
  setSweepData(assembleSweep(makeApi({ sport: 'basketball', standings })))
  const { container } = render(<StandingsScreen go={() => {}} openTeam={() => {}} openKnockouts={() => {}} />)
  const headings = [...container.querySelectorAll('.gh b')].map((el) => el.textContent)
  expect(headings).toEqual(['Eastern Conference', 'Western Conference'])
})

test('StandingsScreen (basketball, league format) shows no group-stage "advance" chip or legend', () => {
  setSweepData(assembleSweep(makeApi({ sport: 'basketball' })))
  render(<StandingsScreen go={() => {}} openTeam={() => {}} openKnockouts={() => {}} />)
  expect(screen.queryByText(/Top 2 advance/i)).toBeNull()
  expect(screen.queryByText('Advance')).toBeNull()
  expect(screen.queryByText(/Play-off \(3rd\)/i)).toBeNull()
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
    standings: { A: [
      { code: 'hr', name: 'Croatia', played: 1, win: 1, draw: 0, loss: 0, gf: 2, ga: 0, pts: 3 },
      { code: 'br', name: 'Brazil', played: 1, win: 0, draw: 0, loss: 1, gf: 0, ga: 2, pts: 0 },
    ] },
    photos: [], syncStatus: {},
  }))
  render(<StandingsScreen go={() => {}} openTeam={() => {}} openKnockouts={() => {}} />)
  for (const label of ['P', 'W', 'D', 'L', 'GD', 'PTS']) {
    expect(screen.getAllByText(label).length).toBeGreaterThan(0)
  }
  expect(screen.getByText('Group A')).toBeInTheDocument()
  expect(screen.getByText('+2')).toBeInTheDocument()
})

// regression: pre-fix wire (serializeCompetitor with no meta.group fallback) sent
// teams[].group: null for NBA, so S.groups (derived from teams[].group) and
// S.standings (mirrored from /api/standings, keyed by conference) were different key
// spaces — S.standings[null] was undefined and GroupTable's .map crashed the app.
// This must render safely (empty/keyed tables) no matter which key space is broken.
test('StandingsScreen does not crash when basketball teams[].group is null (key-space mismatch)', () => {
  const bootstrap = makeBootstrap({
    sport: 'basketball',
    teams: [
      { code: 'lal', name: 'Lakers', group: null, pool: null, color: '#552583', logo: null, strength: null, squad: null },
      { code: 'bos', name: 'Celtics', group: null, pool: null, color: '#007a33', logo: null, strength: null, squad: null },
    ],
  })
  setSweepData(assembleSweep(makeApi({ sport: 'basketball', bootstrap })))
  expect(() => render(<StandingsScreen go={() => {}} openTeam={() => {}} openKnockouts={() => {}} />)).not.toThrow()
})

// regression: a stale dataset (ko days in the past, worker never flipped the fixture to
// live/final) falls through HomeScreen's grace-window match to the S.nextMatch fallback.
// The hero countdown used to render a permanently-pinned "-00:20:00" (the KICKOFF_GRACE_SEC
// floor of the outer Math.max clamp) instead of stopping at zero once kickoff has passed.
test('HomeScreen hero countdown clamps at zero (not negative) for a fully stale next fixture', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'gh', name: 'Ghana', group: 'L', pool: 'P', color: '#0a7', strength: 70 },
        { code: 'mx', name: 'Mexico', group: 'L', pool: 'P', color: '#a30', strength: 60 },
      ],
      people: [{ id: 'p1', name: 'Jax', short: 'Jax', initials: 'J', av: '#000', avatarPath: null }],
      ownership: {}, scoring: null,
    },
    fixtures: [{
      id: 'm1', group: 'L', matchday: 1, t1: 'gh', t2: 'mx', ko: '2020-01-01T00:00:00Z',
      venue: 'V', city: 'C', status: 'upcoming', score: null, minute: null,
      prob: { a: 50, d: 25, b: 25 }, stage: 'group',
    }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  const noop = () => {}
  const { container } = render(
    <HomeScreen go={noop} openMatch={noop} openTeam={noop} openPerson={noop} onAdmin={noop} />
  )
  expect(container.querySelector('.hero .vs-cd .cd').textContent).toBe('00:00:00')
})

test('PickSheet team-filter group heading follows sport vocab: "Group A" for football, conference name verbatim for basketball', () => {
  const noop = () => {}
  setSweepData(assembleSweep(makeApi({ sport: 'football' })))
  const foot = render(<PickSheet kind="team" onClose={noop} onPerson={noop} onTeam={noop} />)
  expect(foot.getByText('Group A')).toBeTruthy()
  foot.unmount()

  setSweepData(assembleSweep(makeApi({ sport: 'basketball' })))
  const ball = render(<PickSheet kind="team" onClose={noop} onPerson={noop} onTeam={noop} />)
  expect(ball.getByText('Eastern Conference')).toBeTruthy() // verbatim, no "Group" prefix
  ball.unmount()
})
