import { liveLabel } from './format.js'

/* Per-sport UI vocabulary. Anything not listed here must key off wire facts
   (hasDraws/format), not off sport names. */
const GENERIC = {
  noun: 'game', nounPlural: 'games', groupLabel: 'Group', finalLabel: 'Final', ftShort: 'Final',
  koTabLabel: 'Playoffs', teamsIcon: 'shield',
  standingsCols: [['played', 'P'], ['win', 'W'], ['loss', 'L'], ['pct', 'PCT'], ['pf', 'PF'], ['pa', 'PA']],
  live: (f) => f.phase || '',
}
const SPORT_VOCAB = {
  football: {
    ...GENERIC,
    noun: 'match', nounPlural: 'matches', finalLabel: 'Full time', ftShort: 'FT',
    koTabLabel: 'Knockouts', teamsIcon: 'ball',
    standingsCols: [['played', 'P'], ['win', 'W'], ['draw', 'D'], ['loss', 'L'], ['gf', 'GF'], ['ga', 'GA'], ['pts', 'PTS']],
    live: liveLabel,
  },
  basketball: GENERIC,
}
export function vocabFor(sport) { return SPORT_VOCAB[sport] || GENERIC }
