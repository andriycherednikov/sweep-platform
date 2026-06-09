import { person, ownership } from '../db/schema.js'
import { roster } from './roster.js'
import { createPool, createDb } from '../db/client.js'

const AV_COLORS = ['#d2342a', '#3b6fd1', '#0a6b3b', '#7a4fd1', '#c9472f', '#1f7a8c', '#b5562a', '#5a4fd1', '#2a8f6a', '#c23a6a']

/** Derive a person row (id, name, short, initials, av color) from a display name. */
export function toPerson(name, i) {
  const parts = name.trim().split(/\s+/)
  const initials = (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase()
  const short = parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0]
  return { id: `p${i + 1}`, name, short, initials, avColor: AV_COLORS[i % AV_COLORS.length] }
}

/**
 * Idempotently rebuild `person` + `ownership` from the roster (replaces the demo people).
 * Safe to re-run: clears ownership then people, then re-inserts. Photos keep their text
 * uploader_name; any profile photo (none yet) tagged to an old person id is removed first.
 */
export async function importRoster(db, list = roster) {
  await db.delete(ownership)
  await db.delete(person)
  for (let i = 0; i < list.length; i++) {
    const p = toPerson(list[i].name, i)
    await db.insert(person).values(p)
    for (const code of list[i].teams) {
      await db.insert(ownership).values({ personId: p.id, teamCode: code }).onConflictDoNothing()
    }
  }
  return { people: list.length, picks: list.reduce((n, r) => n + r.teams.length, 0) }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = createPool()
  const r = await importRoster(createDb(pool))
  await pool.end()
  console.log(`imported ${r.people} people, ${r.picks} ownership picks`)
}
