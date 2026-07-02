// web/src/screens-detail.test.jsx — MatchSheet lineup block + two-way probability
import { expect, test, beforeEach, vi } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'

vi.mock('./api/client.js', () => ({
  postSupport: vi.fn(async () => ({})),
  uploadPhoto: vi.fn(async () => ({})),
  adminLogin: vi.fn(async () => ({ admin: true })),
  fetchAdminPhotos: vi.fn(async () => ({ pending: [], approved: [] })),
  settleStaleBets: vi.fn(async () => ({ swept: 0 })),
  fetchOpenBets: vi.fn(async () => ({ people: [], totalOpen: 0, totalStale: 0 })),
  moderatePhoto: vi.fn(async () => ({})),
  fetchWhoami: vi.fn(async () => ({ sweepId: 'default', role: 'member' })),
  createPerson: vi.fn(async () => ({})),
  deletePerson: vi.fn(async () => ({})),
  patchPerson: vi.fn(async () => ({})),
  bulkPostOwnership: vi.fn(async () => ({})),
  bulkDeleteOwnership: vi.fn(async () => ({})),
}))
import { MatchSheet, TeamDetail, PersonDetail } from './screens-detail.jsx'
import { SWEEP as S, setSweepData } from './data.js'
import { assembleSweep } from './lib/assemble.js'
import { setMe, setSocialData } from './social.js'
import { setSpoiler } from './spoiler.js'

const LINEUPS = [
  { teamCode: 'hr', formation: '4-3-3', startXI: [
    { name: 'L. Modric', number: 10, pos: 'M' },
    { name: 'I. Perisic', number: 4, pos: 'F' },
  ] },
  { teamCode: 'be', formation: '3-4-2-1', startXI: [
    { name: 'K. De Bruyne', number: 7, pos: 'M' },
    { name: 'Y. Carrasco', number: null, pos: 'M' }, // missing number tolerated
  ] },
]

const SQUAD = [
  { name: 'D. Livakovic', number: 1, pos: 'Goalkeeper', photo: 'https://x/1.png' },
  { name: 'J. Gvardiol', number: 20, pos: 'Defender', photo: 'https://x/20.png' },
  { name: 'M. Pjaca', number: 14, pos: 'Attacker', photo: null }, // no photo → number badge
]

function sheetFixture(lineups, squads = {}, events = [], opts = {}) {
  const { status = 'upcoming', score = null, statistics = null, penScore = null, stage = 'group' } = opts
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'L', pool: 'P', color: '#d8334a', strength: 80, squad: squads.hr ?? null },
        { code: 'be', name: 'Belgium', group: 'L', pool: 'P', color: '#1f8a4c', strength: 82, squad: squads.be ?? null },
      ],
      people: [], ownership: {}, scoring: null,
    },
    fixtures: [{
      id: 'm1', group: 'L', matchday: 1, t1: 'hr', t2: 'be', ko: '2026-06-13T09:00:00Z',
      venue: 'V', city: 'C', status, score, minute: null,
      prob: { a: 53, d: 26, b: 21 }, stage, penScore, lineups, events, statistics,
    }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ support: {} })
  return S.fixture('m1')
}

const noop = () => {}
const renderSheet = (f) => render(
  <MatchSheet f={f} onClose={noop} onToast={noop} openTeam={noop} openPerson={noop} openPhoto={noop} />,
)

beforeEach(() => { localStorage.clear(); setMe(null); vi.clearAllMocks(); setSpoiler(false) })

test('MatchSheet hides the match-events timeline under privacy mode, shows it on reveal', () => {
  const events = [{ id: 'g1', type: 'goal', teamCode: 'hr', player: 'L. Modric', minute: 41, detail: 'Normal Goal' }]
  const f = sheetFixture(null, {}, events, { status: 'final', score: [1, 0] })
  setSpoiler(true)
  const { queryByText, getByLabelText } = renderSheet(f)
  expect(queryByText(/Match events/i)).toBeNull()   // timeline header hidden
  expect(queryByText('L. Modric')).toBeNull()        // scorer hidden
  act(() => { fireEvent.click(getByLabelText(/reveal score/i)) })
  expect(queryByText(/Match events/i)).toBeTruthy()  // revealed with the score
  expect(queryByText('L. Modric')).toBeTruthy()
  setSpoiler(false)
})

test('MatchSheet shows the Official prediction through live and final, not just pre-match', () => {
  // queries scoped to each render's own container (testing-library renders share document.body)
  const hasPred = (f) => renderSheet(f).container.textContent.includes('Official prediction')
  expect(hasPred(sheetFixture(null, {}, [], { status: 'upcoming' }))).toBe(true)            // baseline
  expect(hasPred(sheetFixture(null, {}, [], { status: 'live', score: [1, 0] }))).toBe(true) // was hidden by !showScore
  expect(hasPred(sheetFixture(null, {}, [], { status: 'final', score: [2, 1] }))).toBe(true)
})

test('MatchSheet shows a Starting XI block with formations and players', () => {
  const { getByText } = renderSheet(sheetFixture(LINEUPS))
  expect(getByText('Starting XI')).toBeTruthy()
  expect(getByText('4-3-3')).toBeTruthy()
  expect(getByText('3-4-2-1')).toBeTruthy()
  expect(getByText('L. Modric')).toBeTruthy()
  expect(getByText('Y. Carrasco')).toBeTruthy() // a missing number does not drop the player
})

test('Starting XI players borrow squad headshots matched by shirt number', () => {
  const squadHr = [
    { name: 'GK', number: 1, pos: 'Goalkeeper', photo: 'https://x/1.png' },
    { name: 'Modric (squad)', number: 10, pos: 'Midfielder', photo: 'https://x/10.png' },
    { name: 'Perisic (squad)', number: 4, pos: 'Forward', photo: 'https://x/4.png' },
  ]
  const { container } = renderSheet(sheetFixture(LINEUPS, { hr: squadHr }))
  const srcs = [...container.querySelectorAll('img.squad-ph')].map((i) => i.getAttribute('src'))
  expect(srcs).toContain('https://x/10.png') // Modric wears 10 → got the squad photo
  expect(srcs).toContain('https://x/4.png')  // Perisic wears 4
})

test('MatchSheet falls back to Squads (collapsed by default) and expands on click', () => {
  const { getByText, getAllByText, queryByText, container } = renderSheet(sheetFixture(null, { hr: SQUAD, be: SQUAD }))
  expect(queryByText('Starting XI')).toBeNull()
  expect(getByText('Squads')).toBeTruthy()                          // toggle present
  const collapse = container.querySelector('.squad-collapse')
  expect(collapse.classList.contains('open')).toBe(false)          // collapsed
  fireEvent.click(getByText('Squads'))                             // expand
  expect(collapse.classList.contains('open')).toBe(true)           // expanded
  expect(getAllByText('Goalkeepers')).toHaveLength(2)              // grouped by position, one per team
  expect(getAllByText('J. Gvardiol', { selector: '.squad-nm' })).toHaveLength(2)
})

