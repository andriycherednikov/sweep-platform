// web/src/components.test.jsx
import { expect, test, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react'

vi.mock('./api/client.js', () => ({
  postSupport: vi.fn(async () => ({})),
  postSession: vi.fn(async () => ({ sweepId: 'sw_b', role: 'member' })),
  postLogout: vi.fn(async () => ({})),
}))
import { postSupport, postSession, postLogout } from './api/client.js'
import { Av, Flag, CrowdPick, IdentityControl, MatchCard, ProbBar, SquadList, useCountdown, SweepsSheet, Sidebar, HomeHeader, AppHeader, ScoreCover, SpoilerToggle, PersonTeams, useScrolled, SHRINK_PX, SHRINK_HI, SHRINK_LO, BottomNav, OptOutButton, resultFor } from './components.jsx'
import { listSweeps, addSweep, removeSweep, useSweeps } from './sweeps.js'
import { isSpoiler, setSpoiler, isRevealed } from './spoiler.js'
import { HomeScreen, KnockoutsScreen } from './screens-main.jsx'
import { setSweepData, SWEEP } from './data.js'
import { assembleSweep } from './lib/assemble.js'
import { setMe, setSocialData } from './social.js'
import { optOut } from './optout.js'
import { makeApi } from '../test/factories.js'

const S = SWEEP

// resultFor: W/D/L from a team's perspective — must honor winnerCode (shootouts) while
// treating the 'DRAW' sentinel as a draw, not a loss for both sides.
test('resultFor reads winnerCode for shootouts and treats DRAW sentinel as a draw', () => {
  const ko = { status: 'final', t1: 'py', t2: 'de', score: [1, 1], winnerCode: 'py' }
  expect(resultFor(ko, 'py')).toBe('w') // shootout winner
  expect(resultFor(ko, 'de')).toBe('l')
  const drawn = { status: 'final', t1: 'nl', t2: 'jp', score: [2, 2], winnerCode: 'DRAW' }
  expect(resultFor(drawn, 'nl')).toBe('d') // NOT a loss for both
  expect(resultFor(drawn, 'jp')).toBe('d')
  // no winnerCode → score fallback
  expect(resultFor({ status: 'final', t1: 'a', t2: 'b', score: [2, 0] }, 'a')).toBe('w')
  expect(resultFor({ status: 'final', t1: 'a', t2: 'b', score: [1, 1] }, 'a')).toBe('d')
})

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

test('Flag renders the club logo when the team has one', () => {
  setSweepData(assembleSweep(makeApi({ sport: 'basketball' })))
  render(<Flag code="lal" w={24} h={24} />)
  expect(screen.getByRole('img').src).toBe('https://x/lal.png')
})

test('Flag falls back to a colored monogram when no logo and not football', () => {
  const api = makeApi({ sport: 'basketball' })
  api.bootstrap.teams[0].logo = null
  setSweepData(assembleSweep(api))
  const { container } = render(<Flag code="lal" w={24} h={24} />)
  expect(container.querySelector('.emblem-mono')).toBeTruthy()
  expect(container.querySelector('.emblem-mono').textContent).toBe('LA')
})

test('Flag keeps flagcdn for football teams', () => {
  setSweepData(assembleSweep(makeApi()))
  render(<Flag code="hr" w={24} h={17} />)
  expect(screen.getByRole('img').src).toContain('flagcdn.com')
})

const F = { id: 'm1', t1: 'mx', t2: 'za', status: 'upcoming' }
const FG = { id: 'm1', t1: 'mx', t2: 'za', status: 'upcoming', stage: 'group' }

beforeEach(() => {
  localStorage.clear(); setMe(null); vi.clearAllMocks(); setSpoiler(false)
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
  setSocialData({ support: { m1: { p1: 'mx', p2: 'za' } } })
})
afterEach(() => localStorage.clear())

test('CrowdPick renders tappable team zones showing each crowd count', () => {
  const { getByLabelText, container } = render(<CrowdPick f={F} />)
  // 1 vs 1 → two zones, each showing a flag and its vote count
  const zones = container.querySelectorAll('.cz')
  expect(zones.length).toBe(2)
  expect(getByLabelText(/Mexico/i).querySelector('img.flag')).not.toBeNull()
  expect(getByLabelText(/Mexico/i).textContent).toContain('1')
  expect(getByLabelText(/South Africa/i).textContent).toContain('1')
  // zones grow by vote count via inline flex-grow (1 each here)
  expect(getByLabelText(/Mexico/i).style.flexGrow).toBe('1')
})

test('CrowdPick zones keep their min-width floor and hide counts before any votes', () => {
  setSocialData({ support: {} })
  const { getByLabelText, container } = render(<CrowdPick f={FG} />)
  // all three zones still render (none collapse) when nobody has voted
  expect(container.querySelectorAll('.cz').length).toBe(3)
  // no count shown yet, and every zone grows equally so they spread full-width
  expect(getByLabelText(/Mexico/i).textContent).not.toMatch(/\d/)
  expect(getByLabelText(/Mexico/i).style.flexGrow).toBe('1')
  expect(getByLabelText(/Call Draw/i).style.flexGrow).toBe('1')
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

test('CrowdPick toasts "voting is closed" when a locked zone is tapped', () => {
  setMe('p1')
  const onToast = vi.fn()
  const { getByLabelText } = render(<CrowdPick f={{ ...F, status: 'final' }} onToast={onToast} locked />)
  fireEvent.click(getByLabelText(/South Africa/i))
  expect(postSupport).not.toHaveBeenCalled()
  expect(onToast).toHaveBeenCalledWith(expect.stringMatching(/closed/i))
})

test('CrowdPick renders nothing when locked with no calls', () => {
  setSocialData({ support: {} })
  const { container } = render(<CrowdPick f={{ ...F, status: 'final' }} locked />)
  expect(container.firstChild).toBeNull()
})

test('CrowdPick shows a Draw zone (three zones) on a group-stage fixture', () => {
  setSocialData({ support: { m1: { p1: 'mx', p2: 'DRAW' } } });
  const { getByLabelText, container } = render(<CrowdPick f={FG} />);
  expect(getByLabelText(/Call Draw/i)).toBeTruthy();
  expect(container.querySelectorAll('.cz').length).toBe(3);
});

test('CrowdPick hides the Draw control on a knockout fixture', () => {
  setSocialData({ support: { m1: { p1: 'mx', p2: 'za' } } });
  const { queryByLabelText } = render(<CrowdPick f={{ ...FG, stage: 'r16' }} />);
  expect(queryByLabelText(/Call Draw/i)).toBeNull();
});

test('CrowdPick knockout empty-state note omits the draw prompt', () => {
  setMe(null);
  setSocialData({ support: {} });
  const { getByText, queryByText } = render(<CrowdPick f={{ ...FG, stage: 'r16' }} />);
  expect(getByText('Tap a team to call the winner')).toBeInTheDocument();
  expect(queryByText(/or draw/i)).toBeNull();
});

test('CrowdPick records a DRAW pick and POSTs it', () => {
  setMe('p1');
  setSocialData({ support: {} });
  const { getByLabelText } = render(<CrowdPick f={FG} />);
  fireEvent.click(getByLabelText(/Call Draw/i));
  expect(postSupport).toHaveBeenCalledWith('m1', 'p1', 'DRAW');
});

test('CrowdPick shows no draw zone on a no-draw sport, even at stage=group', () => {
  setSweepData(assembleSweep(makeApi({ sport: 'basketball' })))   // NBA regular season maps stage:'group'
  render(<CrowdPick f={SWEEP.fixtures[0]} locked={false} />)
  expect(screen.queryByText('Draw')).toBeNull()
  expect(screen.getByText(/Tap a team to call the winner/)).toBeTruthy()
})

test('CrowdPick keeps the draw zone on football group games', () => {
  setSweepData(assembleSweep(makeApi()))
  render(<CrowdPick f={SWEEP.fixtures[0]} locked={false} />)
  expect(screen.getByText('Draw')).toBeTruthy()
})

test('ProbBar renders three segments (home / draw / away)', () => {
  const { container } = render(<ProbBar prob3={{ pa: 60, pd: 25, pb: 15 }} />)
  const segs = container.querySelectorAll('.prob-bar i')
  expect(segs).toHaveLength(3)
  expect(segs[0].style.width).toBe('60%')
  expect(container.querySelector('.prob-bar .d').style.width).toBe('25%')
  expect(segs[2].style.width).toBe('15%')
})

test('ProbBar renders two segments (no draw) for knockouts via prob2', () => {
  const { container } = render(<ProbBar prob2={{ pa: 60, pb: 40 }} />)
  const segs = container.querySelectorAll('.prob-bar i')
  expect(segs).toHaveLength(2)
  expect(segs[0].style.width).toBe('60%')
  expect(segs[1].style.width).toBe('40%')
  expect(container.querySelector('.prob-bar .d')).toBeNull()
})

test('useCountdown re-syncs its target when the next match changes (offset jumps)', () => {
  vi.useFakeTimers()
  const { result, rerender } = renderHook(({ off }) => useCountdown(off), { initialProps: { off: 5 } })
  expect(result.current.hms).toBe('00:00:05')
  // hero rolls to a match 2h out → offset jumps; the clock must reset, not stay at 0
  rerender({ off: 7200 })
  expect(result.current.hms).toBe('02:00:00')
  vi.useRealTimers()
})

test('useCountdown counts into negative time when kickoff has passed (grace window)', () => {
  vi.useFakeTimers()
  const { result } = renderHook(({ off }) => useCountdown(off), { initialProps: { off: -323 } })
  expect(result.current.hms).toBe('-00:05:23') // 5m23s past kickoff
  expect(result.current.s).toBe(-323)
  vi.useRealTimers()
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

test('HomeScreen latest-scores lists an extra-time penalty scorer (120, no shootout)', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'be', name: 'Belgium', group: 'G', pool: 'P', color: '#111', strength: 81 },
        { code: 'sn', name: 'Senegal', group: 'G', pool: 'P', color: '#093', strength: 74 },
      ],
      people: [], ownership: {}, scoring: null,
    },
    fixtures: [{
      id: 'm1', group: 'G', matchday: 0, t1: 'be', t2: 'sn', ko: '2026-07-01T18:00:00Z',
      venue: 'V', city: 'C', status: 'final', score: [2, 1], penScore: null, minute: null,
      prob: { a: 50, d: 25, b: 25 }, stage: 'knockout',
      events: [
        { id: 'g1', type: 'goal', teamCode: 'be', player: 'R. Lukaku', assist: null, minute: 86, detail: 'Normal Goal' },
        // in-play extra-time penalty winner (no shootout) — must be listed as a scorer
        { id: 'g2', type: 'goal', teamCode: 'be', player: 'Y. Tielemans', assist: null, minute: 120, detail: 'Penalty' },
        { id: 'g3', type: 'goal', teamCode: 'sn', player: 'H. Diarra', assist: null, minute: 25, detail: 'Normal Goal' },
      ],
    }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  const noop = () => {}
  setSpoiler(false)
  const { getByText } = render(<HomeScreen go={noop} openMatch={noop} openTeam={noop} openPerson={noop} openPhoto={noop} onAdmin={noop} />)
  expect(getByText(/Lukaku/)).toBeTruthy()
  expect(getByText(/Tielemans/)).toBeTruthy() // the 120' penalty scorer — dropped before the fix
})

test('HomeScreen latest-scores shows at most 6 finished games (newest first)', () => {
  const finals = Array.from({ length: 7 }, (_, i) => ({
    id: `m${i + 1}`, group: 'A', matchday: 1, t1: 'mx', t2: 'za',
    ko: `2026-06-${String(10 + i).padStart(2, '0')}T18:00:00Z`,
    venue: 'V', city: 'C', status: 'final', score: [1, 0], minute: null,
    prob: { a: 50, d: 25, b: 25 }, stage: 'group', events: [],
  }))
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'mx', name: 'Mexico', group: 'A', pool: 'P', color: '#0a7', strength: 76 },
        { code: 'za', name: 'South Africa', group: 'A', pool: 'P', color: '#a30', strength: 60 },
      ],
      people: [], ownership: {}, scoring: null,
    },
    fixtures: finals, standings: {}, photos: [], syncStatus: { stale: false },
  }))
  const noop = () => {}
  const { container } = render(<HomeScreen go={noop} openMatch={noop} openTeam={noop} openPerson={noop} openPhoto={noop} onAdmin={noop} />)
  expect(container.querySelectorAll('.sidescores .res').length).toBe(6)
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

