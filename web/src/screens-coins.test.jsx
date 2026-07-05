import { expect, test, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CoinsScreen, ParlayCard, WagersInfoSheet } from './screens-coins.jsx'
import { setWalletData, canWager } from './coins.js'
import { clearBetslip, betslipLegs } from './betslip.js'
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
  // Flag renders <img class="flag ..."> with alt set to team name; query via DOM
  expect(container.querySelectorAll('img.flag').length).toBeGreaterThan(0)
  expect(screen.getByText('2')).toBeInTheDocument()
})

test('place-a-bet headlines To Qualify when available, else the match result', () => {
  clearBetslip()
  S.fixtures.push({ id: 'f2', t1: 'fra', t2: 'swe', stage: 'knockout', status: 'upcoming',
    ko: new Date('2026-07-02T18:00:00Z'), dayKey: '2026-07-02', dayLabel: 'Wed 2 Jul', markets: {
      '1x2': { book: 'Pinnacle', selections: [{ key: 'HOME', label: 'Home', odds: 1.3 }, { key: 'DRAW', label: 'Draw', odds: 6 }, { key: 'AWAY', label: 'Away', odds: 9 }] },
      toq: { book: 'Bet365', selections: [{ key: 'HOME', label: 'Home', odds: 1.14 }, { key: 'AWAY', label: 'Away', odds: 5.5 }] } } })
  render(<CoinsScreen go={() => {}} openBet={() => {}} />)
  // knockout row shows To Qualify odds (1.14 / 5.5), no Draw — not the 1x2 line
  const row2 = screen.getByTestId('bet-row-f2')
  expect(within(row2).getByText('1.14')).toBeInTheDocument()
  expect(within(row2).getByText('5.5')).toBeInTheDocument()
  expect(within(row2).queryByText('Draw')).not.toBeInTheDocument()
  // the group fixture still headlines the 3-way match result (has a Draw)
  expect(within(screen.getByTestId('bet-row-f1')).getByText('Draw')).toBeInTheDocument()
  // tapping the knockout headline stakes a 'toq' leg, not '1x2'
  fireEvent.click(within(row2).getByRole('button', { name: /home odds 1.14/i }))
  expect(betslipLegs().find((l) => l.fixtureId === 'f2')?.market).toBe('toq')
})

test('an ml-only NBA fixture appears on the Wagers list with an ml headline', () => {
  clearBetslip()
  S.fixtures.push({ id: 'g1', t1: 'lal', t2: 'bos', stage: 'league', status: 'upcoming',
    ko: new Date('2026-07-03T18:00:00Z'), dayKey: '2026-07-03', dayLabel: 'Thu 3 Jul', markets: {
      ml: { book: 'B', selections: [{ key: 'HOME', label: 'Home', odds: 1.6 }, { key: 'AWAY', label: 'Away', odds: 2.3 }] } } })
  render(<CoinsScreen go={() => {}} openBet={() => {}} />)
  const row = screen.getByTestId('bet-row-g1')
  expect(within(row).getByText('1.6')).toBeInTheDocument()
  expect(within(row).getByText('2.3')).toBeInTheDocument()
  fireEvent.click(within(row).getByRole('button', { name: /home odds 1.6/i }))
  expect(betslipLegs().find((l) => l.fixtureId === 'g1')?.market).toBe('ml')
})

test('drift regression: "+N more" counts only renderable markets, not unknown keys', () => {
  S.fixtures[0].markets = {
    ...S.fixtures[0].markets,
    ou25: { line: 2.5, book: 'B', selections: [{ key: 'OVER', label: 'Over', odds: 1.9 }, { key: 'UNDER', label: 'Under', odds: 1.9 }] },
    hcap: { line: -1.5, book: 'B', selections: [{ key: 'HOME', label: 'Home', odds: 1.9 }, { key: 'AWAY', label: 'Away', odds: 1.9 }] },
    zzz_unknown: { book: 'B', selections: [{ key: 'X', label: 'X', odds: 2 }] },
  }
  render(<CoinsScreen go={() => {}} openBet={() => {}} />)
  expect(within(screen.getByTestId('bet-row-f1')).getByText('+2 more markets')).toBeInTheDocument()
})

test('tapping the row opens the bet detail', () => {
  const openBet = vi.fn()
  render(<CoinsScreen go={() => {}} openBet={openBet} />)
  fireEvent.click(screen.getByTestId('bet-row-f1'))
  expect(openBet).toHaveBeenCalledWith('f1')
})

test('tapping an odds button adds the selection and auto-opens the slip (tab hides while open)', () => {
  clearBetslip()
  render(<CoinsScreen go={() => {}} openBet={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /home odds 2/i }))
  // first selection auto-opens the sheet; the side tab is hidden while the sheet is open
  expect(screen.getByRole('button', { name: /place bet/i })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /open bet slip/i })).not.toBeInTheDocument()
})

test('the bet slip tab is visible even with no selections', () => {
  clearBetslip()
  render(<CoinsScreen go={() => {}} openBet={() => {}} />)
  expect(screen.getByRole('button', { name: /open bet slip/i })).toBeInTheDocument()
})

