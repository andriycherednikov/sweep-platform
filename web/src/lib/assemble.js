import { flag, gd, fmtTime, fmtDate, fmtDateTime, fmtDayKey, fmtWeekday } from './format.js'

function outlookFor(s) {
  return s >= 86 ? 'Title contender' : s >= 80 ? 'Last-8 shout' : s >= 73 ? 'Knockout dark horse' : s >= 66 ? 'Group toss-up' : 'Long shot'
}
function titleOddsFor(s) {
  return Math.max(1, Math.round(Math.pow(Math.max(0, s - 50), 2) / 14))
}

// API-Football returns degenerate placeholder percentages for far-future
// fixtures it can't model yet — all-equal (33/33/33) or the draw tying a win
// side (50/50/0, 0/50/50). A real model never ties the draw to a win outcome,
// so treat those (and absent values) as "no real odds" and let the UI hide them
// until kickoff nears and real numbers arrive.
function hasRealOdds(prob) {
  if (!prob) return false
  const { a, d, b } = prob
  if (a == null || d == null || b == null) return false
  return a !== d && d !== b
}

/**
 * Collapse a three-way prediction to a two-way home-vs-away split (draw excluded),
 * renormalized to sum 100. Used for display; the raw three-way `prob` is kept in case
 * we reinstate the draw or surface raw odds later.
 */
export function twoWayProb(prob) {
  const a = prob?.a ?? 0, b = prob?.b ?? 0
  if (a + b === 0) return { pa: 50, pb: 50 }
  const pa = Math.round((a / (a + b)) * 100)
  return { pa, pb: 100 - pa }
}

/**
 * Three-way prediction for the official-odds bars: home / draw / away,
 * each as a percentage. Win sides are rounded; the draw absorbs the rounding
 * remainder so the three always sum to 100.
 */
export function threeWayProb(prob) {
  const a = prob?.a ?? 0, d = prob?.d ?? 0, b = prob?.b ?? 0
  const t = a + d + b
  if (t === 0) return { pa: 34, pd: 33, pb: 33 }
  const pa = Math.round((a / t) * 100)
  const pb = Math.round((b / t) * 100)
  return { pa, pd: Math.max(0, 100 - pa - pb), pb }
}

/**
 * Pure: turn the API bundle ({bootstrap, fixtures, standings, photos, syncStatus})
 * into the SWEEP-shaped object the components consume.
 */