test('MatchCard shows the one-line local date/time and no timezone label', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'hr', name: 'Croatia', group: 'L', pool: 'A', color: '#c00', strength: 82 },
        { code: 'en', name: 'England', group: 'L', pool: 'A', color: '#fff', strength: 90 },
      ],
      people: [], ownership: {}, scoring: null,
    },
    fixtures: [{
      id: 'm1', group: 'L', matchday: 1, t1: 'hr', t2: 'en', ko: '2026-06-13T22:00:00Z',
      venue: 'V', city: 'C', status: 'upcoming', score: null, minute: null, prob: null, stage: 'group',
    }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  const noop = () => {}
  const { getByText, queryByText, container } = render(
    <MatchCard f={SWEEP.fixture('m1')} onOpen={noop} onToast={noop} />
  )
  expect(getByText('Sun, 14 June · 8:00 AM')).toBeTruthy()
  expect(queryByText(/AEST/)).toBeNull()
  expect(container.querySelector('.mc-time').textContent).not.toMatch(/AEST/)
})

test('SweepsSheet lists stored sweeps and marks the active one', () => {
  addSweep({ sweepId: 'sw_a', name: 'Office', role: 'admin', token: 'ta' })
  addSweep({ sweepId: 'sw_b', name: 'Pub', role: 'member', token: 'tb' })
  const { getByText } = render(<SweepsSheet activeSweepId="sw_a" onClose={() => {}} queryClient={{ invalidateQueries: vi.fn() }} />)
  expect(getByText('Office')).toBeInTheDocument()
  expect(getByText('Pub')).toBeInTheDocument()
  expect(getByText(/current/i)).toBeInTheDocument()  // the active sweep is badged
})

