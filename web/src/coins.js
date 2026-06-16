import { useState, useEffect } from 'react'
import { SWEEP as S } from './data.js'
import { getMe, toast } from './social.js'
import { postBet } from './api/client.js'
import { trackEvent } from './lib/analytics.js'

const listeners = new Set()
function notify() { listeners.forEach((fn) => fn()) }
let pendingSeq = 0  // unique-ifies optimistic bet ids so rapid placeBets never collide

let wallet = { balance: 0, weeklyGrant: 1000, bets: { open: [], settled: [] } }
let board = []  // [{ personId, balance }]

export function setWalletData(server) {
  if (!server) return
  wallet = { balance: server.balance ?? 0, weeklyGrant: server.weeklyGrant ?? 1000, bets: server.bets ?? { open: [], settled: [] } }
  board = server.leaderboard ?? []
  notify()
}

export function myBalance() { return wallet.balance }
export function myWallet() { return wallet }
export function balanceByPerson() { const m = {}; for (const e of board) m[e.personId] = e.balance; return m }

/** Leaderboard rows resolved to people, highest balance first. */
export function coinsLeaderboard(limit = Infinity) {
  return board
    .map((e) => ({ person: S.people.find((p) => p.id === e.personId), balance: e.balance }))
    .filter((x) => x.person)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, limit)
}

export function leaderboardByBalance() { return board }

/** Optimistically debit the balance + add an open bet; reconcile/rollback against the server. */
export async function placeBet(fixtureId, market, selection, stake) {
  const me = getMe()
  if (!me) { if (window.__sweepPickMe) window.__sweepPickMe(); return }
  if (!(stake >= 1) || stake > wallet.balance) { toast('Not enough coins'); return }
  const f = S.fixture(fixtureId)
  const mk = f?.markets?.[market]
  const sel = mk?.selections?.find((s) => s.key === selection)
  const odds = sel ? sel.odds : null
  const pending = { id: `pending_${Date.now()}_${pendingSeq++}`, fixtureId, market, selection, stake, odds,
    line: mk?.line ?? null, potentialPayout: odds ? Math.round(stake * odds) : 0, status: 'open' }
  wallet = { ...wallet, balance: wallet.balance - stake, bets: { ...wallet.bets, open: [pending, ...wallet.bets.open] } }
  notify()
  trackEvent('bet_placed', { match_id: fixtureId, market, selection, stake })
  try {
    const res = await postBet({ fixtureId, personId: me.id, market, selection, stake })
    // swap the pending row for the real one; the SSE 'bet' event reconciles the
    // authoritative balance/bets shortly after, so we don't fight concurrent placeBets here.
    wallet = { ...wallet, balance: res.balance, bets: { ...wallet.bets, open: wallet.bets.open.map((b) => b.id === pending.id ? res.bet : b) } }
    notify()
  } catch {
    // targeted rollback on the LIVE wallet (not a stale snapshot): drop just this pending bet
    // and credit its stake back, so a failed bet can't clobber a concurrent one's update.
    wallet = { ...wallet, balance: wallet.balance + stake, bets: { ...wallet.bets, open: wallet.bets.open.filter((b) => b.id !== pending.id) } }
    notify(); toast("Couldn't place bet — try again")
  }
}

export function useCoins() {
  const [, force] = useState(0)
  useEffect(() => { const fn = () => force((x) => x + 1); listeners.add(fn); return () => listeners.delete(fn) }, [])
  return { wallet, board }
}
