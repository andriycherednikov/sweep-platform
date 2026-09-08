// Stripe will not activate live mode without these pages. The OWNER placeholders are
// deliberately left visible in the rendered page rather than guarded by a test here: a
// test asserting they are still unfilled would fail the moment someone fills them in.
import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Terms, Privacy } from './screens-legal.jsx'
import { LandingFoot } from './screens-landing.jsx'

describe.each([['terms', Terms], ['privacy', Privacy]])('%s page', (id, Page) => {
  test('renders standalone, with no sweep session and no account token', () => {
    render(<Page />)
    expect(screen.getByTestId(id)).toBeTruthy()
  })
})

test('the footer offers both, so they are reachable from every marketing page', () => {
  render(<LandingFoot />)
  const hrefs = [...document.querySelectorAll('.lp-foot-links a')].map((a) => a.getAttribute('href'))
  expect(hrefs).toContain('/terms')
  expect(hrefs).toContain('/privacy')
})

// This page went false once: it promised "there is no password here to lose" while the
// schema was already storing bcrypt hashes and every magic-link redeem offered to set
// one. A policy that describes the wrong product is the one kind of stale copy worth
// pinning down with a test.
test('privacy names the password it stores, and how, rather than denying there is one', () => {
  render(<Privacy />)
  const text = screen.getByTestId('privacy').textContent
  expect(text).toMatch(/hash/i)
  expect(text).not.toMatch(/no password/i)
})
