import { expect, test, afterAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'

const { pool, db } = openTestDb()
const app = buildApp(db)
let base
afterAll(async () => { await app.close(); await pool.end() })

test('GET /api/stream emits SSE frames for events published to the bus', async () => {
  await app.listen({ port: 0, host: '127.0.0.1' })
  const { port } = app.server.address()
  base = `http://127.0.0.1:${port}`

  const res = await fetch(`${base}/api/stream`)
  expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)
  const reader = res.body.getReader()

  // first read drains the initial retry hint; publish then read the event frame
  await reader.read()
  app.bus.publish({ type: 'watch', fixtureId: 'm1' })

  let buf = ''
  while (!buf.includes('"fixtureId":"m1"')) {
    const { value } = await reader.read()
    buf += new TextDecoder().decode(value)
  }
  expect(buf).toContain('data: {"type":"watch","fixtureId":"m1"}')
  await reader.cancel()
})
