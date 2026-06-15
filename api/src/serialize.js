export function serializeTeam(t) {
  return { code: t.code, name: t.name, group: t.group, pool: t.pool, color: t.color, strength: t.strength, squad: t.squad ?? null }
}
export function serializePerson(p) {
  return { id: p.id, name: p.name, short: p.short, initials: p.initials, av: p.avColor, avatarPath: p.avatarPath, createdAt: p.createdAt }
}
export function serializeFixture(f) {
  return {
    id: f.id, group: f.group, matchday: f.matchday, t1: f.t1Code, t2: f.t2Code,
    ko: f.kickoffUtc, venue: f.venue, city: f.city, status: f.status,
    score: f.score1 == null ? null : [f.score1, f.score2], minute: f.minute,
    prob: { a: f.probA, d: f.probD, b: f.probB },
    lineups: f.lineups ?? null,
    events: f.events ?? [],
    stage: f.stage, derby: f.derby, doubleOwner: f.doubleOwner,
  }
}
