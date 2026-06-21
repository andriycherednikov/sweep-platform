/* ============================================================
   THE SWEEP — Bet detail overlay: all markets for a fixture
   ============================================================ */
import { useState, useRef } from 'react'
import { SWEEP as S } from './data.js'
import { Flag, AppHeader, useIsDesktop, useScrolled } from './components.jsx'
import { WalletHeader, MyBets, WagersInfoSheet, BetslipSheet, BetslipPill } from './screens-coins.jsx'
import { useBetslip, toggleLeg, hasLeg, betslipCount } from './betslip.js'
import { StatementList } from './screens-statement.jsx'
import { useCoins, myWallet } from './coins.js'

// Ordering: all full-match markets, then 1st-half markets, then novelty markets.
const MARKET_ORDER = ['1x2', 'dc', 'ou25', 'btts', 'oe', 'cards', 'fh1x2', 'fhou', 'cs', 'gs']
// correct score collapses behind a "show more" toggle (goalscorer has its own grouped path)
const LONG_MARKETS = { cs: 12 }
const GS_PER_TEAM = 6 // goalscorer players shown per team before "show more"

// team-aware label for 1x2/fh1x2 Home/Away; passthrough otherwise
function selLabel(mkKey, sel, f) {
  if (mkKey === '1x2' || mkKey === 'fh1x2') {
    if (sel.key === 'HOME') return S.team(f.t1)?.name || 'Home'
    if (sel.key === 'AWAY') return S.team(f.t2)?.name || 'Away'
    if (sel.key === 'DRAW') return 'Draw'
  }
  return sel.label
}

// Tokenise a player name for squad matching. The odds feed and the squad feed format
// names differently (accents, hyphens, "Al-" vs "Al ", common-name vs full-name), so we
// match on overlapping NAME WORDS rather than the exact string. Drop short connectors.
const NAME_STOP = new Set(['al', 'el', 'de', 'da', 'do', 'di', 'la', 'le', 'bin', 'ibn', 'van', 'der', 'den', 'dos', 'das'])
const nameToks = (s) => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
  .filter((t) => t.length >= 3 && !NAME_STOP.has(t))
// split goalscorer selections into [{code,name,sels}] grouped by team (then "Other"):
// assign each odds player to whichever team's squad shares more name words.
function scorerGroups(gs, f) {
  const sels = [...(gs?.selections || [])].sort((a, b) => a.odds - b.odds)
  const toksFor = (code) => {
    const set = new Set()
    for (const p of (S.team(code)?.squad || [])) for (const t of nameToks(p.name)) set.add(t)
    return set
  }
  const t1 = toksFor(f.t1), t2 = toksFor(f.t2)
  const score = (toks, set) => toks.reduce((n, t) => n + (set.has(t) ? 1 : 0), 0)
  const g1 = [], g2 = [], other = []
  for (const s of sels) {
    const toks = nameToks(s.key)
    const a = score(toks, t1), b = score(toks, t2)
    if (a === 0 && b === 0) other.push(s)
    else if (a >= b) g1.push(s); else g2.push(s)
  }
  return [
    { code: f.t1, name: S.team(f.t1)?.name || f.t1, sels: g1 },
    { code: f.t2, name: S.team(f.t2)?.name || f.t2, sels: g2 },
    { code: null, name: 'Other', sels: other },
  ].filter((grp) => grp.sels.length)
}

