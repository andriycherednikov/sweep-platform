/* ============================================================
   THE SWEEP — Coins screen: wallet, bettable matches, bet history
   ============================================================ */
import { useState, useRef, useEffect } from 'react'
import { SWEEP as S } from './data.js'
import { getMe } from './social.js'
import { useCoins, myWallet, placeBet, placeParlay } from './coins.js'
import { useBetslip, toggleLeg, hasLeg, removeLeg, clearBetslip, combinedOdds, betslipCount } from './betslip.js'
import { Icon, Flag, useScrolled, useIsDesktop, AppHeader, OptOutButton } from './components.jsx'
import { optOut } from './optout.js'
import { MARKET_LABELS, betSelectionLabel } from './lib/betLabels.js'
import { StatementList } from './screens-statement.jsx'

/* ---- helpers ---- */
function selectionLabel(selection, f) {
  if (!f) return selection
  if (selection === 'DRAW') return 'Draw'
  if (selection === 'HOME') return S.team(f.t1)?.name || f.t1
  if (selection === 'AWAY') return S.team(f.t2)?.name || f.t2
  return selection
}

// the team flag for a team selection (Match Winner / First Half home/away), else null
function betSelectionFlag(b) {
  const f = S.fixture(b.fixtureId)
  if ((b.market === '1x2' || b.market === 'fh1x2') && f) {
    if (b.selection === 'HOME') return f.t1
    if (b.selection === 'AWAY') return f.t2
  }
  return null
}

/* One single-bet row. Extracted verbatim from MyBets so single bets render
   identically alongside parlay cards. */
