/* ============================================================
   THE SWEEP — Yowie Dollars statement: a person's coin ledger,
   rendered inline as a tab inside the Wagers screen. Columns:
   date · activity (icon + game / selection) · amount (+/−) · running balance.
   ============================================================ */
import { useQuery } from '@tanstack/react-query'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCoins, faTicket, faUsers } from '@fortawesome/free-solid-svg-icons'
import { SWEEP as S } from './data.js'
import { getMe } from './social.js'
import { fetchLedger } from './api/client.js'
import { betSelectionLabel, MARKET_LABELS } from './lib/betLabels.js'

// Font Awesome glyphs for the non-tick kinds: deposit (grant) = coins, bet placed = ticket.
const KIND_ICON = { dep: faCoins, bet: faTicket, teamwin: faUsers }

/** A stylish rounded checkmark (custom SVG, not Font Awesome). Colour is inherited
 *  (green for a won bet). Sized to 1em so it tracks the icon font-size. */
function Tick() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor"
      strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  )
}

/** Render the right glyph for an entry kind: the stylish tick for won bets, else a FA icon. */
function KindGlyph({ kind }) {
  if (kind === 'win' || kind === 'predict') return <Tick />
  return <FontAwesomeIcon icon={KIND_ICON[kind]} />
}

/** Structured view of one ledger entry: an icon kind, a title line (the game or grant),
 *  and a sub line (the selection). Reuses the bet-slip helpers for selection wording. */
function entryView(e) {
  if (e.type === 'grant') return { kind: 'dep', title: e.weekIndex === 0 ? 'Starting bankroll' : 'Weekly Yowie Dollars', sub: 'Deposit' }
  if (e.type === 'refund') {
    if (e.parlay) return { kind: 'dep', title: `Multi · ${e.parlay.legs.length} legs`, sub: 'Refund' }
    return { kind: 'dep', title: 'Refund', sub: '' }
  }
  if (e.type === 'predict' || e.type === 'teamwin') {
    const f = S.fixture(e.fixtureId)
    const match = f ? `${S.team(f.t1)?.name || f.t1} v ${S.team(f.t2)?.name || f.t2}` : null
    const sub = e.type === 'predict' ? 'Correct prediction' : 'Your team won'
    return { kind: e.type, title: match || sub, sub: match ? sub : '' }
  }
  const won = e.type === 'payout'
  const kind = won ? 'win' : 'bet'
  if (e.parlay) return { kind, title: `Multi · ${e.parlay.legs.length} legs`, sub: won ? 'Multi won' : 'Multi placed' }
  const b = e.bet
  if (!b) return { kind, title: won ? 'Bet won' : 'Bet placed', sub: '' }
  const f = S.fixture(b.fixtureId)
  const match = f ? `${S.team(f.t1)?.name || f.t1} v ${S.team(f.t2)?.name || f.t2}` : b.fixtureId
  const mkt = MARKET_LABELS[b.market] || b.market
  return { kind, title: match, sub: `${betSelectionLabel(b)} · ${mkt}` }
}

function dateParts(iso) {
  const d = iso ? new Date(iso) : null
  if (!d) return { date: '', time: '' }
  return {
    date: d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }),
    time: d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
  }
}

const fmtAmount = (n) => `${n > 0 ? '+' : n < 0 ? '-' : ''}${Math.abs(n).toLocaleString()}`

const noteStyle = { padding: '16px 14px', color: 'var(--muted)', fontSize: 13 }

/** The statement list — fetches the signed-in person's ledger and renders it as a table.
 *  Rendered inside the Wagers screen's scroll/wrap, so it owns no header or scroll chrome. */
export function StatementList() {
  const me = getMe()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['coins', 'ledger', me?.id],
    queryFn: () => fetchLedger(me.id),
    enabled: !!me,
  })
  const entries = data?.entries ?? []

  if (isError) return <div className="block" style={noteStyle}>Couldn’t load your statement — try again.</div>
  if (isLoading) return <div className="block" style={noteStyle}>Loading…</div>
  if (entries.length === 0) return <div className="block" style={noteStyle}>No activity yet.</div>

  return (
    <div className="block stmt-list">
      <div className="stmt-row stmt-row-head">
        <span className="stmt-col-h">Date</span>
        <span className="stmt-col-h">Activity</span>
        <span className="stmt-col-h stmt-col-r">Amount</span>
        <span className="stmt-col-h stmt-col-r">Balance</span>
      </div>
      {entries.map((e) => {
        const { date, time } = dateParts(e.createdAt)
        const v = entryView(e)
        const credit = e.amount > 0
        return (
          <div key={e.id} className="stmt-row">
            <div className="stmt-when">
              <span className="stmt-when-date">{date}</span>
              <span className="stmt-when-time">{time}</span>
            </div>
            <div className="stmt-act">
              <span className={'stmt-ic ' + v.kind}><KindGlyph kind={v.kind} /></span>
              <span className="stmt-txt">
                <span className="stmt-title">{v.title}</span>
                {v.sub && <span className="stmt-sub">{v.sub}</span>}
              </span>
            </div>
            <span className={'stmt-amt ' + (credit ? 'up' : 'down')}>{fmtAmount(e.amount)}</span>
            <span className="stmt-bal-col">{e.balanceAfter.toLocaleString()}</span>
          </div>
        )
      })}
    </div>
  )
}
