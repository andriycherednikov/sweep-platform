import { expect, test, afterAll } from 'vitest'
import { createPool, createDb } from '../src/db/client.js'
import { createBus } from '../src/events/bus.js'
import { publish } from '../src/events/notify.js'
import { startListener } from '../src/events/listen.js'

const pool = createPool(process.env.DATABASE_URL)
const db = createDb(pool)
let stop
afterAll(async () => { if (stop) await stop(); await pool.end() })

test('a published event arrives on the bus via Postgres NOTIFY', async () => {
  const bus = createBus()
  const got = new Promise((resolve) => bus.subscribe(resolve))
  stop = await startListener(pool, bus)
  await publish(db, { type: 'score', fixtureId: '9002', status: 'live', score: [1, 0], minute: 63 })
  expect(await got).toEqual({ type: 'score', fixtureId: '9002', status: 'live', score: [1, 0], minute: 63 })
})
