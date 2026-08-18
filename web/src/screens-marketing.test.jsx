import { expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Landing } from './screens-landing.jsx'
import { Pricing } from './screens-pricing.jsx'

/* The split is deliberate: the front page sells the ritual, the top bar is where
   someone goes to find out what it costs. Keep the price off the landing. */

test('the landing routes to pricing from the nav instead of quoting a price', () => {
  render(<Landing />)
  expect(screen.getAllByRole('link', { name: /pricing/i })[0]).toHaveAttribute('href', '/pricing')
  expect(document.body.textContent).not.toMatch(/\$\s?\d/)
})

test('the landing leads with the free trial, not the card', () => {
  render(<Landing />)
  screen.getAllByRole('link', { name: /start free/i }).forEach((a) => expect(a).toHaveAttribute('href', '/account'))
  expect(screen.getAllByText(/no card/i).length).toBeGreaterThan(0)
})

test('the pricing page carries the price and the same start action', () => {
  render(<Pricing />)
  expect(screen.getByText(/\$5/)).toBeInTheDocument()
  expect(screen.getAllByRole('link', { name: /start free/i })[0]).toHaveAttribute('href', '/account')
})
