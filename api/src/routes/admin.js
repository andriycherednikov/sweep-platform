import { and, eq, desc } from 'drizzle-orm'
import { photo, person, sweep } from '../db/schema.js'
import { settleStaleBets } from '../wagering/settle.js'
import { openBetsBySweep } from '../wagering/ledger.js'
import { requireSweep } from '../sweeps/auth.js'

export async function adminRoutes(app) {
  // Admin of this sweep = the account that owns it (sweeps/resolve.js derives the role
  // per request). There is no passcode to hold any more.
  const admin = requireSweep(['admin'])

  app.get('/api/admin/me', { preHandler: admin }, async () => ({ admin: true }))

  // Safety net: settle any open bets stuck on already-final fixtures (the worker only
  // grades at the moment a match flips final, so a missed transition leaves them stale).
  app.post('/api/admin/settle-stale', { preHandler: admin }, async () => {
    const swept = await settleStaleBets(app.db, app.publish)
    return { swept }
  })

  const wageringBody = { type: 'object', required: ['enabled'], additionalProperties: false, properties: { enabled: { type: 'boolean' } } }
  app.post('/api/admin/wagering', { preHandler: admin, schema: { body: wageringBody } }, async (req) => {
    await app.db.update(sweep).set({ wageringEnabled: req.body.enabled }).where(eq(sweep.id, req.sweep.id))
    return { wageringEnabled: req.body.enabled }
  })

  // Audit view of every open (unresolved) bet in the sweep, grouped by person, so the admin
  // can confirm nothing is left unsettled — bets stuck on already-final matches are flagged.
  app.get('/api/admin/open-bets', { preHandler: admin }, async (req) => {
    return openBetsBySweep(app.db, req.sweep.id)
  })

  // Every photo in the sweep, newest first. There is no queue to divide them into, and
  // they are already public at /photos/<file> — the same bytes the team pages render —
  // so there is nothing here to serve behind a credential either.
  app.get('/api/admin/photos', { preHandler: admin }, async (req) => {
    const rows = await app.db.select().from(photo)
      .where(and(eq(photo.sweepId, req.sweep.id), eq(photo.status, 'approved')))
      .orderBy(desc(photo.createdAt))
    return rows.map((p) => ({
      id: p.id, kind: p.kind, uploader: p.uploaderName, person: p.personId, fixtureId: p.fixtureId,
      caption: p.caption, createdAt: p.createdAt, src: `/photos/${p.filePath}`,
    }))
  })

  /** Take a photo down. The only thing that ever happens to one after it is uploaded. */
  app.delete('/api/admin/photos/:id', { preHandler: admin }, async (req, reply) => {
    const { id } = req.params
    const [p] = await app.db.select().from(photo).where(and(eq(photo.id, id), eq(photo.sweepId, req.sweep.id)))
    if (!p) return reply.code(404).send({ error: 'not_found' })

    await app.photos.removeApproved(p.filePath).catch(() => {})
    if (p.thumbPath) await app.photos.removeApproved(p.thumbPath).catch(() => {})
    await app.db.update(photo).set({ status: 'removed', moderatedAt: new Date() }).where(eq(photo.id, id))
    if (p.kind === 'profile' && p.personId) {
      await app.db.update(person).set({ avatarPath: null }).where(and(eq(person.id, p.personId), eq(person.sweepId, req.sweep.id)))
    }
    await app.publish({ type: 'photo-removed', sweepId: req.sweep.id, id, kind: p.kind, ...(p.kind === 'fan' ? { fixtureId: p.fixtureId } : { person: p.personId }) })
    return { id, removed: true }
  })
}
