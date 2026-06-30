import { flag, gd, fmtTime, fmtDate, fmtDateTime, fmtDayKey, fmtWeekday } from './format.js'

function outlookFor(s) {
  return s >= 86 ? 'Title contender' : s >= 80 ? 'Last-8 shout' : s >= 73 ? 'Knockout dark horse' : s >= 66 ? 'Group toss-up' : 'Long shot'
}
function titleOddsFor(s) {
  return Math.max(1, Math.round(Math.pow(Math.max(0, s - 50), 2) / 14))
}

/**
 * The team code that WON a final fixture, or null (a draw, or not yet final).
 * Honors f.winnerCode — which the worker derives from the provider's actual result,
 * so it covers penalty shootouts and any decided knockout (the 'DRAW' sentinel means
 * no winner) — and falls back to the goal score only when winnerCode is absent.
 *
 * Single source of truth for "who won": every person-win tally must go through this,
 * otherwise group standings (group-stage only) silently drop all knockout/shootout wins.
 */
export function winnerCodeOf(f) {
  if (!f || f.status !== 'final') return null
  if (f.winnerCode) return f.winnerCode === 'DRAW' ? null : f.winnerCode
  if (!f.score) return null
  if (f.score[0] > f.score[1]) return f.t1
  if (f.score[1] > f.score[0]) return f.t2
  return null
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
 * Two-way "to progress" probability {pa, pb} for the elimination bars. Prefers the
 * To Qualify odds (the book's actual P(each side advances) — extra time/penalties
 * included); falls back to the draw-collapsed 1x2 split when no toq market exists.
 */
export function progressProb(f) {
  const sels = f?.markets?.toq?.selections
  if (sels) {
    const h = sels.find((s) => s.key === 'HOME')?.odds
    const a = sels.find((s) => s.key === 'AWAY')?.odds
    if (h > 1 && a > 1) {
      const ih = 1 / h, ia = 1 / a
      const pa = Math.round((ih / (ih + ia)) * 100)
      return { pa, pb: 100 - pa }
    }
  }
  return twoWayProb(f?.prob)
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
    // Derive penScore fallback from events if DB column is null
    let penScore = f.penScore ?? null;
    if (!penScore && f.events && f.events.length > 0) {
      const p1 = f.events.filter(e => e.teamCode === f.t1 && e.minute === 120 && e.type === 'goal' && /penalty/i.test(e.detail || "") && !/miss|save/i.test(e.detail || "")).length;
      const p2 = f.events.filter(e => e.teamCode === f.t2 && e.minute === 120 && e.type === 'goal' && /penalty/i.test(e.detail || "") && !/miss|save/i.test(e.detail || "")).length;
      if (p1 > 0 || p2 > 0) {
        penScore = [p1, p2];
      }
    }

    return {
      id: f.id, group: f.group, matchday: f.matchday, t1: f.t1, t2: f.t2, ko,
      venue: f.venue, city: f.city, status: f.status, score: f.score, minute: f.minute, phase: f.phase ?? null,
      prob: f.prob, hasOdds: hasRealOdds(f.prob), prob2: progressProb(f), prob3: threeWayProb(f.prob),
      markets: f.markets ?? null, htScore: f.htScore ?? null, penScore,
      lineups: f.lineups ?? null, events: f.events ?? [], statistics: f.statistics ?? null, stage: f.stage, derby, doubleOwners,
      winnerCode: f.winnerCode ?? null,
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

  // people ranked by their wins across ALL their final fixtures (tiebreak: best-team
  // strength). Counted per-fixture via winnerCodeOf — NOT summed from group standings,
  // which only tally the group stage and so drop every knockout and penalty-shootout win.
  const money = people.map((p) => {
    const myTeams = p.teams.map((c) => teams[c]).filter(Boolean)
    const best = myTeams.slice().sort((a, b) => b.strength - a.strength)[0]
    const wins = fixtures.reduce((n, f) => {
      const w = winnerCodeOf(f)
      return n + (w && p.teams.indexOf(w) >= 0 ? 1 : 0)
    }, 0)
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

  // Teams that reached the knockout — from the real KO fixtures, plus the known WC2026
  // R32 line-up. The 8 best 3rd-placed teams advance, so a 3rd-place group finish is NOT
  // elimination; only teams that reached neither are out after the group stage.
  const KNOWN_KO_TEAMS = new Set([
    "de","py","fr","se","za","ca","nl","ma","pt","hr","es","at","us","bih","be","sn",
    "br","jp","ci","no","mx","ec","gb-eng","cgo","ar","cpv","au","eg","ch","dz","co","gh"
  ]);
  const hasRealTeams = bootstrap.teams.some(t => KNOWN_KO_TEAMS.has(t.code))
  const koFixtureTeams = new Set()
  for (const f of fixtures) if (f.stage === 'knockout') { koFixtureTeams.add(f.t1); koFixtureTeams.add(f.t2) }
  const reachedKnockout = (code) => koFixtureTeams.has(code) || (hasRealTeams && KNOWN_KO_TEAMS.has(code))

  // 1. Group stage: once a group's games are all final, everyone from position 3 down who
  //    did NOT reach the knockout is out (top 2 always advance; best 3rd-placed teams may).
  for (const g of Object.keys(standings)) {
    const groupTeams = standings[g]
    const groupFixtures = fixtures.filter(f => f.group === g)
    const allDone = groupFixtures.length > 0 && groupFixtures.every(f => f.status === 'final')
    if (allDone) {
      for (let i = 2; i < groupTeams.length; i++) {
        if (!reachedKnockout(groupTeams[i].code)) eliminatedTeamCodes.add(groupTeams[i].code)
      }
    }
  }

  // 2. When the real R32 line-up is known, any team that did not reach the knockout is out.
  if (hasRealTeams) {
    for (const t of bootstrap.teams) {
      if (!reachedKnockout(t.code)) eliminatedTeamCodes.add(t.code)
    }
  }

  // 3. Finished knockout matches
  for (const f of fixtures) {
    if (f.stage === 'knockout' && f.status === 'final') {
      if (f.winnerCode && f.winnerCode !== 'DRAW') {
        eliminatedTeamCodes.add(f.winnerCode === f.t1 ? f.t2 : f.t1)
      } else if (f.score) {
        if (f.score[0] > f.score[1]) eliminatedTeamCodes.add(f.t2)
        else if (f.score[1] > f.score[0]) eliminatedTeamCodes.add(f.t1)
      }
    }
  }

  // ---- finishing-order placement -------------------------------------------
  // People rank by WHEN their last team is eliminated: the longer your last team
  // survives, the better you place. Ties (co-owners of one team, or teams out in
  // simultaneous games) share a range. Times order people; they're never shown.
  const KO_ROUNDS = 5 // WC-2026 KO rounds to lift the cup: R32, R16, QF, SF, Final
  const koWins = {}
  for (const f of fixtures) {
    if (f.stage === 'knockout') {
      const w = winnerCodeOf(f)
      if (w) koWins[w] = (koWins[w] || 0) + 1
    }
  }
  const championCodes = new Set(Object.keys(koWins).filter((c) => koWins[c] >= KO_ROUNDS))

  // The instant (ms) a team was knocked out, or null if it's alive / the champion.
  const teamElimTime = (code) => {
    if (!eliminatedTeamCodes.has(code)) return null
    for (const f of fixtures) { // the one KO match it played and lost
      if (f.stage === 'knockout' && f.status === 'final' && (f.t1 === code || f.t2 === code)) {
        const w = winnerCodeOf(f)
        if (w && w !== code) return f.ko.getTime()
      }
    }
    // group exit → its last group fixture (those games kick off together → ties)
    let last = null
    for (const f of fixtures) {
      if (f.stage !== 'knockout' && (f.t1 === code || f.t2 === code)) {
        const t = f.ko.getTime()
        if (last == null || t > last) last = t
      }
    }
    return last
  }

  // Per person: settled? champion? and the ordering time (Infinity = above all who are out).
  const personElim = (p) => {
    if (!p.teams || p.teams.length === 0) return { settled: false, champion: false, time: Infinity }
    // ponytail: champions (the cup winner here, or the lone survivor crowned below) coexist with no still-in people — so the Infinity tie-group below is champions only, never widened.
    if (p.teams.some((c) => championCodes.has(c))) return { settled: true, champion: true, time: Infinity }
    if (p.teams.some((c) => !eliminatedTeamCodes.has(c))) return { settled: false, champion: false, time: Infinity }
    const ts = p.teams.map(teamElimTime).filter((t) => t != null)
    // ponytail: time 0 (placed last) is a degenerate fallback for an eliminated team with no fixtures — unreachable in prod since every team has group fixtures.
    return { settled: true, champion: false, time: ts.length ? Math.max(...ts) : 0 }
  }
  const elimByPerson = Object.fromEntries(people.map((p) => [p.id, personElim(p)]))
  // only people who actually hold teams take a finishing slot
  const ranked = people.filter((p) => p.teams && p.teams.length > 0)

  // Lone survivor: if exactly one person is still in the running, they've clinched the
  // sweep (they'll outlast everyone left) → crown them 1st now, before the actual final.
  const stillIn = ranked.filter((p) => !elimByPerson[p.id].settled)
  if (stillIn.length === 1) elimByPerson[stillIn[0].id] = { settled: true, champion: true, time: Infinity }

  // Standard competition ranking, range display. start = 1 + (# who outlasted me);
  // a tie group of size k shows start..start+k-1. null = not settled (still in).
  const placements = {}
  for (const p of people) {
    const me = elimByPerson[p.id]
    if (!me.settled) { placements[p.id] = null; continue }
    let above = 0, tie = 0
    for (const q of ranked) {
      const t = elimByPerson[q.id].time
      if (t > me.time) above++
      else if (t === me.time) tie++
    }
    placements[p.id] = { start: above + 1, end: above + tie, champion: me.champion }
  }
  const placementOf = (id) => placements[id] || null

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
    team, fixture, flag, gd, ownersOf, ownersForFixture, isTeamEliminated, isPersonEliminated, placementOf, fmtTime, fmtDate, fmtDayKey, fmtWeekday, todayKey,
  }
}
