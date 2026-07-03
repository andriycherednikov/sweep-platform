import { mkdir, writeFile, access } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import sharp from 'sharp'
import { generate } from './generate.js'
import * as s from '../db/schema.js'
import { createPool, createDb } from '../db/client.js'

/** Generate placeholder image files for the seeded approved fan photos (CLI only). */
async function seedPhotoFiles(g) {
  const dir = join(resolve(process.env.PHOTOS_DIR ?? './photos-data'), 'approved', 'seed')
  await mkdir(dir, { recursive: true })
  const esc = (str) => str.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))
  for (const ph of g.photos) {
    if (ph.status !== 'approved') continue
    const file = join(dir, `${ph.id}.jpg`)
    try { await access(file); continue } catch { /* generate below */ }
    const color = g.teams[ph.team]?.color ?? '#12305c'
    const svg = `<svg width="1280" height="800" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#0b1f3a"/></linearGradient></defs><rect width="1280" height="800" fill="url(#g)"/><text x="64" y="540" font-family="Arial, sans-serif" font-size="96" font-weight="800" fill="rgba(255,255,255,.18)">FAN PHOTO</text><text x="64" y="724" font-family="Arial, sans-serif" font-size="48" font-weight="700" fill="#ffffff">${esc(ph.caption)}</text></svg>`
    await writeFile(file, await sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer())
  }
}

export async function seed(db) {
  const g = generate()

  const COMPETITION_ID = 'apifootball:1:2026'
  await db.insert(s.competition).values({
    id: COMPETITION_ID, provider: 'apifootball', sport: 'football', leagueId: '1',
    season: '2026', format: 'groups_then_ko', name: 'World Cup 2026',
  }).onConflictDoNothing()
  await db.insert(s.sweep).values({
    id: 'default', name: 'The Sweep', kind: 'default', scoringRule: 'top3',
    coOwners: 'all_win', competitionId: COMPETITION_ID,
  }).onConflictDoNothing()

  for (const code of Object.keys(g.teams)) {
    const t = g.teams[code]
    await db.insert(s.team).values({
      code: t.code, name: t.name, group: t.group, pool: t.pool,
      color: t.color, strength: t.strength, flagCode: t.code,
    }).onConflictDoNothing()
    await db.insert(s.teamCrosswalk).values({ teamCode: t.code, providerTeamId: null }).onConflictDoNothing()
    await db.insert(s.competitor).values({
      id: `cp_${t.code}`, competitionId: COMPETITION_ID, code: t.code, name: t.name,
      color: t.color, providerId: null, meta: { group: t.group, pool: t.pool, strength: t.strength },
    }).onConflictDoNothing()
  }

  for (const p of g.people) {
    await db.insert(s.person).values({
      id: p.id, sweepId: 'default', name: p.name, short: p.short, initials: p.initials, avColor: p.av,
    }).onConflictDoNothing()
    for (const tc of p.teams) {
      await db.insert(s.ownership).values({ sweepId: 'default', personId: p.id, competitorId: `cp_${tc}` }).onConflictDoNothing()
    }
  }

  for (const f of g.fixtures) {
    await db.insert(s.fixture).values({
      id: f.id, group: f.group, matchday: f.matchday, t1Code: f.t1, t2Code: f.t2,
      kickoffUtc: f.ko, venue: f.venue, city: f.city, status: f.status,
      score1: f.score?.[0] ?? null, score2: f.score?.[1] ?? null, minute: f.minute ?? null,
      probA: f.prob.a, probD: f.prob.d, probB: f.prob.b,
      markets: f.markets, htScore1: f.ht?.[0] ?? null, htScore2: f.ht?.[1] ?? null,
      stage: 'group', derby: !!f.derby, doubleOwner: (f.doubleOwners?.length ?? 0) > 0,
    }).onConflictDoUpdate({
      target: s.fixture.id,
      set: { status: f.status, score1: f.score?.[0] ?? null, score2: f.score?.[1] ?? null, minute: f.minute ?? null,
        markets: f.markets, htScore1: f.ht?.[0] ?? null, htScore2: f.ht?.[1] ?? null },
    })

    const detail = {
      group: f.group, matchday: f.matchday, venue: f.venue, city: f.city,
      prob: f.prob, markets: f.markets ?? null,
      ht: f.ht ?? null, derby: !!f.derby, doubleOwner: (f.doubleOwners?.length ?? 0) > 0,
    }
    await db.insert(s.event).values({
      id: f.id, competitionId: COMPETITION_ID, c1Code: f.t1, c2Code: f.t2,
      startUtc: f.ko, status: f.status,
      score1: f.score?.[0] ?? null, score2: f.score?.[1] ?? null,
      stage: 'group', detail,
    }).onConflictDoUpdate({
      target: s.event.id,
      set: { status: f.status, score1: f.score?.[0] ?? null, score2: f.score?.[1] ?? null, detail },
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

      await db.insert(s.ranking).values({
        competitionId: COMPETITION_ID, competitorCode: t.code, points: t.pts,
        stats: { played: t.played, win: t.win, draw: t.draw, loss: t.loss, gf: t.gf, ga: t.ga },
      }).onConflictDoUpdate({
        target: [s.ranking.competitionId, s.ranking.competitorCode],
        set: { points: t.pts, stats: { played: t.played, win: t.win, draw: t.draw, loss: t.loss, gf: t.gf, ga: t.ga } },
      })
    }
  }

  for (const ph of g.photos) {
    await db.insert(s.photo).values({
      id: ph.id, sweepId: 'default', kind: 'fan', uploaderName: ph.uploader, fixtureId: ph.fixtureId,
      filePath: `seed/${ph.id}.jpg`, caption: ph.caption, status: ph.status,
    }).onConflictDoNothing()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = createPool()
  await seed(createDb(pool))
  await seedPhotoFiles(generate())
  await pool.end()
  console.log('seed complete')
}
