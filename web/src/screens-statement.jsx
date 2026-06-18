/* ============================================================
   THE SWEEP — Yowie Dollars statement: a person's coin ledger,
   rendered inline as a tab inside the Wagers screen. Columns:
   date · activity (icon + game / selection) · amount (+/−) · running balance.
   ============================================================ */
import { useQuery } from '@tanstack/react-query'
import { SWEEP as S } from './data.js'
import { getMe } from './social.js'
import { fetchLedger } from './api/client.js'
import { Icon } from './components.jsx'
import { betSelectionLabel, MARKET_LABELS } from './lib/betLabels.js'

// one icon per ledger entry kind: deposit (grant), bet placed (stake), bet won (payout)
const KIND_ICON = { dep: Icon.coin, bet: Icon.ball, win: Icon.star }

/** Structured view of one ledger entry: an icon kind, a title line (the game or grant),
 *  and a sub line (the selection). Reuses the bet-slip helpers for selection wording. */
function entryView(e) {
  if (e.type === 'grant') return { kind: 'dep', title: e.weekIndex === 0 ? 'Starting bankroll' : 'Weekly Yowie Dollars', sub: 'Deposit' }
  if (e.type === 'refund') return { kind: 'dep', title: 'Refund', sub: '' }
  const won = e.type === 'payout'
  const kind = won ? 'win' : 'bet'
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
        const Ic = KIND_ICON[v.kind]
        const credit = e.amount > 0
        return (
          <div key={e.id} className="stmt-row">
            <div className="stmt-when">
              <span className="stmt-when-date">{date}</span>
              <span className="stmt-when-time">{time}</span>
            </div>
            <div className="stmt-act">
              <span className={'stmt-ic ' + v.kind}><Ic /></span>
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
