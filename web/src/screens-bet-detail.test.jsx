import { expect, test, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BetDetail } from './screens-bet-detail.jsx'
import { setWalletData } from './coins.js'
import { clearBetslip } from './betslip.js'
import { setMe } from './social.js'
import { SWEEP as S } from './data.js'

beforeEach(() => {
  clearBetslip()
  S.people = [{ id: 'pn_a', name: 'Ann', initials: 'AN', av: '#ccc' }]
  S.flag = (c) => `/flags/${c}.png`
  S.team = (c) => ({ code: c, name: c.toUpperCase(), color: '#123', flagCode: c })
  S.fixtures = [{ id: 'f1', t1: 'arg', t2: 'bra', stage: 'group', status: 'upcoming',
    ko: new Date('2026-07-01T18:00:00Z'), dateTimeLabel: 'Tue 1 Jul, 18:00', markets: {
    '1x2': { label: 'Match Winner', book: 'Pinnacle', selections: [{ key: 'HOME', label: 'Home', odds: 2 }, { key: 'DRAW', label: 'Draw', odds: 3.5 }, { key: 'AWAY', label: 'Away', odds: 4 }] },
    ou25: { label: 'Over/Under 2.5', line: 2.5, book: 'Pinnacle', selections: [{ key: 'OVER', label: 'Over 2.5', odds: 1.9 }, { key: 'UNDER', label: 'Under 2.5', odds: 1.9 }] },
    cs: { label: 'Correct Score', book: 'Pinnacle', selections: [{ key: '2:1', label: '2-1', odds: 8 }, { key: '1:0', label: '1-0', odds: 7 }] } } }]
  S.fixture = (id) => S.fixtures.find((f) => f.id === id)
  setMe('pn_a')
  setWalletData({ balance: 1000, weeklyGrant: 1000, bets: { open: [], settled: [] }, leaderboard: [] })
})

test('bet detail lists every market for the fixture', () => {
  render(<BetDetail fixtureId="f1" onBack={() => {}} />)
  expect(screen.getByText('Match Winner')).toBeInTheDocument()
  expect(screen.getByText('Over/Under 2.5')).toBeInTheDocument()
  expect(screen.getByText('Correct Score')).toBeInTheDocument()
})

test('tapping a selection adds it to the betslip and auto-opens the slip (keypad shows)', () => {
  render(<BetDetail fixtureId="f1" onBack={() => {}} />)
  fireEvent.click(screen.getAllByTestId('mkt-sel')[0])
  // the first selection auto-opens the sheet, so the keypad is shown without tapping the tab
  expect(screen.getByRole('button', { name: 'Max stake' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '5' })).toBeInTheDocument()
})

test('the Statement tab shows the Yowie Dollars statement', () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['coins', 'ledger', 'pn_a'], {
    balance: 1000,
    entries: [{ id: 1, type: 'grant', amount: 1000, weekIndex: 0, balanceAfter: 1000, createdAt: '2026-07-01T00:00:00.000Z', bet: null }],
  })
  render(
    <QueryClientProvider client={qc}>
      <BetDetail fixtureId="f1" onBack={() => {}} />
    </QueryClientProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: /^statement$/i }))
  expect(screen.getByText('Starting bankroll')).toBeInTheDocument()
  expect(screen.getByText('Balance')).toBeInTheDocument()
})
