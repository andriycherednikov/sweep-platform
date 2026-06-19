import { expect, test, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CoinsScreen } from './screens-coins.jsx'
import { setWalletData, canWager } from './coins.js'
import { clearBetslip } from './betslip.js'
import { setMe } from './social.js'
import { SWEEP as S } from './data.js'

beforeEach(() => {
  clearBetslip()
  localStorage.clear()
  S.people = [{ id: 'pn_a', name: 'Ann', initials: 'AN', av: '#ccc' }]
  S.flag = (c) => `/flags/${c}.png`
  S.team = (c) => ({ code: c, name: c.toUpperCase(), color: '#123', flagCode: c })
  S.todayKey = '2026-07-01'
  const mk = { '1x2': { book: 'Pinnacle', selections: [{ key: 'HOME', label: 'Home', odds: 2 }, { key: 'DRAW', label: 'Draw', odds: 3.5 }, { key: 'AWAY', label: 'Away', odds: 4 }] } }
  S.fixtures = [{ id: 'f1', t1: 'arg', t2: 'bra', stage: 'group', status: 'upcoming', ko: new Date('2026-07-01T18:00:00Z'), dayKey: '2026-07-01', dayLabel: 'Tue 1 Jul', markets: mk }]
  S.fixture = (id) => S.fixtures.find((f) => f.id === id)
  setMe('pn_a')
  setWalletData({ balance: 1000, weeklyGrant: 1000, bets: { open: [], settled: [] }, leaderboard: [{ personId: 'pn_a', balance: 1000 }] })
})

test('place-a-bet shows a day header, flags, and inline 1X2 odds', () => {
  const { container } = render(<CoinsScreen go={() => {}} openBet={() => {}} />)
  expect(screen.getByText('Today')).toBeInTheDocument()
  // Flag renders <img class="flag ..."> with alt="" (decorative); query via DOM
  expect(container.querySelectorAll('img.flag').length).toBeGreaterThan(0)
  expect(screen.getByText('2')).toBeInTheDocument()
})

test('tapping the row opens the bet detail', () => {
  const openBet = vi.fn()
  render(<CoinsScreen go={() => {}} openBet={openBet} />)
  fireEvent.click(screen.getByTestId('bet-row-f1'))
  expect(openBet).toHaveBeenCalledWith('f1')
})

test('tapping an odds button adds the selection to the betslip (pill appears)', () => {
  clearBetslip()
  render(<CoinsScreen go={() => {}} openBet={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /home odds 2/i }))
  expect(screen.getByRole('button', { name: /open bet slip/i })).toBeInTheDocument()
})

test('My bets lists open and settled bets and filters', () => {
  setWalletData({ balance: 800, weeklyGrant: 1000, leaderboard: [], bets: {
    open: [{ id: 'b1', fixtureId: 'f1', market: 'ou25', selection: 'OVER', stake: 100, odds: 1.9, potentialPayout: 190, status: 'open' }],
    settled: [{ id: 'b2', fixtureId: 'f1', market: '1x2', selection: 'HOME', stake: 50, odds: 2, potentialPayout: 100, status: 'won' }] } })
  render(<CoinsScreen go={() => {}} openBet={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /my bets/i }))
  // 'Open' (default) shows the open ou25 pick but not the settled won bet
  expect(screen.getByText('Over')).toBeInTheDocument()
  expect(screen.queryByText('won')).not.toBeInTheDocument()
  // 'All' shows both
  fireEvent.click(screen.getByRole('button', { name: /^all$/i }))
  expect(screen.getByText('Over')).toBeInTheDocument()
  expect(screen.getByText('won')).toBeInTheDocument()
  // filter to Settled only
  fireEvent.click(screen.getByRole('button', { name: /^settled$/i }))
  expect(screen.queryByText('Over')).not.toBeInTheDocument()
  expect(screen.getByText('won')).toBeInTheDocument()
})

test('the Statement tab shows the Yowie Dollars statement', () => {
  // CoinsScreen renders <StatementList/> for this tab, which fetches via TanStack Query —
  // wrap in a provider and pre-seed the ledger so it renders synchronously.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['coins', 'ledger', 'pn_a'], {
    balance: 1000,
    entries: [{ id: 1, type: 'grant', amount: 1000, weekIndex: 0, balanceAfter: 1000, createdAt: '2026-07-01T00:00:00.000Z', bet: null }],
  })
  render(
    <QueryClientProvider client={qc}>
      <CoinsScreen go={() => {}} openBet={() => {}} />
    </QueryClientProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: /^statement$/i }))
  expect(screen.getByText('Starting bankroll')).toBeInTheDocument()
  expect(screen.getByText('Balance')).toBeInTheDocument()
})

test('the About sheet shield hands off to the opt-out sheet', () => {
  render(<CoinsScreen go={() => {}} openBet={() => {}} />)
  // open the "?" About sheet
  fireEvent.click(screen.getByRole('button', { name: /about wagers/i }))
  expect(screen.getByText(/Stepping away is OK/i)).toBeInTheDocument()
  // its shield opens the opt-out sheet (there may be 2 matches: header + sheet — click the last)
  const btns = screen.getAllByRole('button', { name: /step away from wagers/i })
  fireEvent.click(btns[btns.length - 1])
  expect(screen.getByRole('button', { name: 'Completely' })).toBeInTheDocument()
})

test('the header shield opens the opt-out sheet and a duration locks Wagers', () => {
  render(<CoinsScreen go={() => {}} openBet={() => {}} />)
  // The About sheet auto-opens on first render (localStorage cleared in beforeEach).
  // Close it first so only the header shield button is in the DOM.
  fireEvent.click(screen.getByRole('button', { name: /got it/i }))
  // shield replaces the privacy eye in the Wagers header
  fireEvent.click(screen.getByLabelText('Step away from Wagers'))
  // sheet shows the five choices
  expect(screen.getByRole('button', { name: '7 days' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Completely' })).toBeInTheDocument()
  // choosing a duration reveals the confirm step
  fireEvent.click(screen.getByRole('button', { name: '7 days' }))
  fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }))
  // opted out → canWager() is now false
  expect(canWager()).toBe(false)
})
