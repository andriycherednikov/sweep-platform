// web/src/components.test.jsx
import { expect, test, beforeEach, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

vi.mock('./api/client.js', () => ({
  postWatch: vi.fn(async () => ({})),
  postSupport: vi.fn(async () => ({})),
}))
import { postSupport } from './api/client.js'
import { Av, CrowdPick, IdentityControl, ProbBar, SquadList } from './components.jsx'
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
const FG = { id: 'm1', t1: 'mx', t2: 'za', status: 'upcoming', stage: 'group' }

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

test('CrowdPick shows a Draw control and three bar segments on a group-stage fixture', () => {
  setSocialData({ watch: {}, support: { m1: { p1: 'mx', p2: 'DRAW' } } });
  const { getByLabelText, container } = render(<CrowdPick f={FG} />);
  expect(getByLabelText(/Draw/i).textContent).toContain('1');
  expect(container.querySelectorAll('.cbar i').length).toBe(3);
});

test('CrowdPick hides the Draw control on a knockout fixture', () => {
  setSocialData({ watch: {}, support: { m1: { p1: 'mx', p2: 'za' } } });
  const { queryByLabelText } = render(<CrowdPick f={{ ...FG, stage: 'r16' }} />);
  expect(queryByLabelText(/^Call a draw/i)).toBeNull();
});

test('CrowdPick records a DRAW pick and POSTs it', () => {
  setMe('p1');
  setSocialData({ watch: {}, support: {} });
  const { getByLabelText } = render(<CrowdPick f={FG} />);
  fireEvent.click(getByLabelText(/Call a draw/i));
  expect(postSupport).toHaveBeenCalledWith('m1', 'p1', 'DRAW');
});

test('ProbBar renders two segments (home vs away) summing to 100, no draw segment', () => {
  const { container } = render(<ProbBar prob2={{ pa: 72, pb: 28 }} />)
  const segs = container.querySelectorAll('.prob-bar i')
  expect(segs).toHaveLength(2)
  expect(segs[0].style.width).toBe('72%')
  expect(segs[1].style.width).toBe('28%')
  expect(container.querySelector('.prob-bar .d')).toBeNull()
})

test('SquadList groups players by position and renders a photo or a number badge', () => {
  const { container, getByText } = render(<SquadList players={[
    { name: 'Keeper', number: 1, pos: 'Goalkeeper', photo: 'https://x/1.png' },
    { name: 'Striker', number: 9, pos: 'Attacker', photo: null },
  ]} />)
  expect(getByText('Goalkeepers')).toBeTruthy()
  expect(getByText('Forwards')).toBeTruthy()
  expect(container.querySelector('img.squad-ph').getAttribute('src')).toBe('https://x/1.png')
  expect(container.querySelector('.squad-ph-ph').textContent).toBe('9') // no photo → number badge
})

test('SquadList renders nothing for an empty squad', () => {
  const { container } = render(<SquadList players={[]} />)
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

test('HomeScreen latest-scores rows show goal scorers and a yellow/red card tally per team', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'mx', name: 'Mexico', group: 'A', pool: 'P', color: '#0a7', strength: 76 },
        { code: 'za', name: 'South Africa', group: 'A', pool: 'P', color: '#a30', strength: 60 },
      ],
      people: [{ id: 'p1', name: 'A', short: 'A', initials: 'A', av: '#000', avatarPath: null }],
      ownership: {}, scoring: null,
    },
    fixtures: [{
      id: 'm1', group: 'A', matchday: 1, t1: 'mx', t2: 'za', ko: '2026-06-12T18:00:00Z',
      venue: 'V', city: 'C', status: 'final', score: [2, 0], minute: null, prob: { a: 50, d: 25, b: 25 }, stage: 'group',
      events: [
        { id: 'g1', type: 'goal', teamCode: 'mx', player: 'Julián Quiñones', assist: 'Erik Lira', minute: 9, detail: 'Normal Goal' },
        { id: 'g2', type: 'goal', teamCode: 'mx', player: 'Raúl Jiménez', assist: null, minute: 67, detail: 'Normal Goal' },
        { id: 'c1', type: 'card', teamCode: 'za', player: 'Teboho Mokoena', minute: 17, card: 'yellow', detail: 'Yellow Card' },
        { id: 'c2', type: 'card', teamCode: 'za', player: 'Siphephelo Sithole', minute: 49, card: 'red', detail: 'Red Card' },
      ],
    }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  const noop = () => {}
  const { getByText, getByTitle } = render(<HomeScreen go={noop} openMatch={noop} openTeam={noop} openPerson={noop} openPhoto={noop} onAdmin={noop} />)
  expect(getByText('Latest scores')).toBeTruthy()
  expect(getByText(/Quiñones/)).toBeTruthy()                 // Mexico scorer (home side)
  expect(getByText(/Jiménez/)).toBeTruthy()                  // second Mexico scorer
  expect(getByTitle('1 yellow card')).toBeTruthy()           // South Africa card tally
  expect(getByTitle('1 red card')).toBeTruthy()
})

