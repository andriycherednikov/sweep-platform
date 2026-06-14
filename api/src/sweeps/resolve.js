import { eq } from 'drizzle-orm'
import { sweep } from '../db/schema.js'
import { SWEEP_COOKIE, parseSweepCookie } from './auth.js'
import { DEFAULT_SWEEP_ID } from './constants.js'

/** preHandler factory: sets req.sweep (row|null) and req.role ('member'|'admin'|null). */
export function sweepResolver(app) {
  return async (req) => {
    req.sweep = null
    req.role = null
    const onPlatform = req.headers.host === app.platformHost

    let session = null
    const raw = req.cookies?.[SWEEP_COOKIE]
    if (raw) {
      const un = app.unsignCookie(raw)
      if (un.valid) session = parseSweepCookie(un.value)
    }

    if (onPlatform) {
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
    req.role = session && session.sweepId === DEFAULT_SWEEP_ID ? session.role : 'member'
  }
}
