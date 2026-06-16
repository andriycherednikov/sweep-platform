// web/src/screens-detail.test.jsx — MatchSheet lineup block + two-way probability
import { expect, test, beforeEach, vi } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'

vi.mock('./api/client.js', () => ({
  postWatch: vi.fn(async () => ({})),
  postSupport: vi.fn(async () => ({})),
  uploadPhoto: vi.fn(async () => ({})),
  adminLogin: vi.fn(async () => ({ admin: true })),
  fetchAdminPhotos: vi.fn(async () => ({ pending: [], approved: [] })),
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
  const { status = 'upcoming', score = null } = opts
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
      prob: { a: 53, d: 26, b: 21 }, stage: 'group', lineups, events,
    }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ watch: {}, support: {} })
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

test('MatchSheet shows the watch CTA + who\'s-watching for an upcoming game', () => {
  const { getByText } = renderSheet(sheetFixture(null, {}, [], { status: 'upcoming' }))
  expect(getByText(/I'll be watching/i)).toBeTruthy()
  expect(getByText(/Who's watching/i)).toBeTruthy()
})

test('MatchSheet hides the watch CTA + who\'s-watching once a game is final', () => {
  const { queryByText } = renderSheet(sheetFixture(null, {}, [], { status: 'final', score: [1, 1] }))
  expect(queryByText(/I'll be watching/i)).toBeNull()
  expect(queryByText(/Who's watching/i)).toBeNull()
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
  setSocialData({ watch: {}, support: {} })
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
  setSocialData({ watch: {}, support: { m1: { p1: 'hr' } } })
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
  setSocialData({ watch: {}, support: { m1: { p1: 'hr' } } })
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
  setSocialData({ watch: {}, support: { m1: { p1: 'DRAW' } } })
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
  setSocialData({ watch: {}, support: { m1: { p1: 'hr' } } })
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
  setSocialData({ watch: {}, support: {} })
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
  setSocialData({ watch: {}, support: {} })
}

test('PeopleAdmin lists existing sweep people with a team count', () => {
  seedPeople()
  const { getByText, getAllByText } = render(<PeopleAdmin onToast={noop} />)
  expect(getByText('Ann')).toBeTruthy()
  expect(getByText('Cara')).toBeTruthy()
  // Ann owns 1 team — a count badge shows it
  expect(getAllByText('teams').length).toBeGreaterThan(0)
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
  await waitFor(() => expect(patchPerson).toHaveBeenCalledWith('p1', { name: 'Annie' }))
})

test('PeopleAdmin allocation sheet applies a rename + team change together', async () => {
  seedPeople()
  patchPerson.mockResolvedValueOnce({ id: 'p1', name: 'Annie' })
  const { getByText, getByLabelText } = render(<PeopleAdmin onToast={noop} />)
  fireEvent.click(getByText('Ann'))
  fireEvent.change(getByLabelText('Name'), { target: { value: 'Annie' } })
  fireEvent.click(getByText('+1'))             // allocate a random team too
  fireEvent.click(getByText('Apply changes'))
  await waitFor(() => expect(patchPerson).toHaveBeenCalledWith('p1', { name: 'Annie' }))
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

import { AdminConsole } from './screens-detail.jsx'

test('AdminConsole offers People + Moderation tabs but no Draw tab', () => {
  seedPeople()
  const { getByText, queryByText } = render(<AdminConsole onBack={noop} onToast={noop} />)
  expect(getByText('Moderation')).toBeInTheDocument()
  expect(queryByText('Draw')).toBeNull()
})

test('MatchSheet covers a final score under spoiler mode, reveals on tap', () => {
  const f = sheetFixture(null, {}, [], { status: 'final', score: [5, 1] })
  setSpoiler(true)
  const { queryByText, getByLabelText } = renderSheet(f)
  expect(queryByText('5–1')).toBeNull()
  act(() => { fireEvent.click(getByLabelText(/reveal score/i)) })
  expect(queryByText('5–1')).toBeTruthy()
  setSpoiler(false)
})

// ---------------- PeopleScreen — Wins ⇄ Predictions stat toggle ----------------
import { PeopleScreen } from './screens-detail.jsx'

// Wins come from standings win counts; correct predictions from support picks on finals.
// Designed so the two orderings differ: wins → Alice(3), Bob(1); predictions → Bob(3), Alice(1).
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
  setSocialData({ watch: {}, support: {
    m1: { alice: 'a', bob: 'a', carol: 'b' }, // winner a → alice ✓, bob ✓, carol ✗
    m2: { bob: 'b', alice: 'c' },             // winner b → bob ✓, alice ✗
    m4: { bob: 'a' },                          // winner a → bob ✓
  } })
}
// → correct calls: Bob 3, Alice 1, Carol 0

const rowNames = (c) => [...c.querySelectorAll('.prow .pi b')].map((n) => n.textContent)
const statFor = (c, name) => {
  const row = [...c.querySelectorAll('.prow')].find((r) => r.querySelector('.pi b')?.textContent === name)
  return row?.querySelector('.pp')?.textContent ?? null
}

test('PeopleScreen defaults to the Wins view (team wins, sorted by wins)', () => {
  peopleSweep()
  const { container, getByText } = render(<PeopleScreen openPerson={noop} />)
  expect(rowNames(container)).toEqual(['Alice Anders', 'Bob Brown', 'Carol Clark'])
  expect(statFor(container, 'Alice Anders')).toBe('3')
  expect(statFor(container, 'Bob Brown')).toBe('1')
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
