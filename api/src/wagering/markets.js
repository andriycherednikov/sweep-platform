import { SPORTS } from '../sports.js'

/** Winning selection for a final fixture: 'HOME' | 'AWAY' | 'DRAW' | null. */
export function fixtureResult(f) {
  if (f.winnerCode) {
    if (f.winnerCode === f.t1Code) return 'HOME'
    if (f.winnerCode === f.t2Code) return 'AWAY'
    return 'DRAW'
  }
  if (f.score1 == null || f.score2 == null) return null
  return f.score1 > f.score2 ? 'HOME' : f.score1 < f.score2 ? 'AWAY' : 'DRAW'
}

/** Half-time [home, away] goals from the stored HT score, falling back to counting goal
 *  events at minute <= 45. null when neither is available (events never polled). */
function htScores(f) {
  let h = f.htScore1, a = f.htScore2
  if (h == null || a == null) {
    if (!Array.isArray(f.events)) return null // never polled — can't know the HT score
    const fh = f.events.filter((e) => e.type === 'goal' && (e.minute ?? 99) <= 45)
    h = fh.filter((e) => e.teamCode === f.t1Code).length
    a = fh.filter((e) => e.teamCode === f.t2Code).length
  }
  return [h, a]
}
function htResult(f) {
  const s = htScores(f); if (!s) return null
  const [h, a] = s
  return h > a ? 'HOME' : h < a ? 'AWAY' : 'DRAW'
}

/** Regulation-time (90') winning side from the stored 90-minute score. Used for bet
 *  settlement so a knockout decided in ET/penalties still grades on its 90' result. */
export function regulationResult(f) {
  if (f.regScore1 == null || f.regScore2 == null) return null
  return f.regScore1 > f.regScore2 ? 'HOME' : f.regScore1 < f.regScore2 ? 'AWAY' : 'DRAW'
}

/** Score pair a sport's bets grade on; null when not yet available. */
function scoresFor(f, sport) {
  if (sport.gradeOn === 'regulation') return f.regScore1 == null || f.regScore2 == null ? null : [f.regScore1, f.regScore2]
  return f.score1 == null || f.score2 == null ? null : [f.score1, f.score2]
}

export const MARKET_REGISTRY = {
  '1x2': { needsDraws: true, grade(f, selection) { const r = regulationResult(f); return r == null ? null : r === selection ? 'won' : 'lost' } },
  ml: { grade(f, selection) { const r = fixtureResult(f); return r == null ? null : r === selection ? 'won' : 'lost' } },
  ou: { grade(f, selection, line, sport) {
    if (line == null) return null
    const s = scoresFor(f, sport); if (!s) return null
    const total = s[0] + s[1]
    if (total === line) return null // ponytail: half-point lines only at offer — an integer push would need refund plumbing
    return ((total > line) === (selection === 'OVER')) ? 'won' : 'lost'
  } },
  hcap: { grade(f, selection, line, sport) {
    if (line == null) return null
    const s = scoresFor(f, sport); if (!s) return null
    const margin = s[0] + line - s[1]
    if (margin === 0) return null // ponytail: half-point lines only at offer — an integer push would need refund plumbing
    return ((margin > 0) === (selection === 'HOME')) ? 'won' : 'lost'
  } },
  // To Qualify grades on who actually advanced (winnerCode → ET/penalties aware), not the 90' result.
  toq: { grade(f, selection) { const r = fixtureResult(f); return r == null ? null : r === selection ? 'won' : 'lost' } },
  fh1x2: { needsDraws: true, grade(f, selection) { const r = htResult(f); return r == null ? null : r === selection ? 'won' : 'lost' } },
  ou25: {
    grade(f, selection, line) {
      if (line == null) return null
      if (f.regScore1 == null || f.regScore2 == null) return null
      const measure = f.regScore1 + f.regScore2
      const over = measure > line
      return (selection === 'OVER' ? over : !over) ? 'won' : 'lost'
    },
  },
  cards: {
    grade(f, selection, line) {
      if (line == null) return null
      if (!Array.isArray(f.events)) return null
      const measure = f.events.filter((e) => e.type === 'card' && (e.minute ?? 0) <= 90).length
      const over = measure > line
      return (selection === 'OVER' ? over : !over) ? 'won' : 'lost'
    },
  },
  cs: { grade(f, selection) { if (f.regScore1 == null || f.regScore2 == null) return null; return `${f.regScore1}:${f.regScore2}` === selection ? 'won' : 'lost' } },
  btts: {
    grade(f, selection) {
      if (f.regScore1 == null || f.regScore2 == null) return null
      const yes = f.regScore1 > 0 && f.regScore2 > 0
      return (selection === 'YES' ? yes : !yes) ? 'won' : 'lost'
    },
  },
  dc: {
    needsDraws: true,
    grade(f, selection) {
      const r = regulationResult(f); if (r == null) return null
      const pair = { '1X': ['HOME', 'DRAW'], '12': ['HOME', 'AWAY'], 'X2': ['DRAW', 'AWAY'] }[selection]
      return pair && pair.includes(r) ? 'won' : 'lost'
    },
  },
  oe: {
    grade(f, selection) {
      if (f.regScore1 == null || f.regScore2 == null) return null
      const even = (f.regScore1 + f.regScore2) % 2 === 0
      return (selection === 'EVEN' ? even : !even) ? 'won' : 'lost'
    },
  },
  fhou: {
    grade(f, selection, line) {
      if (line == null) return null
      const s = htScores(f); if (!s) return null
      const over = (s[0] + s[1]) > line
      return (selection === 'OVER' ? over : !over) ? 'won' : 'lost'
    },
  },
  gs: {
    grade(f, selection) {
      if (!Array.isArray(f.events)) return null // events not polled yet → leave open
      // v1 "all bets stand": won iff the named player scored a non-own goal in regulation;
      // otherwise lost (no DNP void). API-Football names the same player differently per feed:
      // the odds value is a full name ("Erling Haaland") but a fixture event is initial+surname
      // ("E. Haaland"). Match on surname + first-initial, not exact string.
      // ponytail: surname+initial heuristic — two scorers sharing both in one match would
      // collide; rare, and the UI groups goalscorers by the same key. Upgrade to player ids if it bites.
      const parse = (s) => {
        const t = String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '')
          .toLowerCase().replace(/[^a-z\s]/g, ' ').trim().split(/\s+/).filter(Boolean)
        return t.length ? { last: t[t.length - 1], first: t.length > 1 ? t[0][0] : null } : null
      }
      const want = parse(selection)
      const samePlayer = (p) => {
        const got = parse(p)
        if (!want || !got || want.last !== got.last) return false
        return !(want.first && got.first) || want.first === got.first
      }
      const scored = f.events.some((e) => e.type === 'goal' && e.detail !== 'Own Goal' && (e.minute ?? 0) <= 90 && samePlayer(e.player))
      return scored ? 'won' : 'lost'
    },
  },
}

/** Resolve one bet → 'won' | 'lost' | null (null = data not available yet, leave open). */
export function resolveBet(market, selection, line, f, sport = SPORTS.football) {
  const entry = MARKET_REGISTRY[market]
  if (!entry) return null
  if (entry.needsDraws && !sport.hasDraws) return null // belt: never grade a draw market for a no-draw sport
  return entry.grade(f, selection, line, sport)
}
