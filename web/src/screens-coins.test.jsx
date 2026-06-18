import { expect, test, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CoinsScreen } from './screens-coins.jsx'
import { setWalletData } from './coins.js'
import { setMe } from './social.js'
import { SWEEP as S } from './data.js'

beforeEach(() => {
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

test('the View statement link calls openStatement', () => {
  const openStatement = vi.fn()
  render(<CoinsScreen go={() => {}} openBet={() => {}} openStatement={openStatement} />)
  fireEvent.click(screen.getByRole('button', { name: /view statement/i }))
  expect(openStatement).toHaveBeenCalledTimes(1)
})
