import { isExcluded } from './optout.js'
import { flattenEvent } from './db/event-shape.js'

export function serializeTeam(t) {
  return { code: t.code, name: t.name, group: t.group, pool: t.pool, color: t.color, logo: t.logo ?? null, strength: t.strength, squad: t.squad ?? null }
}
export function serializePerson(p) {
  return { id: p.id, name: p.name, short: p.short, initials: p.initials, av: p.avColor, avatarPath: p.avatarPath, adult: p.adult, excluded: isExcluded(p), createdAt: p.createdAt }
}
export function serializeFixture(f) {
  return {
    id: f.id, group: f.group, matchday: f.matchday, t1: f.t1Code, t2: f.t2Code,
    ko: f.kickoffUtc, venue: f.venue, city: f.city, status: f.status,
    score: f.score1 == null ? null : [f.score1, f.score2], minute: f.minute, phase: f.phase ?? null,
    prob: { a: f.probA, d: f.probD, b: f.probB },
    markets: f.markets ?? null,
    htScore: f.htScore1 == null ? null : [f.htScore1, f.htScore2],
    penScore: f.penScore1 == null ? null : [f.penScore1, f.penScore2],
    lineups: f.lineups ?? null,
    events: f.events ?? [],
    statistics: f.statistics ?? null,
    stage: f.stage, derby: f.derby, doubleOwner: f.doubleOwner,
    winnerCode: f.winnerCode ?? null,
  }
}
export function serializeCompetitor(c) {
  const m = c.meta ?? {}
  return { code: c.code, name: c.name, group: m.group ?? m.conference ?? null, pool: m.pool ?? null, color: c.color, logo: c.logo ?? null, strength: m.strength ?? null, squad: m.squad ?? null }
}
export function serializeEvent(row) {
  return serializeFixture(flattenEvent(row))
}
