import { createReadStream } from 'node:fs'
import { and, eq, desc } from 'drizzle-orm'
import { photo } from '../db/schema.js'
import { ADMIN_COOKIE, COOKIE_MAX_AGE, verifyPasscode, requireAdmin } from '../auth.js'

const loginBody = {
  type: 'object', required: ['passcode'], additionalProperties: false,
  properties: { passcode: { type: 'string', minLength: 1, maxLength: 200 } },
}

export async function adminRoutes(app) {
  const admin = requireAdmin(app)

  app.post('/api/admin/login', {
    schema: { body: loginBody },
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (req, reply) => {
    if (!verifyPasscode(req.body.passcode, app.adminHash)) return reply.code(401).send({ error: 'bad_passcode' })
    reply.setCookie(ADMIN_COOKIE, reply.signCookie('ok'), {
      httpOnly: true, sameSite: 'lax', path: '/', maxAge: COOKIE_MAX_AGE,
      secure: process.env.NODE_ENV === 'production',
    })
    return { admin: true }
  })

  app.post('/api/admin/logout', async (_req, reply) => {
    reply.clearCookie(ADMIN_COOKIE, { path: '/' })
    return { admin: false }
  })

  app.get('/api/admin/me', { preHandler: admin }, async () => ({ admin: true }))

  app.get('/api/admin/photos', { preHandler: admin }, async () => {
    const rows = await app.db.select().from(photo).orderBy(desc(photo.createdAt))
    const shape = (p) => ({
      id: p.id, kind: p.kind, uploader: p.uploaderName, person: p.personId, team: p.teamCode,
      caption: p.caption, status: p.status, createdAt: p.createdAt,
      fileUrl: `/api/admin/photos/${p.id}/file`,
    })
    return {
      pending: rows.filter((p) => p.status === 'pending').map(shape),
      approved: rows.filter((p) => p.status === 'approved').map(shape),
    }
  })

  app.get('/api/admin/photos/:id/file', { preHandler: admin }, async (req, reply) => {
    const [p] = await app.db.select().from(photo).where(eq(photo.id, req.params.id))
    if (!p) return reply.code(404).send({ error: 'not_found' })
    const path = p.status === 'approved' ? app.photos.approvedPath(p.filePath) : app.photos.pendingPath(p.filePath)
    reply.type('image/jpeg')
    return reply.send(createReadStream(path))
  })

  // moderation added in Task 7 (same file, reuse `admin`).
}
