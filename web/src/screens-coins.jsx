/* ============================================================
   THE SWEEP — Coins screen: wallet, bettable matches, bet history
   ============================================================ */
import { useState } from 'react'
import { SWEEP as S } from './data.js'
import { getMe } from './social.js'
import { useCoins, myWallet, placeBet } from './coins.js'
import { Icon } from './components.jsx'

/* ---- helpers ---- */
function selectionLabel(selection, f) {
  if (!f) return selection
  if (selection === 'DRAW') return 'Draw'
  if (selection === 'HOME') return S.team(f.t1)?.name || f.t1
  if (selection === 'AWAY') return S.team(f.t2)?.name || f.t2
  return selection
}

/* ---- Bet sheet (bottom-sheet overlay) ---- */
function BetSheet({ f, selection, odds, onClose }) {
  const [stake, setStake] = useState('')
  const { wallet } = useCoins()
  const balance = wallet.balance
  const stakeNum = parseInt(stake, 10)
  const valid = stakeNum >= 1 && stakeNum <= balance
  const payout = (stakeNum >= 1 && odds) ? Math.round(stakeNum * odds) : 0

  async function submit() {
    if (!valid) return
    await placeBet(f.id, selection, stakeNum)
    onClose()
  }

  const t1 = S.team(f.t1)
  const t2 = S.team(f.t2)
  const label = selectionLabel(selection, f)

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()} style={{ maxHeight: '90%' }}>
        <div className="grab" />
        <div className="sheet-head">
          <h3>Place a bet</h3>
          <button className="x" onClick={onClose}><Icon.x /></button>
        </div>
        <div className="sheet-body">
          {/* Match summary */}
          <div className="coin-bet-match">
            <div className="coin-bet-teams">
              <span>{t1?.name || f.t1}</span>
              <span className="coin-bet-vs">v</span>
              <span>{t2?.name || f.t2}</span>
            </div>
            <div className="coin-bet-selection">
              <span className="coin-sel-label">{label}</span>
              <span className="coin-sel-odds">@ {odds}</span>
            </div>
          </div>

          {/* Stake input */}
          <div className="field" style={{ marginTop: 16 }}>
            <label>Stake (coins)</label>
            <input
              type="number"
              min="1"
              max={balance}
              value={stake}
              onChange={e => setStake(e.target.value)}
              placeholder={`1 – ${balance}`}
            />
          </div>

          {/* Payout preview */}
          {stakeNum >= 1 && (
            <div className="coin-payout-preview">
              To win: <b>{payout}</b> coins
            </div>
          )}

          <button
            className="cta"
            style={{ marginTop: 18, opacity: valid ? 1 : 0.5 }}
            onClick={submit}
            disabled={!valid}
          >
            <Icon.coin /> Place bet
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---- Main screen ---- */
export function CoinsScreen({ go, openMatch }) {
  useCoins() // re-render on store changes
  const me = getMe()
  const wallet = myWallet()

  const [betSheet, setBetSheet] = useState(null) // { f, selection, odds } | null

  // Upcoming bettable matches, sorted by kickoff
  const bettable = S.fixtures
    .filter(f => f.status === 'upcoming' && f.odds)
    .sort((a, b) => a.ko - b.ko)

  function openBet(f, selection, odds) {
    if (!me) { if (window.__sweepPickMe) window.__sweepPickMe(); return }
    setBetSheet({ f, selection, odds })
  }

  return (
    <div className="screen screen-anim" data-testid="coins-screen" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Wallet header */}
      <div className="coin-wallet-header">
        {me ? (
          <>
            <div className="coin-balance-row">
              <Icon.coin className="coin-icon" />
              <span className="coin-balance">{wallet.balance}</span>
              <span className="coin-label">coins</span>
            </div>
            <div className="coin-grant-note">{`+${wallet.weeklyGrant.toLocaleString()} coins every week`}</div>
          </>
        ) : (
          <div className="coin-no-id">
            <p>Pick who you are to track your coins and place bets.</p>
            <button className="cta" style={{ marginTop: 10 }} onClick={() => { if (window.__sweepPickMe) window.__sweepPickMe() }}>
              Choose your profile
            </button>
          </div>
        )}
      </div>

      <div className="scroll pad screen-anim">
        <div className="wrap" style={{ marginTop: 14 }}>

          {/* Place a bet */}
          <div className="sec-h"><h2>Place a bet</h2></div>
          {bettable.length === 0 ? (
            <div className="block" style={{ padding: '16px 14px', color: 'var(--muted)', fontSize: 13 }}>
              No bettable matches right now.
            </div>
          ) : (
            bettable.map(f => {
              const t1 = S.team(f.t1)
              const t2 = S.team(f.t2)
              const isGroup = f.stage === 'group'
              return (
                <div key={f.id} className="block coin-match-row">
                  <div className="coin-match-teams">
                    <div className="coin-team">
                      <span className="coin-team-name">{t1?.name || f.t1}</span>
                    </div>
                    <span className="coin-vs">v</span>
                    <div className="coin-team coin-team-r">
                      <span className="coin-team-name">{t2?.name || f.t2}</span>
                    </div>
                  </div>
                  {f.odds.book && (
                    <div className="coin-book">{f.odds.book}</div>
                  )}
                  <div className="coin-odds-row">
                    <button
                      className="coin-odds-btn"
                      aria-label={`home odds ${f.odds.home}`}
                      onClick={() => openBet(f, 'HOME', f.odds.home)}
                    >
                      <span className="coin-odds-side">{t1?.name || f.t1}</span>
                      <span className="coin-odds-val">{f.odds.home}</span>
                    </button>
                    {isGroup && (
                      <button
                        className="coin-odds-btn"
                        aria-label={`draw odds ${f.odds.draw}`}
                        onClick={() => openBet(f, 'DRAW', f.odds.draw)}
                      >
                        <span className="coin-odds-side">Draw</span>
                        <span className="coin-odds-val">{f.odds.draw}</span>
                      </button>
                    )}
                    <button
                      className="coin-odds-btn"
                      aria-label={`away odds ${f.odds.away}`}
                      onClick={() => openBet(f, 'AWAY', f.odds.away)}
                    >
                      <span className="coin-odds-side">{t2?.name || f.t2}</span>
                      <span className="coin-odds-val">{f.odds.away}</span>
                    </button>
                  </div>
                </div>
              )
            })
          )}

          {/* Open bets */}
          <div className="sec-h"><h2>Open bets</h2></div>
          <div className="block">
            {wallet.bets.open.length === 0 ? (
              <div style={{ padding: '12px 0', color: 'var(--muted2)', fontSize: 13, fontWeight: 600 }}>No open bets yet.</div>
            ) : (
              wallet.bets.open.map(bet => {
                const f = S.fixture(bet.fixtureId)
                const label = selectionLabel(bet.selection, f)
                return (
                  <div key={bet.id} className="coin-bet-row">
                    <div className="coin-bet-info">
                      <span className="coin-bet-sel">{label}</span>
                      {f && (
                        <span className="coin-bet-match-name">
                          {S.team(f.t1)?.name || f.t1} v {S.team(f.t2)?.name || f.t2}
                        </span>
                      )}
                    </div>
                    <div className="coin-bet-nums">
                      <span className="coin-bet-stake">{bet.stake} @ {bet.odds}</span>
                      <span className="coin-bet-payout">To win {bet.potentialPayout}</span>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Settled bets */}
          <div className="sec-h"><h2>Settled</h2></div>
          <div className="block">
            {wallet.bets.settled.length === 0 ? (
              <div style={{ padding: '12px 0', color: 'var(--muted2)', fontSize: 13, fontWeight: 600 }}>No settled bets yet.</div>
            ) : (
              wallet.bets.settled.map(bet => {
                const f = S.fixture(bet.fixtureId)
                const label = selectionLabel(bet.selection, f)
                const won = bet.status === 'won'
                return (
                  <div key={bet.id} className="coin-bet-row">
                    <div className="coin-bet-info">
                      <span className="coin-bet-sel">{label}</span>
                      {f && (
                        <span className="coin-bet-match-name">
                          {S.team(f.t1)?.name || f.t1} v {S.team(f.t2)?.name || f.t2}
                        </span>
                      )}
                    </div>
                    <div className="coin-bet-nums">
                      <span className="coin-bet-stake">{bet.stake} @ {bet.odds}</span>
                      {won && <span className="coin-bet-payout">Won {bet.payout || bet.potentialPayout}</span>}
                    </div>
                    <span className={'pill coin-status-pill ' + (won ? 'coin-won' : 'coin-lost')}>
                      {won ? 'Won' : 'Lost'}
                    </span>
                  </div>
                )
              })
            )}
          </div>

        </div>
      </div>

      {/* Bet sheet */}
      {betSheet && (
        <BetSheet
          f={betSheet.f}
          selection={betSheet.selection}
          odds={betSheet.odds}
          onClose={() => setBetSheet(null)}
        />
      )}
    </div>
  )
}
