import { expect, test, vi, beforeEach } from 'vitest'
import * as client from './api/client.js'
import { setWalletData, myBalance, placeBet, coinsLeaderboard, balanceByPerson, canWager } from './coins.js'
import { setMe } from './social.js'
import { optOut } from './optout.js'
import { SWEEP as S } from './data.js'

beforeEach(() => {
  localStorage.clear()
  S.people = [{ id: 'pn_a', name: 'Ann' }, { id: 'pn_b', name: 'Bob' }]
  S.fixtures = [{ id: 'f1', t1: 'arg', t2: 'bra', status: 'upcoming', markets: {
    '1x2': { selections: [{ key: 'HOME', odds: 2 }, { key: 'DRAW', odds: 3.5 }, { key: 'AWAY', odds: 4 }] },
    ou25: { line: 2.5, selections: [{ key: 'OVER', odds: 1.9 }, { key: 'UNDER', odds: 1.9 }] } } }]
  S.fixture = (id) => S.fixtures.find((f) => f.id === id)
  setMe('pn_a')
  setWalletData({ balance: 1000, weeklyGrant: 1000, bets: { open: [], settled: [] }, leaderboard: [{ personId: 'pn_a', balance: 1000 }, { personId: 'pn_b', balance: 1200 }] })
})

test('myBalance reflects the hydrated wallet', () => {
  expect(myBalance()).toBe(1000)
})

test('coinsLeaderboard ranks people by balance, highest first', () => {
  const board = coinsLeaderboard()
  expect(board.map((e) => e.person.id)).toEqual(['pn_b', 'pn_a'])
  expect(board[0].balance).toBe(1200)
})

test('balanceByPerson maps personId to balance', () => {
  expect(balanceByPerson()).toEqual({ pn_a: 1000, pn_b: 1200 })
})

test('placeBet optimistically debits the balance and rolls back on failure', async () => {
  vi.spyOn(client, 'postBet').mockRejectedValueOnce(new Error('nope'))
  await placeBet('f1', '1x2', 'HOME', 100)
  expect(myBalance()).toBe(1000) // rolled back
})

test('placeBet keeps the debit on success', async () => {
  vi.spyOn(client, 'postBet').mockResolvedValueOnce({ bet: { id: 'b1', fixtureId: 'f1', market: '1x2', selection: 'HOME', stake: 100, odds: 2, potentialPayout: 200, status: 'open' }, balance: 900 })
  await placeBet('f1', '1x2', 'HOME', 100)
  expect(myBalance()).toBe(900)
})

test('placeBet reads odds from the chosen market and posts market+selection', async () => {
  vi.spyOn(client, 'postBet').mockResolvedValueOnce({ bet: { id: 'b1', market: 'ou25', selection: 'OVER', stake: 100, odds: 1.9, potentialPayout: 190, status: 'open' }, balance: 900 })
  await placeBet('f1', 'ou25', 'OVER', 100)
  expect(myBalance()).toBe(900)
  expect(client.postBet).toHaveBeenCalledWith({ fixtureId: 'f1', personId: 'pn_a', market: 'ou25', selection: 'OVER', stake: 100 })
})

test('canWager is false while opted out, true once the window lapses', () => {
  expect(canWager()).toBe(true)   // me = pn_a, an adult
  optOut('1d')
  expect(canWager()).toBe(false)
  localStorage.clear()            // simulate the window elapsing / silent lift
  expect(canWager()).toBe(true)
})
