/* ============================================================
   THE SWEEP — shared bet-label helpers (market names + selection wording).
   Used by the Wagers bet slip (screens-coins) and the statement (screens-statement);
   kept here so neither screen has to import the other.
   ============================================================ */
import { SWEEP as S } from '../data.js'

export const MARKET_LABELS = {
  '1x2': 'Match Winner',
  fh1x2: 'First Half',
  ou25: 'Over/Under 2.5',
  cards: 'Cards O/U',
  cs: 'Correct Score',
}

/** Human selection wording for a bet, e.g. a team name, "Over 2.5", or "2-1". */
export function betSelectionLabel(b) {
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
