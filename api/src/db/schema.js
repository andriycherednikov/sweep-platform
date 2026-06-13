import { pgTable, text, integer, primaryKey, timestamp, boolean, jsonb, serial, uniqueIndex } from 'drizzle-orm/pg-core'

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
})

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
  sweepId: text('sweep_id').notNull().references(() => sweep.id),
  personId: text('person_id').notNull().references(() => person.id),
  teamCode: text('team_code').notNull().references(() => team.code),
}, (t) => ({
  pk: primaryKey({ columns: [t.personId, t.teamCode] }),
  oneOwnerPerTeam: uniqueIndex('ownership_sweep_team_uq').on(t.sweepId, t.teamCode),
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
  minute: integer('minute'),
  probA: integer('prob_a'),
  probD: integer('prob_d'),
  probB: integer('prob_b'),
  lineups: jsonb('lineups'),
  events: jsonb('events'),
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
  sweepId: text('sweep_id').notNull().references(() => sweep.id),
  fixtureId: text('fixture_id').notNull().references(() => fixture.id),
  personId: text('person_id').notNull().references(() => person.id),
}, (t) => ({ pk: primaryKey({ columns: [t.fixtureId, t.personId] }) }))

export const support = pgTable('support', {
  sweepId: text('sweep_id').notNull().references(() => sweep.id),
  fixtureId: text('fixture_id').notNull().references(() => fixture.id),
  personId: text('person_id').notNull().references(() => person.id),
  // a pick: t1Code, t2Code, or the literal 'DRAW' (group-stage draw) — not a team FK
  teamCode: text('team_code').notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.fixtureId, t.personId] }) }))

export const photo = pgTable('photo', {
  id: text('id').primaryKey(),
  sweepId: text('sweep_id').notNull().references(() => sweep.id),
  kind: text('kind').notNull(),
  uploaderName: text('uploader_name').notNull(),
  personId: text('person_id').references(() => person.id),
  fixtureId: text('fixture_id').references(() => fixture.id, { onDelete: 'set null' }),
  filePath: text('file_path').notNull(),
  thumbPath: text('thumb_path'),
  caption: text('caption'),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  moderatedAt: timestamp('moderated_at', { withTimezone: true }),
})