test('SweepsSheet switching a stored sweep posts its token and invalidates queries', async () => {
  addSweep({ sweepId: 'sw_a', name: 'Office', role: 'admin', token: 'ta' })
  addSweep({ sweepId: 'sw_b', name: 'Pub', role: 'member', token: 'tb' })
  const qc = { invalidateQueries: vi.fn() }
  const { getByText } = render(<SweepsSheet activeSweepId="sw_a" onClose={() => {}} queryClient={qc} />)
  await act(async () => { fireEvent.click(getByText('Pub')) })
  expect(postSession).toHaveBeenCalledWith('tb')
  expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sweep'] })
})

test('SweepsSheet leaving the active sweep removes it from the store and logs out', async () => {
  addSweep({ sweepId: 'sw_a', name: 'Office', role: 'admin', token: 'ta' })
  addSweep({ sweepId: 'sw_b', name: 'Pub', role: 'member', token: 'tb' })
  const { getAllByLabelText } = render(<SweepsSheet activeSweepId="sw_a" onClose={() => {}} queryClient={{ invalidateQueries: vi.fn() }} />)
  await act(async () => { fireEvent.click(getAllByLabelText(/remove/i)[0]) })  // first row = sw_a (active)
  expect(listSweeps().map((s) => s.sweepId)).toEqual(['sw_b'])
  expect(postLogout).toHaveBeenCalled()
})

test('SweepsSheet leaving the active sweep invalidates the sweep query so the Gate drops to "pick a sweep"', async () => {
  addSweep({ sweepId: 'sw_a', name: 'Office', role: 'admin', token: 'ta' })
  addSweep({ sweepId: 'sw_b', name: 'Pub', role: 'member', token: 'tb' })
  const qc = { invalidateQueries: vi.fn() }
  const { getAllByLabelText } = render(<SweepsSheet activeSweepId="sw_a" onClose={() => {}} queryClient={qc} />)
  await act(async () => { fireEvent.click(getAllByLabelText(/remove/i)[0]) })  // first row = sw_a (active)
  expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sweep'] })
})

test('SweepsSheet shows an empty state when no sweeps are stored', () => {
  const { getByText } = render(<SweepsSheet activeSweepId={null} onClose={() => {}} queryClient={{ invalidateQueries: vi.fn() }} />)
  expect(getByText(/invite link/i)).toBeInTheDocument()
})

test('SweepsSheet surfaces an error and stays open when switching fails (revoked/expired token)', async () => {
  postSession.mockRejectedValueOnce(new Error('HTTP 401'))
  addSweep({ sweepId: 'sw_a', name: 'Office', role: 'admin', token: 'ta' })
  addSweep({ sweepId: 'sw_b', name: 'Pub', role: 'member', token: 'tb' })
  const onClose = vi.fn()
  const { getByText, findByText } = render(<SweepsSheet activeSweepId="sw_a" onClose={onClose} queryClient={{ invalidateQueries: vi.fn() }} />)
  await act(async () => { fireEvent.click(getByText('Pub')) })
  expect(await findByText(/couldn.t switch/i)).toBeInTheDocument()
  expect(onClose).not.toHaveBeenCalled()  // error surfaced instead of an unhandled rejection + close
})

