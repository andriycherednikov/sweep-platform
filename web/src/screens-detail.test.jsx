// web/src/screens-detail.test.jsx — MatchSheet lineup block + two-way probability
import { expect, test, beforeEach, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

vi.mock('./api/client.js', () => ({
  postWatch: vi.fn(async () => ({})),
  postSupport: vi.fn(async () => ({})),
}))
import { MatchSheet, TeamDetail } from './screens-detail.jsx'
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

function sheetFixture(lineups, squads = {}, events = []) {
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
      venue: 'V', city: 'C', status: 'upcoming', score: null, minute: null,
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

test('MatchSheet probability bar is two-way (home vs away) with no Draw key', () => {
  const { container, queryByText } = renderSheet(sheetFixture(null))
  const segs = container.querySelectorAll('.prob-bar i')
  expect(segs).toHaveLength(2)
  expect(queryByText('Draw')).toBeNull()
})
