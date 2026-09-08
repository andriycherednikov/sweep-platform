import { expect, test } from 'vitest'
import { missingProdEnv } from '../src/db/migrate.js'

const FULL = {
  NODE_ENV: 'production',
  SESSION_SECRET: 's', PUBLIC_ORIGIN: 'https://x.test',
  RESEND_API_KEY: 're_x', MAIL_FROM: 'The Sweep <a@b.test>',
}

test('outside production nothing is required', () => {
  expect(missingProdEnv({ NODE_ENV: 'development' })).toEqual([])
})

test('a fully configured production env passes', () => {
  expect(missingProdEnv(FULL)).toEqual([])
})

// `make deploy` ships docker-compose.yml but never .env.docker, so a var added on a
// branch is simply absent on the server. Migrations are one-way — 0008 drops a column
// the running api still reads — so learning this after the migration means a
// crash-loop with no rollback. Every missing name at once, or the operator fixes one,
// redeploys, and hits the next.
test('all missing vars are named at once, not just the first', () => {
  expect(missingProdEnv({ NODE_ENV: 'production' }))
    .toEqual(['SESSION_SECRET', 'PUBLIC_ORIGIN', 'RESEND_API_KEY', 'MAIL_FROM'])
})

test('a blank value counts as missing', () => {
  expect(missingProdEnv({ ...FULL, MAIL_FROM: '' })).toEqual(['MAIL_FROM'])
})
