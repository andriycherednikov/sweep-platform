import { expect, test, vi } from 'vitest'
import { buildApp } from '../src/app.js'
import { openTestDb } from './helpers/db.js'
import { transportFromEnv, codeMail, inviteMail } from '../src/mail.js'

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

test('a fourth argument rides along as the HTML part', async () => {
  const send = vi.fn(async () => ({ data: { id: 'e_1' }, error: null }))
  const t = transportFromEnv({ RESEND_API_KEY: 're_x', MAIL_FROM: 'a@b.test' }, { emails: { send } })
  await t('to@example.test', 'Subject', 'Body', '<p>Body</p>')
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ text: 'Body', html: '<p>Body</p>' }))
})

// The dev console fallback takes three params, and every recording seam in the suite
// records positionally — a three-arg send must not grow an empty html key.
test('a three-argument send carries no html key at all', async () => {
  const send = vi.fn(async () => ({ data: { id: 'e_1' }, error: null }))
  const t = transportFromEnv({ RESEND_API_KEY: 're_x', MAIL_FROM: 'a@b.test' }, { emails: { send } })
  await t('to@example.test', 'Subject', 'Body')
  expect(send.mock.calls[0][0]).not.toHaveProperty('html')
})

test('the code mail carries the code in the subject and in both parts', () => {
  const m = codeMail('481920', 'Friday Night NBA')
  expect(m.subject).toContain('481920')
  expect(m.text).toContain('481920')
  expect(m.html).toContain('481920')
  expect(m.html).toContain('Friday Night NBA')
})

// The sweep name is owner-typed free text and a free cardless trial makes it a lure
// vector, so it never reaches the subject line — only the escaped body.
test('the sweep name never reaches the subject', () => {
  expect(codeMail('481920', 'Friday Night NBA').subject).not.toContain('Friday Night NBA')
})

test('an owner-typed sweep name is inert in the HTML', () => {
  const m = codeMail('481920', '<script>alert(1)</script>')
  expect(m.html).not.toContain('<script>')
  expect(m.html).toContain('&lt;script&gt;')
})

test('the invite mail carries the group link, escaped, in both parts', () => {
  const m = inviteMail('Friday Night NBA', 'https://sweep.test/g/tok"onerror=x')
  expect(m.text).toContain('https://sweep.test/g/tok"onerror=x')
  expect(m.html).toContain('&quot;onerror=x')
  expect(m.html).not.toContain('"onerror=x"')
})
