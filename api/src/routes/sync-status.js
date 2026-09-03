import { and, eq, ne, desc, isNull } from 'drizzle-orm'
import { syncLog } from '../db/schema.js'

const STALE_MS = 18 * 3600_000

export async function syncStatusRoutes(app) {
  app.get('/api/sync-status', async (req) => {
    // Scoped to the sweep's own competition: before this, sync_log carried no
    // competition and the newest row anywhere answered for everyone, so one healthy
    // competition made every other sweep report fresh. Rows written before the column
    // existed are null — they answer only where there is no competition in scope.
    const competitionId = req.sweep?.competitionId ?? null
    const forThisCompetition = competitionId
      ? eq(syncLog.competitionId, competitionId)
      : isNull(syncLog.competitionId)

    const newest = async (where) => {
      const rows = await app.db.select().from(syncLog)
        .where(and(forThisCompetition, where))
        .orderBy(desc(syncLog.ranAt)).limit(1)
      return rows[0] ?? null
    }
    const ok = (kind) => and(eq(syncLog.kind, kind), eq(syncLog.status, 'ok'))

    const [baseline, live, failed] = await Promise.all([
      newest(ok('baseline')),
      newest(ok('live')),
      // The other half of the old blindness: the query filtered to status='ok', so a
      // failing feed had no way to say so. Report the newest failure alongside the
      // freshness rather than folding it into `stale` — 2h-old data is not stale just
      // because the last poll errored, and an operator needs to see both facts.
      newest(ne(syncLog.status, 'ok')),
    ])

    const lastBaselineAt = baseline?.ranAt ?? null
    return {
      stale: !lastBaselineAt || (Date.now() - new Date(lastBaselineAt).getTime() > STALE_MS),
      lastBaselineAt,
      lastLiveAt: live?.ranAt ?? null,
      lastError: failed ? { kind: failed.kind, at: failed.ranAt, error: failed.error } : null,
    }
  })
}
