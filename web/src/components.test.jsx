// web/src/components.test.jsx
import { expect, test, beforeEach, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

vi.mock('./api/client.js', () => ({
  postWatch: vi.fn(async () => ({})),
  postSupport: vi.fn(async () => ({})),
}))
import { postSupport } from './api/client.js'
import { Av, CrowdPick } from './components.jsx'
import { HomeScreen } from './screens-main.jsx'
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

test('HomeScreen renders with zero approved fan photos (empty community state)', () => {
  // Real-world prod state: nobody has uploaded/been-approved yet → photos: [].
  // The "From the community" carousel must not crash on an undefined photo.
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'mx', name: 'Mexico', group: 'A', pool: 'P', color: '#0a7', strength: 70 },
        { code: 'za', name: 'South Africa', group: 'A', pool: 'P', color: '#a30', strength: 60 },
      ],
      people: [{ id: 'p1', name: 'A', short: 'A', initials: 'A', av: '#000', avatarPath: null }],
      ownership: {}, scoring: null,
    },
    fixtures: [{
      id: 'm1', group: 'A', matchday: 1, t1: 'mx', t2: 'za', ko: '2026-06-12T18:00:00Z',
      venue: 'V', city: 'C', status: 'upcoming', score: null, minute: null,
      prob: { a: 50, d: 25, b: 25 }, stage: 'group',
    }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  const noop = () => {}
  const { getByText } = render(
    <HomeScreen go={noop} openMatch={noop} openTeam={noop} openPerson={noop} onAdmin={noop} />
  )
  expect(getByText('From the community')).toBeTruthy()
})

function homeWith(photos) {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'gh', name: 'Ghana', group: 'L', pool: 'P', color: '#0a7', strength: 70 },
        { code: 'mx', name: 'Mexico', group: 'L', pool: 'P', color: '#a30', strength: 60 },
      ],
      people: [{ id: 'p1', name: 'Jax', short: 'Jax', initials: 'J', av: '#000', avatarPath: null }],
      ownership: {}, scoring: null,
    },
    fixtures: [{ id: 'm1', group: 'L', matchday: 1, t1: 'gh', t2: 'mx', ko: '2026-06-12T18:00:00Z', venue: 'V', city: 'C', status: 'upcoming', score: null, minute: null, prob: { a: 50, d: 25, b: 25 }, stage: 'group' }],
    standings: {}, photos,
  }))
}

test('HomeScreen: clicking a community photo opens the lightbox (openPhoto)', () => {
  homeWith([{ id: 'ph1', uploader: 'Jax', team: 'gh', caption: 'Ghana flag', status: 'approved', src: '/photos/x.jpg', kind: 'fan' }])
  const openPhoto = vi.fn()
  const { getByAltText } = render(<HomeScreen go={() => {}} openMatch={() => {}} openTeam={() => {}} openPerson={() => {}} openPhoto={openPhoto} onAdmin={() => {}} />)
  fireEvent.click(getByAltText('Ghana flag'))
  expect(openPhoto).toHaveBeenCalledWith(expect.objectContaining({ id: 'ph1' }))
})

test('HomeScreen: empty community box prompts upload (go upload)', () => {
  homeWith([])
  const go = vi.fn()
  const { getByText } = render(<HomeScreen go={go} openMatch={() => {}} openTeam={() => {}} openPerson={() => {}} openPhoto={() => {}} onAdmin={() => {}} />)
  fireEvent.click(getByText('No fan photos yet'))
  expect(go).toHaveBeenCalledWith('upload')
})
