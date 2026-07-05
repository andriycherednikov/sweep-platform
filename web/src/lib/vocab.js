import { liveLabel } from './format.js'

/* Per-sport UI vocabulary. Anything not listed here must key off wire facts
   (hasDraws/format), not off sport names. */
const GENERIC = {
  noun: 'game', nounPlural: 'games', groupLabel: 'Group', finalLabel: 'Final', ftShort: 'Final',
  koTabLabel: 'Playoffs', teamsIcon: 'shield', kickoffLabel: 'Starting soon', startsInLabel: 'Starts in',
  standingsCols: [['played', 'P'], ['win', 'W'], ['loss', 'L'], ['pct', 'PCT'], ['pf', 'PF'], ['pa', 'PA']],
  live: (f) => f.phase || '',
  groupHeading: (k) => k,
}
const SPORT_VOCAB = {
  football: {
    ...GENERIC,
    noun: 'match', nounPlural: 'matches', finalLabel: 'Full time', ftShort: 'FT',
    koTabLabel: 'Knockouts', teamsIcon: 'ball', kickoffLabel: 'Kicking off', startsInLabel: 'Kicks off in',
    // pre-branch column set (WC visual parity): P W D L GD PTS — GD, not GF/GA.
    standingsCols: [['played', 'P'], ['win', 'W'], ['draw', 'D'], ['loss', 'L'], ['gd', 'GD'], ['pts', 'PTS']],
    live: liveLabel,
    groupHeading: (k) => `Group ${k}`,
  },
  basketball: { ...GENERIC, groupLabel: 'Conference', groupHeading: (k) => k },
}
export function vocabFor(sport) { return SPORT_VOCAB[sport] || GENERIC }
