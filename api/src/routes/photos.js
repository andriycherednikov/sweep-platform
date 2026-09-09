import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { photo, person } from '../db/schema.js'
import { eventInCompetition } from '../db/event-shape.js'
import { validateUpload, processImage } from '../photos/process.js'
import { requireSweep, requirePerson } from '../sweeps/auth.js'

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

  app.post('/api/photos', { preHandler: [member, requirePerson(app)] }, async (req, reply) => {
    const sweepId = req.sweep.id
    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'missing_file' })
    const fields = data.fields
    const val = (k) => (fields[k] && typeof fields[k].value === 'string' ? fields[k].value : undefined)
    const kind = val('kind')
    // Both the uploader and the subject are the caller. Nobody can see a sweep without
    // a seat in it, so the name was already known — asking for it in the form only
    // created a field the server then believed.
    const personId = req.person.id
    const uploaderName = req.person.name
    const fixtureId = val('fixtureId'), caption = val('caption') ?? null

    if (kind !== 'fan' && kind !== 'profile') return reply.code(400).send({ error: 'bad_kind' })

    const buf = await data.toBuffer()
    if (data.file.truncated) return reply.code(400).send({ error: 'file too large (8 MB max)' })
    const verr = validateUpload(data.mimetype, buf.length)
    if (verr) return reply.code(400).send({ error: verr })

    // Tagging a game is optional — a photo of the group watching is still a photo of
    // the sweep. A tag that IS supplied still has to be a game in this competition.
    if (kind === 'fan' && fixtureId) {
      const fx = await eventInCompetition(app.db, req.sweep.competitionId, fixtureId)
      if (!fx) return reply.code(400).send({ error: 'unknown_fixture' })
    }

    const { buffer, thumb, ext } = await processImage(buf, kind)
    const id = randomUUID()
    const fileName = `${id}.${ext}`
    const thumbName = `${id}_t.${ext}`

    // A profile photo replaces the one it supersedes — a person has one face, and the
    // old file should not outlive it on disk.
    if (kind === 'profile') {
      const prior = await app.db.select().from(photo)
        .where(and(eq(photo.kind, 'profile'), eq(photo.personId, personId), eq(photo.status, 'approved'), eq(photo.sweepId, sweepId)))
      for (const old of prior) {
        await app.photos.removeApproved(old.filePath).catch(() => {})
        if (old.thumbPath) await app.photos.removeApproved(old.thumbPath).catch(() => {})
        await app.db.update(photo).set({ status: 'removed', moderatedAt: new Date() }).where(eq(photo.id, old.id))
      }
    }

    await app.photos.writeApproved(fileName, buffer)
    await app.photos.writeApproved(thumbName, thumb)
    await app.db.insert(photo).values({
      id, sweepId, kind, uploaderName,
      personId: kind === 'profile' ? personId : null,
      fixtureId: kind === 'fan' ? (fixtureId ?? null) : null,
      filePath: fileName, thumbPath: thumbName, caption, status: 'approved', moderatedAt: new Date(),
    })
    if (kind === 'profile') {
      await app.db.update(person).set({ avatarPath: `/photos/${fileName}` }).where(and(eq(person.id, personId), eq(person.sweepId, sweepId)))
    }
    await app.publish({ type: 'photo-approved', sweepId, id, kind, ...(kind === 'fan' ? { fixtureId: fixtureId ?? null } : { person: personId }) })
    return reply.code(201).send({ id, kind, status: 'approved', fixtureId: fixtureId ?? null, personId: personId ?? null })
  })
}
