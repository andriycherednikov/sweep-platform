// The /photos/ mount is @fastify/static over the approved (moderated) directory,
// pinned here so the v9 → v10 bump (GHSA-8pvw-jcv7-9cmj, GHSA-83w8-p2f5-377r) cannot
// quietly stop serving. The traversal half of those advisories is deliberately NOT
// tested: app.inject normalises the path before routing, so the same assertions pass
// on the vulnerable version and would only look like coverage. The version pin is the
// mitigation; reproducing it would need a real socket and a hand-written request line.
import { expect, test, afterAll, beforeAll } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'

const { pool, db } = openTestDb()
let dir, app
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sweep-static-'))
  app = buildApp(db, { photosDir: dir, sessionSecret: 's' })
  await app.ready()
  await writeFile(join(dir, 'approved', 'ok.jpg'), 'approved-bytes')
})
afterAll(async () => { await app.close(); await pool.end(); await rm(dir, { recursive: true, force: true }) })

test('an approved photo is served from /photos/', async () => {
  const res = await app.inject({ method: 'GET', url: '/photos/ok.jpg' })
  expect(res.statusCode).toBe(200)
  expect(res.body).toBe('approved-bytes')
})
