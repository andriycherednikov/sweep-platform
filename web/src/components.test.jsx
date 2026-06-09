// web/src/components.test.jsx
import { expect, test, beforeEach, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

vi.mock('./api/client.js', () => ({
  postWatch: vi.fn(async () => ({})),
  postSupport: vi.fn(async () => ({})),
}))
import { postSupport } from './api/client.js'
import { Av, CrowdPick } from './components.jsx'
import { setSweepData } from './data.js'
import { assembleSweep } from './lib/assemble.js'
import { setMe, setSocialData } from './social.js'

test('Av renders the initials chip when no avatarPath', () => {
  const { container } = render(<Av p={{ initials: 'AB', av: '#123456' }} size={24} />)
  expect(container.querySelector('img')).toBeNull()
  expect(container.textContent).toContain('AB')
})

test('Av renders an <img> when avatarPath is present', () => {
  const { container } = render(<Av p={{ initials: 'AB', av: '#123456', avatarPath: '/photos/x.jpg' }} size={24} />)
  const img = container.querySelector('img')
  expect(img).not.toBeNull()
  expect(img.getAttribute('src')).toBe('/photos/x.jpg')
})

const F = { id: 'm1', t1: 'mx', t2: 'za', status: 'upcoming' }

beforeEach(() => {
  localStorage.clear(); setMe(null); vi.clearAllMocks()
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'mx', name: 'Mexico', group: 'A', pool: 'P', color: '#0a7', strength: 70 },
        { code: 'za', name: 'South Africa', group: 'A', pool: 'P', color: '#a30', strength: 60 },
      ],
      people: [
        { id: 'p1', name: 'A', short: 'A', initials: 'A', av: '#000', avatarPath: null },
        { id: 'p2', name: 'B', short: 'B', initials: 'B', av: '#111', avatarPath: null },
      ],
      ownership: {}, scoring: null,
    },
    fixtures: [], standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSocialData({ watch: {}, support: { m1: { p1: 'mx', p2: 'za' } } })
})

test('CrowdPick shows the crowd call count per team (distinct from official %)', () => {
  const { getByLabelText } = render(<CrowdPick f={F} />)
  expect(getByLabelText(/Mexico/i).textContent).toContain('1')
  expect(getByLabelText(/South Africa/i).textContent).toContain('1')
})

test('CrowdPick records my pick and POSTs it', () => {
  setMe('p1')
  const { getByLabelText } = render(<CrowdPick f={F} />)
  fireEvent.click(getByLabelText(/South Africa/i))
  expect(postSupport).toHaveBeenCalledWith('m1', 'p1', 'za')
})

test('CrowdPick is read-only when locked — clicking does not POST', () => {
  setMe('p1')
  const { getByLabelText } = render(<CrowdPick f={{ ...F, status: 'live' }} locked />)
  fireEvent.click(getByLabelText(/South Africa/i))
  expect(postSupport).not.toHaveBeenCalled()
})

test('CrowdPick renders nothing when locked with no calls', () => {
  setSocialData({ watch: {}, support: {} })
  const { container } = render(<CrowdPick f={{ ...F, status: 'final' }} locked />)
  expect(container.firstChild).toBeNull()
})
