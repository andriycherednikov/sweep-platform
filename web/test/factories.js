/* Shared multi-sport API-bundle factory for web tests (assembleSweep input shape). */
const FOOT_COMP = { sport: 'football', hasDraws: true, name: 'World Cup 2026', season: '2026', format: 'groups_then_ko', logo: null }
const BBALL_COMP = { sport: 'basketball', hasDraws: false, name: 'NBA', season: '2023-2024', format: 'league', logo: 'https://x/nba.png' }

export function makeTeam(over = {}) {
  return { code: 'hr', name: 'Croatia', group: 'A', pool: null, color: '#f00', logo: null, strength: 80, squad: null, ...over }
}
export function makeFixture(over = {}) {
  return { id: 'f1', group: 'A', matchday: 1, t1: 'hr', t2: 'br', ko: '2026-06-13T06:00:00.000Z',
    venue: 'V', city: 'C', status: 'upcoming', score: null, minute: null, phase: null,
    prob: { a: 45, d: 25, b: 30 }, markets: null, htScore: null, penScore: null,
    lineups: null, events: [], statistics: null, stage: 'group', derby: false, doubleOwner: false, winnerCode: null, ...over }
}
export function makeBootstrap(over = {}) {
  const { sport = 'football', ...rest } = over
  const bball = sport === 'basketball'
  return {
    teams: bball
      ? [makeTeam({ code: 'lal', name: 'Lakers', group: null, color: '#552583', logo: 'https://x/lal.png', strength: null }),
         makeTeam({ code: 'bos', name: 'Celtics', group: null, color: '#007a33', logo: 'https://x/bos.png', strength: null })]
      : [makeTeam(), makeTeam({ code: 'br', name: 'Brazil', group: 'A', color: '#ff0' })],
    people: [{ id: 'p1', name: 'Ann', short: 'Ann', initials: 'A', av: '#333', avatarPath: null, adult: true, excluded: false, createdAt: null }],
    ownership: { p1: bball ? ['lal'] : ['hr'] },
    scoring: { rule: 'top3', coOwners: false },
    sweep: { id: 's1', name: 'Test Sweep', role: 'member' },
    readOnly: false, wageringEnabled: true,
    competition: bball ? BBALL_COMP : FOOT_COMP,
    ...rest,
  }
}
export function makeApi(over = {}) {
  const { sport = 'football', fixtures, standings, bootstrap, ...rest } = over
  const bball = sport === 'basketball'
  return {
    bootstrap: bootstrap ?? makeBootstrap({ sport }),
    fixtures: fixtures ?? [bball ? makeFixture({ t1: 'lal', t2: 'bos', group: '', matchday: 0 }) : makeFixture()],
    standings: standings ?? (bball
      ? { 'Eastern Conference': [{ code: 'bos', name: 'Celtics', played: 2, win: 2, draw: 0, loss: 0, gf: 0, ga: 0, gd: 0, pts: 0, pct: 1, pf: 240, pa: 200 }],
          'Western Conference': [{ code: 'lal', name: 'Lakers', played: 2, win: 1, draw: 0, loss: 1, gf: 0, ga: 0, gd: 0, pts: 0, pct: 0.5, pf: 220, pa: 221 }] }
      : { A: [{ code: 'hr', name: 'Croatia', played: 1, win: 1, draw: 0, loss: 0, gf: 2, ga: 0, gd: 2, pts: 3, pct: null, pf: null, pa: null }] }),
    photos: [], syncStatus: {},
    ...rest,
  }
}
