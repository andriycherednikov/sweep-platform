// web/src/screens-detail.test.jsx — MatchSheet lineup block + two-way probability
import { expect, test, beforeEach, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

vi.mock('./api/client.js', () => ({
  postWatch: vi.fn(async () => ({})),
  postSupport: vi.fn(async () => ({})),
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
