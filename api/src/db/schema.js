import { pgTable, text, integer, numeric, primaryKey, timestamp, boolean, jsonb, serial, index, unique, foreignKey } from 'drizzle-orm/pg-core'

export const sweep = pgTable('sweep', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').notNull().default('token'), // 'default' | 'token'
  memberToken: text('member_token').unique(),
  adminToken: text('admin_token').unique(),
  scoringRule: text('scoring_rule').notNull().default('top3'),
  coOwners: text('co_owners').notNull().default('all_win'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
})

export const person = pgTable('person', {
  id: text('id').primaryKey(),
  sweepId: text('sweep_id').notNull().references(() => sweep.id),
  name: text('name').notNull(),
  short: text('short').notNull(),
  initials: text('initials').notNull(),
  avColor: text('av_color').notNull(),
  avatarPath: text('avatar_path'),
  // wagers are 18+; admins flag minors so they can't see/use the coins feature
  adult: boolean('adult').notNull().default(true),
  // Wagers self-exclusion (responsible-gambling). NULL = active. A future timestamp =
  // excluded until then (auto-clears). The FOREVER sentinel (year 9999) = indefinite.
  // Binding: the opt-out endpoint only ever extends this, never shortens it.
  excludedUntil: timestamp('excluded_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sweepIdx: index('person_sweep_id_idx').on(t.sweepId),
  // target for child composite FKs that pin a row to its person's sweep
  idSweepUq: unique('person_id_sweep_id_uq').on(t.id, t.sweepId),
}))

export const team = pgTable('team', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  group: text('group').notNull(),
  pool: text('pool').notNull(),
  color: text('color').notNull(),
  strength: integer('strength').notNull(),
  flagCode: text('flag_code').notNull(),
  squad: jsonb('squad'),
})

export const ownership = pgTable('ownership', {
  sweepId: text('sweep_id').notNull(),
  personId: text('person_id').notNull(),
  teamCode: text('team_code').notNull().references(() => team.code),
}, (t) => ({
  pk: primaryKey({ columns: [t.personId, t.teamCode] }),
  sweepIdx: index('ownership_sweep_id_idx').on(t.sweepId),
  // composite FK pins (person, sweep) together — a row can never reference a person in another sweep
  personSweepFk: foreignKey({ columns: [t.personId, t.sweepId], foreignColumns: [person.id, person.sweepId], name: 'ownership_person_sweep_fk' }),
}))

export const teamCrosswalk = pgTable('team_crosswalk', {
  teamCode: text('team_code').primaryKey().references(() => team.code),
  providerTeamId: integer('provider_team_id'),
})

export const fixture = pgTable('fixture', {
  id: text('id').primaryKey(),
  group: text('group').notNull(),
  matchday: integer('matchday').notNull(),
  t1Code: text('t1_code').notNull().references(() => team.code),
  t2Code: text('t2_code').notNull().references(() => team.code),
  kickoffUtc: timestamp('kickoff_utc', { withTimezone: true }).notNull(),
  venue: text('venue').notNull(),
  city: text('city').notNull(),
  status: text('status').notNull(),
  score1: integer('score1'),
  score2: integer('score2'),
  regScore1: integer('reg_score1'),
  regScore2: integer('reg_score2'),
  minute: integer('minute'),
  probA: integer('prob_a'),
  probD: integer('prob_d'),
  probB: integer('prob_b'),
  winnerCode: text('winner_code'), // winning team code or 'DRAW', set when final
  markets: jsonb('markets'),
  htScore1: integer('ht_score1'),
  htScore2: integer('ht_score2'),
  lineups: jsonb('lineups'),
  events: jsonb('events'),
  statistics: jsonb('statistics'), // { [teamCode]: { shotsOnGoal, totalShots, corners, possession, fouls } }
  stage: text('stage').notNull().default('group'),
  derby: boolean('derby').notNull().default(false),
  doubleOwner: boolean('double_owner').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const standing = pgTable('standing', {
  teamCode: text('team_code').primaryKey().references(() => team.code),
  played: integer('played').notNull().default(0),
  win: integer('win').notNull().default(0),
  draw: integer('draw').notNull().default(0),
  loss: integer('loss').notNull().default(0),
  gf: integer('gf').notNull().default(0),
  ga: integer('ga').notNull().default(0),
  pts: integer('pts').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const syncLog = pgTable('sync_log', {
  id: serial('id').primaryKey(),
  ranAt: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
  source: text('source').notNull(),
  kind: text('kind').notNull(),
  status: text('status').notNull(),
  counts: jsonb('counts'),
  error: text('error'),
})

export const watch = pgTable('watch', {
  sweepId: text('sweep_id').notNull(),
  fixtureId: text('fixture_id').notNull().references(() => fixture.id),
  personId: text('person_id').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.fixtureId, t.personId] }),
  sweepIdx: index('watch_sweep_id_idx').on(t.sweepId),
  personSweepFk: foreignKey({ columns: [t.personId, t.sweepId], foreignColumns: [person.id, person.sweepId], name: 'watch_person_sweep_fk' }),
}))

