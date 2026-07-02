import { eq } from 'drizzle-orm'
import { competitor, ranking } from '../db/schema.js'

export async function standingsRoutes(app) {
  app.get('/api/standings', async (req) => {
    const competitionId = req.sweep?.competitionId
    const [comps, rows] = await Promise.all([
      app.db.select().from(competitor).where(eq(competitor.competitionId, competitionId)),
      app.db.select().from(ranking).where(eq(ranking.competitionId, competitionId)),
    ])
    const byCode = Object.fromEntries(rows.map((r) => [r.competitorCode, { ...(r.stats ?? {}), pts: r.points }]))
    const tables = {}
    for (const t of comps) {
      const s = byCode[t.code] ?? { played: 0, win: 0, draw: 0, loss: 0, gf: 0, ga: 0, pts: 0 }
      ;(tables[t.meta?.group] ??= []).push({
        code: t.code, name: t.name, played: s.played ?? 0, win: s.win ?? 0, draw: s.draw ?? 0,
        loss: s.loss ?? 0, gf: s.gf ?? 0, ga: s.ga ?? 0, gd: (s.gf ?? 0) - (s.ga ?? 0), pts: s.pts ?? 0,
      })
    }
    for (const g of Object.keys(tables)) {
      tables[g].sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.name.localeCompare(y.name))
    }
    return tables
  })
}
