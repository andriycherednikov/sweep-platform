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
  competitionId: text('competition_id').notNull().references(() => competition.id),
  accountId: text('account_id').references(() => account.id),
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

export const ownership = pgTable('ownership', {
  sweepId: text('sweep_id').notNull(),
  personId: text('person_id').notNull(),
  competitorId: text('competitor_id').notNull().references(() => competitor.id),
}, (t) => ({
  pk: primaryKey({ columns: [t.personId, t.competitorId] }),
  sweepIdx: index('ownership_sweep_id_idx').on(t.sweepId),
  // composite FK pins (person, sweep) together — a row can never reference a person in another sweep
  personSweepFk: foreignKey({ columns: [t.personId, t.sweepId], foreignColumns: [person.id, person.sweepId], name: 'ownership_person_sweep_fk' }),
}))

export const syncLog = pgTable('sync_log', {
  id: serial('id').primaryKey(),
  ranAt: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
  source: text('source').notNull(),
  kind: text('kind').notNull(),
  status: text('status').notNull(),
  counts: jsonb('counts'),
  error: text('error'),
})

export const support = pgTable('support', {
  sweepId: text('sweep_id').notNull(),
  fixtureId: text('fixture_id').notNull().references(() => event.id),
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
  fixtureId: text('fixture_id').notNull().references(() => event.id),
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
  fixtureId: text('fixture_id').references(() => event.id, { onDelete: 'set null' }),
  filePath: text('file_path').notNull(),
  thumbPath: text('thumb_path'),
  caption: text('caption'),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  moderatedAt: timestamp('moderated_at', { withTimezone: true }),
}, (t) => ({
  sweepIdx: index('photo_sweep_id_idx').on(t.sweepId),
}))

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // P4 billing — Stripe state mirror (webhook-written). null subscriptionStatus = never subscribed.
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  stripeSubscriptionItemId: text('stripe_subscription_item_id'),
  subscriptionStatus: text('subscription_status'),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),      // one cardless trial clock per account, set at first provision
  trialReminderSentAt: timestamp('trial_reminder_sent_at', { withTimezone: true }),
})

export const loginToken = pgTable('login_token', {
  token: text('token').primaryKey(),
  email: text('email').notNull(), // keyed by email, NOT account — account is created on first USE (verified email)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
})

export const accountSession = pgTable('account_session', {
  token: text('token').primaryKey(),
  accountId: text('account_id').notNull().references(() => account.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

export const catalogLeague = pgTable('catalog_league', {
  id: text('id').primaryKey(), // '<provider>:<providerLeagueId>'
  provider: text('provider').notNull(),
  providerLeagueId: text('provider_league_id').notNull(),
  name: text('name').notNull(),
  type: text('type').notNull(), // raw feed value — 'League' | 'Cup' | 'cup' (casing varies by API)
  logo: text('logo'),
  country: jsonb('country'), // {name, code, flag} | null
  seasons: jsonb('seasons').notNull().default([]), // [{season, start, end, current, standings, odds}]
  curated: boolean('curated').notNull().default(false), // sync NEVER touches this — curation is operator data
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const billingEvent = pgTable('billing_event', {
  id: serial('id').primaryKey(),
  stripeEventId: text('stripe_event_id').notNull().unique(), // idempotency: duplicate webhook delivery → conflict → no-op
  type: text('type').notNull(),
  accountId: text('account_id'),
  summary: jsonb('summary'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const competition = pgTable('competition', {
  id: text('id').primaryKey(), // '<provider>:<leagueId>:<season>'
  provider: text('provider').notNull(),
  sport: text('sport').notNull(),
  leagueId: text('league_id').notNull(),
  season: text('season').notNull(),
  format: text('format').notNull(), // 'league' | 'groups_then_ko' | 'knockout'
  name: text('name').notNull(),
  logo: text('logo'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  providerUq: unique('competition_provider_uq').on(t.provider, t.sport, t.leagueId, t.season),
}))

export const competitor = pgTable('competitor', {
  id: text('id').primaryKey(),
  competitionId: text('competition_id').notNull().references(() => competition.id),
  code: text('code').notNull(),
  name: text('name').notNull(),
  color: text('color').notNull(),
  logo: text('logo'),
  providerId: integer('provider_id'), // replaces team_crosswalk
  meta: jsonb('meta'), // soccer: {group, pool, strength, squad}; NBA: {conference}
}, (t) => ({
  codeUq: unique('competitor_competition_code_uq').on(t.competitionId, t.code),
  compIdx: index('competitor_competition_id_idx').on(t.competitionId),
}))

export const event = pgTable('event', {
  id: text('id').primaryKey(),
  competitionId: text('competition_id').notNull().references(() => competition.id),
  c1Code: text('c1_code').notNull(),
  c2Code: text('c2_code').notNull(),
  startUtc: timestamp('start_utc', { withTimezone: true }).notNull(),
  status: text('status').notNull(), // 'upcoming' | 'live' | 'final'
  score1: integer('score1'),
  score2: integer('score2'),
  winnerCode: text('winner_code'), // winning competitor code or 'DRAW', set when final
  round: text('round'),
  stage: text('stage').notNull().default('group'),
  // sport-specific payload: {group, matchday, venue, city, minute, phase, ht:[..], reg:[..],
  //  pen:[..], prob:{a,d,b}, markets, lineups, events, statistics, derby, doubleOwner}
  detail: jsonb('detail').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  compStartIdx: index('event_competition_start_idx').on(t.competitionId, t.startUtc),
  c1Fk: foreignKey({ columns: [t.c1Code, t.competitionId], foreignColumns: [competitor.code, competitor.competitionId], name: 'event_c1_fk' }),
  c2Fk: foreignKey({ columns: [t.c2Code, t.competitionId], foreignColumns: [competitor.code, competitor.competitionId], name: 'event_c2_fk' }),
}))

export const ranking = pgTable('ranking', {
  competitionId: text('competition_id').notNull(),
  competitorCode: text('competitor_code').notNull(),
  rank: integer('rank'),
  points: integer('points').notNull().default(0),
  stats: jsonb('stats'), // soccer: {played,win,draw,loss,gf,ga}
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.competitionId, t.competitorCode] }),
  competitorFk: foreignKey({ columns: [t.competitorCode, t.competitionId], foreignColumns: [competitor.code, competitor.competitionId], name: 'ranking_competitor_fk' }),
}))
