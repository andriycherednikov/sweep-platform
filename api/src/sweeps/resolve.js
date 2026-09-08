import { eq } from 'drizzle-orm'
import { sweep } from '../db/schema.js'
import { readSweepList } from './auth.js'
import { DEFAULT_SWEEP_ID } from './constants.js'

/** preHandler factory: sets req.sweep (row|null) and req.role ('member'|'admin'|null). */
export function sweepResolver(app) {
  return async (req) => {
    req.sweep = null
    req.role = null
    const onPlatform = req.headers.host === app.platformHost

    const list = readSweepList(app, req)
    // Which of the browser's sweeps this request is for. The header is how every fetch
    // says it (client.js); the query param is for EventSource, which cannot set headers.
    // Naming none is the old behaviour — the most recently used one.
    const want = req.headers['x-sweep-id'] || req.query?.sweep
    const session = list && (want ? list.find((e) => e.sweepId === want) : list[0])

    if (onPlatform) {
      // A named sweep this browser does not hold is unauthorized, never a silent
      // fallback to a different one — that would drop someone into another group's sweep.
      if (!session) return
      const [row] = await app.db.select().from(sweep).where(eq(sweep.id, session.sweepId))
      if (!row || row.archivedAt) return
      req.sweep = row
      req.role = session.role
      return
    }

    const [row] = await app.db.select().from(sweep).where(eq(sweep.id, DEFAULT_SWEEP_ID))
    if (!row) return
    req.sweep = row
    req.role = list?.find((e) => e.sweepId === DEFAULT_SWEEP_ID)?.role ?? 'member'
  }
}
