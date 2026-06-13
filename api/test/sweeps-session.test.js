import { expect, test } from 'vitest'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { SWEEP_COOKIE, signSweepCookie, parseSweepCookie } from '../src/sweeps/auth.js'

test('sign then parse round-trips sweepId + role', async () => {
  const app = Fastify()
  await app.register(cookie, { secret: 'test-secret' })
  await app.ready()
  const signed = app.signCookie(signSweepCookie('abc123', 'admin'))
  const un = app.unsignCookie(signed)
  expect(un.valid).toBe(true)
  expect(parseSweepCookie(un.value)).toEqual({ sweepId: 'abc123', role: 'admin' })
  await app.close()
})

test('parseSweepCookie returns null for malformed value', () => {
  expect(parseSweepCookie('garbage')).toBeNull()
  expect(parseSweepCookie('id:badrole')).toBeNull()
})
