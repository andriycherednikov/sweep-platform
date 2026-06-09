import { team, standing } from '../db/schema.js'

export async function standingsRoutes(app) {
  app.get('/api/standings', async () => {
    const [teams, rows] = await Promise.all([
      app.db.select().from(team),
      app.db.select().from(standing),
    ])
    const byCode = Object.fromEntries(rows.map((r) => [r.teamCode, r]))
    const tables = {}
    for (const t of teams) {
      const s = byCode[t.code] ?? { played: 0, win: 0, draw: 0, loss: 0, gf: 0, ga: 0, pts: 0 }
      ;(tables[t.group] ??= []).push({
        code: t.code, name: t.name, played: s.played, win: s.win, draw: s.draw, loss: s.loss,
        gf: s.gf, ga: s.ga, gd: s.gf - s.ga, pts: s.pts,
      })
    }
    for (const g of Object.keys(tables)) {
      tables[g].sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.name.localeCompare(y.name))
    }
    return tables
  })
}
