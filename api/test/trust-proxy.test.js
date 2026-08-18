import { expect, test, afterAll } from 'vitest'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'

const { pool, db } = openTestDb()
const app = buildApp(db)
app.get('/__probe', async (req) => ({ ip: req.ip, protocol: req.protocol }))
afterAll(async () => { await app.close(); await pool.end() })

// Behind the shared Caddy every request arrives from the proxy's IP over plain http.
// Without trustProxy the per-client rate limits (magic-link, checkout) all key on that
// one address — one visitor's burst locks everyone out.
test('the proxy headers are trusted: X-Forwarded-For/-Proto become req.ip/req.protocol', async () => {
  const res = await app.inject({
    method: 'GET', url: '/__probe',
    headers: { 'x-forwarded-for': '203.0.113.7', 'x-forwarded-proto': 'https' },
  })
  expect(res.json()).toEqual({ ip: '203.0.113.7', protocol: 'https' })
})