test('MatchSheet renders a timeline of goals and cards with player and minute', () => {
  const events = [
    { id: 'a', type: 'goal', teamCode: 'hr', player: 'Modric', assist: 'Perisic', minute: 23, detail: 'Normal Goal' },
    { id: 'b', type: 'card', teamCode: 'be', player: 'Lukaku', minute: 41, card: 'yellow', detail: 'Yellow Card' },
  ]
  const { getByText } = renderSheet(sheetFixture(null, {}, events))
  expect(getByText('Match events')).toBeTruthy()
  expect(getByText('Modric')).toBeTruthy()
  expect(getByText("23'")).toBeTruthy()
  expect(getByText('Lukaku')).toBeTruthy()
  expect(getByText("41'")).toBeTruthy()
  expect(getByText('assist · Perisic')).toBeTruthy() // goal assist on its own line
})

test('Match events block is collapsible via its header toggle', () => {
  const events = [{ id: 'a', type: 'goal', teamCode: 'hr', player: 'Modric', minute: 23, detail: 'Normal Goal', assist: null }]
  const { getByRole } = renderSheet(sheetFixture(null, {}, events))
  const toggle = getByRole('button', { name: /match events/i })
  expect(toggle.getAttribute('aria-expanded')).toBe('true') // open by default
  fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-expanded')).toBe('false') // collapses like Starting XI
})

test('MatchSheet shows no timeline block when there are no events', () => {
  const { queryByText } = renderSheet(sheetFixture(null, {}, []))
  expect(queryByText('Match events')).toBeNull()
})

test('MatchSheet shows neither block when there are no lineups and no squads', () => {
  const { queryByText } = renderSheet(sheetFixture(null))
  expect(queryByText('Starting XI')).toBeNull()
  expect(queryByText('Squads')).toBeNull()
})

test('confirmed XI takes precedence over squads and is open by default', () => {
  const { getByText, queryByText, container } = renderSheet(sheetFixture(LINEUPS, { hr: SQUAD, be: SQUAD }))
  expect(getByText('Starting XI')).toBeTruthy()
  expect(queryByText('Squads')).toBeNull()
  expect(container.querySelector('.squad-collapse').classList.contains('open')).toBe(true)
})

test('TeamDetail renders a Squad section with players when the team has a squad', () => {
  sheetFixture(null, { hr: SQUAD })
  const { getByText, queryByText } = render(
    <TeamDetail code="hr" onBack={noop} openMatch={noop} openPerson={noop} openUpload={noop} />,
  )
  expect(getByText('Squad')).toBeTruthy()
  expect(getByText('3 players')).toBeTruthy()
  expect(getByText('D. Livakovic', { selector: '.squad-nm' })).toBeTruthy()
})

test('TeamDetail omits the Squad section when the team has no squad', () => {
  sheetFixture(null)
  const { queryByText } = render(
    <TeamDetail code="be" onBack={noop} openMatch={noop} openPerson={noop} openUpload={noop} />,
  )
  expect(queryByText('Squad')).toBeNull()
})

test('TeamDetail displays shootout score next to regulation score in fixtures list', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#c00', strength: 82 },
        { code: 'en', name: 'England', group: 'L', pool: 'A', color: '#fff', strength: 90 },
      ],
      people: [], ownership: {}, scoring: null,
    },
    fixtures: [{
      id: 'm1', group: 'L', matchday: 2, t1: 'hr', t2: 'en', ko: '2026-06-13T22:00:00Z',
      venue: 'V', city: 'C', status: 'final', score: [1, 1], penScore: [4, 3], winnerCode: 'hr', minute: null, prob: null, stage: 'knockout',
    }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  const { getByText } = render(
    <TeamDetail code="hr" onBack={noop} openMatch={noop} openPerson={noop} openUpload={noop} />
  )
  expect(getByText(/1–1/)).toBeTruthy()
  expect(getByText('4')).toBeTruthy()
  expect(getByText('3')).toBeTruthy()
})


test('MatchSheet official-prediction bar is three-way (home / draw / away)', () => {
  const { container } = renderSheet(sheetFixture(null))
  const segs = container.querySelectorAll('.prob-bar i')
  expect(segs).toHaveLength(3)
  // the middle segment is the draw odds
  expect(container.querySelector('.prob-bar .d')).not.toBeNull()
})

test('detail sheet shows a Draw backer button on a group-stage fixture', () => {
  const { container } = renderSheet(sheetFixture(null))
  // scope to the backer buttons (the official-prediction key also says "Draw")
  const backerButtons = container.querySelectorAll('button[type="button"]')
  const drawBtn = [...backerButtons].find(b => b.textContent.includes('Draw'))
  expect(drawBtn).toBeTruthy()
})

test('detail sheet omits the Draw backer button on a knockout fixture', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'L', pool: 'P', color: '#d8334a', strength: 80, squad: null },
        { code: 'be', name: 'Belgium', group: 'L', pool: 'P', color: '#1f8a4c', strength: 82, squad: null },
      ],
      people: [], ownership: {}, scoring: null,
    },
    fixtures: [{
      id: 'm2', group: null, matchday: null, t1: 'hr', t2: 'be', ko: '2026-07-01T15:00:00Z',
      venue: 'V', city: 'C', status: 'upcoming', score: null, minute: null,
      prob: { a: 53, d: 26, b: 21 }, stage: 'r16', lineups: null, events: [],
    }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ support: {} })
  const f = S.fixture('m2')
  const { container } = renderSheet(f)
  // On knockout fixtures the Draw backer button must NOT appear
  const backerButtons = container.querySelectorAll('button[type="button"]')
  const drawBtn = [...backerButtons].find(b => b.textContent.includes('Draw'))
  expect(drawBtn).toBeUndefined()
})

test('PersonDetail match rows show the one-line local date/time', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#c00', strength: 82 },
        { code: 'en', name: 'England', group: 'L', pool: 'A', color: '#fff', strength: 90 },
      ],
      people: [{ id: 'p1', name: 'Ann', short: 'Ann' }],
      ownership: { p1: ['hr'] }, scoring: null,
    },
    fixtures: [{
      id: 'm1', group: 'L', matchday: 1, t1: 'hr', t2: 'en', ko: '2026-06-13T22:00:00Z',
      venue: 'V', city: 'C', status: 'upcoming', score: null, minute: null, prob: null, stage: 'group',
    }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  const noop = () => {}
  const { container } = render(
    <PersonDetail person={S.people[0]} onBack={noop} openMatch={noop} openTeam={noop} openProfileUpload={noop} />
  )
  const fxWhen = container.querySelector('.mini-fx .fx-when')
  expect(fxWhen).toBeTruthy()
  expect(fxWhen.textContent).toBe('Sun, 14 June · 8:00 AM')
})

