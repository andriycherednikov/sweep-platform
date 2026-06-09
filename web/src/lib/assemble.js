import { flag, gd, fmtTime, fmtDay, fmtDayKey, fmtWeekday } from './format.js'

function outlookFor(s) {
  return s >= 86 ? 'Title contender' : s >= 80 ? 'Last-8 shout' : s >= 73 ? 'Knockout dark horse' : s >= 66 ? 'Group toss-up' : 'Long shot'
}
function titleOddsFor(s) {
  return Math.max(1, Math.round(Math.pow(Math.max(0, s - 50), 2) / 14))
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
      prob: f.prob, stage: f.stage, derby, doubleOwners,
      timeLabel: fmtTime(ko), dayLabel: fmtDay(ko), dayKey: fmtDayKey(ko),
    }
  })
  fixtures.sort((a, b) => a.ko - b.ko)
  const ownersForFixture = (f) => ({ t1: ownersOf(f.t1), t2: ownersOf(f.t2) })
  const derbies = fixtures.filter((f) => f.derby)

  // live / next match (real data: first live, else first upcoming, else first)
  const liveMatch = fixtures.find((f) => f.status === 'live') || null
  const nextMatch = fixtures.find((f) => f.status === 'upcoming') || fixtures[0] || null

  // "in the money": rank people by their best owned team's strength
  const money = people.map((p) => {
    const best = p.teams.map((c) => teams[c]).filter(Boolean).sort((a, b) => b.strength - a.strength)[0]
    return { person: p, team: best || null, odds: best ? best.titleOdds : 0, strength: best ? best.strength : 0 }
  }).sort((a, b) => b.strength - a.strength)
  money.forEach((m, i) => { m.rank = i + 1; m.tag = i === 0 ? 'Title fav' : m.strength >= 70 ? 'Alive' : 'Outside' })

  // photos (already approved-only from the API)
  const photos = (rawPhotos || []).map((ph) => ({
    id: ph.id, uploader: ph.uploader, team: ph.team, caption: ph.caption, status: ph.status, src: ph.src, kind: ph.kind,
  }))

  const todayKey = fmtDayKey(new Date())

  return {
    teams, teamList, groups, people, peopleById, fixtures, standings, photos, derbies, money,
    nextMatch, liveMatch, scoring: bootstrap.scoring,
    team, flag, gd, ownersOf, ownersForFixture, fmtTime, fmtDay, fmtDayKey, fmtWeekday, todayKey,
  }
}
