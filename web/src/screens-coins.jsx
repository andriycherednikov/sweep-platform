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

const MARKET_LABELS = {
  '1x2': 'Match Winner',
  fh1x2: 'First Half',
  ou25: 'Over/Under 2.5',
  cards: 'Cards O/U',
  cs: 'Correct Score',
}

function betSelectionLabel(b) {
  const f = S.fixture(b.fixtureId)
  if ((b.market === '1x2' || b.market === 'fh1x2') && f) {
    if (b.selection === 'HOME') return S.team(f.t1)?.name || 'Home'
    if (b.selection === 'AWAY') return S.team(f.t2)?.name || 'Away'
    if (b.selection === 'DRAW') return 'Draw'
  }
  if (b.market === 'ou25' || b.market === 'cards')
    return b.selection === 'OVER' ? `Over ${b.line ?? ''}`.trim() : `Under ${b.line ?? ''}`.trim()
  if (b.market === 'cs') return String(b.selection).replace(':', '-')
  return b.selection
}

function MyBets({ bets }) {
  const [filter, setFilter] = useState('all')
  const { open, settled } = bets

  const list = filter === 'open' ? open : filter === 'settled' ? settled : [...open, ...settled]

  const emptyMsg =
    filter === 'open' ? 'No open bets.' :
    filter === 'settled' ? 'No settled bets.' :
    'No bets yet.'

  return (
    <div>
      {/* Filter row */}
      <div className="statseg" style={{ gridTemplateColumns: '1fr 1fr 1fr', marginBottom: 14 }}>
        {['all', 'open', 'settled'].map(f => (
          <button
            key={f}
            className={'statseg-opt' + (filter === f ? ' on' : '')}
            onClick={() => setFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div style={{ color: 'var(--muted2)', fontSize: 13, padding: '10px 2px' }}>{emptyMsg}</div>
      ) : (
        list.map(b => {
          const f = S.fixture(b.fixtureId)
          const matchName = f
            ? `${S.team(f.t1)?.name || f.t1} v ${S.team(f.t2)?.name || f.t2}`
            : b.fixtureId
          const selLabel = betSelectionLabel(b)
          const mktLabel = MARKET_LABELS[b.market] || b.market
          const isWon = b.status === 'won'
          const isLost = b.status === 'lost'
          const pillClass = isWon ? 'coin-won' : isLost ? 'coin-lost' : ''
          return (
            <div key={b.id} className="coin-bet-row">
              <div className="coin-bet-info">
                <div className="coin-bet-match-name">{matchName}</div>
                <div className="coin-bet-sel">{mktLabel} — {selLabel}</div>
                <div className="coin-bet-stake">{b.stake} coins @ {b.odds}</div>
              </div>
              <div className="coin-bet-nums">
                <span className={`pill coin-status-pill ${pillClass}`}>{b.status}</span>
                {(b.status === 'open' || isWon) && (
                  <span className="coin-bet-payout">To win {b.potentialPayout}</span>
                )}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

/* ---- Shared wallet header (coins balance + optional back button) ---- */
export function WalletHeader({ onBack }) {
  useCoins() // re-render on balance changes
  const me = getMe()
  const wallet = myWallet()
  return (
    <div className="coin-wallet-header">
      <div className="coin-wallet-inner">
        {onBack && (
          <button className="coin-back" onClick={onBack} aria-label="Back"><Icon.back /></button>
        )}
        {me ? (
          <div className="coin-balance-row">
            <Icon.coin className="coin-icon" />
            <span className="coin-balance">{wallet.balance}</span>
            <span className="coin-label">coins</span>
          </div>
        ) : (
          <div className="coin-no-id">
            <p>Pick who you are to track your coins and place bets.</p>
            <button className="cta" style={{ marginTop: 8 }} onClick={() => { if (window.__sweepPickMe) window.__sweepPickMe() }}>
              Choose your profile
            </button>
          </div>
        )}
      </div>
      {me && <div className="coin-grant-note">{`+${wallet.weeklyGrant.toLocaleString()} coins every week`}</div>}
    </div>
  )
}

/* ---- Bet sheet (bottom-sheet overlay) ---- */
export function BetSheet({ f, market, selection, odds, onClose }) {
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
    <div className="screen screen-anim coins-page" data-testid="coins-screen" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      <WalletHeader />

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
                      <div className="coin-bet-grid">
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
                            <div className="coin-odds-row">
                              {mkt.selections.map(sel => {
                                let label, flagCode = null
                                if (sel.key === 'HOME') { label = t1?.name || f.t1; flagCode = f.t1 }
                                else if (sel.key === 'AWAY') { label = t2?.name || f.t2; flagCode = f.t2 }
                                else label = 'Draw'
                                return (
                                  <button
                                    key={sel.key}
                                    className="coin-odds-btn"
                                    aria-label={`${sel.key.toLowerCase()} odds ${sel.odds}`}
                                    onClick={(e) => openInlineBet(e, f, '1x2', sel.key, sel.odds)}
                                  >
                                    {flagCode && <img className="coin-sel-bg" src={S.flag(flagCode, 160)} alt="" />}
                                    <span className="coin-odds-side"><span className="nm">{label}</span></span>
                                    <span className="coin-odds-val">{sel.odds}</span>
                                  </button>
                                )
                              })}
                            </div>
                            <div className="coin-row-foot">
                              {(() => { const n = Object.keys(f.markets).length - 1; return n > 0 ? `+${n} more market${n > 1 ? 's' : ''}` : 'More bets' })()}
                              <Icon.chev />
                            </div>
                          </div>
                        )
                      })}
                      </div>
                    </div>
                  )
                })
              )}
            </>
          )}

          {/* My bets tab */}
          {tab === 'bets' && (
            <div className="block" style={{ padding: '14px 14px' }}>
              <MyBets bets={wallet.bets} />
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
