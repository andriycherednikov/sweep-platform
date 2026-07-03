const LIVE = new Set(['Q1', 'Q2', 'Q3', 'Q4', 'OT', 'BT', 'HT'])
const FINAL = new Set(['FT', 'AOT'])

/** API-Basketball game status short → our status. Unknown/postponed → 'upcoming'. */
export function mapGameStatus(short) {
  if (FINAL.has(short)) return 'final'
  if (LIVE.has(short)) return 'live'
  return 'upcoming'
}

const quarters = (s) => [s.quarter_1 ?? null, s.quarter_2 ?? null, s.quarter_3 ?? null, s.quarter_4 ?? null]

/** Raw /games row → football-core mapped shape (shared baseline spine reads these names). */
export function mapGame(raw) {
  const status = mapGameStatus(raw.status?.short)
  const h = raw.scores?.home?.total ?? null
  const a = raw.scores?.away?.total ?? null
  let winnerSide = null
  if (status === 'final') {
    if (h === a) throw new Error(`basketball game ${raw.id} is final with a tied score`)
    winnerSide = h > a ? 'home' : 'away'
  }
  const ot = raw.scores?.home?.over_time
  return {
    id: String(raw.id),
    homeProviderId: raw.teams.home.id,
    awayProviderId: raw.teams.away.id,
    kickoffUtc: new Date(raw.date),
    status, winnerSide, score1: h, score2: a,
    // regular season → 'group' (the inherited default stage); any week label → knockout.
    // Play-in and All-Star ride along as knockout; All-Star dies at the unknown-team filter.
    stage: raw.week == null ? 'group' : 'knockout',
    group: '', matchday: 0,
    venue: raw.venue ?? '', city: '',
    minute: null,
    phase: status === 'live' ? (raw.status?.short ?? null) : null,
    detail: {
      quarters: { home: quarters(raw.scores?.home ?? {}), away: quarters(raw.scores?.away ?? {}) },
      ot: ot == null ? null : [ot, raw.scores?.away?.over_time ?? null],
      week: raw.week ?? null,
    },
  }
}
