import Fastify from 'fastify'
import { bootstrapRoutes } from './routes/bootstrap.js'
import { fixtureRoutes } from './routes/fixtures.js'

export function buildApp(db, opts = {}) {
  const app = Fastify({ logger: opts.logger ?? false })
  app.decorate('db', db)
  app.get('/api/health', async () => ({ ok: true }))
  app.register(bootstrapRoutes)
  app.register(fixtureRoutes)
  return app
}
