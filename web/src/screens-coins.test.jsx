import { expect, test, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CoinsScreen } from './screens-coins.jsx'
import { setWalletData } from './coins.js'
import { setMe } from './social.js'
import { SWEEP as S } from './data.js'

beforeEach(() => {
  S.people = [{ id: 'pn_a', name: 'Ann', initials: 'AN', av: '#ccc' }]
  S.fixtures = [{ id: 'f1', t1: 'arg', t2: 'bra', stage: 'group', status: 'upcoming', ko: new Date('2026-07-01T18:00:00Z'), odds: { home: 2, draw: 3.5, away: 4, book: 'Pinnacle' } }]
  S.fixture = (id) => S.fixtures.find((f) => f.id === id)
  S.team = (c) => ({ code: c, name: c.toUpperCase(), color: '#123', flagCode: c })
  setMe('pn_a')
  setWalletData({ balance: 1000, weeklyGrant: 1000, bets: { open: [], settled: [] }, leaderboard: [{ personId: 'pn_a', balance: 1000 }] })
})

test('shows the wallet balance and a bettable match with odds', () => {
  render(<CoinsScreen go={() => {}} openMatch={() => {}} />)
  expect(screen.getByText(/1000/)).toBeInTheDocument()
  expect(screen.getByText('Pinnacle')).toBeInTheDocument()
})

test('tapping an odds button opens the bet sheet with a stake input', () => {
  render(<CoinsScreen go={() => {}} openMatch={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /home odds 2/i }))
  expect(screen.getByRole('spinbutton')).toBeInTheDocument()
})