test('PersonDetail match rows show shootout score and track it as W/L instead of D', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#c00', strength: 82 },
        { code: 'en', name: 'England', group: 'L', pool: 'A', color: '#fff', strength: 90 },
      ],
      people: [{ id: 'p1', name: 'Ann', short: 'Ann' }],
      ownership: { p1: ['hr'] }, scoring: null,
    },
    fixtures: [{
      id: 'm1', group: 'L', matchday: 2, t1: 'hr', t2: 'en', ko: '2026-06-13T22:00:00Z',
      venue: 'V', city: 'C', status: 'final', score: [1, 1], penScore: [4, 3], winnerCode: 'hr', minute: null, prob: null, stage: 'knockout',
    }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  const noop = () => {}
  const { getByText, getAllByText } = render(
    <PersonDetail person={S.people[0]} onBack={noop} openMatch={noop} openTeam={noop} openProfileUpload={noop} />
  )
  
  // Verify it displays the shootout score next to the main score
  expect(getByText(/1–1/)).toBeTruthy()
  expect(getByText('4')).toBeTruthy()
  expect(getByText('3')).toBeTruthy()
  
  // Verify it displays "W" pill instead of "D" pill
  expect(getByText('W')).toBeTruthy()
  
  // Verify the wins count in stats summary is 1 (multiple elements will render '1')
  expect(getAllByText('1').length).toBeGreaterThanOrEqual(3)
})


test('PersonDetail shows a Calls-right accuracy tile', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#c00', strength: 82 },
        { code: 'en', name: 'England', group: 'L', pool: 'A', color: '#fff', strength: 90 },
      ],
      people: [{ id: 'p1', name: 'Ann', short: 'Ann' }],
      ownership: { p1: ['hr'] }, scoring: null,
    },
    fixtures: [
      { id: 'm1', group: 'L', matchday: 1, t1: 'hr', t2: 'en', ko: '2026-06-13T22:00:00Z',
        venue: 'V', city: 'C', status: 'final', score: [2, 1], minute: null, prob: null, stage: 'group' },
    ],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ support: { m1: { p1: 'hr' } } })
  const noop = () => {}
  const { getByText } = render(
    <PersonDetail person={S.people[0]} onBack={noop} openMatch={noop} openTeam={noop} openProfileUpload={noop} />
  )
  expect(getByText('Calls right')).toBeTruthy()
  expect(getByText('1/1')).toBeTruthy()
})

test('PersonDetail prediction history shows the pick and a correct verdict', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#c00', strength: 82 },
        { code: 'en', name: 'England', group: 'L', pool: 'A', color: '#fff', strength: 90 },
      ],
      people: [{ id: 'p1', name: 'Ann', short: 'Ann' }],
      ownership: {}, scoring: null,
    },
    fixtures: [
      { id: 'm1', group: 'L', matchday: 1, t1: 'hr', t2: 'en', ko: '2026-06-13T22:00:00Z',
        venue: 'V', city: 'C', status: 'final', score: [2, 1], minute: null, prob: null, stage: 'group' },
    ],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ support: { m1: { p1: 'hr' } } })
  const noop = () => {}
  const { getByText, container } = render(
    <PersonDetail person={S.people[0]} onBack={noop} openMatch={noop} openTeam={noop} openProfileUpload={noop} />
  )
  expect(getByText('Prediction history')).toBeTruthy()
  // pick is shown as the picked team's flag (title "Picked Croatia"), not the score
  const pick = container.querySelector('.pick-flag')
  expect(pick).toBeTruthy()
  expect(pick.getAttribute('title')).toBe('Picked Croatia')
  expect(container.querySelector('.v-pill.ok')).toBeTruthy()
  // the score is no longer rendered in the prediction row
  expect(container.querySelector('.rr .sc')).toBeNull()
})

test('PersonDetail shows a handshake (not a flag) for a draw pick', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#c00', strength: 82 },
        { code: 'en', name: 'England', group: 'L', pool: 'A', color: '#fff', strength: 90 },
      ],
      people: [{ id: 'p1', name: 'Ann', short: 'Ann' }],
      ownership: {}, scoring: null,
    },
    fixtures: [
      { id: 'm1', group: 'L', matchday: 1, t1: 'hr', t2: 'en', ko: '2026-06-13T22:00:00Z',
        venue: 'V', city: 'C', status: 'final', score: [1, 1], minute: null, prob: null, stage: 'group' },
    ],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ support: { m1: { p1: 'DRAW' } } })
  const noop = () => {}
  const { container, getByText } = render(
    <PersonDetail person={S.people[0]} onBack={noop} openMatch={noop} openTeam={noop} openProfileUpload={noop} />
  )
  expect(container.querySelector('.pick-draw')).toBeTruthy()
  expect(container.querySelector('.pick-flag')).toBeNull()
  expect(getByText('🤝')).toBeTruthy()
  expect(container.querySelector('.v-pill.ok')).toBeTruthy() // DRAW correct on a level final
})

test('PersonDetail shows a loading spinner (not text) for an unresolved prediction', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#c00', strength: 82 },
        { code: 'en', name: 'England', group: 'L', pool: 'A', color: '#fff', strength: 90 },
      ],
      people: [{ id: 'p1', name: 'Ann', short: 'Ann' }],
      ownership: {}, scoring: null,
    },
    fixtures: [
      { id: 'm1', group: 'L', matchday: 1, t1: 'hr', t2: 'en', ko: '2026-06-13T22:00:00Z',
        venue: 'V', city: 'C', status: 'upcoming', score: null, minute: null, prob: null, stage: 'group' },
    ],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ support: { m1: { p1: 'hr' } } })
  const noop = () => {}
  const { container, queryByText } = render(
    <PersonDetail person={S.people[0]} onBack={noop} openMatch={noop} openTeam={noop} openProfileUpload={noop} />
  )
  expect(container.querySelector('.pick-pending svg')).toBeTruthy()
  expect(queryByText('pending')).toBeNull()
})

test('PersonDetail hides the Prediction history section when the person made no predictions', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [{ code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#c00', strength: 82 }],
      people: [{ id: 'p1', name: 'Ann', short: 'Ann' }],
      ownership: {}, scoring: null,
    },
    fixtures: [], standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ support: {} })
  const noop = () => {}
  const { queryByText } = render(
    <PersonDetail person={S.people[0]} onBack={noop} openMatch={noop} openTeam={noop} openProfileUpload={noop} />
  )
  expect(queryByText('Prediction history')).toBeNull()
})

import { adminGateState, AdminScreen } from './screens-detail.jsx'
import { waitFor } from '@testing-library/react'
import { fetchWhoami } from './api/client.js'

test('adminGateState forks on whoami role / default sweep', () => {
  expect(adminGateState({ sweepId: 'sw_abc', role: 'admin' })).toBe('unlocked')
  expect(adminGateState({ sweepId: 'default', role: 'admin' })).toBe('unlocked')
  expect(adminGateState({ sweepId: 'default', role: 'member' })).toBe('pin')
  expect(adminGateState({ sweepId: 'default', role: null })).toBe('pin')
  expect(adminGateState({ sweepId: 'sw_abc', role: 'member' })).toBe('need-link')
  expect(adminGateState({ sweepId: null, role: null })).toBe('need-link')
})

