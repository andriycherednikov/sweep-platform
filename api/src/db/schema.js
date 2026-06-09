import { pgTable, text, integer, primaryKey } from 'drizzle-orm/pg-core'

export const person = pgTable('person', {
  id: text('id').primaryKey(),
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
})

export const ownership = pgTable('ownership', {
  personId: text('person_id').notNull().references(() => person.id),
  teamCode: text('team_code').notNull().references(() => team.code),
}, (t) => ({ pk: primaryKey({ columns: [t.personId, t.teamCode] }) }))

export const scoringConfig = pgTable('scoring_config', {
  id: integer('id').primaryKey(),
  rule: text('rule').notNull(),
  coOwners: text('co_owners').notNull(),
})

export const teamCrosswalk = pgTable('team_crosswalk', {
  teamCode: text('team_code').primaryKey().references(() => team.code),
  providerTeamId: integer('provider_team_id'),
})
