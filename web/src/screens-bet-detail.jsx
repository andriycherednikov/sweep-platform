/* ============================================================
   THE SWEEP — Bet detail overlay: all markets for a fixture
   ============================================================ */
import { useState } from 'react'
import { SWEEP as S } from './data.js'
import { Flag } from './components.jsx'
import { BetSheet, WalletHeader, MyBets } from './screens-coins.jsx'
import { useCoins, myWallet } from './coins.js'

const MARKET_ORDER = ['1x2', 'fh1x2', 'ou25', 'cards', 'cs']
const CS_VISIBLE = 12

// team-aware label for 1x2/fh1x2 Home/Away; passthrough otherwise
function selLabel(mkKey, sel, f) {
  if (mkKey === '1x2' || mkKey === 'fh1x2') {
    if (sel.key === 'HOME') return S.team(f.t1)?.name || 'Home'
    if (sel.key === 'AWAY') return S.team(f.t2)?.name || 'Away'
    if (sel.key === 'DRAW') return 'Draw'
  }
  return sel.label
}

export function BetDetail({ fixtureId, onBack }) {
  const f = S.fixture(fixtureId)
  const [sheet, setSheet] = useState(null) // { market, selection, odds } | null
  const [csOpen, setCsOpen] = useState(false)
  const [tab, setTab] = useState('place')
  useCoins() // re-render My bets on store changes

  if (!f) return <div data-testid="bet-detail" className="coins-page" style={{ display: 'flex', flexDirection: 'column', height: '100%' }} />

  const markets = f.markets || {}
  const keys = MARKET_ORDER.filter((k) => markets[k])

  return (
    <div data-testid="bet-detail" className="coins-page" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <WalletHeader onBack={onBack} />

      {/* Place a bet / My bets toggle (kept on the game screen too) */}
      <div className="wrap" style={{ paddingTop: 12, paddingBottom: 0 }}>
        <div className="statseg" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <button className={'statseg-opt' + (tab === 'place' ? ' on' : '')} onClick={() => setTab('place')}>Place a bet</button>
          <button className={'statseg-opt' + (tab === 'bets' ? ' on' : '')} onClick={() => setTab('bets')}>My bets</button>
        </div>
      </div>

      {tab === 'bets' ? (
        <div className="scroll pad screen-anim">
          <div className="wrap" style={{ marginTop: 14 }}>
            <div className="block" style={{ padding: '14px 14px' }}>
              <MyBets bets={myWallet().bets} />
            </div>
          </div>
        </div>
      ) : (
      <div className="scroll pad screen-anim">
        <div className="wrap" style={{ marginTop: 0 }}>
          <div className="coin-match-title">
            <span className="coin-mt-team"><Flag code={f.t1} w={30} h={21} />{S.team(f.t1)?.name || f.t1}</span>
            <span className="coin-mt-vs">v</span>
            <span className="coin-mt-team">{S.team(f.t2)?.name || f.t2}<Flag code={f.t2} w={30} h={21} /></span>
            <span className="coin-mt-ko">{f.dateTimeLabel}</span>
          </div>
          <div className="coin-mkt-list">
          {keys.map((k) => {
            const mk = markets[k]
            let sels = mk.selections
            const isCS = k === 'cs'
            if (isCS) {
              sels = [...sels].sort((a, b) => a.odds - b.odds)
              if (!csOpen) sels = sels.slice(0, CS_VISIBLE)
            }
            const teamFlag = (k === '1x2' || k === 'fh1x2')
            return (
              <div className={'block coin-mkt' + (isCS ? ' cs' : '')} key={k}>
                <div className="coin-mkt-head">
                  <span className="blocktitle">{mk.label}</span>
                </div>
                <div
                  className={'coin-mkt-grid' + (isCS ? ' cs' : '')}
                  style={isCS ? undefined : { gridTemplateColumns: `repeat(${sels.length}, 1fr)` }}
                >
                  {sels.map((s) => {
                    const fc = teamFlag ? (s.key === 'HOME' ? f.t1 : s.key === 'AWAY' ? f.t2 : null) : null
                    return (
                      <button
                        key={s.key}
                        className="coin-mkt-sel"
                        data-testid="mkt-sel"
                        onClick={() => setSheet({ market: k, selection: s.key, odds: s.odds })}
                      >
                        {fc && <img className="coin-sel-bg" src={S.flag(fc, 160)} alt="" />}
                        <span className="coin-mkt-lbl"><span className="nm">{selLabel(k, s, f)}</span></span>
                        <span className="coin-mkt-odds">{s.odds}</span>
                      </button>
                    )
                  })}
                </div>
                {isCS && mk.selections.length > CS_VISIBLE && (
                  <button className="coin-more" onClick={() => setCsOpen((v) => !v)}>
                    {csOpen ? 'Show less' : 'Show more'}
                  </button>
                )}
              </div>
            )
          })}
          </div>
        </div>
      </div>
      )}

      {sheet && (
        <BetSheet
          f={f}
          market={sheet.market}
          selection={sheet.selection}
          odds={sheet.odds}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  )
}