test('AdminScreen on the platform host with an admin cookie unlocks without a PIN', async () => {
  fetchWhoami.mockResolvedValueOnce({ sweepId: 'sw_abc', role: 'admin' })
  setSweepData(assembleSweep({
    bootstrap: { teams: [], people: [], ownership: {}, scoring: null },
    fixtures: [], standings: {}, photos: [], syncStatus: { stale: false },
  }))
  const { findByText, queryByText } = render(<AdminScreen onBack={noop} onToast={noop} />)
  expect(await findByText('People', { selector: '.admintab' })).toBeTruthy() // landed on the People tab, no keypad
  expect(queryByText('Enter passcode')).toBeNull()
})

test('AdminScreen on a platform member (no admin link) prompts to open the admin link', async () => {
  fetchWhoami.mockResolvedValueOnce({ sweepId: 'sw_abc', role: 'member' })
  const { findByText, queryByText } = render(<AdminScreen onBack={noop} onToast={noop} />)
  expect(await findByText(/open your admin link/i)).toBeTruthy()
  expect(queryByText('Enter passcode')).toBeNull()
})

test('AdminScreen on the default host with no admin cookie still shows the PIN keypad', async () => {
  fetchWhoami.mockResolvedValueOnce({ sweepId: 'default', role: 'member' })
  const { findByText } = render(<AdminScreen onBack={noop} onToast={noop} />)
  expect(await findByText('Enter passcode')).toBeTruthy()
})

import { PeopleAdmin } from './screens-detail.jsx'
import { createPerson, patchPerson, deletePerson, bulkPostOwnership, bulkDeleteOwnership } from './api/client.js'

function seedPeople() {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#c00', strength: 80 },
        { code: 'en', name: 'England', group: 'L', pool: 'A', color: '#fff', strength: 90 },
        { code: 'br', name: 'Brazil', group: 'A', pool: 'B', color: '#ff0', strength: 95 },
      ],
      people: [
        { id: 'p1', name: 'Ann', short: 'Ann', initials: 'AN', createdAt: '2026-06-01T00:00:00Z' },
        { id: 'p2', name: 'Cara', short: 'Cara', initials: 'CA', createdAt: '2026-06-03T00:00:00Z' },
      ],
      ownership: { p1: ['hr'] }, scoring: null,
    },
    fixtures: [], standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ support: {} })
}

test('PeopleAdmin lists existing sweep people with a team count', () => {
  seedPeople()
  const { getByText, getAllByText } = render(<PeopleAdmin onToast={noop} />)
  expect(getByText('Ann')).toBeTruthy()
  expect(getByText('Cara')).toBeTruthy()
  // Ann owns 1 team — a count badge shows it
  expect(getAllByText('teams').length).toBeGreaterThan(0)
})

test('PeopleAdmin flags a self-excluded person with an "Excluded" badge', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [{ code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#c00', strength: 80 }],
      people: [
        { id: 'p1', name: 'Ann', short: 'Ann', initials: 'AN', excluded: true },
        { id: 'p2', name: 'Cara', short: 'Cara', initials: 'CA' },
      ],
      ownership: {}, scoring: null,
    },
    fixtures: [], standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ support: {} })
  const { container, getAllByText } = render(<PeopleAdmin onToast={noop} />)
  const badges = getAllByText('Excluded')
  expect(badges.length).toBe(1) // only the excluded person is flagged
  const annRow = [...container.querySelectorAll('.prow')].find((r) => r.querySelector('.pi b')?.textContent === 'Ann')
  expect(annRow.querySelector('.excl-badge')).toBeTruthy()
})

test('PeopleAdmin sorts newest-added first by default', () => {
  seedPeople()
  const { container } = render(<PeopleAdmin onToast={noop} />)
  const names = [...container.querySelectorAll('.prow .pi b')].map((b) => b.textContent)
  expect(names).toEqual(['Cara', 'Ann']) // Cara created later → first
})

test('PeopleAdmin add trigger is a compact icon button labelled "Add person"', () => {
  seedPeople()
  const { getByLabelText, queryByText } = render(<PeopleAdmin onToast={noop} />)
  expect(getByLabelText('Add person')).toBeInTheDocument()  // accessible name preserved
  expect(queryByText('Add person')).toBeNull()              // text label replaced by "+"
})

