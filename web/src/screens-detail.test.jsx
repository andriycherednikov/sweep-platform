// web/src/screens-detail.test.jsx — MatchSheet lineup block + two-way probability
import { expect, test, beforeEach, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

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
  postOwnership: vi.fn(async () => ({})),
  deleteOwnership: vi.fn(async () => ({})),
}))
import { MatchSheet, TeamDetail, PersonDetail } from './screens-detail.jsx'
import { SWEEP as S, setSweepData } from './data.js'
import { assembleSweep } from './lib/assemble.js'
import { setMe, setSocialData } from './social.js'

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

beforeEach(() => { localStorage.clear(); setMe(null); vi.clearAllMocks() })

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
import { createPerson, patchPerson, deletePerson } from './api/client.js'

function seedPeople() {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [{ code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#c00', strength: 80 }],
      people: [{ id: 'p1', name: 'Ann', short: 'Ann', initials: 'AN' }],
      ownership: { p1: ['hr'] }, scoring: null,
    },
    fixtures: [], standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ watch: {}, support: {} })
}

test('PeopleAdmin lists existing sweep people', () => {
  seedPeople()
  const { getByText } = render(<PeopleAdmin onToast={noop} />)
  expect(getByText('Ann')).toBeTruthy()
})

test('PeopleAdmin creates a person via createPerson', async () => {
  seedPeople()
  createPerson.mockResolvedValueOnce({ id: 'p2', name: 'Bo' })
  const { getByPlaceholderText, getByText } = render(<PeopleAdmin onToast={noop} />)
  fireEvent.change(getByPlaceholderText('Add a person…'), { target: { value: 'Bo' } })
  fireEvent.click(getByText('Add'))
  await waitFor(() => expect(createPerson).toHaveBeenCalledTimes(1))
  expect(createPerson.mock.calls[0][0]).toMatchObject({ name: 'Bo', short: 'Bo', initials: 'BO' })
  // av is required by the server (avColor, minLength 1) — must be a non-empty hex color, never null
  const av = createPerson.mock.calls[0][0].av
  expect(typeof av).toBe('string')
  expect(av).toMatch(/^#[0-9a-fA-F]{3,8}$/)
})

test('PeopleAdmin renames a person via patchPerson', async () => {
  seedPeople()
  patchPerson.mockResolvedValueOnce({ id: 'p1', name: 'Annie' })
  const { getByLabelText, getByDisplayValue, getByText } = render(<PeopleAdmin onToast={noop} />)
  fireEvent.click(getByLabelText('Rename Ann'))
  fireEvent.change(getByDisplayValue('Ann'), { target: { value: 'Annie' } })
  fireEvent.click(getByText('Save'))
  await waitFor(() => expect(patchPerson).toHaveBeenCalledWith('p1', { name: 'Annie' }))
})

test('PeopleAdmin deletes a person via deletePerson', async () => {
  seedPeople()
  deletePerson.mockResolvedValueOnce({ ok: true })
  const { getByLabelText } = render(<PeopleAdmin onToast={noop} />)
  fireEvent.click(getByLabelText('Remove Ann'))
  await waitFor(() => expect(deletePerson).toHaveBeenCalledWith('p1'))
})

import { DrawAdmin } from './screens-detail.jsx'
import { postOwnership, deleteOwnership } from './api/client.js'

function seedDraw() {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#c00', strength: 80 },
        { code: 'en', name: 'England', group: 'L', pool: 'A', color: '#fff', strength: 90 },
      ],
      people: [{ id: 'p1', name: 'Ann', short: 'Ann', initials: 'AN' }],
      ownership: { p1: ['hr'] }, scoring: null,
    },
    fixtures: [], standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ watch: {}, support: {} })
}

test('DrawAdmin assigns a team to a person via postOwnership', async () => {
  seedDraw()
  postOwnership.mockResolvedValueOnce({ ok: true })
  const { getByLabelText, getByText } = render(<DrawAdmin onToast={noop} />)
  fireEvent.change(getByLabelText('Person'), { target: { value: 'p1' } })
  fireEvent.change(getByLabelText('Team'), { target: { value: 'en' } })
  fireEvent.click(getByText('Assign'))
  await waitFor(() => expect(postOwnership).toHaveBeenCalledWith('p1', 'en'))
})

test('DrawAdmin removes an existing assignment via deleteOwnership', async () => {
  seedDraw()
  deleteOwnership.mockResolvedValueOnce({ ok: true })
  const { getByLabelText } = render(<DrawAdmin onToast={noop} />)
  fireEvent.change(getByLabelText('Person'), { target: { value: 'p1' } })
  fireEvent.click(getByLabelText('Unassign Croatia'))
  await waitFor(() => expect(deleteOwnership).toHaveBeenCalledWith('p1', 'hr'))
})

test('PeopleAdmin invalidates the sweep query after creating a person', async () => {
  seedPeople()
  const qc = { invalidateQueries: vi.fn() }
  createPerson.mockResolvedValueOnce({ id: 'p2', name: 'Bo' })
  const { getByPlaceholderText, getByText } = render(<PeopleAdmin onToast={noop} queryClient={qc} />)
  fireEvent.change(getByPlaceholderText('Add a person…'), { target: { value: 'Bo' } })
  fireEvent.click(getByText('Add'))
  await waitFor(() => expect(createPerson).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sweep'] }))
})

test('PeopleAdmin invalidates the sweep query after deleting a person', async () => {
  seedPeople()
  const qc = { invalidateQueries: vi.fn() }
  deletePerson.mockResolvedValueOnce({ ok: true })
  const { getByLabelText } = render(<PeopleAdmin onToast={noop} queryClient={qc} />)
  fireEvent.click(getByLabelText('Remove Ann'))
  await waitFor(() => expect(deletePerson).toHaveBeenCalledWith('p1'))
  await waitFor(() => expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sweep'] }))
})

test('DrawAdmin invalidates the sweep query after assigning a team', async () => {
  seedDraw()
  const qc = { invalidateQueries: vi.fn() }
  postOwnership.mockResolvedValueOnce({ ok: true })
  const { getByLabelText, getByText } = render(<DrawAdmin onToast={noop} queryClient={qc} />)
  fireEvent.change(getByLabelText('Person'), { target: { value: 'p1' } })
  fireEvent.change(getByLabelText('Team'), { target: { value: 'en' } })
  fireEvent.click(getByText('Assign'))
  await waitFor(() => expect(postOwnership).toHaveBeenCalledWith('p1', 'en'))
  await waitFor(() => expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sweep'] }))
})

test('DrawAdmin invalidates the sweep query after removing a team', async () => {
  seedDraw()
  const qc = { invalidateQueries: vi.fn() }
  deleteOwnership.mockResolvedValueOnce({ ok: true })
  const { getByLabelText } = render(<DrawAdmin onToast={noop} queryClient={qc} />)
  fireEvent.change(getByLabelText('Person'), { target: { value: 'p1' } })
  fireEvent.click(getByLabelText('Unassign Croatia'))
  await waitFor(() => expect(deleteOwnership).toHaveBeenCalledWith('p1', 'hr'))
  await waitFor(() => expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sweep'] }))
})