export const support = pgTable('support', {
  sweepId: text('sweep_id').notNull(),
  fixtureId: text('fixture_id').notNull().references(() => fixture.id),
  personId: text('person_id').notNull(),
  // a pick: t1Code, t2Code, or the literal 'DRAW' (group-stage draw) — not a team FK
  teamCode: text('team_code').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.fixtureId, t.personId] }),
  sweepIdx: index('support_sweep_id_idx').on(t.sweepId),
  personSweepFk: foreignKey({ columns: [t.personId, t.sweepId], foreignColumns: [person.id, person.sweepId], name: 'support_person_sweep_fk' }),
}))

export const coinLedger = pgTable('coin_ledger', {
  id: serial('id').primaryKey(),
  sweepId: text('sweep_id').notNull(),
  personId: text('person_id').notNull(),
  type: text('type').notNull(),         // 'grant' | 'stake' | 'payout' | 'refund' | 'predict' | 'teamwin'
  amount: integer('amount').notNull(),  // signed
  refId: text('ref_id').notNull(),      // week index for grants, bet id otherwise
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sweepIdx: index('coin_ledger_sweep_id_idx').on(t.sweepId),
  personSweepFk: foreignKey({ columns: [t.personId, t.sweepId], foreignColumns: [person.id, person.sweepId], name: 'coin_ledger_person_sweep_fk' }),
  // idempotent grants/payouts: at most one row per (person, type, ref)
  entryUq: unique('coin_ledger_entry_uq').on(t.sweepId, t.personId, t.type, t.refId),
}))

export const parlay = pgTable('parlay', {
  id: text('id').primaryKey(),
  sweepId: text('sweep_id').notNull(),
  personId: text('person_id').notNull(),
  stake: integer('stake').notNull(),
  combinedOdds: numeric('combined_odds').notNull(),
  potentialPayout: integer('potential_payout').notNull(),
  status: text('status').notNull().default('open'), // 'open' | 'won' | 'lost' | 'refunded'
  placedAt: timestamp('placed_at', { withTimezone: true }).notNull().defaultNow(),
  settledAt: timestamp('settled_at', { withTimezone: true }),
}, (t) => ({
  sweepIdx: index('parlay_sweep_id_idx').on(t.sweepId),
  personSweepFk: foreignKey({ columns: [t.personId, t.sweepId], foreignColumns: [person.id, person.sweepId], name: 'parlay_person_sweep_fk' }),
}))

export const bet = pgTable('bet', {
  id: text('id').primaryKey(),
  sweepId: text('sweep_id').notNull(),
  personId: text('person_id').notNull(),
  fixtureId: text('fixture_id').notNull().references(() => fixture.id),
  selection: text('selection').notNull(), // 'HOME' | 'DRAW' | 'AWAY'
  market: text('market').notNull().default('1x2'),
  line: numeric('line'),
  stake: integer('stake').notNull(),
  oddsDecimal: numeric('odds_decimal').notNull(),
  book: text('book'),
  potentialPayout: integer('potential_payout').notNull(),
  status: text('status').notNull().default('open'), // 'open' | 'won' | 'lost' | 'refunded'
  placedAt: timestamp('placed_at', { withTimezone: true }).notNull().defaultNow(),
  settledAt: timestamp('settled_at', { withTimezone: true }),
  parlayId: text('parlay_id').references(() => parlay.id, { onDelete: 'cascade' }),
}, (t) => ({
  sweepIdx: index('bet_sweep_id_idx').on(t.sweepId),
  fixtureIdx: index('bet_fixture_id_idx').on(t.fixtureId),
  parlayIdx: index('bet_parlay_id_idx').on(t.parlayId),
  personSweepFk: foreignKey({ columns: [t.personId, t.sweepId], foreignColumns: [person.id, person.sweepId], name: 'bet_person_sweep_fk' }),
}))

export const photo = pgTable('photo', {
  id: text('id').primaryKey(),
  sweepId: text('sweep_id').notNull().references(() => sweep.id),
  kind: text('kind').notNull(),
  uploaderName: text('uploader_name').notNull(),
  // nullable (fan photos have no person), so it keeps single-column FKs rather than a composite tenant FK
  personId: text('person_id').references(() => person.id),
  fixtureId: text('fixture_id').references(() => fixture.id, { onDelete: 'set null' }),
  filePath: text('file_path').notNull(),
  thumbPath: text('thumb_path'),
  caption: text('caption'),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  moderatedAt: timestamp('moderated_at', { withTimezone: true }),
}, (t) => ({
  sweepIdx: index('photo_sweep_id_idx').on(t.sweepId),
}))
