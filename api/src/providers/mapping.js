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

/** Largest-remainder rounding of fractional percents to ints summing to exactly 100. */
function roundTo100(parts) {
  const scaled = parts.map((p) => p * 100)
  const floors = scaled.map(Math.floor)
  let remainder = 100 - floors.reduce((s, n) => s + n, 0)
  // hand out the leftover to the largest fractional parts (deterministic a→d→b on ties)
  const order = scaled
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((x, y) => (y.frac - x.frac) || (x.i - y.i))
  const out = floors.slice()
  for (let k = 0; k < order.length && remainder > 0; k++, remainder--) out[order[k].i] += 1
  return out
}

/**
 * /odds response → {a,d,b} implied win percents (home,draw,away), or null.
 * Picks the first bookmaker carrying a complete "Match Winner" (1X2) market,
 * converts decimal odds to implied probabilities (1/odd), strips the margin by
 * normalizing, and rounds to ints summing to exactly 100.
 */
export function mapOdds(rawResponse) {
  const bookmakers = rawResponse?.response?.[0]?.bookmakers ?? []
  for (const bk of bookmakers) {
    const bet = (bk.bets ?? []).find((b) => b.name === 'Match Winner')
    if (!bet) continue
    const pick = (label) => bet.values?.find((v) => v.value === label)?.odd
    const odds = [pick('Home'), pick('Draw'), pick('Away')].map(Number)
    if (odds.some((o) => !Number.isFinite(o) || o <= 1)) continue
    const implied = odds.map((o) => 1 / o)
    const sum = implied.reduce((s, n) => s + n, 0)
    const [a, d, b] = roundTo100(implied.map((p) => p / sum))
    return { a, d, b }
  }
  return null
}

export function mapTeam(raw) {
  return { providerTeamId: raw.team.id, name: raw.team.name, code: raw.team.code ?? null, country: raw.team.country ?? null }
}

/**
 * /players/squads response → [{name, number, pos, photo}] for one team's roster, or null.
 * A missing shirt number is kept (null), not dropped — squads list players without numbers.
 */
export function mapSquad(rawResponse) {
  const players = rawResponse?.response?.[0]?.players ?? []
  const out = players.map((p) => ({
    name: p.name ?? null,
    number: p.number ?? null,
    pos: p.position ?? null,
    photo: p.photo ?? null,
  }))
  return out.length ? out : null
}

/**
 * /fixtures/lineups response + a crosswalk (Map<providerTeamId, teamCode>) →
 * [{ teamCode, formation, startXI:[{name,number,pos}] }]. Teams not in the crosswalk
 * are dropped; returns null if nothing resolves (so callers don't wipe prior data).
 */
export function mapLineups(rawResponse, crosswalkMap) {
  const entries = rawResponse?.response ?? []
  const out = []
  for (const e of entries) {
    const teamCode = crosswalkMap.get(e.team?.id)
    if (!teamCode) continue
    const startXI = (e.startXI ?? []).map(({ player }) => ({
      name: player?.name ?? null,
      number: player?.number ?? null,
      pos: player?.pos ?? null,
    }))
    out.push({ teamCode, formation: e.formation ?? null, startXI })
  }
  return out.length ? out : null
}

/**
 * /fixtures/events response + a crosswalk (Map<providerTeamId, teamCode>) →
 * [{ id, type:'goal'|'card', teamCode, player, minute, detail, assist?, card? }].
 * Keeps only Goal & Card; drops subst/Var and any team not in the crosswalk.
 * `minute` is the numeric elapsed clock; stoppage `extra` is folded into `id` only,
 * which is a deterministic composite the worker uses to diff fetched-vs-stored events.
 */
export function mapEvents(rawResponse, crosswalkMap) {
  const events = rawResponse?.response ?? []
  const out = []
  for (const e of events) {
    const type = e.type === 'Goal' ? 'goal' : e.type === 'Card' ? 'card' : null
    if (!type) continue
    const teamCode = crosswalkMap.get(e.team?.id)
    if (!teamCode) continue
    const elapsed = e.time?.elapsed ?? 0
    const extra = e.time?.extra ?? null
    const player = e.player?.name ?? null
    const detail = e.detail ?? null
    const ev = { id: [elapsed, extra ?? 0, teamCode, player, type, detail].join('|'), type, teamCode, player, minute: elapsed, detail }
    if (type === 'goal') ev.assist = e.assist?.name ?? null
    if (type === 'card') ev.card = /red|second yellow/i.test(detail ?? '') ? 'red' : 'yellow'
    out.push(ev)
  }
  return out
}