export function BetDetail({ fixtureId, onBack, openMatch }) {
  const f = S.fixture(fixtureId)
  const [slipOpen, setSlipOpen] = useState(false)
  const [openMkts, setOpenMkts] = useState(() => new Set())
  const [tab, setTab] = useState('place')
  const [info, setInfo] = useState(false)
  const desktop = useIsDesktop()
  const scrollRef = useRef(null)
  const { scrolled, onScroll } = useScrolled(scrollRef)
  useCoins() // re-render My bets on store changes
  useBetslip() // re-render on slip changes (pill count + selected-state highlight)
  const helpBtn = (
    <button className="hdr-help" onClick={() => setInfo(true)} aria-label="About wagers" title="About wagers">?</button>
  )

  if (!f) return <div data-testid="bet-detail" className="coins-page" style={{ display: 'flex', flexDirection: 'column', height: '100%' }} />

  const markets = f.markets || {}
  const keys = MARKET_ORDER.filter((k) => markets[k])

  return (
    <div data-testid="bet-detail" className="coins-page" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {desktop
        ? <WalletHeader onBack={onBack} onInfo={() => setInfo(true)} scrolled={scrolled} />
        : <AppHeader title="Wagers" coins={myWallet().balance} onBack={onBack} scrolled={scrolled} right={helpBtn} />}

      {/* Place a bet / My bets / Statement toggle (kept on the game screen too) */}
      <div className="wrap" style={{ paddingTop: 12, paddingBottom: 0 }}>
        <div className="statseg" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <button className={'statseg-opt' + (tab === 'place' ? ' on' : '')} onClick={() => setTab('place')}>Place a bet</button>
          <button className={'statseg-opt' + (tab === 'bets' ? ' on' : '')} onClick={() => setTab('bets')}>My bets</button>
          <button className={'statseg-opt' + (tab === 'statement' ? ' on' : '')} onClick={() => setTab('statement')}>Statement</button>
        </div>
      </div>

      {tab === 'bets' ? (
        <div className="scroll pad screen-anim" ref={scrollRef} onScroll={onScroll}>
          <div className="wrap" style={{ marginTop: 14 }}>
            <div className="block" style={{ padding: '14px 14px' }}>
              <MyBets bets={myWallet().bets} parlays={myWallet().parlays} onMatch={(fid) => { const fx = S.fixture(fid); if (fx && openMatch) openMatch(fx) }} />
            </div>
          </div>
        </div>
      ) : tab === 'statement' ? (
        <div className="scroll pad screen-anim" ref={scrollRef} onScroll={onScroll}>
          <div className="wrap" style={{ marginTop: 14 }}>
            <StatementList />
          </div>
        </div>
      ) : (
      <div className="scroll pad screen-anim" ref={scrollRef} onScroll={onScroll}>
        <div className="wrap" style={{ marginTop: 0 }}>
          <div className="coin-match-title">
            <div className="coin-mt-row">
              <span className="coin-mt-team"><Flag code={f.t1} w={24} h={17} />{S.team(f.t1)?.name || f.t1}</span>
              <span className="coin-mt-vs">v</span>
              <span className="coin-mt-team">{S.team(f.t2)?.name || f.t2}<Flag code={f.t2} w={24} h={17} /></span>
            </div>
            <span className="coin-mt-ko">{f.dateTimeLabel}</span>
          </div>
          <div className="coin-mkt-list">
          {keys.map((k) => {
            const mk = markets[k]
            const teamFlag = (k === '1x2' || k === 'fh1x2')
            const toggle = () => setOpenMkts((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
            // one selection button (also reused by the grouped goalscorer path)
            const selBtn = (s) => {
              const fc = teamFlag ? (s.key === 'HOME' ? f.t1 : s.key === 'AWAY' ? f.t2 : null) : null
              return (
                <button
                  key={s.key}
                  className={'coin-mkt-sel' + (hasLeg(f.id, k, s.key) ? ' on' : '')}
                  data-testid="mkt-sel"
                  onClick={() => {
                    const before = betslipCount()
                    toggleLeg({ fixtureId: f.id, market: k, selection: s.key, odds: s.odds, line: mk.line ?? null, book: mk.book ?? null, label: selLabel(k, s, f) })
                    if (before === 0 && betslipCount() === 1) setSlipOpen(true) // open only on the first selection
                  }}
                >
                  {fc && <img className="coin-sel-bg" src={S.flag(fc, 160)} alt="" />}
                  <span className="coin-mkt-lbl"><span className="nm">{selLabel(k, s, f)}</span></span>
                  <span className="coin-mkt-odds">{s.odds}</span>
                </button>
              )
            }

            // Goalscorer: grouped by team (then "Other"), each a full-width player list.
            if (k === 'gs') {
              const groups = scorerGroups(mk, f)
              const open = openMkts.has('gs')
              return (
                <div className="block coin-mkt gs" key="gs">
                  <div className="coin-mkt-head"><span className="blocktitle">{mk.label}</span></div>
                  {groups.map((grp) => (
                    <div className="coin-gs-group" key={grp.code || 'other'}>
                      <div className="coin-gs-team">
                        {grp.code && <Flag code={grp.code} w={20} h={14} />}<span>{grp.name}</span>
                      </div>
                      <div className="coin-mkt-grid gs">
                        {(open ? grp.sels : grp.sels.slice(0, GS_PER_TEAM)).map(selBtn)}
                      </div>
                    </div>
                  ))}
                  {groups.some((grp) => grp.sels.length > GS_PER_TEAM) && (
                    <button className="coin-more" onClick={toggle}>{open ? 'Show less' : 'Show more'}</button>
                  )}
                </div>
              )
            }

            const limit = LONG_MARKETS[k]            // correct score: vertical list w/ show-more
            const isLong = limit != null
            const open = openMkts.has(k)
            let sels = mk.selections
            if (isLong) {
              sels = [...sels].sort((a, b) => a.odds - b.odds)
              if (!open) sels = sels.slice(0, limit)
            }
            return (
              <div className={'block coin-mkt' + (isLong ? ' ' + k : '')} key={k}>
                <div className="coin-mkt-head">
                  <span className="blocktitle">{mk.label}</span>
                </div>
                <div
                  className={'coin-mkt-grid' + (isLong ? ' ' + k : '')}
                  style={isLong ? undefined : { gridTemplateColumns: `repeat(${sels.length}, 1fr)` }}
                >
                  {sels.map(selBtn)}
                </div>
                {isLong && mk.selections.length > limit && (
                  <button className="coin-more" onClick={toggle}>{open ? 'Show less' : 'Show more'}</button>
                )}
              </div>
            )
          })}
          </div>
        </div>
      </div>
      )}

      {!slipOpen && <BetslipPill onOpen={() => setSlipOpen(true)} />}
      {slipOpen && <BetslipSheet onClose={() => setSlipOpen(false)} />}
      {info && <WagersInfoSheet onClose={() => setInfo(false)} />}
    </div>
  )
}
