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

// The feed lists the All-Star squads as teams (and their game as a fixture) — not franchises.
const ALL_STAR = new Set(['East', 'West'])

/** Raw /teams row → domain team, or null for All-Star squads (filter at the map). */
export function mapBasketTeam(raw) {
  if (ALL_STAR.has(raw.name)) return null
  return { providerTeamId: raw.id, name: raw.name, code: null, country: raw.country?.name ?? null, logo: raw.logo ?? null }
}

/** Raw /standings row → ranking-shaped domain row (conference rows only; division duplicates → null). */
export function mapBasketStanding(raw) {
  const group = raw.group?.name ?? ''
  if (!group.endsWith('Conference')) return null
  return {
    providerTeamId: raw.team.id,
    group,
    rank: raw.position,
    pts: 0, // NBA tables rank by win%, not points
    stats: {
      played: raw.games.played,
      win: raw.games.win.total, loss: raw.games.lose.total,
      pf: raw.points.for, pa: raw.points.against,
      pct: Number(raw.games.win.percentage),
    },
  }
}

/** Raw /leagues row → catalog entry. */
export function mapLeague(raw) {
  return {
    providerLeagueId: raw.id, name: raw.name, type: raw.type, logo: raw.logo ?? null,
    seasons: (raw.seasons ?? []).map((s) => ({ season: String(s.season), start: s.start, end: s.end })),
  }
}