test('SweepsSheet can rename a stored sweep (local label)', () => {
  addSweep({ sweepId: 'sw_a', name: 'Office', role: 'admin', token: 'ta' })
  const { getByLabelText, getByText, getByDisplayValue } = render(<SweepsSheet activeSweepId={null} onClose={() => {}} queryClient={{ invalidateQueries: vi.fn() }} />)
  fireEvent.click(getByLabelText(/rename office/i))
  fireEvent.change(getByDisplayValue('Office'), { target: { value: 'Office Pool' } })
  fireEvent.click(getByText('Save'))
  expect(listSweeps()[0].name).toBe('Office Pool')
})

test('SweepsSheet shows a friendly fallback when a stored sweep has no name', () => {
  addSweep({ sweepId: 'sw_zz', name: null, role: 'member', token: 'tz' })
  const { getByText, queryByText } = render(<SweepsSheet activeSweepId={null} onClose={() => {}} queryClient={{ invalidateQueries: vi.fn() }} />)
  expect(getByText('Untitled sweep')).toBeInTheDocument()
  expect(queryByText('sw_zz')).toBeNull()  // never show the raw id as a name
})

/* "My sweeps" switcher visibility — only worth showing once the device has joined
   more than one sweep (with 0–1 there's nothing to switch to). */

test('useSweeps re-renders subscribers when sweeps are added and removed', () => {
  const { result } = renderHook(() => useSweeps())
  expect(result.current).toEqual([])
  act(() => { addSweep({ sweepId: 'sw_a', name: 'Office', role: 'admin', token: 'ta' }) })
  expect(result.current).toHaveLength(1)
  act(() => { addSweep({ sweepId: 'sw_b', name: 'Pub', role: 'member', token: 'tb' }) })
  expect(result.current).toHaveLength(2)
  act(() => { removeSweep('sw_a') })
  expect(result.current).toHaveLength(1)
})

test('Sidebar hides "My sweeps" with one joined sweep', () => {
  addSweep({ sweepId: 'sw_a', name: 'Office', role: 'admin', token: 'ta' })
  const { queryByText } = render(<Sidebar current="home" go={() => {}} onKnock={() => {}} onAdmin={() => {}} onSweeps={() => {}} />)
  expect(queryByText('My sweeps')).toBeNull()
})

test('Sidebar shows "My sweeps" with two joined sweeps', () => {
  addSweep({ sweepId: 'sw_a', name: 'Office', role: 'admin', token: 'ta' })
  addSweep({ sweepId: 'sw_b', name: 'Pub', role: 'member', token: 'tb' })
  const { getByText } = render(<Sidebar current="home" go={() => {}} onKnock={() => {}} onAdmin={() => {}} onSweeps={() => {}} />)
  expect(getByText('My sweeps')).toBeInTheDocument()
})

test('HomeHeader hides the switch-sweep button with one joined sweep', () => {
  addSweep({ sweepId: 'sw_a', name: 'Office', role: 'admin', token: 'ta' })
  const { queryByLabelText } = render(<HomeHeader onAdmin={() => {}} go={() => {}} onSweeps={() => {}} />)
  expect(queryByLabelText(/my sweeps/i)).toBeNull()
})

test('HomeHeader shows the switch-sweep button with two sweeps and opens the switcher', () => {
  addSweep({ sweepId: 'sw_a', name: 'Office', role: 'admin', token: 'ta' })
  addSweep({ sweepId: 'sw_b', name: 'Pub', role: 'member', token: 'tb' })
  const onSweeps = vi.fn()
  const { getByLabelText } = render(<HomeHeader onAdmin={() => {}} go={() => {}} onSweeps={onSweeps} />)
  fireEvent.click(getByLabelText(/my sweeps/i))
  expect(onSweeps).toHaveBeenCalled()
})

/* Moderation/admin entry visibility — hidden for non-admins on token sweeps,
   always shown on the default sweep (its admin enters a PIN there). */
function setSweep(sweep) {
  setSweepData(assembleSweep({
    bootstrap: { teams: [], people: [], ownership: {}, scoring: null, sweep },
    fixtures: [], standings: {}, photos: [], syncStatus: { stale: false },
  }))
}

test('Sidebar hides Moderation for a non-admin on a token sweep', () => {
  setSweep({ id: 'sw_x', name: 'Office', role: 'member' })
  const { queryByText } = render(<Sidebar current="home" go={() => {}} onKnock={() => {}} onAdmin={() => {}} onSweeps={() => {}} />)
  expect(queryByText('Moderation')).toBeNull()
})

test('Sidebar shows Moderation for an admin on a token sweep', () => {
  setSweep({ id: 'sw_x', name: 'Office', role: 'admin' })
  const { getByText } = render(<Sidebar current="home" go={() => {}} onKnock={() => {}} onAdmin={() => {}} onSweeps={() => {}} />)
  expect(getByText('Moderation')).toBeInTheDocument()
})

test('Sidebar shows Moderation on the default sweep even for a member', () => {
  setSweep({ id: 'default', name: 'The Sweep', role: 'member' })
  const { getByText } = render(<Sidebar current="home" go={() => {}} onKnock={() => {}} onAdmin={() => {}} onSweeps={() => {}} />)
  expect(getByText('Moderation')).toBeInTheDocument()
})

test('HomeHeader hides the admin entry for a non-admin on a token sweep', () => {
  setSweep({ id: 'sw_x', name: 'Office', role: 'member' })
  const { queryByLabelText } = render(<HomeHeader onAdmin={() => {}} go={() => {}} onSweeps={() => {}} />)
  expect(queryByLabelText(/^admin$|moderation/i)).toBeNull()
})

