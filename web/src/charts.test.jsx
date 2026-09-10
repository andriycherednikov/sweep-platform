import { expect, test } from 'vitest'
import { render } from '@testing-library/react'

import { Lines, Bars, Scatter, linePath } from './charts.jsx'

// The geometry is the whole component, so it is tested as arithmetic rather than
// through the DOM: given values, a plot box and a ceiling, the path is exactly this.
test('linePath spreads the values across the width and flips y so up means more', () => {
  expect(linePath([0, 5, 10], 100, 10, 200)).toBe('M0,100 L100,50 L200,0')
})

test('linePath with one reading places the single point and nothing else', () => {
  expect(linePath([4], 100, 8, 200)).toBe('M0,50')
})

// Every chart on the dashboard can be handed an empty array — a sweep provisioned
// seconds ago has no rows anywhere — and none of them may throw over it.
test('linePath of nothing is nothing', () => {
  expect(linePath([], 100, 10)).toBe('')
})

test('Lines draws one path per series, in the series colour', () => {
  const { container } = render(
    <Lines
      title="Race"
      series={[
        { id: 'a', color: '#e11', points: [1, 2, 3], label: 'AS' },
        { id: 'b', color: '#00f', points: [0, 1, 1], label: 'BT', dim: true },
      ]}
    />,
  )
  // the filled-none ones are the lines; the others are the dots on the end of them
  const paths = [...container.querySelectorAll('path[fill="none"]')]
  expect(paths.map((p) => p.getAttribute('stroke'))).toEqual(['#e11', '#00f'])
  // the leader is the thick one; everyone else is there for context
  expect(paths[0].getAttribute('stroke-width')).toBe('3')
  expect(paths[1].getAttribute('stroke-width')).toBe('2')
  expect(container.textContent).toContain('AS')
})

// The box is stretched to whatever the card is, so a <circle> would come out an egg: the
// dot is a line going nowhere, wearing a round cap and a stroke that refuses to scale.
test('a line ends in a round-capped stroke rather than a circle', () => {
  const { container } = render(
    <Lines title="Race" series={[{ id: 'a', color: '#e11', points: [1, 2], label: 'AS' }]} />,
  )
  expect(container.querySelectorAll('circle')).toHaveLength(0)
  const dot = [...container.querySelectorAll('path')].find((p) => !p.hasAttribute('fill'))
  // the right-hand end of the plot, at the top because the last reading is the maximum
  expect(dot.getAttribute('d')).toBe('M602,0L602,0')
  expect(dot.getAttribute('stroke-linecap')).toBe('round')
  expect(dot.getAttribute('vector-effect')).toBe('non-scaling-stroke')
})

test('Lines with no series renders an empty chart rather than throwing', () => {
  const { container } = render(<Lines title="Race" series={[]} />)
  expect(container.querySelector('svg')).toBeTruthy()
  expect(container.querySelectorAll('path')).toHaveLength(0)
})

test('Bars scales the tallest bar to the full plot and gives every bar the same width', () => {
  const { container } = render(<Bars title="Bets" values={[0, 2, 4]} />)
  const bars = [...container.querySelectorAll('rect')]
  expect(bars).toHaveLength(3)
  expect(new Set(bars.map((b) => b.getAttribute('width'))).size).toBe(1)
  // the 200-unit grid less 6 of stroke room top and bottom
  expect(bars[2].getAttribute('height')).toBe('188')
  expect(bars[0].getAttribute('height')).toBe('0')
})

test('Bars of nothing renders an empty chart rather than throwing', () => {
  const { container } = render(<Bars title="Bets" values={[]} />)
  expect(container.querySelector('svg')).toBeTruthy()
  expect(container.querySelectorAll('rect')).toHaveLength(0)
})

// Points arrive as 0..1 fractions of each axis — deciding what "a lot of wins" means
// is the dashboard's job, not the chart's.
// Positioned HTML, not a drawing: a 26px dot sits on a track of the box less one dot, so
// somebody at 0 or at 1 is inside the plot rather than half over its edge. Top-left is
// x0 y1, because up means more and CSS counts down.
test('Scatter places a dot per point on a track inset by half a dot', () => {
  const { container } = render(
    <Scatter
      title="Luck"
      quadrants={['Cursed', 'Sharp', 'Hopeless', 'Blessed']}
      points={[
        { id: 'a', x: 0, y: 1, label: 'AS', color: '#e11' },
        { id: 'b', x: 1, y: 0, label: 'BT', color: '#00f' },
        { id: 'c', x: 0.5, y: 0.5, label: 'CD', color: '#0a0' },
      ]}
    />,
  )
  const dots = [...container.querySelectorAll('.ch-dot')]
  expect(dots.map((d) => [d.style.left, d.style.top])).toEqual([
    ['calc(13px + 0 * (100% - 26px))', 'calc(13px + 0 * (100% - 26px))'],
    ['calc(13px + 1 * (100% - 26px))', 'calc(13px + 1 * (100% - 26px))'],
    ['calc(13px + 0.5 * (100% - 26px))', 'calc(13px + 0.5 * (100% - 26px))'],
  ])
  expect(dots[0].style.background).toBe('rgb(238, 17, 17)')
  expect(container.textContent).toContain('Blessed')
  expect(container.textContent).toContain('CD')
})

test('Scatter with nobody on it renders the quadrants and no dots', () => {
  const { container } = render(<Scatter title="Luck" points={[]} quadrants={['a', 'b', 'c', 'd']} />)
  expect(container.querySelectorAll('.ch-dot')).toHaveLength(0)
  expect(container.textContent).toContain('a')
})