function SingleBetRow({ b, onMatch }) {
  const f = S.fixture(b.fixtureId)
  const selLabel = betSelectionLabel(b)
  const selFlag = betSelectionFlag(b)
  const mktLabel = MARKET_LABELS[b.market] || b.market
  const isWon = b.status === 'won'
  const isLost = b.status === 'lost'
  const pillClass = isWon ? 'coin-won' : isLost ? 'coin-lost' : ''
  const placed = b.placedAt ? new Date(b.placedAt) : null
  const placedDate = placed ? placed.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) : ''
  const placedTime = placed ? placed.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''
  return (
    <div className="coin-betslip" onClick={() => f && onMatch && onMatch(b.fixtureId)}>
      <div className="coin-bs-placed">
        <span className="coin-bs-pd-date">{placedDate}</span>
        <span className="coin-bs-pd-time">{placedTime}</span>
      </div>
      <div className="coin-bs-content">
        {f && (
          <div className="coin-bs-event">
            <img className="flag" src={S.flag(f.t1, 40)} alt="" />
            {S.team(f.t1)?.name || f.t1} v {S.team(f.t2)?.name || f.t2}
            <img className="flag" src={S.flag(f.t2, 40)} alt="" />
          </div>
        )}
        <div className="coin-bs-body">
          <div className="coin-bs-main">
            <span className="coin-bs-mkt">{mktLabel}</span>
            <div className="coin-bs-sel">
              {selFlag && <img className="flag" src={S.flag(selFlag, 40)} alt="" />}
              <span className="coin-bs-pick">{selLabel}</span>
            </div>
            {f && f.status === 'live' && (
              <div className="coin-bs-when live"><span className="coin-live-dot" />Live · {f.minute ?? 0}'</div>
            )}
            {f && f.status === 'upcoming' && (
              <div className="coin-bs-when">{f.dateTimeLabel}</div>
            )}
          </div>
          <div className="coin-bs-side">
            {(isWon || isLost) && <span className={`pill coin-status-pill ${pillClass}`}>{b.status}</span>}
            {/* won keeps the stake/odds AND "Won 732", but on one row so the card
                stays 2 lines tall — no third line, no empty bottom space. */}
            {isWon ? (
              <span className="coin-bs-resultline">
                <span className="coin-bs-stake"><Icon.coin />{b.stake} @ {b.odds}</span>
                <span className="coin-bs-payout won">Won <b>{b.potentialPayout}</b></span>
              </span>
            ) : (
              <span className="coin-bs-stake"><Icon.coin />{b.stake} @ {b.odds}</span>
            )}
            {b.status === 'open' && (
              <span className="coin-bs-payout">To win <b>{b.potentialPayout}</b></span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* One parlay (multi) card — placed-date column + a header (leg count, combined odds),
   each leg's flag/pick/market/odds (with won/lost styling), and the stake/payout footer.
   Mirrors the single-bet card's layout vocabulary so the two read as one list. */
function ParlayCard({ p }) {
  const isWon = p.status === 'won'
  const isLost = p.status === 'lost'
  const isRefunded = p.status === 'refunded'
  const pillClass = isWon ? 'coin-won' : isLost ? 'coin-lost' : ''
  const odds = Number(p.combinedOdds).toFixed(2)
  const placed = p.placedAt ? new Date(p.placedAt) : null
  const placedDate = placed ? placed.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) : ''
  const placedTime = placed ? placed.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''
  return (
    <div className="coin-betslip coin-parlay">
      <div className="coin-bs-placed">
        <span className="coin-bs-pd-date">{placedDate}</span>
        <span className="coin-bs-pd-time">{placedTime}</span>
      </div>
      <div className="coin-bs-content">
        <div className="coin-parlay-head">
          <span className="coin-parlay-tag"><span className="coin-parlay-ico"><Icon.tickets /></span>Multi · {p.legs.length} legs</span>
        </div>
        <div className="coin-parlay-legs">
          {p.legs.map((l) => {
            const lw = l.status === 'won', ll = l.status === 'lost'
            const lf = S.fixture(l.fixtureId)
            const legFlag = betSelectionFlag(l)
            return (
              <div key={l.id} className={'coin-parlay-leg' + (lw ? ' won' : ll ? ' lost' : '')}>
                <div className="coin-parlay-leg-body">
                  {lf && (
                    <div className="coin-bs-event">
                      <img className="flag" src={S.flag(lf.t1, 40)} alt="" />
                      {S.team(lf.t1)?.name || lf.t1} v {S.team(lf.t2)?.name || lf.t2}
                      <img className="flag" src={S.flag(lf.t2, 40)} alt="" />
                    </div>
                  )}
                  <div className="coin-bs-main">
                    <span className="coin-bs-mkt">{MARKET_LABELS[l.market] || l.market}</span>
                    <div className="coin-bs-sel">
                      {legFlag && <img className="flag" src={S.flag(legFlag, 40)} alt="" />}
                      <span className="coin-bs-pick">{betSelectionLabel(l)}</span>
                    </div>
                    {lf && lf.status === 'upcoming' && <div className="coin-bs-when">{lf.dateTimeLabel}</div>}
                    {lf && lf.status === 'live' && <div className="coin-bs-when live"><span className="coin-live-dot" />Live · {lf.minute ?? 0}'</div>}
                  </div>
                </div>
                {(lw || ll) && <span className={`pill coin-status-pill ${lw ? 'coin-won' : 'coin-lost'}`}>{l.status}</span>}
              </div>
            )
          })}
        </div>
        <div className="coin-bs-side coin-parlay-foot">
          {(isWon || isLost || isRefunded) && <span className={`pill coin-status-pill ${pillClass}`}>{p.status}</span>}
          {isWon ? (
            <span className="coin-bs-resultline">
              <span className="coin-bs-stake"><Icon.coin />{p.stake} @ {odds}</span>
              <span className="coin-bs-payout won">Won <b>{p.potentialPayout}</b></span>
            </span>
          ) : (
            <span className="coin-bs-stake"><Icon.coin />{p.stake} @ {odds}</span>
          )}
          {p.status === 'open' && <span className="coin-bs-payout">To win <b>{p.potentialPayout}</b></span>}
        </div>
      </div>
    </div>
  )
}

export function MyBets({ bets, parlays = { open: [], settled: [] }, onMatch }) {
  const [filter, setFilter] = useState('open')
  const tag = (arr, kind) => arr.map((d) => ({ kind, data: d }))
  const open = [...tag(bets.open, 'bet'), ...tag(parlays.open, 'parlay')]
  const settled = [...tag(bets.settled, 'bet'), ...tag(parlays.settled, 'parlay')]
  const picked = filter === 'open' ? open : filter === 'settled' ? settled : [...open, ...settled]
  // newest first (by when the bet/parlay was struck)
  const list = [...picked].sort((a, b) => new Date(b.data.placedAt || 0) - new Date(a.data.placedAt || 0))

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
        list.map((item) => item.kind === 'parlay'
          ? <ParlayCard key={item.data.id} p={item.data} />
          : <SingleBetRow key={item.data.id} b={item.data} onMatch={onMatch} />)
      )}
    </div>
  )
}

