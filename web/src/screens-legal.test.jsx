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
