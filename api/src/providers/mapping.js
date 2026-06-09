const LIVE = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INT'])
const FINAL = new Set(['FT', 'AET', 'PEN'])

/** API-Football fixture status short code → our status. Unknown/postponed → 'upcoming'. */
export function mapStatus(short) {
  if (FINAL.has(short)) return 'final'
  if (LIVE.has(short)) return 'live'
  return 'upcoming'
}

/**
 * Parse a fixture's `league.round` into matchday + stage.
 * The real WC group stage reads "Group Stage - N" — the GROUP LETTER is NOT here
 * (it lives on the /standings rows), so group is '' and resolved later from standings.
 * Also tolerates the embedded form "Group A - 1". Non-group rounds → knockout.
 */
export function parseRound(round) {
  const s = round ?? ''
  let m = /Group\s+Stage\s*-\s*(\d+)/i.exec(s)
  if (m) return { group: '', matchday: Number(m[1]), stage: 'group' }
  m = /Group\s+([A-L])\s*-\s*(\d+)/i.exec(s)
  if (m) return { group: m[1].toUpperCase(), matchday: Number(m[2]), stage: 'group' }
  return { group: '', matchday: 0, stage: 'knockout' }
}

/** "Group A" → "A". The "Ranking of third-placed teams" pseudo-group → null. */
export function parseGroupLabel(label) {
  const m = /Group\s+([A-L])/i.exec(label ?? '')
  return m ? m[1].toUpperCase() : null
}

export function mapFixture(raw) {
  const { group, matchday, stage } = parseRound(raw.league?.round)
  const status = mapStatus(raw.fixture?.status?.short)
  return {
    id: String(raw.fixture.id),
    group, matchday, stage,
    homeProviderId: raw.teams.home.id,
    awayProviderId: raw.teams.away.id,
    kickoffUtc: new Date(raw.fixture.date),
    venue: raw.fixture.venue?.name ?? '',
    city: raw.fixture.venue?.city ?? '',
    status,
    score1: raw.goals?.home ?? null,
    score2: raw.goals?.away ?? null,
    minute: status === 'live' ? (raw.fixture?.status?.elapsed ?? null) : null,
  }
}

/** A standings row → domain. `group` is the letter (A–L) or null for the third-placed ranking. */
export function mapStanding(raw) {
  return {
    providerTeamId: raw.team.id,
    group: parseGroupLabel(raw.group),
    played: raw.all.played, win: raw.all.win, draw: raw.all.draw, loss: raw.all.lose,
    gf: raw.all.goals.for, ga: raw.all.goals.against, pts: raw.points,
  }
}

const pct = (s) => (s == null ? null : Number(String(s).replace('%', '').trim()))

/** /predictions response → {a,d,b} integer percents (home,draw,away), or null if absent. */
export function mapPrediction(rawResponse) {
  const p = rawResponse?.response?.[0]?.predictions?.percent
  if (!p) return null
  const a = pct(p.home), d = pct(p.draw), b = pct(p.away)
  if (a == null || d == null || b == null) return null
  return { a, d, b }
}

export function mapTeam(raw) {
  return { providerTeamId: raw.team.id, name: raw.team.name, code: raw.team.code ?? null, country: raw.team.country ?? null }
}