test('PeopleAdmin add-member sheet creates a person (+ optional teams) then invalidates once', async () => {
  seedPeople()
  const qc = { invalidateQueries: vi.fn() }
  createPerson.mockResolvedValueOnce({ id: 'p9', name: 'Bo' })
  const { getByText, getByLabelText, getByPlaceholderText } = render(<PeopleAdmin onToast={noop} queryClient={qc} />)
  fireEvent.click(getByLabelText('Add person'))                       // open the sheet
  fireEvent.change(getByPlaceholderText('e.g. Macca'), { target: { value: 'Bo' } })
  fireEvent.click(getByText('Add'))                              // submit (cta)
  await waitFor(() => expect(createPerson).toHaveBeenCalledTimes(1))
  const av = createPerson.mock.calls[0][0].av
  expect(av).toMatch(/^#[0-9a-fA-F]{3,8}$/)
  await waitFor(() => expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sweep'] }))
})

test('Add-person sheet shows the selected teams as chips after allocate random', async () => {
  seedPeople()
  const { getByText, getByLabelText, queryByText } = render(<PeopleAdmin onToast={noop} />)
  fireEvent.click(getByLabelText('Add person'))
  expect(queryByText(/Selected \(/)).toBeNull()   // nothing selected yet
  fireEvent.click(getByText('+2'))                 // allocate 2 random
  expect(getByText('Selected (2)')).toBeTruthy()   // selected summary appears
})

test('PeopleAdmin allocation sheet renames via patchPerson on apply (name always editable)', async () => {
  seedPeople()
  patchPerson.mockResolvedValueOnce({ id: 'p1', name: 'Annie' })
  const { getByText, getByLabelText } = render(<PeopleAdmin onToast={noop} />)
  fireEvent.click(getByText('Ann'))            // open allocation sheet
  fireEvent.change(getByLabelText('Name'), { target: { value: 'Annie' } })
  fireEvent.click(getByText('Apply changes'))  // single Apply commits the rename
  // a rename also refreshes the derived short-name + avatar initials so they never drift
  await waitFor(() => expect(patchPerson).toHaveBeenCalledWith('p1', { name: 'Annie', short: 'Annie', initials: 'AN' }))
})

test('PeopleAdmin allocation sheet applies a rename + team change together', async () => {
  seedPeople()
  patchPerson.mockResolvedValueOnce({ id: 'p1', name: 'Annie' })
  const { getByText, getByLabelText } = render(<PeopleAdmin onToast={noop} />)
  fireEvent.click(getByText('Ann'))
  fireEvent.change(getByLabelText('Name'), { target: { value: 'Annie' } })
  fireEvent.click(getByText('+1'))             // allocate a random team too
  fireEvent.click(getByText('Apply changes'))
  await waitFor(() => expect(patchPerson).toHaveBeenCalledWith('p1', { name: 'Annie', short: 'Annie', initials: 'AN' }))
  await waitFor(() => expect(bulkPostOwnership).toHaveBeenCalledTimes(1))
})

test('PeopleAdmin allocation sheet removes a person via deletePerson', async () => {
  seedPeople()
  deletePerson.mockResolvedValueOnce({ ok: true })
  const { getByText, getByLabelText } = render(<PeopleAdmin onToast={noop} />)
  fireEvent.click(getByText('Ann'))
  fireEvent.click(getByLabelText('Remove Ann'))
  await waitFor(() => expect(deletePerson).toHaveBeenCalledWith('p1'))
})

test('PeopleAdmin allocation sheet: allocate random + apply → bulk add + invalidate', async () => {
  seedPeople()
  const qc = { invalidateQueries: vi.fn() }
  const { getByText } = render(<PeopleAdmin onToast={noop} queryClient={qc} />)
  fireEvent.click(getByText('Cara'))           // Cara owns nothing
  fireEvent.click(getByText('+2'))             // allocate 2 random
  fireEvent.click(getByText('Apply changes'))
  await waitFor(() => expect(bulkPostOwnership).toHaveBeenCalledTimes(1))
  const items = bulkPostOwnership.mock.calls[0][0]
  expect(items).toHaveLength(2)
  expect(items.every((it) => it.personId === 'p2')).toBe(true)
  await waitFor(() => expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sweep'] }))
})

test('PeopleAdmin allocation sheet: unallocate an owned team → bulk delete', async () => {
  seedPeople()
  const qc = { invalidateQueries: vi.fn() }
  const { getByText, getByLabelText } = render(<PeopleAdmin onToast={noop} queryClient={qc} />)
  fireEvent.click(getByText('Ann'))                       // Ann owns Croatia
  fireEvent.click(getByLabelText('Unallocate Croatia'))  // stage removal
  fireEvent.click(getByText('Apply changes'))
  await waitFor(() => expect(bulkDeleteOwnership).toHaveBeenCalledTimes(1))
  expect(bulkDeleteOwnership.mock.calls[0][0]).toEqual([{ personId: 'p1', teamCode: 'hr' }])
})

import { AdminConsole, AdminQueue } from './screens-detail.jsx'
import { fetchOpenBets } from './api/client.js'

test('AdminConsole offers People + Moderation tabs but no Draw tab', () => {
  seedPeople()
  const { getByText, queryByText } = render(<AdminConsole onBack={noop} onToast={noop} />)
  expect(getByText('Moderation')).toBeInTheDocument()
  expect(queryByText('Draw')).toBeNull()
})

test('Moderation › Open bets lists a person\'s open bets and flags stale ones', async () => {
  // a finished match so a still-open bet on it reads as "stale / needs settling"
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'L', pool: 'P', color: '#d8334a', strength: 80 },
        { code: 'be', name: 'Belgium', group: 'L', pool: 'P', color: '#1f8a4c', strength: 82 },
      ],
      people: [{ id: 'p1', name: 'Ann', short: 'Ann', initials: 'AN', av: '#000', avatarPath: null }],
      ownership: {}, scoring: null,
    },
    fixtures: [{ id: 'm1', group: 'L', matchday: 1, t1: 'hr', t2: 'be', ko: '2026-06-13T09:00:00Z',
      venue: 'V', city: 'C', status: 'final', score: [2, 0], minute: null, prob: { a: 53, d: 26, b: 21 }, stage: 'group' }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  fetchOpenBets.mockResolvedValueOnce({
    totalOpen: 1, totalStale: 1,
    people: [{
      person: { id: 'p1', name: 'Ann', short: 'Ann', initials: 'AN', av: '#000' },
      openCount: 1, staleCount: 1,
      singles: [{ id: 'b1', fixtureId: 'm1', market: '1x2', selection: 'HOME', stake: 100, odds: 2, potentialPayout: 200, status: 'open', fixtureStatus: 'final', stale: true }],
      parlays: [],
    }],
  })

  const { getByText, findByText } = render(<AdminQueue embedded onToast={noop} />)
  // stale total surfaces on the tab, then drill into the list
  await findByText('Open bets')
  act(() => { fireEvent.click(getByText('Open bets')) })
  expect(await findByText('Ann')).toBeInTheDocument()
  expect(getByText('1 stale')).toBeInTheDocument()
  expect(getByText('Needs settling')).toBeInTheDocument()
  expect(getByText('Croatia')).toBeInTheDocument()   // HOME selection → home team name
  expect(getByText('Match Winner')).toBeInTheDocument()
})

test('Moderation › Open bets collapses non-stale people and the header toggles them', async () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'L', pool: 'P', color: '#d8334a', strength: 80 },
        { code: 'be', name: 'Belgium', group: 'L', pool: 'P', color: '#1f8a4c', strength: 82 },
      ],
      people: [{ id: 'p2', name: 'Bob', short: 'Bob', initials: 'BO', av: '#000', avatarPath: null }],
      ownership: {}, scoring: null,
    },
    fixtures: [{ id: 'm1', group: 'L', matchday: 1, t1: 'hr', t2: 'be', ko: '2026-07-01T09:00:00Z',
      venue: 'V', city: 'C', status: 'upcoming', score: null, minute: null, prob: { a: 53, d: 26, b: 21 }, stage: 'group' }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  fetchOpenBets.mockResolvedValueOnce({
    totalOpen: 1, totalStale: 0,
    people: [{
      person: { id: 'p2', name: 'Bob', short: 'Bob', initials: 'BO', av: '#000' },
      openCount: 1, staleCount: 0,
      singles: [{ id: 'b2', fixtureId: 'm1', market: '1x2', selection: 'AWAY', stake: 50, odds: 3, potentialPayout: 150, status: 'open', fixtureStatus: 'upcoming', stale: false }],
      parlays: [],
    }],
  })
  const { getByText, findByText, queryByText } = render(<AdminQueue embedded onToast={noop} />)
  await findByText('Open bets')
  act(() => { fireEvent.click(getByText('Open bets')) })
  expect(await findByText('Bob')).toBeInTheDocument()
  // no stale bets → collapsed by default, so the bet itself isn't rendered yet
  expect(queryByText('Belgium')).toBeNull()
  act(() => { fireEvent.click(getByText('Bob')) }) // expand
  expect(await findByText('Belgium')).toBeInTheDocument() // AWAY selection → away team name
})

test('Moderation › Open bets surfaces an error (not "all settled") when the audit fails to load', async () => {
  seedPeople()
  fetchOpenBets.mockRejectedValueOnce(new Error('HTTP 500'))
  const { getByText, findByText, queryByText } = render(<AdminQueue embedded onToast={noop} />)
  await findByText('Open bets')
  act(() => { fireEvent.click(getByText('Open bets')) })
  expect(await findByText(/Couldn’t load open bets/i)).toBeInTheDocument()
  // must NOT show the green success state that would falsely reassure the admin
  expect(queryByText(/Every wager has been settled/i)).toBeNull()
})

test('MatchSheet shows per-team match statistics side by side', () => {
  const statistics = {
    hr: { shotsOnGoal: 5, totalShots: 12, corners: 7, possession: '58%', fouls: 9 },
    be: { shotsOnGoal: 2, totalShots: 8, corners: 3, possession: '42%', fouls: 14 },
  };
  const f = sheetFixture(null, {}, [], { status: 'live', score: [1, 0], statistics });
  const { getByText } = renderSheet(f);
  expect(getByText('Match statistics')).toBeInTheDocument();
  expect(getByText('Shots on Goal')).toBeInTheDocument();
  expect(getByText('Possession')).toBeInTheDocument();
  expect(getByText('58%')).toBeInTheDocument();   // home possession
  expect(getByText('42%')).toBeInTheDocument();   // away possession
  expect(getByText('14')).toBeInTheDocument();    // away fouls
});

