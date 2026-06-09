import { and, eq, desc } from 'drizzle-orm'
import { syncLog } from '../db/schema.js'

const STALE_MS = 18 * 3600_000

export async function syncStatusRoutes(app) {
  app.get('/api/sync-status', async () => {
    const newest = async (kind) => {
      const rows = await app.db.select().from(syncLog)
        .where(and(eq(syncLog.kind, kind), eq(syncLog.status, 'ok')))
        .orderBy(desc(syncLog.ranAt)).limit(1)
      return rows[0]?.ranAt ?? null
    }
    const [lastBaselineAt, lastLiveAt] = await Promise.all([newest('baseline'), newest('live')])
    const stale = !lastBaselineAt || (Date.now() - new Date(lastBaselineAt).getTime() > STALE_MS)
    return { stale, lastBaselineAt, lastLiveAt }
  })
}
