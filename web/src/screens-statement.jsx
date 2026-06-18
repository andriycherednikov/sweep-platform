/* ============================================================
   THE SWEEP — Statement screen: a person's Yowie Dollars ledger
   ============================================================ */
import { useQuery } from '@tanstack/react-query'
import { SWEEP as S } from './data.js'
import { getMe } from './social.js'
import { fetchLedger } from './api/client.js'
import { Icon } from './components.jsx'
import { betSelectionLabel, MARKET_LABELS } from './screens-coins.jsx'

/** Human reason for one ledger entry. Reuses the bet-slip helpers for selection wording. */
function entryLabel(e) {
  if (e.type === 'grant') return e.weekIndex === 0 ? 'Starting bankroll' : 'Weekly Yowie Dollars'
  if (e.type === 'refund') return 'Refund'
  const b = e.bet
  if (!b) return e.type === 'payout' ? 'Bet payout' : 'Bet placed'
  const f = S.fixture(b.fixtureId)
  const match = f ? `${S.team(f.t1)?.name || f.t1} v ${S.team(f.t2)?.name || f.t2}` : b.fixtureId
  const sel = betSelectionLabel(b)
  const mkt = MARKET_LABELS[b.market] || b.market
  if (e.type === 'payout') return `Won bet · ${match} — ${sel}`
  const status = b.status && b.status !== 'open' ? ` (${b.status.charAt(0).toUpperCase() + b.status.slice(1)})` : ''
  return `${match} — ${sel} · ${mkt}${status}`
}

function fmtDate(iso) {
  const d = iso ? new Date(iso) : null
  return d ? d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : ''
}

const fmtAmount = (n) => `${n > 0 ? '+' : n < 0 ? '-' : ''}${Math.abs(n).toLocaleString()}`

export function StatementScreen({ onBack }) {
  const me = getMe()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['coins', 'ledger', me?.id],
    queryFn: () => fetchLedger(me.id),
    enabled: !!me,
  })
  const entries = data?.entries ?? []

  return (
    <div className="screen screen-anim" data-testid="statement-screen" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="stmt-head">
        <button className="coin-back" onClick={onBack} aria-label="Back"><Icon.back /></button>
        <h2 className="stmt-title">Statement</h2>
        <div className="stmt-bal"><Icon.coin /><span>{(data?.balance ?? 0).toLocaleString()}</span></div>
      </div>

      <div className="scroll pad screen-anim">
        <div className="wrap" style={{ marginTop: 14 }}>
          {isError ? (
            <div className="block" style={{ padding: '16px 14px', color: 'var(--muted)', fontSize: 13 }}>
              Couldn’t load your statement — pull down or try again.
            </div>
          ) : isLoading ? (
            <div className="block" style={{ padding: '16px 14px', color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
          ) : entries.length === 0 ? (
            <div className="block" style={{ padding: '16px 14px', color: 'var(--muted)', fontSize: 13 }}>No activity yet.</div>
          ) : (
            <div className="block stmt-list">
              {entries.map((e) => {
                const credit = e.amount > 0
                return (
                  <div key={e.id} className="stmt-row">
                    <div className="stmt-main">
                      <span className="stmt-label">{entryLabel(e)}</span>
                      <span className="stmt-date">{fmtDate(e.createdAt)}</span>
                    </div>
                    <div className="stmt-side">
                      <span className={'stmt-amt ' + (credit ? 'up' : 'down')}>{fmtAmount(e.amount)}</span>
                      <span className="stmt-running">{e.balanceAfter.toLocaleString()}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