/* ---- Shared wallet header (coins balance + optional back button) ---- */
export function WalletHeader({ onBack, go, scrolled, onInfo, onOptOut }) {
  useCoins() // re-render on balance changes
  const me = getMe()
  const wallet = myWallet()
  return (
    <div className={"coin-wallet-header" + (scrolled ? " shrunk" : "")}>
      <div className="coin-wallet-inner">
        {onBack
          ? <button className="coin-back" onClick={onBack} aria-label="Back"><Icon.back /></button>
          : go
          ? <button className="brand brand-btn phead-brand" onClick={() => go("home")} aria-label="Home"><div className="mark"><img src="/trophy.png" alt="The Sweep" /></div></button>
          : <span className="coin-back coin-back-ghost" aria-hidden="true" />}
        {me ? (
          <div className="coin-balance-row">
            <Icon.coin className="coin-icon" />
            <span className="coin-balance">{wallet.balance}</span>
            <span className="coin-label">Yowie Dollars</span>
          </div>
        ) : (
          <div className="coin-no-id">
            <p>Pick who you are to track your Yowie Dollars and place bets.</p>
            <button className="cta" style={{ marginTop: 8 }} onClick={() => { if (window.__sweepPickMe) window.__sweepPickMe() }}>
              Choose your profile
            </button>
          </div>
        )}
        {(onOptOut || onInfo) && (
          <div className="coin-wallet-actions">
            {onOptOut && <OptOutButton onClick={onOptOut} />}
            {onInfo && <button className="hdr-help coin-help" onClick={onInfo} aria-label="About wagers" title="About wagers">?</button>}
          </div>
        )}
      </div>
      {me && <div className="coin-grant-note">{`+${wallet.weeklyGrant.toLocaleString()} Yowie Dollars every week`}</div>}
    </div>
  )
}

/* In-sheet number pad for the stake — used on mobile so we never summon the OS
   keyboard (which on iOS doesn't resize the viewport and leaves the sheet/button
   stranded behind it). Clamps to the balance and strips leading zeros. */
function StakePad({ value, onChange, max }) {
  const press = (k) => {
    if (k === 'del') return onChange(value.slice(0, -1))
    if (k === 'max') return onChange(String(max))
    const next = (value + k).replace(/^0+(?=\d)/, '')
    if (next.length > 9) return
    onChange(parseInt(next || '0', 10) > max ? String(max) : next)
  }
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'max', '0', 'del']
  return (
    <div className="stakepad">
      {keys.map(k => (
        <button key={k} type="button" className={'stakekey' + (k === 'max' || k === 'del' ? ' op' : '')} onClick={() => press(k)} aria-label={k === 'del' ? 'Backspace' : k === 'max' ? 'Max stake' : k}>
          {k === 'del' ? '⌫' : k === 'max' ? 'Max' : k}
        </button>
      ))}
    </div>
  )
}

