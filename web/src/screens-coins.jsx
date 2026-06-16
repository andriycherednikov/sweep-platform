/* ============================================================
   THE SWEEP — Coins screen: wallet, bettable matches, bet history
   ============================================================ */
import { useState } from 'react'
import { SWEEP as S } from './data.js'
import { getMe } from './social.js'
import { useCoins, myWallet, placeBet } from './coins.js'
import { Icon, Flag } from './components.jsx'

/* ---- helpers ---- */
function selectionLabel(selection, f) {
  if (!f) return selection
  if (selection === 'DRAW') return 'Draw'
  if (selection === 'HOME') return S.team(f.t1)?.name || f.t1
  if (selection === 'AWAY') return S.team(f.t2)?.name || f.t2
  return selection
}

/* ---- Bet sheet (bottom-sheet overlay) ---- */
function BetSheet({ f, market, selection, odds, onClose }) {
  const [stake, setStake] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const { wallet } = useCoins()
  const balance = wallet.balance
  const stakeNum = parseInt(stake, 10)
  const valid = stakeNum >= 1 && stakeNum <= balance
  const payout = (stakeNum >= 1 && odds) ? Math.round(stakeNum * odds) : 0

  async function submit() {
    if (!valid || submitting) return
    setSubmitting(true)
    try { await placeBet(f.id, market, selection, stakeNum); onClose() }
    finally { setSubmitting(false) }
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
              step="1"
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
            style={{ marginTop: 18, opacity: (valid && !submitting) ? 1 : 0.5 }}
            onClick={submit}
            disabled={!valid || submitting}
          >
            <Icon.coin /> {submitting ? 'Placing…' : 'Place bet'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---- Main screen ---- */
export function CoinsScreen({ go, openBet }) {
  useCoins() // re-render on store changes
  const me = getMe()
  const wallet = myWallet()

  const [tab, setTab] = useState('place')
  const [betSheet, setBetSheet] = useState(null) // { f, market, selection, odds } | null

  // Upcoming bettable matches, group stage with 1x2 market. Fixtures arrive chronological.
  const bettable = S.fixtures
    .filter(f => f.status === 'upcoming' && f.markets?.['1x2'] && f.stage === 'group')

  // Group by dayKey (same pattern as ScheduleScreen in screens-main.jsx)
  const days = []
  const byDay = {}
  bettable.forEach(f => {
    if (!byDay[f.dayKey]) { byDay[f.dayKey] = []; days.push(f.dayKey) }
    byDay[f.dayKey].push(f)
  })

  function openInlineBet(e, f, market, selKey, odds) {
    e.stopPropagation()
    if (!me) { if (window.__sweepPickMe) window.__sweepPickMe(); return }
    setBetSheet({ f, market, selection: selKey, odds })
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

      {/* Tab toggle */}
      <div className="wrap" style={{ paddingTop: 12, paddingBottom: 0 }}>
        <div className="statseg" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <button
            className={'statseg-opt' + (tab === 'place' ? ' on' : '')}
            onClick={() => setTab('place')}
          >Place a bet</button>
          <button
            className={'statseg-opt' + (tab === 'bets' ? ' on' : '')}
            onClick={() => setTab('bets')}
          >My bets</button>
        </div>
      </div>

      <div className="scroll pad screen-anim">
        <div className="wrap" style={{ marginTop: 14 }}>

          {/* Place a bet tab */}
          {tab === 'place' && (
            <>
              {days.length === 0 ? (
                <div className="block" style={{ padding: '16px 14px', color: 'var(--muted)', fontSize: 13 }}>
                  No bettable matches right now.
                </div>
              ) : (
                days.map(dk => {
                  const fs = byDay[dk]
                  const d = fs[0]
                  const isToday = dk === S.todayKey
                  return (
                    <div key={dk}>
                      <div className={'daydiv' + (isToday ? ' today' : '')}>
                        <span className="d">{isToday ? 'Today' : d.dayLabel}</span>
                        <span className="ln"></span>
                        <span className="ct">{fs.length} {fs.length > 1 ? 'matches' : 'match'}</span>
                      </div>
                      {fs.map(f => {
                        const t1 = S.team(f.t1)
                        const t2 = S.team(f.t2)
                        const mkt = f.markets['1x2']
                        return (
                          <div
                            key={f.id}
                            className="block coin-match-row"
                            data-testid={`bet-row-${f.id}`}
                            onClick={() => openBet(f.id)}
                            style={{ cursor: 'pointer' }}
                          >
                            <div className="coin-match-teams">
                              <div className="coin-team">
                                <Flag code={f.t1} w={24} h={16} />
                                <span className="coin-team-name">{t1?.name || f.t1}</span>
                              </div>
                              <span className="coin-vs">v</span>
                              <div className="coin-team coin-team-r">
                                <span className="coin-team-name">{t2?.name || f.t2}</span>
                                <Flag code={f.t2} w={24} h={16} />
                              </div>
                            </div>
                            {mkt.book && (
                              <div className="coin-book">{mkt.book}</div>
                            )}
                            <div className="coin-odds-row">
                              {mkt.selections.map(sel => {
                                let label
                                if (sel.key === 'HOME') label = t1?.name || f.t1
                                else if (sel.key === 'AWAY') label = t2?.name || f.t2
                                else label = 'Draw'
                                return (
                                  <button
                                    key={sel.key}
                                    className="coin-odds-btn"
                                    aria-label={`${sel.key.toLowerCase()} odds ${sel.odds}`}
                                    onClick={(e) => openInlineBet(e, f, '1x2', sel.key, sel.odds)}
                                  >
                                    <span className="coin-odds-side">{label}</span>
                                    <span className="coin-odds-val">{sel.odds}</span>
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })
              )}
            </>
          )}

          {/* My bets tab */}
          {tab === 'bets' && (
            <div className="block" style={{ padding: '16px 14px' }}>
              <div style={{ fontFamily: "'Barlow Semi Condensed'", fontWeight: 700, fontSize: 15, marginBottom: 10 }}>Your bets</div>
              <div style={{ display: 'flex', gap: 16 }}>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                  <span style={{ fontWeight: 700, color: 'var(--fg)', fontSize: 18 }}>{wallet.bets.open.length}</span>
                  {' '}open
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                  <span style={{ fontWeight: 700, color: 'var(--fg)', fontSize: 18 }}>{wallet.bets.settled.length}</span>
                  {' '}settled
                </div>
              </div>
              {wallet.bets.open.length === 0 && wallet.bets.settled.length === 0 && (
                <div style={{ marginTop: 12, color: 'var(--muted2)', fontSize: 13 }}>No bets placed yet.</div>
              )}
            </div>
          )}

        </div>
      </div>

      {/* Bet sheet */}
      {betSheet && (
        <BetSheet
          f={betSheet.f}
          market={betSheet.market}
          selection={betSheet.selection}
          odds={betSheet.odds}
          onClose={() => setBetSheet(null)}
        />
      )}
    </div>
  )
}
