import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { photo, person, event } from '../db/schema.js'
import { validateUpload, processImage } from '../photos/process.js'
import { requireSweep } from '../sweeps/auth.js'

export async function photoRoutes(app) {
  const member = requireSweep(['member', 'admin'])

  app.get('/api/photos', { preHandler: member }, async (req) => {
    const conds = [eq(photo.status, 'approved'), eq(photo.sweepId, req.sweep.id)]
    if (req.query.fixture) conds.push(eq(photo.fixtureId, req.query.fixture))
    const rows = await app.db.select().from(photo).where(and(...conds))
    return rows.map((p) => ({
      id: p.id, kind: p.kind, uploader: p.uploaderName, fixtureId: p.fixtureId,
      caption: p.caption, src: `/photos/${p.filePath}`, status: p.status,
    }))
  })

  app.post('/api/photos', { preHandler: member }, async (req, reply) => {
    const sweepId = req.sweep.id
    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'missing_file' })
    const fields = data.fields
    const val = (k) => (fields[k] && typeof fields[k].value === 'string' ? fields[k].value : undefined)
    const kind = val('kind'), uploaderName = val('uploaderName')
    const personId = val('personId'), fixtureId = val('fixtureId'), caption = val('caption') ?? null

    if (kind !== 'fan' && kind !== 'profile') return reply.code(400).send({ error: 'bad_kind' })
    if (!uploaderName) return reply.code(400).send({ error: 'missing_uploader' })

    const buf = await data.toBuffer()
    if (data.file.truncated) return reply.code(400).send({ error: 'file too large (8 MB max)' })
    const verr = validateUpload(data.mimetype, buf.length)
    if (verr) return reply.code(400).send({ error: verr })

    if (kind === 'fan') {
      if (!fixtureId) return reply.code(400).send({ error: 'missing_fixture' })
      const [fx] = await app.db.select().from(event).where(eq(event.id, fixtureId))
      if (!fx) return reply.code(400).send({ error: 'unknown_fixture' })
    } else {
      if (!personId) return reply.code(400).send({ error: 'missing_person' })
      const [p] = await app.db.select().from(person).where(and(eq(person.id, personId), eq(person.sweepId, sweepId)))
      if (!p) return reply.code(400).send({ error: 'unknown_person' })
    }

    // one pending per person per kind (moderation mode only — auto-approve never queues)
    if (!app.autoApprovePhotos) {
      const dupConds = [eq(photo.status, 'pending'), eq(photo.kind, kind), eq(photo.sweepId, sweepId)]
      dupConds.push(kind === 'profile' ? eq(photo.personId, personId) : eq(photo.uploaderName, uploaderName))
      const dup = await app.db.select().from(photo).where(and(...dupConds))
      if (dup.length) return reply.code(409).send({ error: 'pending_exists' })
    }

    const { buffer, thumb, ext } = await processImage(buf, kind)
    const id = randomUUID()
    const fileName = `${id}.${ext}`
    const thumbName = `${id}_t.${ext}`
    await app.photos.writePending(fileName, buffer)
    await app.photos.writePending(thumbName, thumb)

    if (app.autoApprovePhotos) {
      // skip the moderation queue: move straight to approved and go live immediately
      if (kind === 'profile') {
        // supersede the person's prior approved profile photo
        const prior = await app.db.select().from(photo)
          .where(and(eq(photo.kind, 'profile'), eq(photo.personId, personId), eq(photo.status, 'approved'), eq(photo.sweepId, sweepId)))
        for (const old of prior) {
          await app.photos.removeApproved(old.filePath).catch(() => {})
          await app.db.update(photo).set({ status: 'removed', moderatedAt: new Date() }).where(eq(photo.id, old.id))
        }
      }
      await app.photos.moveToApproved(fileName)
      await app.photos.moveToApproved(thumbName).catch(() => {})
      await app.db.insert(photo).values({
        id, sweepId, kind, uploaderName,
        personId: kind === 'profile' ? personId : null,
        fixtureId: kind === 'fan' ? fixtureId : null,
        filePath: fileName, thumbPath: thumbName, caption, status: 'approved', moderatedAt: new Date(),
      })
      if (kind === 'profile') {
        await app.db.update(person).set({ avatarPath: `/photos/${fileName}` }).where(and(eq(person.id, personId), eq(person.sweepId, sweepId)))
      }
      await app.publish({ type: 'photo-approved', sweepId, id, kind, ...(kind === 'fan' ? { fixtureId } : { person: personId }) })
      return reply.code(201).send({ id, kind, status: 'approved', fixtureId: fixtureId ?? null, personId: personId ?? null })
    }

    await app.db.insert(photo).values({
      id, sweepId, kind, uploaderName,
      personId: kind === 'profile' ? personId : null,
      fixtureId: kind === 'fan' ? fixtureId : null,
      filePath: fileName, thumbPath: thumbName, caption, status: 'pending',
    })
    // signal admins' moderation badge to refresh (no payload — count is fetched with creds)
    await app.publish({ type: 'photo-pending', sweepId: req.sweep.id })
    return reply.code(201).send({ id, kind, status: 'pending', fixtureId: fixtureId ?? null, personId: personId ?? null })
  })
}