test('HomeHeader shows the admin entry for an admin on a token sweep', () => {
  setSweep({ id: 'sw_x', name: 'Office', role: 'admin' })
  const { getByLabelText } = render(<HomeHeader onAdmin={() => {}} go={() => {}} onSweeps={() => {}} />)
  expect(getByLabelText(/^admin$|moderation/i)).toBeInTheDocument()
})

test('HomeHeader shows the admin entry on the default sweep even for a member', () => {
  setSweep({ id: 'default', name: 'The Sweep', role: 'member' })
  const { getByLabelText } = render(<HomeHeader onAdmin={() => {}} go={() => {}} onSweeps={() => {}} />)
  expect(getByLabelText(/^admin$|moderation/i)).toBeInTheDocument()
})

test('SpoilerToggle reflects and flips the mode', () => {
  setSpoiler(false)
  const { getByLabelText } = render(<SpoilerToggle />)
  const btn = getByLabelText(/privacy mode/i)
  expect(btn.getAttribute('aria-pressed')).toBe('false')
  act(() => { fireEvent.click(btn) })
  expect(isSpoiler()).toBe(true)
  expect(btn.getAttribute('aria-pressed')).toBe('true')
  setSpoiler(false)
})

test('ScoreCover reveals its fixture when tapped', () => {
  setSpoiler(true)
  const { getByLabelText } = render(<ScoreCover f={{ id: 'mX' }} />)
  expect(isRevealed('mX')).toBe(false)
  act(() => { fireEvent.click(getByLabelText(/reveal score/i)) })
  expect(isRevealed('mX')).toBe(true)
  setSpoiler(false)
})

function finalCard() {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'mx', name: 'Mexico', group: 'A', pool: 'P', color: '#0a7', strength: 76 },
        { code: 'za', name: 'South Africa', group: 'A', pool: 'P', color: '#a30', strength: 60 },
      ],
      people: [], ownership: {}, scoring: null,
    },
    fixtures: [{
      id: 'm1', group: 'A', matchday: 1, t1: 'mx', t2: 'za', ko: '2026-06-12T18:00:00Z',
      venue: 'V', city: 'C', status: 'final', score: [3, 1], minute: null, prob: { a: 50, d: 25, b: 25 }, stage: 'group',
    }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
}

test('MatchCard covers a final score under spoiler mode and reveals on tap', () => {
  finalCard()
  setSpoiler(true)
  const noop = () => {}
  const { queryByText, getByLabelText } = render(<MatchCard f={SWEEP.fixture('m1')} onOpen={noop} onToast={noop} />)
  expect(queryByText('3')).toBeNull()                 // score not rendered
  expect(getByLabelText(/reveal score/i)).toBeTruthy() // cover present
  act(() => { fireEvent.click(getByLabelText(/reveal score/i)) })
  expect(queryByText('3')).toBeTruthy()                // real score now shown
  setSpoiler(false)
})

test('MatchCard shows the score normally when spoiler mode is off', () => {
  finalCard()
  setSpoiler(false)
  const noop = () => {}
  const { getByText, queryByLabelText } = render(<MatchCard f={SWEEP.fixture('m1')} onOpen={noop} onToast={noop} />)
  expect(getByText('3')).toBeTruthy()
  expect(queryByLabelText(/reveal score/i)).toBeNull()
})

test('MatchCard renders shootout penalty scores and dims the loser', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'mx', name: 'Mexico', group: 'A', pool: 'P', color: '#0a7', strength: 76 },
        { code: 'za', name: 'South Africa', group: 'A', pool: 'P', color: '#a30', strength: 60 },
      ],
      people: [], ownership: {}, scoring: null,
    },
    fixtures: [{
      id: 'm1', group: 'A', matchday: 1, t1: 'mx', t2: 'za', ko: '2026-06-12T18:00:00Z',
      venue: 'V', city: 'C', status: 'final', score: [1, 1], penScore: [3, 5], winnerCode: 'za', minute: null, prob: { a: 50, d: 25, b: 25 }, stage: 'knockout',
    }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSpoiler(false)
  const noop = () => {}
  const { getByText, queryByText, container } = render(<MatchCard f={SWEEP.fixture('m1')} onOpen={noop} onToast={noop} />)
  expect(queryByText(/Penalties:/)).toBeNull() // pens now inline after each score, no stacked label
  expect(getByText('(3)')).toBeTruthy()
  expect(getByText('(5)')).toBeTruthy()
  // per-side inline within the score cell: "1 (3) – 1 (5)"
  expect(container.querySelector('.mc-sc').textContent.replace(/\s/g, '')).toContain('1(3)–1(5)')
  const mxContainer = container.querySelector('.mc-h-team:not(.right)')
  expect(mxContainer.className).toContain('dim')
  const zaContainer = container.querySelector('.mc-h-team.right')
  expect(zaContainer.className).not.toContain('dim')
})

test('HomeScreen latest-scores covers finals under spoiler mode, reveals on tap', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'mx', name: 'Mexico', group: 'A', pool: 'P', color: '#0a7', strength: 76 },
        { code: 'za', name: 'South Africa', group: 'A', pool: 'P', color: '#a30', strength: 60 },
      ],
      people: [], ownership: {}, scoring: null,
    },
    fixtures: [{
      id: 'm1', group: 'A', matchday: 1, t1: 'mx', t2: 'za', ko: '2026-06-12T18:00:00Z',
      venue: 'V', city: 'C', status: 'final', score: [4, 2], minute: null, prob: { a: 50, d: 25, b: 25 }, stage: 'group', events: [],
    }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSpoiler(true)
  const noop = () => {}
  const { container, queryByText, getAllByLabelText } = render(
    <HomeScreen go={noop} openMatch={noop} openTeam={noop} openPerson={noop} openPhoto={noop} onAdmin={noop} />
  )
  expect(container.querySelector('.sidescores .rscore')).toBeNull() // no raw scoreline
  const covers = getAllByLabelText(/reveal score/i)
  act(() => { fireEvent.click(covers[0]) })
  expect(queryByText('4 – 2')).toBeTruthy()
  setSpoiler(false)
})

