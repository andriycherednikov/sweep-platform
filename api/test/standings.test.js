import { expect, test, afterAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'

const { pool, db } = openTestDb()
const app = buildApp(db)
afterAll(async () => { await app.close(); await pool.end() })

test('GET /api/standings groups teams A–L, sorted by points', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/standings' })
  expect(res.statusCode).toBe(200)
  const tables = res.json()
  expect(Object.keys(tables).sort()).toEqual('ABCDEFGHIJKL'.split(''))
  for (const g of Object.keys(tables)) {
    expect(tables[g]).toHaveLength(4)
    const pts = tables[g].map((t) => t.pts)
    expect(pts).toEqual([...pts].sort((a, b) => b - a))
  }
})
