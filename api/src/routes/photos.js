import { and, eq } from 'drizzle-orm'
import { photo } from '../db/schema.js'

export async function photoRoutes(app) {
  app.get('/api/photos', async (req) => {
    const conds = [eq(photo.status, 'approved')]
    if (req.query.team) conds.push(eq(photo.teamCode, req.query.team))
    const rows = await app.db.select().from(photo).where(and(...conds))
    return rows.map((p) => ({
      id: p.id, kind: p.kind, uploader: p.uploaderName, team: p.teamCode,
      caption: p.caption, src: `/photos/${p.filePath}`, status: p.status,
    }))
  })
}
