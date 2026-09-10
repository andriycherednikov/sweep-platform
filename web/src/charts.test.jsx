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
      height={160}
      series={[
        { id: 'a', color: '#e11', points: [1, 2, 3], label: 'AS' },
        { id: 'b', color: '#00f', points: [0, 1, 1], label: 'BT', dim: true },
      ]}
    />,
  )
  const paths = [...container.querySelectorAll('path')]
  expect(paths.map((p) => p.getAttribute('stroke'))).toEqual(['#e11', '#00f'])
  // the leader is the thick one; everyone else is there for context
  expect(paths[0].getAttribute('stroke-width')).toBe('3')
  expect(paths[1].getAttribute('stroke-width')).toBe('2')
  expect(container.textContent).toContain('AS')
})

test('Lines with no series renders an empty chart rather than throwing', () => {
  const { container } = render(<Lines title="Race" height={160} series={[]} />)
  expect(container.querySelector('svg')).toBeTruthy()
  expect(container.querySelectorAll('path')).toHaveLength(0)
})

test('Bars scales the tallest bar to the full plot and gives every bar the same width', () => {
  const { container } = render(<Bars title="Bets" values={[0, 2, 4]} height={100} />)
  const bars = [...container.querySelectorAll('rect')]
  expect(bars).toHaveLength(3)
  expect(new Set(bars.map((b) => b.getAttribute('width'))).size).toBe(1)
  // 100 tall less 6 of stroke room top and bottom
  expect(bars[2].getAttribute('height')).toBe('88')
  expect(bars[0].getAttribute('height')).toBe('0')
})

test('Bars of nothing renders an empty chart rather than throwing', () => {
  const { container } = render(<Bars title="Bets" values={[]} />)
  expect(container.querySelector('svg')).toBeTruthy()
  expect(container.querySelectorAll('rect')).toHaveLength(0)
})

// Points arrive as 0..1 fractions of each axis — deciding what "a lot of wins" means
// is the dashboard's job, not the chart's.
test('Scatter places a dot per point inside the inset, top-left being x0 y1', () => {
  const { container } = render(
    <Scatter
      title="Luck"
      height={200}
      quadrants={['Cursed', 'Sharp', 'Hopeless', 'Blessed']}
      points={[
        { id: 'a', x: 0, y: 1, label: 'AS', color: '#e11' },
        { id: 'b', x: 1, y: 0, label: 'BT', color: '#00f' },
        { id: 'c', x: 0.5, y: 0.5, label: 'CD', color: '#0a0' },
      ]}
    />,
  )
  const dots = [...container.querySelectorAll('circle')]
  expect(dots.map((d) => [d.getAttribute('cx'), d.getAttribute('cy')])).toEqual([
    ['20', '20'], ['620', '180'], ['320', '100'],
  ])
  expect(dots[0].getAttribute('fill')).toBe('#e11')
  expect(container.textContent).toContain('Blessed')
  expect(container.textContent).toContain('CD')
})

test('Scatter with nobody on it renders the quadrants and no dots', () => {
  const { container } = render(<Scatter title="Luck" points={[]} quadrants={['a', 'b', 'c', 'd']} />)
  expect(container.querySelectorAll('circle')).toHaveLength(0)
  expect(container.textContent).toContain('a')
})