/* ---- Bet sheet (bottom-sheet overlay) ---- */
export function BetSheet({ f, market, selection, odds, onClose }) {
  const [stake, setStake] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const { wallet } = useCoins()
  const desktop = useIsDesktop()
  const balance = wallet.balance
  const stakeNum = parseInt(stake, 10)
  const valid = stakeNum >= 1 && stakeNum <= balance
  const payout = (stakeNum >= 1 && odds) ? Math.round(stakeNum * odds) : 0
  // quick-add chips — bump the stake by a fixed amount, clamped to the balance
  const addAmt = (amt) => setStake(String(Math.min(balance, (parseInt(stake, 10) || 0) + amt)))
  const QUICK = [100, 200, 500, 1000]

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
              <img className="flag" src={S.flag(f.t1, 40)} alt="" />
              <span>{t1?.name || f.t1}</span>
              <span className="coin-bet-vs">v</span>
              <span>{t2?.name || f.t2}</span>
              <img className="flag" src={S.flag(f.t2, 40)} alt="" />
            </div>
            <div className="coin-bet-selection">
              <span className="coin-sel-label">{label}</span>
              <span className="coin-sel-odds">@ {odds}</span>
            </div>
          </div>

          {/* Quick-add chips — add a fixed amount to the stake in one tap */}
          <div className="stake-chips">
            {QUICK.map(a => (
              <button key={a} type="button" className="stake-chip" onClick={() => addAmt(a)} disabled={(parseInt(stake, 10) || 0) >= balance}>+{a}</button>
            ))}
          </div>

          {/* Stake — editable input on desktop (physical keyboard); a tap-to-set
              display + in-sheet keypad on mobile (no OS keyboard). */}
          <div className="field" style={{ marginTop: 12 }}>
            <label>Stake (Yowie Dollars)</label>
            {desktop ? (
              <input
                type="number"
                min="1"
                step="1"
                max={balance}
                value={stake}
                onChange={e => setStake(e.target.value)}
                placeholder={`1 – ${balance}`}
              />
            ) : (
              <div className={'stake-display' + (stake ? '' : ' empty')} aria-label="Stake">
                {stake || `1 – ${balance}`}
              </div>
            )}
          </div>

          {/* Payout preview */}
          {stakeNum >= 1 && (
            <div className="coin-payout-preview">
              To win: <b>{payout}</b> Yowie Dollars
            </div>
          )}

          {!desktop && <StakePad value={stake} onChange={setStake} max={balance} />}

          <div className="sheet-foot">
            <button
              className="cta"
              style={{ opacity: (valid && !submitting) ? 1 : 0.5 }}
              onClick={submit}
              disabled={!valid || submitting}
            >
              <Icon.coin /> {submitting ? 'Placing…' : 'Place bet'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* Floating pill — leg count + combined odds; opens the betslip sheet. Hidden when empty. */
export function BetslipPill({ onOpen }) {
  const { legs } = useBetslip()
  if (legs.length === 0) return null
  return (
    <button className="betslip-pill" onClick={onOpen}
      aria-label={`Open bet slip, ${legs.length} selection${legs.length > 1 ? 's' : ''}`}>
      <span className="betslip-pill-count">{legs.length}</span>
      <span className="betslip-pill-label">Betslip</span>
    </button>
  )
}

/* Unified accumulating betslip. 1 leg → a single bet; 2+ → a parlay. Reuses StakePad +
   quick-add chips + payout preview. Surfaces a closed-event notice (on open and on a blocked
   submit), an "odds updated" note on drift, and a remove control per leg. */
export function BetslipSheet({ onClose }) {
  const { legs } = useBetslip()
  const [stake, setStake] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const { wallet } = useCoins()
  const desktop = useIsDesktop()
  const balance = wallet.balance
  const stakeNum = parseInt(stake, 10)
  // per-leg live state: bettable iff the fixture is still upcoming and the pick still has odds
  const legState = legs.map((l) => {
    const f = S.fixture(l.fixtureId)
    const live = f?.markets?.[l.market]?.selections?.find((s) => s.key === l.selection)
    return { leg: l, f, bettable: !!f && f.status === 'upcoming' && !!live, liveOdds: live ? live.odds : null }
  })
  const closed = legState.filter((s) => !s.bettable)
  const drifted = legState.some((s) => s.bettable && s.liveOdds != null && s.liveOdds !== s.leg.odds)
  const combined = legState.reduce((acc, s) => acc * (s.liveOdds ?? s.leg.odds), 1)
  const payout = stakeNum >= 1 ? Math.round(stakeNum * combined) : 0
  const valid = stakeNum >= 1 && stakeNum <= balance && legs.length >= 1 && closed.length === 0
  const addAmt = (amt) => setStake(String(Math.min(balance, (parseInt(stake, 10) || 0) + amt)))
  const QUICK = [100, 200, 500, 1000]

  async function submit() {
    if (submitting || closed.length > 0 || !valid) return
    setSubmitting(true)
    try {
      const placing = legState.map((s) => ({ ...s.leg, odds: s.liveOdds ?? s.leg.odds }))
      if (placing.length === 1) {
        await placeBet(placing[0].fixtureId, placing[0].market, placing[0].selection, stakeNum)
        clearBetslip(); onClose()
      } else {
        const res = await placeParlay(placing, stakeNum)
        if (res?.ok) { clearBetslip(); onClose() }
      }
    } finally { setSubmitting(false) }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '92%' }}>
        <div className="grab" />
        <div className="sheet-head">
          <h3>{legs.length > 1 ? `Multi · ${legs.length} legs` : 'Bet slip'}</h3>
          <button className="x" onClick={onClose}><Icon.x /></button>
        </div>
        <div className="sheet-body">
          {closed.length > 0 && (
            <div className="betslip-notice" role="alert">
              {closed.length === 1 ? '1 selection is no longer available' : `${closed.length} selections are no longer available`} — remove it to place.
            </div>
          )}
          {drifted && <div className="betslip-note">Odds updated — your payout has been refreshed.</div>}

          <div className="betslip-legs">
            {legState.map(({ leg, f, bettable }) => (
              <div key={leg.fixtureId + leg.market + leg.selection} className={'betslip-leg' + (bettable ? '' : ' closed')}>
                <div className="betslip-leg-main">
                  <span className="betslip-leg-match">{f ? `${S.team(f.t1)?.name || f.t1} v ${S.team(f.t2)?.name || f.t2}` : leg.fixtureId}</span>
                  <span className="betslip-leg-pick">{leg.label} · {MARKET_LABELS[leg.market] || leg.market}</span>
                  {!bettable && <span className="betslip-leg-closed">Closed</span>}
                </div>
                <span className="betslip-leg-odds">{leg.odds}</span>
                <button className="betslip-leg-x" aria-label={`Remove ${leg.label}`} onClick={() => removeLeg(leg.fixtureId)}><Icon.x /></button>
              </div>
            ))}
          </div>

          <div className="stake-chips">
            {QUICK.map((a) => (
              <button key={a} type="button" className="stake-chip" onClick={() => addAmt(a)} disabled={(parseInt(stake, 10) || 0) >= balance}>+{a}</button>
            ))}
          </div>

          <div className="field" style={{ marginTop: 12 }}>
            <label>Stake (Yowie Dollars)</label>
            {desktop ? (
              <input type="number" min="1" step="1" max={balance} value={stake} onChange={(e) => setStake(e.target.value)} placeholder={`1 – ${balance}`} />
            ) : (
              <div className={'stake-display' + (stake ? '' : ' empty')} aria-label="Stake">{stake || `1 – ${balance}`}</div>
            )}
          </div>

          {stakeNum >= 1 && (
            <div className="coin-payout-preview">To win: <b>{payout}</b> Yowie Dollars <span className="betslip-combined">@ {combined.toFixed(2)}</span></div>
          )}

          {!desktop && <StakePad value={stake} onChange={setStake} max={balance} />}

          <div className="sheet-foot">
            <button className="cta" style={{ opacity: valid && !submitting ? 1 : 0.5 }} onClick={submit} disabled={!valid || submitting}>
              <Icon.coin /> {submitting ? 'Placing…' : legs.length > 1 ? 'Place multi' : 'Place bet'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* Wagers self-exclusion sheet. Two steps — choose a duration, then confirm —
   because the choice is BINDING: once confirmed there's no early opt-back-in and
   the remaining time is never shown. Reachable from the header shield and from the
   "Stepping away" section of the About sheet. */
const OPT_OUT_CHOICES = [
  ['1d', '1 day'],
  ['3d', '3 days'],
  ['7d', '7 days'],
  ['14d', '14 days'],
  ['forever', 'Completely'],
]
export function OptOutSheet({ onClose }) {
  const [chosen, setChosen] = useState(null) // duration key awaiting confirmation
  const label = OPT_OUT_CHOICES.find(([k]) => k === chosen)?.[1]
  const confirmCopy = chosen === 'forever'
    ? "You're stepping away from Wagers for good. It won't turn itself back on."
    : `You're stepping away from Wagers for ${label}. It'll lock now and quietly come back when the time's up — you can't turn it back on early.`
  function confirm() { optOut(chosen); onClose() }
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()} style={{ maxHeight: '92%' }}>
        <div className="grab" />
        <div className="sheet-head">
          <h3>Step away from Wagers</h3>
          <button className="x" onClick={onClose}><Icon.x /></button>
        </div>
        <div className="sheet-body">
          {chosen == null ? (
            <>
              <p className="fyi-lead">
                Taking a break is completely OK — and completely anonymous. You won't miss out on
                any of the fun: the rest of The Sweep carries on exactly the same, only Wagers
                pauses. Choose how long to step away — it'll be hidden until then, with no turning
                it back on early.
              </p>
              <div className="optout-choices">
                {OPT_OUT_CHOICES.map(([k, lbl]) => (
                  <button key={k} className="optout-choice" onClick={() => setChosen(k)}>{lbl}</button>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="fyi-lead">{confirmCopy}</p>
              <div className="optout-confirm-row">
                <button className="btn-ghost" onClick={() => setChosen(null)}>Cancel</button>
                <button className="cta" onClick={confirm}>Confirm</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* Shown automatically the first time someone opens Wagers (once per device),
   and re-openable anytime via the "?" in the header. */
const WAGERS_FYI_KEY = 'sweep.wagers.fyi.v1'
const WAGERS_END = '19 July 2026' // World Cup Final — weekly grants stop, table locks

// Weekly grants roll on a 7-day cycle anchored to the first kickoff, so the
// deposit lands on that same weekday/time. Surface it in Sydney time.
function weeklyDropSydney() {
  const first = S.fixtures.map(f => f.ko).filter(Boolean).sort()[0]
  if (!first) return null
  const d = new Date(first)
  const day = d.toLocaleString('en-AU', { timeZone: 'Australia/Sydney', weekday: 'long' })
  const time = d.toLocaleString('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', minute: '2-digit', hour12: true })
  return `${day} at ${time}`
}

export function WagersInfoSheet({ onClose, onOptOut }) {
  const drop = weeklyDropSydney()
  const faqs = [
    ['Can I buy more Yowie Dollars if I run out?', `No. There’s nothing to buy — no real money is ever involved. Everyone is topped up with +1,000 Yowie Dollars automatically each week${drop ? `, every ${drop} (Sydney time)` : ''}.`],
    ['Can kids play?', 'No. Wagers is for adult accounts only (18+). Minors can’t see or use the feature at all.'],
    ['Do I win anything for finishing on top?', 'Just bragging rights — the glory of the highest Yowie Dollars balance. There are no prizes and no payouts.'],
    ['Is this real gambling?', 'Not at all. Yowie Dollars are play money for a bit of fun between mates. We’re not encouraging gambling.'],
  ]
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()} style={{ maxHeight: '92%' }}>
        <div className="grab" />
        <div className="sheet-head"><h3>About Wagers</h3><button className="x" onClick={onClose}><Icon.x /></button></div>
        <div className="sheet-body">
          <p className="fyi-lead">
            Wagers is a <b>just-for-fun</b>, recreational game — not real betting. It’s a friendly
            competition for <b>bragging rights</b>: push your <b>Yowie Dollars</b> balance as high as
            you can. No real money, no prizes, no gambling.
          </p>
          <div className="fyi-grant">
            <Icon.coin />
            <span>Everyone starts with <b>1,000 Yowie Dollars</b>, and another <b>1,000</b> drops into
            every account automatically {drop ? <>every <b>{drop}</b> (Sydney time)</> : <b>each week</b>} —
            until the World Cup Final on <b>{WAGERS_END}</b>, when the table locks and the bragging begins.</span>
          </div>
          <div className="fyi-grant">
            <Icon.coin />
            <span>You will get <b>100 Yowie Dollars</b> for every match outcome you predict correctly in the
            schedule, and <b>300</b> each time a team you own wins a match.</span>
          </div>
          <p className="fyi-18">🔞 Adults only — minor accounts can’t see or use Wagers.</p>
          <div className="fyi-stepaway">
            <p>
              <b>Stepping away is OK.</b> Everyone's different. If you'd rather not take part — or if
              this feature could be harmful or a trigger for you — you absolutely should step away,
              and we 100% support that. It's completely anonymous.
              You're free, welcome, and encouraged to do it any time it feels right for you.
            </p>
            <button className="btn-ghost fyi-stepaway-btn" onClick={onOptOut} aria-label="Step away from Wagers">
              <Icon.shield style={{ width: 16, height: 16 }} /> Step away from Wagers
            </button>
          </div>
          <div className="fyi-faq">
            {faqs.map(([q, a]) => (
              <div className="fyi-q" key={q}>
                <b>{q}</b>
                <p>{a}</p>
              </div>
            ))}
          </div>
          <button className="cta" style={{ marginTop: 8, width: '100%' }} onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  )
}

/* ---- Main screen ---- */
export function CoinsScreen({ go, openBet, openMatch }) {
  useCoins() // re-render on store changes
  useBetslip() // re-render on slip changes (pill count + selected-state highlight)
  const me = getMe()
  const wallet = myWallet()

  const [tab, setTab] = useState('place')
  const [slipOpen, setSlipOpen] = useState(false)
  const [info, setInfo] = useState(false)
  const [optOutOpen, setOptOutOpen] = useState(false)
  const scrollRef = useRef(null)
  const { scrolled, onScroll } = useScrolled(scrollRef)
  const desktop = useIsDesktop()

  // Auto-open the FYI the very first time this device opens Wagers; never again.
  useEffect(() => {
    try {
      if (!localStorage.getItem(WAGERS_FYI_KEY)) { setInfo(true); localStorage.setItem(WAGERS_FYI_KEY, '1') }
    } catch { /* private mode — just skip the one-time popup */ }
  }, [])
  const helpBtn = (
    <button className="hdr-help" onClick={() => setInfo(true)} aria-label="About wagers" title="About wagers">?</button>
  )

  // Upcoming bettable matches with a 1x2 market — full tournament. Fixtures arrive chronological.
  const bettable = S.fixtures
    .filter(f => f.status === 'upcoming' && f.markets?.['1x2'])

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
    const mk = f.markets?.[market]
    const before = betslipCount()
    toggleLeg({ fixtureId: f.id, market, selection: selKey, odds, line: mk?.line ?? null, book: mk?.book ?? null, label: selectionLabel(selKey, f) })
    // auto-open the slip only when the FIRST selection is added; later adds don't reopen it
    if (before === 0 && betslipCount() === 1) setSlipOpen(true)
  }

  return (
    <div className="screen screen-anim coins-page" data-testid="coins-screen" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {desktop
        ? <WalletHeader onInfo={() => setInfo(true)} onOptOut={() => setOptOutOpen(true)} />
        : <AppHeader title="Wagers" coins={wallet.balance} go={go} scrolled={scrolled} right={helpBtn}
            replaceSpoiler={<OptOutButton onClick={() => setOptOutOpen(true)} />} />}

      {/* Tab toggle */}
      <div className="wrap" style={{ paddingTop: 12, paddingBottom: 0 }}>
        <div className="statseg" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <button
            className={'statseg-opt' + (tab === 'place' ? ' on' : '')}
            onClick={() => setTab('place')}
          >Place a bet</button>
          <button
            className={'statseg-opt' + (tab === 'bets' ? ' on' : '')}
            onClick={() => setTab('bets')}
          >My bets</button>
          <button
            className={'statseg-opt' + (tab === 'statement' ? ' on' : '')}
            onClick={() => setTab('statement')}
          >Statement</button>
        </div>
      </div>

      <div className="scroll pad screen-anim" ref={scrollRef} onScroll={onScroll}>
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
                                    className={'coin-odds-btn' + (hasLeg(f.id, '1x2', sel.key) ? ' on' : '')}
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
              <MyBets bets={wallet.bets} parlays={wallet.parlays} onMatch={(fid) => { const fx = S.fixture(fid); if (fx && openMatch) openMatch(fx) }} />
            </div>
          )}

          {/* Yowie Dollars statement tab */}
          {tab === 'statement' && <StatementList />}

        </div>
      </div>

      {/* Accumulating betslip — floating pill opens the slip sheet */}
      <BetslipPill onOpen={() => setSlipOpen(true)} />
      {slipOpen && <BetslipSheet onClose={() => setSlipOpen(false)} />}
      {info && <WagersInfoSheet onClose={() => setInfo(false)} onOptOut={() => { setInfo(false); setOptOutOpen(true) }} />}
      {optOutOpen && <OptOutSheet onClose={() => setOptOutOpen(false)} />}
    </div>
  )
}