export function assembleSweep(api) {
  const { bootstrap, fixtures: rawFixtures, standings: rawStandings, photos: rawPhotos } = api

  // people (carry their team codes from ownership)
  const ownership = bootstrap.ownership || {}
  const people = bootstrap.people.map((p) => ({
    id: p.id, name: p.name, short: p.short, initials: p.initials, av: p.av, avatarPath: p.avatarPath,
    createdAt: p.createdAt ?? null,
    // age gate for wagers — everyone is an adult unless an admin flags otherwise
    adult: p.adult !== false,
    // server-recorded Wagers self-exclusion (responsible-gambling) — surfaced in admin
    excluded: p.excluded === true,
    teams: ownership[p.id] ? ownership[p.id].slice() : [],
  }))
  const peopleById = Object.fromEntries(people.map((p) => [p.id, p]))

  // owners by team code
  const ownersByTeam = {}
  for (const p of people) for (const code of p.teams) (ownersByTeam[code] = ownersByTeam[code] || []).push(p)
  const ownersOf = (code) => ownersByTeam[code] || []

  // standings stats by code (from /api/standings rows)
  const statByCode = {}
  for (const g of Object.keys(rawStandings)) for (const row of rawStandings[g]) statByCode[row.code] = row

  // teams keyed by code (full objects: meta + stats + owners + outlook)
  const teams = {}
  for (const t of bootstrap.teams) {
    const s = statByCode[t.code] || { played: 0, win: 0, draw: 0, loss: 0, gf: 0, ga: 0, pts: 0 }
    teams[t.code] = {
      code: t.code, name: t.name, group: t.group, pool: t.pool, color: t.color, strength: t.strength,
      played: s.played, win: s.win, draw: s.draw, loss: s.loss, gf: s.gf, ga: s.ga, pts: s.pts,
      owners: ownersOf(t.code), titleOdds: titleOddsFor(t.strength), outlook: outlookFor(t.strength),
      squad: t.squad ?? null,
    }
  }
  const team = (code) => teams[code]
  const teamList = Object.keys(teams).map((c) => teams[c])
  const groups = [...new Set(teamList.map((t) => t.group))].sort()

  // standings grouped + sorted (pts, gd, gf, name)
  const standings = {}
  for (const t of teamList) (standings[t.group] = standings[t.group] || []).push(teams[t.code])
  for (const g of Object.keys(standings)) {
    standings[g].sort((x, y) => (y.pts - x.pts) || ((y.gf - y.ga) - (x.gf - x.ga)) || (y.gf - x.gf) || x.name.localeCompare(y.name))
  }

  // fixtures: Date kickoff + time labels + derby/doubleOwners from ownership
  const fixtures = rawFixtures.map((f) => {
    const ko = new Date(f.ko)
    const o1 = ownersOf(f.t1), o2 = ownersOf(f.t2)
    const derby = o1.length > 0 && o2.length > 0
    const doubleOwners = o1.filter((p) => o2.indexOf(p) >= 0)
    return {
      id: f.id, group: f.group, matchday: f.matchday, t1: f.t1, t2: f.t2, ko,
      venue: f.venue, city: f.city, status: f.status, score: f.score, minute: f.minute,
      prob: f.prob, hasOdds: hasRealOdds(f.prob), prob2: twoWayProb(f.prob), prob3: threeWayProb(f.prob),
      markets: f.markets ?? null, htScore: f.htScore ?? null,
      lineups: f.lineups ?? null, events: f.events ?? [], statistics: f.statistics ?? null, stage: f.stage, derby, doubleOwners,
      timeLabel: fmtTime(ko), dayLabel: fmtDate(ko), dayKey: fmtDayKey(ko),
      dateTimeLabel: fmtDateTime(ko),
    }
  })
  fixtures.sort((a, b) => a.ko - b.ko)
  const fixturesById = Object.fromEntries(fixtures.map((f) => [f.id, f]))
  const fixture = (id) => fixturesById[id] || null
  const ownersForFixture = (f) => ({ t1: ownersOf(f.t1), t2: ownersOf(f.t2) })
  const derbies = fixtures.filter((f) => f.derby)

  // live / next match (real data: first live, else first upcoming, else first)
  const liveMatch = fixtures.find((f) => f.status === 'live') || null
  const nextMatch = fixtures.find((f) => f.status === 'upcoming') || fixtures[0] || null

  // people ranked by their teams' combined wins (tiebreak: best-team strength)
  const money = people.map((p) => {
    const myTeams = p.teams.map((c) => teams[c]).filter(Boolean)
    const best = myTeams.slice().sort((a, b) => b.strength - a.strength)[0]
    const wins = myTeams.reduce((n, t) => n + (t.win || 0), 0)
    return { person: p, team: best || null, odds: best ? best.titleOdds : 0, strength: best ? best.strength : 0, wins }
  }).sort((a, b) => (b.wins - a.wins) || (b.strength - a.strength))
  money.forEach((m, i) => { m.rank = i + 1; m.tag = i === 0 ? 'Title fav' : m.strength >= 70 ? 'Alive' : 'Outside' })

  // photos (already approved-only from the API) — tagged to a game (fixtureId)
  const photos = (rawPhotos || []).map((ph) => ({
    id: ph.id, uploader: ph.uploader, fixtureId: ph.fixtureId, caption: ph.caption, status: ph.status, src: ph.src, kind: ph.kind,
  }))

  const todayKey = fmtDayKey(new Date())

  // team elimination tracking: teams eliminated in group stage or losing knockout games
  const eliminatedTeamCodes = new Set()

  // 1. Group stage elimination based on group standings (when group games finish)
  for (const g of Object.keys(standings)) {
    const groupTeams = standings[g]
    const groupFixtures = fixtures.filter(f => f.group === g)
    const allDone = groupFixtures.length > 0 && groupFixtures.every(f => f.status === 'final')
    if (allDone) {
      for (let i = 2; i < groupTeams.length; i++) {
        eliminatedTeamCodes.add(groupTeams[i].code)
      }
    }
  }

  // 2. Production World Cup 2026 Round of 32 check
  const KNOWN_KO_TEAMS = new Set([
    "de","py","fr","se","za","ca","nl","ma","pt","hr","es","at","us","bih","be","sn",
    "br","jp","ci","no","mx","ec","gb-eng","cgo","ar","cpv","au","eg","ch","dz","co","gh"
  ]);
  const hasRealTeams = bootstrap.teams.some(t => KNOWN_KO_TEAMS.has(t.code))
  if (hasRealTeams) {
    for (const t of bootstrap.teams) {
      if (!KNOWN_KO_TEAMS.has(t.code)) {
        eliminatedTeamCodes.add(t.code)
      }
    }
  }

  // 3. Finished knockout matches
  for (const f of fixtures) {
    if (f.stage === 'knockout' && f.status === 'final' && f.score) {
      if (f.score[0] > f.score[1]) eliminatedTeamCodes.add(f.t2)
      else if (f.score[1] > f.score[0]) eliminatedTeamCodes.add(f.t1)
    }
  }

  const isTeamEliminated = (code) => eliminatedTeamCodes.has(code)
  const isPersonEliminated = (id) => {
    const p = peopleById[id]
    if (!p || !p.teams || p.teams.length === 0) return false
    return p.teams.every((code) => eliminatedTeamCodes.has(code))
  }

  return {
    teams, teamList, groups, people, peopleById, fixtures, fixturesById, standings, photos, derbies, money,
    nextMatch, liveMatch, scoring: bootstrap.scoring,
    sweep: bootstrap.sweep || { id: 'default', name: 'The Sweep' },
    team, fixture, flag, gd, ownersOf, ownersForFixture, isTeamEliminated, isPersonEliminated, fmtTime, fmtDate, fmtDayKey, fmtWeekday, todayKey,
  }
}