test('MatchSheet renders no statistics block when the cache has none', () => {
  const f = sheetFixture(null, {}, [], { status: 'live', score: [0, 0], statistics: null });
  const { queryByText } = renderSheet(f);
  expect(queryByText('Match statistics')).toBeNull();
});

test('MatchSheet hides match statistics under privacy mode', () => {
  const statistics = { hr: { possession: '58%' }, be: { possession: '42%' } };
  const f = sheetFixture(null, {}, [], { status: 'final', score: [1, 0], statistics });
  setSpoiler(true);
  const { queryByText } = renderSheet(f);
  expect(queryByText('Match statistics')).toBeNull();
  setSpoiler(false);
});

test('MatchSheet covers a final score under spoiler mode, reveals on tap', () => {
  const f = sheetFixture(null, {}, [], { status: 'final', score: [5, 1] })
  setSpoiler(true)
  const { queryByText, getByLabelText } = renderSheet(f)
  expect(queryByText('5–1')).toBeNull()
  act(() => { fireEvent.click(getByLabelText(/reveal score/i)) })
  expect(queryByText('5–1')).toBeTruthy()
  setSpoiler(false)
})

test('MatchSheet renders a Penalty Shootout section and filters it from normal timeline', () => {
  const events = [
    { id: 'g1', type: 'goal', teamCode: 'hr', player: 'Modric', assist: null, minute: 15, detail: 'Normal Goal' },
    // Shootout events (minute 120, detail contains penalty)
    { id: 'p1', type: 'goal', teamCode: 'hr', player: 'Modric', assist: null, minute: 120, detail: 'Penalty' }, // score
    { id: 'p2', type: 'goal', teamCode: 'be', player: 'Hazard', assist: null, minute: 120, detail: 'Missed Penalty' }, // miss
  ];
  // penScore present = the provider recorded a shootout (score.penalty). That, not the
  // bare minute-120 events, is what makes this a shootout.
  const f = sheetFixture(null, {}, events, { status: 'final', score: [1, 1], penScore: [1, 0], stage: 'knockout' });
  setSpoiler(false);
  const { getByText, queryByText, getAllByText, container } = renderSheet(f);

  // Normal goal is in the normal events timeline
  expect(getAllByText('Modric')).toHaveLength(2);
  expect(getByText("15'")).toBeTruthy();

  // Shootout section and header scores are rendered
  expect(getByText('Penalty shootout')).toBeTruthy();
  expect(queryByText(/Penalties:/)).toBeNull(); // pens now inline after each score, not a stacked label
  expect(container.querySelector('.cd').textContent.replace(/\s/g, '')).toBe('1(1)–1(0)'); // "1 (1) – 1 (0)"
  expect(getByText('FULL TIME')).toBeTruthy();
  
  // Scored penalty taker and missed penalty taker are rendered
  expect(getByText('Round 1')).toBeTruthy();
  expect(getByText('Hazard')).toBeTruthy();
  
  // Shootout minute 120' does not show up as a normal timeline row with a center time tag of 120'
  expect(queryByText("120'")).toBeNull();
})

test('MatchSheet shows an extra-time penalty (120, no shootout) as a normal goal, not a shootout', () => {
  // Belgium 3–2 Senegal: the winner is a penalty converted at 120' in extra time.
  // The fixture did NOT go to a shootout (no penScore) — so this is a real goal, not a kick.
  const events = [
    { id: 'g1', type: 'goal', teamCode: 'hr', player: 'Modric', assist: null, minute: 15, detail: 'Normal Goal' },
    { id: 'p1', type: 'goal', teamCode: 'hr', player: 'Modric', assist: null, minute: 120, detail: 'Penalty' },
  ];
  const f = sheetFixture(null, {}, events, { status: 'final', score: [2, 1], stage: 'knockout' });
  setSpoiler(false);
  const { queryByText, getByText, container } = renderSheet(f);
  // No shootout section for an in-play extra-time penalty
  expect(queryByText('Penalty shootout')).toBeNull();
  // The 120' penalty stays in the normal timeline
  expect(getByText("120'")).toBeTruthy();
  // Score is the plain 2–1 with no penalty parenthetical
  expect(container.querySelector('.cd').textContent.replace(/\s/g, '')).toBe('2–1');
})

test('MatchSheet hides penalty shootout info under privacy mode', () => {
  const events = [
    { id: 'p1', type: 'goal', teamCode: 'hr', player: 'Modric', assist: null, minute: 120, detail: 'Penalty' },
  ];
  const f = sheetFixture(null, {}, events, { status: 'final', score: [1, 1], penScore: [1, 0], stage: 'knockout' });
  setSpoiler(true);
  const { getByText, queryByText, container } = renderSheet(f);

  // Score is covered
  expect(queryByText('1–1')).toBeNull();
  // Inline penalty tally is hidden too (whole score cell is replaced by the cover)
  expect(container.querySelector('.cd')).toBeNull();
  // Shootout section is hidden
  expect(queryByText('Penalty shootout')).toBeNull();
  // Status pill shows FULL TIME instead of FT (PENALTY SHOOTOUT)
  expect(getByText('FULL TIME')).toBeTruthy();
  expect(queryByText('FT (PENALTY SHOOTOUT)')).toBeNull();
  setSpoiler(false);
})

// ---------------- PeopleScreen — Wins ⇄ Predictions stat toggle ----------------
import { PeopleScreen } from './screens-detail.jsx'

