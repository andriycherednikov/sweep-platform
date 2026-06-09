import { expect, test, afterAll, beforeEach } from 'vitest'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { syncLog } from '../src/db/schema.js'

const { pool, db } = openTestDb()
const app = buildApp(db)
afterAll(async () => { await app.close(); await pool.end() })
beforeEach(async () => { await db.delete(syncLog) })

test('stale=true when no baseline sync has ever run', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/sync-status' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({ stale: true, lastBaselineAt: null })
})

test('stale=false right after a successful baseline sync', async () => {
  await db.insert(syncLog).values({ source: 'api-football', kind: 'baseline', status: 'ok' })
  expect((await app.inject({ method: 'GET', url: '/api/sync-status' })).json().stale).toBe(false)
})

test('stale=true when newest OK baseline is older than 18h', async () => {
  const old = new Date(Date.now() - 19 * 3600_000)
  await db.insert(syncLog).values({ source: 'api-football', kind: 'baseline', status: 'ok', ranAt: old })
  expect((await app.inject({ method: 'GET', url: '/api/sync-status' })).json().stale).toBe(true)
})
