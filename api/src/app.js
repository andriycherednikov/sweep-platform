import Fastify from 'fastify'
import { bootstrapRoutes } from './routes/bootstrap.js'
import { fixtureRoutes } from './routes/fixtures.js'
import { standingsRoutes } from './routes/standings.js'
import { peopleRoutes } from './routes/people.js'
import { teamRoutes } from './routes/teams.js'
import { photoRoutes } from './routes/photos.js'
import { syncStatusRoutes } from './routes/sync-status.js'
import { streamRoutes } from './routes/stream.js'
import { socialRoutes } from './routes/social.js'
import { createBus } from './events/bus.js'
import multipart from '@fastify/multipart'
import fstatic from '@fastify/static'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import { resolve } from 'node:path'
import { createStorageSync } from './photos/storage.js'
import { MAX_BYTES } from './photos/process.js'
import { adminRoutes } from './routes/admin.js'
import { sweepsRoutes } from './routes/sweeps.js'
import { sweepResolver } from './sweeps/resolve.js'

export function buildApp(db, opts = {}) {
  const app = Fastify({ logger: opts.logger ?? false })
  app.decorate('db', db)
  app.decorate('bus', opts.bus ?? createBus())
  app.decorate('publish', opts.publish ?? ((event) => app.bus.publish(event)))

  const photosDir = resolve(opts.photosDir ?? process.env.PHOTOS_DIR ?? './photos-data')
  const store = createStorageSync(photosDir)
  app.decorate('photos', store)
  app.register(multipart, { limits: { fileSize: MAX_BYTES, files: 1 } })
  // serve approved/ at /photos (in prod Caddy does this; harmless to also expose here)
  app.register(fstatic, { root: store.approvedDir, prefix: '/photos/', decorateReply: false })

  app.decorate('adminHash', opts.adminHash ?? process.env.ADMIN_PASSCODE ?? '')
  app.decorate('sessionSecret', opts.sessionSecret ?? process.env.SESSION_SECRET ?? 'dev-insecure-secret')
  app.decorate('platformHost', opts.platformHost ?? process.env.PLATFORM_HOST ?? 'worldcupsweep.yowiebay.au')
  app.register(cookie, { secret: opts.sessionSecret ?? process.env.SESSION_SECRET ?? 'dev-insecure-secret' })
  app.register(rateLimit, { global: false })

  app.get('/api/health', async () => ({ ok: true }))
  app.addHook('preHandler', sweepResolver(app))
  app.get('/api/whoami', async (req) => ({ sweepId: req.sweep?.id ?? null, role: req.role ?? null }))
  app.register(bootstrapRoutes)
  app.register(fixtureRoutes)
  app.register(standingsRoutes)
  app.register(peopleRoutes)
  app.register(teamRoutes)
  app.register(photoRoutes)
  app.register(syncStatusRoutes)
  app.register(streamRoutes)
  app.register(socialRoutes)
  app.register(adminRoutes)
  app.register(sweepsRoutes)
  return app
}
