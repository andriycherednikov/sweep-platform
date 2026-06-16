/* ============================================================
   THE SWEEP — Bet detail overlay: all markets for a fixture
   ============================================================ */
import { useState } from 'react'
import { SWEEP as S } from './data.js'
import { Icon, Flag } from './components.jsx'
import { BetSheet } from './screens-coins.jsx'

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

  if (!f) return <div data-testid="bet-detail" style={{ display: 'flex', flexDirection: 'column', height: '100%' }} />

  const markets = f.markets || {}
  const keys = MARKET_ORDER.filter((k) => markets[k])

  return (
    <div data-testid="bet-detail" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="scroll pad screen-anim">
        <div className="wrap" style={{ marginTop: 14 }}>
          <div className="coin-bd-banner">
            <button className="coin-bd-back" onClick={onBack} aria-label="Back"><Icon.back /></button>
            <div className="coin-bd-head">
              <span className="coin-bd-team"><Flag code={f.t1} w={34} h={24} />{S.team(f.t1)?.name || f.t1}</span>
              <span className="coin-bd-vs">v</span>
              <span className="coin-bd-team">{S.team(f.t2)?.name || f.t2}<Flag code={f.t2} w={34} h={24} /></span>
            </div>
            <div className="coin-bd-ko">{f.dateTimeLabel}</div>
          </div>
          {keys.map((k) => {
            const mk = markets[k]
            let sels = mk.selections
            const isCS = k === 'cs'
            if (isCS) {
              sels = [...sels].sort((a, b) => a.odds - b.odds)
              if (!csOpen) sels = sels.slice(0, CS_VISIBLE)
            }
            return (
              <div className="block coin-mkt" key={k} style={{ marginBottom: 12 }}>
                <div className="coin-mkt-head">
                  <span className="blocktitle">{mk.label}</span>
                  {mk.book && <span className="coin-book">{mk.book}</span>}
                </div>
                <div
                  className={'coin-mkt-grid' + (isCS ? ' cs' : '')}
                  style={isCS ? undefined : { gridTemplateColumns: `repeat(${sels.length}, 1fr)` }}
                >
                  {sels.map((s) => (
                    <button
                      key={s.key}
                      className="coin-mkt-sel"
                      data-testid="mkt-sel"
                      onClick={() => setSheet({ market: k, selection: s.key, odds: s.odds })}
                    >
                      <span className="coin-mkt-lbl">{selLabel(k, s, f)}</span>
                      <span className="coin-mkt-odds">{s.odds}</span>
                    </button>
                  ))}
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
