import { generate } from './generate.js'
import * as s from '../db/schema.js'
import { createPool, createDb } from '../db/client.js'

export async function seed(db) {
  const g = generate()

  await db.insert(s.scoringConfig).values(g.scoring).onConflictDoNothing()

  for (const code of Object.keys(g.teams)) {
    const t = g.teams[code]
    await db.insert(s.team).values({
      code: t.code, name: t.name, group: t.group, pool: t.pool,
      color: t.color, strength: t.strength, flagCode: t.code,
    }).onConflictDoNothing()
    await db.insert(s.teamCrosswalk).values({ teamCode: t.code, providerTeamId: null }).onConflictDoNothing()
  }

  for (const p of g.people) {
    await db.insert(s.person).values({
      id: p.id, name: p.name, short: p.short, initials: p.initials, avColor: p.av,
    }).onConflictDoNothing()
    for (const tc of p.teams) {
      await db.insert(s.ownership).values({ personId: p.id, teamCode: tc }).onConflictDoNothing()
    }
  }

  for (const f of g.fixtures) {
    await db.insert(s.fixture).values({
      id: f.id, group: f.group, matchday: f.matchday, t1Code: f.t1, t2Code: f.t2,
      kickoffUtc: f.ko, venue: f.venue, city: f.city, status: f.status,
      score1: f.score?.[0] ?? null, score2: f.score?.[1] ?? null, minute: f.minute ?? null,
      probA: f.prob.a, probD: f.prob.d, probB: f.prob.b,
      stage: 'group', derby: !!f.derby, doubleOwner: (f.doubleOwners?.length ?? 0) > 0,
    }).onConflictDoUpdate({
      target: s.fixture.id,
      set: { status: f.status, score1: f.score?.[0] ?? null, score2: f.score?.[1] ?? null, minute: f.minute ?? null },
    })
  }

  for (const g2 of g.groups) {
    for (const t of g.standings[g2]) {
      await db.insert(s.standing).values({
        teamCode: t.code, played: t.played, win: t.win, draw: t.draw, loss: t.loss,
        gf: t.gf, ga: t.ga, pts: t.pts,
      }).onConflictDoUpdate({
        target: s.standing.teamCode,
        set: { played: t.played, win: t.win, draw: t.draw, loss: t.loss, gf: t.gf, ga: t.ga, pts: t.pts },
      })
    }
  }

  for (const ph of g.photos) {
    await db.insert(s.photo).values({
      id: ph.id, kind: 'fan', uploaderName: ph.uploader, teamCode: ph.team,
      filePath: `seed/${ph.id}.jpg`, caption: ph.caption, status: ph.status,
    }).onConflictDoNothing()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = createPool()
  await seed(createDb(pool))
  await pool.end()
  console.log('seed complete')
}