// Wins come from actual final-fixture results (winnerCode-aware); correct predictions from
// support picks on finals. Atlas (alice) wins m1+m4 → 2; Bravo (bob) wins m2 → 1.
// Designed so the two orderings differ: wins → Alice(2), Bob(1); predictions → Bob(3), Alice(1).
function peopleSweep() {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'a', name: 'Atlas', group: 'L', pool: 'P', color: '#111', strength: 90 },
        { code: 'b', name: 'Bravo', group: 'L', pool: 'P', color: '#222', strength: 80 },
        { code: 'c', name: 'Cobra', group: 'L', pool: 'P', color: '#333', strength: 70 },
        { code: 'd', name: 'Delta', group: 'L', pool: 'P', color: '#444', strength: 60 },
      ],
      people: [
        { id: 'alice', name: 'Alice Anders', short: 'Alice' },
        { id: 'bob', name: 'Bob Brown', short: 'Bob' },
        { id: 'carol', name: 'Carol Clark', short: 'Carol' },
      ],
      ownership: { alice: ['a'], bob: ['b'], carol: ['c'] },
      scoring: null,
    },
    fixtures: [
      { id: 'm1', group: 'L', matchday: 1, t1: 'a', t2: 'b', ko: '2026-06-13T09:00:00Z', venue: 'V', city: 'C', status: 'final', score: [2, 0], minute: null, prob: { a: 50, d: 25, b: 25 }, stage: 'group' },
      { id: 'm2', group: 'L', matchday: 1, t1: 'b', t2: 'c', ko: '2026-06-14T09:00:00Z', venue: 'V', city: 'C', status: 'final', score: [3, 0], minute: null, prob: { a: 50, d: 25, b: 25 }, stage: 'group' },
      { id: 'm4', group: 'L', matchday: 1, t1: 'a', t2: 'd', ko: '2026-06-16T09:00:00Z', venue: 'V', city: 'C', status: 'final', score: [1, 0], minute: null, prob: { a: 50, d: 25, b: 25 }, stage: 'group' },
    ],
    standings: { L: [
      { code: 'a', name: 'Atlas', played: 3, win: 3, draw: 0, loss: 0, gf: 6, ga: 1, pts: 9 },
      { code: 'b', name: 'Bravo', played: 3, win: 1, draw: 0, loss: 2, gf: 3, ga: 4, pts: 3 },
      { code: 'c', name: 'Cobra', played: 3, win: 0, draw: 0, loss: 3, gf: 0, ga: 6, pts: 0 },
      { code: 'd', name: 'Delta', played: 3, win: 0, draw: 0, loss: 3, gf: 1, ga: 5, pts: 0 },
    ] },
    photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ support: {
    m1: { alice: 'a', bob: 'a', carol: 'b' }, // winner a → alice ✓, bob ✓, carol ✗
    m2: { bob: 'b', alice: 'c' },             // winner b → bob ✓, alice ✗
    m4: { bob: 'a' },                          // winner a → bob ✓
  } })
}
// → correct calls: Bob 3, Alice 1, Carol 0

const rowNames = (c) => [...c.querySelectorAll('.prow .pi b')].map((n) => n.childNodes[0].textContent.trim())
const statFor = (c, name) => {
  const row = [...c.querySelectorAll('.prow')].find((r) => r.querySelector('.pi b')?.childNodes[0].textContent.trim() === name)
  return row?.querySelector('.pp')?.textContent ?? null
}

test('PeopleScreen defaults to the Wins view (team wins, sorted by wins)', () => {
  peopleSweep()
  const { container, getByText } = render(<PeopleScreen openPerson={noop} />)
  expect(rowNames(container)).toEqual(['Alice Anders', 'Bob Brown', 'Carol Clark'])
  expect(statFor(container, 'Alice Anders')).toBe('2') // Atlas won m1 + m4
  expect(statFor(container, 'Bob Brown')).toBe('1')    // Bravo won m2
  expect(statFor(container, 'Carol Clark')).toBeNull() // 0 wins → no pill
  expect(getByText(/sorted by team wins/i)).toBeInTheDocument()
})

test('PeopleScreen Predictions view shows correct-call counts and re-sorts by them', () => {
  peopleSweep()
  const { container, getByText, getAllByText } = render(<PeopleScreen openPerson={noop} />)
  act(() => { fireEvent.click(getByText('Predictions')) })
  expect(rowNames(container)).toEqual(['Bob Brown', 'Alice Anders', 'Carol Clark'])
  expect(statFor(container, 'Bob Brown')).toBe('3')
  expect(statFor(container, 'Alice Anders')).toBe('1')
  expect(statFor(container, 'Carol Clark')).toBeNull() // 0 correct → no pill
  expect(getAllByText('correct').length).toBeGreaterThan(0)
  expect(getByText(/sorted by correct predictions/i)).toBeInTheDocument()
})

test('PeopleScreen opens on Predictions when initialView=predictions', () => {
  peopleSweep()
  const { container, getByText } = render(<PeopleScreen openPerson={noop} initialView="predictions" />)
  expect(rowNames(container)).toEqual(['Bob Brown', 'Alice Anders', 'Carol Clark'])
  expect(statFor(container, 'Bob Brown')).toBe('3')
  expect(getByText(/sorted by correct predictions/i)).toBeInTheDocument()
})

test('PeopleScreen keeps the active view while searching', () => {
  peopleSweep()
  const { container, getByText, getByPlaceholderText } = render(<PeopleScreen openPerson={noop} />)
  act(() => { fireEvent.click(getByText('Predictions')) })
  act(() => { fireEvent.change(getByPlaceholderText(/search by name/i), { target: { value: 'bob' } }) })
  expect(rowNames(container)).toEqual(['Bob Brown'])
  expect(statFor(container, 'Bob Brown')).toBe('3') // still the predictions count
  expect(getByText(/sorted by correct predictions/i)).toBeInTheDocument()
})

// ---------------- PeopleScreen — Coins stat toggle ----------------
import { setWalletData } from './coins.js'

// Designed so wins order differs from coins order:
// wins → Alice(3), Bob(1), Carol(0); coins → Bob(1500), Alice(900), Carol(0)
test('PeopleScreen Coins toggle ranks people by coin balance descending', () => {
  peopleSweep()
  setMe('alice') // wagers/coins filter is 18+ and requires a signed-in adult
  setWalletData({
    balance: 0,
    weeklyGrant: 1000,
    bets: { open: [], settled: [] },
    leaderboard: [
      { personId: 'bob', balance: 1500 },
      { personId: 'alice', balance: 900 },
    ],
  })
  const { container, getByText } = render(<PeopleScreen openPerson={noop} />)
  act(() => { fireEvent.click(getByText('Yowie Dollars')) })
  // Bob has more coins → should appear first
  expect(rowNames(container)).toEqual(['Bob Brown', 'Alice Anders', 'Carol Clark'])
  // balances are shown as pills (adults always show, even at 0)
  expect(statFor(container, 'Bob Brown')).toBe('1,500')
  expect(statFor(container, 'Alice Anders')).toBe('900')
  expect(statFor(container, 'Carol Clark')).toBe('0') // adult with 0 still shows "0"
  expect(getByText(/sorted by Yowie Dollars balance/i)).toBeInTheDocument()
})

test('PeopleScreen Yowie Dollars view omits minors entirely (present in Wins)', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [{ code: 'a', name: 'Atlas', group: 'L', pool: 'P', color: '#111', strength: 90 }],
      people: [
        { id: 'alice', name: 'Alice Anders', short: 'Alice' },
        { id: 'kid', name: 'Kid Kelly', short: 'Kid', adult: false }, // minor — no wagers
      ],
      ownership: { alice: ['a'], kid: ['a'] }, scoring: null,
    },
    fixtures: [], standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ support: {} })
  setMe('alice')
  setWalletData({ balance: 0, weeklyGrant: 1000, bets: { open: [], settled: [] }, leaderboard: [{ personId: 'alice', balance: 900 }] })
  const { container, getByText, queryByText } = render(<PeopleScreen openPerson={noop} />)
  // Wins view shows everyone, including the minor
  expect(rowNames(container)).toContain('Kid Kelly')
  // Switch to Yowie Dollars → the minor is gone, and the count reads "adults"
  act(() => { fireEvent.click(getByText('Yowie Dollars')) })
  expect(queryByText('Kid Kelly')).not.toBeInTheDocument()
  expect(rowNames(container)).toEqual(['Alice Anders'])
  expect(getByText(/1 adult · sorted by Yowie Dollars balance/i)).toBeInTheDocument()
})