test('HomeScreen hero covers a live score under spoiler mode', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'ar', name: 'Argentina', group: 'A', pool: 'P', color: '#6cf', strength: 90 },
        { code: 'mx', name: 'Mexico', group: 'A', pool: 'P', color: '#0a7', strength: 76 },
      ],
      people: [], ownership: {}, scoring: null,
    },
    fixtures: [
      { id: 'live1', group: 'A', matchday: 1, t1: 'ar', t2: 'mx', ko: '2026-06-13T06:30:00Z', venue: 'V', city: 'C', status: 'live', score: [2, 0], minute: 63, prob: { a: 50, d: 25, b: 25 }, stage: 'group' },
    ],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSpoiler(true)
  const noop = () => {}
  const { queryByText, getByLabelText } = render(
    <HomeScreen go={noop} openMatch={noop} openTeam={noop} openPerson={noop} openPhoto={noop} onAdmin={noop} />
  )
  expect(queryByText('2–0')).toBeNull()                 // live score covered
  expect(getByLabelText(/reveal score/i)).toBeTruthy()  // cover present
  expect(queryByText("63' · LIVE")).toBeTruthy()        // LIVE label still shown
  setSpoiler(false)
})

test('Sidebar renders the spoiler toggle', () => {
  const noop = () => {}
  const { getByLabelText } = render(<Sidebar current="home" go={noop} onKnock={noop} onAdmin={noop} />)
  expect(getByLabelText(/privacy mode/i)).toBeTruthy()
})

test('HomeHeader renders the spoiler toggle', () => {
  const noop = () => {}
  const { getByLabelText } = render(<HomeHeader onAdmin={noop} go={noop} />)
  expect(getByLabelText(/privacy mode/i)).toBeTruthy()
})

test('HomeScreen hides goal scorers in Latest scores under privacy mode', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'mx', name: 'Mexico', group: 'A', pool: 'P', color: '#0a7', strength: 76 },
        { code: 'za', name: 'South Africa', group: 'A', pool: 'P', color: '#a30', strength: 60 },
      ],
      people: [], ownership: {}, scoring: null,
    },
    fixtures: [{
      id: 'm1', group: 'A', matchday: 1, t1: 'mx', t2: 'za', ko: '2026-06-12T18:00:00Z',
      venue: 'V', city: 'C', status: 'final', score: [2, 0], minute: null, prob: { a: 50, d: 25, b: 25 }, stage: 'group',
      events: [{ id: 'g1', type: 'goal', teamCode: 'mx', player: 'Julián Quiñones', assist: null, minute: 9, detail: 'Normal Goal' }],
    }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  const noop = () => {}
  setSpoiler(true)
  const hidden = render(<HomeScreen go={noop} openMatch={noop} openTeam={noop} openPerson={noop} openPhoto={noop} onAdmin={noop} />)
  expect(hidden.queryByText(/Quiñones/)).toBeNull()   // scorer hidden under privacy mode
  hidden.unmount()
  setSpoiler(false)
  const shown = render(<HomeScreen go={noop} openMatch={noop} openTeam={noop} openPerson={noop} openPhoto={noop} onAdmin={noop} />)
  expect(shown.queryByText(/Quiñones/)).toBeTruthy()  // scorer shown when privacy off
})

test('HomeScreen latest-scores shows shootout penalty scores and status', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'mx', name: 'Mexico', group: 'A', pool: 'P', color: '#0a7', strength: 76 },
        { code: 'za', name: 'South Africa', group: 'A', pool: 'P', color: '#a30', strength: 60 },
      ],
      people: [], ownership: {}, scoring: null,
    },
    fixtures: [{
      id: 'm1', group: 'A', matchday: 1, t1: 'mx', t2: 'za', ko: '2026-06-12T18:00:00Z',
      venue: 'V', city: 'C', status: 'final', score: [1, 1], penScore: [3, 5], winnerCode: 'za', minute: null, prob: { a: 50, d: 25, b: 25 }, stage: 'knockout', events: [],
    }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  const noop = () => {}
  setSpoiler(false)
  const { getByText, queryByText, container } = render(<HomeScreen go={noop} openMatch={noop} openTeam={noop} openPerson={noop} openPhoto={noop} onAdmin={noop} />)
  expect(queryByText(/Penalties:/)).toBeNull() // pens now inline after each score
  expect(getByText('(3)')).toBeTruthy()
  expect(getByText('(5)')).toBeTruthy()
  expect(getByText('FT')).toBeTruthy()
  expect(container.querySelector('.rscore').textContent.replace(/\s/g, '')).toContain('1(3)–1(5)')
})

test('HomeScreen hero shows the running penalty tally during a live shootout', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'nl', name: 'Netherlands', group: 'A', pool: 'P', color: '#f60', strength: 84 },
        { code: 'ma', name: 'Morocco', group: 'A', pool: 'P', color: '#c00', strength: 75 },
      ],
      people: [], ownership: {}, scoring: null,
    },
    fixtures: [{
      id: 'k1', group: '', matchday: 0, t1: 'nl', t2: 'ma', ko: '2026-06-30T10:00:00Z',
      venue: 'V', city: 'C', status: 'live', score: [1, 1], penScore: [1, 0], phase: 'P', minute: null, prob: null, stage: 'knockout', events: [],
    }],
    standings: {}, photos: [], syncStatus: { stale: false },
  }))
  setSpoiler(false)
  const noop = () => {}
  const { container, getByText } = render(<HomeScreen go={noop} openMatch={noop} openTeam={noop} openPerson={noop} openPhoto={noop} onAdmin={noop} />)
  // running shootout tally is rendered inline with the score ("1 (1) – 1 (0)")
  expect(container.querySelector('.vs-cd .cd').textContent.replace(/\s/g, '')).toContain('1(1)–1(0)')
  expect(getByText(/Pens · LIVE/)).toBeTruthy() // phase label
})