test('the bet slip tab is hidden on the My bets tab', () => {
  clearBetslip()
  render(<CoinsScreen go={() => {}} openBet={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /my bets/i }))
  expect(screen.queryByRole('button', { name: /open bet slip/i })).not.toBeInTheDocument()
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

test('My bets shows the team flag for ml and hcap picks, not just 1x2', () => {
  // add ml, hcap, and toq markets to f1
  S.fixtures[0].markets = {
    ...S.fixtures[0].markets,
    ml: { book: 'Pinnacle', selections: [{ key: 'HOME', label: 'Home', odds: 1.6 }, { key: 'AWAY', label: 'Away', odds: 2.3 }] },
    hcap: { book: 'Pinnacle', selections: [{ key: 'HOME', label: 'Home', odds: 1.9 }, { key: 'AWAY', label: 'Away', odds: 1.9 }] },
    toq: { book: 'Pinnacle', selections: [{ key: 'HOME', label: 'Home', odds: 1.5 }, { key: 'AWAY', label: 'Away', odds: 2.5 }] },
  }
  setWalletData({ balance: 800, weeklyGrant: 1000, leaderboard: [], bets: {
    open: [
      { id: 'b3', fixtureId: 'f1', market: 'ml', selection: 'HOME', stake: 50, odds: 1.6, potentialPayout: 80, status: 'open' },
      { id: 'b4', fixtureId: 'f1', market: 'hcap', selection: 'AWAY', stake: 50, odds: 1.9, potentialPayout: 95, status: 'open' },
      { id: 'b5', fixtureId: 'f1', market: 'toq', selection: 'HOME', stake: 50, odds: 1.5, potentialPayout: 75, status: 'open' },
    ], settled: [] } })
  render(<CoinsScreen go={() => {}} openBet={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /my bets/i }))
  expect(document.querySelectorAll('.coin-bs-sel img.flag').length).toBe(3)
})

test('My bets renders a parlay card with leg count and payout', () => {
  setWalletData({ balance: 800, weeklyGrant: 1000, leaderboard: [], bets: { open: [], settled: [] }, parlays: {
    open: [{ id: 'par1', stake: 100, combinedOdds: 3.8, potentialPayout: 380, status: 'open', placedAt: '2026-07-01T18:00:00Z', legs: [
      { id: 'l1', fixtureId: 'f1', market: '1x2', selection: 'HOME', odds: 2, line: null, status: 'open' },
      { id: 'l2', fixtureId: 'f1', market: 'ou25', selection: 'OVER', odds: 1.9, line: 2.5, status: 'open' }] }],
    settled: [] } })
  render(<CoinsScreen go={() => {}} openBet={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /my bets/i }))
  expect(screen.getByText(/2 legs/i)).toBeInTheDocument()
  expect(screen.getByText('380')).toBeInTheDocument()
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

test('the Statement tab labels a parlay stake as a Multi', () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['coins', 'ledger', 'pn_a'], {
    balance: 900,
    entries: [{ id: 2, type: 'stake', amount: -100, balanceAfter: 900, createdAt: '2026-07-01T18:00:00.000Z', bet: null,
      parlay: { id: 'par1', stake: 100, combinedOdds: 3.8, potentialPayout: 380, status: 'open', legs: [{ id: 'l1' }, { id: 'l2' }] } }],
  })
  render(<QueryClientProvider client={qc}><CoinsScreen go={() => {}} openBet={() => {}} /></QueryClientProvider>)
  fireEvent.click(screen.getByRole('button', { name: /^statement$/i }))
  expect(screen.getByText(/Multi · 2 legs/i)).toBeInTheDocument()
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

test('clicking an individual parlay leg calls onMatch with fixtureId', () => {
  const onMatch = vi.fn()
  const parlay = {
    id: 'p1', status: 'open', stake: 100, potentialPayout: 400, combinedOdds: 4,
    legs: [{ id: 'l1', fixtureId: 'f1', market: '1x2', selection: 'HOME', odds: 2, status: 'open' }]
  }
  const { container } = render(<ParlayCard p={parlay} onMatch={onMatch} />)
  const leg = container.querySelector('.coin-parlay-leg')
  expect(leg).toBeTruthy()
  fireEvent.click(leg)
  expect(onMatch).toHaveBeenCalledWith('f1')
})

test('WagersInfoSheet renders grant text with "each week" when no fixtures (no drop)', () => {
  S.fixtures = []
  render(<WagersInfoSheet onClose={() => {}} onOptOut={() => {}} />)
  // find the grant span containing both "each week" and the full text
  const grantSpan = screen.getByText(/Everyone starts with/)
  // assert it contains exactly one occurrence of "each week"
  const grantText = grantSpan.textContent
  const matches = grantText.match(/each week/g) || []
  expect(matches.length).toBe(1)
  // assert it ends with "while the season runs."
  expect(grantText).toMatch(/while the season runs\.$/)
})

