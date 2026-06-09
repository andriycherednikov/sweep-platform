import Fastify from 'fastify'
import { bootstrapRoutes } from './routes/bootstrap.js'
import { fixtureRoutes } from './routes/fixtures.js'
import { standingsRoutes } from './routes/standings.js'
import { peopleRoutes } from './routes/people.js'
import { teamRoutes } from './routes/teams.js'
import { photoRoutes } from './routes/photos.js'

export function buildApp(db, opts = {}) {
  const app = Fastify({ logger: opts.logger ?? false })
  app.decorate('db', db)
  app.get('/api/health', async () => ({ ok: true }))
  app.register(bootstrapRoutes)
  app.register(fixtureRoutes)
  app.register(standingsRoutes)
  app.register(peopleRoutes)
  app.register(teamRoutes)
  app.register(photoRoutes)
  return app
}
