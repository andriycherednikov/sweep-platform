import { createPool, createDb } from './db/client.js'
import { buildApp } from './app.js'
import { startListener } from './events/listen.js'

const pool = createPool()
const db = createDb(pool)
const app = buildApp(db, { logger: true })

// Bridge cross-process events (worker pg_notify) onto this api's bus → SSE clients.
await startListener(pool, app.bus)

const port = Number(process.env.PORT ?? 3000)
app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err)
  process.exit(1)
})
