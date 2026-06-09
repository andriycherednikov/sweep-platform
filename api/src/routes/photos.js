import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { photo, person, team } from '../db/schema.js'
import { validateUpload, processImage } from '../photos/process.js'

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

  app.post('/api/photos', async (req, reply) => {
    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'missing_file' })
    const fields = data.fields
    const val = (k) => (fields[k] && typeof fields[k].value === 'string' ? fields[k].value : undefined)
    const kind = val('kind'), uploaderName = val('uploaderName')
    const personId = val('personId'), teamCode = val('teamCode'), caption = val('caption') ?? null

    if (kind !== 'fan' && kind !== 'profile') return reply.code(400).send({ error: 'bad_kind' })
    if (!uploaderName) return reply.code(400).send({ error: 'missing_uploader' })

    const buf = await data.toBuffer()
    if (data.file.truncated) return reply.code(400).send({ error: 'file too large (8 MB max)' })
    const verr = validateUpload(data.mimetype, buf.length)
    if (verr) return reply.code(400).send({ error: verr })

    if (kind === 'fan') {
      if (!teamCode) return reply.code(400).send({ error: 'missing_team' })
      const [t] = await app.db.select().from(team).where(eq(team.code, teamCode))
      if (!t) return reply.code(400).send({ error: 'unknown_team' })
    } else {
      if (!personId) return reply.code(400).send({ error: 'missing_person' })
      const [p] = await app.db.select().from(person).where(eq(person.id, personId))
      if (!p) return reply.code(400).send({ error: 'unknown_person' })
    }

    // one pending per person per kind
    const dupConds = [eq(photo.status, 'pending'), eq(photo.kind, kind)]
    dupConds.push(kind === 'profile' ? eq(photo.personId, personId) : eq(photo.uploaderName, uploaderName))
    const dup = await app.db.select().from(photo).where(and(...dupConds))
    if (dup.length) return reply.code(409).send({ error: 'pending_exists' })

    const { buffer, thumb, ext } = await processImage(buf, kind)
    const id = randomUUID()
    const fileName = `${id}.${ext}`
    const thumbName = `${id}_t.${ext}`
    await app.photos.writePending(fileName, buffer)
    await app.photos.writePending(thumbName, thumb)

    await app.db.insert(photo).values({
      id, kind, uploaderName,
      personId: kind === 'profile' ? personId : null,
      teamCode: kind === 'fan' ? teamCode : null,
      filePath: fileName, thumbPath: thumbName, caption, status: 'pending',
    })
    return reply.code(201).send({ id, kind, status: 'pending', teamCode: teamCode ?? null, personId: personId ?? null })
  })
}
