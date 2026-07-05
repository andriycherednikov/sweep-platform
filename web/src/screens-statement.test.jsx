import { expect, test, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StatementList } from './screens-statement.jsx'
import { setMe } from './social.js'
import { SWEEP as S } from './data.js'

function renderWith(entries, balance = 0) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // pre-seed the query cache so the component renders synchronously without a real fetch
  qc.setQueryData(['coins', 'ledger', 'pn_a'], { balance, entries })
  return render(
    <QueryClientProvider client={qc}>
      <StatementList />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  S.people = [{ id: 'pn_a', name: 'Ann', initials: 'AN', av: '#ccc' }]
  S.team = (c) => ({ code: c, name: c.toUpperCase(), flagCode: c })
  S.flag = (c) => `/flags/${c}.png`
  S.fixtures = [{ id: 'f1', t1: 'arg', t2: 'bra' }]
  S.fixture = (id) => S.fixtures.find((f) => f.id === id)
  setMe('pn_a')
})

test('renders column headers including a Balance column', () => {
  renderWith([
    { id: 1, type: 'grant', amount: 1000, weekIndex: 0, balanceAfter: 1000, createdAt: '2026-06-09T00:00:00.000Z', bet: null },
  ], 1000)
  expect(screen.getByText('Date')).toBeInTheDocument()
  expect(screen.getByText('Activity')).toBeInTheDocument()
  expect(screen.getByText('Amount')).toBeInTheDocument()
  expect(screen.getByText('Balance')).toBeInTheDocument()
})

test('renders a grant as a positive entry labelled Starting bankroll with its running balance and deposit icon', () => {
  const { container } = renderWith([
    { id: 1, type: 'grant', amount: 1000, weekIndex: 0, balanceAfter: 1000, createdAt: '2026-06-09T00:00:00.000Z', bet: null },
  ], 1000)
  expect(screen.getByText('Starting bankroll')).toBeInTheDocument()
  expect(screen.getByText('+1,000')).toBeInTheDocument()
  // running balance shows in the last column
  expect(screen.getByText('1,000')).toBeInTheDocument()
  expect(container.querySelector('.stmt-ic.dep')).toBeTruthy()
})

test('weekly grant (weekIndex > 0) is labelled Weekly Yowie Dollars', () => {
  renderWith([
    { id: 2, type: 'grant', amount: 1000, weekIndex: 1, balanceAfter: 2000, createdAt: '2026-06-16T00:00:00.000Z', bet: null },
  ], 2000)
  expect(screen.getByText('Weekly Yowie Dollars')).toBeInTheDocument()
})

test('a placed/lost stake shows game + selection (no "(Lost)") with a negative amount and the bet icon', () => {
  const { container } = renderWith([
    { id: 3, type: 'stake', amount: -200, weekIndex: null, balanceAfter: 800, createdAt: '2026-06-17T00:00:00.000Z',
      bet: { id: 'b1', fixtureId: 'f1', market: '1x2', selection: 'AWAY', line: null, stake: 200, odds: 3, status: 'lost' } },
  ], 800)
  // line 1 = the game; line 2 = the selection (AWAY → team t2 name BRA)
  expect(screen.getByText('ARG v BRA')).toBeInTheDocument()
  expect(screen.getByText('BRA · Match Winner')).toBeInTheDocument()
  // we no longer annotate losses — the stake debit stands on its own
  expect(screen.queryByText(/lost/i)).not.toBeInTheDocument()
  expect(screen.getByText('-200')).toBeInTheDocument()
  expect(screen.getByText('800')).toBeInTheDocument()
  expect(container.querySelector('.stmt-ic.bet')).toBeTruthy()
})

test('a payout shows the game + selection, a positive amount and the win icon', () => {
  const { container } = renderWith([
    { id: 4, type: 'payout', amount: 230, weekIndex: null, balanceAfter: 1230, createdAt: '2026-06-18T00:00:00.000Z',
      bet: { id: 'b2', fixtureId: 'f1', market: '1x2', selection: 'HOME', line: null, stake: 100, odds: 2.3, status: 'won' } },
  ], 1230)
  expect(screen.getByText('ARG v BRA')).toBeInTheDocument()
  expect(screen.getByText('ARG · Match Winner')).toBeInTheDocument()
  expect(screen.getByText('+230')).toBeInTheDocument()
  expect(container.querySelector('.stmt-ic.win')).toBeTruthy()
})

test('a correct-prediction reward row shows the match, +100 and a gold tick', () => {
  const { container } = renderWith([
    { id: 7, type: 'predict', amount: 100, weekIndex: null, balanceAfter: 1100, createdAt: '2026-06-18T00:00:00.000Z', bet: null, fixtureId: 'f1' },
  ], 1100)
  expect(screen.getByText('ARG v BRA')).toBeInTheDocument()
  expect(screen.getByText('Correct prediction')).toBeInTheDocument()
  expect(screen.getByText('+100')).toBeInTheDocument()
  expect(container.querySelector('.stmt-ic.predict')).toBeTruthy()
})

test('a team-win reward row shows the match, +300 and the team icon', () => {
  const { container } = renderWith([
    { id: 8, type: 'teamwin', amount: 300, weekIndex: null, balanceAfter: 1400, createdAt: '2026-06-18T00:00:00.000Z', bet: null, fixtureId: 'f1' },
  ], 1400)
  expect(screen.getByText('ARG v BRA')).toBeInTheDocument()
  expect(screen.getByText('Your team won a match')).toBeInTheDocument()
  expect(screen.getByText('+300')).toBeInTheDocument()
  expect(container.querySelector('.stmt-ic.teamwin')).toBeTruthy()
})

test('shows an empty state when there are no entries', () => {
  renderWith([], 0)
  expect(screen.getByText(/No activity yet/i)).toBeInTheDocument()
})
