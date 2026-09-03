// A defaulted cookie secret is sweep-admin role forgery: anyone who has read this
// repo can sign a session. Compose does not catch it either — `required: true` on the
// env_file asserts the FILE exists, not that any variable inside it is set, so a
// .env.docker missing SESSION_SECRET boots happily on a publicly-known key.
import { expect, test, afterEach } from 'vitest'
import { buildApp } from '../src/app.js'

const db = {} // buildApp only decorates it; nothing here reaches the database
const env = { ...process.env }
afterEach(() => { process.env = { ...env } })

test('production refuses to boot without SESSION_SECRET', () => {
  process.env.NODE_ENV = 'production'
  delete process.env.SESSION_SECRET
  expect(() => buildApp(db, { platformHost: 'p.test' })).toThrow(/SESSION_SECRET/)
})

test('production boots when the secret is supplied', () => {
  process.env.NODE_ENV = 'production'
  process.env.SESSION_SECRET = 'a-real-secret'
  const app = buildApp(db, { platformHost: 'p.test' })
  expect(app.sessionSecret).toBe('a-real-secret')
  return app.close()
})

test('dev and test still get the throwaway default, so nobody has to set it locally', () => {
  process.env.NODE_ENV = 'test'
  delete process.env.SESSION_SECRET
  const app = buildApp(db)
  expect(app.sessionSecret).toBe('dev-insecure-secret')
  return app.close()
})

// The sibling guard on the same function, locked in passing so the two stay together.
test('production refuses to boot without PLATFORM_HOST', () => {
  process.env.NODE_ENV = 'production'
  process.env.SESSION_SECRET = 'a-real-secret'
  delete process.env.PLATFORM_HOST
  expect(() => buildApp(db)).toThrow(/PLATFORM_HOST/)
})