test('HomeScreen hero features the live match (score + minute) over the next kickoff', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'ar', name: 'Argentina', group: 'A', pool: 'P', color: '#6cf', strength: 90 },
        { code: 'mx', name: 'Mexico', group: 'A', pool: 'P', color: '#0a7', strength: 76 },
        { code: 'kr', name: 'South Korea', group: 'B', pool: 'P', color: '#a30', strength: 73 },
        { code: 'cz', name: 'Czechia', group: 'B', pool: 'P', color: '#338', strength: 67 },
      ],
      people: [{ id: 'p1', name: 'A', short: 'A', initials: 'A', av: '#000', avatarPath: null }],
      ownership: {}, scoring: null,
    },
    fixtures: [
      { id: 'live1', group: 'A', matchday: 1, t1: 'ar', t2: 'mx', ko: '2026-06-13T06:30:00Z', venue: 'V', city: 'C', status: 'live', score: [2, 0], minute: 63, prob: { a: 50, d: 25, b: 25 }, stage: 'group' },
      { id: 'up1', group: 'B', matchday: 1, t1: 'kr', t2: 'cz', ko: '2026-06-13T18:00:00Z', venue: 'V', city: 'C', status: 'upcoming', score: null, minute: null, prob: { a: 50, d: 25, b: 25 }, stage: 'group' },
    ],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  const noop = () => {}
  const { getByText, queryByText } = render(<HomeScreen go={noop} openMatch={noop} openTeam={noop} openPerson={noop} openPhoto={noop} onAdmin={noop} />)
  expect(getByText(/Live now/i)).toBeTruthy()       // live badge, not "Next match"
  expect(queryByText('Kicks off in')).toBeNull()    // countdown header replaced
  expect(getByText('2–0')).toBeTruthy()             // live score in the hero
  expect(getByText("63' · LIVE")).toBeTruthy()      // live minute
})

test('HomeScreen: clicking a community photo opens the lightbox (openPhoto)', () => {
  homeWith([{ id: 'ph1', uploader: 'Jax', fixtureId: 'm1', caption: 'Ghana flag', status: 'approved', src: '/photos/x.jpg', kind: 'fan' }])
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

test('IdentityControl: avatar → your profile, ⇄ → change perspective', () => {
  setMe('p1')
  const viewMe = vi.fn(), pickMe = vi.fn()
  window.__sweepViewMe = viewMe; window.__sweepPickMe = pickMe
  const { getByLabelText } = render(<IdentityControl />)
  fireEvent.click(getByLabelText('View your profile'))
  expect(viewMe).toHaveBeenCalled()
  fireEvent.click(getByLabelText('Change perspective'))
  expect(pickMe).toHaveBeenCalled()
  delete window.__sweepViewMe; delete window.__sweepPickMe
})

test('IdentityControl: with nobody picked, the chip opens the picker and hides ⇄', () => {
  setMe(null)
  const pickMe = vi.fn(); window.__sweepPickMe = pickMe
  const { getByLabelText, queryByLabelText } = render(<IdentityControl />)
  expect(queryByLabelText('Change perspective')).toBeNull()
  fireEvent.click(getByLabelText('Pick who you are'))
  expect(pickMe).toHaveBeenCalled()
  delete window.__sweepPickMe
})
