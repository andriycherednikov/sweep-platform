import { expect, test, vi } from 'vitest'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { transportFromEnv } from '../src/mail.js'

const { db } = openTestDb()

test('no key configured means no transport', () => {
  expect(transportFromEnv({})).toBeNull()
})

test('a configured key yields a transport that sends', async () => {
  const send = vi.fn(async () => ({ data: { id: 'e_1' }, error: null }))
  const t = transportFromEnv({ RESEND_API_KEY: 're_x', MAIL_FROM: 'a@b.test' }, { emails: { send } })
  await t('to@example.test', 'Subject', 'Body')
  expect(send).toHaveBeenCalledWith(expect.objectContaining({
    from: 'a@b.test', to: 'to@example.test', subject: 'Subject',
  }))
})

// Sign-in links are bearer credentials. Printing them to stdout in production hands
// an account to anyone with log access, so a prod boot without mail must not happen.
test('production refuses to boot with no transport', () => {
  expect(() => buildApp(db, {
    sessionSecret: 's', nodeEnv: 'production', env: {},
  })).toThrow(/mail transport/)
})

test('dev still boots and logs to the console', () => {
  expect(() => buildApp(db, { sessionSecret: 's' })).not.toThrow()
})
