import { createReadStream } from 'node:fs'
import { and, eq, desc } from 'drizzle-orm'
import { photo, person } from '../db/schema.js'
import { verifyPasscode } from '../auth.js'
import { settleStaleBets } from '../coins/settle.js'
import { SWEEP_COOKIE, COOKIE_MAX_AGE, signSweepCookie, requireSweep } from '../sweeps/auth.js'
import { DEFAULT_SWEEP_ID } from '../sweeps/constants.js'

const loginBody = {
  type: 'object', required: ['passcode'], additionalProperties: false,
  properties: { passcode: { type: 'string', minLength: 1, maxLength: 200 } },
}

export async function adminRoutes(app) {
  const admin = requireSweep(['admin'])

  app.post('/api/admin/login', {
    schema: { body: loginBody },
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (req, reply) => {
    if (!verifyPasscode(req.body.passcode, app.adminHash)) return reply.code(401).send({ error: 'bad_passcode' })
    reply.setCookie(SWEEP_COOKIE, reply.signCookie(signSweepCookie(DEFAULT_SWEEP_ID, 'admin')), {
      httpOnly: true, sameSite: 'lax', path: '/', maxAge: COOKIE_MAX_AGE,
      secure: process.env.NODE_ENV === 'production',
    })
    return { admin: true }
  })

  app.post('/api/admin/logout', async (_req, reply) => {
    reply.clearCookie(SWEEP_COOKIE, { path: '/' })
    return { admin: false }
  })

  app.get('/api/admin/me', { preHandler: admin }, async () => ({ admin: true }))

  // Safety net: settle any open bets stuck on already-final fixtures (the worker only
  // grades at the moment a match flips final, so a missed transition leaves them stale).
  app.post('/api/admin/settle-stale', { preHandler: admin }, async () => {
    const swept = await settleStaleBets(app.db, app.publish)
    return { swept }
  })

  app.get('/api/admin/photos', { preHandler: admin }, async (req) => {
    const rows = await app.db.select().from(photo).where(eq(photo.sweepId, req.sweep.id)).orderBy(desc(photo.createdAt))
    const shape = (p) => ({
      id: p.id, kind: p.kind, uploader: p.uploaderName, person: p.personId, fixtureId: p.fixtureId,
      caption: p.caption, status: p.status, createdAt: p.createdAt,
      fileUrl: `/api/admin/photos/${p.id}/file`,
    })
    return {
      pending: rows.filter((p) => p.status === 'pending').map(shape),
      approved: rows.filter((p) => p.status === 'approved').map(shape),
    }
  })

  app.get('/api/admin/photos/:id/file', { preHandler: admin }, async (req, reply) => {
    const [p] = await app.db.select().from(photo).where(and(eq(photo.id, req.params.id), eq(photo.sweepId, req.sweep.id)))
    if (!p) return reply.code(404).send({ error: 'not_found' })
    const path = p.status === 'approved' ? app.photos.approvedPath(p.filePath) : app.photos.pendingPath(p.filePath)
    reply.type('image/jpeg')
    return reply.send(createReadStream(path))
  })

  const moderateBody = {
    type: 'object', required: ['action'], additionalProperties: false,
    properties: { action: { type: 'string', enum: ['approve', 'reject', 'remove'] } },
  }

  app.post('/api/admin/photos/:id', { preHandler: admin, schema: { body: moderateBody } }, async (req, reply) => {
    const { id } = req.params
    const { action } = req.body
    const [p] = await app.db.select().from(photo).where(and(eq(photo.id, id), eq(photo.sweepId, req.sweep.id)))
    if (!p) return reply.code(404).send({ error: 'not_found' })

    if (action === 'approve') {
      // supersede a prior approved profile photo for this person
      if (p.kind === 'profile') {
        const prior = await app.db.select().from(photo)
          .where(and(eq(photo.kind, 'profile'), eq(photo.personId, p.personId), eq(photo.status, 'approved'), eq(photo.sweepId, req.sweep.id)))
        for (const old of prior) {
          await app.photos.removeApproved(old.filePath)
          await app.db.update(photo).set({ status: 'removed', moderatedAt: new Date() }).where(eq(photo.id, old.id))
        }
      }
      await app.photos.moveToApproved(p.filePath)
      if (p.thumbPath) await app.photos.moveToApproved(p.thumbPath).catch(() => {})
      await app.db.update(photo).set({ status: 'approved', moderatedAt: new Date() }).where(eq(photo.id, id))
      if (p.kind === 'profile') {
        await app.db.update(person).set({ avatarPath: `/photos/${p.filePath}` }).where(and(eq(person.id, p.personId), eq(person.sweepId, req.sweep.id)))
      }
      await app.publish({ type: 'photo-approved', sweepId: req.sweep.id, id, kind: p.kind, ...(p.kind === 'fan' ? { fixtureId: p.fixtureId } : { person: p.personId }) })
      return { id, status: 'approved' }
    }

    if (action === 'reject') {
      await app.photos.removePending(p.filePath)
      if (p.thumbPath) await app.photos.removePending(p.thumbPath).catch(() => {})
      await app.db.update(photo).set({ status: 'rejected', moderatedAt: new Date() }).where(eq(photo.id, id))
      return { id, status: 'rejected' }
    }

    // remove (an approved photo)
    await app.photos.removeApproved(p.filePath)
    if (p.thumbPath) await app.photos.removeApproved(p.thumbPath).catch(() => {})
    await app.db.update(photo).set({ status: 'removed', moderatedAt: new Date() }).where(eq(photo.id, id))
    if (p.kind === 'profile' && p.personId) {
      await app.db.update(person).set({ avatarPath: null }).where(and(eq(person.id, p.personId), eq(person.sweepId, req.sweep.id)))
    }
    await app.publish({ type: 'photo-removed', sweepId: req.sweep.id, id, kind: p.kind, ...(p.kind === 'fan' ? { fixtureId: p.fixtureId } : { person: p.personId }) })
    return { id, status: 'removed' }
  })
}