test('PersonTeams shows names for <=2 teams, compact flags + count for more', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'dz', name: 'Algeria', group: 'A', pool: 'P', color: '#0a7', strength: 70 },
        { code: 'au', name: 'Australia', group: 'A', pool: 'P', color: '#a30', strength: 65 },
        { code: 'pl', name: 'Poland', group: 'A', pool: 'P', color: '#c00', strength: 68 },
      ],
      people: [], ownership: {}, scoring: null,
    },
    fixtures: [], standings: {}, photos: [], syncStatus: { stale: false },
  }))
  const two = render(<PersonTeams codes={['dz', 'au']} />)
  expect(two.queryByText('Algeria')).toBeTruthy()
  expect(two.queryByText('Australia')).toBeTruthy()
  expect(two.container.querySelector('.tms-flags')).toBeNull()
  two.unmount()
  const many = render(<PersonTeams codes={['dz', 'au', 'pl']} />)
  expect(many.queryByText('Algeria')).toBeNull()                 // names hidden once >2
  expect(many.container.querySelector('.tms-flags')).toBeTruthy() // compact flags mode
  expect(many.getByText(/3 teams/)).toBeTruthy()                 // count label
  expect(many.container.querySelectorAll('.tms-flags img').length).toBe(3)
})

test('SpoilerToggle (compact) highlights only when privacy mode is on', () => {
  setSpoiler(false)
  const off = render(<SpoilerToggle compact />)
  expect(off.container.querySelector('.spoiler-tog.compact.on')).toBeNull()
  off.unmount()
  setSpoiler(true)
  const on = render(<SpoilerToggle compact />)
  expect(on.container.querySelector('.spoiler-tog.compact.on')).toBeTruthy()
  setSpoiler(false)
})

test('useScrolled returns a gradual progress (0..1) linear in scrollTop, clamped at the ends', () => {
  // tall content so the input clamp (max = scrollHeight - clientHeight) never bites
  const ref = { current: { scrollTop: 0, scrollHeight: 10000, clientHeight: 800 } }
  const { result } = renderHook(() => useScrolled(ref))
  const at = (y) => { ref.current.scrollTop = y; act(() => result.current.onScroll()); return result.current.progress }
  expect(result.current.progress).toBe(0)
  expect(at(0)).toBe(0)
  expect(at(SHRINK_PX / 2)).toBeCloseTo(0.5, 5)   // halfway through D → 0.5
  expect(at(SHRINK_PX)).toBe(1)                   // at D → fully shrunk
  expect(at(SHRINK_PX * 3)).toBe(1)               // past D → clamped at 1
})

test('useScrolled is gradual & monotonic — a small scroll moves progress a small, exact amount (no binary flip)', () => {
  const ref = { current: { scrollTop: 0, scrollHeight: 10000, clientHeight: 800 } }
  const { result } = renderHook(() => useScrolled(ref))
  const at = (y) => { ref.current.scrollTop = y; act(() => result.current.onScroll()); return result.current.progress }
  const a = at(100)
  const b = at(110)
  expect(b).toBeGreaterThan(a)
  expect(b - a).toBeCloseTo(10 / SHRINK_PX, 5)    // exactly linear, no dead-band snap
})

test('useScrolled latches `scrolled` with hysteresis (collapse ≥ HI, re-expand ≤ LO) for the sibling headers', () => {
  // The sibling headers sit OUTSIDE the flex scroller, so collapsing them grows the
  // scroller's clientHeight and the browser re-clamps scrollTop — a single 0.5 threshold
  // would oscillate. Two thresholds with a dead-band latch the state so a small re-clamp
  // can't flip it back.
  const ref = { current: { scrollTop: 0, scrollHeight: 10000, clientHeight: 800 } }
  const { result } = renderHook(() => useScrolled(ref))
  const at = (y) => { ref.current.scrollTop = y; act(() => result.current.onScroll()); return result.current.scrolled }
  expect(at(0)).toBe(false)
  expect(at(SHRINK_PX * 0.45)).toBe(false)        // between LO and HI, from rest → no latch yet
  expect(at(SHRINK_PX * 0.55)).toBe(true)         // reaches HI (0.55) → collapse
  expect(at(SHRINK_PX * 0.45)).toBe(true)         // back in the dead-band → STAYS collapsed (latched)
  expect(at(SHRINK_PX * 0.35)).toBe(false)        // drops to LO (0.35) → re-expand
})

test('useScrolled hysteresis dead-band exceeds the sibling collapse delta (~26px) → no re-clamp oscillation', () => {
  // Invariant the fix relies on: the post-collapse native scrollTop re-clamp (≈ the header's
  // ~26px shrink, with the identity chip removed) is smaller than the dead-band, so it can
  // never drop progress from ≥HI back below LO.
  expect((SHRINK_HI - SHRINK_LO) * SHRINK_PX).toBeGreaterThan(26)
  expect(SHRINK_HI).toBeGreaterThan(SHRINK_LO)
})

test('useScrolled clamps iOS rubber-band/overscroll input so progress stays in [0,1]', () => {
  // negative scrollTop (top overscroll) → floored to 0
  const ref = { current: { scrollTop: -40, scrollHeight: 10000, clientHeight: 800 } }
  const { result } = renderHook(() => useScrolled(ref))
  act(() => result.current.onScroll())
  expect(result.current.progress).toBe(0)
  // momentum past the bottom → clamped to maxScroll (=9200), well beyond D → 1
  ref.current.scrollTop = 99999
  act(() => result.current.onScroll())
  expect(result.current.progress).toBe(1)
})

