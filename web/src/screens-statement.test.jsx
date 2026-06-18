import { expect, test, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StatementScreen } from './screens-statement.jsx'
import { setMe } from './social.js'
import { SWEEP as S } from './data.js'

function renderWith(entries, balance = 0) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // pre-seed the query cache so the component renders synchronously without a real fetch
  qc.setQueryData(['coins', 'ledger', 'pn_a'], { balance, entries })
  return render(
    <QueryClientProvider client={qc}>
      <StatementScreen onBack={() => {}} />
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

test('renders a grant as a positive entry labelled Starting bankroll', () => {
  renderWith([
    { id: 1, type: 'grant', amount: 1000, weekIndex: 0, balanceAfter: 1000, createdAt: '2026-06-09T00:00:00.000Z', bet: null },
  ], 1000)
  expect(screen.getByText('Starting bankroll')).toBeInTheDocument()
  expect(screen.getByText('+1,000')).toBeInTheDocument()
})

test('weekly grant (weekIndex > 0) is labelled Weekly Yowie Dollars', () => {
  renderWith([
    { id: 2, type: 'grant', amount: 1000, weekIndex: 1, balanceAfter: 2000, createdAt: '2026-06-16T00:00:00.000Z', bet: null },
  ], 2000)
  expect(screen.getByText('Weekly Yowie Dollars')).toBeInTheDocument()
})

test('a lost stake shows the match, selection and (Lost), with a negative amount', () => {
  renderWith([
    { id: 3, type: 'stake', amount: -200, weekIndex: null, balanceAfter: 800, createdAt: '2026-06-17T00:00:00.000Z',
      bet: { id: 'b1', fixtureId: 'f1', market: '1x2', selection: 'AWAY', line: null, stake: 200, odds: 3, status: 'lost' } },
  ], 800)
  // AWAY → team t2 name (BRA); label includes match + (Lost)
  expect(screen.getByText(/BRA/)).toBeInTheDocument()
  expect(screen.getByText(/\(Lost\)/)).toBeInTheDocument()
  expect(screen.getByText('-200')).toBeInTheDocument()
})

test('a payout shows Won bet on the match and a positive amount', () => {
  renderWith([
    { id: 4, type: 'payout', amount: 230, weekIndex: null, balanceAfter: 1230, createdAt: '2026-06-18T00:00:00.000Z',
      bet: { id: 'b2', fixtureId: 'f1', market: '1x2', selection: 'HOME', line: null, stake: 100, odds: 2.3, status: 'won' } },
  ], 1230)
  expect(screen.getByText(/Won bet/)).toBeInTheDocument()
  expect(screen.getByText('+230')).toBeInTheDocument()
})

test('shows an empty state when there are no entries', () => {
  renderWith([], 0)
  expect(screen.getByText(/No activity yet/i)).toBeInTheDocument()
})