// ---------------- TeamsScreen — Hide eliminated ----------------
import { TeamsScreen } from './screens-detail.jsx'

test('TeamsScreen "Hide eliminated" hides OUT teams and restores them on toggle', () => {
  // 'de' is a known knockout team (alive); 'kr' is not, so assemble marks it eliminated
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'de', name: 'Germany', group: 'A', pool: 'P', color: '#000', strength: 90 },
        { code: 'kr', name: 'South Korea', group: 'A', pool: 'P', color: '#c00', strength: 60 },
      ],
      people: [], ownership: {}, scoring: null,
    },
    fixtures: [],
    standings: { A: [
      { code: 'de', name: 'Germany', played: 3, win: 3, draw: 0, loss: 0, gf: 6, ga: 0, pts: 9 },
      { code: 'kr', name: 'South Korea', played: 3, win: 0, draw: 0, loss: 3, gf: 0, ga: 6, pts: 0 },
    ] },
    photos: [], syncStatus: { stale: false },
  }))
  const noop = () => {}
  const { getByText, queryByText } = render(<TeamsScreen go={noop} openTeam={noop} />)
  expect(getByText(/1 out of 2 teams still in the running/i)).toBeTruthy() // running tally
  expect(getByText('Germany')).toBeTruthy()
  expect(getByText('South Korea')).toBeTruthy() // eliminated but shown by default

  act(() => { fireEvent.click(getByText('Hide eliminated')) })
  expect(getByText('Germany')).toBeTruthy()
  expect(queryByText('South Korea')).toBeNull() // hidden

  act(() => { fireEvent.click(getByText('Hide eliminated')) }) // static label → click again to restore
  expect(queryByText('South Korea')).toBeTruthy() // restored
})

test('TeamsScreen "By sweep pool" omits the PTS column (points are group-only)', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'ar', name: 'Argentina', group: 'C', pool: 'A', color: '#0a7', strength: 90 },
        { code: 'fr', name: 'France', group: 'D', pool: 'A', color: '#00f', strength: 88 },
      ],
      people: [], ownership: {}, scoring: null,
    },
    fixtures: [],
    standings: {
      C: [{ code: 'ar', name: 'Argentina', played: 3, win: 3, draw: 0, loss: 0, gf: 6, ga: 0, pts: 9 }],
      D: [{ code: 'fr', name: 'France', played: 3, win: 3, draw: 0, loss: 0, gf: 5, ga: 1, pts: 9 }],
    },
    photos: [], syncStatus: { stale: false },
  }))
  const noop = () => {}
  const { getByText, queryAllByText } = render(<TeamsScreen go={noop} openTeam={noop} />)
  expect(queryAllByText('pts').length).toBeGreaterThan(0)  // group view shows points
  act(() => { fireEvent.click(getByText('By sweep pool')) })
  expect(queryAllByText('pts').length).toBe(0)             // pool view hides points
  expect(getByText('Argentina')).toBeTruthy()              // teams still listed
})

// ---------------- PeopleScreen — Placement tab ----------------
// Two semis already played, finalists still alive. Later semi (sb) losers place
// 3–4, earlier semi (sa) losers place 5–6, finalists (still in) show nothing.
// NOTE: a QF-stage person (Que) sits at position 4 (between Bea=3 and Sam=5) so
// that the standard competition ranking produces the expected positions.
function placementSweep() {
  const ko = (id, t1, t2, when, winnerCode) => ({
    id, group: '', matchday: 0, t1, t2, ko: when, venue: 'V', city: 'C',
    status: 'final', score: [1, 0], minute: 90, prob: { a: 50, d: 25, b: 25 }, stage: 'knockout', winnerCode,
  })
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'f1', name: 'Fin1', group: '', pool: 'P', color: '#111', strength: 90 },
        { code: 'f2', name: 'Fin2', group: '', pool: 'P', color: '#222', strength: 88 },
        { code: 'sa', name: 'SemiA', group: '', pool: 'P', color: '#333', strength: 80 },
        { code: 'sb', name: 'SemiB', group: '', pool: 'P', color: '#444', strength: 80 },
        { code: 'qf', name: 'QF', group: '', pool: 'P', color: '#555', strength: 70 },
      ],
      people: [
        { id: 'champ', name: 'Champ Player', short: 'Champ' },
        { id: 'runner', name: 'Runner Player', short: 'Runner' },
        { id: 'sa1', name: 'Sam Stone', short: 'Sam' },
        { id: 'sb1', name: 'Bea Bell', short: 'Bea' },
        { id: 'qf1', name: 'Que Frida', short: 'Que' },
      ],
      ownership: { champ: ['f1'], runner: ['f2'], sa1: ['sa'], sb1: ['sb'], qf1: ['qf'] },
      scoring: null,
    },
    fixtures: [
      ko('semiA', 'f1', 'sa', '2026-07-14T18:00:00Z', 'f1'),
      ko('qfMatch', 'f2', 'qf', '2026-07-14T22:00:00Z', 'f2'), // between semiA and semiB → position 4
      ko('semiB', 'f2', 'sb', '2026-07-15T18:00:00Z', 'f2'),
    ],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ support: {} })
}

test('PeopleScreen Placement tab shows finishing positions and nothing for still-in', () => {
  placementSweep()
  const { container, getByText } = render(<PeopleScreen openPerson={noop} />)
  act(() => { fireEvent.click(getByText('Placement')) })
  expect(statFor(container, 'Bea Bell')).toBe('3')   // sb out later → 3 (single owner)
  expect(statFor(container, 'Sam Stone')).toBe('5')  // sa out earlier → 5
  expect(statFor(container, 'Champ Player')).toBeNull() // still in → blank
  expect(statFor(container, 'Runner Player')).toBeNull()
  expect(getByText(/placed · by finishing position/i)).toBeInTheDocument()
})

test('PeopleScreen Placement tab orders still-in at top, then best placement down', () => {
  placementSweep()
  const { container, getByText } = render(<PeopleScreen openPerson={noop} />)
  act(() => { fireEvent.click(getByText('Placement')) })
  const names = rowNames(container)
  // still-in (no number) above placed; among placed, 3 (Bea) above 5 (Sam)
  expect(names.indexOf('Bea Bell')).toBeLessThan(names.indexOf('Sam Stone'))
  expect(names.indexOf('Champ Player')).toBeLessThan(names.indexOf('Bea Bell'))
  expect(names.indexOf('Runner Player')).toBeLessThan(names.indexOf('Bea Bell'))
})

test('PeopleScreen hides the "Hide eliminated" toggle in the Placement view', () => {
  placementSweep()
  const { getByText, queryByText } = render(<PeopleScreen openPerson={noop} />)
  expect(queryByText('Hide eliminated')).toBeInTheDocument() // shown in the Wins view
  act(() => { fireEvent.click(getByText('Placement')) })
  expect(queryByText('Hide eliminated')).not.toBeInTheDocument() // meaningless here → hidden
})