test('useScrolled: when maxScroll < D (short content), progress cannot reach 1', () => {
  // scrollHeight - clientHeight = 120, which is < SHRINK_PX(220). This is the
  // SHORT-content regime that caused the original jitter. Progress maxes at the
  // clamped maxScroll / D, never 1.
  const ref = { current: { scrollTop: 99999, scrollHeight: 920, clientHeight: 800 } }
  const { result } = renderHook(() => useScrolled(ref))
  act(() => result.current.onScroll())
  expect(result.current.progress).toBeCloseTo(120 / SHRINK_PX, 5)
  expect(result.current.progress).toBeLessThan(1)
})

test('useScrolled tolerates a bare {scrollTop} ref (no scrollHeight/clientHeight) without NaN', () => {
  const ref = { current: { scrollTop: SHRINK_PX } }
  const { result } = renderHook(() => useScrolled(ref))
  act(() => result.current.onScroll())
  expect(result.current.progress).toBe(1)
  expect(Number.isNaN(result.current.progress)).toBe(false)
})

test('AppHeader: tab headers are a compact fixed bar that shows the viewing-as chip but not the full selector/date', () => {
  setMe('p1') // selected identity → the chips render where the variant allows
  const home = render(<HomeHeader onAdmin={() => {}} go={() => {}} onSweeps={() => {}} />)
  expect(home.container.querySelector('header.home-flow')).toBeTruthy()   // full home header
  expect(home.container.querySelector('.id-full')).toBeTruthy()           // identity selector on home
  expect(home.container.querySelector('.id-mini')).toBeTruthy()           // mini chip exists on home
  home.unmount()
  const tab = render(<AppHeader title="Wagers" go={() => {}} />)
  expect(tab.container.querySelector('header.tab-mini')).toBeTruthy()     // compact fixed bar
  expect(tab.container.querySelector('header.shrunk')).toBeNull()         // never scroll-shrinks
  expect(tab.container.querySelector('.id-mini')).toBeTruthy()            // shows who you're viewing as
  expect(tab.container.querySelector('.id-full')).toBeNull()              // but NOT the full selector
  expect(tab.container.querySelector('.tz')).toBeNull()                   // and no date
  setMe(null)
})

test('BottomNav hides the Wagers tab once opted out', () => {
  localStorage.clear()
  S.people = [{ id: 'pn_a', name: 'Ann' }]
  setMe('pn_a') // an adult (no adult:false)
  const { queryByText, rerender } = render(<BottomNav tab="home" go={() => {}} />)
  expect(queryByText('Wagers')).toBeInTheDocument()
  act(() => { optOut('7d') })
  rerender(<BottomNav tab="home" go={() => {}} />)
  expect(queryByText('Wagers')).not.toBeInTheDocument()
})

test('OptOutButton renders a shield and fires onClick', () => {
  const onClick = vi.fn()
  const { getByLabelText } = render(<OptOutButton onClick={onClick} />)
  fireEvent.click(getByLabelText('Step away from Wagers'))
  expect(onClick).toHaveBeenCalled()
})

test('KnockoutsScreen renders bracket and respects spoiler protection', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'za', name: 'South Africa', group: 'A', pool: 'P', color: '#0a7', strength: 76 },
        { code: 'ca', name: 'Canada', group: 'A', pool: 'P', color: '#a30', strength: 60 },
      ],
      people: [], ownership: {}, scoring: null,
    },
    fixtures: [{
      id: 'k1', group: '', matchday: 0, t1: 'za', t2: 'ca', ko: '2026-06-28T18:00:00Z',
      venue: 'Sofi Stadium', city: 'Inglewood', status: 'final', score: [0, 1], winnerCode: 'ca',
      minute: 90, prob: null, stage: 'knockout'
    }],
    standings: {},
  }))
  setSpoiler(true)
  const { container } = render(<KnockoutsScreen go={() => {}} openMatch={() => {}} openTeam={() => {}} openPerson={() => {}} />)
  expect(container.querySelector('.b-match-box')).toBeTruthy()
  // Under spoiler mode, the eye cover is in the header, not on team rows, and neither team row is marked loser/winner
  expect(container.querySelector('.b-head-row .spoiler-cover')).toBeTruthy()
  expect(container.querySelector('.b-team-row.winner')).toBeFalsy()
  expect(container.querySelector('.b-team-row.loser')).toBeFalsy()
  setSpoiler(false)
})

test('BracketMatchBox drops the whole date line once a match is live (live dot carries the status)', () => {
  setSweepData(assembleSweep({
    bootstrap: {
      teams: [
        { code: 'za', name: 'South Africa', group: 'A', pool: 'P', color: '#0a7', strength: 76 },
        { code: 'ca', name: 'Canada', group: 'A', pool: 'P', color: '#a30', strength: 60 },
      ],
      people: [], ownership: {}, scoring: null,
    },
    fixtures: [{
      id: 'k1', group: '', matchday: 0, t1: 'za', t2: 'ca', ko: '2026-06-28T18:00:00Z',
      venue: 'Sofi Stadium', city: 'Inglewood', status: 'live', score: [0, 0],
      minute: 51, prob: null, stage: 'knockout'
    }],
    standings: {},
  }))
  setSpoiler(false)
  const { container } = render(<KnockoutsScreen go={() => {}} openMatch={() => {}} openTeam={() => {}} openPerson={() => {}} />)
  const liveBox = [...container.querySelectorAll('.b-match-box')].find(b => b.querySelector('.b-live-dot'))
  expect(liveBox).toBeTruthy()
  expect(liveBox.querySelector('.b-head-date')).toBeNull()           // no date line at all while live
  expect(liveBox.querySelector('.b-live-dot').textContent).toContain("51'") // live dot carries the status
})



