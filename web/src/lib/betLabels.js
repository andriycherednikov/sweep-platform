/* ============================================================
   THE SWEEP — shared bet-label helpers (market names + selection wording).
   Used by the Wagers bet slip (screens-coins) and the statement (screens-statement);
   kept here so neither screen has to import the other.
   ============================================================ */
import { SWEEP as S } from '../data.js'

// every market key the web can render, in display order (bet-detail + "+N more" both consume this)
export const RENDERABLE_MARKETS = ['toq', '1x2', 'ml', 'dc', 'ou25', 'ou', 'hcap', 'btts', 'oe', 'cards', 'fh1x2', 'fhou', 'cs', 'gs']

export const MARKET_LABELS = {
  '1x2': 'Match Winner',
  toq: 'To Qualify',
  ml: 'Moneyline',
  fh1x2: 'First Half',
  ou25: 'Over/Under 2.5',
  ou: 'Over/Under',
  hcap: 'Handicap',
  cards: 'Cards O/U',
  cs: 'Correct Score',
  btts: 'Both Teams to Score',
  dc: 'Double Chance',
  oe: 'Odd/Even Goals',
  fhou: 'First Half O/U',
  gs: 'Anytime Goalscorer',
}

/** Human selection wording for a bet, e.g. a team name, "Over 2.5", or "2-1". */
export function betSelectionLabel(b) {
  const f = S.fixture(b.fixtureId)
  if ((b.market === '1x2' || b.market === 'fh1x2' || b.market === 'toq' || b.market === 'ml') && f) {
    if (b.selection === 'HOME') return S.team(f.t1)?.name || 'Home'
    if (b.selection === 'AWAY') return S.team(f.t2)?.name || 'Away'
    if (b.selection === 'DRAW') return 'Draw'
  }
  if (b.market === 'ou25' || b.market === 'cards' || b.market === 'fhou' || b.market === 'ou')
    return b.selection === 'OVER' ? `Over ${b.line ?? ''}`.trim() : `Under ${b.line ?? ''}`.trim()
  if (b.market === 'cs') return String(b.selection).replace(':', '-')
  if (b.market === 'dc' && f) {
    const t1 = S.team(f.t1)?.name || 'Home', t2 = S.team(f.t2)?.name || 'Away'
    if (b.selection === '1X') return `${t1} or Draw`
    if (b.selection === '12') return `${t1} or ${t2}`
    if (b.selection === 'X2') return `Draw or ${t2}`
  }
  if (b.market === 'btts') return b.selection === 'YES' ? 'Yes' : 'No'
  if (b.market === 'oe') return b.selection === 'ODD' ? 'Odd' : 'Even'
  if (b.market === 'hcap' && f) {
    const line = b.line ?? f?.markets?.hcap?.line ?? 0
    const t = b.selection === 'HOME' ? S.team(f.t1)?.name || 'Home' : S.team(f.t2)?.name || 'Away'
    const n = b.selection === 'HOME' ? line : -line
    return `${t} ${n > 0 ? '+' : ''}${n}`
  }
  // generic fallback: the market's own selection label (e.g. "Yes", "Odd")
  const sel = f?.markets?.[b.market]?.selections?.find((s) => s.key === b.selection)
  return sel?.label || b.selection
}
