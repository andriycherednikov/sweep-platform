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

export function buildApp(db, opts = {}) {
  const app = Fastify({ logger: opts.logger ?? false })
  app.decorate('db', db)
  app.decorate('bus', opts.bus ?? createBus())
  app.decorate('publish', opts.publish ?? ((event) => app.bus.publish(event)))
  app.get('/api/health', async () => ({ ok: true }))
  app.register(bootstrapRoutes)
  app.register(fixtureRoutes)
  app.register(standingsRoutes)
  app.register(peopleRoutes)
  app.register(teamRoutes)
  app.register(photoRoutes)
  app.register(syncStatusRoutes)
  app.register(streamRoutes)
  app.register(socialRoutes)
  return app
}
