import { test, expect } from 'vitest'
import { buildApp } from '../src/app.js'
import { fakeStripe } from './helpers/fake-stripe.js'

test('sk_live outside production refuses to boot; sk_test and injected fakes are fine', () => {
  expect(() => buildApp(null, { sessionSecret: 's', stripeKey: 'sk_live_abc' }))
    .toThrow(/live Stripe key/)
  expect(() => buildApp(null, { sessionSecret: 's', stripeKey: 'rk_live_abc' }))
    .toThrow(/live Stripe key/)
  const app = buildApp(null, { sessionSecret: 's', stripeKey: 'sk_test_abc' })
  expect(app.stripe).toBeTruthy()
  const app2 = buildApp(null, { sessionSecret: 's', stripe: fakeStripe() })
  expect(app2.stripe.calls).toBeDefined()
  const app3 = buildApp(null, { sessionSecret: 's' })
  expect(app3.stripe).toBeNull() // unconfigured dev — billing routes 503, everything else works
})
